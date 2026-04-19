import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramHandoffValue,
  TELEGRAM_GUEST_COMMAND_ACTION_TYPES,
} from '../../../shared/telegram/index.js';

export const TELEGRAM_BOT_CALLBACK_ADAPTER_NAME = 'telegram_bot_callback_adapter';
export const TELEGRAM_BOT_CALLBACK_ADAPTER_RESULT_VERSION =
  'telegram_bot_callback_adapter_result.v1';

const SUPPORTED_ACTION_TYPES = new Set(TELEGRAM_GUEST_COMMAND_ACTION_TYPES);

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
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
  return freezeTelegramHandoffValue(sortResultValue(value));
}

function resolveNowIso(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (Number.isNaN(Date.parse(iso))) {
    throw new Error('[TELEGRAM_BOT_CALLBACK_ADAPTER] invalid clock timestamp');
  }
  return iso;
}

function parsePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`[TELEGRAM_BOT_CALLBACK_ADAPTER] ${label} must be a positive integer`);
  }
  return normalized;
}

function buildBookingRequestReference(bookingRequestId) {
  return freezeSortedResultValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: parsePositiveInteger(
      bookingRequestId,
      'booking_request_reference.booking_request_id'
    ),
  });
}

function buildTelegramUserReferenceFromCallback(callbackQuery) {
  const telegramUserId = normalizeString(callbackQuery?.from?.id);
  if (!telegramUserId || !/^[1-9]\d*$/.test(telegramUserId)) {
    throw new Error(
      '[TELEGRAM_BOT_CALLBACK_ADAPTER] callback_query.from.id must be a usable Telegram user id'
    );
  }

  return freezeSortedResultValue({
    reference_type: 'telegram_user',
    telegram_user_id: telegramUserId,
  });
}

function parseActionToken(rawToken) {
  const token = normalizeString(rawToken);
  if (!token) {
    return null;
  }

  if (SUPPORTED_ACTION_TYPES.has(token)) {
    return freezeSortedResultValue({
      action_type: token,
      booking_request_reference: null,
      source: 'direct',
    });
  }

  const tokenMatch = token.match(/^([a-z_]+):([1-9]\d*)$/);
  if (!tokenMatch) {
    return null;
  }

  const actionType = normalizeString(tokenMatch[1]);
  if (!actionType || !SUPPORTED_ACTION_TYPES.has(actionType)) {
    return null;
  }

  return freezeSortedResultValue({
    action_type: actionType,
    booking_request_reference: buildBookingRequestReference(tokenMatch[2]),
    source: 'action_with_booking_reference',
  });
}

function parseTemplateToken(rawData) {
  const data = normalizeString(rawData);
  if (!data) {
    return null;
  }

  const match = data.match(/^template:([a-z0-9_]+):([1-9]\d*)$/);
  if (!match) {
    return null;
  }

  return freezeSortedResultValue({
    message_type: normalizeString(match[1]),
    booking_request_reference: buildBookingRequestReference(match[2]),
  });
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
  if (executionStatus === 'executed_with_managed_template') {
    return 'processed';
  }
  if (executionStatus === 'executed_with_default_fallback') {
    return 'processed_with_fallback';
  }
  if (executionStatus === 'execution_blocked' || executionStatus === 'execution_not_possible') {
    return 'blocked_not_possible';
  }
  return 'blocked_not_possible';
}

function buildCallbackSummary(rawUpdate) {
  return freezeSortedResultValue({
    callback_query_id: normalizeString(rawUpdate?.callback_query?.id),
    telegram_update_id:
      Number.isInteger(rawUpdate?.update_id) && rawUpdate.update_id >= 0
        ? rawUpdate.update_id
        : null,
    data: normalizeString(rawUpdate?.callback_query?.data),
    message_id:
      Number.isInteger(rawUpdate?.callback_query?.message?.message_id) &&
      rawUpdate.callback_query.message.message_id > 0
        ? rawUpdate.callback_query.message.message_id
        : null,
  });
}

