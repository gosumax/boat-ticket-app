import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
  TELEGRAM_NOTIFICATION_DELIVERY_PLAN_VERSION,
  TELEGRAM_NOTIFICATION_SEND_TIMING_MODE,
} from '../../server/telegram/services/notification-delivery-planning-service.js';
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
    telegram_user_id: `tg-notification-plan-${suffix}`,
    display_name: `Notification Plan Guest ${suffix}`,
    username: `notification_plan_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999555${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = context.repositories.trafficSources.create({
    source_code: `notification-plan-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Notification Plan Source ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: `notification-plan-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `notification-plan-zone-${suffix}` },
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

function resolveMessage(context, messageType, bookingRequestId) {
  return context.services.serviceMessageResolutionService.resolveServiceMessage({
    message_type: messageType,
    booking_request_id: bookingRequestId,
  });
}

function planResolvedMessage(context, db, messageType, bookingRequestId) {
  const resolution = resolveMessage(context, messageType, bookingRequestId);
  const beforePlanCounts = snapshotTelegramRowCounts(db);
  const plan = context.services.notificationDeliveryPlanningService.planNotificationDelivery({
    service_message_resolution: resolution,
  });

  expect(snapshotTelegramRowCounts(db)).toEqual(beforePlanCounts);
  return { resolution, plan };
}

function expectedDedupeKey({ notificationType, guestProfileId, bookingRequestId, contentKey }) {
  return [
    'telegram_notification_delivery',
    `channel=${TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL}`,
    `type=${notificationType}`,
    `guest=${guestProfileId}`,
    `request=${bookingRequestId}`,
    `payload=${contentKey}`,
    `resolution=${TELEGRAM_SERVICE_MESSAGE_RESOLUTION_VERSION}`,
  ].join('|');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('telegram notification-delivery planning service', () => {
  let db;
  let context;
  let clock;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('plans immediate telegram bot delivery for the four allowed service-message scenarios read-only', () => {
    const createdSeed = seedRequest(context, '1001');
    const created = planResolvedMessage(
      context,
      db,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      createdSeed.bookingRequestId
    ).plan;

    expect(created).toMatchObject({
      response_version: TELEGRAM_NOTIFICATION_DELIVERY_PLAN_VERSION,
      read_only: true,
      planning_only: true,
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      delivery_channel: TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
      delivery_target: {
        target_type: 'telegram_guest',
        guest_profile_id: createdSeed.guest.guest_profile_id,
        telegram_user_id: createdSeed.guest.telegram_user_id,
        display_name: 'Notification Plan Guest 1001',
        username: 'notification_plan_1001',
        language_code: 'ru',
        consent_status: 'granted',
        profile_status: 'active',
        booking_request_id: createdSeed.bookingRequestId,
      },
      send_timing_mode: TELEGRAM_NOTIFICATION_SEND_TIMING_MODE,
      resolved_payload_summary_reference: {
        reference_type: 'telegram_service_message_resolution',
        resolution_version: TELEGRAM_SERVICE_MESSAGE_RESOLUTION_VERSION,
        message_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        message_mode: 'telegram_request_open',
        booking_request_id: createdSeed.bookingRequestId,
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.booking_created,
        locale: 'ru',
        field_keys: ['body', 'headline', 'status_line'],
        action_button_ids: [
          TELEGRAM_BOT_START_ACTIONS.view_current_request,
          TELEGRAM_BOT_START_ACTIONS.contact,
          TELEGRAM_BOT_START_ACTIONS.useful_content,
        ],
      },
      send_decision: {
        should_send: true,
        send_allowed: true,
        suppression_reason: null,
        block_reason: null,
        safe_block_reasons: [],
      },
      no_op_guards: {
        telegram_message_sent: false,
        notification_log_row_created: false,
        bot_handlers_invoked: false,
        mini_app_ui_invoked: false,
        seller_owner_admin_ui_invoked: false,
        production_routes_invoked: false,
        money_ledger_written: false,
      },
      planned_by: 'telegram_notification_delivery_planning_service',
    });
    expect(created.dedupe_key).toBe(created.idempotency_key);
    expect(created.dedupe_key).toBe(
      expectedDedupeKey({
        notificationType: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        guestProfileId: createdSeed.guest.guest_profile_id,
        bookingRequestId: createdSeed.bookingRequestId,
        contentKey: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.booking_created,
      })
    );
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.delivery_target)).toBe(true);
    expect(Object.isFrozen(created.resolved_payload_summary_reference)).toBe(true);
    expect(Object.isFrozen(created.send_decision.safe_block_reasons)).toBe(true);

    context.services.bookingRequestService.extendHoldOnce(createdSeed.bookingRequestId, {
      actorType: 'seller',
      actorId: '1',
    });
    const extended = planResolvedMessage(
      context,
      db,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      createdSeed.bookingRequestId
    ).plan;

    expect(extended).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      delivery_channel: TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
      send_timing_mode: TELEGRAM_NOTIFICATION_SEND_TIMING_MODE,
      resolved_payload_summary_reference: {
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.hold_extended,
      },
      send_decision: {
        should_send: true,
        suppression_reason: null,
      },
    });

    const expiredSeed = seedRequest(context, '2002');
    clock.advanceMinutes(16);
    context.services.bookingRequestService.expireHold(expiredSeed.bookingRequestId, {
      actorType: 'system',
      actorId: 'hold-expirer',
    });
    const expired = planResolvedMessage(
      context,
      db,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
      expiredSeed.bookingRequestId
    ).plan;

    expect(expired).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
      resolved_payload_summary_reference: {
        message_mode: 'completed_cancelled_expired',
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.hold_expired,
        action_button_ids: [
          TELEGRAM_BOT_START_ACTIONS.create_booking_request,
          TELEGRAM_BOT_START_ACTIONS.contact,
          TELEGRAM_BOT_START_ACTIONS.useful_content,
        ],
      },
      send_decision: {
        should_send: true,
        suppression_reason: null,
      },
    });

    const confirmedSeed = seedRequest(context, '3003');
    context.services.bookingRequestService.confirmPrepayment(confirmedSeed.bookingRequestId, {
      actorType: 'system',
      actorId: 'payment-3003',
    });
    const confirmed = planResolvedMessage(
      context,
      db,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      confirmedSeed.bookingRequestId
    ).plan;

    expect(confirmed).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      resolved_payload_summary_reference: {
        message_mode: 'telegram_confirmed_not_yet_ticketed',
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.booking_confirmed,
      },
      send_decision: {
        should_send: true,
        suppression_reason: null,
      },
    });
    expect(
      new Set([
        created.dedupe_key,
        extended.dedupe_key,
        expired.dedupe_key,
        confirmed.dedupe_key,
      ]).size
    ).toBe(4);
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_notifications').get().count).toBe(0);
  });

  it('returns safe suppression reasons without sending or writing notification logs', () => {
    const seeded = seedRequest(context, '4004');
    const resolution = resolveMessage(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      seeded.bookingRequestId
    );
    const unsafeResolution = cloneJson(resolution);
    unsafeResolution.text_payload.variables.telegram_user_id = null;
    const beforeMissingTargetCounts = snapshotTelegramRowCounts(db);

    const missingTargetPlan =
      context.services.notificationDeliveryPlanningService.planNotificationDelivery(
        unsafeResolution
      );

    expect(missingTargetPlan).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      delivery_channel: TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
      delivery_target: {
        guest_profile_id: seeded.guest.guest_profile_id,
        telegram_user_id: null,
      },
      send_decision: {
        should_send: false,
        send_allowed: false,
        suppression_reason: 'missing_telegram_delivery_target',
        block_reason: 'missing_telegram_delivery_target',
        safe_block_reasons: [
          {
            reason: 'missing_telegram_delivery_target',
            message: 'Telegram delivery target identity is missing.',
          },
        ],
      },
    });
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeMissingTargetCounts);
    expect(Object.isFrozen(missingTargetPlan.send_decision.safe_block_reasons[0])).toBe(true);

    const unsupportedResolution = cloneJson(resolution);
    unsupportedResolution.message_type = 'ticket_sent';
    const beforeUnsupportedCounts = snapshotTelegramRowCounts(db);
    const unsupportedPlan =
      context.services.notificationDeliveryPlanningService.planNotificationDelivery({
        resolution: unsupportedResolution,
      });

    expect(unsupportedPlan).toMatchObject({
      notification_type: 'ticket_sent',
      send_decision: {
        should_send: false,
        suppression_reason: 'unsupported_notification_type',
        block_reason: 'unsupported_notification_type',
        safe_block_reasons: [
          {
            reason: 'unsupported_notification_type',
            message: 'Notification type is not in the Telegram service-message delivery allowlist.',
          },
        ],
      },
    });
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeUnsupportedCounts);
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_notifications').get().count).toBe(0);
  });
});
