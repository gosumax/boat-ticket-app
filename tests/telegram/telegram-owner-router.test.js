import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTelegramOwnerRouter } from '../../server/telegram/owner-router.mjs';
import {
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_manual-fallback-test-helpers.js';

describe('telegram owner manual fallback router', () => {
  let db;
  let clock;
  let context;
  let app;

  beforeEach(() => {
    clock = createClock('2026-04-10T12:00:00.000Z');
    ({ db, context } = createTestContext(clock));
    wireClock(context, clock);

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 9001, role: 'owner' };
      next();
    });
    app.use(
      '/api/telegram/owner',
      createTelegramOwnerRouter({
        telegramContext: context,
        now: clock.now,
      })
    );
  });

  afterEach(() => {
    db.close();
  });

  it('loads manual fallback queue and excludes seller-actionable requests', async () => {
    const manual = seedBookingRequest(context, clock, {
      suffix: '1001',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
    });
    const sellerActionable = seedBookingRequest(context, clock, {
      suffix: '1002',
      sourceType: 'seller_qr',
      bindingReason: 'seller_qr',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T14:45:00.000Z',
    });

    const response = await request(app).get('/api/telegram/owner/manual-fallback/queue');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      response_version: 'telegram_owner_http_route_result.v1',
      route_status: 'processed',
      route_operation_type: 'owner_manual_fallback_queue_list',
      operation_result_summary: {
        list_scope: 'manual_fallback_queue_current',
        items: expect.any(Array),
      },
    });

    const ids = response.body.operation_result_summary.items.map(
      (item) => item.booking_request_reference.booking_request_id
    );

    expect(ids).toContain(manual.bookingRequestId);
    expect(ids).not.toContain(sellerActionable.bookingRequestId);

    const manualItem = response.body.operation_result_summary.items.find(
      (item) => item.booking_request_reference.booking_request_id === manual.bookingRequestId
    );
    expect(manualItem).toMatchObject({
      queue_state: 'waiting_for_manual_contact',
      requested_seats_count: 2,
      requested_prepayment_amount: 3200,
      current_route_reason: expect.any(String),
      contact_phone_summary: {
        phone_e164: expect.stringContaining('+7999888'),
      },
    });
  });

  it('wires call_started, not_reached, assign_to_seller, and manual_prepayment_confirmed actions', async () => {
    const callStarted = seedBookingRequest(context, clock, {
      suffix: '2001',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
    });
    const notReached = seedBookingRequest(context, clock, {
      suffix: '2002',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
    });
    const assignToSeller = seedBookingRequest(context, clock, {
      suffix: '2003',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
    });
    const prepayment = seedBookingRequest(context, clock, {
      suffix: '2004',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
    });

    const callStartedResponse = await request(app)
      .post(`/api/telegram/owner/manual-fallback/queue/${callStarted.bookingRequestId}/actions`)
      .send({
        action_type: 'call_started',
        idempotency_key: 'owner-router-call-2001',
      });
    expect(callStartedResponse.status).toBe(200);
    expect(callStartedResponse.body.operation_result_summary).toMatchObject({
      outcome: 'applied',
      action: 'call_started',
      booking_request_id: callStarted.bookingRequestId,
      event: {
        event_type: 'MANUAL_FALLBACK_CALL_STARTED',
      },
    });

    const notReachedResponse = await request(app)
      .post(`/api/telegram/owner/manual-fallback/queue/${notReached.bookingRequestId}/actions`)
      .send({
        action_type: 'not_reached',
        idempotency_key: 'owner-router-not-reached-2002',
      });
    expect(notReachedResponse.status).toBe(200);
    expect(notReachedResponse.body.operation_result_summary).toMatchObject({
      outcome: 'applied',
      action: 'not_reached',
      queue_item: {
        booking_request: {
          request_status: 'SELLER_NOT_REACHED',
        },
      },
    });

    const assignResponse = await request(app)
      .post(`/api/telegram/owner/manual-fallback/queue/${assignToSeller.bookingRequestId}/actions`)
      .send({
        action_type: 'assign_to_seller',
        idempotency_key: 'owner-router-assign-2003',
        action_payload: { seller_id: 2 },
      });
    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.operation_result_summary).toMatchObject({
      outcome: 'applied',
      action: 'assign_to_seller',
      queue_item: null,
      event: {
        event_type: 'MANUAL_FALLBACK_ASSIGNED_TO_SELLER',
      },
    });
    const sellerQueue = context.services.sellerWorkQueueService.listSellerWorkQueue(2);
    expect(
      sellerQueue.items.map((item) => item.booking_request.booking_request_id)
    ).toContain(assignToSeller.bookingRequestId);

    const prepaymentResponse = await request(app)
      .post(`/api/telegram/owner/manual-fallback/queue/${prepayment.bookingRequestId}/actions`)
      .send({
        action_type: 'manual_prepayment_confirmed',
        idempotency_key: 'owner-router-prepayment-2004',
      });
    expect(prepaymentResponse.status).toBe(200);
    expect(prepaymentResponse.body.operation_result_summary).toMatchObject({
      outcome: 'applied',
      action: 'manual_prepayment_confirmed',
      queue_item: {
        booking_request: {
          request_status: 'PREPAYMENT_CONFIRMED',
        },
      },
      handoff_execution: {
        current_execution_state: 'queued_for_handoff',
      },
    });
  });

  it('returns blocked responses for unavailable or expired action paths', async () => {
    const manual = seedBookingRequest(context, clock, {
      suffix: '3001',
      sourceType: 'promo_qr',
      bindingReason: 'promo_qr',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
    });
    const sellerActionable = seedBookingRequest(context, clock, {
      suffix: '3002',
      sourceType: 'seller_qr',
      bindingReason: 'seller_qr',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T14:45:00.000Z',
    });

    const first = await request(app)
      .post(`/api/telegram/owner/manual-fallback/queue/${manual.bookingRequestId}/actions`)
      .send({
        action_type: 'not_reached',
        idempotency_key: 'owner-router-close-3001',
      });
    expect(first.status).toBe(200);

    const closedAction = await request(app)
      .post(`/api/telegram/owner/manual-fallback/queue/${manual.bookingRequestId}/actions`)
      .send({
        action_type: 'call_started',
        idempotency_key: 'owner-router-blocked-3001',
      });
    expect(closedAction.status).toBe(409);
    expect(closedAction.body).toMatchObject({
      route_status: 'blocked_not_possible',
      route_operation_type: 'owner_manual_fallback_action',
      operation_result_summary: null,
    });

    const notManual = await request(app)
      .post(
        `/api/telegram/owner/manual-fallback/queue/${sellerActionable.bookingRequestId}/actions`
      )
      .send({
        action_type: 'manual_prepayment_confirmed',
        idempotency_key: 'owner-router-not-manual-3002',
      });
    expect(notManual.status).toBe(409);
    expect(notManual.body.route_status).toBe('blocked_not_possible');

    const requestStateResponse = await request(app).get(
      '/api/telegram/owner/manual-fallback/request-states/active'
    );
    expect(requestStateResponse.status).toBe(200);
    expect(requestStateResponse.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'owner_manual_fallback_request_states_active',
      operation_result_summary: {
        list_scope: 'manual_handling_states_for_active_queue',
        items: expect.any(Array),
      },
    });
  });
});
