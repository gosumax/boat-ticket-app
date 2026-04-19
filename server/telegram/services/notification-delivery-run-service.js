import {
  freezeTelegramHandoffValue,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_RUN_BATCH_RESULT_TYPE,
  TELEGRAM_NOTIFICATION_DELIVERY_RUN_RESULT_TYPE,
  TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS,
  TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_RUN_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_STATES,
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION,
  TELEGRAM_NOTIFICATION_DISPATCH_STATUSES,
  TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES,
} from '../../../shared/telegram/index.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SUPPORTED_NOTIFICATION_TYPES = new Set(TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES);

const DELIVERY_STATE_TO_EXECUTION_STATUS = Object.freeze({
  [TELEGRAM_NOTIFICATION_DELIVERY_STATES.sent]:
    TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
  [TELEGRAM_NOTIFICATION_DELIVERY_STATES.blocked]:
    TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
  [TELEGRAM_NOTIFICATION_DELIVERY_STATES.failed]:
    TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
});

const ATTEMPT_STATUS_TO_EXECUTION_STATUS = Object.freeze({
  [TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent]:
    TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
  [TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_blocked]:
    TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
  [TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_failed]:
    TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
});

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeLimit(value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function sortRunValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortRunValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortRunValue(value[key])])
  );
}

function freezeSortedRunValue(value) {
  return freezeTelegramHandoffValue(sortRunValue(value));
}

function pickQueueItem(input = {}) {
  if (Array.isArray(input)) {
    return null;
  }

  return (
    input.notification_dispatch_queue_item ??
    input.notificationDispatchQueueItem ??
    input.dispatch_queue_item ??
    input.dispatchQueueItem ??
    input.queue_item ??
    input.queueItem ??
    input.item ??
    (input.response_version || input.queue_item_type ? input : null)
  );
}

function pickQueueItems(input = {}) {
  if (Array.isArray(input)) {
    return input;
  }

  const items =
    input.notification_dispatch_queue_items ??
    input.notificationDispatchQueueItems ??
    input.dispatch_queue_items ??
    input.dispatchQueueItems ??
    input.queue_items ??
    input.queueItems ??
    input.items;

  if (items === undefined || items === null) {
    return null;
  }

  return Array.isArray(items) ? items : [items];
}

function pickPersistedIntentEventId(input = {}) {
  const directValue =
    input.booking_request_event_id ??
    input.bookingRequestEventId ??
    input.intent_event_id ??
    input.intentEventId ??
    input.persisted_intent_event_id ??
    input.persistedIntentEventId;
  if (directValue !== undefined && directValue !== null) {
    return Number(directValue);
  }

  const reference =
    input.persisted_intent_reference ??
    input.persistedIntentReference ??
    input.notification_item_reference ??
    input.notificationItemReference ??
    input.dispatch_queue_item_reference?.persisted_intent_reference ??
    input.dispatchQueueItemReference?.persisted_intent_reference ??
    input.dispatchQueueItemReference?.persistedIntentReference;

  return reference?.booking_request_event_id
    ? Number(reference.booking_request_event_id)
    : null;
}

function pickDedupeKey(input = {}) {
  return normalizeString(
    input.dedupe_key ??
      input.dedupeKey ??
      input.idempotency_key ??
      input.idempotencyKey
  );
}

function isDispatchQueueProjectionItem(queueItem) {
  return (
    queueItem &&
    typeof queueItem === 'object' &&
    !Array.isArray(queueItem) &&
    queueItem.response_version === TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION &&
    queueItem.queue_item_type === TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE &&
    queueItem.read_only === true &&
    queueItem.projection_only === true
  );
}

function buildDispatchQueueItemReference(queueItem) {
  if (!queueItem || typeof queueItem !== 'object' || Array.isArray(queueItem)) {
    return null;
  }

  return freezeSortedRunValue({
    reference_type:
      queueItem.queue_item_type || TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
    queue_projection_version: queueItem.response_version || null,
    notification_type: normalizeString(queueItem.notification_type),
    dispatch_status: queueItem.dispatch_status || null,
    persisted_intent_reference: queueItem.persisted_intent_reference || null,
    dedupe_key: normalizeString(queueItem.dedupe_key ?? queueItem.idempotency_key),
    idempotency_key: normalizeString(queueItem.idempotency_key ?? queueItem.dedupe_key),
  });
}

