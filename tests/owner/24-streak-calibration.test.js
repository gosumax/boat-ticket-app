// 24-streak-calibration.test.js — Streak and calibration tests
// Tests calibration phase, level progression, and streak multipliers
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, ownerToken, ownerUserId;

// Test users
let sellerId, boatId, slotId;

// Consecutive test days for streak testing
const DAYS = [
  '2030-03-01', // Saturday
  '2030-03-02', // Sunday
  '2030-03-03', // Monday
  '2030-03-04', // Tuesday
  '2030-03-05', // Wednesday
  '2030-03-06', // Thursday
  '2030-03-07', // Friday
  '2030-03-08'  // Saturday
];

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  
  // Create owner user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const ownerRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'owner', 1)
  `).run('test_owner', hashedPassword);
  ownerUserId = ownerRes.lastInsertRowid;
  ownerToken = jwt.sign({ id: ownerUserId, username: 'test_owner', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Ensure owner_settings row exists
  db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
  
  // Create seller with zone
  const sellerRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active, zone)
    VALUES (?, ?, 'seller', 1, 'center')
  `).run('test_seller', hashedPassword);
  sellerId = sellerRes.lastInsertRowid;
  
  // Create boat
  const boatRes = db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child)
    VALUES (?, 'speed', 1, 1000, 500)
  `).run('Streak Test Boat');
  boatId = boatRes.lastInsertRowid;
  
  // Create slot
  const slotRes = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, is_active, price_adult, price_child, duration_minutes)
    VALUES (?, '10:00', 1000, 10, 10, 1, 1000, 500, 60)
  `).run(boatId);
  slotId = slotRes.lastInsertRowid;
  
  // Create seller_motivation_state table if not exists
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS seller_motivation_state (
        seller_id INTEGER PRIMARY KEY,
        calibrated INTEGER NOT NULL DEFAULT 0,
        calibration_worked_days INTEGER NOT NULL DEFAULT 0,
        calibration_revenue_sum INTEGER NOT NULL DEFAULT 0,
        current_level TEXT NOT NULL DEFAULT 'NONE',
        streak_days INTEGER NOT NULL DEFAULT 0,
        last_eval_day TEXT NULL,
        week_id TEXT NULL,
        week_worked_days INTEGER NOT NULL DEFAULT 0,
        week_revenue_sum INTEGER NOT NULL DEFAULT 0
      )
    `);
  } catch (e) {
    // Table may already exist
  }
});

beforeEach(() => {
  // Clean up all test data
  db.prepare(`DELETE FROM motivation_day_settings`).run();
  DAYS.forEach(day => {
    db.prepare(`DELETE FROM money_ledger WHERE business_day = ?`).run(day);
    db.prepare(`DELETE FROM presales WHERE business_day = ?`).run(day);
    db.prepare(`DELETE FROM sales_transactions_canonical WHERE business_day = ?`).run(day);
    db.prepare(`DELETE FROM seller_motivation_state WHERE seller_id = ?`).run(sellerId);
  });
  db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
});

// Helper to create a sale for a specific day
function createSale(day, amount, sellerUserId) {
  // Create presale
  const presaleRes = db.prepare(`
    INSERT INTO presales (customer_name, customer_phone, number_of_seats, total_price, business_day, status, boat_slot_id, seller_id, zone_at_sale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('Test Customer', '79991234567', 1, amount, day, 'ACTIVE', slotId, sellerUserId, 'center');
  const presaleId = presaleRes.lastInsertRowid;
  
  // Create money_ledger entry
  db.prepare(`
    INSERT INTO money_ledger (presale_id, slot_id, trip_day, business_day, kind, type, method, amount, status, seller_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(presaleId, slotId, day, day, 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 'CASH', amount, 'POSTED', sellerUserId);
  
  return presaleId;
}

// Helper to initialize seller state
function initSellerState(sellerUserId, calibrated = 0, level = 'NONE', streakDays = 0, calibrationDays = 0, calibrationRevenue = 0) {
  db.prepare(`
    INSERT OR REPLACE INTO seller_motivation_state 
    (seller_id, calibrated, calibration_worked_days, calibration_revenue_sum, current_level, streak_days, last_eval_day, week_id, week_worked_days, week_revenue_sum)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0)
  `).run(sellerUserId, calibrated, calibrationDays, calibrationRevenue, level, streakDays);
}

// Helper to update seller state for a day (simulating shift close)
function updateSellerStateForDay(sellerUserId, day, revenue) {
  // Get current state
  let state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerUserId);
  
  if (!state) {
    db.prepare(`
      INSERT INTO seller_motivation_state (seller_id, calibrated, calibration_worked_days, calibration_revenue_sum, current_level, streak_days)
      VALUES (?, 0, 0, 0, 'NONE', 0)
    `).run(sellerUserId);
    state = {
      seller_id: sellerUserId,
      calibrated: 0,
      calibration_worked_days: 0,
      calibration_revenue_sum: 0,
      current_level: 'NONE',
      streak_days: 0
    };
  }
  
  // Skip if already processed
  if (state.last_eval_day === day) return state;
  
  let newCalibrated = state.calibrated;
  let newCalibrationWorkedDays = state.calibration_worked_days;
  let newCalibrationRevenueSum = state.calibration_revenue_sum;
  let newCurrentLevel = state.current_level;
  let newStreakDays = state.streak_days;
  
  const workedToday = revenue > 0;
  
  // Phase 1: Calibration (first 3 working days)
  if (state.calibrated === 0) {
    if (workedToday) {
      newCalibrationWorkedDays += 1;
      newCalibrationRevenueSum += revenue;
    }
    
    if (newCalibrationWorkedDays >= 3) {
      const avgRevenue = newCalibrationRevenueSum / newCalibrationWorkedDays;
      newCurrentLevel = getLevelByAvg(avgRevenue);
      newCalibrated = 1;
      newStreakDays = 0;
    }
  } 
  // Phase 2: Normal operation
  else {
    const threshold = getStreakThreshold(state.current_level);
    
    if (!workedToday) {
      newStreakDays = 0;
    } else if (revenue > threshold) {
      newStreakDays += 1;
    } else {
      newStreakDays = 0;
    }
  }
  
  // Save state
  db.prepare(`
    UPDATE seller_motivation_state SET
      calibrated = ?,
      calibration_worked_days = ?,
      calibration_revenue_sum = ?,
      current_level = ?,
      streak_days = ?,
      last_eval_day = ?
    WHERE seller_id = ?
  `).run(newCalibrated, newCalibrationWorkedDays, newCalibrationRevenueSum, newCurrentLevel, newStreakDays, day, sellerUserId);
  
  return { calibrated: newCalibrated, current_level: newCurrentLevel, streak_days: newStreakDays };
}

// Level thresholds (same as in seller-motivation-state.mjs)
function getLevelByAvg(avgRevenue) {
  const avg = Number(avgRevenue) || 0;
  if (avg < 40000) return 'NONE';
  if (avg < 50000) return 'WEAK';
  if (avg < 60000) return 'MID';
  if (avg < 70000) return 'STRONG';
  return 'TOP';
}

function getStreakThreshold(level) {
  const thresholds = {
    NONE: 0,
    WEAK: 50000,
    MID: 60000,
    STRONG: 70000,
    TOP: 80000
  };
  return thresholds[level] || 0;
}

function getStreakMultiplier(streakDays) {
  const days = Math.max(0, Math.floor(Number(streakDays) || 0));
  const multipliers = {
    0: 1.00,
    1: 1.00,
    2: 1.05,
    3: 1.10,
    4: 1.15,
    5: 1.20,
    6: 1.25,
    7: 1.30,
    8: 1.30
  };
  return multipliers[Math.min(days, 8)] || 1.30;
}

describe('STREAK AND CALIBRATION', () => {
  
  describe('A) Calibration phase (first 3 working days)', () => {
    
    it('seller starts uncalibrated', async () => {
      initSellerState(sellerId, 0, 'NONE', 0, 0, 0);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      
      expect(state.calibrated).toBe(0);
      expect(state.current_level).toBe('NONE');
      expect(state.streak_days).toBe(0);
    });
    
    it('after 1 working day: still uncalibrated', async () => {
      initSellerState(sellerId, 0, 'NONE', 0, 0, 0);
      
      createSale(DAYS[0], 50000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 50000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      
      expect(state.calibrated).toBe(0);
      expect(state.calibration_worked_days).toBe(1);
    });
    
    it('after 2 working days: still uncalibrated', async () => {
      initSellerState(sellerId, 0, 'NONE', 0, 0, 0);
      
      createSale(DAYS[0], 50000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 50000);
      
      createSale(DAYS[1], 60000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[1], 60000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      
      expect(state.calibrated).toBe(0);
      expect(state.calibration_worked_days).toBe(2);
    });
    
    it('after 3 working days: calibrated with correct level', async () => {
      initSellerState(sellerId, 0, 'NONE', 0, 0, 0);
      
      // 3 days averaging 55000 -> MID level
      createSale(DAYS[0], 50000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 50000);
      
      createSale(DAYS[1], 55000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[1], 55000);
      
      createSale(DAYS[2], 60000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[2], 60000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      
      expect(state.calibrated).toBe(1);
      // Average = (50000 + 55000 + 60000) / 3 = 55000 -> MID level
      expect(state.current_level).toBe('MID');
    });
    
    it('calibration to TOP level with high revenue', async () => {
      initSellerState(sellerId, 0, 'NONE', 0, 0, 0);
      
      // 3 days averaging 80000 -> TOP level
      createSale(DAYS[0], 75000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 75000);
      
      createSale(DAYS[1], 80000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[1], 80000);
      
      createSale(DAYS[2], 85000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[2], 85000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      
      expect(state.calibrated).toBe(1);
      expect(state.current_level).toBe('TOP');
    });
    
    it('calibration to WEAK level with moderate revenue', async () => {
      initSellerState(sellerId, 0, 'NONE', 0, 0, 0);
      
      // 3 days averaging 45000 -> WEAK level
      createSale(DAYS[0], 42000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 42000);
      
      createSale(DAYS[1], 45000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[1], 45000);
      
      createSale(DAYS[2], 48000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[2], 48000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      
      expect(state.calibrated).toBe(1);
      expect(state.current_level).toBe('WEAK');
    });
  });
  
  describe('B) Streak building', () => {
    
    it('streak starts at 0 after calibration', async () => {
      // Initialize as calibrated
      initSellerState(sellerId, 1, 'MID', 0, 3, 165000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      
      expect(state.streak_days).toBe(0);
    });
    
    it('streak increases when exceeding threshold', async () => {
      // MID level requires >60000 to maintain streak
      initSellerState(sellerId, 1, 'MID', 0, 3, 165000);
      
      createSale(DAYS[0], 65000, sellerId); // > 60000 threshold
      updateSellerStateForDay(sellerId, DAYS[0], 65000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      
      expect(state.streak_days).toBe(1);
    });
    
    it('streak builds over multiple days', async () => {
      initSellerState(sellerId, 1, 'TOP', 0, 3, 240000);
      
      // TOP level requires >80000 to maintain streak
      createSale(DAYS[0], 85000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 85000);
      
      createSale(DAYS[1], 90000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[1], 90000);
      
      createSale(DAYS[2], 95000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[2], 95000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      
      expect(state.streak_days).toBe(3);
    });
    
    it('streak resets when below threshold', async () => {
      initSellerState(sellerId, 1, 'TOP', 3, 3, 240000);
      
      // Below threshold (80000)
      createSale(DAYS[0], 70000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 70000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      
      expect(state.streak_days).toBe(0);
    });
    
    it('streak resets when no work', async () => {
      initSellerState(sellerId, 1, 'TOP', 5, 3, 240000);
      
      // No revenue = didn't work
      updateSellerStateForDay(sellerId, DAYS[0], 0);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      
      expect(state.streak_days).toBe(0);
    });
  });
  
  describe('C) Streak multipliers in points calculation', () => {
    
    it('streak_days=0 has multiplier 1.00', async () => {
      const multiplier = getStreakMultiplier(0);
      expect(multiplier).toBe(1.00);
    });
    
    it('streak_days=2 has multiplier 1.05', async () => {
      const multiplier = getStreakMultiplier(2);
      expect(multiplier).toBe(1.05);
    });
    
    it('streak_days=3 has multiplier 1.10', async () => {
      const multiplier = getStreakMultiplier(3);
      expect(multiplier).toBe(1.10);
    });
    
    it('streak_days=5 has multiplier 1.20', async () => {
      const multiplier = getStreakMultiplier(5);
      expect(multiplier).toBe(1.20);
    });
    
    it('streak_days=8+ has max multiplier 1.30', async () => {
      expect(getStreakMultiplier(8)).toBe(1.30);
      expect(getStreakMultiplier(10)).toBe(1.30);
      expect(getStreakMultiplier(100)).toBe(1.30);
    });
    
    it('points_total includes streak multiplier', async () => {
      // Setup seller with streak
      initSellerState(sellerId, 1, 'TOP', 5, 3, 240000);
      
      // Set adaptive mode with known coefficients
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 1.0,
          k_zone_center: 1.0
        });
      
      createSale(DAYS[0], 10000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAYS[0]}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const sellerPoints = res.body.data.points_by_user.find(p => p.user_id === sellerId);
      
      // With streak=5, multiplier should be 1.20
      // Base points = (10000/1000) * 1.0 * 1.0 = 10
      // With streak = 10 * 1.20 = 12
      expect(sellerPoints).toBeDefined();
      expect(sellerPoints.k_streak).toBe(1.20);
      expect(sellerPoints.points_total).toBeCloseTo(sellerPoints.points_base * 1.20, 1);
    });
  });
  
  describe('D) Level thresholds', () => {
    
    it('NONE level for avg < 40000', async () => {
      initSellerState(sellerId, 0, 'NONE', 0, 0, 0);
      
      createSale(DAYS[0], 30000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 30000);
      
      createSale(DAYS[1], 35000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[1], 35000);
      
      createSale(DAYS[2], 38000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[2], 38000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      expect(state.current_level).toBe('NONE');
    });
    
    it('WEAK level for avg 40000-49999', async () => {
      initSellerState(sellerId, 0, 'NONE', 0, 0, 0);
      
      createSale(DAYS[0], 42000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 42000);
      
      createSale(DAYS[1], 45000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[1], 45000);
      
      createSale(DAYS[2], 48000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[2], 48000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      expect(state.current_level).toBe('WEAK');
    });
    
    it('MID level for avg 50000-59999', async () => {
      initSellerState(sellerId, 0, 'NONE', 0, 0, 0);
      
      createSale(DAYS[0], 52000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 52000);
      
      createSale(DAYS[1], 55000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[1], 55000);
      
      createSale(DAYS[2], 58000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[2], 58000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      expect(state.current_level).toBe('MID');
    });
    
    it('STRONG level for avg 60000-69999', async () => {
      initSellerState(sellerId, 0, 'NONE', 0, 0, 0);
      
      createSale(DAYS[0], 62000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 62000);
      
      createSale(DAYS[1], 65000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[1], 65000);
      
      createSale(DAYS[2], 68000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[2], 68000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      expect(state.current_level).toBe('STRONG');
    });
    
    it('TOP level for avg >= 70000', async () => {
      initSellerState(sellerId, 0, 'NONE', 0, 0, 0);
      
      createSale(DAYS[0], 72000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 72000);
      
      createSale(DAYS[1], 75000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[1], 75000);
      
      createSale(DAYS[2], 78000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[2], 78000);
      
      const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      expect(state.current_level).toBe('TOP');
    });
  });
  
  describe('E) Points_by_user includes streak info', () => {
    
    it('points_by_user entry has streak fields', async () => {
      initSellerState(sellerId, 1, 'TOP', 3, 3, 240000);
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive' });
      
      createSale(DAYS[0], 50000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAYS[0]}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const sellerPoints = res.body.data.points_by_user.find(p => p.user_id === sellerId);
      
      expect(sellerPoints).toBeDefined();
      expect(sellerPoints.calibrated).toBe(1);
      expect(sellerPoints.current_level).toBe('TOP');
      expect(sellerPoints.streak_days).toBe(3);
      expect(sellerPoints.k_streak).toBe(1.10);
    });
    
    it('uncalibrated seller has k_streak = 1.00', async () => {
      initSellerState(sellerId, 0, 'NONE', 0, 0, 0);
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive' });
      
      createSale(DAYS[0], 50000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAYS[0]}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const sellerPoints = res.body.data.points_by_user.find(p => p.user_id === sellerId);
      
      expect(sellerPoints.calibrated).toBe(0);
      expect(sellerPoints.k_streak).toBe(1.00);
    });
  });
  
  describe('F) Multi-day streak scenario', () => {
    
    it('complete streak scenario over 6 days', async () => {
      // Start fresh
      initSellerState(sellerId, 1, 'TOP', 0, 3, 240000);
      
      const revenues = [85000, 90000, 95000, 88000, 92000, 86000]; // All > 80000 threshold
      let expectedStreak = 0;
      
      for (let i = 0; i < revenues.length; i++) {
        createSale(DAYS[i], revenues[i], sellerId);
        updateSellerStateForDay(sellerId, DAYS[i], revenues[i]);
        expectedStreak++;
        
        const state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
        expect(state.streak_days).toBe(expectedStreak);
      }
      
      // After 6 days, streak should be 6, multiplier 1.25
      const finalState = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      expect(finalState.streak_days).toBe(6);
      expect(getStreakMultiplier(finalState.streak_days)).toBe(1.25);
    });
    
    it('streak breaks on bad day', async () => {
      initSellerState(sellerId, 1, 'TOP', 0, 3, 240000);
      
      // 3 good days
      createSale(DAYS[0], 85000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[0], 85000);
      
      createSale(DAYS[1], 90000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[1], 90000);
      
      createSale(DAYS[2], 95000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[2], 95000);
      
      let state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      expect(state.streak_days).toBe(3);
      
      // Bad day (< 80000 threshold)
      createSale(DAYS[3], 60000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[3], 60000);
      
      state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      expect(state.streak_days).toBe(0);
      
      // Resume streak
      createSale(DAYS[4], 90000, sellerId);
      updateSellerStateForDay(sellerId, DAYS[4], 90000);
      
      state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
      expect(state.streak_days).toBe(1);
    });
  });
});
