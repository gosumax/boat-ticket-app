import {
  buildTelegramHandoffTimestampSummary,
  buildTelegramLatestTimestampSummary,
  freezeTelegramSourceAnalyticsReportingValue,
  TELEGRAM_SOURCE_ANALYTICS_FUNNEL_SUMMARY_VERSION,
  TELEGRAM_SOURCE_ANALYTICS_REPORT_ITEM_VERSION,
  TELEGRAM_SOURCE_ANALYTICS_REPORT_LIST_VERSION,
} from '../../../shared/telegram/index.js';

const ERROR_PREFIX = '[TELEGRAM_SOURCE_ANALYTICS_REPORTING]';
const SERVICE_NAME = 'telegram_source_analytics_reporting_service';

function rejectAnalyticsReporting(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (value === true || value === false) {
    return value;
  }
  if (value === 1 || value === 0) {
    return value === 1;
  }
  rejectAnalyticsReporting('boolean filter is invalid');
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectAnalyticsReporting(`${label} must be a positive integer`);
  }
  return normalized;
}

function buildSourceRegistryReference(row) {
  return freezeTelegramSourceAnalyticsReportingValue({
    reference_type: 'telegram_source_registry_item',
    source_registry_item_id: row.source_registry_item_id,
    source_reference: row.source_reference,
  });
}

function safeLower(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function isBridgeSuccess(payload = {}) {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (payload.linked_to_presale === true) {
    return true;
  }
  if (payload.confirmed_presale_id !== undefined && payload.confirmed_presale_id !== null) {
    return true;
  }
  const indicators = [
    payload.bridge_outcome,
    payload.bridge_status,
    payload.outcome,
    payload.result,
    payload.status,
    payload.handoff_status,
  ]
    .map((value) => safeLower(value))
    .filter(Boolean);
  if (
    indicators.some((value) =>
      [
        'success',
        'succeeded',
        'linked',
        'linked_to_presale',
        'consumed',
        'handoff_consumed',
        'presale_bridged',
      ].includes(value)
    )
  ) {
    return true;
  }
  if (
    indicators.some((value) =>
      ['failed', 'blocked', 'rejected', 'error', 'handoff_blocked'].includes(value)
    )
  ) {
    return false;
  }
  return false;
}

function isCompletedTrip(payload = {}) {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (payload.completed_trip === true || payload.trip_completed === true) {
    return true;
  }
  const indicators = [
    payload.trip_status,
    payload.outcome,
    payload.result,
    payload.status,
  ]
    .map((value) => safeLower(value))
    .filter(Boolean);
  return indicators.some((value) =>
    ['completed', 'trip_completed', 'boarding_completed'].includes(value)
  );
}

function createCountersSeed() {
  return {
    entries: 0,
    source_bindings: 0,
    attribution_starts: 0,
    booking_requests: 0,
    prepayment_confirmations: 0,
    bridged_presales: 0,
    completed_trips: 0,
    review_submissions: 0,
  };
}

function computeCounters(rows = []) {
  const counters = createCountersSeed();
  for (const row of rows) {
    const eventType = normalizeString(row.analytics_event_type);
    if (!eventType) {
      continue;
    }
    if (eventType === 'guest_entry') {
      counters.entries += 1;
      continue;
    }
    if (eventType === 'source_binding') {
      counters.source_bindings += 1;
      continue;
    }
    if (eventType === 'attribution_start') {
      counters.attribution_starts += 1;
      continue;
    }
    if (eventType === 'booking_request_created') {
      counters.booking_requests += 1;
      continue;
    }
    if (eventType === 'prepayment_confirmed') {
      counters.prepayment_confirmations += 1;
      continue;
    }
    if (eventType === 'bridge_outcome') {
      if (isBridgeSuccess(row.event_payload)) {
        counters.bridged_presales += 1;
      }
      if (isCompletedTrip(row.event_payload)) {
        counters.completed_trips += 1;
      }
      continue;
    }
    if (eventType === 'review_submitted') {
      counters.review_submissions += 1;
    }
  }

  return freezeTelegramSourceAnalyticsReportingValue(counters);
}

function buildRatioSummary(numerator, denominator) {
  if (!denominator) {
    return freezeTelegramSourceAnalyticsReportingValue({
      ratio: null,
      percentage: null,
    });
  }
  const ratio = Number((numerator / denominator).toFixed(4));
  return freezeTelegramSourceAnalyticsReportingValue({
    ratio,
    percentage: Number((ratio * 100).toFixed(2)),
  });
}

function computeConversionSummary(counters) {
  return freezeTelegramSourceAnalyticsReportingValue({
    source_bindings_from_entries: buildRatioSummary(
      counters.source_bindings,
      counters.entries
    ),
    attribution_starts_from_source_bindings: buildRatioSummary(
      counters.attribution_starts,
      counters.source_bindings
    ),
    booking_requests_from_entries: buildRatioSummary(
      counters.booking_requests,
      counters.entries
    ),
    prepayment_confirmations_from_booking_requests: buildRatioSummary(
      counters.prepayment_confirmations,
      counters.booking_requests
    ),
    bridged_presales_from_prepayment_confirmations: buildRatioSummary(
      counters.bridged_presales,
      counters.prepayment_confirmations
    ),
    completed_trips_from_bridged_presales: buildRatioSummary(
      counters.completed_trips,
      counters.bridged_presales
    ),
    review_submissions_from_completed_trips: buildRatioSummary(
      counters.review_submissions,
      counters.completed_trips
    ),
    review_submissions_from_entries: buildRatioSummary(
      counters.review_submissions,
      counters.entries
    ),
  });
}

function buildSourcePerformanceSummary({
  row,
  counters,
  conversionSummary,
  reportingIso,
  latestSourceEventIso,
}) {
  return freezeTelegramSourceAnalyticsReportingValue({
    source_reference: buildSourceRegistryReference(row),
    source_type_family_summary: freezeTelegramSourceAnalyticsReportingValue({
      source_family: row.source_family,
      source_type: row.source_type,
    }),
    counters_summary: counters,
    conversion_summary: conversionSummary,
    reporting_timestamp_summary: buildTelegramHandoffTimestampSummary(reportingIso),
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      reportingIso,
      latestSourceEventIso,
      row.updated_at,
      row.created_at
    ),
  });
}

