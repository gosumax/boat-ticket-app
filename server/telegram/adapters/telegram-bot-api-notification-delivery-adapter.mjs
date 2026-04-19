import { spawnSync } from 'node:child_process';
import {
  freezeTelegramHandoffValue,
  TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES,
  TELEGRAM_SERVICE_MESSAGE_TYPES,
} from '../../../shared/telegram/index.js';

export const TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_NAME =
  'telegram-bot-api-notification-delivery-adapter';
export const TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_VERSION =
  'telegram_bot_api_notification_delivery_adapter_v1';
export const TELEGRAM_BOT_API_BASE_URL = 'https://api.telegram.org';

const DEFAULT_TIMEOUT_MS = 10000;
const SUPPORTED_NOTIFICATION_TYPES = new Set([
  TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
  TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended,
  TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired,
  TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
  TELEGRAM_SERVICE_MESSAGE_TYPES['1_hour_before_trip'],
  TELEGRAM_SERVICE_MESSAGE_TYPES['30_minutes_before_trip'],
  TELEGRAM_SERVICE_MESSAGE_TYPES.post_trip_thank_you,
  TELEGRAM_SERVICE_MESSAGE_TYPES.post_trip_review_request,
]);

const SERVICE_MESSAGE_TEXT_BY_TYPE = Object.freeze({
  [TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created]: [
    'Booking request received',
    'We received your request.',
    'Temporary hold is active.',
  ],
  [TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended]: [
    'Hold extended',
    'Your temporary hold was extended.',
    'Prepayment is still pending.',
  ],
  [TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired]: [
    'Hold expired',
    'Your temporary hold has expired.',
    'You can create a new booking request.',
  ],
  [TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed]: [
    'Booking confirmed',
    'Your prepayment is confirmed. We are preparing your ticket.',
    'Ticket handoff is pending.',
  ],
  [TELEGRAM_SERVICE_MESSAGE_TYPES['1_hour_before_trip']]: [
    '1 Hour Reminder',
    'Reminder: your trip starts in about 1 hour.',
    'Please arrive in advance at the boarding point.',
  ],
  [TELEGRAM_SERVICE_MESSAGE_TYPES['30_minutes_before_trip']]: [
    '30 Minute Reminder',
    'Reminder: your trip starts in 30 minutes.',
    'Boarding preparation is now in progress.',
  ],
  [TELEGRAM_SERVICE_MESSAGE_TYPES.post_trip_thank_you]: [
    'Post-Trip Thank You',
    'Thank you for the trip.',
    'We hope to see you again soon on another route.',
  ],
  [TELEGRAM_SERVICE_MESSAGE_TYPES.post_trip_review_request]: [
    'Post-Trip Review Request',
    'Please share a quick review about your trip experience.',
    'Your feedback helps improve service.',
  ],
});

const LINKED_TICKET_CONFIRMED_TEXT = Object.freeze([
  'Booking confirmed',
  'Your booking is confirmed and your ticket is ready.',
  'Ticket status: TICKET_READY.',
]);

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function sortAdapterValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortAdapterValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortAdapterValue(value[key])])
  );
}

function freezeSortedAdapterValue(value) {
  return freezeTelegramHandoffValue(sortAdapterValue(value));
}

function normalizeTimeoutMs(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(Math.trunc(normalized), 60000);
}

function normalizeApiBaseUrl(value) {
  return normalizeString(value) || TELEGRAM_BOT_API_BASE_URL;
}

function normalizeBotToken(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  return /^[A-Za-z0-9:_-]+$/.test(normalized) ? normalized : null;
}

function normalizeNotificationType(value) {
  return normalizeString(value) || 'unknown';
}

function normalizeAdapterInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      failedReason: 'invalid_adapter_input',
      rawInput: null,
    };
  }

  if (
    input.adapter_contract_version !==
    TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION
  ) {
    return {
      valid: false,
      failedReason: 'unsupported_adapter_contract_version',
      rawInput: input,
    };
  }

  const notificationType = normalizeNotificationType(input.notification_type);
  if (!SUPPORTED_NOTIFICATION_TYPES.has(notificationType)) {
    return {
      valid: false,
      failedReason: 'unsupported_notification_type',
      notificationType,
      rawInput: input,
    };
  }

  return {
    valid: true,
    rawInput: input,
    notificationType,
    deliveryChannel: normalizeString(input.delivery_channel) || 'telegram_bot',
    deliveryTargetSummary: input.delivery_target_summary || {},
    resolvedPayloadSummaryReference: input.resolved_payload_summary_reference || {},
    queueItemReference: input.queue_item_reference || null,
    dedupeKey: normalizeString(input.dedupe_key),
    idempotencyKey: normalizeString(input.idempotency_key),
  };
}

