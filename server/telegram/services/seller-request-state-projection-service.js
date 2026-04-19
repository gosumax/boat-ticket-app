import {
  buildTelegramLatestTimestampSummary,
  buildTelegramSellerActionEventReference,
  buildTelegramSellerHandoffLinkageSummary,
  freezeTelegramSellerOperationValue,
  TELEGRAM_SELLER_ACTION_TYPES,
  TELEGRAM_SELLER_HANDLING_STATES,
  TELEGRAM_SELLER_REQUEST_STATE_LIST_VERSION,
  TELEGRAM_SELLER_REQUEST_STATE_PROJECTION_VERSION,
} from '../../../shared/telegram/index.js';

const ERROR_PREFIX = '[TELEGRAM_SELLER_REQUEST_STATE]';
const SERVICE_NAME = 'telegram_seller_request_state_projection_service';

function rejectSellerRequestState(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeHandlingState(value) {
  if (!TELEGRAM_SELLER_HANDLING_STATES.includes(value)) {
    rejectSellerRequestState(`Unsupported handling state: ${String(value || 'unknown')}`);
  }

  return value;
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

function mapLegacySellerActionType(event) {
  const payloadAction = String(
    event?.event_payload?.action_type ??
      event?.event_payload?.seller_work_queue_action ??
      ''
  ).trim();
  if (payloadAction === TELEGRAM_SELLER_ACTION_TYPES.call_started) {
    return TELEGRAM_SELLER_ACTION_TYPES.call_started;
  }
  if (payloadAction === TELEGRAM_SELLER_ACTION_TYPES.not_reached) {
    return TELEGRAM_SELLER_ACTION_TYPES.not_reached;
  }
  if (event?.event_type === 'SELLER_CALL_STARTED') {
    return TELEGRAM_SELLER_ACTION_TYPES.call_started;
  }
  if (event?.event_type === 'SELLER_NOT_REACHED') {
    return TELEGRAM_SELLER_ACTION_TYPES.not_reached;
  }

  return null;
}

function buildLastSellerAction(event) {
  if (!event) {
    return null;
  }

  const actionType = mapLegacySellerActionType(event);
  if (!actionType) {
    return null;
  }

  return freezeTelegramSellerOperationValue({
    action_type: actionType,
    action_event_reference: buildTelegramSellerActionEventReference(event),
    action_timestamp_summary: buildTelegramLatestTimestampSummary(event.event_at),
  });
}

function mapHandlingState({
  queueState,
  lifecycleState,
  lastSellerAction,
  linkageSummary,
  confirmedPresaleReference,
}) {
  const bridgeLinkageState = linkageSummary?.bridge_linkage_state || null;
  if (
    lifecycleState === 'CONFIRMED_TO_PRESALE' ||
    confirmedPresaleReference ||
    bridgeLinkageState === 'bridged_to_presale'
  ) {
    return normalizeHandlingState('handed_off');
  }

  if (lifecycleState === 'PREPAYMENT_CONFIRMED') {
    return normalizeHandlingState('prepayment_confirmed');
  }

  if (lifecycleState === 'SELLER_NOT_REACHED') {
    return normalizeHandlingState('seller_not_reached');
  }

  if (lastSellerAction?.action_type === TELEGRAM_SELLER_ACTION_TYPES.not_reached) {
    return normalizeHandlingState('seller_not_reached');
  }

  if (
    lifecycleState === 'CONTACT_IN_PROGRESS' ||
    lastSellerAction?.action_type === TELEGRAM_SELLER_ACTION_TYPES.call_started
  ) {
    return normalizeHandlingState('contact_in_progress');
  }

  if (queueState === 'waiting_for_seller_contact' || queueState === 'hold_extended_waiting') {
    return normalizeHandlingState('new_for_seller');
  }

  if (queueState === 'prepayment_confirmed_waiting_handoff') {
    return normalizeHandlingState('prepayment_confirmed');
  }

  return normalizeHandlingState('no_longer_actionable');
}

export class TelegramSellerRequestStateProjectionService {
  constructor({
    bookingRequestEvents,
    sellerWorkQueueQueryService,
    bridgeLinkageProjectionService = null,
  }) {
    this.bookingRequestEvents = bookingRequestEvents;
    this.sellerWorkQueueQueryService = sellerWorkQueueQueryService;
    this.bridgeLinkageProjectionService = bridgeLinkageProjectionService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'seller-request-state-projection-service',
      status: 'read_only_seller_request_state_projection_ready',
      dependencyKeys: [
        'bookingRequestEvents',
        'sellerWorkQueueQueryService',
        'bridgeLinkageProjectionService',
      ],
    });
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id DESC', limit: 500 }
    );
  }

  findLastSellerActionEvent(bookingRequestId) {
    return (
      this.listRequestEvents(bookingRequestId).find(
        (event) => Boolean(mapLegacySellerActionType(event))
      ) || null
    );
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

  buildProjectionFromQueueItem(queueItem) {
    if (!queueItem?.booking_request_reference?.booking_request_id) {
      rejectSellerRequestState('Queue item is invalid for seller request-state projection');
    }
    const bookingRequestId = queueItem.booking_request_reference.booking_request_id;
    const lastSellerAction = buildLastSellerAction(
      this.findLastSellerActionEvent(bookingRequestId)
    );
    const linkageSummary = this.readLinkageSummary(
      queueItem.booking_request_reference,
      queueItem.confirmed_presale_reference
    );
    const currentSellerHandlingState = mapHandlingState({
      queueState: queueItem.queue_state,
      lifecycleState: queueItem.lifecycle_state,
      lastSellerAction,
      linkageSummary,
      confirmedPresaleReference: queueItem.confirmed_presale_reference,
    });

    return freezeTelegramSellerOperationValue({
      response_version: TELEGRAM_SELLER_REQUEST_STATE_PROJECTION_VERSION,
      projection_item_type: 'telegram_seller_request_state_projection_item',
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      booking_request_reference: queueItem.booking_request_reference,
      seller_reference: queueItem.seller_reference,
      current_seller_handling_state: currentSellerHandlingState,
      last_seller_action: lastSellerAction,
      current_route_target: queueItem.current_route_target,
      lifecycle_state: queueItem.lifecycle_state,
      handoff_linkage_summary: linkageSummary,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        queueItem.latest_timestamp_summary?.iso,
        lastSellerAction?.action_timestamp_summary?.iso,
        linkageSummary?.latest_timestamp_summary?.iso
      ),
    });
  }

  readCurrentSellerHandlingStateByBookingRequestReference(input = {}) {
    const queueItem =
      this.sellerWorkQueueQueryService.readSellerWorkQueueItemByBookingRequestReference(
        input
      );
    return this.buildProjectionFromQueueItem(queueItem);
  }

  listSellerHandlingStatesForSeller(input = {}) {
    const queueList =
      this.sellerWorkQueueQueryService.listCurrentSellerWorkQueueItemsBySellerReference(
        input
      );
    const items = queueList.items
      .map((queueItem) => this.buildProjectionFromQueueItem(queueItem))
      .sort(compareProjectionItems);

    return freezeTelegramSellerOperationValue({
      response_version: TELEGRAM_SELLER_REQUEST_STATE_LIST_VERSION,
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      list_scope: 'seller_request_handling_states_by_seller',
      seller_reference: queueList.seller_reference,
      item_count: items.length,
      items,
    });
  }

  readByBookingRequestReference(input = {}) {
    return this.readCurrentSellerHandlingStateByBookingRequestReference(input);
  }

  listBySellerReference(input = {}) {
    return this.listSellerHandlingStatesForSeller(input);
  }
}
