import {
  freezeTelegramHandoffValue,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPE_NAMES,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PERSISTENCE_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION_ITEM_TYPE,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUS_NAMES,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_STATES,
  TELEGRAM_NOTIFICATION_DELIVERY_STATE_NAMES,
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION,
  TELEGRAM_NOTIFICATION_DISPATCH_STATUSES,
  TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPE_NAMES,
  TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES,
  TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
  TELEGRAM_NOTIFICATION_INTENT_STATUSES,
  TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES,
} from '../../../shared/telegram/index.js';

const SERVICE_NAME = 'telegram_notification_delivery_attempt_projection_service';
const INTENT_SOURCE = 'telegram_notification_intent_persistence_service';
const ATTEMPT_SOURCE = 'telegram_notification_delivery_attempt_persistence_service';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_SCAN_LIMIT = 1000;
const MAX_SCAN_LIMIT = 2000;
const SUPPORTED_NOTIFICATION_TYPES = new Set(TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES);

const ATTEMPT_STATUS_TO_DELIVERY_STATE = Object.freeze({
  [TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_started]:
    TELEGRAM_NOTIFICATION_DELIVERY_STATES.started,
  [TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_blocked]:
    TELEGRAM_NOTIFICATION_DELIVERY_STATES.blocked,
  [TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_failed]:
    TELEGRAM_NOTIFICATION_DELIVERY_STATES.failed,
  [TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent]:
    TELEGRAM_NOTIFICATION_DELIVERY_STATES.sent,
});

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] ${label} must be a positive integer`
    );
  }

  return normalized;
}

function normalizeLimit(value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function sortProjectionValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortProjectionValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortProjectionValue(value[key])])
  );
}

function freezeSortedProjectionValue(value) {
  return freezeTelegramHandoffValue(sortProjectionValue(value));
}

function normalizeDeliveryState(value) {
  const normalized = normalizeString(value);
  if (normalized === 'no-attempt-yet') {
    return TELEGRAM_NOTIFICATION_DELIVERY_STATES.no_attempt_yet;
  }

  return normalized;
}

function normalizeDeliveryStates(value) {
  const rawStates = value === undefined || value === null
    ? TELEGRAM_NOTIFICATION_DELIVERY_STATE_NAMES
    : Array.isArray(value)
      ? value
      : [value];
  const normalizedStates = rawStates.map(normalizeDeliveryState).filter(Boolean);
  const unsupportedStates = normalizedStates.filter(
    (state) => !TELEGRAM_NOTIFICATION_DELIVERY_STATE_NAMES.includes(state)
  );

  if (unsupportedStates.length > 0) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Unsupported delivery state: ${unsupportedStates[0]}`
    );
  }

  return new Set(
    normalizedStates.length > 0
      ? normalizedStates
      : TELEGRAM_NOTIFICATION_DELIVERY_STATE_NAMES
  );
}

