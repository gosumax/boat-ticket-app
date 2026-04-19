import {
  buildTelegramContactPhoneSummary,
  buildTelegramLatestTimestampSummary,
  buildTelegramRequestedTripSlotReference,
  buildTelegramSellerReference,
  freezeTelegramManualFallbackValue,
  SELLER_SOURCE_FAMILIES,
  TELEGRAM_MANUAL_FALLBACK_QUEUE_QUERY_ITEM_VERSION,
  TELEGRAM_MANUAL_FALLBACK_QUEUE_QUERY_LIST_VERSION,
  TELEGRAM_MANUAL_FALLBACK_QUEUE_STATES,
} from '../../../shared/telegram/index.js';
import {
  buildBookingRequestReference,
  buildTelegramUserSummaryFromGuestProfileAndEvents,
  extractRequestedPrepaymentAmount,
} from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_MANUAL_FALLBACK_QUEUE_QUERY]';
const SERVICE_NAME = 'telegram_manual_fallback_queue_query_service';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const CANDIDATE_SCAN_LIMIT = 2000;

const WAITING_FOR_MANUAL_CONTACT_STATUSES = new Set([
  'NEW',
  'ATTRIBUTED',
  'HOLD_ACTIVE',
  'WAITING_PREPAYMENT',
]);
const NO_LONGER_ACTIONABLE_STATUSES = new Set([
  'GUEST_CANCELLED',
  'HOLD_EXPIRED',
  'CLOSED_UNCONVERTED',
  'CONFIRMED_TO_PRESALE',
]);

const ROUTING_FROM_BINDING_STATUS = Object.freeze({
  resolved_owner_source: Object.freeze({
    routing_status: 'owner_manual',
    route_target_type: 'owner_manual',
    route_reason: 'resolved_owner_source',
  }),
  resolved_generic_source: Object.freeze({
    routing_status: 'generic_unassigned',
    route_target_type: 'generic_unassigned',
    route_reason: 'resolved_generic_source',
  }),
  resolved_seller_source: Object.freeze({
    routing_status: 'unresolved_source_manual',
    route_target_type: 'manual_review',
    route_reason: 'resolved_seller_source_without_active_attribution',
  }),
  unresolved_source_token: Object.freeze({
    routing_status: 'unresolved_source_manual',
    route_target_type: 'manual_review',
    route_reason: 'unresolved_source_token',
  }),
  no_source_token: Object.freeze({
    routing_status: 'no_source_manual',
    route_target_type: 'manual_review',
    route_reason: 'no_source_token',
  }),
});

function rejectManualFallbackQueueQuery(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectManualFallbackQueueQuery(`${label} must be a positive integer`);
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

function normalizeQueueState(value, label = 'queue_state') {
  const normalized = String(value || '').trim();
  if (!TELEGRAM_MANUAL_FALLBACK_QUEUE_STATES.includes(normalized)) {
    rejectManualFallbackQueueQuery(`${label} is unsupported: ${normalized || 'unknown'}`);
  }

  return normalized;
}

function pickBookingRequestReferenceInput(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return { booking_request_id: Number(input) };
  }

  return (
    input.booking_request_reference ??
    input.bookingRequestReference ??
    input.booking_request ??
    input.bookingRequest ??
    input.reference ??
    input ??
    null
  );
}

function normalizeBookingRequestId(input = {}) {
  const rawReference = pickBookingRequestReferenceInput(input);
  if (!rawReference) {
    rejectManualFallbackQueueQuery('booking request reference is required');
  }

  const referenceType = String(
    rawReference.reference_type || 'telegram_booking_request'
  ).trim();
  if (referenceType !== 'telegram_booking_request') {
    rejectManualFallbackQueueQuery(
      `Unsupported booking request reference type: ${referenceType}`
    );
  }

  return normalizePositiveInteger(
    rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
    'booking_request_reference.booking_request_id'
  );
}

function compareQueueItems(left, right) {
  const leftTime = Date.parse(left.latest_timestamp_summary?.iso || 0);
  const rightTime = Date.parse(right.latest_timestamp_summary?.iso || 0);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return (
    right.booking_request_reference.booking_request_id -
    left.booking_request_reference.booking_request_id
  );
}

function isSellerSourceFamily(sourceFamily) {
  return SELLER_SOURCE_FAMILIES.includes(sourceFamily);
}

