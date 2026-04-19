import {
  buildTelegramHandoffReadinessRecord,
  buildTelegramHandoffTimestampSummary,
  freezeTelegramHandoffValue,
  TELEGRAM_HANDOFF_PREPARED_EVENT_TYPE,
  TELEGRAM_HANDOFF_READINESS_LIST_VERSION,
} from '../../../shared/telegram/index.js';
import {
  buildBookingRequestReference,
  buildReadOnlyNoOpGuards,
  buildTelegramUserSummaryFromGuestProfileAndEvents,
  normalizePositiveInteger,
  normalizeString,
} from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_HANDOFF_READINESS]';
const SERVICE_NAME = 'telegram_handoff_readiness_projection_service';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_SCAN_LIMIT = 500;

function rejectReadiness(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeLimit(limit, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const normalized = Number(limit);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function pickBookingRequestReference(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return {
      reference_type: 'telegram_booking_request',
      booking_request_id: Number(input),
    };
  }

  return (
    input.booking_request_reference ??
    input.bookingRequestReference ??
    input.reference ??
    input.booking_request ??
    input.bookingRequest ??
    input ??
    null
  );
}

function compareReadinessItems(left, right) {
  const leftTime = Date.parse(left.latest_readiness_timestamp_summary?.iso || 0);
  const rightTime = Date.parse(right.latest_readiness_timestamp_summary?.iso || 0);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return (
    right.booking_request_reference.booking_request_id -
    left.booking_request_reference.booking_request_id
  );
}

function isMergeableRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeHandoffSnapshotValues(baseValue, overlayValue) {
  if (overlayValue === undefined) {
    return baseValue;
  }
  if (!isMergeableRecord(baseValue) || !isMergeableRecord(overlayValue)) {
    return overlayValue;
  }

  const mergedValue = { ...baseValue };
  for (const [key, nestedOverlayValue] of Object.entries(overlayValue)) {
    mergedValue[key] = mergeHandoffSnapshotValues(baseValue[key], nestedOverlayValue);
  }

  return mergedValue;
}

function resolvePreparedSnapshotFromEvent(preparedEvent) {
  const canonicalSnapshot = preparedEvent?.event_payload?.handoff_snapshot ?? null;
  const legacySnapshot = preparedEvent?.event_payload?.payload ?? null;
  if (canonicalSnapshot && legacySnapshot) {
    return freezeTelegramHandoffValue(
      mergeHandoffSnapshotValues(canonicalSnapshot, legacySnapshot)
    );
  }

  return freezeTelegramHandoffValue(canonicalSnapshot ?? legacySnapshot ?? null);
}

function isNonProjectableReadinessError(error) {
  const message = String(error?.message || '');
  return (
    message.includes('not projectable for handoff readiness') ||
    message.includes('Invalid booking request reference')
  );
}

function buildListResult({ guestSummary, items, listScope }) {
  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_HANDOFF_READINESS_LIST_VERSION,
    read_only: true,
    projection_only: true,
    projected_by: SERVICE_NAME,
    list_scope: listScope,
    telegram_user_summary: guestSummary,
    item_count: items.length,
    items,
    no_op_guards: buildReadOnlyNoOpGuards(),
  });
}

