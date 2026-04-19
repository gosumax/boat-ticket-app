import {
  BOOKING_HOLD_STATUSES,
  BOOKING_REQUEST_STATUSES,
  TELEGRAM_EVENT_TYPES,
} from '../../../shared/telegram/index.js';

const ACTIVE_REQUEST_STATUSES = new Set([
  'NEW',
  'ATTRIBUTED',
  'CONTACT_IN_PROGRESS',
  'HOLD_ACTIVE',
  'WAITING_PREPAYMENT',
  'PREPAYMENT_CONFIRMED',
]);

const HOLD_EXTENSION_MINUTES = 10;
const HOLD_INITIAL_MINUTES = 15;

function toIsoTimestamp(input) {
  const date = input instanceof Date ? input : new Date(input);
  return date.toISOString();
}

function addMinutes(isoTimestamp, minutes) {
  const date = new Date(isoTimestamp);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function assertKnownStatus(status, allowed, label) {
  if (!allowed.includes(status)) {
    throw new Error(`[TELEGRAM_BOOKING] Unknown ${label}: ${status}`);
  }
}

export class TelegramBookingRequestService {
  constructor({
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'booking-request-service',
      status: 'lifecycle_ready',
      dependencyKeys: ['bookingRequests', 'bookingHolds', 'bookingRequestEvents'],
    });
  }

  nowIso() {
    return toIsoTimestamp(this.now());
  }

  getRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      throw new Error(`[TELEGRAM_BOOKING] Booking request not found: ${bookingRequestId}`);
    }
    return bookingRequest;
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  appendRequestEvent({
    bookingRequestId,
    bookingHoldId = null,
    sellerAttributionSessionId = null,
    eventType,
    actorType,
    actorId = null,
    eventPayload = {},
    eventAt = this.nowIso(),
  }) {
    if (!TELEGRAM_EVENT_TYPES.includes(eventType)) {
      throw new Error(`[TELEGRAM_BOOKING] Unknown event type: ${eventType}`);
    }

    return this.bookingRequestEvents.create({
      booking_request_id: bookingRequestId,
      booking_hold_id: bookingHoldId,
      seller_attribution_session_id: sellerAttributionSessionId,
      event_type: eventType,
      event_at: eventAt,
      actor_type: actorType,
      actor_id: actorId,
      event_payload: eventPayload,
    });
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
  }

  hasActiveRequestForGuest(guestProfileId) {
    const requests = this.bookingRequests.listBy(
      { guest_profile_id: guestProfileId },
      { orderBy: 'booking_request_id DESC', limit: 100 }
    );
    return requests.some((request) => ACTIVE_REQUEST_STATUSES.has(request.request_status));
  }

  createBookingRequest(input) {
    const {
      guest_profile_id,
      seller_attribution_session_id,
      requested_trip_date,
      requested_time_slot,
      requested_seats,
      requested_ticket_mix,
      requested_prepayment_amount = 0,
      currency = 'RUB',
      contact_phone_e164,
      actor_type = 'system',
      actor_id = null,
    } = input || {};

    if (!guest_profile_id || !seller_attribution_session_id || !requested_trip_date || !requested_time_slot) {
      throw new Error('[TELEGRAM_BOOKING] Missing required booking request fields');
    }
    if (!requested_seats || Number(requested_seats) <= 0) {
      throw new Error('[TELEGRAM_BOOKING] requested_seats must be greater than zero');
    }
    if (this.hasActiveRequestForGuest(guest_profile_id)) {
      throw new Error('[TELEGRAM_BOOKING] Guest already has an active booking request');
    }

    const createdAt = this.nowIso();
    const bookingRequest = this.bookingRequests.create({
      guest_profile_id,
      seller_attribution_session_id,
      requested_trip_date,
      requested_time_slot,
      requested_seats,
      requested_ticket_mix: requested_ticket_mix || {},
      contact_phone_e164,
      request_status: BOOKING_REQUEST_STATUSES[0],
      created_at: createdAt,
      last_status_at: createdAt,
    });

    this.appendRequestEvent({
      bookingRequestId: bookingRequest.booking_request_id,
      sellerAttributionSessionId: seller_attribution_session_id,
      eventType: 'REQUEST_CREATED',
      actorType: actor_type,
      actorId: actor_id,
      eventPayload: {
        requested_trip_date,
        requested_time_slot,
        requested_seats,
      },
      eventAt: createdAt,
    });

    const bookingHold = this.startHold(bookingRequest.booking_request_id, {
      actorType: actor_type,
      actorId: actor_id,
      requestedAmount: requested_prepayment_amount,
      currency,
      holdScope: 'booking_request',
      holdStartedAt: createdAt,
    });

    return Object.freeze({
      bookingRequest: this.getRequestOrThrow(bookingRequest.booking_request_id),
      bookingHold,
      events: this.listRequestEvents(bookingRequest.booking_request_id),
    });
  }

  startHold(
    bookingRequestId,
    {
      actorType = 'system',
      actorId = null,
      requestedAmount = 0,
      currency = 'RUB',
      holdScope = 'booking_request',
      holdStartedAt = this.nowIso(),
    } = {}
  ) {
    const bookingRequest = this.getRequestOrThrow(bookingRequestId);
    const existingHold = this.getHoldForRequest(bookingRequestId);

    if (existingHold && ['ACTIVE', 'EXTENDED'].includes(existingHold.hold_status)) {
      throw new Error('[TELEGRAM_BOOKING] Active hold already exists for booking request');
    }
    if (bookingRequest.request_status === 'PREPAYMENT_CONFIRMED') {
      throw new Error('[TELEGRAM_BOOKING] Cannot start hold after prepayment confirmation');
    }

    const holdExpiresAt = addMinutes(holdStartedAt, HOLD_INITIAL_MINUTES);
    const bookingHold = existingHold
      ? this.bookingHolds.updateById(existingHold.booking_hold_id, {
          hold_scope: holdScope,
          hold_expires_at: holdExpiresAt,
          hold_status: 'ACTIVE',
          requested_amount: requestedAmount,
          currency,
          started_at: holdStartedAt,
          last_extended_at: null,
        })
      : this.bookingHolds.create({
          booking_request_id: bookingRequestId,
          hold_scope: holdScope,
          hold_expires_at: holdExpiresAt,
          hold_status: 'ACTIVE',
          requested_amount: requestedAmount,
          currency,
          started_at: holdStartedAt,
          last_extended_at: null,
        });

    const updatedRequest = this.bookingRequests.updateById(bookingRequestId, {
      request_status: 'HOLD_ACTIVE',
      last_status_at: holdStartedAt,
    });
    assertKnownStatus(updatedRequest.request_status, BOOKING_REQUEST_STATUSES, 'booking request status');

    this.appendRequestEvent({
      bookingRequestId,
      bookingHoldId: bookingHold.booking_hold_id,
      sellerAttributionSessionId: bookingRequest.seller_attribution_session_id,
      eventType: 'HOLD_STARTED',
      actorType,
      actorId,
      eventPayload: {
        hold_expires_at: holdExpiresAt,
        hold_scope: holdScope,
        requested_amount: requestedAmount,
        currency,
      },
      eventAt: holdStartedAt,
    });

    return bookingHold;
  }

  extendHoldOnce(
    bookingRequestId,
    { actorType = 'system', actorId = null, eventMetadata = {} } = {}
  ) {
    const bookingRequest = this.getRequestOrThrow(bookingRequestId);
    const bookingHold = this.getHoldForRequest(bookingRequestId);
    const nowIso = this.nowIso();

    if (!bookingHold) {
      throw new Error('[TELEGRAM_BOOKING] Cannot extend missing hold');
    }
    if (!['ACTIVE', 'EXTENDED'].includes(bookingHold.hold_status)) {
      throw new Error('[TELEGRAM_BOOKING] Only active hold can be extended');
    }
    if (new Date(bookingHold.hold_expires_at).getTime() <= new Date(nowIso).getTime()) {
      throw new Error('[TELEGRAM_BOOKING] Cannot extend expired hold');
    }

    const existingExtensions = this.listRequestEvents(bookingRequestId).filter(
      (event) => event.event_type === 'HOLD_EXTENDED'
    ).length;
    if (existingExtensions >= 1) {
      throw new Error('[TELEGRAM_BOOKING] Hold extension already used');
    }

    const nextExpiry = addMinutes(bookingHold.hold_expires_at, HOLD_EXTENSION_MINUTES);
    const updatedHold = this.bookingHolds.updateById(bookingHold.booking_hold_id, {
      hold_status: 'EXTENDED',
      hold_expires_at: nextExpiry,
      last_extended_at: nowIso,
    });
    assertKnownStatus(updatedHold.hold_status, BOOKING_HOLD_STATUSES, 'hold status');

    this.bookingRequests.updateById(bookingRequestId, {
      request_status: 'HOLD_ACTIVE',
      last_status_at: nowIso,
    });

    this.appendRequestEvent({
      bookingRequestId,
      bookingHoldId: bookingHold.booking_hold_id,
      sellerAttributionSessionId: bookingRequest.seller_attribution_session_id,
      eventType: 'HOLD_EXTENDED',
      actorType,
      actorId,
      eventPayload: {
        ...eventMetadata,
        hold_expires_at: nextExpiry,
        extension_minutes: HOLD_EXTENSION_MINUTES,
      },
      eventAt: nowIso,
    });

    return updatedHold;
  }

  cancelRequestByGuest(bookingRequestId, { actorType = 'guest', actorId = null } = {}) {
    const bookingRequest = this.getRequestOrThrow(bookingRequestId);
    const nowIso = this.nowIso();

    if (['PREPAYMENT_CONFIRMED', 'CONFIRMED_TO_PRESALE'].includes(bookingRequest.request_status)) {
      throw new Error('[TELEGRAM_BOOKING] Guest cancellation is not allowed after prepayment confirmation');
    }

    const updatedRequest = this.bookingRequests.updateById(bookingRequestId, {
      request_status: 'GUEST_CANCELLED',
      last_status_at: nowIso,
    });
    const bookingHold = this.getHoldForRequest(bookingRequestId);
    const updatedHold = bookingHold && ['ACTIVE', 'EXTENDED'].includes(bookingHold.hold_status)
      ? this.bookingHolds.updateById(bookingHold.booking_hold_id, {
          hold_status: 'CANCELLED',
        })
      : bookingHold;

    this.appendRequestEvent({
      bookingRequestId,
      bookingHoldId: updatedHold?.booking_hold_id || null,
      sellerAttributionSessionId: bookingRequest.seller_attribution_session_id,
      eventType: 'GUEST_CANCELLED',
      actorType,
      actorId,
      eventPayload: {
        request_status: updatedRequest.request_status,
      },
      eventAt: nowIso,
    });

    return Object.freeze({
      bookingRequest: updatedRequest,
      bookingHold: updatedHold,
    });
  }

  markSellerNotReached(
    bookingRequestId,
    { actorType = 'system', actorId = null, eventMetadata = {} } = {}
  ) {
    const bookingRequest = this.getRequestOrThrow(bookingRequestId);
    const nowIso = this.nowIso();

    if (['PREPAYMENT_CONFIRMED', 'CONFIRMED_TO_PRESALE'].includes(bookingRequest.request_status)) {
      throw new Error('[TELEGRAM_BOOKING] Cannot mark seller not reached after prepayment confirmation');
    }

    const updatedRequest = this.bookingRequests.updateById(bookingRequestId, {
      request_status: 'SELLER_NOT_REACHED',
      last_status_at: nowIso,
    });
    const bookingHold = this.getHoldForRequest(bookingRequestId);
    const updatedHold = bookingHold && ['ACTIVE', 'EXTENDED'].includes(bookingHold.hold_status)
      ? this.bookingHolds.updateById(bookingHold.booking_hold_id, {
          hold_status: 'RELEASED',
        })
      : bookingHold;

    this.appendRequestEvent({
      bookingRequestId,
      bookingHoldId: updatedHold?.booking_hold_id || null,
      sellerAttributionSessionId: bookingRequest.seller_attribution_session_id,
      eventType: 'SELLER_NOT_REACHED',
      actorType,
      actorId,
      eventPayload: {
        ...eventMetadata,
        request_status: updatedRequest.request_status,
      },
      eventAt: nowIso,
    });

    return Object.freeze({
      bookingRequest: updatedRequest,
      bookingHold: updatedHold,
    });
  }

  expireHold(bookingRequestId, { actorType = 'system', actorId = null } = {}) {
    const bookingRequest = this.getRequestOrThrow(bookingRequestId);
    const bookingHold = this.getHoldForRequest(bookingRequestId);
    const nowIso = this.nowIso();

    if (!bookingHold) {
      throw new Error('[TELEGRAM_BOOKING] Cannot expire missing hold');
    }
    if (bookingRequest.request_status === 'PREPAYMENT_CONFIRMED') {
      throw new Error('[TELEGRAM_BOOKING] Cannot expire hold after prepayment confirmation');
    }

    const updatedHold = this.bookingHolds.updateById(bookingHold.booking_hold_id, {
      hold_status: 'EXPIRED',
    });
    const updatedRequest = this.bookingRequests.updateById(bookingRequestId, {
      request_status: 'HOLD_EXPIRED',
      last_status_at: nowIso,
    });

    this.appendRequestEvent({
      bookingRequestId,
      bookingHoldId: bookingHold.booking_hold_id,
      sellerAttributionSessionId: bookingRequest.seller_attribution_session_id,
      eventType: 'HOLD_EXPIRED',
      actorType,
      actorId,
      eventPayload: {
        request_status: updatedRequest.request_status,
      },
      eventAt: nowIso,
    });

    return Object.freeze({
      bookingRequest: updatedRequest,
      bookingHold: updatedHold,
    });
  }

  confirmPrepayment(
    bookingRequestId,
    { actorType = 'system', actorId = null, eventMetadata = {} } = {}
  ) {
    const bookingRequest = this.getRequestOrThrow(bookingRequestId);
    const nowIso = this.nowIso();

    if (['GUEST_CANCELLED', 'SELLER_NOT_REACHED', 'HOLD_EXPIRED', 'CLOSED_UNCONVERTED'].includes(bookingRequest.request_status)) {
      throw new Error('[TELEGRAM_BOOKING] Cannot confirm prepayment for closed booking request');
    }
    if (bookingRequest.request_status === 'PREPAYMENT_CONFIRMED') {
      return Object.freeze({
        bookingRequest,
        bookingHold: this.getHoldForRequest(bookingRequestId),
      });
    }

    const updatedRequest = this.bookingRequests.updateById(bookingRequestId, {
      request_status: 'PREPAYMENT_CONFIRMED',
      last_status_at: nowIso,
    });
    const bookingHold = this.getHoldForRequest(bookingRequestId);
    const updatedHold = bookingHold
      ? this.bookingHolds.updateById(bookingHold.booking_hold_id, {
          hold_status: 'CONVERTED',
        })
      : null;

    this.appendRequestEvent({
      bookingRequestId,
      bookingHoldId: updatedHold?.booking_hold_id || null,
      sellerAttributionSessionId: bookingRequest.seller_attribution_session_id,
      eventType: 'PREPAYMENT_CONFIRMED',
      actorType,
      actorId,
      eventPayload: {
        ...eventMetadata,
        request_status: updatedRequest.request_status,
      },
      eventAt: nowIso,
    });

    return Object.freeze({
      bookingRequest: updatedRequest,
      bookingHold: updatedHold,
    });
  }
}
