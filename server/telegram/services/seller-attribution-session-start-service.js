import {
  SELLER_SOURCE_FAMILIES,
  TELEGRAM_SOURCE_FAMILIES,
  freezeTelegramHandoffValue,
} from '../../../shared/telegram/index.js';
import {
  TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
  TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION,
  TELEGRAM_SOURCE_BINDING_STATUSES,
} from './source-binding-persistence-service.js';

export const TELEGRAM_SELLER_ATTRIBUTION_SESSION_START_RESULT_VERSION =
  'telegram_seller_attribution_session_start_result.v1';
export const TELEGRAM_SELLER_ATTRIBUTION_SESSION_STARTED_EVENT_TYPE =
  'SELLER_ATTRIBUTION_SESSION_STARTED';
export const TELEGRAM_SELLER_ATTRIBUTION_SESSION_SKIPPED_EVENT_TYPE =
  'SELLER_ATTRIBUTION_SESSION_SKIPPED';

const ERROR_PREFIX = '[TELEGRAM_SELLER_ATTRIBUTION_SESSION_START]';
const SERVICE_NAME = 'telegram_seller_attribution_session_start_service';
const ATTRIBUTION_WINDOW_HOURS = 30;
const NO_ATTRIBUTION_STATUS = 'NO_SELLER_ATTRIBUTION';
const GENERIC_SOURCE_FAMILIES = Object.freeze(
  TELEGRAM_SOURCE_FAMILIES.filter(
    (sourceFamily) => !SELLER_SOURCE_FAMILIES.includes(sourceFamily)
  )
);

const SKIP_REASONS_BY_BINDING_STATUS = Object.freeze({
  resolved_owner_source: 'resolved_owner_source_has_no_seller_attribution',
  resolved_generic_source: 'resolved_generic_source_has_no_seller_attribution',
  no_source_token: 'no_source_token_has_no_seller_attribution',
  unresolved_source_token: 'unresolved_source_token_has_no_seller_attribution',
});

function rejectAttributionStart(message) {
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
    rejectAttributionStart(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeNullablePositiveInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function normalizeBooleanFlag(value) {
  return value === true || value === 1;
}

function sortAttributionValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortAttributionValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortAttributionValue(value[key])])
  );
}

function freezeSortedAttributionValue(value) {
  return freezeTelegramHandoffValue(sortAttributionValue(value));
}

function compareFrozenValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toIsoTimestamp(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    rejectAttributionStart('timestamp must be a usable date');
  }

  return date.toISOString();
}

function addHours(isoTimestamp, hours) {
  const date = new Date(isoTimestamp);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

function buildTimestampSummary(isoTimestamp) {
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) {
    rejectAttributionStart('timestamp summary requires a usable ISO timestamp');
  }

  return freezeSortedAttributionValue({
    unix_seconds: Math.floor(parsed / 1000),
    iso: isoTimestamp,
  });
}

function normalizeTelegramUserSummary(value) {
  if (!isPlainObject(value)) {
    rejectAttributionStart('telegram_user_summary is required');
  }

  const telegramUserId = normalizeOptionalString(value.telegram_user_id);
  if (!telegramUserId) {
    rejectAttributionStart('telegram_user_summary.telegram_user_id is required');
  }

  return freezeSortedAttributionValue({
    telegram_user_id: telegramUserId,
    is_bot: Boolean(value.is_bot),
    first_name: normalizeOptionalString(value.first_name),
    last_name: normalizeOptionalString(value.last_name),
    username: normalizeOptionalString(value.username),
    language_code: normalizeOptionalString(value.language_code),
    display_name: normalizeOptionalString(value.display_name) || telegramUserId,
  });
}