function normalizeNotificationTypes(value) {
  const rawTypes = value === undefined || value === null
    ? TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES
    : Array.isArray(value)
      ? value
      : [value];
  const normalizedTypes = rawTypes.map(normalizeString).filter(Boolean);
  const unsupportedTypes = normalizedTypes.filter(
    (notificationType) => !SUPPORTED_NOTIFICATION_TYPES.has(notificationType)
  );

  if (unsupportedTypes.length > 0) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Unsupported notification type: ${unsupportedTypes[0]}`
    );
  }

  return new Set(
    normalizedTypes.length > 0
      ? normalizedTypes
      : TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES
  );
}

function pickDeliveryStates(input = {}) {
  return (
    input.delivery_states ??
    input.deliveryStates ??
    input.delivery_state ??
    input.deliveryState ??
    input.states ??
    input.state
  );
}

function pickNotificationTypes(input = {}) {
  return (
    input.notification_types ??
    input.notificationTypes ??
    input.notification_type ??
    input.notificationType ??
    input.types ??
    input.type
  );
}

function pickPersistedIntentEventId(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return normalizePositiveInteger(input, 'notification item reference');
  }

  const directValue =
    input.booking_request_event_id ??
    input.bookingRequestEventId ??
    input.intent_event_id ??
    input.intentEventId ??
    input.persisted_intent_event_id ??
    input.persistedIntentEventId;

  if (directValue !== undefined && directValue !== null) {
    return normalizePositiveInteger(directValue, 'notification item reference');
  }

  const reference =
    input.persisted_intent_reference ??
    input.persistedIntentReference ??
    input.notification_item_reference ??
    input.notificationItemReference ??
    input.notification_item?.persisted_intent_reference ??
    input.notificationItem?.persisted_intent_reference ??
    input.notificationItem?.persistedIntentReference ??
    input.dispatch_queue_item_reference?.persisted_intent_reference ??
    input.dispatchQueueItemReference?.persisted_intent_reference ??
    input.dispatchQueueItemReference?.persistedIntentReference ??
    input.dispatch_queue_item?.persisted_intent_reference ??
    input.dispatchQueueItem?.persisted_intent_reference ??
    input.dispatchQueueItem?.persistedIntentReference;

  if (!reference?.booking_request_event_id) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] notification item reference is required'
    );
  }

  return normalizePositiveInteger(
    reference.booking_request_event_id,
    'notification item reference'
  );
}

function buildPersistedIntentReference(event) {
  return freezeTelegramHandoffValue({
    reference_type: 'telegram_booking_request_event',
    booking_request_event_id: event.booking_request_event_id,
    booking_request_id: event.booking_request_id,
    event_type: event.event_type,
  });
}

function buildPersistedDeliveryAttemptReference(event) {
  return freezeTelegramHandoffValue({
    reference_type: 'telegram_booking_request_event',
    booking_request_event_id: event.booking_request_event_id,
    booking_request_id: event.booking_request_id,
    event_type: event.event_type,
    delivery_attempt_status: event.event_payload?.delivery_attempt_status || null,
  });
}

function buildNoOpGuards() {
  return freezeTelegramHandoffValue({
    telegram_api_called: false,
    telegram_message_sent: false,
    delivery_attempt_row_created: false,
    notification_log_row_created: false,
    bot_handlers_invoked: false,
    mini_app_ui_invoked: false,
    seller_owner_admin_ui_invoked: false,
    production_routes_invoked: false,
    money_ledger_written: false,
  });
}

function buildSuppressionBlockState(payload) {
  const sendDecision = payload.send_decision || {};
  const safeBlockReasons = Array.isArray(sendDecision.safe_block_reasons)
    ? sendDecision.safe_block_reasons
    : [];
  const suppressionReason = normalizeString(payload.suppression_reason);
  const blockReason = normalizeString(payload.block_reason);
  const hasSuppression = Boolean(suppressionReason);
  const hasBlock =
    Boolean(blockReason) ||
    safeBlockReasons.length > 0 ||
    sendDecision.send_allowed === false ||
    sendDecision.should_send === false;

  if (!hasSuppression && !hasBlock) {
    return null;
  }

  return freezeTelegramHandoffValue({
    state: hasBlock
      ? TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.blocked
      : TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.suppressed,
    suppression_reason: suppressionReason,
    block_reason: blockReason,
    safe_block_reasons: safeBlockReasons,
    send_allowed: sendDecision.send_allowed ?? null,
    should_send: sendDecision.should_send ?? null,
  });
}

function buildDispatchStatusProjection(payload, suppressionBlockState) {
  const intentStatus = normalizeString(payload.intent_status);
  const suppressionReason = normalizeString(payload.suppression_reason);
  const blockReason = normalizeString(payload.block_reason);
  const status = suppressionBlockState?.state ||
    (intentStatus === TELEGRAM_NOTIFICATION_INTENT_STATUSES.created
      ? TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.pending
      : TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.suppressed);

  return freezeTelegramHandoffValue({
    status,
    intent_status: intentStatus,
    dispatchable: status === TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.pending,
    delivery_attempt_state: 'not_attempted',
    projected_from: 'persisted_notification_intent',
    reason: blockReason || suppressionReason,
  });
}

function buildDispatchQueueItemFromIntentEvent(event) {
  const payload = event.event_payload || {};
  const suppressionBlockState = buildSuppressionBlockState(payload);

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION,
    queue_item_type: TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
    notification_type: payload.notification_type || null,
    dispatch_status: buildDispatchStatusProjection(payload, suppressionBlockState),
    persisted_intent_reference: buildPersistedIntentReference(event),
    delivery_target_summary: payload.delivery_target_summary || null,
    dedupe_key: payload.dedupe_key || payload.idempotency_key || null,
    idempotency_key: payload.idempotency_key || payload.dedupe_key || null,
    suppression_block_state: suppressionBlockState,
  });
}

function buildDispatchQueueItemReference(queueItem) {
  return freezeSortedProjectionValue({
    reference_type: TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
    queue_projection_version: queueItem.response_version,
    notification_type: normalizeString(queueItem.notification_type),
    dispatch_status: queueItem.dispatch_status || null,
    persisted_intent_reference: queueItem.persisted_intent_reference || null,
    dedupe_key: normalizeString(queueItem.dedupe_key ?? queueItem.idempotency_key),
    idempotency_key: normalizeString(queueItem.idempotency_key ?? queueItem.dedupe_key),
  });
}

function getDeliveryStateForAttemptStatus(deliveryAttemptStatus) {
  const deliveryState = ATTEMPT_STATUS_TO_DELIVERY_STATE[deliveryAttemptStatus];
  if (!deliveryState) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Unsupported delivery attempt status: ${deliveryAttemptStatus || 'unknown'}`
    );
  }

  return deliveryState;
}

