import {
  freezeTelegramHandoffValue,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPE_NAMES,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PERSISTENCE_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUS_NAMES,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES,
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION,
  TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES,
} from '../../../shared/telegram/index.js';
import { TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL } from './notification-delivery-planning-service.js';

const SERVICE_NAME = 'telegram_notification_delivery_attempt_persistence_service';
const SUPPORTED_NOTIFICATION_TYPES = new Set(TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES);

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeActorType(value) {
  const normalized = normalizeString(value || 'system');
  if (!normalized) {
    throw new Error('[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] actorType is required');
  }

  return normalized;
}

function normalizeActorId(value) {
  return value === null || value === undefined ? null : normalizeString(value);
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] ${label} must be a positive integer`
    );
  }

  return normalized;
}

function sortAttemptValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortAttemptValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortAttemptValue(value[key])])
  );
}

function freezeSortedAttemptValue(value) {
  return freezeTelegramHandoffValue(sortAttemptValue(value));
}

function compareFrozenValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pickDispatchQueueItem(input = {}) {
  if (input?.notification_dispatch_queue_item) return input.notification_dispatch_queue_item;
  if (input?.notificationDispatchQueueItem) return input.notificationDispatchQueueItem;
  if (input?.dispatch_queue_item) return input.dispatch_queue_item;
  if (input?.dispatchQueueItem) return input.dispatchQueueItem;
  if (input?.queue_item) return input.queue_item;
  if (input?.queueItem) return input.queueItem;
  if (input?.item) return input.item;
  if (input?.response_version || input?.queue_item_type) return input;

  return null;
}

function pickDeliveryAttemptStatus(input = {}) {
  return (
    input.delivery_attempt_status ??
    input.deliveryAttemptStatus ??
    input.attempt_status ??
    input.attemptStatus ??
    input.status ??
    input.outcome
  );
}

function normalizeDeliveryAttemptStatus(value) {
  const normalized = normalizeString(value);
  if (!TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUS_NAMES.includes(normalized)) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] Unsupported delivery attempt status: ${normalized || 'unknown'}`
    );
  }

  return normalized;
}

function getEventTypeForAttemptStatus(deliveryAttemptStatus) {
  return TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES[deliveryAttemptStatus];
}

function assertDispatchQueueProjectionItem(queueItem) {
  if (!queueItem || typeof queueItem !== 'object' || Array.isArray(queueItem)) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] notification dispatch queue item is required'
    );
  }
  if (
    queueItem.response_version !== TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION ||
    queueItem.queue_item_type !== TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE ||
    queueItem.read_only !== true ||
    queueItem.projection_only !== true
  ) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] notification dispatch queue projection item is required'
    );
  }
}

function buildDispatchQueueItemReference(queueItem) {
  const persistedIntentReference = freezeSortedAttemptValue(
    queueItem.persisted_intent_reference || {}
  );

  return freezeSortedAttemptValue({
    reference_type: TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
    queue_projection_version: queueItem.response_version,
    notification_type: normalizeString(queueItem.notification_type),
    dispatch_status: queueItem.dispatch_status || null,
    persisted_intent_reference: persistedIntentReference,
    dedupe_key: normalizeString(queueItem.dedupe_key ?? queueItem.idempotency_key),
    idempotency_key: normalizeString(queueItem.idempotency_key ?? queueItem.dedupe_key),
  });
}

function buildAttemptDedupeKey({ normalizedQueueItem, deliveryAttemptStatus }) {
  return [
    'telegram_notification_delivery_attempt',
    `status=${deliveryAttemptStatus}`,
    `intent_event=${normalizedQueueItem.persisted_intent_reference.booking_request_event_id}`,
    `queue=${normalizedQueueItem.queue_item_dedupe_key}`,
  ].join('|');
}

function normalizeAttemptIdempotency({ input, normalizedQueueItem, deliveryAttemptStatus }) {
  const fallbackKey = buildAttemptDedupeKey({ normalizedQueueItem, deliveryAttemptStatus });
  const dedupeKey = normalizeString(
    input.dedupeKey ?? input.dedupe_key ?? input.idempotencyKey ?? input.idempotency_key ?? fallbackKey
  );
  const idempotencyKey = normalizeString(
    input.idempotencyKey ?? input.idempotency_key ?? input.dedupeKey ?? input.dedupe_key ?? fallbackKey
  );

  if (!dedupeKey || !idempotencyKey) {
    throw new Error('[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] dedupe/idempotency key is required');
  }
  if (dedupeKey !== idempotencyKey) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] dedupe and idempotency keys must match'
    );
  }

  return { dedupeKey, idempotencyKey };
}

