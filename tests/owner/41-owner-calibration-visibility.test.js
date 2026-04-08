import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';
import { upsertSellerCalibrationState } from '../../server/motivation/seller-calibration-state.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app;
let db;
let ownerToken;

function insertSeller(sellerId, username, zone = 'center') {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, is_active, zone)
    VALUES (?, ?, 'hash', 'seller', 1, ?)
  `).run(sellerId, username, zone);
}

function insertSaleForDay({
  sellerId,
  businessDay,
  zoneAtSale = 'center',
  totalPrice = 50000,
  boatName = 'Owner Calibration Boat',
}) {
  const boatId = db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
    VALUES (?, 'speed', 1, 3000, 1500, 2250)
  `).run(`${boatName} ${sellerId} ${businessDay}`).lastInsertRowid;

  const slotId = db.prepare(`
    INSERT INTO boat_slots (
      boat_id, time, price, capacity, seats_left,
      price_adult, price_child, price_teen, duration_minutes,
      trip_date, is_active, seller_cutoff_minutes
    )
    VALUES (?, '10:00', 3000, 30, 30, 3000, 1500, 2250, 60, ?, 1, 30)
  `).run(boatId, businessDay).lastInsertRowid;

  const presaleId = db.prepare(`
    INSERT INTO presales (
      seller_id, boat_slot_id, slot_uid,
      customer_name, customer_phone, number_of_seats,
      total_price, prepayment_amount, status, business_day,
      zone_at_sale, payment_cash_amount, payment_card_amount
    )
    VALUES (?, ?, ?, 'Buyer', '79990000000', 1, ?, ?, 'ACTIVE', ?, ?, ?, 0)
  `).run(
    sellerId,
    slotId,
    `boat_slot:${slotId}`,
    totalPrice,
    totalPrice,
    businessDay,
    zoneAtSale,
    totalPrice,
  ).lastInsertRowid;

  db.prepare(`
    INSERT INTO money_ledger (
      kind, type, amount, seller_id, presale_id,
      status, business_day, event_time, method
    )
    VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', ?, ?, ?, 'POSTED', ?, datetime('now'), 'CASH')
  `).run(totalPrice, sellerId, presaleId, businessDay);

  return { boatId, slotId, presaleId };
}

function getDaySellerPointsRow(response, sellerId) {
  return (response.body?.data?.points_by_user || []).find((row) => Number(row.user_id) === Number(sellerId));
}

function getDaySellerPayoutRow(response, sellerId) {
  return (response.body?.data?.payouts || []).find((row) => Number(row.user_id) === Number(sellerId));
}

function getWeeklySellerRow(response, sellerId) {
  return (response.body?.data?.sellers || []).find((row) => Number(row.user_id) === Number(sellerId));
}

function getOwnerSellerRow(response, sellerId) {
  return (response.body?.data?.items || []).find((row) => Number(row.seller_id) === Number(sellerId));
}

