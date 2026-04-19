import {
  SELLER_SOURCE_FAMILIES,
  TELEGRAM_SOURCE_FAMILIES,
  freezeTelegramHandoffValue,
} from '../../../shared/telegram/index.js';
import {
  TELEGRAM_GUEST_ENTRY_PERSISTENCE_RESULT_VERSION,
  TELEGRAM_GUEST_ENTRY_STATUS_RECORDED,
} from './guest-entry-persistence-service.js';
import {
  TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE,
  TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION,
} from './guest-entry-projection-service.js';
import {
  TELEGRAM_START_SOURCE_RESOLUTION_STATUSES,
  TELEGRAM_START_SOURCE_TOKEN_RESOLUTION_VERSION,
} from './start-source-token-resolution-service.js';

export const TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION =
  'telegram_source_binding_persistence_result.v1';
export const TELEGRAM_SOURCE_BINDING_EVENT_TYPE = 'SOURCE_BOUND';
export const TELEGRAM_SOURCE_BINDING_STATUSES = TELEGRAM_START_SOURCE_RESOLUTION_STATUSES;

const ERROR_PREFIX = '[TELEGRAM_SOURCE_BINDING_PERSISTENCE]';
const SERVICE_NAME = 'telegram_source_binding_persistence_service';
const OWNER_SOURCE_FAMILY = 'owner_source';
const GENERIC_SOURCE_FAMILIES = Object.freeze(
  TELEGRAM_SOURCE_FAMILIES.filter(
    (sourceFamily) => !SELLER_SOURCE_FAMILIES.includes(sourceFamily)
  )
);

function rejectSourceBinding(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectSourceBinding(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeSourceToken(value, label) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    rejectSourceBinding(`${label} must contain only letters, numbers, underscores, or hyphens`);
  }

  return normalized.toLowerCase();
}

function sortBindingValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortBindingValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortBindingValue(value[key])])
  );
}

function freezeSortedBindingValue(value) {
  return freezeTelegramHandoffValue(sortBindingValue(value));
}

function compareFrozenValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertSummaryObject(value, label, requiredFields) {
  if (!isPlainObject(value)) {
    rejectSourceBinding(`${label} is required`);
  }

  for (const field of requiredFields) {
    if (!normalizeOptionalString(value[field])) {
      rejectSourceBinding(`${label}.${field} is required`);
    }
  }
}

function assertNormalizedStartPayload(value) {
  if (!isPlainObject(value)) {
    rejectSourceBinding('guest-entry normalized_start_payload is required');
  }
  if (typeof value.has_payload !== 'boolean') {
    rejectSourceBinding('guest-entry normalized_start_payload.has_payload must be boolean');
  }
  if (value.has_payload && !normalizeOptionalString(value.normalized_payload)) {
    rejectSourceBinding(
      'guest-entry normalized_start_payload.normalized_payload is required when present'
    );
  }
}

function assertEventTimestampSummary(value, label) {
  if (!isPlainObject(value)) {
    rejectSourceBinding(`${label} is required`);
  }
  if (!Number.isInteger(value.unix_seconds) || value.unix_seconds <= 0) {
    rejectSourceBinding(`${label}.unix_seconds must be a usable integer`);
  }

  const iso = normalizeOptionalString(value.iso);
  if (!iso || Number.isNaN(Date.parse(iso))) {
    rejectSourceBinding(`${label}.iso must be a usable ISO timestamp`);
  }
}

function buildGuestEntryReference(reference) {
  if (!isPlainObject(reference)) {
    rejectSourceBinding('guest-entry persisted reference is required');
  }
  if (reference.reference_type !== 'telegram_guest_entry_event') {
    rejectSourceBinding(
      `Unsupported guest-entry reference type: ${reference.reference_type || 'unknown'}`
    );
  }

  return freezeSortedBindingValue({
    reference_type: 'telegram_guest_entry_event',
    guest_entry_event_id: normalizePositiveInteger(
      reference.guest_entry_event_id,
      'guest-entry reference'
    ),
    idempotency_key: normalizeOptionalString(reference.idempotency_key),
  });
}

