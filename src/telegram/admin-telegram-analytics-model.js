export const TELEGRAM_ANALYTICS_VIEW_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  DETAIL_LOADING: 'detail_loading',
  DETAIL_WARNING: 'detail_warning',
  ERROR: 'error',
});

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  return normalized;
}

function toPercentOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return null;
  }
  return Number(normalized.toFixed(2));
}

function ratioPercent(numerator, denominator) {
  if (!denominator) return null;
  const ratio = (Number(numerator) || 0) / Number(denominator);
  return Number((ratio * 100).toFixed(2));
}

function resolvePercentage(summary, key, numerator = 0, denominator = 0) {
  const explicit = toPercentOrNull(summary?.[key]?.percentage);
  if (explicit !== null) {
    return explicit;
  }
  return ratioPercent(numerator, denominator);
}

function normalizeCountersSummary(value = null) {
  return Object.freeze({
    entries: toNumber(value?.entries),
    source_bindings: toNumber(value?.source_bindings),
    attribution_starts: toNumber(value?.attribution_starts),
    booking_requests: toNumber(value?.booking_requests),
    prepayment_confirmations: toNumber(value?.prepayment_confirmations),
    bridged_presales: toNumber(value?.bridged_presales),
    completed_trips: toNumber(value?.completed_trips),
    review_submissions: toNumber(value?.review_submissions),
  });
}

function normalizeConversionSummary(counters, value = null) {
  return Object.freeze({
    source_bindings_from_entries_pct: resolvePercentage(
      value,
      'source_bindings_from_entries',
      counters.source_bindings,
      counters.entries
    ),
    booking_requests_from_entries_pct: resolvePercentage(
      value,
      'booking_requests_from_entries',
      counters.booking_requests,
      counters.entries
    ),
    prepayment_confirmations_from_booking_requests_pct: resolvePercentage(
      value,
      'prepayment_confirmations_from_booking_requests',
      counters.prepayment_confirmations,
      counters.booking_requests
    ),
    bridged_presales_from_prepayment_confirmations_pct: resolvePercentage(
      value,
      'bridged_presales_from_prepayment_confirmations',
      counters.bridged_presales,
      counters.prepayment_confirmations
    ),
    completed_trips_from_bridged_presales_pct: resolvePercentage(
      value,
      'completed_trips_from_bridged_presales',
      counters.completed_trips,
      counters.bridged_presales
    ),
    review_submissions_from_completed_trips_pct: resolvePercentage(
      value,
      'review_submissions_from_completed_trips',
      counters.review_submissions,
      counters.completed_trips
    ),
    review_submissions_from_entries_pct: resolvePercentage(
      value,
      'review_submissions_from_entries',
      counters.review_submissions,
      counters.entries
    ),
  });
}

function normalizeSourceReport(report = null) {
  const sourceReference =
    normalizeString(report?.source_reference?.source_reference) ||
    normalizeString(report?.source_reference);
  if (!sourceReference) {
    return null;
  }
  const counters = normalizeCountersSummary(report?.counters_summary);
  return Object.freeze({
    sourceReference,
    sourceFamily: normalizeString(report?.source_type_family_summary?.source_family) || 'unknown',
    sourceType: normalizeString(report?.source_type_family_summary?.source_type) || 'unknown',
    counters,
    conversion: normalizeConversionSummary(counters, report?.conversion_summary),
    latestIso: normalizeString(report?.latest_timestamp_summary?.iso),
  });
}

function sortBySourceReference(left, right) {
  return String(left?.sourceReference || '').localeCompare(
    String(right?.sourceReference || '')
  );
}

function buildFunnelSteps(counters) {
  const ordered = [
    {
      key: 'entries',
      label: 'Entries',
      count: counters.entries,
    },
    {
      key: 'attribution_starts',
      label: 'Attribution starts',
      count: counters.attribution_starts,
    },
    {
      key: 'booking_requests',
      label: 'Request creation',
      count: counters.booking_requests,
    },
    {
      key: 'prepayment_confirmations',
      label: 'Prepayment confirmations',
      count: counters.prepayment_confirmations,
    },
    {
      key: 'bridged_presales',
      label: 'Confirmed bookings',
      count: counters.bridged_presales,
    },
    {
      key: 'completed_trips',
      label: 'Completed rides',
      count: counters.completed_trips,
    },
    {
      key: 'review_submissions',
      label: 'Reviews',
      count: counters.review_submissions,
    },
  ];

  return Object.freeze(
    ordered.map((step, index) => {
      const prevCount = index > 0 ? ordered[index - 1].count : null;
      const dropoffFromPrevious =
        prevCount === null ? null : Math.max(0, Number(prevCount) - Number(step.count));
      return Object.freeze({
        ...step,
        dropoff_from_previous: dropoffFromPrevious,
        conversion_from_previous_pct:
          prevCount === null ? null : ratioPercent(step.count, prevCount),
        conversion_from_entries_pct: ratioPercent(step.count, counters.entries),
      });
    })
  );
}

export function formatTelegramAnalyticsPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'n/a';
  }
  return `${Number(value).toFixed(2)}%`;
}

export function resolveTelegramAnalyticsErrorMessage(error, fallbackMessage) {
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
  return message || fallbackMessage;
}

function resolveSelectedSourceReference(sourceReports, preferredSourceReference) {
  const preferred = normalizeString(preferredSourceReference);
  if (
    preferred &&
    sourceReports.some((item) => item.sourceReference === preferred)
  ) {
    return preferred;
  }
  return sourceReports[0]?.sourceReference || null;
}

