import { beforeEach, describe, expect, it } from 'vitest';
import { TELEGRAM_REVIEW_STATUSES } from '../../shared/telegram/index.js';
import {
  confirmAndLinkToPresale,
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram review flow service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-14T09:00:00.000Z');
    ({ db, context } = createTestContext(clock));
    wireClock(context, clock);
  });

  it('reads review_available for completed trips without a submitted review', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '5101',
      requestedTripDate: '2026-04-11',
      requestedTimeSlot: '09:30',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['USED'],
      businessDay: '2026-04-11',
    });

    const state =
      context.services.reviewFlowService.readReviewRequestStateByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(state.review_status).toBe('review_available');
    expect(state.rating_summary).toBeNull();
    expect(state.comment_summary).toBeNull();
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('submits one immutable review and reads it back', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '5201',
      requestedTripDate: '2026-04-10',
      requestedTimeSlot: '12:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['USED', 'USED'],
      businessDay: '2026-04-10',
    });

    const submitted = context.services.reviewFlowService.submitGuestReviewForCompletedTrip({
      booking_request_id: seeded.bookingRequestId,
      rating_value: 5,
      comment_text: 'Excellent trip.',
      idempotency_key: 'review-5201',
      dedupe_key: 'review-5201',
    });

    expect(submitted.review_status).toBe('review_submitted');
    expect(submitted.rating_summary.rating_value).toBe(5);
    expect(submitted.comment_summary.comment_text).toBe('Excellent trip.');
    expect(submitted.idempotency_dedupe_summary).toEqual({
      idempotency_key: 'review-5201',
      dedupe_key: 'review-5201',
    });

    const readSubmitted =
      context.services.reviewFlowService.readSubmittedReviewByBookingRequestReference({
        booking_request_id: seeded.bookingRequestId,
      });
    expect(readSubmitted.review_status).toBe('review_submitted');
    expect(readSubmitted.rating_summary.rating_value).toBe(5);
    expect(readSubmitted.comment_summary.comment_text).toBe('Excellent trip.');
  });

  it('returns stable replay for duplicate compatible submissions and rejects incompatible ones', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '5301',
      requestedTripDate: '2026-04-09',
      requestedTimeSlot: '11:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['USED'],
      businessDay: '2026-04-09',
    });

    const first = context.services.reviewFlowService.submitGuestReviewForCompletedTrip({
      booking_request_id: seeded.bookingRequestId,
      rating_value: 4,
      comment_text: 'Nice and calm route.',
    });
    const replay = context.services.reviewFlowService.submitGuestReviewForCompletedTrip({
      booking_request_id: seeded.bookingRequestId,
      rating_value: 4,
      comment_text: 'Nice and calm route.',
    });

    expect(replay).toEqual(first);

    expect(() =>
      context.services.reviewFlowService.submitGuestReviewForCompletedTrip({
        booking_request_id: seeded.bookingRequestId,
        rating_value: 2,
        comment_text: 'Changed opinion.',
      })
    ).toThrow('duplicate incompatible submission');
  });

  it('rejects submissions when trip is not completed', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '5401',
      requestedTripDate: '2026-04-16',
      requestedTimeSlot: '14:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-16',
    });

    expect(() =>
      context.services.reviewFlowService.submitGuestReviewForCompletedTrip({
        booking_request_id: seeded.bookingRequestId,
        rating_value: 5,
        comment_text: 'Should fail before trip completion.',
      })
    ).toThrow('trip not completed');
  });

  it('rejects invalid booking references, ratings, and comments', () => {
    expect(() =>
      context.services.reviewFlowService.readReviewRequestStateByBookingRequestReference(0)
    ).toThrow('booking_request_reference.booking_request_id must be a positive integer');

    const seeded = seedBookingRequest(context, clock, {
      suffix: '5501',
      requestedTripDate: '2026-04-08',
      requestedTimeSlot: '10:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['USED'],
      businessDay: '2026-04-08',
    });

    expect(() =>
      context.services.reviewFlowService.submitGuestReviewForCompletedTrip({
        booking_request_id: seeded.bookingRequestId,
        rating_value: 6,
        comment_text: 'Invalid rating.',
      })
    ).toThrow('invalid rating');

    expect(() =>
      context.services.reviewFlowService.submitGuestReviewForCompletedTrip({
        booking_request_id: seeded.bookingRequestId,
        rating_value: 5,
        comment_text: '',
      })
    ).toThrow('invalid comment payload');

    expect(() =>
      context.services.reviewFlowService.submitGuestReviewForCompletedTrip({
        booking_request_id: 9999,
        rating_value: 5,
        comment_text: 'Unknown booking request.',
      })
    ).toThrow('invalid booking request reference');
  });

  it('keeps deterministic review-state coverage', () => {
    expect(TELEGRAM_REVIEW_STATUSES).toEqual([
      'review_not_available',
      'review_available',
      'review_submitted',
    ]);
  });
});
