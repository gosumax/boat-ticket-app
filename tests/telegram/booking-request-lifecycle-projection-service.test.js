import { describe, expect, it } from 'vitest';
import {
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_LIST_VERSION,
  TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION_VERSION,
} from '../../server/telegram/index.js';
import {
  activateHold,
  createBookingInput,
  createBookingRequest,
  createLifecycleTestContext,
  createSellerRouteDecision,
  expireHold,
  extendHold,
} from './_booking-request-lifecycle-helpers.js';

function readLifecycleState(context, bookingRequestReference) {
  return context.services.bookingRequestLifecycleProjectionService.readCurrentLifecycleStateByBookingRequestReference(
    {
      booking_request_reference: bookingRequestReference,
    }
  );
}

describe('telegram booking-request lifecycle projection service', () => {
  it('projects each supported Telegram booking-request lifecycle state read-only', () => {
    const newContext = createLifecycleTestContext();
    const newRequest = createBookingRequest(newContext.context);
    const newState = readLifecycleState(
      newContext.context,
      newRequest.booking_request_reference
    );

    expect(newState).toMatchObject({
      response_version: TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION_VERSION,
      projection_item_type: 'telegram_booking_request_lifecycle_projection_item',
      booking_request_status: 'NEW',
      lifecycle_state: 'new',
      hold_reference: null,
      requested_prepayment_amount: 1000,
      hold_active: false,
      request_active: true,
      request_confirmed: false,
      cancelled: false,
      expired: false,
      latest_lifecycle_timestamp_summary: {
        iso: '2026-04-10T10:30:00.000Z',
        unix_seconds: 1775817000,
      },
    });
    expect(Object.isFrozen(newState)).toBe(true);
    expect(Object.isFrozen(newState.booking_request_reference)).toBe(true);
    expect(Object.isFrozen(newState.telegram_user_summary)).toBe(true);

    const activeContext = createLifecycleTestContext();
    const activeCreation = createBookingRequest(activeContext.context);
    const activeHold = activateHold(activeContext.context, activeCreation);
    const activeState = readLifecycleState(
      activeContext.context,
      activeHold.booking_request_reference
    );

    expect(activeState).toMatchObject({
      booking_request_status: 'HOLD_ACTIVE',
      lifecycle_state: 'hold_active',
      hold_reference: {
        reference_type: 'telegram_booking_hold',
        booking_hold_id: 1,
      },
      hold_active: true,
      request_active: true,
      request_confirmed: false,
    });

    const extendedContext = createLifecycleTestContext();
    const extendedCreation = createBookingRequest(extendedContext.context);
    const extendedHold = extendHold(
      extendedContext.context,
      activateHold(extendedContext.context, extendedCreation)
    );
    const extendedState = readLifecycleState(
      extendedContext.context,
      extendedHold.booking_request_reference
    );

    expect(extendedState).toMatchObject({
      booking_request_status: 'HOLD_ACTIVE',
      lifecycle_state: 'hold_extended',
      hold_active: true,
      request_active: true,
      latest_lifecycle_timestamp_summary: {
        iso: '2026-04-10T10:35:00.000Z',
        unix_seconds: 1775817300,
      },
    });

    const expiredContext = createLifecycleTestContext();
    const expiredCreation = createBookingRequest(expiredContext.context);
    const expiredResult = expireHold(
      expiredContext.context,
      activateHold(expiredContext.context, expiredCreation)
    );
    const expiredState = readLifecycleState(
      expiredContext.context,
      expiredResult.booking_request_reference
    );

    expect(expiredState).toMatchObject({
      booking_request_status: 'HOLD_EXPIRED',
      lifecycle_state: 'hold_expired',
      hold_active: false,
      request_active: false,
      expired: true,
      latest_lifecycle_timestamp_summary: {
        iso: '2026-04-10T10:47:00.000Z',
        unix_seconds: 1775818020,
      },
    });

    const cancelledContext = createLifecycleTestContext();
    const cancelledCreation = createBookingRequest(cancelledContext.context);
    const cancelledHold = activateHold(cancelledContext.context, cancelledCreation);
    cancelledContext.context.services.bookingRequestGuestCancelBeforePrepaymentService.cancelBeforePrepayment(
      {
        booking_request_reference: cancelledHold.booking_request_reference,
        telegram_user_summary: cancelledHold.telegram_user_summary,
      }
    );
    const cancelledState = readLifecycleState(
      cancelledContext.context,
      cancelledHold.booking_request_reference
    );

    expect(cancelledState).toMatchObject({
      booking_request_status: 'GUEST_CANCELLED',
      lifecycle_state: 'cancelled_before_prepayment',
      hold_active: false,
      request_active: false,
      cancelled: true,
      expired: false,
      latest_lifecycle_timestamp_summary: {
        iso: '2026-04-10T10:40:00.000Z',
        unix_seconds: 1775817600,
      },
    });

    const confirmedContext = createLifecycleTestContext();
    const confirmedCreation = createBookingRequest(confirmedContext.context);
    const confirmedHold = activateHold(confirmedContext.context, confirmedCreation);
    confirmedContext.context.services.bookingRequestPrepaymentConfirmationService.confirmPrepayment(
      {
        booking_request_reference: confirmedHold.booking_request_reference,
      }
    );
    const confirmedState = readLifecycleState(
      confirmedContext.context,
      confirmedHold.booking_request_reference
    );

    expect(confirmedState).toMatchObject({
      booking_request_status: 'PREPAYMENT_CONFIRMED',
      lifecycle_state: 'prepayment_confirmed',
      hold_active: false,
      request_active: false,
      request_confirmed: true,
      cancelled: false,
      expired: false,
      latest_lifecycle_timestamp_summary: {
        iso: '2026-04-10T10:41:00.000Z',
        unix_seconds: 1775817660,
      },
    });
  });

  it('lists booking requests for a Telegram guest and returns the latest active-or-final state', () => {
    const { context, clocks } = createLifecycleTestContext();
    const decision = createSellerRouteDecision(context);
    const first = context.services.bookingRequestCreationService.createBookingRequest(
      createBookingInput(decision)
    );

    context.services.bookingRequestGuestCancelBeforePrepaymentService.cancelBeforePrepayment({
      booking_request_reference: first.booking_request_reference,
      telegram_user_summary: first.telegram_user_summary,
    });

    clocks.creation.set('2026-04-10T10:50:00.000Z');
    const second = context.services.bookingRequestCreationService.createBookingRequest(
      createBookingInput(decision, {
        idempotency_key: 'telegram-booking-create-2',
        requested_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: '2026-04-12',
          requested_time_slot: '14:30',
          slot_uid: 'generated:84',
          boat_slot_id: 84,
        },
      })
    );

    const list =
      context.services.bookingRequestLifecycleProjectionService.listBookingRequestsForGuest(
        {
          telegram_user_id: '777000111',
        }
      );
    const latest =
      context.services.bookingRequestLifecycleProjectionService.readLatestActiveOrFinalLifecycleStateForGuest(
        {
          telegram_user_id: '777000111',
        }
      );

    expect(list).toMatchObject({
      response_version: TELEGRAM_BOOKING_REQUEST_LIFECYCLE_LIST_VERSION,
      item_count: 2,
      items: [
        {
          booking_request_reference: {
            booking_request_id: second.booking_request_reference.booking_request_id,
          },
          lifecycle_state: 'new',
          request_active: true,
        },
        {
          booking_request_reference: {
            booking_request_id: first.booking_request_reference.booking_request_id,
          },
          lifecycle_state: 'cancelled_before_prepayment',
          request_active: false,
        },
      ],
    });
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list.items)).toBe(true);
    expect(latest.booking_request_reference.booking_request_id).toBe(
      second.booking_request_reference.booking_request_id
    );
    expect(latest.lifecycle_state).toBe('new');
  });

  it('skips non-projectable linked requests when listing lifecycle items for a guest', () => {
    const { context, clocks, db } = createLifecycleTestContext();
    const decision = createSellerRouteDecision(context);
    const first = context.services.bookingRequestCreationService.createBookingRequest(
      createBookingInput(decision, {
        idempotency_key: 'telegram-booking-create-linked-first',
      })
    );
    const firstActive = activateHold(context, first);
    context.services.bookingRequestPrepaymentConfirmationService.confirmPrepayment({
      booking_request_reference: firstActive.booking_request_reference,
      idempotency_key: 'telegram-prepayment-confirm-linked-first',
    });
    const linkedPresaleId = Number(
      db.prepare('INSERT INTO presales DEFAULT VALUES').run().lastInsertRowid
    );
    context.repositories.bookingRequests.updateById(
      firstActive.booking_request_reference.booking_request_id,
      {
        request_status: 'CONFIRMED_TO_PRESALE',
        confirmed_presale_id: linkedPresaleId,
      }
    );

    clocks.creation.set('2026-04-10T10:50:00.000Z');
    const second = context.services.bookingRequestCreationService.createBookingRequest(
      createBookingInput(decision, {
        idempotency_key: 'telegram-booking-create-linked-second',
      })
    );

    const list =
      context.services.bookingRequestLifecycleProjectionService.listBookingRequestsForGuest(
        {
          telegram_user_id: '777000111',
        }
      );

    expect(list.item_count).toBe(1);
    expect(list.items).toMatchObject([
      {
        booking_request_reference: {
          booking_request_id: second.booking_request_reference.booking_request_id,
        },
        lifecycle_state: 'new',
      },
    ]);
  });

  it('keeps lifecycle projections readable for legacy HOLD_EXPIRED rows without a HOLD_EXPIRED event', () => {
    const { context, db } = createLifecycleTestContext();
    const decision = createSellerRouteDecision(context);
    const creation = context.services.bookingRequestCreationService.createBookingRequest(
      createBookingInput(decision, {
        idempotency_key: 'telegram-booking-create-legacy-gap-first',
      })
    );
    const active = activateHold(context, creation);
    const expired = expireHold(context, active);
    const expiredBookingRequestId =
      expired.booking_request_reference.booking_request_id;

    db.prepare(
      `
        DELETE FROM telegram_booking_request_events
        WHERE booking_request_id = ? AND event_type = 'HOLD_EXPIRED'
      `
    ).run(expiredBookingRequestId);

    const secondCreation = context.services.bookingRequestCreationService.createBookingRequest(
      createBookingInput(decision, {
        idempotency_key: 'telegram-booking-create-legacy-gap-second',
      })
    );
    const secondActive = activateHold(context, secondCreation);
    context.services.bookingRequestPrepaymentConfirmationService.confirmPrepayment({
      booking_request_reference: secondActive.booking_request_reference,
      idempotency_key: 'telegram-prepayment-confirm-legacy-gap',
    });

    const list =
      context.services.bookingRequestLifecycleProjectionService.listBookingRequestsForGuest(
        {
          telegram_user_id: '777000111',
        }
      );

    expect(list.item_count).toBe(2);
    const expiredItem = list.items.find(
      (item) =>
        item.booking_request_reference.booking_request_id === expiredBookingRequestId
    );
    expect(expiredItem).toMatchObject({
      booking_request_status: 'HOLD_EXPIRED',
      lifecycle_state: 'hold_expired',
      hold_active: false,
      request_active: false,
      expired: true,
    });
    expect(Date.parse(expiredItem.latest_lifecycle_timestamp_summary.iso)).not.toBeNaN();

    const confirmedItem = list.items.find(
      (item) =>
        item.booking_request_reference.booking_request_id ===
        secondActive.booking_request_reference.booking_request_id
    );
    expect(confirmedItem).toMatchObject({
      booking_request_status: 'PREPAYMENT_CONFIRMED',
      lifecycle_state: 'prepayment_confirmed',
      hold_active: false,
      request_active: false,
      request_confirmed: true,
    });
  });

  it('rejects non-projectable booking-request lifecycle items deterministically', () => {
    const { context } = createLifecycleTestContext();
    const creationResult = createBookingRequest(context);
    context.repositories.bookingRequests.updateById(
      creationResult.booking_request_reference.booking_request_id,
      {
        request_status: 'ATTRIBUTED',
      }
    );

    expect(() =>
      readLifecycleState(context, creationResult.booking_request_reference)
    ).toThrow(
      'Booking request is not projectable inside Telegram lifecycle boundary: 1'
    );
  });
});