function buildResult({
  mappingStatus,
  mappedCallbackSummary = null,
  mappedActionType = null,
  mappedMessageType = null,
  operationType = null,
  operationStatus = null,
  telegramUserReference = null,
  relatedBookingRequestReference = null,
  operationResultSummary = null,
  rejectionReason = null,
  nowIso,
}) {
  return freezeSortedResultValue({
    response_version: TELEGRAM_BOT_CALLBACK_ADAPTER_RESULT_VERSION,
    adapter_name: TELEGRAM_BOT_CALLBACK_ADAPTER_NAME,
    mapping_status: mappingStatus,
    mapped_callback_summary: mappedCallbackSummary,
    mapped_action_type: mappedActionType,
    mapped_message_type: mappedMessageType,
    operation_type: operationType,
    operation_status: operationStatus,
    telegram_user_reference: telegramUserReference,
    related_booking_request_reference: relatedBookingRequestReference,
    operation_result_summary: operationResultSummary,
    rejection_reason: rejectionReason,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      operationResultSummary?.latest_timestamp_summary?.iso
    ),
  });
}

export class TelegramBotCallbackAdapter {
  constructor({
    guestCommandActionOrchestrationService,
    templateExecutionOrchestrationService,
    webhookOutboundResponseOrchestrationService = null,
    telegramMiniAppLaunchSummary = null,
    now = () => new Date(),
  }) {
    this.guestCommandActionOrchestrationService = guestCommandActionOrchestrationService;
    this.templateExecutionOrchestrationService = templateExecutionOrchestrationService;
    this.webhookOutboundResponseOrchestrationService =
      webhookOutboundResponseOrchestrationService;
    this.telegramMiniAppLaunchSummary = telegramMiniAppLaunchSummary;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: TELEGRAM_BOT_CALLBACK_ADAPTER_NAME,
      status: 'telegram_bot_callback_adapter_ready',
      dependencyKeys: [
        'guestCommandActionOrchestrationService',
        'templateExecutionOrchestrationService',
        'webhookOutboundResponseOrchestrationService',
      ],
    });
  }

  attachOutboundResponseSummary(rawUpdate, result) {
    if (!this.webhookOutboundResponseOrchestrationService) {
      return result;
    }

    try {
      const outboundResponseSummary =
        this.webhookOutboundResponseOrchestrationService.orchestrateOutboundResponse({
          adapter_type: 'callback',
          raw_update: rawUpdate,
          adapter_result_summary: result,
          mini_app_launch_summary: this.telegramMiniAppLaunchSummary,
        });
      if (!outboundResponseSummary) {
        return result;
      }
      return freezeSortedResultValue({
        ...result,
        outbound_response_summary: outboundResponseSummary,
      });
    } catch (error) {
      return freezeSortedResultValue({
        ...result,
        outbound_response_summary: {
          response_version: 'telegram_webhook_outbound_response_result.v1',
          orchestrated_by: 'telegram_webhook_outbound_response_orchestration_service',
          adapter_type: 'callback',
          outbound_mapping_status: 'orchestration_failed',
          mapped_action_type: result?.mapped_action_type || null,
          mapped_operation_type: result?.operation_type || null,
          mapped_operation_status: result?.operation_status || null,
          response_text_fields: null,
          button_payloads: [],
          telegram_target_summary: null,
          delivery_handoff_summary: {
            handoff_status: 'failed',
            adapter_outcome: 'failed',
            blocked_reason: null,
            failed_reason:
              normalizeString(error?.message) ||
              '[TELEGRAM_BOT_CALLBACK_ADAPTER] outbound_response_orchestration_failed',
            provider_result_reference: null,
          },
          latest_timestamp_summary: buildTelegramLatestTimestampSummary(resolveNowIso(this.now)),
        },
      });
    }
  }

  handleCallbackUpdate(rawUpdate) {
    const nowIso = resolveNowIso(this.now);
    const mappedCallbackSummary = buildCallbackSummary(rawUpdate);
    const callbackData = mappedCallbackSummary.data;
    if (!callbackData) {
      return buildResult({
        mappingStatus: 'rejected_invalid_input',
        mappedCallbackSummary,
        operationType: null,
        operationStatus: 'rejected_invalid_input',
        rejectionReason: '[TELEGRAM_BOT_CALLBACK_ADAPTER] callback_query.data is required',
        nowIso,
      });
    }

    try {
      const templateToken = parseTemplateToken(callbackData);
      if (templateToken) {
        const templateResult =
          this.templateExecutionOrchestrationService
            .executeTemplateBackedNotificationByBookingRequestReference({
              booking_request_reference: templateToken.booking_request_reference,
              message_type: templateToken.message_type,
            });
        return buildResult({
          mappingStatus: 'mapped_template_callback',
          mappedCallbackSummary,
          mappedMessageType: templateToken.message_type,
          operationType: 'template_message_by_booking_request',
          operationStatus: mapTemplateOperationStatus(templateResult.execution_status),
          relatedBookingRequestReference: templateToken.booking_request_reference,
          operationResultSummary: templateResult,
          nowIso,
        });
      }

      const actionToken = callbackData.startsWith('action:')
        ? parseActionToken(callbackData.slice('action:'.length))
        : parseActionToken(callbackData);
      if (!actionToken) {
        return buildResult({
          mappingStatus: 'unsupported_callback_data',
          mappedCallbackSummary,
          operationType: null,
          operationStatus: 'rejected_invalid_input',
          rejectionReason: `[TELEGRAM_BOT_CALLBACK_ADAPTER] Unsupported callback data: ${callbackData}`,
          nowIso,
        });
      }

      const telegramUserReference = actionToken.booking_request_reference
        ? null
        : buildTelegramUserReferenceFromCallback(rawUpdate.callback_query);
      const actionResult = actionToken.booking_request_reference
        ? this.guestCommandActionOrchestrationService
          .executeGuestActionByBookingRequestReference({
            action_type: actionToken.action_type,
            booking_request_reference: actionToken.booking_request_reference,
          })
        : this.guestCommandActionOrchestrationService
          .executeGuestActionByTelegramUserReference({
            action_type: actionToken.action_type,
            telegram_user_reference: telegramUserReference,
          });

      const baseResult = buildResult({
        mappingStatus: 'mapped_guest_action_callback',
        mappedCallbackSummary,
        mappedActionType: actionToken.action_type,
        operationType: actionToken.booking_request_reference
          ? 'guest_action_by_booking_request'
          : 'guest_action_by_telegram_user',
        operationStatus: mapGuestActionOperationStatus(actionResult.action_status),
        telegramUserReference:
          telegramUserReference ||
          (actionResult.telegram_user_summary?.telegram_user_id
            ? {
                reference_type: 'telegram_user',
                telegram_user_id: actionResult.telegram_user_summary.telegram_user_id,
              }
            : null),
        relatedBookingRequestReference:
          actionToken.booking_request_reference ||
          actionResult.related_booking_request_reference ||
          null,
        operationResultSummary: actionResult,
        nowIso,
      });
      return this.attachOutboundResponseSummary(rawUpdate, baseResult);
    } catch (error) {
      return buildResult({
        mappingStatus: 'rejected_invalid_input',
        mappedCallbackSummary,
        operationType: null,
        operationStatus: 'rejected_invalid_input',
        rejectionReason:
          normalizeString(error?.message) || '[TELEGRAM_BOT_CALLBACK_ADAPTER] invalid_input',
        nowIso,
      });
    }
  }

  execute(rawUpdate) {
    return this.handleCallbackUpdate(rawUpdate);
  }
}

export function createTelegramBotCallbackAdapter(options = {}) {
  return new TelegramBotCallbackAdapter(options);
}
