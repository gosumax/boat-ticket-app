import { freezeTelegramHandoffValue } from '../../../shared/telegram/index.js';
import {
  TELEGRAM_START_UPDATE_NORMALIZED_EVENT_TYPE,
} from './start-update-normalization-service.js';

export const TELEGRAM_GUEST_ENTRY_PERSISTENCE_RESULT_VERSION =
  'telegram_guest_entry_persistence_result.v1';
export const TELEGRAM_GUEST_ENTRY_STATUS_RECORDED = 'RECORDED';

const ERROR_PREFIX = '[TELEGRAM_GUEST_ENTRY_PERSISTENCE]';
const SERVICE_NAME = 'telegram_guest_entry_persistence_service';

function rejectGuestEntry(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function assertInteger(value, label, { allowZero = false } = {}) {
  if (!Number.isInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    rejectGuestEntry(`${label} must be a usable integer`);
  }

  return value;
}

function sortEntryValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortEntryValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortEntryValue(value[key])])
  );
}

function freezeSortedEntryValue(value) {
  return freezeTelegramHandoffValue(sortEntryValue(value));
}

function compareFrozenValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildTelegramUserSummary(telegramUser) {
  if (!isPlainObject(telegramUser)) {
    rejectGuestEntry('telegram_user summary is required');
  }

  const telegramUserId = normalizeString(telegramUser.telegram_user_id);
  if (!telegramUserId) {
    rejectGuestEntry('telegram_user.telegram_user_id is required');
  }

  return freezeSortedEntryValue({
    telegram_user_id: telegramUserId,
    is_bot: Boolean(telegramUser.is_bot),
    first_name: normalizeString(telegramUser.first_name),
    last_name: normalizeString(telegramUser.last_name),
    username: normalizeString(telegramUser.username),
    language_code: normalizeString(telegramUser.language_code),
    display_name: normalizeString(telegramUser.display_name) || telegramUserId,
  });
}

function buildTelegramChatSummary(telegramChat) {
  if (!isPlainObject(telegramChat)) {
    rejectGuestEntry('telegram_chat summary is required');
  }

  const telegramChatId = normalizeString(telegramChat.telegram_chat_id);
  const chatType = normalizeString(telegramChat.chat_type);
  if (!telegramChatId) {
    rejectGuestEntry('telegram_chat.telegram_chat_id is required');
  }
  if (!chatType) {
    rejectGuestEntry('telegram_chat.chat_type is required');
  }

  return freezeSortedEntryValue({
    telegram_chat_id: telegramChatId,
    chat_type: chatType,
    title: normalizeString(telegramChat.title),
    username: normalizeString(telegramChat.username),
    first_name: normalizeString(telegramChat.first_name),
    last_name: normalizeString(telegramChat.last_name),
    display_name: normalizeString(telegramChat.display_name) || telegramChatId,
  });
}

function buildNormalizedStartPayload(payload) {
  if (!isPlainObject(payload)) {
    rejectGuestEntry('normalized_start_payload is required');
  }
  if (typeof payload.has_payload !== 'boolean') {
    rejectGuestEntry('normalized_start_payload.has_payload must be boolean');
  }

  const rawPayload = normalizeString(payload.raw_payload);
  const normalizedPayload = normalizeString(payload.normalized_payload);
  if (payload.has_payload && !normalizedPayload) {
    rejectGuestEntry('normalized_start_payload.normalized_payload is required when present');
  }

  return freezeSortedEntryValue({
    raw_payload: rawPayload,
    normalized_payload: normalizedPayload,
    has_payload: payload.has_payload,
  });
}

