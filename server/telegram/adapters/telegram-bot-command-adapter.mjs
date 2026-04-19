import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramHandoffValue,
  TELEGRAM_GUEST_COMMAND_ACTION_TYPES,
} from '../../../shared/telegram/index.js';

export const TELEGRAM_BOT_COMMAND_ADAPTER_NAME = 'telegram_bot_command_adapter';
export const TELEGRAM_BOT_COMMAND_ADAPTER_RESULT_VERSION =
  'telegram_bot_command_adapter_result.v1';

const SUPPORTED_ACTION_TYPES = new Set(TELEGRAM_GUEST_COMMAND_ACTION_TYPES);
const COMMAND_TO_ACTION_TYPE = Object.freeze(
  Object.fromEntries(TELEGRAM_GUEST_COMMAND_ACTION_TYPES.map((actionType) => [`/${actionType}`, actionType]))
);

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
    throw new Error('[TELEGRAM_BOT_COMMAND_ADAPTER] invalid clock timestamp');
  }
  return iso;
}

function parsePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`[TELEGRAM_BOT_COMMAND_ADAPTER] ${label} must be a positive integer`);
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

function buildTelegramUserReferenceFromMessage(message) {
  const telegramUserId = normalizeString(message?.from?.id);
  if (!telegramUserId || !/^[1-9]\d*$/.test(telegramUserId)) {
    throw new Error(
      '[TELEGRAM_BOT_COMMAND_ADAPTER] message.from.id must be a usable Telegram user id'
    );
  }

  return freezeSortedResultValue({
    reference_type: 'telegram_user',
    telegram_user_id: telegramUserId,
  });
}

function parseCommandText(rawText) {
  const text = normalizeString(rawText);
  if (!text) {
    return null;
  }

  const match = text.match(/^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/);
  if (!match) {
    return null;
  }

  return freezeSortedResultValue({
    command: `/${String(match[1] || '').toLowerCase()}`,
    bot_username: normalizeString(match[2]),
    payload: normalizeString(match[3]),
    raw_text: text,
  });
}

function parseActionPayloadBookingReference(payload) {
  if (!payload) {
    return null;
  }
  if (!/^[1-9]\d*$/.test(payload)) {
    throw new Error(
      '[TELEGRAM_BOT_COMMAND_ADAPTER] action command payload must contain booking request id'
    );
  }
  return buildBookingRequestReference(payload);
}

