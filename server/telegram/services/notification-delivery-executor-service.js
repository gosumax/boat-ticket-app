import {
  freezeTelegramHandoffValue,
  TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUS_NAMES,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR_VERSION,
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION,
  TELEGRAM_NOTIFICATION_DISPATCH_STATUSES,
  TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES,
} from '../../../shared/telegram/index.js';
import { TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL } from './notification-delivery-planning-service.js';

const SERVICE_NAME = 'telegram_notification_delivery_executor_service';
const DEFAULT_ADAPTER_NAME = 'injected-telegram-notification-delivery-adapter';
const SUPPORTED_NOTIFICATION_TYPES = new Set(TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES);

const EXECUTION_STATUS_TO_ATTEMPT_STATUS = Object.freeze({
  [TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent]:
    TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent,
  [TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked]:
    TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_blocked,
  [TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed]:
    TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_failed,
});

const ATTEMPT_STATUS_TO_EXECUTION_STATUS = Object.freeze(
  Object.fromEntries(
    Object.entries(EXECUTION_STATUS_TO_ATTEMPT_STATUS).map(
      ([executionStatus, attemptStatus]) => [attemptStatus, executionStatus]
    )
  )
);

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeActorType(value) {
  const normalized = normalizeString(value || 'system');
  if (!normalized) {
    throw new Error('[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] actorType is required');
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
      `[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] ${label} must be a positive integer`
    );
  }

  return normalized;
}

function sortExecutorValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortExecutorValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortExecutorValue(value[key])])
  );
}

function freezeSortedExecutorValue(value) {
  return freezeTelegramHandoffValue(sortExecutorValue(value));
}

function pickQueueItem(input = {}) {
  if (Array.isArray(input)) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] exactly one notification queue item is required'
    );
  }

  const queueItem =
    input.notification_dispatch_queue_item ??
    input.notificationDispatchQueueItem ??
    input.dispatch_queue_item ??
    input.dispatchQueueItem ??
    input.queue_item ??
    input.queueItem ??
    input.item ??
    (input.response_version || input.queue_item_type ? input : null);

  if (Array.isArray(queueItem)) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] exactly one notification queue item is required'
    );
  }

  return queueItem;
}

function assertDispatchQueueProjectionItem(queueItem) {
  if (!queueItem || typeof queueItem !== 'object' || Array.isArray(queueItem)) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] notification dispatch queue item is required'
    );
  }

  if (
    queueItem.response_version !== TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION ||
    queueItem.queue_item_type !== TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE ||
    queueItem.read_only !== true ||
    queueItem.projection_only !== true
  ) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] notification dispatch queue projection item is required'
    );
  }
}

function buildDispatchQueueItemReference(queueItem) {
  return freezeSortedExecutorValue({
    reference_type: TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
    queue_projection_version: queueItem.response_version,
    notification_type: normalizeString(queueItem.notification_type),
    dispatch_status: queueItem.dispatch_status || null,
    persisted_intent_reference: queueItem.persisted_intent_reference || null,
    dedupe_key: normalizeString(queueItem.dedupe_key ?? queueItem.idempotency_key),
    idempotency_key: normalizeString(queueItem.idempotency_key ?? queueItem.dedupe_key),
  });
}

