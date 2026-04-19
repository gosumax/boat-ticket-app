import {
  buildTelegramContactPhoneSummary,
  buildTelegramCurrentRouteTarget,
  buildTelegramLatestTimestampSummary,
  buildTelegramRequestedTripSlotReference,
  buildTelegramSellerReference,
  freezeTelegramSellerOperationValue,
  TELEGRAM_SELLER_QUEUE_STATES,
  TELEGRAM_SELLER_WORK_QUEUE_QUERY_ITEM_VERSION,
  TELEGRAM_SELLER_WORK_QUEUE_QUERY_LIST_VERSION,
} from '../../../shared/telegram/index.js';
import {
  buildBookingRequestReference,
  buildTelegramUserSummaryFromGuestProfileAndEvents,
} from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_SELLER_WORK_QUEUE_QUERY]';
const SERVICE_NAME = 'telegram_seller_work_queue_query_service';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const WAITING_FOR_SELLER_CONTACT_STATUSES = new Set([
  'NEW',
  'ATTRIBUTED',
  'CONTACT_IN_PROGRESS',
  'HOLD_ACTIVE',
  'WAITING_PREPAYMENT',
]);

const NO_LONGER_ACTIONABLE_STATUSES = new Set([
  'GUEST_CANCELLED',
  'HOLD_EXPIRED',
  'SELLER_NOT_REACHED',
  'CLOSED_UNCONVERTED',
  'CONFIRMED_TO_PRESALE',
]);

