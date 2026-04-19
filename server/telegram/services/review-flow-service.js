import {
  buildTelegramHandoffTimestampSummary,
  buildTelegramLatestTimestampSummary,
  freezeTelegramReviewFlowValue,
  TELEGRAM_REVIEW_COMMENT_MAX_LENGTH,
  TELEGRAM_REVIEW_FLOW_RESULT_VERSION,
  TELEGRAM_REVIEW_RATING_MAX,
  TELEGRAM_REVIEW_RATING_MIN,
  TELEGRAM_REVIEW_REQUEST_STATE_VERSION,
  TELEGRAM_REVIEW_STATUSES,
  TELEGRAM_REVIEW_SUBMISSION_VERSION,
} from '../../../shared/telegram/index.js';
import {
  buildBookingRequestReference,
  buildTelegramUserSummaryFromGuestProfileAndEvents,
} from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_REVIEW_FLOW]';
const SERVICE_NAME = 'telegram_review_flow_service';

function rejectReviewFlow(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectReviewFlow(`${label} must be a positive integer`);
  }

  return normalized;
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

function normalizeBookingRequestId(input = {}) {
  const rawReference = pickBookingRequestReference(input);
  if (!rawReference) {
    rejectReviewFlow('booking request reference is required');
  }

  const referenceType = normalizeString(
    rawReference.reference_type || 'telegram_booking_request'
  );
  if (referenceType !== 'telegram_booking_request') {
    rejectReviewFlow(
      `Unsupported booking request reference type: ${referenceType || 'unknown'}`
    );
  }

  return normalizePositiveInteger(
    rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
    'booking_request_reference.booking_request_id'
  );
}

function normalizeReviewStatus(value) {
  if (!TELEGRAM_REVIEW_STATUSES.includes(value)) {
    rejectReviewFlow(`Unsupported review status: ${String(value || 'unknown')}`);
  }

  return value;
}

function normalizeRatingValue(input = {}) {
  const rawRating =
    input.rating_value ?? input.ratingValue ?? input.rating ?? input.value ?? null;
  const ratingValue = Number(rawRating);
  if (
    !Number.isInteger(ratingValue) ||
    ratingValue < TELEGRAM_REVIEW_RATING_MIN ||
    ratingValue > TELEGRAM_REVIEW_RATING_MAX
  ) {
    rejectReviewFlow('invalid rating');
  }

  return ratingValue;
}

function normalizeCommentText(input = {}) {
  const rawComment =
    input.comment_text ?? input.commentText ?? input.comment ?? input.text ?? null;
  const commentText = normalizeString(rawComment);
  if (!commentText) {
    rejectReviewFlow('invalid comment payload');
  }
  if (commentText.length > TELEGRAM_REVIEW_COMMENT_MAX_LENGTH) {
    rejectReviewFlow('invalid comment payload');
  }

  return commentText;
}

function normalizeOptionalKey(value, label) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length > 180) {
    rejectReviewFlow(`${label} must be 180 chars or fewer`);
  }

  return normalized;
}

function buildDerivedDedupeKey({ bookingRequestId, ratingValue, commentText }) {
  let checksum = 7;
  const normalizedComment = commentText.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const char of normalizedComment) {
    checksum = (checksum * 31 + char.codePointAt(0)) % 1000000007;
  }

  return `tg-review-${bookingRequestId}-${ratingValue}-${checksum}`;
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

