import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_RUN_BATCH_RESULT_TYPE,
  TELEGRAM_NOTIFICATION_DELIVERY_RUN_RESULT_TYPE,
  TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS,
  TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_RUN_VERSION,
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
    telegram_user_id: `tg-delivery-run-${suffix}`,
    display_name: `Delivery Run Guest ${suffix}`,
    username: `delivery_run_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999555${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = context.repositories.trafficSources.create({
    source_code: `delivery-run-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Delivery Run Source ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: `delivery-run-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `delivery-run-zone-${suffix}` },
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
    actorId: 'notification-delivery-run-test',
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
    actor_id: 'notification-delivery-run-test',
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

describe('telegram notification delivery run service', () => {
  let db;
  let context;
  let clock;
  let adapterCalls;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    adapterCalls = [];
    context = createTelegramPersistenceContext(db, {
      executeTelegramNotificationDelivery: vi.fn((adapterInput) => {
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
      }),
    });
    wireClock(context, clock);
  });

  it('runs one selected ready item and safely skips a repeated fully resolved item', () => {
    const seeded = seedRequest(context, '1001');
    const intent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      seeded.bookingRequestId
    );
    const item = getQueueItemForIntent(context, intent);

    const first =
      context.services.notificationDeliveryRunService
        .runDeliveryForReadyNotificationItem({
          notification_dispatch_queue_item: item,
          actorType: 'system',
          actorId: 'delivery-run-test',
        });
    const second =
      context.services.notificationDeliveryRunService
        .runDeliveryForReadyNotificationItem({
          notification_dispatch_queue_item: item,
          actorType: 'system',
          actorId: 'delivery-run-test',
        });

    expect(adapterCalls).toHaveLength(1);
    expect(first).toMatchObject({
      response_version: TELEGRAM_NOTIFICATION_DELIVERY_RUN_VERSION,
      run_result_type: TELEGRAM_NOTIFICATION_DELIVERY_RUN_RESULT_TYPE,
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      run_status: TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.sent,
      queue_item_reference: {
        persisted_intent_reference: item.persisted_intent_reference,
      },
      delivery_target_summary: {
        booking_request_id: seeded.bookingRequestId,
        guest_profile_id: seeded.guest.guest_profile_id,
        telegram_user_id: seeded.guest.telegram_user_id,
      },
      dedupe_key: item.dedupe_key,
      idempotency_key: item.idempotency_key,
      execution_result_summary: {
        execution_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
        delivery_attempt_status:
          TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent,
      },
      persisted_attempt_reference: {
        event_type: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES.delivery_sent,
        delivery_attempt_status:
          TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent,
      },
      blocked_reason: null,
      failed_reason: null,
      skip_reason: null,
    });
    expect(second).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      run_status: TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.skipped,
      skip_reason:
        TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.already_fully_resolved,
      execution_result_summary: {
        execution_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
        persisted_attempt_reference: first.persisted_attempt_reference,
      },
      persisted_attempt_reference: first.persisted_attempt_reference,
    });
    expect(listAttemptEvents(context, seeded.bookingRequestId)).toHaveLength(1);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.queue_item_reference)).toBe(true);
    expect(Object.isFrozen(first.execution_result_summary)).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_notifications').get().count)
      .toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });

  it('runs explicit batches deterministically and skips blocked suppressed invalid items', () => {
    const createdSeed = seedRequest(context, '2001');
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

    const blockedSeed = seedRequest(context, '2003');
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

    const suppressedSeed = seedRequest(context, '2004');
    const suppressedEvent = createSuppressedIntentEvent(context, suppressedSeed);
    const suppressedItem =
      context.services.notificationDispatchQueueProjectionService
        .listSuppressedDispatchQueue({ limit: 50 })
        .items
        .find(
          (queueItem) =>
            queueItem.persisted_intent_reference.booking_request_event_id ===
            suppressedEvent.booking_request_event_id
        );
    const invalidItem = cloneJson(createdItem);
    invalidItem.read_only = false;
    const beforeRunCounts = snapshotTelegramRowCounts(db);

    const batch =
      context.services.notificationDeliveryRunService
        .runDeliveryForReadyNotificationItems({
          items: [
            createdItem,
            extendedItem,
            expiredItem,
            blockedItem,
            suppressedItem,
            invalidItem,
          ],
          actorType: 'system',
          actorId: 'delivery-run-test',
        });

    expect(adapterCalls.map((call) => call.notification_type)).toEqual([
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
    ]);
    expect(batch).toMatchObject({
      response_version: TELEGRAM_NOTIFICATION_DELIVERY_RUN_VERSION,
      run_result_type: TELEGRAM_NOTIFICATION_DELIVERY_RUN_BATCH_RESULT_TYPE,
      counters: {
        total: 6,
        processed: 3,
        skipped: 3,
        sent: 1,
        blocked: 1,
        failed: 1,
        blocked_skipped: 1,
        suppressed: 1,
        invalid: 1,
      },
    });
    expect(batch.results.map((result) => result.run_status)).toEqual([
      TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.sent,
      TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.blocked,
      TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.failed,
      TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.skipped,
      TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.skipped,
      TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.skipped,
    ]);
    expect(batch.results.map((result) => result.skip_reason)).toEqual([
      null,
      null,
      null,
      TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.blocked,
      TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.suppressed,
      TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.invalid,
    ]);
    expect(batch.results[1]).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      blocked_reason: 'guest_blocked_bot',
      execution_result_summary: {
        execution_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
      },
    });
    expect(batch.results[2]).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
      failed_reason: 'telegram_provider_timeout',
      execution_result_summary: {
        execution_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
      },
    });
    expect(batch.results[3]).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      blocked_reason: 'missing_telegram_delivery_target',
    });
    expect(
      snapshotTelegramRowCounts(db).telegram_booking_request_events -
        beforeRunCounts.telegram_booking_request_events
    ).toBe(3);
    expect(Object.isFrozen(batch)).toBe(true);
    expect(Object.isFrozen(batch.results)).toBe(true);
    expect(Object.isFrozen(batch.counters)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_notifications').get().count)
      .toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });

  it('reads pending queue items itself when batch input omits an explicit list', () => {
    const firstSeed = seedRequest(context, '3001');
    persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      firstSeed.bookingRequestId
    );
    const secondSeed = seedRequest(context, '3002');
    persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      secondSeed.bookingRequestId
    );

    const batch =
      context.services.notificationDeliveryRunService
        .runNotificationDeliveryForReadyItems({
          limit: 2,
          actorType: 'system',
          actorId: 'delivery-run-test',
        });

    expect(adapterCalls).toHaveLength(2);
    expect(batch.results.map((result) => result.delivery_target_summary.booking_request_id))
      .toEqual([firstSeed.bookingRequestId, secondSeed.bookingRequestId]);
    expect(batch.counters).toMatchObject({
      total: 2,
      processed: 2,
      skipped: 0,
      sent: 2,
    });
  });
});