function normalizeGuestEntryResult(guestEntryResult) {
  if (!isPlainObject(guestEntryResult)) {
    rejectSourceBinding('guest-entry result is required');
  }

  const responseVersion = guestEntryResult.response_version;
  const supportedResult =
    responseVersion === TELEGRAM_GUEST_ENTRY_PERSISTENCE_RESULT_VERSION ||
    responseVersion === TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION;
  if (!supportedResult) {
    rejectSourceBinding(
      `Unsupported guest-entry result version: ${responseVersion || 'unknown'}`
    );
  }
  if (
    responseVersion === TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION &&
    guestEntryResult.projection_item_type !== TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE
  ) {
    rejectSourceBinding('guest-entry projection item is required');
  }
  if (guestEntryResult.entry_status !== TELEGRAM_GUEST_ENTRY_STATUS_RECORDED) {
    rejectSourceBinding(
      `Unsupported guest-entry status: ${guestEntryResult.entry_status || 'unknown'}`
    );
  }

  assertSummaryObject(guestEntryResult.telegram_user_summary, 'telegram_user_summary', [
    'telegram_user_id',
  ]);
  assertNormalizedStartPayload(guestEntryResult.normalized_start_payload);
  assertEventTimestampSummary(
    guestEntryResult.event_timestamp_summary,
    'guest-entry event_timestamp_summary'
  );

  const guestEntryReference = buildGuestEntryReference(
    guestEntryResult.persisted_entry_reference
  );
  const idempotencyKey = normalizeOptionalString(guestEntryResult.idempotency_key);
  const dedupeKey = normalizeOptionalString(guestEntryResult.dedupe_key);
  if (!idempotencyKey || !dedupeKey || idempotencyKey !== dedupeKey) {
    rejectSourceBinding('guest-entry dedupe/idempotency key is required and must match');
  }
  if (guestEntryReference.idempotency_key !== idempotencyKey) {
    rejectSourceBinding('guest-entry reference idempotency key mismatch');
  }

  return freezeTelegramHandoffValue({
    response_version: responseVersion,
    entry_status: guestEntryResult.entry_status,
    telegram_user_summary: freezeSortedBindingValue(
      guestEntryResult.telegram_user_summary
    ),
    telegram_chat_summary: freezeSortedBindingValue(
      guestEntryResult.telegram_chat_summary || null
    ),
    normalized_start_payload: freezeSortedBindingValue(
      guestEntryResult.normalized_start_payload
    ),
    source_token: normalizeOptionalString(guestEntryResult.source_token),
    normalized_source_token: normalizeSourceToken(
      guestEntryResult.source_token,
      'guest-entry source_token'
    ),
    guest_entry_reference: guestEntryReference,
    guest_entry_event_id: guestEntryReference.guest_entry_event_id,
    dedupe_key: dedupeKey,
    idempotency_key: idempotencyKey,
    event_timestamp_summary: freezeSortedBindingValue(
      guestEntryResult.event_timestamp_summary
    ),
  });
}

function assertResolutionFamily({ resolutionStatus, sourceFamily }) {
  if (resolutionStatus === 'no_source_token' || resolutionStatus === 'unresolved_source_token') {
    if (sourceFamily !== null) {
      rejectSourceBinding(`${resolutionStatus} must not resolve a source family`);
    }
    return;
  }

  if (resolutionStatus === 'resolved_seller_source') {
    if (!SELLER_SOURCE_FAMILIES.includes(sourceFamily)) {
      rejectSourceBinding('resolved_seller_source requires a seller source family');
    }
    return;
  }

  if (resolutionStatus === 'resolved_owner_source') {
    if (sourceFamily !== OWNER_SOURCE_FAMILY) {
      rejectSourceBinding('resolved_owner_source requires owner_source family');
    }
    return;
  }

  if (resolutionStatus === 'resolved_generic_source') {
    if (!GENERIC_SOURCE_FAMILIES.includes(sourceFamily)) {
      rejectSourceBinding('resolved_generic_source requires a generic source family');
    }
  }
}

