import {
  buildBookingRequestReference,
  buildHoldReference,
  compareStableLifecycleValues,
  freezeSortedLifecycleValue,
  normalizeBookingRequestReference,
  normalizeString,
  normalizeTimestampSummary,
  TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMED_EVENT_TYPE,
} from './booking-request-lifecycle-shared.js';

export const TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMATION_RESULT_VERSION =
  'telegram_booking_request_prepayment_confirmation_result.v1';

const ERROR_PREFIX = '[TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMATION]';
const SERVICE_NAME = 'telegram_booking_request_prepayment_confirmation_service';
const FALLBACK_EVENT_SCAN_LIMIT = 10000;

function rejectPrepaymentConfirmation(message) {
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

function buildConfirmationSignature({ bookingRequestReference, idempotencyKey }) {
  return freezeSortedLifecycleValue({
    response_version:
      TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMATION_RESULT_VERSION,
    booking_request_reference: bookingRequestReference,
    dedupe_key: idempotencyKey,
    idempotency_key: idempotencyKey,
  });
}

function normalizeConfirmationInput(input = {}) {
  const bookingRequestReference = normalizeBookingRequestReference(
    pickBookingRequestReference(input),
    rejectPrepaymentConfirmation
  );
  const idempotencyKey =
    normalizeString(input.idempotency_key ?? input.idempotencyKey) ||
    `telegram_booking_request_prepayment_confirmation:${
      bookingRequestReference.booking_request_id
    }`;

  return freezeSortedLifecycleValue({
    booking_request_reference: bookingRequestReference,
    dedupe_key: idempotencyKey,
    idempotency_key: idempotencyKey,
    confirmation_signature: buildConfirmationSignature({
      bookingRequestReference,
      idempotencyKey,
    }),
  });
}

function buildNoOpGuards() {
  return freezeSortedLifecycleValue({
    booking_hold_created: false,
    hold_extension_created: false,
    hold_expiry_created: false,
    guest_cancelled_before_prepayment: false,
    prepayment_confirmed: true,
    presale_created: false,
    production_webhook_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  });
}

function buildConfirmationResult({
  bookingRequest,
  bookingHold,
  projectionItem,
  normalizedInput,
  confirmedAt,
}) {
  return freezeSortedLifecycleValue({
    response_version:
      TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMATION_RESULT_VERSION,
    confirmation_status: 'prepayment_confirmed',
    telegram_user_summary: projectionItem.telegram_user_summary,
    booking_request_reference: buildBookingRequestReference(bookingRequest),
    hold_reference: buildHoldReference(bookingHold),
    requested_trip_slot_reference: projectionItem.requested_trip_slot_reference,
    requested_seats: projectionItem.requested_seats,
    requested_prepayment_amount: projectionItem.requested_prepayment_amount,
    confirmation_timestamp_summary: normalizeTimestampSummary(confirmedAt),
    hold_active: false,
    request_confirmed: true,
    dedupe_key: normalizedInput.dedupe_key,
    idempotency_key: normalizedInput.idempotency_key,
  });
}

function buildEventPayload({ normalizedInput, projectionItem, result }) {
  return freezeSortedLifecycleValue({
    response_version:
      TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMATION_RESULT_VERSION,
    prepayment_confirmation_source: SERVICE_NAME,
    booking_request_lifecycle_state: projectionItem,
    confirmation_status: result.confirmation_status,
    telegram_user_summary: result.telegram_user_summary,
    booking_request_reference: result.booking_request_reference,
    hold_reference: result.hold_reference,
    requested_trip_slot_reference: result.requested_trip_slot_reference,
    requested_seats: result.requested_seats,
    requested_prepayment_amount: result.requested_prepayment_amount,
    confirmation_timestamp_summary: result.confirmation_timestamp_summary,
    hold_active: result.hold_active,
    request_confirmed: result.request_confirmed,
    dedupe_key: result.dedupe_key,
    idempotency_key: result.idempotency_key,
    confirmation_signature: normalizedInput.confirmation_signature,
    no_op_guards: buildNoOpGuards(),
    prepayment_confirmation_result: result,
  });
}

function buildResultFromEvent(event) {
  const result = event?.event_payload?.prepayment_confirmation_result;
  if (!result) {
    rejectPrepaymentConfirmation(
      `Prepayment confirmation event result is missing: ${event?.booking_request_event_id || 'unknown'}`
    );
  }

  return freezeSortedLifecycleValue(result);
}

export class TelegramBookingRequestPrepaymentConfirmationService {
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
      serviceName: 'booking-request-prepayment-confirmation-service',
      status: 'prepayment_confirmation_persistence_ready',
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
      rejectPrepaymentConfirmation(
        'prepayment confirmation clock returned an unusable timestamp'
      );
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  listConfirmationEvents() {
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
        .all(TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMED_EVENT_TYPE)
        .map((row) => this.bookingRequestEvents.deserializeRow(row))
        .filter(
          (event) => event.event_payload?.prepayment_confirmation_source === SERVICE_NAME
        );
    }

    return this.bookingRequestEvents
      .listBy(
        {
          event_type: TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMED_EVENT_TYPE,
        },
        {
          orderBy: 'booking_request_event_id ASC',
          limit: FALLBACK_EVENT_SCAN_LIMIT,
        }
      )
      .filter(
        (event) => event.event_payload?.prepayment_confirmation_source === SERVICE_NAME
      );
  }

  resolveIdempotentConfirmationEvent(normalizedInput) {
    const matchingEvents = this.listConfirmationEvents().filter(
      (event) => event.event_payload?.idempotency_key === normalizedInput.idempotency_key
    );
    if (matchingEvents.length === 0) {
      return null;
    }

    const matchingEvent = matchingEvents.find((event) =>
      compareStableLifecycleValues(
        event.event_payload?.confirmation_signature,
        normalizedInput.confirmation_signature
      )
    );
    if (matchingEvent) {
      return matchingEvent;
    }

    rejectPrepaymentConfirmation(
      `Idempotency conflict for prepayment confirmation: ${normalizedInput.idempotency_key}`
    );
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  assertConfirmableLifecycleState(projectionItem) {
    if (projectionItem.lifecycle_state === 'prepayment_confirmed') {
      rejectPrepaymentConfirmation(
        `Booking request is already prepayment-confirmed: ${projectionItem.booking_request_reference.booking_request_id}`
      );
    }
    if (projectionItem.lifecycle_state === 'cancelled_before_prepayment') {
      rejectPrepaymentConfirmation(
        `Booking request is already cancelled before prepayment: ${projectionItem.booking_request_reference.booking_request_id}`
      );
    }
    if (projectionItem.lifecycle_state === 'hold_expired') {
      rejectPrepaymentConfirmation(
        `Booking request is already expired before prepayment confirmation: ${projectionItem.booking_request_reference.booking_request_id}`
      );
    }
    if (!['hold_active', 'hold_extended'].includes(projectionItem.lifecycle_state)) {
      rejectPrepaymentConfirmation(
        `No valid active request state for prepayment confirmation: ${projectionItem.booking_request_reference.booking_request_id}`
      );
    }
  }

  confirmPrepayment(input = {}) {
    const runConfirmation = () => {
      const normalizedInput = normalizeConfirmationInput(input);
      const idempotentEvent =
        this.resolveIdempotentConfirmationEvent(normalizedInput);
      if (idempotentEvent) {
        return buildResultFromEvent(idempotentEvent);
      }

      const projectionItem =
        this.bookingRequestLifecycleProjectionService.readCurrentLifecycleStateByBookingRequestReference(
          {
            booking_request_reference: normalizedInput.booking_request_reference,
          }
        );
      this.assertConfirmableLifecycleState(projectionItem);

      const confirmedAt = this.nowIso();
      const bookingRequest = this.bookingRequests.updateById(
        normalizedInput.booking_request_reference.booking_request_id,
        {
          request_status: 'PREPAYMENT_CONFIRMED',
          last_status_at: confirmedAt,
        }
      );
      const existingHold = this.getHoldForRequest(bookingRequest.booking_request_id);
      const bookingHold =
        existingHold && ['ACTIVE', 'EXTENDED'].includes(existingHold.hold_status)
          ? this.bookingHolds.updateById(existingHold.booking_hold_id, {
              hold_status: 'CONVERTED',
            })
          : existingHold;
      const result = buildConfirmationResult({
        bookingRequest,
        bookingHold,
        projectionItem,
        normalizedInput,
        confirmedAt,
      });

      this.bookingRequestEvents.create({
        booking_request_id: bookingRequest.booking_request_id,
        booking_hold_id: bookingHold?.booking_hold_id || null,
        seller_attribution_session_id: bookingRequest.seller_attribution_session_id,
        event_type: TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMED_EVENT_TYPE,
        event_at: confirmedAt,
        actor_type: 'system',
        actor_id: 'telegram-prepayment-confirmation-service',
        event_payload: buildEventPayload({
          normalizedInput,
          projectionItem,
          result,
        }),
      });

      return result;
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runConfirmation)();
    }

    return runConfirmation();
  }

  confirm(input = {}) {
    return this.confirmPrepayment(input);
  }
}