function assertReadyDispatchStatus(queueItem) {
  const status = normalizeString(queueItem.dispatch_status?.status);
  if (status === TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.suppressed) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] suppressed notification queue item is not executable'
    );
  }
  if (status === TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.blocked) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] blocked notification queue item is not executable'
    );
  }
  if (
    status !== TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.pending ||
    queueItem.dispatch_status?.dispatchable !== true
  ) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] non-executable notification queue item status: ${status || 'unknown'}`
    );
  }
}

function normalizeExecutableQueueItem(queueItem) {
  assertDispatchQueueProjectionItem(queueItem);

  const notificationType = normalizeString(queueItem.notification_type) || 'unknown';
  if (!SUPPORTED_NOTIFICATION_TYPES.has(notificationType)) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] Unsupported notification type: ${notificationType}`
    );
  }

  assertReadyDispatchStatus(queueItem);

  const persistedIntentReference = freezeSortedExecutorValue(
    queueItem.persisted_intent_reference || {}
  );
  const bookingRequestId = normalizePositiveInteger(
    persistedIntentReference.booking_request_id,
    'queue_item.persisted_intent_reference.booking_request_id'
  );
  const persistedIntentEventId = normalizePositiveInteger(
    persistedIntentReference.booking_request_event_id,
    'queue_item.persisted_intent_reference.booking_request_event_id'
  );
  const deliveryTargetSummary = freezeSortedExecutorValue(
    queueItem.delivery_target_summary || {}
  );
  const telegramUserId = normalizeString(deliveryTargetSummary.telegram_user_id);
  if (!telegramUserId) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] non-executable notification queue item target: missing telegram_user_id'
    );
  }

  const deliveryTargetBookingRequestId =
    deliveryTargetSummary.booking_request_id === null ||
    deliveryTargetSummary.booking_request_id === undefined
      ? null
      : normalizePositiveInteger(
          deliveryTargetSummary.booking_request_id,
          'queue_item.delivery_target_summary.booking_request_id'
        );
  if (
    deliveryTargetBookingRequestId !== null &&
    deliveryTargetBookingRequestId !== bookingRequestId
  ) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] notification queue item target does not match intent reference'
    );
  }

  const dedupeKey = normalizeString(queueItem.dedupe_key ?? queueItem.idempotency_key);
  const idempotencyKey = normalizeString(queueItem.idempotency_key ?? queueItem.dedupe_key);
  if (!dedupeKey || !idempotencyKey) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] notification queue item dedupe/idempotency key is required'
    );
  }
  if (dedupeKey !== idempotencyKey) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] notification queue item dedupe and idempotency keys must match'
    );
  }

  return freezeSortedExecutorValue({
    notification_type: notificationType,
    booking_request_id: bookingRequestId,
    persisted_intent_event_id: persistedIntentEventId,
    persisted_intent_reference: persistedIntentReference,
    dispatch_status: queueItem.dispatch_status || null,
    delivery_target_summary: deliveryTargetSummary,
    resolved_payload_summary_reference:
      queueItem.resolved_payload_summary_reference || null,
    queue_item_reference: buildDispatchQueueItemReference(queueItem),
    dedupe_key: dedupeKey,
    idempotency_key: idempotencyKey,
  });
}

function buildNoOpGuards() {
  return freezeSortedExecutorValue({
    telegram_api_called_by_executor: false,
    telegram_message_sent_by_executor: false,
    notification_log_row_created: false,
    bot_handlers_invoked: false,
    mini_app_ui_invoked: false,
    seller_owner_admin_ui_invoked: false,
    production_routes_invoked: false,
    money_ledger_written: false,
  });
}

function buildAdapterInput(normalizedQueueItem) {
  return freezeSortedExecutorValue({
    adapter_contract_version: TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION,
    delivery_channel: TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
    delivery_target_summary: normalizedQueueItem.delivery_target_summary,
    dedupe_key: normalizedQueueItem.dedupe_key,
    idempotency_key: normalizedQueueItem.idempotency_key,
    no_op_guards: buildNoOpGuards(),
    notification_type: normalizedQueueItem.notification_type,
    queue_item_reference: normalizedQueueItem.queue_item_reference,
    resolved_payload_summary_reference:
      normalizedQueueItem.resolved_payload_summary_reference,
    requested_by: SERVICE_NAME,
  });
}

function getAdapterExecutor(adapter) {
  if (typeof adapter === 'function') {
    return adapter;
  }
  if (typeof adapter?.executeTelegramNotificationDelivery === 'function') {
    return adapter.executeTelegramNotificationDelivery.bind(adapter);
  }
  if (typeof adapter?.deliverNotification === 'function') {
    return adapter.deliverNotification.bind(adapter);
  }
  if (typeof adapter?.execute === 'function') {
    return adapter.execute.bind(adapter);
  }

  return null;
}

function pickAdapterOutcome(rawResult) {
  if (typeof rawResult === 'string') {
    return normalizeString(rawResult);
  }

  return normalizeString(
    rawResult?.outcome ??
      rawResult?.delivery_outcome ??
      rawResult?.deliveryOutcome ??
      rawResult?.status
  );
}

function buildProviderResultReference(rawResult, executionStatus) {
  if (rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)) {
    return freezeSortedExecutorValue(
      rawResult.provider_result_reference ??
        rawResult.providerResultReference ??
        rawResult.result_reference ??
        rawResult.resultReference ??
        {
          adapter_name:
            normalizeString(rawResult.adapter_name ?? rawResult.adapterName) ||
            DEFAULT_ADAPTER_NAME,
          adapter_outcome: executionStatus,
        }
    );
  }

  return freezeSortedExecutorValue({
    adapter_name: DEFAULT_ADAPTER_NAME,
    adapter_outcome: executionStatus,
  });
}

