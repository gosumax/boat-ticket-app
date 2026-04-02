import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

let app;
let db;
let dispatcherToken;
let slotId;
let phoneSeq = 0;

const DAY = '2026-03-31';
const SELF_MIXED_DAY = '2026-04-01';

async function login(username, password) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  expect(res.status).toBe(200);
  expect(res.body?.token).toBeTruthy();
  return res.body.token;
}

function insertActivePresaleWithTicket({ sellerId, paymentMethod, price, cashAmount, cardAmount, day = DAY }) {
  const presaleRes = db.prepare(`
    INSERT INTO presales (
      boat_slot_id, slot_uid, seller_id,
      customer_name, customer_phone, number_of_seats,
      total_price, prepayment_amount, status,
      payment_method, payment_cash_amount, payment_card_amount,
      business_day, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    slotId,
    `manual:${slotId}`,
    sellerId,
    `Ignored ${sellerId}`,
    `+7999000${String(++phoneSeq).padStart(6, '0')}`,
    1,
    price,
    price,
    paymentMethod,
    cashAmount,
    cardAmount,
    day
  );

  const presaleId = Number(presaleRes.lastInsertRowid);
  const ticketCols = new Set(db.prepare(`PRAGMA table_info(tickets)`).all().map((r) => r.name));
  const columns = ['presale_id', 'boat_slot_id', 'ticket_code', 'status', 'price', 'created_at', 'updated_at'];
  const values = [presaleId, slotId, `T-${presaleId}`, 'ACTIVE', price, "datetime('now')", "datetime('now')"];
  if (ticketCols.has('payment_method')) {
    columns.push('payment_method');
    values.push('?');
  }
  if (ticketCols.has('business_day')) {
    columns.push('business_day');
    values.push('?');
  }

  const sqlValues = values.map((value) => (value === "datetime('now')" ? value : '?')).join(', ');
  const params = [presaleId, slotId, `T-${presaleId}`, 'ACTIVE', price];
  if (ticketCols.has('payment_method')) params.push(paymentMethod);
  if (ticketCols.has('business_day')) params.push(day);
  db.prepare(`INSERT INTO tickets (${columns.join(', ')}) VALUES (${sqlValues})`).run(...params);
}

function insertLedgerSale({ kind, sellerId, type, method, amount, presaleId = null, cashAmount = 0, cardAmount = 0, day = DAY }) {
  const ledgerCols = new Set(db.prepare(`PRAGMA table_info(money_ledger)`).all().map((row) => row.name));
  const columns = ['kind', 'type', 'method', 'amount', 'status', 'seller_id', 'business_day', 'event_time'];
  const values = [kind, type, method, amount, 'POSTED', sellerId, day, `${day} 12:00:00`];
  if (ledgerCols.has('presale_id')) {
    columns.push('presale_id');
    values.push(presaleId);
  }

  if (ledgerCols.has('cash_amount')) {
    columns.push('cash_amount');
    values.push(cashAmount);
  }
  if (ledgerCols.has('card_amount')) {
    columns.push('card_amount');
    values.push(cardAmount);
  }

  db.prepare(`
    INSERT INTO money_ledger (${columns.join(', ')})
    VALUES (${columns.map(() => '?').join(', ')})
  `).run(...values);
}

function insertPresale({ sellerId, totalPrice, paymentMethod, cashAmount, cardAmount, day = DAY }) {
  return Number(db.prepare(`
    INSERT INTO presales (
      boat_slot_id, slot_uid, seller_id,
      customer_name, customer_phone, number_of_seats,
      total_price, prepayment_amount, status,
      payment_method, payment_cash_amount, payment_card_amount,
      business_day, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    slotId,
    `manual:${slotId}`,
    sellerId,
    `Ledger ${sellerId}`,
    `+7999555${String(++phoneSeq).padStart(6, '0')}`,
    1,
    totalPrice,
    totalPrice,
    paymentMethod,
    cashAmount,
    cardAmount,
    day
  ).lastInsertRowid);
}

