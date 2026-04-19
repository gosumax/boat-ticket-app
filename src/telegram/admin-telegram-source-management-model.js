export const TELEGRAM_SOURCE_EDITOR_VIEW_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  SAVING: 'saving',
  SAVED: 'saved',
  CONFLICT: 'conflict',
  ERROR: 'error',
});

export const TELEGRAM_SOURCE_FORM_MODES = Object.freeze({
  CREATE: 'create',
  EDIT: 'edit',
});

export const TELEGRAM_SOURCE_FAMILY_TYPE_OPTIONS = Object.freeze({
  seller_source: Object.freeze([
    'seller_qr',
    'seller_direct_link',
    'seller_tshirt_qr',
  ]),
  owner_source: Object.freeze(['owner_source']),
  generic_source: Object.freeze([
    'generic_qr',
    'bot_search_entry',
    'messenger_link',
    'other_campaign',
  ]),
  point_promo_source: Object.freeze(['promo_qr', 'point_qr']),
});

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return Boolean(fallback);
}

function toPositiveIntegerOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function normalizeObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return null;
}

export function getSourceTypeOptionsForFamily(sourceFamily) {
  return TELEGRAM_SOURCE_FAMILY_TYPE_OPTIONS[sourceFamily] || [];
}

function resolveSourceTypeForFamily(sourceFamily, requestedSourceType = null) {
  const options = getSourceTypeOptionsForFamily(sourceFamily);
  const normalizedRequested = normalizeString(requestedSourceType);
  if (normalizedRequested && options.includes(normalizedRequested)) {
    return normalizedRequested;
  }
  return options[0] || '';
}

function sortByReference(left, right) {
  return String(left?.sourceReference || '').localeCompare(
    String(right?.sourceReference || '')
  );
}

function normalizeSourceRegistryItem(item) {
  const sourceReference =
    normalizeString(item?.source_reference?.source_reference) ||
    normalizeString(item?.source_reference);
  const sourceFamily =
    normalizeString(item?.source_type_family_summary?.source_family) ||
    'generic_source';
  const sourceType =
    normalizeString(item?.source_type_family_summary?.source_type) ||
    resolveSourceTypeForFamily(sourceFamily);
  const sourceToken =
    normalizeString(item?.source_token_summary?.source_token) || '';
  const sellerId = toPositiveIntegerOrNull(
    item?.seller_reference?.seller_id ??
      item?.seller_id
  );
  const isEnabled = toBoolean(item?.enabled_state_summary?.enabled, true);
  const isExportable = toBoolean(
    item?.printable_exportable_flag_summary?.exportable,
    true
  );

  return Object.freeze({
    sourceReference: sourceReference || '',
    sourceFamily,
    sourceType: resolveSourceTypeForFamily(sourceFamily, sourceType),
    sourceToken,
    sellerId,
    isEnabled,
    isExportable,
    latestIso: item?.latest_timestamp_summary?.iso || null,
  });
}

function mapAnalyticsBySourceReference(analyticsList) {
  const map = new Map();
  for (const item of toArray(analyticsList?.items)) {
    const reference = normalizeString(item?.source_reference?.source_reference);
    if (reference) {
      map.set(reference, item);
    }
  }
  return map;
}

function mapQrPayloadBySourceReference(qrExportPayloadList) {
  const map = new Map();
  for (const item of toArray(qrExportPayloadList?.items)) {
    const reference = normalizeString(item?.source_reference?.source_reference);
    if (reference) {
      map.set(reference, item);
    }
  }
  return map;
}

function normalizeCountersSummary(analyticsItem) {
  const counters = normalizeObject(analyticsItem?.counters_summary) || {};
  return Object.freeze({
    entries: Number(counters.entries || 0),
    attribution_starts: Number(counters.attribution_starts || 0),
    booking_requests: Number(counters.booking_requests || 0),
    confirmed_bookings: Number(counters.prepayment_confirmations || 0),
    completed_rides: Number(counters.completed_trips || 0),
  });
}

function normalizeConversionSummary(analyticsItem) {
  const conversion = normalizeObject(analyticsItem?.conversion_summary) || {};
  const bookingFromEntries = normalizeObject(conversion.booking_requests_from_entries) || {};
  const confirmedFromRequests =
    normalizeObject(conversion.prepayment_confirmations_from_booking_requests) || {};
  const completedFromConfirmed =
    normalizeObject(conversion.completed_trips_from_bridged_presales) || {};

  return Object.freeze({
    booking_requests_from_entries_pct:
      bookingFromEntries.percentage === null || bookingFromEntries.percentage === undefined
        ? null
        : Number(bookingFromEntries.percentage),
    confirmed_bookings_from_requests_pct:
      confirmedFromRequests.percentage === null ||
      confirmedFromRequests.percentage === undefined
        ? null
        : Number(confirmedFromRequests.percentage),
    completed_rides_from_confirmed_pct:
      completedFromConfirmed.percentage === null ||
      completedFromConfirmed.percentage === undefined
        ? null
        : Number(completedFromConfirmed.percentage),
  });
}

