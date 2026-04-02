import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import normalizeSummary from '../../src/utils/normalizeSummary.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';
const BUSINESS_DAY = '2026-04-02';
const EXPECTED_TOTALS = {
  owner_cash_today: 61140,
  weekly_fund: 900,
  season_fund_total: 1760,
  final_salary_total: 16100,
  salary_to_pay: 16100,
};
const CONTROLLED_SETTINGS = {
  motivationType: 'team',
  motivation_percent: 18760 / 79900,
  teamIncludeSellers: false,
  teamIncludeDispatchers: true,
  viklif_withhold_percent_total: 0,
  dispatcher_withhold_percent_total: 0,
  weekly_withhold_percent_total: 900 / 79900,
  season_withhold_percent_total: 1760 / 79900,
};

let app;
let db;
let dispatcherUser;
let dispatcherToken;

function assertCanonicalTotals(payload) {
  expect(Number(payload.owner_cash_today || 0)).toBe(EXPECTED_TOTALS.owner_cash_today);
  expect(Number(payload.weekly_fund || 0)).toBe(EXPECTED_TOTALS.weekly_fund);
  expect(Number(payload.season_fund_total || 0)).toBe(EXPECTED_TOTALS.season_fund_total);
  expect(Number(payload.final_salary_total || 0)).toBe(EXPECTED_TOTALS.final_salary_total);
  expect(Number(payload.salary_to_pay || 0)).toBe(EXPECTED_TOTALS.salary_to_pay);
  expect(Number(payload.owner_handover_cash_final || payload.owner_cash_today || 0)).toBe(EXPECTED_TOTALS.owner_cash_today);
}

function assertBreakdownTotals(payload) {
  const totals = payload?.shift_close_breakdown?.totals;
  expect(totals).toBeDefined();
  expect(Number(totals.owner_cash_today || 0)).toBe(EXPECTED_TOTALS.owner_cash_today);
  expect(Number(totals.weekly_fund || 0)).toBe(EXPECTED_TOTALS.weekly_fund);
  expect(Number(totals.season_fund_total || 0)).toBe(EXPECTED_TOTALS.season_fund_total);
  expect(Number(totals.final_salary_total || 0)).toBe(EXPECTED_TOTALS.final_salary_total);
}

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
});

beforeEach(async () => {
  db.exec(`
    DELETE FROM shift_closures;
    DELETE FROM money_ledger;
    DELETE FROM motivation_day_settings;
    DELETE FROM seller_day_stats;
    DELETE FROM seller_season_applied_days;
    DELETE FROM seller_season_stats;
    DELETE FROM seller_motivation_state;
    DELETE FROM owner_settings;
  `);

  const seed = await seedBasicData(db);
  dispatcherUser = seed.users.dispatcher;
  dispatcherToken = jwt.sign(
    { id: dispatcherUser.id, username: dispatcherUser.username, role: 'dispatcher' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  db.prepare(`
    INSERT INTO owner_settings (id, settings_json)
    VALUES (1, ?)
  `).run(JSON.stringify(CONTROLLED_SETTINGS));

  db.prepare(`
    INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
    VALUES ('SALE_ACCEPTED_CASH', 'DISPATCHER_SHIFT', 'CASH', 79900, 'POSTED', ?, ?)
  `).run(BUSINESS_DAY, dispatcherUser.id);
});

describe('dispatcher shift close live/snapshot consistency', () => {
  it('keeps canonical 2026-04-02 totals identical across live summary, close snapshot, stored calculation_json, aliases, and normalize path', async () => {
    const currentUser = {
      id: dispatcherUser.id,
      username: dispatcherUser.username,
      role: 'dispatcher',
    };

    const liveRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${BUSINESS_DAY}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(liveRes.status).toBe(200);
    expect(liveRes.body.ok).toBe(true);
    expect(liveRes.body.source).toBe('live');
    assertCanonicalTotals(liveRes.body);
    assertBreakdownTotals(liveRes.body);

    const normalizedLive = normalizeSummary(liveRes.body, { currentUser });
    assertCanonicalTotals(normalizedLive);
    expect(Number(normalizedLive.shift_close_breakdown?.totals?.owner_cash_today || 0)).toBe(EXPECTED_TOTALS.owner_cash_today);

    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: BUSINESS_DAY });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(closeRes.body.source).toBe('snapshot');
    assertCanonicalTotals(closeRes.body);
    assertBreakdownTotals(closeRes.body);

    const closureRow = db.prepare(`
      SELECT calculation_json
      FROM shift_closures
      WHERE business_day = ?
    `).get(BUSINESS_DAY);

    expect(closureRow?.calculation_json).toBeTruthy();
    const calculationJson = JSON.parse(closureRow.calculation_json);
    expect(Number(calculationJson?.totals?.owner_cash_today || 0)).toBe(EXPECTED_TOTALS.owner_cash_today);
    expect(Number(calculationJson?.totals?.weekly_fund || 0)).toBe(EXPECTED_TOTALS.weekly_fund);
    expect(Number(calculationJson?.totals?.season_fund_total || 0)).toBe(EXPECTED_TOTALS.season_fund_total);
    expect(Number(calculationJson?.totals?.final_salary_total || 0)).toBe(EXPECTED_TOTALS.final_salary_total);

    const snapshotRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${BUSINESS_DAY}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.body.ok).toBe(true);
    expect(snapshotRes.body.source).toBe('snapshot');
    assertCanonicalTotals(snapshotRes.body);
    assertBreakdownTotals(snapshotRes.body);
    expect(snapshotRes.body.shift_close_breakdown?.totals).toEqual(calculationJson.totals);

    const normalizedSnapshot = normalizeSummary(snapshotRes.body, { currentUser });
    assertCanonicalTotals(normalizedSnapshot);
    expect(Number(normalizedSnapshot.shift_close_breakdown?.totals?.owner_cash_today || 0)).toBe(EXPECTED_TOTALS.owner_cash_today);
    expect(Number(normalizedSnapshot.shift_close_breakdown?.totals?.weekly_fund || 0)).toBe(EXPECTED_TOTALS.weekly_fund);
    expect(Number(normalizedSnapshot.shift_close_breakdown?.totals?.season_fund_total || 0)).toBe(EXPECTED_TOTALS.season_fund_total);
    expect(Number(normalizedSnapshot.shift_close_breakdown?.totals?.final_salary_total || 0)).toBe(EXPECTED_TOTALS.final_salary_total);
  });
});