function normalizeSourceBindingReference(value) {
  if (!isPlainObject(value)) {
    rejectAttributionStart('source_binding_reference is required');
  }
  if (value.reference_type !== 'telegram_guest_entry_source_binding_event') {
    rejectAttributionStart(
      `Unsupported source-binding reference type: ${value.reference_type || 'unknown'}`
    );
  }
  if (value.event_type && value.event_type !== TELEGRAM_SOURCE_BINDING_EVENT_TYPE) {
    rejectAttributionStart(
      `Unsupported source-binding event type: ${value.event_type}`
    );
  }

  const sourceBindingEventId = normalizePositiveInteger(
    value.source_binding_event_id,
    'source_binding_reference.source_binding_event_id'
  );
  const guestEntryEventId = normalizePositiveInteger(
    value.guest_entry_event_id,
    'source_binding_reference.guest_entry_event_id'
  );

  return freezeSortedAttributionValue({
    reference_type: 'telegram_guest_entry_source_binding_event',
    source_binding_event_id: sourceBindingEventId,
    guest_entry_event_id: guestEntryEventId,
    event_type: TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
    idempotency_key: normalizeOptionalString(value.idempotency_key),
  });
}

function normalizeSourceBindingResult(input) {
  if (!isPlainObject(input)) {
    rejectAttributionStart('persisted source-binding result is required');
  }
  if (input.response_version !== TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION) {
    rejectAttributionStart(
      `Unsupported source-binding result version: ${input.response_version || 'unknown'}`
    );
  }

  const bindingStatus = normalizeOptionalString(input.binding_status);
  if (!TELEGRAM_SOURCE_BINDING_STATUSES.includes(bindingStatus)) {
    rejectAttributionStart(
      `Unsupported source-binding outcome: ${bindingStatus || 'unknown'}`
    );
  }

  const sourceResolutionOutcome = normalizeOptionalString(
    input.source_resolution_outcome
  );
  if (sourceResolutionOutcome !== bindingStatus) {
    rejectAttributionStart('source-binding outcome mismatch');
  }

  const sourceBindingReference = normalizeSourceBindingReference(
    input.source_binding_reference
  );
  const idempotencyKey = buildDedupeKey(sourceBindingReference);
  const sourceBindingIdempotencyKey = normalizeOptionalString(input.idempotency_key);
  if (
    sourceBindingReference.idempotency_key &&
    sourceBindingIdempotencyKey &&
    sourceBindingReference.idempotency_key !== sourceBindingIdempotencyKey
  ) {
    rejectAttributionStart('source-binding reference idempotency key mismatch');
  }

  const normalizedSourceToken = normalizeOptionalString(input.normalized_source_token);
  const rawSourceToken = normalizeOptionalString(input.raw_source_token);
  if (bindingStatus === 'no_source_token') {
    if (rawSourceToken || normalizedSourceToken) {
      rejectAttributionStart('no_source_token must not carry source tokens');
    }
  } else if (!rawSourceToken || !normalizedSourceToken) {
    rejectAttributionStart(`${bindingStatus} requires source tokens`);
  }

  const resolvedSourceFamily = normalizeOptionalString(input.resolved_source_family);
  if (bindingStatus === 'resolved_seller_source') {
    if (!SELLER_SOURCE_FAMILIES.includes(resolvedSourceFamily)) {
      rejectAttributionStart(
        'resolved_seller_source requires a seller source family'
      );
    }
  } else if (bindingStatus === 'resolved_owner_source') {
    if (resolvedSourceFamily !== 'owner_source') {
      rejectAttributionStart('resolved_owner_source requires owner_source family');
    }
  } else if (bindingStatus === 'resolved_generic_source') {
    if (!GENERIC_SOURCE_FAMILIES.includes(resolvedSourceFamily)) {
      rejectAttributionStart(
        'resolved_generic_source requires a generic source family'
      );
    }
  } else if (resolvedSourceFamily !== null) {
    rejectAttributionStart(`${bindingStatus} must not resolve a source family`);
  }

  const normalized = {
    response_version: input.response_version,
    binding_status: bindingStatus,
    telegram_user_summary: normalizeTelegramUserSummary(
      input.telegram_user_summary
    ),
    guest_entry_reference: freezeSortedAttributionValue(
      input.guest_entry_reference || null
    ),
    source_binding_reference: sourceBindingReference,
    raw_source_token: rawSourceToken,
    normalized_source_token: normalizedSourceToken,
    resolved_source_family: resolvedSourceFamily,
    source_resolution_outcome: sourceResolutionOutcome,
    source_resolution_summary: freezeSortedAttributionValue(
      input.source_resolution_summary || null
    ),
    event_timestamp_summary: freezeSortedAttributionValue(
      input.event_timestamp_summary || null
    ),
    source_binding_idempotency_key: sourceBindingIdempotencyKey,
    source_binding_dedupe_key: normalizeOptionalString(input.dedupe_key),
    idempotency_key: idempotencyKey,
    dedupe_key: idempotencyKey,
  };

  return freezeTelegramHandoffValue({
    ...normalized,
    source_binding_input_signature: freezeSortedAttributionValue(normalized),
  });
}

