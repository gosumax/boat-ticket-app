import {
  buildTelegramLatestTimestampSummary,
  buildTelegramSellerReference,
  buildTelegramManualFallbackActionEventReference,
  freezeTelegramManualFallbackValue,
  TELEGRAM_MANUAL_FALLBACK_ACTION_RESULT_VERSION,
  TELEGRAM_MANUAL_FALLBACK_ACTION_STATUSES,
  TELEGRAM_MANUAL_FALLBACK_ACTION_TYPE_NAMES,
  TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES,
} from '../../../shared/telegram/index.js';
import { buildBookingRequestReference } from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_MANUAL_FALLBACK_ACTION]';
const SERVICE_NAME = 'telegram_manual_fallback_action_service';
const MANUAL_ASSIGNMENT_SOURCE_FAMILY = 'seller_direct_link';
const ACTIONABLE_QUEUE_STATES = new Set([
  'waiting_for_manual_contact',
  'hold_extended_waiting_manual',
  'manual_contact_in_progress',
]);
const CALL_STARTED_MUTABLE_REQUEST_STATUSES = new Set([
  'NEW',
  'ATTRIBUTED',
]);

function rejectManualFallbackAction(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectManualFallbackAction(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeActionType(value) {
  const normalized = String(value || '').trim();
  if (!TELEGRAM_MANUAL_FALLBACK_ACTION_TYPE_NAMES.includes(normalized)) {
    rejectManualFallbackAction(`Unsupported action type: ${normalized || 'unknown'}`);
  }

  return normalized;
}

function normalizeActionStatus(value) {
  if (!TELEGRAM_MANUAL_FALLBACK_ACTION_STATUSES.includes(value)) {
    rejectManualFallbackAction(`Unsupported action status: ${String(value || 'unknown')}`);
  }

  return value;
}

function normalizeIdempotencyKey(value, label = 'idempotency_key') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    rejectManualFallbackAction(`${label} is required`);
  }

  return normalized;
}

function normalizeActorType(value) {
  const normalized = String(value || 'owner').trim();
  if (!normalized) {
    rejectManualFallbackAction('actor_type is required');
  }

  return normalized;
}

function normalizeActorId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
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
    rejectManualFallbackAction('booking request reference is required');
  }

  const referenceType = String(
    rawReference.reference_type || 'telegram_booking_request'
  ).trim();
  if (referenceType !== 'telegram_booking_request') {
    rejectManualFallbackAction(
      `Unsupported booking request reference type: ${referenceType}`
    );
  }

  return normalizePositiveInteger(
    rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
    'booking_request_reference.booking_request_id'
  );
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])])
  );
}

function normalizeActionPayload(value) {
  if (value === null || value === undefined) {
    return freezeTelegramManualFallbackValue({});
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    rejectManualFallbackAction('action_payload must be an object');
  }

  return freezeTelegramManualFallbackValue(sortJsonValue(value));
}

function compareStableValues(left, right) {
  return JSON.stringify(sortJsonValue(left)) === JSON.stringify(sortJsonValue(right));
}

function buildActionSignature({
  bookingRequestId,
  actionType,
  actorType,
  actorId,
  actionPayload,
}) {
  return freezeTelegramManualFallbackValue({
    booking_request_id: bookingRequestId,
    action_type: actionType,
    actor_type: actorType,
    actor_id: actorId,
    action_payload: actionPayload,
  });
}

function normalizeAssignSellerId(actionPayload = {}) {
  const snakeCaseSellerId = actionPayload.seller_id;
  const camelCaseSellerId = actionPayload.sellerId;

  if (
    snakeCaseSellerId !== undefined &&
    camelCaseSellerId !== undefined &&
    Number(snakeCaseSellerId) !== Number(camelCaseSellerId)
  ) {
    rejectManualFallbackAction('seller_id payload fields conflict');
  }

  return normalizePositiveInteger(
    snakeCaseSellerId ?? camelCaseSellerId,
    'action_payload.seller_id'
  );
}

function mapQueueStateToHandlingState(queueState) {
  if (queueState === 'manual_contact_in_progress') {
    return 'manual_contact_in_progress';
  }
  if (queueState === 'manual_not_reached') {
    return 'manual_not_reached';
  }
  if (queueState === 'prepayment_confirmed_waiting_handoff') {
    return 'prepayment_confirmed';
  }
  if (
    queueState === 'waiting_for_manual_contact' ||
    queueState === 'hold_extended_waiting_manual'
  ) {
    return 'new_for_manual';
  }

  return 'no_longer_actionable';
}

