import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { getTestDb, resetTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';
import {
  getIsoWeekIdForBusinessDay,
  getIsoWeekRangeLocal,
} from '../../server/utils/iso-week.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

const OWNER_ID = 8501;
const DISPATCHER_ID = 8502;
const SELLER_A_ID = 8503;
const SELLER_B_ID = 8504;
const SELLER_C_ID = 8505;

let app;
let db;
let ownerToken;
let dispatcherToken;
let sellerAToken;
let sellerBToken;
let sellerCToken;

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
    DELETE FROM users WHERE id BETWEEN 8501 AND 8505;
  `);

  insertUser(OWNER_ID, 'owner_dirty_validation', 'owner');
  insertUser(DISPATCHER_ID, 'dispatcher_dirty_validation', 'dispatcher', 'center');
  insertUser(SELLER_A_ID, 'seller_dirty_alpha', 'seller', 'center');
  insertUser(SELLER_B_ID, 'seller_dirty_beta', 'seller', 'stationary');
  insertUser(SELLER_C_ID, 'seller_dirty_gamma', 'seller', 'hedgehog');

  db.prepare(`
    INSERT INTO owner_settings (id, settings_json)
    VALUES (1, '{}')
  `).run();
}

function getTodayDates() {
  const paymentDay = String(db.prepare(`SELECT DATE('now','localtime') AS day`).get()?.day || '');
  const tomorrow = String(db.prepare(`SELECT DATE(?,'+1 day') AS day`).get(paymentDay)?.day || '');
  const dayAfter = String(db.prepare(`SELECT DATE(?,'+2 day') AS day`).get(paymentDay)?.day || '');

  return {
    paymentDay,
    tomorrow,
    dayAfter,
    weekId: getIsoWeekIdForBusinessDay(paymentDay),
    seasonId: paymentDay.slice(0, 4),
  };
}

function insertBoat({ name, type, adult, child, teen }) {
  return db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
    VALUES (?, ?, 1, ?, ?, ?)
  `).run(name, type, adult, child, teen).lastInsertRowid;
}

function insertManualSlot({
  boatId,
  tripDate,
  time,
  capacity = 20,
  adult,
  child,
  teen,
}) {
  const slotId = db.prepare(`
    INSERT INTO boat_slots (
      boat_id, time, price, capacity, seats_left,
      price_adult, price_child, price_teen, duration_minutes,
      trip_date, is_active, seller_cutoff_minutes, is_completed, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 60, ?, 1, 30, 0, 'ACTIVE')
  `).run(
    boatId,
    time,
    adult,
    capacity,
    capacity,
    adult,
    child,
    teen,
    tripDate,
  ).lastInsertRowid;

  return { slotId, slotUid: `manual:${slotId}` };
}

function insertGeneratedSlot({
  boatId,
  type,
  tripDate,
  time,
  capacity = 20,
  adult,
  child,
  teen,
}) {
  const templateId = db.prepare(`
    INSERT INTO schedule_templates (
      weekday, time, product_type, boat_id, boat_type, capacity,
      price_adult, price_child, price_teen, duration_minutes, is_active
    )
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 60, 1)
  `).run(time, type, boatId, type, capacity, adult, child, teen).lastInsertRowid;

  const slotId = db.prepare(`
    INSERT INTO generated_slots (
      schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
      duration_minutes, is_active, price_adult, price_child, price_teen,
      seller_cutoff_minutes, dispatcher_cutoff_minutes, is_completed, status
    )
    VALUES (?, ?, ?, ?, ?, ?, 60, 1, ?, ?, ?, 30, 10, 0, 'ACTIVE')
  `).run(templateId, tripDate, boatId, time, capacity, capacity, adult, child, teen).lastInsertRowid;

  return { slotId, slotUid: `generated:${slotId}` };
}

function markSlotCompleted(slotUid) {
  if (String(slotUid).startsWith('generated:')) {
    db.prepare(`
      UPDATE generated_slots
      SET is_completed = 1, status = 'COMPLETED'
      WHERE id = ?
    `).run(Number(String(slotUid).split(':')[1]));
    return;
  }

  db.prepare(`
    UPDATE boat_slots
    SET is_completed = 1, status = 'COMPLETED'
    WHERE id = ?
  `).run(Number(String(slotUid).split(':')[1]));
}