function normalizeSourceResolutionResult(sourceResolutionResult) {
  if (!isPlainObject(sourceResolutionResult)) {
    rejectSourceBinding('source-resolution result is required');
  }
  if (
    sourceResolutionResult.response_version !==
    TELEGRAM_START_SOURCE_TOKEN_RESOLUTION_VERSION
  ) {
    rejectSourceBinding(
      `Unsupported source-resolution result version: ${sourceResolutionResult.response_version || 'unknown'}`
    );
  }
  if (sourceResolutionResult.read_only !== true) {
    rejectSourceBinding('source-resolution result must be read-only');
  }

  const resolutionStatus = normalizeOptionalString(
    sourceResolutionResult.resolution_status
  );
  if (!TELEGRAM_START_SOURCE_RESOLUTION_STATUSES.includes(resolutionStatus)) {
    rejectSourceBinding(
      `Unsupported source resolution outcome: ${resolutionStatus || 'unknown'}`
    );
  }

  const rawSourceToken = normalizeOptionalString(
    sourceResolutionResult.raw_source_token
  );
  const normalizedSourceToken = normalizeSourceToken(
    sourceResolutionResult.normalized_source_token,
    'source-resolution normalized_source_token'
  );
  const hasSourceToken = Boolean(sourceResolutionResult.has_source_token);
  const sourceFamily = normalizeOptionalString(sourceResolutionResult.source_family);
  const sourceResolutionReason = normalizeOptionalString(
    sourceResolutionResult.source_resolution_reason
  );

  if (resolutionStatus === 'no_source_token') {
    if (hasSourceToken || rawSourceToken || normalizedSourceToken) {
      rejectSourceBinding('no_source_token must not carry a source token');
    }
  } else if (!hasSourceToken || !rawSourceToken || !normalizedSourceToken) {
    rejectSourceBinding(`${resolutionStatus} requires a source token`);
  }

  assertResolutionFamily({ resolutionStatus, sourceFamily });

  return freezeTelegramHandoffValue({
    response_version: sourceResolutionResult.response_version,
    resolution_status: resolutionStatus,
    raw_source_token: rawSourceToken,
    normalized_source_token: normalizedSourceToken,
    has_source_token: hasSourceToken,
    source_family: sourceFamily,
    source_resolution_reason: sourceResolutionReason,
    resolution_input_kind: normalizeOptionalString(
      sourceResolutionResult.resolution_input_kind
    ),
    resolved_by: normalizeOptionalString(sourceResolutionResult.resolved_by),
  });
}

function assertGuestEntryMatchesPersistedRow(row, normalizedGuestEntry) {
  if (!row) {
    rejectSourceBinding(
      `Guest-entry event not found: ${normalizedGuestEntry.guest_entry_event_id}`
    );
  }
  if (row.entry_status !== TELEGRAM_GUEST_ENTRY_STATUS_RECORDED) {
    rejectSourceBinding(
      `Persisted guest-entry status is unsupported: ${row.entry_status || 'unknown'}`
    );
  }
  if (row.idempotency_key !== normalizedGuestEntry.idempotency_key) {
    rejectSourceBinding(
      `Persisted guest-entry idempotency key mismatch: ${normalizedGuestEntry.guest_entry_event_id}`
    );
  }
  if (row.dedupe_key !== normalizedGuestEntry.dedupe_key) {
    rejectSourceBinding(
      `Persisted guest-entry dedupe key mismatch: ${normalizedGuestEntry.guest_entry_event_id}`
    );
  }

  const comparableFields = [
    'telegram_user_summary',
    'telegram_chat_summary',
    'normalized_start_payload',
    'source_token',
    'event_timestamp_summary',
  ];
  for (const field of comparableFields) {
    if (!compareFrozenValues(row[field] ?? null, normalizedGuestEntry[field] ?? null)) {
      rejectSourceBinding(
        `Persisted guest-entry payload mismatch for ${field}: ${normalizedGuestEntry.guest_entry_event_id}`
      );
    }
  }
}

function assertGuestEntryMatchesSourceResolution(normalizedGuestEntry, sourceResolution) {
  if (normalizedGuestEntry.normalized_source_token !== sourceResolution.normalized_source_token) {
    rejectSourceBinding('guest-entry source token does not match source resolution');
  }
  if (
    sourceResolution.raw_source_token !== null &&
    normalizedGuestEntry.source_token !== sourceResolution.raw_source_token
  ) {
    rejectSourceBinding('guest-entry raw source token does not match source resolution');
  }
}

function buildDedupeKey(normalizedGuestEntry) {
  return `telegram_source_binding:guest_entry_event=${normalizedGuestEntry.guest_entry_event_id}`;
}

function buildSourceResolutionSummary(sourceResolution) {
  return freezeSortedBindingValue({
    response_version: sourceResolution.response_version,
    resolution_status: sourceResolution.resolution_status,
    source_resolution_reason: sourceResolution.source_resolution_reason,
    resolution_input_kind: sourceResolution.resolution_input_kind,
    resolved_by: sourceResolution.resolved_by,
  });
}