function normalizeNumericChatId(value, { allowNegative = false } = {}) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  if (!/^-?[1-9]\d*$/.test(normalized)) {
    return null;
  }
  if (!allowNegative && normalized.startsWith('-')) {
    return null;
  }

  return normalized;
}

function normalizeChannelUsername(value) {
  const normalized = normalizeString(value);
  if (!normalized || !/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function pickTelegramChatTarget(deliveryTargetSummary = {}) {
  const explicitChatId = normalizeNumericChatId(
    deliveryTargetSummary.telegram_chat_id,
    { allowNegative: true }
  );
  if (explicitChatId) {
    return {
      chatId: explicitChatId,
      chatIdKind: explicitChatId.startsWith('-') ? 'chat_id' : 'private_chat_id',
      targetSource: 'telegram_chat_id',
    };
  }

  const channelUsername = normalizeChannelUsername(deliveryTargetSummary.telegram_chat_id);
  if (channelUsername) {
    return {
      chatId: channelUsername,
      chatIdKind: 'channel_username',
      targetSource: 'telegram_chat_id',
    };
  }

  const telegramUserId = normalizeNumericChatId(deliveryTargetSummary.telegram_user_id);
  if (telegramUserId) {
    return {
      chatId: telegramUserId,
      chatIdKind: 'private_user_id',
      targetSource: 'telegram_user_id',
    };
  }

  return null;
}

function normalizeInlineKeyboardButton(rawButton) {
  if (!rawButton || typeof rawButton !== 'object' || Array.isArray(rawButton)) {
    return null;
  }

  const text = normalizeString(rawButton.text ?? rawButton.label);
  const callbackData = normalizeString(
    rawButton.callback_data ?? rawButton.callbackData
  );
  const webAppUrl = normalizeString(
    rawButton.web_app?.url ??
      rawButton.webApp?.url ??
      rawButton.web_app_url ??
      rawButton.webAppUrl
  );
  if (!text || (!callbackData && !webAppUrl)) {
    return null;
  }

  if (webAppUrl) {
    return freezeSortedAdapterValue({
      text,
      web_app: {
        url: webAppUrl,
      },
    });
  }

  return freezeSortedAdapterValue({
    text,
    callback_data: callbackData,
  });
}

function normalizeReplyMarkup(rawMarkup) {
  if (!rawMarkup || typeof rawMarkup !== 'object' || Array.isArray(rawMarkup)) {
    return null;
  }

  const rawInlineKeyboard = Array.isArray(rawMarkup.inline_keyboard)
    ? rawMarkup.inline_keyboard
    : null;
  if (!rawInlineKeyboard) {
    return null;
  }

  const inlineKeyboard = rawInlineKeyboard
    .map((row) => (Array.isArray(row) ? row : [row]))
    .map((row) => row.map((button) => normalizeInlineKeyboardButton(button)).filter(Boolean))
    .filter((row) => row.length > 0);
  if (inlineKeyboard.length === 0) {
    return null;
  }

  return freezeSortedAdapterValue({
    inline_keyboard: inlineKeyboard,
  });
}

function pickFutureReplyMarkup(input = {}) {
  const rawReplyMarkup =
    input.reply_markup ??
    input.replyMarkup ??
    input.telegram_reply_markup ??
    input.telegramReplyMarkup ??
    input.resolved_payload_summary_reference?.reply_markup ??
    input.resolved_payload_summary_reference?.replyMarkup ??
    input.resolved_payload_summary_reference?.telegram_reply_markup ??
    input.resolved_payload_summary_reference?.telegramReplyMarkup ??
    null;

  return normalizeReplyMarkup(rawReplyMarkup);
}

function pickFutureResolvedTextFields(input = {}) {
  const fields =
    input.text_payload?.fields ||
    input.service_message_text?.fields ||
    input.resolved_payload_summary_reference?.resolved_text_fields ||
    input.resolved_text_payload?.fields ||
    null;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return null;
  }

  const lines = [
    normalizeString(fields.headline),
    normalizeString(fields.body),
    normalizeString(fields.status_line),
  ].filter(Boolean);

  return lines.length > 0 ? lines : null;
}

function buildServiceMessageText(normalizedInput) {
  const futureResolvedFields = pickFutureResolvedTextFields(normalizedInput.rawInput);
  if (futureResolvedFields) {
    return futureResolvedFields.join('\n');
  }

  if (
    normalizedInput.notificationType === TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed &&
    normalizedInput.resolvedPayloadSummaryReference.message_mode === 'linked_to_presale'
  ) {
    return LINKED_TICKET_CONFIRMED_TEXT.join('\n');
  }

  return SERVICE_MESSAGE_TEXT_BY_TYPE[normalizedInput.notificationType].join('\n');
}

function buildDeliveryMetadataSummary({ normalizedInput, target, text, replyMarkup }) {
  const payloadReference = normalizedInput.resolvedPayloadSummaryReference || {};
  const buttonRows = Array.isArray(replyMarkup?.inline_keyboard)
    ? replyMarkup.inline_keyboard
    : [];
  const buttonCount = buttonRows.reduce((count, row) => count + row.length, 0);

  return freezeSortedAdapterValue({
    adapter_name: TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_NAME,
    adapter_version: TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_VERSION,
    api_method: 'sendMessage',
    content_key: normalizeString(payloadReference.content_key),
    delivery_channel: normalizedInput.deliveryChannel,
    field_keys: Array.isArray(payloadReference.field_keys)
      ? payloadReference.field_keys.map(normalizeString).filter(Boolean).sort()
      : [],
    locale: normalizeString(payloadReference.locale),
    message_mode: normalizeString(payloadReference.message_mode),
    notification_type: normalizedInput.notificationType,
    resolved_message_type: normalizeString(payloadReference.message_type),
    target_summary: {
      chat_id_kind: target?.chatIdKind || null,
      chat_target_present: Boolean(target),
      target_source: target?.targetSource || null,
      target_type: normalizeString(normalizedInput.deliveryTargetSummary.target_type),
    },
    button_payload_summary: {
      row_count: buttonRows.length,
      button_count: buttonCount,
      inline_keyboard: buttonCount > 0,
    },
    text_payload_summary: {
      format: 'plain_text',
      message_kind: 'service_message',
      text_length: text.length,
    },
  });
}

function buildExternalDeliveryReference({ telegramResult, target }) {
  if (!telegramResult || typeof telegramResult !== 'object') {
    return null;
  }

  return freezeSortedAdapterValue({
    provider: 'telegram_bot_api',
    api_method: 'sendMessage',
    telegram_chat_id: normalizeString(telegramResult.chat?.id ?? target.chatId),
    telegram_message_id: telegramResult.message_id ?? null,
  });
}

function buildProviderResultReference({
  adapterStatus,
  deliveryMetadataSummary,
  externalDeliveryReference = null,
  telegramApiSummary = null,
}) {
  return freezeSortedAdapterValue({
    adapter_name: TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_NAME,
    adapter_outcome: adapterStatus,
    adapter_version: TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_VERSION,
    delivery_metadata_summary: deliveryMetadataSummary,
    external_delivery_reference: externalDeliveryReference,
    provider: 'telegram_bot_api',
    telegram_api_summary: telegramApiSummary,
  });
}

function buildAdapterResult({
  adapterStatus,
  blockedReason = null,
  deliveryMetadataSummary,
  externalDeliveryReference = null,
  failedReason = null,
  telegramApiSummary = null,
}) {
  return freezeSortedAdapterValue({
    adapter_name: TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_NAME,
    adapter_status: adapterStatus,
    adapter_version: TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_VERSION,
    blocked_reason: blockedReason,
    delivery_metadata_summary: deliveryMetadataSummary,
    external_delivery_reference: externalDeliveryReference,
    failed_reason: failedReason,
    outcome: adapterStatus,
    provider_result_reference: buildProviderResultReference({
      adapterStatus,
      deliveryMetadataSummary,
      externalDeliveryReference,
      telegramApiSummary,
    }),
    status: adapterStatus,
  });
}

function normalizeTelegramTransportResult(rawResult) {
  if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
    return {
      ok: false,
      status: null,
      errorCode: null,
      description: 'telegram_transport_invalid_response',
      result: null,
    };
  }

  const body = rawResult.body && typeof rawResult.body === 'object'
    ? rawResult.body
    : rawResult;

  return {
    ok: body.ok === true,
    status: rawResult.http_status ?? rawResult.status ?? body.status ?? null,
    errorCode: body.error_code ?? rawResult.error_code ?? null,
    description:
      normalizeString(body.description) ||
      normalizeString(rawResult.error_message) ||
      null,
    result: body.result || rawResult.result || null,
    transportOk: rawResult.transport_ok !== false,
  };
}