function mapLegacyManualActionType(event) {
  const payloadAction = String(
    event?.event_payload?.manual_fallback_action ??
      event?.event_payload?.action_type ??
      event?.event_payload?.seller_work_queue_action ??
      ''
  ).trim();

  if (payloadAction === 'call_started') {
    return 'call_started';
  }
  if (payloadAction === 'not_reached') {
    return 'not_reached';
  }
  if (payloadAction === 'assign_to_seller') {
    return 'assign_to_seller';
  }
  if (payloadAction === 'manual_prepayment_confirmed') {
    return 'manual_prepayment_confirmed';
  }
  if (event?.event_type === 'MANUAL_FALLBACK_CALL_STARTED') {
    return 'call_started';
  }
  if (event?.event_type === 'MANUAL_FALLBACK_ASSIGNED_TO_SELLER') {
    return 'assign_to_seller';
  }

  return null;
}

function isAttributionExpired(attributionSession, nowIso) {
  if (!attributionSession) {
    return false;
  }

  if (attributionSession.attribution_status === 'EXPIRED') {
    return true;
  }

  const expiresAt = Date.parse(attributionSession.expires_at || '');
  if (Number.isNaN(expiresAt)) {
    return true;
  }

  return expiresAt <= Date.parse(nowIso);
}

function buildCurrentRouteTarget(routeDecision, attributionSummary = null) {
  if (routeDecision.route_target_type === 'seller') {
    return freezeTelegramManualFallbackValue({
      route_target_type: 'seller',
      seller_reference: buildTelegramSellerReference({
        sellerId: attributionSummary?.seller_id || null,
        sellerAttributionSessionId:
          attributionSummary?.seller_attribution_session_id || null,
      }),
    });
  }

  return freezeTelegramManualFallbackValue({
    route_target_type: routeDecision.route_target_type,
    seller_reference: null,
  });
}

