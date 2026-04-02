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
  const getSellerCashDebtTotal = (rows) => (rows || []).reduce((sum, s) => (
    sum + Math.max(0, Number(s.cash_due_to_owner ?? s.cash_balance ?? 0))
  ), 0);
  const calcOwnerHandoverFinal = (body) => (
    Number(body.net_cash || 0) -
    Number(body.salary_paid_cash || 0) -
    getSellerCashDebtTotal(body.sellers || []) -
    Math.max(0, Number(body.salary_due_total || 0) - Number(body.salary_paid_total || 0)) -
    Number(body.future_trips_reserve_cash || 0) -
    Number(body.funds_withhold_cash_today || 0)
  );
  const getSeasonBreakdown = (body) => {
    const withhold = body.motivation_withhold || {};
    const seasonFromRevenue = Number(withhold.season_from_revenue ?? withhold.season_amount ?? 0);
    const seasonFromTransfer = Number(
      withhold.season_from_prepayment_transfer ??
      withhold.season_amount_from_cancelled_prepayment ??
      0
    );
    const seasonTotal = Number(
      withhold.season_total ??
      withhold.season_fund_total ??
      (seasonFromRevenue + seasonFromTransfer)
    );
    return { withhold, seasonFromRevenue, seasonFromTransfer, seasonTotal };
  };
  const getShiftCloseTotals = (body) => body?.shift_close_breakdown?.totals ?? null;
  const assertShiftCloseBreakdownAligned = (body) => {
    const breakdown = body.shift_close_breakdown;
    const totals = getShiftCloseTotals(body);

    expect(breakdown).toBeDefined();
    expect(totals).toBeTruthy();
    expect(Array.isArray(breakdown.participants)).toBe(true);
    expect(typeof breakdown.formulas).toBe('object');

    expect(Number(body.collected_cash || 0)).toBeCloseTo(Number(totals.cash_received || 0), 6);
    expect(Number(body.collected_card || 0)).toBeCloseTo(Number(totals.card_received || 0), 6);
    expect(Number(body.collected_total || 0)).toBeCloseTo(Number(totals.total_received || 0), 6);
    expect(Number(body.future_trips_reserve_cash || 0)).toBeCloseTo(Number(totals.reserve_cash || 0), 6);
    expect(Number(body.future_trips_reserve_card || 0)).toBeCloseTo(Number(totals.reserve_card || 0), 6);
    expect(Number(body.future_trips_reserve_total || 0)).toBeCloseTo(Number(totals.reserve_total || 0), 6);
    expect(Number(body.sellers_collect_total || 0)).toBeCloseTo(Number(totals.collect_from_sellers || 0), 6);
    expect(Number(body.weekly_fund || 0)).toBeCloseTo(Number(totals.weekly_fund || 0), 6);
    expect(Number(body.season_fund_total || 0)).toBeCloseTo(Number(totals.season_fund_total || 0), 6);
    expect(Number(body.salary_to_pay || 0)).toBeCloseTo(Number(totals.final_salary_total || 0), 6);
    expect(Number(body.salary_base || 0)).toBeCloseTo(Number(totals.salary_base || 0), 6);
    expect(Number(body.salary_due_total || 0)).toBeCloseTo(Number(totals.final_salary_total || 0), 6);
    expect(Number(body.funds_withhold_cash_today || 0)).toBeCloseTo(Number(totals.funds_withhold_cash_today || 0), 6);
    expect(Number(body.owner_cash_available_without_future_reserve || 0)).toBeCloseTo(Number(totals.owner_cash_before_reserve || 0), 6);
    expect(Number(body.owner_cash_available_after_future_reserve_cash || 0)).toBeCloseTo(Number(totals.owner_cash_after_reserve || 0), 6);
    expect(Number(body.owner_handover_cash_final || 0)).toBeCloseTo(Number(totals.owner_cash_today || 0), 6);
  };

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
    expect(typeof body.salary_base).toBe('number');
    expect(typeof body.owner_cash_available_after_future_reserve_cash).toBe('number');
    expect(typeof body.owner_cash_available_after_reserve_and_funds_cash).toBe('number');
    expect(typeof body.owner_handover_cash_final).toBe('number');
    expect(typeof body.funds_withhold_cash_today).toBe('number');

    // E) role breakdown
    expect(Array.isArray(body.sellers)).toBe(true);
    expect(typeof body.dispatcher).toBe('object');

    // Dispatcher object structure
    expect(typeof body.dispatcher.deposit_cash).toBe('number');
    expect(typeof body.dispatcher.deposit_card).toBe('number');
    expect(typeof body.dispatcher.salary_paid_cash).toBe('number');
    expect(typeof body.dispatcher.salary_paid_card).toBe('number');
    expect(typeof body.dispatcher.salary_paid_total).toBe('number');
    assertShiftCloseBreakdownAligned(body);
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
    expect(typeof body.salary_base).toBe('number');
    expect(typeof body.owner_cash_available_after_future_reserve_cash).toBe('number');
    expect(typeof body.owner_cash_available_after_reserve_and_funds_cash).toBe('number');
    expect(typeof body.owner_handover_cash_final).toBe('number');
    expect(typeof body.funds_withhold_cash_today).toBe('number');

    // E) role breakdown
    expect(Array.isArray(body.sellers)).toBe(true);
    expect(typeof body.dispatcher).toBe('object');
    assertShiftCloseBreakdownAligned(body);
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
      expect(typeof seller.team_part).toBe('number');
      expect(typeof seller.individual_part).toBe('number');
      expect(typeof seller.total_raw).toBe('number');
      expect(typeof seller.salary_rounding_to_season).toBe('number');
      expect(typeof seller.personal_revenue_day).toBe('number');
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

  it('4b) dispatcher payout row is present in LIVE and SNAPSHOT with salary breakdown fields', async () => {
    const businessDay = '2099-07-11';
    const sellerId = seedData.users.sellerA.id;

    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 60000, 'POSTED', ?, ?)
    `).run(businessDay, sellerId);
    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SALE_ACCEPTED_CASH', 'DISPATCHER_SHIFT', 'CASH', 40000, 'POSTED', ?, ?)
    `).run(businessDay, dispatcherId);

    const liveRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveRes.status).toBe(200);
    expect(liveRes.body.ok).toBe(true);

    const liveDispatcherRow = (liveRes.body.sellers || []).find(
      (seller) => Number(seller.seller_id) === Number(dispatcherId)
    );

    expect(liveDispatcherRow).toBeDefined();
    expect(liveDispatcherRow.role).toBe('dispatcher');
    expect(Number(liveDispatcherRow.salary_due_total || 0)).toBeGreaterThan(0);
    expect(Number(liveDispatcherRow.personal_revenue_day || 0)).toBe(40000);
    expect(typeof liveDispatcherRow.team_part).toBe('number');
    expect(typeof liveDispatcherRow.individual_part).toBe('number');
    expect(typeof liveDispatcherRow.total_raw).toBe('number');
    expect(typeof liveDispatcherRow.salary_rounding_to_season).toBe('number');

    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: businessDay });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);

    const snapshotRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.body.source).toBe('snapshot');

    const snapshotDispatcherRow = (snapshotRes.body.sellers || []).find(
      (seller) => Number(seller.seller_id) === Number(dispatcherId)
    );

    expect(snapshotDispatcherRow).toBeDefined();
    expect(snapshotDispatcherRow.role).toBe('dispatcher');
    expect(Number(snapshotDispatcherRow.salary_due_total || 0)).toBe(Number(liveDispatcherRow.salary_due_total || 0));
    expect(Number(snapshotDispatcherRow.team_part || 0)).toBeCloseTo(Number(liveDispatcherRow.team_part || 0), 6);
    expect(Number(snapshotDispatcherRow.individual_part || 0)).toBeCloseTo(Number(liveDispatcherRow.individual_part || 0), 6);
    expect(Number(snapshotDispatcherRow.total_raw || 0)).toBeCloseTo(Number(liveDispatcherRow.total_raw || 0), 6);
    expect(Number(snapshotDispatcherRow.personal_revenue_day || 0)).toBe(Number(liveDispatcherRow.personal_revenue_day || 0));
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

  it('6) dispatcher-collected seller-linked revenue stays out of seller debt rows', async () => {
    const businessDay = '2099-07-03';
    const sellerId = seedData.users.sellerA.id;

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
    expect(res.body.sellers.length).toBeGreaterThanOrEqual(1);
    const sellerRow = (res.body.sellers || []).find((seller) => Number(seller.seller_id) === Number(sellerId));
    expect(sellerRow).toBeDefined();
    expect(Number(sellerRow.cash_due_to_owner || 0)).toBe(0);
    expect(Number(sellerRow.terminal_due_to_owner || sellerRow.terminal_debt || 0)).toBe(0);
    expect(Number(res.body.sellers_collect_total || 0)).toBe(0);
    expect(Number(res.body.sellers_debt_total || 0)).toBe(0);
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
    const getSellerCashDebtTotal = (rows) => (rows || []).reduce((sum, s) => (
      sum + Math.max(0, Number(s.cash_due_to_owner ?? s.cash_balance ?? 0))
    ), 0);
    const calcOwnerHandoverFinal = (body) => (
      Number(body.net_cash || 0) -
      Number(body.salary_paid_cash || 0) -
      getSellerCashDebtTotal(body.sellers || []) -
      Math.max(0, Number(body.salary_due_total || 0) - Number(body.salary_paid_total || 0)) -
      Number(body.future_trips_reserve_cash || 0) -
      Number(body.funds_withhold_cash_today || 0)
    );

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
    expect(Number(liveRes.body.owner_handover_cash_final || 0)).toBe(calcOwnerHandoverFinal(liveRes.body));

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
    expect(Number(snapRes.body.owner_handover_cash_final || 0)).toBe(calcOwnerHandoverFinal(snapRes.body));
  });

  it('8) future reserve metrics include cash/card/mixed and stay consistent after next-day refund', async () => {
    const businessDay = '2099-07-08';
    const nextBusinessDay = '2099-07-09';
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
      900, 900, 'CASH', 900, 0, nextBusinessDay
    ).lastInsertRowid);
    const pFutureCard = Number(insertPresale.run(
      slotId, `generated:${seedData.slots.generated.genSlot1}`, sellerId,
      'Future Card', '+79990001002', 1,
      700, 700, 'CARD', 0, 700, nextBusinessDay
    ).lastInsertRowid);
    const pFutureMixed = Number(insertPresale.run(
      slotId, `generated:${seedData.slots.generated.genSlot2}`, sellerId,
      'Future Mixed', '+79990001003', 1,
      1000, 1000, 'MIXED', 400, 600, nextBusinessDay
    ).lastInsertRowid);
    const pToday = Number(insertPresale.run(
      slotId, `manual:${slotId}`, sellerId,
      'Today Sale', '+79990001004', 1,
      300, 300, 'CASH', 300, 0, businessDay
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

    insertLedger({ presaleId: pFutureCash, type: 'SALE_PREPAYMENT_CASH', method: 'CASH', amount: 900, day: businessDay, cashAmount: 900, cardAmount: 0 });
    insertLedger({ presaleId: pFutureCard, type: 'SALE_ACCEPTED_CARD', method: 'CARD', amount: 700, day: businessDay, cashAmount: 0, cardAmount: 700 });
    insertLedger({ presaleId: pFutureMixed, type: 'SALE_ACCEPTED_MIXED', method: 'MIXED', amount: 1000, day: businessDay, cashAmount: 400, cardAmount: 600 });
    insertLedger({ presaleId: pToday, type: 'SALE_ACCEPTED_CASH', method: 'CASH', amount: 300, day: businessDay, cashAmount: 300, cardAmount: 0 });

    const liveToday = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveToday.status).toBe(200);
    expect(liveToday.body.ok).toBe(true);
    expect(Number(liveToday.body.future_trips_reserve_cash || 0)).toBe(1300);
    expect(Number(liveToday.body.future_trips_reserve_card || 0)).toBe(1300);
    expect(Number(liveToday.body.future_trips_reserve_total || 0)).toBe(2600);
    expect(Number(liveToday.body.salary_base || 0)).toBe(
      Number(liveToday.body.net_total || 0) - Number(liveToday.body.future_trips_reserve_total || 0)
    );
    expect(Number(liveToday.body.owner_cash_available_after_future_reserve_cash || 0)).toBe(
      Number(liveToday.body.owner_cash_available_without_future_reserve || 0) -
      Number(liveToday.body.future_trips_reserve_cash || 0)
    );
    expect(Number(liveToday.body.explain?.liabilities?.future_trips_reserve_cash || 0)).toBe(1300);
    expect(Number(liveToday.body.explain?.liabilities?.future_trips_reserve_terminal || 0)).toBe(1300);

    // Refund on the next day should not create "future reserve" for that day.
    insertLedger({ presaleId: pFutureCash, type: 'SALE_CANCEL_REVERSE', method: 'CASH', amount: -900, day: nextBusinessDay, cashAmount: -900, cardAmount: 0 });

    const liveTomorrow = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${nextBusinessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveTomorrow.status).toBe(200);
    expect(liveTomorrow.body.ok).toBe(true);
    expect(Number(liveTomorrow.body.future_trips_reserve_total || 0)).toBe(0);
    expect(Number(liveTomorrow.body.future_trips_reserve_cash || 0)).toBe(0);
    expect(Number(liveTomorrow.body.future_trips_reserve_card || 0)).toBe(0);
  });

  it('9) season from revenue without prepayment transfer keeps handover tied to daily withhold only', async () => {
    const businessDay = '2099-07-07';
    const sellerId = seedData.users.sellerA.id;

    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SALE_ACCEPTED_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
    `).run(businessDay, sellerId);

    const assertSaleOnly = (body) => {
      const { withhold, seasonFromRevenue, seasonFromTransfer, seasonTotal } = getSeasonBreakdown(body);
      expect(seasonFromRevenue).toBeGreaterThan(0);
      expect(seasonFromTransfer).toBe(0);
      expect(seasonTotal).toBeCloseTo(seasonFromRevenue, 6);
      expect(Number(withhold.fund_total_after_withhold || 0)).toBeCloseTo(
        Number(withhold.fund_total_original || 0) -
        Number(withhold.weekly_amount || 0) -
        seasonFromRevenue -
        Number(withhold.dispatcher_amount_total || 0),
        6
      );
      expect(Number(body.funds_withhold_cash_today || 0)).toBeCloseTo(
        Number(withhold.weekly_amount || 0) +
        seasonFromRevenue +
        Number(withhold.dispatcher_amount_total || 0),
        6
      );
      expect(Number(body.owner_handover_cash_final || 0)).toBeCloseTo(calcOwnerHandoverFinal(body), 6);
    };

    const liveRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveRes.status).toBe(200);
    expect(liveRes.body.ok).toBe(true);
    assertSaleOnly(liveRes.body);

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
    assertSaleOnly(snapRes.body);
  });

  it('10) season fund total includes cancelled prepayment routed to season without reducing owner handover', async () => {
    const businessDay = '2099-07-05';
    const sellerId = seedData.users.sellerA.id;

    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SALE_ACCEPTED_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
    `).run(businessDay, sellerId);

    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SEASON_PREPAY_DELETE', 'FUND', 'INTERNAL', 1200, 'POSTED', ?, NULL)
    `).run(businessDay);

    const assertSeasonFund = (body) => {
      const { withhold, seasonFromRevenue, seasonFromTransfer, seasonTotal } = getSeasonBreakdown(body);
      expect(seasonFromTransfer).toBe(1200);
      expect(seasonTotal).toBeCloseTo(
        seasonFromRevenue + 1200,
        6
      );
      expect(Number(withhold.fund_total_after_withhold || 0)).toBeCloseTo(
        Number(withhold.fund_total_original || 0) -
        Number(withhold.weekly_amount || 0) -
        seasonFromRevenue -
        Number(withhold.dispatcher_amount_total || 0),
        6
      );
      expect(Number(body.salary_due_total || 0)).toBeLessThanOrEqual(
        Math.max(0, Number(withhold.fund_total_after_withhold || 0)) + 0.009
      );
      expect(Number(body.funds_withhold_cash_today || 0)).toBeCloseTo(
        Number(withhold.weekly_amount || 0) +
        seasonFromRevenue +
        Number(withhold.dispatcher_amount_total || 0),
        6
      );
      expect(Number(body.owner_handover_cash_final || 0)).toBeCloseTo(calcOwnerHandoverFinal(body), 6);
    };

    const liveRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveRes.status).toBe(200);
    expect(liveRes.body.ok).toBe(true);
    assertSeasonFund(liveRes.body);

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
    assertSeasonFund(snapRes.body);
  });

  it('11) season prepay transfer without sales stays outside daily owner handover withhold', async () => {
    const businessDay = '2099-07-06';

    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SEASON_PREPAY_DELETE', 'FUND', 'INTERNAL', 1000, 'POSTED', ?, NULL)
    `).run(businessDay);

    const assertTransferOnlyDay = (body) => {
      const { withhold, seasonFromRevenue, seasonFromTransfer, seasonTotal } = getSeasonBreakdown(body);
      expect(Number(body.collected_total || 0)).toBe(0);
      expect(Number(body.net_total || 0)).toBe(0);
      expect(Number(body.salary_due_total || 0)).toBe(0);
      expect(Number(withhold.fund_total_original || 0)).toBe(0);
      expect(seasonFromRevenue).toBe(0);
      expect(seasonFromTransfer).toBe(1000);
      expect(seasonTotal).toBe(1000);
      expect(Number(withhold.fund_total_after_withhold || 0)).toBe(0);
      expect(Number(body.funds_withhold_cash_today || 0)).toBe(0);
      expect(Number(body.owner_handover_cash_final || 0)).toBeCloseTo(calcOwnerHandoverFinal(body), 6);
    };

    const liveRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveRes.status).toBe(200);
    expect(liveRes.body.ok).toBe(true);
    assertTransferOnlyDay(liveRes.body);

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
    assertTransferOnlyDay(snapRes.body);
  });

  it('12) 2026-04-02 keeps top cards, snapshot breakdown and owner settings trace in sync', async () => {
    const businessDay = '2026-04-02';
    const nextBusinessDay = '2026-04-03';
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

    const futureCashPresaleId = Number(insertPresale.run(
      slotId,
      `manual:${slotId}`,
      sellerId,
      'Future Cash 2026-04-03',
      '+79990002001',
      1,
      900,
      900,
      'CASH',
      900,
      0,
      nextBusinessDay
    ).lastInsertRowid);

    const futureCardPresaleId = Number(insertPresale.run(
      slotId,
      `manual:${slotId}`,
      sellerId,
      'Future Card 2026-04-03',
      '+79990002002',
      1,
      700,
      700,
      'CARD',
      0,
      700,
      nextBusinessDay
    ).lastInsertRowid);

    const ledgerCols = new Set(db.prepare(`PRAGMA table_info(money_ledger)`).all().map((row) => row.name));
    const insertLedger = ({
      seller_id,
      kind,
      type,
      method,
      amount,
      presale_id = null,
      slot_id = null,
      cash_amount = 0,
      card_amount = 0,
    }) => {
      const cols = ['kind', 'type', 'method', 'amount', 'status', 'business_day', 'seller_id'];
      const vals = [kind, type, method, amount, 'POSTED', businessDay, seller_id];
      if (presale_id !== null) {
        cols.push('presale_id');
        vals.push(presale_id);
      }
      if (slot_id !== null) {
        cols.push('slot_id');
        vals.push(slot_id);
      }
      if (ledgerCols.has('cash_amount')) {
        cols.push('cash_amount');
        vals.push(cash_amount);
      }
      if (ledgerCols.has('card_amount')) {
        cols.push('card_amount');
        vals.push(card_amount);
      }
      db.prepare(`INSERT INTO money_ledger (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
    };

    insertLedger({
      seller_id: sellerId,
      kind: 'SELLER_SHIFT',
      type: 'SALE_ACCEPTED_CASH',
      method: 'CASH',
      amount: 120000,
      cash_amount: 120000,
      card_amount: 0,
    });
    insertLedger({
      seller_id: sellerId,
      kind: 'SELLER_SHIFT',
      type: 'SALE_ACCEPTED_CARD',
      method: 'CARD',
      amount: 80000,
      cash_amount: 0,
      card_amount: 80000,
    });
    insertLedger({
      seller_id: dispatcherId,
      kind: 'DISPATCHER_SHIFT',
      type: 'SALE_ACCEPTED_CASH',
      method: 'CASH',
      amount: 40000,
      cash_amount: 40000,
      card_amount: 0,
    });
    insertLedger({
      seller_id: sellerId,
      kind: 'SELLER_SHIFT',
      type: 'SALE_PREPAYMENT_CASH',
      method: 'CASH',
      amount: 900,
      presale_id: futureCashPresaleId,
      slot_id: slotId,
      cash_amount: 900,
      card_amount: 0,
    });
    insertLedger({
      seller_id: sellerId,
      kind: 'SELLER_SHIFT',
      type: 'SALE_ACCEPTED_CARD',
      method: 'CARD',
      amount: 700,
      presale_id: futureCardPresaleId,
      slot_id: slotId,
      cash_amount: 0,
      card_amount: 700,
    });

    const liveRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveRes.status).toBe(200);
    expect(liveRes.body.ok).toBe(true);
    expect(['live', 'ledger']).toContain(liveRes.body.source);
    assertShiftCloseBreakdownAligned(liveRes.body);
    expect(Number(liveRes.body.collected_cash || 0)).toBe(160900);
    expect(Number(liveRes.body.collected_card || 0)).toBe(80700);
    expect(Number(liveRes.body.collected_total || 0)).toBe(241600);
    expect(Number(liveRes.body.future_trips_reserve_cash || 0)).toBe(900);
    expect(Number(liveRes.body.future_trips_reserve_card || 0)).toBe(700);
    expect(Number(liveRes.body.future_trips_reserve_total || 0)).toBe(1600);
    expect(Number(liveRes.body.salary_base || 0)).toBe(240000);
    expect(Number(liveRes.body.funds_withhold_cash_today || 0)).toBe(3450);
    expect(Number(liveRes.body.owner_handover_cash_final || 0)).toBe(122900);
    expect(getShiftCloseTotals(liveRes.body)).toMatchObject({
      cash_received: 160900,
      card_received: 80700,
      total_received: 241600,
      reserve_cash: 900,
      reserve_card: 700,
      reserve_total: 1600,
      collect_from_sellers: 900,
      salary_base: 240000,
      motivation_fund: 36000,
      weekly_fund: 1900,
      season_from_revenue: 1350,
      season_base: 1200,
      season_rounding: 150,
      season_prepay_transfer: 0,
      season_fund_total: 1350,
      dispatcher_bonus: 200,
      salary_fund_total: 32840,
      final_salary_total: 32750,
      owner_cash_before_reserve: 127250,
      owner_cash_after_reserve: 126350,
      owner_cash_today: 122900,
      funds_withhold_cash_today: 3450,
    });

    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: businessDay });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(closeRes.body.closed).toBe(true);
    expect(closeRes.body.shift_close_breakdown).toBeDefined();

    const frozenBreakdown = closeRes.body.shift_close_breakdown;
    const closureRow = db.prepare(`
      SELECT calculation_json
      FROM shift_closures
      WHERE business_day = ?
    `).get(businessDay);

    expect(closureRow?.calculation_json).toBeTruthy();
    const storedBreakdown = JSON.parse(closureRow.calculation_json);
    expect(storedBreakdown.version).toBe('shift_close_v2026_04_02');
    expect(storedBreakdown.totals).toEqual(frozenBreakdown.totals);
    expect(Number(storedBreakdown.totals.salary_base || 0)).toBe(240000);

    const settingsRow = db.prepare('SELECT settings_json FROM owner_settings WHERE id = 1').get();
    const currentSettings = settingsRow?.settings_json ? JSON.parse(settingsRow.settings_json) : {};
    db.prepare(`
      INSERT INTO owner_settings (id, settings_json)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json
    `).run(JSON.stringify({
      ...currentSettings,
      motivation_percent: 0.45,
      weekly_percent: 0.2,
      season_percent: 0.15,
      weekly_withhold_percent_total: 0.2,
      season_withhold_percent_total: 0.15,
      dispatcher_withhold_percent_total: 0.1,
    }));

    const snapRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(snapRes.status).toBe(200);
    expect(snapRes.body.ok).toBe(true);
    expect(snapRes.body.source).toBe('snapshot');
    assertShiftCloseBreakdownAligned(snapRes.body);
    expect(Number(snapRes.body.collected_cash || 0)).toBe(160900);
    expect(Number(snapRes.body.collected_card || 0)).toBe(80700);
    expect(Number(snapRes.body.collected_total || 0)).toBe(241600);
    expect(Number(snapRes.body.future_trips_reserve_total || 0)).toBe(1600);
    expect(Number(snapRes.body.salary_base || 0)).toBe(240000);
    expect(Number(snapRes.body.funds_withhold_cash_today || 0)).toBe(3450);
    expect(Number(snapRes.body.owner_handover_cash_final || 0)).toBe(122900);
    expect(snapRes.body.shift_close_breakdown.totals).toEqual(frozenBreakdown.totals);
    expect(snapRes.body.shift_close_breakdown.withhold).toEqual(frozenBreakdown.withhold);
    expect(snapRes.body.shift_close_breakdown.settings).toEqual(frozenBreakdown.settings);
    expect(Number(snapRes.body.motivation_withhold?.weekly_amount || 0)).toBeCloseTo(
      Number(frozenBreakdown.withhold?.weekly_amount || 0),
      6
    );
    expect(Number(snapRes.body.motivation_withhold?.dispatcher_amount_total || 0)).toBeCloseTo(
      Number(frozenBreakdown.withhold?.dispatcher_amount_total || 0),
      6
    );
  });
});
