import { freezeTelegramHandoffValue } from '../../../shared/telegram/index.js';
import { TELEGRAM_BOOKING_REQUEST_HOLD_ACTIVATION_RESULT_VERSION } from './booking-request-hold-activation-service.js';

export const TELEGRAM_BOOKING_REQUEST_HOLD_EXTENSION_RESULT_VERSION =
  'telegram_booking_request_hold_extension_result.v1';

const ERROR_PREFIX = '[TELEGRAM_BOOKING_REQUEST_HOLD_EXTENSION]';
const SERVICE_NAME = 'telegram_booking_request_hold_extension_service';
const HOLD_ACTIVATION_SERVICE_NAME =
  'telegram_booking_request_hold_activation_service';
const HOLD_STARTED_EVENT_TYPE = 'HOLD_STARTED';
const HOLD_EXTENDED_EVENT_TYPE = 'HOLD_EXTENDED';
const HOLD_EXTENSION_MINUTES = 10;
const EXTENDABLE_HOLD_STATUS = 'ACTIVE';
const ACTIVE_HOLD_STATUSES = new Set(['ACTIVE', 'EXTENDED']);

function rejectExtension(message) {
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
    rejectExtension(`${label} must be a positive integer`);
  }

  return normalized;
}

function sortExtensionValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortExtensionValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortExtensionValue(value[key])])
  );
}

function freezeSortedExtensionValue(value) {
  return freezeTelegramHandoffValue(sortExtensionValue(value));
}

function compareStableValues(left, right) {
  return (
    JSON.stringify(sortExtensionValue(left)) ===
    JSON.stringify(sortExtensionValue(right))
  );
}

function normalizeTimestampSummary(iso) {
  return freezeSortedExtensionValue({
    iso,
    unix_seconds: Math.floor(Date.parse(iso) / 1000),
  });
}

function normalizeTimestampSummaryInput(value, label) {
  if (!isPlainObject(value)) {
    rejectExtension(`${label} is required`);
  }

  const iso = normalizeString(value.iso);
  if (!iso || Number.isNaN(Date.parse(iso))) {
    rejectExtension(`${label}.iso must be a valid timestamp`);
  }

  return normalizeTimestampSummary(new Date(iso).toISOString());
}

