import { freezeTelegramHandoffValue } from '../../../shared/telegram/index.js';

export const TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION_VERSION =
  'telegram_booking_request_lifecycle_projection.v1';
export const TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION_ITEM_TYPE =
  'telegram_booking_request_lifecycle_projection_item';
export const TELEGRAM_BOOKING_REQUEST_LIFECYCLE_LIST_VERSION =
  'telegram_booking_request_lifecycle_projection_list.v1';

export const TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_EVENT_TYPE =
  'GUEST_CANCELLED_BEFORE_PREPAYMENT';
export const TELEGRAM_BOOKING_REQUEST_REQUEST_CREATED_EVENT_TYPE = 'REQUEST_CREATED';
export const TELEGRAM_BOOKING_REQUEST_HOLD_STARTED_EVENT_TYPE = 'HOLD_STARTED';
export const TELEGRAM_BOOKING_REQUEST_HOLD_EXTENDED_EVENT_TYPE = 'HOLD_EXTENDED';
export const TELEGRAM_BOOKING_REQUEST_HOLD_EXPIRED_EVENT_TYPE = 'HOLD_EXPIRED';
export const TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMED_EVENT_TYPE =
  'PREPAYMENT_CONFIRMED';

export const TELEGRAM_BOOKING_REQUEST_LIFECYCLE_STATES = Object.freeze([
  'new',
  'hold_active',
  'hold_extended',
  'hold_expired',
  'cancelled_before_prepayment',
  'prepayment_confirmed',
]);

const REQUEST_CREATED_EVENT_TYPES = Object.freeze([
  TELEGRAM_BOOKING_REQUEST_REQUEST_CREATED_EVENT_TYPE,
]);
const HOLD_ACTIVE_EVENT_TYPES = Object.freeze([
  TELEGRAM_BOOKING_REQUEST_HOLD_STARTED_EVENT_TYPE,
]);
const HOLD_EXTENDED_EVENT_TYPES = Object.freeze([
  TELEGRAM_BOOKING_REQUEST_HOLD_EXTENDED_EVENT_TYPE,
]);
const HOLD_EXPIRED_EVENT_TYPES = Object.freeze([
  TELEGRAM_BOOKING_REQUEST_HOLD_EXPIRED_EVENT_TYPE,
]);
const CANCELLED_EVENT_TYPES = Object.freeze([
  TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_EVENT_TYPE,
  'GUEST_CANCELLED',
]);
const PREPAYMENT_CONFIRMED_EVENT_TYPES = Object.freeze([
  TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMED_EVENT_TYPE,
]);

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function normalizePositiveInteger(value, label, reject) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    reject(`${label} must be a positive integer`);
  }

  return normalized;
}

export function normalizeNonNegativeInteger(value, label, reject) {
  const normalized = Number(value ?? 0);
  if (!Number.isInteger(normalized) || normalized < 0) {
    reject(`${label} must be a non-negative integer`);
  }

  return normalized;
}

export function sortLifecycleValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortLifecycleValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortLifecycleValue(value[key])])
  );
}

export function freezeSortedLifecycleValue(value) {
  return freezeTelegramHandoffValue(sortLifecycleValue(value));
}

export function compareStableLifecycleValues(left, right) {
  return (
    JSON.stringify(sortLifecycleValue(left)) ===
    JSON.stringify(sortLifecycleValue(right))
  );
}

export function normalizeTimestampSummary(iso) {
  return freezeSortedLifecycleValue({
    iso,
    unix_seconds: Math.floor(Date.parse(iso) / 1000),
  });
}

function normalizeEventTimestampCandidate(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function buildSyntheticLifecycleEvent({
  bookingRequest,
  bookingHold = null,
  eventType,
  fallbackReason,
}) {
  const eventAt =
    normalizeEventTimestampCandidate(bookingRequest?.last_status_at) ||
    normalizeEventTimestampCandidate(bookingHold?.hold_expires_at) ||
    normalizeEventTimestampCandidate(bookingHold?.started_at) ||
    normalizeEventTimestampCandidate(bookingRequest?.created_at);
  if (!eventAt) {
    return null;
  }

  return freezeSortedLifecycleValue({
    booking_request_event_id: null,
    booking_request_id: bookingRequest.booking_request_id,
    booking_hold_id: bookingHold?.booking_hold_id || null,
    seller_attribution_session_id: bookingRequest.seller_attribution_session_id,
    event_type: eventType,
    event_at: eventAt,
    actor_type: 'system',
    actor_id: 'telegram-lifecycle-projection-fallback',
    event_payload: freezeSortedLifecycleValue({
      projection_fallback: true,
      projection_fallback_reason: fallbackReason,
      request_status: normalizeString(bookingRequest?.request_status),
      hold_status: normalizeString(bookingHold?.hold_status),
    }),
  });
}

export function findLatestEvent(events = [], eventTypes = []) {
  const eventTypeSet = new Set(eventTypes);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (eventTypeSet.has(events[index]?.event_type)) {
      return events[index];
    }
  }

  return null;
}

