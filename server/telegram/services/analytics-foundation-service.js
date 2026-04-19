import {
  buildTelegramHandoffTimestampSummary,
  buildTelegramLatestTimestampSummary,
  freezeTelegramAnalyticsFoundationValue,
  TELEGRAM_ANALYTICS_CAPTURE_EVENT_VERSION,
  TELEGRAM_ANALYTICS_CAPTURE_LIST_VERSION,
  TELEGRAM_ANALYTICS_COUNTERS_SUMMARY_VERSION,
  TELEGRAM_ANALYTICS_EVENT_TYPE_ALIASES,
  TELEGRAM_ANALYTICS_SAFE_EVENT_TYPES,
} from '../../../shared/telegram/index.js';

const ERROR_PREFIX = '[TELEGRAM_ANALYTICS_FOUNDATION]';
const SERVICE_NAME = 'telegram_analytics_foundation_service';

const EVENT_REFERENCE_REQUIREMENTS = Object.freeze({
  guest_entry: Object.freeze(['guest_or_source']),
  source_binding: Object.freeze(['guest_or_source']),
  attribution_start: Object.freeze(['guest_or_source']),
  booking_request_created: Object.freeze(['booking_request']),
  hold_started: Object.freeze(['booking_request']),
  hold_extended: Object.freeze(['booking_request']),
  hold_expired: Object.freeze(['booking_request']),
  guest_cancelled_before_prepayment: Object.freeze(['booking_request']),
  prepayment_confirmed: Object.freeze(['booking_request']),
  handoff_prepared: Object.freeze(['booking_request']),
  bridge_outcome: Object.freeze(['booking_request']),
  notification_execution_outcome: Object.freeze(['booking_request']),
  review_submitted: Object.freeze(['booking_or_guest']),
});

function rejectAnalytics(message) {
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
    rejectAnalytics(`${label} must be a positive integer`);
  }
  return normalized;
}

function normalizeEventAt(value, fallbackNowIso) {
  const raw = normalizeString(value);
  if (!raw) {
    return fallbackNowIso;
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    rejectAnalytics('event timestamp summary is invalid');
  }
  return new Date(parsed).toISOString();
}

function normalizeEventType(value) {
  const raw = normalizeString(value);
  if (!raw) {
    rejectAnalytics('analytics event type is required');
  }
  const aliasMapped = TELEGRAM_ANALYTICS_EVENT_TYPE_ALIASES[raw] || null;
  const normalized = aliasMapped || raw.toLowerCase();
  if (!TELEGRAM_ANALYTICS_SAFE_EVENT_TYPES.includes(normalized)) {
    rejectAnalytics(`invalid or non-projectable analytics event type: ${raw}`);
  }
  return normalized;
}

function normalizePayload(value) {
  if (value === null || value === undefined || value === '') {
    return freezeTelegramAnalyticsFoundationValue({});
  }
  if (!isPlainObject(value)) {
    rejectAnalytics('analytics event payload must be an object when provided');
  }
  return freezeTelegramAnalyticsFoundationValue(value);
}

function normalizeReferenceType(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  if (
    normalized !== 'telegram_source_registry_item' &&
    normalized !== 'telegram_traffic_source'
  ) {
    rejectAnalytics(`Unsupported source reference type: ${normalized}`);
  }
  return normalized;
}

function buildAnalyticsEventReference(row) {
  return freezeTelegramAnalyticsFoundationValue({
    reference_type: 'telegram_analytics_capture_event',
    analytics_capture_event_id: row.analytics_capture_event_id,
    idempotency_key: row.idempotency_key,
  });
}

function buildGuestReference(guestProfileId) {
  if (!guestProfileId) return null;
  return freezeTelegramAnalyticsFoundationValue({
    reference_type: 'telegram_guest_profile',
    guest_profile_id: guestProfileId,
  });
}

function buildBookingRequestReference(bookingRequestId) {
  if (!bookingRequestId) return null;
  return freezeTelegramAnalyticsFoundationValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: bookingRequestId,
  });
}

function buildSourceReference({ sourceReferenceType, sourceReferenceId, sourceReferenceToken }) {
  if (!sourceReferenceType || !sourceReferenceId) {
    return null;
  }
  if (sourceReferenceType === 'telegram_source_registry_item') {
    return freezeTelegramAnalyticsFoundationValue({
      reference_type: sourceReferenceType,
      source_registry_item_id: Number(sourceReferenceId),
      source_token: sourceReferenceToken || null,
    });
  }
  return freezeTelegramAnalyticsFoundationValue({
    reference_type: sourceReferenceType,
    traffic_source_id: Number(sourceReferenceId),
    source_token: sourceReferenceToken || null,
  });
}

