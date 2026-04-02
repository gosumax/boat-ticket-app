import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const PAYMENT_DAY = '2099-08-09';
const TRIP_DAY = '2099-08-10';

let app;
let db;
let seedData;
let dispatcherToken;

async function login(username, password = 'password123') {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ username, password });

  expect(response.status).toBe(200);
  expect(response.body?.token).toBeTruthy();
  return response.body.token;
}

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  seedData = await seedBasicData(db);
  dispatcherToken = await login('dispatcher1');
});

describe('dispatcher shift close mixed summary legacy fallback', () => {
  it('keeps mixed fully inside cash/card cards even when presale row is gone', async () => {
    const sellerId = Number(seedData.users.sellerA.id);
    const slotId = Number(seedData.slots.manual.slot1);
    const slotUid = `generated:${seedData.slots.generated.genSlot1}`;

    const presaleId = Number(db.prepare(`
      INSERT INTO presales (
        boat_slot_id, slot_uid, seller_id,
        customer_name, customer_phone, number_of_seats,
        total_price, prepayment_amount, status,
        payment_method, payment_cash_amount, payment_card_amount,
        business_day, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      slotId,
      slotUid,
      sellerId,
      'Legacy Mixed Summary',
      '+79990001234',
      1,
      3000,
      3000,
      'MIXED',
      1250,
      1750,
      TRIP_DAY
    ).lastInsertRowid);

    const canonicalCols = new Set(
      db.prepare(`PRAGMA table_info(sales_transactions_canonical)`).all().map((row) => row.name)
    );
    const canonicalInsertCols = [];
    const canonicalInsertVals = [];
    const pushCanonical = (column, value) => {
      if (!canonicalCols.has(column)) return;
      canonicalInsertCols.push(column);
      canonicalInsertVals.push(value);
    };

    pushCanonical('ticket_id', 900001);
    pushCanonical('business_day', TRIP_DAY);
    pushCanonical('presale_id', presaleId);
    pushCanonical('slot_id', slotId);
    pushCanonical('slot_uid', slotUid);
    pushCanonical('slot_source', 'generated');
    pushCanonical('amount', 3000);
    pushCanonical('qty', 1);
    pushCanonical('method', 'MIXED');
    pushCanonical('status', 'VALID');
    pushCanonical('cash_amount', 1250);
    pushCanonical('card_amount', 1750);

    db.prepare(`
      INSERT INTO sales_transactions_canonical (
        ${canonicalInsertCols.join(', ')}
      ) VALUES (${canonicalInsertCols.map(() => '?').join(', ')})
    `).run(...canonicalInsertVals);

    db.prepare(`
      INSERT INTO money_ledger (
        presale_id, slot_id, trip_day, event_time,
        kind, type, method, amount, status, seller_id, business_day
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?)
    `).run(
      presaleId,
      slotId,
      TRIP_DAY,
      `${PAYMENT_DAY} 09:00:00`,
      'SELLER_SHIFT',
      'SALE_PREPAYMENT_CASH',
      'CASH',
      500,
      sellerId,
      PAYMENT_DAY
    );

    db.prepare(`
      INSERT INTO money_ledger (
        presale_id, slot_id, trip_day, event_time,
        kind, type, method, amount, status, seller_id, business_day
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?)
    `).run(
      presaleId,
      slotId,
      TRIP_DAY,
      `${PAYMENT_DAY} 09:05:00`,
      'DISPATCHER_SHIFT',
      'SALE_ACCEPTED_MIXED',
      'MIXED',
      2500,
      sellerId,
      PAYMENT_DAY
    );

    // Simulate real legacy data: mixed ledger rows survived, linked presale row did not.
    db.prepare(`DELETE FROM presales WHERE id = ?`).run(presaleId);

    const response = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${PAYMENT_DAY}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(response.status).toBe(200);
    expect(response.body?.ok).toBe(true);
    expect(response.body?.source).toBe('live');

    expect(Number(response.body?.collected_total || 0)).toBe(3000);
    expect(Number(response.body?.collected_cash || 0)).toBe(1250);
    expect(Number(response.body?.collected_card || 0)).toBe(1750);
    expect(Number(response.body?.collected_split_unallocated || 0)).toBe(0);
    expect(
      Number(response.body?.collected_cash || 0) +
      Number(response.body?.collected_card || 0)
    ).toBe(Number(response.body?.collected_total || 0));
  });
});
