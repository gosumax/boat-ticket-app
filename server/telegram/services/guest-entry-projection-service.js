import { freezeTelegramHandoffValue } from '../../../shared/telegram/index.js';
import {
  TELEGRAM_GUEST_ENTRY_PERSISTENCE_RESULT_VERSION,
  TELEGRAM_GUEST_ENTRY_STATUS_RECORDED,
} from './guest-entry-persistence-service.js';

export const TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION =
  'telegram_guest_entry_projection.v1';
export const TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE =
  'telegram_guest_entry_projection_item';

const ERROR_PREFIX = '[TELEGRAM_GUEST_ENTRY_PROJECTION]';
const SERVICE_NAME = 'telegram_guest_entry_projection_service';
const PERSISTENCE_SOURCE = 'telegram_guest_entry_persistence_service';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_SCAN_LIMIT = 1000;
const MAX_SCAN_LIMIT = 2000;

function rejectGuestEntryProjection(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectGuestEntryProjection(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeLimit(value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function compareStableValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildNoOpGuards() {
  return freezeTelegramHandoffValue({
    source_binding_created: false,
    seller_attribution_created: false,
    booking_created: false,
    production_webhook_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  });
}

function buildPersistedEntryReference(row) {
  return freezeTelegramHandoffValue({
    reference_type: 'telegram_guest_entry_event',
    guest_entry_event_id: row.guest_entry_event_id,
    idempotency_key: row.idempotency_key,
  });
}

function pickTelegramUserId(input = {}) {
  const value =
    input.telegram_user_id ??
    input.telegramUserId ??
    input.telegram_guest_id ??
    input.telegramGuestId ??
    input.guest?.telegram_user_id ??
    input.guest?.telegramUserId ??
    input.telegram_user_summary?.telegram_user_id ??
    input.telegramUserSummary?.telegram_user_id ??
    input.telegramUserSummary?.telegramUserId;
  const telegramUserId = normalizeString(value);
  if (!telegramUserId) {
    rejectGuestEntryProjection('telegram_user_id is required');
  }

  return telegramUserId;
}

function pickGuestEntryEventId(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return normalizePositiveInteger(input, 'guest-entry reference');
  }

  const directValue =
    input.guest_entry_event_id ??
    input.guestEntryEventId ??
    input.event_id ??
    input.eventId;

  if (directValue !== undefined && directValue !== null) {
    return normalizePositiveInteger(directValue, 'guest-entry reference');
  }

  const reference =
    input.persisted_entry_reference ??
    input.persistedEntryReference ??
    input.entry_reference ??
    input.entryReference ??
    input.guest_entry_reference ??
    input.guestEntryReference ??
    input.guest_entry_item?.persisted_entry_reference ??
    input.guestEntryItem?.persisted_entry_reference ??
    input.guestEntryItem?.persistedEntryReference;

  if (!reference?.guest_entry_event_id) {
    rejectGuestEntryProjection('guest-entry persisted reference is required');
  }

  if (
    reference.reference_type &&
    reference.reference_type !== 'telegram_guest_entry_event'
  ) {
    rejectGuestEntryProjection(
      `Unsupported guest-entry reference type: ${reference.reference_type}`
    );
  }

  return normalizePositiveInteger(
    reference.guest_entry_event_id,
    'guest-entry reference'
  );
}

function pickExpectedIdempotencyKey(input = {}) {
  const reference =
    input.persisted_entry_reference ??
    input.persistedEntryReference ??
    input.entry_reference ??
    input.entryReference ??
    input.guest_entry_reference ??
    input.guestEntryReference ??
    input.guest_entry_item?.persisted_entry_reference ??
    input.guestEntryItem?.persisted_entry_reference ??
    input.guestEntryItem?.persistedEntryReference;

  return normalizeString(
    input.idempotency_key ??
      input.idempotencyKey ??
      reference?.idempotency_key ??
      reference?.idempotencyKey
  );
}

function assertSummaryObject(value, label, requiredFields) {
  if (!isPlainObject(value)) {
    rejectGuestEntryProjection(`${label} is required`);
  }

  for (const field of requiredFields) {
    if (!normalizeString(value[field])) {
      rejectGuestEntryProjection(`${label}.${field} is required`);
    }
  }

  return true;
}

function assertEventTimestampSummary(value) {
  if (!isPlainObject(value)) {
    rejectGuestEntryProjection('event_timestamp_summary is required');
  }
  if (!Number.isInteger(value.unix_seconds) || value.unix_seconds <= 0) {
    rejectGuestEntryProjection(
      'event_timestamp_summary.unix_seconds must be a usable integer'
    );
  }

  const iso = normalizeString(value.iso);
  if (!iso || Number.isNaN(Date.parse(iso))) {
    rejectGuestEntryProjection(
      'event_timestamp_summary.iso must be a usable ISO timestamp'
    );
  }

  return true;
}

function assertNormalizedStartPayload(value) {
  if (!isPlainObject(value)) {
    rejectGuestEntryProjection('normalized_start_payload is required');
  }
  if (typeof value.has_payload !== 'boolean') {
    rejectGuestEntryProjection(
      'normalized_start_payload.has_payload must be boolean'
    );
  }
  if (value.has_payload && !normalizeString(value.normalized_payload)) {
    rejectGuestEntryProjection(
      'normalized_start_payload.normalized_payload is required when present'
    );
  }

  return true;
}

function assertSignatureMatchesRow(row) {
  const signature = row.entry_signature;
  if (!isPlainObject(signature)) {
    rejectGuestEntryProjection(
      `Guest-entry event is not projectable: ${row.guest_entry_event_id}`
    );
  }
  if (
    signature.response_version !== TELEGRAM_GUEST_ENTRY_PERSISTENCE_RESULT_VERSION
  ) {
    rejectGuestEntryProjection(
      `Guest-entry event persistence version is not projectable: ${row.guest_entry_event_id}`
    );
  }

  const expectedFields = [
    'entry_status',
    'telegram_user_summary',
    'telegram_chat_summary',
    'normalized_start_payload',
    'source_token',
    'event_timestamp_summary',
    'dedupe_key',
    'idempotency_key',
  ];

  for (const field of expectedFields) {
    if (!compareStableValues(signature[field], row[field])) {
      rejectGuestEntryProjection(
        `Guest-entry event signature mismatch for ${field}: ${row.guest_entry_event_id}`
      );
    }
  }

  return true;
}

function assertProjectableGuestEntryEvent(row) {
  if (!row) {
    rejectGuestEntryProjection('Guest-entry item not found');
  }
  if (row.entry_status !== TELEGRAM_GUEST_ENTRY_STATUS_RECORDED) {
    rejectGuestEntryProjection(
      `Unsupported guest-entry status: ${row.entry_status || 'unknown'}`
    );
  }

  assertSummaryObject(row.telegram_user_summary, 'telegram_user_summary', [
    'telegram_user_id',
  ]);
  assertSummaryObject(row.telegram_chat_summary, 'telegram_chat_summary', [
    'telegram_chat_id',
    'chat_type',
  ]);
  assertNormalizedStartPayload(row.normalized_start_payload);
  assertEventTimestampSummary(row.event_timestamp_summary);

  const dedupeKey = normalizeString(row.dedupe_key);
  const idempotencyKey = normalizeString(row.idempotency_key);
  if (!dedupeKey || !idempotencyKey || dedupeKey !== idempotencyKey) {
    rejectGuestEntryProjection(
      `Guest-entry dedupe/idempotency key is invalid: ${row.guest_entry_event_id}`
    );
  }

  if (row.entry_payload?.guest_entry_persistence_source !== PERSISTENCE_SOURCE) {
    rejectGuestEntryProjection(
      `Guest-entry event source is not projectable: ${row.guest_entry_event_id}`
    );
  }

  assertSignatureMatchesRow(row);
  return true;
}

function compareGuestEntryRows(left, right) {
  const leftTime = Date.parse(left.event_timestamp_summary.iso);
  const rightTime = Date.parse(right.event_timestamp_summary.iso);

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return Number(left.guest_entry_event_id) - Number(right.guest_entry_event_id);
}

function buildProjectionItem(row) {
  assertProjectableGuestEntryEvent(row);

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION,
    projection_item_type: TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE,
    entry_status: row.entry_status,
    telegram_user_summary: row.telegram_user_summary,
    telegram_chat_summary: row.telegram_chat_summary,
    normalized_start_payload: row.normalized_start_payload,
    source_token: row.source_token || null,
    persisted_entry_reference: buildPersistedEntryReference(row),
    dedupe_key: row.dedupe_key,
    idempotency_key: row.idempotency_key,
    event_timestamp_summary: row.event_timestamp_summary,
    read_only: true,
    projection_only: true,
    projected_by: SERVICE_NAME,
    no_op_guards: buildNoOpGuards(),
  });
}

