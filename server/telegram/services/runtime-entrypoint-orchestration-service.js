import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramRuntimeEntrypointValue,
  TELEGRAM_GUEST_COMMAND_ACTION_TYPES,
  TELEGRAM_RUNTIME_ENTRYPOINT_RESULT_VERSION,
  TELEGRAM_SERVICE_MESSAGE_TEMPLATE_TYPES,
} from '../../../shared/telegram/index.js';

const SERVICE_NAME = 'telegram_runtime_entrypoint_orchestration_service';
const ERROR_PREFIX = '[TELEGRAM_RUNTIME_ENTRYPOINT]';
const SUPPORTED_ACTION_TYPES = new Set(TELEGRAM_GUEST_COMMAND_ACTION_TYPES);
const SUPPORTED_MESSAGE_TYPES = new Set(TELEGRAM_SERVICE_MESSAGE_TEMPLATE_TYPES);

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
  return freezeTelegramRuntimeEntrypointValue(sortResultValue(value));
}

function normalizeTelegramUserReference(input = {}) {
  const reference =
    input.telegram_user_reference ??
    input.telegramUserReference ??
    input.telegram_user ??
    input.telegramUser ??
    null;
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    reject('telegram_user_reference is required');
  }

  const referenceType = normalizeString(reference.reference_type || 'telegram_user');
  if (referenceType !== 'telegram_user') {
    reject(`Unsupported telegram-user reference type: ${referenceType || 'unknown'}`);
  }

  const telegramUserId = normalizeString(
    reference.telegram_user_id ?? reference.telegramUserId
  );
  if (!telegramUserId) {
    reject('telegram_user_reference.telegram_user_id is required');
  }

  return freezeSortedResultValue({
    reference_type: 'telegram_user',
    telegram_user_id: telegramUserId,
  });
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

function normalizeActionType(input = {}) {
  const actionType = normalizeString(
    input.action_type ?? input.actionType ?? input.action ?? input.type
  );
  if (!actionType || !SUPPORTED_ACTION_TYPES.has(actionType)) {
    reject(`Unsupported action type: ${actionType || 'unknown'}`);
  }

  return actionType;
}

function normalizeMessageType(input = {}) {
  const messageType = normalizeString(
    input.message_type ?? input.messageType ?? input.type
  );
  if (!messageType || !SUPPORTED_MESSAGE_TYPES.has(messageType)) {
    reject(`Unsupported message type: ${messageType || 'unknown'}`);
  }

  return messageType;
}

function buildStartActionSummary(orchestrationResult) {
  return freezeSortedResultValue({
    start_orchestration_status: orchestrationResult?.orchestration_status || null,
    source_binding_status: orchestrationResult?.source_binding_summary?.binding_status || null,
    attribution_status: orchestrationResult?.attribution_summary?.attribution_status || null,
  });
}

function buildGuestActionSummary(actionResult) {
  return freezeSortedResultValue({
    action_type: actionResult?.action_type || null,
    action_status: actionResult?.action_status || null,
    visibility_availability_summary:
      actionResult?.visibility_availability_summary || null,
  });
}

function buildTemplateActionSummary(executionResult) {
  return freezeSortedResultValue({
    message_type: executionResult?.message_type || null,
    execution_status: executionResult?.execution_status || null,
    template_reference: executionResult?.template_reference || null,
    delivery_run_status: executionResult?.delivery_result_summary?.run_status || null,
    delivery_skip_reason: executionResult?.delivery_result_summary?.skip_reason || null,
  });
}

function mapStartOperationStatus(orchestrationStatus) {
  if (orchestrationStatus === 'start_rejected_invalid_update') {
    return 'rejected_invalid_input';
  }
  if (orchestrationStatus === 'start_processed_without_source') {
    return 'processed_with_fallback';
  }

  return 'processed';
}

function mapGuestActionOperationStatus(actionStatus) {
  if (actionStatus === 'action_rejected_invalid_input') {
    return 'rejected_invalid_input';
  }
  if (actionStatus === 'action_not_available') {
    return 'blocked_not_possible';
  }

  return 'processed';
}

function mapTemplateOperationStatus(executionStatus) {
  if (executionStatus === 'executed_with_default_fallback') {
    return 'processed_with_fallback';
  }
  if (executionStatus === 'executed_with_managed_template') {
    return 'processed';
  }
  if (executionStatus === 'execution_blocked' || executionStatus === 'execution_not_possible') {
    return 'blocked_not_possible';
  }

  return 'blocked_not_possible';
}

export class TelegramRuntimeEntrypointOrchestrationService {
  constructor({
    inboundStartOrchestrationService,
    guestCommandActionOrchestrationService,
    templateExecutionOrchestrationService,
    now = () => new Date(),
  }) {
    this.inboundStartOrchestrationService = inboundStartOrchestrationService;
    this.guestCommandActionOrchestrationService =
      guestCommandActionOrchestrationService;
    this.templateExecutionOrchestrationService = templateExecutionOrchestrationService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'telegram_runtime_entrypoint_orchestration_ready',
      dependencyKeys: [
        'inboundStartOrchestrationService',
        'guestCommandActionOrchestrationService',
        'templateExecutionOrchestrationService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      throw new Error('[TELEGRAM_RUNTIME_ENTRYPOINT] invalid clock timestamp');
    }
    return iso;
  }