function buildNoOpGuards() {
  return freezeTelegramHandoffValue({
    seller_attribution_created: false,
    booking_created: false,
    production_webhook_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  });
}

function normalizeBindingInput({ guestEntryResult, sourceResolutionResult }) {
  const normalizedGuestEntry = normalizeGuestEntryResult(guestEntryResult);
  const sourceResolution = normalizeSourceResolutionResult(sourceResolutionResult);

  assertGuestEntryMatchesSourceResolution(normalizedGuestEntry, sourceResolution);

  const dedupeKey = buildDedupeKey(normalizedGuestEntry);
  const sourceResolutionSummary = buildSourceResolutionSummary(sourceResolution);
  const noOpGuards = buildNoOpGuards();
  const bindingSignature = freezeSortedBindingValue({
    response_version: TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION,
    event_type: TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
    binding_status: sourceResolution.resolution_status,
    telegram_user_summary: normalizedGuestEntry.telegram_user_summary,
    guest_entry_reference: normalizedGuestEntry.guest_entry_reference,
    raw_source_token: sourceResolution.raw_source_token,
    normalized_source_token: sourceResolution.normalized_source_token,
    resolved_source_family: sourceResolution.source_family,
    source_resolution_outcome: sourceResolution.resolution_status,
    source_resolution_summary: sourceResolutionSummary,
    guest_entry_event_timestamp_summary:
      normalizedGuestEntry.event_timestamp_summary,
    dedupe_key: dedupeKey,
    idempotency_key: dedupeKey,
    no_op_guards: noOpGuards,
  });

  return freezeTelegramHandoffValue({
    guest_entry_event_id: normalizedGuestEntry.guest_entry_event_id,
    event_type: TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
    binding_status: sourceResolution.resolution_status,
    telegram_user_summary: normalizedGuestEntry.telegram_user_summary,
    guest_entry_reference: normalizedGuestEntry.guest_entry_reference,
    raw_source_token: sourceResolution.raw_source_token,
    normalized_source_token: sourceResolution.normalized_source_token,
    resolved_source_family: sourceResolution.source_family,
    source_resolution_outcome: sourceResolution.resolution_status,
    source_resolution_summary: sourceResolutionSummary,
    guest_entry_event_timestamp_summary:
      normalizedGuestEntry.event_timestamp_summary,
    dedupe_key: dedupeKey,
    idempotency_key: dedupeKey,
    no_op_guards: noOpGuards,
    binding_signature: bindingSignature,
    normalized_guest_entry: normalizedGuestEntry,
  });
}

function buildSourceBindingReference(row) {
  return freezeTelegramHandoffValue({
    reference_type: 'telegram_guest_entry_source_binding_event',
    source_binding_event_id: row.source_binding_event_id,
    guest_entry_event_id: row.guest_entry_event_id,
    event_type: row.event_type,
    idempotency_key: row.idempotency_key,
  });
}

function buildResultFromRow(row) {
  return freezeTelegramHandoffValue({
    response_version:
      row.binding_payload?.response_version ||
      TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION,
    binding_status: row.binding_status,
    telegram_user_summary: row.telegram_user_summary || null,
    guest_entry_reference: row.guest_entry_reference || null,
    source_binding_reference: buildSourceBindingReference(row),
    raw_source_token: row.raw_source_token || null,
    normalized_source_token: row.normalized_source_token || null,
    resolved_source_family: row.resolved_source_family || null,
    source_resolution_outcome: row.source_resolution_outcome,
    source_resolution_summary: row.source_resolution_summary || null,
    dedupe_key: row.dedupe_key,
    idempotency_key: row.idempotency_key,
    event_timestamp_summary: row.event_timestamp_summary || null,
  });
}

function buildEventTimestampSummary(eventAt, normalizedBinding) {
  const parsedEventAt = Date.parse(eventAt);

  return freezeSortedBindingValue({
    source_binding_event_timestamp: {
      unix_seconds: Math.floor(parsedEventAt / 1000),
      iso: eventAt,
    },
    guest_entry_event_timestamp:
      normalizedBinding.guest_entry_event_timestamp_summary,
  });
}

