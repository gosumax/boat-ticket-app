import { beforeEach, describe, expect, it } from 'vitest';
import {
  activateHold,
  cloneJson,
  countRows,
  createBookingRequest,
  createLifecycleTestContext,
  extendHold,
  snapshotTelegramRowCounts,
} from './_booking-request-lifecycle-helpers.js';
import {
  TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMATION_RESULT_VERSION,
} from '../../server/telegram/index.js';

function confirmPrepayment(context, input) {
  return context.services.bookingRequestPrepaymentConfirmationService.confirmPrepayment(
    input
  );
}

describe('telegram booking-request prepayment confirmation service', () => {
  let db;
  let context;
  let clocks;

  beforeEach(() => {
    ({ db, context, clocks } = createLifecycleTestContext());
  });

  it('confirms prepayment after an initial hold and persists one immutable confirmation event', () => {
    const creationResult = createBookingRequest(context);
    const activeHoldState = activateHold(context, creationResult);

    const result = confirmPrepayment(context, {
      booking_request_reference: activeHoldState.booking_request_reference,
      idempotency_key: 'confirm-1',
    });

    expect(result).toMatchObject({
      response_version:
        TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMATION_RESULT_VERSION,
      confirmation_status: 'prepayment_confirmed',
      telegram_user_summary: {
        telegram_user_id: '777000111',
        display_name: 'Alex Boat',
      },
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: 1,
      },
      hold_reference: {
        reference_type: 'telegram_booking_hold',
        booking_hold_id: 1,
        booking_request_id: 1,
      },
      requested_trip_slot_reference: {
        reference_type: 'telegram_requested_trip_slot_reference',
        requested_trip_date: '2026-04-11',
        requested_time_slot: '12:00',
        slot_uid: 'generated:42',
        boat_slot_id: 42,
      },
      requested_seats: 2,
      requested_prepayment_amount: 1000,
      confirmation_timestamp_summary: {
        iso: '2026-04-10T10:41:00.000Z',
        unix_seconds: 1775817660,
      },
      hold_active: false,
      request_confirmed: true,
      dedupe_key: 'confirm-1',
      idempotency_key: 'confirm-1',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.booking_request_reference)).toBe(true);

    expect(context.repositories.bookingRequests.getById(1)).toMatchObject({
      request_status: 'PREPAYMENT_CONFIRMED',
      last_status_at: '2026-04-10T10:41:00.000Z',
    });
    expect(context.repositories.bookingHolds.getById(1)).toMatchObject({
      hold_status: 'CONVERTED',
    });
    expect(countRows(db, 'telegram_booking_request_events')).toBe(3);

    const event = context.repositories.bookingRequestEvents.getById(3);
    expect(event).toMatchObject({
      booking_request_id: 1,
      booking_hold_id: 1,
      seller_attribution_session_id: 1,
      event_type: 'PREPAYMENT_CONFIRMED',
      event_at: '2026-04-10T10:41:00.000Z',
      actor_type: 'system',
      actor_id: 'telegram-prepayment-confirmation-service',
    });
    expect(event.event_payload).toMatchObject({
      prepayment_confirmation_source:
        'telegram_booking_request_prepayment_confirmation_service',
      confirmation_status: 'prepayment_confirmed',
      hold_active: false,
      request_confirmed: true,
      idempotency_key: 'confirm-1',
    });
    expect(event.event_payload.prepayment_confirmation_result).toEqual(result);
  });

  it('supports confirmation after a once-extended hold and preserves strict idempotency', () => {
    const creationResult = createBookingRequest(context);
    const extendedHoldState = extendHold(
      context,
      activateHold(context, creationResult)
    );
    const input = {
      booking_request_reference: extendedHoldState.booking_request_reference,
      idempotency_key: 'confirm-2',
    };

    const first = confirmPrepayment(context, input);
    clocks.confirmation.set('2026-04-10T11:41:00.000Z');
    const second = confirmPrepayment(context, input);

    expect(first.confirmation_status).toBe('prepayment_confirmed');
    expect(second).toEqual(first);
    expect(countRows(db, 'telegram_booking_request_events')).toBe(4);

    expect(() =>
      confirmPrepayment(context, {
        booking_request_reference: {
          ...input.booking_request_reference,
          booking_request_id: 999,
        },
        idempotency_key: 'confirm-2',
      })
    ).toThrow(
      '[TELEGRAM_BOOKING_REQUEST_PREPAYMENT_CONFIRMATION] Idempotency conflict for prepayment confirmation: confirm-2'
    );
  });

  it('rejects already-confirmed, expired, cancelled, invalid-reference, and no-active-state confirmation attempts without writes', () => {
    const creationResult = createBookingRequest(context);
    const beforeRejected = snapshotTelegramRowCounts(db);

    const invalidReference = cloneJson(creationResult.booking_request_reference);
    invalidReference.reference_type = 'legacy_presale';

    expect(() =>
      confirmPrepayment(context, {
        booking_request_reference: invalidReference,
      })
    ).toThrow('Unsupported booking-request reference type: legacy_presale');

    expect(() =>
      confirmPrepayment(context, {
        booking_request_reference: creationResult.booking_request_reference,
      })
    ).toThrow('No valid active request state for prepayment confirmation: 1');
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeRejected);

    ({ db, context } = createLifecycleTestContext());
    const confirmedCreation = createBookingRequest(context);
    const confirmedHold = activateHold(context, confirmedCreation);
    confirmPrepayment(context, {
      booking_request_reference: confirmedHold.booking_request_reference,
      idempotency_key: 'confirm-3',
    });
    expect(() =>
      confirmPrepayment(context, {
        booking_request_reference: confirmedHold.booking_request_reference,
        idempotency_key: 'confirm-4',
      })
    ).toThrow('Booking request is already prepayment-confirmed: 1');

    ({ db, context } = createLifecycleTestContext());
    const expiredCreation = createBookingRequest(context);
    const expiredHold = activateHold(context, expiredCreation);
    context.services.bookingRequestHoldExpiryService.expireHold({
      active_hold_state: expiredHold,
    });
    expect(() =>
      confirmPrepayment(context, {
        booking_request_reference: expiredHold.booking_request_reference,
      })
    ).toThrow('Booking request is already expired before prepayment confirmation: 1');

    ({ db, context } = createLifecycleTestContext());
    const cancelledCreation = createBookingRequest(context);
    const cancelledHold = activateHold(context, cancelledCreation);
    context.services.bookingRequestGuestCancelBeforePrepaymentService.cancelBeforePrepayment(
      {
        booking_request_reference: cancelledHold.booking_request_reference,
        telegram_user_summary: cancelledHold.telegram_user_summary,
      }
    );
    expect(() =>
      confirmPrepayment(context, {
        booking_request_reference: cancelledHold.booking_request_reference,
      })
    ).toThrow('Booking request is already cancelled before prepayment: 1');
  });
});
