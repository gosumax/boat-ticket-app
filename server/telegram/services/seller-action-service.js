import {
  buildTelegramLatestTimestampSummary,
  buildTelegramSellerActionEventReference,
  buildTelegramSellerReference,
  freezeTelegramSellerOperationValue,
  TELEGRAM_SELLER_ACTION_RESULT_VERSION,
  TELEGRAM_SELLER_ACTION_STATUSES,
  TELEGRAM_SELLER_ACTION_TYPE_NAMES,
  TELEGRAM_SELLER_ACTION_TYPES,
} from '../../../shared/telegram/index.js';
import { buildBookingRequestReference } from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_SELLER_ACTION]';
const SERVICE_NAME = 'telegram_seller_action_service';
const FALLBACK_EVENT_SCAN_LIMIT = 10000;
const ACTIONABLE_QUEUE_STATES = new Set([
  'waiting_for_seller_contact',
  'hold_extended_waiting',
]);

function rejectSellerAction(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectSellerAction(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeActionType(value) {
  const normalized = String(value || '').trim();
  if (!TELEGRAM_SELLER_ACTION_TYPE_NAMES.includes(normalized)) {
    rejectSellerAction(`Unsupported action type: ${normalized || 'unknown'}`);
  }

  return normalized;
}

function normalizeIdempotencyKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    rejectSellerAction('idempotency_key is required');
  }

  return normalized;
}

function normalizeActionStatus(value) {
  if (!TELEGRAM_SELLER_ACTION_STATUSES.includes(value)) {
    rejectSellerAction(`Unsupported action status: ${String(value || 'unknown')}`);
  }

  return value;
}

function pickSellerReferenceInput(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return { seller_id: Number(input) };
  }

  return (
    input.seller_reference ??
    input.sellerReference ??
    input.seller ??
    input ??
    null
  );
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

function normalizeSellerId(input = {}) {
  const rawReference = pickSellerReferenceInput(input);
  if (!rawReference) {
    rejectSellerAction('seller reference is required');
  }

  const referenceType = String(rawReference.reference_type || 'seller_user').trim();
  if (referenceType !== 'seller_user') {
    rejectSellerAction(`Unsupported seller reference type: ${referenceType}`);
  }

  return normalizePositiveInteger(
    rawReference.seller_id ?? rawReference.sellerId ?? rawReference,
    'seller_reference.seller_id'
  );
}