function pickBindingInputs(input, sourceResolutionResult) {
  if (sourceResolutionResult !== undefined) {
    return {
      guestEntryResult: input,
      sourceResolutionResult,
    };
  }

  if (!isPlainObject(input)) {
    rejectSourceBinding('source-binding input is required');
  }

  const guestEntryResult =
    input.guest_entry_result ??
    input.guestEntryResult ??
    input.guest_entry ??
    input.guestEntry ??
    input.guest_entry_projection_item ??
    input.guestEntryProjectionItem;
  const pickedSourceResolutionResult =
    input.source_resolution_result ??
    input.sourceResolutionResult ??
    input.source_resolution ??
    input.sourceResolution ??
    input.start_source_resolution_result ??
    input.startSourceResolutionResult;

  return {
    guestEntryResult,
    sourceResolutionResult: pickedSourceResolutionResult,
  };
}

export class TelegramSourceBindingPersistenceService {
  constructor({ guestEntryEvents, guestEntrySourceBindingEvents, now = () => new Date() }) {
    this.guestEntryEvents = guestEntryEvents;
    this.guestEntrySourceBindingEvents = guestEntrySourceBindingEvents;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'source-binding-persistence-service',
      status: 'persistence_only_ready',
      dependencyKeys: ['guestEntryEvents', 'guestEntrySourceBindingEvents'],
    });
  }

  nowIso() {
    return this.now().toISOString();
  }

  get db() {
    return this.guestEntrySourceBindingEvents?.db || null;
  }

  resolveIdempotentBindingEvent(normalizedBinding) {
    const existingEvent = this.guestEntrySourceBindingEvents.findOneBy(
      { idempotency_key: normalizedBinding.idempotency_key },
      { orderBy: 'source_binding_event_id ASC' }
    );
    if (!existingEvent) {
      return null;
    }

    if (
      compareFrozenValues(
        existingEvent.binding_signature,
        normalizedBinding.binding_signature
      )
    ) {
      return existingEvent;
    }

    rejectSourceBinding(
      `Idempotency conflict for source binding: ${normalizedBinding.idempotency_key}`
    );
  }

  createSourceBindingEvent(normalizedBinding) {
    const eventAt = this.nowIso();
    const eventTimestampSummary = buildEventTimestampSummary(eventAt, normalizedBinding);

    return this.guestEntrySourceBindingEvents.create({
      guest_entry_event_id: normalizedBinding.guest_entry_event_id,
      event_type: normalizedBinding.event_type,
      binding_status: normalizedBinding.binding_status,
      telegram_user_summary: normalizedBinding.telegram_user_summary,
      guest_entry_reference: normalizedBinding.guest_entry_reference,
      raw_source_token: normalizedBinding.raw_source_token,
      normalized_source_token: normalizedBinding.normalized_source_token,
      resolved_source_family: normalizedBinding.resolved_source_family,
      source_resolution_outcome: normalizedBinding.source_resolution_outcome,
      source_resolution_summary: normalizedBinding.source_resolution_summary,
      event_at: eventAt,
      event_timestamp_summary: eventTimestampSummary,
      binding_payload: {
        response_version: TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION,
        source_binding_persistence_source: SERVICE_NAME,
        persistence_only: true,
        no_op_guards: normalizedBinding.no_op_guards,
      },
      idempotency_key: normalizedBinding.idempotency_key,
      dedupe_key: normalizedBinding.dedupe_key,
      binding_signature: normalizedBinding.binding_signature,
    });
  }

  persistSourceBinding(input = {}, sourceResolutionResult = undefined) {
    const runPersistence = () => {
      const normalizedBinding = normalizeBindingInput(
        pickBindingInputs(input, sourceResolutionResult)
      );
      const guestEntryRow = this.guestEntryEvents.getById(
        normalizedBinding.guest_entry_event_id
      );
      assertGuestEntryMatchesPersistedRow(
        guestEntryRow,
        normalizedBinding.normalized_guest_entry
      );

      const idempotentEvent = this.resolveIdempotentBindingEvent(normalizedBinding);
      if (idempotentEvent) {
        return buildResultFromRow(idempotentEvent);
      }

      return buildResultFromRow(this.createSourceBindingEvent(normalizedBinding));
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runPersistence)();
    }

    return runPersistence();
  }

  persistGuestEntrySourceBinding(input = {}, sourceResolutionResult = undefined) {
    return this.persistSourceBinding(input, sourceResolutionResult);
  }

  persistBinding(input = {}, sourceResolutionResult = undefined) {
    return this.persistSourceBinding(input, sourceResolutionResult);
  }
}
