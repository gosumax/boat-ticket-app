import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION,
  TELEGRAM_NOTIFICATION_DISPATCH_STATUSES,
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
    telegram_user_id: `tg-dispatch-queue-${suffix}`,
    display_name: `Dispatch Queue Guest ${suffix}`,
    username: `dispatch_queue_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999333${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = context.repositories.trafficSources.create({
    source_code: `dispatch-queue-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Dispatch Queue Source ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: `dispatch-queue-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `dispatch-queue-zone-${suffix}` },
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
    actorId: 'notification-dispatch-queue-test',
  });
}

function persistAllowedIntent(context, messageType, bookingRequestId) {
  return persistPlan(context, planResolvedMessage(context, messageType, bookingRequestId));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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
    actor_id: 'notification-dispatch-queue-test',
    event_payload: payload.event_payload,
  });
}

function createSuppressedIntentEvent(context, seeded, overrides = {}) {
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
      ...overrides,
    },
  });
}

describe('telegram notification dispatch queue projection service', () => {
  let db;
  let context;
  let clock;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('projects frozen dispatch queue items from persisted intents for the four allowed scenarios only', () => {
    const createdSeed = seedRequest(context, '1001');
    const createdIntent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      createdSeed.bookingRequestId
    );

    context.services.bookingRequestService.extendHoldOnce(createdSeed.bookingRequestId, {
      actorType: 'seller',
      actorId: '1',
    });
    const extendedIntent = persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      createdSeed.bookingRequestId
    );

    const expiredSeed = seedRequest(context, '2002');
    clock.advanceMinutes(16);
    context.services.bookingRequestService.expireHold(expiredSeed.bookingRequestId, {
      actorType: 'system',
      actorId: 'hold-expirer',
    });
    persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
      expiredSeed.bookingRequestId
    );

    const confirmedSeed = seedRequest(context, '3003');
    context.services.bookingRequestService.confirmPrepayment(
      confirmedSeed.bookingRequestId,
      {
        actorType: 'system',
        actorId: 'payment-3003',
      }
    );
    persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      confirmedSeed.bookingRequestId
    );

    const blockedSeed = seedRequest(context, '4004');
    const blockedResolution = cloneJson(
      resolveMessage(
        context,
        TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        blockedSeed.bookingRequestId
      )
    );
    blockedResolution.text_payload.variables.telegram_user_id = null;
    const blockedPlan =
      context.services.notificationDeliveryPlanningService.planNotificationDelivery({
        service_message_resolution: blockedResolution,
      });
    persistPlan(context, blockedPlan);

    createPersistedIntentEvent(context, createdSeed.bookingRequestId, {
      event_type: TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES.suppressed,
      event_payload: {
        response_version: TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
        notification_intent_source: 'telegram_notification_intent_persistence_service',
        notification_type: 'ticket_sent',
        intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.suppressed,
        delivery_target_summary: {},
        resolved_payload_summary_reference: {},
        dedupe_key: 'unsupported-ticket-sent',
        idempotency_key: 'unsupported-ticket-sent',
        suppression_reason: 'unsupported_notification_type',
        block_reason: 'unsupported_notification_type',
        persistence_only: true,
      },
    });
    const beforeProjectionCounts = snapshotTelegramRowCounts(db);

    const queue =
      context.services.notificationDispatchQueueProjectionService
        .listNotificationDispatchQueue({ limit: 10 });

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeProjectionCounts);
    expect(queue).toMatchObject({
      response_version: TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION,
      read_only: true,
      projection_only: true,
      source: 'persisted_notification_intents',
      no_op_guards: {
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
    expect(queue.items.map((item) => item.notification_type)).toEqual([
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
      TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
    ]);

    const createdItem = queue.items[0];
    expect(createdItem).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      dispatch_status: {
        status: TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.pending,
        intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.created,
        dispatchable: true,
        delivery_attempt_state: 'not_attempted',
        projected_from: 'persisted_notification_intent',
        reason: null,
      },
      persisted_intent_reference: {
        reference_type: 'telegram_booking_request_event',
        booking_request_event_id:
          createdIntent.persisted_intent_reference.booking_request_event_id,
        booking_request_id: createdSeed.bookingRequestId,
        event_type: TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES.created,
      },
      delivery_target_summary: {
        booking_request_id: createdSeed.bookingRequestId,
        guest_profile_id: createdSeed.guest.guest_profile_id,
        telegram_user_id: createdSeed.guest.telegram_user_id,
      },
      dedupe_key: createdIntent.dedupe_key,
      idempotency_key: createdIntent.idempotency_key,
      resolved_payload_summary_reference: {
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.booking_created,
      },
      suppression_block_state: null,
      read_only: true,
      projection_only: true,
    });
    expect(queue.items[1].dedupe_key).toBe(extendedIntent.dedupe_key);

    const blockedItem = queue.items[4];
    expect(blockedItem).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      dispatch_status: {
        status: TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.blocked,
        intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.suppressed,
        dispatchable: false,
        reason: 'missing_telegram_delivery_target',
      },
      delivery_target_summary: {
        booking_request_id: blockedSeed.bookingRequestId,
        telegram_user_id: null,
      },
      dedupe_key: blockedPlan.dedupe_key,
      idempotency_key: blockedPlan.idempotency_key,
      suppression_block_state: {
        state: TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.blocked,
        suppression_reason: 'missing_telegram_delivery_target',
        block_reason: 'missing_telegram_delivery_target',
        send_allowed: false,
        should_send: false,
      },
    });
    expect(blockedItem.suppression_block_state.safe_block_reasons).toEqual([
      {
        reason: 'missing_telegram_delivery_target',
        message: 'Telegram delivery target identity is missing.',
      },
    ]);

    expect(Object.isFrozen(queue)).toBe(true);
    expect(Object.isFrozen(queue.items)).toBe(true);
    expect(Object.isFrozen(queue.items[0])).toBe(true);
    expect(Object.isFrozen(queue.items[0].dispatch_status)).toBe(true);
    expect(Object.isFrozen(queue.items[0].persisted_intent_reference)).toBe(true);
    expect(Object.isFrozen(blockedItem.suppression_block_state)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_notifications').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });

  it('lists pending, blocked, and suppressed-style projections deterministically without writes', () => {
    const pendingSeed = seedRequest(context, '5001');
    const blockedSeed = seedRequest(context, '5002');
    const suppressedSeed = seedRequest(context, '5003');

    persistAllowedIntent(
      context,
      TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      pendingSeed.bookingRequestId
    );

    const blockedResolution = cloneJson(
      resolveMessage(
        context,
        TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        blockedSeed.bookingRequestId
      )
    );
    blockedResolution.text_payload.variables.telegram_user_id = null;
    persistPlan(
      context,
      context.services.notificationDeliveryPlanningService.planNotificationDelivery({
        service_message_resolution: blockedResolution,
      })
    );
    createSuppressedIntentEvent(context, suppressedSeed);
    const beforeProjectionCounts = snapshotTelegramRowCounts(db);

    const pendingQueue =
      context.services.notificationDispatchQueueProjectionService
        .listPendingDispatchQueue();
    const blockedQueue =
      context.services.notificationDispatchQueueProjectionService
        .listBlockedDispatchQueue();
    const suppressedQueue =
      context.services.notificationDispatchQueueProjectionService
        .listSuppressedDispatchQueue();

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeProjectionCounts);
    expect(pendingQueue.items).toHaveLength(1);
    expect(blockedQueue.items).toHaveLength(1);
    expect(suppressedQueue.items).toHaveLength(1);
    expect(pendingQueue.items[0].booking_request_id).toBeUndefined();
    expect(
      pendingQueue.items[0].persisted_intent_reference.booking_request_id
    ).toBe(pendingSeed.bookingRequestId);
    expect(blockedQueue.items[0].persisted_intent_reference.booking_request_id)
      .toBe(blockedSeed.bookingRequestId);
    expect(suppressedQueue.items[0]).toMatchObject({
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      dispatch_status: {
        status: TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.suppressed,
        intent_status: TELEGRAM_NOTIFICATION_INTENT_STATUSES.suppressed,
        dispatchable: false,
        reason: 'guest_notifications_suppressed',
      },
      suppression_block_state: {
        state: TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.suppressed,
        suppression_reason: 'guest_notifications_suppressed',
        block_reason: null,
      },
    });

    const combined =
      context.services.notificationDispatchQueueProjectionService
        .listNotificationDispatchQueue({
          dispatch_statuses: [
            TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.suppressed,
            TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.pending,
          ],
        });
    expect(combined.items.map((item) => item.dispatch_status.status)).toEqual([
      TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.pending,
      TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.suppressed,
    ]);
    expect(() =>
      context.services.notificationDispatchQueueProjectionService
        .listNotificationDispatchQueue({ dispatch_statuses: ['sent'] })
    ).toThrow('Unsupported dispatch status');
  });
});
