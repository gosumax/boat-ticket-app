import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_GUEST_ACTION_STATES,
  TELEGRAM_GUEST_ACTION_STATE_PROJECTION_VERSION,
} from '../../shared/telegram/index.js';

const TELEGRAM_TABLES = Object.freeze([
  'telegram_guest_profiles',
  'telegram_traffic_sources',
  'telegram_source_qr_codes',
  'telegram_seller_attribution_sessions',
  'telegram_guest_entries',
  'telegram_booking_requests',
  'telegram_booking_holds',
  'telegram_booking_request_events',
  'telegram_content_blocks',
  'telegram_notifications',
  'telegram_analytics_events',
  'telegram_post_trip_messages',
  'telegram_post_trip_offers',
]);

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
    CREATE TABLE presales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_slot_id INTEGER NULL,
      status TEXT DEFAULT 'ACTIVE',
      slot_uid TEXT NULL,
      business_day TEXT NULL
    );
    CREATE TABLE tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      presale_id INTEGER NOT NULL REFERENCES presales(id),
      boat_slot_id INTEGER NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );
  `);
  db.prepare(`INSERT INTO users (id, username, role, is_active) VALUES (1, 'seller-a', 'seller', 1)`).run();
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
}

function snapshotTelegramRowCounts(db) {
  return Object.fromEntries(
    TELEGRAM_TABLES.map((tableName) => [
      tableName,
      db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count,
    ])
  );
}

function seedGuest(context, suffix) {
  return context.repositories.guestProfiles.create({
    telegram_user_id: `tg-action-state-${suffix}`,
    display_name: `Action State Guest ${suffix}`,
    username: `action_state_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999666${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
}

function seedAttribution(context, guest, suffix) {
  const source = context.repositories.trafficSources.create({
    source_code: `action-state-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Action State Source ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: `action-state-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `action-state-zone-${suffix}` },
    is_active: 1,
  });

  return context.services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    entry_channel: 'qr',
  }).sellerAttributionSession;
}

function seedRequest(context, clock, suffix) {
  const guest = seedGuest(context, suffix);
  const attribution = seedAttribution(context, guest, suffix);

  clock.advanceMinutes(1);
  const lifecycle = context.services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id: attribution.seller_attribution_session_id,
    requested_trip_date: '2026-04-11',
    requested_time_slot: '12:00',
    requested_seats: 2,
    requested_ticket_mix: { adult: 2 },
    requested_prepayment_amount: 1000,
    currency: 'RUB',
    contact_phone_e164: guest.phone_e164,
  });

  return {
    guest,
    bookingRequestId: lifecycle.bookingRequest.booking_request_id,
  };
}

describe('telegram guest-facing action-state projection service', () => {
  let db;
  let context;
  let clock;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('returns browsing_only for a new guest with no booking history', () => {
    const guest = seedGuest(context, '1001');
    const beforeCounts = snapshotTelegramRowCounts(db);

    const projection =
      context.services.guestActionStateProjectionService.readGuestActionStateByTelegramUserReference(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: guest.telegram_user_id,
          },
        }
      );

    expect(projection).toMatchObject({
      response_version: TELEGRAM_GUEST_ACTION_STATE_PROJECTION_VERSION,
      read_only: true,
      projection_only: true,
      current_guest_action_state: TELEGRAM_GUEST_ACTION_STATES.browsing_only,
      active_request_flag: false,
      linked_ticket_flag: false,
      can_view_trips: true,
      can_view_ticket: false,
      can_contact: true,
      can_cancel_before_prepayment: false,
      can_open_useful_content: true,
      can_open_faq: true,
      latest_timestamp_summary: {
        iso: expect.any(String),
        unix_seconds: expect.any(Number),
      },
      telegram_user_summary: {
        guest_profile_id: guest.guest_profile_id,
        telegram_user_id: guest.telegram_user_id,
      },
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.telegram_user_summary)).toBe(true);
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeCounts);
  });

  it('returns waiting_for_prepayment for active request state', () => {
    const seeded = seedRequest(context, clock, '2002');

    const projection =
      context.services.guestActionStateProjectionService.readGuestActionStateByBookingRequestReference(
        {
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
        }
      );

    expect(projection).toMatchObject({
      current_guest_action_state: TELEGRAM_GUEST_ACTION_STATES.waiting_for_prepayment,
      active_request_flag: true,
      linked_ticket_flag: false,
      can_view_trips: true,
      can_view_ticket: false,
      can_cancel_before_prepayment: true,
      can_contact: true,
      can_open_useful_content: true,
      can_open_faq: true,
    });
  });

  it('returns confirmed_with_ticket when the guest has linked ticket state', () => {
    const seeded = seedRequest(context, clock, '3003');
    context.services.bookingRequestService.confirmPrepayment(seeded.bookingRequestId, {
      actorType: 'system',
      actorId: 'payment-3003',
    });
    const presaleId = db.prepare(`
      INSERT INTO presales (boat_slot_id, status, slot_uid, business_day)
      VALUES (42, 'ACTIVE', 'generated:42', '2026-04-11')
    `).run().lastInsertRowid;
    db.prepare(`
      INSERT INTO tickets (presale_id, boat_slot_id, status)
      VALUES
        (?, 42, 'ACTIVE'),
        (?, 42, 'USED')
    `).run(presaleId, presaleId);
    context.repositories.bookingRequests.updateById(seeded.bookingRequestId, {
      request_status: 'CONFIRMED_TO_PRESALE',
      confirmed_presale_id: presaleId,
      last_status_at: '2026-04-10T10:30:00.000Z',
    });

    const projection =
      context.services.guestActionStateProjectionService.readGuestActionStateByTelegramUserReference(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: seeded.guest.telegram_user_id,
          },
        }
      );

    expect(projection).toMatchObject({
      current_guest_action_state: TELEGRAM_GUEST_ACTION_STATES.confirmed_with_ticket,
      active_request_flag: false,
      linked_ticket_flag: true,
      can_view_ticket: true,
      can_cancel_before_prepayment: false,
    });
  });

  it('returns completed_or_idle when the guest has completed history without active request', () => {
    const seeded = seedRequest(context, clock, '4004');
    clock.advanceMinutes(16);
    context.services.bookingRequestService.expireHold(seeded.bookingRequestId, {
      actorType: 'system',
      actorId: 'hold-expirer',
    });

    const projection =
      context.services.guestActionStateProjectionService.readGuestActionStateByTelegramUserReference(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: seeded.guest.telegram_user_id,
          },
        }
      );

    expect(projection).toMatchObject({
      current_guest_action_state: TELEGRAM_GUEST_ACTION_STATES.completed_or_idle,
      active_request_flag: false,
      linked_ticket_flag: false,
      can_view_trips: true,
      can_view_ticket: false,
      can_cancel_before_prepayment: false,
    });
  });

  it('rejects invalid references deterministically', () => {
    expect(() =>
      context.services.guestActionStateProjectionService.readGuestActionStateByTelegramUserReference(
        {
          telegram_user_reference: {
            reference_type: 'telegram_chat',
            telegram_user_id: 'u1',
          },
        }
      )
    ).toThrow('[TELEGRAM_GUEST_ACTION_STATE] Unsupported telegram-user reference type');

    expect(() =>
      context.services.guestActionStateProjectionService.readGuestActionStateByBookingRequestReference(
        {
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: 0,
          },
        }
      )
    ).toThrow(
      '[TELEGRAM_GUEST_ACTION_STATE] booking_request_reference.booking_request_id must be a positive integer'
    );
  });
});
