import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_MANUAL_FALLBACK_QUEUE_STATES,
} from '../../shared/telegram/index.js';
import {
  createClock,
  createTestContext,
  seedBookingRequest,
  seedSourceBindingEvent,
  wireClock,
} from './_manual-fallback-test-helpers.js';

describe('telegram manual fallback queue query service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-10T12:00:00.000Z');
    ({ db, context } = createTestContext(clock));
    wireClock(context, clock);
  });

  it('lists documented manual routing cases and excludes seller-actionable requests', () => {
    const ownerManual = seedBookingRequest(context, clock, {
      suffix: '7101',
      sourceType: 'promo_qr',
      sourceName: 'Owner Manual Case',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      bindingReason: 'owner_source',
    });
    const noSource = seedBookingRequest(context, clock, {
      suffix: '7102',
      sourceType: 'seller_qr',
      sourceName: 'No Source Case',
      sellerId: null,
      attributionStatus: 'INACTIVE',
      bindingReason: 'seller_qr',
    });
    seedSourceBindingEvent(context, clock, {
      telegramUserId: noSource.guest.telegram_user_id,
      bindingStatus: 'no_source_token',
      resolvedSourceFamily: null,
      rawSourceToken: null,
      normalizedSourceToken: null,
    });
    const unresolvedSource = seedBookingRequest(context, clock, {
      suffix: '7103',
      sourceType: 'seller_qr',
      sourceName: 'Unresolved Source Case',
      sellerId: null,
      attributionStatus: 'INACTIVE',
      bindingReason: 'seller_qr',
    });
    seedSourceBindingEvent(context, clock, {
      telegramUserId: unresolvedSource.guest.telegram_user_id,
      bindingStatus: 'unresolved_source_token',
      resolvedSourceFamily: null,
      rawSourceToken: 'unknown_token_7103',
      normalizedSourceToken: 'unknown_token_7103',
    });
    const attributionExpired = seedBookingRequest(context, clock, {
      suffix: '7104',
      sourceType: 'seller_qr',
      sourceName: 'Expired Attribution Case',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T11:00:00.000Z',
      bindingReason: 'seller_qr',
    });
    const genericManual = seedBookingRequest(context, clock, {
      suffix: '7105',
      sourceType: 'promo_qr',
      sourceName: 'Generic Manual Case',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      bindingReason: 'promo_qr',
    });
    const sellerActionable = seedBookingRequest(context, clock, {
      suffix: '7106',
      sourceType: 'seller_qr',
      sourceName: 'Seller Actionable Case',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T16:00:00.000Z',
      bindingReason: 'seller_qr',
    });

    const queue =
      context.services.manualFallbackQueueQueryService.listCurrentManualFallbackQueueItems(
        { limit: 20 }
      );
    const itemByRequestId = new Map(
      queue.items.map((item) => [
        item.booking_request_reference.booking_request_id,
        item,
      ])
    );

    expect(itemByRequestId.has(ownerManual.bookingRequestId)).toBe(true);
    expect(itemByRequestId.has(noSource.bookingRequestId)).toBe(true);
    expect(itemByRequestId.has(unresolvedSource.bookingRequestId)).toBe(true);
    expect(itemByRequestId.has(attributionExpired.bookingRequestId)).toBe(true);
    expect(itemByRequestId.has(genericManual.bookingRequestId)).toBe(true);
    expect(itemByRequestId.has(sellerActionable.bookingRequestId)).toBe(false);

    expect(
      itemByRequestId.get(ownerManual.bookingRequestId).current_route_target.route_target_type
    ).toBe('owner_manual');
    expect(itemByRequestId.get(noSource.bookingRequestId).current_route_reason).toBe(
      'no_source_token'
    );
    expect(itemByRequestId.get(unresolvedSource.bookingRequestId).current_route_reason).toBe(
      'unresolved_source_token'
    );
    expect(
      itemByRequestId.get(attributionExpired.bookingRequestId).current_route_reason
    ).toBe('seller_attribution_expired');
    expect(
      itemByRequestId.get(genericManual.bookingRequestId).current_route_target.route_target_type
    ).toBe('generic_unassigned');
    expect(Object.isFrozen(queue)).toBe(true);
    expect(Object.isFrozen(queue.items)).toBe(true);
    expect(Object.isFrozen(queue.items[0])).toBe(true);
  });

  it('projects all deterministic manual queue states and supports active-state filter API', () => {
    const waiting = seedBookingRequest(context, clock, {
      suffix: '7201',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    const holdExtended = seedBookingRequest(context, clock, {
      suffix: '7202',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.bookingRequestService.extendHoldOnce(holdExtended.bookingRequestId, {
      actorType: 'owner',
      actorId: 'owner-hold-7202',
    });
    const contactInProgress = seedBookingRequest(context, clock, {
      suffix: '7203',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.manualFallbackActionService.recordManualFallbackAction({
      bookingRequestId: contactInProgress.bookingRequestId,
      actionType: 'call_started',
      idempotencyKey: 'manual-call-7203',
      actorType: 'owner',
      actorId: 'owner-call-7203',
      actionPayload: { channel: 'phone' },
    });
    const manualNotReached = seedBookingRequest(context, clock, {
      suffix: '7204',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.manualFallbackActionService.recordManualFallbackAction({
      bookingRequestId: manualNotReached.bookingRequestId,
      actionType: 'not_reached',
      idempotencyKey: 'manual-not-reached-7204',
      actorType: 'owner',
      actorId: 'owner-not-reached-7204',
      actionPayload: { note: 'no answer' },
    });
    const prepaymentConfirmed = seedBookingRequest(context, clock, {
      suffix: '7205',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.bookingRequestService.confirmPrepayment(
      prepaymentConfirmed.bookingRequestId,
      {
        actorType: 'owner',
        actorId: 'owner-prepayment-7205',
      }
    );
    const noLongerActionable = seedBookingRequest(context, clock, {
      suffix: '7206',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.bookingRequestService.cancelRequestByGuest(
      noLongerActionable.bookingRequestId,
      {
        actorType: 'guest',
        actorId: 'guest-cancel-7206',
      }
    );

    const queue =
      context.services.manualFallbackQueueQueryService.listCurrentManualFallbackQueueItems(
        { limit: 20 }
      );
    const stateByRequestId = new Map(
      queue.items.map((item) => [
        item.booking_request_reference.booking_request_id,
        item.queue_state,
      ])
    );

    expect(stateByRequestId.get(waiting.bookingRequestId)).toBe(
      'waiting_for_manual_contact'
    );
    expect(stateByRequestId.get(holdExtended.bookingRequestId)).toBe(
      'hold_extended_waiting_manual'
    );
    expect(stateByRequestId.get(contactInProgress.bookingRequestId)).toBe(
      'manual_contact_in_progress'
    );
    expect(stateByRequestId.get(manualNotReached.bookingRequestId)).toBe(
      'manual_not_reached'
    );
    expect(stateByRequestId.get(prepaymentConfirmed.bookingRequestId)).toBe(
      'prepayment_confirmed_waiting_handoff'
    );
    expect(stateByRequestId.get(noLongerActionable.bookingRequestId)).toBe(
      'no_longer_actionable'
    );

    const filtered =
      context.services.manualFallbackQueueQueryService.listManualFallbackQueueItemsByActiveHandlingState(
        {
          active_handling_state: 'manual_contact_in_progress',
        }
      );
    expect(filtered.items).toHaveLength(1);
    expect(
      filtered.items[0].booking_request_reference.booking_request_id
    ).toBe(contactInProgress.bookingRequestId);
    expect(TELEGRAM_MANUAL_FALLBACK_QUEUE_STATES).toContain(
      filtered.items[0].queue_state
    );
  });

  it('reads one queue item by booking request reference and rejects invalid/non-manual paths', () => {
    const manual = seedBookingRequest(context, clock, {
      suffix: '7301',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    const sellerActionable = seedBookingRequest(context, clock, {
      suffix: '7302',
      sourceType: 'seller_qr',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T15:00:00.000Z',
      bindingReason: 'seller_qr',
    });

    const queueItem =
      context.services.manualFallbackQueueQueryService.readManualFallbackQueueItemByBookingRequestReference(
        manual.bookingRequestId
      );

    expect(queueItem.booking_request_reference.booking_request_id).toBe(
      manual.bookingRequestId
    );
    expect(queueItem.source_binding_summary).toBeNull();
    expect(queueItem.attribution_summary).toBeTruthy();
    expect(queueItem.requested_trip_slot_reference.requested_trip_date).toBe(
      '2026-04-12'
    );
    expect(queueItem.requested_seats_count).toBe(2);
    expect(queueItem.requested_prepayment_amount).toBe(3200);
    expect(Object.isFrozen(queueItem)).toBe(true);

    expect(() =>
      context.services.manualFallbackQueueQueryService.readManualFallbackQueueItemByBookingRequestReference(
        sellerActionable.bookingRequestId
      )
    ).toThrow('No active manual path');
    expect(() =>
      context.services.manualFallbackQueueQueryService.readManualFallbackQueueItemByBookingRequestReference(
        manual.bookingRequestId + 999
      )
    ).toThrow('Invalid booking request reference');
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });
});