function getExpectedIntentEventType(intentStatus) {
  if (intentStatus === TELEGRAM_NOTIFICATION_INTENT_STATUSES.created) {
    return TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES.created;
  }
  if (intentStatus === TELEGRAM_NOTIFICATION_INTENT_STATUSES.suppressed) {
    return TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES.suppressed;
  }

  return null;
}

function assertProjectablePersistedIntentEvent(event) {
  if (!event) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Notification item not found'
    );
  }
  if (!TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPE_NAMES.includes(event.event_type)) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Event is not a notification intent: ${event.event_type || 'unknown'}`
    );
  }

  const payload = event.event_payload || {};
  if (
    payload.response_version !== TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION ||
    payload.notification_intent_source !== INTENT_SOURCE
  ) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Notification intent event is not projectable: ${event.booking_request_event_id}`
    );
  }

  const notificationType = normalizeString(payload.notification_type);
  if (!SUPPORTED_NOTIFICATION_TYPES.has(notificationType)) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Unsupported notification type: ${notificationType || 'unknown'}`
    );
  }

  const intentStatus = normalizeString(payload.intent_status);
  const expectedEventType = getExpectedIntentEventType(intentStatus);
  if (!expectedEventType || event.event_type !== expectedEventType) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Invalid notification intent status: ${intentStatus || 'unknown'}`
    );
  }

  const dedupeKey = normalizeString(payload.dedupe_key ?? payload.idempotency_key);
  const idempotencyKey = normalizeString(payload.idempotency_key ?? payload.dedupe_key);
  if (!dedupeKey || !idempotencyKey || dedupeKey !== idempotencyKey) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Notification item dedupe/idempotency key is invalid: ${event.booking_request_event_id}`
    );
  }

  if (!payload.delivery_target_summary || typeof payload.delivery_target_summary !== 'object') {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Notification item delivery target summary is required: ${event.booking_request_event_id}`
    );
  }

  return true;
}