function buildEventProjection(row) {
  return freezeTelegramAnalyticsFoundationValue({
    analytics_event_reference: buildAnalyticsEventReference(row),
    event_type: row.analytics_event_type,
    guest_reference: buildGuestReference(row.guest_profile_id),
    source_reference: buildSourceReference({
      sourceReferenceType: row.source_reference_type,
      sourceReferenceId: row.source_reference_id,
      sourceReferenceToken: row.source_reference_token,
    }),
    booking_request_reference: buildBookingRequestReference(row.booking_request_id),
    event_timestamp_summary: buildTelegramHandoffTimestampSummary(row.event_at),
  });
}

function signaturesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class TelegramAnalyticsFoundationService {
  constructor({
    analyticsCaptureEvents,
    guestProfiles,
    bookingRequests,
    sourceRegistryItems,
    trafficSources,
    now = () => new Date(),
  }) {
    this.analyticsCaptureEvents = analyticsCaptureEvents;
    this.guestProfiles = guestProfiles;
    this.bookingRequests = bookingRequests;
    this.sourceRegistryItems = sourceRegistryItems;
    this.trafficSources = trafficSources;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'telegram_analytics_foundation_ready',
      dependencyKeys: [
        'analyticsCaptureEvents',
        'guestProfiles',
        'bookingRequests',
        'sourceRegistryItems',
        'trafficSources',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectAnalytics('analytics clock returned an unusable timestamp');
    }
    return iso;
  }

  resolveGuestProfileIdFromInput(input = {}, bookingRequest = null) {
    const explicitGuestProfileIdRaw =
      input.guest_profile_id ?? input.guestProfileId ?? null;
    if (
      explicitGuestProfileIdRaw !== null &&
      explicitGuestProfileIdRaw !== undefined &&
      explicitGuestProfileIdRaw !== ''
    ) {
      return normalizePositiveInteger(explicitGuestProfileIdRaw, 'guest_profile_id');
    }

    const guestReference =
      input.guest_reference ??
      input.guestReference ??
      input.guest_profile_reference ??
      input.guestProfileReference ??
      null;
    if (guestReference && isPlainObject(guestReference)) {
      return normalizePositiveInteger(
        guestReference.guest_profile_id ?? guestReference.guestProfileId,
        'guest_reference.guest_profile_id'
      );
    }

    const telegramUserReference =
      input.telegram_user_reference ??
      input.telegramUserReference ??
      input.telegram_user_summary ??
      input.telegramUserSummary ??
      null;
    if (telegramUserReference) {
      const telegramUserId = normalizeString(
        isPlainObject(telegramUserReference)
          ? telegramUserReference.telegram_user_id ??
              telegramUserReference.telegramUserId
          : telegramUserReference
      );
      if (telegramUserId) {
        const guest = this.guestProfiles.findOneBy(
          { telegram_user_id: telegramUserId },
          { orderBy: 'guest_profile_id ASC' }
        );
        if (guest) {
          return guest.guest_profile_id;
        }
      }
    }

    return bookingRequest?.guest_profile_id || null;
  }

  resolveBookingRequestFromInput(input = {}) {
    const explicitBookingRequestIdRaw =
      input.booking_request_id ?? input.bookingRequestId ?? null;
    const bookingRequestReference =
      input.booking_request_reference ??
      input.bookingRequestReference ??
      input.booking_request ??
      input.bookingRequest ??
      null;
    const bookingRequestIdRaw =
      explicitBookingRequestIdRaw ??
      (isPlainObject(bookingRequestReference)
        ? bookingRequestReference.booking_request_id ??
          bookingRequestReference.bookingRequestId
        : bookingRequestReference);

    if (bookingRequestIdRaw === null || bookingRequestIdRaw === undefined || bookingRequestIdRaw === '') {
      return null;
    }

    const bookingRequestId = normalizePositiveInteger(
      bookingRequestIdRaw,
      'booking_request_id'
    );
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectAnalytics(`booking request not found: ${bookingRequestId}`);
    }
    return bookingRequest;
  }

  resolveSourceReferenceFromInput(input = {}) {
    const sourceReferenceRaw =
      input.source_reference ??
      input.sourceReference ??
      input.source_registry_reference ??
      input.sourceRegistryReference ??
      input.traffic_source_reference ??
      input.trafficSourceReference ??
      null;
    const sourceTokenRaw =
      input.source_token ??
      input.sourceToken ??
      input.normalized_source_token ??
      input.normalizedSourceToken ??
      null;

    if (
      (sourceReferenceRaw === null || sourceReferenceRaw === undefined || sourceReferenceRaw === '') &&
      (sourceTokenRaw === null || sourceTokenRaw === undefined || sourceTokenRaw === '')
    ) {
      return null;
    }

    if (sourceReferenceRaw && isPlainObject(sourceReferenceRaw)) {
      const referenceType = normalizeReferenceType(
        sourceReferenceRaw.reference_type ?? sourceReferenceRaw.referenceType
      );
      if (referenceType === 'telegram_source_registry_item') {
        const sourceRegistryItemIdRaw =
          sourceReferenceRaw.source_registry_item_id ??
          sourceReferenceRaw.sourceRegistryItemId;
        const sourceReference =
          sourceReferenceRaw.source_reference ?? sourceReferenceRaw.sourceReference;
        let row = null;
        if (
          sourceRegistryItemIdRaw !== null &&
          sourceRegistryItemIdRaw !== undefined &&
          sourceRegistryItemIdRaw !== ''
        ) {
          row = this.sourceRegistryItems.getById(
            normalizePositiveInteger(
              sourceRegistryItemIdRaw,
              'source_reference.source_registry_item_id'
            )
          );
        } else if (normalizeString(sourceReference)) {
          row = this.sourceRegistryItems.findOneBy(
            { source_reference: normalizeString(sourceReference) },
            { orderBy: 'source_registry_item_id ASC' }
          );
        }
        if (!row) {
          rejectAnalytics('source reference is not projectable');
        }
        return freezeTelegramAnalyticsFoundationValue({
          source_reference_type: 'telegram_source_registry_item',
          source_reference_id: String(row.source_registry_item_id),
          source_reference_token: row.source_token || null,
        });
      }

      const trafficSourceId = normalizePositiveInteger(
        sourceReferenceRaw.traffic_source_id ?? sourceReferenceRaw.trafficSourceId,
        'source_reference.traffic_source_id'
      );
      if (this.trafficSources && !this.trafficSources.getById(trafficSourceId)) {
        rejectAnalytics(`traffic source not found: ${trafficSourceId}`);
      }
      return freezeTelegramAnalyticsFoundationValue({
        source_reference_type: 'telegram_traffic_source',
        source_reference_id: String(trafficSourceId),
        source_reference_token: normalizeString(sourceTokenRaw),
      });
    }

    const sourceReferenceAsString = normalizeString(sourceReferenceRaw);
    if (sourceReferenceAsString) {
      const row = this.sourceRegistryItems.findOneBy(
        { source_reference: sourceReferenceAsString },
        { orderBy: 'source_registry_item_id ASC' }
      );
      if (!row) {
        rejectAnalytics('source reference is not projectable');
      }
      return freezeTelegramAnalyticsFoundationValue({
        source_reference_type: 'telegram_source_registry_item',
        source_reference_id: String(row.source_registry_item_id),
        source_reference_token: row.source_token || null,
      });
    }

    const sourceToken = normalizeString(sourceTokenRaw);
    if (!sourceToken) {
      return null;
    }
    const row = this.sourceRegistryItems.findOneBy(
      { source_token: sourceToken },
      { orderBy: 'source_registry_item_id ASC' }
    );
    if (!row) {
      rejectAnalytics('source reference is not projectable');
    }
    return freezeTelegramAnalyticsFoundationValue({
      source_reference_type: 'telegram_source_registry_item',
      source_reference_id: String(row.source_registry_item_id),
      source_reference_token: row.source_token || null,
    });
  }

  assertReferenceRequirements({ eventType, guestProfileId, bookingRequestId, sourceReference }) {
    const requirements = EVENT_REFERENCE_REQUIREMENTS[eventType] || [];
    for (const requirement of requirements) {
      if (requirement === 'guest_or_source') {
        if (!guestProfileId && !sourceReference) {
          rejectAnalytics(`${eventType} requires guest or source reference`);
        }
      }
      if (requirement === 'booking_request') {
        if (!bookingRequestId) {
          rejectAnalytics(`${eventType} requires booking request reference`);
        }
      }
      if (requirement === 'booking_or_guest') {
        if (!bookingRequestId && !guestProfileId) {
          rejectAnalytics(`${eventType} requires booking request or guest reference`);
        }
      }
    }
  }

  normalizeCaptureInput(input = {}) {
    if (!isPlainObject(input)) {
      rejectAnalytics('analytics capture input must be an object');
    }
    const nowIso = this.nowIso();
    const eventType = normalizeEventType(input.event_type ?? input.eventType);
    const bookingRequest = this.resolveBookingRequestFromInput(input);
    const bookingRequestId = bookingRequest?.booking_request_id || null;
    const guestProfileId = this.resolveGuestProfileIdFromInput(input, bookingRequest);
    const sourceReference = this.resolveSourceReferenceFromInput(input);
    this.assertReferenceRequirements({
      eventType,
      guestProfileId,
      bookingRequestId,
      sourceReference,
    });
    const eventAt = normalizeEventAt(
      input.event_at ?? input.eventAt,
      nowIso
    );
    const eventPayload = normalizePayload(
      input.event_payload ?? input.eventPayload ?? null
    );
    const dedupeKeyDerived = [
      `telegram_analytics_capture`,
      `event=${eventType}`,
      `guest=${guestProfileId || 'none'}`,
      `sourceType=${sourceReference?.source_reference_type || 'none'}`,
      `sourceId=${sourceReference?.source_reference_id || 'none'}`,
      `request=${bookingRequestId || 'none'}`,
      `at=${eventAt}`,
    ].join(':');
    const idempotencyKey = normalizeString(
      input.idempotency_key ?? input.idempotencyKey ?? dedupeKeyDerived
    );
    const dedupeKey = normalizeString(
      input.dedupe_key ?? input.dedupeKey ?? dedupeKeyDerived
    );
    const eventSignature = freezeTelegramAnalyticsFoundationValue({
      analytics_event_type: eventType,
      event_at: eventAt,
      guest_profile_id: guestProfileId,
      booking_request_id: bookingRequestId,
      source_reference_type: sourceReference?.source_reference_type || null,
      source_reference_id: sourceReference?.source_reference_id || null,
      source_reference_token: sourceReference?.source_reference_token || null,
      event_payload: eventPayload || null,
    });

    return freezeTelegramAnalyticsFoundationValue({
      analytics_event_type: eventType,
      event_at: eventAt,
      guest_profile_id: guestProfileId,
      booking_request_id: bookingRequestId,
      source_reference_type: sourceReference?.source_reference_type || null,
      source_reference_id: sourceReference?.source_reference_id || null,
      source_reference_token: sourceReference?.source_reference_token || null,
      event_payload: eventPayload,
      idempotency_key: idempotencyKey,
      dedupe_key: dedupeKey,
      event_signature: eventSignature,
    });
  }

  buildCaptureResult(row, responseVersion = TELEGRAM_ANALYTICS_CAPTURE_EVENT_VERSION, operation = 'captured') {
    return freezeTelegramAnalyticsFoundationValue({
      response_version: responseVersion,
      persistence_applied: operation !== 'idempotent_replay',
      operation,
      processed_by: SERVICE_NAME,
      analytics_event: buildEventProjection(row),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        row.event_at,
        row.created_at
      ),
    });
  }

  captureAnalyticsEventFromTelegramState(input = {}) {
    const normalized = this.normalizeCaptureInput(input);
    const existing = this.analyticsCaptureEvents.findOneBy(
      { idempotency_key: normalized.idempotency_key },
      { orderBy: 'analytics_capture_event_id ASC' }
    );
    if (existing) {
      if (signaturesEqual(existing.event_signature, normalized.event_signature)) {
        return this.buildCaptureResult(existing, TELEGRAM_ANALYTICS_CAPTURE_EVENT_VERSION, 'idempotent_replay');
      }
      rejectAnalytics(`idempotency conflict for analytics capture: ${normalized.idempotency_key}`);
    }

    const created = this.analyticsCaptureEvents.create({
      analytics_event_type: normalized.analytics_event_type,
      event_at: normalized.event_at,
      guest_profile_id: normalized.guest_profile_id,
      booking_request_id: normalized.booking_request_id,
      source_reference_type: normalized.source_reference_type,
      source_reference_id: normalized.source_reference_id,
      source_reference_token: normalized.source_reference_token,
      event_payload: normalized.event_payload,
      idempotency_key: normalized.idempotency_key,
      dedupe_key: normalized.dedupe_key,
      event_signature: normalized.event_signature,
      created_at: this.nowIso(),
    });
    return this.buildCaptureResult(created);
  }

  listAnalyticsEventsByGuestReference(input = {}) {
    const guestProfileId = this.resolveGuestProfileIdFromInput(input);
    if (!guestProfileId) {
      rejectAnalytics('guest reference is required');
    }
    const rows = this.analyticsCaptureEvents.listBy(
      { guest_profile_id: guestProfileId },
      { orderBy: 'analytics_capture_event_id ASC', limit: 2000 }
    );
    const items = rows.map((row) => buildEventProjection(row));
    return freezeTelegramAnalyticsFoundationValue({
      response_version: TELEGRAM_ANALYTICS_CAPTURE_LIST_VERSION,
      read_only: true,
      projected_by: SERVICE_NAME,
      list_scope: 'guest_reference',
      guest_reference: buildGuestReference(guestProfileId),
      item_count: items.length,
      items,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        ...items.map((item) => item.event_timestamp_summary?.iso)
      ),
    });
  }

  listAnalyticsEventsBySourceReference(input = {}) {
    const sourceReference = this.resolveSourceReferenceFromInput(input);
    if (!sourceReference) {
      rejectAnalytics('source reference is required');
    }
    const rows = this.analyticsCaptureEvents.listBy(
      {
        source_reference_type: sourceReference.source_reference_type,
        source_reference_id: sourceReference.source_reference_id,
      },
      { orderBy: 'analytics_capture_event_id ASC', limit: 2000 }
    );
    const items = rows.map((row) => buildEventProjection(row));
    return freezeTelegramAnalyticsFoundationValue({
      response_version: TELEGRAM_ANALYTICS_CAPTURE_LIST_VERSION,
      read_only: true,
      projected_by: SERVICE_NAME,
      list_scope: 'source_reference',
      source_reference: buildSourceReference({
        sourceReferenceType: sourceReference.source_reference_type,
        sourceReferenceId: sourceReference.source_reference_id,
        sourceReferenceToken: sourceReference.source_reference_token,
      }),
      item_count: items.length,
      items,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        ...items.map((item) => item.event_timestamp_summary?.iso)
      ),
    });
  }

  readAnalyticsCountersSummary(input = {}) {
    if (!isPlainObject(input) && input !== null && input !== undefined) {
      rejectAnalytics('analytics counters input must be an object');
    }
    const guestProfileId = this.resolveGuestProfileIdFromInput(input || {});
    const sourceReference = this.resolveSourceReferenceFromInput(input || {});
    let rows = this.analyticsCaptureEvents.listBy(
      {},
      { orderBy: 'analytics_capture_event_id ASC', limit: 5000 }
    );
    if (guestProfileId) {
      rows = rows.filter((row) => Number(row.guest_profile_id) === Number(guestProfileId));
    }
    if (sourceReference) {
      rows = rows.filter(
        (row) =>
          row.source_reference_type === sourceReference.source_reference_type &&
          String(row.source_reference_id) === String(sourceReference.source_reference_id)
      );
    }

    const counters = {};
    for (const eventType of TELEGRAM_ANALYTICS_SAFE_EVENT_TYPES) {
      counters[eventType] = 0;
    }
    for (const row of rows) {
      const key = row.analytics_event_type;
      if (!Object.prototype.hasOwnProperty.call(counters, key)) {
        continue;
      }
      counters[key] += 1;
    }

    return freezeTelegramAnalyticsFoundationValue({
      response_version: TELEGRAM_ANALYTICS_COUNTERS_SUMMARY_VERSION,
      read_only: true,
      projected_by: SERVICE_NAME,
      counters_summary: freezeTelegramAnalyticsFoundationValue({
        total_events: rows.length,
        by_event_type: counters,
      }),
      guest_reference: guestProfileId ? buildGuestReference(guestProfileId) : null,
      source_reference: sourceReference
        ? buildSourceReference({
            sourceReferenceType: sourceReference.source_reference_type,
            sourceReferenceId: sourceReference.source_reference_id,
            sourceReferenceToken: sourceReference.source_reference_token,
          })
        : null,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        ...rows.map((row) => row.event_at)
      ),
    });
  }

  captureAnalyticsEvent(input = {}) {
    return this.captureAnalyticsEventFromTelegramState(input);
  }
}
