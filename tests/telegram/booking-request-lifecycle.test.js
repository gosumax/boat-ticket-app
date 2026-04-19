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

function seedDependencies(repositories) {
  const guest = repositories.guestProfiles.create({
    telegram_user_id: 'tg-user-1',
    display_name: 'Guest One',
    username: 'guest1',
    language_code: 'ru',
    phone_e164: '+79990000000',
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: 'qr-main',
    source_type: 'qr',
    source_name: 'Main QR',
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: 'qr-token-main',
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: 'beach-a' },
    is_active: 1,
  });
  const attribution = repositories.sellerAttributionSessions.create({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    seller_id: 1,
    starts_at: '2026-04-10T10:00:00.000Z',
    expires_at: '2026-04-10T10:30:00.000Z',
    attribution_status: 'ACTIVE',
    binding_reason: 'qr_entry',
  });

  return { guest, source, qr, attribution };
}

describe('telegram booking request lifecycle', () => {
  let db;
  let repositories;
  let bookingRequestService;
  let clock;
  let seeded;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    const context = createTelegramPersistenceContext(db);
    repositories = context.repositories;
    seeded = seedDependencies(repositories);
    bookingRequestService = context.services.bookingRequestService;
    bookingRequestService.now = clock.now;
  });

  it('creates a booking request, auto-starts a 15-minute hold, and writes transition events', () => {
    const result = bookingRequestService.createBookingRequest({
      guest_profile_id: seeded.guest.guest_profile_id,
      seller_attribution_session_id: seeded.attribution.seller_attribution_session_id,
      requested_trip_date: '2026-04-11',
      requested_time_slot: '12:00',
      requested_seats: 2,
      requested_ticket_mix: { adult: 2 },
      contact_phone_e164: '+79990000000',
      actor_type: 'guest',
      actor_id: String(seeded.guest.guest_profile_id),
    });

    expect(result.bookingRequest.request_status).toBe('HOLD_ACTIVE');
    expect(result.bookingHold.hold_status).toBe('ACTIVE');
    expect(result.bookingHold.hold_expires_at).toBe('2026-04-10T10:15:00.000Z');
    expect(result.events.map((event) => event.event_type)).toEqual(['REQUEST_CREATED', 'HOLD_STARTED']);
  });

  it('prevents multiple active booking requests for the same guest', () => {
    bookingRequestService.createBookingRequest({
      guest_profile_id: seeded.guest.guest_profile_id,
      seller_attribution_session_id: seeded.attribution.seller_attribution_session_id,
      requested_trip_date: '2026-04-11',
      requested_time_slot: '12:00',
      requested_seats: 2,
      requested_ticket_mix: { adult: 2 },
      contact_phone_e164: '+79990000000',
    });

    expect(() =>
      bookingRequestService.createBookingRequest({
        guest_profile_id: seeded.guest.guest_profile_id,
        seller_attribution_session_id: seeded.attribution.seller_attribution_session_id,
        requested_trip_date: '2026-04-12',
        requested_time_slot: '14:00',
        requested_seats: 1,
        requested_ticket_mix: { adult: 1 },
        contact_phone_e164: '+79990000000',
      })
    ).toThrow('Guest already has an active booking request');
  });

  it('allows exactly one 10-minute hold extension', () => {
    const result = bookingRequestService.createBookingRequest({
      guest_profile_id: seeded.guest.guest_profile_id,
      seller_attribution_session_id: seeded.attribution.seller_attribution_session_id,
      requested_trip_date: '2026-04-11',
      requested_time_slot: '12:00',
      requested_seats: 2,
      requested_ticket_mix: { adult: 2 },
      contact_phone_e164: '+79990000000',
    });

    const updatedHold = bookingRequestService.extendHoldOnce(result.bookingRequest.booking_request_id, {
      actorType: 'seller',
      actorId: '1',
    });

    expect(updatedHold.hold_status).toBe('EXTENDED');
    expect(updatedHold.hold_expires_at).toBe('2026-04-10T10:25:00.000Z');
    expect(() => bookingRequestService.extendHoldOnce(result.bookingRequest.booking_request_id)).toThrow(
      'Hold extension already used'
    );
  });

  it('allows guest cancellation only before prepayment confirmation', () => {
    const result = bookingRequestService.createBookingRequest({
      guest_profile_id: seeded.guest.guest_profile_id,
      seller_attribution_session_id: seeded.attribution.seller_attribution_session_id,
      requested_trip_date: '2026-04-11',
      requested_time_slot: '12:00',
      requested_seats: 2,
      requested_ticket_mix: { adult: 2 },
      contact_phone_e164: '+79990000000',
    });

    const cancelled = bookingRequestService.cancelRequestByGuest(result.bookingRequest.booking_request_id, {
      actorType: 'guest',
      actorId: String(seeded.guest.guest_profile_id),
    });

    expect(cancelled.bookingRequest.request_status).toBe('GUEST_CANCELLED');
    expect(cancelled.bookingHold.hold_status).toBe('CANCELLED');
  });

  it('marks seller not reached and releases the active hold', () => {
    const result = bookingRequestService.createBookingRequest({
      guest_profile_id: seeded.guest.guest_profile_id,
      seller_attribution_session_id: seeded.attribution.seller_attribution_session_id,
      requested_trip_date: '2026-04-11',
      requested_time_slot: '12:00',
      requested_seats: 2,
      requested_ticket_mix: { adult: 2 },
      contact_phone_e164: '+79990000000',
    });

    const closed = bookingRequestService.markSellerNotReached(result.bookingRequest.booking_request_id, {
      actorType: 'system',
      actorId: 'timeout-job',
    });

    expect(closed.bookingRequest.request_status).toBe('SELLER_NOT_REACHED');
    expect(closed.bookingHold.hold_status).toBe('RELEASED');
  });

  it('expires the hold and writes a hold-expired event', () => {
    const result = bookingRequestService.createBookingRequest({
      guest_profile_id: seeded.guest.guest_profile_id,
      seller_attribution_session_id: seeded.attribution.seller_attribution_session_id,
      requested_trip_date: '2026-04-11',
      requested_time_slot: '12:00',
      requested_seats: 2,
      requested_ticket_mix: { adult: 2 },
      contact_phone_e164: '+79990000000',
    });

    clock.advanceMinutes(16);
    const expired = bookingRequestService.expireHold(result.bookingRequest.booking_request_id, {
      actorType: 'system',
      actorId: 'hold-expirer',
    });

    expect(expired.bookingRequest.request_status).toBe('HOLD_EXPIRED');
    expect(expired.bookingHold.hold_status).toBe('EXPIRED');
    expect(
      bookingRequestService
        .listRequestEvents(result.bookingRequest.booking_request_id)
        .map((event) => event.event_type)
    ).toContain('HOLD_EXPIRED');
  });

  it('confirms prepayment, converts the hold, and blocks later guest cancellation', () => {
    const result = bookingRequestService.createBookingRequest({
      guest_profile_id: seeded.guest.guest_profile_id,
      seller_attribution_session_id: seeded.attribution.seller_attribution_session_id,
      requested_trip_date: '2026-04-11',
      requested_time_slot: '12:00',
      requested_seats: 2,
      requested_ticket_mix: { adult: 2 },
      contact_phone_e164: '+79990000000',
    });

    const confirmed = bookingRequestService.confirmPrepayment(result.bookingRequest.booking_request_id, {
      actorType: 'system',
      actorId: 'payment-confirmation',
    });

    expect(confirmed.bookingRequest.request_status).toBe('PREPAYMENT_CONFIRMED');
    expect(confirmed.bookingHold.hold_status).toBe('CONVERTED');
    expect(() => bookingRequestService.cancelRequestByGuest(result.bookingRequest.booking_request_id)).toThrow(
      'Guest cancellation is not allowed after prepayment confirmation'
    );
  });
});
