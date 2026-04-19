import {
  buildBookingRequestReference,
  buildHoldReference,
  buildReadOnlyNoOpGuards,
  buildRequestedTripSlotReference,
  buildTelegramUserSummaryFromGuestProfileAndEvents,
  compareProjectionItemsByLatestLifecycleDesc,
  deriveLifecycleState,
  extractRequestedPrepaymentAmount,
  freezeSortedLifecycleValue,
  normalizeBookingRequestReference,
  normalizePositiveInteger,
  normalizeString,
  normalizeTimestampSummary,
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_LIST_VERSION,
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION_ITEM_TYPE,
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION_VERSION,
} from './booking-request-lifecycle-shared.js';

export {
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_LIST_VERSION,
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION_ITEM_TYPE,
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION_VERSION,
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_STATES,
} from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION]';
const SERVICE_NAME = 'telegram_booking_request_lifecycle_projection_service';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_SCAN_LIMIT = 1000;
const MAX_SCAN_LIMIT = 5000;

function rejectLifecycleProjection(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeLimit(value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function pickBookingRequestReference(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return {
      reference_type: 'telegram_booking_request',
      booking_request_id: Number(input),
      guest_profile_id: null,
      seller_attribution_session_id: null,
    };
  }

  return (
    input.booking_request_reference ??
    input.bookingRequestReference ??
    input.reference ??
    input.booking_request ??
    input.bookingRequest ??
    input ??
    null
  );
}

function pickTelegramUserId(input = {}) {
  return normalizeString(
    input.telegram_user_id ??
      input.telegramUserId ??
      input.telegram_user_summary?.telegram_user_id ??
      input.telegramUserSummary?.telegram_user_id ??
      input.telegramUserSummary?.telegramUserId
  );
}

function resolveGuestProfileIdInput(input = {}) {
  const directValue =
    input.guest_profile_id ??
    input.guestProfileId ??
    input.telegram_user_summary?.guest_profile_id ??
    input.telegramUserSummary?.guest_profile_id;

  if (directValue === null || directValue === undefined || directValue === '') {
    return null;
  }

  return normalizePositiveInteger(directValue, 'guest_profile_id', rejectLifecycleProjection);
}

function buildListResult({ guestSummary, items }) {
  return freezeSortedLifecycleValue({
    response_version: TELEGRAM_BOOKING_REQUEST_LIFECYCLE_LIST_VERSION,
    read_only: true,
    projection_only: true,
    projected_by: SERVICE_NAME,
    telegram_user_summary: guestSummary,
    list_order: 'latest_lifecycle_timestamp_desc_booking_request_id_desc',
    item_count: items.length,
    items,
    no_op_guards: buildReadOnlyNoOpGuards(),
  });
}

export class TelegramBookingRequestLifecycleProjectionService {
  constructor({
    guestProfiles,
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
  }) {
    this.guestProfiles = guestProfiles;
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
  }

  describe() {
    return Object.freeze({
      serviceName: 'booking-request-lifecycle-projection-service',
      status: 'read_only_lifecycle_projection_ready',
      dependencyKeys: [
        'guestProfiles',
        'bookingRequests',
        'bookingHolds',
        'bookingRequestEvents',
      ],
    });
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectLifecycleProjection(`Booking request not found: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  getGuestProfileOrThrow(guestProfileId) {
    const guestProfile = this.guestProfiles.getById(guestProfileId);
    if (!guestProfile) {
      rejectLifecycleProjection(`Guest profile not found: ${guestProfileId}`);
    }

    return guestProfile;
  }

  findGuestProfileByTelegramUserId(telegramUserId) {
    const guestProfile = this.guestProfiles.findOneBy(
      { telegram_user_id: telegramUserId },
      { orderBy: 'guest_profile_id ASC' }
    );
    if (!guestProfile) {
      rejectLifecycleProjection(
        `Guest profile not found for telegram_user_id: ${telegramUserId}`
      );
    }

    return guestProfile;
  }

  resolveGuestProfile(input = {}) {
    const guestProfileId = resolveGuestProfileIdInput(input);
    const telegramUserId = pickTelegramUserId(input);

    let guestProfile = null;
    if (guestProfileId) {
      guestProfile = this.getGuestProfileOrThrow(guestProfileId);
    }

    if (telegramUserId) {
      const byTelegramUserId = this.findGuestProfileByTelegramUserId(telegramUserId);
      if (
        guestProfile &&
        guestProfile.guest_profile_id !== byTelegramUserId.guest_profile_id
      ) {
        rejectLifecycleProjection(
          'Guest identity inputs resolve to different profiles'
        );
      }

      guestProfile = byTelegramUserId;
    }

    if (!guestProfile) {
      rejectLifecycleProjection('Telegram guest identity is required');
    }

    return guestProfile;
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  assertBookingRequestReferenceMatches(bookingRequest, bookingRequestReference) {
    if (
      bookingRequestReference.guest_profile_id !== null &&
      bookingRequestReference.guest_profile_id !== bookingRequest.guest_profile_id
    ) {
      rejectLifecycleProjection(
        `Booking request reference does not match persisted request: ${bookingRequest.booking_request_id}`
      );
    }
    if (
      bookingRequestReference.seller_attribution_session_id !== null &&
      bookingRequestReference.seller_attribution_session_id !==
        bookingRequest.seller_attribution_session_id
    ) {
      rejectLifecycleProjection(
        `Booking request reference does not match persisted request: ${bookingRequest.booking_request_id}`
      );
    }
  }

  normalizeBookingRequestReferenceInput(input = {}) {
    const rawReference = pickBookingRequestReference(input);
    if (!rawReference) {
      rejectLifecycleProjection('booking request reference is required');
    }
    if (
      rawReference.reference_type &&
      rawReference.reference_type !== 'telegram_booking_request'
    ) {
      rejectLifecycleProjection(
        `Unsupported booking-request reference type: ${rawReference.reference_type || 'unknown'}`
      );
    }

    if (
      rawReference.reference_type === 'telegram_booking_request' &&
      rawReference.guest_profile_id &&
      rawReference.seller_attribution_session_id
    ) {
      return normalizeBookingRequestReference(
        rawReference,
        rejectLifecycleProjection
      );
    }

    const bookingRequestId = normalizePositiveInteger(
      rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
      'booking_request_reference.booking_request_id',
      rejectLifecycleProjection
    );

    return freezeSortedLifecycleValue({
      reference_type: 'telegram_booking_request',
      booking_request_id: bookingRequestId,
      guest_profile_id:
        rawReference.guest_profile_id === null ||
        rawReference.guest_profile_id === undefined
          ? null
          : normalizePositiveInteger(
              rawReference.guest_profile_id,
              'booking_request_reference.guest_profile_id',
              rejectLifecycleProjection
            ),
      seller_attribution_session_id:
        rawReference.seller_attribution_session_id === null ||
        rawReference.seller_attribution_session_id === undefined
          ? null
          : normalizePositiveInteger(
              rawReference.seller_attribution_session_id,
              'booking_request_reference.seller_attribution_session_id',
              rejectLifecycleProjection
            ),
    });
  }

  buildProjectionItem(bookingRequest) {
    const bookingHold = this.getHoldForRequest(bookingRequest.booking_request_id);
    const events = this.listRequestEvents(bookingRequest.booking_request_id);
    const guestProfile = this.getGuestProfileOrThrow(bookingRequest.guest_profile_id);
    const lifecycleState = deriveLifecycleState({
      bookingRequest,
      bookingHold,
      events,
      reject: rejectLifecycleProjection,
    });

    return freezeSortedLifecycleValue({
      response_version: TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION_VERSION,
      projection_item_type: TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION_ITEM_TYPE,
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      booking_request_status: bookingRequest.request_status,
      telegram_user_summary: buildTelegramUserSummaryFromGuestProfileAndEvents({
        guestProfile,
        events,
      }),
      booking_request_reference: buildBookingRequestReference(bookingRequest),
      hold_reference: buildHoldReference(bookingHold),
      requested_trip_slot_reference: buildRequestedTripSlotReference({
        bookingRequest,
        events,
      }),
      requested_seats: Number(bookingRequest.requested_seats),
      requested_prepayment_amount: extractRequestedPrepaymentAmount({
        bookingHold,
        events,
      }),
      lifecycle_state: lifecycleState.lifecycle_state,
      hold_active: lifecycleState.hold_active,
      request_active: lifecycleState.request_active,
      request_confirmed: lifecycleState.request_confirmed,
      cancelled: lifecycleState.cancelled,
      expired: lifecycleState.expired,
      latest_lifecycle_timestamp_summary: normalizeTimestampSummary(
        lifecycleState.latest_lifecycle_event.event_at
      ),
      no_op_guards: buildReadOnlyNoOpGuards(),
    });
  }

  readCurrentLifecycleStateByBookingRequestReference(input = {}) {
    const bookingRequestReference =
      this.normalizeBookingRequestReferenceInput(input);
    const bookingRequest = this.getBookingRequestOrThrow(
      bookingRequestReference.booking_request_id
    );
    this.assertBookingRequestReferenceMatches(
      bookingRequest,
      bookingRequestReference
    );

    return this.buildProjectionItem(bookingRequest);
  }

  listBookingRequestsForGuest(input = {}) {
    const guestProfile = this.resolveGuestProfile(input);
    const limit = normalizeLimit(
      input.limit ?? input.scanLimit ?? input.scan_limit,
      DEFAULT_SCAN_LIMIT,
      MAX_SCAN_LIMIT
    );
    const rows = this.bookingRequests.listBy(
      { guest_profile_id: guestProfile.guest_profile_id },
      {
        orderBy: 'created_at ASC, booking_request_id ASC',
        limit,
      }
    );
    const items = rows
      .map((bookingRequest) => this.buildProjectionItem(bookingRequest))
      .sort(compareProjectionItemsByLatestLifecycleDesc)
      .slice(0, normalizeLimit(input.limit, DEFAULT_LIMIT, MAX_LIMIT));

    return buildListResult({
      guestSummary: buildTelegramUserSummaryFromGuestProfileAndEvents({
        guestProfile,
        events: [],
      }),
      items,
    });
  }

  readLatestActiveOrFinalLifecycleStateForGuest(input = {}) {
    const listResult = this.listBookingRequestsForGuest(input);
    const latestActive = listResult.items.find((item) => item.request_active);
    if (latestActive) {
      return latestActive;
    }

    return listResult.items[0] || null;
  }

  readCurrentLifecycleState(input = {}) {
    return this.readCurrentLifecycleStateByBookingRequestReference(input);
  }

  listBookingRequests(input = {}) {
    return this.listBookingRequestsForGuest(input);
  }

  readLatestLifecycleStateForGuest(input = {}) {
    return this.readLatestActiveOrFinalLifecycleStateForGuest(input);
  }
}
