import {
  buildTelegramLatestTimestampSummary,
  buildTelegramSellerHandoffLinkageSummary,
  buildTelegramSellerReference,
  buildTelegramManualFallbackActionEventReference,
  freezeTelegramManualFallbackValue,
  TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES,
  TELEGRAM_MANUAL_FALLBACK_HANDLING_STATES,
  TELEGRAM_MANUAL_FALLBACK_REQUEST_STATE_LIST_VERSION,
  TELEGRAM_MANUAL_FALLBACK_REQUEST_STATE_PROJECTION_VERSION,
} from '../../../shared/telegram/index.js';
import { buildBookingRequestReference } from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_MANUAL_FALLBACK_REQUEST_STATE]';
const SERVICE_NAME = 'telegram_manual_fallback_request_state_projection_service';
const ACTIVE_MANUAL_QUEUE_STATES = new Set([
  'waiting_for_manual_contact',
  'hold_extended_waiting_manual',
  'manual_contact_in_progress',
  'prepayment_confirmed_waiting_handoff',
]);
const CLOSING_LIFECYCLE_STATES = new Set([
  'GUEST_CANCELLED',
  'HOLD_EXPIRED',
  'CLOSED_UNCONVERTED',
]);

function rejectManualFallbackRequestState(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeHandlingState(value) {
  if (!TELEGRAM_MANUAL_FALLBACK_HANDLING_STATES.includes(value)) {
    rejectManualFallbackRequestState(
      `Unsupported handling state: ${String(value || 'unknown')}`
    );
  }

  return value;
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

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectManualFallbackRequestState(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeBookingRequestId(input = {}) {
  const rawReference = pickBookingRequestReferenceInput(input);
  if (!rawReference) {
    rejectManualFallbackRequestState('booking request reference is required');
  }

  const referenceType = String(
    rawReference.reference_type || 'telegram_booking_request'
  ).trim();
  if (referenceType !== 'telegram_booking_request') {
    rejectManualFallbackRequestState(
      `Unsupported booking request reference type: ${referenceType}`
    );
  }

  return normalizePositiveInteger(
    rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
    'booking_request_reference.booking_request_id'
  );
}

function compareProjectionItems(left, right) {
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

function mapLegacyManualActionType(event) {
  const payloadAction = String(
    event?.event_payload?.manual_fallback_action ??
      event?.event_payload?.action_type ??
      event?.event_payload?.seller_work_queue_action ??
      ''
  ).trim();
  if (payloadAction === TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started) {
    return TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started;
  }
  if (payloadAction === TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.not_reached) {
    return TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.not_reached;
  }
  if (payloadAction === TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller) {
    return TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller;
  }
  if (event?.event_type === 'MANUAL_FALLBACK_CALL_STARTED') {
    return TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started;
  }
  if (event?.event_type === 'MANUAL_FALLBACK_ASSIGNED_TO_SELLER') {
    return TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller;
  }
  if (
    event?.event_type === 'SELLER_NOT_REACHED' &&
    payloadAction === TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.not_reached
  ) {
    return TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.not_reached;
  }

  return null;
}

function buildLastManualAction(event) {
  if (!event) {
    return null;
  }

  const actionType = mapLegacyManualActionType(event);
  if (!actionType) {
    return null;
  }

  return freezeTelegramManualFallbackValue({
    action_type: actionType,
    manual_action_event_reference:
      buildTelegramManualFallbackActionEventReference(event),
    action_timestamp_summary: buildTelegramLatestTimestampSummary(event.event_at),
  });
}

function mapHandlingState({
  queueState,
  lifecycleState,
  lastManualAction,
  routeTarget,
  linkageSummary,
}) {
  const routeTargetType = routeTarget?.route_target_type || null;
  const bridgeLinkageState = linkageSummary?.bridge_linkage_state || null;

  if (
    lifecycleState === 'CONFIRMED_TO_PRESALE' ||
    bridgeLinkageState === 'bridged_to_presale'
  ) {
    return normalizeHandlingState('handed_off');
  }
  if (
    routeTargetType === 'seller' ||
    lastManualAction?.action_type === TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller
  ) {
    return normalizeHandlingState('reassigned_to_seller');
  }
  if (
    lifecycleState === 'PREPAYMENT_CONFIRMED' ||
    queueState === 'prepayment_confirmed_waiting_handoff'
  ) {
    return normalizeHandlingState('prepayment_confirmed');
  }
  if (
    lifecycleState === 'SELLER_NOT_REACHED' ||
    queueState === 'manual_not_reached' ||
    lastManualAction?.action_type === TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.not_reached
  ) {
    return normalizeHandlingState('manual_not_reached');
  }
  if (
    lifecycleState === 'CONTACT_IN_PROGRESS' ||
    queueState === 'manual_contact_in_progress' ||
    lastManualAction?.action_type === TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started
  ) {
    return normalizeHandlingState('manual_contact_in_progress');
  }
  if (
    queueState === 'waiting_for_manual_contact' ||
    queueState === 'hold_extended_waiting_manual'
  ) {
    return normalizeHandlingState('new_for_manual');
  }
  if (
    queueState === 'no_longer_actionable' ||
    CLOSING_LIFECYCLE_STATES.has(lifecycleState)
  ) {
    return normalizeHandlingState('no_longer_actionable');
  }
  if (
    routeTargetType === 'owner_manual' ||
    routeTargetType === 'manual_review' ||
    routeTargetType === 'generic_unassigned'
  ) {
    return normalizeHandlingState('new_for_manual');
  }

  return normalizeHandlingState('no_longer_actionable');
}

export class TelegramManualFallbackRequestStateProjectionService {
  constructor({
    bookingRequests,
    bookingRequestEvents,
    sellerAttributionSessions,
    manualFallbackQueueQueryService,
    bridgeLinkageProjectionService = null,
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingRequestEvents = bookingRequestEvents;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.manualFallbackQueueQueryService = manualFallbackQueueQueryService;
    this.bridgeLinkageProjectionService = bridgeLinkageProjectionService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'manual-fallback-request-state-projection-service',
      status: 'read_only_manual_fallback_request_state_projection_ready',
      dependencyKeys: [
        'bookingRequests',
        'bookingRequestEvents',
        'sellerAttributionSessions',
        'manualFallbackQueueQueryService',
        'bridgeLinkageProjectionService',
      ],
    });
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectManualFallbackRequestState(
        `Invalid booking request reference: ${bookingRequestId}`
      );
    }

    return bookingRequest;
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id DESC', limit: 500 }
    );
  }

  findLastManualActionEvent(bookingRequestId) {
    return (
      this.listRequestEvents(bookingRequestId).find((event) =>
        Boolean(mapLegacyManualActionType(event))
      ) || null
    );
  }

  readQueueItemOrNull(bookingRequestId) {
    try {
      return this.manualFallbackQueueQueryService.readManualFallbackQueueItemByBookingRequestReference(
        bookingRequestId
      );
    } catch (error) {
      const message = String(error?.message || '');
      if (message.includes('No active manual path')) {
        return null;
      }
      if (message.includes('Invalid booking request reference')) {
        rejectManualFallbackRequestState(
          `Invalid booking request reference: ${bookingRequestId}`
        );
      }

      throw error;
    }
  }

  buildFallbackRouteTargetForAssignedSeller(bookingRequest) {
    const attribution = this.sellerAttributionSessions.getById(
      bookingRequest.seller_attribution_session_id
    );
    const sellerReference = buildTelegramSellerReference({
      sellerId: attribution?.seller_id || null,
      sellerAttributionSessionId:
        attribution?.seller_attribution_session_id || null,
    });

    return freezeTelegramManualFallbackValue({
      route_target_type: 'seller',
      seller_reference: sellerReference,
    });
  }

  readLinkageSummary(bookingRequestReference, confirmedPresaleReference = null) {
    if (!this.bridgeLinkageProjectionService) {
      return buildTelegramSellerHandoffLinkageSummary({
        confirmedPresaleId: confirmedPresaleReference?.presale_id ?? null,
      });
    }

    try {
      const bridgeProjection =
        this.bridgeLinkageProjectionService.readCurrentBridgeLinkageByBookingRequestReference(
          bookingRequestReference
        );
      return buildTelegramSellerHandoffLinkageSummary({
        bridgeLinkageProjection: bridgeProjection,
        confirmedPresaleId: confirmedPresaleReference?.presale_id ?? null,
      });
    } catch (error) {
      const message = String(error?.message || '');
      if (
        message.includes('not handoff-prepared') ||
        message.includes('not projectable') ||
        message.includes('Invalid booking request reference')
      ) {
        return buildTelegramSellerHandoffLinkageSummary({
          confirmedPresaleId: confirmedPresaleReference?.presale_id ?? null,
        });
      }

      throw error;
    }
  }

  buildProjection({
    bookingRequest,
    queueItem = null,
    lastManualActionEvent = null,
  }) {
    const bookingRequestReference = queueItem?.booking_request_reference
      ? queueItem.booking_request_reference
      : buildBookingRequestReference(bookingRequest);
    const lastManualAction = buildLastManualAction(lastManualActionEvent);
    const routeTarget = queueItem?.current_route_target
      ? queueItem.current_route_target
      : lastManualAction?.action_type ===
          TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller
        ? this.buildFallbackRouteTargetForAssignedSeller(bookingRequest)
        : freezeTelegramManualFallbackValue({
            route_target_type: 'manual_review',
            seller_reference: null,
          });
    const routeReason = queueItem?.current_route_reason
      ? queueItem.current_route_reason
      : lastManualAction?.action_type ===
          TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller
        ? 'manual_assign_to_seller'
        : 'manual_history_without_active_manual_path';
    const confirmedPresaleReference = bookingRequest.confirmed_presale_id
      ? freezeTelegramManualFallbackValue({
          reference_type: 'canonical_presale',
          presale_id: Number(bookingRequest.confirmed_presale_id),
        })
      : null;
    const linkageSummary = this.readLinkageSummary(
      bookingRequestReference,
      confirmedPresaleReference
    );
    const lifecycleState = queueItem?.lifecycle_state || bookingRequest.request_status;
    const currentManualHandlingState = mapHandlingState({
      queueState: queueItem?.queue_state || null,
      lifecycleState,
      lastManualAction,
      routeTarget,
      linkageSummary,
    });

    return freezeTelegramManualFallbackValue({
      response_version: TELEGRAM_MANUAL_FALLBACK_REQUEST_STATE_PROJECTION_VERSION,
      projection_item_type: 'telegram_manual_fallback_request_state_projection_item',
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      booking_request_reference: bookingRequestReference,
      current_manual_handling_state: currentManualHandlingState,
      last_manual_action: lastManualAction,
      current_route_target: routeTarget,
      current_route_reason: routeReason,
      lifecycle_state: lifecycleState,
      handoff_linkage_summary: linkageSummary,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        queueItem?.latest_timestamp_summary?.iso,
        lastManualAction?.action_timestamp_summary?.iso,
        linkageSummary?.latest_timestamp_summary?.iso,
        bookingRequest?.last_status_at
      ),
    });
  }

  readCurrentManualHandlingStateByBookingRequestReference(input = {}) {
    const bookingRequestId = normalizeBookingRequestId(input);
    const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
    const queueItem = this.readQueueItemOrNull(bookingRequestId);
    const lastManualActionEvent = this.findLastManualActionEvent(bookingRequestId);

    if (!queueItem && !lastManualActionEvent) {
      rejectManualFallbackRequestState(
        `Booking request is not projectable for manual request-state: ${bookingRequestId}`
      );
    }

    return this.buildProjection({
      bookingRequest,
      queueItem,
      lastManualActionEvent,
    });
  }

  listManualHandlingStatesForActiveManualQueueItems(input = {}) {
    const queueList =
      this.manualFallbackQueueQueryService.listCurrentManualFallbackQueueItems(input);
    const items = queueList.items
      .filter((item) => ACTIVE_MANUAL_QUEUE_STATES.has(item.queue_state))
      .map((queueItem) =>
        this.buildProjection({
          bookingRequest: this.getBookingRequestOrThrow(
            queueItem.booking_request_reference.booking_request_id
          ),
          queueItem,
          lastManualActionEvent: this.findLastManualActionEvent(
            queueItem.booking_request_reference.booking_request_id
          ),
        })
      )
      .sort(compareProjectionItems);

    return freezeTelegramManualFallbackValue({
      response_version: TELEGRAM_MANUAL_FALLBACK_REQUEST_STATE_LIST_VERSION,
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      list_scope: 'manual_handling_states_for_active_queue',
      item_count: items.length,
      items,
    });
  }

  readByBookingRequestReference(input = {}) {
    return this.readCurrentManualHandlingStateByBookingRequestReference(input);
  }

  listForActiveQueue(input = {}) {
    return this.listManualHandlingStatesForActiveManualQueueItems(input);
  }
}