export function buildBookingRequestReference(bookingRequest) {
  return freezeSortedLifecycleValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: bookingRequest.booking_request_id,
    guest_profile_id: bookingRequest.guest_profile_id,
    seller_attribution_session_id:
      bookingRequest.seller_attribution_session_id,
  });
}

export function buildHoldReference(bookingHold) {
  if (!bookingHold) {
    return null;
  }

  return freezeSortedLifecycleValue({
    reference_type: 'telegram_booking_hold',
    booking_hold_id: bookingHold.booking_hold_id,
    booking_request_id: bookingHold.booking_request_id,
  });
}

function normalizeRawTripSlotReference(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const requestedTripDate = normalizeString(
    value.requested_trip_date ?? value.requestedTripDate ?? value.trip_date ?? value.tripDate
  );
  const requestedTimeSlot = normalizeString(
    value.requested_time_slot ?? value.requestedTimeSlot ?? value.time_slot ?? value.timeSlot
  );
  if (!requestedTripDate || !requestedTimeSlot) {
    return null;
  }

  return freezeSortedLifecycleValue({
    reference_type: 'telegram_requested_trip_slot_reference',
    requested_trip_date: requestedTripDate,
    requested_time_slot: requestedTimeSlot,
    slot_uid: normalizeString(value.slot_uid ?? value.slotUid),
    boat_slot_id:
      value.boat_slot_id === null || value.boat_slot_id === undefined
        ? null
        : Number.isInteger(Number(value.boat_slot_id))
          ? Number(value.boat_slot_id)
          : null,
  });
}

function collectProjectionPayloadCandidates(eventPayload = {}) {
  return [
    eventPayload?.requested_trip_slot_reference,
    eventPayload?.creation_result?.requested_trip_slot_reference,
    eventPayload?.booking_request_creation_result?.requested_trip_slot_reference,
    eventPayload?.hold_activation_result?.requested_trip_slot_reference,
    eventPayload?.hold_extension_result?.requested_trip_slot_reference,
    eventPayload?.hold_expiry_result?.requested_trip_slot_reference,
    eventPayload?.guest_cancel_before_prepayment_result?.requested_trip_slot_reference,
    eventPayload?.prepayment_confirmation_result?.requested_trip_slot_reference,
  ];
}

export function buildRequestedTripSlotReference({ bookingRequest, events = [] }) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidates = collectProjectionPayloadCandidates(events[index]?.event_payload);
    for (const candidate of candidates) {
      const normalized = normalizeRawTripSlotReference(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  return freezeSortedLifecycleValue({
    reference_type: 'telegram_requested_trip_slot_reference',
    requested_trip_date: bookingRequest.requested_trip_date,
    requested_time_slot: bookingRequest.requested_time_slot,
    slot_uid: null,
    boat_slot_id: null,
  });
}

function extractRequestedPrepaymentAmountFromPayload(eventPayload = {}) {
  const candidates = [
    eventPayload?.requested_prepayment_amount,
    eventPayload?.creation_result?.requested_prepayment_amount,
    eventPayload?.booking_request_creation_result?.requested_prepayment_amount,
    eventPayload?.hold_activation_result?.requested_prepayment_amount,
    eventPayload?.hold_extension_result?.requested_prepayment_amount,
    eventPayload?.hold_expiry_result?.requested_prepayment_amount,
    eventPayload?.guest_cancel_before_prepayment_result?.requested_prepayment_amount,
    eventPayload?.prepayment_confirmation_result?.requested_prepayment_amount,
  ];

  for (const candidate of candidates) {
    const normalized = Number(candidate);
    if (Number.isInteger(normalized) && normalized >= 0) {
      return normalized;
    }
  }

  return null;
}

export function extractRequestedPrepaymentAmount({
  bookingHold = null,
  events = [],
}) {
  if (bookingHold) {
    const normalized = Number(bookingHold.requested_amount);
    if (Number.isInteger(normalized) && normalized >= 0) {
      return normalized;
    }
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const normalized = extractRequestedPrepaymentAmountFromPayload(
      events[index]?.event_payload
    );
    if (normalized !== null) {
      return normalized;
    }
  }

  return 0;
}

function extractTelegramUserSummaryCandidate(eventPayload = {}) {
  const candidates = [
    eventPayload?.telegram_user_summary,
    eventPayload?.creation_result?.telegram_user_summary,
    eventPayload?.booking_request_creation_result?.telegram_user_summary,
    eventPayload?.hold_activation_result?.telegram_user_summary,
    eventPayload?.hold_extension_result?.telegram_user_summary,
    eventPayload?.hold_expiry_result?.telegram_user_summary,
    eventPayload?.guest_cancel_before_prepayment_result?.telegram_user_summary,
    eventPayload?.prepayment_confirmation_result?.telegram_user_summary,
  ];

  return (
    candidates.find(
      (candidate) => normalizeString(candidate?.telegram_user_id)
    ) || null
  );
}

export function buildTelegramUserSummaryFromGuestProfileAndEvents({
  guestProfile,
  events = [],
}) {
  let fallbackCandidate = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    fallbackCandidate = extractTelegramUserSummaryCandidate(
      events[index]?.event_payload
    );
    if (fallbackCandidate) {
      break;
    }
  }

  const telegramUserId =
    normalizeString(fallbackCandidate?.telegram_user_id) ||
    normalizeString(guestProfile.telegram_user_id);

  return freezeSortedLifecycleValue({
    telegram_user_id: telegramUserId,
    is_bot: Boolean(fallbackCandidate?.is_bot),
    first_name: normalizeString(fallbackCandidate?.first_name),
    last_name: normalizeString(fallbackCandidate?.last_name),
    username:
      normalizeString(fallbackCandidate?.username) ||
      normalizeString(guestProfile.username),
    language_code:
      normalizeString(fallbackCandidate?.language_code) ||
      normalizeString(guestProfile.language_code),
    display_name:
      normalizeString(fallbackCandidate?.display_name) ||
      normalizeString(guestProfile.display_name) ||
      telegramUserId,
  });
}

