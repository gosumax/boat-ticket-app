import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES,
  TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
  TELEGRAM_NOTIFICATION_INTENT_STATUSES,
} from '../../shared/telegram/index.js';
import {
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
  context.services.notificationIntentPersistenceService.now = clock.now;
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
    telegram_user_id: `tg-notification-intent-${suffix}`,
    display_name: `Notification Intent Guest ${suffix}`,
    username: `notification_intent_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999444${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = context.repositories.trafficSources.create({
    source_code: `notification-intent-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Notification Intent Source ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: `notification-intent-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `notification-intent-zone-${suffix}` },
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

function planResolvedMessage(context, messageType, bookingRequestId) {
  return context.services.notificationDeliveryPlanningService.planNotificationDelivery({
    service_message_resolution: resolveMessage(context, messageType, bookingRequestId),
  });
}

function persistPlan(context, plan) {
  return context.services.notificationIntentPersistenceService.persistNotificationIntent({
    notification_delivery_plan: plan,
    actorType: 'system',
    actorId: 'notification-intent-test',
  });
}

function listIntentEvents(context, bookingRequestId) {
  return context.repositories.bookingRequestEvents
    .listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 100 }
    )
    .filter((event) =>
      Object.values(TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES).includes(event.event_type)
    );
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('telegram notification intent persistence service', () => {
  let db;
  let context;
  let clock;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('persists immutable notification intent events for the four allowed scenarios only', () => {
    const createdSeed = seedRequest(context, '1001');
    const createdPlan = planResolvedMessage(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      createdSeed.bookingRequestId
    );
    const created = persistPlan(context, createdPlan);

    expect(created).toMatchObject({
      response_version: TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.created,
      persisted_intent_reference: {
        reference_type: 'telegram_booking_request_event',
        booking_request_id: createdSeed.bookingRequestId,
        event_type: TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES.created,
      },
      delivery_target_summary: {
        booking_request_id: createdSeed.bookingRequestId,
        guest_profile_id: createdSeed.guest.guest_profile_id,
        telegram_user_id: createdSeed.guest.telegram_user_id,
      },
      dedupe_key: createdPlan.dedupe_key,
      idempotency_key: createdPlan.idempotency_key,
      suppression_reason: null,
      block_reason: null,
    });
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.persisted_intent_reference)).toBe(true);
    expect(Object.isFrozen(created.delivery_target_summary)).toBe(true);

    context.services.bookingRequestService.extendHoldOnce(createdSeed.bookingRequestId, {
      actorType: 'seller',
      actorId: '1',
    });
    const extended = persistPlan(
      context,
      planResolvedMessage(
        context,
        TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
        createdSeed.bookingRequestId
      )
    );
    expect(extended).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.created,
      persisted_intent_reference: {
        event_type: TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES.created,
      },
      suppression_reason: null,
    });

    const expiredSeed = seedRequest(context, '2002');
    clock.advanceMinutes(16);
    context.services.bookingRequestService.expireHold(expiredSeed.bookingRequestId, {
      actorType: 'system',
      actorId: 'hold-expirer',
    });
    const expired = persistPlan(
      context,
      planResolvedMessage(
        context,
        TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
        expiredSeed.bookingRequestId
      )
    );
    expect(expired).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
      intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.created,
      suppression_reason: null,
    });

    const confirmedSeed = seedRequest(context, '3003');
    context.services.bookingRequestService.confirmPrepayment(confirmedSeed.bookingRequestId, {
      actorType: 'system',
      actorId: 'payment-3003',
    });
    const confirmed = persistPlan(
      context,
      planResolvedMessage(
        context,
        TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
        confirmedSeed.bookingRequestId
      )
    );
    expect(confirmed).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.created,
      suppression_reason: null,
    });

    const createdIntentEvent = listIntentEvents(context, createdSeed.bookingRequestId)[0];
    expect(createdIntentEvent.event_payload).toMatchObject({
      notification_intent_source: 'telegram_notification_intent_persistence_service',
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.created,
      persistence_only: true,
      no_op_guards: {
        telegram_message_sent: false,
        notification_log_row_created: false,
        bot_handlers_invoked: false,
        mini_app_ui_invoked: false,
        seller_owner_admin_ui_invoked: false,
        production_routes_invoked: false,
        money_ledger_written: false,
      },
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_notifications').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });

  it('replays identical idempotency keys and rejects payload drift', () => {
    const seeded = seedRequest(context, '4004');
    const plan = planResolvedMessage(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      seeded.bookingRequestId
    );

    const first = persistPlan(context, plan);
    const second = persistPlan(context, plan);

    expect(second).toEqual(first);
    expect(listIntentEvents(context, seeded.bookingRequestId)).toHaveLength(1);

    const driftedPlan = cloneJson(plan);
    driftedPlan.delivery_target.username = 'changed_username';

    expect(() => persistPlan(context, driftedPlan)).toThrow('Idempotency conflict');
    expect(listIntentEvents(context, seeded.bookingRequestId)).toHaveLength(1);
  });

  it('persists suppressed decisions without creating notification logs or sending messages', () => {
    const seeded = seedRequest(context, '5005');
    const resolution = cloneJson(
      resolveMessage(
        context,
        TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        seeded.bookingRequestId
      )
    );
    resolution.text_payload.variables.telegram_user_id = null;
    const plan =
      context.services.notificationDeliveryPlanningService.planNotificationDelivery({
        service_message_resolution: resolution,
      });
    const beforeCounts = snapshotTelegramRowCounts(db);

    const first = persistPlan(context, plan);
    const second = persistPlan(context, plan);

    expect(first).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.suppressed,
      persisted_intent_reference: {
        event_type: TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES.suppressed,
      },
      delivery_target_summary: {
        booking_request_id: seeded.bookingRequestId,
        telegram_user_id: null,
      },
      dedupe_key: plan.dedupe_key,
      idempotency_key: plan.idempotency_key,
      suppression_reason: 'missing_telegram_delivery_target',
      block_reason: 'missing_telegram_delivery_target',
    });
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.persisted_intent_reference)).toBe(true);
    expect(listIntentEvents(context, seeded.bookingRequestId)).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_notifications').get().count).toBe(0);

    const afterCounts = snapshotTelegramRowCounts(db);
    expect(afterCounts).toMatchObject({
      ...beforeCounts,
      telegram_booking_request_events:
        beforeCounts.telegram_booking_request_events + 1,
    });
  });
});