export class TelegramManualFallbackActionService {
  constructor({
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    sellerAttributionSessions,
    attributionService,
    bookingRequestService,
    manualFallbackQueueQueryService,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.attributionService = attributionService;
    this.bookingRequestService = bookingRequestService;
    this.manualFallbackQueueQueryService = manualFallbackQueueQueryService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'manual-fallback-action-service',
      status: 'telegram_manual_fallback_actions_ready',
      dependencyKeys: [
        'bookingRequests',
        'bookingHolds',
        'bookingRequestEvents',
        'sellerAttributionSessions',
        'attributionService',
        'bookingRequestService',
        'manualFallbackQueueQueryService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectManualFallbackAction('action clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectManualFallbackAction(`Invalid booking request reference: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
  }

  resolveIdempotentEvent({ bookingRequestId, idempotencyKey, actionSignature }) {
    const matchingEvents = this.listRequestEvents(bookingRequestId).filter(
      (event) => event.event_payload?.idempotency_key === idempotencyKey
    );
    if (matchingEvents.length === 0) {
      return null;
    }

    const exactMatch = matchingEvents.find((event) =>
      compareStableValues(event.event_payload?.action_signature, actionSignature)
    );
    if (exactMatch) {
      return exactMatch;
    }

    rejectManualFallbackAction(
      `Idempotency conflict for booking request: ${bookingRequestId}`
    );
    return null;
  }

  readActionableQueueItemOrThrow(bookingRequestId) {
    let queueItem;
    try {
      queueItem =
        this.manualFallbackQueueQueryService.readManualFallbackQueueItemByBookingRequestReference(
          bookingRequestId
        );
    } catch (error) {
      const message = String(error?.message || '');
      if (message.includes('Invalid booking request reference')) {
        rejectManualFallbackAction(
          `Invalid booking request reference: ${bookingRequestId}`
        );
      }
      if (message.includes('No active manual path')) {
        rejectManualFallbackAction(
          `No active manual path for booking request: ${bookingRequestId}`
        );
      }
      if (message.includes('non-projectable')) {
        rejectManualFallbackAction(
          `No longer actionable request: ${bookingRequestId}`
        );
      }

      throw error;
    }

    if (!ACTIONABLE_QUEUE_STATES.has(queueItem.queue_state)) {
      rejectManualFallbackAction(
        `No longer actionable request: ${bookingRequestId}`
      );
    }

    return queueItem;
  }

  assertActiveSellerExists(sellerId) {
    const seller = this.db
      .prepare(
        `
          SELECT id
          FROM users
          WHERE id = ? AND role = 'seller' AND is_active = 1
        `
      )
      .get(sellerId);

    if (!seller) {
      rejectManualFallbackAction(`Invalid seller assignment target: ${sellerId}`);
    }
  }

  applyCallStarted({
    bookingRequest,
    actorType,
    actorId,
    actionAt,
    idempotencyKey,
    dedupeKey,
    actionSignature,
    actionPayload,
  }) {
    const updatedRequest = CALL_STARTED_MUTABLE_REQUEST_STATUSES.has(
      bookingRequest.request_status
    )
      ? this.bookingRequests.updateById(bookingRequest.booking_request_id, {
          request_status: 'CONTACT_IN_PROGRESS',
          last_status_at: actionAt,
        })
      : bookingRequest;
    const bookingHold = this.bookingHolds.findOneBy({
      booking_request_id: bookingRequest.booking_request_id,
    });

    const actionEvent = this.bookingRequestEvents.create({
      booking_request_id: updatedRequest.booking_request_id,
      booking_hold_id: bookingHold?.booking_hold_id || null,
      seller_attribution_session_id: updatedRequest.seller_attribution_session_id,
      event_type: 'MANUAL_FALLBACK_CALL_STARTED',
      event_at: actionAt,
      actor_type: actorType,
      actor_id: actorId,
      event_payload: freezeTelegramManualFallbackValue({
        manual_fallback_action_service_source: SERVICE_NAME,
        manual_fallback_action: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started,
        action_type: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started,
        prior_request_status: bookingRequest.request_status,
        request_status: updatedRequest.request_status,
        idempotency_key: idempotencyKey,
        dedupe_key: dedupeKey,
        action_signature: actionSignature,
        action_payload: actionPayload,
      }),
    });

    return freezeTelegramManualFallbackValue({
      booking_request: updatedRequest,
      action_event: actionEvent,
    });
  }

  applyNotReached({
    bookingRequest,
    actorType,
    actorId,
    idempotencyKey,
    dedupeKey,
    actionSignature,
    actionPayload,
  }) {
    this.bookingRequestService.markSellerNotReached(
      bookingRequest.booking_request_id,
      {
        actorType,
        actorId,
        eventMetadata: freezeTelegramManualFallbackValue({
          manual_fallback_action_service_source: SERVICE_NAME,
          manual_fallback_action: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.not_reached,
          action_type: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.not_reached,
          idempotency_key: idempotencyKey,
          dedupe_key: dedupeKey,
          action_signature: actionSignature,
          action_payload: actionPayload,
          prior_request_status: bookingRequest.request_status,
        }),
      }
    );

    const actionEvent = this.resolveIdempotentEvent({
      bookingRequestId: bookingRequest.booking_request_id,
      idempotencyKey,
      actionSignature,
    });
    if (!actionEvent) {
      rejectManualFallbackAction(
        `Manual action event is missing after not_reached apply: ${bookingRequest.booking_request_id}`
      );
    }

    return freezeTelegramManualFallbackValue({
      booking_request: this.getBookingRequestOrThrow(bookingRequest.booking_request_id),
      action_event: actionEvent,
    });
  }

  applyAssignToSeller({
    bookingRequest,
    actorType,
    actorId,
    actionAt,
    idempotencyKey,
    dedupeKey,
    actionSignature,
    actionPayload,
  }) {
    const sellerId = normalizeAssignSellerId(actionPayload);
    this.assertActiveSellerExists(sellerId);

    const priorAttributionSession = this.sellerAttributionSessions.getById(
      bookingRequest.seller_attribution_session_id
    );
    if (!priorAttributionSession) {
      rejectManualFallbackAction(
        `Incompatible route transition for booking request: ${bookingRequest.booking_request_id}`
      );
    }

    const nextAttributionSession =
      this.attributionService.createSellerAttributionSession({
        guestProfileId: bookingRequest.guest_profile_id,
        trafficSourceId: priorAttributionSession.traffic_source_id,
        sourceQRCodeId: priorAttributionSession.source_qr_code_id,
        sellerId,
        sourceFamily: MANUAL_ASSIGNMENT_SOURCE_FAMILY,
        startsAt: actionAt,
      });
    const updatedRequest = this.bookingRequests.updateById(
      bookingRequest.booking_request_id,
      {
        seller_attribution_session_id:
          nextAttributionSession.seller_attribution_session_id,
        request_status:
          bookingRequest.request_status === 'NEW'
            ? 'ATTRIBUTED'
            : bookingRequest.request_status,
        last_status_at: actionAt,
      }
    );

    const actionEvent = this.bookingRequestEvents.create({
      booking_request_id: updatedRequest.booking_request_id,
      booking_hold_id: null,
      seller_attribution_session_id:
        nextAttributionSession.seller_attribution_session_id,
      event_type: 'MANUAL_FALLBACK_ASSIGNED_TO_SELLER',
      event_at: actionAt,
      actor_type: actorType,
      actor_id: actorId,
      event_payload: freezeTelegramManualFallbackValue({
        manual_fallback_action_service_source: SERVICE_NAME,
        manual_fallback_action: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller,
        action_type: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller,
        idempotency_key: idempotencyKey,
        dedupe_key: dedupeKey,
        action_signature: actionSignature,
        action_payload: actionPayload,
        prior_request_status: bookingRequest.request_status,
        request_status: updatedRequest.request_status,
        prior_seller_attribution_session_id:
          priorAttributionSession.seller_attribution_session_id,
        seller_attribution_session_id:
          nextAttributionSession.seller_attribution_session_id,
        seller_id: sellerId,
        source_family: MANUAL_ASSIGNMENT_SOURCE_FAMILY,
        source_ownership: 'seller',
        path_type: 'seller_attributed',
      }),
    });

    return freezeTelegramManualFallbackValue({
      booking_request: updatedRequest,
      action_event: actionEvent,
      seller_reference: buildTelegramSellerReference({
        sellerId,
        sellerAttributionSessionId:
          nextAttributionSession.seller_attribution_session_id,
      }),
    });
  }

  safeReadQueueItem(bookingRequestId) {
    try {
      return this.manualFallbackQueueQueryService.readManualFallbackQueueItemByBookingRequestReference(
        bookingRequestId
      );
    } catch (error) {
      if (String(error?.message || '').includes('No active manual path')) {
        return null;
      }

      throw error;
    }
  }

  buildResult({
    actionStatus,
    actionType,
    bookingRequest,
    actionEvent,
    sellerReference = null,
  }) {
    const queueItem = this.safeReadQueueItem(bookingRequest.booking_request_id);
    const resultingRouteTarget = queueItem
      ? queueItem.current_route_target
      : freezeTelegramManualFallbackValue({
          route_target_type: 'seller',
          seller_reference: sellerReference,
        });
    const resultingRouteReason = queueItem
      ? queueItem.current_route_reason
      : 'manual_assign_to_seller';
    const manualHandlingState = queueItem
      ? mapQueueStateToHandlingState(queueItem.queue_state)
      : 'reassigned_to_seller';

    return freezeTelegramManualFallbackValue({
      response_version: TELEGRAM_MANUAL_FALLBACK_ACTION_RESULT_VERSION,
      action_status: normalizeActionStatus(actionStatus),
      action_type: actionType,
      booking_request_reference: buildBookingRequestReference(bookingRequest),
      manual_action_event_reference:
        buildTelegramManualFallbackActionEventReference(actionEvent),
      resulting_route_target: resultingRouteTarget,
      resulting_route_reason: resultingRouteReason,
      resulting_handling_state_summary: {
        manual_handling_state: manualHandlingState,
        queue_state: queueItem?.queue_state || null,
        lifecycle_state: queueItem?.lifecycle_state || bookingRequest.request_status,
      },
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        actionEvent?.event_at,
        queueItem?.latest_timestamp_summary?.iso,
        bookingRequest?.last_status_at
      ),
      idempotency_key: actionEvent?.event_payload?.idempotency_key || null,
      dedupe_key: actionEvent?.event_payload?.dedupe_key || null,
    });
  }

  recordManualFallbackAction(input = {}) {
    const runAction = () => {
      const bookingRequestId = normalizeBookingRequestId(input);
      const actionType = normalizeActionType(
        input.action_type ?? input.actionType ?? input.action
      );
      const idempotencyKey = normalizeIdempotencyKey(
        input.idempotency_key ?? input.idempotencyKey
      );
      const dedupeKey = normalizeIdempotencyKey(
        input.dedupe_key ?? input.dedupeKey ?? idempotencyKey,
        'dedupe_key'
      );
      const actorType = normalizeActorType(input.actor_type ?? input.actorType);
      const actorId = normalizeActorId(input.actor_id ?? input.actorId);
      const actionPayload = normalizeActionPayload(
        input.action_payload ?? input.actionPayload
      );
      const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
      const actionSignature = buildActionSignature({
        bookingRequestId: bookingRequest.booking_request_id,
        actionType,
        actorType,
        actorId,
        actionPayload,
      });
      const idempotentEvent = this.resolveIdempotentEvent({
        bookingRequestId,
        idempotencyKey,
        actionSignature,
      });
      if (idempotentEvent) {
        return this.buildResult({
          actionStatus: 'idempotent_replay',
          actionType,
          bookingRequest: this.getBookingRequestOrThrow(bookingRequestId),
          actionEvent: idempotentEvent,
          sellerReference:
            idempotentEvent?.event_payload?.seller_id &&
            idempotentEvent?.event_payload?.seller_attribution_session_id
              ? buildTelegramSellerReference({
                  sellerId: idempotentEvent.event_payload.seller_id,
                  sellerAttributionSessionId:
                    idempotentEvent.event_payload.seller_attribution_session_id,
                })
              : null,
        });
      }

      this.readActionableQueueItemOrThrow(bookingRequestId);

      const actionAt = this.nowIso();
      let applied;
      if (actionType === TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started) {
        applied = this.applyCallStarted({
          bookingRequest,
          actorType,
          actorId,
          actionAt,
          idempotencyKey,
          dedupeKey,
          actionSignature,
          actionPayload,
        });
      } else if (actionType === TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.not_reached) {
        applied = this.applyNotReached({
          bookingRequest,
          actorType,
          actorId,
          idempotencyKey,
          dedupeKey,
          actionSignature,
          actionPayload,
        });
      } else {
        applied = this.applyAssignToSeller({
          bookingRequest,
          actorType,
          actorId,
          actionAt,
          idempotencyKey,
          dedupeKey,
          actionSignature,
          actionPayload,
        });
      }

      return this.buildResult({
        actionStatus: 'applied',
        actionType,
        bookingRequest: applied.booking_request,
        actionEvent: applied.action_event,
        sellerReference: applied.seller_reference || null,
      });
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runAction)();
    }

    return runAction();
  }

  act(input = {}) {
    return this.recordManualFallbackAction(input);
  }
}
