import { freezeTelegramHandoffValue } from '../../../shared/telegram/index.js';
import { TELEGRAM_BOOKING_REQUEST_HOLD_ACTIVATION_RESULT_VERSION } from './booking-request-hold-activation-service.js';
import { TELEGRAM_BOOKING_REQUEST_HOLD_EXTENSION_RESULT_VERSION } from './booking-request-hold-extension-service.js';
import { releaseLiveSeatHold } from './live-seat-hold-service.js';

export const TELEGRAM_BOOKING_REQUEST_HOLD_EXPIRY_RESULT_VERSION =
  'telegram_booking_request_hold_expiry_result.v1';

const ERROR_PREFIX = '[TELEGRAM_BOOKING_REQUEST_HOLD_EXPIRY]';
const SERVICE_NAME = 'telegram_booking_request_hold_expiry_service';
const HOLD_ACTIVATION_SERVICE_NAME =
  'telegram_booking_request_hold_activation_service';
const HOLD_EXTENSION_SERVICE_NAME =
  'telegram_booking_request_hold_extension_service';
const HOLD_STARTED_EVENT_TYPE = 'HOLD_STARTED';
const HOLD_EXTENDED_EVENT_TYPE = 'HOLD_EXTENDED';
const HOLD_EXPIRED_EVENT_TYPE = 'HOLD_EXPIRED';
const ACTIVE_HOLD_STATUSES = new Set(['ACTIVE', 'EXTENDED']);

function rejectExpiry(message) {
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
    rejectExpiry(`${label} must be a positive integer`);
  }

  return normalized;
}

function sortExpiryValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortExpiryValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortExpiryValue(value[key])])
  );
}

function freezeSortedExpiryValue(value) {
  return freezeTelegramHandoffValue(sortExpiryValue(value));
}

function compareStableValues(left, right) {
  return (
    JSON.stringify(sortExpiryValue(left)) ===
    JSON.stringify(sortExpiryValue(right))
  );
}

function normalizeTimestampSummary(iso) {
  return freezeSortedExpiryValue({
    iso,
    unix_seconds: Math.floor(Date.parse(iso) / 1000),
  });
}

function normalizeTimestampSummaryInput(value, label) {
  if (!isPlainObject(value)) {
    rejectExpiry(`${label} is required`);
  }

  const iso = normalizeString(value.iso);
  if (!iso || Number.isNaN(Date.parse(iso))) {
    rejectExpiry(`${label}.iso must be a valid timestamp`);
  }

  return normalizeTimestampSummary(new Date(iso).toISOString());
}

function normalizePersistedTimestampSummary(iso, label) {
  const normalizedIso = normalizeString(iso);
  if (!normalizedIso || Number.isNaN(Date.parse(normalizedIso))) {
    rejectExpiry(`${label} must be a valid timestamp`);
  }

  return normalizeTimestampSummary(new Date(normalizedIso).toISOString());
}

function pickHoldState(input = {}) {
  if (input?.response_version) return input;
  if (input?.booking_request_hold_extension_result) {
    return input.booking_request_hold_extension_result;
  }
  if (input?.bookingRequestHoldExtensionResult) {
    return input.bookingRequestHoldExtensionResult;
  }
  if (input?.booking_request_hold_activation_result) {
    return input.booking_request_hold_activation_result;
  }
  if (input?.bookingRequestHoldActivationResult) {
    return input.bookingRequestHoldActivationResult;
  }
  if (input?.hold_extension_result) return input.hold_extension_result;
  if (input?.holdExtensionResult) return input.holdExtensionResult;
  if (input?.hold_activation_result) return input.hold_activation_result;
  if (input?.holdActivationResult) return input.holdActivationResult;
  if (input?.active_hold_state) return input.active_hold_state;
  if (input?.activeHoldState) return input.activeHoldState;

  return null;
}

