import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_POST_TRIP_MESSAGE_TYPES,
  TELEGRAM_POST_TRIP_PLANNING_STATES,
} from '../../shared/telegram/index.js';
import {
  confirmAndLinkToPresale,
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram post-trip message planning service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-14T08:00:00.000Z');
    ({ db, context } = createTestContext(clock));
    wireClock(context, clock);
  });

  it('plans supported post-trip messages for completed trips', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '4101',
      requestedTripDate: '2026-04-12',
      requestedTimeSlot: '10:30',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['USED', 'USED'],
      businessDay: '2026-04-12',
    });

    const plan =
      context.services.postTripMessagePlanningService.planPostTripMessagesByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(plan.item_count).toBe(2);
    expect(plan.items.map((item) => item.post_trip_message_type)).toEqual(
      TELEGRAM_POST_TRIP_MESSAGE_TYPES
    );
    expect(plan.items.every((item) => item.planning_status === 'post_trip_planned')).toBe(true);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.items[0])).toBe(true);
  });

  it('returns post_trip_not_possible when trip is not completed', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '4201',
      requestedTripDate: '2026-04-14',
      requestedTimeSlot: '11:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-14',
    });

    const plan =
      context.services.postTripMessagePlanningService.planPostTripMessagesByBookingRequestReference(
        {
          booking_request_id: seeded.bookingRequestId,
          post_trip_message_type: 'post_trip_review_request',
        }
      );
    const item = plan.items[0];

    expect(item.planning_status).toBe('post_trip_not_possible');
    expect(item.planning_eligibility_state).toBe('trip_not_completed');
  });

  it('returns post_trip_not_needed for review requests when review is already submitted', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '4301',
      requestedTripDate: '2026-04-11',
      requestedTimeSlot: '09:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['USED'],
      businessDay: '2026-04-11',
    });
    context.services.reviewFlowService.submitGuestReviewForCompletedTrip({
      booking_request_id: seeded.bookingRequestId,
      rating_value: 5,
      comment_text: 'Great trip and friendly crew.',
      idempotency_key: 'review-4301',
    });

    const plan =
      context.services.postTripMessagePlanningService.planPostTripMessagesByBookingRequestReference(
        {
          booking_request_id: seeded.bookingRequestId,
          post_trip_message_type: 'post_trip_review_request',
        }
      );
    const item = plan.items[0];

    expect(item.planning_status).toBe('post_trip_not_needed');
    expect(item.planning_eligibility_state).toBe('review_already_submitted');
  });

  it('lists only post_trip_planned items for a telegram guest', () => {
    const completed = seedBookingRequest(context, clock, {
      suffix: '4401',
      requestedTripDate: '2026-04-12',
      requestedTimeSlot: '12:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: completed.bookingRequestId,
      ticketStatuses: ['USED'],
      businessDay: '2026-04-12',
    });

    clock.advanceMinutes(2);
    context.services.bookingRequestService.createBookingRequest({
      guest_profile_id: completed.guest.guest_profile_id,
      seller_attribution_session_id: completed.attribution.seller_attribution_session_id,
      requested_trip_date: '2026-04-16',
      requested_time_slot: '13:00',
      requested_seats: 1,
      requested_ticket_mix: { adult: 1 },
      requested_prepayment_amount: 1200,
      currency: 'RUB',
      contact_phone_e164: completed.guest.phone_e164,
    });

    const list =
      context.services.postTripMessagePlanningService.listPlannedPostTripMessagesForTelegramGuest(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: completed.guest.telegram_user_id,
          },
        }
      );

    expect(list.item_count).toBe(2);
    expect(list.items.every((item) => item.planning_status === 'post_trip_planned')).toBe(true);
    expect(list.telegram_user_summary.telegram_user_id).toBe(completed.guest.telegram_user_id);
  });

  it('rejects invalid references and unsupported message types', () => {
    expect(() =>
      context.services.postTripMessagePlanningService.planPostTripMessagesByBookingRequestReference(
        0
      )
    ).toThrow('booking_request_reference.booking_request_id must be a positive integer');

    const seeded = seedBookingRequest(context, clock, {
      suffix: '4501',
    });
    expect(() =>
      context.services.postTripMessagePlanningService.planPostTripMessagesByBookingRequestReference(
        {
          booking_request_id: seeded.bookingRequestId,
          post_trip_message_type: 'post_trip_bonus_offer',
        }
      )
    ).toThrow('Unsupported post-trip message type');

    expect(() =>
      context.services.postTripMessagePlanningService.listPlannedPostTripMessagesForTelegramGuest(
        {
          telegram_user_reference: {
            reference_type: 'telegram_chat',
            telegram_user_id: 'x',
          },
        }
      )
    ).toThrow('Unsupported telegram-user reference type');
  });

  it('keeps deterministic planning-state coverage', () => {
    expect(TELEGRAM_POST_TRIP_PLANNING_STATES).toEqual([
      'post_trip_planned',
      'post_trip_not_needed',
      'post_trip_not_possible',
    ]);
  });
});
