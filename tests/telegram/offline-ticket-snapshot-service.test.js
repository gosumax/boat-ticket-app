import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_OFFLINE_TICKET_SNAPSHOT_STATUSES,
} from '../../shared/telegram/index.js';
import {
  confirmAndLinkToPresale,
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram offline ticket snapshot service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-10T08:00:00.000Z');
    ({ db, context } = createTestContext(clock));
    wireClock(context, clock);
  });

  it('builds offline_snapshot_ready from linked ready ticket projection', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '2101',
      requestedTripDate: '2026-04-12',
      requestedTimeSlot: '11:00',
      requestedSeats: 2,
    });
    const presaleId = confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE', 'ACTIVE'],
      numberOfSeats: 2,
      totalPrice: 6000,
      prepaymentAmount: 2000,
      businessDay: '2026-04-12',
    });

    const snapshot =
      context.services.offlineTicketSnapshotService.buildOfflineTicketSnapshotByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(snapshot.offline_snapshot_status).toBe('offline_snapshot_ready');
    expect(snapshot.booking_request_reference.booking_request_id).toBe(seeded.bookingRequestId);
    expect(snapshot.linked_canonical_presale_reference.presale_id).toBe(presaleId);
    expect(snapshot.minimal_ticket_identity_summary.deterministic_ticket_state).toBe(
      'linked_ticket_ready'
    );
    expect(snapshot.offline_safe_code_reference_summary.offline_reference_code).toContain(
      `TG-${seeded.bookingRequestId}-`
    );
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(TELEGRAM_OFFLINE_TICKET_SNAPSHOT_STATUSES).toContain(
      snapshot.offline_snapshot_status
    );
  });

  it('returns stable offline_unavailable when canonical linkage is missing', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '2201',
    });
    context.services.bookingRequestService.confirmPrepayment(seeded.bookingRequestId, {
      actorType: 'system',
      actorId: 'confirm-2201',
    });
    db.pragma('foreign_keys = OFF');
    context.repositories.bookingRequests.updateById(seeded.bookingRequestId, {
      request_status: 'CONFIRMED_TO_PRESALE',
      confirmed_presale_id: 882201,
      last_status_at: clock.now().toISOString(),
    });
    db.pragma('foreign_keys = ON');

    const snapshot =
      context.services.offlineTicketSnapshotService.buildOfflineTicketSnapshotByBookingRequestReference(
        seeded.bookingRequestId
      );

    expect(snapshot.offline_snapshot_status).toBe('offline_unavailable');
    expect(snapshot.booking_request_reference.booking_request_id).toBe(seeded.bookingRequestId);
    expect(snapshot.minimal_ticket_identity_summary.deterministic_ticket_state).toBe(
      'linked_ticket_cancelled_or_unavailable'
    );
    expect(snapshot.degradation_reason).toContain('offline_unavailable');
  });

  it('builds snapshot by telegram user reference', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '2301',
      requestedTripDate: '2026-04-14',
      requestedTimeSlot: '09:30',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-14',
    });

    const snapshot =
      context.services.offlineTicketSnapshotService.buildOfflineTicketSnapshotByTelegramUserReference(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: seeded.guest.telegram_user_id,
          },
        }
      );

    expect(snapshot.offline_snapshot_status).toBe('offline_snapshot_ready');
    expect(snapshot.booking_request_reference.booking_request_id).toBe(seeded.bookingRequestId);
  });

  it('rejects invalid booking request reads deterministically', () => {
    expect(() =>
      context.services.offlineTicketSnapshotService.buildOfflineTicketSnapshotByBookingRequestReference(
        0
      )
    ).toThrow('booking_request_reference.booking_request_id must be a positive integer');

    expect(() =>
      context.services.offlineTicketSnapshotService.buildOfflineTicketSnapshotByBookingRequestReference(
        9999
      )
    ).toThrow('Invalid booking request reference');
  });
});
