import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_PRESALE_HANDOFF_ADAPTER_NAME,
  TELEGRAM_PRESALE_HANDOFF_ADAPTER_VERSION,
} from '../../shared/telegram/index.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      role TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE presales (id INTEGER PRIMARY KEY AUTOINCREMENT);
  `);
  db.prepare(`INSERT INTO users (username, role, is_active) VALUES ('seller-a', 'seller', 1)`).run();
  return db;
}

function createClock(startIso) {
  let current = new Date(startIso);
  return {
    now: () => new Date(current),
    advanceMinutes(minutes) {
      current = new Date(current.getTime() + minutes * 60 * 1000);
    },
  };
}

function wireClock(context, clock) {
  context.services.attributionService.now = clock.now;
  context.services.bookingRequestService.now = clock.now;
  context.services.presaleHandoffService.now = clock.now;
  context.services.handoffExecutionService.now = clock.now;
}

function seedPreparedExecution(context, clock, suffix, { start = true, consume = false } = {}) {
  wireClock(context, clock);

  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-adapter-${suffix}`,
    display_name: `Adapter Guest ${suffix}`,
    username: `adapter_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7997333${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-adapter-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Adapter ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-adapter-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `adapter-zone-${suffix}` },
    is_active: 1,
  });

  const attributionResult = services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    entry_channel: 'qr',
  });

  const lifecycleResult = services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id:
      attributionResult.sellerAttributionSession.seller_attribution_session_id,
    requested_trip_date: '2026-04-13',
    requested_time_slot: '13:30',
    requested_seats: 3,
    requested_ticket_mix: { adult: 2, child: 1 },
    requested_prepayment_amount: 4500,
    currency: 'RUB',
    contact_phone_e164: `+7997333${suffix}`,
  });

  const confirmed = services.bookingRequestService.confirmPrepayment(
    lifecycleResult.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: `payment-${suffix}`,
    }
  );

  const prepared = services.presaleHandoffService.prepareHandoff(
    confirmed.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: `prepared-${suffix}`,
    }
  );

  services.handoffExecutionService.queueForHandoff(confirmed.bookingRequest.booking_request_id, {
    actorType: 'system',
    actorId: `queue-${suffix}`,
    queueReason: 'ready_for_adapter',
  });

  if (start) {
    services.handoffExecutionService.startHandoff(confirmed.bookingRequest.booking_request_id, {
      actorType: 'system',
      actorId: `start-${suffix}`,
      startReason: 'adapter_dry_run_window',
    });
  }

  if (consume) {
    services.handoffExecutionService.consumeHandoff(confirmed.bookingRequest.booking_request_id, {
      actorType: 'system',
      actorId: `consume-${suffix}`,
      consumeReason: 'already_consumed_snapshot',
      consumeMetadata: { external_handoff_ref: `dry-run-ref-${suffix}` },
    });
  }

  return {
    guest,
    source,
    qr,
    bookingRequestId: confirmed.bookingRequest.booking_request_id,
    prepared,
  };
}

describe('telegram presale handoff adapter contract layer', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T11:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('builds a deterministic dry-run bridge input and returns success for a consumable snapshot', () => {
    const seeded = seedPreparedExecution(context, clock, '2001', { start: true });
    const before = context.services.handoffExecutionQueryService.readExecutionState(
      seeded.bookingRequestId
    );

    const result = context.services.presaleHandoffAdapterService.validateDryRun(
      seeded.bookingRequestId,
      {
        slotUid: 'generated:42',
      }
    );

    expect(result.outcome).toBe('success');
    expect(result.outcome_code).toBe('DRY_RUN_READY');
    expect(result.adapter_name).toBe(TELEGRAM_PRESALE_HANDOFF_ADAPTER_NAME);
    expect(result.adapter_version).toBe(TELEGRAM_PRESALE_HANDOFF_ADAPTER_VERSION);
    expect(result.handoff_consumable).toBe(true);
    expect(result.bridge_input.bridge_contract_version).toBe(
      TELEGRAM_PRESALE_HANDOFF_ADAPTER_VERSION
    );
    expect(result.bridge_input.presale_create_request).toEqual({
      slotUid: 'generated:42',
      tripDate: '2026-04-13',
      customerName: 'Adapter Guest 2001',
      customerPhone: '+79973332001',
      numberOfSeats: 3,
      tickets: { adult: 2, teen: 0, child: 1 },
      prepaymentAmount: 4500,
      payment_method: 'CASH',
      cash_amount: 4500,
      card_amount: 0,
      sellerId: 1,
    });
    expect(result.validation.blockers).toEqual([]);
    expect(result.validation.failures).toEqual([]);
    expect(result.no_op.production_presale_created).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);

    const after = context.services.handoffExecutionQueryService.readExecutionState(
      seeded.bookingRequestId
    );
    expect(after).toEqual(before);
  });

  it('returns blocked when the consumable snapshot still lacks slotUid resolution', () => {
    const seeded = seedPreparedExecution(context, clock, '2002', { start: true });

    const result = context.services.presaleHandoffAdapterService.validateDryRun(
      seeded.bookingRequestId
    );

    expect(result.outcome).toBe('blocked');
    expect(result.outcome_code).toBe('SLOT_UID_REQUIRED');
    expect(result.bridge_input.presale_create_request.slotUid).toBeNull();
    expect(result.validation.blockers[0].code).toBe('SLOT_UID_REQUIRED');
    expect(result.validation.failures).toEqual([]);
  });

  it('returns blocked when execution state is not yet consumable for the future presale bridge', () => {
    const seeded = seedPreparedExecution(context, clock, '2003', { start: false });

    const result = context.services.presaleHandoffAdapterService.validateDryRun(
      seeded.bookingRequestId,
      {
        slotUid: 'manual:77',
      }
    );

    expect(result.outcome).toBe('blocked');
    expect(result.outcome_code).toBe('EXECUTION_STATE_NOT_CONSUMABLE');
    expect(result.handoff_consumable).toBe(false);
    expect(result.validation.blockers[0].code).toBe('EXECUTION_STATE_NOT_CONSUMABLE');
  });

  it('supports already-consumed snapshots and remains deterministic in dry-run mode', () => {
    const seeded = seedPreparedExecution(context, clock, '2004', {
      start: true,
      consume: true,
    });

    const first = context.services.presaleHandoffAdapterService.validateDryRun(
      seeded.bookingRequestId,
      {
        slotUid: 'manual:88',
        paymentMethod: 'CARD',
      }
    );
    const second = context.services.presaleHandoffAdapterService.validateDryRun(
      seeded.bookingRequestId,
      {
        slotUid: 'manual:88',
        paymentMethod: 'CARD',
      }
    );

    expect(first.outcome).toBe('success');
    expect(first.current_execution_state).toBe('handoff_consumed');
    expect(first.bridge_input.presale_create_request.payment_method).toBe('CARD');
    expect(first.bridge_input.presale_create_request.cash_amount).toBe(0);
    expect(first.bridge_input.presale_create_request.card_amount).toBe(4500);
    expect(second).toEqual(first);
  });

  it('returns failure for an invalid slotUid override while staying no-op', () => {
    const seeded = seedPreparedExecution(context, clock, '2005', { start: true });

    const result = context.services.presaleHandoffAdapterService.validateDryRun(
      seeded.bookingRequestId,
      {
        slotUid: 'invalid-slot',
      }
    );

    expect(result.outcome).toBe('failure');
    expect(result.outcome_code).toBe('INVALID_SLOT_UID');
    expect(result.validation.failures[0].code).toBe('INVALID_SLOT_UID');
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });

  it('returns failure for unsupported ticket mix keys that cannot map to the current presale contract', () => {
    const seeded = seedPreparedExecution(context, clock, '2006', { start: true });
    const preparedEvent = context.repositories.bookingRequestEvents.findOneBy(
      {
        booking_request_id: seeded.bookingRequestId,
        event_type: 'HANDOFF_PREPARED',
      },
      { orderBy: 'booking_request_event_id DESC' }
    );
    context.repositories.bookingRequestEvents.updateById(
      preparedEvent.booking_request_event_id,
      {
        event_payload: {
          ...preparedEvent.event_payload,
          payload: {
            ...preparedEvent.event_payload.payload,
            trip: {
              ...preparedEvent.event_payload.payload.trip,
              requested_ticket_mix: { adult: 2, infant: 1 },
            },
          },
        },
      }
    );

    const result = context.services.presaleHandoffAdapterService.validateDryRun(
      seeded.bookingRequestId,
      {
        slotUid: 'generated:90',
      }
    );

    expect(result.outcome).toBe('failure');
    expect(result.outcome_code).toBe('UNSUPPORTED_TICKET_MIX_KEYS');
    expect(result.validation.failures[0].code).toBe('UNSUPPORTED_TICKET_MIX_KEYS');
  });
});
