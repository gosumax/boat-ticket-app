import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_MINI_APP_BOOKING_SUBMIT_RESULT_VERSION,
} from '../../server/telegram/index.js';
import {
  createMiniAppFoundationContext,
  MINI_APP_FUTURE_DATE,
} from './_mini-app-foundation-test-helpers.js';

function countRows(db, tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

describe('telegram mini app booking-submit orchestration service', () => {
  let db;
  let context;
  let routingDecision;

  beforeEach(() => {
    const seeded = createMiniAppFoundationContext();
    db = seeded.db;
    context = seeded.context;
    routingDecision = seeded.routingDecision;
  });

  function buildSubmitInput(overrides = {}) {
    return {
      telegram_guest: routingDecision.telegram_user_summary,
      selected_trip_slot_reference: {
        reference_type: 'telegram_requested_trip_slot_reference',
        requested_trip_date: MINI_APP_FUTURE_DATE,
        requested_time_slot: '12:00',
        slot_uid: 'generated:42',
      },
      requested_seats: 2,
      requested_prepayment_amount: 1000,
      customer_name: 'Мария',
      contact_phone: '+79990000000',
      idempotency_key: 'mini-submit-1',
      ...overrides,
    };
  }

  it('submits one booking request with an initial hold and replays idempotently', () => {
    const first =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput()
      );
    const replay =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput()
      );

    expect(first).toMatchObject({
      response_version: TELEGRAM_MINI_APP_BOOKING_SUBMIT_RESULT_VERSION,
      submit_status: 'submitted_with_hold',
      submit_reason_code: null,
      telegram_user_summary: {
        telegram_user_id: '777000111',
        display_name: 'Мария',
      },
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: 1,
      },
      hold_reference: {
        reference_type: 'telegram_booking_hold',
        booking_hold_id: 1,
      },
      current_route_target: {
        route_target_type: 'seller',
      },
      selected_trip_slot_reference: {
        slot_uid: 'generated:42',
      },
      requested_seats_count: 2,
      requested_prepayment_amount: 1000,
      contact_phone_summary: {
        phone_e164: '+79990000000',
      },
      seller_contact_summary: {
        seller_display_name: 'Seller A',
        seller_phone_e164: '+79991112233',
      },
      hold_started_at_summary: {
        iso: '2036-04-10T10:31:00.000Z',
      },
      hold_expires_at_summary: {
        iso: '2036-04-10T10:46:00.000Z',
      },
      latest_timestamp_summary: {
        iso: '2036-04-10T10:31:00.000Z',
      },
      idempotency_key: 'mini-submit-1',
      dedupe_key: 'mini-submit-1',
    });
    expect(replay).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.telegram_user_summary)).toBe(true);
    expect(context.repositories.guestProfiles.getById(1)).toMatchObject({
      display_name: 'Мария',
    });
    expect(countRows(db, 'telegram_booking_requests')).toBe(1);
    expect(countRows(db, 'telegram_booking_holds')).toBe(1);
    expect(countRows(db, 'telegram_booking_request_events')).toBe(2);
  });

  it('prefers managed seller public profile over source metadata in submit result', () => {
    db.prepare(
      `
        UPDATE users
        SET public_display_name = ?, public_phone_e164 = ?
        WHERE id = 1
      `
    ).run('Анна Соколова', '+79995554433');

    const result =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput({
          idempotency_key: 'mini-submit-public-profile',
        })
      );

    expect(result.seller_contact_summary).toMatchObject({
      seller_display_name: 'Анна Соколова',
      seller_phone_e164: '+79995554433',
      source_metadata_origin: 'seller_user_public_profile',
    });
  });

  it('does not leak internal seller username when public buyer profile is unavailable', () => {
    db.prepare(
      `
        UPDATE telegram_source_qr_codes
        SET entry_context = ?
        WHERE source_qr_code_id = 1
      `
    ).run(JSON.stringify({ code: 'seller-qr-a' }));

    const result =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput({
          idempotency_key: 'mini-submit-no-login-leak',
        })
      );

    expect(result.seller_contact_summary).toMatchObject({
      seller_display_name: 'Продавец',
      seller_phone_e164: null,
      source_metadata_origin: 'seller_user_fallback_label',
    });
    expect(result.seller_contact_summary.seller_display_name).not.toBe('seller-a');
  });

  it('returns submit_failed_validation for deterministic input validation failures', () => {
    const invalidCustomerName =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput({ customer_name: '' })
      );
    expect(invalidCustomerName.submit_status).toBe('submit_failed_validation');
    expect(invalidCustomerName.submit_reason_code).toBe('invalid_customer_name');

    const invalidPhone =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput({ contact_phone: '79990000000' })
      );
    expect(invalidPhone.submit_status).toBe('submit_failed_validation');
    expect(invalidPhone.submit_reason_code).toBe('invalid_contact_phone');

    const invalidSeats =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput({ requested_seats: 0, idempotency_key: 'mini-submit-invalid-seats' })
      );
    expect(invalidSeats.submit_status).toBe('submit_failed_validation');
    expect(invalidSeats.submit_reason_code).toBe('invalid_seats_count');

    const invalidTripReference =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput({
          idempotency_key: 'mini-submit-invalid-trip',
          selected_trip_slot_reference: {
            reference_type: 'telegram_requested_trip_slot_reference',
            requested_trip_date: MINI_APP_FUTURE_DATE,
            requested_time_slot: '12:00',
            slot_uid: 'generated:999',
          },
        })
      );
    expect(invalidTripReference.submit_status).toBe('submit_failed_validation');
    expect(invalidTripReference.submit_reason_code).toBe('invalid_trip_slot_reference');
    expect(countRows(db, 'telegram_booking_requests')).toBe(0);
    expect(countRows(db, 'telegram_booking_holds')).toBe(0);
  });

  it('persists a mixed buyer ticket selection and blocks requests above live available seats', () => {
    const mixedSubmit =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput({
          selected_trip_slot_reference: {
            reference_type: 'telegram_requested_trip_slot_reference',
            requested_trip_date: MINI_APP_FUTURE_DATE,
            requested_time_slot: '10:00',
            slot_uid: 'generated:41',
          },
          requested_seats: 4,
          requested_ticket_mix: {
            adult: 2,
            teen: 1,
            child: 1,
          },
          idempotency_key: 'mini-submit-mixed',
        })
      );

    expect(mixedSubmit.submit_status).toBe('submitted_with_hold');
    expect(context.repositories.bookingRequests.getById(1)).toMatchObject({
      requested_seats: 4,
      requested_ticket_mix: {
        adult: 2,
        teen: 1,
        child: 1,
      },
    });

    const overCapacitySubmit =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput({
          selected_trip_slot_reference: {
            reference_type: 'telegram_requested_trip_slot_reference',
            requested_trip_date: MINI_APP_FUTURE_DATE,
            requested_time_slot: '12:00',
            slot_uid: 'generated:42',
          },
          requested_seats: 3,
          requested_ticket_mix: {
            adult: 2,
            child: 1,
          },
          idempotency_key: 'mini-submit-over-capacity',
        })
      );

    expect(overCapacitySubmit.submit_status).toBe('submit_blocked');
    expect(overCapacitySubmit.submit_reason_code).toBe('not_enough_seats');
    expect(countRows(db, 'telegram_booking_requests')).toBe(1);
    expect(countRows(db, 'telegram_booking_holds')).toBe(1);
  });

  it('returns submit_blocked for no routing state, duplicate active request, and deterministic idempotency conflicts', () => {
    context.repositories.guestProfiles.create({
      telegram_user_id: '888000999',
      display_name: 'No Route Guest',
      username: 'no_route_guest',
      language_code: 'ru',
      phone_e164: '+79998887766',
      consent_status: 'granted',
      profile_status: 'active',
    });
    const noRouteBlocked =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest({
        telegram_guest: {
          telegram_user_id: '888000999',
        },
        selected_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: MINI_APP_FUTURE_DATE,
          requested_time_slot: '10:00',
          slot_uid: 'generated:41',
        },
        requested_seats: 1,
        requested_prepayment_amount: 500,
        customer_name: 'No Route Guest',
        contact_phone: '+79998887766',
        idempotency_key: 'mini-submit-no-route',
      });
    expect(noRouteBlocked.submit_status).toBe('submit_blocked');
    expect(noRouteBlocked.submit_reason_code).toBe('no_valid_routing_state');

    const first =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput({ idempotency_key: 'mini-submit-first' })
      );
    expect(first.submit_status).toBe('submitted_with_hold');

    const duplicateActive =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput({ idempotency_key: 'mini-submit-second' })
      );
    expect(duplicateActive.submit_status).toBe('submit_blocked');
    expect(duplicateActive.submit_reason_code).toBe('duplicate_active_request');

    const idempotencyConflict =
      context.services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest(
        buildSubmitInput({
          idempotency_key: 'mini-submit-first',
          requested_seats: 1,
        })
      );
    expect(idempotencyConflict.submit_status).toBe('submit_blocked');
    expect(idempotencyConflict.submit_reason_code).toBe('idempotency_conflict');
    expect(countRows(db, 'telegram_booking_requests')).toBe(1);
    expect(countRows(db, 'telegram_booking_holds')).toBe(1);
    expect(countRows(db, 'telegram_booking_request_events')).toBe(2);
  });
});