  buildOperationResult({
    operationType,
    operationStatus,
    telegramUserSummary = null,
    bookingRequestReference = null,
    relatedMessageActionSummary = null,
    operationResultSummary = null,
    rejectionReason = null,
    nowIso,
    latestTimestampCandidates = [],
  }) {
    return freezeSortedResultValue({
      response_version: TELEGRAM_RUNTIME_ENTRYPOINT_RESULT_VERSION,
      processed_by: SERVICE_NAME,
      operation_type: operationType,
      operation_status: operationStatus,
      telegram_user_summary: telegramUserSummary || null,
      related_booking_request_reference: bookingRequestReference || null,
      related_message_action_summary: relatedMessageActionSummary || null,
      operation_result_summary: operationResultSummary || null,
      rejection_reason: rejectionReason || null,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        ...latestTimestampCandidates
      ),
    });
  }

  processInboundStartUpdate(input = {}) {
    const nowIso = this.nowIso();
    const operationType = 'inbound_start_update';

    try {
      const result =
        this.inboundStartOrchestrationService.orchestrateInboundStartUpdate(input);
      return this.buildOperationResult({
        operationType,
        operationStatus: mapStartOperationStatus(result.orchestration_status),
        telegramUserSummary: result.telegram_user_summary || null,
        bookingRequestReference:
          result.bot_start_state_summary?.active_booking_request_summary
            ?.booking_request_reference || null,
        relatedMessageActionSummary: buildStartActionSummary(result),
        operationResultSummary: result,
        nowIso,
        latestTimestampCandidates: [result.latest_timestamp_summary?.iso],
      });
    } catch (error) {
      return this.buildOperationResult({
        operationType,
        operationStatus: 'rejected_invalid_input',
        rejectionReason: normalizeString(error?.message) || 'invalid_input',
        nowIso,
      });
    }
  }

  processGuestActionRequest(input = {}) {
    const nowIso = this.nowIso();
    const operationTypeByBooking =
      'guest_action_by_booking_request';
    const operationTypeByTelegramUser =
      'guest_action_by_telegram_user';
    let actionType = null;

    try {
      actionType = normalizeActionType(input);
      const hasBookingReference = Boolean(
        input.booking_request_reference ||
          input.bookingRequestReference ||
          input.booking_request ||
          input.bookingRequest
      );

      const actionResult = hasBookingReference
        ? this.guestCommandActionOrchestrationService
          .executeGuestActionByBookingRequestReference({
            ...input,
            action_type: actionType,
            booking_request_reference: normalizeBookingRequestReference(input),
          })
        : this.guestCommandActionOrchestrationService
          .executeGuestActionByTelegramUserReference({
            ...input,
            action_type: actionType,
            telegram_user_reference: normalizeTelegramUserReference(input),
          });

      return this.buildOperationResult({
        operationType: hasBookingReference
          ? operationTypeByBooking
          : operationTypeByTelegramUser,
        operationStatus: mapGuestActionOperationStatus(actionResult.action_status),
        telegramUserSummary: actionResult.telegram_user_summary || null,
        bookingRequestReference: actionResult.related_booking_request_reference || null,
        relatedMessageActionSummary: buildGuestActionSummary(actionResult),
        operationResultSummary: actionResult,
        nowIso,
        latestTimestampCandidates: [actionResult.latest_timestamp_summary?.iso],
      });
    } catch (error) {
      return this.buildOperationResult({
        operationType: 'guest_action_by_telegram_user',
        operationStatus: 'rejected_invalid_input',
        rejectionReason: normalizeString(error?.message) || 'invalid_input',
        relatedMessageActionSummary: actionType
          ? { action_type: actionType }
          : null,
        nowIso,
      });
    }
  }

  executeTemplateMessageByBookingRequestReference(input = {}) {
    const nowIso = this.nowIso();
    const operationType = 'template_message_by_booking_request';

    try {
      const bookingRequestReference = normalizeBookingRequestReference(input);
      const messageType = normalizeMessageType(input);
      const result =
        this.templateExecutionOrchestrationService
          .executeTemplateBackedNotificationByBookingRequestReference({
            booking_request_reference: bookingRequestReference,
            message_type: messageType,
          });

      return this.buildOperationResult({
        operationType,
        operationStatus: mapTemplateOperationStatus(result.execution_status),
        telegramUserSummary: result.delivery_result_summary?.execution_result_summary
          ?.delivery_target_summary || null,
        bookingRequestReference,
        relatedMessageActionSummary: buildTemplateActionSummary(result),
        operationResultSummary: result,
        nowIso,
        latestTimestampCandidates: [result.latest_timestamp_summary?.iso],
      });
    } catch (error) {
      return this.buildOperationResult({
        operationType,
        operationStatus: 'rejected_invalid_input',
        rejectionReason: normalizeString(error?.message) || 'invalid_input',
        nowIso,
      });
    }
  }
}