function normalizeAdapterResult(rawResult) {
  if (
    rawResult === null ||
    rawResult === undefined ||
    (typeof rawResult !== 'string' &&
      (typeof rawResult !== 'object' || Array.isArray(rawResult)))
  ) {
    throw new Error(
      '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] injected delivery adapter returned an invalid result'
    );
  }

  const executionStatus = pickAdapterOutcome(rawResult);
  if (!TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUS_NAMES.includes(executionStatus)) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] Unsupported delivery adapter outcome: ${executionStatus || 'unknown'}`
    );
  }

  const blockedReason =
    executionStatus === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked
      ? normalizeString(
          rawResult.blocked_reason ??
            rawResult.blockedReason ??
            rawResult.block_reason ??
            rawResult.blockReason ??
            rawResult.reason ??
            rawResult.message
        ) || 'delivery_blocked'
      : null;
  const failedReason =
    executionStatus === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed
      ? normalizeString(
          rawResult.failed_reason ??
            rawResult.failedReason ??
            rawResult.failure_reason ??
            rawResult.failureReason ??
            rawResult.reason ??
            rawResult.message
        ) || 'delivery_failed'
      : null;

  return freezeSortedExecutorValue({
    execution_status: executionStatus,
    delivery_attempt_status: EXECUTION_STATUS_TO_ATTEMPT_STATUS[executionStatus],
    blocked_reason: blockedReason,
    failed_reason: failedReason,
    provider_result_reference: buildProviderResultReference(rawResult, executionStatus),
  });
}

function buildPersistedAttemptReferenceFromEvent(event) {
  return freezeSortedExecutorValue({
    reference_type: 'telegram_booking_request_event',
    booking_request_event_id: event.booking_request_event_id,
    booking_request_id: event.booking_request_id,
    event_type: event.event_type,
    delivery_attempt_status: event.event_payload?.delivery_attempt_status || null,
  });
}

function buildExecutionResultFromAttemptPayload({
  attemptPayload,
  persistedAttemptReference,
  fallbackQueueItem,
}) {
  const executionStatus =
    ATTEMPT_STATUS_TO_EXECUTION_STATUS[attemptPayload.delivery_attempt_status];
  if (!executionStatus) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] Idempotency key already belongs to unsupported delivery attempt status: ${attemptPayload.delivery_attempt_status || 'unknown'}`
    );
  }

  return freezeSortedExecutorValue({
    response_version: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR_VERSION,
    notification_type:
      normalizeString(attemptPayload.notification_type) ||
      fallbackQueueItem.notification_type,
    execution_status: executionStatus,
    queue_item_reference:
      attemptPayload.dispatch_queue_item_reference ||
      fallbackQueueItem.queue_item_reference,
    delivery_target_summary:
      attemptPayload.delivery_target_summary ||
      fallbackQueueItem.delivery_target_summary,
    dedupe_key:
      normalizeString(attemptPayload.dedupe_key ?? attemptPayload.idempotency_key) ||
      fallbackQueueItem.dedupe_key,
    idempotency_key:
      normalizeString(attemptPayload.idempotency_key ?? attemptPayload.dedupe_key) ||
      fallbackQueueItem.idempotency_key,
    persisted_attempt_reference: persistedAttemptReference,
    blocked_reason: attemptPayload.blocked_reason || null,
    failed_reason: attemptPayload.failed_reason || null,
  });
}

function buildExecutionResultFromPersistenceResult({
  persistenceResult,
  normalizedQueueItem,
}) {
  return buildExecutionResultFromAttemptPayload({
    attemptPayload: {
      notification_type: persistenceResult.notification_type,
      delivery_attempt_status: persistenceResult.delivery_attempt_status,
      dispatch_queue_item_reference:
        persistenceResult.dispatch_queue_item_reference ||
        normalizedQueueItem.queue_item_reference,
      delivery_target_summary:
        persistenceResult.delivery_target_summary ||
        normalizedQueueItem.delivery_target_summary,
      dedupe_key: persistenceResult.dedupe_key,
      idempotency_key: persistenceResult.idempotency_key,
      blocked_reason: persistenceResult.blocked_reason,
      failed_reason: persistenceResult.failed_reason,
    },
    persistedAttemptReference: persistenceResult.persisted_delivery_attempt_reference,
    fallbackQueueItem: normalizedQueueItem,
  });
}