function buildTelegramApiSummary(telegramResult) {
  return freezeSortedAdapterValue({
    error_code: telegramResult.errorCode,
    http_status: telegramResult.status,
    ok: telegramResult.ok,
    provider_description: telegramResult.ok ? null : telegramResult.description,
    transport_ok: telegramResult.transportOk,
  });
}

function classifyTelegramApiFailure(telegramResult) {
  const description = String(telegramResult.description || '').toLowerCase();
  const errorCode = Number(telegramResult.errorCode || telegramResult.status || 0);

  if (
    errorCode === 403 &&
    (description.includes('bot was blocked') ||
      description.includes('blocked by the user') ||
      description.includes('user is deactivated'))
  ) {
    return {
      adapterStatus: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
      blockedReason: 'user_blocked_bot',
      failedReason: null,
    };
  }

  if (
    description.includes('chat not found') ||
    description.includes('user not found') ||
    description.includes('peer_id_invalid')
  ) {
    return {
      adapterStatus: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
      blockedReason: 'chat_not_found',
      failedReason: null,
    };
  }

  return {
    adapterStatus: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
    blockedReason: null,
    failedReason: 'telegram_api_failure',
  };
}

function buildInvalidInputResult({ failedReason, notificationType = null }) {
  const deliveryMetadataSummary = freezeSortedAdapterValue({
    adapter_name: TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_NAME,
    adapter_version: TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_VERSION,
    api_method: 'sendMessage',
    notification_type: notificationType,
    target_summary: {
      chat_id_kind: null,
      chat_target_present: false,
      target_source: null,
      target_type: null,
    },
    button_payload_summary: {
      row_count: 0,
      button_count: 0,
      inline_keyboard: false,
    },
    text_payload_summary: {
      format: 'plain_text',
      message_kind: 'service_message',
      text_length: 0,
    },
  });

  return buildAdapterResult({
    adapterStatus: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
    deliveryMetadataSummary,
    failedReason,
  });
}