export function createTelegramSourceDraft(sourceItem = null) {
  const sourceFamily = sourceItem?.sourceFamily || 'generic_source';
  const sourceType = resolveSourceTypeForFamily(
    sourceFamily,
    sourceItem?.sourceType
  );
  const sourcePayload = normalizeObject(sourceItem?.sourcePayload) || {};

  return Object.freeze({
    sourceReference: normalizeString(sourceItem?.sourceReference) || '',
    sourceFamily,
    sourceType,
    sourceToken: normalizeString(sourceItem?.sourceToken) || '',
    sellerId:
      sourceItem?.sellerId === null || sourceItem?.sellerId === undefined
        ? ''
        : String(sourceItem.sellerId),
    isEnabled: toBoolean(sourceItem?.isEnabled, true),
    isExportable: toBoolean(sourceItem?.isExportable, true),
    sourcePayloadText: JSON.stringify(sourcePayload, null, 2),
  });
}

export function buildTelegramSourceManagementModel({
  sourceRegistryList = null,
  analyticsList = null,
  qrExportPayloadList = null,
  selectedSourceReference = null,
  sourceDrafts = {},
  activeFormMode = TELEGRAM_SOURCE_FORM_MODES.EDIT,
} = {}) {
  const analyticsBySource = mapAnalyticsBySourceReference(analyticsList);
  const qrBySource = mapQrPayloadBySourceReference(qrExportPayloadList);

  const sources = toArray(sourceRegistryList?.items)
    .map((item) => {
      const normalized = normalizeSourceRegistryItem(item);
      const analyticsItem = analyticsBySource.get(normalized.sourceReference) || null;
      const counters = normalizeCountersSummary(analyticsItem);
      return Object.freeze({
        ...normalized,
        counters,
        hasAnalytics: Boolean(analyticsItem),
        hasQrPayload: qrBySource.has(normalized.sourceReference),
      });
    })
    .sort(sortByReference);

  const selectedSource =
    sources.find((item) => item.sourceReference === selectedSourceReference) ||
    sources[0] ||
    null;
  const selectedReference = selectedSource?.sourceReference || null;
  const selectedDraft =
    activeFormMode === TELEGRAM_SOURCE_FORM_MODES.CREATE
      ? sourceDrafts.__create__ || createTelegramSourceDraft(null)
      : selectedReference
        ? sourceDrafts[selectedReference] || createTelegramSourceDraft(selectedSource)
        : createTelegramSourceDraft(null);

  const selectedAnalyticsItem = selectedSource
    ? analyticsBySource.get(selectedSource.sourceReference) || null
    : null;
  const selectedQrPayloadItem = selectedSource
    ? qrBySource.get(selectedSource.sourceReference) || null
    : null;

  const summary = Object.freeze({
    total_sources: sources.length,
    enabled_sources: sources.filter((item) => item.isEnabled).length,
    seller_bound_sources: sources.filter((item) => item.sellerId !== null).length,
    exportable_sources: sources.filter((item) => item.isExportable).length,
  });

  return Object.freeze({
    sources: Object.freeze(sources),
    selectedSource,
    selectedSourceReference: selectedReference,
    selectedDraft,
    selectedAnalyticsItem,
    selectedCounters: normalizeCountersSummary(selectedAnalyticsItem),
    selectedConversion: normalizeConversionSummary(selectedAnalyticsItem),
    selectedQrPayloadItem,
    sourceTypeOptions: Object.freeze(
      getSourceTypeOptionsForFamily(selectedDraft.sourceFamily)
    ),
    activeFormMode,
    summary,
  });
}

export function resolveTelegramSourceEditorErrorMessage(error, fallbackMessage) {
  const response = error?.response;
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    if (response.rejection_reason) {
      return String(response.rejection_reason);
    }
    if (response.error) {
      return String(response.error);
    }
    if (response.message) {
      return String(response.message);
    }
  }

  const message = normalizeString(error?.message);
  if (!message) {
    return fallbackMessage;
  }
  return message;
}

export function classifyTelegramSourceEditorStateByError(errorMessage) {
  const message = normalizeString(errorMessage)?.toLowerCase() || '';
  if (message.includes('version conflict')) {
    return TELEGRAM_SOURCE_EDITOR_VIEW_STATES.CONFLICT;
  }
  return TELEGRAM_SOURCE_EDITOR_VIEW_STATES.ERROR;
}

export function reduceTelegramSourceEditorState(currentState, event = {}) {
  const previous = currentState || TELEGRAM_SOURCE_EDITOR_VIEW_STATES.IDLE;
  switch (event.type) {
    case 'start_load':
      return TELEGRAM_SOURCE_EDITOR_VIEW_STATES.LOADING;
    case 'load_success':
      return TELEGRAM_SOURCE_EDITOR_VIEW_STATES.READY;
    case 'load_error':
      return TELEGRAM_SOURCE_EDITOR_VIEW_STATES.ERROR;
    case 'start_save':
      return TELEGRAM_SOURCE_EDITOR_VIEW_STATES.SAVING;
    case 'save_success':
      return TELEGRAM_SOURCE_EDITOR_VIEW_STATES.SAVED;
    case 'save_error':
      return classifyTelegramSourceEditorStateByError(event.errorMessage);
    case 'reset_feedback':
      return TELEGRAM_SOURCE_EDITOR_VIEW_STATES.READY;
    default:
      return previous;
  }
}
