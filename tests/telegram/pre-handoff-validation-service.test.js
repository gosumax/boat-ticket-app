import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';

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

function seedPreparedRequest(context, clock, suffix) {
  wireClock(context, clock);

  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-validation-${suffix}`,
    display_name: `Validation Guest ${suffix}`,
    username: `validation_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7997777${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-validation-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Validation ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-validation-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `validation-zone-${suffix}` },
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
    requested_trip_date: '2026-04-16',
    requested_time_slot: '12:00',
    requested_seats: 2,
    requested_ticket_mix: { adult: 2 },
    requested_prepayment_amount: 3200,
    currency: 'RUB',
    contact_phone_e164: `+7997777${suffix}`,
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

describe('telegram pre-handoff validation service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T14:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('returns valid_for_handoff when the frozen snapshot is ready and execution has not already started, blocked, or consumed', () => {
    const prepared = seedPreparedRequest(context, clock, '8001');
    setPreparedSnapshot(
      context,
      prepared.booking_request_reference.booking_request_id,
      (snapshot) => ({
        ...snapshot,
        trip: {
          ...snapshot.trip,
          slot_uid: 'generated:50',
          slot_resolution_required: false,
        },
      })
    );

    const result =
      context.services.preHandoffValidationService.readValidationByBookingRequestReference(
        prepared.booking_request_reference.booking_request_id
      );

    expect(result.validation_status).toBe('valid_for_handoff');
    expect(result.handoff_allowed).toBe(true);
    expect(result.blocking_issues).toEqual([]);
    expect(result.warning_issues[0].code).toBe('PAYMENT_METHOD_SELECTION_REQUIRED');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('returns manual_review_required when the frozen snapshot still requires slot resolution', () => {
    const prepared = seedPreparedRequest(context, clock, '8002');

    const result =
      context.services.preHandoffValidationService.readValidationByBookingRequestReference(
        prepared.booking_request_reference.booking_request_id
      );

    expect(result.validation_status).toBe('manual_review_required');
    expect(result.handoff_allowed).toBe(false);
    expect(result.blocking_issues).toEqual([]);
    expect(result.warning_issues.map((item) => item.code)).toContain(
      'SLOT_RESOLUTION_REQUIRED'
    );
  });

  it('returns blocked_for_handoff when current execution is already blocked', () => {
    const prepared = seedPreparedRequest(context, clock, '8003');
    setPreparedSnapshot(
      context,
      prepared.booking_request_reference.booking_request_id,
      (snapshot) => ({
        ...snapshot,
        trip: {
          ...snapshot.trip,
          slot_uid: 'generated:51',
          slot_resolution_required: false,
        },
      })
    );
    context.services.handoffExecutionService.markQueued({
      booking_request_reference: prepared.booking_request_reference,
      queue_reason: 'ready',
    });
    clock.advanceMinutes(2);
    context.services.handoffExecutionService.markBlocked({
      booking_request_reference: prepared.booking_request_reference,
      blocked_reason: 'slot_resolution_missing',
    });

    const result =
      context.services.preHandoffValidationService.readValidationByBookingRequestReference(
        prepared.booking_request_reference.booking_request_id
      );

    expect(result.validation_status).toBe('blocked_for_handoff');
    expect(result.handoff_allowed).toBe(false);
    expect(result.blocking_issues.map((item) => item.code)).toContain(
      'EXECUTION_ALREADY_BLOCKED'
    );
  });

  it('rejects invalid or non-projectable requests deterministically', () => {
    expect(() =>
      context.services.preHandoffValidationService.readValidationByBookingRequestReference(9999)
    ).toThrow('Invalid booking request reference');

    const prepared = seedPreparedRequest(context, clock, '8004');
    context.repositories.bookingRequests.updateById(
      prepared.booking_request_reference.booking_request_id,
      {
        request_status: 'SELLER_NOT_REACHED',
        last_status_at: '2026-04-10T14:15:00.000Z',
      }
    );

    expect(() =>
      context.services.preHandoffValidationService.readValidationByBookingRequestReference(
        prepared.booking_request_reference.booking_request_id
      )
    ).toThrow('not projectable');
  });
});
