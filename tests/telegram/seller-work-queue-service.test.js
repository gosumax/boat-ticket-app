import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import { TELEGRAM_SELLER_WORK_QUEUE_ACTIONS } from '../../shared/telegram/index.js';

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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_slot_id INTEGER NULL,
      customer_name TEXT,
      customer_phone TEXT,
      number_of_seats INTEGER,
      total_price INTEGER,
      prepayment_amount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      slot_uid TEXT NULL,
      payment_method TEXT NULL,
      payment_cash_amount INTEGER DEFAULT 0,
      payment_card_amount INTEGER DEFAULT 0,
      seller_id INTEGER NULL,
      business_day TEXT NULL,
      tickets_json TEXT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (?, ?, 'seller', 1)`
  ).run(1, 'seller-one');
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (?, ?, 'seller', 1)`
  ).run(2, 'seller-two');

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

function listEvents(context, bookingRequestId) {
  return context.repositories.bookingRequestEvents.listBy(
    { booking_request_id: bookingRequestId },
    { orderBy: 'booking_request_event_id ASC', limit: 100 }
  );
}

function seedSellerRequest(
  context,
  {
    sellerId = 1,
    suffix,
    requestedTripDate = '2026-04-11',
    requestedTimeSlot = '12:00',
    requestedSeats = 2,
    requestedPrepaymentAmount = 1000,
  }
) {
  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-seller-queue-${suffix}`,
    display_name: `Seller Queue Guest ${suffix}`,
    username: `seller_queue_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999000${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-queue-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Queue Source ${suffix}`,
    default_seller_id: sellerId,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-queue-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: { zone: `seller-queue-zone-${suffix}` },
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
    requested_trip_date: requestedTripDate,
    requested_time_slot: requestedTimeSlot,
    requested_seats: requestedSeats,
    requested_ticket_mix: { adult: requestedSeats },
    requested_prepayment_amount: requestedPrepaymentAmount,
    currency: 'RUB',
    contact_phone_e164: `+7999000${suffix}`,
  });

  return {
    bookingRequestId: lifecycle.bookingRequest.booking_request_id,
    sellerId,
    guest,
    attributionSession: attribution.sellerAttributionSession,
  };
}

describe('telegram seller work queue service', () => {
  let db;
  let context;
  let clock;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    context.services.attributionService.now = clock.now;
    context.services.bookingRequestService.now = clock.now;
    context.services.sellerWorkQueueService.now = clock.now;
  });

  it('lists seller-owned active booking requests and linked confirmed presales only', () => {
    const active = seedSellerRequest(context, { sellerId: 1, suffix: '1001' });
    const otherSeller = seedSellerRequest(context, { sellerId: 2, suffix: '1002' });
    const linked = seedSellerRequest(context, { sellerId: 1, suffix: '1003' });
    const closed = seedSellerRequest(context, { sellerId: 1, suffix: '1004' });
    const presaleId = db.prepare(`
      INSERT INTO presales (
        boat_slot_id, customer_name, customer_phone, number_of_seats, total_price,
        prepayment_amount, status, slot_uid, payment_method, seller_id, business_day,
        tickets_json
      )
      VALUES (1, 'Linked Guest', '+79990001003', 2, 5000, 1000, 'ACTIVE',
        'generated:42', 'CARD', 1, '2026-04-11', '{"adult":2}')
    `).run().lastInsertRowid;

    context.repositories.bookingRequests.updateById(linked.bookingRequestId, {
      request_status: 'CONFIRMED_TO_PRESALE',
      confirmed_presale_id: presaleId,
      last_status_at: '2026-04-10T10:01:00.000Z',
    });
    context.services.bookingRequestService.markSellerNotReached(closed.bookingRequestId);

    const queue = context.services.sellerWorkQueueService.listSellerWorkQueue(1);
    const requestIds = queue.items.map((item) => item.booking_request.booking_request_id);

    expect(requestIds).toContain(active.bookingRequestId);
    expect(requestIds).toContain(linked.bookingRequestId);
    expect(requestIds).not.toContain(otherSeller.bookingRequestId);
    expect(requestIds).not.toContain(closed.bookingRequestId);

    const linkedItem = queue.items.find(
      (item) => item.booking_request.booking_request_id === linked.bookingRequestId
    );
    expect(linkedItem.queue_item_type).toBe('linked_confirmed_presale');
    expect(linkedItem.confirmed_presale).toMatchObject({
      id: presaleId,
      seller_id: 1,
      slot_uid: 'generated:42',
      tickets_json: { adult: 2 },
    });
    expect(linkedItem.available_actions).toEqual([]);
  });

  it('records call_started once per idempotency key and preserves conflicts', () => {
    const seeded = seedSellerRequest(context, { sellerId: 1, suffix: '2001' });
    context.repositories.bookingRequests.updateById(seeded.bookingRequestId, {
      request_status: 'ATTRIBUTED',
    });

    const first = context.services.sellerWorkQueueService.recordSellerAction({
      sellerId: 1,
      bookingRequestId: seeded.bookingRequestId,
      action: TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.call_started,
      idempotencyKey: 'call-started-2001',
    });
    const second = context.services.sellerWorkQueueService.recordSellerAction({
      sellerId: 1,
      bookingRequestId: seeded.bookingRequestId,
      action: TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.call_started,
      idempotencyKey: 'call-started-2001',
    });
    const events = listEvents(context, seeded.bookingRequestId);

    expect(first.outcome).toBe('applied');
    expect(second.outcome).toBe('idempotent_replay');
    expect(second.event.booking_request_event_id).toBe(first.event.booking_request_event_id);
    expect(first.queue_item.booking_request.request_status).toBe('CONTACT_IN_PROGRESS');
    expect(events.filter((event) => event.event_type === 'SELLER_CALL_STARTED')).toHaveLength(1);
    expect(first.event.event_payload).toMatchObject({
      idempotency_key: 'call-started-2001',
      seller_work_queue_action: TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.call_started,
      seller_id: 1,
      prior_request_status: 'ATTRIBUTED',
      request_status: 'CONTACT_IN_PROGRESS',
    });

    expect(() =>
      context.services.sellerWorkQueueService.recordSellerAction({
        sellerId: 1,
        bookingRequestId: seeded.bookingRequestId,
        action: TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.not_reached,
        idempotencyKey: 'call-started-2001',
      })
    ).toThrow('Idempotency conflict');
  });

  it('delegates hold_extend, not_reached, and prepayment_confirmed through lifecycle events idempotently', () => {
    const holdExtend = seedSellerRequest(context, { sellerId: 1, suffix: '3001' });
    const notReached = seedSellerRequest(context, { sellerId: 1, suffix: '3002' });
    const prepayment = seedSellerRequest(context, { sellerId: 1, suffix: '3003' });

    const extended = context.services.sellerWorkQueueService.recordSellerAction({
      sellerId: 1,
      bookingRequestId: holdExtend.bookingRequestId,
      action: TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.hold_extend,
      idempotencyKey: 'hold-extend-3001',
    });
    const extendedAgain = context.services.sellerWorkQueueService.recordSellerAction({
      sellerId: 1,
      bookingRequestId: holdExtend.bookingRequestId,
      action: TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.hold_extend,
      idempotencyKey: 'hold-extend-3001',
    });
    const closed = context.services.sellerWorkQueueService.recordSellerAction({
      sellerId: 1,
      bookingRequestId: notReached.bookingRequestId,
      action: TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.not_reached,
      idempotencyKey: 'not-reached-3002',
    });
    const confirmed = context.services.sellerWorkQueueService.recordSellerAction({
      sellerId: 1,
      bookingRequestId: prepayment.bookingRequestId,
      action: TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.prepayment_confirmed,
      idempotencyKey: 'prepayment-3003',
    });

    expect(extended.outcome).toBe('applied');
    expect(extendedAgain.outcome).toBe('idempotent_replay');
    expect(extended.queue_item.booking_hold.hold_status).toBe('EXTENDED');
    expect(extended.event.event_type).toBe('HOLD_EXTENDED');
    expect(extended.event.event_payload).toMatchObject({
      idempotency_key: 'hold-extend-3001',
      seller_work_queue_action: TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.hold_extend,
    });
    expect(listEvents(context, holdExtend.bookingRequestId).filter(
      (event) => event.event_type === 'HOLD_EXTENDED'
    )).toHaveLength(1);

    expect(closed.queue_item.booking_request.request_status).toBe('SELLER_NOT_REACHED');
    expect(closed.queue_item.booking_hold.hold_status).toBe('RELEASED');
    expect(closed.event.event_type).toBe('SELLER_NOT_REACHED');
    expect(closed.event.event_payload.seller_work_queue_action).toBe(
      TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.not_reached
    );

    expect(confirmed.queue_item.booking_request.request_status).toBe('PREPAYMENT_CONFIRMED');
    expect(confirmed.queue_item.booking_hold.hold_status).toBe('CONVERTED');
    expect(confirmed.event.event_type).toBe('PREPAYMENT_CONFIRMED');
    expect(confirmed.event.event_payload.seller_work_queue_action).toBe(
      TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.prepayment_confirmed
    );
  });

  it('rejects seller actions from non-assigned sellers and does not downgrade linked presales', () => {
    const linked = seedSellerRequest(context, { sellerId: 1, suffix: '4001' });
    const presaleId = db.prepare(`
      INSERT INTO presales (
        boat_slot_id, customer_name, customer_phone, number_of_seats, total_price,
        prepayment_amount, status, seller_id
      )
      VALUES (1, 'Confirmed Guest', '+79990004001', 1, 2500, 2500, 'ACTIVE', 1)
    `).run().lastInsertRowid;

    context.repositories.bookingRequests.updateById(linked.bookingRequestId, {
      request_status: 'CONFIRMED_TO_PRESALE',
      confirmed_presale_id: presaleId,
      last_status_at: '2026-04-10T10:02:00.000Z',
    });

    expect(() =>
      context.services.sellerWorkQueueService.recordSellerAction({
        sellerId: 2,
        bookingRequestId: linked.bookingRequestId,
        action: TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.call_started,
        idempotencyKey: 'wrong-seller-4001',
      })
    ).toThrow('not assigned to seller');
    expect(() =>
      context.services.sellerWorkQueueService.recordSellerAction({
        sellerId: 1,
        bookingRequestId: linked.bookingRequestId,
        action: TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.prepayment_confirmed,
        idempotencyKey: 'prepayment-linked-4001',
      })
    ).toThrow('after prepayment is final');

    const after = context.repositories.bookingRequests.getById(linked.bookingRequestId);
    expect(after.request_status).toBe('CONFIRMED_TO_PRESALE');
    expect(after.confirmed_presale_id).toBe(presaleId);
  });
});