function buildDedupeKey(sourceBindingReference) {
  return `telegram_seller_attribution_session_start:source_binding_event=${sourceBindingReference.source_binding_event_id}`;
}

function buildSourceBindingReference(row) {
  return freezeSortedAttributionValue({
    reference_type: 'telegram_guest_entry_source_binding_event',
    source_binding_event_id: row.source_binding_event_id,
    guest_entry_event_id: row.guest_entry_event_id,
    event_type: row.event_type,
    idempotency_key: row.idempotency_key,
  });
}

function buildSourceBindingSnapshot(row) {
  return freezeTelegramHandoffValue({
    response_version:
      row.binding_payload?.response_version ||
      TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION,
    binding_status: row.binding_status,
    telegram_user_summary: freezeSortedAttributionValue(
      row.telegram_user_summary || null
    ),
    guest_entry_reference: freezeSortedAttributionValue(
      row.guest_entry_reference || null
    ),
    source_binding_reference: buildSourceBindingReference(row),
    raw_source_token: normalizeOptionalString(row.raw_source_token),
    normalized_source_token: normalizeOptionalString(row.normalized_source_token),
    resolved_source_family: normalizeOptionalString(row.resolved_source_family),
    source_resolution_outcome: normalizeOptionalString(
      row.source_resolution_outcome
    ),
    source_resolution_summary: freezeSortedAttributionValue(
      row.source_resolution_summary || null
    ),
    dedupe_key: normalizeOptionalString(row.dedupe_key),
    idempotency_key: normalizeOptionalString(row.idempotency_key),
    event_timestamp_summary: freezeSortedAttributionValue(
      row.event_timestamp_summary || null
    ),
  });
}

function assertPersistedSourceBindingMatches(row, normalizedSourceBinding) {
  if (!row) {
    rejectAttributionStart(
      `Source-binding event not found: ${normalizedSourceBinding.source_binding_reference.source_binding_event_id}`
    );
  }

  const persisted = normalizeSourceBindingResult(buildSourceBindingSnapshot(row));
  if (
    !compareFrozenValues(
      persisted.source_binding_input_signature,
      normalizedSourceBinding.source_binding_input_signature
    )
  ) {
    rejectAttributionStart(
      `Persisted source-binding payload mismatch: ${normalizedSourceBinding.source_binding_reference.source_binding_event_id}`
    );
  }
}

function buildGuestProfileSummary(guestProfile, telegramUserSummary) {
  return freezeSortedAttributionValue({
    guest_profile_id: guestProfile.guest_profile_id,
    telegram_user_id: guestProfile.telegram_user_id,
    display_name: guestProfile.display_name || telegramUserSummary.display_name,
    username: guestProfile.username || null,
    language_code: guestProfile.language_code || null,
    phone_e164: guestProfile.phone_e164 || null,
    profile_status: guestProfile.profile_status,
  });
}

function buildAttributionSessionReference(session) {
  if (!session) {
    return null;
  }

  return freezeSortedAttributionValue({
    reference_type: 'telegram_seller_attribution_session',
    seller_attribution_session_id: session.seller_attribution_session_id,
    guest_profile_id: session.guest_profile_id,
    traffic_source_id: session.traffic_source_id,
    source_qr_code_id: session.source_qr_code_id,
    seller_id: session.seller_id ?? null,
    attribution_status: session.attribution_status,
  });
}

function buildNoOpGuards(sellerAttributionCreated) {
  return freezeSortedAttributionValue({
    seller_attribution_created: Boolean(sellerAttributionCreated),
    booking_created: false,
    production_webhook_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  });
}