function pickProviderResultReference(input = {}) {
  return freezeSortedAttemptValue(
    input.provider_result_reference ??
      input.providerResultReference ??
      input.result_reference ??
      input.resultReference ??
      null
  );
}

function pickBlockedReason(input = {}, normalizedQueueItem) {
  const explicitReason = normalizeString(
    input.blockedReason ?? input.blocked_reason ?? input.blockReason ?? input.block_reason
  );
  const queueReason = normalizeString(
    normalizedQueueItem.suppression_block_state?.block_reason ||
      normalizedQueueItem.suppression_block_state?.suppression_reason ||
      normalizedQueueItem.dispatch_status?.reason
  );

  return explicitReason || queueReason || 'delivery_blocked';
}

function pickFailedReason(input = {}) {
  return normalizeString(
    input.failedReason ?? input.failed_reason ?? input.failureReason ?? input.failure_reason
  ) || 'delivery_failed';
}

function assertDispatchStatusSupportsOutcome({
  input,
  normalizedQueueItem,
  deliveryAttemptStatus,
}) {
  const dispatchable = normalizedQueueItem.dispatch_status?.dispatchable === true;
  const explicitBlockReason = normalizeString(
    input.blockedReason ?? input.blocked_reason ?? input.blockReason ?? input.block_reason
  );

  if (deliveryAttemptStatus === TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_blocked) {
    if (!dispatchable || explicitBlockReason) {
      return;
    }

    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] delivery_blocked requires a non-dispatchable queue item or explicit block reason'
    );
  }

  if (!dispatchable) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] ${deliveryAttemptStatus} requires a dispatchable queue item`
    );
  }
}

function buildNoOpGuards() {
  return freezeTelegramHandoffValue({
    telegram_api_called: false,
    telegram_message_sent: false,
    notification_log_row_created: false,
    bot_handlers_invoked: false,
    mini_app_ui_invoked: false,
    seller_owner_admin_ui_invoked: false,
    production_routes_invoked: false,
    money_ledger_written: false,
  });
}

function normalizeDispatchQueueItem(queueItem) {
  assertDispatchQueueProjectionItem(queueItem);

  const notificationType = normalizeString(queueItem.notification_type) || 'unknown';
  if (!SUPPORTED_NOTIFICATION_TYPES.has(notificationType)) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] Unsupported notification type: ${notificationType}`
    );
  }

  const persistedIntentReference = freezeSortedAttemptValue(
    queueItem.persisted_intent_reference || {}
  );
  const bookingRequestId = normalizePositiveInteger(
    persistedIntentReference.booking_request_id,
    'dispatch_queue_item.persisted_intent_reference.booking_request_id'
  );
  const persistedIntentEventId = normalizePositiveInteger(
    persistedIntentReference.booking_request_event_id,
    'dispatch_queue_item.persisted_intent_reference.booking_request_event_id'
  );
  const deliveryTargetSummary = freezeSortedAttemptValue(
    queueItem.delivery_target_summary || {}
  );
  const deliveryTargetBookingRequestId =
    deliveryTargetSummary.booking_request_id === null ||
    deliveryTargetSummary.booking_request_id === undefined
      ? null
      : normalizePositiveInteger(
          deliveryTargetSummary.booking_request_id,
          'dispatch_queue_item.delivery_target_summary.booking_request_id'
        );
  const queueItemDedupeKey = normalizeString(queueItem.dedupe_key ?? queueItem.idempotency_key);
  const queueItemIdempotencyKey = normalizeString(
    queueItem.idempotency_key ?? queueItem.dedupe_key
  );

  if (!queueItemDedupeKey || !queueItemIdempotencyKey) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] dispatch queue item dedupe/idempotency key is required'
    );
  }

  return freezeTelegramHandoffValue({
    notification_type: notificationType,
    booking_request_id: bookingRequestId,
    persisted_intent_event_id: persistedIntentEventId,
    persisted_intent_reference: persistedIntentReference,
    delivery_target_summary: deliveryTargetSummary,
    delivery_target_booking_request_id: deliveryTargetBookingRequestId,
    dispatch_status: freezeSortedAttemptValue(queueItem.dispatch_status || {}),
    suppression_block_state: freezeSortedAttemptValue(queueItem.suppression_block_state || null),
    dispatch_queue_item_reference: buildDispatchQueueItemReference(queueItem),
    queue_item_dedupe_key: queueItemDedupeKey,
    queue_item_idempotency_key: queueItemIdempotencyKey,
  });
}