function createSendMessageRequest({ chatId, text, replyMarkup = null }) {
  const request = {
    chat_id: chatId,
    text,
  };
  if (replyMarkup) {
    request.reply_markup = replyMarkup;
  }
  return request;
}

function sendTelegramBotApiRequestSync({
  apiBaseUrl,
  botToken,
  method,
  request,
  timeoutMs,
}) {
  const childInput = JSON.stringify({
    apiBaseUrl,
    botToken,
    method,
    request,
    timeoutMs,
  });
  const childScript = `
const input = await new Promise((resolve, reject) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => resolve(data));
  process.stdin.on('error', reject);
});
const payload = JSON.parse(input);
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), payload.timeoutMs);
let httpStatus = null;
try {
  const response = await fetch(
    \`\${payload.apiBaseUrl}/bot\${payload.botToken}/\${payload.method}\`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload.request),
      signal: controller.signal,
    }
  );
  httpStatus = response.status;
  const responseText = await response.text();
  let body = null;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch {
    body = { ok: false, description: 'telegram_api_non_json_response' };
  }
  process.stdout.write(JSON.stringify({
    transport_ok: true,
    http_status: httpStatus,
    body,
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    transport_ok: false,
    http_status: httpStatus,
    error_name: error?.name || null,
    error_message: error?.message || 'telegram_transport_error',
  }));
} finally {
  clearTimeout(timeout);
}
`;

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    encoding: 'utf8',
    input: childInput,
    timeout: timeoutMs + 1000,
    windowsHide: true,
  });

  if (child.error) {
    return {
      transport_ok: false,
      error_message: child.error.message || 'telegram_transport_error',
      http_status: null,
    };
  }
  if (child.status !== 0 && !child.stdout) {
    return {
      transport_ok: false,
      error_message: normalizeString(child.stderr) || 'telegram_transport_error',
      http_status: null,
    };
  }

  try {
    return JSON.parse(child.stdout || '{}');
  } catch {
    return {
      transport_ok: false,
      error_message: 'telegram_transport_invalid_json_response',
      http_status: null,
    };
  }
}

