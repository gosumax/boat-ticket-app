import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR_VERSION,
  TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES,
  TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
  TELEGRAM_NOTIFICATION_INTENT_STATUSES,
  TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS,
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
    telegram_user_id: `tg-delivery-executor-${suffix}`,
    display_name: `Delivery Executor Guest ${suffix}`,
    username: `delivery_executor_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999444${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = context.repositories.trafficSources.create({
    source_code: `delivery-executor-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Delivery Executor Source ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: `delivery-executor-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `delivery-executor-zone-${suffix}` },
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
    actorId: 'notification-delivery-executor-test',
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
    actor_id: 'notification-delivery-executor-test',
    event_payload: payload.event_payload,
  });
}

function createSuppressedIntentEvent(context, seeded) {
  return createPersistedIntentEvent(context, seeded.bookingRequestId, {
    event_type: TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES.suppressed,
    event_payload: {
      response_version: TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
      notification_intent_source: 'telegram_notification_intent_persistence_service',
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.suppressed,
      delivery_channel: 'telegram_bot',
      send_timing_mode: 'immediate',
      delivery_target_summary: {
        target_type: 'telegram_guest',
        booking_request_id: seeded.bookingRequestId,
        guest_profile_id: seeded.guest.guest_profile_id,
        telegram_user_id: seeded.guest.telegram_user_id,
      },
      resolved_payload_summary_reference: {
        reference_type: 'telegram_service_message_resolution',
        message_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.booking_created,
      },
      send_decision: {
        should_send: null,
        send_allowed: null,
        suppression_reason: 'guest_notifications_suppressed',
        block_reason: null,
        safe_block_reasons: [],
      },
      dedupe_key: `manual-suppressed-${seeded.bookingRequestId}`,
      idempotency_key: `manual-suppressed-${seeded.bookingRequestId}`,
      suppression_reason: 'guest_notifications_suppressed',
      block_reason: null,
      persistence_only: true,
    },
  });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('telegram notification delivery executor service', () => {
  let db;
  let context;
  let clock;
  let adapterCalls;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    adapterCalls = [];
    context = createTelegramPersistenceContext(db, {
      executeTelegramNotificationDelivery(adapterInput) {
        adapterCalls.push(adapterInput);

        if (
          adapterInput.notification_type === TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended
        ) {
          return {
            outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
            blockedReason: 'guest_blocked_bot',
            providerResultReference: { deterministic_adapter_case: 'blocked' },
          };
        }

        if (
          adapterInput.notification_type === TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired
        ) {
          return {
            outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
            failedReason: 'telegram_provider_timeout',
            providerResultReference: { deterministic_adapter_case: 'failed' },
          };
        }

        return {
          outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
          providerResultReference: { deterministic_adapter_case: 'sent' },
        };
      },
    });
    wireClock(context, clock);
  });

  it('executes one ready projected notification queue item at a time through the injected adapter', () => {
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
    const confirmedIntent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      confirmedSeed.bookingRequestId
    );
    const confirmedItem = getQueueItemForIntent(context, confirmedIntent);
    const beforeExecutionCounts = snapshotTelegramRowCounts(db);

    const sent =
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery({
          notification_dispatch_queue_item: createdItem,
          actorType: 'system',
          actorId: 'executor-test',
        });
    const blocked =
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery({
          notification_dispatch_queue_item: extendedItem,
          actorType: 'system',
          actorId: 'executor-test',
        });
    const failed =
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery({
          notification_dispatch_queue_item: expiredItem,
          actorType: 'system',
          actorId: 'executor-test',
        });
    const confirmed =
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery({
          notification_dispatch_queue_item: confirmedItem,
          actorType: 'system',
          actorId: 'executor-test',
        });

    expect(adapterCalls).toHaveLength(4);
    expect(adapterCalls[0]).toMatchObject({
      adapter_contract_version: TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION,
      delivery_channel: 'telegram_bot',
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      delivery_target_summary: {
        booking_request_id: createdSeed.bookingRequestId,
        guest_profile_id: createdSeed.guest.guest_profile_id,
        telegram_user_id: createdSeed.guest.telegram_user_id,
      },
      dedupe_key: createdItem.dedupe_key,
      idempotency_key: createdItem.idempotency_key,
      queue_item_reference: {
        persisted_intent_reference: createdItem.persisted_intent_reference,
      },
    });
    expect(Object.isFrozen(adapterCalls[0])).toBe(true);
    expect(Object.isFrozen(adapterCalls[0].delivery_target_summary)).toBe(true);
    expect(Object.isFrozen(adapterCalls[0].queue_item_reference)).toBe(true);

    expect(sent).toMatchObject({
      response_version: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR_VERSION,
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      execution_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      queue_item_reference: {
        persisted_intent_reference: createdItem.persisted_intent_reference,
      },
      delivery_target_summary: {
        booking_request_id: createdSeed.bookingRequestId,
        guest_profile_id: createdSeed.guest.guest_profile_id,
        telegram_user_id: createdSeed.guest.telegram_user_id,
      },
      dedupe_key: createdItem.dedupe_key,
      idempotency_key: createdItem.idempotency_key,
      persisted_attempt_reference: {
        reference_type: 'telegram_booking_request_event',
        booking_request_id: createdSeed.bookingRequestId,
        event_type: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES.delivery_sent,
        delivery_attempt_status:
          TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent,
      },
      blocked_reason: null,
      failed_reason: null,
    });
    expect(blocked).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      execution_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
      persisted_attempt_reference: {
        event_type: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES.delivery_blocked,
        delivery_attempt_status:
          TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_blocked,
      },
      blocked_reason: 'guest_blocked_bot',
      failed_reason: null,
    });
    expect(failed).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
      execution_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
      persisted_attempt_reference: {
        event_type: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES.delivery_failed,
        delivery_attempt_status:
          TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_failed,
      },
      blocked_reason: null,
      failed_reason: 'telegram_provider_timeout',
    });
    expect(confirmed).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      execution_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
    });

    expect(Object.isFrozen(sent)).toBe(true);
    expect(Object.isFrozen(sent.queue_item_reference)).toBe(true);
    expect(Object.isFrozen(sent.delivery_target_summary)).toBe(true);
    expect(Object.isFrozen(sent.persisted_attempt_reference)).toBe(true);

    const sentEvent = context.repositories.bookingRequestEvents.getById(
      sent.persisted_attempt_reference.booking_request_event_id
    );
    expect(sentEvent.event_payload).toMatchObject({
      notification_delivery_attempt_source:
        'telegram_notification_delivery_attempt_persistence_service',
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      delivery_attempt_status:
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent,
      provider_result_reference: { deterministic_adapter_case: 'sent' },
      persistence_only: true,
    });

    const afterExecutionCounts = snapshotTelegramRowCounts(db);
    expect(afterExecutionCounts).toMatchObject({
      ...beforeExecutionCounts,
      telegram_booking_request_events:
        beforeExecutionCounts.telegram_booking_request_events + 4,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_notifications').get().count)
      .toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });

  it('replays the same idempotency key without invoking the adapter again', () => {
    const seeded = seedRequest(context, '4004');
    const intent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      seeded.bookingRequestId
    );
    const item = getQueueItemForIntent(context, intent);

    const first =
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery({
          notification_dispatch_queue_item: item,
          actorType: 'system',
          actorId: 'executor-test',
        });
    const second =
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery({
          notification_dispatch_queue_item: item,
          actorType: 'system',
          actorId: 'executor-test',
        });

    expect(second).toEqual(first);
    expect(adapterCalls).toHaveLength(1);
    expect(listAttemptEvents(context, seeded.bookingRequestId)).toHaveLength(1);

    context.services.bookingRequestService.extendHoldOnce(seeded.bookingRequestId, {
      actorType: 'seller',
      actorId: '1',
    });
    const extendedIntent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      seeded.bookingRequestId
    );
    const conflictingItem = cloneJson(getQueueItemForIntent(context, extendedIntent));
    conflictingItem.dedupe_key = item.dedupe_key;
    conflictingItem.idempotency_key = item.idempotency_key;

    expect(() =>
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery({
          notification_dispatch_queue_item: conflictingItem,
        })
    ).toThrow('Idempotency conflict');
    expect(adapterCalls).toHaveLength(1);
    expect(listAttemptEvents(context, seeded.bookingRequestId)).toHaveLength(1);
  });

  it('rejects unsupported, invalid, suppressed, and non-executable queue items without writes', () => {
    const seeded = seedRequest(context, '5005');
    const intent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      seeded.bookingRequestId
    );
    const item = getQueueItemForIntent(context, intent);

    const blockedSeed = seedRequest(context, '6006');
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

    const suppressedSeed = seedRequest(context, '7007');
    const suppressedEvent = createSuppressedIntentEvent(context, suppressedSeed);
    const suppressedQueue =
      context.services.notificationDispatchQueueProjectionService
        .listSuppressedDispatchQueue({ limit: 50 });
    const suppressedItem = suppressedQueue.items.find(
      (queueItem) =>
        queueItem.persisted_intent_reference.booking_request_event_id ===
        suppressedEvent.booking_request_event_id
    );
    expect(suppressedItem).toBeTruthy();
    const beforeRejectedCounts = snapshotTelegramRowCounts(db);

    expect(() =>
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery([item])
    ).toThrow('exactly one notification queue item');

    const invalidItem = cloneJson(item);
    invalidItem.read_only = false;
    expect(() =>
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery({
          notification_dispatch_queue_item: invalidItem,
        })
    ).toThrow('notification dispatch queue projection item is required');

    const unsupportedItem = cloneJson(item);
    unsupportedItem.notification_type = 'ticket_sent';
    expect(() =>
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery({
          notification_dispatch_queue_item: unsupportedItem,
        })
    ).toThrow('Unsupported notification type');

    const nonExecutableItem = cloneJson(item);
    nonExecutableItem.dispatch_status.dispatchable = false;
    expect(() =>
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery({
          notification_dispatch_queue_item: nonExecutableItem,
        })
    ).toThrow('non-executable notification queue item status');

    expect(() =>
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery({
          notification_dispatch_queue_item: blockedItem,
        })
    ).toThrow('blocked notification queue item is not executable');

    expect(() =>
      context.services.notificationDeliveryExecutorService
        .executeNotificationDelivery({
          notification_dispatch_queue_item: suppressedItem,
        })
    ).toThrow('suppressed notification queue item is not executable');

    expect(adapterCalls).toHaveLength(0);
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeRejectedCounts);
  });
});