function normalizeDeliveryAttemptInput(input = {}) {
  const queueItem = pickDispatchQueueItem(input);
  const deliveryAttemptStatus = normalizeDeliveryAttemptStatus(
    pickDeliveryAttemptStatus(input)
  );
  const normalizedQueueItem = normalizeDispatchQueueItem(queueItem);

  assertDispatchStatusSupportsOutcome({
    input,
    normalizedQueueItem,
    deliveryAttemptStatus,
  });

  const { dedupeKey, idempotencyKey } = normalizeAttemptIdempotency({
    input,
    normalizedQueueItem,
    deliveryAttemptStatus,
  });
  const noOpGuards = buildNoOpGuards();
  const blockedReason =
    deliveryAttemptStatus === TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_blocked
      ? pickBlockedReason(input, normalizedQueueItem)
      : null;
  const failedReason =
    deliveryAttemptStatus === TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_failed
      ? pickFailedReason(input)
      : null;
  const providerResultReference = pickProviderResultReference(input);
  const attemptSignature = freezeSortedAttemptValue({
    response_version: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PERSISTENCE_VERSION,
    notification_type: normalizedQueueItem.notification_type,
    delivery_attempt_status: deliveryAttemptStatus,
    delivery_channel: TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
    delivery_target_summary: normalizedQueueItem.delivery_target_summary,
    dispatch_queue_item_reference: normalizedQueueItem.dispatch_queue_item_reference,
    dedupe_key: dedupeKey,
    idempotency_key: idempotencyKey,
    blocked_reason: blockedReason,
    failed_reason: failedReason,
    provider_result_reference: providerResultReference,
    no_op_guards: noOpGuards,
  });

  return freezeTelegramHandoffValue({
    booking_request_id: normalizedQueueItem.booking_request_id,
    persisted_intent_event_id: normalizedQueueItem.persisted_intent_event_id,
    notification_type: normalizedQueueItem.notification_type,
    event_type: getEventTypeForAttemptStatus(deliveryAttemptStatus),
    delivery_attempt_status: deliveryAttemptStatus,
    delivery_channel: TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
    delivery_target_summary: normalizedQueueItem.delivery_target_summary,
    dispatch_queue_item_reference: normalizedQueueItem.dispatch_queue_item_reference,
    dedupe_key: dedupeKey,
    idempotency_key: idempotencyKey,
    blocked_reason: blockedReason,
    failed_reason: failedReason,
    provider_result_reference: providerResultReference,
    no_op_guards: noOpGuards,
    attempt_signature: attemptSignature,
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

function buildResultFromEvent(event) {
  const eventPayload = event.event_payload || {};

  return freezeTelegramHandoffValue({
    response_version:
      eventPayload.response_version ||
      TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PERSISTENCE_VERSION,
    notification_type: eventPayload.notification_type || null,
    delivery_attempt_status: eventPayload.delivery_attempt_status || null,
    persisted_delivery_attempt_reference: buildPersistedDeliveryAttemptReference(event),
    delivery_target_summary: eventPayload.delivery_target_summary || null,
    dedupe_key: eventPayload.dedupe_key || eventPayload.idempotency_key || null,
    idempotency_key: eventPayload.idempotency_key || eventPayload.dedupe_key || null,
    dispatch_queue_item_reference: eventPayload.dispatch_queue_item_reference || null,
    blocked_reason: eventPayload.blocked_reason || null,
    failed_reason: eventPayload.failed_reason || null,
  });
}

export class TelegramNotificationDeliveryAttemptPersistenceService {
  constructor({
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'notification-delivery-attempt-persistence-service',
      status: 'persistence_only_ready',
      dependencyKeys: ['bookingRequests', 'bookingHolds', 'bookingRequestEvents'],
    });
  }

  nowIso() {
    return this.now().toISOString();
  }

  get db() {
    return this.bookingRequests.db;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      throw new Error(
        `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] Booking request not found: ${bookingRequestId}`
      );
    }

    return bookingRequest;
  }

  getPersistedIntentEventOrThrow(normalizedAttempt) {
    const event = this.bookingRequestEvents.getById(normalizedAttempt.persisted_intent_event_id);
    if (
      !event ||
      Number(event.booking_request_id) !== Number(normalizedAttempt.booking_request_id)
    ) {
      throw new Error(
        `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] Dispatch queue item intent reference not found: ${normalizedAttempt.persisted_intent_event_id}`
      );
    }

    return event;
  }

  assertQueueItemMatchesBookingRequest(bookingRequest, normalizedAttempt) {
    const targetGuestProfileId = normalizedAttempt.delivery_target_summary.guest_profile_id;
    if (
      targetGuestProfileId !== null &&
      targetGuestProfileId !== undefined &&
      Number(targetGuestProfileId) !== Number(bookingRequest.guest_profile_id)
    ) {
      throw new Error(
        `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] Delivery target does not match booking request: ${bookingRequest.booking_request_id}`
      );
    }
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  listDeliveryAttemptEvents(bookingRequestId) {
    return this.bookingRequestEvents
      .listBy(
        { booking_request_id: bookingRequestId },
        { orderBy: 'booking_request_event_id ASC', limit: 500 }
      )
      .filter((event) =>
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPE_NAMES.includes(event.event_type)
      );
  }

  resolveIdempotentDeliveryAttemptEvent({
    bookingRequestId,
    idempotencyKey,
    attemptSignature,
  }) {
    const matchingEvents = this.listDeliveryAttemptEvents(bookingRequestId).filter(
      (event) => event.event_payload?.idempotency_key === idempotencyKey
    );
    if (matchingEvents.length === 0) {
      return null;
    }

    const matchingAttemptEvent = matchingEvents.find((event) =>
      compareFrozenValues(event.event_payload?.attempt_signature, attemptSignature)
    );
    if (matchingAttemptEvent) {
      return matchingAttemptEvent;
    }

    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT] Idempotency conflict for booking request: ${bookingRequestId}`
    );
  }

  buildEventPayload(normalizedAttempt) {
    return freezeTelegramHandoffValue({
      response_version: TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PERSISTENCE_VERSION,
      notification_delivery_attempt_source: SERVICE_NAME,
      notification_type: normalizedAttempt.notification_type,
      delivery_attempt_status: normalizedAttempt.delivery_attempt_status,
      delivery_channel: normalizedAttempt.delivery_channel,
      delivery_target_summary: normalizedAttempt.delivery_target_summary,
      dispatch_queue_item_reference: normalizedAttempt.dispatch_queue_item_reference,
      dedupe_key: normalizedAttempt.dedupe_key,
      idempotency_key: normalizedAttempt.idempotency_key,
      blocked_reason: normalizedAttempt.blocked_reason,
      failed_reason: normalizedAttempt.failed_reason,
      provider_result_reference: normalizedAttempt.provider_result_reference,
      persistence_only: true,
      no_op_guards: normalizedAttempt.no_op_guards,
      attempt_signature: normalizedAttempt.attempt_signature,
    });
  }

  appendDeliveryAttemptEvent({ bookingRequest, normalizedAttempt, actorType, actorId }) {
    const bookingHold = this.getHoldForRequest(bookingRequest.booking_request_id);

    return this.bookingRequestEvents.create({
      booking_request_id: bookingRequest.booking_request_id,
      booking_hold_id: bookingHold?.booking_hold_id || null,
      seller_attribution_session_id: bookingRequest.seller_attribution_session_id,
      event_type: normalizedAttempt.event_type,
      event_at: this.nowIso(),
      actor_type: actorType,
      actor_id: actorId,
      event_payload: this.buildEventPayload(normalizedAttempt),
    });
  }

  persistNotificationDeliveryAttempt(input = {}) {
    const runPersistence = () => {
      const normalizedAttempt = normalizeDeliveryAttemptInput(input);
      const actorType = normalizeActorType(input.actorType || input.actor_type || 'system');
      const actorId = normalizeActorId(input.actorId ?? input.actor_id ?? null);
      const bookingRequest = this.getBookingRequestOrThrow(
        normalizedAttempt.booking_request_id
      );

      this.getPersistedIntentEventOrThrow(normalizedAttempt);
      this.assertQueueItemMatchesBookingRequest(bookingRequest, normalizedAttempt);

      const idempotentEvent = this.resolveIdempotentDeliveryAttemptEvent({
        bookingRequestId: normalizedAttempt.booking_request_id,
        idempotencyKey: normalizedAttempt.idempotency_key,
        attemptSignature: normalizedAttempt.attempt_signature,
      });
      if (idempotentEvent) {
        return buildResultFromEvent(idempotentEvent);
      }

      const event = this.appendDeliveryAttemptEvent({
        bookingRequest,
        normalizedAttempt,
        actorType,
        actorId,
      });

      return buildResultFromEvent(event);
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runPersistence)();
    }

    return runPersistence();
  }

  persistDeliveryStarted(input = {}) {
    return this.persistNotificationDeliveryAttempt({
      ...input,
      delivery_attempt_status:
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_started,
    });
  }

  persistDeliveryBlocked(input = {}) {
    return this.persistNotificationDeliveryAttempt({
      ...input,
      delivery_attempt_status:
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_blocked,
    });
  }

  persistDeliveryFailed(input = {}) {
    return this.persistNotificationDeliveryAttempt({
      ...input,
      delivery_attempt_status:
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_failed,
    });
  }

  persistDeliverySent(input = {}) {
    return this.persistNotificationDeliveryAttempt({
      ...input,
      delivery_attempt_status:
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent,
    });
  }
}