function assertProjectableDeliveryAttemptEvent(event) {
  if (!TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPE_NAMES.includes(event?.event_type)) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Event is not a delivery attempt: ${event?.event_type || 'unknown'}`
    );
  }

  const payload = event.event_payload || {};
  if (
    payload.response_version !== TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PERSISTENCE_VERSION ||
    payload.notification_delivery_attempt_source !== ATTEMPT_SOURCE
  ) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Delivery attempt event is not projectable: ${event.booking_request_event_id}`
    );
  }

  const notificationType = normalizeString(payload.notification_type);
  if (!SUPPORTED_NOTIFICATION_TYPES.has(notificationType)) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Unsupported notification type: ${notificationType || 'unknown'}`
    );
  }

  const deliveryAttemptStatus = normalizeString(payload.delivery_attempt_status);
  if (!TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUS_NAMES.includes(deliveryAttemptStatus)) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Unsupported delivery attempt status: ${deliveryAttemptStatus || 'unknown'}`
    );
  }

  if (event.event_type !== TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES[deliveryAttemptStatus]) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Delivery attempt event type does not match status: ${event.booking_request_event_id}`
    );
  }

  const dispatchQueueItemReference = payload.dispatch_queue_item_reference || {};
  if (
    dispatchQueueItemReference.reference_type !== TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE ||
    dispatchQueueItemReference.queue_projection_version !==
      TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION
  ) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Delivery attempt dispatch queue item reference is invalid: ${event.booking_request_event_id}`
    );
  }

  const persistedIntentReference =
    dispatchQueueItemReference.persisted_intent_reference || {};
  const persistedIntentEventId = normalizePositiveInteger(
    persistedIntentReference.booking_request_event_id,
    'delivery_attempt.dispatch_queue_item_reference.persisted_intent_reference.booking_request_event_id'
  );
  const persistedIntentBookingRequestId = normalizePositiveInteger(
    persistedIntentReference.booking_request_id,
    'delivery_attempt.dispatch_queue_item_reference.persisted_intent_reference.booking_request_id'
  );

  if (Number(persistedIntentBookingRequestId) !== Number(event.booking_request_id)) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Delivery attempt booking request reference mismatch: ${event.booking_request_event_id}`
    );
  }

  if (
    dispatchQueueItemReference.notification_type &&
    dispatchQueueItemReference.notification_type !== notificationType
  ) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Delivery attempt notification type mismatch: ${event.booking_request_event_id}`
    );
  }

  return {
    persistedIntentEventId,
  };
}

function buildLatestAttemptResult(event) {
  const payload = event.event_payload || {};

  return freezeTelegramHandoffValue({
    response_version:
      payload.response_version || TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PERSISTENCE_VERSION,
    notification_type: payload.notification_type || null,
    delivery_attempt_status: payload.delivery_attempt_status || null,
    persisted_delivery_attempt_reference: buildPersistedDeliveryAttemptReference(event),
    delivery_target_summary: payload.delivery_target_summary || null,
    dedupe_key: payload.dedupe_key || payload.idempotency_key || null,
    idempotency_key: payload.idempotency_key || payload.dedupe_key || null,
    dispatch_queue_item_reference: payload.dispatch_queue_item_reference || null,
    blocked_reason: payload.blocked_reason || null,
    failed_reason: payload.failed_reason || null,
    provider_result_reference: payload.provider_result_reference || null,
  });
}

function assertAttemptResultMatchesIntent({ latestAttemptResult, intentEvent }) {
  if (!latestAttemptResult) {
    return;
  }

  const intentPayload = intentEvent.event_payload || {};
  if (latestAttemptResult.notification_type !== intentPayload.notification_type) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Delivery attempt does not match notification item type: ${intentEvent.booking_request_event_id}`
    );
  }

  const persistedIntentReference =
    latestAttemptResult.dispatch_queue_item_reference?.persisted_intent_reference || {};
  if (
    Number(persistedIntentReference.booking_request_event_id) !==
    Number(intentEvent.booking_request_event_id)
  ) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION] Delivery attempt does not reference notification item: ${intentEvent.booking_request_event_id}`
    );
  }
}

function getBlockedReason({ deliveryState, latestAttemptResult, queueItem }) {
  if (deliveryState === TELEGRAM_NOTIFICATION_DELIVERY_STATES.blocked) {
    return (
      latestAttemptResult?.blocked_reason ||
      queueItem.dispatch_status?.reason ||
      queueItem.suppression_block_state?.block_reason ||
      queueItem.suppression_block_state?.suppression_reason ||
      'delivery_blocked'
    );
  }

  if (queueItem.dispatch_status?.status === TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.blocked) {
    return (
      queueItem.dispatch_status.reason ||
      queueItem.suppression_block_state?.block_reason ||
      queueItem.suppression_block_state?.suppression_reason ||
      null
    );
  }

  return null;
}

function getFailedReason({ deliveryState, latestAttemptResult }) {
  if (deliveryState !== TELEGRAM_NOTIFICATION_DELIVERY_STATES.failed) {
    return null;
  }

  return latestAttemptResult?.failed_reason || 'delivery_failed';
}