function buildEventSignature(input) {
  return freezeSortedAttributionValue(input);
}

function normalizeSourceType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function ensureSellerSourceMatchesBinding({ trafficSource, normalizedSourceBinding }) {
  const sourceType = normalizeSourceType(trafficSource.source_type);
  if (sourceType !== normalizedSourceBinding.resolved_source_family) {
    rejectAttributionStart(
      `Resolved source family does not match traffic source type: ${sourceType || 'unknown'}`
    );
  }
}

function pickSourceBindingResult(input) {
  if (input?.source_binding_result) return input.source_binding_result;
  if (input?.sourceBindingResult) return input.sourceBindingResult;
  return input;
}

function buildStartEventRowPayload({
  eventType,
  attributionStatus,
  noAttributionReason = null,
  normalizedSourceBinding,
  guestProfileSummary = null,
  attributionSessionReference = null,
  sellerAttributionActive,
  attributionStartedAtSummary = null,
  attributionExpiresAtSummary = null,
  noOpGuards,
}) {
  return {
    source_binding_event_id:
      normalizedSourceBinding.source_binding_reference.source_binding_event_id,
    seller_attribution_session_id:
      attributionSessionReference?.seller_attribution_session_id ?? null,
    event_type: eventType,
    attribution_status: attributionStatus,
    no_attribution_reason: noAttributionReason,
    telegram_user_summary: normalizedSourceBinding.telegram_user_summary,
    telegram_guest_summary: guestProfileSummary,
    source_binding_reference: normalizedSourceBinding.source_binding_reference,
    attribution_session_reference: attributionSessionReference,
    seller_attribution_active: sellerAttributionActive ? 1 : 0,
    attribution_started_at_summary: attributionStartedAtSummary,
    attribution_expires_at_summary: attributionExpiresAtSummary,
    event_payload: freezeSortedAttributionValue({
      response_version: TELEGRAM_SELLER_ATTRIBUTION_SESSION_START_RESULT_VERSION,
      seller_attribution_session_start_source: SERVICE_NAME,
      source_binding_input_signature:
        normalizedSourceBinding.source_binding_input_signature,
      no_op_guards: noOpGuards,
    }),
    idempotency_key: normalizedSourceBinding.idempotency_key,
    dedupe_key: normalizedSourceBinding.dedupe_key,
    event_signature: buildEventSignature({
      response_version: TELEGRAM_SELLER_ATTRIBUTION_SESSION_START_RESULT_VERSION,
      event_type: eventType,
      attribution_status: attributionStatus,
      no_attribution_reason: noAttributionReason,
      telegram_user_summary: normalizedSourceBinding.telegram_user_summary,
      telegram_guest_summary: guestProfileSummary,
      source_binding_reference: normalizedSourceBinding.source_binding_reference,
      attribution_session_reference: attributionSessionReference,
      seller_attribution_active: Boolean(sellerAttributionActive),
      attribution_started_at_summary: attributionStartedAtSummary,
      attribution_expires_at_summary: attributionExpiresAtSummary,
      source_binding_input_signature:
        normalizedSourceBinding.source_binding_input_signature,
      dedupe_key: normalizedSourceBinding.dedupe_key,
      idempotency_key: normalizedSourceBinding.idempotency_key,
      no_op_guards: noOpGuards,
    }),
  };
}

function buildResultFromRow(row) {
  return freezeTelegramHandoffValue({
    response_version:
      row.event_payload?.response_version ||
      TELEGRAM_SELLER_ATTRIBUTION_SESSION_START_RESULT_VERSION,
    attribution_status: row.attribution_status,
    no_attribution_reason: row.no_attribution_reason || null,
    telegram_user_summary: freezeSortedAttributionValue(
      row.telegram_user_summary || null
    ),
    telegram_guest_summary: freezeSortedAttributionValue(
      row.telegram_guest_summary || null
    ),
    source_binding_reference: freezeSortedAttributionValue(
      row.source_binding_reference || null
    ),
    attribution_session_reference: freezeSortedAttributionValue(
      row.attribution_session_reference || null
    ),
    seller_attribution_active: normalizeBooleanFlag(
      row.seller_attribution_active
    ),
    attribution_started_at_summary: freezeSortedAttributionValue(
      row.attribution_started_at_summary || null
    ),
    attribution_expires_at_summary: freezeSortedAttributionValue(
      row.attribution_expires_at_summary || null
    ),
    dedupe_key: row.dedupe_key,
    idempotency_key: row.idempotency_key,
  });
}

