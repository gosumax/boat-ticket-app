import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_STATES,
  TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES,
  TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
  TELEGRAM_NOTIFICATION_INTENT_STATUSES,
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
    telegram_user_id: `tg-delivery-projection-${suffix}`,
    display_name: `Delivery Projection Guest ${suffix}`,
    username: `delivery_projection_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999111${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = context.repositories.trafficSources.create({
    source_code: `delivery-projection-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Delivery Projection Source ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: `delivery-projection-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `delivery-projection-zone-${suffix}` },
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
    actorId: 'notification-delivery-attempt-projection-test',
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

function createPersistedIntentEvent(context, bookingRequestId, payload) {
  return context.repositories.bookingRequestEvents.create({
    booking_request_id: bookingRequestId,
    booking_hold_id: null,
    seller_attribution_session_id:
      context.repositories.bookingRequests.getById(bookingRequestId)
        .seller_attribution_session_id,
    event_type: payload.event_type,
    event_at: '2026-04-10T10:30:00.000Z',
    actor_type: 'system',
    actor_id: 'notification-delivery-attempt-projection-test',
    event_payload: payload.event_payload,
  });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('telegram notification delivery-attempt projection service', () => {
  let db;
  let context;
  let clock;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('lists frozen notification items with latest delivery-attempt state from immutable events only', () => {
    const noAttemptSeed = seedRequest(context, '1001');
    const noAttemptIntent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      noAttemptSeed.bookingRequestId
    );

    context.services.bookingRequestService.extendHoldOnce(noAttemptSeed.bookingRequestId, {
      actorType: 'seller',
      actorId: '1',
    });
    const startedIntent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      noAttemptSeed.bookingRequestId
    );
    const startedItem = getQueueItemForIntent(context, startedIntent);
    const started =
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliveryStarted({
          notification_dispatch_queue_item: startedItem,
          actorType: 'system',
          actorId: 'projection-test-started',
        });

    const failedSeed = seedRequest(context, '2002');
    clock.advanceMinutes(16);
    context.services.bookingRequestService.expireHold(failedSeed.bookingRequestId, {
      actorType: 'system',
      actorId: 'hold-expirer',
    });
    const failedIntent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
      failedSeed.bookingRequestId
    );
    const failedItem = getQueueItemForIntent(context, failedIntent);
    const failed =
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliveryFailed({
          notification_dispatch_queue_item: failedItem,
          actorType: 'system',
          actorId: 'projection-test-failed',
          failedReason: 'telegram_provider_timeout',
          providerResultReference: { provider_error_code: 'ETIMEDOUT' },
        });

    const sentSeed = seedRequest(context, '3003');
    context.services.bookingRequestService.confirmPrepayment(sentSeed.bookingRequestId, {
      actorType: 'system',
      actorId: 'payment-3003',
    });
    const sentIntent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      sentSeed.bookingRequestId
    );
    const sentItem = getQueueItemForIntent(context, sentIntent);
    const sent =
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliverySent({
          notification_dispatch_queue_item: sentItem,
          actorType: 'system',
          actorId: 'projection-test-sent',
          providerResultReference: {
            deterministic_delivery_probe: 'sent_without_telegram_api_call',
          },
        });

    const blockedSeed = seedRequest(context, '4004');
    const blockedIntent = persistPlan(
      context,
      planResolvedMessage(
        context,
        TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        blockedSeed.bookingRequestId,
        (resolution) => {
          resolution.text_payload.variables.telegram_user_id = null;
        }
      )
    );
    const blockedItem = getQueueItemForIntent(context, blockedIntent);
    const blocked =
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliveryBlocked({
          notification_dispatch_queue_item: blockedItem,
          actorType: 'system',
          actorId: 'projection-test-blocked',
        });
    const beforeProjectionCounts = snapshotTelegramRowCounts(db);

    const projection =
      context.services.notificationDeliveryAttemptProjectionService
        .listNotificationItemsWithLatestDeliveryAttemptState({ limit: 10 });

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeProjectionCounts);
    expect(projection).toMatchObject({
      response_version: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION_VERSION,
      read_only: true,
      projection_only: true,
      source: 'persisted_notification_intents_and_delivery_attempt_events',
      item_count: 5,
      no_op_guards: {
        telegram_api_called: false,
        telegram_message_sent: false,
        delivery_attempt_row_created: false,
        notification_log_row_created: false,
        bot_handlers_invoked: false,
        mini_app_ui_invoked: false,
        seller_owner_admin_ui_invoked: false,
        production_routes_invoked: false,
        money_ledger_written: false,
      },
    });
    expect(
      projection.items.map((item) => [
        item.notification_type,
        item.delivery_state,
        item.latest_attempt_status,
      ])
    ).toEqual([
      [
        TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        TELEGRAM_NOTIFICATION_DELIVERY_STATES.no_attempt_yet,
        null,
      ],
      [
        TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
        TELEGRAM_NOTIFICATION_DELIVERY_STATES.started,
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_started,
      ],
      [
        TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
        TELEGRAM_NOTIFICATION_DELIVERY_STATES.failed,
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_failed,
      ],
      [
        TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
        TELEGRAM_NOTIFICATION_DELIVERY_STATES.sent,
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent,
      ],
      [
        TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        TELEGRAM_NOTIFICATION_DELIVERY_STATES.blocked,
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_blocked,
      ],
    ]);

    const noAttempt = projection.items[0];
    expect(noAttempt).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      delivery_state: TELEGRAM_NOTIFICATION_DELIVERY_STATES.no_attempt_yet,
      latest_attempt_status: null,
      latest_attempt_event_reference: null,
      persisted_intent_reference: noAttemptIntent.persisted_intent_reference,
      dispatch_queue_item_reference: {
        persisted_intent_reference: noAttemptIntent.persisted_intent_reference,
      },
      delivery_target_summary: {
        booking_request_id: noAttemptSeed.bookingRequestId,
        guest_profile_id: noAttemptSeed.guest.guest_profile_id,
        telegram_user_id: noAttemptSeed.guest.telegram_user_id,
      },
      dedupe_key: noAttemptIntent.dedupe_key,
      idempotency_key: noAttemptIntent.idempotency_key,
      blocked_reason: null,
      failed_reason: null,
      latest_persisted_delivery_attempt_result: null,
    });
    expect(projection.items[1].latest_attempt_event_reference).toEqual(
      started.persisted_delivery_attempt_reference
    );
    expect(projection.items[2]).toMatchObject({
      latest_attempt_event_reference: failed.persisted_delivery_attempt_reference,
      failed_reason: 'telegram_provider_timeout',
      latest_persisted_delivery_attempt_result: {
        failed_reason: 'telegram_provider_timeout',
        provider_result_reference: { provider_error_code: 'ETIMEDOUT' },
      },
    });
    expect(projection.items[3].latest_attempt_event_reference).toEqual(
      sent.persisted_delivery_attempt_reference
    );
    expect(projection.items[4]).toMatchObject({
      latest_attempt_event_reference: blocked.persisted_delivery_attempt_reference,
      blocked_reason: 'missing_telegram_delivery_target',
      failed_reason: null,
      delivery_target_summary: {
        booking_request_id: blockedSeed.bookingRequestId,
        telegram_user_id: null,
      },
    });

    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.items)).toBe(true);
    expect(Object.isFrozen(projection.items[0])).toBe(true);
    expect(Object.isFrozen(projection.items[0].dispatch_queue_item_reference)).toBe(true);
    expect(Object.isFrozen(projection.items[2].latest_persisted_delivery_attempt_result))
      .toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_notifications').get().count)
      .toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });

  it('reads one notification item with its latest persisted delivery-attempt result', () => {
    const seeded = seedRequest(context, '5005');
    const intent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      seeded.bookingRequestId
    );
    const item = getQueueItemForIntent(context, intent);

    context.services.notificationDeliveryAttemptPersistenceService
      .persistDeliveryStarted({
        notification_dispatch_queue_item: item,
        actorType: 'system',
        actorId: 'projection-test-started',
      });
    const failed =
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliveryFailed({
          notification_dispatch_queue_item: item,
          actorType: 'system',
          actorId: 'projection-test-failed',
          failedReason: 'telegram_provider_timeout',
        });
    const sent =
      context.services.notificationDeliveryAttemptPersistenceService
        .persistDeliverySent({
          notification_dispatch_queue_item: item,
          actorType: 'system',
          actorId: 'projection-test-sent',
          providerResultReference: { provider_message_id: 'message-5005' },
        });
    const beforeReadCounts = snapshotTelegramRowCounts(db);

    const read =
      context.services.notificationDeliveryAttemptProjectionService
        .readNotificationItemWithLatestDeliveryAttemptResult({
          persisted_intent_reference: intent.persisted_intent_reference,
        });

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeReadCounts);
    expect(read).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      delivery_state: TELEGRAM_NOTIFICATION_DELIVERY_STATES.sent,
      latest_attempt_status:
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent,
      latest_attempt_event_reference: sent.persisted_delivery_attempt_reference,
      dispatch_queue_item_reference: item
        ? { persisted_intent_reference: item.persisted_intent_reference }
        : null,
      delivery_target_summary: {
        booking_request_id: seeded.bookingRequestId,
        guest_profile_id: seeded.guest.guest_profile_id,
      },
      dedupe_key: intent.dedupe_key,
      idempotency_key: intent.idempotency_key,
      latest_attempt_dedupe_key: sent.dedupe_key,
      latest_attempt_idempotency_key: sent.idempotency_key,
      blocked_reason: null,
      failed_reason: null,
      latest_persisted_delivery_attempt_result: {
        persisted_delivery_attempt_reference: sent.persisted_delivery_attempt_reference,
        provider_result_reference: { provider_message_id: 'message-5005' },
      },
    });
    expect(read.latest_attempt_event_reference.booking_request_event_id)
      .toBeGreaterThan(failed.persisted_delivery_attempt_reference.booking_request_event_id);

    const readViaDispatchReference =
      context.services.notificationDeliveryAttemptProjectionService
        .readNotificationItem({
          dispatch_queue_item_reference: read.dispatch_queue_item_reference,
        });
    expect(readViaDispatchReference).toEqual(read);
  });

  it('rejects unsupported notification types, invalid items, and unsupported filters without writes', () => {
    const seeded = seedRequest(context, '6006');
    const validIntent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      seeded.bookingRequestId
    );
    const unsupportedEvent = createPersistedIntentEvent(context, seeded.bookingRequestId, {
      event_type: TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES.suppressed,
      event_payload: {
        response_version: TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
        notification_intent_source: 'telegram_notification_intent_persistence_service',
        notification_type: 'ticket_sent',
        intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.suppressed,
        delivery_target_summary: {
          booking_request_id: seeded.bookingRequestId,
          guest_profile_id: seeded.guest.guest_profile_id,
        },
        dedupe_key: `unsupported-ticket-sent-${seeded.bookingRequestId}`,
        idempotency_key: `unsupported-ticket-sent-${seeded.bookingRequestId}`,
        suppression_reason: 'unsupported_notification_type',
        block_reason: 'unsupported_notification_type',
        persistence_only: true,
      },
    });
    const invalidEvent = createPersistedIntentEvent(context, seeded.bookingRequestId, {
      event_type: TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES.created,
      event_payload: {
        response_version: 'legacy_notification_intent_v0',
        notification_intent_source: 'telegram_notification_intent_persistence_service',
        notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.created,
        delivery_target_summary: {
          booking_request_id: seeded.bookingRequestId,
          guest_profile_id: seeded.guest.guest_profile_id,
        },
        dedupe_key: `invalid-item-${seeded.bookingRequestId}`,
        idempotency_key: `invalid-item-${seeded.bookingRequestId}`,
        persistence_only: true,
      },
    });
    const beforeRejectedReads = snapshotTelegramRowCounts(db);

    expect(() =>
      context.services.notificationDeliveryAttemptProjectionService
        .readNotificationItem({
          booking_request_event_id: unsupportedEvent.booking_request_event_id,
        })
    ).toThrow('Unsupported notification type');
    expect(() =>
      context.services.notificationDeliveryAttemptProjectionService
        .readNotificationItem({
          booking_request_event_id: invalidEvent.booking_request_event_id,
        })
    ).toThrow('not projectable');
    expect(() =>
      context.services.notificationDeliveryAttemptProjectionService
        .listNotificationItems({ notification_types: ['ticket_sent'] })
    ).toThrow('Unsupported notification type');
    expect(() =>
      context.services.notificationDeliveryAttemptProjectionService
        .listNotificationItems({ delivery_states: ['mystery'] })
    ).toThrow('Unsupported delivery state');
    expect(() =>
      context.services.notificationDeliveryAttemptProjectionService
        .listNotificationItems()
    ).toThrow('Unsupported notification type');

    expect(
      context.services.notificationDeliveryAttemptProjectionService
        .readNotificationItem(validIntent.persisted_intent_reference)
    ).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      delivery_state: TELEGRAM_NOTIFICATION_DELIVERY_STATES.no_attempt_yet,
    });
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeRejectedReads);
  });
});
