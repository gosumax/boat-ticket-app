import { beforeEach, describe, expect, it } from 'vitest';
import {
  confirmAndLinkToPresale,
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram guest command-action orchestration service', () => {
  let clock;
  let db;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-14T10:00:00.000Z');
    ({ db, context } = createTestContext(clock));
    wireClock(context, clock);
  });

  it('executes open_ticket by booking reference with completed deterministic result', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '7101',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-15',
    });

    const result =
      context.services.guestCommandActionOrchestrationService
        .executeGuestActionByBookingRequestReference({
          action_type: 'open_ticket',
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
        });

    expect(result).toMatchObject({
      action_type: 'open_ticket',
      action_status: 'action_completed',
      telegram_user_summary: {
        telegram_user_id: seeded.guest.telegram_user_id,
      },
      related_booking_request_reference: {
        booking_request_id: seeded.bookingRequestId,
      },
      resolved_data_summary: {
        booking_request_reference: {
          booking_request_id: seeded.bookingRequestId,
        },
        ticket_availability_state: 'available',
      },
      visibility_availability_summary: {
        can_view_ticket: true,
        action_available: true,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.resolved_data_summary)).toBe(true);
  });

  it('executes cancel_before_prepayment when action is available', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '7102',
    });

    const result =
      context.services.guestCommandActionOrchestrationService
        .executeGuestActionByBookingRequestReference({
          action_type: 'cancel_before_prepayment',
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
          idempotency_key: 'guest-action-cancel-7102',
        });

    expect(result).toMatchObject({
      action_type: 'cancel_before_prepayment',
      action_status: 'action_completed',
      related_booking_request_reference: {
        booking_request_id: seeded.bookingRequestId,
      },
      resolved_data_summary: {
        cancel_status: 'cancelled_before_prepayment',
        booking_request_reference: {
          booking_request_id: seeded.bookingRequestId,
        },
      },
    });
  });

  it('returns action_not_available deterministically for disallowed cancel operation', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '7103',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-15',
    });

    const result =
      context.services.guestCommandActionOrchestrationService
        .executeGuestActionByBookingRequestReference({
          action_type: 'cancel_before_prepayment',
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
        });

    expect(result).toMatchObject({
      action_type: 'cancel_before_prepayment',
      action_status: 'action_not_available',
      visibility_availability_summary: {
        can_cancel_before_prepayment: false,
        action_available: false,
      },
      resolved_data_summary: null,
    });
  });

  it('executes open_contact with projected support content and contact fallback metadata', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '7104',
    });

    const result =
      context.services.guestCommandActionOrchestrationService
        .executeGuestActionByTelegramUserReference({
          action_type: 'open_contact',
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: seeded.guest.telegram_user_id,
          },
        });

    expect(result).toMatchObject({
      action_type: 'open_contact',
      action_status: 'action_available',
      resolved_data_summary: {
        preferred_contact_phone_e164: seeded.guest.phone_e164,
        support_action_reference: 'contact_support',
        support_content_feed_summary: {
          content_grouping_summary: ['trip_help'],
          item_count: expect.any(Number),
          items: expect.any(Array),
        },
      },
      visibility_availability_summary: {
        can_contact: true,
        action_available: true,
      },
    });
    expect(
      result.resolved_data_summary.support_content_feed_summary.items.every(
        (item) => item.content_type_summary?.content_grouping === 'trip_help'
      )
    ).toBe(true);
  });

  it('rejects invalid action payloads deterministically', () => {
    const result =
      context.services.guestCommandActionOrchestrationService
        .executeGuestActionByTelegramUserReference({
          action_type: 'open_unknown_action',
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: 'tg-unknown-7105',
          },
        });

    expect(result).toMatchObject({
      action_status: 'action_rejected_invalid_input',
      action_type: null,
      rejection_reason: expect.stringContaining('Unsupported action type'),
    });
  });
});
