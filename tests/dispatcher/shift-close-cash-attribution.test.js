import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { getTodayLocal, getTomorrowLocal } from '../_helpers/testDates.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app;
let db;
let seedData;
let sellerToken;
let sellerId;
let dispatcherToken;
let dispatcherId;
let today;
let tomorrow;

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  seedData = await seedBasicData(db);

  today = getTodayLocal(db);
  tomorrow = getTomorrowLocal(db);
  sellerId = seedData.users.sellerA.id;

  const sellerLoginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'sellerA', password: 'password123' });
  sellerToken = sellerLoginRes.body.token;

  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_cash', hashedPassword);
  dispatcherId = Number(dispatcherRes.lastInsertRowid);
  dispatcherToken = jwt.sign(
    { id: dispatcherId, username: 'test_dispatcher_cash', role: 'dispatcher' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
});

describe('DISPATCHER SHIFT CLOSE: seller attribution survives dispatcher completion', () => {
  it('keeps only the seller prepayment in debt when dispatcher accepts the remainder', async () => {
    const presaleRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        tripDate: tomorrow,
        customerName: 'Cash Attribution Test Customer',
        customerPhone: '+79998887766',
        numberOfSeats: 3,
        prepaymentAmount: 1000,
        payment_method: 'CASH',
      });

    expect(presaleRes.status).toBe(201);
    expect(Number(presaleRes.body?.presale?.total_price || 0)).toBe(3000);
    expect(Number(presaleRes.body?.presale?.prepayment_amount || 0)).toBe(1000);

    const presaleId = Number(presaleRes.body.presale.id);
    const acceptRes = await request(app)
      .patch(`/api/selling/presales/${presaleId}/accept-payment`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ payment_method: 'CASH' });

    expect(acceptRes.status).toBe(200);

    const updatedPresale = db.prepare('SELECT total_price, prepayment_amount FROM presales WHERE id = ?').get(presaleId);
    expect(Number(updatedPresale.prepayment_amount || 0)).toBe(Number(updatedPresale.total_price || 0));

    const paymentDaySummaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${today}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(paymentDaySummaryRes.status).toBe(200);
    expect(paymentDaySummaryRes.body.ok).toBe(true);

    const sellerRow = (paymentDaySummaryRes.body.sellers || []).find((seller) => Number(seller.seller_id) === Number(sellerId));
    expect(sellerRow).toBeDefined();
    expect(Number(sellerRow.collected_total || sellerRow.accepted || 0)).toBe(3000);
    expect(Number(sellerRow.cash_due_to_owner || 0)).toBe(1000);
    expect(Number(sellerRow.terminal_due_to_owner || 0)).toBe(0);
    expect(Number(paymentDaySummaryRes.body.collected_total || 0)).toBe(3000);
    expect(Number(paymentDaySummaryRes.body.collected_cash || 0)).toBe(3000);
    expect(Number(paymentDaySummaryRes.body.sellers_collect_total || 0)).toBe(1000);
    expect(Number(paymentDaySummaryRes.body.sellers_debt_total || 0)).toBe(1000);
    expect(Number(paymentDaySummaryRes.body.future_trips_reserve_total || 0)).toBe(3000);
    expect(Number(paymentDaySummaryRes.body.future_trips_reserve_cash || 0)).toBe(3000);
    expect(Number(paymentDaySummaryRes.body.salary_base || 0)).toBe(0);

    const tripDaySummaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${tomorrow}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(tripDaySummaryRes.status).toBe(200);
    expect(tripDaySummaryRes.body.ok).toBe(true);
    expect(Number(tripDaySummaryRes.body.collected_total || 0)).toBe(0);
    expect(Number(tripDaySummaryRes.body.total_revenue || 0)).toBeGreaterThan(0);

    const tripDaySellerRow = (tripDaySummaryRes.body.sellers || []).find((seller) => Number(seller.seller_id) === Number(sellerId));
    const tripDayDispatcherRow = (tripDaySummaryRes.body.sellers || []).find((seller) => Number(seller.seller_id) === Number(dispatcherId));
    expect(tripDaySellerRow).toBeUndefined();
    expect(tripDayDispatcherRow).toBeUndefined();
  });
});
