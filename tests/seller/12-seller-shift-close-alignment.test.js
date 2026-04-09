import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

let app;
let db;
let seedData;
let sellerAToken;
let dispatcherToken;

beforeAll(async () => {
  resetTestDb();
  db = getTestDb();
  seedData = await seedBasicData(db);
  app = await makeApp();

  sellerAToken = (
    await request(app).post('/api/auth/login').send({ username: 'sellerA', password: 'password123' })
  ).body.token;
  dispatcherToken = (
    await request(app).post('/api/auth/login').send({ username: 'dispatcher1', password: 'password123' })
  ).body.token;
});

describe('SELLER SHIFT-CLOSE ALIGNMENT', () => {
  it('keeps seller earnings, points and prepayments aligned with the canonical shift-close formulas', async () => {
    const today = db.prepare(`SELECT DATE('now','localtime') AS d`).get().d;

    const sellerSaleRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerAToken}`)
      .send({
        slotUid: `manual:${seedData.slots.manual.slot9}`,
        customerName: 'Seller A canonical payout',
        customerPhone: '+79990000010',
        numberOfSeats: 10,
        prepaymentAmount: 4000,
        payment_method: 'CASH',
      });

    expect(sellerSaleRes.status).toBe(201);
    const sellerSaleId = Number(sellerSaleRes.body?.presale?.id || 0);
    expect(sellerSaleId).toBeGreaterThan(0);

    const sellerAcceptRes = await request(app)
      .patch(`/api/selling/presales/${sellerSaleId}/accept-payment`)
      .set('Authorization', `Bearer ${sellerAToken}`)
      .send({ payment_method: 'CASH' });

    expect(sellerAcceptRes.status).toBe(200);

    const dispatcherSaleRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        slotUid: `manual:${seedData.slots.manual.slot2}`,
        customerName: 'Dispatcher same-day sale',
        customerPhone: '+79990000011',
        numberOfSeats: 5,
        prepaymentAmount: 0,
      });

    expect(dispatcherSaleRes.status).toBe(201);
    const dispatcherSaleId = Number(dispatcherSaleRes.body?.presale?.id || 0);
    expect(dispatcherSaleId).toBeGreaterThan(0);

    const dispatcherAcceptRes = await request(app)
      .patch(`/api/selling/presales/${dispatcherSaleId}/accept-payment`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ payment_method: 'CASH' });

    expect(dispatcherAcceptRes.status).toBe(200);

    const reserveSaleRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        customerName: 'Future trip reserve',
        customerPhone: '+79990000012',
        numberOfSeats: 3,
        prepaymentAmount: 3000,
        payment_method: 'CASH',
        tripDate: seedData.slots.generated.tomorrow,
      });

    expect(reserveSaleRes.status).toBe(201);
    expect(Number(reserveSaleRes.body?.presale?.prepayment_amount || 0)).toBe(3000);

    const sellerDashboardRes = await request(app)
      .get('/api/selling/seller-dashboard')
      .set('Authorization', `Bearer ${sellerAToken}`);

    expect(sellerDashboardRes.status).toBe(200);
    expect(sellerDashboardRes.body.ok).toBe(true);
    expect(sellerDashboardRes.body.data?.earnings?.source).toContain('dispatcher_shift_close');
    expect(Number(sellerDashboardRes.body.data?.earnings?.value || 0)).toBeGreaterThan(0);
    expect(Number(sellerDashboardRes.body.data?.points?.today || 0)).toBe(12);
    expect(Number(sellerDashboardRes.body.data?.prepayments_today?.cash || 0)).toBe(4000);
    expect(Number(sellerDashboardRes.body.data?.prepayments_today?.card || 0)).toBe(0);

    const shiftCloseRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${today}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(shiftCloseRes.status).toBe(200);
    expect(shiftCloseRes.body.ok).toBe(true);
    expect(Number(shiftCloseRes.body.future_trips_reserve_total || 0)).toBe(3000);
    const paymentDayRevenueRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE
          WHEN ml.type IN (
            'SALE_PREPAYMENT_CASH',
            'SALE_PREPAYMENT_CARD',
            'SALE_PREPAYMENT_MIXED',
            'SALE_ACCEPTED_CASH',
            'SALE_ACCEPTED_CARD',
            'SALE_ACCEPTED_MIXED'
          ) THEN ml.amount
          ELSE 0
        END), 0) AS gross,
        COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refunds
      FROM money_ledger ml
      WHERE ml.status = 'POSTED'
        AND ml.kind IN ('SELLER_SHIFT', 'DISPATCHER_SHIFT')
        AND DATE(ml.business_day) = ?
    `).get(today);
    const paymentDayRevenue = Math.max(
      0,
      Number(paymentDayRevenueRow.gross || 0) - Number(paymentDayRevenueRow.refunds || 0)
    );
    expect(
      Number(shiftCloseRes.body.salary_base || 0) + Number(shiftCloseRes.body.future_trips_reserve_total || 0)
    ).toBe(paymentDayRevenue);

    const sellerRow = (shiftCloseRes.body.sellers || []).find(
      (row) => Number(row.seller_id) === Number(seedData.users.sellerA.id)
    );
    expect(sellerRow).toBeDefined();
    expect(Number(sellerRow.salary_due_total || sellerRow.salary_due || 0)).toBeCloseTo(
      Number(sellerDashboardRes.body.data?.earnings?.value || 0),
      6
    );
  });
});