function getBlockedReasonFromQueueItem(queueItem) {
  return (
    normalizeString(queueItem?.dispatch_status?.reason) ||
    normalizeString(queueItem?.suppression_block_state?.block_reason) ||
    normalizeString(queueItem?.suppression_block_state?.suppression_reason) ||
    null
  );
}

function executionStatusToRunStatus(executionStatus) {
  if (executionStatus === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent) {
    return TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.sent;
  }
  if (executionStatus === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked) {
    return TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.blocked;
  }
  if (executionStatus === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed) {
    return TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.failed;
  }

  return TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.failed;
}

function buildExecutionSummaryFromResult(executionResult) {
  if (!executionResult) {
    return null;
  }

  return freezeSortedRunValue({
    response_version:
      executionResult.response_version || TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR_VERSION,
    execution_status: executionResult.execution_status || null,
    delivery_attempt_status:
      executionResult.persisted_attempt_reference?.delivery_attempt_status || null,
    persisted_attempt_reference: executionResult.persisted_attempt_reference || null,
    blocked_reason: executionResult.blocked_reason || null,
    failed_reason: executionResult.failed_reason || null,
  });
}

function buildExecutionSummaryFromProjection(projection) {
  if (!projection) {
    return null;
  }

  return freezeSortedRunValue({
    response_version: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR_VERSION,
    execution_status:
      DELIVERY_STATE_TO_EXECUTION_STATUS[projection.delivery_state] ||
      ATTEMPT_STATUS_TO_EXECUTION_STATUS[projection.latest_attempt_status] ||
      null,
    delivery_attempt_status: projection.latest_attempt_status || null,
    persisted_attempt_reference: projection.latest_attempt_event_reference || null,
    blocked_reason: projection.blocked_reason || null,
    failed_reason: projection.failed_reason || null,
  });
}

function buildRunResult({
  queueItem = null,
  runStatus,
  executionResultSummary = null,
  persistedAttemptReference = null,
  skipReason = null,
  blockedReason = null,
  failedReason = null,
}) {
  const executionStatus = executionResultSummary?.execution_status || null;

  return freezeSortedRunValue({
    response_version: TELEGRAM_NOTIFICATION_DELIVERY_RUN_VERSION,
    run_result_type: TELEGRAM_NOTIFICATION_DELIVERY_RUN_RESULT_TYPE,
    notification_type:
      normalizeString(queueItem?.notification_type) ||
      executionResultSummary?.notification_type ||
      null,
    run_status: runStatus,
    queue_item_reference: buildDispatchQueueItemReference(queueItem),
    delivery_target_summary:
      queueItem?.delivery_target_summary ||
      executionResultSummary?.delivery_target_summary ||
      null,
    dedupe_key: normalizeString(queueItem?.dedupe_key ?? queueItem?.idempotency_key),
    idempotency_key: normalizeString(queueItem?.idempotency_key ?? queueItem?.dedupe_key),
    execution_result_summary: executionResultSummary,
    persisted_attempt_reference:
      persistedAttemptReference ||
      executionResultSummary?.persisted_attempt_reference ||
      null,
    blocked_reason:
      blockedReason ||
      executionResultSummary?.blocked_reason ||
      (executionStatus === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked
        ? 'delivery_blocked'
        : null),
    failed_reason:
      failedReason ||
      executionResultSummary?.failed_reason ||
      (executionStatus === TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed
        ? 'delivery_failed'
        : null),
    skip_reason: skipReason,
  });
}

function buildSkippedResult({
  queueItem,
  skipReason,
  blockedReason = null,
  failedReason = null,
  executionResultSummary = null,
}) {
  return buildRunResult({
    queueItem,
    runStatus: TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.skipped,
    executionResultSummary,
    skipReason,
    blockedReason,
    failedReason,
  });
}

function buildCounters(results) {
  const counters = {
    total: results.length,
    processed: 0,
    skipped: 0,
    sent: 0,
    blocked: 0,
    failed: 0,
    invalid: 0,
    suppressed: 0,
    blocked_skipped: 0,
    non_executable: 0,
    delivery_already_started: 0,
    already_fully_resolved: 0,
  };

  for (const result of results) {
    if (result.run_status === TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.skipped) {
      counters.skipped += 1;
      if (result.skip_reason === TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.blocked) {
        counters.blocked_skipped += 1;
      } else if (result.skip_reason && counters[result.skip_reason] !== undefined) {
        counters[result.skip_reason] += 1;
      }
      continue;
    }

    counters.processed += 1;
    if (counters[result.run_status] !== undefined) {
      counters[result.run_status] += 1;
    }
  }

  return freezeSortedRunValue(counters);
}