function normalizeSourceReferenceInput(input = {}) {
  if (typeof input === 'number') {
    return freezeTelegramSourceAnalyticsReportingValue({
      source_registry_item_id: normalizePositiveInteger(
        input,
        'source_registry_item_id'
      ),
      source_reference: null,
    });
  }
  if (typeof input === 'string') {
    return freezeTelegramSourceAnalyticsReportingValue({
      source_registry_item_id: null,
      source_reference: normalizeString(input),
    });
  }
  if (!isPlainObject(input)) {
    rejectAnalyticsReporting('source reference is required');
  }
  const sourceRegistryItemIdRaw =
    input.source_registry_item_id ?? input.sourceRegistryItemId;
  const sourceReferenceRaw =
    input.source_reference ??
    input.sourceReference ??
    input.reference;
  if (
    (sourceRegistryItemIdRaw === undefined ||
      sourceRegistryItemIdRaw === null ||
      sourceRegistryItemIdRaw === '') &&
    (sourceReferenceRaw === undefined ||
      sourceReferenceRaw === null ||
      sourceReferenceRaw === '')
  ) {
    rejectAnalyticsReporting('source reference is required');
  }

  return freezeTelegramSourceAnalyticsReportingValue({
    source_registry_item_id:
      sourceRegistryItemIdRaw === undefined ||
      sourceRegistryItemIdRaw === null ||
      sourceRegistryItemIdRaw === ''
        ? null
        : normalizePositiveInteger(sourceRegistryItemIdRaw, 'source_registry_item_id'),
    source_reference:
      sourceReferenceRaw === undefined ||
      sourceReferenceRaw === null ||
      sourceReferenceRaw === ''
        ? null
        : normalizeString(sourceReferenceRaw),
  });
}

function normalizeListFilters(input = {}) {
  if (input === null || input === undefined) {
    return freezeTelegramSourceAnalyticsReportingValue({
      enabled: null,
    });
  }
  if (!isPlainObject(input)) {
    rejectAnalyticsReporting('source analytics list input must be an object');
  }
  return freezeTelegramSourceAnalyticsReportingValue({
    enabled: normalizeBoolean(
      input.enabled ?? input.is_enabled ?? input.isEnabled,
      null
    ),
  });
}