export class TelegramManualFallbackQueueQueryService {
  constructor({
    guestProfiles,
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    sellerAttributionSessions,
    trafficSources,
    sourceQRCodes,
    guestEntrySourceBindingEvents,
    attributionService,
    now = () => new Date(),
  }) {
    this.guestProfiles = guestProfiles;
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.trafficSources = trafficSources;
    this.sourceQRCodes = sourceQRCodes;
    this.guestEntrySourceBindingEvents = guestEntrySourceBindingEvents;
    this.attributionService = attributionService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'manual-fallback-queue-query-service',
      status: 'read_only_manual_fallback_queue_query_ready',
      dependencyKeys: [
        'guestProfiles',
        'bookingRequests',
        'bookingHolds',
        'bookingRequestEvents',
        'sellerAttributionSessions',
        'trafficSources',
        'sourceQRCodes',
        'guestEntrySourceBindingEvents',
        'attributionService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectManualFallbackQueueQuery('queue query clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectManualFallbackQueueQuery(`Invalid booking request reference: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  getGuestProfileOrThrow(guestProfileId, bookingRequestId) {
    const guestProfile = this.guestProfiles.getById(guestProfileId);
    if (!guestProfile) {
      rejectManualFallbackQueueQuery(
        `Guest profile is missing for booking request: ${bookingRequestId}`
      );
    }

    return guestProfile;
  }

  getBookingHold(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
  }

  findLastManualActionEvent(events = []) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const actionType = mapLegacyManualActionType(events[index]);
      if (actionType) {
        return events[index];
      }
    }

    return null;
  }

  resolveSourceFamily({
    attributionSession,
    trafficSource,
    sourceQRCode,
  }) {
    if (!attributionSession && !trafficSource) {
      return null;
    }

    if (attributionSession?.binding_reason) {
      return attributionSession.binding_reason;
    }

    if (!trafficSource) {
      return null;
    }

    return this.attributionService.classifySourceFamily({
      sourceType: trafficSource.source_type,
      entryChannel:
        sourceQRCode?.entry_context?.entry_channel || 'manual_fallback_queue_query',
    });
  }

  getAttributionBundle(bookingRequest) {
    const attributionSession = this.sellerAttributionSessions.getById(
      bookingRequest.seller_attribution_session_id
    );
    if (!attributionSession) {
      return freezeTelegramManualFallbackValue({
        attribution_session: null,
        traffic_source: null,
        source_qr_code: null,
        source_family: null,
      });
    }

    const trafficSource = this.trafficSources.getById(attributionSession.traffic_source_id);
    const sourceQRCode = this.sourceQRCodes.getById(attributionSession.source_qr_code_id);
    const sourceFamily = this.resolveSourceFamily({
      attributionSession,
      trafficSource,
      sourceQRCode,
    });

    return freezeTelegramManualFallbackValue({
      attribution_session: attributionSession,
      traffic_source: trafficSource || null,
      source_qr_code: sourceQRCode || null,
      source_family: sourceFamily,
    });
  }

  readLatestSourceBindingSummary(guestProfile) {
    this.guestEntrySourceBindingEvents.assertReady();
    const telegramUserId = String(guestProfile.telegram_user_id || '').trim();
    if (!telegramUserId) {
      return null;
    }

    if (this.db?.prepare) {
      const row = this.db
        .prepare(
          `
            SELECT *
            FROM telegram_guest_entry_source_binding_events
            WHERE json_extract(telegram_user_summary, '$.telegram_user_id') = ?
            ORDER BY source_binding_event_id DESC
            LIMIT 1
          `
        )
        .get(telegramUserId);
      if (row) {
        const event = this.guestEntrySourceBindingEvents.deserializeRow(row);
        return freezeTelegramManualFallbackValue({
          source_binding_reference: {
            reference_type: 'telegram_guest_entry_source_binding_event',
            source_binding_event_id: event.source_binding_event_id,
            guest_entry_event_id: event.guest_entry_event_id,
            event_type: event.event_type,
            idempotency_key: event.idempotency_key,
          },
          binding_status: event.binding_status || null,
          source_resolution_outcome: event.source_resolution_outcome || null,
          resolved_source_family: event.resolved_source_family || null,
          normalized_source_token: event.normalized_source_token || null,
          latest_timestamp_summary: event.event_timestamp_summary || null,
        });
      }
    }

    const event =
      this.guestEntrySourceBindingEvents
        .listBy({}, { orderBy: 'source_binding_event_id DESC', limit: 1000 })
        .find(
          (item) =>
            item.telegram_user_summary?.telegram_user_id === telegramUserId
        ) || null;
    if (!event) {
      return null;
    }

    return freezeTelegramManualFallbackValue({
      source_binding_reference: {
        reference_type: 'telegram_guest_entry_source_binding_event',
        source_binding_event_id: event.source_binding_event_id,
        guest_entry_event_id: event.guest_entry_event_id,
        event_type: event.event_type,
        idempotency_key: event.idempotency_key,
      },
      binding_status: event.binding_status || null,
      source_resolution_outcome: event.source_resolution_outcome || null,
      resolved_source_family: event.resolved_source_family || null,
      normalized_source_token: event.normalized_source_token || null,
      latest_timestamp_summary: event.event_timestamp_summary || null,
    });
  }

  buildAttributionSummary(attributionBundle, nowIso) {
    const attributionSession = attributionBundle.attribution_session;
    if (!attributionSession) {
      return null;
    }

    const sellerId = Number(attributionSession.seller_id);
    return freezeTelegramManualFallbackValue({
      attribution_session_reference: {
        reference_type: 'telegram_seller_attribution_session',
        seller_attribution_session_id:
          attributionSession.seller_attribution_session_id,
        guest_profile_id: attributionSession.guest_profile_id,
        traffic_source_id: attributionSession.traffic_source_id,
        source_qr_code_id: attributionSession.source_qr_code_id,
      },
      seller_id: Number.isInteger(sellerId) && sellerId > 0 ? sellerId : null,
      attribution_status: attributionSession.attribution_status || null,
      attribution_expires_at: attributionSession.expires_at || null,
      attribution_active:
        attributionSession.attribution_status === 'ACTIVE' &&
        !isAttributionExpired(attributionSession, nowIso),
      binding_reason: attributionSession.binding_reason || null,
      source_family: attributionBundle.source_family || null,
      traffic_source_summary: attributionBundle.traffic_source
        ? {
            source_code: attributionBundle.traffic_source.source_code || null,
            source_type: attributionBundle.traffic_source.source_type || null,
            source_name: attributionBundle.traffic_source.source_name || null,
          }
        : null,
      source_qr_summary: attributionBundle.source_qr_code
        ? {
            source_qr_code_id: attributionBundle.source_qr_code.source_qr_code_id,
            qr_token: attributionBundle.source_qr_code.qr_token || null,
          }
        : null,
    });
  }

  isSellerActionablePath({
    attributionSummary,
    sourceFamily,
  }) {
    if (!attributionSummary) {
      return false;
    }

    return Boolean(
      attributionSummary.attribution_active &&
        Number.isInteger(Number(attributionSummary.seller_id)) &&
        Number(attributionSummary.seller_id) > 0 &&
        isSellerSourceFamily(sourceFamily)
    );
  }

  decideManualRouting({
    attributionSummary,
    sourceBindingSummary,
  }) {
    if (
      attributionSummary &&
      attributionSummary.attribution_status === 'EXPIRED'
    ) {
      return freezeTelegramManualFallbackValue({
        routing_status: 'attribution_expired_manual',
        route_target_type: 'manual_review',
        route_reason: 'seller_attribution_expired',
        seller_actionable: false,
      });
    }
    if (
      attributionSummary &&
      attributionSummary.attribution_status === 'ACTIVE' &&
      attributionSummary.attribution_active === false &&
      attributionSummary.attribution_expires_at
    ) {
      return freezeTelegramManualFallbackValue({
        routing_status: 'attribution_expired_manual',
        route_target_type: 'manual_review',
        route_reason: 'seller_attribution_expired',
        seller_actionable: false,
      });
    }

    const sourceBindingStatus = sourceBindingSummary?.binding_status || null;
    if (sourceBindingStatus && ROUTING_FROM_BINDING_STATUS[sourceBindingStatus]) {
      return freezeTelegramManualFallbackValue({
        ...ROUTING_FROM_BINDING_STATUS[sourceBindingStatus],
        seller_actionable: false,
      });
    }

    const sourceFamily = attributionSummary?.source_family || null;
    if (sourceFamily === 'owner_source') {
      return freezeTelegramManualFallbackValue({
        routing_status: 'owner_manual',
        route_target_type: 'owner_manual',
        route_reason: 'resolved_owner_source',
        seller_actionable: false,
      });
    }
    if (sourceFamily && isSellerSourceFamily(sourceFamily)) {
      return freezeTelegramManualFallbackValue({
        routing_status: 'unresolved_source_manual',
        route_target_type: 'manual_review',
        route_reason: 'resolved_seller_source_without_active_attribution',
        seller_actionable: false,
      });
    }
    if (sourceFamily) {
      return freezeTelegramManualFallbackValue({
        routing_status: 'generic_unassigned',
        route_target_type: 'generic_unassigned',
        route_reason: 'resolved_generic_source',
        seller_actionable: false,
      });
    }

    return freezeTelegramManualFallbackValue({
      routing_status: 'no_source_manual',
      route_target_type: 'manual_review',
      route_reason: 'no_source_token',
      seller_actionable: false,
    });
  }

  buildHoldStateSummary(bookingHold = null) {
    if (!bookingHold) {
      return freezeTelegramManualFallbackValue({
        hold_status: 'missing',
        hold_active: false,
        hold_expires_at_summary: null,
      });
    }

    const holdStatus = String(bookingHold.hold_status || '').trim();
    return freezeTelegramManualFallbackValue({
      hold_status: holdStatus || 'unknown',
      hold_active: ['ACTIVE', 'EXTENDED'].includes(holdStatus),
      hold_expires_at_summary: buildTelegramLatestTimestampSummary(
        bookingHold.hold_expires_at
      ),
    });
  }

  deriveQueueState({ bookingRequest, bookingHold, lastManualActionType }) {
    const requestStatus = String(bookingRequest.request_status || '').trim();
    if (bookingRequest.confirmed_presale_id) {
      return 'no_longer_actionable';
    }
    if (requestStatus === 'SELLER_NOT_REACHED') {
      return 'manual_not_reached';
    }
    if (requestStatus === 'PREPAYMENT_CONFIRMED') {
      return 'prepayment_confirmed_waiting_handoff';
    }
    if (NO_LONGER_ACTIONABLE_STATUSES.has(requestStatus)) {
      return 'no_longer_actionable';
    }
    if (
      requestStatus === 'CONTACT_IN_PROGRESS' ||
      lastManualActionType === 'call_started'
    ) {
      return 'manual_contact_in_progress';
    }
    if (requestStatus === 'HOLD_ACTIVE' && bookingHold?.hold_status === 'EXTENDED') {
      return 'hold_extended_waiting_manual';
    }
    if (WAITING_FOR_MANUAL_CONTACT_STATUSES.has(requestStatus)) {
      return 'waiting_for_manual_contact';
    }

    rejectManualFallbackQueueQuery(
      `Booking request is non-projectable for manual fallback queue: ${bookingRequest.booking_request_id}`
    );
    return null;
  }

  buildQueueItem(bookingRequest) {
    const guestProfile = this.getGuestProfileOrThrow(
      bookingRequest.guest_profile_id,
      bookingRequest.booking_request_id
    );
    const bookingHold = this.getBookingHold(bookingRequest.booking_request_id);
    const events = this.listRequestEvents(bookingRequest.booking_request_id);
    const lastManualActionEvent = this.findLastManualActionEvent(events);
    const lastManualActionType = mapLegacyManualActionType(lastManualActionEvent);
    const sourceBindingSummary = this.readLatestSourceBindingSummary(guestProfile);
    const nowIso = this.nowIso();
    const attributionBundle = this.getAttributionBundle(bookingRequest);
    const attributionSummary = this.buildAttributionSummary(attributionBundle, nowIso);

    if (
      this.isSellerActionablePath({
        attributionSummary,
        sourceFamily: attributionBundle.source_family,
      })
    ) {
      return null;
    }

    const routeDecision = this.decideManualRouting({
      attributionSummary,
      sourceBindingSummary,
    });
    const queueState = this.deriveQueueState({
      bookingRequest,
      bookingHold,
      lastManualActionType,
    });

    return freezeTelegramManualFallbackValue({
      response_version: TELEGRAM_MANUAL_FALLBACK_QUEUE_QUERY_ITEM_VERSION,
      projection_item_type: 'telegram_manual_fallback_queue_item',
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      queue_state: queueState,
      booking_request_reference: buildBookingRequestReference(bookingRequest),
      telegram_user_summary: buildTelegramUserSummaryFromGuestProfileAndEvents({
        guestProfile,
        events,
      }),
      current_route_target: buildCurrentRouteTarget(routeDecision, attributionSummary),
      current_route_reason: routeDecision.route_reason,
      requested_trip_slot_reference:
        buildTelegramRequestedTripSlotReference(bookingRequest),
      requested_seats_count: Number(bookingRequest.requested_seats || 0),
      requested_prepayment_amount: extractRequestedPrepaymentAmount({
        bookingHold,
        events,
      }),
      contact_phone_summary: buildTelegramContactPhoneSummary(
        bookingRequest.contact_phone_e164
      ),
      lifecycle_state: bookingRequest.request_status,
      hold_state_summary: this.buildHoldStateSummary(bookingHold),
      source_binding_summary: sourceBindingSummary,
      attribution_summary: attributionSummary,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        bookingRequest.last_status_at,
        bookingRequest.created_at,
        bookingHold?.last_extended_at,
        bookingHold?.started_at,
        sourceBindingSummary?.latest_timestamp_summary?.iso,
        lastManualActionEvent?.event_at
      ),
      last_manual_action_type: lastManualActionType,
    });
  }

  listManualFallbackCandidateRequestIds({ limit = DEFAULT_LIMIT } = {}) {
    const normalizedLimit = normalizeLimit(limit);
    return this.bookingRequests
      .listBy(
        {},
        {
          orderBy: 'last_status_at DESC, booking_request_id DESC',
          limit: Math.max(normalizedLimit, CANDIDATE_SCAN_LIMIT),
        }
      )
      .map((bookingRequest) => bookingRequest.booking_request_id);
  }

  listCurrentManualFallbackQueueItems(input = {}) {
    const queueStateFilter =
      input.queue_state !== undefined && input.queue_state !== null
        ? normalizeQueueState(input.queue_state)
        : null;
    const requestIds = this.listManualFallbackCandidateRequestIds({
      limit: input.limit,
    });
    const items = [];

    for (const bookingRequestId of requestIds) {
      const queueItem = this.buildQueueItem(
        this.getBookingRequestOrThrow(bookingRequestId)
      );
      if (!queueItem) {
        continue;
      }
      if (queueStateFilter && queueItem.queue_state !== queueStateFilter) {
        continue;
      }
      items.push(queueItem);
      if (items.length >= normalizeLimit(input.limit)) {
        break;
      }
    }

    return freezeTelegramManualFallbackValue({
      response_version: TELEGRAM_MANUAL_FALLBACK_QUEUE_QUERY_LIST_VERSION,
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      list_scope: 'manual_fallback_queue_current',
      queue_state_filter: queueStateFilter,
      item_count: items.length,
      items: items.sort(compareQueueItems),
    });
  }

  readManualFallbackQueueItemByBookingRequestReference(input = {}) {
    const bookingRequestId = normalizeBookingRequestId(input);
    const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
    const queueItem = this.buildQueueItem(bookingRequest);
    if (!queueItem) {
      rejectManualFallbackQueueQuery(
        `No active manual path for booking request: ${bookingRequestId}`
      );
    }

    return queueItem;
  }

  listManualFallbackQueueItemsByActiveHandlingState(input = {}) {
    const queueState = normalizeQueueState(
      input.queue_state ?? input.active_handling_state,
      'active_handling_state'
    );
    return this.listCurrentManualFallbackQueueItems({
      ...input,
      queue_state: queueState,
    });
  }

  listByActiveHandlingState(input = {}) {
    return this.listManualFallbackQueueItemsByActiveHandlingState(input);
  }

  readByBookingRequestReference(input = {}) {
    return this.readManualFallbackQueueItemByBookingRequestReference(input);
  }

  listCurrentQueue(input = {}) {
    return this.listCurrentManualFallbackQueueItems(input);
  }
}