describe('OWNER CALIBRATION VISIBILITY', () => {
  beforeAll(async () => {
    resetTestDb();
    app = await makeApp();
    db = getTestDb();

    const passwordHash = bcrypt.hashSync('password123', 10);
    const ownerId = db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active)
      VALUES (1201, 'owner_hidden_visibility', ?, 'owner', 1)
    `).run(passwordHash).lastInsertRowid;

    ownerToken = jwt.sign(
      { id: ownerId, username: 'owner_hidden_visibility', role: 'owner' },
      JWT_SECRET,
      { expiresIn: '24h' },
    );

    db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
  });

  beforeEach(() => {
    db.exec(`
      DELETE FROM motivation_day_settings;
      DELETE FROM seller_calibration_state;
      DELETE FROM seller_motivation_state;
      DELETE FROM money_ledger;
      DELETE FROM tickets;
      DELETE FROM presales;
      DELETE FROM boat_slots;
      DELETE FROM boats;
      DELETE FROM users WHERE id IN (2201, 2202, 2203);
    `);

    db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
      motivationType: 'adaptive',
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

  it('falls back to uncalibrated owner visibility when hidden state is missing', async () => {
    const sellerId = 2201;
    const businessDay = '2026-04-08';
    const weekId = '2026-W15';

    insertSeller(sellerId, 'seller_owner_uncalibrated');
    insertSaleForDay({ sellerId, businessDay });

    const [dayRes, weekRes, sellersRes] = await Promise.all([
      request(app)
        .get(`/api/owner/motivation/day?day=${businessDay}`)
        .set('Authorization', `Bearer ${ownerToken}`),
      request(app)
        .get(`/api/owner/motivation/weekly?week=${weekId}`)
        .set('Authorization', `Bearer ${ownerToken}`),
      request(app)
        .get('/api/owner/sellers?preset=all')
        .set('Authorization', `Bearer ${ownerToken}`),
    ]);

    expect(dayRes.status).toBe(200);
    expect(weekRes.status).toBe(200);
    expect(sellersRes.status).toBe(200);
    expect(dayRes.body.meta.owner_calibration_visibility_source).toBe('seller_calibration_state_sidecar');
    expect(weekRes.body.meta.owner_calibration_visibility_source).toBe('seller_calibration_state_sidecar');
    expect(sellersRes.body.meta.owner_calibration_visibility_source).toBe('seller_calibration_state_sidecar');

    expect(getDaySellerPointsRow(dayRes, sellerId)?.seller_calibration_state).toMatchObject({
      calibration_status: 'uncalibrated',
      effective_level: null,
      pending_next_week_level: null,
      streak_days: 0,
      streak_multiplier: 1,
      effective_week_id: '2026-W15',
      pending_week_id: null,
    });
    expect(getDaySellerPayoutRow(dayRes, sellerId)?.seller_calibration_state).toMatchObject({
      calibration_status: 'uncalibrated',
      effective_week_id: '2026-W15',
    });
    expect(getWeeklySellerRow(weekRes, sellerId)?.seller_calibration_state).toMatchObject({
      calibration_status: 'uncalibrated',
      effective_level: null,
      streak_days: 0,
      streak_multiplier: 1,
      effective_week_id: '2026-W15',
    });
    expect(getOwnerSellerRow(sellersRes, sellerId)?.seller_calibration_state).toMatchObject({
      calibration_status: 'uncalibrated',
      effective_level: null,
      streak_days: 0,
      streak_multiplier: 1,
    });
  });

  it('shows sidecar calibrated and pending owner visibility without changing legacy points multipliers', async () => {
    const sellerId = 2202;
    const businessDay = '2026-04-15';
    const weekId = '2026-W16';

    insertSeller(sellerId, 'seller_owner_pending');
    insertSaleForDay({ sellerId, businessDay, totalPrice: 50000 });

    db.prepare(`
      INSERT INTO seller_motivation_state (
        seller_id,
        calibrated,
        calibration_worked_days,
        calibration_revenue_sum,
        current_level,
        streak_days,
        last_eval_day,
        week_id,
        week_worked_days,
        week_revenue_sum
      )
      VALUES (?, 1, 3, 240000, 'TOP', 3, ?, ?, 1, 50000)
    `).run(sellerId, businessDay, weekId);

    upsertSellerCalibrationState(db, {
      sellerId,
      businessDay,
      calibrationStatus: 'calibrated',
      effectiveLevel: 'STRONG',
      pendingNextWeekLevel: 'TOP',
      streakDays: 4,
      streakMultiplier: 1.4,
      lastCompletedWorkday: businessDay,
      workedDaysInWeek: 2,
      completedRevenueSumWeek: 100000,
    });

    const [dayRes, weekRes, sellersRes] = await Promise.all([
      request(app)
        .get(`/api/owner/motivation/day?day=${businessDay}`)
        .set('Authorization', `Bearer ${ownerToken}`),
      request(app)
        .get(`/api/owner/motivation/weekly?week=${weekId}`)
        .set('Authorization', `Bearer ${ownerToken}`),
      request(app)
        .get('/api/owner/sellers?preset=all')
        .set('Authorization', `Bearer ${ownerToken}`),
    ]);

    const dayPointsRow = getDaySellerPointsRow(dayRes, sellerId);
    const dayPayoutRow = getDaySellerPayoutRow(dayRes, sellerId);
    const weeklySellerRow = getWeeklySellerRow(weekRes, sellerId);
    const sellersItem = getOwnerSellerRow(sellersRes, sellerId);

    expect(dayRes.status).toBe(200);
    expect(weekRes.status).toBe(200);
    expect(sellersRes.status).toBe(200);

    expect(dayPointsRow.k_streak).toBe(1.1);
    expect(weeklySellerRow.k_streak).toBe(1.1);

    expect(dayPointsRow.seller_calibration_state).toMatchObject({
      calibration_status: 'calibrated',
      effective_level: 'STRONG',
      pending_next_week_level: 'TOP',
      streak_days: 4,
      streak_multiplier: 1.4,
      effective_week_id: '2026-W16',
      pending_week_id: '2026-W17',
    });
    expect(dayPayoutRow.seller_calibration_state).toMatchObject({
      calibration_status: 'calibrated',
      effective_level: 'STRONG',
      pending_next_week_level: 'TOP',
    });
    expect(weeklySellerRow.seller_calibration_state).toMatchObject({
      calibration_status: 'calibrated',
      effective_level: 'STRONG',
      pending_next_week_level: 'TOP',
      streak_days: 4,
      streak_multiplier: 1.4,
    });
    expect(sellersItem).toMatchObject({
      calibration_status: 'calibrated',
      effective_level: 'STRONG',
      pending_next_week_level: 'TOP',
      streak_multiplier: 1.4,
      effective_week_id: '2026-W16',
      pending_week_id: '2026-W17',
    });
    expect(sellersItem.seller_calibration_state).toMatchObject({
      streak_days: 4,
      streak_multiplier: 1.4,
    });
  });

  it('shows insufficient_data to owner while preserving the current effective level', async () => {
    const sellerId = 2203;
    const businessDay = '2026-04-22';
    const weekId = '2026-W17';

    insertSeller(sellerId, 'seller_owner_insufficient');
    insertSaleForDay({ sellerId, businessDay, totalPrice: 45000 });

    upsertSellerCalibrationState(db, {
      sellerId,
      businessDay,
      calibrationStatus: 'insufficient_data',
      effectiveLevel: 'WEAK',
      streakDays: 0,
      streakMultiplier: 1,
      lastCompletedWorkday: '2026-04-21',
      workedDaysInWeek: 1,
      completedRevenueSumWeek: 45000,
    });

    const [dayRes, weekRes, sellersRes] = await Promise.all([
      request(app)
        .get(`/api/owner/motivation/day?day=${businessDay}`)
        .set('Authorization', `Bearer ${ownerToken}`),
      request(app)
        .get(`/api/owner/motivation/weekly?week=${weekId}`)
        .set('Authorization', `Bearer ${ownerToken}`),
      request(app)
        .get('/api/owner/sellers?preset=all')
        .set('Authorization', `Bearer ${ownerToken}`),
    ]);

    expect(getDaySellerPointsRow(dayRes, sellerId)?.seller_calibration_state).toMatchObject({
      calibration_status: 'insufficient_data',
      effective_level: 'WEAK',
      pending_next_week_level: null,
      streak_days: 0,
      streak_multiplier: 1,
    });
    expect(getWeeklySellerRow(weekRes, sellerId)?.seller_calibration_state).toMatchObject({
      calibration_status: 'insufficient_data',
      effective_level: 'WEAK',
      pending_next_week_level: null,
    });
    expect(getOwnerSellerRow(sellersRes, sellerId)?.seller_calibration_state).toMatchObject({
      calibration_status: 'insufficient_data',
      effective_level: 'WEAK',
      pending_next_week_level: null,
      effective_week_id: '2026-W17',
    });
  });
});
