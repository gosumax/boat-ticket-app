import { freezeTelegramHandoffValue } from '../../../shared/telegram/index.js';
import { TELEGRAM_BOOKING_REQUEST_CREATION_RESULT_VERSION } from './booking-request-creation-service.js';
import { reserveLiveSeatHold } from './live-seat-hold-service.js';

export const TELEGRAM_BOOKING_REQUEST_HOLD_ACTIVATION_RESULT_VERSION =
  'telegram_booking_request_hold_activation_result.v1';

const ERROR_PREFIX = '[TELEGRAM_BOOKING_REQUEST_HOLD_ACTIVATION]';
const SERVICE_NAME = 'telegram_booking_request_hold_activation_service';
const BOOKING_REQUEST_CREATION_SERVICE_NAME =
  'telegram_booking_request_creation_service';
const REQUEST_CREATED_EVENT_TYPE = 'REQUEST_CREATED';
const HOLD_STARTED_EVENT_TYPE = 'HOLD_STARTED';
const HOLD_INITIAL_MINUTES = 15;
const ACTIVATABLE_BOOKING_REQUEST_STATUS = 'NEW';
const ACTIVE_HOLD_STATUSES = new Set(['ACTIVE', 'EXTENDED']);

function rejectActivation(message) {
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
    rejectActivation(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeNonNegativeInteger(value, label) {
  const normalized = Number(value ?? 0);
  if (!Number.isInteger(normalized) || normalized < 0) {
    rejectActivation(`${label} must be a non-negative integer`);
  }

  return normalized;
}

function sortActivationValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortActivationValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortActivationValue(value[key])])
  );
}

function freezeSortedActivationValue(value) {
  return freezeTelegramHandoffValue(sortActivationValue(value));
}

function compareStableValues(left, right) {
  return (
    JSON.stringify(sortActivationValue(left)) ===
    JSON.stringify(sortActivationValue(right))
  );
}

function normalizeTimestampSummary(iso) {
  return freezeSortedActivationValue({
    iso,
    unix_seconds: Math.floor(Date.parse(iso) / 1000),
  });
}

