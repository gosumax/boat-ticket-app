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
    advanceHours(hours) {
      current = new Date(current.getTime() + hours * 60 * 60 * 1000);
    },
  };
}

function wireClock(context, clock) {
  context.services.attributionService.now = clock.now;
  context.services.bookingRequestService.now = clock.now;
  context.services.presaleHandoffService.now = clock.now;
}

function seedConfirmedRequest(context, clock, suffix = 'handoff') {
  const { repositories, services } = context;
  wireClock(context, clock);

  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-handoff-user-${suffix}`,
    display_name: 'Handoff Guest',
    username: `handoff_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: '+79993334455',
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-handoff-qr-${suffix}`,
    source_type: 'seller_qr',
    source_name: 'Seller Handoff QR',
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-handoff-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: 'beach-handoff' },
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
    requested_seats: 3,
    requested_ticket_mix: { adult: 2, child: 1 },
    requested_prepayment_amount: 4500,
    currency: 'RUB',
    contact_phone_e164: '+79993334455',
  });

  const confirmed = services.bookingRequestService.confirmPrepayment(
    lifecycleResult.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: 'payment-job',
    }
  );

  return {
    guest,
    source,
    qr,
    bookingRequestId: confirmed.bookingRequest.booking_request_id,
  };
}

function seedPendingRequest(context, clock, suffix = 'pending') {
  const { repositories, services } = context;
  wireClock(context, clock);

  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-pending-user-${suffix}`,
    display_name: 'Pending Guest',
    username: `pending_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: '+79995556677',
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-pending-qr-${suffix}`,
    source_type: 'seller_qr',
    source_name: 'Seller Pending QR',
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-pending-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: 'beach-pending' },
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
    requested_time_slot: '15:00',
    requested_seats: 2,
    requested_ticket_mix: { adult: 2 },
    requested_prepayment_amount: 2500,
    currency: 'RUB',
    contact_phone_e164: '+79995556677',
  });

  return {
    guest,
    source,
    qr,
    bookingRequestId: lifecycleResult.bookingRequest.booking_request_id,
  };
}

