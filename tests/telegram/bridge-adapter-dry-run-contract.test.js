import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_BRIDGE_ADAPTER_DRY_RUN_CONTRACT_NAME,
  TELEGRAM_BRIDGE_ADAPTER_DRY_RUN_CONTRACT_VERSION,
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
  };
}

function wireClock(context, clock) {
  context.services.attributionService.now = clock.now;
  context.services.bookingRequestService.now = clock.now;
  context.services.presaleHandoffService.now = clock.now;
}

function seedPreparedRequest(
  context,
  clock,
  suffix,
  {
    requestedSeats = 2,
    requestedTicketMix = { adult: 2 },
    requestedPrepaymentAmount = 2500,
  } = {}
) {
  wireClock(context, clock);

  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-dry-run-${suffix}`,
    display_name: `Dry Run Guest ${suffix}`,
    username: `dry_run_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7997666${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-dry-run-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Dry Run ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-dry-run-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `dry-run-zone-${suffix}` },
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
    requested_trip_date: '2026-04-15',
    requested_time_slot: '14:30',
    requested_seats: requestedSeats,
    requested_ticket_mix: requestedTicketMix,
    requested_prepayment_amount: requestedPrepaymentAmount,
    currency: 'RUB',
    contact_phone_e164: `+7997666${suffix}`,
  });

  const confirmed = services.bookingRequestService.confirmPrepayment(
    lifecycleResult.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: `payment-${suffix}`,
    }
  );

  return services.presaleHandoffService.prepareHandoff(
    confirmed.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: `prepared-${suffix}`,
    }
  );
}

function setPreparedSnapshot(context, bookingRequestId, mutateSnapshot) {
  const preparedEvent = context.repositories.bookingRequestEvents.findOneBy(
    {
      booking_request_id: bookingRequestId,
      event_type: 'HANDOFF_PREPARED',
    },
    { orderBy: 'booking_request_event_id DESC' }
  );
  const nextSnapshot = mutateSnapshot(preparedEvent.event_payload.payload);
  context.repositories.bookingRequestEvents.updateById(
    preparedEvent.booking_request_event_id,
    {
      event_payload: {
        ...preparedEvent.event_payload,
        handoff_snapshot: nextSnapshot,
        payload: nextSnapshot,
      },
    }
  );
}

describe('telegram bridge adapter dry-run contract service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T13:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('returns dry_run_valid with a normalized bridge input summary when the frozen snapshot is structurally consumable', () => {
    const prepared = seedPreparedRequest(context, clock, '7001');
    setPreparedSnapshot(
      context,
      prepared.booking_request_reference.booking_request_id,
      (snapshot) => ({
        ...snapshot,
        trip: {
          ...snapshot.trip,
          slot_uid: 'generated:42',
          slot_resolution_required: false,
        },
      })
    );

    const refreshed = context.services.handoffReadinessQueryService.readPreparedRequest(
      prepared.booking_request_reference.booking_request_id
    );
    const result =
      context.services.bridgeAdapterDryRunContractService.validateFrozenHandoffSnapshot(
        refreshed.handoff_snapshot
      );

    expect(result.adapter_name).toBe(TELEGRAM_BRIDGE_ADAPTER_DRY_RUN_CONTRACT_NAME);
    expect(result.adapter_version).toBe(
      TELEGRAM_BRIDGE_ADAPTER_DRY_RUN_CONTRACT_VERSION
    );
    expect(result.adapter_status).toBe('dry_run_valid');
    expect(result.blocked_reason).toBeNull();
    expect(result.normalized_bridge_input_summary.presale_create_request_summary).toEqual({
      slotUid: 'generated:42',
      tripDate: '2026-04-15',
      requestedTimeSlot: '14:30',
      customerName: 'Dry Run Guest 7001',
      customerPhone: '+79976667001',
      numberOfSeats: 2,
      tickets: { adult: 2, teen: 0, child: 0 },
      prepaymentAmount: 2500,
      payment_method: null,
      cash_amount: 0,
      card_amount: 0,
      sellerId: 1,
    });
    expect(result.warning_list[0].code).toBe('PAYMENT_METHOD_SELECTION_REQUIRED');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.normalized_bridge_input_summary)).toBe(true);
  });

  it('returns dry_run_manual_review when the frozen snapshot still requires slot resolution', () => {
    const prepared = seedPreparedRequest(context, clock, '7002');
    const refreshed = context.services.handoffReadinessQueryService.readPreparedRequest(
      prepared.booking_request_reference.booking_request_id
    );

    const result =
      context.services.bridgeAdapterDryRunContractService.validateFrozenHandoffSnapshot(
        refreshed.handoff_snapshot
      );

    expect(result.adapter_status).toBe('dry_run_manual_review');
    expect(result.blocked_reason).toBeNull();
    expect(result.warning_list.map((item) => item.code)).toContain(
      'SLOT_RESOLUTION_REQUIRED'
    );
  });

  it('returns dry_run_blocked when the frozen snapshot contains ticket types outside the current presale contract', () => {
    const prepared = seedPreparedRequest(context, clock, '7003', {
      requestedSeats: 3,
      requestedTicketMix: { adult: 2, infant: 1 },
    });
    setPreparedSnapshot(
      context,
      prepared.booking_request_reference.booking_request_id,
      (snapshot) => ({
        ...snapshot,
        trip: {
          ...snapshot.trip,
          slot_uid: 'generated:44',
          slot_resolution_required: false,
        },
      })
    );

    const refreshed = context.services.handoffReadinessQueryService.readPreparedRequest(
      prepared.booking_request_reference.booking_request_id
    );
    const result =
      context.services.bridgeAdapterDryRunContractService.validateFrozenHandoffSnapshot(
        refreshed.handoff_snapshot
      );

    expect(result.adapter_status).toBe('dry_run_blocked');
    expect(result.blocked_reason).toBe('UNSUPPORTED_TICKET_MIX_KEYS');
  });

  it('rejects inputs that are not frozen handoff snapshots', () => {
    expect(() =>
      context.services.bridgeAdapterDryRunContractService.validateFrozenHandoffSnapshot(123)
    ).toThrow('Frozen handoff snapshot is required');
  });
});
