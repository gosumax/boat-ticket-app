import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app;
let db;
let seedData;
let dispatcherId;
let dispatcherToken;
let calcMotivationDay;
let backfillAllLegacyShiftClosures;

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  seedData = await seedBasicData(db);

  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_backfill', hashedPassword);
  dispatcherId = Number(dispatcherRes.lastInsertRowid);
  dispatcherToken = jwt.sign(
    { id: dispatcherId, username: 'test_dispatcher_backfill', role: 'dispatcher' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  ({ calcMotivationDay } = await import('../../server/motivation/engine.mjs'));
  ({ backfillAllLegacyShiftClosures } = await import('../../server/shift-closure-backfill.mjs'));
});

describe('SHIFT CLOSURE BACKFILL', () => {
  it('backfills legacy closed day without shift_closures row and serves canonical snapshot totals', async () => {
    const businessDay = '2099-08-03';
    const sellerId = seedData.users.sellerA.id;
    const ledgerCols = new Set(db.prepare(`PRAGMA table_info(money_ledger)`).all().map((row) => row.name));

    const insertLedger = ({ seller_id = null, kind, type, method = 'INTERNAL', amount }) => {
      const cols = ['kind', 'type', 'method', 'amount', 'status', 'business_day'];
      const vals = [kind, type, method, amount, 'POSTED', businessDay];
      if (ledgerCols.has('seller_id')) {
        cols.push('seller_id');
        vals.push(seller_id);
      }
      if (ledgerCols.has('event_time')) {
        cols.push('event_time');
        vals.push(`${businessDay} 18:00:00`);
      }
      if (ledgerCols.has('decision_final')) {
        cols.push('decision_final');
        vals.push(1);
      }
      db.prepare(`
        INSERT INTO money_ledger (${cols.join(', ')})
        VALUES (${cols.map(() => '?').join(', ')})
      `).run(...vals);
    };

    insertLedger({
      seller_id: sellerId,
      kind: 'SELLER_SHIFT',
      type: 'SALE_ACCEPTED_CASH',
      method: 'CASH',
      amount: 100000,
    });

    const motivationResult = calcMotivationDay(db, businessDay, {
      profile: 'dispatcher_shift_close',
      dispatcherUserId: dispatcherId,
    });
    const withhold = motivationResult?.data?.withhold || {};
    const weeklyAmount = Number(withhold.weekly_amount || 0);
    const seasonAmount = Number(withhold.season_amount || 0);

    expect(weeklyAmount).toBeGreaterThan(0);
    expect(seasonAmount).toBeGreaterThan(0);

    insertLedger({
      kind: 'FUND',
      type: 'WITHHOLD_WEEKLY',
      amount: weeklyAmount,
    });
    insertLedger({
      kind: 'FUND',
      type: 'WITHHOLD_SEASON',
      amount: seasonAmount,
    });

    const beforeRow = db.prepare(`
      SELECT calculation_json
      FROM shift_closures
      WHERE business_day = ?
    `).get(businessDay);
    expect(beforeRow).toBeUndefined();

    const backfillResult = backfillAllLegacyShiftClosures(db, {
      dispatcherUserId: dispatcherId,
      snapshotSource: 'snapshot_backfill',
    });

    expect(backfillResult.ok).toBe(true);
    expect(Number(backfillResult.backfilled_days || 0)).toBeGreaterThanOrEqual(1);

    const closureRow = db.prepare(`
      SELECT calculation_json
      FROM shift_closures
      WHERE business_day = ?
        AND calculation_json IS NOT NULL
        AND calculation_json != ''
      LIMIT 1
    `).get(businessDay);

    expect(closureRow?.calculation_json).toBeTruthy();

    const storedBreakdown = JSON.parse(closureRow.calculation_json);
    expect(storedBreakdown?.totals).toBeTruthy();
    expect(Number(storedBreakdown.totals.weekly_fund || 0)).toBeGreaterThan(0);
    expect(Number(storedBreakdown.totals.season_fund_total || 0)).toBeGreaterThan(0);
    expect(Number(storedBreakdown.totals.final_salary_total || 0)).toBeGreaterThan(0);

    const summaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.ok).toBe(true);
    expect(summaryRes.body.source).toBe('snapshot');
    expect(summaryRes.body.is_closed).toBe(true);
    expect(summaryRes.body.shift_close_breakdown?.totals).toEqual(storedBreakdown.totals);
    expect(Number(summaryRes.body.owner_cash_today || 0)).toBeCloseTo(Number(storedBreakdown.totals.owner_cash_today || 0), 6);
    expect(Number(summaryRes.body.weekly_fund || 0)).toBeCloseTo(Number(storedBreakdown.totals.weekly_fund || 0), 6);
    expect(Number(summaryRes.body.season_fund_total || 0)).toBeCloseTo(Number(storedBreakdown.totals.season_fund_total || 0), 6);
    expect(Number(summaryRes.body.salary_to_pay || 0)).toBeCloseTo(Number(storedBreakdown.totals.final_salary_total || 0), 6);
    expect(Number(summaryRes.body.salary_due_total || 0)).toBeCloseTo(Number(summaryRes.body.salary_to_pay || 0), 6);
  });
});