export class TelegramSourceAnalyticsReportingService {
  constructor({
    analyticsCaptureEvents,
    sourceRegistryItems,
    now = () => new Date(),
  }) {
    this.analyticsCaptureEvents = analyticsCaptureEvents;
    this.sourceRegistryItems = sourceRegistryItems;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'telegram_source_analytics_reporting_ready',
      dependencyKeys: ['analyticsCaptureEvents', 'sourceRegistryItems'],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectAnalyticsReporting('source analytics reporting clock returned an unusable timestamp');
    }
    return iso;
  }

  listAllSourceRegistryRows() {
    return this.sourceRegistryItems.listBy(
      {},
      { orderBy: 'source_registry_item_id ASC', limit: 2000 }
    );
  }

  findSourceRegistryRow(referenceInput = {}) {
    const normalized = normalizeSourceReferenceInput(referenceInput);
    if (normalized.source_registry_item_id) {
      const byId = this.sourceRegistryItems.getById(normalized.source_registry_item_id);
      if (byId) {
        return byId;
      }
    }
    if (normalized.source_reference) {
      const byReference = this.sourceRegistryItems.findOneBy(
        { source_reference: normalized.source_reference },
        { orderBy: 'source_registry_item_id ASC' }
      );
      if (byReference) {
        return byReference;
      }
    }
    rejectAnalyticsReporting('invalid or non-projectable source input');
  }

  listAllAnalyticsRows() {
    return this.analyticsCaptureEvents.listBy(
      {},
      { orderBy: 'analytics_capture_event_id ASC', limit: 20000 }
    );
  }

  getAnalyticsRowsForSource(sourceRegistryItemId, analyticsRows) {
    return analyticsRows.filter(
      (row) =>
        row.source_reference_type === 'telegram_source_registry_item' &&
        String(row.source_reference_id) === String(sourceRegistryItemId)
    );
  }

  buildSourceReportRow(sourceRow, analyticsRows, reportingIso) {
    const sourceRows = this.getAnalyticsRowsForSource(
      sourceRow.source_registry_item_id,
      analyticsRows
    );
    const counters = computeCounters(sourceRows);
    const conversionSummary = computeConversionSummary(counters);
    const latestSourceEventIso =
      sourceRows[sourceRows.length - 1]?.event_at || null;
    return buildSourcePerformanceSummary({
      row: sourceRow,
      counters,
      conversionSummary,
      reportingIso,
      latestSourceEventIso,
    });
  }

  listSourcePerformanceSummaries(input = {}) {
    const filters = normalizeListFilters(input);
    const reportingIso = this.nowIso();
    let sourceRows = this.listAllSourceRegistryRows();
    if (filters.enabled !== null) {
      sourceRows = sourceRows.filter(
        (row) => Boolean(row.is_enabled) === filters.enabled
      );
    }
    const analyticsRows = this.listAllAnalyticsRows();
    const items = sourceRows.map((row) =>
      this.buildSourceReportRow(row, analyticsRows, reportingIso)
    );
    return freezeTelegramSourceAnalyticsReportingValue({
      response_version: TELEGRAM_SOURCE_ANALYTICS_REPORT_LIST_VERSION,
      read_only: true,
      projected_by: SERVICE_NAME,
      enabled_filter_summary: filters.enabled,
      item_count: items.length,
      items,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        reportingIso,
        ...items.map((item) => item.latest_timestamp_summary?.iso)
      ),
    });
  }

  readSourcePerformanceReportBySourceReference(input = {}) {
    const reportingIso = this.nowIso();
    const sourceRow = this.findSourceRegistryRow(input);
    const analyticsRows = this.listAllAnalyticsRows();
    const report = this.buildSourceReportRow(sourceRow, analyticsRows, reportingIso);
    return freezeTelegramSourceAnalyticsReportingValue({
      response_version: TELEGRAM_SOURCE_ANALYTICS_REPORT_ITEM_VERSION,
      read_only: true,
      projected_by: SERVICE_NAME,
      source_performance_report: report,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        reportingIso,
        report.latest_timestamp_summary?.iso
      ),
    });
  }

  readOverallTelegramFunnelCountersSummary(input = {}) {
    if (!isPlainObject(input) && input !== null && input !== undefined) {
      rejectAnalyticsReporting('overall funnel input must be an object');
    }
    const reportingIso = this.nowIso();
    const analyticsRows = this.listAllAnalyticsRows();
    const counters = computeCounters(analyticsRows);
    const conversionSummary = computeConversionSummary(counters);
    const sourceCount = this.listAllSourceRegistryRows().length;
    return freezeTelegramSourceAnalyticsReportingValue({
      response_version: TELEGRAM_SOURCE_ANALYTICS_FUNNEL_SUMMARY_VERSION,
      read_only: true,
      projected_by: SERVICE_NAME,
      counters_summary: counters,
      conversion_summary: conversionSummary,
      source_coverage_summary: freezeTelegramSourceAnalyticsReportingValue({
        registered_sources: sourceCount,
      }),
      reporting_timestamp_summary: buildTelegramHandoffTimestampSummary(reportingIso),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        reportingIso,
        ...analyticsRows.map((row) => row.event_at)
      ),
    });
  }
}
