import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';
const CLOSED_DAY = '2099-12-31';

let app;
let db;
let sellerToken;
let dispatcherToken;
let sourceSlotId;
let targetSlotId;
let boatSlotsHasTripDate = false;
let presalesHasBusinessDay = false;

function hasColumn(tableName, columnName) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return cols.some((c) => c.name === columnName);
}

function makeToken(userId, role) {
  return jwt.sign({ id: userId, role }, JWT_SECRET, { expiresIn: '24h' });
}

function ensureUser(role, username) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ? LIMIT 1').get(username);
  if (existing?.id) return Number(existing.id);
  const res = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, ?, 1)
  `).run(username, 'test-hash', role);
  return Number(res.lastInsertRowid);
}

function insertBoatSlot(boatId, time) {
  const existing = db.prepare('SELECT id FROM boat_slots WHERE boat_id = ? AND time = ? LIMIT 1').get(boatId, time);
  if (existing?.id) return Number(existing.id);

  if (boatSlotsHasTripDate) {
    const res = db.prepare(`
      INSERT INTO boat_slots
      (boat_id, time, trip_date, price, is_active, seats_left, capacity, duration_minutes, price_adult, price_child, price_teen)
      VALUES (?, ?, ?, 1000, 1, 20, 20, 60, 1000, 500, 750)
    `).run(boatId, time, CLOSED_DAY);
    return Number(res.lastInsertRowid);
  }
  const res = db.prepare(`
    INSERT INTO boat_slots
    (boat_id, time, price, is_active, seats_left, capacity, duration_minutes, price_adult, price_child, price_teen)
    VALUES (?, ?, 1000, 1, 20, 20, 60, 1000, 500, 750)
  `).run(boatId, time);
  return Number(res.lastInsertRowid);
}

function ensureGeneratedSlotForClosedDay(boatId) {
  const existing = db.prepare('SELECT id FROM generated_slots WHERE trip_date = ? LIMIT 1').get(CLOSED_DAY);
  if (existing?.id) return `generated:${existing.id}`;

  const time = '11:30';
  const template = db.prepare(`
    INSERT INTO schedule_templates
    (weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, price_teen, duration_minutes, is_active)
    VALUES (1, ?, 'speed', ?, 'speed', 20, 1000, 500, 750, 60, 1)
  `).run(time, boatId);

  const generated = db.prepare(`
    INSERT INTO generated_slots
    (schedule_template_id, trip_date, boat_id, time, capacity, seats_left, duration_minutes, is_active, price_adult, price_child, price_teen)
    VALUES (?, ?, ?, ?, 20, 20, 60, 1, 1000, 500, 750)
  `).run(Number(template.lastInsertRowid), CLOSED_DAY, boatId, time);

  return `generated:${generated.lastInsertRowid}`;
}

function insertPresale({ sellerId, status = 'ACTIVE', seats = 1, totalPrice = 1000, prepaymentAmount = 0 }) {
  const customerSuffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const baseCols = [
    'boat_slot_id',
    'seller_id',
    'slot_uid',
    'customer_name',
    'customer_phone',
    'number_of_seats',
    'total_price',
    'prepayment_amount',
    'status',
    'payment_method',
  ];
  const baseValues = [
    sourceSlotId,
    sellerId,
    `manual:${sourceSlotId}`,
    `Shift Lock ${customerSuffix}`,
    `shift-lock-${customerSuffix}`,
    seats,
    totalPrice,
    prepaymentAmount,
    status,
    'cash',
  ];

  if (presalesHasBusinessDay) {
    baseCols.splice(3, 0, 'business_day');
    baseValues.splice(3, 0, CLOSED_DAY);
  }

  const placeholders = baseCols.map(() => '?').join(', ');
  const sql = `
    INSERT INTO presales (${baseCols.join(', ')}, created_at, updated_at)
    VALUES (${placeholders}, datetime('now'), datetime('now'))
  `;
  const res = db.prepare(sql).run(...baseValues);
  return Number(res.lastInsertRowid);
}

function closeShiftForDay(day) {
  db.prepare(`
    INSERT OR IGNORE INTO shift_closures (business_day, closed_at, closed_by)
    VALUES (?, datetime('now'), 1)
  `).run(day);
}

function cleanupTestPresales() {
  const ids = db
    .prepare("SELECT id FROM presales WHERE customer_phone LIKE 'shift-lock-%'")
    .all()
    .map((r) => Number(r.id))
    .filter((v) => Number.isFinite(v));

  if (ids.length === 0) return;

  const marks = ids.map(() => '?').join(', ');
  db.prepare(`DELETE FROM money_ledger WHERE presale_id IN (${marks})`).run(...ids);
  db.prepare(`DELETE FROM tickets WHERE presale_id IN (${marks})`).run(...ids);
  db.prepare(`DELETE FROM presales WHERE id IN (${marks})`).run(...ids);
}

function expectShiftClosed(res) {
  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({
    ok: false,
    code: 'SHIFT_CLOSED',
    business_day: CLOSED_DAY,
  });
}

describe('Shift close hard lock matrix (selling endpoints)', () => {
  let closedDayGeneratedSlotUid;
  let sellerId;

  beforeAll(async () => {
    app = await makeApp();
    db = (await import('../../server/db.js')).default;

    boatSlotsHasTripDate = hasColumn('boat_slots', 'trip_date');
    presalesHasBusinessDay = hasColumn('presales', 'business_day');

    const boat = db.prepare('SELECT id FROM boats ORDER BY id ASC LIMIT 1').get();
    const boatId =
      boat?.id ??
      Number(
        db.prepare(`
          INSERT INTO boats (name, is_active, type, price_adult, price_child, price_teen)
          VALUES ('Shift Lock Boat', 1, 'speed', 1000, 500, 750)
        `).run().lastInsertRowid
      );

    sourceSlotId = insertBoatSlot(boatId, '09:00');
    targetSlotId = insertBoatSlot(boatId, '10:00');
    closedDayGeneratedSlotUid = ensureGeneratedSlotForClosedDay(boatId);

    sellerId = ensureUser('seller', `shift_lock_seller_${Date.now()}`);
    const dispatcherId = ensureUser('dispatcher', `shift_lock_dispatcher_${Date.now()}`);

    sellerToken = makeToken(sellerId, 'seller');
    dispatcherToken = makeToken(dispatcherId, 'dispatcher');
  });

  beforeEach(() => {
    cleanupTestPresales();
    db.prepare('DELETE FROM shift_closures WHERE business_day = ?').run(CLOSED_DAY);
  });

  it('POST /api/selling/presales -> 409 SHIFT_CLOSED', async () => {
    closeShiftForDay(CLOSED_DAY);

    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        slotUid: closedDayGeneratedSlotUid,
        customerName: 'Guard Create',
        customerPhone: 'shift-lock-create',
        numberOfSeats: 1,
        prepaymentAmount: 0,
      });

    expectShiftClosed(res);
  });

  it('PATCH /api/selling/presales/:id/payment -> 409 SHIFT_CLOSED', async () => {
    const presaleId = insertPresale({ sellerId, status: 'ACTIVE', prepaymentAmount: 100, totalPrice: 1000 });
    closeShiftForDay(CLOSED_DAY);

    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/payment`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ additionalPayment: 100 });

    expectShiftClosed(res);
  });

  it('PATCH /api/selling/presales/:id/accept-payment -> 409 SHIFT_CLOSED', async () => {
    const presaleId = insertPresale({ sellerId, status: 'ACTIVE', prepaymentAmount: 0, totalPrice: 1000 });
    closeShiftForDay(CLOSED_DAY);

    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/accept-payment`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ payment_method: 'CASH' });

    expectShiftClosed(res);
  });

  it('PATCH /api/selling/presales/:id/cancel -> 409 SHIFT_CLOSED', async () => {
    const presaleId = insertPresale({ sellerId, status: 'ACTIVE' });
    closeShiftForDay(CLOSED_DAY);

    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/cancel`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({});

    expectShiftClosed(res);
  });

  it('PATCH /api/selling/presales/:id/move -> 409 SHIFT_CLOSED', async () => {
    const presaleId = insertPresale({ sellerId, status: 'CANCELLED_TRIP_PENDING' });
    closeShiftForDay(CLOSED_DAY);

    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/move`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ target_slot_id: targetSlotId });

    expectShiftClosed(res);
  });

  it('PATCH /api/selling/presales/:id/seats -> 409 SHIFT_CLOSED', async () => {
    const presaleId = insertPresale({ sellerId, status: 'ACTIVE', seats: 2, totalPrice: 2000, prepaymentAmount: 2000 });
    closeShiftForDay(CLOSED_DAY);

    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/seats`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ number_of_seats: 1, comment: 'reduce seats' });

    expectShiftClosed(res);
  });

  it('PATCH /api/selling/presales/:id/used -> 409 SHIFT_CLOSED', async () => {
    const presaleId = insertPresale({ sellerId, status: 'ACTIVE' });
    closeShiftForDay(CLOSED_DAY);

    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/used`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({});

    expectShiftClosed(res);
  });

  it('PATCH /api/selling/presales/:id/refund -> 409 SHIFT_CLOSED', async () => {
    const presaleId = insertPresale({ sellerId, status: 'CANCELLED_TRIP_PENDING' });
    closeShiftForDay(CLOSED_DAY);

    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/refund`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({});

    expectShiftClosed(res);
  });

  it('POST /api/selling/presales/:id/transfer -> 409 SHIFT_CLOSED', async () => {
    const presaleId = insertPresale({ sellerId, status: 'ACTIVE' });
    closeShiftForDay(CLOSED_DAY);

    const res = await request(app)
      .post(`/api/selling/presales/${presaleId}/transfer`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ to_slot_uid: `manual:${targetSlotId}` });

    expectShiftClosed(res);
  });

  it('PATCH /api/selling/presales/:id/transfer -> 409 SHIFT_CLOSED', async () => {
    const presaleId = insertPresale({ sellerId, status: 'ACTIVE' });
    closeShiftForDay(CLOSED_DAY);

    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/transfer`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ to_slot_uid: `manual:${targetSlotId}` });

    expectShiftClosed(res);
  });

  it('PATCH /api/selling/presales/:id/cancel-trip-pending -> 409 SHIFT_CLOSED', async () => {
    const presaleId = insertPresale({ sellerId, status: 'ACTIVE' });
    closeShiftForDay(CLOSED_DAY);

    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/cancel-trip-pending`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({});

    expectShiftClosed(res);
  });
});
