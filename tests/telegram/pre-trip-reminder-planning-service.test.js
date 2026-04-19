import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_PRE_TRIP_REMINDER_PLANNING_STATES,
  TELEGRAM_PRE_TRIP_REMINDER_TYPES,
} from '../../shared/telegram/index.js';
import {
  confirmAndLinkToPresale,
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram pre-trip reminder planning service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-10T07:00:00.000Z');
    ({ db, context } = createTestContext(clock));
    wireClock(context, clock);
  });

  it('plans supported reminders for linked ready tickets', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '3101',
      requestedTripDate: '2026-04-12',
      requestedTimeSlot: '12:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-12',
    });

    const plan =
      context.services.preTripReminderPlanningService.planRemindersByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(plan.item_count).toBe(2);
    expect(plan.items.map((item) => item.reminder_type)).toEqual(
      TELEGRAM_PRE_TRIP_REMINDER_TYPES
    );
    expect(
      plan.items.every((item) => item.reminder_planning_status === 'reminder_planned')
    ).toBe(true);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.items[0])).toBe(true);
  });

  it('returns reminder_not_needed when trigger time has already elapsed', () => {
    clock.set('2026-04-12T09:45:00.000Z');
    const seeded = seedBookingRequest(context, clock, {
      suffix: '3201',
      requestedTripDate: '2026-04-12',
      requestedTimeSlot: '10:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-12',
    });

    const plan =
      context.services.preTripReminderPlanningService.planRemindersByBookingRequestReference({
        booking_request_reference: {
          reference_type: 'telegram_booking_request',
          booking_request_id: seeded.bookingRequestId,
        },
        reminder_type: '1_hour_before_trip',
      });
    const item = plan.items[0];

    expect(item.reminder_type).toBe('1_hour_before_trip');
    expect(item.reminder_planning_status).toBe('reminder_not_needed');
    expect(item.reminder_eligibility_state).toBe('trigger_time_elapsed');
  });

  it('returns reminder_not_needed for linked completed ticket states', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '3301',
      requestedTripDate: '2026-04-11',
      requestedTimeSlot: '09:30',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['USED', 'USED'],
      businessDay: '2026-04-11',
    });

    const plan =
      context.services.preTripReminderPlanningService.planRemindersByBookingRequestReference({
        booking_request_id: seeded.bookingRequestId,
        reminder_type: '30_minutes_before_trip',
      });
    const item = plan.items[0];

    expect(item.reminder_planning_status).toBe('reminder_not_needed');
    expect(item.reminder_eligibility_state).toBe('ticket_completed');
  });

  it('returns reminder_not_possible for no_ticket_yet states', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '3401',
    });

    const plan =
      context.services.preTripReminderPlanningService.planRemindersByBookingRequestReference({
        booking_request_id: seeded.bookingRequestId,
        reminder_type: '30_minutes_before_trip',
      });
    const item = plan.items[0];

    expect(item.reminder_planning_status).toBe('reminder_not_possible');
    expect(item.reminder_eligibility_state).toBe('ticket_not_linked');
  });

  it('lists only reminder_planned items for a telegram guest', () => {
    const ready = seedBookingRequest(context, clock, {
      suffix: '3501',
      requestedTripDate: '2026-04-13',
      requestedTimeSlot: '16:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: ready.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-13',
    });

    clock.advanceMinutes(1);
    context.services.bookingRequestService.createBookingRequest({
      guest_profile_id: ready.guest.guest_profile_id,
      seller_attribution_session_id: ready.attribution.seller_attribution_session_id,
      requested_trip_date: '2026-04-13',
      requested_time_slot: '15:30',
      requested_seats: 1,
      requested_ticket_mix: { adult: 1 },
      requested_prepayment_amount: 1000,
      currency: 'RUB',
      contact_phone_e164: ready.guest.phone_e164,
    });

    const list =
      context.services.preTripReminderPlanningService.listPlannedRemindersForTelegramGuest(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: ready.guest.telegram_user_id,
          },
        }
      );

    expect(list.item_count).toBe(2);
    expect(
      list.items.every((item) => item.reminder_planning_status === 'reminder_planned')
    ).toBe(true);
    expect(list.telegram_user_summary.telegram_user_id).toBe(ready.guest.telegram_user_id);
  });

  it('rejects invalid references and unsupported reminder types', () => {
    expect(() =>
      context.services.preTripReminderPlanningService.planRemindersByBookingRequestReference(
        0
      )
    ).toThrow('booking_request_reference.booking_request_id must be a positive integer');

    const seeded = seedBookingRequest(context, clock, {
      suffix: '3601',
    });
    expect(() =>
      context.services.preTripReminderPlanningService.planRemindersByBookingRequestReference({
        booking_request_id: seeded.bookingRequestId,
        reminder_type: '2_hours_before_trip',
      })
    ).toThrow('Unsupported reminder type');

    expect(() =>
      context.services.preTripReminderPlanningService.listPlannedRemindersForTelegramGuest({
        telegram_user_reference: {
          reference_type: 'telegram_chat',
          telegram_user_id: 'x',
        },
      })
    ).toThrow('Unsupported telegram-user reference type');
  });

  it('keeps deterministic planning-state coverage', () => {
    expect(TELEGRAM_PRE_TRIP_REMINDER_PLANNING_STATES).toEqual([
      'reminder_planned',
      'reminder_not_needed',
      'reminder_not_possible',
    ]);
  });
});
