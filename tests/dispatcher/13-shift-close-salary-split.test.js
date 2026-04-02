import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app;
let db;
let dispatcherToken;
let dispatcherId;
let sellerId;

const DAY = '2034-02-10';

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();

  const seedData = await seedBasicData(db);
  sellerId = seedData?.users?.sellerA?.id
    || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;

  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('dispatcher_shift_split', hashedPassword);
  dispatcherId = Number(dispatcherRes.lastInsertRowid);
  dispatcherToken = jwt.sign(
    { id: dispatcherId, username: 'dispatcher_shift_split', role: 'dispatcher' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
});

beforeEach(() => {
  db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY);
  db.prepare(`DELETE FROM money_ledger WHERE business_day = ?`).run(DAY);
  db.prepare(`DELETE FROM shift_closures WHERE business_day = ?`).run(DAY);

  db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
    motivationType: 'team',
    motivation_percent: 0.15,
    team_share: 0.5,
    individual_share: 0.5,
    k_dispatchers: 1,
    teamIncludeSellers: true,
    teamIncludeDispatchers: true,
    dispatcher_withhold_percent_total: 0.004,
    weekly_withhold_percent_total: 0.008,
    season_withhold_percent_total: 0.005,
    viklif_withhold_percent_total: 0.02,
  }));
});

describe('DISPATCHER SHIFT CLOSE SALARY SPLIT', () => {
  it('uses team and individual parts plus dispatcher bonus with invariant-safe rounding', async () => {
    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SALE_ACCEPTED_CASH', 'SELLER_SHIFT', 'CASH', 60000, 'POSTED', ?, ?)
    `).run(DAY, sellerId);
    db.prepare(`
      INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
      VALUES ('SALE_ACCEPTED_CASH', 'DISPATCHER_SHIFT', 'CASH', 40000, 'POSTED', ?, ?)
    `).run(DAY, dispatcherId);

    const liveRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${DAY}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveRes.status).toBe(200);
    expect(liveRes.body.ok).toBe(true);
    expect(liveRes.body.source).toBe('live');
    expect(Number(liveRes.body.salary_total || 0)).toBe(Number(liveRes.body.salary_due_total || 0));
    expect(Number(liveRes.body.motivation_withhold?.viklif_amount || 0)).toBe(0);

    const liveRows = Array.isArray(liveRes.body.sellers) ? liveRes.body.sellers : [];
    const liveSellerRow = liveRows.find((row) => Number(row.seller_id) === Number(sellerId));
    const liveDispatcherRow = liveRows.find((row) => Number(row.seller_id) === Number(dispatcherId));

    expect(liveSellerRow).toBeDefined();
    expect(liveDispatcherRow).toBeDefined();

    expect(Number(liveSellerRow.team_part || 0)).toBeGreaterThan(0);
    expect(Number(liveSellerRow.individual_part || 0)).toBeGreaterThan(0);
    expect(Number(liveDispatcherRow.team_part || 0)).toBeGreaterThan(0);
    expect(Number(liveDispatcherRow.individual_part || 0)).toBeGreaterThan(0);
    expect(Number(liveDispatcherRow.dispatcher_daily_bonus || 0)).toBeGreaterThan(0);

    const dispatcherRawFromParts =
      Number(liveDispatcherRow.team_part || 0) +
      Number(liveDispatcherRow.individual_part || 0) +
      Number(liveDispatcherRow.dispatcher_daily_bonus || 0);
    expect(Number(liveDispatcherRow.total_raw || 0)).toBeCloseTo(dispatcherRawFromParts, 6);
    expect(
      Number(liveDispatcherRow.salary_due_total || 0) +
      Number(liveDispatcherRow.salary_rounding_to_season || 0)
    ).toBeCloseTo(Number(liveDispatcherRow.total_raw || 0), 6);

    const roundedPayoutTotal = liveRows.reduce((sum, row) => sum + Number(row.salary_due_total || row.salary_due || 0), 0);
    const payoutRoundingTotal = liveRows.reduce((sum, row) => sum + Number(row.salary_rounding_to_season || 0), 0);
    expect(roundedPayoutTotal).toBe(Number(liveRes.body.salary_due_total || 0));
    expect(roundedPayoutTotal + payoutRoundingTotal).toBeCloseTo(
      Number(liveRes.body.motivation_withhold?.fund_total_after_withhold || 0),
      6
    );

    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: DAY });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(closeRes.body.is_closed).toBe(true);

    const snapshotRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${DAY}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.body.source).toBe('snapshot');
    expect(Number(snapshotRes.body.salary_total || 0)).toBe(Number(snapshotRes.body.salary_due_total || 0));

    const snapshotRows = Array.isArray(snapshotRes.body.sellers) ? snapshotRes.body.sellers : [];
    const snapshotDispatcherRow = snapshotRows.find((row) => Number(row.seller_id) === Number(dispatcherId));
    const snapshotSellerRow = snapshotRows.find((row) => Number(row.seller_id) === Number(sellerId));

    expect(snapshotSellerRow).toBeDefined();
    expect(snapshotDispatcherRow).toBeDefined();
    expect(Number(snapshotSellerRow.individual_part || 0)).toBeGreaterThan(0);
    expect(Number(snapshotDispatcherRow.individual_part || 0)).toBeGreaterThan(0);
    expect(Number(snapshotDispatcherRow.dispatcher_daily_bonus || 0)).toBeGreaterThan(0);
    expect(Number(snapshotDispatcherRow.team_part || 0)).toBeCloseTo(Number(liveDispatcherRow.team_part || 0), 6);
    expect(Number(snapshotDispatcherRow.individual_part || 0)).toBeCloseTo(Number(liveDispatcherRow.individual_part || 0), 6);
    expect(Number(snapshotDispatcherRow.dispatcher_daily_bonus || 0)).toBeCloseTo(Number(liveDispatcherRow.dispatcher_daily_bonus || 0), 6);
  });
});