function isExecutorValidationError(error) {
  const message = String(error?.message || '');

  return (
    message.includes('notification dispatch queue') ||
    message.includes('Unsupported notification type') ||
    message.includes('non-executable notification queue item') ||
    message.includes('dedupe') ||
    message.includes('idempotency') ||
    message.includes('telegram_user_id') ||
    message.includes('must be a positive integer')
  );
}

export class TelegramNotificationDeliveryRunService {
  constructor({
    notificationDispatchQueueProjectionService,
    notificationDeliveryExecutorService,
    notificationDeliveryAttemptProjectionService = null,
  }) {
    this.notificationDispatchQueueProjectionService =
      notificationDispatchQueueProjectionService;
    this.notificationDeliveryExecutorService = notificationDeliveryExecutorService;
    this.notificationDeliveryAttemptProjectionService =
      notificationDeliveryAttemptProjectionService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'notification-delivery-run-service',
      status: 'queue_backed_delivery_run_ready',
      dependencyKeys: [
        'notificationDispatchQueueProjectionService',
        'notificationDeliveryExecutorService',
        'notificationDeliveryAttemptProjectionService',
      ],
    });
  }

  findSelectedQueueItem(input = {}) {
    const intentEventId = pickPersistedIntentEventId(input);
    const dedupeKey = pickDedupeKey(input);
    if (!intentEventId && !dedupeKey) {
      return null;
    }

    const queue =
      this.notificationDispatchQueueProjectionService
        .listNotificationDispatchQueue({
          dispatch_statuses: [
            TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.pending,
            TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.blocked,
            TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.suppressed,
          ],
          limit: input.limit,
          scanLimit: input.scanLimit ?? input.scan_limit,
        });

    return queue.items.find((item) => {
      const itemIntentEventId =
        item.persisted_intent_reference?.booking_request_event_id;
      const itemDedupeKey = normalizeString(item.dedupe_key ?? item.idempotency_key);

      return (
        (intentEventId && Number(itemIntentEventId) === Number(intentEventId)) ||
        (dedupeKey && itemDedupeKey === dedupeKey)
      );
    }) || null;
  }

  resolveSelectedQueueItem(input = {}) {
    const selectedQueueItem = pickQueueItem(input);
    if (selectedQueueItem) {
      return selectedQueueItem;
    }

    return this.findSelectedQueueItem(input);
  }

  readDeliveryAttemptProjection(queueItem, input = {}) {
    if (
      !this.notificationDeliveryAttemptProjectionService ||
      typeof this.notificationDeliveryAttemptProjectionService.readNotificationItem !== 'function'
    ) {
      return null;
    }

    return this.notificationDeliveryAttemptProjectionService.readNotificationItem({
      persisted_intent_reference: queueItem.persisted_intent_reference,
      scanLimit: input.scanLimit ?? input.scan_limit,
      attemptScanLimit: input.attemptScanLimit ?? input.attempt_scan_limit,
    });
  }

  evaluateReadiness(queueItem, input = {}) {
    if (!queueItem) {
      return buildSkippedResult({
        queueItem: null,
        skipReason: TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.invalid,
        failedReason: 'notification_dispatch_queue_item_required',
      });
    }

    if (!isDispatchQueueProjectionItem(queueItem)) {
      return buildSkippedResult({
        queueItem,
        skipReason: TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.invalid,
        failedReason: 'notification_dispatch_queue_projection_item_required',
      });
    }

    if (!SUPPORTED_NOTIFICATION_TYPES.has(normalizeString(queueItem.notification_type))) {
      return buildSkippedResult({
        queueItem,
        skipReason:
          TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.unsupported_notification_type,
        failedReason: 'unsupported_notification_type',
      });
    }

    const dispatchStatus = normalizeString(queueItem.dispatch_status?.status);
    if (dispatchStatus === TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.blocked) {
      return buildSkippedResult({
        queueItem,
        skipReason: TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.blocked,
        blockedReason: getBlockedReasonFromQueueItem(queueItem) || 'dispatch_blocked',
      });
    }
    if (dispatchStatus === TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.suppressed) {
      return buildSkippedResult({
        queueItem,
        skipReason: TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.suppressed,
        blockedReason: getBlockedReasonFromQueueItem(queueItem) || 'dispatch_suppressed',
      });
    }
    if (
      dispatchStatus !== TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.pending ||
      queueItem.dispatch_status?.dispatchable !== true
    ) {
      return buildSkippedResult({
        queueItem,
        skipReason: TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.non_executable,
        failedReason: `non_executable_dispatch_status:${dispatchStatus || 'unknown'}`,
      });
    }

    try {
      const projection = this.readDeliveryAttemptProjection(queueItem, input);
      if (projection?.delivery_state === TELEGRAM_NOTIFICATION_DELIVERY_STATES.sent) {
        return buildSkippedResult({
          queueItem,
          skipReason:
            TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.already_fully_resolved,
          executionResultSummary: buildExecutionSummaryFromProjection(projection),
        });
      }
      if (projection?.delivery_state === TELEGRAM_NOTIFICATION_DELIVERY_STATES.started) {
        return buildSkippedResult({
          queueItem,
          skipReason:
            TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.delivery_already_started,
          failedReason: 'delivery_already_started',
        });
      }
    } catch (error) {
      return buildSkippedResult({
        queueItem,
        skipReason: TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.invalid,
        failedReason: error?.message || 'delivery_attempt_projection_invalid',
      });
    }

    return null;
  }

  runDeliveryForReadyNotificationItem(input = {}) {
    const queueItem = this.resolveSelectedQueueItem(input);
    const readinessResult = this.evaluateReadiness(queueItem, input);
    if (readinessResult) {
      return readinessResult;
    }

    try {
      const executionResult =
        this.notificationDeliveryExecutorService.executeNotificationDelivery({
          notification_dispatch_queue_item: queueItem,
          actorType: input.actorType || input.actor_type || 'system',
          actorId: input.actorId ?? input.actor_id ?? null,
        });
      const executionResultSummary = buildExecutionSummaryFromResult(executionResult);

      return buildRunResult({
        queueItem,
        runStatus: executionStatusToRunStatus(executionResult.execution_status),
        executionResultSummary,
        persistedAttemptReference: executionResult.persisted_attempt_reference || null,
        blockedReason: executionResult.blocked_reason || null,
        failedReason: executionResult.failed_reason || null,
      });
    } catch (error) {
      if (isExecutorValidationError(error)) {
        return buildSkippedResult({
          queueItem,
          skipReason: TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS.invalid,
          failedReason: error?.message || 'invalid_delivery_queue_item',
        });
      }

      return buildRunResult({
        queueItem,
        runStatus: TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES.failed,
        executionResultSummary: null,
        failedReason: error?.message || 'delivery_run_failed',
      });
    }
  }

  runNotificationDeliveryForReadyItem(input = {}) {
    return this.runDeliveryForReadyNotificationItem(input);
  }

  runSelectedReadyNotificationDelivery(input = {}) {
    return this.runDeliveryForReadyNotificationItem(input);
  }

  runDeliveryForReadyNotificationItems(input = {}) {
    const explicitItems = pickQueueItems(input);
    const queueItems = explicitItems ||
      this.notificationDispatchQueueProjectionService
        .listPendingDispatchQueue({
          limit: normalizeLimit(input.limit),
          scanLimit: input.scanLimit ?? input.scan_limit,
        })
        .items;
    const results = queueItems.map((queueItem) =>
      this.runDeliveryForReadyNotificationItem({
        notification_dispatch_queue_item: queueItem,
        actorType: input.actorType || input.actor_type || 'system',
        actorId: input.actorId ?? input.actor_id ?? null,
        scanLimit: input.scanLimit ?? input.scan_limit,
        attemptScanLimit: input.attemptScanLimit ?? input.attempt_scan_limit,
      })
    );

    return freezeSortedRunValue({
      response_version: TELEGRAM_NOTIFICATION_DELIVERY_RUN_VERSION,
      run_result_type: TELEGRAM_NOTIFICATION_DELIVERY_RUN_BATCH_RESULT_TYPE,
      results,
      counters: buildCounters(results),
    });
  }

  runNotificationDeliveryForReadyItems(input = {}) {
    return this.runDeliveryForReadyNotificationItems(input);
  }

  runSelectedReadyNotificationDeliveries(input = {}) {
    return this.runDeliveryForReadyNotificationItems(input);
  }
}
