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

function seedBookingRequest(
  context,
  clock,
  suffix,
  {
    confirmPrepayment = true,
    prepareHandoff = true,
    requestedPrepaymentAmount = 3200,
  } = {}
) {
  wireClock(context, clock);

  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-eligibility-${suffix}`,
    display_name: `Eligibility Guest ${suffix}`,
    username: `eligibility_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7997888${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-eligibility-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Eligibility ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-eligibility-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `eligibility-zone-${suffix}` },
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
    requested_trip_date: '2026-04-17',
    requested_time_slot: '13:00',
    requested_seats: 2,
    requested_ticket_mix: { adult: 2 },
    requested_prepayment_amount: requestedPrepaymentAmount,
    currency: 'RUB',
    contact_phone_e164: `+7997888${suffix}`,
  });

  let bookingRequestId = lifecycleResult.bookingRequest.booking_request_id;
  if (confirmPrepayment) {
    bookingRequestId = services.bookingRequestService.confirmPrepayment(bookingRequestId, {
      actorType: 'system',
      actorId: `payment-${suffix}`,
    }).bookingRequest.booking_request_id;
  }

  if (prepareHandoff) {
    services.presaleHandoffService.prepareHandoff(bookingRequestId, {
      actorType: 'system',
      actorId: `prepared-${suffix}`,
    });
  }

  return {
    bookingRequestId,
  };
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

describe('telegram handoff eligibility projection service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T15:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('projects eligible_for_bridge when readiness is ready and validation succeeds', () => {
    const seeded = seedBookingRequest(context, clock, '9001');
    setPreparedSnapshot(context, seeded.bookingRequestId, (snapshot) => ({
      ...snapshot,
      trip: {
        ...snapshot.trip,
        slot_uid: 'generated:60',
        slot_resolution_required: false,
      },
    }));

    const result =
      context.services.handoffEligibilityProjectionService.readHandoffEligibilityByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(result.eligibility_state).toBe('eligible_for_bridge');
    expect(result.execution_state).toBe('handoff_prepared');
    expect(result.validation_status).toBe('valid_for_handoff');
  });

  it('projects not_ready for projectable requests that are not yet prepayment_confirmed and handoff_prepared', () => {
    const seeded = seedBookingRequest(context, clock, '9002', {
      confirmPrepayment: false,
      prepareHandoff: false,
    });

    const result =
      context.services.handoffEligibilityProjectionService.readHandoffEligibilityByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(result.eligibility_state).toBe('not_ready');
    expect(result.execution_state).toBeNull();
    expect(result.validation_status).toBeNull();
  });

  it('projects manual_review_required when pre-handoff validation requires slot resolution', () => {
    const seeded = seedBookingRequest(context, clock, '9003');

    const result =
      context.services.handoffEligibilityProjectionService.readHandoffEligibilityByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(result.eligibility_state).toBe('manual_review_required');
    expect(result.validation_status).toBe('manual_review_required');
  });

  it('projects already_consumed once the frozen snapshot has been consumed', () => {
    const seeded = seedBookingRequest(context, clock, '9004');
    setPreparedSnapshot(context, seeded.bookingRequestId, (snapshot) => ({
      ...snapshot,
      trip: {
        ...snapshot.trip,
        slot_uid: 'generated:61',
        slot_resolution_required: false,
      },
    }));
    context.services.handoffExecutionService.markQueued({
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: seeded.bookingRequestId,
      },
      queue_reason: 'ready',
    });
    context.services.handoffExecutionService.markStarted({
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: seeded.bookingRequestId,
      },
      start_reason: 'bridge_worker',
    });
    context.services.handoffExecutionService.markConsumed({
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: seeded.bookingRequestId,
      },
      consume_reason: 'acknowledged',
    });

    const result =
      context.services.handoffEligibilityProjectionService.readHandoffEligibilityByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(result.eligibility_state).toBe('already_consumed');
    expect(result.execution_state).toBe('handoff_consumed');
  });

  it('lists eligible requests separately from requests needing manual review', () => {
    const eligible = seedBookingRequest(context, clock, '9005');
    setPreparedSnapshot(context, eligible.bookingRequestId, (snapshot) => ({
      ...snapshot,
      trip: {
        ...snapshot.trip,
        slot_uid: 'generated:62',
        slot_resolution_required: false,
      },
    }));
    clock.advanceMinutes(2);
    const manual = seedBookingRequest(context, clock, '9006');

    const eligibleList =
      context.services.handoffEligibilityProjectionService.listHandoffEligibleRequests();
    const manualList =
      context.services.handoffEligibilityProjectionService.listRequestsNeedingManualReview();

    expect(eligibleList.items).toHaveLength(1);
    expect(eligibleList.items[0].booking_request_reference.booking_request_id).toBe(
      eligible.bookingRequestId
    );
    expect(manualList.items).toHaveLength(1);
    expect(manualList.items[0].booking_request_reference.booking_request_id).toBe(
      manual.bookingRequestId
    );
  });

  it('rejects invalid or non-projectable booking request reads deterministically', () => {
    expect(() =>
      context.services.handoffEligibilityProjectionService.readHandoffEligibilityByBookingRequestReference(
        9999
      )
    ).toThrow('Invalid booking request reference');

    const seeded = seedBookingRequest(context, clock, '9007');
    context.repositories.bookingRequests.updateById(seeded.bookingRequestId, {
      request_status: 'SELLER_NOT_REACHED',
      last_status_at: '2026-04-10T15:30:00.000Z',
    });

    expect(() =>
      context.services.handoffEligibilityProjectionService.readHandoffEligibilityByBookingRequestReference(
        seeded.bookingRequestId
      )
    ).toThrow('not projectable');
  });
});
