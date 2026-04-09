import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { getTestDb, resetTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';
import { getIsoWeekIdForBusinessDay } from '../../server/utils/iso-week.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

const OWNER_ID = 8401;
const DISPATCHER_ID = 8402;
const SELLER_A_ID = 8403;
const SELLER_B_ID = 8404;
const SELLER_C_ID = 8405;
const SELLER_D_ID = 8406;
const SELLER_E_ID = 8407;

const DAY_BASELINE = '2046-06-02';
const DAY_CHANGED = '2046-06-09';
const DAY_WEIGHT_EQUAL = '2046-06-16';
const DAY_WEIGHT_BOOSTED = '2046-06-17';
const DAY_POINTS_1 = '2046-07-06';
const DAY_POINTS_2 = '2046-07-07';
const SEASON_ID = '2047';

let app;
let db;
let ownerToken;
let dispatcherToken;
let nextSlotMinuteOffset = 0;

function nextTime() {
  const minutes = (8 * 60) + nextSlotMinuteOffset;
  nextSlotMinuteOffset += 17;
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function insertUser(id, username, role, zone = null) {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, is_active, zone)
    VALUES (?, ?, 'hash', ?, 1, ?)
  `).run(id, username, role, zone);
}

function resetBaseData() {
  db.exec(`
    DELETE FROM shift_closures;
    DELETE FROM motivation_day_settings;
    DELETE FROM seller_calibration_state;
    DELETE FROM seller_motivation_state;
    DELETE FROM seller_day_stats;
    DELETE FROM seller_season_stats;
    DELETE FROM seller_season_applied_days;
    DELETE FROM sales_transactions_canonical;
    DELETE FROM tickets;
    DELETE FROM presales;
    DELETE FROM money_ledger;
    DELETE FROM generated_slots;
    DELETE FROM schedule_templates;
    DELETE FROM boat_slots;
    DELETE FROM boats;
    DELETE FROM owner_settings;
    DELETE FROM users WHERE id BETWEEN 8401 AND 8407;
  `);

  nextSlotMinuteOffset = 0;

  insertUser(OWNER_ID, 'owner_settings_stress', 'owner');
  insertUser(DISPATCHER_ID, 'dispatcher_settings_stress', 'dispatcher', 'center');
  insertUser(SELLER_A_ID, 'seller_alpha', 'seller', 'center');
  insertUser(SELLER_B_ID, 'seller_beta', 'seller', 'stationary');
  insertUser(SELLER_C_ID, 'seller_gamma', 'seller', 'hedgehog');
  insertUser(SELLER_D_ID, 'seller_delta', 'seller', 'sanatorium');
  insertUser(SELLER_E_ID, 'seller_epsilon', 'seller', 'center');

  db.prepare(`
    INSERT INTO owner_settings (id, settings_json)
    VALUES (1, '{}')
  `).run();
}

function insertLedgerRevenue({ day, sellerId, amount, kind = 'SELLER_SHIFT', type = 'SALE_ACCEPTED_CASH', method = 'CASH' }) {
  db.prepare(`
    INSERT INTO money_ledger (
      business_day, trip_day, kind, type, method, amount, status, seller_id, event_time
    )
    VALUES (?, ?, ?, ?, ?, ?, 'POSTED', ?, datetime('now'))
  `).run(day, day, kind, type, method, amount, sellerId);
}

function insertBoat(type, name, prices = { adult: 1000, child: 500, teen: 750 }) {
  return db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
    VALUES (?, ?, 1, ?, ?, ?)
  `).run(name, type, prices.adult, prices.child, prices.teen).lastInsertRowid;
}

