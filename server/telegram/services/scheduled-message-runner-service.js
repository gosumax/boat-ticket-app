import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramScheduledMessageRunnerValue,
  TELEGRAM_SCHEDULED_MESSAGE_RUN_RESULT_VERSION,
  TELEGRAM_SCHEDULED_MESSAGE_RUN_SCOPES,
  TELEGRAM_SCHEDULED_MESSAGE_SUPPORTED_TYPES,
} from '../../../shared/telegram/index.js';

const SERVICE_NAME = 'telegram_scheduled_message_runner_service';
const ERROR_PREFIX = '[TELEGRAM_SCHEDULED_MESSAGE_RUNNER]';
const SUPPORTED_MESSAGE_TYPES = new Set(TELEGRAM_SCHEDULED_MESSAGE_SUPPORTED_TYPES);

function reject(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    reject(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeLimit(value, fallback = 500, max = 5000) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function sortResultValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortResultValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortResultValue(value[key])])
  );
}

function freezeSortedResultValue(value) {
  return freezeTelegramScheduledMessageRunnerValue(sortResultValue(value));
}

function normalizeBookingRequestReference(input = {}) {
  const reference =
    input.booking_request_reference ??
    input.bookingRequestReference ??
    input.booking_request ??
    input.bookingRequest ??
    null;
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    reject('booking_request_reference is required');
  }

  const referenceType = normalizeString(reference.reference_type || 'telegram_booking_request');
  if (referenceType !== 'telegram_booking_request') {
    reject(`Unsupported booking-request reference type: ${referenceType || 'unknown'}`);
  }

  return freezeSortedResultValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: normalizePositiveInteger(
      reference.booking_request_id ?? reference.bookingRequestId,
      'booking_request_reference.booking_request_id'
    ),
  });
}

function buildBookingRequestReferenceFromRow(bookingRequest = {}) {
  return freezeSortedResultValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: bookingRequest.booking_request_id,
  });
}

function isValidIso(iso) {
  if (!iso) {
    return false;
  }
  return !Number.isNaN(Date.parse(iso));
}

function mapPlanningSkipReason(item) {
  const planningStatus = item.planning_status || null;
  if (!planningStatus) {
    return 'invalid';
  }
  if (planningStatus.includes('not_needed')) {
    return 'already_resolved';
  }
  if (planningStatus.includes('not_possible')) {
    return 'blocked';
  }

  return 'not_planned';
}

function isInvalidExecutionReason(reason) {
  const message = normalizeString(reason);
  if (!message) {
    return false;
  }

  return (
    message.includes('Unsupported') ||
    message.includes('is required') ||
    message.includes('must be a positive integer')
  );
}

function isAlreadyResolvedExecutionReason(reason) {
  const message = normalizeString(reason);
  if (!message) {
    return false;
  }

  return (
    message.includes('already_fully_resolved') ||
    message.includes('delivery_already_started') ||
    message.includes('already') ||
    message.includes('not needed')
  );
}

function classifyExecutionSkipReason(executionResult) {
  const deliverySkipReason = normalizeString(
    executionResult?.delivery_result_summary?.skip_reason
  );
  if (deliverySkipReason === 'already_fully_resolved' || deliverySkipReason === 'delivery_already_started') {
    return 'already_resolved';
  }
  if (deliverySkipReason === 'invalid') {
    return 'invalid';
  }
  if (deliverySkipReason === 'blocked' || deliverySkipReason === 'suppressed') {
    return 'blocked';
  }

  const failedReason = normalizeString(executionResult?.delivery_result_summary?.failed_reason);
  if (isInvalidExecutionReason(failedReason)) {
    return 'invalid';
  }
  if (isAlreadyResolvedExecutionReason(failedReason)) {
    return 'already_resolved';
  }

  if (executionResult?.execution_status === 'execution_not_possible') {
    return 'blocked';
  }

  return 'blocked';
}

function buildProcessedSummary(item, executionResult) {
  return freezeSortedResultValue({
    booking_request_reference: item.booking_request_reference,
    planned_item_scope: item.planned_item_scope,
    message_type: item.message_type,
    execution_status: executionResult.execution_status,
    template_reference: executionResult.template_reference || null,
    execution_result_summary: executionResult.delivery_result_summary || null,
    latest_timestamp_summary: executionResult.latest_timestamp_summary || null,
  });
}

