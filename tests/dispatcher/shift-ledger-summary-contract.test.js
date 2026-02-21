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

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData, dispatcherToken, dispatcherId;

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
});