export class TelegramGuestEntryProjectionService {
  constructor({ guestEntryEvents }) {
    this.guestEntryEvents = guestEntryEvents;
  }

  describe() {
    return Object.freeze({
      serviceName: 'guest-entry-projection-service',
      status: 'read_only_guest_entry_projection_ready',
      dependencyKeys: ['guestEntryEvents'],
    });
  }

  get db() {
    return this.guestEntryEvents?.db || null;
  }

  listPersistedGuestEntryEvents({ scanLimit = DEFAULT_SCAN_LIMIT } = {}) {
    this.guestEntryEvents.assertReady();
    const normalizedScanLimit = normalizeLimit(
      scanLimit,
      DEFAULT_SCAN_LIMIT,
      MAX_SCAN_LIMIT
    );
    const { tableName, idColumn } = this.guestEntryEvents;

    return this.db
      .prepare(
        `
          SELECT *
          FROM ${tableName}
          ORDER BY ${idColumn} ASC
          LIMIT ?
        `
      )
      .all(normalizedScanLimit)
      .map((row) => this.guestEntryEvents.deserializeRow(row));
  }

  listGuestEntryHistoryForTelegramGuest(input = {}) {
    const telegramUserId = pickTelegramUserId(input);
    const limit = normalizeLimit(input.limit);
    const rows = this.listPersistedGuestEntryEvents({
      scanLimit: input.scanLimit ?? input.scan_limit,
    })
      .filter(
        (row) =>
          normalizeString(row.telegram_user_summary?.telegram_user_id) ===
          telegramUserId
      )
      .map((row) => {
        assertProjectableGuestEntryEvent(row);
        return row;
      })
      .sort(compareGuestEntryRows)
      .slice(0, limit);

    const items = rows.map((row) => buildProjectionItem(row));

    return freezeTelegramHandoffValue({
      response_version: TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION,
      read_only: true,
      projection_only: true,
      source: 'persisted_telegram_guest_entry_events',
      telegram_user_id: telegramUserId,
      history_order: 'event_timestamp_asc_guest_entry_event_id_asc',
      items,
      item_count: items.length,
      no_op_guards: buildNoOpGuards(),
    });
  }