function buildSkippedSummary(item, skipReason, details = {}) {
  return freezeSortedResultValue({
    booking_request_reference: item.booking_request_reference,
    planned_item_scope: item.planned_item_scope,
    message_type: item.message_type,
    skip_reason: skipReason,
    planning_status: item.planning_status,
    planned_trigger_time_summary: item.planned_trigger_time_summary,
    blocked_reason: details.blocked_reason || null,
    invalid_reason: details.invalid_reason || null,
    already_resolved_reason: details.already_resolved_reason || null,
    latest_timestamp_summary: item.latest_timestamp_summary || null,
  });
}

function buildCounters(plannedItems, dueItems, processedSummaries, skippedSummaries) {
  const counters = {
    planned_total: plannedItems.length,
    due_total: dueItems.length,
    processed_total: processedSummaries.length,
    skipped_total: skippedSummaries.length,
    skipped_not_due: 0,
    skipped_blocked: 0,
    skipped_invalid: 0,
    skipped_already_resolved: 0,
    skipped_not_planned: 0,
  };

  for (const skipped of skippedSummaries) {
    if (skipped.skip_reason === 'not_due') {
      counters.skipped_not_due += 1;
    } else if (skipped.skip_reason === 'blocked') {
      counters.skipped_blocked += 1;
    } else if (skipped.skip_reason === 'invalid') {
      counters.skipped_invalid += 1;
    } else if (skipped.skip_reason === 'already_resolved') {
      counters.skipped_already_resolved += 1;
    } else if (skipped.skip_reason === 'not_planned') {
      counters.skipped_not_planned += 1;
    }
  }

  return freezeSortedResultValue(counters);
}

function resolveRunStatus(counters) {
  if (counters.due_total === 0) {
    return 'run_nothing_due';
  }
  if (counters.processed_total === 0) {
    return 'run_blocked';
  }
  if (counters.skipped_total === 0) {
    return 'run_executed';
  }

  return 'run_partially_executed';
}

function buildResult({
  runScope,
  bookingRequestReference = null,
  plannedItems,
  dueItems,
  processedItemSummaries,
  skippedItemSummaries,
  nowIso,
}) {
  const countersSummary = buildCounters(
    plannedItems,
    dueItems,
    processedItemSummaries,
    skippedItemSummaries
  );

  return freezeSortedResultValue({
    response_version: TELEGRAM_SCHEDULED_MESSAGE_RUN_RESULT_VERSION,
    executed_by: SERVICE_NAME,
    run_scope: runScope,
    run_status: resolveRunStatus(countersSummary),
    related_booking_request_reference: bookingRequestReference,
    processed_item_summaries: processedItemSummaries,
    skipped_item_summaries: skippedItemSummaries,
    counters_summary: countersSummary,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      ...processedItemSummaries.map((item) => item.latest_timestamp_summary?.iso),
      ...skippedItemSummaries.map((item) => item.latest_timestamp_summary?.iso)
    ),
  });
}

