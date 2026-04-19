import { freezeTelegramHandoffValue } from '../../../shared/telegram/index.js';

export const TELEGRAM_START_UPDATE_NORMALIZED_EVENT_TYPE = 'telegram.inbound_start_message.v1';

const TELEGRAM_START_UPDATE_ERROR_PREFIX = '[TELEGRAM_START_UPDATE_NORMALIZATION]';

function rejectStartUpdate(message) {
  throw new Error(`${TELEGRAM_START_UPDATE_ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTelegramId(value, label, { allowNegative = false } = {}) {
  const normalized = typeof value === 'number' ? String(value) : String(value || '').trim();
  const idPattern = allowNegative ? /^-?[1-9]\d*$/ : /^[1-9]\d*$/;

  if (!idPattern.test(normalized)) {
    rejectStartUpdate(`${label} must be a usable Telegram id`);
  }

  return normalized;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeTelegramUser(user) {
  if (!isPlainObject(user)) {
    rejectStartUpdate('message.from must contain a usable Telegram user');
  }

  const telegramUserId = normalizeTelegramId(user.id, 'message.from.id');
  const firstName = normalizeOptionalString(user.first_name);
  const lastName = normalizeOptionalString(user.last_name);
  const username = normalizeOptionalString(user.username);
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || username || telegramUserId;

  return {
    telegram_user_id: telegramUserId,
    is_bot: Boolean(user.is_bot),
    first_name: firstName,
    last_name: lastName,
    username,
    language_code: normalizeOptionalString(user.language_code),
    display_name: displayName,
  };
}

function normalizeTelegramChat(chat) {
  if (!isPlainObject(chat)) {
    rejectStartUpdate('message.chat must contain a usable Telegram chat');
  }

  const chatType = normalizeOptionalString(chat.type);
  if (!chatType) {
    rejectStartUpdate('message.chat.type must be a usable Telegram chat type');
  }

  const telegramChatId = normalizeTelegramId(chat.id, 'message.chat.id', {
    allowNegative: true,
  });
  const firstName = normalizeOptionalString(chat.first_name);
  const lastName = normalizeOptionalString(chat.last_name);
  const title = normalizeOptionalString(chat.title);
  const username = normalizeOptionalString(chat.username);
  const displayName =
    title || [firstName, lastName].filter(Boolean).join(' ') || username || telegramChatId;

  return {
    telegram_chat_id: telegramChatId,
    chat_type: chatType,
    title,
    username,
    first_name: firstName,
    last_name: lastName,
    display_name: displayName,
  };
}

function parseStartCommand(text) {
  if (typeof text !== 'string' || !text.trim()) {
    rejectStartUpdate('message.text must contain /start');
  }

  const match = text.trim().match(/^\/start(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/);
  if (!match) {
    rejectStartUpdate('Unsupported message without /start command');
  }

  const payloadText = normalizeOptionalString(match[2]);
  const sourceToken =
    payloadText && /^[A-Za-z0-9_-]+$/.test(payloadText) ? payloadText : null;

  return {
    start_command_present: true,
    command: '/start',
    bot_username: normalizeOptionalString(match[1]),
    start_payload: payloadText
      ? {
          raw_payload: payloadText,
          normalized_payload: payloadText,
          has_payload: true,
        }
      : {
          raw_payload: null,
          normalized_payload: null,
          has_payload: false,
        },
    source_token: sourceToken,
  };
}

function normalizeMessageTimestamp(dateValue) {
  if (!Number.isInteger(dateValue) || dateValue <= 0) {
    rejectStartUpdate('message.date must be a usable unix timestamp');
  }

  return {
    unix_seconds: dateValue,
    iso: new Date(dateValue * 1000).toISOString(),
  };
}

function normalizeUpdateId(updateId) {
  if (!Number.isInteger(updateId) || updateId < 0) {
    rejectStartUpdate('update_id must be a usable Telegram update id');
  }

  return updateId;
}

function normalizeMessageId(messageId) {
  if (!Number.isInteger(messageId) || messageId <= 0) {
    rejectStartUpdate('message.message_id must be a usable Telegram message id');
  }

  return messageId;
}

function buildRawReferenceSummary(update, message) {
  return {
    raw_update_type: 'message',
    telegram_update_id: update.update_id,
    telegram_message_id: message.message_id,
    telegram_chat_id: String(message.chat.id),
    telegram_user_id: String(message.from.id),
    update_keys: Object.keys(update).sort(),
    message_keys: Object.keys(message).sort(),
  };
}

export class TelegramStartUpdateNormalizationService {
  describe() {
    return Object.freeze({
      serviceName: 'start-update-normalization-service',
      status: 'stateless_start_update_normalization_ready',
      dependencyKeys: [],
    });
  }

  normalizeStartUpdate(rawUpdate) {
    if (!isPlainObject(rawUpdate)) {
      rejectStartUpdate('raw update must be an object');
    }

    if (!isPlainObject(rawUpdate.message)) {
      rejectStartUpdate('Unsupported non-message update');
    }

    const message = rawUpdate.message;
    const telegramUpdateId = normalizeUpdateId(rawUpdate.update_id);
    const telegramMessageId = normalizeMessageId(message.message_id);
    const telegramUser = normalizeTelegramUser(message.from);
    const telegramChat = normalizeTelegramChat(message.chat);
    const startCommand = parseStartCommand(message.text);
    const messageTimestamp = normalizeMessageTimestamp(message.date);

    return freezeTelegramHandoffValue({
      normalized_event_type: TELEGRAM_START_UPDATE_NORMALIZED_EVENT_TYPE,
      telegram_update_id: telegramUpdateId,
      telegram_message_id: telegramMessageId,
      telegram_user: telegramUser,
      telegram_chat: telegramChat,
      message_text: message.text,
      start_command_present: startCommand.start_command_present,
      start_command: {
        command: startCommand.command,
        bot_username: startCommand.bot_username,
      },
      normalized_start_payload: startCommand.start_payload,
      source_token: startCommand.source_token,
      message_timestamp: messageTimestamp,
      safe_raw_reference: buildRawReferenceSummary(rawUpdate, message),
    });
  }
}