export class TelegramSellerAttributionSessionStartService {
  constructor({
    guestProfiles,
    trafficSources,
    sourceQRCodes,
    sourceRegistryItems = null,
    sellerAttributionSessions,
    sellerAttributionSessionStartEvents,
    guestEntrySourceBindingEvents,
    now = () => new Date(),
  }) {
    this.guestProfiles = guestProfiles;
    this.trafficSources = trafficSources;
    this.sourceQRCodes = sourceQRCodes;
    this.sourceRegistryItems = sourceRegistryItems;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.sellerAttributionSessionStartEvents =
      sellerAttributionSessionStartEvents;
    this.guestEntrySourceBindingEvents = guestEntrySourceBindingEvents;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'seller-attribution-session-start-service',
      status: 'source_binding_driven_session_start_ready',
      dependencyKeys: [
        'guestProfiles',
        'trafficSources',
        'sourceQRCodes',
        'sourceRegistryItems',
        'sellerAttributionSessions',
        'sellerAttributionSessionStartEvents',
        'guestEntrySourceBindingEvents',
      ],
    });
  }

  nowIso() {
    return toIsoTimestamp(this.now());
  }

  get db() {
    return this.sellerAttributionSessionStartEvents?.db || null;
  }

  resolveIdempotentStartEvent(normalizedSourceBinding) {
    const existingEvent = this.sellerAttributionSessionStartEvents.findOneBy(
      { idempotency_key: normalizedSourceBinding.idempotency_key },
      { orderBy: 'attribution_start_event_id ASC' }
    );
    if (!existingEvent) {
      return null;
    }

    if (
      compareFrozenValues(
        existingEvent.event_payload?.source_binding_input_signature,
        normalizedSourceBinding.source_binding_input_signature
      )
    ) {
      return existingEvent;
    }

    rejectAttributionStart(
      `Idempotency conflict for seller-attribution session start: ${normalizedSourceBinding.idempotency_key}`
    );
  }

  findOrCreateGuestProfile(telegramUserSummary, startsAt) {
    const existingGuest = this.guestProfiles.findOneBy(
      { telegram_user_id: telegramUserSummary.telegram_user_id },
      { orderBy: 'guest_profile_id ASC' }
    );
    if (existingGuest) {
      return existingGuest;
    }

    return this.guestProfiles.create({
      telegram_user_id: telegramUserSummary.telegram_user_id,
      display_name: telegramUserSummary.display_name,
      username: telegramUserSummary.username,
      language_code: telegramUserSummary.language_code,
      phone_e164: null,
      consent_status: 'unknown',
      first_seen_at: startsAt,
      last_seen_at: startsAt,
      profile_status: 'active',
    });
  }

  resolveRegistrySourceRecord(normalizedSourceBinding) {
    if (!this.sourceRegistryItems?.findOneBy) {
      return null;
    }

    const sourceRegistryItem = this.sourceRegistryItems.findOneBy(
      { source_token: normalizedSourceBinding.normalized_source_token },
      { orderBy: 'source_registry_item_id ASC' }
    );
    if (!sourceRegistryItem) {
      return null;
    }
    if (!normalizeBooleanFlag(sourceRegistryItem.is_enabled)) {
      rejectAttributionStart(
        `Source registry item is inactive: ${sourceRegistryItem.source_reference || sourceRegistryItem.source_token}`
      );
    }

    const sourceType = normalizeSourceType(sourceRegistryItem.source_type);
    if (sourceType !== normalizedSourceBinding.resolved_source_family) {
      rejectAttributionStart(
        `Resolved source family does not match source-registry type: ${sourceType || 'unknown'}`
      );
    }

    const sellerId = normalizeNullablePositiveInteger(sourceRegistryItem.seller_id);
    if (!sellerId) {
      rejectAttributionStart(
        `Resolved seller source has no seller: ${normalizedSourceBinding.normalized_source_token}`
      );
    }

    return {
      sourceRegistryItem,
      sellerId,
    };
  }

  ensureTrafficSourceFromRegistry(registryRecord, startsAt) {
    const sourceCode =
      normalizeOptionalString(registryRecord.source_reference) ||
      `telegram_registry_${registryRecord.source_registry_item_id}`;
    const sourceType = normalizeSourceType(registryRecord.source_type);
    const sourceName =
      normalizeOptionalString(registryRecord.source_reference) ||
      normalizeOptionalString(registryRecord.source_token) ||
      sourceCode;

    const existing = this.trafficSources.findOneBy(
      { source_code: sourceCode },
      { orderBy: 'traffic_source_id ASC' }
    );
    if (existing) {
      return existing;
    }

    return this.trafficSources.create({
      source_code: sourceCode,
      source_type: sourceType,
      source_name: sourceName,
      default_seller_id: registryRecord.seller_id,
      is_active: 1,
      created_at: startsAt,
    });
  }

  ensureSourceQRCodeFromRegistry({
    registryRecord,
    trafficSource,
    startsAt,
  }) {
    const existing = this.sourceQRCodes.findOneBy(
      { qr_token: registryRecord.source_token },
      { orderBy: 'source_qr_code_id ASC' }
    );
    if (existing) {
      return existing;
    }

    return this.sourceQRCodes.create({
      qr_token: registryRecord.source_token,
      traffic_source_id: trafficSource.traffic_source_id,
      seller_id: registryRecord.seller_id,
      entry_context: {
        source_reference: registryRecord.source_reference,
        source_family: registryRecord.source_family,
        source_type: registryRecord.source_type,
      },
      is_active: 1,
      created_at: startsAt,
    });
  }

  resolveSellerSourceFromRegistry(normalizedSourceBinding, startsAt) {
    const registrySource = this.resolveRegistrySourceRecord(normalizedSourceBinding);
    if (!registrySource) {
      return null;
    }

    const trafficSource = this.ensureTrafficSourceFromRegistry(
      registrySource.sourceRegistryItem,
      startsAt
    );
    ensureSellerSourceMatchesBinding({ trafficSource, normalizedSourceBinding });

    const sourceQRCode = this.ensureSourceQRCodeFromRegistry({
      registryRecord: registrySource.sourceRegistryItem,
      trafficSource,
      startsAt,
    });
    if (!normalizeBooleanFlag(sourceQRCode.is_active)) {
      rejectAttributionStart(
        `Source QR code is inactive: ${sourceQRCode.source_qr_code_id}`
      );
    }

    return {
      sourceQRCode,
      trafficSource,
      sellerId: registrySource.sellerId,
    };
  }

  resolveSellerSource(normalizedSourceBinding, startsAt) {
    const sourceQRCode = this.sourceQRCodes.findOneBy(
      { qr_token: normalizedSourceBinding.normalized_source_token },
      { orderBy: 'source_qr_code_id ASC' }
    );
    if (sourceQRCode) {
      if (!normalizeBooleanFlag(sourceQRCode.is_active)) {
        rejectAttributionStart(
          `Source QR code is inactive: ${sourceQRCode.source_qr_code_id}`
        );
      }

      const trafficSource = this.trafficSources.getById(
        sourceQRCode.traffic_source_id
      );
      if (!trafficSource) {
        rejectAttributionStart(
          `Traffic source not found: ${sourceQRCode.traffic_source_id}`
        );
      }
      if (!normalizeBooleanFlag(trafficSource.is_active)) {
        rejectAttributionStart(
          `Traffic source is inactive: ${trafficSource.traffic_source_id}`
        );
      }

      ensureSellerSourceMatchesBinding({ trafficSource, normalizedSourceBinding });

      const sellerId =
        normalizeNullablePositiveInteger(sourceQRCode.seller_id) ??
        normalizeNullablePositiveInteger(trafficSource.default_seller_id);
      if (!sellerId) {
        rejectAttributionStart(
          `Resolved seller source has no seller: ${normalizedSourceBinding.normalized_source_token}`
        );
      }

      return { sourceQRCode, trafficSource, sellerId };
    }

    const registryResolved = this.resolveSellerSourceFromRegistry(
      normalizedSourceBinding,
      startsAt
    );
    if (registryResolved) {
      return registryResolved;
    }

    rejectAttributionStart(
      `Source QR code not found for source token: ${normalizedSourceBinding.normalized_source_token}`
    );
  }

  createSellerAttributionStart(normalizedSourceBinding) {
    const startsAt = this.nowIso();
    const expiresAt = addHours(startsAt, ATTRIBUTION_WINDOW_HOURS);
    const sellerSource = this.resolveSellerSource(normalizedSourceBinding, startsAt);
    const guestProfile = this.findOrCreateGuestProfile(
      normalizedSourceBinding.telegram_user_summary,
      startsAt
    );

    const attributionSession = this.sellerAttributionSessions.create({
      guest_profile_id: guestProfile.guest_profile_id,
      traffic_source_id: sellerSource.trafficSource.traffic_source_id,
      source_qr_code_id: sellerSource.sourceQRCode.source_qr_code_id,
      seller_id: sellerSource.sellerId,
      starts_at: startsAt,
      expires_at: expiresAt,
      attribution_status: 'ACTIVE',
      binding_reason: normalizedSourceBinding.resolved_source_family,
    });
    const noOpGuards = buildNoOpGuards(true);
    const eventRow = this.sellerAttributionSessionStartEvents.create(
      buildStartEventRowPayload({
        eventType: TELEGRAM_SELLER_ATTRIBUTION_SESSION_STARTED_EVENT_TYPE,
        attributionStatus: 'ACTIVE',
        normalizedSourceBinding,
        guestProfileSummary: buildGuestProfileSummary(
          guestProfile,
          normalizedSourceBinding.telegram_user_summary
        ),
        attributionSessionReference:
          buildAttributionSessionReference(attributionSession),
        sellerAttributionActive: true,
        attributionStartedAtSummary: buildTimestampSummary(startsAt),
        attributionExpiresAtSummary: buildTimestampSummary(expiresAt),
        noOpGuards,
      })
    );

    return buildResultFromRow(eventRow);
  }

  createNoAttributionResult(normalizedSourceBinding) {
    const noAttributionReason =
      SKIP_REASONS_BY_BINDING_STATUS[normalizedSourceBinding.binding_status];
    if (!noAttributionReason) {
      rejectAttributionStart(
        `Unsupported no-attribution outcome: ${normalizedSourceBinding.binding_status}`
      );
    }

    const eventRow = this.sellerAttributionSessionStartEvents.create(
      buildStartEventRowPayload({
        eventType: TELEGRAM_SELLER_ATTRIBUTION_SESSION_SKIPPED_EVENT_TYPE,
        attributionStatus: NO_ATTRIBUTION_STATUS,
        noAttributionReason,
        normalizedSourceBinding,
        sellerAttributionActive: false,
        noOpGuards: buildNoOpGuards(false),
      })
    );

    return buildResultFromRow(eventRow);
  }

  startSellerAttributionFromSourceBinding(input = {}) {
    const runStart = () => {
      const normalizedSourceBinding = normalizeSourceBindingResult(
        pickSourceBindingResult(input)
      );
      const idempotentEvent =
        this.resolveIdempotentStartEvent(normalizedSourceBinding);
      if (idempotentEvent) {
        return buildResultFromRow(idempotentEvent);
      }

      const persistedSourceBinding =
        this.guestEntrySourceBindingEvents.getById(
          normalizedSourceBinding.source_binding_reference.source_binding_event_id
        );
      assertPersistedSourceBindingMatches(
        persistedSourceBinding,
        normalizedSourceBinding
      );

      if (normalizedSourceBinding.binding_status !== 'resolved_seller_source') {
        return this.createNoAttributionResult(normalizedSourceBinding);
      }

      return this.createSellerAttributionStart(normalizedSourceBinding);
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runStart)();
    }

    return runStart();
  }

  startFromSourceBinding(input = {}) {
    return this.startSellerAttributionFromSourceBinding(input);
  }

  start(input = {}) {
    return this.startSellerAttributionFromSourceBinding(input);
  }
}
