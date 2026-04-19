import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES,
} from '../../shared/telegram/index.js';
import {
  createClock,
  createTestContext,
  listRequestEvents,
  seedBookingRequest,
  wireClock,
} from './_manual-fallback-test-helpers.js';

describe('telegram manual fallback action service', () => {
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-10T12:00:00.000Z');
    ({ context } = createTestContext(clock));
    wireClock(context, clock);
  });

  it('applies call_started and not_reached with strict idempotency and stable result payloads', () => {
    const manual = seedBookingRequest(context, clock, {
      suffix: '8101',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });

    const first = context.services.manualFallbackActionService.recordManualFallbackAction({
      bookingRequestId: manual.bookingRequestId,
      actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started,
      idempotencyKey: 'manual-action-call-8101',
      actorType: 'owner',
      actorId: 'owner-8101',
      actionPayload: { channel: 'phone' },
    });
    const replay = context.services.manualFallbackActionService.recordManualFallbackAction({
      bookingRequestId: manual.bookingRequestId,
      actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started,
      idempotencyKey: 'manual-action-call-8101',
      actorType: 'owner',
      actorId: 'owner-8101',
      actionPayload: { channel: 'phone' },
    });

    expect(first.action_status).toBe('applied');
    expect(replay.action_status).toBe('idempotent_replay');
    expect(replay.manual_action_event_reference.booking_request_event_id).toBe(
      first.manual_action_event_reference.booking_request_event_id
    );
    expect(first.action_type).toBe(TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started);
    expect(first.resulting_route_target.route_target_type).toBe('generic_unassigned');
    expect(first.resulting_handling_state_summary.manual_handling_state).toBe(
      'manual_contact_in_progress'
    );
    expect(first.idempotency_key).toBe('manual-action-call-8101');
    expect(first.dedupe_key).toBe('manual-action-call-8101');
    expect(Object.isFrozen(first)).toBe(true);

    expect(() =>
      context.services.manualFallbackActionService.recordManualFallbackAction({
        bookingRequestId: manual.bookingRequestId,
        actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started,
        idempotencyKey: 'manual-action-call-8101',
        actorType: 'owner',
        actorId: 'owner-8101',
        actionPayload: { channel: 'different' },
      })
    ).toThrow('Idempotency conflict');

    const notReached = context.services.manualFallbackActionService.recordManualFallbackAction({
      bookingRequestId: manual.bookingRequestId,
      actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.not_reached,
      idempotencyKey: 'manual-action-not-reached-8101',
      actorType: 'owner',
      actorId: 'owner-8101',
      actionPayload: { note: 'no answer' },
    });
    const events = listRequestEvents(context, manual.bookingRequestId);

    expect(notReached.action_status).toBe('applied');
    expect(notReached.resulting_handling_state_summary.manual_handling_state).toBe(
      'manual_not_reached'
    );
    expect(notReached.resulting_handling_state_summary.lifecycle_state).toBe(
      'SELLER_NOT_REACHED'
    );
    expect(events.filter((event) => event.event_type === 'SELLER_NOT_REACHED')).toHaveLength(1);
  });

  it('assigns actionable manual requests to seller using Telegram attribution path', () => {
    const manual = seedBookingRequest(context, clock, {
      suffix: '8201',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
      sellerId: null,
    });
    const before = context.repositories.bookingRequests.getById(manual.bookingRequestId);

    const action = context.services.manualFallbackActionService.recordManualFallbackAction({
      bookingRequestId: manual.bookingRequestId,
      actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller,
      idempotencyKey: 'manual-action-assign-8201',
      actorType: 'owner',
      actorId: 'owner-8201',
      actionPayload: { seller_id: 2 },
    });
    const after = context.repositories.bookingRequests.getById(manual.bookingRequestId);
    const events = listRequestEvents(context, manual.bookingRequestId);

    expect(action.action_status).toBe('applied');
    expect(action.resulting_route_target.route_target_type).toBe('seller');
    expect(action.resulting_route_target.seller_reference.seller_id).toBe(2);
    expect(action.resulting_handling_state_summary.manual_handling_state).toBe(
      'reassigned_to_seller'
    );
    expect(after.seller_attribution_session_id).not.toBe(before.seller_attribution_session_id);
    expect(
      events.filter((event) => event.event_type === 'MANUAL_FALLBACK_ASSIGNED_TO_SELLER')
    ).toHaveLength(1);
    expect(() =>
      context.services.manualFallbackQueueQueryService.readManualFallbackQueueItemByBookingRequestReference(
        manual.bookingRequestId
      )
    ).toThrow('No active manual path');
  });

  it('rejects deterministic invalid and incompatible action requests', () => {
    const manual = seedBookingRequest(context, clock, {
      suffix: '8301',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    const sellerActionable = seedBookingRequest(context, clock, {
      suffix: '8302',
      sourceType: 'seller_qr',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T15:00:00.000Z',
      bindingReason: 'seller_qr',
    });
    const closedManual = seedBookingRequest(context, clock, {
      suffix: '8303',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
    });
    context.services.bookingRequestService.cancelRequestByGuest(
      closedManual.bookingRequestId,
      { actorType: 'guest', actorId: 'guest-8303' }
    );

    expect(() =>
      context.services.manualFallbackActionService.recordManualFallbackAction({
        bookingRequestId: manual.bookingRequestId + 999,
        actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started,
        idempotencyKey: 'manual-invalid-ref-8301',
      })
    ).toThrow('Invalid booking request reference');

    expect(() =>
      context.services.manualFallbackActionService.recordManualFallbackAction({
        bookingRequestId: sellerActionable.bookingRequestId,
        actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started,
        idempotencyKey: 'manual-no-path-8302',
      })
    ).toThrow('No active manual path');

    expect(() =>
      context.services.manualFallbackActionService.recordManualFallbackAction({
        bookingRequestId: closedManual.bookingRequestId,
        actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.call_started,
        idempotencyKey: 'manual-closed-8303',
      })
    ).toThrow('No longer actionable request');

    expect(() =>
      context.services.manualFallbackActionService.recordManualFallbackAction({
        bookingRequestId: manual.bookingRequestId,
        actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller,
        idempotencyKey: 'manual-invalid-seller-8301',
        actionPayload: { seller_id: 999 },
      })
    ).toThrow('Invalid seller assignment target');

    const originalGetById = context.services.manualFallbackActionService
      .sellerAttributionSessions.getById;
    context.services.manualFallbackActionService.sellerAttributionSessions.getById = () => null;
    expect(() =>
      context.services.manualFallbackActionService.recordManualFallbackAction({
        bookingRequestId: manual.bookingRequestId,
        actionType: TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES.assign_to_seller,
        idempotencyKey: 'manual-incompatible-transition-8301',
        actionPayload: { seller_id: 2 },
      })
    ).toThrow('Incompatible route transition');
    context.services.manualFallbackActionService.sellerAttributionSessions.getById =
      originalGetById;
  });
});