function rejectSellerQueueQuery(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectSellerQueueQuery(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeLimit(value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function normalizeQueueState(value, label = 'queue_state') {
  const normalized = String(value || '').trim();
  if (!TELEGRAM_SELLER_QUEUE_STATES.includes(normalized)) {
    rejectSellerQueueQuery(`${label} is unsupported: ${normalized || 'unknown'}`);
  }

  return normalized;
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
    rejectSellerQueueQuery('seller reference is required');
  }

  const referenceType = String(rawReference.reference_type || 'seller_user').trim();
  if (referenceType !== 'seller_user') {
    rejectSellerQueueQuery(`Unsupported seller reference type: ${referenceType}`);
  }

  return normalizePositiveInteger(
    rawReference.seller_id ?? rawReference.sellerId ?? rawReference,
    'seller_reference.seller_id'
  );
}

function normalizeBookingRequestId(input = {}) {
  const rawReference = pickBookingRequestReferenceInput(input);
  if (!rawReference) {
    rejectSellerQueueQuery('booking request reference is required');
  }

  const referenceType = String(
    rawReference.reference_type || 'telegram_booking_request'
  ).trim();
  if (referenceType !== 'telegram_booking_request') {
    rejectSellerQueueQuery(
      `Unsupported booking request reference type: ${referenceType}`
    );
  }

  return normalizePositiveInteger(
    rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
    'booking_request_reference.booking_request_id'
  );
}

function compareQueueItems(left, right) {
  const leftTime = Date.parse(left.latest_timestamp_summary?.iso || 0);
  const rightTime = Date.parse(right.latest_timestamp_summary?.iso || 0);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return (
    right.booking_request_reference.booking_request_id -
    left.booking_request_reference.booking_request_id
  );
}

export class TelegramSellerWorkQueueQueryService {
  constructor({
    guestProfiles,
    bookingRequests,
    bookingHolds,
    sellerAttributionSessions,
    now = () => new Date(),
  }) {
    this.guestProfiles = guestProfiles;
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'seller-work-queue-query-service',
      status: 'read_only_seller_work_queue_query_ready',
      dependencyKeys: [
        'guestProfiles',
        'bookingRequests',
        'bookingHolds',
        'sellerAttributionSessions',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectSellerQueueQuery('queue query clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectSellerQueueQuery(`Invalid booking request reference: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  getBookingHold(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  getSellerAttributionOrThrow(bookingRequest) {
    const attribution = this.sellerAttributionSessions.getById(
      bookingRequest.seller_attribution_session_id
    );
    if (!attribution) {
      rejectSellerQueueQuery(
        `No active seller path for booking request: ${bookingRequest.booking_request_id}`
      );
    }

    return attribution;
  }

  assertActiveSellerAttribution(attribution, bookingRequestId) {
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
      rejectSellerQueueQuery(
        `No active seller path for booking request: ${bookingRequestId}`
      );
    }
  }

  buildHoldStateSummary(bookingHold = null) {
    if (!bookingHold) {
      return freezeTelegramSellerOperationValue({
        hold_status: 'missing',
        hold_active: false,
        hold_expires_at_summary: null,
      });
    }

    const holdStatus = String(bookingHold.hold_status || '').trim();
    const holdExpiresAtSummary = buildTelegramLatestTimestampSummary(
      bookingHold.hold_expires_at
    );

    return freezeTelegramSellerOperationValue({
      hold_status: holdStatus || 'unknown',
      hold_active: ['ACTIVE', 'EXTENDED'].includes(holdStatus),
      hold_expires_at_summary: holdExpiresAtSummary,
    });
  }

  deriveQueueState(bookingRequest, bookingHold = null) {
    const requestStatus = String(bookingRequest.request_status || '').trim();
    if (bookingRequest.confirmed_presale_id) {
      return 'no_longer_actionable';
    }

    if (requestStatus === 'PREPAYMENT_CONFIRMED') {
      return 'prepayment_confirmed_waiting_handoff';
    }

    if (requestStatus === 'HOLD_ACTIVE' && bookingHold?.hold_status === 'EXTENDED') {
      return 'hold_extended_waiting';
    }

    if (WAITING_FOR_SELLER_CONTACT_STATUSES.has(requestStatus)) {
      return 'waiting_for_seller_contact';
    }

    if (NO_LONGER_ACTIONABLE_STATUSES.has(requestStatus)) {
      return 'no_longer_actionable';
    }

    rejectSellerQueueQuery(
      `Booking request is non-projectable for seller work queue: ${bookingRequest.booking_request_id}`
    );
    return null;
  }

  buildQueueItem(bookingRequest) {
    const attribution = this.getSellerAttributionOrThrow(bookingRequest);
    this.assertActiveSellerAttribution(
      attribution,
      bookingRequest.booking_request_id
    );
    const guestProfile = this.guestProfiles.getById(bookingRequest.guest_profile_id);
    if (!guestProfile) {
      rejectSellerQueueQuery(
        `Guest profile is missing for booking request: ${bookingRequest.booking_request_id}`
      );
    }
    const bookingHold = this.getBookingHold(bookingRequest.booking_request_id);
    const queueState = this.deriveQueueState(bookingRequest, bookingHold);
    const sellerReference = buildTelegramSellerReference({
      sellerId: attribution.seller_id,
      sellerAttributionSessionId: attribution.seller_attribution_session_id,
    });

    return freezeTelegramSellerOperationValue({
      response_version: TELEGRAM_SELLER_WORK_QUEUE_QUERY_ITEM_VERSION,
      projection_item_type: 'telegram_seller_work_queue_item',
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      queue_state: queueState,
      booking_request_reference: buildBookingRequestReference(bookingRequest),
      telegram_user_summary: buildTelegramUserSummaryFromGuestProfileAndEvents({
        guestProfile,
        events: [],
      }),
      seller_reference: sellerReference,
      current_route_target: buildTelegramCurrentRouteTarget({
        sellerReference,
      }),
      requested_trip_slot_reference:
        buildTelegramRequestedTripSlotReference(bookingRequest),
      requested_seats_count: Number(bookingRequest.requested_seats || 0),
      requested_prepayment_amount: Number(
        bookingHold?.requested_amount ?? bookingRequest.requested_prepayment_amount ?? 0
      ),
      contact_phone_summary: buildTelegramContactPhoneSummary(
        bookingRequest.contact_phone_e164
      ),
      lifecycle_state: bookingRequest.request_status,
      hold_state_summary: this.buildHoldStateSummary(bookingHold),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        bookingRequest.last_status_at,
        bookingRequest.created_at,
        bookingHold?.last_extended_at,
        bookingHold?.started_at
      ),
      confirmed_presale_reference: bookingRequest.confirmed_presale_id
        ? freezeTelegramSellerOperationValue({
            reference_type: 'canonical_presale',
            presale_id: Number(bookingRequest.confirmed_presale_id),
          })
        : null,
    });
  }

  listBookingRequestIdsForSeller(sellerId, { limit = DEFAULT_LIMIT } = {}) {
    this.bookingRequests.assertReady();
    this.sellerAttributionSessions.assertReady();

    const normalizedLimit = normalizeLimit(limit);
    return this.db
      .prepare(
        `
          SELECT br.booking_request_id
          FROM telegram_booking_requests br
          INNER JOIN telegram_seller_attribution_sessions sas
            ON sas.seller_attribution_session_id = br.seller_attribution_session_id
          WHERE sas.seller_id = ?
            AND sas.attribution_status = 'ACTIVE'
            AND datetime(sas.expires_at) > datetime(?)
          ORDER BY datetime(COALESCE(br.last_status_at, br.created_at)) DESC, br.booking_request_id DESC
          LIMIT ?
        `
      )
      .all(sellerId, this.nowIso(), normalizedLimit)
      .map((row) => row.booking_request_id);
  }

  listCurrentSellerWorkQueueItemsBySellerReference(input = {}) {
    const sellerId = normalizeSellerId(input);
    const queueStateFilter =
      input.queue_state !== undefined && input.queue_state !== null
        ? normalizeQueueState(input.queue_state)
        : null;

    const items = this.listBookingRequestIdsForSeller(sellerId, {
      limit: input.limit,
    })
      .map((bookingRequestId) =>
        this.buildQueueItem(this.getBookingRequestOrThrow(bookingRequestId))
      )
      .filter((item) => (queueStateFilter ? item.queue_state === queueStateFilter : true))
      .sort(compareQueueItems);

    return freezeTelegramSellerOperationValue({
      response_version: TELEGRAM_SELLER_WORK_QUEUE_QUERY_LIST_VERSION,
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      list_scope: 'seller_work_queue_by_seller',
      seller_reference: buildTelegramSellerReference({ sellerId }),
      queue_state_filter: queueStateFilter,
      item_count: items.length,
      items,
    });
  }

  readSellerWorkQueueItemByBookingRequestReference(input = {}) {
    const bookingRequestId = normalizeBookingRequestId(input);
    const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
    return this.buildQueueItem(bookingRequest);
  }

  listSellerWorkQueueItemsByActiveHandlingState(input = {}) {
    const queueState = normalizeQueueState(
      input.queue_state ?? input.active_handling_state,
      'active_handling_state'
    );

    return this.listCurrentSellerWorkQueueItemsBySellerReference({
      ...input,
      queue_state: queueState,
    });
  }

  listBySellerReference(input = {}) {
    return this.listCurrentSellerWorkQueueItemsBySellerReference(input);
  }

  readByBookingRequestReference(input = {}) {
    return this.readSellerWorkQueueItemByBookingRequestReference(input);
  }

  listByActiveHandlingState(input = {}) {
    return this.listSellerWorkQueueItemsByActiveHandlingState(input);
  }
}
