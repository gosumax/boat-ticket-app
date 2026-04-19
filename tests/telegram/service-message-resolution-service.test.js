import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_BOT_START_ACTIONS,
  TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS,
  TELEGRAM_SERVICE_MESSAGE_RESOLUTION_VERSION,
  TELEGRAM_SERVICE_MESSAGE_TYPES,
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
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (1, 'seller-a', 'seller', 1)`
  ).run();
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

function seedRequest(context, suffix) {
  const guest = context.repositories.guestProfiles.create({
    telegram_user_id: `tg-service-message-${suffix}`,
    display_name: `Service Message Guest ${suffix}`,
    username: `service_message_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999777${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = context.repositories.trafficSources.create({
    source_code: `service-message-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Service Message Source ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: `service-message-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `service-message-zone-${suffix}` },
    is_active: 1,
  });
  const attribution = context.services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    entry_channel: 'qr',
  });
  const lifecycle = context.services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id:
      attribution.sellerAttributionSession.seller_attribution_session_id,
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

function resolveByReference(context, bookingRequestId) {
  return context.services.serviceMessageResolutionService.resolveServiceMessageByBookingRequestReference(
    {
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: bookingRequestId,
      },
    }
  );
}

describe('telegram service-message resolution service', () => {
  let db;
  let context;
  let clock;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('resolves booking_created then hold_extended deterministically from request state', () => {
    const seeded = seedRequest(context, '1001');
    const beforeCreatedCounts = snapshotTelegramRowCounts(db);

    const created = resolveByReference(context, seeded.bookingRequestId);

    expect(created).toMatchObject({
      response_version: TELEGRAM_SERVICE_MESSAGE_RESOLUTION_VERSION,
      read_only: true,
      message_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      message_mode: 'telegram_request_open',
      related_booking_request_reference: {
        booking_request_id: seeded.bookingRequestId,
      },
      telegram_user_summary: {
        guest_profile_id: seeded.guest.guest_profile_id,
        telegram_user_id: seeded.guest.telegram_user_id,
      },
      resolved_text_payload_summary: {
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.booking_created,
        locale: 'ru',
        fields: {
          headline: 'Booking request received',
        },
        variables: {
          booking_request_id: seeded.bookingRequestId,
          request_status: 'HOLD_ACTIVE',
          hold_status: 'ACTIVE',
          hold_expires_at: '2026-04-10T10:15:00.000Z',
        },
      },
      action_button_descriptors_summary: {
        total_count: 3,
        primary_action: TELEGRAM_BOT_START_ACTIONS.view_current_request,
      },
      visibility_flags: {
        contact_visible: true,
        useful_content_visible: true,
      },
      latest_timestamp_summary: {
        iso: expect.any(String),
        unix_seconds: expect.any(Number),
      },
      text_payload: {
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.booking_created,
      },
    });
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.resolved_text_payload_summary.variables)).toBe(true);
    expect(Object.isFrozen(created.action_button_descriptors_summary.descriptors[0])).toBe(true);
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeCreatedCounts);

    context.services.bookingRequestService.extendHoldOnce(seeded.bookingRequestId, {
      actorType: 'seller',
      actorId: '1',
    });
    const beforeExtendedCounts = snapshotTelegramRowCounts(db);

    const extended = resolveByReference(context, seeded.bookingRequestId);

    expect(extended).toMatchObject({
      message_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      message_mode: 'telegram_request_open',
      resolved_text_payload_summary: {
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.hold_extended,
        fields: {
          headline: 'Hold extended',
          status_line: 'Prepayment is still pending.',
        },
        variables: {
          request_status: 'HOLD_ACTIVE',
          hold_status: 'EXTENDED',
          hold_expires_at: '2026-04-10T10:25:00.000Z',
        },
      },
      action_button_descriptors_summary: {
        primary_action: TELEGRAM_BOT_START_ACTIONS.view_current_request,
      },
    });
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeExtendedCounts);
  });

  it('resolves hold_expired and uses create_booking_request as primary action', () => {
    const seeded = seedRequest(context, '2002');
    clock.advanceMinutes(16);
    context.services.bookingRequestService.expireHold(seeded.bookingRequestId, {
      actorType: 'system',
      actorId: 'hold-expirer',
    });
    const beforeCounts = snapshotTelegramRowCounts(db);

    const expired = resolveByReference(context, seeded.bookingRequestId);

    expect(expired).toMatchObject({
      message_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
      message_mode: 'completed_cancelled_expired',
      resolved_text_payload_summary: {
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.hold_expired,
        fields: {
          headline: 'Hold expired',
          status_line: 'You can create a new booking request.',
        },
        variables: {
          request_status: 'HOLD_EXPIRED',
          hold_status: 'EXPIRED',
        },
      },
      action_button_descriptors_summary: {
        primary_action: TELEGRAM_BOT_START_ACTIONS.create_booking_request,
      },
    });
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeCounts);
  });

  it('resolves booking_confirmed before and after linked presale state', () => {
    const seeded = seedRequest(context, '3003');
    context.services.bookingRequestService.confirmPrepayment(seeded.bookingRequestId, {
      actorType: 'system',
      actorId: 'payment-3003',
    });
    const beforePreLinkCounts = snapshotTelegramRowCounts(db);

    const confirmedBeforeLink = resolveByReference(context, seeded.bookingRequestId);

    expect(confirmedBeforeLink).toMatchObject({
      message_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      message_mode: 'telegram_confirmed_not_yet_ticketed',
      resolved_text_payload_summary: {
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.booking_confirmed,
        fields: {
          headline: 'Booking confirmed',
          body: 'Your prepayment is confirmed. We are preparing your ticket.',
          status_line: 'Ticket handoff is pending.',
        },
        variables: {
          request_status: 'PREPAYMENT_CONFIRMED',
          confirmed_presale_id: null,
          linked_to_presale: false,
          ticket_status: 'PAYMENT_CONFIRMED',
        },
      },
      action_button_descriptors_summary: {
        primary_action: TELEGRAM_BOT_START_ACTIONS.view_current_request,
      },
    });
    expect(snapshotTelegramRowCounts(db)).toEqual(beforePreLinkCounts);

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
    const beforeLinkedCounts = snapshotTelegramRowCounts(db);

    const confirmedLinked = resolveByReference(context, seeded.bookingRequestId);

    expect(confirmedLinked).toMatchObject({
      message_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      message_mode: 'linked_to_presale',
      related_booking_request_reference: {
        booking_request_id: seeded.bookingRequestId,
      },
      resolved_text_payload_summary: {
        fields: {
          body: 'Your booking is confirmed and your ticket is ready.',
          status_line: 'Ticket status: TICKET_READY.',
        },
        variables: {
          confirmed_presale_id: presaleId,
          linked_to_presale: true,
          canonical_linkage_status: 'enriched',
          ticket_status: 'TICKET_READY',
        },
      },
      action_button_descriptors_summary: {
        primary_action: TELEGRAM_BOT_START_ACTIONS.view_ticket,
      },
    });
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeLinkedCounts);
  });

  it('rejects unsupported lifecycle states and deterministic message-type mismatches', () => {
    const seeded = seedRequest(context, '4004');
    context.services.bookingRequestService.cancelRequestByGuest(seeded.bookingRequestId, {
      actorType: 'guest',
      actorId: seeded.guest.telegram_user_id,
    });

    expect(() => resolveByReference(context, seeded.bookingRequestId)).toThrow(
      'Booking request state is not supported for service-message resolution'
    );

    const seeded2 = seedRequest(context, '5005');
    expect(() =>
      context.services.serviceMessageResolutionService.resolveServiceMessage({
        message_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
        booking_request_id: seeded2.bookingRequestId,
      })
    ).toThrow('Request state resolves to booking_created, expected hold_extended');
  });
});