export function createTelegramBotApiSyncTransport({
  apiBaseUrl = TELEGRAM_BOT_API_BASE_URL,
  requestTimeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const timeoutMs = normalizeTimeoutMs(requestTimeoutMs);

  return Object.freeze({
    sendMessage({ botToken, request }) {
      return sendTelegramBotApiRequestSync({
        apiBaseUrl: normalizedApiBaseUrl,
        botToken,
        method: 'sendMessage',
        request,
        timeoutMs,
      });
    },
  });
}

export class TelegramBotApiNotificationDeliveryAdapter {
  constructor({
    apiBaseUrl = TELEGRAM_BOT_API_BASE_URL,
    botToken = process.env.TELEGRAM_BOT_TOKEN,
    requestTimeoutMs = DEFAULT_TIMEOUT_MS,
    transport = null,
  } = {}) {
    this.apiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
    this.botToken = normalizeBotToken(botToken);
    this.requestTimeoutMs = normalizeTimeoutMs(requestTimeoutMs);
    this.transport =
      transport ||
      createTelegramBotApiSyncTransport({
        apiBaseUrl: this.apiBaseUrl,
        requestTimeoutMs: this.requestTimeoutMs,
      });
  }

  describe() {
    return Object.freeze({
      serviceName: TELEGRAM_BOT_API_NOTIFICATION_DELIVERY_ADAPTER_NAME,
      status: 'telegram_bot_api_send_message_adapter_ready',
      dependencyKeys: ['telegramBotApiTransport'],
    });
  }

  executeTelegramNotificationDelivery(adapterInput = {}) {
    return this.deliverNotification(adapterInput);
  }

  deliverNotification(adapterInput = {}) {
    const normalizedInput = normalizeAdapterInput(adapterInput);
    if (!normalizedInput.valid) {
      return buildInvalidInputResult({
        failedReason: normalizedInput.failedReason,
        notificationType: normalizedInput.notificationType || null,
      });
    }

    const text = buildServiceMessageText(normalizedInput);
    const target = pickTelegramChatTarget(normalizedInput.deliveryTargetSummary);
    const replyMarkup = pickFutureReplyMarkup(normalizedInput.rawInput);
    const deliveryMetadataSummary = buildDeliveryMetadataSummary({
      normalizedInput,
      target,
      text,
      replyMarkup,
    });

    if (!target) {
      return buildAdapterResult({
        adapterStatus: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
        blockedReason: 'no_valid_chat_target',
        deliveryMetadataSummary,
      });
    }

    if (!this.botToken) {
      return buildAdapterResult({
        adapterStatus: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
        deliveryMetadataSummary,
        failedReason: 'telegram_bot_token_missing_or_invalid',
      });
    }

    let rawTransportResult = null;
    try {
      rawTransportResult = this.transport.sendMessage({
        botToken: this.botToken,
        request: createSendMessageRequest({
          chatId: target.chatId,
          text,
          replyMarkup,
        }),
      });
    } catch (error) {
      rawTransportResult = {
        transport_ok: false,
        error_message: error?.message || 'telegram_transport_error',
        http_status: null,
      };
    }

    const telegramResult = normalizeTelegramTransportResult(rawTransportResult);
    const telegramApiSummary = buildTelegramApiSummary(telegramResult);
    if (telegramResult.ok) {
      const externalDeliveryReference = buildExternalDeliveryReference({
        telegramResult: telegramResult.result,
        target,
      });

      return buildAdapterResult({
        adapterStatus: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
        deliveryMetadataSummary,
        externalDeliveryReference,
        telegramApiSummary,
      });
    }

    const classifiedFailure = classifyTelegramApiFailure(telegramResult);
    return buildAdapterResult({
      ...classifiedFailure,
      deliveryMetadataSummary,
      telegramApiSummary,
    });
  }

  execute(adapterInput = {}) {
    return this.executeTelegramNotificationDelivery(adapterInput);
  }
}

export function createTelegramBotApiNotificationDeliveryAdapter(options = {}) {
  return new TelegramBotApiNotificationDeliveryAdapter(options);
}