function normalizeTelegramUserSummary(value) {
  if (!isPlainObject(value)) {
    rejectExpiry('telegram user summary is required');
  }

  const telegramUserId = normalizeString(value.telegram_user_id);
  if (!telegramUserId) {
    rejectExpiry('telegram_user_id is required');
  }

  return freezeSortedExpiryValue({
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
    rejectExpiry('booking request reference is required');
  }
  if (value.reference_type !== 'telegram_booking_request') {
    rejectExpiry(
      `Unsupported booking-request reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedExpiryValue({
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

function normalizeHoldReference(value) {
  if (!isPlainObject(value)) {
    rejectExpiry('hold reference is required');
  }
  if (value.reference_type !== 'telegram_booking_hold') {
    rejectExpiry(
      `Unsupported hold reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedExpiryValue({
    reference_type: 'telegram_booking_hold',
    booking_hold_id: normalizePositiveInteger(
      value.booking_hold_id,
      'hold_reference.booking_hold_id'
    ),
    booking_request_id: normalizePositiveInteger(
      value.booking_request_id,
      'hold_reference.booking_request_id'
    ),
  });
}

function normalizeTripSlotReference(value) {
  if (!isPlainObject(value)) {
    rejectExpiry('requested trip/slot reference is required');
  }
  if (value.reference_type !== 'telegram_requested_trip_slot_reference') {
    rejectExpiry(
      `Unsupported trip/slot reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedExpiryValue({
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

function normalizeOptionalLiveSeatHoldSummary(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isPlainObject(value)) {
    rejectExpiry('live seat hold summary must be an object');
  }

  return freezeSortedExpiryValue({
    summary_type: normalizeString(value.summary_type),
    seat_hold_applied: value.seat_hold_applied === true,
    slot_uid: normalizeString(value.slot_uid),
    held_seats:
      value.held_seats === null || value.held_seats === undefined
        ? null
        : normalizePositiveInteger(value.held_seats, 'live_seat_hold_summary.held_seats'),
    release_applied: value.release_applied === true,
    seats_left_after:
      value.seats_left_after === null || value.seats_left_after === undefined
        ? null
        : Number(value.seats_left_after),
    seats_left_after_release:
      value.seats_left_after_release === null ||
      value.seats_left_after_release === undefined
        ? null
        : Number(value.seats_left_after_release),
  });
}

function normalizeActiveHoldStateValue(activeHoldState) {
  if (!isPlainObject(activeHoldState)) {
    rejectExpiry('active hold state is required');
  }

  const isActivationState =
    activeHoldState.response_version ===
    TELEGRAM_BOOKING_REQUEST_HOLD_ACTIVATION_RESULT_VERSION;
  const isExtensionState =
    activeHoldState.response_version ===
    TELEGRAM_BOOKING_REQUEST_HOLD_EXTENSION_RESULT_VERSION;
  if (!isActivationState && !isExtensionState) {
    rejectExpiry(
      `Unsupported active hold state version: ${
        activeHoldState.response_version || 'unknown'
      }`
    );
  }

  const expectedHoldStatus = isExtensionState ? 'EXTENDED' : 'ACTIVE';
  if (activeHoldState.hold_status !== expectedHoldStatus) {
    rejectExpiry(
      `Unsupported hold status for expiry: ${activeHoldState.hold_status || 'unknown'}`
    );
  }
  if (activeHoldState.hold_active !== true) {
    rejectExpiry('active hold state must be active');
  }

  const idempotencyKey = normalizeString(activeHoldState.idempotency_key);
  const dedupeKey = normalizeString(activeHoldState.dedupe_key);
  if (!idempotencyKey || !dedupeKey || idempotencyKey !== dedupeKey) {
    rejectExpiry('active hold state idempotency key is invalid');
  }

  const bookingRequestReference = normalizeBookingRequestReference(
    activeHoldState.booking_request_reference
  );
  const holdReference = normalizeHoldReference(activeHoldState.hold_reference);
  if (
    holdReference.booking_request_id !==
    bookingRequestReference.booking_request_id
  ) {
    rejectExpiry('hold reference does not match booking request reference');
  }

  return freezeSortedExpiryValue({
    response_version: activeHoldState.response_version,
    hold_status: activeHoldState.hold_status,
    telegram_user_summary: normalizeTelegramUserSummary(
      activeHoldState.telegram_user_summary
    ),
    booking_request_reference: bookingRequestReference,
    hold_reference: holdReference,
    requested_trip_slot_reference: normalizeTripSlotReference(
      activeHoldState.requested_trip_slot_reference
    ),
    requested_seats: normalizePositiveInteger(
      activeHoldState.requested_seats,
      'requested_seats'
    ),
    hold_expires_at_summary: normalizeTimestampSummaryInput(
      isExtensionState
        ? activeHoldState.extended_hold_expires_at_summary
        : activeHoldState.hold_expires_at_summary,
      isExtensionState
        ? 'extended_hold_expires_at_summary'
        : 'hold_expires_at_summary'
    ),
    live_seat_hold_summary: normalizeOptionalLiveSeatHoldSummary(
      activeHoldState.live_seat_hold_summary
    ),
    hold_active: true,
    extension_applied: isExtensionState,
    dedupe_key: dedupeKey,
    idempotency_key: idempotencyKey,
  });
}

function normalizeExpiryInput(input = {}) {
  const activeHoldState = normalizeActiveHoldStateValue(pickHoldState(input));
  const expiryIdempotencyKey =
    `telegram_booking_request_hold_expire:${activeHoldState.idempotency_key}`;

  return freezeSortedExpiryValue({
    active_hold_state: activeHoldState,
    booking_request_id:
      activeHoldState.booking_request_reference.booking_request_id,
    booking_hold_id: activeHoldState.hold_reference.booking_hold_id,
    guest_profile_id: activeHoldState.booking_request_reference.guest_profile_id,
    seller_attribution_session_id:
      activeHoldState.booking_request_reference.seller_attribution_session_id,
    dedupe_key: expiryIdempotencyKey,
    idempotency_key: expiryIdempotencyKey,
    expiry_signature: {
      response_version: TELEGRAM_BOOKING_REQUEST_HOLD_EXPIRY_RESULT_VERSION,
      active_hold_state: activeHoldState,
      dedupe_key: expiryIdempotencyKey,
      idempotency_key: expiryIdempotencyKey,
    },
  });
}

function buildHoldReference(bookingHold) {
  return freezeSortedExpiryValue({
    reference_type: 'telegram_booking_hold',
    booking_hold_id: bookingHold.booking_hold_id,
    booking_request_id: bookingHold.booking_request_id,
  });
}

function buildNoOpGuards({ seatHoldReleased = false } = {}) {
  return freezeSortedExpiryValue({
    booking_hold_created: false,
    hold_extension_created: false,
    hold_expiry_created: true,
    seat_hold_released: seatHoldReleased,
    guest_cancelled: false,
    prepayment_confirmed: false,
    presale_created: false,
    production_webhook_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  });
}

function buildExpiryResult({
  bookingHold,
  normalizedInput,
  holdExpiredAtSummary,
  liveSeatReleaseSummary,
}) {
  const activeHoldState = normalizedInput.active_hold_state;

  return freezeSortedExpiryValue({
    response_version: TELEGRAM_BOOKING_REQUEST_HOLD_EXPIRY_RESULT_VERSION,
    hold_status: bookingHold.hold_status,
    telegram_user_summary: activeHoldState.telegram_user_summary,
    booking_request_reference: activeHoldState.booking_request_reference,
    hold_reference: buildHoldReference(bookingHold),
    requested_trip_slot_reference: activeHoldState.requested_trip_slot_reference,
    requested_seats: activeHoldState.requested_seats,
    hold_expired_at_summary:
      holdExpiredAtSummary || activeHoldState.hold_expires_at_summary,
    live_seat_release_summary: liveSeatReleaseSummary || null,
    hold_active: false,
    hold_expired: true,
    extension_applied: activeHoldState.extension_applied,
    dedupe_key: normalizedInput.dedupe_key,
    idempotency_key: normalizedInput.idempotency_key,
  });
}

function buildEventPayload({ normalizedInput, result }) {
  return freezeSortedExpiryValue({
    response_version: TELEGRAM_BOOKING_REQUEST_HOLD_EXPIRY_RESULT_VERSION,
    hold_expiry_source: SERVICE_NAME,
    active_hold_state: normalizedInput.active_hold_state,
    hold_status: result.hold_status,
    telegram_user_summary: result.telegram_user_summary,
    booking_request_reference: result.booking_request_reference,
    hold_reference: result.hold_reference,
    requested_trip_slot_reference: result.requested_trip_slot_reference,
    requested_seats: result.requested_seats,
    hold_expired_at_summary: result.hold_expired_at_summary,
    live_seat_release_summary: result.live_seat_release_summary || null,
    hold_active: result.hold_active,
    hold_expired: result.hold_expired,
    extension_applied: result.extension_applied,
    dedupe_key: result.dedupe_key,
    idempotency_key: result.idempotency_key,
    expiry_signature: normalizedInput.expiry_signature,
    no_op_guards: buildNoOpGuards({
      seatHoldReleased:
        result.live_seat_release_summary?.release_applied === true,
    }),
    hold_expiry_result: result,
  });
}

function buildResultFromEvent(event) {
  const result = event?.event_payload?.hold_expiry_result;
  if (!result) {
    rejectExpiry(
      `Hold expiry event result is missing: ${event?.booking_request_event_id || 'unknown'}`
    );
  }

  return freezeSortedExpiryValue(result);
}

export class TelegramBookingRequestHoldExpiryService {
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
      serviceName: 'booking-request-hold-expiry-service',
      status: 'hold_expiry_persistence_ready',
      dependencyKeys: ['bookingRequests', 'bookingHolds', 'bookingRequestEvents'],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectExpiry('expiry clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectExpiry(`Booking request not found: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  getBookingHoldOrThrow(bookingHoldId) {
    const bookingHold = this.bookingHolds.getById(bookingHoldId);
    if (!bookingHold) {
      rejectExpiry(`Booking hold not found: ${bookingHoldId}`);
    }

    return bookingHold;
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
  }

  listExpiryEvents(bookingRequestId) {
    return this.listRequestEvents(bookingRequestId).filter(
      (event) =>
        event.event_type === HOLD_EXPIRED_EVENT_TYPE &&
        event.event_payload?.hold_expiry_source === SERVICE_NAME
    );
  }

  resolveIdempotentExpiryEvent(normalizedInput) {
    const matchingEvents = this.listExpiryEvents(
      normalizedInput.booking_request_id
    ).filter(
      (event) => event.event_payload?.idempotency_key === normalizedInput.idempotency_key
    );
    if (matchingEvents.length === 0) {
      return null;
    }

    const matchingEvent = matchingEvents.find((event) =>
      compareStableValues(
        event.event_payload?.expiry_signature,
        normalizedInput.expiry_signature
      )
    );
    if (matchingEvent) {
      return matchingEvent;
    }

    rejectExpiry(
      `Idempotency conflict for booking request hold expiry: ${normalizedInput.idempotency_key}`
    );
  }

  assertPersistedActiveHoldState(normalizedInput) {
    const activeHoldState = normalizedInput.active_hold_state;
    const expectedEventType =
      activeHoldState.response_version ===
      TELEGRAM_BOOKING_REQUEST_HOLD_EXTENSION_RESULT_VERSION
        ? HOLD_EXTENDED_EVENT_TYPE
        : HOLD_STARTED_EVENT_TYPE;
    const expectedSource =
      expectedEventType === HOLD_EXTENDED_EVENT_TYPE
        ? HOLD_EXTENSION_SERVICE_NAME
        : HOLD_ACTIVATION_SERVICE_NAME;
    const sourcePayloadKey =
      expectedEventType === HOLD_EXTENDED_EVENT_TYPE
        ? 'hold_extension_source'
        : 'hold_activation_source';
    const resultPayloadKey =
      expectedEventType === HOLD_EXTENDED_EVENT_TYPE
        ? 'hold_extension_result'
        : 'hold_activation_result';

    const matchingActiveHoldEvent = this.listRequestEvents(
      normalizedInput.booking_request_id
    ).find((event) => {
      if (
        event.event_type !== expectedEventType ||
        event.event_payload?.[sourcePayloadKey] !== expectedSource ||
        event.event_payload?.idempotency_key !== activeHoldState.idempotency_key
      ) {
        return false;
      }

      return compareStableValues(
        normalizeActiveHoldStateValue(event.event_payload?.[resultPayloadKey]),
        activeHoldState
      );
    });
    if (!matchingActiveHoldEvent) {
      rejectExpiry(
        `Persisted active hold state not found: ${normalizedInput.booking_request_id}`
      );
    }
  }

  assertBookingRequestMatchesActiveHoldState(bookingRequest, normalizedInput) {
    const activeHoldState = normalizedInput.active_hold_state;
    if (bookingRequest.guest_profile_id !== normalizedInput.guest_profile_id) {
      rejectExpiry('booking request guest does not match active hold state');
    }
    if (
      bookingRequest.seller_attribution_session_id !==
      normalizedInput.seller_attribution_session_id
    ) {
      rejectExpiry(
        'booking request seller attribution does not match active hold state'
      );
    }
    if (
      bookingRequest.requested_trip_date !==
        activeHoldState.requested_trip_slot_reference.requested_trip_date ||
      bookingRequest.requested_time_slot !==
        activeHoldState.requested_trip_slot_reference.requested_time_slot ||
      bookingRequest.requested_seats !== activeHoldState.requested_seats
    ) {
      rejectExpiry('booking request payload does not match active hold state');
    }
    if (bookingRequest.request_status !== 'HOLD_ACTIVE') {
      rejectExpiry(
        `Unsupported booking-request state for hold expiry: ${bookingRequest.request_status || 'unknown'}`
      );
    }
  }

  assertBookingHoldMatchesActiveHoldState(bookingHold, normalizedInput, nowIso) {
    const activeHoldState = normalizedInput.active_hold_state;
    if (bookingHold.booking_request_id !== normalizedInput.booking_request_id) {
      rejectExpiry('hold reference does not match booking request');
    }
    if (bookingHold.hold_status === 'EXPIRED') {
      rejectExpiry(
        `Hold already expired for booking request: ${normalizedInput.booking_request_id}`
      );
    }
    if (!ACTIVE_HOLD_STATUSES.has(bookingHold.hold_status)) {
      rejectExpiry(
        `No active hold for booking request: ${normalizedInput.booking_request_id}`
      );
    }
    if (bookingHold.hold_status !== activeHoldState.hold_status) {
      rejectExpiry('active hold state status does not match persisted hold');
    }
    const persistedHoldExpiresAtSummary = normalizePersistedTimestampSummary(
      bookingHold.hold_expires_at,
      'persisted hold_expiry timestamp'
    );
    if (
      Date.parse(persistedHoldExpiresAtSummary.iso) >
      new Date(nowIso).getTime()
    ) {
      rejectExpiry(
        `Active hold is not expired for booking request: ${normalizedInput.booking_request_id}`
      );
    }

    return persistedHoldExpiresAtSummary;
  }

  expireHold(input = {}) {
    const runExpiry = () => {
      const normalizedInput = normalizeExpiryInput(input);
      const idempotentEvent = this.resolveIdempotentExpiryEvent(normalizedInput);
      if (idempotentEvent) {
        return buildResultFromEvent(idempotentEvent);
      }

      const bookingRequest = this.getBookingRequestOrThrow(
        normalizedInput.booking_request_id
      );
      const bookingHold = this.getBookingHoldOrThrow(
        normalizedInput.booking_hold_id
      );
      const nowIso = this.nowIso();
      this.assertPersistedActiveHoldState(normalizedInput);
      this.assertBookingRequestMatchesActiveHoldState(
        bookingRequest,
        normalizedInput
      );
      const persistedHoldExpiresAtSummary = this.assertBookingHoldMatchesActiveHoldState(
        bookingHold,
        normalizedInput,
        nowIso
      );
      const activeHoldState = normalizedInput.active_hold_state;
      const seatHoldSummary = activeHoldState.live_seat_hold_summary || null;
      const liveSeatReleaseSummary =
        seatHoldSummary?.seat_hold_applied === true
          ? releaseLiveSeatHold({
              db: this.db,
              requestedTripSlotReference:
                activeHoldState.requested_trip_slot_reference,
              requestedSeats:
                seatHoldSummary.held_seats || activeHoldState.requested_seats,
              errorPrefix: ERROR_PREFIX,
              releasedAt: nowIso,
            })
          : freezeSortedExpiryValue({
              summary_type: seatHoldSummary?.summary_type || null,
              seat_hold_applied: false,
              slot_uid:
                activeHoldState.requested_trip_slot_reference?.slot_uid || null,
              held_seats: 0,
              released_seats: 0,
              release_applied: false,
            });

      const updatedHold = this.bookingHolds.updateById(
        bookingHold.booking_hold_id,
        {
          hold_status: 'EXPIRED',
        }
      );
      this.bookingRequests.updateById(bookingRequest.booking_request_id, {
        request_status: 'HOLD_EXPIRED',
        last_status_at: nowIso,
      });
      const result = buildExpiryResult({
        bookingHold: updatedHold,
        normalizedInput,
        holdExpiredAtSummary: persistedHoldExpiresAtSummary,
        liveSeatReleaseSummary,
      });

      this.bookingRequestEvents.create({
        booking_request_id: bookingRequest.booking_request_id,
        booking_hold_id: updatedHold.booking_hold_id,
        seller_attribution_session_id:
          bookingRequest.seller_attribution_session_id,
        event_type: HOLD_EXPIRED_EVENT_TYPE,
        event_at: nowIso,
        actor_type: 'system',
        actor_id: 'telegram-hold-expiry-service',
        event_payload: buildEventPayload({ normalizedInput, result }),
      });

      return result;
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runExpiry)();
    }

    return runExpiry();
  }

  expire(input = {}) {
    return this.expireHold(input);
  }
}
