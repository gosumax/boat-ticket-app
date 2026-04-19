import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES,
  TELEGRAM_MANUAL_FALLBACK_HANDLING_STATES,
} from '../../shared/telegram/index.js';
import {
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_manual-fallback-test-helpers.js';

describe('telegram manual fallback request-state projection service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-10T12:00:00.000Z');
    ({ db, context } = createTestContext(clock));
    wireClock(context, clock);
  });

  it('projects deterministic manual handling states by booking request reference', () => {
    const newForManual = seedBookingRequest(context, clock, {
      suffix: '9101',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    const contactInProgress = seedBookingRequest(context, clock, {
      suffix: '9102',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.manualFallbackActionService.recordManualFallbackAction({
      bookingRequestId: contactInProgress.bookingRequestId,
      actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started,
      idempotencyKey: 'request-state-call-9102',
      actorType: 'owner',
      actorId: 'owner-9102',
      actionPayload: { channel: 'phone' },
    });
    const manualNotReached = seedBookingRequest(context, clock, {
      suffix: '9103',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.manualFallbackActionService.recordManualFallbackAction({
      bookingRequestId: manualNotReached.bookingRequestId,
      actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.not_reached,
      idempotencyKey: 'request-state-not-reached-9103',
      actorType: 'owner',
      actorId: 'owner-9103',
      actionPayload: { note: 'no answer' },
    });
    const reassignedToSeller = seedBookingRequest(context, clock, {
      suffix: '9104',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.manualFallbackActionService.recordManualFallbackAction({
      bookingRequestId: reassignedToSeller.bookingRequestId,
      actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller,
      idempotencyKey: 'request-state-assign-9104',
      actorType: 'owner',
      actorId: 'owner-9104',
      actionPayload: { seller_id: 2 },
    });
    const prepaymentConfirmed = seedBookingRequest(context, clock, {
      suffix: '9105',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.bookingRequestService.confirmPrepayment(
      prepaymentConfirmed.bookingRequestId,
      {
        actorType: 'owner',
        actorId: 'owner-9105',
      }
    );
    const handedOff = seedBookingRequest(context, clock, {
      suffix: '9106',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.bookingRequestService.confirmPrepayment(handedOff.bookingRequestId, {
      actorType: 'owner',
      actorId: 'owner-9106',
    });
    const presaleId = db
      .prepare(
        `
          INSERT INTO presales (
            boat_slot_id, customer_name, customer_phone, number_of_seats, total_price
          ) VALUES (1, 'Manual Handed Off', '+79990001122', 2, 5000)
        `
      )
      .run().lastInsertRowid;
    context.repositories.bookingRequests.updateById(handedOff.bookingRequestId, {
      confirmed_presale_id: Number(presaleId),
      request_status: 'CONFIRMED_TO_PRESALE',
      last_status_at: clock.now().toISOString(),
    });
    const noLongerActionable = seedBookingRequest(context, clock, {
      suffix: '9107',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.bookingRequestService.cancelRequestByGuest(
      noLongerActionable.bookingRequestId,
      {
        actorType: 'guest',
        actorId: 'guest-9107',
      }
    );

    const projectionFor = (bookingRequestId) =>
      context.services.manualFallbackRequestStateProjectionService
        .readCurrentManualHandlingStateByBookingRequestReference(bookingRequestId);

    expect(
      projectionFor(newForManual.bookingRequestId).current_manual_handling_state
    ).toBe('new_for_manual');
    expect(
      projectionFor(contactInProgress.bookingRequestId).current_manual_handling_state
    ).toBe('manual_contact_in_progress');
    expect(
      projectionFor(manualNotReached.bookingRequestId).current_manual_handling_state
    ).toBe('manual_not_reached');
    expect(
      projectionFor(reassignedToSeller.bookingRequestId).current_manual_handling_state
    ).toBe('reassigned_to_seller');
    expect(
      projectionFor(prepaymentConfirmed.bookingRequestId).current_manual_handling_state
    ).toBe('prepayment_confirmed');
    expect(
      projectionFor(handedOff.bookingRequestId).current_manual_handling_state
    ).toBe('handed_off');
    expect(
      projectionFor(noLongerActionable.bookingRequestId).current_manual_handling_state
    ).toBe('no_longer_actionable');

    const reassignedProjection = projectionFor(reassignedToSeller.bookingRequestId);
    expect(reassignedProjection.current_route_target.route_target_type).toBe('seller');
    expect(reassignedProjection.current_route_reason).toBe('manual_assign_to_seller');
    expect(reassignedProjection.last_manual_action.action_type).toBe(
      TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller
    );
    expect(Object.isFrozen(reassignedProjection)).toBe(true);
    expect(TELEGRAM_MANUAL_FALLBACK_HANDLING_STATES).toContain(
      reassignedProjection.current_manual_handling_state
    );
  });

  it('lists handling states only for active manual queue items and rejects non-projectable reads', () => {
    const activeA = seedBookingRequest(context, clock, {
      suffix: '9201',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    const activeB = seedBookingRequest(context, clock, {
      suffix: '9202',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.manualFallbackActionService.recordManualFallbackAction({
      bookingRequestId: activeB.bookingRequestId,
      actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started,
      idempotencyKey: 'active-list-call-9202',
      actionPayload: { channel: 'phone' },
    });
    const inactiveManual = seedBookingRequest(context, clock, {
      suffix: '9203',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.bookingRequestService.cancelRequestByGuest(
      inactiveManual.bookingRequestId,
      {
        actorType: 'guest',
        actorId: 'guest-9203',
      }
    );
    const neverManualSeller = seedBookingRequest(context, clock, {
      suffix: '9204',
      sourceType: 'seller_qr',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T16:00:00.000Z',
      bindingReason: 'seller_qr',
    });

    const list = context.services.manualFallbackRequestStateProjectionService
      .listManualHandlingStatesForActiveManualQueueItems({ limit: 20 });
    const listedIds = list.items.map(
      (item) => item.booking_request_reference.booking_request_id
    );

    expect(listedIds).toContain(activeA.bookingRequestId);
    expect(listedIds).toContain(activeB.bookingRequestId);
    expect(listedIds).not.toContain(inactiveManual.bookingRequestId);
    expect(listedIds).not.toContain(neverManualSeller.bookingRequestId);
    expect(list.item_count).toBe(list.items.length);
    expect(list.items.every((item) => item.current_manual_handling_state !== 'no_longer_actionable')).toBe(true);

    expect(() =>
      context.services.manualFallbackRequestStateProjectionService
        .readCurrentManualHandlingStateByBookingRequestReference(
          neverManualSeller.bookingRequestId
        )
    ).toThrow('not projectable');
    expect(() =>
      context.services.manualFallbackRequestStateProjectionService
        .readCurrentManualHandlingStateByBookingRequestReference(
          activeA.bookingRequestId + 999
        )
    ).toThrow('Invalid booking request reference');
  });
});