function assertAnalyticsApiClient(apiClient) {
  const requiredMethods = [
    'getTelegramAdminSourceAnalyticsFunnelSummary',
    'getTelegramAdminSourceAnalyticsSummaries',
    'getTelegramAdminSourceAnalyticsReport',
  ];
  for (const methodName of requiredMethods) {
    if (typeof apiClient?.[methodName] !== 'function') {
      throw new Error(`Analytics API client method is required: ${methodName}`);
    }
  }
}

export async function loadTelegramAnalyticsSnapshot({
  apiClient,
  preferredSourceReference = null,
} = {}) {
  assertAnalyticsApiClient(apiClient);

  const [funnelSummary, sourceAnalyticsList] = await Promise.all([
    apiClient.getTelegramAdminSourceAnalyticsFunnelSummary(),
    apiClient.getTelegramAdminSourceAnalyticsSummaries(),
  ]);

  const sourceReports = toArray(sourceAnalyticsList?.items)
    .map((item) => normalizeSourceReport(item))
    .filter(Boolean)
    .sort(sortBySourceReference);
  const selectedSourceReference = resolveSelectedSourceReference(
    sourceReports,
    preferredSourceReference
  );

  let sourceDetailReport = null;
  let sourceDetailError = '';

  if (selectedSourceReference) {
    try {
      const detailSummary = await apiClient.getTelegramAdminSourceAnalyticsReport(
        selectedSourceReference
      );
      sourceDetailReport = detailSummary?.source_performance_report || null;
      if (!sourceDetailReport) {
        sourceDetailError = 'Source detail is unavailable for this reference.';
      }
    } catch (error) {
      sourceDetailError = resolveTelegramAnalyticsErrorMessage(
        error,
        'Source detail is unavailable for this reference.'
      );
    }
  }

  return Object.freeze({
    funnelSummary: funnelSummary || {},
    sourceAnalyticsList: sourceAnalyticsList || { items: [] },
    selectedSourceReference,
    sourceDetailReport,
    sourceDetailError,
  });
}

export function buildTelegramAnalyticsScreenModel({
  funnelSummary = null,
  sourceAnalyticsList = null,
  selectedSourceReference = null,
  sourceDetailReport = null,
  sourceDetailError = '',
} = {}) {
  const overallCounters = normalizeCountersSummary(funnelSummary?.counters_summary);
  const overallConversion = normalizeConversionSummary(
    overallCounters,
    funnelSummary?.conversion_summary
  );

  const sourceReports = toArray(sourceAnalyticsList?.items)
    .map((item) => normalizeSourceReport(item))
    .filter(Boolean)
    .sort(sortBySourceReference);

  const selectedReference = resolveSelectedSourceReference(
    sourceReports,
    selectedSourceReference
  );
  const selectedSourceSummary =
    sourceReports.find((item) => item.sourceReference === selectedReference) || null;
  const normalizedDetailReport = normalizeSourceReport(sourceDetailReport);
  const selectedSourceDetail =
    normalizedDetailReport?.sourceReference === selectedReference
      ? normalizedDetailReport
      : null;
  const selectedSourceReport = selectedSourceDetail || selectedSourceSummary || null;
  const selectedSourceFunnelSteps = selectedSourceReport
    ? buildFunnelSteps(selectedSourceReport.counters)
    : Object.freeze([]);

  const totalEntries = overallCounters.entries;
  const totalReviews = overallCounters.review_submissions;

  return Object.freeze({
    summary: Object.freeze({
      registered_sources: toNumber(
        funnelSummary?.source_coverage_summary?.registered_sources
      ),
      entries: totalEntries,
      booking_requests: overallCounters.booking_requests,
      confirmed_bookings: overallCounters.bridged_presales,
      completed_rides: overallCounters.completed_trips,
      reviews: totalReviews,
      final_dropoff_count: Math.max(0, totalEntries - totalReviews),
      final_conversion_from_entries_pct: ratioPercent(totalReviews, totalEntries),
    }),
    overallCounters,
    overallConversion,
    funnelSteps: buildFunnelSteps(overallCounters),
    sourceReports: Object.freeze(sourceReports),
    selectedSourceReference: selectedReference,
    selectedSourceSummary,
    selectedSourceDetail,
    selectedSourceReport,
    selectedSourceFunnelSteps,
    selectedSourceDetailUnavailable:
      Boolean(selectedReference) && !selectedSourceDetail && Boolean(sourceDetailError),
    sourceDetailError: sourceDetailError || '',
    hasAnySources: sourceReports.length > 0,
    hasAnyOverallData:
      overallCounters.entries > 0 ||
      overallCounters.booking_requests > 0 ||
      overallCounters.prepayment_confirmations > 0 ||
      overallCounters.bridged_presales > 0 ||
      overallCounters.completed_trips > 0 ||
      overallCounters.review_submissions > 0,
  });
}

export function reduceTelegramAnalyticsViewState(currentState, event = {}) {
  const previous = currentState || TELEGRAM_ANALYTICS_VIEW_STATES.IDLE;
  switch (event.type) {
    case 'start_load':
      return TELEGRAM_ANALYTICS_VIEW_STATES.LOADING;
    case 'load_success':
      return TELEGRAM_ANALYTICS_VIEW_STATES.READY;
    case 'load_error':
      return TELEGRAM_ANALYTICS_VIEW_STATES.ERROR;
    case 'start_detail':
      return TELEGRAM_ANALYTICS_VIEW_STATES.DETAIL_LOADING;
    case 'detail_success':
      return TELEGRAM_ANALYTICS_VIEW_STATES.READY;
    case 'detail_error':
      return TELEGRAM_ANALYTICS_VIEW_STATES.DETAIL_WARNING;
    case 'reset_feedback':
      return TELEGRAM_ANALYTICS_VIEW_STATES.READY;
    default:
      return previous;
  }
}