function parseTemplateCommandPayload(payload) {
  const normalizedPayload = normalizeString(payload);
  if (!normalizedPayload) {
    throw new Error(
      '[TELEGRAM_BOT_COMMAND_ADAPTER] template command payload must contain message type and booking request id'
    );
  }

  const parts = normalizedPayload.split(/\s+/).filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(
      '[TELEGRAM_BOT_COMMAND_ADAPTER] template command payload must be "<message_type> <booking_request_id>"'
    );
  }

  const messageType = normalizeString(parts[0]);
  const bookingRequestReference = buildBookingRequestReference(parts[1]);
  return freezeSortedResultValue({
    message_type: messageType,
    booking_request_reference: bookingRequestReference,
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

function buildMappedCommandSummary(parsedCommand) {
  return freezeSortedResultValue({
    command: parsedCommand?.command || null,
    bot_username: parsedCommand?.bot_username || null,
    payload: parsedCommand?.payload || null,
    raw_text: parsedCommand?.raw_text || null,
  });
}

function buildResult({
  mappingStatus,
  mappedCommandSummary = null,
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
    response_version: TELEGRAM_BOT_COMMAND_ADAPTER_RESULT_VERSION,
    adapter_name: TELEGRAM_BOT_COMMAND_ADAPTER_NAME,
    mapping_status: mappingStatus,
    mapped_command_summary: mappedCommandSummary,
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

export class TelegramBotCommandAdapter {
  constructor({
    runtimeEntrypointOrchestrationService,
    guestCommandActionOrchestrationService,
    templateExecutionOrchestrationService,
    webhookOutboundResponseOrchestrationService = null,
    telegramMiniAppLaunchSummary = null,
    now = () => new Date(),
  }) {
    this.runtimeEntrypointOrchestrationService = runtimeEntrypointOrchestrationService;
    this.guestCommandActionOrchestrationService = guestCommandActionOrchestrationService;
    this.templateExecutionOrchestrationService = templateExecutionOrchestrationService;
    this.webhookOutboundResponseOrchestrationService =
      webhookOutboundResponseOrchestrationService;
    this.telegramMiniAppLaunchSummary = telegramMiniAppLaunchSummary;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: TELEGRAM_BOT_COMMAND_ADAPTER_NAME,
      status: 'telegram_bot_command_adapter_ready',
      dependencyKeys: [
        'runtimeEntrypointOrchestrationService',
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
          adapter_type: 'command',
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
          adapter_type: 'command',
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
              '[TELEGRAM_BOT_COMMAND_ADAPTER] outbound_response_orchestration_failed',
            provider_result_reference: null,
          },
          latest_timestamp_summary: buildTelegramLatestTimestampSummary(resolveNowIso(this.now)),
        },
      });
    }
  }

  handleCommandUpdate(rawUpdate) {
    const nowIso = resolveNowIso(this.now);
    const parsedCommand = parseCommandText(rawUpdate?.message?.text);
    if (!parsedCommand) {
      return buildResult({
        mappingStatus: 'ignored_non_command',
        operationType: null,
        operationStatus: null,
        mappedCommandSummary: null,
        nowIso,
      });
    }

    const mappedCommandSummary = buildMappedCommandSummary(parsedCommand);

    try {
      if (parsedCommand.command === '/start') {
        const runtimeResult =
          this.runtimeEntrypointOrchestrationService.processInboundStartUpdate(rawUpdate);
        const baseResult = buildResult({
          mappingStatus: 'mapped_start_command',
          mappedCommandSummary,
          operationType: runtimeResult.operation_type || 'inbound_start_update',
          operationStatus: runtimeResult.operation_status || 'processed',
          telegramUserReference:
            runtimeResult.telegram_user_summary?.telegram_user_id
              ? {
                  reference_type: 'telegram_user',
                  telegram_user_id: runtimeResult.telegram_user_summary.telegram_user_id,
                }
              : null,
          relatedBookingRequestReference:
            runtimeResult.related_booking_request_reference || null,
          operationResultSummary: runtimeResult,
          nowIso,
        });
        return this.attachOutboundResponseSummary(rawUpdate, baseResult);
      }

      if (parsedCommand.command === '/template_message') {
        const templateCommandInput = parseTemplateCommandPayload(parsedCommand.payload);
        const templateResult =
          this.templateExecutionOrchestrationService
            .executeTemplateBackedNotificationByBookingRequestReference({
              booking_request_reference: templateCommandInput.booking_request_reference,
              message_type: templateCommandInput.message_type,
            });
        return buildResult({
          mappingStatus: 'mapped_template_command',
          mappedCommandSummary,
          mappedMessageType: templateCommandInput.message_type,
          operationType: 'template_message_by_booking_request',
          operationStatus: mapTemplateOperationStatus(templateResult.execution_status),
          relatedBookingRequestReference: templateCommandInput.booking_request_reference,
          operationResultSummary: templateResult,
          nowIso,
        });
      }

      const actionType = COMMAND_TO_ACTION_TYPE[parsedCommand.command] || null;
      if (!actionType || !SUPPORTED_ACTION_TYPES.has(actionType)) {
        return buildResult({
          mappingStatus: 'unsupported_command',
          mappedCommandSummary,
          operationType: null,
          operationStatus: 'rejected_invalid_input',
          rejectionReason: `[TELEGRAM_BOT_COMMAND_ADAPTER] Unsupported command: ${parsedCommand.command}`,
          nowIso,
        });
      }

      const bookingRequestReference = parseActionPayloadBookingReference(parsedCommand.payload);
      const telegramUserReference = bookingRequestReference
        ? null
        : buildTelegramUserReferenceFromMessage(rawUpdate.message);
      const actionResult = bookingRequestReference
        ? this.guestCommandActionOrchestrationService
          .executeGuestActionByBookingRequestReference({
            action_type: actionType,
            booking_request_reference: bookingRequestReference,
          })
        : this.guestCommandActionOrchestrationService
          .executeGuestActionByTelegramUserReference({
            action_type: actionType,
            telegram_user_reference: telegramUserReference,
          });

      const baseResult = buildResult({
        mappingStatus: 'mapped_guest_action_command',
        mappedCommandSummary,
        mappedActionType: actionType,
        operationType: bookingRequestReference
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
          bookingRequestReference ||
          actionResult.related_booking_request_reference ||
          null,
        operationResultSummary: actionResult,
        nowIso,
      });
      return this.attachOutboundResponseSummary(rawUpdate, baseResult);
    } catch (error) {
      return buildResult({
        mappingStatus: 'rejected_invalid_input',
        mappedCommandSummary,
        operationType: null,
        operationStatus: 'rejected_invalid_input',
        rejectionReason:
          normalizeString(error?.message) || '[TELEGRAM_BOT_COMMAND_ADAPTER] invalid_input',
        nowIso,
      });
    }
  }

  execute(rawUpdate) {
    return this.handleCommandUpdate(rawUpdate);
  }
}

export function createTelegramBotCommandAdapter(options = {}) {
  return new TelegramBotCommandAdapter(options);
}