function addMinutes(isoTimestamp, minutes) {
  const date = new Date(isoTimestamp);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function pickCreationResult(input = {}) {
  if (input?.response_version) return input;
  if (input?.booking_request_creation_result) return input.booking_request_creation_result;
  if (input?.bookingRequestCreationResult) return input.bookingRequestCreationResult;
  if (input?.creation_result) return input.creation_result;
  if (input?.creationResult) return input.creationResult;

  return null;
}

function normalizeTelegramUserSummary(value) {
  if (!isPlainObject(value)) {
    rejectActivation('telegram user summary is required');
  }

  const telegramUserId = normalizeString(value.telegram_user_id);
  if (!telegramUserId) {
    rejectActivation('telegram_user_id is required');
  }

  return freezeSortedActivationValue({
    telegram_user_id: telegramUserId,
    is_bot: Boolean(value.is_bot),
    first_name: normalizeString(value.first_name),
    last_name: normalizeString(value.last_name),
    username: normalizeString(value.username),
    language_code: normalizeString(value.language_code),
    display_name: normalizeString(value.display_name) || telegramUserId,
  });
}

function normalizeBookingRequestReference(value) {
  if (!isPlainObject(value)) {
    rejectActivation('booking request reference is required');
  }
  if (value.reference_type !== 'telegram_booking_request') {
    rejectActivation(
      `Unsupported booking-request reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedActivationValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: normalizePositiveInteger(
      value.booking_request_id,
      'booking_request_reference.booking_request_id'
    ),
    guest_profile_id: normalizePositiveInteger(
      value.guest_profile_id,
      'booking_request_reference.guest_profile_id'
    ),
    seller_attribution_session_id: normalizePositiveInteger(
      value.seller_attribution_session_id,
      'booking_request_reference.seller_attribution_session_id'
    ),
  });
}

function normalizeTripSlotReference(value) {
  if (!isPlainObject(value)) {
    rejectActivation('requested trip/slot reference is required');
  }
  if (value.reference_type !== 'telegram_requested_trip_slot_reference') {
    rejectActivation(
      `Unsupported trip/slot reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedActivationValue({
    reference_type: 'telegram_requested_trip_slot_reference',
    requested_trip_date: normalizeString(value.requested_trip_date),
    requested_time_slot: normalizeString(value.requested_time_slot),
    slot_uid: normalizeString(value.slot_uid),
    boat_slot_id:
      value.boat_slot_id === null || value.boat_slot_id === undefined
        ? null
        : normalizePositiveInteger(value.boat_slot_id, 'boat_slot_id'),
  });
}

function normalizeCreationResultValue(creationResult) {
  if (!isPlainObject(creationResult)) {
    rejectActivation('booking-request creation result is required');
  }
  if (creationResult.response_version !== TELEGRAM_BOOKING_REQUEST_CREATION_RESULT_VERSION) {
    rejectActivation(
      `Unsupported booking-request creation result version: ${
        creationResult.response_version || 'unknown'
      }`
    );
  }
  if (creationResult.booking_request_status !== ACTIVATABLE_BOOKING_REQUEST_STATUS) {
    rejectActivation(
      `Unsupported booking-request state: ${creationResult.booking_request_status || 'unknown'}`
    );
  }

  const idempotencyKey = normalizeString(creationResult.idempotency_key);
  const dedupeKey = normalizeString(creationResult.dedupe_key);
  if (!idempotencyKey || !dedupeKey || idempotencyKey !== dedupeKey) {
    rejectActivation('booking-request creation result idempotency key is invalid');
  }

  return freezeSortedActivationValue({
    response_version: creationResult.response_version,
    booking_request_status: creationResult.booking_request_status,
    telegram_user_summary: normalizeTelegramUserSummary(
      creationResult.telegram_user_summary
    ),
    booking_request_reference: normalizeBookingRequestReference(
      creationResult.booking_request_reference
    ),
    requested_trip_slot_reference: normalizeTripSlotReference(
      creationResult.requested_trip_slot_reference
    ),
    requested_seats: normalizePositiveInteger(
      creationResult.requested_seats,
      'requested_seats'
    ),
    requested_prepayment_amount: normalizeNonNegativeInteger(
      creationResult.requested_prepayment_amount,
      'requested_prepayment_amount'
    ),
    dedupe_key: dedupeKey,
    idempotency_key: idempotencyKey,
  });
}

function normalizeCreationResult(input = {}) {
  const normalizedCreationResult = normalizeCreationResultValue(
    pickCreationResult(input)
  );
  const activationIdempotencyKey =
    `telegram_booking_request_hold_activate:${normalizedCreationResult.idempotency_key}`;

  return freezeSortedActivationValue({
    creation_result: normalizedCreationResult,
    booking_request_id:
      normalizedCreationResult.booking_request_reference.booking_request_id,
    guest_profile_id: normalizedCreationResult.booking_request_reference.guest_profile_id,
    seller_attribution_session_id:
      normalizedCreationResult.booking_request_reference.seller_attribution_session_id,
    dedupe_key: activationIdempotencyKey,
    idempotency_key: activationIdempotencyKey,
    activation_signature: {
      response_version: TELEGRAM_BOOKING_REQUEST_HOLD_ACTIVATION_RESULT_VERSION,
      creation_result: normalizedCreationResult,
      dedupe_key: activationIdempotencyKey,
      idempotency_key: activationIdempotencyKey,
    },
  });
}

function buildHoldReference(bookingHold) {
  return freezeSortedActivationValue({
    reference_type: 'telegram_booking_hold',
    booking_hold_id: bookingHold.booking_hold_id,
    booking_request_id: bookingHold.booking_request_id,
  });
}

function buildNoOpGuards({ seatHoldCreated = false } = {}) {
  return freezeSortedActivationValue({
    booking_hold_created: true,
    hold_extension_created: false,
    hold_expire_cleanup_run: false,
    seat_hold_created: seatHoldCreated,
    prepayment_confirmed: false,
    presale_created: false,
    production_webhook_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  });
}

function buildActivationResult({
  bookingHold,
  normalizedInput,
  holdStartedAt,
  holdExpiresAt,
  liveSeatHoldSummary,
}) {
  const creationResult = normalizedInput.creation_result;

  return freezeSortedActivationValue({
    response_version: TELEGRAM_BOOKING_REQUEST_HOLD_ACTIVATION_RESULT_VERSION,
    hold_status: bookingHold.hold_status,
    telegram_user_summary: creationResult.telegram_user_summary,
    booking_request_reference: creationResult.booking_request_reference,
    hold_reference: buildHoldReference(bookingHold),
    requested_trip_slot_reference: creationResult.requested_trip_slot_reference,
    requested_seats: creationResult.requested_seats,
    hold_started_at_summary: normalizeTimestampSummary(holdStartedAt),
    hold_expires_at_summary: normalizeTimestampSummary(holdExpiresAt),
    live_seat_hold_summary: liveSeatHoldSummary || null,
    hold_active: bookingHold.hold_status === 'ACTIVE',
    dedupe_key: normalizedInput.dedupe_key,
    idempotency_key: normalizedInput.idempotency_key,
  });
}

function buildEventPayload({ normalizedInput, result }) {
  return freezeSortedActivationValue({
    response_version: TELEGRAM_BOOKING_REQUEST_HOLD_ACTIVATION_RESULT_VERSION,
    hold_activation_source: SERVICE_NAME,
    booking_request_creation_result: normalizedInput.creation_result,
    hold_status: result.hold_status,
    telegram_user_summary: result.telegram_user_summary,
    booking_request_reference: result.booking_request_reference,
    hold_reference: result.hold_reference,
    requested_trip_slot_reference: result.requested_trip_slot_reference,
    requested_seats: result.requested_seats,
    hold_started_at_summary: result.hold_started_at_summary,
    hold_expires_at_summary: result.hold_expires_at_summary,
    live_seat_hold_summary: result.live_seat_hold_summary || null,
    hold_active: result.hold_active,
    dedupe_key: result.dedupe_key,
    idempotency_key: result.idempotency_key,
    activation_signature: normalizedInput.activation_signature,
    no_op_guards: buildNoOpGuards({
      seatHoldCreated: result.live_seat_hold_summary?.seat_hold_applied === true,
    }),
    hold_activation_result: result,
  });
}

function buildResultFromEvent(event) {
  const result = event?.event_payload?.hold_activation_result;
  if (!result) {
    rejectActivation(
      `Hold activation event result is missing: ${event?.booking_request_event_id || 'unknown'}`
    );
  }

  return freezeSortedActivationValue(result);
}

export class TelegramBookingRequestHoldActivationService {
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
      serviceName: 'booking-request-hold-activation-service',
      status: 'hold_activation_persistence_ready',
      dependencyKeys: ['bookingRequests', 'bookingHolds', 'bookingRequestEvents'],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectActivation('activation clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectActivation(`Booking request not found: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
  }

  listActivationEvents(bookingRequestId) {
    return this.listRequestEvents(bookingRequestId).filter(
      (event) =>
        event.event_type === HOLD_STARTED_EVENT_TYPE &&
        event.event_payload?.hold_activation_source === SERVICE_NAME
    );
  }

  resolveIdempotentActivationEvent(normalizedInput) {
    const matchingEvents = this.listActivationEvents(
      normalizedInput.booking_request_id
    ).filter(
      (event) => event.event_payload?.idempotency_key === normalizedInput.idempotency_key
    );
    if (matchingEvents.length === 0) {
      return null;
    }

    const matchingEvent = matchingEvents.find((event) =>
      compareStableValues(
        event.event_payload?.activation_signature,
        normalizedInput.activation_signature
      )
    );
    if (matchingEvent) {
      return matchingEvent;
    }

    rejectActivation(
      `Idempotency conflict for booking request hold activation: ${normalizedInput.idempotency_key}`
    );
  }

  assertPersistedCreationResult(normalizedInput) {
    const matchingCreationEvent = this.listRequestEvents(
      normalizedInput.booking_request_id
    ).find((event) => {
      if (
        event.event_type !== REQUEST_CREATED_EVENT_TYPE ||
        event.event_payload?.booking_request_creation_source !==
          BOOKING_REQUEST_CREATION_SERVICE_NAME ||
        event.event_payload?.idempotency_key !==
          normalizedInput.creation_result.idempotency_key
      ) {
        return false;
      }

      return compareStableValues(
        normalizeCreationResultValue(event.event_payload?.creation_result),
        normalizedInput.creation_result
      );
    });
    if (!matchingCreationEvent) {
      rejectActivation(
        `Persisted booking-request creation result not found: ${normalizedInput.booking_request_id}`
      );
    }
  }

  assertBookingRequestMatchesCreationResult(bookingRequest, normalizedInput) {
    const creationResult = normalizedInput.creation_result;
    if (bookingRequest.guest_profile_id !== normalizedInput.guest_profile_id) {
      rejectActivation('booking request guest does not match creation result');
    }
    if (
      bookingRequest.seller_attribution_session_id !==
      normalizedInput.seller_attribution_session_id
    ) {
      rejectActivation(
        'booking request seller attribution does not match creation result'
      );
    }
    if (
      bookingRequest.requested_trip_date !==
        creationResult.requested_trip_slot_reference.requested_trip_date ||
      bookingRequest.requested_time_slot !==
        creationResult.requested_trip_slot_reference.requested_time_slot ||
      bookingRequest.requested_seats !== creationResult.requested_seats
    ) {
      rejectActivation('booking request payload does not match creation result');
    }
    if (bookingRequest.request_status !== ACTIVATABLE_BOOKING_REQUEST_STATUS) {
      rejectActivation(
        `Unsupported booking-request state: ${bookingRequest.request_status || 'unknown'}`
      );
    }
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  assertNoExistingActiveHold(bookingRequestId) {
    const existingHold = this.getHoldForRequest(bookingRequestId);
    if (existingHold && ACTIVE_HOLD_STATUSES.has(existingHold.hold_status)) {
      rejectActivation(
        `Duplicate active hold for booking request: ${bookingRequestId}`
      );
    }
    if (existingHold) {
      rejectActivation(`Booking request already has a hold: ${bookingRequestId}`);
    }
  }

  activateHold(input = {}) {
    const runActivation = () => {
      const normalizedInput = normalizeCreationResult(input);
      const idempotentEvent =
        this.resolveIdempotentActivationEvent(normalizedInput);
      if (idempotentEvent) {
        return buildResultFromEvent(idempotentEvent);
      }

      const bookingRequest = this.getBookingRequestOrThrow(
        normalizedInput.booking_request_id
      );
      this.assertPersistedCreationResult(normalizedInput);
      this.assertBookingRequestMatchesCreationResult(bookingRequest, normalizedInput);
      this.assertNoExistingActiveHold(normalizedInput.booking_request_id);

      const holdStartedAt = this.nowIso();
      const liveSeatHoldSummary = reserveLiveSeatHold({
        db: this.db,
        requestedTripSlotReference:
          normalizedInput.creation_result.requested_trip_slot_reference,
        requestedSeats: normalizedInput.creation_result.requested_seats,
        errorPrefix: ERROR_PREFIX,
        reservedAt: holdStartedAt,
      });
      const holdExpiresAt = addMinutes(holdStartedAt, HOLD_INITIAL_MINUTES);
      const bookingHold = this.bookingHolds.create({
        booking_request_id: bookingRequest.booking_request_id,
        hold_scope: 'booking_request',
        hold_expires_at: holdExpiresAt,
        hold_status: 'ACTIVE',
        requested_amount:
          normalizedInput.creation_result.requested_prepayment_amount,
        currency: 'RUB',
        started_at: holdStartedAt,
        last_extended_at: null,
      });
      this.bookingRequests.updateById(bookingRequest.booking_request_id, {
        request_status: 'HOLD_ACTIVE',
        last_status_at: holdStartedAt,
      });
      const result = buildActivationResult({
        bookingHold,
        normalizedInput,
        holdStartedAt,
        holdExpiresAt,
        liveSeatHoldSummary,
      });

      this.bookingRequestEvents.create({
        booking_request_id: bookingRequest.booking_request_id,
        booking_hold_id: bookingHold.booking_hold_id,
        seller_attribution_session_id: bookingRequest.seller_attribution_session_id,
        event_type: HOLD_STARTED_EVENT_TYPE,
        event_at: holdStartedAt,
        actor_type: 'telegram_guest',
        actor_id: normalizedInput.creation_result.telegram_user_summary.telegram_user_id,
        event_payload: buildEventPayload({ normalizedInput, result }),
      });

      return result;
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runActivation)();
    }

    return runActivation();
  }

  activate(input = {}) {
    return this.activateHold(input);
  }
}