function normalizeBookingRequestId(input = {}) {
  const rawReference = pickBookingRequestReferenceInput(input);
  if (!rawReference) {
    rejectSellerAction('booking request reference is required');
  }

  const referenceType = String(
    rawReference.reference_type || 'telegram_booking_request'
  ).trim();
  if (referenceType !== 'telegram_booking_request') {
    rejectSellerAction(
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

function compareStableValues(left, right) {
  return JSON.stringify(sortJsonValue(left)) === JSON.stringify(sortJsonValue(right));
}

function normalizeActionPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return freezeTelegramSellerOperationValue({});
  }

  return freezeTelegramSellerOperationValue(sortJsonValue(value));
}

function buildActionSignature({
  bookingRequestReference,
  sellerReference,
  actionType,
  actionPayload,
}) {
  return freezeTelegramSellerOperationValue({
    booking_request_reference: bookingRequestReference,
    seller_reference: sellerReference,
    action_type: actionType,
    action_payload: actionPayload,
  });
}

function buildQueueStateSummary(queueItem) {
  return freezeTelegramSellerOperationValue({
    queue_state: queueItem.queue_state,
    lifecycle_state: queueItem.lifecycle_state,
  });
}

export class TelegramSellerActionService {
  constructor({
    bookingRequests,
    bookingRequestEvents,
    sellerAttributionSessions,
    bookingRequestService,
    sellerWorkQueueQueryService,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingRequestEvents = bookingRequestEvents;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.bookingRequestService = bookingRequestService;
    this.sellerWorkQueueQueryService = sellerWorkQueueQueryService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'seller-action-service',
      status: 'telegram_seller_actions_ready',
      dependencyKeys: [
        'bookingRequests',
        'bookingRequestEvents',
        'sellerAttributionSessions',
        'bookingRequestService',
        'sellerWorkQueueQueryService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectSellerAction('seller action clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectSellerAction(`Invalid booking request reference: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  getActiveAttributionOrThrow(bookingRequestId, sellerAttributionSessionId) {
    const attribution = this.sellerAttributionSessions.getById(
      sellerAttributionSessionId
    );
    if (!attribution) {
      rejectSellerAction(`No active seller path for booking request: ${bookingRequestId}`);
    }

    const sellerId = Number(attribution.seller_id);
    const expiresAt = Date.parse(attribution.expires_at);
    const now = Date.parse(this.nowIso());
    if (
      !Number.isInteger(sellerId) ||
      sellerId <= 0 ||
      attribution.attribution_status !== 'ACTIVE' ||
      Number.isNaN(expiresAt) ||
      expiresAt <= now
    ) {
      rejectSellerAction(`No active seller path for booking request: ${bookingRequestId}`);
    }

    return attribution;
  }

  listPersistedSellerActionEvents() {
    this.bookingRequestEvents.assertReady();
    if (this.bookingRequestEvents.db?.prepare) {
      return this.bookingRequestEvents.db
        .prepare(
          `
            SELECT *
            FROM telegram_booking_request_events
            WHERE event_type IN ('SELLER_CALL_STARTED', 'SELLER_NOT_REACHED')
            ORDER BY booking_request_event_id ASC
          `
        )
        .all()
        .map((row) => this.bookingRequestEvents.deserializeRow(row))
        .filter((event) => event.event_payload?.seller_action_service_source === SERVICE_NAME);
    }

    return this.bookingRequestEvents
      .listBy({}, {
        orderBy: 'booking_request_event_id ASC',
        limit: FALLBACK_EVENT_SCAN_LIMIT,
      })
      .filter(
        (event) =>
          ['SELLER_CALL_STARTED', 'SELLER_NOT_REACHED'].includes(event.event_type) &&
          event.event_payload?.seller_action_service_source === SERVICE_NAME
      );
  }

  resolveIdempotentEvent({ idempotencyKey, actionSignature }) {
    const matchingEvents = this.listPersistedSellerActionEvents().filter(
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

    rejectSellerAction(`Idempotency conflict for seller action: ${idempotencyKey}`);
    return null;
  }

  assertActionableQueueState(queueItem) {
    if (!ACTIONABLE_QUEUE_STATES.has(queueItem.queue_state)) {
      rejectSellerAction(
        `Booking request is no longer actionable for seller action: ${queueItem.booking_request_reference.booking_request_id}`
      );
    }
  }

  applyCallStarted({
    bookingRequest,
    sellerId,
    idempotencyKey,
    dedupeKey,
    actionSignature,
    actionAt,
    actionPayload,
  }) {
    const nextStatus = ['NEW', 'ATTRIBUTED', 'HOLD_ACTIVE', 'WAITING_PREPAYMENT'].includes(
      bookingRequest.request_status
    )
      ? 'CONTACT_IN_PROGRESS'
      : bookingRequest.request_status;

    const updatedRequest = this.bookingRequests.updateById(
      bookingRequest.booking_request_id,
      {
        request_status: nextStatus,
        last_status_at: actionAt,
      }
    );

    const event = this.bookingRequestEvents.create({
      booking_request_id: updatedRequest.booking_request_id,
      booking_hold_id: null,
      seller_attribution_session_id: updatedRequest.seller_attribution_session_id,
      event_type: 'SELLER_CALL_STARTED',
      event_at: actionAt,
      actor_type: 'seller',
      actor_id: String(sellerId),
      event_payload: freezeTelegramSellerOperationValue({
        seller_action_service_source: SERVICE_NAME,
        action_type: TELEGRAM_SELLER_ACTION_TYPES.call_started,
        prior_request_status: bookingRequest.request_status,
        request_status: updatedRequest.request_status,
        idempotency_key: idempotencyKey,
        dedupe_key: dedupeKey,
        action_signature: actionSignature,
        action_payload: actionPayload,
      }),
    });

    return freezeTelegramSellerOperationValue({
      booking_request: updatedRequest,
      action_event: event,
    });
  }

  applyNotReached({
    bookingRequest,
    sellerId,
    idempotencyKey,
    dedupeKey,
    actionSignature,
    actionPayload,
  }) {
    this.bookingRequestService.markSellerNotReached(bookingRequest.booking_request_id, {
      actorType: 'seller',
      actorId: String(sellerId),
      eventMetadata: freezeTelegramSellerOperationValue({
        seller_action_service_source: SERVICE_NAME,
        action_type: TELEGRAM_SELLER_ACTION_TYPES.not_reached,
        idempotency_key: idempotencyKey,
        dedupe_key: dedupeKey,
        action_signature: actionSignature,
        action_payload: actionPayload,
      }),
    });

    const actionEvent = this.resolveIdempotentEvent({
      idempotencyKey,
      actionSignature,
    });
    if (!actionEvent) {
      rejectSellerAction(
        `Seller action event is missing after not_reached apply: ${bookingRequest.booking_request_id}`
      );
    }

    return freezeTelegramSellerOperationValue({
      booking_request: this.getBookingRequestOrThrow(bookingRequest.booking_request_id),
      action_event: actionEvent,
    });
  }

  buildResult({
    bookingRequest,
    sellerReference,
    actionType,
    actionStatus,
    actionEvent,
  }) {
    const queueItem =
      this.sellerWorkQueueQueryService.readSellerWorkQueueItemByBookingRequestReference({
        booking_request_reference: buildBookingRequestReference(bookingRequest),
      });

    return freezeTelegramSellerOperationValue({
      response_version: TELEGRAM_SELLER_ACTION_RESULT_VERSION,
      action_status: normalizeActionStatus(actionStatus),
      action_type: actionType,
      booking_request_reference: queueItem.booking_request_reference,
      seller_reference: sellerReference,
      action_event_reference: buildTelegramSellerActionEventReference(actionEvent),
      lifecycle_queue_state_summary: buildQueueStateSummary(queueItem),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        actionEvent?.event_at,
        queueItem?.latest_timestamp_summary?.iso,
        bookingRequest?.last_status_at
      ),
      idempotency_key: actionEvent?.event_payload?.idempotency_key || null,
      dedupe_key: actionEvent?.event_payload?.dedupe_key || null,
    });
  }

  recordSellerAction(input = {}) {
    const runAction = () => {
      const sellerId = normalizeSellerId(input);
      const bookingRequestId = normalizeBookingRequestId(input);
      const actionType = normalizeActionType(
        input.action_type ?? input.actionType ?? input.action
      );
      const idempotencyKey = normalizeIdempotencyKey(
        input.idempotency_key ?? input.idempotencyKey
      );
      const dedupeKey = normalizeIdempotencyKey(
        input.dedupe_key ?? input.dedupeKey ?? idempotencyKey
      );
      const actionPayload = normalizeActionPayload(
        input.action_payload ?? input.actionPayload
      );
      const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
      const attribution = this.getActiveAttributionOrThrow(
        bookingRequest.booking_request_id,
        bookingRequest.seller_attribution_session_id
      );
      if (Number(attribution.seller_id) !== sellerId) {
        rejectSellerAction(`Wrong seller for booking request: ${bookingRequestId}`);
      }
      const sellerReference = buildTelegramSellerReference({
        sellerId,
        sellerAttributionSessionId: bookingRequest.seller_attribution_session_id,
      });
      const actionSignature = buildActionSignature({
        bookingRequestReference: buildBookingRequestReference(bookingRequest),
        sellerReference,
        actionType,
        actionPayload,
      });
      const idempotentEvent = this.resolveIdempotentEvent({
        idempotencyKey,
        actionSignature,
      });
      if (idempotentEvent) {
        return this.buildResult({
          bookingRequest,
          sellerReference,
          actionType,
          actionStatus: 'idempotent_replay',
          actionEvent: idempotentEvent,
        });
      }

      const queueItem =
        this.sellerWorkQueueQueryService.readSellerWorkQueueItemByBookingRequestReference(
          bookingRequest.booking_request_id
        );
      this.assertActionableQueueState(queueItem);

      const actionAt = this.nowIso();
      const applied =
        actionType === TELEGRAM_SELLER_ACTION_TYPES.call_started
          ? this.applyCallStarted({
              bookingRequest,
              sellerId,
              idempotencyKey,
              dedupeKey,
              actionSignature,
              actionAt,
              actionPayload,
            })
          : this.applyNotReached({
              bookingRequest,
              sellerId,
              idempotencyKey,
              dedupeKey,
              actionSignature,
              actionPayload,
            });

      return this.buildResult({
        bookingRequest: applied.booking_request,
        sellerReference,
        actionType,
        actionStatus: 'applied',
        actionEvent: applied.action_event,
      });
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runAction)();
    }

    return runAction();
  }

  act(input = {}) {
    return this.recordSellerAction(input);
  }
}
