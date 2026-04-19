import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_GUEST_TICKET_STATES,
} from '../../shared/telegram/index.js';
import {
  parseDispatcherBoardingQrPayload,
} from '../../server/ticketing/buyer-ticket-reference.mjs';
import {
  confirmAndLinkToPresale,
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram guest ticket-view projection service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-10T09:00:00.000Z');
    ({ db, context } = createTestContext(clock));
    wireClock(context, clock);
  });

  it('projects no_ticket_yet by booking request reference', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '1101',
    });

    const view =
      context.services.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(view.booking_request_reference.booking_request_id).toBe(seeded.bookingRequestId);
    expect(view.linked_canonical_presale_reference).toBeNull();
    expect(view.ticket_status_summary.deterministic_ticket_state).toBe('no_ticket_yet');
    expect(view.ticket_availability_state).toBe('not_available_yet');
    expect(view.payment_summary).toBeNull();
    expect(view.seller_contact_summary).toMatchObject({
      seller_display_name: 'Seller 1101',
      seller_phone_e164: '+79990001101',
    });
    expect(view.hold_status_summary).toMatchObject({
      hold_status: 'ACTIVE',
      requested_amount: 2000,
      currency: 'RUB',
      hold_expires_at_summary: {
        iso: '2026-04-10T09:15:00.000Z',
      },
    });
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.ticket_status_summary)).toBe(true);
    expect(TELEGRAM_GUEST_TICKET_STATES).toContain(
      view.ticket_status_summary.deterministic_ticket_state
    );
  });

  it('uses managed seller public profile as buyer-facing contact source when present', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '1151',
    });

    db.prepare(
      `
        UPDATE users
        SET public_display_name = ?, public_phone_e164 = ?
        WHERE id = 1
      `
    ).run('Анна Соколова', '+79995554433');

    const view =
      context.services.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(view.seller_contact_summary).toMatchObject({
      seller_display_name: 'Анна Соколова',
      seller_phone_e164: '+79995554433',
      source_metadata_origin: 'seller_user_public_profile',
    });
  });

  it('projects linked_ticket_ready and supports read by canonical presale reference', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '1201',
      requestedTripDate: '2026-04-12',
      requestedTimeSlot: '14:30',
      requestedSeats: 3,
      requestedPrepaymentAmount: 2500,
    });
    const presaleId = confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE', 'USED'],
      numberOfSeats: 3,
      totalPrice: 7000,
      prepaymentAmount: 2500,
      businessDay: '2026-04-12',
      customerPhone: '+79990001201',
    });

    const view =
      context.services.guestTicketViewProjectionService.readGuestTicketViewByCanonicalPresaleReference(
        presaleId
      );

    expect(view.booking_request_reference.booking_request_id).toBe(seeded.bookingRequestId);
    expect(view.linked_canonical_presale_reference.presale_id).toBe(presaleId);
    expect(view.ticket_status_summary.deterministic_ticket_state).toBe(
      'linked_ticket_ready'
    );
    expect(view.ticket_availability_state).toBe('available');
    expect(view.seats_count_summary.requested_seats).toBe(3);
    expect(view.payment_summary).toMatchObject({
      read_status: 'readable',
      total_price: 7000,
      prepayment_amount: 2500,
      remaining_payment_amount: 4500,
    });
    expect(view.contact_summary.preferred_contact_phone_e164).toBe(seeded.guest.phone_e164);
    expect(view.seller_contact_summary).toMatchObject({
      seller_display_name: 'Seller 1201',
      seller_phone_e164: '+79990001201',
    });
    expect(view.buyer_ticket_reference_summary).toMatchObject({
      buyer_ticket_code: 'А1',
      canonical_presale_id: presaleId,
      canonical_ticket_count: 2,
      canonical_ticket_ids: [1, 2],
    });
    expect(view.boarding_qr_payload_summary).toMatchObject({
      payload_source: 'canonical_presale_id_and_ticket_ids',
      compatibility_target: 'dispatcher_boarding_existing_ids',
      qr_payload_text: 'boat-ticket:v1|presale=1|tickets=1,2',
    });
    expect(
      parseDispatcherBoardingQrPayload(view.boarding_qr_payload_summary.qr_payload_text)
    ).toEqual({
      payload_format: 'boat_ticket_boarding_qr_v1',
      canonicalPresaleId: presaleId,
      canonicalTicketIds: [1, 2],
    });
  });

  it('projects linked_ticket_completed when all linked tickets are completed', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '1301',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['USED', 'USED'],
      numberOfSeats: 2,
      totalPrice: 5000,
      prepaymentAmount: 2000,
    });

    const view =
      context.services.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(view.ticket_status_summary.deterministic_ticket_state).toBe(
      'linked_ticket_completed'
    );
    expect(view.ticket_availability_state).toBe('completed');
    expect(view.buyer_ticket_reference_summary?.buyer_ticket_code).toBe('А1');
    expect(view.boarding_qr_payload_summary).toBeNull();
  });

  it('projects linked_ticket_cancelled_or_unavailable when canonical data is missing', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '1401',
    });
    context.services.bookingRequestService.confirmPrepayment(seeded.bookingRequestId, {
      actorType: 'system',
      actorId: 'confirm-1401',
    });
    db.pragma('foreign_keys = OFF');
    context.repositories.bookingRequests.updateById(seeded.bookingRequestId, {
      request_status: 'CONFIRMED_TO_PRESALE',
      confirmed_presale_id: 40401,
      last_status_at: clock.now().toISOString(),
    });
    db.pragma('foreign_keys = ON');

    const view =
      context.services.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(view.linked_canonical_presale_reference.presale_id).toBe(40401);
    expect(view.ticket_status_summary.deterministic_ticket_state).toBe(
      'linked_ticket_cancelled_or_unavailable'
    );
    expect(view.ticket_availability_state).toBe('unavailable');
    expect(view.payment_summary).toBeNull();
  });

  it('reads by telegram user reference and prefers a linked request deterministically', () => {
    const first = seedBookingRequest(context, clock, {
      suffix: '1501',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: first.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
    });

    clock.advanceMinutes(5);
    context.services.bookingRequestService.createBookingRequest({
      guest_profile_id: first.guest.guest_profile_id,
      seller_attribution_session_id: first.attribution.seller_attribution_session_id,
      requested_trip_date: '2026-04-13',
      requested_time_slot: '10:00',
      requested_seats: 1,
      requested_ticket_mix: { adult: 1 },
      requested_prepayment_amount: 1000,
      currency: 'RUB',
      contact_phone_e164: first.guest.phone_e164,
    });

    const view =
      context.services.guestTicketViewProjectionService.readGuestTicketViewByTelegramUserReference(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: first.guest.telegram_user_id,
          },
        }
      );

    expect(view.booking_request_reference.booking_request_id).toBe(first.bookingRequestId);
    expect(view.ticket_status_summary.deterministic_ticket_state).toBe(
      'linked_ticket_ready'
    );
  });

  it('rejects invalid and ambiguous reads deterministically', () => {
    expect(() =>
      context.services.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
        9999
      )
    ).toThrow('Invalid booking request reference');

    const first = seedBookingRequest(context, clock, {
      suffix: '1601',
    });
    const sharedPresaleId = confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: first.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
    });

    clock.advanceMinutes(2);
    const second = seedBookingRequest(context, clock, {
      suffix: '1602',
    });
    context.services.bookingRequestService.confirmPrepayment(second.bookingRequestId, {
      actorType: 'system',
      actorId: 'confirm-1602',
    });
    context.repositories.bookingRequests.updateById(second.bookingRequestId, {
      request_status: 'CONFIRMED_TO_PRESALE',
      confirmed_presale_id: sharedPresaleId,
      last_status_at: clock.now().toISOString(),
    });

    expect(() =>
      context.services.guestTicketViewProjectionService.readGuestTicketViewByCanonicalPresaleReference(
        sharedPresaleId
      )
    ).toThrow('resolves ambiguously');
  });
});