function buildEventTimestampSummary(messageTimestamp) {
  if (!isPlainObject(messageTimestamp)) {
    rejectGuestEntry('message_timestamp summary is required');
  }

  const unixSeconds = assertInteger(messageTimestamp.unix_seconds, 'message_timestamp.unix_seconds');
  const iso = normalizeString(messageTimestamp.iso);
  if (!iso || Number.isNaN(Date.parse(iso))) {
    rejectGuestEntry('message_timestamp.iso must be a usable ISO timestamp');
  }

  return freezeSortedEntryValue({
    unix_seconds: unixSeconds,
    iso,
  });
}

function buildEntryPayload(normalizedStartUpdate) {
  return freezeSortedEntryValue({
    normalized_event_type: normalizedStartUpdate.normalized_event_type,
    telegram_update_id: normalizedStartUpdate.telegram_update_id,
    telegram_message_id: normalizedStartUpdate.telegram_message_id,
    message_text: normalizeString(normalizedStartUpdate.message_text),
    start_command_present: normalizedStartUpdate.start_command_present,
    start_command: freezeSortedEntryValue(normalizedStartUpdate.start_command || {}),
    safe_raw_reference: freezeSortedEntryValue(normalizedStartUpdate.safe_raw_reference || {}),
  });
}

function buildIdempotencyKey({ telegramUpdateId, telegramMessageId }) {
  return `telegram_guest_entry:start_update=${telegramUpdateId}:message=${telegramMessageId}`;
}

function buildPersistedEntryReference(row) {
  return freezeTelegramHandoffValue({
    reference_type: 'telegram_guest_entry_event',
    guest_entry_event_id: row.guest_entry_event_id,
    idempotency_key: row.idempotency_key,
  });
}

function buildResultFromRow(row) {
  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_GUEST_ENTRY_PERSISTENCE_RESULT_VERSION,
    entry_status: row.entry_status,
    telegram_user_summary: row.telegram_user_summary || null,
    telegram_chat_summary: row.telegram_chat_summary || null,
    normalized_start_payload: row.normalized_start_payload || null,
    source_token: row.source_token || null,
    persisted_entry_reference: buildPersistedEntryReference(row),
    dedupe_key: row.dedupe_key,
    idempotency_key: row.idempotency_key,
    event_timestamp_summary: row.event_timestamp_summary || null,
  });
}

function normalizeStartEntryInput(normalizedStartUpdate) {
  if (!isPlainObject(normalizedStartUpdate)) {
    rejectGuestEntry('normalized /start event result is required');
  }
  if (normalizedStartUpdate.normalized_event_type !== TELEGRAM_START_UPDATE_NORMALIZED_EVENT_TYPE) {
    rejectGuestEntry(`Unsupported normalized event type: ${normalizedStartUpdate.normalized_event_type || 'unknown'}`);
  }
  if (normalizedStartUpdate.start_command_present !== true) {
    rejectGuestEntry('normalized /start command is required');
  }

  const telegramUpdateId = assertInteger(
    normalizedStartUpdate.telegram_update_id,
    'telegram_update_id',
    { allowZero: true }
  );
  const telegramMessageId = assertInteger(
    normalizedStartUpdate.telegram_message_id,
    'telegram_message_id'
  );
  const telegramUserSummary = buildTelegramUserSummary(normalizedStartUpdate.telegram_user);
  const telegramChatSummary = buildTelegramChatSummary(normalizedStartUpdate.telegram_chat);
  const normalizedStartPayload = buildNormalizedStartPayload(
    normalizedStartUpdate.normalized_start_payload
  );
  const eventTimestampSummary = buildEventTimestampSummary(
    normalizedStartUpdate.message_timestamp
  );
  const sourceToken = normalizeString(normalizedStartUpdate.source_token);
  const entryPayload = buildEntryPayload(normalizedStartUpdate);
  const idempotencyKey = buildIdempotencyKey({ telegramUpdateId, telegramMessageId });
  const entrySignature = freezeSortedEntryValue({
    response_version: TELEGRAM_GUEST_ENTRY_PERSISTENCE_RESULT_VERSION,
    entry_status: TELEGRAM_GUEST_ENTRY_STATUS_RECORDED,
    telegram_update_id: telegramUpdateId,
    telegram_message_id: telegramMessageId,
    telegram_user_summary: telegramUserSummary,
    telegram_chat_summary: telegramChatSummary,
    normalized_start_payload: normalizedStartPayload,
    source_token: sourceToken,
    event_timestamp_summary: eventTimestampSummary,
    entry_payload: entryPayload,
    dedupe_key: idempotencyKey,
    idempotency_key: idempotencyKey,
  });

  return freezeTelegramHandoffValue({
    entry_status: TELEGRAM_GUEST_ENTRY_STATUS_RECORDED,
    telegram_update_id: telegramUpdateId,
    telegram_message_id: telegramMessageId,
    telegram_user_summary: telegramUserSummary,
    telegram_chat_summary: telegramChatSummary,
    normalized_start_payload: normalizedStartPayload,
    source_token: sourceToken,
    event_timestamp_summary: eventTimestampSummary,
    entry_payload: entryPayload,
    dedupe_key: idempotencyKey,
    idempotency_key: idempotencyKey,
    entry_signature: entrySignature,
  });
}