function resolveTripCompletionState(ticketView, nowIso) {
  const deterministicTicketState =
    ticketView?.ticket_status_summary?.deterministic_ticket_state || 'no_ticket_yet';
  if (deterministicTicketState === 'linked_ticket_completed') {
    return freezeTelegramReviewFlowValue({
      review_possible: true,
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
      return freezeTelegramReviewFlowValue({
        review_possible: true,
        completion_state: 'trip_day_elapsed',
        completion_timestamp_iso:
          parseTripStartIso(ticketView) || ticketView?.latest_timestamp_summary?.iso || nowIso,
      });
    }

    return freezeTelegramReviewFlowValue({
      review_possible: false,
      completion_state: 'trip_not_completed',
      completion_timestamp_iso: parseTripStartIso(ticketView),
    });
  }

  if (deterministicTicketState === 'linked_ticket_cancelled_or_unavailable') {
    return freezeTelegramReviewFlowValue({
      review_possible: false,
      completion_state: 'ticket_unavailable',
      completion_timestamp_iso: null,
    });
  }

  return freezeTelegramReviewFlowValue({
    review_possible: false,
    completion_state: 'ticket_not_linked',
    completion_timestamp_iso: null,
  });
}

function buildRatingSummary(ratingValue) {
  if (ratingValue === null || ratingValue === undefined || ratingValue === '') {
    return null;
  }

  if (!Number.isInteger(Number(ratingValue))) {
    return null;
  }

  return freezeTelegramReviewFlowValue({
    rating_value: Number(ratingValue),
    rating_scale_min: TELEGRAM_REVIEW_RATING_MIN,
    rating_scale_max: TELEGRAM_REVIEW_RATING_MAX,
  });
}

function buildCommentSummary(commentText) {
  const normalized = normalizeString(commentText);
  if (!normalized) {
    return null;
  }

  return freezeTelegramReviewFlowValue({
    comment_text: normalized,
    comment_length: normalized.length,
  });
}

function areCompatibleSubmissions(existing, ratingValue, commentText) {
  const existingRating = Number(existing?.rating_value);
  const existingComment = normalizeString(existing?.comment_text);
  return (
    Number.isInteger(existingRating) &&
    existingRating === ratingValue &&
    existingComment === commentText
  );
}

export class TelegramReviewFlowService {
  constructor({
    bookingRequests,
    bookingRequestEvents,
    guestProfiles,
    reviewSubmissions,
    guestTicketViewProjectionService,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingRequestEvents = bookingRequestEvents;
    this.guestProfiles = guestProfiles;
    this.reviewSubmissions = reviewSubmissions;
    this.guestTicketViewProjectionService = guestTicketViewProjectionService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'review-flow-service',
      status: 'telegram_boundary_review_flow_ready',
      dependencyKeys: [
        'bookingRequests',
        'bookingRequestEvents',
        'guestProfiles',
        'reviewSubmissions',
        'guestTicketViewProjectionService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectReviewFlow('review flow clock returned an unusable timestamp');
    }

    return iso;
  }

  resolveBookingContextOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectReviewFlow(`invalid booking request reference: ${bookingRequestId}`);
    }

    const guestProfile = this.guestProfiles.getById(bookingRequest.guest_profile_id);
    if (!guestProfile) {
      rejectReviewFlow(
        `booking request is not projectable for review flow: ${bookingRequestId}`
      );
    }

    const events = this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
    const ticketView =
      this.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
        bookingRequestId
      );
    const reviewSubmission =
      this.reviewSubmissions.findOneBy(
        { booking_request_id: bookingRequestId },
        { orderBy: 'review_submission_id DESC' }
      ) || null;

    return {
      bookingRequest,
      guestProfile,
      events,
      ticketView,
      reviewSubmission,
    };
  }

  buildReviewFlowResult({
    responseVersion,
    reviewStatus,
    bookingRequest,
    guestProfile,
    events,
    ticketView,
    reviewSubmission = null,
    nowIso,
    operationMode = 'read_only',
  }) {
    const normalizedStatus = normalizeReviewStatus(reviewStatus);

    return freezeTelegramReviewFlowValue({
      response_version: responseVersion,
      projection_item_type: 'telegram_review_flow_item',
      read_only: operationMode === 'read_only',
      persistence_applied: operationMode === 'submitted',
      processed_by: SERVICE_NAME,
      booking_request_reference: buildBookingRequestReference(bookingRequest),
      review_status: normalizedStatus,
      rating_summary: buildRatingSummary(reviewSubmission?.rating_value ?? null),
      comment_summary: buildCommentSummary(reviewSubmission?.comment_text ?? null),
      submitted_timestamp_summary: buildTelegramHandoffTimestampSummary(
        normalizeString(reviewSubmission?.submitted_at)
      ),
      telegram_user_summary: buildTelegramUserSummaryFromGuestProfileAndEvents({
        guestProfile,
        events,
      }),
      idempotency_dedupe_summary: reviewSubmission
        ? freezeTelegramReviewFlowValue({
            idempotency_key: normalizeString(reviewSubmission.idempotency_key),
            dedupe_key: normalizeString(reviewSubmission.dedupe_key),
          })
        : null,
      review_availability_state: resolveTripCompletionState(ticketView, nowIso),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        reviewSubmission?.submitted_at,
        ticketView?.latest_timestamp_summary?.iso,
        bookingRequest?.last_status_at
      ),
    });
  }

  readReviewRequestStateByBookingRequestReference(input = {}) {
    const nowIso = this.nowIso();
    const bookingRequestId = normalizeBookingRequestId(input);
    const context = this.resolveBookingContextOrThrow(bookingRequestId);
    const completionState = resolveTripCompletionState(context.ticketView, nowIso);

    const reviewStatus = context.reviewSubmission
      ? 'review_submitted'
      : completionState.review_possible
        ? 'review_available'
        : 'review_not_available';

    return this.buildReviewFlowResult({
      responseVersion: TELEGRAM_REVIEW_REQUEST_STATE_VERSION,
      reviewStatus,
      ...context,
      nowIso,
      operationMode: 'read_only',
    });
  }

  submitGuestReviewForCompletedTrip(input = {}) {
    const nowIso = this.nowIso();
    const bookingRequestId = normalizeBookingRequestId(input);
    const ratingValue = normalizeRatingValue(input);
    const commentText = normalizeCommentText(input);
    const context = this.resolveBookingContextOrThrow(bookingRequestId);
    const completionState = resolveTripCompletionState(context.ticketView, nowIso);
    if (!completionState.review_possible) {
      rejectReviewFlow('trip not completed');
    }

    if (context.reviewSubmission) {
      if (areCompatibleSubmissions(context.reviewSubmission, ratingValue, commentText)) {
        return this.buildReviewFlowResult({
          responseVersion: TELEGRAM_REVIEW_SUBMISSION_VERSION,
          reviewStatus: 'review_submitted',
          ...context,
          nowIso,
          operationMode: 'submitted',
        });
      }
      rejectReviewFlow('duplicate incompatible submission');
    }

    const dedupeKey =
      normalizeOptionalKey(input.dedupe_key ?? input.dedupeKey, 'dedupe_key') ||
      buildDerivedDedupeKey({ bookingRequestId, ratingValue, commentText });
    const idempotencyKey =
      normalizeOptionalKey(input.idempotency_key ?? input.idempotencyKey, 'idempotency_key') ||
      dedupeKey;

    let submission = null;
    try {
      submission = this.reviewSubmissions.create({
        booking_request_id: bookingRequestId,
        guest_profile_id: context.guestProfile.guest_profile_id,
        telegram_user_id: context.guestProfile.telegram_user_id,
        rating_value: ratingValue,
        comment_text: commentText,
        submitted_at: nowIso,
        idempotency_key: idempotencyKey,
        dedupe_key: dedupeKey,
        created_at: nowIso,
      });
    } catch {
      const existing =
        this.reviewSubmissions.findOneBy(
          { booking_request_id: bookingRequestId },
          { orderBy: 'review_submission_id DESC' }
        ) || null;
      if (existing && areCompatibleSubmissions(existing, ratingValue, commentText)) {
        submission = existing;
      } else {
        rejectReviewFlow('duplicate incompatible submission');
      }
    }

    return this.buildReviewFlowResult({
      responseVersion: TELEGRAM_REVIEW_SUBMISSION_VERSION,
      reviewStatus: 'review_submitted',
      bookingRequest: context.bookingRequest,
      guestProfile: context.guestProfile,
      events: context.events,
      ticketView: context.ticketView,
      reviewSubmission: submission,
      nowIso,
      operationMode: 'submitted',
    });
  }

  readSubmittedReviewByBookingRequestReference(input = {}) {
    const nowIso = this.nowIso();
    const bookingRequestId = normalizeBookingRequestId(input);
    const context = this.resolveBookingContextOrThrow(bookingRequestId);
    const reviewStatus = context.reviewSubmission
      ? 'review_submitted'
      : 'review_not_available';

    return this.buildReviewFlowResult({
      responseVersion: TELEGRAM_REVIEW_FLOW_RESULT_VERSION,
      reviewStatus,
      ...context,
      nowIso,
      operationMode: 'read_only',
    });
  }

  readRequestStateByBookingRequestReference(input = {}) {
    return this.readReviewRequestStateByBookingRequestReference(input);
  }

  submitReview(input = {}) {
    return this.submitGuestReviewForCompletedTrip(input);
  }

  readSubmittedReview(input = {}) {
    return this.readSubmittedReviewByBookingRequestReference(input);
  }
}
