import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { getTestDb, resetTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';
import { getIsoWeekIdForBusinessDay } from '../../server/utils/iso-week.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app;
let db;
let ownerToken;
let dispatcherToken;
let slotTimeSequence = 0;

const OWNER_ID = 9101;
const DISPATCHER_ID = 9102;
const SELLER_A_ID = 9201;
const SELLER_B_ID = 9202;
const SELLER_C_ID = 9203;
const SELLER_D_ID = 9204;

const SELLER_NAMES = new Map([
  [SELLER_A_ID, 'seller_long_alpha'],
  [SELLER_B_ID, 'seller_long_invalid'],
  [SELLER_C_ID, 'seller_long_gamma'],
  [SELLER_D_ID, 'seller_long_delta'],
]);

const SELLER_REVENUE_TOTALS = new Map([
  [SELLER_A_ID, 915000],
  [SELLER_B_ID, 50000],
  [SELLER_C_ID, 180000],
  [SELLER_D_ID, 100000],
]);

const LONG_RANGE_DAYS = [
  '2026-03-16',
  '2026-03-17',
  '2026-03-18',
  '2026-03-19',
  '2026-03-20',
  '2026-03-21',
  '2026-03-22',
  '2026-03-23',
  '2026-03-24',
  '2026-03-25',
  '2026-03-26',
  '2026-03-27',
  '2026-03-28',
  '2026-03-29',
  '2026-03-30',
  '2026-03-31',
  '2026-04-01',
  '2026-04-02',
  '2026-04-03',
  '2026-04-04',
  '2026-04-05',
  '2026-04-06',
  '2026-04-07',
  '2026-04-08',
];

const VALID_SALES_DAYS = [
  '2026-03-16',
  '2026-03-17',
  '2026-03-18',
  '2026-03-23',
  '2026-03-24',
  '2026-03-25',
  '2026-03-26',
  '2026-03-27',
  '2026-03-30',
  '2026-03-31',
  '2026-04-01',
  '2026-04-06',
  '2026-04-07',
  '2026-04-08',
  '2026-04-09',
];

const W15_DAYS = ['2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09'];

const boatIdsByType = new Map();
const templateIdsByType = new Map();

function insertUser(id, username, role, zone = null) {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, is_active, zone)
    VALUES (?, ?, 'hash', ?, 1, ?)
  `).run(id, username, role, zone);
}

function nextUniqueTime() {
  const totalMinutes = (8 * 60) + (slotTimeSequence * 7);
  slotTimeSequence += 1;
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function ensureBoatAndTemplate(productType = 'speed') {
  if (!boatIdsByType.has(productType)) {
    const boatId = db.prepare(`
      INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
      VALUES (?, ?, 1, 3000, 1500, 2250)
    `).run(`Long Validation ${productType}`, productType).lastInsertRowid;
    boatIdsByType.set(productType, boatId);

    const templateId = db.prepare(`
      INSERT INTO schedule_templates (
        weekday, time, product_type, boat_id, boat_type, capacity,
        price_adult, price_child, price_teen, duration_minutes, is_active
      )
      VALUES (1, '08:00', ?, ?, ?, 40, 3000, 1500, 2250, 60, 1)
    `).run(productType, boatId, productType).lastInsertRowid;
    templateIdsByType.set(productType, templateId);
  }

  return {
    boatId: boatIdsByType.get(productType),
    templateId: templateIdsByType.get(productType),
  };
}

function splitSeatPrices(totalRevenue, seats) {
  const normalizedSeats = Math.max(1, Number(seats || 0));
  const basePrice = Math.floor(Number(totalRevenue || 0) / normalizedSeats);
  let remainder = Number(totalRevenue || 0) - (basePrice * normalizedSeats);

  return Array.from({ length: normalizedSeats }, () => {
    if (remainder > 0) {
      remainder -= 1;
      return basePrice + 1;
    }
    return basePrice;
  });
}

function insertBoatSlot(boatId, {
  tripDate,
  time,
  isCompleted = 1,
  status = 'COMPLETED',
} = {}) {
  return db.prepare(`
    INSERT INTO boat_slots (
      boat_id, time, price, capacity, seats_left,
      price_adult, price_child, price_teen, duration_minutes,
      trip_date, is_active, seller_cutoff_minutes, is_completed, status
    )
    VALUES (?, ?, 3000, 40, 40, 3000, 1500, 2250, 60, ?, 1, 30, ?, ?)
  `).run(boatId, time, tripDate, isCompleted, status).lastInsertRowid;
}

function insertGeneratedSlot(templateId, boatId, {
  tripDate,
  time,
  isCompleted = 1,
  status = 'COMPLETED',
} = {}) {
  return db.prepare(`
    INSERT INTO generated_slots (
      schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
      duration_minutes, is_active, price_adult, price_child, price_teen,
      seller_cutoff_minutes, dispatcher_cutoff_minutes, is_completed, status
    )
    VALUES (?, ?, ?, ?, 40, 40, 60, 1, 3000, 1500, 2250, 30, 10, ?, ?)
  `).run(templateId, tripDate, boatId, time, isCompleted, status).lastInsertRowid;
}

function insertPresale({
  sellerId,
  boatSlotId,
  generatedSlotId,
  businessDay,
  numberOfSeats,
  totalPrice,
  presaleStatus = 'ACTIVE',
  zoneAtSale = null,
  cashAmount = null,
  cardAmount = 0,
}) {
  return db.prepare(`
    INSERT INTO presales (
      boat_slot_id, slot_uid, seller_id,
      customer_name, customer_phone, number_of_seats,
      total_price, prepayment_amount, status, business_day,
      zone_at_sale, payment_cash_amount, payment_card_amount
    )
    VALUES (?, ?, ?, 'Long Validation Buyer', '79990000000', ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(
    boatSlotId,
    `generated:${generatedSlotId}`,
    sellerId,
    numberOfSeats,
    totalPrice,
    presaleStatus,
    businessDay,
    zoneAtSale,
    cashAmount == null ? totalPrice : cashAmount,
    cardAmount,
  ).lastInsertRowid;
}

function insertTicket({ presaleId, boatSlotId, ticketCode, price, ticketStatus = 'ACTIVE' }) {
  return db.prepare(`
    INSERT INTO tickets (
      presale_id, boat_slot_id, ticket_code, status, price
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(presaleId, boatSlotId, ticketCode, ticketStatus, price).lastInsertRowid;
}

function insertCanonicalTicket({
  ticketId,
  presaleId,
  slotId,
  boatId,
  generatedSlotId,
  businessDay,
  amount,
  canonicalStatus = 'VALID',
  fullyPaid = true,
}) {
  db.prepare(`
    INSERT INTO sales_transactions_canonical (
      ticket_id, presale_id, slot_id, boat_id, slot_uid,
      amount, cash_amount, card_amount, method, status, business_day
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'CASH', ?, ?)
  `).run(
    ticketId,
    presaleId,
    slotId,
    boatId,
    `generated:${generatedSlotId}`,
    amount,
    fullyPaid ? amount : Math.floor(amount / 2),
    canonicalStatus,
    businessDay,
  );
}

function insertSaleLedger({
  sellerId,
  presaleId,
  boatSlotId,
  businessDay,
  amount,
}) {
  db.prepare(`
    INSERT INTO money_ledger (
      presale_id, slot_id, trip_day, business_day,
      kind, type, method, amount, status, seller_id, event_time
    )
    VALUES (?, ?, ?, ?, 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 'CASH', ?, 'POSTED', ?, datetime('now'))
  `).run(presaleId, boatSlotId, businessDay, businessDay, amount, sellerId);
}

function createSale({
  sellerId,
  businessDay,
  tripDate = null,
  totalRevenue,
  seats = 5,
  productType = 'speed',
  zoneAtSale = null,
  presaleStatus = 'ACTIVE',
  ticketStatus = 'ACTIVE',
  canonicalStatus = 'VALID',
  tripCompleted = 1,
  tripStatus = 'COMPLETED',
  fullyPaid = true,
  withLedger = true,
}) {
  const { boatId, templateId } = ensureBoatAndTemplate(productType);
  const time = nextUniqueTime();
  const resolvedTripDate = tripDate || businessDay;
  const boatSlotId = insertBoatSlot(boatId, {
    tripDate: resolvedTripDate,
    time,
    isCompleted: tripCompleted,
    status: tripStatus,
  });
  const generatedSlotId = insertGeneratedSlot(templateId, boatId, {
    tripDate: resolvedTripDate,
    time,
    isCompleted: tripCompleted,
    status: tripStatus,
  });
  const seatPrices = splitSeatPrices(totalRevenue, seats);
  const presaleId = insertPresale({
    sellerId,
    boatSlotId,
    generatedSlotId,
    businessDay,
    numberOfSeats: seats,
    totalPrice: seatPrices.reduce((sum, price) => sum + price, 0),
    presaleStatus,
    zoneAtSale,
    cashAmount: fullyPaid ? totalRevenue : Math.floor(totalRevenue / 2),
  });

  seatPrices.forEach((price, index) => {
    const ticketId = insertTicket({
      presaleId,
      boatSlotId,
      ticketCode: `LONG-${sellerId}-${businessDay}-${index + 1}-${time.replace(':', '')}`,
      price,
      ticketStatus,
    });

    insertCanonicalTicket({
      ticketId,
      presaleId,
      slotId: boatSlotId,
      boatId,
      generatedSlotId,
      businessDay,
      amount: price,
      canonicalStatus,
      fullyPaid,
    });
  });

  if (withLedger) {
    insertSaleLedger({
      sellerId,
      presaleId,
      boatSlotId,
      businessDay,
      amount: totalRevenue,
    });
  }
}

async function closeBusinessDay(businessDay) {
  const res = await request(app)
    .post('/api/dispatcher/shift/close')
    .set('Authorization', `Bearer ${dispatcherToken}`)
    .send({ business_day: businessDay });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.business_day).toBe(businessDay);
  return res.body;
}

async function getDayPayload(day) {
  const res = await request(app)
    .get(`/api/owner/motivation/day?day=${day}`)
    .set('Authorization', `Bearer ${ownerToken}`);

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  return res.body.data;
}

function getSidecarState(sellerId) {
  return db.prepare(`
    SELECT *
    FROM seller_calibration_state
    WHERE seller_id = ?
  `).get(sellerId);
}

function findRowByUserId(rows, userId) {
  return (rows || []).find((row) => Number(row.user_id || row.seller_id) === Number(userId));
}

function buildSortedRanking(expectedPointsMap, revenueTotals) {
  return [...expectedPointsMap.entries()]
    .map(([sellerId, pointsTotal]) => ({
      sellerId,
      pointsTotal,
      revenueTotal: Number(revenueTotals.get(sellerId) || 0),
      name: SELLER_NAMES.get(sellerId) || `Seller ${sellerId}`,
    }))
    .sort((left, right) => {
      if (right.pointsTotal !== left.pointsTotal) return right.pointsTotal - left.pointsTotal;
      if (right.revenueTotal !== left.revenueTotal) return right.revenueTotal - left.revenueTotal;
      return left.name.localeCompare(right.name);
    })
    .map((row) => row.sellerId);
}

describe('MOTIVATION long-range validation', () => {
  beforeAll(async () => {
    resetTestDb();
    app = await makeApp();
    db = getTestDb();
  });

  beforeEach(() => {
    db.exec(`
      DELETE FROM shift_closures;
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
      DELETE FROM users WHERE id BETWEEN 9101 AND 9204;
    `);

    slotTimeSequence = 0;
    boatIdsByType.clear();
    templateIdsByType.clear();

    insertUser(OWNER_ID, 'owner_long_validation', 'owner');
    insertUser(DISPATCHER_ID, 'dispatcher_long_validation', 'dispatcher');
    insertUser(SELLER_A_ID, SELLER_NAMES.get(SELLER_A_ID), 'seller', 'center');
    insertUser(SELLER_B_ID, SELLER_NAMES.get(SELLER_B_ID), 'seller', 'center');
    insertUser(SELLER_C_ID, SELLER_NAMES.get(SELLER_C_ID), 'seller', 'hedgehog');
    insertUser(SELLER_D_ID, SELLER_NAMES.get(SELLER_D_ID), 'seller', 'sanatorium');

    ownerToken = jwt.sign(
      { id: OWNER_ID, username: 'owner_long_validation', role: 'owner' },
      JWT_SECRET,
      { expiresIn: '24h' },
    );
    dispatcherToken = jwt.sign(
      { id: DISPATCHER_ID, username: 'dispatcher_long_validation', role: 'dispatcher' },
      JWT_SECRET,
      { expiresIn: '24h' },
    );

    db.prepare(`
      INSERT INTO owner_settings (id, settings_json)
      VALUES (1, ?)
    `).run(JSON.stringify({
      motivationType: 'adaptive',
      motivation_percent: 0.15,
      weekly_withhold_percent_total: 0.008,
      season_withhold_percent_total: 0.005,
      dispatcher_withhold_percent_total: 0.002,
      season_payout_scheme: 'top3',
      seasonStart: '2026-01-01',
      seasonEnd: '2026-12-31',
      season_start_mmdd: '01-01',
      season_end_mmdd: '12-31',
      k_speed: 1.2,
      k_cruise: 3.0,
      k_zone_center: 1.0,
      k_zone_hedgehog: 1.3,
      k_zone_sanatorium: 0.8,
      k_zone_stationary: 0.7,
      k_banana_hedgehog: 2.7,
      k_banana_center: 2.2,
      k_banana_sanatorium: 1.2,
      k_banana_stationary: 1.0,
    }));
  });

  it('keeps multi-week day/weekly/season, sidecar calibration, and cross-screen totals deterministic across a month-like range', async () => {
    createSale({
      sellerId: SELLER_A_ID,
      businessDay: '2026-03-16',
      totalRevenue: 55000,
      zoneAtSale: 'center',
    });
    createSale({
      sellerId: SELLER_A_ID,
      businessDay: '2026-03-17',
      totalRevenue: 55000,
      zoneAtSale: 'center',
    });
    createSale({
      sellerId: SELLER_A_ID,
      businessDay: '2026-03-18',
      totalRevenue: 55000,
      zoneAtSale: 'center',
    });

    ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'].forEach((day) => {
      createSale({
        sellerId: SELLER_A_ID,
        businessDay: day,
        totalRevenue: 65000,
        zoneAtSale: 'center',
      });
    });

    ['2026-03-30', '2026-03-31', '2026-04-01'].forEach((day) => {
      createSale({
        sellerId: SELLER_A_ID,
        businessDay: day,
        totalRevenue: 85000,
        zoneAtSale: 'center',
      });
    });

    createSale({
      sellerId: SELLER_B_ID,
      businessDay: '2026-04-02',
      tripDate: '2026-04-09',
      totalRevenue: 50000,
      zoneAtSale: 'center',
      tripCompleted: 0,
      tripStatus: 'ACTIVE',
      withLedger: false,
    });
    createSale({
      sellerId: SELLER_B_ID,
      businessDay: '2026-04-03',
      totalRevenue: 50000,
      zoneAtSale: 'center',
      presaleStatus: 'CANCELLED',
      withLedger: false,
    });
    createSale({
      sellerId: SELLER_B_ID,
      businessDay: '2026-04-03',
      totalRevenue: 50000,
      zoneAtSale: 'center',
      ticketStatus: 'REFUNDED',
      canonicalStatus: 'VOID',
      withLedger: false,
    });

    ['2026-04-06', '2026-04-07', '2026-04-08'].forEach((day) => {
      createSale({
        sellerId: SELLER_C_ID,
        businessDay: day,
        totalRevenue: 60000,
        zoneAtSale: 'hedgehog',
      });
    });

    ['2026-04-06', '2026-04-07'].forEach((day) => {
      createSale({
        sellerId: SELLER_D_ID,
        businessDay: day,
        totalRevenue: 50000,
        zoneAtSale: 'sanatorium',
      });
    });

    ['2026-04-07', '2026-04-08'].forEach((day) => {
      createSale({
        sellerId: SELLER_A_ID,
        businessDay: day,
        totalRevenue: 85000,
        zoneAtSale: 'center',
      });
    });

    for (const day of LONG_RANGE_DAYS) {
      await closeBusinessDay(day);

      if (day === '2026-03-22') {
        expect(getSidecarState(SELLER_A_ID)).toMatchObject({
          calibration_status: 'uncalibrated',
          effective_level: null,
          pending_next_week_level: 'MEDIUM',
          effective_week_id: '2026-W12',
          pending_week_id: '2026-W13',
          worked_days_in_week: 3,
          completed_revenue_sum_week: 165000,
        });
      }

      if (day === '2026-03-27') {
        expect(getSidecarState(SELLER_A_ID)).toMatchObject({
          calibration_status: 'calibrated',
          effective_level: 'MEDIUM',
          pending_next_week_level: null,
          effective_week_id: '2026-W13',
          streak_days: 5,
          streak_multiplier: 1.5,
          last_completed_workday: '2026-03-27',
        });
      }

      if (day === '2026-04-05') {
        expect(getSidecarState(SELLER_A_ID)).toMatchObject({
          calibration_status: 'calibrated',
          effective_level: 'STRONG',
          pending_next_week_level: 'TOP',
          effective_week_id: '2026-W14',
          pending_week_id: '2026-W15',
          worked_days_in_week: 3,
          completed_revenue_sum_week: 255000,
        });
      }
    }

    const sellerAFinalState = getSidecarState(SELLER_A_ID);
    expect(sellerAFinalState).toMatchObject({
      calibration_status: 'calibrated',
      effective_level: 'TOP',
      pending_next_week_level: null,
      pending_week_id: null,
      effective_week_id: '2026-W15',
      streak_days: 2,
      streak_multiplier: 1.2,
      last_completed_workday: '2026-04-08',
      worked_days_in_week: 2,
      completed_revenue_sum_week: 170000,
    });

    expect(getSidecarState(SELLER_B_ID)).toMatchObject({
      calibration_status: 'uncalibrated',
      effective_level: null,
      pending_next_week_level: null,
      effective_week_id: '2026-W15',
      worked_days_in_week: 0,
      completed_revenue_sum_week: 0,
      streak_days: 0,
      streak_multiplier: 1,
    });

    const dayPayloads = new Map();
    for (const day of VALID_SALES_DAYS) {
      dayPayloads.set(day, await getDayPayload(day));
    }

    const expectedWeeklyPoints = new Map();
    W15_DAYS.forEach((day) => {
      const pointsRows = dayPayloads.get(day)?.points_by_user || [];
      pointsRows.forEach((row) => {
        const sellerId = Number(row.user_id);
        expectedWeeklyPoints.set(
          sellerId,
          Number(expectedWeeklyPoints.get(sellerId) || 0) + Number(row.points_total || 0),
        );
      });
    });

    const expectedSeasonPoints = new Map();
    VALID_SALES_DAYS.forEach((day) => {
      const pointsRows = dayPayloads.get(day)?.points_by_user || [];
      pointsRows.forEach((row) => {
        const sellerId = Number(row.user_id);
        expectedSeasonPoints.set(
          sellerId,
          Number(expectedSeasonPoints.get(sellerId) || 0) + Number(row.points_total || 0),
        );
      });
    });

    const weeklyRes = await request(app)
      .get('/api/owner/motivation/weekly?week=2026-W15')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(weeklyRes.status).toBe(200);
    expect(weeklyRes.body.ok).toBe(true);

    const weeklySellers = weeklyRes.body.data.sellers || [];
    expect(
      weeklySellers
        .filter((row) => Number(row.user_id) !== SELLER_B_ID)
        .map((row) => Number(row.user_id))
    ).toEqual(
      buildSortedRanking(expectedWeeklyPoints, SELLER_REVENUE_TOTALS)
    );
    expect(findRowByUserId(weeklySellers, SELLER_B_ID)).toMatchObject({
      user_id: SELLER_B_ID,
      streak_days: 0,
      k_streak: 1,
    });
    expect(Number(findRowByUserId(weeklySellers, SELLER_B_ID)?.points_week_total || 0)).toBeGreaterThan(0);

    [SELLER_A_ID, SELLER_C_ID, SELLER_D_ID].forEach((sellerId) => {
      const weeklyRow = findRowByUserId(weeklySellers, sellerId);
      expect(weeklyRow).toBeDefined();
      expect(Number(weeklyRow.points_week_total || 0)).toBeCloseTo(
        Number(expectedWeeklyPoints.get(sellerId) || 0),
        6,
      );
    });

    const seasonRes = await request(app)
      .get('/api/owner/motivation/season?season_id=2026')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(seasonRes.status).toBe(200);
    expect(seasonRes.body.ok).toBe(true);

    const seasonSellers = seasonRes.body.data.sellers || [];
    expect(
      seasonSellers
        .filter((row) => Number(row.user_id) !== SELLER_B_ID)
        .map((row) => Number(row.user_id))
    ).toEqual(
      buildSortedRanking(expectedSeasonPoints, SELLER_REVENUE_TOTALS)
    );
    expect(Number(findRowByUserId(seasonSellers, SELLER_B_ID)?.points_total || 0)).toBeGreaterThan(0);

    [SELLER_A_ID, SELLER_C_ID, SELLER_D_ID].forEach((sellerId) => {
      const seasonRow = findRowByUserId(seasonSellers, sellerId);
      expect(seasonRow).toBeDefined();
      expect(Number(seasonRow.points_total || 0)).toBeCloseTo(
        Number(expectedSeasonPoints.get(sellerId) || 0),
        6,
      );
      expect(Number(seasonRow.is_eligible || 0)).toBe(0);
    });
    expect(Number(findRowByUserId(seasonSellers, SELLER_A_ID)?.season_payout || 0)).toBeGreaterThan(0);
    expect(Number(findRowByUserId(seasonSellers, SELLER_A_ID)?.season_payout_recipient || 0)).toBe(1);

    const ownerSellersRes = await request(app)
      .get('/api/owner/sellers?preset=all')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerSellersRes.status).toBe(200);
    expect(ownerSellersRes.body.ok).toBe(true);

    const ownerSellerItems = ownerSellersRes.body.data.items || [];

    [SELLER_A_ID, SELLER_B_ID, SELLER_C_ID, SELLER_D_ID].forEach((sellerId) => {
      const ownerRow = findRowByUserId(ownerSellerItems, sellerId);
      expect(ownerRow).toBeDefined();
      expect(Number(ownerRow.revenue_forecast || 0)).toBe(Number(SELLER_REVENUE_TOTALS.get(sellerId)));
    });

    expect(findRowByUserId(ownerSellerItems, SELLER_A_ID)?.seller_calibration_state).toMatchObject({
      calibration_status: 'calibrated',
      effective_level: 'TOP',
      pending_next_week_level: null,
      effective_week_id: '2026-W15',
      streak_days: 2,
      streak_multiplier: 1.2,
    });
    expect(findRowByUserId(ownerSellerItems, SELLER_B_ID)?.seller_calibration_state).toMatchObject({
      calibration_status: 'uncalibrated',
      effective_level: null,
      pending_next_week_level: null,
    });

    const todayDayPayload = dayPayloads.get('2026-04-08');
    expect(findRowByUserId(todayDayPayload?.points_by_user || [], SELLER_B_ID)).toBeUndefined();
    const dispatcherSummaryRes = await request(app)
      .get('/api/dispatcher/shift-ledger/summary?business_day=2026-04-08')
      .set('Authorization', `Bearer ${dispatcherToken}`);
    expect(dispatcherSummaryRes.status).toBe(200);
    expect(dispatcherSummaryRes.body.ok).toBe(true);
    expect(dispatcherSummaryRes.body.source).toBe('snapshot');

    const ownerMoneyRes = await request(app)
      .get('/api/owner/money/summary?from=2026-04-08&to=2026-04-08')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerMoneyRes.status).toBe(200);
    expect(ownerMoneyRes.body.ok).toBe(true);

    const ownerTotals = ownerMoneyRes.body.data?.totals || {};
    const ownerDecisionMetrics = ownerMoneyRes.body.data?.owner_decision_metrics || {};
    const shiftSeasonToday = Number(
      dispatcherSummaryRes.body?.shift_close_breakdown?.totals?.season_from_revenue ??
      dispatcherSummaryRes.body?.motivation_withhold?.season_from_revenue ??
      dispatcherSummaryRes.body?.motivation_withhold?.season_amount ??
      0
    );

    expect(Number(todayDayPayload?.withhold?.weekly_amount || 0)).toBeCloseTo(
      Number(dispatcherSummaryRes.body?.weekly_fund || 0),
      6,
    );
    expect(Number(todayDayPayload?.withhold?.weekly_amount || 0)).toBeCloseTo(
      Number(ownerDecisionMetrics.withhold_weekly_today ?? ownerTotals.funds_withhold_weekly_today ?? 0),
      6,
    );
    expect(Number(todayDayPayload?.withhold?.season_amount || 0)).toBeCloseTo(
      Number(ownerDecisionMetrics.withhold_season_today ?? ownerTotals.funds_withhold_season_today ?? 0),
      6,
    );
    expect(Number(ownerDecisionMetrics.withhold_season_today ?? ownerTotals.funds_withhold_season_today ?? 0)).toBeCloseTo(
      shiftSeasonToday,
      6,
    );

    const sellerASeasonRow = findRowByUserId(seasonSellers, SELLER_A_ID);
    const sellerAOwnerRow = findRowByUserId(ownerSellerItems, SELLER_A_ID);
    expect(Number(sellerAOwnerRow.revenue_forecast || 0)).toBeGreaterThan(0);
    expect(Number(sellerASeasonRow.season_payout || 0)).toBeGreaterThan(0);
    expect(Number(sellerASeasonRow.is_eligible || 0)).toBe(0);

    expect(getIsoWeekIdForBusinessDay('2026-04-08')).toBe('2026-W15');
  });
});