export class TelegramGuestEntryPersistenceService {
  constructor({ guestEntryEvents }) {
    this.guestEntryEvents = guestEntryEvents;
  }

  describe() {
    return Object.freeze({
      serviceName: 'guest-entry-persistence-service',
      status: 'persistence_only_ready',
      dependencyKeys: ['guestEntryEvents'],
    });
  }

  get db() {
    return this.guestEntryEvents?.db || null;
  }

  resolveIdempotentEntry(normalizedEntry) {
    const existingEntry = this.guestEntryEvents.findOneBy(
      { idempotency_key: normalizedEntry.idempotency_key },
      { orderBy: 'guest_entry_event_id ASC' }
    );
    if (!existingEntry) {
      return null;
    }

    if (compareFrozenValues(existingEntry.entry_signature, normalizedEntry.entry_signature)) {
      return existingEntry;
    }

    rejectGuestEntry(
      `Idempotency conflict for guest entry: ${normalizedEntry.idempotency_key}`
    );
  }

  createEntry(normalizedEntry) {
    return this.guestEntryEvents.create({
      entry_status: normalizedEntry.entry_status,
      telegram_update_id: normalizedEntry.telegram_update_id,
      telegram_message_id: normalizedEntry.telegram_message_id,
      telegram_user_summary: normalizedEntry.telegram_user_summary,
      telegram_chat_summary: normalizedEntry.telegram_chat_summary,
      normalized_start_payload: normalizedEntry.normalized_start_payload,
      source_token: normalizedEntry.source_token,
      event_timestamp_summary: normalizedEntry.event_timestamp_summary,
      entry_payload: {
        ...normalizedEntry.entry_payload,
        guest_entry_persistence_source: SERVICE_NAME,
        persistence_only: true,
        no_op_guards: {
          source_binding_created: false,
          seller_attribution_created: false,
          booking_created: false,
          bot_handler_invoked: false,
          production_route_invoked: false,
          mini_app_ui_invoked: false,
          money_ledger_written: false,
        },
      },
      idempotency_key: normalizedEntry.idempotency_key,
      dedupe_key: normalizedEntry.dedupe_key,
      entry_signature: normalizedEntry.entry_signature,
    });
  }

  persistGuestEntry(normalizedStartUpdate) {
    const runPersistence = () => {
      const normalizedEntry = normalizeStartEntryInput(normalizedStartUpdate);
      const idempotentEntry = this.resolveIdempotentEntry(normalizedEntry);
      if (idempotentEntry) {
        return buildResultFromRow(idempotentEntry);
      }

      return buildResultFromRow(this.createEntry(normalizedEntry));
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runPersistence)();
    }

    return runPersistence();
  }

  persistStartGuestEntry(normalizedStartUpdate) {
    return this.persistGuestEntry(normalizedStartUpdate);
  }
}