  readGuestEntryItemByPersistedReference(input = {}) {
    const guestEntryEventId = pickGuestEntryEventId(input);
    const expectedIdempotencyKey = pickExpectedIdempotencyKey(input);
    const row = this.guestEntryEvents.getById(guestEntryEventId);
    const item = buildProjectionItem(row);

    if (
      expectedIdempotencyKey &&
      item.idempotency_key !== expectedIdempotencyKey
    ) {
      rejectGuestEntryProjection(
        `Guest-entry reference idempotency key mismatch: ${guestEntryEventId}`
      );
    }

    return item;
  }

  readLatestGuestEntryForTelegramGuest(input = {}) {
    const history = this.listGuestEntryHistoryForTelegramGuest(input);
    return history.items.at(-1) || null;
  }

  listGuestEntryHistory(input = {}) {
    return this.listGuestEntryHistoryForTelegramGuest(input);
  }

  listGuestEntries(input = {}) {
    return this.listGuestEntryHistoryForTelegramGuest(input);
  }

  readGuestEntryItem(input = {}) {
    return this.readGuestEntryItemByPersistedReference(input);
  }

  readGuestEntry(input = {}) {
    return this.readGuestEntryItemByPersistedReference(input);
  }

  readLatestGuestEntry(input = {}) {
    return this.readLatestGuestEntryForTelegramGuest(input);
  }
}