function addMinutes(isoTimestamp, minutes) {
  const date = new Date(isoTimestamp);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function pickActiveHoldState(input = {}) {
  if (input?.response_version) return input;
  if (input?.booking_request_hold_activation_result) {
    return input.booking_request_hold_activation_result;
  }
  if (input?.bookingRequestHoldActivationResult) {
    return input.bookingRequestHoldActivationResult;
  }
  if (input?.hold_activation_result) return input.hold_activation_result;
  if (input?.holdActivationResult) return input.holdActivationResult;
  if (input?.active_hold_state) return input.active_hold_state;
  if (input?.activeHoldState) return input.activeHoldState;

  return null;
}

function normalizeTelegramUserSummary(value) {
  if (!isPlainObject(value)) {
    rejectExtension('telegram user summary is required');
  }

  const telegramUserId = normalizeString(value.telegram_user_id);
  if (!telegramUserId) {
    rejectExtension('telegram_user_id is required');
  }

  return freezeSortedExtensionValue({
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
    rejectExtension('booking request reference is required');
  }
  if (value.reference_type !== 'telegram_booking_request') {
    rejectExtension(
      `Unsupported booking-request reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedExtensionValue({
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
    rejectExtension('hold reference is required');
  }
  if (value.reference_type !== 'telegram_booking_hold') {
    rejectExtension(
      `Unsupported hold reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedExtensionValue({
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
    rejectExtension('requested trip/slot reference is required');
  }
  if (value.reference_type !== 'telegram_requested_trip_slot_reference') {
    rejectExtension(
      `Unsupported trip/slot reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedExtensionValue({
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
    rejectExtension('live seat hold summary must be an object');
  }

  return freezeSortedExtensionValue({
    summary_type: normalizeString(value.summary_type),
    seat_hold_applied: value.seat_hold_applied === true,
    slot_uid: normalizeString(value.slot_uid),
    held_seats:
      value.held_seats === null || value.held_seats === undefined
        ? null
        : normalizePositiveInteger(value.held_seats, 'live_seat_hold_summary.held_seats'),
    seats_left_after:
      value.seats_left_after === null || value.seats_left_after === undefined
        ? null
        : Number(value.seats_left_after),
    seats_left_after_release:
      value.seats_left_after_release === null ||
      value.seats_left_after_release === undefined
        ? null
        : Number(value.seats_left_after_release),
    release_applied: value.release_applied === true,
  });
}

function normalizeActiveHoldStateValue(activeHoldState) {
  if (!isPlainObject(activeHoldState)) {
    rejectExtension('active hold state is required');
  }
  if (
    activeHoldState.response_version !==
    TELEGRAM_BOOKING_REQUEST_HOLD_ACTIVATION_RESULT_VERSION
  ) {
    rejectExtension(
      `Unsupported active hold state version: ${
        activeHoldState.response_version || 'unknown'
      }`
    );
  }
  if (activeHoldState.hold_status !== EXTENDABLE_HOLD_STATUS) {
    rejectExtension(
      `Unsupported hold status for extension: ${activeHoldState.hold_status || 'unknown'}`
    );
  }
  if (activeHoldState.hold_active !== true) {
    rejectExtension('active hold state must be active');
  }

  const idempotencyKey = normalizeString(activeHoldState.idempotency_key);
  const dedupeKey = normalizeString(activeHoldState.dedupe_key);
  if (!idempotencyKey || !dedupeKey || idempotencyKey !== dedupeKey) {
    rejectExtension('active hold state idempotency key is invalid');
  }

  const bookingRequestReference = normalizeBookingRequestReference(
    activeHoldState.booking_request_reference
  );
  const holdReference = normalizeHoldReference(activeHoldState.hold_reference);
  if (
    holdReference.booking_request_id !==
    bookingRequestReference.booking_request_id
  ) {
    rejectExtension('hold reference does not match booking request reference');
  }

  return freezeSortedExtensionValue({
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
      activeHoldState.hold_expires_at_summary,
      'hold_expires_at_summary'
    ),
    live_seat_hold_summary: normalizeOptionalLiveSeatHoldSummary(
      activeHoldState.live_seat_hold_summary
    ),
    hold_active: true,
    dedupe_key: dedupeKey,
    idempotency_key: idempotencyKey,
  });
}

function normalizeExtensionInput(input = {}) {
  const activeHoldState = normalizeActiveHoldStateValue(
    pickActiveHoldState(input)
  );
  const extensionIdempotencyKey =
    `telegram_booking_request_hold_extend:${activeHoldState.idempotency_key}`;

  return freezeSortedExtensionValue({
    active_hold_state: activeHoldState,
    booking_request_id:
      activeHoldState.booking_request_reference.booking_request_id,
    booking_hold_id: activeHoldState.hold_reference.booking_hold_id,
    guest_profile_id: activeHoldState.booking_request_reference.guest_profile_id,
    seller_attribution_session_id:
      activeHoldState.booking_request_reference.seller_attribution_session_id,
    dedupe_key: extensionIdempotencyKey,
    idempotency_key: extensionIdempotencyKey,
    extension_signature: {
      response_version: TELEGRAM_BOOKING_REQUEST_HOLD_EXTENSION_RESULT_VERSION,
      active_hold_state: activeHoldState,
      dedupe_key: extensionIdempotencyKey,
      idempotency_key: extensionIdempotencyKey,
    },
  });
}

function buildHoldReference(bookingHold) {
  return freezeSortedExtensionValue({
    reference_type: 'telegram_booking_hold',
    booking_hold_id: bookingHold.booking_hold_id,
    booking_request_id: bookingHold.booking_request_id,
  });
}

function buildNoOpGuards() {
  return freezeSortedExtensionValue({
    booking_hold_created: false,
    hold_extension_created: true,
    hold_expire_cleanup_run: false,
    prepayment_confirmed: false,
    presale_created: false,
    production_webhook_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  });
}

function buildExtensionResult({
  bookingHold,
  normalizedInput,
  originalHoldExpiresAt,
  extendedHoldExpiresAt,
}) {
  const activeHoldState = normalizedInput.active_hold_state;

  return freezeSortedExtensionValue({
    response_version: TELEGRAM_BOOKING_REQUEST_HOLD_EXTENSION_RESULT_VERSION,
    hold_status: bookingHold.hold_status,
    telegram_user_summary: activeHoldState.telegram_user_summary,
    booking_request_reference: activeHoldState.booking_request_reference,
    hold_reference: buildHoldReference(bookingHold),
    requested_trip_slot_reference: activeHoldState.requested_trip_slot_reference,
    requested_seats: activeHoldState.requested_seats,
    original_hold_expires_at_summary: normalizeTimestampSummary(originalHoldExpiresAt),
    extended_hold_expires_at_summary: normalizeTimestampSummary(extendedHoldExpiresAt),
    live_seat_hold_summary: activeHoldState.live_seat_hold_summary || null,
    hold_active: ACTIVE_HOLD_STATUSES.has(bookingHold.hold_status),
    extension_applied: true,
    dedupe_key: normalizedInput.dedupe_key,
    idempotency_key: normalizedInput.idempotency_key,
  });
}

function buildEventPayload({ normalizedInput, result }) {
  return freezeSortedExtensionValue({
    response_version: TELEGRAM_BOOKING_REQUEST_HOLD_EXTENSION_RESULT_VERSION,
    hold_extension_source: SERVICE_NAME,
    active_hold_state: normalizedInput.active_hold_state,
    hold_status: result.hold_status,
    telegram_user_summary: result.telegram_user_summary,
    booking_request_reference: result.booking_request_reference,
    hold_reference: result.hold_reference,
    requested_trip_slot_reference: result.requested_trip_slot_reference,
    requested_seats: result.requested_seats,
    original_hold_expires_at_summary: result.original_hold_expires_at_summary,
    extended_hold_expires_at_summary: result.extended_hold_expires_at_summary,
    live_seat_hold_summary: result.live_seat_hold_summary || null,
    hold_active: result.hold_active,
    extension_applied: result.extension_applied,
    dedupe_key: result.dedupe_key,
    idempotency_key: result.idempotency_key,
    extension_signature: normalizedInput.extension_signature,
    no_op_guards: buildNoOpGuards(),
    hold_extension_result: result,
  });
}

function buildResultFromEvent(event) {
  const result = event?.event_payload?.hold_extension_result;
  if (!result) {
    rejectExtension(
      `Hold extension event result is missing: ${event?.booking_request_event_id || 'unknown'}`
    );
  }

  return freezeSortedExtensionValue(result);
}

export class TelegramBookingRequestHoldExtensionService {
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
      serviceName: 'booking-request-hold-extension-service',
      status: 'hold_extension_persistence_ready',
      dependencyKeys: ['bookingRequests', 'bookingHolds', 'bookingRequestEvents'],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectExtension('extension clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectExtension(`Booking request not found: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  getBookingHoldOrThrow(bookingHoldId) {
    const bookingHold = this.bookingHolds.getById(bookingHoldId);
    if (!bookingHold) {
      rejectExtension(`Booking hold not found: ${bookingHoldId}`);
    }

    return bookingHold;
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
  }

  listExtensionEvents(bookingRequestId) {
    return this.listRequestEvents(bookingRequestId).filter(
      (event) =>
        event.event_type === HOLD_EXTENDED_EVENT_TYPE &&
        event.event_payload?.hold_extension_source === SERVICE_NAME
    );
  }

  resolveIdempotentExtensionEvent(normalizedInput) {
    const matchingEvents = this.listExtensionEvents(
      normalizedInput.booking_request_id
    ).filter(
      (event) => event.event_payload?.idempotency_key === normalizedInput.idempotency_key
    );
    if (matchingEvents.length === 0) {
      return null;
    }

    const matchingEvent = matchingEvents.find((event) =>
      compareStableValues(
        event.event_payload?.extension_signature,
        normalizedInput.extension_signature
      )
    );
    if (matchingEvent) {
      return matchingEvent;
    }

    rejectExtension(
      `Idempotency conflict for booking request hold extension: ${normalizedInput.idempotency_key}`
    );
  }

  assertPersistedActiveHoldState(normalizedInput) {
    const matchingActivationEvent = this.listRequestEvents(
      normalizedInput.booking_request_id
    ).find((event) => {
      if (
        event.event_type !== HOLD_STARTED_EVENT_TYPE ||
        event.event_payload?.hold_activation_source !==
          HOLD_ACTIVATION_SERVICE_NAME ||
        event.event_payload?.idempotency_key !==
          normalizedInput.active_hold_state.idempotency_key
      ) {
        return false;
      }

      return compareStableValues(
        normalizeActiveHoldStateValue(event.event_payload?.hold_activation_result),
        normalizedInput.active_hold_state
      );
    });
    if (!matchingActivationEvent) {
      rejectExtension(
        `Persisted active hold state not found: ${normalizedInput.booking_request_id}`
      );
    }
  }

  assertBookingRequestMatchesActiveHoldState(bookingRequest, normalizedInput) {
    const activeHoldState = normalizedInput.active_hold_state;
    if (bookingRequest.guest_profile_id !== normalizedInput.guest_profile_id) {
      rejectExtension('booking request guest does not match active hold state');
    }
    if (
      bookingRequest.seller_attribution_session_id !==
      normalizedInput.seller_attribution_session_id
    ) {
      rejectExtension(
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
      rejectExtension('booking request payload does not match active hold state');
    }
    if (bookingRequest.request_status !== 'HOLD_ACTIVE') {
      rejectExtension(
        `Unsupported booking-request state for hold extension: ${bookingRequest.request_status || 'unknown'}`
      );
    }
  }

  assertBookingHoldMatchesActiveHoldState(bookingHold, normalizedInput, nowIso) {
    const activeHoldState = normalizedInput.active_hold_state;
    if (bookingHold.booking_request_id !== normalizedInput.booking_request_id) {
      rejectExtension('hold reference does not match booking request');
    }
    if (bookingHold.hold_status === 'EXTENDED') {
      rejectExtension(
        `Hold already extended for booking request: ${normalizedInput.booking_request_id}`
      );
    }
    if (bookingHold.hold_status !== EXTENDABLE_HOLD_STATUS) {
      rejectExtension(
        `No active hold for booking request: ${normalizedInput.booking_request_id}`
      );
    }
    if (bookingHold.last_extended_at) {
      rejectExtension(
        `Hold already extended for booking request: ${normalizedInput.booking_request_id}`
      );
    }
    if (
      bookingHold.hold_expires_at !==
      activeHoldState.hold_expires_at_summary.iso
    ) {
      rejectExtension('active hold state expiry does not match persisted hold');
    }
    if (
      new Date(bookingHold.hold_expires_at).getTime() <=
      new Date(nowIso).getTime()
    ) {
      rejectExtension(
        `Active hold is expired for booking request: ${normalizedInput.booking_request_id}`
      );
    }
  }

  assertNoPriorExtension(bookingRequestId) {
    const priorExtension = this.listRequestEvents(bookingRequestId).find(
      (event) => event.event_type === HOLD_EXTENDED_EVENT_TYPE
    );
    if (priorExtension) {
      rejectExtension(`Hold already extended for booking request: ${bookingRequestId}`);
    }
  }

  extendHold(input = {}) {
    const runExtension = () => {
      const normalizedInput = normalizeExtensionInput(input);
      const idempotentEvent = this.resolveIdempotentExtensionEvent(normalizedInput);
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
      this.assertBookingHoldMatchesActiveHoldState(
        bookingHold,
        normalizedInput,
        nowIso
      );
      this.assertNoPriorExtension(normalizedInput.booking_request_id);

      const originalHoldExpiresAt = bookingHold.hold_expires_at;
      const extendedHoldExpiresAt = addMinutes(
        originalHoldExpiresAt,
        HOLD_EXTENSION_MINUTES
      );
      const updatedHold = this.bookingHolds.updateById(
        bookingHold.booking_hold_id,
        {
          hold_status: 'EXTENDED',
          hold_expires_at: extendedHoldExpiresAt,
          last_extended_at: nowIso,
        }
      );
      this.bookingRequests.updateById(bookingRequest.booking_request_id, {
        request_status: 'HOLD_ACTIVE',
        last_status_at: nowIso,
      });
      const result = buildExtensionResult({
        bookingHold: updatedHold,
        normalizedInput,
        originalHoldExpiresAt,
        extendedHoldExpiresAt,
      });

      this.bookingRequestEvents.create({
        booking_request_id: bookingRequest.booking_request_id,
        booking_hold_id: updatedHold.booking_hold_id,
        seller_attribution_session_id:
          bookingRequest.seller_attribution_session_id,
        event_type: HOLD_EXTENDED_EVENT_TYPE,
        event_at: nowIso,
        actor_type: 'telegram_guest',
        actor_id: normalizedInput.active_hold_state.telegram_user_summary.telegram_user_id,
        event_payload: buildEventPayload({ normalizedInput, result }),
      });

      return result;
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runExtension)();
    }

    return runExtension();
  }

  extend(input = {}) {
    return this.extendHold(input);
  }
}