function insertManualSale({
  day,
  sellerId,
  amount,
  boatType,
  zoneAtSale = null,
  customerName = 'Validation Buyer',
}) {
  const boatId = insertBoat(boatType, `Settings ${boatType} ${day} ${sellerId} ${nextTime()}`);
  const slotTime = nextTime();
  const priceAdult = boatType === 'banana' ? 500 : 1000;
  const slotId = db.prepare(`
    INSERT INTO boat_slots (
      boat_id, time, price, capacity, seats_left,
      price_adult, price_child, price_teen, duration_minutes,
      trip_date, is_active, seller_cutoff_minutes, is_completed, status
    )
    VALUES (?, ?, ?, 30, 30, ?, ?, ?, 60, ?, 1, 30, 1, 'COMPLETED')
  `).run(
    boatId,
    slotTime,
    priceAdult,
    priceAdult,
    Math.floor(priceAdult / 2),
    Math.floor(priceAdult * 0.75),
    day,
  ).lastInsertRowid;

  const presaleId = db.prepare(`
    INSERT INTO presales (
      boat_slot_id, slot_uid, seller_id,
      customer_name, customer_phone, number_of_seats,
      total_price, prepayment_amount, status, business_day, zone_at_sale,
      payment_method, payment_cash_amount, payment_card_amount
    )
    VALUES (?, ?, ?, ?, '79990000000', 1, ?, ?, 'ACTIVE', ?, ?, 'CASH', ?, 0)
  `).run(
    slotId,
    `manual:${slotId}`,
    sellerId,
    customerName,
    amount,
    amount,
    day,
    zoneAtSale,
    amount,
  ).lastInsertRowid;

  db.prepare(`
    INSERT INTO tickets (presale_id, boat_slot_id, ticket_code, status, price)
    VALUES (?, ?, ?, 'ACTIVE', ?)
  `).run(presaleId, slotId, `SET-${presaleId}`, amount);

  db.prepare(`
    INSERT INTO money_ledger (
      presale_id, slot_id, trip_day, business_day,
      kind, type, method, amount, status, seller_id, event_time
    )
    VALUES (?, ?, ?, ?, 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 'CASH', ?, 'POSTED', ?, datetime('now'))
  `).run(presaleId, slotId, day, day, amount, sellerId);

  return { boatId, slotId, presaleId };
}