export class TelegramHandoffReadinessQueryService {
  constructor({
    guestProfiles,
    bookingRequests,
    bookingRequestEvents,
    bookingRequestLifecycleProjectionService,
  }) {
    this.guestProfiles = guestProfiles;
    this.bookingRequests = bookingRequests;
    this.bookingRequestEvents = bookingRequestEvents;
    this.bookingRequestLifecycleProjectionService =
      bookingRequestLifecycleProjectionService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'handoff-readiness-query-service',
      status: 'read_only_handoff_readiness_projection_ready',
      dependencyKeys: [
        'guestProfiles',
        'bookingRequests',
        'bookingRequestEvents',
        'bookingRequestLifecycleProjectionService',
      ],
    });
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectReadiness(`Invalid booking request reference: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  getGuestProfileOrThrow(guestProfileId) {
    const guestProfile = this.guestProfiles.getById(guestProfileId);
    if (!guestProfile) {
      rejectReadiness(`Guest profile not found: ${guestProfileId}`);
    }

    return guestProfile;
  }

  getPreparedEvent(bookingRequestId) {
    return this.bookingRequestEvents.findOneBy(
      {
        booking_request_id: bookingRequestId,
        event_type: TELEGRAM_HANDOFF_PREPARED_EVENT_TYPE,
      },
      {
        orderBy: 'booking_request_event_id DESC',
      }
    );
  }

  getPreparedEventOrThrow(bookingRequestId) {
    const preparedEvent = this.getPreparedEvent(bookingRequestId);
    if (!preparedEvent) {
      rejectReadiness(`Booking request is not handoff-prepared: ${bookingRequestId}`);
    }

    return preparedEvent;
  }

  listPreparedEvents({ limit = DEFAULT_LIMIT } = {}) {
    this.bookingRequestEvents.assertReady();

    const normalizedLimit = normalizeLimit(limit);
    const { db, tableName, idColumn } = this.bookingRequestEvents;
    const statement = db.prepare(`
      SELECT prepared_events.*
      FROM ${tableName} prepared_events
      INNER JOIN (
        SELECT booking_request_id, MAX(${idColumn}) AS latest_event_id
        FROM ${tableName}
        WHERE event_type = ?
        GROUP BY booking_request_id
      ) latest_per_request
        ON latest_per_request.latest_event_id = prepared_events.${idColumn}
      ORDER BY prepared_events.${idColumn} DESC
      LIMIT ?
    `);

    return statement
      .all(TELEGRAM_HANDOFF_PREPARED_EVENT_TYPE, normalizedLimit)
      .map((row) => this.bookingRequestEvents.deserializeRow(row));
  }

  mapLifecycleProjectionError(bookingRequestId, error) {
    const message = String(error?.message || '');
    if (
      message.includes('Booking request not found') ||
      message.includes('booking request reference') ||
      message.includes('Unsupported booking-request reference type')
    ) {
      rejectReadiness(`Invalid booking request reference: ${bookingRequestId}`);
    }
    if (
      message.includes('not projectable inside Telegram lifecycle boundary') ||
      message.includes('lifecycle event is missing for projection')
    ) {
      rejectReadiness(
        `Booking request is not projectable for handoff readiness: ${bookingRequestId}`
      );
    }

    throw error;
  }

  readLifecycleProjectionOrThrow(bookingRequestReference) {
    try {
      return this.bookingRequestLifecycleProjectionService.readCurrentLifecycleStateByBookingRequestReference(
        {
          booking_request_reference: bookingRequestReference,
        }
      );
    } catch (error) {
      this.mapLifecycleProjectionError(
        bookingRequestReference.booking_request_id,
        error
      );
      return null;
    }
  }

  resolveReadinessState(projectionItem, preparedEvent) {
    if (projectionItem.lifecycle_state === 'prepayment_confirmed') {
      return preparedEvent ? 'ready_for_handoff' : 'not_ready';
    }

    if (
      projectionItem.lifecycle_state === 'cancelled_before_prepayment' ||
      projectionItem.lifecycle_state === 'hold_expired'
    ) {
      return 'invalid_for_handoff';
    }

    if (
      projectionItem.lifecycle_state === 'new' ||
      projectionItem.lifecycle_state === 'hold_active' ||
      projectionItem.lifecycle_state === 'hold_extended'
    ) {
      return 'not_ready';
    }

    rejectReadiness(
      `Booking request is not projectable for handoff readiness: ${
        projectionItem.booking_request_reference.booking_request_id
      }`
    );
  }

  buildReadinessItemFromProjection(bookingRequest, projectionItem, preparedEvent = null) {
    const handoffSnapshot = resolvePreparedSnapshotFromEvent(preparedEvent);
    if (preparedEvent && !handoffSnapshot) {
      rejectReadiness(
        `HANDOFF_PREPARED snapshot payload is missing: ${bookingRequest.booking_request_id}`
      );
    }

    const readinessState = this.resolveReadinessState(projectionItem, preparedEvent);
    const latestReadinessSummary = preparedEvent
      ? buildTelegramHandoffTimestampSummary(preparedEvent.event_at)
      : projectionItem.latest_lifecycle_timestamp_summary;

    return buildTelegramHandoffReadinessRecord({
      bookingRequest,
      lifecycleState: projectionItem.lifecycle_state,
      preparedEvent,
      handoffSnapshot,
      readinessState,
      latestReadinessIso: latestReadinessSummary?.iso || null,
    });
  }

  buildReadinessItem(bookingRequest, preparedEvent = null) {
    const bookingRequestReference = buildBookingRequestReference(bookingRequest);
    const projectionItem = this.readLifecycleProjectionOrThrow(bookingRequestReference);

    return this.buildReadinessItemFromProjection(
      bookingRequest,
      projectionItem,
      preparedEvent
    );
  }

  buildPreparedProjectionFallback(bookingRequest, preparedEvent) {
    const persistedProjection = freezeTelegramHandoffValue(
      preparedEvent?.event_payload?.booking_request_lifecycle_state ?? null
    );
    if (persistedProjection?.lifecycle_state) {
      return persistedProjection;
    }

    return freezeTelegramHandoffValue({
      booking_request_reference: buildBookingRequestReference(bookingRequest),
      lifecycle_state: 'prepayment_confirmed',
      latest_lifecycle_timestamp_summary: buildTelegramHandoffTimestampSummary(
        preparedEvent?.event_at || null
      ),
    });
  }

  buildPreparedRecord(bookingRequest, preparedEvent) {
    if (!preparedEvent) {
      rejectReadiness(
        `Booking request is not handoff-prepared: ${bookingRequest.booking_request_id}`
      );
    }

    const bookingRequestReference = buildBookingRequestReference(bookingRequest);
    let projectionItem = null;
    try {
      projectionItem = this.readLifecycleProjectionOrThrow(bookingRequestReference);
    } catch (error) {
      if (!isNonProjectableReadinessError(error)) {
        throw error;
      }
    }

    return this.buildReadinessItemFromProjection(
      bookingRequest,
      projectionItem || this.buildPreparedProjectionFallback(bookingRequest, preparedEvent),
      preparedEvent
    );
  }

  buildReadinessItemIfProjectable(bookingRequest) {
    try {
      return this.buildReadinessItem(
        bookingRequest,
        this.getPreparedEvent(bookingRequest.booking_request_id)
      );
    } catch (error) {
      if (isNonProjectableReadinessError(error)) {
        return null;
      }

      throw error;
    }
  }

  readHandoffReadinessByBookingRequestReference(input = {}) {
    const rawReference = pickBookingRequestReference(input);
    if (!rawReference) {
      rejectReadiness('booking request reference is required');
    }

    const bookingRequestId = normalizePositiveInteger(
      rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
      'booking_request_reference.booking_request_id',
      rejectReadiness
    );
    const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
    const preparedEvent = this.getPreparedEvent(bookingRequestId);

    return this.buildReadinessItem(bookingRequest, preparedEvent);
  }

  resolveGuestProfile(input = {}) {
    if (this.bookingRequestLifecycleProjectionService?.resolveGuestProfile) {
      return this.bookingRequestLifecycleProjectionService.resolveGuestProfile(input);
    }

    const guestProfileId = input.guest_profile_id ?? input.guestProfileId ?? null;
    if (guestProfileId !== null && guestProfileId !== undefined && guestProfileId !== '') {
      return this.getGuestProfileOrThrow(
        normalizePositiveInteger(guestProfileId, 'guest_profile_id', rejectReadiness)
      );
    }

    const telegramUserId = normalizeString(
      input.telegram_user_id ??
        input.telegramUserId ??
        input.telegram_user_summary?.telegram_user_id ??
        input.telegramUserSummary?.telegram_user_id ??
        input.telegramUserSummary?.telegramUserId
    );
    if (!telegramUserId) {
      rejectReadiness('Telegram guest identity is required');
    }

    const guestProfile = this.guestProfiles.findOneBy(
      { telegram_user_id: telegramUserId },
      { orderBy: 'guest_profile_id ASC' }
    );
    if (!guestProfile) {
      rejectReadiness(
        `Guest profile not found for telegram_user_id: ${telegramUserId}`
      );
    }

    return guestProfile;
  }

  listProjectableReadinessItemsForGuest(input = {}, { limit = DEFAULT_LIMIT } = {}) {
    const guestProfile = this.resolveGuestProfile(input);
    const rows = this.bookingRequests.listBy(
      { guest_profile_id: guestProfile.guest_profile_id },
      {
        orderBy: 'created_at ASC, booking_request_id ASC',
        limit: normalizeLimit(input.scanLimit ?? input.scan_limit, DEFAULT_SCAN_LIMIT, DEFAULT_SCAN_LIMIT),
      }
    );
    const items = rows
      .map((bookingRequest) => this.buildReadinessItemIfProjectable(bookingRequest))
      .filter(Boolean)
      .sort(compareReadinessItems)
      .slice(0, normalizeLimit(limit));

    return {
      guestProfile,
      items,
    };
  }

  listHandoffReadyRequestsForTelegramGuest(input = {}) {
    const { guestProfile, items } = this.listProjectableReadinessItemsForGuest(input, {
      limit: input.limit,
    });
    const readyItems = items.filter(
      (item) => item.handoff_readiness_state === 'ready_for_handoff'
    );

    return buildListResult({
      guestSummary: buildTelegramUserSummaryFromGuestProfileAndEvents({
        guestProfile,
        events: [],
      }),
      items: readyItems,
      listScope: 'telegram_guest_handoff_ready_requests',
    });
  }

  readLatestHandoffReadyOrNotStateForTelegramGuest(input = {}) {
    const { items } = this.listProjectableReadinessItemsForGuest(input, {
      limit: 1,
    });

    return items[0] || null;
  }

  readPreparedRequest(input = {}) {
    const bookingRequestReference = pickBookingRequestReference(input);
    const bookingRequestId = normalizePositiveInteger(
      bookingRequestReference?.booking_request_id ??
        bookingRequestReference?.bookingRequestId ??
        bookingRequestReference,
      'booking_request_reference.booking_request_id',
      rejectReadiness
    );
    const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
    const preparedEvent = this.getPreparedEvent(bookingRequestId);
    if (!preparedEvent) {
      rejectReadiness(
        `Booking request is not handoff-prepared: ${bookingRequestId}`
      );
    }

    try {
      const readinessItem = this.readHandoffReadinessByBookingRequestReference(input);
      if (!readinessItem.handoff_prepared) {
        rejectReadiness(`Booking request is not handoff-prepared: ${bookingRequestId}`);
      }

      return readinessItem;
    } catch (error) {
      if (!isNonProjectableReadinessError(error)) {
        throw error;
      }

      return this.buildPreparedRecord(bookingRequest, preparedEvent);
    }
  }

  listPreparedRequests({ limit = DEFAULT_LIMIT } = {}) {
    const items = this.listPreparedEvents({ limit })
      .map((preparedEvent) => {
        try {
          return this.readPreparedRequest(preparedEvent.booking_request_id);
        } catch (error) {
          const message = String(error?.message || '');
          if (message.includes('not handoff-prepared')) {
            return null;
          }

          throw error;
        }
      })
      .filter(Boolean)
      .sort(compareReadinessItems)
      .slice(0, normalizeLimit(limit));

    return freezeTelegramHandoffValue(items);
  }
}