function buildNotificationDeliveryProjectionItem({ intentEvent, latestAttemptEvent }) {
  assertProjectablePersistedIntentEvent(intentEvent);
  if (latestAttemptEvent) {
    assertProjectableDeliveryAttemptEvent(latestAttemptEvent);
  }

  const payload = intentEvent.event_payload || {};
  const queueItem = buildDispatchQueueItemFromIntentEvent(intentEvent);
  const latestAttemptResult = latestAttemptEvent
    ? buildLatestAttemptResult(latestAttemptEvent)
    : null;
  assertAttemptResultMatchesIntent({ latestAttemptResult, intentEvent });

  const deliveryState = latestAttemptResult
    ? getDeliveryStateForAttemptStatus(latestAttemptResult.delivery_attempt_status)
    : TELEGRAM_NOTIFICATION_DELIVERY_STATES.no_attempt_yet;
  const dispatchQueueItemReference =
    latestAttemptResult?.dispatch_queue_item_reference ||
    buildDispatchQueueItemReference(queueItem);
  const latestAttemptEventReference =
    latestAttemptResult?.persisted_delivery_attempt_reference || null;

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION_VERSION,
    projection_item_type: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION_ITEM_TYPE,
    notification_type: payload.notification_type,
    intent_status: payload.intent_status || null,
    delivery_state: deliveryState,
    latest_attempt_status: latestAttemptResult?.delivery_attempt_status || null,
    latest_attempt_event_reference: latestAttemptEventReference,
    notification_item_reference: queueItem.persisted_intent_reference,
    persisted_intent_reference: queueItem.persisted_intent_reference,
    dispatch_queue_item_reference: dispatchQueueItemReference,
    delivery_target_summary:
      latestAttemptResult?.delivery_target_summary || queueItem.delivery_target_summary,
    dedupe_key: queueItem.dedupe_key,
    idempotency_key: queueItem.idempotency_key,
    latest_attempt_dedupe_key: latestAttemptResult?.dedupe_key || null,
    latest_attempt_idempotency_key: latestAttemptResult?.idempotency_key || null,
    blocked_reason: getBlockedReason({ deliveryState, latestAttemptResult, queueItem }),
    failed_reason: getFailedReason({ deliveryState, latestAttemptResult }),
    latest_persisted_delivery_attempt_result: latestAttemptResult,
    read_only: true,
    projection_only: true,
    projected_by: SERVICE_NAME,
    no_op_guards: buildNoOpGuards(),
  });
}

export class TelegramNotificationDeliveryAttemptProjectionService {
  constructor({ bookingRequestEvents }) {
    this.bookingRequestEvents = bookingRequestEvents;
  }

  describe() {
    return Object.freeze({
      serviceName: 'notification-delivery-attempt-projection-service',
      status: 'read_only_delivery_attempt_projection_ready',
      dependencyKeys: ['bookingRequestEvents'],
    });
  }

  get db() {
    return this.bookingRequestEvents.db;
  }

  listEventsByTypes(eventTypes, { bookingRequestId = null, scanLimit = DEFAULT_SCAN_LIMIT } = {}) {
    this.bookingRequestEvents.assertReady();
    const normalizedScanLimit = normalizeLimit(scanLimit, DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT);
    const placeholders = eventTypes.map(() => '?').join(', ');
    const { tableName, idColumn } = this.bookingRequestEvents;
    const bookingRequestPredicate = bookingRequestId ? 'booking_request_id = ? AND' : '';
    const statement = this.db.prepare(
      `
        SELECT *
        FROM ${tableName}
        WHERE ${bookingRequestPredicate} event_type IN (${placeholders})
        ORDER BY ${idColumn} ASC
        LIMIT ?
      `
    );
    const args = bookingRequestId
      ? [bookingRequestId, ...eventTypes, normalizedScanLimit]
      : [...eventTypes, normalizedScanLimit];

    return statement
      .all(...args)
      .map((row) => this.bookingRequestEvents.deserializeRow(row));
  }

  listPersistedIntentEvents({ scanLimit = DEFAULT_SCAN_LIMIT } = {}) {
    return this.listEventsByTypes(TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPE_NAMES, {
      scanLimit,
    });
  }

  listDeliveryAttemptEvents({ bookingRequestId = null, scanLimit = DEFAULT_SCAN_LIMIT } = {}) {
    return this.listEventsByTypes(TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPE_NAMES, {
      bookingRequestId,
      scanLimit,
    });
  }