function attemptEventMatchesQueueItem(event, normalizedQueueItem) {
  const payload = event.event_payload || {};
  const intentReference =
    payload.dispatch_queue_item_reference?.persisted_intent_reference || {};

  return (
    normalizeString(payload.notification_type) === normalizedQueueItem.notification_type &&
    Number(intentReference.booking_request_id) ===
      Number(normalizedQueueItem.booking_request_id) &&
    Number(intentReference.booking_request_event_id) ===
      Number(normalizedQueueItem.persisted_intent_event_id) &&
    normalizeString(payload.dedupe_key ?? payload.idempotency_key) ===
      normalizedQueueItem.dedupe_key
  );
}

export class TelegramNotificationDeliveryExecutorService {
  constructor({
    notificationDeliveryAttemptPersistenceService,
    executeTelegramNotificationDelivery = null,
    deliveryAdapter = null,
  }) {
    this.notificationDeliveryAttemptPersistenceService =
      notificationDeliveryAttemptPersistenceService;
    this.deliveryAdapter = executeTelegramNotificationDelivery || deliveryAdapter;
  }

  describe() {
    return Object.freeze({
      serviceName: 'notification-delivery-executor-service',
      status: 'injected_adapter_executor_ready',
      dependencyKeys: ['notificationDeliveryAttemptPersistenceService'],
    });
  }

  resolveIdempotentExecution(normalizedQueueItem) {
    const persistenceService = this.notificationDeliveryAttemptPersistenceService;
    if (typeof persistenceService?.listDeliveryAttemptEvents !== 'function') {
      return null;
    }

    const matchingEvents = persistenceService
      .listDeliveryAttemptEvents(normalizedQueueItem.booking_request_id)
      .filter(
        (event) =>
          event.event_payload?.idempotency_key === normalizedQueueItem.idempotency_key
      );
    if (matchingEvents.length === 0) {
      return null;
    }

    const matchingQueueItemEvents = matchingEvents.filter((event) =>
      attemptEventMatchesQueueItem(event, normalizedQueueItem)
    );
    if (matchingQueueItemEvents.length === 0) {
      throw new Error(
        `[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] Idempotency conflict for notification queue item: ${normalizedQueueItem.idempotency_key}`
      );
    }

    const event = matchingQueueItemEvents[matchingQueueItemEvents.length - 1];
    return buildExecutionResultFromAttemptPayload({
      attemptPayload: event.event_payload || {},
      persistedAttemptReference: buildPersistedAttemptReferenceFromEvent(event),
      fallbackQueueItem: normalizedQueueItem,
    });
  }

  executeNotificationDelivery(input = {}) {
    const queueItem = pickQueueItem(input);
    const normalizedQueueItem = normalizeExecutableQueueItem(queueItem);
    const idempotentResult = this.resolveIdempotentExecution(normalizedQueueItem);
    if (idempotentResult) {
      return idempotentResult;
    }

    const adapterExecutor = getAdapterExecutor(this.deliveryAdapter);
    if (!adapterExecutor) {
      throw new Error(
        '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] injected delivery adapter is required'
      );
    }

    const adapterInput = buildAdapterInput(normalizedQueueItem);
    const rawAdapterResult = adapterExecutor(adapterInput);
    if (rawAdapterResult && typeof rawAdapterResult.then === 'function') {
      throw new Error(
        '[TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR] injected delivery adapter must return a synchronous result'
      );
    }

    const adapterResult = normalizeAdapterResult(rawAdapterResult);
    const actorType = normalizeActorType(input.actorType || input.actor_type || 'system');
    const actorId = normalizeActorId(input.actorId ?? input.actor_id ?? null);
    const persistenceResult =
      this.notificationDeliveryAttemptPersistenceService
        .persistNotificationDeliveryAttempt({
          notification_dispatch_queue_item: queueItem,
          delivery_attempt_status: adapterResult.delivery_attempt_status,
          dedupeKey: normalizedQueueItem.dedupe_key,
          idempotencyKey: normalizedQueueItem.idempotency_key,
          blockedReason: adapterResult.blocked_reason,
          failedReason: adapterResult.failed_reason,
          providerResultReference: adapterResult.provider_result_reference,
          actorType,
          actorId,
        });

    return buildExecutionResultFromPersistenceResult({
      persistenceResult,
      normalizedQueueItem,
    });
  }
}
