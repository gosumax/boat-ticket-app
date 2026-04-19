import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PERSISTENCE_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES,
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
  context.services.notificationDeliveryAttemptPersistenceService.now = clock.now;
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
    telegram_user_id: `tg-delivery-attempt-${suffix}`,
    display_name: `Delivery Attempt Guest ${suffix}`,
    username: `delivery_attempt_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999222${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = context.repositories.trafficSources.create({
    source_code: `delivery-attempt-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Delivery Attempt Source ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: `delivery-attempt-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `delivery-attempt-zone-${suffix}` },
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

function planResolvedMessage(context, messageType, bookingRequestId, mutateResolution = null) {
  const resolution = cloneJson(resolveMessage(context, messageType, bookingRequestId));
  if (mutateResolution) {
    mutateResolution(resolution);
  }

  return context.services.notificationDeliveryPlanningService.planNotificationDelivery({
    service_message_resolution: resolution,
  });
}

function persistPlan(context, plan) {
  return context.services.notificationIntentPersistenceService.persistNotificationIntent({
    notification_delivery_plan: plan,
    actorType: 'system',
    actorId: 'notification-delivery-attempt-test',
  });
}

function persistAllowedIntent(context, messageType, bookingRequestId) {
  return persistPlan(
    context,
    planResolvedMessage(context, messageType, bookingRequestId)
  );
}

function getQueueItemForIntent(context, intent) {
  const queue =
    context.services.notificationDispatchQueueProjectionService
      .listNotificationDispatchQueue({ limit: 50 });
  const item = queue.items.find((queueItem) => queueItem.dedupe_key === intent.dedupe_key);

  expect(item).toBeTruthy();
  return item;
}

function listAttemptEvents(context, bookingRequestId) {
  return context.repositories.bookingRequestEvents
    .listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 100 }
    )
    .filter((event) =>
      Object.values(TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES).includes(
        event.event_type
      )
    );
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('telegram notification delivery-attempt persistence service', () => {
  let db;
  let context;
  let clock;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('persists immutable delivery-attempt events for the four allowed scenarios only', () => {
    const createdSeed = seedRequest(context, '1001');
    const createdIntent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      createdSeed.bookingRequestId
    );
    const createdItem = getQueueItemForIntent(context, createdIntent);

    context.services.bookingRequestService.extendHoldOnce(createdSeed.bookingRequestId, {
      actorType: 'seller',
      actorId: '1',
    });
    const extendedIntent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      createdSeed.bookingRequestId
    );
    const extendedItem = getQueueItemForIntent(context, extendedIntent);

    const expiredSeed = seedRequest(context, '2002');
    clock.advanceMinutes(16);
    context.services.bookingRequestService.expireHold(expiredSeed.bookingRequestId, {
      actorType: 'system',
      actorId: 'hold-expirer',
    });
    const expiredIntent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
      expiredSeed.bookingRequestId
    );
    const expiredItem = getQueueItemForIntent(context, expiredIntent);

    const confirmedSeed = seedRequest(context, '3003');
    context.services.bookingRequestService.confirmPrepayment(
      confirmedSeed.bookingRequestId,
      {
        actorType: 'system',
        actorId: 'payment-3003',
      }
    );
    const blockedPlan = planResolvedMessage(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      confirmedSeed.bookingRequestId,
      (resolution) => {
        resolution.text_payload.variables.telegram_user_id = null;
      }
    );
    const blockedIntent = persistPlan(context, blockedPlan);
    const blockedItem = getQueueItemForIntent(context, blockedIntent);
    const beforeAttemptCounts = snapshotTelegramRowCounts(db);

    const started =
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliveryStarted({
          notification_dispatch_queue_item: createdItem,
          actorType: 'system',
          actorId: 'delivery-attempt-test',
        });
    const sent =
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliverySent({
          notification_dispatch_queue_item: extendedItem,
          actorType: 'system',
          actorId: 'delivery-attempt-test',
          providerResultReference: {
            deterministic_delivery_probe: 'sent_without_telegram_api_call',
          },
        });
    const failed =
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliveryFailed({
          notification_dispatch_queue_item: expiredItem,
          actorType: 'system',
          actorId: 'delivery-attempt-test',
          failedReason: 'telegram_provider_timeout',
          providerResultReference: { provider_error_code: 'ETIMEDOUT' },
        });
    const blocked =
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliveryBlocked({
          notification_dispatch_queue_item: blockedItem,
          actorType: 'system',
          actorId: 'delivery-attempt-test',
        });

    expect(started).toMatchObject({
      response_version: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PERSISTENCE_VERSION,
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      delivery_attempt_status:
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_started,
      persisted_delivery_attempt_reference: {
        reference_type: 'telegram_booking_request_event',
        booking_request_id: createdSeed.bookingRequestId,
        event_type: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES.delivery_started,
      },
      delivery_target_summary: {
        booking_request_id: createdSeed.bookingRequestId,
        guest_profile_id: createdSeed.guest.guest_profile_id,
        telegram_user_id: createdSeed.guest.telegram_user_id,
      },
      dispatch_queue_item_reference: {
        persisted_intent_reference: createdItem.persisted_intent_reference,
      },
      blocked_reason: null,
      failed_reason: null,
    });
    expect(started.dedupe_key).toBe(started.idempotency_key);
    expect(started.dedupe_key).toContain('status=delivery_started');
    expect(sent).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      delivery_attempt_status:
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent,
      persisted_delivery_attempt_reference: {
        event_type: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES.delivery_sent,
      },
      blocked_reason: null,
      failed_reason: null,
    });
    expect(failed).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
      delivery_attempt_status:
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_failed,
      persisted_delivery_attempt_reference: {
        event_type: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES.delivery_failed,
      },
      failed_reason: 'telegram_provider_timeout',
    });
    expect(blocked).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      delivery_attempt_status:
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_blocked,
      persisted_delivery_attempt_reference: {
        event_type: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES.delivery_blocked,
      },
      delivery_target_summary: {
        booking_request_id: confirmedSeed.bookingRequestId,
        telegram_user_id: null,
      },
      blocked_reason: 'missing_telegram_delivery_target',
      failed_reason: null,
    });

    expect(Object.isFrozen(started)).toBe(true);
    expect(Object.isFrozen(started.persisted_delivery_attempt_reference)).toBe(true);
    expect(Object.isFrozen(started.delivery_target_summary)).toBe(true);
    expect(Object.isFrozen(started.dispatch_queue_item_reference)).toBe(true);

    const startedEvent = context.repositories.bookingRequestEvents.getById(
      started.persisted_delivery_attempt_reference.booking_request_event_id
    );
    expect(startedEvent.event_payload).toMatchObject({
      notification_delivery_attempt_source:
        'telegram_notification_delivery_attempt_persistence_service',
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      delivery_attempt_status:
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_started,
      persistence_only: true,
      no_op_guards: {
        telegram_api_called: false,
        telegram_message_sent: false,
        notification_log_row_created: false,
        bot_handlers_invoked: false,
        mini_app_ui_invoked: false,
        seller_owner_admin_ui_invoked: false,
        production_routes_invoked: false,
        money_ledger_written: false,
      },
    });

    const afterAttemptCounts = snapshotTelegramRowCounts(db);
    expect(afterAttemptCounts).toMatchObject({
      ...beforeAttemptCounts,
      telegram_booking_request_events:
        beforeAttemptCounts.telegram_booking_request_events + 4,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_notifications').get().count)
      .toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });

  it('replays identical attempt idempotency keys and rejects payload drift', () => {
    const seeded = seedRequest(context, '4004');
    const intent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      seeded.bookingRequestId
    );
    const item = getQueueItemForIntent(context, intent);

    const first =
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliveryFailed({
          notification_dispatch_queue_item: item,
          idempotencyKey: 'delivery-failed-4004',
          failedReason: 'telegram_provider_timeout',
          providerResultReference: { provider_error_code: 'ETIMEDOUT' },
        });
    const second =
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliveryFailed({
          notification_dispatch_queue_item: item,
          idempotencyKey: 'delivery-failed-4004',
          failedReason: 'telegram_provider_timeout',
          providerResultReference: { provider_error_code: 'ETIMEDOUT' },
        });

    expect(second).toEqual(first);
    expect(listAttemptEvents(context, seeded.bookingRequestId)).toHaveLength(1);

    expect(() =>
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliveryFailed({
          notification_dispatch_queue_item: item,
          idempotencyKey: 'delivery-failed-4004',
          failedReason: 'telegram_connection_reset',
          providerResultReference: { provider_error_code: 'ECONNRESET' },
        })
    ).toThrow('Idempotency conflict');
    expect(listAttemptEvents(context, seeded.bookingRequestId)).toHaveLength(1);
  });

  it('rejects non-projection and unsupported queue items without writes', () => {
    const seeded = seedRequest(context, '5005');
    const intent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      seeded.bookingRequestId
    );
    const item = getQueueItemForIntent(context, intent);
    const beforeCounts = snapshotTelegramRowCounts(db);

    const nonProjectionItem = cloneJson(item);
    nonProjectionItem.read_only = false;
    expect(() =>
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliveryStarted({
          notification_dispatch_queue_item: nonProjectionItem,
        })
    ).toThrow('notification dispatch queue projection item is required');

    const unsupportedItem = cloneJson(item);
    unsupportedItem.notification_type = 'ticket_sent';
    expect(() =>
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliveryStarted({
          notification_dispatch_queue_item: unsupportedItem,
        })
    ).toThrow('Unsupported notification type');

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeCounts);
  });
});