  buildLatestAttemptsByIntentEventId(attemptEvents) {
    const latestAttemptsByIntentEventId = new Map();

    for (const event of attemptEvents) {
      const { persistedIntentEventId } = assertProjectableDeliveryAttemptEvent(event);
      const previousEvent = latestAttemptsByIntentEventId.get(persistedIntentEventId);
      if (
        !previousEvent ||
        Number(event.booking_request_event_id) >
          Number(previousEvent.booking_request_event_id)
      ) {
        latestAttemptsByIntentEventId.set(persistedIntentEventId, event);
      }
    }

    return latestAttemptsByIntentEventId;
  }

  listNotificationItemsWithLatestDeliveryAttemptState(input = {}) {
    const normalizedLimit = normalizeLimit(input.limit);
    const notificationTypes = normalizeNotificationTypes(pickNotificationTypes(input));
    const deliveryStates = normalizeDeliveryStates(pickDeliveryStates(input));
    const latestAttemptsByIntentEventId = this.buildLatestAttemptsByIntentEventId(
      this.listDeliveryAttemptEvents({
        scanLimit: input.attemptScanLimit ?? input.attempt_scan_limit ?? input.scanLimit ?? input.scan_limit,
      })
    );
    const items = [];

    for (const intentEvent of this.listPersistedIntentEvents({
      scanLimit: input.scanLimit ?? input.scan_limit,
    })) {
      const item = buildNotificationDeliveryProjectionItem({
        intentEvent,
        latestAttemptEvent:
          latestAttemptsByIntentEventId.get(intentEvent.booking_request_event_id) || null,
      });

      if (!notificationTypes.has(item.notification_type)) {
        continue;
      }
      if (!deliveryStates.has(item.delivery_state)) {
        continue;
      }

      items.push(item);
      if (items.length >= normalizedLimit) {
        break;
      }
    }

    return freezeTelegramHandoffValue({
      response_version: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION_VERSION,
      read_only: true,
      projection_only: true,
      source: 'persisted_notification_intents_and_delivery_attempt_events',
      filters: {
        notification_types: [...notificationTypes],
        delivery_states: [...deliveryStates],
      },
      items,
      item_count: items.length,
      no_op_guards: buildNoOpGuards(),
    });
  }

  readNotificationItemWithLatestDeliveryAttemptResult(input = {}) {
    const intentEventId = pickPersistedIntentEventId(input);
    const intentEvent = this.bookingRequestEvents.getById(intentEventId);
    assertProjectablePersistedIntentEvent(intentEvent);

    const latestAttemptsByIntentEventId = this.buildLatestAttemptsByIntentEventId(
      this.listDeliveryAttemptEvents({
        bookingRequestId: intentEvent.booking_request_id,
        scanLimit: input.attemptScanLimit ?? input.attempt_scan_limit ?? input.scanLimit ?? input.scan_limit,
      })
    );

    return buildNotificationDeliveryProjectionItem({
      intentEvent,
      latestAttemptEvent: latestAttemptsByIntentEventId.get(intentEventId) || null,
    });
  }

  listNotificationItems(input = {}) {
    return this.listNotificationItemsWithLatestDeliveryAttemptState(input);
  }

  listNotificationDeliveryAttemptProjections(input = {}) {
    return this.listNotificationItemsWithLatestDeliveryAttemptState(input);
  }

  listDeliveryAttemptProjections(input = {}) {
    return this.listNotificationItemsWithLatestDeliveryAttemptState(input);
  }

  listNotificationDeliveryStates(input = {}) {
    return this.listNotificationItemsWithLatestDeliveryAttemptState(input);
  }

  readNotificationItem(input = {}) {
    return this.readNotificationItemWithLatestDeliveryAttemptResult(input);
  }

  readNotificationDeliveryAttemptProjection(input = {}) {
    return this.readNotificationItemWithLatestDeliveryAttemptResult(input);
  }

  readDeliveryAttemptProjection(input = {}) {
    return this.readNotificationItemWithLatestDeliveryAttemptResult(input);
  }

  readNotificationDeliveryState(input = {}) {
    return this.readNotificationItemWithLatestDeliveryAttemptResult(input);
  }
}
