import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDb, resetTestDb } from '../_helpers/dbReset.js';
import {
  getSellerCalibrationState,
  upsertSellerCalibrationState,
} from '../../server/motivation/seller-calibration-state.mjs';
import {
  runSellerCalibrationEngineForDay,
} from '../../server/motivation/seller-calibration-engine.mjs';

let db;
let boatId;
let templateId;
let slotTimeSequence = 0;

function insertSeller(id, username) {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, is_active)
    VALUES (?, ?, 'hash', 'seller', 1)
  `).run(id, username);
}

function insertBoat(name, type = 'speed') {
  return db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
    VALUES (?, ?, 1, 3000, 1500, 2250)
  `).run(name, type).lastInsertRowid;
}

function insertScheduleTemplate(boatIdInput, { productType = 'speed' } = {}) {
  return db.prepare(`
    INSERT INTO schedule_templates (
      weekday, time, product_type, boat_id, boat_type, capacity,
      price_adult, price_child, price_teen, duration_minutes, is_active
    )
    VALUES (1, '08:00', ?, ?, ?, 30, 3000, 1500, 2250, 60, 1)
  `).run(productType, boatIdInput, productType).lastInsertRowid;
}

function nextUniqueTime() {
  const totalMinutes = (8 * 60) + (slotTimeSequence * 7);
  slotTimeSequence += 1;
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function insertBoatSlot(boatIdInput, {
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
    VALUES (?, ?, 3000, 30, 30, 3000, 1500, 2250, 60, ?, 1, 30, ?, ?)
  `).run(boatIdInput, time, tripDate, isCompleted, status).lastInsertRowid;
}

function insertGeneratedSlot(templateIdInput, boatIdInput, {
  tripDate,
  time,
  isCompleted = 1,
  status = 'COMPLETED',
} = {}) {
  return db.prepare(`
    INSERT INTO generated_slots (
      schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
      duration_minutes, is_active, price_adult, price_child, price_teen,
      is_completed, status
    )
    VALUES (?, ?, ?, ?, 30, 30, 60, 1, 3000, 1500, 2250, ?, ?)
  `).run(templateIdInput, tripDate, boatIdInput, time, isCompleted, status).lastInsertRowid;
}

function insertPresale({
  sellerId,
  boatSlotId,
  slotUid,
  businessDay,
  numberOfSeats,
  totalPrice,
  status = 'ACTIVE',
}) {
  return db.prepare(`
    INSERT INTO presales (
      boat_slot_id, slot_uid, seller_id,
      customer_name, customer_phone, number_of_seats,
      total_price, prepayment_amount, status, business_day
    )
    VALUES (?, ?, ?, 'Buyer', '79990000000', ?, ?, 0, ?, ?)
  `).run(boatSlotId, slotUid, sellerId, numberOfSeats, totalPrice, status, businessDay).lastInsertRowid;
}

function insertTicket({ presaleId, boatSlotId, ticketCode, price, status = 'ACTIVE' }) {
  return db.prepare(`
    INSERT INTO tickets (
      presale_id, boat_slot_id, ticket_code, status, price
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(presaleId, boatSlotId, ticketCode, status, price).lastInsertRowid;
}

function insertCanonicalTicket({
  ticketId,
  presaleId,
  slotId,
  boatId: boatIdInput,
  slotUid,
  businessDay,
  amount,
  cashAmount,
  cardAmount = 0,
  status = 'VALID',
}) {
  db.prepare(`
    INSERT INTO sales_transactions_canonical (
      ticket_id, presale_id, slot_id, boat_id, slot_uid,
      amount, cash_amount, card_amount, method, status, business_day
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ticketId,
    presaleId,
    slotId,
    boatIdInput,
    slotUid,
    amount,
    cashAmount,
    cardAmount,
    cardAmount > 0 && cashAmount > 0 ? 'MIXED' : (cardAmount > 0 ? 'CARD' : 'CASH'),
    status,
    businessDay,
  );
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

function createCompletedGeneratedSale({
  sellerId,
  businessDay,
  totalRevenue,
  seats = 5,
  tripCompleted = 1,
  tripStatus = 'COMPLETED',
  presaleStatus = 'ACTIVE',
  ticketStatus = 'ACTIVE',
  canonicalStatus = 'VALID',
  fullyPaid = true,
}) {
  const time = nextUniqueTime();
  const boatSlotId = insertBoatSlot(boatId, {
    tripDate: businessDay,
    time,
    isCompleted: tripCompleted,
    status: tripStatus,
  });
  const generatedSlotId = insertGeneratedSlot(templateId, boatId, {
    tripDate: businessDay,
    time,
    isCompleted: tripCompleted,
    status: tripStatus,
  });
  const seatPrices = splitSeatPrices(totalRevenue, seats);
  const presaleId = insertPresale({
    sellerId,
    boatSlotId,
    slotUid: `generated:${generatedSlotId}`,
    businessDay,
    numberOfSeats: seats,
    totalPrice: seatPrices.reduce((sum, price) => sum + price, 0),
    status: presaleStatus,
  });

  seatPrices.forEach((price, index) => {
    const ticketId = insertTicket({
      presaleId,
      boatSlotId,
      ticketCode: `TKT-${sellerId}-${businessDay}-${index + 1}-${time.replace(':', '')}`,
      price,
      status: ticketStatus,
    });

    insertCanonicalTicket({
      ticketId,
      presaleId,
      slotId: boatSlotId,
      boatId,
      slotUid: `generated:${generatedSlotId}`,
      businessDay,
      amount: price,
      cashAmount: fullyPaid ? price : Math.floor(price / 2),
      cardAmount: 0,
      status: canonicalStatus,
    });
  });
}

function processDay(businessDay, sellerIds) {
  return runSellerCalibrationEngineForDay(
    db,
    businessDay,
    sellerIds ? { sellerIds } : undefined
  );
}

function processDays(days, sellerIds) {
  for (const day of days) {
    processDay(day, sellerIds);
  }
}

function seedEffectiveLevelState({ sellerId, businessDay, effectiveLevel, streakDays = 0 }) {
  upsertSellerCalibrationState(db, {
    sellerId,
    businessDay,
    calibrationStatus: 'calibrated',
    effectiveLevel,
    streakDays,
    streakMultiplier: streakDays > 0 ? 1.1 : 1,
    lastCompletedWorkday: null,
    workedDaysInWeek: 0,
    completedRevenueSumWeek: 0,
  });
}

describe('SELLER CALIBRATION ENGINE', () => {
  beforeAll(() => {
    resetTestDb();
    db = getTestDb();
  });

  beforeEach(() => {
    db.exec(`
      DELETE FROM seller_calibration_state;
      DELETE FROM sales_transactions_canonical;
      DELETE FROM tickets;
      DELETE FROM presales;
      DELETE FROM generated_slots;
      DELETE FROM schedule_templates;
      DELETE FROM boat_slots;
      DELETE FROM boats;
      DELETE FROM users WHERE id BETWEEN 8101 AND 8699;
    `);
    slotTimeSequence = 0;
    boatId = insertBoat(`Calibration Boat ${Date.now()}`);
    templateId = insertScheduleTemplate(boatId);
  });

  it('keeps the first week uncalibrated, stores pending_next_week_level on Sunday, and activates it only on the next Monday', () => {
    const sellerId = 8101;
    insertSeller(sellerId, 'seller_first_week');

    createCompletedGeneratedSale({ sellerId, businessDay: '2026-04-06', totalRevenue: 55000 });
    createCompletedGeneratedSale({ sellerId, businessDay: '2026-04-07', totalRevenue: 55000 });
    createCompletedGeneratedSale({ sellerId, businessDay: '2026-04-08', totalRevenue: 55000 });

    processDays(['2026-04-06', '2026-04-07', '2026-04-08'], [sellerId]);
    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      calibration_status: 'uncalibrated',
      effective_level: null,
      pending_next_week_level: null,
      worked_days_in_week: 3,
      completed_revenue_sum_week: 165000,
    });

    processDays(['2026-04-09', '2026-04-10', '2026-04-11', '2026-04-12'], [sellerId]);

    const sundayState = getSellerCalibrationState(db, sellerId);
    expect(sundayState).toMatchObject({
      calibration_status: 'uncalibrated',
      effective_level: null,
      pending_next_week_level: 'MEDIUM',
      pending_week_id: '2026-W16',
      worked_days_in_week: 3,
      completed_revenue_sum_week: 165000,
      effective_week_id: '2026-W15',
    });

    processDay('2026-04-13', [sellerId]);

    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      calibration_status: 'calibrated',
      effective_level: 'MEDIUM',
      pending_next_week_level: null,
      pending_week_id: null,
      worked_days_in_week: 0,
      completed_revenue_sum_week: 0,
      effective_week_id: '2026-W16',
    });
  });

  it('marks already calibrated sellers as insufficient_data when a completed week has fewer than three worked days', () => {
    const sellerId = 8102;
    insertSeller(sellerId, 'seller_insufficient_week');
    seedEffectiveLevelState({
      sellerId,
      businessDay: '2026-04-13',
      effectiveLevel: 'WEAK',
    });

    createCompletedGeneratedSale({ sellerId, businessDay: '2026-04-13', totalRevenue: 55000 });
    createCompletedGeneratedSale({ sellerId, businessDay: '2026-04-14', totalRevenue: 52000 });

    processDays([
      '2026-04-13',
      '2026-04-14',
      '2026-04-15',
      '2026-04-16',
      '2026-04-17',
      '2026-04-18',
      '2026-04-19',
    ], [sellerId]);

    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      calibration_status: 'insufficient_data',
      effective_level: 'WEAK',
      pending_next_week_level: null,
      pending_week_id: null,
      worked_days_in_week: 2,
      completed_revenue_sum_week: 107000,
    });
  });

  it('assigns weak, medium, strong, and top levels from completed worked-day averages', () => {
    const sellers = [
      { sellerId: 8201, username: 'seller_weak', revenue: 45000, expectedLevel: 'WEAK' },
      { sellerId: 8202, username: 'seller_medium', revenue: 55000, expectedLevel: 'MEDIUM' },
      { sellerId: 8203, username: 'seller_strong', revenue: 75000, expectedLevel: 'STRONG' },
      { sellerId: 8204, username: 'seller_top', revenue: 80000, expectedLevel: 'TOP' },
    ];
    sellers.forEach(({ sellerId, username }) => insertSeller(sellerId, username));

    for (const day of ['2026-04-20', '2026-04-21', '2026-04-22']) {
      sellers.forEach(({ sellerId, revenue }) => {
        createCompletedGeneratedSale({ sellerId, businessDay: day, totalRevenue: revenue });
      });
    }

    processDays([
      '2026-04-20',
      '2026-04-21',
      '2026-04-22',
      '2026-04-26',
    ], sellers.map(({ sellerId }) => sellerId));

    sellers.forEach(({ sellerId, expectedLevel }) => {
      expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
        calibration_status: 'uncalibrated',
        effective_level: null,
        pending_next_week_level: expectedLevel,
      });
    });

    processDay('2026-04-27', sellers.map(({ sellerId }) => sellerId));

    sellers.forEach(({ sellerId, expectedLevel }) => {
      expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
        calibration_status: 'calibrated',
        effective_level: expectedLevel,
        pending_next_week_level: null,
        effective_week_id: '2026-W18',
      });
    });
  }, 60000);

  it('counts a worked day only when completed fully-paid seats reach five', () => {
    const sellerId = 8301;
    insertSeller(sellerId, 'seller_worked_day_gate');

    createCompletedGeneratedSale({ sellerId, businessDay: '2026-05-04', totalRevenue: 100000, seats: 4 });
    createCompletedGeneratedSale({ sellerId, businessDay: '2026-05-05', totalRevenue: 25000, seats: 5 });
    createCompletedGeneratedSale({ sellerId, businessDay: '2026-05-06', totalRevenue: 25000, seats: 5 });

    processDays([
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
      '2026-05-08',
      '2026-05-09',
      '2026-05-10',
    ], [sellerId]);

    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      calibration_status: 'uncalibrated',
      effective_level: null,
      pending_next_week_level: null,
      worked_days_in_week: 2,
      completed_revenue_sum_week: 50000,
      last_completed_workday: '2026-05-06',
    });
  });

  it('ignores future or unfinished trips in the hidden calibration engine', () => {
    const sellerId = 8401;
    insertSeller(sellerId, 'seller_future_trip');

    createCompletedGeneratedSale({
      sellerId,
      businessDay: '2026-05-11',
      totalRevenue: 90000,
      tripCompleted: 0,
      tripStatus: 'ACTIVE',
    });

    processDay('2026-05-11', [sellerId]);

    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      calibration_status: 'uncalibrated',
      effective_level: null,
      pending_next_week_level: null,
      worked_days_in_week: 0,
      completed_revenue_sum_week: 0,
      last_completed_workday: null,
    });
  });

  it('ignores cancelled and refunded data in the hidden calibration engine', () => {
    const sellerId = 8402;
    insertSeller(sellerId, 'seller_cancelled_refunded');

    createCompletedGeneratedSale({
      sellerId,
      businessDay: '2026-05-12',
      totalRevenue: 60000,
      presaleStatus: 'CANCELLED',
    });
    createCompletedGeneratedSale({
      sellerId,
      businessDay: '2026-05-12',
      totalRevenue: 60000,
      ticketStatus: 'REFUNDED',
      canonicalStatus: 'VOID',
    });

    processDay('2026-05-12', [sellerId]);

    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      calibration_status: 'uncalibrated',
      effective_level: null,
      pending_next_week_level: null,
      worked_days_in_week: 0,
      completed_revenue_sum_week: 0,
      last_completed_workday: null,
    });
  });

  it('grows the new streak multiplier from 1.1 to 1.5 on consecutive qualifying workdays', () => {
    const sellerId = 8501;
    insertSeller(sellerId, 'seller_streak_growth');
    seedEffectiveLevelState({
      sellerId,
      businessDay: '2026-04-13',
      effectiveLevel: 'WEAK',
    });

    const expectations = [
      ['2026-04-13', 1, 1.1],
      ['2026-04-14', 2, 1.2],
      ['2026-04-15', 3, 1.3],
      ['2026-04-16', 4, 1.4],
      ['2026-04-17', 5, 1.5],
    ];

    for (const [day, expectedDays, expectedMultiplier] of expectations) {
      createCompletedGeneratedSale({ sellerId, businessDay: day, totalRevenue: 55000 });
      processDay(day, [sellerId]);
      expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
        streak_days: expectedDays,
        streak_multiplier: expectedMultiplier,
        last_completed_workday: day,
      });
    }
  });

  it('resets streak on a no-workday and starts from day one again after the break', () => {
    const sellerId = 8502;
    insertSeller(sellerId, 'seller_streak_reset_gap');
    seedEffectiveLevelState({
      sellerId,
      businessDay: '2026-04-13',
      effectiveLevel: 'WEAK',
    });

    createCompletedGeneratedSale({ sellerId, businessDay: '2026-04-13', totalRevenue: 50000 });
    createCompletedGeneratedSale({ sellerId, businessDay: '2026-04-14', totalRevenue: 52000 });
    createCompletedGeneratedSale({ sellerId, businessDay: '2026-04-16', totalRevenue: 54000 });

    processDay('2026-04-13', [sellerId]);
    processDay('2026-04-14', [sellerId]);
    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      streak_days: 2,
      streak_multiplier: 1.2,
    });

    processDay('2026-04-15', [sellerId]);
    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      streak_days: 0,
      streak_multiplier: 1,
      last_completed_workday: '2026-04-14',
    });

    processDay('2026-04-16', [sellerId]);
    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      streak_days: 1,
      streak_multiplier: 1.1,
      last_completed_workday: '2026-04-16',
    });
  });

  it('resets streak on a worked day that stays below the effective level threshold', () => {
    const sellerId = 8503;
    insertSeller(sellerId, 'seller_streak_below_threshold');
    seedEffectiveLevelState({
      sellerId,
      businessDay: '2026-04-13',
      effectiveLevel: 'STRONG',
    });

    createCompletedGeneratedSale({ sellerId, businessDay: '2026-04-13', totalRevenue: 75000 });
    createCompletedGeneratedSale({ sellerId, businessDay: '2026-04-14', totalRevenue: 72000 });
    createCompletedGeneratedSale({ sellerId, businessDay: '2026-04-15', totalRevenue: 65000 });

    processDay('2026-04-13', [sellerId]);
    processDay('2026-04-14', [sellerId]);
    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      streak_days: 2,
      streak_multiplier: 1.2,
    });

    processDay('2026-04-15', [sellerId]);
    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      streak_days: 0,
      streak_multiplier: 1,
      last_completed_workday: '2026-04-15',
    });
  });

  it('handles ISO Monday-Sunday rollover correctly across the year boundary', () => {
    const sellerId = 8601;
    insertSeller(sellerId, 'seller_year_boundary');

    createCompletedGeneratedSale({ sellerId, businessDay: '2025-12-29', totalRevenue: 80000 });
    createCompletedGeneratedSale({ sellerId, businessDay: '2025-12-30', totalRevenue: 80000 });
    createCompletedGeneratedSale({ sellerId, businessDay: '2025-12-31', totalRevenue: 80000 });

    processDays([
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ], [sellerId]);

    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      calibration_status: 'uncalibrated',
      effective_level: null,
      pending_next_week_level: 'TOP',
      pending_week_id: '2026-W02',
      effective_week_id: '2026-W01',
    });

    processDay('2026-01-05', [sellerId]);

    expect(getSellerCalibrationState(db, sellerId)).toMatchObject({
      calibration_status: 'calibrated',
      effective_level: 'TOP',
      pending_next_week_level: null,
      pending_week_id: null,
      effective_week_id: '2026-W02',
      worked_days_in_week: 0,
      completed_revenue_sum_week: 0,
    });
  });
});