function getSeatsLeft(slotUid) {
  if (String(slotUid).startsWith('generated:')) {
    return Number(
      db.prepare(`SELECT seats_left FROM generated_slots WHERE id = ?`)
        .get(Number(String(slotUid).split(':')[1]))?.seats_left || 0
    );
  }

  return Number(
    db.prepare(`SELECT seats_left FROM boat_slots WHERE id = ?`)
      .get(Number(String(slotUid).split(':')[1]))?.seats_left || 0
  );
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

async function createPresale(token, payload) {
  const response = await request(app)
    .post('/api/selling/presales')
    .set('Authorization', `Bearer ${token}`)
    .send(payload);

  expect(response.status).toBe(201);
  expect(Number(response.body?.presale?.id || 0)).toBeGreaterThan(0);
  return response.body.presale;
}

async function acceptPayment(token, presaleId, payload) {
  const response = await request(app)
    .patch(`/api/selling/presales/${presaleId}/accept-payment`)
    .set('Authorization', `Bearer ${token}`)
    .send(payload);

  expect(response.status).toBe(200);
  return response.body;
}

async function transferPresale(token, presaleId, toSlotUid, toTripDate) {
  const response = await request(app)
    .post(`/api/selling/presales/${presaleId}/transfer`)
    .set('Authorization', `Bearer ${token}`)
    .send({ to_slot_uid: toSlotUid, to_trip_date: toTripDate });

  expect(response.status).toBe(200);
  expect(response.body?.success).toBe(true);
  return response.body;
}

async function transferTicket(token, ticketId, toSlotUid, toTripDate) {
  const response = await request(app)
    .patch(`/api/selling/tickets/${ticketId}/transfer`)
    .set('Authorization', `Bearer ${token}`)
    .send({ to_slot_uid: toSlotUid, to_trip_date: toTripDate });

  expect(response.status).toBe(200);
  expect(response.body?.success).toBe(true);
  return response.body;
}

async function deleteTicket(token, ticketId, payload = {}) {
  const response = await request(app)
    .patch(`/api/selling/tickets/${ticketId}/delete`)
    .set('Authorization', `Bearer ${token}`)
    .send(payload);

  expect(response.status).toBe(200);
  expect(response.body?.success).toBe(true);
  return response.body;
}

async function refundTicket(token, ticketId) {
  const response = await request(app)
    .patch(`/api/selling/tickets/${ticketId}/refund`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

  expect(response.status).toBe(200);
  expect(response.body?.success).toBe(true);
  return response.body;
}

async function getOwnerSummary(from, to) {
  const response = await request(app)
    .get(`/api/owner/money/summary?from=${from}&to=${to}`)
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getCompareDays() {
  const response = await request(app)
    .get('/api/owner/money/compare-days?preset=7d')
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getCompareBoats(from, to) {
  const response = await request(app)
    .get(`/api/owner/money/compare-boats?fromA=${from}&toA=${to}&fromB=${from}&toB=${to}`)
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getCompareSellers(from, to) {
  const response = await request(app)
    .get(`/api/owner/money/compare-sellers?fromA=${from}&toA=${to}&fromB=${from}&toB=${to}`)
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getOwnerBoatsAll() {
  const response = await request(app)
    .get('/api/owner/boats?preset=all')
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getOwnerSellersAll() {
  const response = await request(app)
    .get('/api/owner/sellers?preset=all')
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getOwnerDay(day) {
  const response = await request(app)
    .get(`/api/owner/motivation/day?day=${day}`)
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getOwnerWeekly(week) {
  const response = await request(app)
    .get(`/api/owner/motivation/weekly?week=${week}`)
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(response.status).toBe(200);
  expect(response.body?.ok).toBe(true);
  return response.body.data;
}

async function getOwnerSeason(seasonId) {
  const response = await request(app)
    .get(`/api/owner/motivation/season?season_id=${seasonId}`)
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

function findByUser(rows, userId) {
  return (rows || []).find((row) => Number(row.user_id || row.seller_id) === Number(userId));
}

function findByBoat(rows, boatId) {
  return (rows || []).find((row) => Number(row.boat_id) === Number(boatId));
}

function isBusinessDayWithinRange(day, range) {
  const value = String(day || '');
  return Boolean(value && range?.dateFrom && range?.dateTo && value >= range.dateFrom && value <= range.dateTo);
}

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();

  const passwordHash = bcrypt.hashSync('password123', 10);
  for (const id of [OWNER_ID, DISPATCHER_ID, SELLER_A_ID, SELLER_B_ID, SELLER_C_ID]) {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(id, `bootstrap_${id}`, passwordHash, 'owner');
  }

  ownerToken = jwt.sign({ id: OWNER_ID, role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  dispatcherToken = jwt.sign({ id: DISPATCHER_ID, role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  sellerAToken = jwt.sign({ id: SELLER_A_ID, role: 'seller' }, JWT_SECRET, { expiresIn: '24h' });
  sellerBToken = jwt.sign({ id: SELLER_B_ID, role: 'seller' }, JWT_SECRET, { expiresIn: '24h' });
  sellerCToken = jwt.sign({ id: SELLER_C_ID, role: 'seller' }, JWT_SECRET, { expiresIn: '24h' });
});

beforeEach(() => {
  resetBaseData();
});

describe('OWNER DIRTY SALES CROSS-CHECK', () => {
  it('keeps payment-day money and trip-day owner analytics intentionally different after future transfers and dirty edits, without breaking seller calibration', async () => {
    const { paymentDay, tomorrow, dayAfter, weekId, seasonId } = getTodayDates();

    await putSettings({
      motivationType: 'adaptive',
      motivation_percent: 0.2,
      weekly_percent: 0.03,
      season_percent: 0.04,
      weekly_withhold_percent_total: 0.01,
      season_withhold_percent_total: 0.005,
      dispatcher_withhold_percent_total: 0.002,
      individual_share: 0.5,
      team_share: 0.5,
      teamIncludeSellers: true,
      teamIncludeDispatchers: true,
      season_payout_scheme: 'all',
      seasonStart: `${seasonId}-01-01`,
      seasonEnd: `${seasonId}-12-31`,
      k_speed: 1,
      k_cruise: 2,
      k_zone_center: 1,
      k_zone_stationary: 0.7,
      k_zone_hedgehog: 1.3,
      k_zone_sanatorium: 0.8,
      k_banana_center: 2.5,
      k_banana_stationary: 1.1,
      k_banana_hedgehog: 3.5,
      k_banana_sanatorium: 1.2,
    });

    const speedBoatId = insertBoat({
      name: 'Dirty Speed',
      type: 'speed',
      adult: 1000,
      child: 500,
      teen: 750,
    });
    const cruiseBoatId = insertBoat({
      name: 'Dirty Cruise',
      type: 'cruise',
      adult: 800,
      child: 400,
      teen: 600,
    });
    const bananaBoatId = insertBoat({
      name: 'Dirty Banana',
      type: 'banana',
      adult: 500,
      child: 250,
      teen: 0,
    });

    const speedToday = insertManualSlot({
      boatId: speedBoatId,
      tripDate: paymentDay,
      time: '22:30',
      adult: 1000,
      child: 500,
      teen: 750,
    });
    const cruiseToday = insertManualSlot({
      boatId: cruiseBoatId,
      tripDate: paymentDay,
      time: '22:45',
      adult: 800,
      child: 400,
      teen: 600,
    });
    const bananaTomorrow = insertManualSlot({
      boatId: bananaBoatId,
      tripDate: tomorrow,
      time: '10:00',
      adult: 500,
      child: 250,
      teen: 0,
    });
    const bananaDayAfter = insertManualSlot({
      boatId: bananaBoatId,
      tripDate: dayAfter,
      time: '11:00',
      adult: 500,
      child: 250,
      teen: 0,
    });
    const cruiseTomorrow = insertGeneratedSlot({
      boatId: cruiseBoatId,
      type: 'cruise',
      tripDate: tomorrow,
      time: '12:00',
      adult: 800,
      child: 400,
      teen: 600,
    });
    const cruiseDayAfter = insertGeneratedSlot({
      boatId: cruiseBoatId,
      type: 'cruise',
      tripDate: dayAfter,
      time: '13:00',
      adult: 800,
      child: 400,
      teen: 600,
    });

    const sameDaySpeed = await createPresale(sellerAToken, {
      slotUid: speedToday.slotUid,
      customerName: 'Same Day Speed Group',
      customerPhone: '+79990000001',
      numberOfSeats: 5,
      prepaymentAmount: 0,
    });
    await acceptPayment(dispatcherToken, Number(sameDaySpeed.id), { payment_method: 'CASH' });

    const sameDayCruise = await createPresale(sellerBToken, {
      slotUid: cruiseToday.slotUid,
      customerName: 'Same Day Cruise Mixed',
      customerPhone: '+79990000002',
      numberOfSeats: 2,
      prepaymentAmount: 0,
    });
    await acceptPayment(dispatcherToken, Number(sameDayCruise.id), {
      payment_method: 'MIXED',
      cash_amount: 600,
      card_amount: 1000,
    });

    const futureBanana = await createPresale(sellerAToken, {
      slotUid: bananaTomorrow.slotUid,
      tripDate: tomorrow,
      customerName: 'Banana Dirty Group',
      customerPhone: '+79990000003',
      numberOfSeats: 5,
      prepaymentAmount: 1000,
      payment_method: 'CASH',
    });
    const futureBananaTickets = db.prepare(`
      SELECT id
      FROM tickets
      WHERE presale_id = ?
      ORDER BY id
    `).all(Number(futureBanana.id));

    await transferTicket(
      dispatcherToken,
      Number(futureBananaTickets[0]?.id || 0),
      bananaDayAfter.slotUid,
      dayAfter,
    );
    await deleteTicket(dispatcherToken, Number(futureBananaTickets[1]?.id || 0));

    const transferredSinglePresale = db.prepare(`
      SELECT id, seller_id, slot_uid, total_price, prepayment_amount
      FROM presales
      WHERE slot_uid = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(bananaDayAfter.slotUid);
    const updatedFutureBanana = db.prepare(`
      SELECT seller_id, number_of_seats, total_price, prepayment_amount
      FROM presales
      WHERE id = ?
    `).get(Number(futureBanana.id));

    expect(Number(transferredSinglePresale?.seller_id || 0)).toBe(SELLER_A_ID);
    expect(String(transferredSinglePresale?.slot_uid || '')).toBe(bananaDayAfter.slotUid);
    expect(Number(transferredSinglePresale?.total_price || 0)).toBe(500);
    expect(Number(transferredSinglePresale?.prepayment_amount || 0)).toBe(0);
    expect(Number(updatedFutureBanana?.seller_id || 0)).toBe(SELLER_A_ID);
    expect(Number(updatedFutureBanana?.number_of_seats || 0)).toBe(3);
    expect(Number(updatedFutureBanana?.total_price || 0)).toBe(1500);
    expect(Number(updatedFutureBanana?.prepayment_amount || 0)).toBe(1000);
    expect(getSeatsLeft(bananaTomorrow.slotUid)).toBe(17);
    expect(getSeatsLeft(bananaDayAfter.slotUid)).toBe(19);

    const transferredCruise = await createPresale(sellerCToken, {
      slotUid: cruiseTomorrow.slotUid,
      tripDate: tomorrow,
      customerName: 'Cruise Transfer Full Paid',
      customerPhone: '+79990000004',
      numberOfSeats: 1,
      prepaymentAmount: 0,
    });
    await acceptPayment(dispatcherToken, Number(transferredCruise.id), { payment_method: 'CARD' });
    await transferPresale(dispatcherToken, Number(transferredCruise.id), cruiseDayAfter.slotUid, dayAfter);

    markSlotCompleted(speedToday.slotUid);
    markSlotCompleted(cruiseToday.slotUid);

    const liveDay = await getOwnerDay(paymentDay);
    const compareDays = await getCompareDays();
    const compareBoats = await getCompareBoats(paymentDay, paymentDay);
    const compareSellers = await getCompareSellers(paymentDay, paymentDay);
    const ownerBoatsAll = await getOwnerBoatsAll();
    const ownerSellersAll = await getOwnerSellersAll();
    const ownerSummary = await getOwnerSummary(paymentDay, paymentDay);
    const liveShift = await getShiftSummary(paymentDay);

    expect(Number(liveDay.revenue_total || 0)).toBe(8400);
    expect(Number(liveDay.salary_base || 0)).toBe(6600);
    expect(Number(liveDay.fundTotal || 0)).toBe(1320);
    expect(Number(liveDay.withhold.weekly_amount || 0)).toBe(50);
    expect(Number(liveDay.withhold.season_amount || 0)).toBe(120);
    expect(Number(liveDay.salary_fund_total || 0)).toBe(1150);
    expect(Number(findByUser(liveDay.points_by_user, SELLER_A_ID)?.points_total || 0)).toBeCloseTo(5, 6);
    expect(Number(findByUser(liveDay.points_by_user, SELLER_B_ID)?.points_total || 0)).toBeCloseTo(2.24, 6);

    const weekly = await getOwnerWeekly(weekId);
    const season = await getOwnerSeason(seasonId);
    const weekRange = getIsoWeekRangeLocal(weekId);
    const expectedSellerAWeeklyPoints =
      5
      + (isBusinessDayWithinRange(tomorrow, weekRange) ? 3.75 : 0)
      + (isBusinessDayWithinRange(dayAfter, weekRange) ? 1.25 : 0);
    expect(Number(findByUser(weekly.sellers, SELLER_A_ID)?.points_week_total || 0)).toBeCloseTo(expectedSellerAWeeklyPoints, 6);
    expect(Number(findByUser(season.sellers, SELLER_A_ID)?.points_total || 0)).toBeCloseTo(8.75, 6);

    const compareDayRow = (compareDays.rows || []).find((row) => String(row.day) === paymentDay);
    expect(Number(compareDayRow?.revenue || 0)).toBe(8400);
    expect(Number(compareDayRow?.cash || 0)).toBe(6600);
    expect(Number(compareDayRow?.card || 0)).toBe(1800);
    expect(Number(compareDayRow?.refund_total || 0)).toBe(0);
    expect(Number(compareDayRow?.net_total || 0)).toBe(8400);

    expect(Number(findByBoat(compareBoats.rows, speedBoatId)?.a?.revenue_gross || 0)).toBe(5000);
    expect(Number(findByBoat(compareBoats.rows, cruiseBoatId)?.a?.revenue_gross || 0)).toBe(2400);
    expect(Number(findByBoat(compareBoats.rows, bananaBoatId)?.a?.revenue_gross || 0)).toBe(1000);

    expect(Number(findByUser(compareSellers.rows, SELLER_A_ID)?.a?.revenue_gross || 0)).toBe(6000);
    expect(Number(findByUser(compareSellers.rows, SELLER_B_ID)?.a?.revenue_gross || 0)).toBe(1600);
    expect(Number(findByUser(compareSellers.rows, SELLER_C_ID)?.a?.revenue_gross || 0)).toBe(800);

    const sellerAAll = findByUser(ownerSellersAll.items, SELLER_A_ID);
    const sellerBAll = findByUser(ownerSellersAll.items, SELLER_B_ID);
    const sellerCAll = findByUser(ownerSellersAll.items, SELLER_C_ID);
    expect(Number(sellerAAll?.revenue_forecast || 0)).toBe(7000);
    expect(Number(sellerBAll?.revenue_forecast || 0)).toBe(1600);
    expect(Number(sellerCAll?.revenue_forecast || 0)).toBe(800);

    expect(Number(findByBoat(ownerBoatsAll.boats, speedBoatId)?.revenue || 0)).toBe(5000);
    expect(Number(findByBoat(ownerBoatsAll.boats, cruiseBoatId)?.revenue || 0)).toBe(2400);
    expect(Number(findByBoat(ownerBoatsAll.boats, bananaBoatId)?.revenue || 0)).toBe(2000);
    expect(Number(ownerBoatsAll.totals?.revenue || 0)).toBe(9400);

    const ownerTotals = ownerSummary.totals || {};
    expect(Number(ownerTotals.collected_total || 0)).toBe(8400);
    expect(Number(ownerTotals.collected_cash || 0)).toBe(6600);
    expect(Number(ownerTotals.collected_card || 0)).toBe(1800);
    expect(Number(ownerTotals.future_trips_reserve_cash || 0)).toBe(1000);
    expect(Number(ownerTotals.future_trips_reserve_card || 0)).toBe(800);
    expect(Number(ownerTotals.future_trips_reserve_total || 0)).toBe(1800);
    expect(Number(ownerTotals.funds_withhold_weekly_today || 0)).toBe(50);
    expect(Number(ownerTotals.funds_withhold_season_today || 0)).toBe(120);

    expect(Number(liveShift.weekly_fund || 0)).toBe(50);
    expect(Number(liveShift.motivation_withhold?.season_amount || 0)).toBe(70);
    expect(Number(liveShift.season_fund_total || 0)).toBe(70);

    const closeSnapshot = await closeShift(paymentDay);
    expect(closeSnapshot.source).toBe('snapshot');
    const snapshotShift = await getShiftSummary(paymentDay);
    expect(snapshotShift.source).toBe('snapshot');
    expect(Number(snapshotShift.weekly_fund || 0)).toBe(50);
    expect(Number(snapshotShift.motivation_withhold?.season_amount || 0)).toBe(70);
    expect(Number(snapshotShift.season_fund_total || 0)).toBe(70);

    const sellerAHiddenState = db.prepare(`
      SELECT *
      FROM seller_calibration_state
      WHERE seller_id = ?
    `).get(SELLER_A_ID);
    expect(sellerAHiddenState).toMatchObject({
      seller_id: SELLER_A_ID,
      calibration_status: 'uncalibrated',
      worked_days_in_week: 1,
      completed_revenue_sum_week: 5000,
      last_completed_workday: paymentDay,
      streak_days: 0,
      streak_multiplier: 1,
    });
  });

  it('posts partial ticket delete/refund reversals into money_ledger and recomputes owner cash, reserve, compare-days, and shift-close totals', async () => {
    const { paymentDay, tomorrow } = getTodayDates();

    const cruiseBoatId = insertBoat({
      name: 'Refund Cruise',
      type: 'cruise',
      adult: 800,
      child: 400,
      teen: 600,
    });
    const bananaBoatId = insertBoat({
      name: 'Refund Banana',
      type: 'banana',
      adult: 500,
      child: 250,
      teen: 0,
    });

    const cruiseFuture = insertGeneratedSlot({
      boatId: cruiseBoatId,
      type: 'cruise',
      tripDate: tomorrow,
      time: '15:00',
      adult: 800,
      child: 400,
      teen: 600,
    });
    const bananaFuture = insertGeneratedSlot({
      boatId: bananaBoatId,
      type: 'banana',
      tripDate: tomorrow,
      time: '16:00',
      adult: 500,
      child: 250,
      teen: 0,
    });

    const cashDeletePresale = await createPresale(sellerAToken, {
      slotUid: cruiseFuture.slotUid,
      tripDate: tomorrow,
      customerName: 'Cash Partial Delete',
      customerPhone: '+79990000010',
      numberOfSeats: 3,
      prepaymentAmount: 0,
    });
    await acceptPayment(dispatcherToken, Number(cashDeletePresale.id), { payment_method: 'CASH' });
    const cashDeleteTickets = db.prepare(`
      SELECT id
      FROM tickets
      WHERE presale_id = ?
      ORDER BY id
    `).all(Number(cashDeletePresale.id));
    await deleteTicket(dispatcherToken, Number(cashDeleteTickets[0]?.id || 0));

    const refundedBananaPresale = await createPresale(sellerBToken, {
      slotUid: bananaFuture.slotUid,
      tripDate: tomorrow,
      customerName: 'Card Partial Refund',
      customerPhone: '+79990000011',
      numberOfSeats: 4,
      prepaymentAmount: 0,
    });
    await acceptPayment(dispatcherToken, Number(refundedBananaPresale.id), { payment_method: 'CARD' });
    const refundedBananaTickets = db.prepare(`
      SELECT id
      FROM tickets
      WHERE presale_id = ?
      ORDER BY id
    `).all(Number(refundedBananaPresale.id));
    await refundTicket(dispatcherToken, Number(refundedBananaTickets[0]?.id || 0));

    const cashDeleteRow = db.prepare(`
      SELECT number_of_seats, total_price, prepayment_amount, payment_cash_amount, payment_card_amount
      FROM presales
      WHERE id = ?
    `).get(Number(cashDeletePresale.id));
    const refundRow = db.prepare(`
      SELECT number_of_seats, total_price, prepayment_amount, payment_cash_amount, payment_card_amount
      FROM presales
      WHERE id = ?
    `).get(Number(refundedBananaPresale.id));

    expect(cashDeleteRow).toMatchObject({
      number_of_seats: 2,
      total_price: 1600,
      prepayment_amount: 1600,
      payment_cash_amount: 1600,
      payment_card_amount: 0,
    });
    expect(refundRow).toMatchObject({
      number_of_seats: 3,
      total_price: 1500,
      prepayment_amount: 1500,
      payment_cash_amount: 0,
      payment_card_amount: 1500,
    });

    const cashReverse = db.prepare(`
      SELECT amount, method, type
      FROM money_ledger
      WHERE presale_id = ?
        AND type = 'SALE_CANCEL_REVERSE'
      ORDER BY id DESC
      LIMIT 1
    `).get(Number(cashDeletePresale.id));
    const cardReverse = db.prepare(`
      SELECT amount, method, type
      FROM money_ledger
      WHERE presale_id = ?
        AND type = 'SALE_CANCEL_REVERSE'
      ORDER BY id DESC
      LIMIT 1
    `).get(Number(refundedBananaPresale.id));

    expect(cashReverse).toMatchObject({
      amount: -800,
      method: 'CASH',
      type: 'SALE_CANCEL_REVERSE',
    });
    expect(cardReverse).toMatchObject({
      amount: -500,
      method: 'CARD',
      type: 'SALE_CANCEL_REVERSE',
    });

    const liveDay = await getOwnerDay(paymentDay);
    expect(Number(liveDay.salary_base || 0)).toBe(0);

    const ownerSummary = await getOwnerSummary(paymentDay, paymentDay);
    const ownerTotals = ownerSummary.totals || {};
    expect(Number(ownerTotals.collected_total || 0)).toBe(4400);
    expect(Number(ownerTotals.collected_cash || 0)).toBe(2400);
    expect(Number(ownerTotals.collected_card || 0)).toBe(2000);
    expect(Number(ownerTotals.refund_total || 0)).toBe(1300);
    expect(Number(ownerTotals.refund_cash || 0)).toBe(800);
    expect(Number(ownerTotals.refund_card || 0)).toBe(500);
    expect(Number(ownerTotals.net_total || 0)).toBe(3100);
    expect(Number(ownerTotals.net_cash || 0)).toBe(1600);
    expect(Number(ownerTotals.net_card || 0)).toBe(1500);
    expect(Number(ownerTotals.future_trips_reserve_cash || 0)).toBe(1600);
    expect(Number(ownerTotals.future_trips_reserve_card || 0)).toBe(1500);
    expect(Number(ownerTotals.future_trips_reserve_total || 0)).toBe(3100);

    const compareDays = await getCompareDays();
    const todayRow = (compareDays.rows || []).find((row) => String(row.day) === paymentDay);
    expect(Number(todayRow?.revenue || 0)).toBe(4400);
    expect(Number(todayRow?.refund_total || 0)).toBe(1300);
    expect(Number(todayRow?.refund_cash || 0)).toBe(800);
    expect(Number(todayRow?.refund_card || 0)).toBe(500);
    expect(Number(todayRow?.net_total || 0)).toBe(3100);
    expect(Number(todayRow?.net_cash || 0)).toBe(1600);
    expect(Number(todayRow?.net_card || 0)).toBe(1500);

    const liveShift = await getShiftSummary(paymentDay);
    expect(Number(liveShift.collected_total || 0)).toBe(4400);
    expect(Number(liveShift.refund_total || 0)).toBe(1300);
    expect(Number(liveShift.refund_cash || 0)).toBe(800);
    expect(Number(liveShift.refund_card || 0)).toBe(500);
    expect(Number(liveShift.net_total || 0)).toBe(3100);
    expect(Number(liveShift.net_cash || 0)).toBe(1600);
    expect(Number(liveShift.net_card || 0)).toBe(1500);

    const closeSnapshot = await closeShift(paymentDay);
    expect(closeSnapshot.source).toBe('snapshot');

    const snapshotShift = await getShiftSummary(paymentDay);
    expect(snapshotShift.source).toBe('snapshot');
    expect(Number(snapshotShift.refund_total || 0)).toBe(1300);
    expect(Number(snapshotShift.refund_cash || 0)).toBe(800);
    expect(Number(snapshotShift.refund_card || 0)).toBe(500);
    expect(Number(snapshotShift.net_total || 0)).toBe(3100);
  });
});
