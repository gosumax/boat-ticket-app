import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import { createTelegramSellerRouter } from '../../server/telegram/seller-router.mjs';

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      role TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE presales (
      id INTEGER PRIMARY KEY AUTOINCREMENT
    );
  `);
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (1, 'seller-one', 'seller', 1)`
  ).run();
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (2, 'seller-two', 'seller', 1)`
  ).run();
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (3, 'dispatcher-one', 'dispatcher', 1)`
  ).run();
  return db;
}

function createClock(startIso) {
  let current = new Date(startIso);
  return {
    now: () => new Date(current),
    set(isoTimestamp) {
      current = new Date(isoTimestamp);
    },
  };
}

function seedSellerRequest(context, { sellerId = 1, suffix = '1001' } = {}) {
  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-router-${suffix}`,
    display_name: `Seller Router Guest ${suffix}`,
    username: `seller_router_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999444${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-router-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Router Source ${suffix}`,
    default_seller_id: sellerId,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-router-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: { zone: `seller-router-zone-${suffix}` },
    is_active: 1,
  });
  const attribution = services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    entry_channel: 'qr',
  });
  const lifecycle = services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id:
      attribution.sellerAttributionSession.seller_attribution_session_id,
    requested_trip_date: '2036-04-11',
    requested_time_slot: '12:00',
    requested_seats: 2,
    requested_ticket_mix: { adult: 2 },
    requested_prepayment_amount: 1000,
    currency: 'RUB',
    contact_phone_e164: `+7999444${suffix}`,
  });

  return {
    bookingRequestId: lifecycle.bookingRequest.booking_request_id,
  };
}

describe('telegram seller router', () => {
  let db;
  let context;
  let clock;
  let app;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2036-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    context.services.attributionService.now = clock.now;
    context.services.bookingRequestService.now = clock.now;
    context.services.sellerWorkQueueService.now = clock.now;

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 1, role: 'seller' };
      next();
    });
    app.use(
      '/api/telegram/seller',
      createTelegramSellerRouter({
        telegramContext: context,
        now: clock.now,
      })
    );
  });

  afterEach(() => {
    db.close();
  });

  it('lists seller work queue via HTTP seam', async () => {
    seedSellerRequest(context, { suffix: '1001' });
    seedSellerRequest(context, { suffix: '1002' });
    seedSellerRequest(context, { sellerId: 2, suffix: '1003' });

    const response = await request(app).get('/api/telegram/seller/work-queue');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      response_version: 'telegram_seller_http_route_result.v1',
      route_status: 'processed',
      route_operation_type: 'seller_work_queue_list',
      operation_result_summary: {
        seller_id: 1,
        items: expect.any(Array),
      },
    });
    expect(response.body.operation_result_summary.items.length).toBe(2);
    expect(response.body.operation_result_summary.items[0]).toMatchObject({
      queue_item_type: 'active_booking_request',
      available_actions: expect.arrayContaining([
        'call_started',
        'not_reached',
        'prepayment_confirmed',
        'cancel_request',
      ]),
    });
  });

  it('wires call_started, hold_extend, prepayment_confirmed, not_reached note, and cancel_request actions', async () => {
    const callStarted = seedSellerRequest(context, { suffix: '2001' });
    const holdExtend = seedSellerRequest(context, { suffix: '2002' });
    const prepayment = seedSellerRequest(context, { suffix: '2003' });
    const notReached = seedSellerRequest(context, { suffix: '2004' });
    const cancelled = seedSellerRequest(context, { suffix: '2005' });

    const callStartedResponse = await request(app)
      .post(`/api/telegram/seller/work-queue/${callStarted.bookingRequestId}/actions`)
      .send({
        action_type: 'call_started',
        idempotency_key: 'seller-router-call-started',
      });
    expect(callStartedResponse.status).toBe(200);
    expect(callStartedResponse.body.operation_result_summary).toMatchObject({
      action: 'call_started',
      outcome: 'applied',
      booking_request_id: callStarted.bookingRequestId,
    });

    const replayResponse = await request(app)
      .post(`/api/telegram/seller/work-queue/${callStarted.bookingRequestId}/actions`)
      .send({
        action_type: 'call_started',
        idempotency_key: 'seller-router-call-started',
      });
    expect(replayResponse.status).toBe(200);
    expect(replayResponse.body.operation_result_summary.outcome).toBe('idempotent_replay');

    const holdExtendResponse = await request(app)
      .post(`/api/telegram/seller/work-queue/${holdExtend.bookingRequestId}/actions`)
      .send({
        action_type: 'hold_extend',
        idempotency_key: 'seller-router-hold-extend',
      });
    expect(holdExtendResponse.status).toBe(200);
    expect(holdExtendResponse.body.operation_result_summary).toMatchObject({
      action: 'hold_extend',
      outcome: 'applied',
      queue_item: {
        booking_hold: {
          hold_status: 'EXTENDED',
        },
      },
    });

    const prepaymentResponse = await request(app)
      .post(`/api/telegram/seller/work-queue/${prepayment.bookingRequestId}/actions`)
      .send({
        action_type: 'prepayment_confirmed',
        idempotency_key: 'seller-router-prepayment',
        action_payload: {
          accepted_prepayment_amount: 1700,
        },
      });
    expect(prepaymentResponse.status).toBe(200);
    expect(prepaymentResponse.body.operation_result_summary.queue_item.booking_request.request_status).toBe(
      'PREPAYMENT_CONFIRMED'
    );
    expect(prepaymentResponse.body.operation_result_summary.event.event_payload.accepted_prepayment_amount).toBe(1700);

    const notReachedResponse = await request(app)
      .post(`/api/telegram/seller/work-queue/${notReached.bookingRequestId}/actions`)
      .send({
        action_type: 'not_reached',
        idempotency_key: 'seller-router-not-reached',
      });
    expect(notReachedResponse.status).toBe(200);
    expect(notReachedResponse.body.operation_result_summary.queue_item.booking_request.request_status).toBe(
      'HOLD_ACTIVE'
    );
    expect(notReachedResponse.body.operation_result_summary.event.event_type).toBe(
      'SELLER_NOT_REACHED_NOTE'
    );

    const cancelResponse = await request(app)
      .post(`/api/telegram/seller/work-queue/${cancelled.bookingRequestId}/actions`)
      .send({
        action_type: 'cancel_request',
        idempotency_key: 'seller-router-cancel',
      });
    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.operation_result_summary.queue_item.booking_request.request_status).toBe(
      'GUEST_CANCELLED'
    );
  });

  it('returns deterministic blocked response for unavailable requests', async () => {
    const unavailable = seedSellerRequest(context, { suffix: '3001' });

    const closeRequest = await request(app)
      .post(`/api/telegram/seller/work-queue/${unavailable.bookingRequestId}/actions`)
      .send({
        action_type: 'cancel_request',
        idempotency_key: 'seller-router-close',
      });
    expect(closeRequest.status).toBe(200);

    const unavailableAction = await request(app)
      .post(`/api/telegram/seller/work-queue/${unavailable.bookingRequestId}/actions`)
      .send({
        action_type: 'hold_extend',
        idempotency_key: 'seller-router-unavailable',
      });
    expect(unavailableAction.status).toBe(409);
    expect(unavailableAction.body).toMatchObject({
      route_status: 'blocked_not_possible',
      route_operation_type: 'seller_work_queue_action',
      operation_result_summary: null,
    });
  });

  it('rejects non-seller role before seller queue operations', async () => {
    const sellerRequest = seedSellerRequest(context, { suffix: '4001' });
    const forbiddenApp = express();
    forbiddenApp.use(express.json());
    forbiddenApp.use((req, _res, next) => {
      req.user = { id: 3, role: 'dispatcher' };
      next();
    });
    forbiddenApp.use(
      '/api/telegram/seller',
      createTelegramSellerRouter({
        telegramContext: context,
        now: clock.now,
      })
    );

    const listResponse = await request(forbiddenApp).get('/api/telegram/seller/work-queue');
    expect(listResponse.status).toBe(403);
    expect(listResponse.body.route_status).toBe('rejected_forbidden');

    const actionResponse = await request(forbiddenApp)
      .post(`/api/telegram/seller/work-queue/${sellerRequest.bookingRequestId}/actions`)
      .send({
        action_type: 'call_started',
      });
    expect(actionResponse.status).toBe(403);
    expect(actionResponse.body.route_status).toBe('rejected_forbidden');
  });
});
