import {
  buildBookingRequestReference,
  buildHoldReference,
  compareStableLifecycleValues,
  freezeSortedLifecycleValue,
  normalizeBookingRequestReference,
  normalizeString,
  normalizeTelegramUserSummary,
  normalizeTimestampSummary,
  TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_EVENT_TYPE,
} from './booking-request-lifecycle-shared.js';
import { releaseLiveSeatHold } from './live-seat-hold-service.js';

export const TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_RESULT_VERSION =
  'telegram_booking_request_guest_cancel_before_prepayment_result.v1';

const ERROR_PREFIX = '[TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT]';
const SERVICE_NAME =
  'telegram_booking_request_guest_cancel_before_prepayment_service';
const FALLBACK_EVENT_SCAN_LIMIT = 10000;
const ACTIVE_HOLD_EVENT_RESULT_PAYLOAD_KEYS = Object.freeze({
  HOLD_STARTED: 'hold_activation_result',
  HOLD_EXTENDED: 'hold_extension_result',
});

function rejectGuestCancel(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function pickBookingRequestReference(input = {}) {
  return (
    input.booking_request_reference ??
    input.bookingRequestReference ??
    input.reference ??
    input.lifecycle_state?.booking_request_reference ??
    input.lifecycleState?.booking_request_reference ??
    null
  );
}

function pickTelegramUserSummary(input = {}) {
  return (
    input.telegram_user_summary ??
    input.telegramUserSummary ??
    input.telegram_guest ??
    input.telegramGuest ??
    input.lifecycle_state?.telegram_user_summary ??
    input.lifecycleState?.telegram_user_summary ??
    null
  );
}

function buildCancelSignature({ bookingRequestReference, telegramUserId, idempotencyKey }) {
  return freezeSortedLifecycleValue({
    response_version:
      TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_RESULT_VERSION,
    booking_request_reference: bookingRequestReference,
    telegram_user_id: telegramUserId,
    dedupe_key: idempotencyKey,
    idempotency_key: idempotencyKey,
  });
}

function normalizeCancelInput(input = {}) {
  const bookingRequestReference = normalizeBookingRequestReference(
    pickBookingRequestReference(input),
    rejectGuestCancel
  );
  const telegramUserSummary = normalizeTelegramUserSummary(
    pickTelegramUserSummary(input),
    rejectGuestCancel
  );
  const idempotencyKey =
    normalizeString(input.idempotency_key ?? input.idempotencyKey) ||
    `telegram_booking_request_guest_cancel_before_prepayment:${
      bookingRequestReference.booking_request_id
    }:${telegramUserSummary.telegram_user_id}`;

  return freezeSortedLifecycleValue({
    booking_request_reference: bookingRequestReference,
    telegram_user_summary: telegramUserSummary,
    dedupe_key: idempotencyKey,
    idempotency_key: idempotencyKey,
    cancel_signature: buildCancelSignature({
      bookingRequestReference,
      telegramUserId: telegramUserSummary.telegram_user_id,
      idempotencyKey,
    }),
  });
}

function buildNoOpGuards({ seatHoldReleased = false } = {}) {
  return freezeSortedLifecycleValue({
    booking_hold_created: false,
    hold_extension_created: false,
    hold_expiry_created: false,
    seat_hold_released: seatHoldReleased,
    guest_cancelled_before_prepayment: true,
    prepayment_confirmed: false,
    presale_created: false,
    production_webhook_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  });
}

function buildCancelResult({
  bookingRequest,
  bookingHold,
  projectionItem,
  normalizedInput,
  cancelledAt,
  liveSeatReleaseSummary,
}) {
  return freezeSortedLifecycleValue({
    response_version:
      TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_RESULT_VERSION,
    cancel_status: 'cancelled_before_prepayment',
    telegram_user_summary: projectionItem.telegram_user_summary,
    booking_request_reference: buildBookingRequestReference(bookingRequest),
    hold_reference: buildHoldReference(bookingHold),
    requested_trip_slot_reference: projectionItem.requested_trip_slot_reference,
    requested_seats: projectionItem.requested_seats,
    cancel_timestamp_summary: normalizeTimestampSummary(cancelledAt),
    live_seat_release_summary: liveSeatReleaseSummary || null,
    hold_active: false,
    request_active: false,
    dedupe_key: normalizedInput.dedupe_key,
    idempotency_key: normalizedInput.idempotency_key,
  });
}

function buildEventPayload({ normalizedInput, projectionItem, result }) {
  return freezeSortedLifecycleValue({
    response_version:
      TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_RESULT_VERSION,
    guest_cancel_before_prepayment_source: SERVICE_NAME,
    lifecycle_event_type:
      TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_EVENT_TYPE,
    booking_request_lifecycle_state: projectionItem,
    cancel_status: result.cancel_status,
    telegram_user_summary: result.telegram_user_summary,
    booking_request_reference: result.booking_request_reference,
    hold_reference: result.hold_reference,
    requested_trip_slot_reference: result.requested_trip_slot_reference,
    requested_seats: result.requested_seats,
    cancel_timestamp_summary: result.cancel_timestamp_summary,
    live_seat_release_summary: result.live_seat_release_summary || null,
    hold_active: result.hold_active,
    request_active: result.request_active,
    dedupe_key: result.dedupe_key,
    idempotency_key: result.idempotency_key,
    cancel_signature: normalizedInput.cancel_signature,
    no_op_guards: buildNoOpGuards({
      seatHoldReleased:
        result.live_seat_release_summary?.release_applied === true,
    }),
    guest_cancel_before_prepayment_result: result,
  });
}

function buildResultFromEvent(event) {
  const result = event?.event_payload?.guest_cancel_before_prepayment_result;
  if (!result) {
    rejectGuestCancel(
      `Guest cancel event result is missing: ${event?.booking_request_event_id || 'unknown'}`
    );
  }

  return freezeSortedLifecycleValue(result);
}

export class TelegramBookingRequestGuestCancelBeforePrepaymentService {
  constructor({
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    bookingRequestLifecycleProjectionService,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.bookingRequestLifecycleProjectionService =
      bookingRequestLifecycleProjectionService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'booking-request-guest-cancel-before-prepayment-service',
      status: 'guest_cancel_before_prepayment_persistence_ready',
      dependencyKeys: [
        'bookingRequests',
        'bookingHolds',
        'bookingRequestEvents',
        'bookingRequestLifecycleProjectionService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectGuestCancel('guest cancel clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  listCancelEvents() {
    this.bookingRequestEvents.assertReady();
    if (this.bookingRequestEvents.db?.prepare) {
      return this.bookingRequestEvents.db
        .prepare(
          `
            SELECT *
            FROM telegram_booking_request_events
            WHERE event_type = ?
            ORDER BY booking_request_event_id ASC
          `
        )
        .all(TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_EVENT_TYPE)
        .map((row) => this.bookingRequestEvents.deserializeRow(row))
        .filter(
          (event) =>
            event.event_payload?.guest_cancel_before_prepayment_source === SERVICE_NAME
        );
    }

    return this.bookingRequestEvents
      .listBy(
        {
          event_type:
            TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_EVENT_TYPE,
        },
        {
          orderBy: 'booking_request_event_id ASC',
          limit: FALLBACK_EVENT_SCAN_LIMIT,
        }
      )
      .filter(
        (event) =>
          event.event_payload?.guest_cancel_before_prepayment_source === SERVICE_NAME
      );
  }

  resolveIdempotentCancelEvent(normalizedInput) {
    const matchingEvents = this.listCancelEvents().filter(
      (event) => event.event_payload?.idempotency_key === normalizedInput.idempotency_key
    );
    if (matchingEvents.length === 0) {
      return null;
    }

    const matchingEvent = matchingEvents.find((event) =>
      compareStableLifecycleValues(
        event.event_payload?.cancel_signature,
        normalizedInput.cancel_signature
      )
    );
    if (matchingEvent) {
      return matchingEvent;
    }

    rejectGuestCancel(
      `Idempotency conflict for guest cancel before prepayment: ${normalizedInput.idempotency_key}`
    );
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
  }

  resolveLiveSeatHoldSummaryFromRequestEvents(bookingRequestId) {
    const events = this.listRequestEvents(bookingRequestId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      const resultPayloadKey =
        ACTIVE_HOLD_EVENT_RESULT_PAYLOAD_KEYS[event?.event_type] || null;
      if (!resultPayloadKey) {
        continue;
      }
      const payload = event?.event_payload?.[resultPayloadKey] || null;
      if (!payload || typeof payload !== 'object') {
        continue;
      }
      const liveSeatHoldSummary = payload.live_seat_hold_summary;
      if (
        liveSeatHoldSummary &&
        typeof liveSeatHoldSummary === 'object' &&
        liveSeatHoldSummary.seat_hold_applied === true
      ) {
        return freezeSortedLifecycleValue({
          summary_type: normalizeString(liveSeatHoldSummary.summary_type),
          seat_hold_applied: true,
          slot_uid: normalizeString(liveSeatHoldSummary.slot_uid),
          held_seats:
            Number.isInteger(Number(liveSeatHoldSummary.held_seats)) &&
            Number(liveSeatHoldSummary.held_seats) > 0
              ? Number(liveSeatHoldSummary.held_seats)
              : null,
        });
      }
    }

    return null;
  }

  assertGuestOwnsRequest(projectionItem, normalizedInput) {
    if (
      projectionItem.telegram_user_summary.telegram_user_id !==
      normalizedInput.telegram_user_summary.telegram_user_id
    ) {
      rejectGuestCancel(
        `Telegram guest does not match booking request: ${projectionItem.booking_request_reference.booking_request_id}`
      );
    }
  }

  assertCancellableLifecycleState(projectionItem) {
    if (projectionItem.lifecycle_state === 'cancelled_before_prepayment') {
      rejectGuestCancel(
        `Booking request is already cancelled before prepayment: ${projectionItem.booking_request_reference.booking_request_id}`
      );
    }
    if (projectionItem.lifecycle_state === 'hold_expired') {
      rejectGuestCancel(
        `Booking request is already expired before prepayment confirmation: ${projectionItem.booking_request_reference.booking_request_id}`
      );
    }
    if (projectionItem.lifecycle_state === 'prepayment_confirmed') {
      rejectGuestCancel(
        `Booking request is already prepayment-confirmed: ${projectionItem.booking_request_reference.booking_request_id}`
      );
    }
    if (!['new', 'hold_active', 'hold_extended'].includes(projectionItem.lifecycle_state)) {
      rejectGuestCancel(
        `Booking request is not cancellable inside Telegram boundary: ${projectionItem.booking_request_reference.booking_request_id}`
      );
    }
  }

  cancelBeforePrepayment(input = {}) {
    const runCancel = () => {
      const normalizedInput = normalizeCancelInput(input);
      const idempotentEvent = this.resolveIdempotentCancelEvent(normalizedInput);
      if (idempotentEvent) {
        return buildResultFromEvent(idempotentEvent);
      }

      const projectionItem =
        this.bookingRequestLifecycleProjectionService.readCurrentLifecycleStateByBookingRequestReference(
          {
            booking_request_reference: normalizedInput.booking_request_reference,
          }
        );
      this.assertGuestOwnsRequest(projectionItem, normalizedInput);
      this.assertCancellableLifecycleState(projectionItem);

      const cancelledAt = this.nowIso();
      const liveSeatHoldSummary = this.resolveLiveSeatHoldSummaryFromRequestEvents(
        projectionItem.booking_request_reference.booking_request_id
      );
      const bookingRequest = this.bookingRequests.updateById(
        normalizedInput.booking_request_reference.booking_request_id,
        {
          request_status: 'GUEST_CANCELLED',
          last_status_at: cancelledAt,
        }
      );
      const existingHold = this.getHoldForRequest(bookingRequest.booking_request_id);
      const bookingHold =
        existingHold && ['ACTIVE', 'EXTENDED'].includes(existingHold.hold_status)
          ? this.bookingHolds.updateById(existingHold.booking_hold_id, {
              hold_status: 'CANCELLED',
            })
          : existingHold;
      const liveSeatReleaseSummary =
        bookingHold &&
        ['CANCELLED'].includes(bookingHold.hold_status) &&
        liveSeatHoldSummary?.seat_hold_applied === true
          ? releaseLiveSeatHold({
              db: this.db,
              requestedTripSlotReference:
                projectionItem.requested_trip_slot_reference,
              requestedSeats:
                liveSeatHoldSummary.held_seats || projectionItem.requested_seats,
              errorPrefix: ERROR_PREFIX,
              releasedAt: cancelledAt,
            })
          : freezeSortedLifecycleValue({
              summary_type: liveSeatHoldSummary?.summary_type || null,
              seat_hold_applied: false,
              slot_uid:
                projectionItem.requested_trip_slot_reference?.slot_uid || null,
              held_seats: 0,
              released_seats: 0,
              release_applied: false,
            });
      const result = buildCancelResult({
        bookingRequest,
        bookingHold,
        projectionItem,
        normalizedInput,
        cancelledAt,
        liveSeatReleaseSummary,
      });

      this.bookingRequestEvents.create({
        booking_request_id: bookingRequest.booking_request_id,
        booking_hold_id: bookingHold?.booking_hold_id || null,
        seller_attribution_session_id: bookingRequest.seller_attribution_session_id,
        event_type:
          TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_EVENT_TYPE,
        event_at: cancelledAt,
        actor_type: 'telegram_guest',
        actor_id: normalizedInput.telegram_user_summary.telegram_user_id,
        event_payload: buildEventPayload({
          normalizedInput,
          projectionItem,
          result,
        }),
      });

      return result;
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runCancel)();
    }

    return runCancel();
  }

  cancel(input = {}) {
    return this.cancelBeforePrepayment(input);
  }
}
