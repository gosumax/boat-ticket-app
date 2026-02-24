/**
 * Test: Dispatcher Shift Ledger Summary Contract
 * Verifies that GET /api/dispatcher/shift-ledger/summary returns complete contract
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { getTodayLocal, getTomorrowLocal } from '../_helpers/testDates.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData, dispatcherToken, dispatcherId;
let today;
let tomorrow;

beforeAll(async () => {
  // Reset test DB
  resetTestDb();
  
  // Initialize app
  app = await makeApp();
  
  // Get DB connection and seed test data
  db = getTestDb();
  seedData = await seedBasicData(db);
  
  // Create dispatcher user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_contract', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_contract', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  today = getTodayLocal(db);
  tomorrow = getTomorrowLocal(db);
});

describe('DISPATCHER SHIFT LEDGER SUMMARY CONTRACT', () => {
  it('1) Before close -> source=ledger, all required fields present', async () => {
    const businessDay = '2099-06-15';  // Future date, no shift closed

    const res = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);

    const body = res.body;

    // A) meta
    expect(body.ok).toBe(true);
    expect(body.business_day).toBe(businessDay);
    expect(['ledger', 'live']).toContain(body.source);  // 'live' is also valid for unclosed
    expect(body.is_closed).toBe(false);
    expect(typeof body.all_trips_finished).toBe('boolean');
    expect(typeof body.open_trips_count).toBe('number');

    // C) totals
    expect(typeof body.collected_total).toBe('number');
    expect(typeof body.collected_cash).toBe('number');
    expect(typeof body.collected_card).toBe('number');
    expect(typeof body.refund_total).toBe('number');
    expect(typeof body.refund_cash).toBe('number');
    expect(typeof body.refund_card).toBe('number');
    expect(typeof body.net_total).toBe('number');
    expect(typeof body.net_cash).toBe('number');
    expect(typeof body.net_card).toBe('number');
    expect(typeof body.future_trips_reserve_cash).toBe('number');
    expect(typeof body.future_trips_reserve_card).toBe('number');
    expect(typeof body.future_trips_reserve_total).toBe('number');

    // Verify net = collected - refund
    expect(body.net_total).toBe(body.collected_total - body.refund_total);
    expect(body.net_cash).toBe(body.collected_cash - body.refund_cash);
    expect(body.net_card).toBe(body.collected_card - body.refund_card);

    // D) deposits / salary
    expect(typeof body.deposit_cash).toBe('number');
    expect(typeof body.deposit_card).toBe('number');
    expect(typeof body.salary_due).toBe('number');
    expect(typeof body.salary_due_total).toBe('number');
    expect(typeof body.salary_paid_cash).toBe('number');
    expect(typeof body.salary_paid_card).toBe('number');
    expect(typeof body.salary_paid_total).toBe('number');
    expect(typeof body.owner_cash_available_after_future_reserve_cash).toBe('number');

    // E) role breakdown
    expect(Array.isArray(body.sellers)).toBe(true);
    expect(typeof body.dispatcher).toBe('object');

    // Dispatcher object structure
    expect(typeof body.dispatcher.deposit_cash).toBe('number');
    expect(typeof body.dispatcher.deposit_card).toBe('number');
    expect(typeof body.dispatcher.salary_paid_cash).toBe('number');
    expect(typeof body.dispatcher.salary_paid_card).toBe('number');
    expect(typeof body.dispatcher.salary_paid_total).toBe('number');
  });

  it('2) After close -> source=snapshot, same fields present, net invariant preserved', async () => {
    const businessDay = '2099-06-16';

    // First close the shift
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: businessDay });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(closeRes.body.closed).toBe(true);

    // Now get summary - should come from snapshot
    const res = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);

    const body = res.body;

    // A) meta - source should be snapshot
    expect(body.ok).toBe(true);
    expect(body.business_day).toBe(businessDay);
    expect(body.source).toBe('snapshot');
    expect(body.is_closed).toBe(true);
    expect(body.closed_at).toBeDefined();
    expect(body.closed_by).toBeDefined();

    // B) trips status
    expect(body.all_trips_finished).toBe(true);
    expect(body.open_trips_count).toBe(0);

    // C) totals
    expect(typeof body.collected_total).toBe('number');
    expect(typeof body.collected_cash).toBe('number');
    expect(typeof body.collected_card).toBe('number');
    expect(typeof body.refund_total).toBe('number');
    expect(typeof body.net_total).toBe('number');
    expect(typeof body.net_cash).toBe('number');
    expect(typeof body.net_card).toBe('number');
    expect(typeof body.future_trips_reserve_cash).toBe('number');
    expect(typeof body.future_trips_reserve_card).toBe('number');
    expect(typeof body.future_trips_reserve_total).toBe('number');

    // Net invariant: net = collected - refund
    expect(body.net_total).toBe(body.collected_total - body.refund_total);

    // D) deposits / salary
    expect(typeof body.deposit_cash).toBe('number');
    expect(typeof body.deposit_card).toBe('number');
    expect(typeof body.salary_due).toBe('number');
    expect(typeof body.salary_due_total).toBe('number');
    expect(typeof body.salary_paid_cash).toBe('number');
    expect(typeof body.salary_paid_card).toBe('number');
    expect(typeof body.salary_paid_total).toBe('number');
    expect(typeof body.owner_cash_available_after_future_reserve_cash).toBe('number');

    // E) role breakdown
    expect(Array.isArray(body.sellers)).toBe(true);
    expect(typeof body.dispatcher).toBe('object');
  });

  it('3) sellers[] contains required fields for each seller', async () => {
    const businessDay = '2099-06-17';

    const res = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);

    const sellers = res.body.sellers || [];

    // Each seller should have required fields
    for (const seller of sellers) {
      expect(typeof seller.seller_id).toBe('number');
      expect(typeof (seller.seller_name || seller.name)).toBe('string');
      expect(typeof seller.collected_total).toBe('number');
      expect(typeof seller.net_total).toBe('number');
      expect(typeof seller.cash_due_to_owner).toBe('number');
      expect(typeof seller.cash_balance).toBe('number');
      expect(typeof seller.status).toBe('string');
    }
  });

  it('4) LIVE branch: salary_due fields present when seller has revenue', async () => {
    const businessDay = '2099-07-01';
    const sellerId = seedData.users.sellerA.id;

    // Insert a sale into money_ledger to generate motivation payout
    // Uses SALE_PREPAYMENT_CASH which is counted in motivation engine revenue_total
    // money_ledger columns: type, kind, method, amount, status, business_day, seller_id, event_time (has DEFAULT)
    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
    `).run(businessDay, sellerId);

    const res = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('live'); // Not closed yet

    // Root-level salary_due fields
    expect(typeof res.body.salary_due).toBe('number');
    expect(typeof res.body.salary_due_total).toBe('number');
    expect(res.body.salary_due).toBeGreaterThanOrEqual(0);
    expect(res.body.salary_due_total).toBeGreaterThanOrEqual(0);

    // sellers[] should have salary_due fields
    expect(Array.isArray(res.body.sellers)).toBe(true);

    const sellers = res.body.sellers || [];
    for (const seller of sellers) {
      // Each seller must have these fields (even if 0)
      expect(typeof seller.salary_due).toBe('number');
      expect(typeof seller.salary_due_total).toBe('number');
      expect(typeof seller.salary_accrued).toBe('number');
      expect(seller.salary_due).toBeGreaterThanOrEqual(0);
      expect(seller.salary_due_total).toBeGreaterThanOrEqual(0);
      expect(seller.salary_accrued).toBeGreaterThanOrEqual(0);
    }

    // Find the seller with revenue and verify they have non-zero salary_due
    const sellerWithRevenue = sellers.find(s => s.seller_id === sellerId);
    if (sellerWithRevenue) {
      // This seller should have a payout from the motivation engine
      expect(sellerWithRevenue.salary_due).toBeGreaterThan(0);
      expect(sellerWithRevenue.salary_due_total).toBe(sellerWithRevenue.salary_due);
      expect(sellerWithRevenue.salary_accrued).toBe(sellerWithRevenue.salary_due);
    }
  });

  it('5) salary_due invariant: LIVE == shift_closures.salary_due == SNAPSHOT', async () => {
    const businessDay = '2099-07-02';
    const sellerId = seedData.users.sellerA.id;

    // A) Insert a sale to generate motivation payout (same ml.type as test 4)
    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
    `).run(businessDay, sellerId);

    // B) Get LIVE summary and capture salary_due_total
    const liveRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveRes.status).toBe(200);
    expect(liveRes.body.ok).toBe(true);
    expect(['live', 'ledger']).toContain(liveRes.body.source);

    const liveSalary = Number(liveRes.body.salary_due_total || 0);
    expect(liveSalary).toBeGreaterThan(0);

    // Verify per-seller salary_due in LIVE
    const liveSeller = (liveRes.body.sellers || []).find(s => s.seller_id === sellerId);
    expect(liveSeller).toBeDefined();
    expect(Number(liveSeller.salary_due_total || 0)).toBeGreaterThan(0);

    // C) Close the shift
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: businessDay });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(closeRes.body.closed).toBe(true);

    // D) Check shift_closures.salary_due in DB
    const closureRow = db.prepare('SELECT salary_due FROM shift_closures WHERE business_day = ?').get(businessDay);
    expect(closureRow).toBeDefined();
    const snapDue = Number(closureRow.salary_due || 0);
    expect(snapDue).toBe(liveSalary);

    // E) Get SNAPSHOT summary and verify salary_due_total matches
    const snapRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(snapRes.status).toBe(200);
    expect(snapRes.body.ok).toBe(true);
    expect(snapRes.body.source).toBe('snapshot');

    const snapSalary = Number(snapRes.body.salary_due_total || 0);
    expect(snapSalary).toBe(liveSalary);

    // F) Verify seller in snapshot has salary_due_total > 0 (stored in sellers_json)
    const snapSeller = (snapRes.body.sellers || []).find(s => s.seller_id === sellerId);
    expect(snapSeller).toBeDefined();
    expect(Number(snapSeller.salary_due_total || 0)).toBeGreaterThan(0);
    expect(Number(snapSeller.salary_due || 0)).toBe(Number(snapSeller.salary_due_total || 0));
    expect(Number(snapSeller.salary_accrued || 0)).toBe(Number(snapSeller.salary_due_total || 0));
  });

  it('6) revenue source fallback: sellers[] is not empty when collected_total > 0', async () => {
    const businessDay = '2099-07-03';
    const sellerId = seedData.users.sellerA.id;

    // Simulate dispatcher-collected revenue for seller-owned presale context:
    // kind=DISPATCHER_SHIFT with seller_id of a seller can make collected_total > 0
    // while seller list from SELLER_SHIFT is empty.
    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SALE_ACCEPTED_CASH', 'DISPATCHER_SHIFT', 'CASH', 15000, 'POSTED', ?, ?)
    `).run(businessDay, sellerId);

    const res = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Number(res.body.collected_total || 0)).toBeGreaterThan(0);
    expect(Array.isArray(res.body.sellers)).toBe(true);
    expect(res.body.sellers.length).toBeGreaterThan(0);
  });

  it('7) owner formula invariant: owner_cash_available = net_total - salary_due_total - sellers_debt_total (live + snapshot)', async () => {
    const businessDay = '2099-07-04';
    const sellerId = seedData.users.sellerA.id;

    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SALE_ACCEPTED_CASH', 'SELLER_SHIFT', 'CASH', 5000, 'POSTED', ?, ?)
    `).run(businessDay, sellerId);

    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SALE_ACCEPTED_CARD', 'SELLER_SHIFT', 'CARD', 7000, 'POSTED', ?, ?)
    `).run(businessDay, sellerId);

    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('DEPOSIT_TO_OWNER_CASH', 'DISPATCHER_SHIFT', 'CASH', 3000, 'POSTED', ?, ?)
    `).run(businessDay, sellerId);

    const getSellersDebtTotal = (rows) => (rows || []).reduce((sum, s) => {
      const cashDue = Math.max(0, Number(s.cash_due_to_owner ?? s.cash_balance ?? s.balance ?? 0));
      const terminalDue = Math.max(0, Number(s.terminal_due_to_owner ?? s.terminal_debt ?? 0));
      return sum + cashDue + terminalDue;
    }, 0);

    const liveRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveRes.status).toBe(200);
    expect(liveRes.body.ok).toBe(true);
    expect(liveRes.body.collected_total).toBe(liveRes.body.collected_cash + liveRes.body.collected_card);

    const liveDebtTotal = getSellersDebtTotal(liveRes.body.sellers);
    expect(liveRes.body.sellers_debt_total).toBe(liveDebtTotal);
    expect(liveRes.body.owner_cash_available).toBe(
      Number(liveRes.body.net_total || 0) - Number(liveRes.body.salary_due_total || 0) - liveDebtTotal
    );

    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: businessDay });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);

    const snapRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(snapRes.status).toBe(200);
    expect(snapRes.body.ok).toBe(true);
    expect(snapRes.body.source).toBe('snapshot');
    expect(snapRes.body.collected_total).toBe(snapRes.body.collected_cash + snapRes.body.collected_card);

    const snapDebtTotal = getSellersDebtTotal(snapRes.body.sellers);
    expect(snapRes.body.sellers_debt_total).toBe(snapDebtTotal);
    expect(snapRes.body.owner_cash_available).toBe(
      Number(snapRes.body.net_total || 0) - Number(snapRes.body.salary_due_total || 0) - snapDebtTotal
    );
  });

  it('8) future reserve metrics include cash/card/mixed and stay consistent after next-day refund', async () => {
    const sellerId = seedData.users.sellerA.id;
    const slotId = seedData.slots.manual.slot2;

    const insertPresale = db.prepare(`
      INSERT INTO presales (
        boat_slot_id, slot_uid, seller_id,
        customer_name, customer_phone, number_of_seats,
        total_price, prepayment_amount, status,
        payment_method, payment_cash_amount, payment_card_amount,
        business_day, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    const pFutureCash = Number(insertPresale.run(
      slotId, `generated:${seedData.slots.generated.genSlot1}`, sellerId,
      'Future Cash', '+79990001001', 1,
      900, 900, 'CASH', 900, 0, tomorrow
    ).lastInsertRowid);
    const pFutureCard = Number(insertPresale.run(
      slotId, `generated:${seedData.slots.generated.genSlot1}`, sellerId,
      'Future Card', '+79990001002', 1,
      700, 700, 'CARD', 0, 700, tomorrow
    ).lastInsertRowid);
    const pFutureMixed = Number(insertPresale.run(
      slotId, `generated:${seedData.slots.generated.genSlot2}`, sellerId,
      'Future Mixed', '+79990001003', 1,
      1000, 1000, 'MIXED', 400, 600, tomorrow
    ).lastInsertRowid);
    const pToday = Number(insertPresale.run(
      slotId, `manual:${slotId}`, sellerId,
      'Today Sale', '+79990001004', 1,
      300, 300, 'CASH', 300, 0, today
    ).lastInsertRowid);

    const ledgerCols = new Set(db.prepare(`PRAGMA table_info(money_ledger)`).all().map(r => r.name));
    const insertLedger = ({ presaleId, type, method, amount, day, cashAmount = 0, cardAmount = 0 }) => {
      const cols = ['presale_id', 'slot_id', 'kind', 'type', 'method', 'amount', 'status', 'seller_id', 'business_day', 'event_time'];
      const vals = [presaleId, slotId, 'SELLER_SHIFT', type, method, amount, 'POSTED', sellerId, day, `${day} 12:00:00`];
      if (ledgerCols.has('cash_amount')) {
        cols.push('cash_amount');
        vals.push(cashAmount);
      }
      if (ledgerCols.has('card_amount')) {
        cols.push('card_amount');
        vals.push(cardAmount);
      }
      db.prepare(`INSERT INTO money_ledger (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
    };

    insertLedger({ presaleId: pFutureCash, type: 'SALE_PREPAYMENT_CASH', method: 'CASH', amount: 900, day: today, cashAmount: 900, cardAmount: 0 });
    insertLedger({ presaleId: pFutureCard, type: 'SALE_ACCEPTED_CARD', method: 'CARD', amount: 700, day: today, cashAmount: 0, cardAmount: 700 });
    insertLedger({ presaleId: pFutureMixed, type: 'SALE_ACCEPTED_MIXED', method: 'MIXED', amount: 1000, day: today, cashAmount: 400, cardAmount: 600 });
    insertLedger({ presaleId: pToday, type: 'SALE_ACCEPTED_CASH', method: 'CASH', amount: 300, day: today, cashAmount: 300, cardAmount: 0 });

    const liveToday = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${today}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveToday.status).toBe(200);
    expect(liveToday.body.ok).toBe(true);
    expect(Number(liveToday.body.future_trips_reserve_cash || 0)).toBe(1300);
    expect(Number(liveToday.body.future_trips_reserve_card || 0)).toBe(1300);
    expect(Number(liveToday.body.future_trips_reserve_total || 0)).toBe(2600);
    expect(Number(liveToday.body.owner_cash_available_after_future_reserve_cash || 0)).toBe(
      Number(liveToday.body.owner_cash_available || 0) - Number(liveToday.body.future_trips_reserve_cash || 0)
    );
    expect(Number(liveToday.body.explain?.liabilities?.future_trips_reserve_cash || 0)).toBe(1300);
    expect(Number(liveToday.body.explain?.liabilities?.future_trips_reserve_terminal || 0)).toBe(1300);

    // Refund on the next day should not create "future reserve" for that day.
    insertLedger({ presaleId: pFutureCash, type: 'SALE_CANCEL_REVERSE', method: 'CASH', amount: -900, day: tomorrow, cashAmount: -900, cardAmount: 0 });

    const liveTomorrow = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${tomorrow}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveTomorrow.status).toBe(200);
    expect(liveTomorrow.body.ok).toBe(true);
    expect(Number(liveTomorrow.body.future_trips_reserve_total || 0)).toBe(0);
    expect(Number(liveTomorrow.body.future_trips_reserve_cash || 0)).toBe(0);
    expect(Number(liveTomorrow.body.future_trips_reserve_card || 0)).toBe(0);
  });
});