describe('telegram presale handoff preparation', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T09:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('prepares one frozen handoff snapshot and replays the same persisted result idempotently', () => {
    const seeded = seedConfirmedRequest(context, clock, '1001');

    const first = context.services.presaleHandoffService.prepareHandoff({
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: seeded.bookingRequestId,
        guest_profile_id: seeded.guest.guest_profile_id,
        seller_attribution_session_id:
          context.repositories.bookingRequests.getById(seeded.bookingRequestId)
            .seller_attribution_session_id,
      },
      actor_type: 'system',
      actor_id: 'handoff-preparer',
      idempotency_key: 'handoff-prepare-1001',
    });

    context.repositories.trafficSources.updateById(seeded.source.traffic_source_id, {
      source_name: 'Mutated After Handoff',
      source_code: 'mutated-code',
    });
    context.repositories.sourceQRCodes.updateById(seeded.qr.source_qr_code_id, {
      seller_id: null,
    });

    const second = context.services.presaleHandoffService.prepareHandoff({
      booking_request_reference: first.booking_request_reference,
      actor_type: 'system',
      actor_id: 'handoff-preparer-replay',
      idempotency_key: 'handoff-prepare-1001',
    });

    expect(second).toEqual(first);
    expect(first.handoff_status).toBe('handoff_prepared');
    expect(first.handoff_prepared).toBe(true);
    expect(first.booking_request_reference.booking_request_id).toBe(seeded.bookingRequestId);
    expect(first.handoff_snapshot_reference.reference_type).toBe('telegram_handoff_snapshot');
    expect(first.handoff_snapshot_reference.handoff_prepared_event_id).toBeTypeOf('number');
    expect(first.idempotency_key).toBe('handoff-prepare-1001');
    expect(first.dedupe_key).toBe('handoff-prepare-1001');
    expect(first.prepared_timestamp_summary.iso).toBe('2026-04-10T09:00:00.000Z');
    expect(first.handoff_snapshot.telegram_user_summary.telegram_user_id).toBe(
      seeded.guest.telegram_user_id
    );
    expect(first.handoff_snapshot.requested_trip_slot_reference).toMatchObject({
      requested_trip_date: '2026-04-12',
      requested_time_slot: '12:30',
    });
    expect(first.handoff_snapshot.requested_seats).toBe(3);
    expect(first.handoff_snapshot.requested_prepayment_amount).toBe(4500);
    expect(first.handoff_snapshot.contact_phone_summary).toEqual({
      phone_e164: '+79993334455',
      phone_last4: '4455',
    });
    expect(first.handoff_snapshot.current_route_target).toEqual({
      route_target_type: 'seller',
      seller_id: 1,
      seller_attribution_session_id:
        first.booking_request_reference.seller_attribution_session_id,
    });
    expect(first.handoff_snapshot.attribution_session_reference).toMatchObject({
      seller_attribution_session_id:
        first.booking_request_reference.seller_attribution_session_id,
      seller_id: 1,
    });
    expect(first.handoff_snapshot.source.source_name).toBe('Seller Handoff QR');
    expect(first.handoff_snapshot.source.seller_id).toBe(1);
    expect(first.payload).toEqual(first.handoff_snapshot);
    expect(first.payload.telegram_request.booking_request_id).toBe(seeded.bookingRequestId);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.handoff_snapshot)).toBe(true);
    expect(Object.isFrozen(first.handoff_snapshot.current_route_target)).toBe(true);
    expect(Object.isFrozen(first.handoff_snapshot.contact_phone_summary)).toBe(true);
  });

  it('throws a deterministic idempotency conflict when the same key is reused for a different request', () => {
    const first = seedConfirmedRequest(context, clock, '1002');
    clock.advanceHours(1);
    const second = seedConfirmedRequest(context, clock, '1003');

    context.services.presaleHandoffService.prepareHandoff({
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: first.bookingRequestId,
        guest_profile_id: first.guest.guest_profile_id,
        seller_attribution_session_id:
          context.repositories.bookingRequests.getById(first.bookingRequestId)
            .seller_attribution_session_id,
      },
      idempotency_key: 'shared-handoff-key',
    });

    expect(() =>
      context.services.presaleHandoffService.prepareHandoff({
        booking_request_reference: {
          reference_type: 'telegram_booking_request',
          booking_request_id: second.bookingRequestId,
          guest_profile_id: second.guest.guest_profile_id,
          seller_attribution_session_id:
            context.repositories.bookingRequests.getById(second.bookingRequestId)
              .seller_attribution_session_id,
        },
        idempotency_key: 'shared-handoff-key',
      })
    ).toThrow('Idempotency conflict for handoff preparation');
  });

  it('rejects requests that are not yet prepayment-confirmed', () => {
    const pending = seedPendingRequest(context, clock, '1004');

    expect(() =>
      context.services.presaleHandoffService.prepareHandoff(pending.bookingRequestId)
    ).toThrow('Booking request is not prepayment-confirmed');
  });

  it('rejects cancelled or expired requests deterministically', () => {
    const cancelled = seedPendingRequest(context, clock, '1005');
    context.services.bookingRequestService.cancelRequestByGuest(cancelled.bookingRequestId);

    expect(() =>
      context.services.presaleHandoffService.prepareHandoff(cancelled.bookingRequestId)
    ).toThrow('Cancelled or expired booking request');

    const expired = seedPendingRequest(context, clock, '1006');
    context.services.bookingRequestService.expireHold(expired.bookingRequestId, {
      actorType: 'system',
      actorId: 'expirer',
    });

    expect(() =>
      context.services.presaleHandoffService.prepareHandoff(expired.bookingRequestId)
    ).toThrow('Cancelled or expired booking request');
  });

  it('rejects invalid booking request references and non-projectable lifecycle states deterministically', () => {
    expect(() =>
      context.services.presaleHandoffService.prepareHandoff({
        booking_request_reference: {
          reference_type: 'telegram_booking_request',
          booking_request_id: 9999,
          guest_profile_id: 9999,
          seller_attribution_session_id: 9999,
        },
      })
    ).toThrow('Invalid booking request reference');

    const seeded = seedConfirmedRequest(context, clock, '1007');
    context.repositories.bookingRequests.updateById(seeded.bookingRequestId, {
      request_status: 'SELLER_NOT_REACHED',
      last_status_at: '2026-04-10T09:15:00.000Z',
    });

    expect(() =>
      context.services.presaleHandoffService.prepareHandoff(seeded.bookingRequestId)
    ).toThrow('not projectable for handoff');
  });

  it('returns the normalized snapshot shape needed for future presale creation without creating production presales', () => {
    const seeded = seedConfirmedRequest(context, clock, '1008');
    const snapshot = context.services.presaleHandoffService.buildNormalizedHandoffPayload(
      seeded.bookingRequestId
    );

    expect(snapshot).toMatchObject({
      response_version: 'telegram_handoff_snapshot.v1',
      snapshot_type: 'telegram_presale_handoff_snapshot',
      frozen_for: 'future_presale_creation',
      requested_seats: 3,
      requested_prepayment_amount: 4500,
      current_route_target: {
        route_target_type: 'seller',
        seller_id: 1,
      },
      source: {
        source_name: 'Seller Handoff QR',
        path_type: 'seller_attributed',
        seller_id: 1,
      },
      trip: {
        requested_trip_date: '2026-04-12',
        requested_time_slot: '12:30',
        requested_seats: 3,
        slot_uid: null,
        slot_resolution_required: true,
      },
      payment: {
        requested_prepayment_amount: 4500,
        currency: 'RUB',
        prepayment_confirmed: true,
      },
      metadata: {
        production_presale_not_created: true,
        seat_reservation_not_applied: true,
        money_ledger_not_written: true,
      },
    });
    expect(snapshot.telegram_request.booking_request_id).toBe(seeded.bookingRequestId);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });
});