export class TelegramScheduledMessageRunnerService {
  constructor({
    bookingRequests,
    preTripReminderPlanningService,
    postTripMessagePlanningService,
    templateExecutionOrchestrationService,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.preTripReminderPlanningService = preTripReminderPlanningService;
    this.postTripMessagePlanningService = postTripMessagePlanningService;
    this.templateExecutionOrchestrationService = templateExecutionOrchestrationService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'telegram_scheduled_message_runner_ready',
      dependencyKeys: [
        'bookingRequests',
        'preTripReminderPlanningService',
        'postTripMessagePlanningService',
        'templateExecutionOrchestrationService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      throw new Error('[TELEGRAM_SCHEDULED_MESSAGE_RUNNER] invalid clock timestamp');
    }
    return iso;
  }

  collectReminderItems(bookingRequestReference) {
    const planned =
      this.preTripReminderPlanningService.planRemindersByBookingRequestReference({
        booking_request_reference: bookingRequestReference,
      });

    return (planned.items || []).map((item) =>
      freezeSortedResultValue({
        planned_item_scope: 'pre_trip_reminder',
        booking_request_reference: item.booking_request_reference || bookingRequestReference,
        message_type: item.reminder_type,
        planning_status: item.reminder_planning_status,
        planned_trigger_time_summary: item.planned_trigger_time_summary || null,
        latest_timestamp_summary: item.latest_timestamp_summary || null,
      })
    );
  }

  collectPostTripItems(bookingRequestReference) {
    const planned =
      this.postTripMessagePlanningService.planPostTripMessagesByBookingRequestReference({
        booking_request_reference: bookingRequestReference,
      });

    return (planned.items || []).map((item) =>
      freezeSortedResultValue({
        planned_item_scope: 'post_trip_message',
        booking_request_reference: item.booking_request_reference || bookingRequestReference,
        message_type: item.post_trip_message_type,
        planning_status: item.planning_status,
        planned_trigger_time_summary: item.planned_trigger_time_summary || null,
        latest_timestamp_summary: item.latest_timestamp_summary || null,
      })
    );
  }

  runPlannedItems(runScope, bookingRequestReference, plannedItems) {
    if (!TELEGRAM_SCHEDULED_MESSAGE_RUN_SCOPES.includes(runScope)) {
      reject(`Unsupported run scope: ${runScope}`);
    }

    const nowIso = this.nowIso();
    const nowMillis = Date.parse(nowIso);
    const processedItemSummaries = [];
    const skippedItemSummaries = [];
    const dueItems = [];

    for (const item of plannedItems) {
      if (!SUPPORTED_MESSAGE_TYPES.has(item.message_type)) {
        skippedItemSummaries.push(
          buildSkippedSummary(item, 'invalid', {
            invalid_reason: 'unsupported_message_type',
          })
        );
        continue;
      }

      if (item.planning_status !== 'reminder_planned' && item.planning_status !== 'post_trip_planned') {
        const skipReason = mapPlanningSkipReason(item);
        skippedItemSummaries.push(
          buildSkippedSummary(item, skipReason, {
            blocked_reason: skipReason === 'blocked' ? item.planning_status : null,
            already_resolved_reason:
              skipReason === 'already_resolved' ? item.planning_status : null,
          })
        );
        continue;
      }

      const triggerIso = item.planned_trigger_time_summary?.iso || null;
      if (!isValidIso(triggerIso)) {
        skippedItemSummaries.push(
          buildSkippedSummary(item, 'invalid', {
            invalid_reason: 'planned_trigger_time_invalid',
          })
        );
        continue;
      }
      if (Date.parse(triggerIso) > nowMillis) {
        skippedItemSummaries.push(buildSkippedSummary(item, 'not_due'));
        continue;
      }

      dueItems.push(item);

      const executionResult =
        this.templateExecutionOrchestrationService
          .executeTemplateBackedNotificationByBookingRequestReference({
            booking_request_reference: item.booking_request_reference,
            message_type: item.message_type,
          });

      if (
        executionResult.execution_status === 'executed_with_managed_template' ||
        executionResult.execution_status === 'executed_with_default_fallback'
      ) {
        processedItemSummaries.push(buildProcessedSummary(item, executionResult));
        continue;
      }

      const skipReason = classifyExecutionSkipReason(executionResult);
      skippedItemSummaries.push(
        buildSkippedSummary(item, skipReason, {
          blocked_reason:
            skipReason === 'blocked'
              ? executionResult.delivery_result_summary?.blocked_reason ||
                executionResult.delivery_result_summary?.failed_reason ||
                executionResult.execution_status
              : null,
          invalid_reason:
            skipReason === 'invalid'
              ? executionResult.delivery_result_summary?.failed_reason ||
                executionResult.execution_status
              : null,
          already_resolved_reason:
            skipReason === 'already_resolved'
              ? executionResult.delivery_result_summary?.skip_reason ||
                executionResult.delivery_result_summary?.failed_reason ||
                executionResult.execution_status
              : null,
        })
      );
    }

    return buildResult({
      runScope,
      bookingRequestReference,
      plannedItems,
      dueItems,
      processedItemSummaries,
      skippedItemSummaries,
      nowIso,
    });
  }

  runPlannedRemindersForBookingRequest(input = {}) {
    const bookingRequestReference = normalizeBookingRequestReference(input);
    return this.runPlannedItems(
      'planned_reminders_by_booking_request',
      bookingRequestReference,
      this.collectReminderItems(bookingRequestReference)
    );
  }

  runPlannedPostTripMessagesForBookingRequest(input = {}) {
    const bookingRequestReference = normalizeBookingRequestReference(input);
    return this.runPlannedItems(
      'planned_post_trip_messages_by_booking_request',
      bookingRequestReference,
      this.collectPostTripItems(bookingRequestReference)
    );
  }

  runAllDuePlannedMessagesBatch(input = {}) {
    const rows = this.bookingRequests.listBy(
      {},
      {
        orderBy: 'booking_request_id ASC',
        limit: normalizeLimit(input.scan_limit ?? input.scanLimit ?? input.limit),
      }
    );
    const plannedItems = rows.flatMap((row) => {
      const bookingRequestReference = buildBookingRequestReferenceFromRow(row);
      return [
        ...this.collectReminderItems(bookingRequestReference),
        ...this.collectPostTripItems(bookingRequestReference),
      ];
    });

    return this.runPlannedItems(
      'all_due_planned_messages',
      null,
      plannedItems
    );
  }
}