async function putSettings(payload) {
  const response = await request(app)
    .put('/api/owner/settings/full')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send(payload);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getDay(day) {
  const response = await request(app)
    .get(`/api/owner/motivation/day?day=${day}`)
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getWeekly(week) {
  const response = await request(app)
    .get(`/api/owner/motivation/weekly?week=${week}`)
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getSeason(seasonId) {
  const response = await request(app)
    .get(`/api/owner/motivation/season?season_id=${seasonId}`)
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getOwnerSummary(from, to) {
  const response = await request(app)
    .get(`/api/owner/money/summary?from=${from}&to=${to}`)
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getShiftSummary(day) {
  const response = await request(app)
    .get(`/api/dispatcher/shift-ledger/summary?business_day=${day}`)
    .set('Authorization', `Bearer ${dispatcherToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body;
}

async function closeShift(day) {
  const response = await request(app)
    .post('/api/dispatcher/shift/close')
    .set('Authorization', `Bearer ${dispatcherToken}`)
    .send({ business_day: day });

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body;
}

function byUser(rows, userId) {
  return (rows || []).find((row) => Number(row.user_id || row.seller_id) === Number(userId));
}

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();

  const passwordHash = bcrypt.hashSync('password123', 10);
  ownerToken = jwt.sign(
    { id: OWNER_ID, username: 'owner_settings_stress', role: 'owner' },
    JWT_SECRET,
    { expiresIn: '24h' },
  );
  dispatcherToken = jwt.sign(
    { id: DISPATCHER_ID, username: 'dispatcher_settings_stress', role: 'dispatcher' },
    JWT_SECRET,
    { expiresIn: '24h' },
  );

  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active)
    VALUES (?, 'bootstrap_owner_settings_stress', ?, 'owner', 1)
  `).run(OWNER_ID, passwordHash);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active)
    VALUES (?, 'bootstrap_dispatcher_settings_stress', ?, 'dispatcher', 1)
  `).run(DISPATCHER_ID, passwordHash);
});

beforeEach(() => {
  resetBaseData();
});

describe('OWNER SETTINGS STRESS VALIDATION', () => {
  it('locks baseline settings into day snapshot, then recalculates day/week/owner money/shift close from new settings on later sales', async () => {
    await putSettings({
      motivationType: 'adaptive',
      motivation_percent: 0.18,
      weekly_percent: 0.01,
      season_percent: 0.02,
      weekly_withhold_percent_total: 0.01,
      season_withhold_percent_total: 0.006,
      dispatcher_withhold_percent_total: 0.002,
      individual_share: 0.5,
      team_share: 0.5,
      teamIncludeSellers: true,
      teamIncludeDispatchers: true,
      season_payout_scheme: 'all',
      seasonStart: '2046-01-01',
      seasonEnd: '2046-12-31',
    });

    insertLedgerRevenue({ day: DAY_BASELINE, sellerId: SELLER_A_ID, amount: 100000 });

    const baselineDay = await getDay(DAY_BASELINE);
    expect(Number(baselineDay.revenue_total || 0)).toBe(100000);
    expect(Number(baselineDay.salary_base || 0)).toBe(100000);
    expect(Number(baselineDay.fundTotal || 0)).toBe(18000);
    expect(Number(baselineDay.withhold.weekly_percent || 0)).toBe(0.01);
    expect(Number(baselineDay.withhold.season_percent || 0)).toBe(0.006);
    expect(Number(baselineDay.withhold.weekly_amount || 0)).toBe(1000);
    expect(Number(baselineDay.withhold.season_amount_base || 0)).toBe(600);
    expect(Number(baselineDay.withhold.season_amount || 0)).toBe(600);
    expect(Number(baselineDay.withhold.dispatcher_amount_total || 0)).toBe(0);
    expect(Number(baselineDay.salary_fund_total || 0)).toBe(16400);

    await closeShift(DAY_BASELINE);

    const baselineShift = await getShiftSummary(DAY_BASELINE);
    const baselineOwnerSummary = await getOwnerSummary(DAY_BASELINE, DAY_BASELINE);
    const baselineOwnerTotals = baselineOwnerSummary.totals || {};

    expect(Number(baselineShift.weekly_fund || 0)).toBe(1000);
    expect(Number(baselineShift.motivation_withhold?.season_amount || 0)).toBe(600);
    expect(Number(baselineShift.salary_base || 0)).toBe(100000);
    expect(Number(baselineOwnerTotals.funds_withhold_weekly_today || 0)).toBe(1000);
    expect(Number(baselineOwnerTotals.funds_withhold_season_today || 0)).toBe(600);

    await putSettings({
      motivationType: 'adaptive',
      motivation_percent: 0.24,
      weekly_percent: 0.03,
      season_percent: 0.04,
      weekly_withhold_percent_total: 0.015,
      season_withhold_percent_total: 0.01,
      dispatcher_withhold_percent_total: 0.002,
      individual_share: 0.5,
      team_share: 0.5,
      teamIncludeSellers: true,
      teamIncludeDispatchers: true,
      season_payout_scheme: 'all',
      seasonStart: '2046-01-01',
      seasonEnd: '2046-12-31',
    });

    const lockedBaselineDay = await getDay(DAY_BASELINE);
    expect(lockedBaselineDay.lock?.is_locked).toBe(true);
    expect(lockedBaselineDay.lock?.settings_source).toBe('snapshot');
    expect(Number(lockedBaselineDay.fundTotal || 0)).toBe(18000);
    expect(Number(lockedBaselineDay.withhold.weekly_amount || 0)).toBe(1000);
    expect(Number(lockedBaselineDay.withhold.season_amount || 0)).toBe(600);

    insertLedgerRevenue({ day: DAY_CHANGED, sellerId: SELLER_A_ID, amount: 100000 });

    const changedDay = await getDay(DAY_CHANGED);
    expect(Number(changedDay.revenue_total || 0)).toBe(100000);
    expect(Number(changedDay.salary_base || 0)).toBe(100000);
    expect(Number(changedDay.fundTotal || 0)).toBe(24000);
    expect(Number(changedDay.withhold.weekly_percent || 0)).toBe(0.015);
    expect(Number(changedDay.withhold.season_percent || 0)).toBe(0.01);
    expect(Number(changedDay.withhold.weekly_amount || 0)).toBe(1500);
    expect(Number(changedDay.withhold.season_amount_base || 0)).toBe(1000);
    expect(Number(changedDay.withhold.season_amount || 0)).toBe(1000);
    expect(Number(changedDay.withhold.dispatcher_amount_total || 0)).toBe(0);
    expect(Number(changedDay.salary_fund_total || 0)).toBe(21500);

    await closeShift(DAY_CHANGED);

    const changedShift = await getShiftSummary(DAY_CHANGED);
    const changedOwnerSummary = await getOwnerSummary(DAY_CHANGED, DAY_CHANGED);
    const changedOwnerTotals = changedOwnerSummary.totals || {};
    const changedWeek = await getWeekly(getIsoWeekIdForBusinessDay(DAY_CHANGED));
    const changedSeason = await getSeason('2046');

    expect(Number(changedShift.weekly_fund || 0)).toBe(1500);
    expect(Number(changedShift.motivation_withhold?.season_amount || 0)).toBe(1000);
    expect(Number(changedShift.salary_base || 0)).toBe(100000);
    expect(Number(changedOwnerTotals.funds_withhold_weekly_today || 0)).toBe(1500);
    expect(Number(changedOwnerTotals.funds_withhold_season_today || 0)).toBe(1000);
    expect(Number(changedOwnerTotals.funds_withhold_dispatcher_bonus_today || 0)).toBe(0);
    expect(Number(changedWeek.weekly_pool_total_current || 0)).toBe(3000);
    expect(Number(changedSeason.season_pool_total_current || 0)).toBe(1600);
  });

  it('reweights dispatcher team share and applies boat/zone/banana coefficients plus seller zone fallback across day and week views', async () => {
    await putSettings({
      motivationType: 'adaptive',
      motivation_percent: 0.15,
      weekly_percent: 0.01,
      season_percent: 0.02,
      weekly_withhold_percent_total: 0,
      season_withhold_percent_total: 0,
      dispatcher_withhold_percent_total: 0,
      individual_share: 0,
      team_share: 1,
      k_dispatchers: 1,
      teamIncludeSellers: true,
      teamIncludeDispatchers: true,
    });

    insertLedgerRevenue({ day: DAY_WEIGHT_EQUAL, sellerId: SELLER_A_ID, amount: 100000 });
    insertLedgerRevenue({
      day: DAY_WEIGHT_EQUAL,
      sellerId: DISPATCHER_ID,
      amount: 100000,
      kind: 'DISPATCHER_SHIFT',
    });

    const equalWeightsDay = await getDay(DAY_WEIGHT_EQUAL);
    const equalSellerPayout = byUser(equalWeightsDay.payouts, SELLER_A_ID);
    const equalDispatcherPayout = byUser(equalWeightsDay.payouts, DISPATCHER_ID);

    expect(Number(equalSellerPayout?.total || 0)).toBeCloseTo(Number(equalDispatcherPayout?.total || 0), 6);
    expect(Number(equalSellerPayout?.team_part || 0)).toBeCloseTo(Number(equalDispatcherPayout?.team_part || 0), 6);

    await putSettings({
      motivationType: 'adaptive',
      motivation_percent: 0.15,
      weekly_percent: 0.01,
      season_percent: 0.02,
      weekly_withhold_percent_total: 0,
      season_withhold_percent_total: 0,
      dispatcher_withhold_percent_total: 0,
      individual_share: 0,
      team_share: 1,
      k_dispatchers: 1.5,
      teamIncludeSellers: true,
      teamIncludeDispatchers: true,
    });

    insertLedgerRevenue({ day: DAY_WEIGHT_BOOSTED, sellerId: SELLER_A_ID, amount: 100000 });
    insertLedgerRevenue({
      day: DAY_WEIGHT_BOOSTED,
      sellerId: DISPATCHER_ID,
      amount: 100000,
      kind: 'DISPATCHER_SHIFT',
    });

    const boostedDay = await getDay(DAY_WEIGHT_BOOSTED);
    const boostedSellerPayout = byUser(boostedDay.payouts, SELLER_A_ID);
    const boostedDispatcherPayout = byUser(boostedDay.payouts, DISPATCHER_ID);

    expect(Number(boostedDispatcherPayout?.team_part || 0) / Number(boostedSellerPayout?.team_part || 1)).toBeCloseTo(1.5, 6);
    expect(Number(boostedDispatcherPayout?.total || 0) / Number(boostedSellerPayout?.total || 1)).toBeCloseTo(1.5, 6);

    await closeShift(DAY_WEIGHT_BOOSTED);
    const boostedShift = await getShiftSummary(DAY_WEIGHT_BOOSTED);
    const boostedShiftSeller = byUser(boostedShift.sellers, SELLER_A_ID);
    const boostedShiftDispatcher = byUser(boostedShift.sellers, DISPATCHER_ID);

    expect(Number(boostedShiftDispatcher?.team_part || 0) / Number(boostedShiftSeller?.team_part || 1)).toBeCloseTo(1.5, 6);

    await putSettings({
      motivationType: 'adaptive',
      motivation_percent: 0.15,
      weekly_percent: 0.01,
      season_percent: 0.02,
      weekly_withhold_percent_total: 0,
      season_withhold_percent_total: 0,
      dispatcher_withhold_percent_total: 0,
      individual_share: 0.5,
      team_share: 0.5,
      k_speed: 1,
      k_cruise: 2,
      k_zone_center: 1,
      k_zone_hedgehog: 1.3,
      k_zone_sanatorium: 0.8,
      k_zone_stationary: 0.7,
      k_banana_center: 2,
      k_banana_hedgehog: 3.5,
      k_banana_sanatorium: 1.2,
      k_banana_stationary: 1.1,
      teamIncludeSellers: true,
      teamIncludeDispatchers: true,
    });

    insertManualSale({
      day: DAY_POINTS_1,
      sellerId: SELLER_A_ID,
      amount: 10000,
      boatType: 'speed',
      zoneAtSale: 'center',
      customerName: 'Speed Center',
    });
    insertManualSale({
      day: DAY_POINTS_1,
      sellerId: SELLER_A_ID,
      amount: 10000,
      boatType: 'cruise',
      zoneAtSale: 'center',
      customerName: 'Cruise Center',
    });
    insertManualSale({
      day: DAY_POINTS_1,
      sellerId: SELLER_B_ID,
      amount: 5000,
      boatType: 'banana',
      zoneAtSale: null,
      customerName: 'Banana Seller Zone Stationary',
    });

    const pointsDay1 = await getDay(DAY_POINTS_1);
    const sellerAWeek1 = byUser(pointsDay1.points_by_user, SELLER_A_ID);
    const sellerBWeek1 = byUser(pointsDay1.points_by_user, SELLER_B_ID);

    expect(Number(sellerAWeek1?.points_by_type?.speed || 0)).toBeCloseTo(10, 6);
    expect(Number(sellerAWeek1?.points_by_type?.cruise || 0)).toBeCloseTo(20, 6);
    expect(Number(sellerAWeek1?.points_total || 0)).toBeCloseTo(30, 6);
    expect(Number(sellerBWeek1?.points_by_type?.banana || 0)).toBeCloseTo(5.5, 6);

    const sellerZoneUpdate = await request(app)
      .put(`/api/owner/sellers/${SELLER_B_ID}/zone`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ zone: 'hedgehog' });

    expect(sellerZoneUpdate.status).toBe(200);
    expect(sellerZoneUpdate.body?.ok).toBe(true);
    expect(sellerZoneUpdate.body?.data?.zone).toBe('hedgehog');

    insertManualSale({
      day: DAY_POINTS_2,
      sellerId: SELLER_B_ID,
      amount: 5000,
      boatType: 'banana',
      zoneAtSale: null,
      customerName: 'Banana Seller Zone Hedgehog',
    });
    insertManualSale({
      day: DAY_POINTS_2,
      sellerId: SELLER_B_ID,
      amount: 5000,
      boatType: 'banana',
      zoneAtSale: 'sanatorium',
      customerName: 'Banana Explicit Sanatorium',
    });

    const pointsDay2 = await getDay(DAY_POINTS_2);
    const sellerBWeek2 = byUser(pointsDay2.points_by_user, SELLER_B_ID);
    const weekly = await getWeekly(getIsoWeekIdForBusinessDay(DAY_POINTS_1));
    const weeklySellerA = byUser(weekly.sellers, SELLER_A_ID);
    const weeklySellerB = byUser(weekly.sellers, SELLER_B_ID);

    expect(Number(sellerBWeek2?.points_by_type?.banana || 0)).toBeCloseTo(23.5, 6);
    expect(Number(sellerBWeek2?.points_total || 0)).toBeCloseTo(23.5, 6);
    expect(Number(weeklySellerA?.points_week_total || 0)).toBeCloseTo(30, 6);
    // Weekly/season recalc uses current seller zone as fallback for legacy banana rows
    // with missing zone_at_sale, so day-1 legacy revenue is re-evaluated with hedgehog.
    expect(Number(weeklySellerB?.points_week_total || 0)).toBeCloseTo(41, 6);
  });

  it('changes season boundaries and payout schemes all/top3/top5 without leaking out-of-season totals', async () => {
    const sellerMayPoints = new Map([
      [SELLER_A_ID, 100],
      [SELLER_B_ID, 80],
      [SELLER_C_ID, 60],
      [SELLER_D_ID, 40],
      [SELLER_E_ID, 20],
    ]);

    db.prepare(`
      INSERT INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
      VALUES ('2047-04-30', ?, 20000, 200)
    `).run(SELLER_E_ID);

    for (const [sellerId, points] of sellerMayPoints.entries()) {
      db.prepare(`
        INSERT INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
        VALUES ('2047-05-10', ?, ?, ?)
      `).run(sellerId, points * 1000, points);
    }

    db.prepare(`
      INSERT INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
      VALUES ('2047-06-10', ?, 50000, 50)
    `).run(SELLER_A_ID);
    db.prepare(`
      INSERT INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
      VALUES ('2047-06-10', ?, 400000, 400)
    `).run(SELLER_E_ID);

    db.prepare(`
      INSERT INTO money_ledger (kind, type, method, amount, status, business_day, event_time)
      VALUES ('FUND', 'WITHHOLD_SEASON', 'INTERNAL', 10000, 'POSTED', '2047-05-20', datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO money_ledger (kind, type, method, amount, status, business_day, event_time)
      VALUES ('FUND', 'WITHHOLD_SEASON', 'INTERNAL', 5000, 'POSTED', '2047-06-15', datetime('now'))
    `).run();

    await putSettings({
      motivationType: 'adaptive',
      motivation_percent: 0.15,
      weekly_percent: 0.01,
      season_percent: 0.01,
      season_payout_scheme: 'all',
      seasonStart: '2047-05-01',
      seasonEnd: '2047-05-31',
    });

    const seasonAll = await getSeason(SEASON_ID);
    const seasonAllRows = seasonAll.sellers || [];

    expect(seasonAll.season_from).toBe('2047-05-01');
    expect(seasonAll.season_to).toBe('2047-05-31');
    expect(Number(seasonAll.season_pool_total_ledger || 0)).toBe(10000);
    expect(Number(seasonAll.season_payout_fund_total || 0)).toBe(10000);
    expect(Number(seasonAll.season_payout_recipient_count || 0)).toBe(5);
    expect(Number(seasonAllRows[0]?.user_id || 0)).toBe(SELLER_A_ID);
    expect(Number(seasonAllRows[4]?.user_id || 0)).toBe(SELLER_E_ID);
    expect(Number(seasonAllRows.reduce((sum, row) => sum + Number(row.season_payout || 0), 0))).toBeCloseTo(10000, 6);

    await putSettings({
      motivationType: 'adaptive',
      motivation_percent: 0.15,
      weekly_percent: 0.01,
      season_percent: 0.01,
      season_payout_scheme: 'top3',
      seasonStart: '2047-05-01',
      seasonEnd: '2047-05-31',
    });

    const seasonTop3 = await getSeason(SEASON_ID);
    const seasonTop3Rows = seasonTop3.sellers || [];

    expect(Number(seasonTop3.season_payout_recipient_count || 0)).toBe(3);
    expect(Number(byUser(seasonTop3Rows, SELLER_A_ID)?.season_payout || 0)).toBeCloseTo(5000, 6);
    expect(Number(byUser(seasonTop3Rows, SELLER_B_ID)?.season_payout || 0)).toBeCloseTo(3000, 6);
    expect(Number(byUser(seasonTop3Rows, SELLER_C_ID)?.season_payout || 0)).toBeCloseTo(2000, 6);
    expect(Number(byUser(seasonTop3Rows, SELLER_D_ID)?.season_payout || 0)).toBe(0);
    expect(Number(byUser(seasonTop3Rows, SELLER_E_ID)?.season_payout || 0)).toBe(0);

    await putSettings({
      motivationType: 'adaptive',
      motivation_percent: 0.15,
      weekly_percent: 0.01,
      season_percent: 0.01,
      season_payout_scheme: 'top5',
      seasonStart: '2047-05-01',
      seasonEnd: '2047-05-31',
    });

    const seasonTop5 = await getSeason(SEASON_ID);
    const seasonTop5Rows = seasonTop5.sellers || [];

    expect(Number(seasonTop5.season_payout_recipient_count || 0)).toBe(5);
    expect(Number(byUser(seasonTop5Rows, SELLER_A_ID)?.season_payout || 0)).toBeCloseTo(3500, 6);
    expect(Number(byUser(seasonTop5Rows, SELLER_B_ID)?.season_payout || 0)).toBeCloseTo(2500, 6);
    expect(Number(byUser(seasonTop5Rows, SELLER_C_ID)?.season_payout || 0)).toBeCloseTo(1800, 6);
    expect(Number(byUser(seasonTop5Rows, SELLER_D_ID)?.season_payout || 0)).toBeCloseTo(1200, 6);
    expect(Number(byUser(seasonTop5Rows, SELLER_E_ID)?.season_payout || 0)).toBeCloseTo(1000, 6);

    await putSettings({
      motivationType: 'adaptive',
      motivation_percent: 0.15,
      weekly_percent: 0.01,
      season_percent: 0.01,
      season_payout_scheme: 'top5',
      seasonStart: '2047-05-01',
      seasonEnd: '2047-06-30',
    });

    const expandedSeason = await getSeason(SEASON_ID);
    const expandedRows = expandedSeason.sellers || [];

    expect(expandedSeason.season_to).toBe('2047-06-30');
    expect(Number(expandedSeason.season_pool_total_ledger || 0)).toBe(15000);
    expect(Number(expandedRows[0]?.user_id || 0)).toBe(SELLER_E_ID);
    expect(Number(expandedRows[1]?.user_id || 0)).toBe(SELLER_A_ID);
    expect(Number(byUser(expandedRows, SELLER_E_ID)?.points_total || 0)).toBeCloseTo(420, 6);
    expect(Number(byUser(expandedRows, SELLER_E_ID)?.season_payout || 0)).toBeCloseTo(5250, 6);
    expect(Number(byUser(expandedRows, SELLER_A_ID)?.season_payout || 0)).toBeCloseTo(3750, 6);
    expect(Number(expandedRows.reduce((sum, row) => sum + Number(row.season_payout || 0), 0))).toBeCloseTo(15000, 6);
  });
});
