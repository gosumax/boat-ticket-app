import { describe, it, expect, beforeAll } from 'vitest';
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
let ownerToken;
let dispatcherToken;

describe('OWNER MONEY SUMMARY: FUND INTERNAL LEDGER AGGREGATION', () => {
  beforeAll(async () => {
    resetTestDb();
    app = await makeApp();
    db = getTestDb();
    seedData = await seedBasicData(db);

    const hashedPassword = bcrypt.hashSync('password123', 10);

    const ownerRes = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, 'owner', 1)
    `).run('test_owner_funds_internal', hashedPassword);
    ownerToken = jwt.sign(
      { id: ownerRes.lastInsertRowid, username: 'test_owner_funds_internal', role: 'owner' },
      JWT_SECRET,
      { expiresIn: '24h' },
    );

    const dispatcherRes = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, 'dispatcher', 1)
    `).run('test_dispatcher_funds_internal', hashedPassword);
    dispatcherToken = jwt.sign(
      { id: dispatcherRes.lastInsertRowid, username: 'test_dispatcher_funds_internal', role: 'dispatcher' },
      JWT_SECRET,
      { expiresIn: '24h' },
    );

    db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
  });

  it('owner summary sees weekly/season withhold from INTERNAL fund ledger and matches dispatcher shift summary', async () => {
    const day = '2033-02-10';
    const sellerId = Number(seedData?.users?.sellerA?.id || 0);
    expect(sellerId).toBeGreaterThan(0);

    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
    `).run(day, sellerId);

    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: day });
    expect(closeRes.status).toBe(200);
    expect(closeRes.body?.ok).toBe(true);

    const fundRows = db.prepare(`
      SELECT type, method, amount
      FROM money_ledger
      WHERE business_day = ?
        AND kind = 'FUND'
        AND type IN ('WITHHOLD_WEEKLY', 'WITHHOLD_SEASON')
        AND status = 'POSTED'
      ORDER BY type
    `).all(day);

    expect(fundRows.length).toBe(2);
    expect(fundRows.every((r) => String(r.method) === 'INTERNAL')).toBe(true);

    const weeklyLedger = Number(fundRows.find((r) => r.type === 'WITHHOLD_WEEKLY')?.amount || 0);
    const seasonLedger = Number(fundRows.find((r) => r.type === 'WITHHOLD_SEASON')?.amount || 0);
    expect(weeklyLedger).toBeGreaterThan(0);
    expect(seasonLedger).toBeGreaterThan(0);

    const dispatcherSummaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${day}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    expect(dispatcherSummaryRes.status).toBe(200);
    expect(dispatcherSummaryRes.body?.ok).toBe(true);

    const withhold = dispatcherSummaryRes.body?.motivation_withhold || {};

    const ownerSummaryRes = await request(app)
      .get(`/api/owner/money/summary?from=${day}&to=${day}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerSummaryRes.status).toBe(200);
    expect(ownerSummaryRes.body?.ok).toBe(true);

    const totals = ownerSummaryRes.body?.data?.totals || {};
    expect(typeof totals.funds_withhold_weekly_today).toBe('number');
    expect(typeof totals.funds_withhold_season_today).toBe('number');
    expect(typeof totals.funds_withhold_dispatcher_bonus_today).toBe('number');
    expect(typeof totals.funds_withhold_rounding_to_season_today).toBe('number');

    expect(Number(totals.funds_withhold_weekly_today)).toBeCloseTo(weeklyLedger, 6);
    expect(Number(totals.funds_withhold_season_today)).toBeCloseTo(seasonLedger, 6);
    expect(Number(totals.funds_withhold_weekly_today)).toBeCloseTo(Number(withhold.weekly_amount || 0), 6);
    expect(Number(totals.funds_withhold_season_today)).toBeCloseTo(Number(withhold.season_amount || 0), 6);
    expect(Number(totals.funds_withhold_dispatcher_bonus_today)).toBeCloseTo(Number(withhold.dispatcher_amount_total || 0), 6);
    expect(Number(totals.funds_withhold_rounding_to_season_today)).toBeCloseTo(Number(withhold.rounding_to_season_amount_total || 0), 6);
  });
});
