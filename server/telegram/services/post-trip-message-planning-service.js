import {
  buildTelegramHandoffTimestampSummary,
  buildTelegramLatestTimestampSummary,
  freezeTelegramPostTripPlanningValue,
  TELEGRAM_POST_TRIP_MESSAGE_PLAN_ITEM_VERSION,
  TELEGRAM_POST_TRIP_MESSAGE_PLAN_LIST_VERSION,
  TELEGRAM_POST_TRIP_MESSAGE_TYPES,
  TELEGRAM_POST_TRIP_PLANNING_STATES,
  TELEGRAM_POST_TRIP_TRIGGER_OFFSETS_MINUTES,
} from '../../../shared/telegram/index.js';
import {
  buildTelegramUserSummaryFromGuestProfileAndEvents,
} from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_POST_TRIP_PLAN]';
const SERVICE_NAME = 'telegram_post_trip_message_planning_service';

function rejectPostTripPlanning(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectPostTripPlanning(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeLimit(value, fallback = 200, max = 500) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function pickBookingRequestReference(input = {}) {
  if (
    (typeof input === 'number' || typeof input === 'string') &&
    String(input).trim() !== ''
  ) {
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

function pickTelegramUserReference(input = {}) {
  if (typeof input === 'string') {
    return { telegram_user_id: input };
  }

  return (
    input.telegram_user_reference ??
    input.telegramUserReference ??
    input.telegram_user ??
    input.telegramUser ??
    input.reference ??
    input ??
    null
  );
}

function normalizeBookingRequestId(input = {}) {
  const rawReference = pickBookingRequestReference(input);
  if (!rawReference) {
    rejectPostTripPlanning('booking request reference is required');
  }

  const referenceType = normalizeString(
    rawReference.reference_type || 'telegram_booking_request'
  );
  if (referenceType !== 'telegram_booking_request') {
    rejectPostTripPlanning(
      `Unsupported booking request reference type: ${referenceType || 'unknown'}`
    );
  }

  return normalizePositiveInteger(
    rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
    'booking_request_reference.booking_request_id'
  );
}

function normalizeTelegramUserId(input = {}) {
  const rawReference = pickTelegramUserReference(input);
  if (!rawReference || typeof rawReference !== 'object' || Array.isArray(rawReference)) {
    rejectPostTripPlanning('telegram_user_reference is required');
  }

  const referenceType = normalizeString(rawReference.reference_type || 'telegram_user');
  if (referenceType !== 'telegram_user') {
    rejectPostTripPlanning(
      `Unsupported telegram-user reference type: ${referenceType || 'unknown'}`
    );
  }

  const telegramUserId = normalizeString(
    rawReference.telegram_user_id ?? rawReference.telegramUserId
  );
  if (!telegramUserId) {
    rejectPostTripPlanning('telegram_user_reference.telegram_user_id is required');
  }

  return telegramUserId;
}

function normalizePostTripPlanningState(value) {
  if (!TELEGRAM_POST_TRIP_PLANNING_STATES.includes(value)) {
    rejectPostTripPlanning(
      `Unsupported post-trip planning status: ${String(value || 'unknown')}`
    );
  }

  return value;
}

function normalizePostTripMessageTypes(input = {}) {
  const rawMessageType =
    input.post_trip_message_type ??
    input.postTripMessageType ??
    input.message_type ??
    input.messageType ??
    input.type ??
    input.types ??
    null;

  if (rawMessageType === null || rawMessageType === undefined || rawMessageType === '') {
    return TELEGRAM_POST_TRIP_MESSAGE_TYPES;
  }

  const rawValues = Array.isArray(rawMessageType) ? rawMessageType : [rawMessageType];
  const normalizedValues = [
    ...new Set(rawValues.map((value) => normalizeString(value)).filter(Boolean)),
  ];
  if (normalizedValues.length === 0) {
    return TELEGRAM_POST_TRIP_MESSAGE_TYPES;
  }

  for (const messageType of normalizedValues) {
    if (!TELEGRAM_POST_TRIP_MESSAGE_TYPES.includes(messageType)) {
      rejectPostTripPlanning(`Unsupported post-trip message type: ${messageType}`);
    }
  }

  return Object.freeze(normalizedValues);
}

function parseTripStartIso(ticketView) {
  const tripDate = normalizeString(ticketView?.date_time_summary?.requested_trip_date);
  const tripTime = normalizeString(ticketView?.date_time_summary?.requested_time_slot);
  if (!tripDate || !tripTime) {
    return null;
  }

  const normalizedTime = tripTime.length === 5 ? `${tripTime}:00` : tripTime;
  const parsed = Date.parse(`${tripDate}T${normalizedTime}.000Z`);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function resolveCompletionEligibility(ticketView, nowIso) {
  const deterministicTicketState =
    ticketView?.ticket_status_summary?.deterministic_ticket_state || 'no_ticket_yet';
  if (deterministicTicketState === 'linked_ticket_completed') {
    return freezeTelegramPostTripPlanningValue({
      trip_is_completed: true,
      completion_state: 'ticket_completed',
      completion_timestamp_iso:
        ticketView?.latest_timestamp_summary?.iso || parseTripStartIso(ticketView),
    });
  }

  if (deterministicTicketState === 'linked_ticket_ready') {
    const requestedTripDate = normalizeString(
      ticketView?.date_time_summary?.requested_trip_date
    );
    const nowDate = nowIso.slice(0, 10);
    if (requestedTripDate && requestedTripDate < nowDate) {
      return freezeTelegramPostTripPlanningValue({
        trip_is_completed: true,
        completion_state: 'trip_day_elapsed',
        completion_timestamp_iso:
          parseTripStartIso(ticketView) || ticketView?.latest_timestamp_summary?.iso || nowIso,
      });
    }

    return freezeTelegramPostTripPlanningValue({
      trip_is_completed: false,
      completion_state: 'trip_not_completed',
      completion_timestamp_iso: parseTripStartIso(ticketView),
    });
  }

  if (deterministicTicketState === 'linked_ticket_cancelled_or_unavailable') {
    return freezeTelegramPostTripPlanningValue({
      trip_is_completed: false,
      completion_state: 'ticket_unavailable',
      completion_timestamp_iso: null,
    });
  }

  return freezeTelegramPostTripPlanningValue({
    trip_is_completed: false,
    completion_state: 'ticket_not_linked',
    completion_timestamp_iso: null,
  });
}

function comparePlannedPostTripItems(left, right) {
  const leftTime = Date.parse(left.planned_trigger_time_summary?.iso || 0);
  const rightTime = Date.parse(right.planned_trigger_time_summary?.iso || 0);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  const leftRequestId = left.booking_request_reference?.booking_request_id || 0;
  const rightRequestId = right.booking_request_reference?.booking_request_id || 0;
  if (leftRequestId !== rightRequestId) {
    return leftRequestId - rightRequestId;
  }

  return left.post_trip_message_type < right.post_trip_message_type ? -1 : 1;
}

export class TelegramPostTripMessagePlanningService {
  constructor({
    guestProfiles,
    bookingRequests,
    postTripMessages,
    reviewSubmissions,
    guestTicketViewProjectionService,
    now = () => new Date(),
  }) {
    this.guestProfiles = guestProfiles;
    this.bookingRequests = bookingRequests;
    this.postTripMessages = postTripMessages;
    this.reviewSubmissions = reviewSubmissions;
    this.guestTicketViewProjectionService = guestTicketViewProjectionService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'post-trip-message-planning-service',
      status: 'read_only_post_trip_message_planning_ready',
      dependencyKeys: [
        'guestProfiles',
        'bookingRequests',
        'postTripMessages',
        'reviewSubmissions',
        'guestTicketViewProjectionService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectPostTripPlanning('post-trip planning clock returned an unusable timestamp');
    }

    return iso;
  }

  resolveGuestProfileByTelegramUserIdOrThrow(telegramUserId) {
    const guestProfile = this.guestProfiles.findOneBy(
      { telegram_user_id: telegramUserId },
      { orderBy: 'guest_profile_id ASC' }
    );
    if (!guestProfile) {
      rejectPostTripPlanning(`Guest profile not found for telegram_user_id: ${telegramUserId}`);
    }

    return guestProfile;
  }

  hasExistingPostTripMessage(bookingRequestId, postTripMessageType) {
    const existing = this.postTripMessages.findOneBy(
      {
        booking_request_id: bookingRequestId,
        message_type: postTripMessageType,
      },
      { orderBy: 'post_trip_message_id DESC' }
    );

    return existing || null;
  }

  hasSubmittedReview(bookingRequestId) {
    const submission = this.reviewSubmissions.findOneBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'review_submission_id DESC' }
    );

    return submission || null;
  }

  buildTriggerIso({
    postTripMessageType,
    completionTimestampIso,
    nowIso,
  }) {
    const baseIso = completionTimestampIso || nowIso;
    const offsetMinutes =
      TELEGRAM_POST_TRIP_TRIGGER_OFFSETS_MINUTES[postTripMessageType] || 0;
    const baseMillis = Date.parse(baseIso);
    if (Number.isNaN(baseMillis)) {
      return nowIso;
    }
    const rawTriggerMillis = baseMillis + offsetMinutes * 60 * 1000;
    const nowMillis = Date.parse(nowIso);
    return new Date(Math.max(rawTriggerMillis, nowMillis)).toISOString();
  }

  buildPlanItem({
    ticketView,
    guestProfile,
    postTripMessageType,
    nowIso,
  }) {
    const bookingRequestReference = ticketView?.booking_request_reference || null;
    const bookingRequestId = bookingRequestReference?.booking_request_id || null;
    const completionEligibility = resolveCompletionEligibility(ticketView, nowIso);
    const existingMessage =
      bookingRequestId !== null
        ? this.hasExistingPostTripMessage(bookingRequestId, postTripMessageType)
        : null;
    const reviewSubmission =
      bookingRequestId !== null ? this.hasSubmittedReview(bookingRequestId) : null;

    let planningStatus = 'post_trip_not_possible';
    let planningEligibilityState = completionEligibility.completion_state;
    let triggerIso = null;

    if (postTripMessageType === 'post_trip_review_request' && reviewSubmission) {
      planningStatus = 'post_trip_not_needed';
      planningEligibilityState = 'review_already_submitted';
    } else if (existingMessage) {
      planningStatus = 'post_trip_not_needed';
      planningEligibilityState = 'post_trip_message_already_recorded';
    } else if (completionEligibility.trip_is_completed) {
      planningStatus = 'post_trip_planned';
      planningEligibilityState = 'trip_completed';
      triggerIso = this.buildTriggerIso({
        postTripMessageType,
        completionTimestampIso: completionEligibility.completion_timestamp_iso,
        nowIso,
      });
    } else if (completionEligibility.completion_state === 'ticket_unavailable') {
      planningStatus = 'post_trip_not_needed';
      planningEligibilityState = 'ticket_unavailable';
    } else {
      planningStatus = 'post_trip_not_possible';
    }

    planningStatus = normalizePostTripPlanningState(planningStatus);

    return freezeTelegramPostTripPlanningValue({
      response_version: TELEGRAM_POST_TRIP_MESSAGE_PLAN_ITEM_VERSION,
      plan_item_type: 'telegram_post_trip_message_plan_item',
      read_only: true,
      planning_only: true,
      planned_by: SERVICE_NAME,
      booking_request_reference: bookingRequestReference,
      post_trip_message_type: postTripMessageType,
      planning_status: planningStatus,
      planned_trigger_time_summary: buildTelegramHandoffTimestampSummary(triggerIso),
      ticket_trip_summary: {
        deterministic_ticket_state:
          ticketView?.ticket_status_summary?.deterministic_ticket_state || 'no_ticket_yet',
        ticket_availability_state: ticketView?.ticket_availability_state || null,
        requested_trip_date: ticketView?.date_time_summary?.requested_trip_date || null,
        requested_time_slot: ticketView?.date_time_summary?.requested_time_slot || null,
        linked_canonical_presale_reference:
          ticketView?.linked_canonical_presale_reference || null,
      },
      telegram_user_summary:
        ticketView?.telegram_user_summary ||
        buildTelegramUserSummaryFromGuestProfileAndEvents({
          guestProfile,
          events: [],
        }),
      planning_eligibility_state: planningEligibilityState,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        triggerIso,
        completionEligibility.completion_timestamp_iso,
        ticketView?.latest_timestamp_summary?.iso,
        existingMessage?.scheduled_for,
        existingMessage?.sent_at,
        reviewSubmission?.submitted_at
      ),
    });
  }

  planPostTripMessagesByBookingRequestReference(input = {}) {
    const bookingRequestId = normalizeBookingRequestId(input);
    const messageTypes = normalizePostTripMessageTypes(input);
    const nowIso = this.nowIso();
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectPostTripPlanning(`Invalid booking request reference: ${bookingRequestId}`);
    }
    const guestProfile = this.guestProfiles.getById(bookingRequest.guest_profile_id);
    if (!guestProfile) {
      rejectPostTripPlanning(
        `Booking request is not projectable for post-trip planning: ${bookingRequestId}`
      );
    }
    const ticketView =
      this.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
        bookingRequestId
      );

    const items = messageTypes.map((postTripMessageType) =>
      this.buildPlanItem({
        ticketView,
        guestProfile,
        postTripMessageType,
        nowIso,
      })
    );

    return freezeTelegramPostTripPlanningValue({
      response_version: TELEGRAM_POST_TRIP_MESSAGE_PLAN_LIST_VERSION,
      read_only: true,
      planning_only: true,
      planned_by: SERVICE_NAME,
      booking_request_reference: ticketView.booking_request_reference,
      item_count: items.length,
      items,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        ...items.map((item) => item.latest_timestamp_summary?.iso)
      ),
    });
  }

  listPlannedPostTripMessagesForTelegramGuest(input = {}) {
    const telegramUserId = normalizeTelegramUserId(input);
    const guestProfile = this.resolveGuestProfileByTelegramUserIdOrThrow(telegramUserId);
    const messageTypes = normalizePostTripMessageTypes(input);
    const nowIso = this.nowIso();
    const bookingRequests = this.bookingRequests.listBy(
      { guest_profile_id: guestProfile.guest_profile_id },
      {
        orderBy: 'created_at DESC, booking_request_id DESC',
        limit: normalizeLimit(input.scan_limit ?? input.scanLimit),
      }
    );

    const items = bookingRequests
      .flatMap((bookingRequest) => {
        const ticketView =
          this.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
            bookingRequest.booking_request_id
          );
        return messageTypes.map((postTripMessageType) =>
          this.buildPlanItem({
            ticketView,
            guestProfile,
            postTripMessageType,
            nowIso,
          })
        );
      })
      .filter((item) => item.planning_status === 'post_trip_planned')
      .sort(comparePlannedPostTripItems);

    return freezeTelegramPostTripPlanningValue({
      response_version: TELEGRAM_POST_TRIP_MESSAGE_PLAN_LIST_VERSION,
      read_only: true,
      planning_only: true,
      planned_by: SERVICE_NAME,
      list_scope: 'telegram_guest_planned_post_trip_messages',
      telegram_user_summary: buildTelegramUserSummaryFromGuestProfileAndEvents({
        guestProfile,
        events: [],
      }),
      item_count: items.length,
      items,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        ...items.map((item) => item.latest_timestamp_summary?.iso)
      ),
    });
  }

  planByBookingRequestReference(input = {}) {
    return this.planPostTripMessagesByBookingRequestReference(input);
  }

  listForTelegramGuest(input = {}) {
    return this.listPlannedPostTripMessagesForTelegramGuest(input);
  }
}