describe('shift close live summary uses money_ledger and splits MIXED into cash/card', () => {
  beforeAll(async () => {
    resetTestDb();
    app = await makeApp();
    db = getTestDb();
    const seed = await seedBasicData(db);
    slotId = Number(seed.slots.manual.slot1);

    dispatcherToken = await login('dispatcher1', 'password123');

    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, role, is_active)
      VALUES
        (4, 'seller_4', 'x', 'seller', 1),
        (12, 'dispatcher_12', 'x', 'dispatcher', 1),
        (13, 'seller_13', 'x', 'seller', 1)
    `).run();

    // Noise in ACTIVE presales/tickets must not affect Shift Close money KPIs anymore.
    insertActivePresaleWithTicket({
      sellerId: 4,
      paymentMethod: 'CARD',
      price: 999999,
      cashAmount: 0,
      cardAmount: 999999,
    });

    insertLedgerSale({
      kind: 'SELLER_SHIFT',
      sellerId: 4,
      type: 'SALE_ACCEPTED_CARD',
      method: 'CARD',
      amount: 16500,
      cardAmount: 16500,
    });
    insertLedgerSale({
      kind: 'DISPATCHER_SHIFT',
      sellerId: 12,
      type: 'SALE_ACCEPTED_CASH',
      method: 'CASH',
      amount: 16500,
      cashAmount: 16500,
    });
    const mixedPresaleId = insertPresale({
      sellerId: 13,
      totalPrice: 3000,
      paymentMethod: 'MIXED',
      cashAmount: 1500,
      cardAmount: 1500,
    });

    insertLedgerSale({
      kind: 'SELLER_SHIFT',
      sellerId: 13,
      type: 'SALE_ACCEPTED_MIXED',
      method: 'MIXED',
      amount: 3000,
      presaleId: mixedPresaleId,
      cashAmount: 1500,
      cardAmount: 1500,
    });
  });

  it('returns live truth from money_ledger and removes separate mixed bucket from KPIs', async () => {
    const res = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${DAY}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.source).toBe('live');
    expect(res.body?.live_source).toBe('ledger');

    expect(Number(res.body?.collected_total || 0)).toBe(36000);
    expect(Number(res.body?.collected_cash || 0)).toBe(18000);
    expect(Number(res.body?.collected_card || 0)).toBe(18000);
    expect(Number(res.body?.collected_split_unallocated || 0)).toBe(0);
    expect(Number(res.body?.sellers_collect_total || 0)).toBe(0);
    expect(Number(res.body?.collected_total || 0)).toBeLessThan(100000);

    const sellers = Array.isArray(res.body?.sellers_live) && res.body.sellers_live.length > 0
      ? res.body.sellers_live
      : (res.body?.sellers || []);

    const byId = new Map(sellers.map((seller) => [Number(seller.seller_id), seller]));
    expect(byId.has(4)).toBe(true);
    expect(byId.has(12)).toBe(true);
    expect(byId.has(13)).toBe(true);

    expect(Number(byId.get(4)?.collected_total || 0)).toBe(16500);
    expect(Number(byId.get(4)?.collected_cash || 0)).toBe(0);
    expect(Number(byId.get(4)?.collected_card || 0)).toBe(16500);
    expect(Number(byId.get(4)?.cash_due_to_owner || 0)).toBe(0);
    expect(Number(byId.get(4)?.terminal_due_to_owner || 0)).toBe(0);

    expect(Number(byId.get(13)?.collected_total || 0)).toBe(3000);
    expect(Number(byId.get(13)?.collected_cash || 0)).toBe(1500);
    expect(Number(byId.get(13)?.collected_card || 0)).toBe(1500);
    expect(Number(byId.get(13)?.collected_split_unallocated || 0)).toBe(0);
    expect(Number(byId.get(13)?.collected_mixed || 0)).toBe(0);
    expect(Number(byId.get(13)?.cash_due_to_owner || 0)).toBe(0);
    expect(Number(byId.get(13)?.terminal_due_to_owner || 0)).toBe(0);
    expect(Number(byId.get(13)?.net_total || 0)).toBe(0);

    expect(String(byId.get(12)?.role || '')).toBe('dispatcher');
    expect(Number(byId.get(12)?.collected_total || 0)).toBe(16500);
    expect(Number(byId.get(12)?.cash_due_to_owner || 0)).toBe(0);
    expect(Number(byId.get(12)?.terminal_due_to_owner || 0)).toBe(0);
    expect(Number(byId.get(12)?.salary_due_total || 0)).toBeGreaterThan(0);
  });

  it('keeps dispatcher self-sale MIXED inside cash/card KPI but outside seller collect in live and snapshot', async () => {
    const presaleId = insertPresale({
      sellerId: 12,
      totalPrice: 4000,
      paymentMethod: 'MIXED',
      cashAmount: 1000,
      cardAmount: 3000,
      day: SELF_MIXED_DAY,
    });

    insertLedgerSale({
      kind: 'DISPATCHER_SHIFT',
      sellerId: 12,
      type: 'SALE_ACCEPTED_MIXED',
      method: 'MIXED',
      amount: 4000,
      presaleId,
      cashAmount: 1000,
      cardAmount: 3000,
      day: SELF_MIXED_DAY,
    });

    const liveRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${SELF_MIXED_DAY}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveRes.status).toBe(200);
    expect(liveRes.body?.ok).toBe(true);
    expect(liveRes.body?.source).toBe('live');
    expect(Number(liveRes.body?.collected_total || 0)).toBe(4000);
    expect(Number(liveRes.body?.collected_cash || 0)).toBe(1000);
    expect(Number(liveRes.body?.collected_card || 0)).toBe(3000);
    expect(Number(liveRes.body?.sellers_collect_total || 0)).toBe(0);
    expect(Number(liveRes.body?.sellers_debt_total || 0)).toBe(0);
    const liveDispatcherRow = (liveRes.body?.sellers || []).find((seller) => Number(seller.seller_id) === 12);
    expect(liveDispatcherRow).toBeDefined();
    expect(String(liveDispatcherRow?.role || '')).toBe('dispatcher');
    expect(Number(liveDispatcherRow?.collected_total || 0)).toBe(4000);
    expect(Number(liveDispatcherRow?.cash_due_to_owner || 0)).toBe(0);
    expect(Number(liveDispatcherRow?.terminal_due_to_owner || 0)).toBe(0);

    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: SELF_MIXED_DAY });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body?.ok).toBe(true);

    const snapshotRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${SELF_MIXED_DAY}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.body?.source).toBe('snapshot');
    expect(Number(snapshotRes.body?.collected_total || 0)).toBe(4000);
    expect(Number(snapshotRes.body?.collected_cash || 0)).toBe(1000);
    expect(Number(snapshotRes.body?.collected_card || 0)).toBe(3000);
    expect(Number(snapshotRes.body?.sellers_collect_total || 0)).toBe(0);
    expect(Number(snapshotRes.body?.sellers_debt_total || 0)).toBe(0);
    const snapshotDispatcherRow = (snapshotRes.body?.sellers || []).find((seller) => Number(seller.seller_id) === 12);
    expect(snapshotDispatcherRow).toBeDefined();
    expect(String(snapshotDispatcherRow?.role || '')).toBe('dispatcher');
    expect(Number(snapshotDispatcherRow?.collected_total || 0)).toBe(4000);
    expect(Number(snapshotDispatcherRow?.cash_due_to_owner || 0)).toBe(0);
    expect(Number(snapshotDispatcherRow?.terminal_due_to_owner || 0)).toBe(0);
  });
});
