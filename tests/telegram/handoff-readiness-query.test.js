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
}

function seedBookingRequest(
  context,
  clock,
  { suffix, confirmPrepayment = true, prepareHandoff = false } = {}
) {
  wireClock(context, clock);

  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-query-${suffix}`,
    display_name: `Query Guest ${suffix}`,
    username: `query_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+79990000${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-query-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Query ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-query-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `query-zone-${suffix}` },
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
    requested_trip_date: '2026-04-12',
    requested_time_slot: '12:30',
    requested_seats: 2,
    requested_ticket_mix: { adult: 2 },
    requested_prepayment_amount: 3000,
    currency: 'RUB',
    contact_phone_e164: `+79990000${suffix}`,
  });

  let bookingRequest = lifecycleResult.bookingRequest;
  if (confirmPrepayment) {
    bookingRequest = services.bookingRequestService.confirmPrepayment(
      bookingRequest.booking_request_id,
      {
        actorType: 'system',
        actorId: `payment-${suffix}`,
      }
    ).bookingRequest;
  }

  const prepared = prepareHandoff
    ? services.presaleHandoffService.prepareHandoff(bookingRequest.booking_request_id)
    : null;

  return {
    guest,
    source,
    qr,
    bookingRequestId: bookingRequest.booking_request_id,
    prepared,
  };
}

describe('telegram handoff readiness query layer', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T09:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('reads readiness by booking request reference and exposes the frozen prepared snapshot when present', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '404',
      confirmPrepayment: true,
      prepareHandoff: true,
    });

    context.repositories.trafficSources.updateById(seeded.source.traffic_source_id, {
      source_name: 'Mutated After Preparation',
      source_code: 'mutated-after-preparation',
    });

    const result =
      context.services.handoffReadinessQueryService.readHandoffReadinessByBookingRequestReference(
        {
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
            guest_profile_id: seeded.guest.guest_profile_id,
            seller_attribution_session_id:
              context.repositories.bookingRequests.getById(seeded.bookingRequestId)
                .seller_attribution_session_id,
          },
        }
      );

    expect(result.booking_request_reference.booking_request_id).toBe(seeded.bookingRequestId);
    expect(result.lifecycle_state).toBe('prepayment_confirmed');
    expect(result.handoff_prepared).toBe(true);
    expect(result.handoff_readiness_state).toBe('ready_for_handoff');
    expect(result.handoff_snapshot_reference.reference_type).toBe('telegram_handoff_snapshot');
    expect(result.latest_readiness_timestamp_summary.iso).toBe('2026-04-10T09:00:00.000Z');
    expect(result.handoff_snapshot.telegram_request.booking_request_id).toBe(seeded.bookingRequestId);
    expect(result.snapshot_payload.source.source_name).toBe('Seller Query 404');
    expect(result.attribution_context.source_name).toBe('Seller Query 404');
    expect(result.attribution_context.seller_id).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.handoff_snapshot)).toBe(true);
    expect(Object.isFrozen(result.attribution_context)).toBe(true);
  });

  it('lists only handoff-ready requests for the requested telegram guest', () => {
    const guestOne = seedBookingRequest(context, clock, {
      suffix: '101',
      confirmPrepayment: true,
      prepareHandoff: true,
    });
    clock.advanceMinutes(5);
    seedBookingRequest(context, clock, {
      suffix: '202',
      confirmPrepayment: true,
      prepareHandoff: true,
    });

    const result =
      context.services.handoffReadinessQueryService.listHandoffReadyRequestsForTelegramGuest(
        {
          telegram_user_id: guestOne.guest.telegram_user_id,
        }
      );

    expect(result.response_version).toBe('telegram_handoff_readiness_projection_list.v1');
    expect(result.telegram_user_summary.telegram_user_id).toBe(
      guestOne.guest.telegram_user_id
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].booking_request_reference.booking_request_id).toBe(
      guestOne.bookingRequestId
    );
    expect(result.items[0].handoff_readiness_state).toBe('ready_for_handoff');
  });

  it('reads the latest handoff-ready-or-not state for a telegram guest', () => {
    const pending = seedBookingRequest(context, clock, {
      suffix: '303',
      confirmPrepayment: false,
      prepareHandoff: false,
    });

    const result =
      context.services.handoffReadinessQueryService.readLatestHandoffReadyOrNotStateForTelegramGuest(
        {
          telegram_user_id: pending.guest.telegram_user_id,
        }
      );

    expect(result.booking_request_reference.booking_request_id).toBe(
      pending.bookingRequestId
    );
    expect(result.lifecycle_state).toBe('hold_active');
    expect(result.handoff_prepared).toBe(false);
    expect(result.handoff_readiness_state).toBe('not_ready');
    expect(result.handoff_snapshot_reference).toBeNull();
  });

  it('returns invalid_for_handoff for cancelled or expired projectable requests', () => {
    const cancelled = seedBookingRequest(context, clock, {
      suffix: '505',
      confirmPrepayment: false,
      prepareHandoff: false,
    });
    context.services.bookingRequestService.cancelRequestByGuest(cancelled.bookingRequestId);

    const result =
      context.services.handoffReadinessQueryService.readHandoffReadinessByBookingRequestReference(
        cancelled.bookingRequestId
      );

    expect(result.lifecycle_state).toBe('cancelled_before_prepayment');
    expect(result.handoff_readiness_state).toBe('invalid_for_handoff');
    expect(result.handoff_prepared).toBe(false);
  });

  it('rejects invalid or non-projectable booking request reads deterministically', () => {
    expect(() =>
      context.services.handoffReadinessQueryService.readHandoffReadinessByBookingRequestReference(
        9999
      )
    ).toThrow('Invalid booking request reference');

    const seeded = seedBookingRequest(context, clock, {
      suffix: '606',
      confirmPrepayment: true,
      prepareHandoff: true,
    });
    context.repositories.bookingRequests.updateById(seeded.bookingRequestId, {
      request_status: 'SELLER_NOT_REACHED',
      last_status_at: '2026-04-10T09:15:00.000Z',
    });

    expect(() =>
      context.services.handoffReadinessQueryService.readHandoffReadinessByBookingRequestReference(
        seeded.bookingRequestId
      )
    ).toThrow('not projectable for handoff readiness');
  });
});