export function normalizeTelegramUserSummary(value, reject) {
  if (!isPlainObject(value)) {
    reject('telegram user summary is required');
  }

  const telegramUserId = normalizeString(
    value.telegram_user_id ?? value.telegramUserId ?? value.id
  );
  if (!telegramUserId) {
    reject('telegram_user_id is required');
  }

  return freezeSortedLifecycleValue({
    telegram_user_id: telegramUserId,
    is_bot: Boolean(value.is_bot ?? value.isBot),
    first_name: normalizeString(value.first_name ?? value.firstName),
    last_name: normalizeString(value.last_name ?? value.lastName),
    username: normalizeString(value.username),
    language_code: normalizeString(value.language_code ?? value.languageCode),
    display_name: normalizeString(value.display_name ?? value.displayName) || telegramUserId,
  });
}

export function normalizeBookingRequestReference(value, reject) {
  if (!isPlainObject(value)) {
    reject('booking request reference is required');
  }
  if (value.reference_type !== 'telegram_booking_request') {
    reject(
      `Unsupported booking-request reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedLifecycleValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: normalizePositiveInteger(
      value.booking_request_id,
      'booking_request_reference.booking_request_id',
      reject
    ),
    guest_profile_id: normalizePositiveInteger(
      value.guest_profile_id,
      'booking_request_reference.guest_profile_id',
      reject
    ),
    seller_attribution_session_id: normalizePositiveInteger(
      value.seller_attribution_session_id,
      'booking_request_reference.seller_attribution_session_id',
      reject
    ),
  });
}

export function buildReadOnlyNoOpGuards() {
  return freezeSortedLifecycleValue({
    booking_request_created: false,
    booking_hold_created: false,
    hold_extension_created: false,
    hold_expiry_created: false,
    guest_cancelled_before_prepayment: false,
    prepayment_confirmed: false,
    presale_created: false,
    production_webhook_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  });
}

export function compareProjectionItemsByLatestLifecycleDesc(left, right) {
  const leftTime = Date.parse(left.latest_lifecycle_timestamp_summary.iso);
  const rightTime = Date.parse(right.latest_lifecycle_timestamp_summary.iso);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return (
    right.booking_request_reference.booking_request_id -
    left.booking_request_reference.booking_request_id
  );
}

export function deriveLifecycleState({
  bookingRequest,
  bookingHold,
  events,
  reject,
}) {
  const bookingRequestId = bookingRequest.booking_request_id;
  const requestStatus = normalizeString(bookingRequest.request_status);

  if (bookingRequest.confirmed_presale_id) {
    reject(
      `Booking request is not projectable inside Telegram lifecycle boundary: ${bookingRequestId}`
    );
  }

  switch (requestStatus) {
    case 'NEW': {
      if (bookingHold) {
        reject(
          `Booking request is not projectable inside Telegram lifecycle boundary: ${bookingRequestId}`
        );
      }
      const createdEvent = findLatestEvent(events, REQUEST_CREATED_EVENT_TYPES);
      if (!createdEvent) {
        reject(
          `Booking request lifecycle event is missing for projection: ${bookingRequestId}`
        );
      }

      return freezeSortedLifecycleValue({
        lifecycle_state: 'new',
        hold_active: false,
        request_active: true,
        request_confirmed: false,
        cancelled: false,
        expired: false,
        latest_lifecycle_event: createdEvent,
      });
    }
    case 'HOLD_ACTIVE': {
      if (!bookingHold) {
        reject(
          `Booking request lifecycle hold is missing for projection: ${bookingRequestId}`
        );
      }
      if (bookingHold.hold_status === 'ACTIVE') {
        const holdStartedEvent = findLatestEvent(events, HOLD_ACTIVE_EVENT_TYPES);
        if (!holdStartedEvent) {
          reject(
            `Booking request lifecycle event is missing for projection: ${bookingRequestId}`
          );
        }

        return freezeSortedLifecycleValue({
          lifecycle_state: 'hold_active',
          hold_active: true,
          request_active: true,
          request_confirmed: false,
          cancelled: false,
          expired: false,
          latest_lifecycle_event: holdStartedEvent,
        });
      }
      if (bookingHold.hold_status === 'EXTENDED') {
        const holdExtendedEvent = findLatestEvent(events, HOLD_EXTENDED_EVENT_TYPES);
        if (!holdExtendedEvent) {
          reject(
            `Booking request lifecycle event is missing for projection: ${bookingRequestId}`
          );
        }

        return freezeSortedLifecycleValue({
          lifecycle_state: 'hold_extended',
          hold_active: true,
          request_active: true,
          request_confirmed: false,
          cancelled: false,
          expired: false,
          latest_lifecycle_event: holdExtendedEvent,
        });
      }

      reject(
        `Booking request is not projectable inside Telegram lifecycle boundary: ${bookingRequestId}`
      );
      break;
    }
    case 'HOLD_EXPIRED': {
      if (!bookingHold || bookingHold.hold_status !== 'EXPIRED') {
        reject(
          `Booking request is not projectable inside Telegram lifecycle boundary: ${bookingRequestId}`
        );
      }

      const holdExpiredEvent =
        findLatestEvent(events, HOLD_EXPIRED_EVENT_TYPES) ||
        buildSyntheticLifecycleEvent({
          bookingRequest,
          bookingHold,
          eventType: TELEGRAM_BOOKING_REQUEST_HOLD_EXPIRED_EVENT_TYPE,
          fallbackReason: 'missing_hold_expired_event',
        });
      if (!holdExpiredEvent) {
        reject(
          `Booking request lifecycle event is missing for projection: ${bookingRequestId}`
        );
      }

      return freezeSortedLifecycleValue({
        lifecycle_state: 'hold_expired',
        hold_active: false,
        request_active: false,
        request_confirmed: false,
        cancelled: false,
        expired: true,
        latest_lifecycle_event: holdExpiredEvent,
      });
    }
    case 'GUEST_CANCELLED': {
      if (bookingHold && bookingHold.hold_status !== 'CANCELLED') {
        reject(
          `Booking request is not projectable inside Telegram lifecycle boundary: ${bookingRequestId}`
        );
      }

      const cancelledEvent = findLatestEvent(events, CANCELLED_EVENT_TYPES);
      if (!cancelledEvent) {
        reject(
          `Booking request lifecycle event is missing for projection: ${bookingRequestId}`
        );
      }

      return freezeSortedLifecycleValue({
        lifecycle_state: 'cancelled_before_prepayment',
        hold_active: false,
        request_active: false,
        request_confirmed: false,
        cancelled: true,
        expired: false,
        latest_lifecycle_event: cancelledEvent,
      });
    }
    case 'PREPAYMENT_CONFIRMED': {
      if (bookingHold && bookingHold.hold_status !== 'CONVERTED') {
        reject(
          `Booking request is not projectable inside Telegram lifecycle boundary: ${bookingRequestId}`
        );
      }

      const confirmedEvent = findLatestEvent(
        events,
        PREPAYMENT_CONFIRMED_EVENT_TYPES
      );
      if (!confirmedEvent) {
        reject(
          `Booking request lifecycle event is missing for projection: ${bookingRequestId}`
        );
      }

      return freezeSortedLifecycleValue({
        lifecycle_state: 'prepayment_confirmed',
        hold_active: false,
        request_active: false,
        request_confirmed: true,
        cancelled: false,
        expired: false,
        latest_lifecycle_event: confirmedEvent,
      });
    }
    default:
      reject(
        `Booking request is not projectable inside Telegram lifecycle boundary: ${bookingRequestId}`
      );
  }
}
