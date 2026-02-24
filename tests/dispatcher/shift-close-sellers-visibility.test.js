import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData;
let dispatcherToken, dispatcherId;
let sellerId;
let sellerToken;

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  seedData = await seedBasicData(db);

  sellerId = seedData.users.sellerA.id;

  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('dispatcher_shift_close_visibility', hashedPassword);
  dispatcherId = Number(dispatcherRes.lastInsertRowid);
  dispatcherToken = jwt.sign(
    { id: dispatcherId, username: 'dispatcher_shift_close_visibility', role: 'dispatcher' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  const sellerLoginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'sellerA', password: 'password123' });
  sellerToken = sellerLoginRes.body.token;
});

describe('DISPATCHER SHIFT CLOSE sellers visibility for dispatcher-role cash revenue', () => {
  it('includes dispatcher user with cash revenue and keeps salary payout path available', async () => {
    const day = '2099-08-11';

    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1200, ?, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(dispatcherId, day);

    const summaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${day}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.ok).toBe(true);

    const sellerRow = (summaryRes.body.sellers || []).find((s) => Number(s.seller_id) === dispatcherId);
    expect(sellerRow).toBeDefined();
    expect(Number(sellerRow.collected_cash || 0)).toBe(1200);
    expect(Number(sellerRow.cash_due_to_owner || 0)).toBe(1200);
    expect(sellerRow.status).toBe('DEBT');

    const payoutRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        business_day: day,
        type: 'SALARY_PAYOUT_CASH',
        seller_id: dispatcherId,
        amount: 100,
      });

    expect(payoutRes.status).toBe(200);
    expect(payoutRes.body.ok).toBe(true);

    const summaryAfterPayoutRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${day}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(summaryAfterPayoutRes.status).toBe(200);
    expect(Number(summaryAfterPayoutRes.body.salary_paid_cash || 0)).toBeGreaterThanOrEqual(100);
  });

  it('includes seller when cash revenue exists only in DISPATCHER_SHIFT and keeps it in snapshot', async () => {
    const day = '2099-08-12';

    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('DISPATCHER_SHIFT', 'SALE_ACCEPTED_CASH', 2300, ?, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(sellerId, day);

    const summaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${day}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.ok).toBe(true);

    const sellerRow = (summaryRes.body.sellers || []).find((s) => Number(s.seller_id) === Number(sellerId));
    expect(sellerRow).toBeDefined();
    expect(Number(sellerRow.collected_cash || 0)).toBe(2300);
    expect(Number(sellerRow.cash_due_to_owner || 0)).toBe(2300);
    expect(sellerRow.status).toBe('DEBT');

    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: day });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);

    const snapshotRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${day}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.body.source).toBe('snapshot');

    const snapshotSeller = (snapshotRes.body.sellers || []).find((s) => Number(s.seller_id) === Number(sellerId));
    expect(snapshotSeller).toBeDefined();
    expect(Number(snapshotSeller.cash_due_to_owner || 0)).toBe(2300);
  });

  it('includes user for card-only accepted sale with zero prepayment (no cash) so salary can be paid', async () => {
    const day = String(seedData?.slots?.generated?.tomorrow || '');

    const presaleRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        tripDate: day,
        customerName: 'Card Only Customer',
        customerPhone: '+79990001122',
        numberOfSeats: 2,
        prepaymentAmount: 0,
        payment_method: 'CARD',
      });

    expect(presaleRes.status).toBe(201);
    const presaleId = Number(presaleRes.body?.presale?.id);
    expect(presaleId).toBeGreaterThan(0);

    const acceptRes = await request(app)
      .patch(`/api/selling/presales/${presaleId}/accept-payment`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ payment_method: 'CARD' });

    expect(acceptRes.status).toBe(200);

    const summaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${day}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.ok).toBe(true);

    const userRow = (summaryRes.body.sellers || []).find((s) => Number(s.seller_id) === Number(dispatcherId));
    expect(userRow).toBeDefined();
    expect(Number(userRow.collected_cash || 0)).toBe(0);
    expect(Number(userRow.collected_card || 0)).toBeGreaterThan(0);
    expect(Number(userRow.cash_due_to_owner || 0)).toBe(0);
    expect(Number(userRow.terminal_due_to_owner || 0)).toBeGreaterThan(0);

    // Salary payout is gated by finished trips; mark day trips completed for this check.
    db.prepare(`
      UPDATE generated_slots
      SET is_completed = 1, status = 'COMPLETED'
      WHERE trip_date = ?
    `).run(day);

    const payoutRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        business_day: day,
        type: 'SALARY_PAYOUT_CASH',
        seller_id: dispatcherId,
        amount: 50,
      });

    expect(payoutRes.status).toBe(200);
    expect(payoutRes.body.ok).toBe(true);
  });
});
