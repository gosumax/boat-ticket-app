import { beforeEach, describe, expect, it } from 'vitest';
import {
  createBookingRequest,
  createLifecycleTestContext,
  activateHold,
  cloneJson,
  countRows,
  snapshotTelegramRowCounts,
} from './_booking-request-lifecycle-helpers.js';
import {
  TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_RESULT_VERSION,
} from '../../server/telegram/index.js';

function cancelBeforePrepayment(context, input) {
  return context.services.bookingRequestGuestCancelBeforePrepaymentService.cancelBeforePrepayment(
    input
  );
}

describe('telegram booking-request guest cancel-before-prepayment service', () => {
  let db;
  let context;
  let clocks;

  beforeEach(() => {
    ({ db, context, clocks } = createLifecycleTestContext());
  });

  it('cancels a hold-active Telegram booking request before prepayment and persists one immutable event', () => {
    const creationResult = createBookingRequest(context);
    const activeHoldState = activateHold(context, creationResult);

    const result = cancelBeforePrepayment(context, {
      booking_request_reference: activeHoldState.booking_request_reference,
      telegram_user_summary: activeHoldState.telegram_user_summary,
      idempotency_key: 'guest-cancel-1',
    });

    expect(result).toMatchObject({
      response_version:
        TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT_RESULT_VERSION,
      cancel_status: 'cancelled_before_prepayment',
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
      cancel_timestamp_summary: {
        iso: '2026-04-10T10:40:00.000Z',
        unix_seconds: 1775817600,
      },
      hold_active: false,
      request_active: false,
      dedupe_key: 'guest-cancel-1',
      idempotency_key: 'guest-cancel-1',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.hold_reference)).toBe(true);
    expect(Object.isFrozen(result.telegram_user_summary)).toBe(true);

    expect(context.repositories.bookingRequests.getById(1)).toMatchObject({
      request_status: 'GUEST_CANCELLED',
      last_status_at: '2026-04-10T10:40:00.000Z',
    });
    expect(context.repositories.bookingHolds.getById(1)).toMatchObject({
      hold_status: 'CANCELLED',
    });
    expect(countRows(db, 'telegram_booking_request_events')).toBe(3);

    const event = context.repositories.bookingRequestEvents.getById(3);
    expect(event).toMatchObject({
      booking_request_id: 1,
      booking_hold_id: 1,
      seller_attribution_session_id: 1,
      event_type: 'GUEST_CANCELLED_BEFORE_PREPAYMENT',
      event_at: '2026-04-10T10:40:00.000Z',
      actor_type: 'telegram_guest',
      actor_id: '777000111',
    });
    expect(event.event_payload).toMatchObject({
      guest_cancel_before_prepayment_source:
        'telegram_booking_request_guest_cancel_before_prepayment_service',
      lifecycle_event_type: 'GUEST_CANCELLED_BEFORE_PREPAYMENT',
      cancel_status: 'cancelled_before_prepayment',
      hold_active: false,
      request_active: false,
      idempotency_key: 'guest-cancel-1',
    });
    expect(event.event_payload.guest_cancel_before_prepayment_result).toEqual(result);
  });

  it('replays exact guest cancellation idempotently and rejects payload drift under the same key', () => {
    const creationResult = createBookingRequest(context);
    const activeHoldState = activateHold(context, creationResult);
    const input = {
      booking_request_reference: activeHoldState.booking_request_reference,
      telegram_user_summary: activeHoldState.telegram_user_summary,
      idempotency_key: 'guest-cancel-2',
    };
    const first = cancelBeforePrepayment(context, input);

    clocks.cancel.set('2026-04-10T11:40:00.000Z');
    const second = cancelBeforePrepayment(context, input);

    expect(second).toEqual(first);
    expect(countRows(db, 'telegram_booking_request_events')).toBe(3);

    expect(() =>
      cancelBeforePrepayment(context, {
        ...input,
        telegram_user_summary: {
          telegram_user_id: '999000111',
        },
      })
    ).toThrow(
      '[TELEGRAM_BOOKING_REQUEST_GUEST_CANCEL_BEFORE_PREPAYMENT] Idempotency conflict for guest cancel before prepayment: guest-cancel-2'
    );
  });

  it('rejects already-cancelled, expired, confirmed, invalid-reference, and guest-mismatch requests without writes', () => {
    const creationResult = createBookingRequest(context);
    const activeHoldState = activateHold(context, creationResult);
    const beforeRejected = snapshotTelegramRowCounts(db);

    const invalidReference = cloneJson(activeHoldState.booking_request_reference);
    invalidReference.reference_type = 'legacy_presale';

    expect(() =>
      cancelBeforePrepayment(context, {
        booking_request_reference: invalidReference,
        telegram_user_summary: activeHoldState.telegram_user_summary,
      })
    ).toThrow('Unsupported booking-request reference type: legacy_presale');

    expect(() =>
      cancelBeforePrepayment(context, {
        booking_request_reference: activeHoldState.booking_request_reference,
        telegram_user_summary: {
          telegram_user_id: 'wrong-user',
        },
      })
    ).toThrow('Telegram guest does not match booking request: 1');
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeRejected);

    cancelBeforePrepayment(context, {
      booking_request_reference: activeHoldState.booking_request_reference,
      telegram_user_summary: activeHoldState.telegram_user_summary,
      idempotency_key: 'guest-cancel-3',
    });

    expect(() =>
      cancelBeforePrepayment(context, {
        booking_request_reference: activeHoldState.booking_request_reference,
        telegram_user_summary: activeHoldState.telegram_user_summary,
        idempotency_key: 'guest-cancel-4',
      })
    ).toThrow('Booking request is already cancelled before prepayment: 1');

    ({ db, context } = createLifecycleTestContext());
    const expiredCreation = createBookingRequest(context);
    const expiredHold = activateHold(context, expiredCreation);
    context.services.bookingRequestHoldExpiryService.expireHold({
      active_hold_state: expiredHold,
    });
    expect(() =>
      cancelBeforePrepayment(context, {
        booking_request_reference: expiredHold.booking_request_reference,
        telegram_user_summary: expiredHold.telegram_user_summary,
      })
    ).toThrow('Booking request is already expired before prepayment confirmation: 1');

    ({ db, context } = createLifecycleTestContext());
    const confirmedCreation = createBookingRequest(context);
    const confirmedHold = activateHold(context, confirmedCreation);
    context.services.bookingRequestPrepaymentConfirmationService.confirmPrepayment({
      booking_request_reference: confirmedHold.booking_request_reference,
    });
    expect(() =>
      cancelBeforePrepayment(context, {
        booking_request_reference: confirmedHold.booking_request_reference,
        telegram_user_summary: confirmedHold.telegram_user_summary,
      })
    ).toThrow('Booking request is already prepayment-confirmed: 1');
  });
});
