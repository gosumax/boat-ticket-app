import { freezeTelegramHandoffValue } from '../../../shared/telegram/index.js';
import {
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_START_RESULT_VERSION,
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_STARTED_EVENT_TYPE,
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_SKIPPED_EVENT_TYPE,
} from './seller-attribution-session-start-service.js';
import {
  TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
  TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION,
} from './source-binding-persistence-service.js';

export const TELEGRAM_SELLER_ATTRIBUTION_PROJECTION_VERSION =
  'telegram_seller_attribution_projection.v1';
export const TELEGRAM_SELLER_ATTRIBUTION_PROJECTION_STATUSES = Object.freeze([
  'ACTIVE',
  'NO_SELLER_ATTRIBUTION',
  'SELLER_ATTRIBUTION_EXPIRED',
  'SELLER_ATTRIBUTION_UNAVAILABLE',
]);

const ERROR_PREFIX = '[TELEGRAM_SELLER_ATTRIBUTION_PROJECTION]';
const SERVICE_NAME = 'telegram_seller_attribution_projection_service';
const ATTRIBUTION_EXPIRED_STATUS = 'SELLER_ATTRIBUTION_EXPIRED';
const ATTRIBUTION_UNAVAILABLE_STATUS = 'SELLER_ATTRIBUTION_UNAVAILABLE';
const NO_SELLER_ATTRIBUTION_STATUS = 'NO_SELLER_ATTRIBUTION';
const DEFAULT_SCAN_LIMIT = 1000;
const MAX_SCAN_LIMIT = 2000;

function rejectAttributionProjection(message) {
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
    rejectAttributionProjection(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeLimit(value, fallback = DEFAULT_SCAN_LIMIT, max = MAX_SCAN_LIMIT) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function normalizeBooleanFlag(value) {
  return value === true || value === 1;
}

function sortProjectionValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortProjectionValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortProjectionValue(value[key])])
  );
}

function freezeSortedProjectionValue(value) {
  return freezeTelegramHandoffValue(sortProjectionValue(value));
}

function compareStableValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildNoOpGuards() {
  return freezeSortedProjectionValue({
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

function buildProjectionSource() {
  return freezeSortedProjectionValue({
    primary_data: 'telegram_seller_attribution_session_start_events',
    source_binding_data: 'telegram_guest_entry_source_binding_events',
    mutable_session_status_used: false,
    booking_data_used: false,
    money_data_used: false,
  });
}

function assertTimestampSummary(value, label) {
  if (!isPlainObject(value)) {
    rejectAttributionProjection(`${label} is required`);
  }
  if (!Number.isInteger(value.unix_seconds) || value.unix_seconds <= 0) {
    rejectAttributionProjection(`${label}.unix_seconds must be a usable integer`);
  }

  const iso = normalizeString(value.iso);
  if (!iso || Number.isNaN(Date.parse(iso))) {
    rejectAttributionProjection(`${label}.iso must be a usable ISO timestamp`);
  }
}

function normalizeTelegramUserSummary(value) {
  if (!isPlainObject(value)) {
    rejectAttributionProjection('telegram_user_summary is required');
  }

  const telegramUserId = normalizeString(value.telegram_user_id);
  if (!telegramUserId) {
    rejectAttributionProjection('telegram_user_summary.telegram_user_id is required');
  }

  return freezeSortedProjectionValue({
    telegram_user_id: telegramUserId,
    is_bot: Boolean(value.is_bot),
    first_name: normalizeString(value.first_name),
    last_name: normalizeString(value.last_name),
    username: normalizeString(value.username),
    language_code: normalizeString(value.language_code),
    display_name: normalizeString(value.display_name) || telegramUserId,
  });
}

function normalizeSourceBindingReference(value) {
  if (!isPlainObject(value)) {
    rejectAttributionProjection('source_binding_reference is required');
  }
  if (value.reference_type !== 'telegram_guest_entry_source_binding_event') {
    rejectAttributionProjection(
      `Unsupported source-binding reference type: ${value.reference_type || 'unknown'}`
    );
  }
  if (value.event_type && value.event_type !== TELEGRAM_SOURCE_BINDING_EVENT_TYPE) {
    rejectAttributionProjection(
      `Unsupported source-binding event type: ${value.event_type}`
    );
  }

  return freezeSortedProjectionValue({
    reference_type: 'telegram_guest_entry_source_binding_event',
    source_binding_event_id: normalizePositiveInteger(
      value.source_binding_event_id,
      'source_binding_reference.source_binding_event_id'
    ),
    guest_entry_event_id: normalizePositiveInteger(
      value.guest_entry_event_id,
      'source_binding_reference.guest_entry_event_id'
    ),
    event_type: TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
    idempotency_key: normalizeString(value.idempotency_key),
  });
}

function normalizeAttributionSessionReference(value) {
  if (!isPlainObject(value)) {
    rejectAttributionProjection('attribution_session_reference is required');
  }
  if (value.reference_type !== 'telegram_seller_attribution_session') {
    rejectAttributionProjection(
      `Unsupported attribution-session reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedProjectionValue({
    reference_type: 'telegram_seller_attribution_session',
    seller_attribution_session_id: normalizePositiveInteger(
      value.seller_attribution_session_id,
      'attribution_session_reference.seller_attribution_session_id'
    ),
    guest_profile_id: normalizePositiveInteger(
      value.guest_profile_id,
      'attribution_session_reference.guest_profile_id'
    ),
    traffic_source_id: normalizePositiveInteger(
      value.traffic_source_id,
      'attribution_session_reference.traffic_source_id'
    ),
    source_qr_code_id: normalizePositiveInteger(
      value.source_qr_code_id,
      'attribution_session_reference.source_qr_code_id'
    ),
    seller_id:
      value.seller_id === null || value.seller_id === undefined
        ? null
        : normalizePositiveInteger(
            value.seller_id,
            'attribution_session_reference.seller_id'
          ),
    attribution_status: normalizeString(value.attribution_status),
  });
}

function buildSourceBindingReference(row) {
  return freezeSortedProjectionValue({
    reference_type: 'telegram_guest_entry_source_binding_event',
    source_binding_event_id: row.source_binding_event_id,
    guest_entry_event_id: row.guest_entry_event_id,
    event_type: row.event_type,
    idempotency_key: row.idempotency_key,
  });
}

function pickTelegramUserId(input = {}) {
  const telegramUserId = normalizeString(
    input.telegram_user_id ??
      input.telegramUserId ??
      input.telegram_guest_id ??
      input.telegramGuestId ??
      input.telegram_user_summary?.telegram_user_id ??
      input.telegramUserSummary?.telegram_user_id ??
      input.telegramUserSummary?.telegramUserId
  );

  if (!telegramUserId) {
    rejectAttributionProjection('telegram_user_id is required');
  }

  return telegramUserId;
}

function pickSourceBindingReferenceInput(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return { source_binding_event_id: Number(input) };
  }

  const reference =
    input.source_binding_reference ??
    input.sourceBindingReference ??
    input.source_binding_result?.source_binding_reference ??
    input.sourceBindingResult?.source_binding_reference ??
    input.sourceBindingResult?.sourceBindingReference;

  if (reference) {
    return reference;
  }

  const sourceBindingEventId =
    input.source_binding_event_id ??
    input.sourceBindingEventId ??
    input.event_id ??
    input.eventId;
  if (sourceBindingEventId !== undefined && sourceBindingEventId !== null) {
    return { source_binding_event_id: sourceBindingEventId };
  }

  rejectAttributionProjection('source_binding_reference is required');
}

function pickAttributionSessionReferenceInput(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return { seller_attribution_session_id: Number(input) };
  }

  const reference =
    input.attribution_session_reference ??
    input.attributionSessionReference ??
    input.seller_attribution_session_reference ??
    input.sellerAttributionSessionReference ??
    input.seller_attribution_result?.attribution_session_reference ??
    input.sellerAttributionResult?.attribution_session_reference ??
    input.sellerAttributionResult?.attributionSessionReference;

  if (reference) {
    return reference;
  }

  const sellerAttributionSessionId =
    input.seller_attribution_session_id ??
    input.sellerAttributionSessionId ??
    input.attribution_session_id ??
    input.attributionSessionId;
  if (
    sellerAttributionSessionId !== undefined &&
    sellerAttributionSessionId !== null
  ) {
    return { seller_attribution_session_id: sellerAttributionSessionId };
  }

  rejectAttributionProjection('attribution_session_reference is required');
}

function getSourceBindingEventIdFromInput(input = {}) {
  const reference = pickSourceBindingReferenceInput(input);
  if (
    reference.reference_type &&
    reference.reference_type !== 'telegram_guest_entry_source_binding_event'
  ) {
    rejectAttributionProjection(
      `Unsupported source-binding reference type: ${reference.reference_type}`
    );
  }

  return {
    sourceBindingEventId: normalizePositiveInteger(
      reference.source_binding_event_id,
      'source_binding_reference.source_binding_event_id'
    ),
    expectedReference: reference.reference_type
      ? normalizeSourceBindingReference(reference)
      : null,
  };
}

function getAttributionSessionIdFromInput(input = {}) {
  const reference = pickAttributionSessionReferenceInput(input);
  if (
    reference.reference_type &&
    reference.reference_type !== 'telegram_seller_attribution_session'
  ) {
    rejectAttributionProjection(
      `Unsupported attribution-session reference type: ${reference.reference_type}`
    );
  }

  return {
    sellerAttributionSessionId: normalizePositiveInteger(
      reference.seller_attribution_session_id,
      'attribution_session_reference.seller_attribution_session_id'
    ),
    expectedReference: reference.reference_type
      ? normalizeAttributionSessionReference(reference)
      : null,
  };
}

function normalizeStartEvent(row) {
  if (!row) {
    rejectAttributionProjection('Seller-attribution start event not found');
  }

  if (
    row.event_payload?.response_version !==
    TELEGRAM_SELLER_ATTRIBUTION_SESSION_START_RESULT_VERSION
  ) {
    rejectAttributionProjection(
      `Seller-attribution start event is not projectable: ${row.attribution_start_event_id}`
    );
  }

  const eventType = normalizeString(row.event_type);
  const attributionStatus = normalizeString(row.attribution_status);
  const sourceBindingReference = normalizeSourceBindingReference(
    row.source_binding_reference
  );
  const telegramUserSummary = normalizeTelegramUserSummary(row.telegram_user_summary);
  const sellerAttributionActive = normalizeBooleanFlag(
    row.seller_attribution_active
  );
  const attributionSessionReference = row.attribution_session_reference
    ? normalizeAttributionSessionReference(row.attribution_session_reference)
    : null;
  const attributionStartedAtSummary = row.attribution_started_at_summary || null;
  const attributionExpiresAtSummary = row.attribution_expires_at_summary || null;
  const noAttributionReason = normalizeString(row.no_attribution_reason);

  if (eventType === TELEGRAM_SELLER_ATTRIBUTION_SESSION_STARTED_EVENT_TYPE) {
    if (attributionStatus !== 'ACTIVE') {
      rejectAttributionProjection(
        `Unsupported started attribution status: ${attributionStatus || 'unknown'}`
      );
    }
    if (!sellerAttributionActive) {
      rejectAttributionProjection(
        `Started attribution event is inactive: ${row.attribution_start_event_id}`
      );
    }
    if (!attributionSessionReference) {
      rejectAttributionProjection(
        `Started attribution event has no session reference: ${row.attribution_start_event_id}`
      );
    }
    if (
      Number(row.seller_attribution_session_id) !==
      attributionSessionReference.seller_attribution_session_id
    ) {
      rejectAttributionProjection(
        `Attribution session reference mismatch: ${row.attribution_start_event_id}`
      );
    }
    if (noAttributionReason) {
      rejectAttributionProjection(
        `Started attribution event has no-attribution reason: ${row.attribution_start_event_id}`
      );
    }

    assertTimestampSummary(
      attributionStartedAtSummary,
      'attribution_started_at_summary'
    );
    assertTimestampSummary(
      attributionExpiresAtSummary,
      'attribution_expires_at_summary'
    );
  } else if (eventType === TELEGRAM_SELLER_ATTRIBUTION_SESSION_SKIPPED_EVENT_TYPE) {
    if (attributionStatus !== NO_SELLER_ATTRIBUTION_STATUS) {
      rejectAttributionProjection(
        `Unsupported skipped attribution status: ${attributionStatus || 'unknown'}`
      );
    }
    if (sellerAttributionActive) {
      rejectAttributionProjection(
        `Skipped attribution event is active: ${row.attribution_start_event_id}`
      );
    }
    if (row.seller_attribution_session_id || attributionSessionReference) {
      rejectAttributionProjection(
        `Skipped attribution event has a session reference: ${row.attribution_start_event_id}`
      );
    }
    if (!noAttributionReason) {
      rejectAttributionProjection(
        `Skipped attribution event has no reason: ${row.attribution_start_event_id}`
      );
    }
  } else {
    rejectAttributionProjection(
      `Unsupported attribution event type: ${eventType || 'unknown'}`
    );
  }

  const normalized = {
    attribution_start_event_id: row.attribution_start_event_id,
    event_type: eventType,
    attribution_status: attributionStatus,
    no_attribution_reason: noAttributionReason,
    telegram_user_summary: telegramUserSummary,
    telegram_guest_summary: freezeSortedProjectionValue(
      row.telegram_guest_summary || null
    ),
    source_binding_reference: sourceBindingReference,
    attribution_session_reference: attributionSessionReference,
    seller_attribution_active: sellerAttributionActive,
    attribution_started_at_summary: freezeSortedProjectionValue(
      attributionStartedAtSummary
    ),
    attribution_expires_at_summary: freezeSortedProjectionValue(
      attributionExpiresAtSummary
    ),
    dedupe_key: normalizeString(row.dedupe_key),
    idempotency_key: normalizeString(row.idempotency_key),
  };

  if (isPlainObject(row.event_signature)) {
    const signatureFields = {
      response_version: TELEGRAM_SELLER_ATTRIBUTION_SESSION_START_RESULT_VERSION,
      event_type: normalized.event_type,
      attribution_status: normalized.attribution_status,
      no_attribution_reason: normalized.no_attribution_reason,
      telegram_user_summary: normalized.telegram_user_summary,
      telegram_guest_summary: normalized.telegram_guest_summary,
      source_binding_reference: normalized.source_binding_reference,
      attribution_session_reference: normalized.attribution_session_reference,
      seller_attribution_active: normalized.seller_attribution_active,
      attribution_started_at_summary: normalized.attribution_started_at_summary,
      attribution_expires_at_summary: normalized.attribution_expires_at_summary,
      dedupe_key: normalized.dedupe_key,
      idempotency_key: normalized.idempotency_key,
    };

    for (const [field, expected] of Object.entries(signatureFields)) {
      if (!compareStableValues(row.event_signature[field] ?? null, expected ?? null)) {
        rejectAttributionProjection(
          `Seller-attribution start event signature mismatch for ${field}: ${row.attribution_start_event_id}`
        );
      }
    }
  }

  return freezeTelegramHandoffValue(normalized);
}

function normalizeSourceBindingEvent(row, expectedReference = null) {
  if (!row) {
    rejectAttributionProjection('Source-binding event not found');
  }
  if (row.event_type !== TELEGRAM_SOURCE_BINDING_EVENT_TYPE) {
    rejectAttributionProjection(
      `Unsupported source-binding event type: ${row.event_type || 'unknown'}`
    );
  }
  if (
    row.binding_payload?.response_version !==
    TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION
  ) {
    rejectAttributionProjection(
      `Source-binding event is not projectable: ${row.source_binding_event_id}`
    );
  }

  const reference = buildSourceBindingReference(row);
  if (expectedReference && !compareStableValues(reference, expectedReference)) {
    rejectAttributionProjection(
      `Source-binding reference mismatch: ${row.source_binding_event_id}`
    );
  }

  return freezeTelegramHandoffValue({
    source_binding_reference: reference,
    telegram_user_summary: normalizeTelegramUserSummary(row.telegram_user_summary),
    binding_status: normalizeString(row.binding_status),
    source_resolution_outcome: normalizeString(row.source_resolution_outcome),
  });
}

function isActiveProjection(snapshot, nowIso) {
  if (snapshot.attribution_status !== 'ACTIVE') {
    return false;
  }

  const expiresAt = snapshot.attribution_expires_at_summary?.iso;
  return Boolean(
    snapshot.seller_attribution_active &&
      expiresAt &&
      Date.parse(expiresAt) > Date.parse(nowIso)
  );
}

function buildProjectionFromStartEvent(normalizedStartEvent, nowIso) {
  let attributionStatus = normalizedStartEvent.attribution_status;
  let sellerAttributionActive = normalizedStartEvent.seller_attribution_active;
  let noAttributionReason = normalizedStartEvent.no_attribution_reason;

  if (normalizedStartEvent.attribution_status === 'ACTIVE') {
    if (isActiveProjection(normalizedStartEvent, nowIso)) {
      attributionStatus = 'ACTIVE';
      sellerAttributionActive = true;
      noAttributionReason = null;
    } else {
      attributionStatus = ATTRIBUTION_EXPIRED_STATUS;
      sellerAttributionActive = false;
      noAttributionReason = 'seller_attribution_expired';
    }
  }

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_SELLER_ATTRIBUTION_PROJECTION_VERSION,
    read_only: true,
    projection_only: true,
    projected_by: SERVICE_NAME,
    projection_source: buildProjectionSource(),
    attribution_start_event_id: normalizedStartEvent.attribution_start_event_id,
    source_event_type: normalizedStartEvent.event_type,
    attribution_status: attributionStatus,
    telegram_user_summary: normalizedStartEvent.telegram_user_summary,
    telegram_guest_summary: normalizedStartEvent.telegram_guest_summary,
    source_binding_reference: normalizedStartEvent.source_binding_reference,
    attribution_session_reference:
      normalizedStartEvent.attribution_session_reference,
    seller_attribution_active: sellerAttributionActive,
    attribution_started_at_summary:
      normalizedStartEvent.attribution_started_at_summary,
    attribution_expires_at_summary:
      normalizedStartEvent.attribution_expires_at_summary,
    no_attribution_reason: noAttributionReason,
    projection_timestamp_summary: freezeSortedProjectionValue({
      iso: nowIso,
      unix_seconds: Math.floor(Date.parse(nowIso) / 1000),
    }),
    dedupe_key: normalizedStartEvent.dedupe_key,
    idempotency_key: normalizedStartEvent.idempotency_key,
    no_op_guards: buildNoOpGuards(),
  });
}

function buildUnavailableProjection({
  telegramUserSummary = null,
  sourceBindingReference = null,
  nowIso,
  reason,
}) {
  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_SELLER_ATTRIBUTION_PROJECTION_VERSION,
    read_only: true,
    projection_only: true,
    projected_by: SERVICE_NAME,
    projection_source: buildProjectionSource(),
    attribution_start_event_id: null,
    source_event_type: null,
    attribution_status: ATTRIBUTION_UNAVAILABLE_STATUS,
    telegram_user_summary: freezeSortedProjectionValue(telegramUserSummary),
    telegram_guest_summary: null,
    source_binding_reference: freezeSortedProjectionValue(sourceBindingReference),
    attribution_session_reference: null,
    seller_attribution_active: false,
    attribution_started_at_summary: null,
    attribution_expires_at_summary: null,
    no_attribution_reason: reason,
    projection_timestamp_summary: freezeSortedProjectionValue({
      iso: nowIso,
      unix_seconds: Math.floor(Date.parse(nowIso) / 1000),
    }),
    dedupe_key: null,
    idempotency_key: null,
    no_op_guards: buildNoOpGuards(),
  });
}

function compareByNewestStartEvent(left, right) {
  return right.attribution_start_event_id - left.attribution_start_event_id;
}

export class TelegramSellerAttributionProjectionService {
  constructor({
    sellerAttributionSessionStartEvents,
    guestEntrySourceBindingEvents,
    now = () => new Date(),
  }) {
    this.sellerAttributionSessionStartEvents =
      sellerAttributionSessionStartEvents;
    this.guestEntrySourceBindingEvents = guestEntrySourceBindingEvents;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'seller-attribution-projection-service',
      status: 'read_only_seller_attribution_projection_ready',
      dependencyKeys: [
        'sellerAttributionSessionStartEvents',
        'guestEntrySourceBindingEvents',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectAttributionProjection('projection clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.sellerAttributionSessionStartEvents?.db || null;
  }

  listPersistedStartEvents({ scanLimit = DEFAULT_SCAN_LIMIT } = {}) {
    this.sellerAttributionSessionStartEvents.assertReady();
    return this.sellerAttributionSessionStartEvents.listBy(
      {},
      {
        orderBy: 'attribution_start_event_id ASC',
        limit: normalizeLimit(scanLimit),
      }
    );
  }

  getStartEventBySourceBindingEventId(sourceBindingEventId) {
    return this.sellerAttributionSessionStartEvents.findOneBy(
      { source_binding_event_id: sourceBindingEventId },
      { orderBy: 'attribution_start_event_id ASC' }
    );
  }

  getStartEventByAttributionSessionId(sellerAttributionSessionId) {
    return this.sellerAttributionSessionStartEvents.findOneBy(
      { seller_attribution_session_id: sellerAttributionSessionId },
      { orderBy: 'attribution_start_event_id ASC' }
    );
  }

  readAttributionBySourceBindingReference(input = {}) {
    const { sourceBindingEventId, expectedReference } =
      getSourceBindingEventIdFromInput(input);
    const sourceBinding = normalizeSourceBindingEvent(
      this.guestEntrySourceBindingEvents.getById(sourceBindingEventId),
      expectedReference
    );
    const startEvent = this.getStartEventBySourceBindingEventId(sourceBindingEventId);
    const nowIso = this.nowIso();

    if (!startEvent) {
      return buildUnavailableProjection({
        telegramUserSummary: sourceBinding.telegram_user_summary,
        sourceBindingReference: sourceBinding.source_binding_reference,
        nowIso,
        reason: 'seller_attribution_session_start_not_found',
      });
    }

    return buildProjectionFromStartEvent(normalizeStartEvent(startEvent), nowIso);
  }

  readAttributionByAttributionSessionReference(input = {}) {
    const { sellerAttributionSessionId, expectedReference } =
      getAttributionSessionIdFromInput(input);
    const startEvent = this.getStartEventByAttributionSessionId(
      sellerAttributionSessionId
    );
    const nowIso = this.nowIso();

    if (!startEvent) {
      rejectAttributionProjection(
        `Attribution session start event not found: ${sellerAttributionSessionId}`
      );
    }

    const projection = buildProjectionFromStartEvent(
      normalizeStartEvent(startEvent),
      nowIso
    );
    if (
      expectedReference &&
      !compareStableValues(
        projection.attribution_session_reference,
        expectedReference
      )
    ) {
      rejectAttributionProjection(
        `Attribution session reference mismatch: ${sellerAttributionSessionId}`
      );
    }

    return projection;
  }

  readCurrentAttributionStateForTelegramGuest(input = {}) {
    const telegramUserId = pickTelegramUserId(input);
    const nowIso = this.nowIso();
    const projections = this.listPersistedStartEvents({
      scanLimit: input.scanLimit ?? input.scan_limit,
    })
      .map((row) => normalizeStartEvent(row))
      .filter(
        (row) => row.telegram_user_summary.telegram_user_id === telegramUserId
      )
      .map((row) => buildProjectionFromStartEvent(row, nowIso))
      .sort(compareByNewestStartEvent);

    const activeProjection =
      projections.find((projection) => projection.seller_attribution_active) ||
      null;
    if (activeProjection) {
      return activeProjection;
    }

    const latestProjection = projections[0] || null;
    if (latestProjection) {
      return latestProjection;
    }

    return buildUnavailableProjection({
      telegramUserSummary: { telegram_user_id: telegramUserId },
      nowIso,
      reason: 'seller_attribution_session_start_not_found',
    });
  }

  readCurrentAttributionState(input = {}) {
    return this.readCurrentAttributionStateForTelegramGuest(input);
  }

  readCurrentAttribution(input = {}) {
    return this.readCurrentAttributionStateForTelegramGuest(input);
  }

  readBySourceBindingReference(input = {}) {
    return this.readAttributionBySourceBindingReference(input);
  }

  readByAttributionSessionReference(input = {}) {
    return this.readAttributionByAttributionSessionReference(input);
  }
}
