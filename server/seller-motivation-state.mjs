/**
 * Seller Motivation State Management
 * 
 * Handles calibration, level, and streak tracking for seller motivation.
 * Called from shift_close endpoint after day is finalized.
 */

import db from './db.js';

// Level thresholds (avg daily revenue in RUB)
const LEVEL_THRESHOLDS = {
  NONE: { min: 0, max: 40000, streak_threshold: 0 },
  WEAK: { min: 40000, max: 50000, streak_threshold: 50000 },
  MID: { min: 50000, max: 60000, streak_threshold: 60000 },
  STRONG: { min: 60000, max: 70000, streak_threshold: 70000 },
  TOP: { min: 70000, max: Infinity, streak_threshold: 80000 }
};

// Streak multiplier table (0=no streak, 1=first day, bonus starts at 2)
const STREAK_MULTIPLIERS = {
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

/**
 * Get level by average revenue
 * @param {number} avgRevenue - Average daily revenue
 * @returns {string} Level name
 */
export function getLevelByAvg(avgRevenue) {
  const avg = Number(avgRevenue) || 0;
  if (avg < 40000) return 'NONE';
  if (avg < 50000) return 'WEAK';
  if (avg < 60000) return 'MID';
  if (avg < 70000) return 'STRONG';
  return 'TOP';
}

/**
 * Get streak multiplier by streak days
 * @param {number} streakDays - Number of consecutive days (0 = no streak)
 * @returns {number} Multiplier (1.00 to 1.30)
 */
export function getStreakMultiplier(streakDays) {
  const days = Math.max(0, Math.floor(Number(streakDays) || 0));
  if (days >= 8) return 1.30;
  return STREAK_MULTIPLIERS[days] || 1.00;
}

/**
 * Get streak threshold for a level
 * @param {string} level - Current level
 * @returns {number} Revenue threshold to maintain streak
 */
export function getStreakThreshold(level) {
  return LEVEL_THRESHOLDS[level]?.streak_threshold || 0;
}

/**
 * Calculate seller revenue for a business day (net)
 * @param {string} businessDay - YYYY-MM-DD
 * @param {number} sellerId - Seller user ID
 * @returns {number} Net revenue for the day
 */
export function getSellerDayRevenue(businessDay, sellerId) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS gross,
      COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refunds
    FROM money_ledger ml
    WHERE ml.status = 'POSTED'
      AND ml.kind = 'SELLER_SHIFT'
      AND ml.seller_id = ?
      AND DATE(ml.business_day) = ?
  `).get(sellerId, businessDay);
  
  const gross = Number(row?.gross || 0);
  const refunds = Number(row?.refunds || 0);
  return Math.max(0, gross - refunds);
}

/**
 * Get ISO week ID (YYYY-WW) from date
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string} Week ID
 */
export function getWeekId(dateStr) {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const oneJan = new Date(year, 0, 1);
  const days = Math.floor((date - oneJan) / 86400000);
  const weekNum = Math.ceil((days + oneJan.getDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Check if date is Sunday
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {boolean}
 */
export function isSunday(dateStr) {
  const date = new Date(dateStr);
  return date.getDay() === 0;
}

/**
 * Update seller motivation state after shift close
 * Should be called AFTER the shift is finalized for the business day
 * @param {string} businessDay - YYYY-MM-DD
 */
export function updateSellerMotivationState(businessDay) {
  console.log(`[MOTIVATION_STATE] Updating for business_day=${businessDay}`);
  
  // Get all active sellers
  const sellers = db.prepare(`
    SELECT id FROM users WHERE role = 'seller' AND is_active = 1
  `).all();
  
  if (!sellers || sellers.length === 0) {
    console.log('[MOTIVATION_STATE] No active sellers found');
    return;
  }
  
  const weekId = getWeekId(businessDay);
  const isSundayToday = isSunday(businessDay);
  
  for (const seller of sellers) {
    const sellerId = seller.id;
    
    // Get seller's revenue for the day
    const dayRevenue = getSellerDayRevenue(businessDay, sellerId);
    const workedToday = dayRevenue > 0;
    
    // Get or create state
    let state = db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
    
    if (!state) {
      // Initialize new state
      db.prepare(`
        INSERT INTO seller_motivation_state (seller_id, calibrated, calibration_worked_days, calibration_revenue_sum, current_level, streak_days, last_eval_day, week_id, week_worked_days, week_revenue_sum)
        VALUES (?, 0, 0, 0, 'NONE', 0, NULL, NULL, 0, 0)
      `).run(sellerId);
      state = {
        seller_id: sellerId,
        calibrated: 0,
        calibration_worked_days: 0,
        calibration_revenue_sum: 0,
        current_level: 'NONE',
        streak_days: 0,
        last_eval_day: null,
        week_id: null,
        week_worked_days: 0,
        week_revenue_sum: 0
      };
    }
    
    // Skip if already processed this day
    if (state.last_eval_day === businessDay) {
      continue;
    }
    
    let newCalibrated = state.calibrated;
    let newCalibrationWorkedDays = state.calibration_worked_days;
    let newCalibrationRevenueSum = state.calibration_revenue_sum;
    let newCurrentLevel = state.current_level;
    let newStreakDays = state.streak_days;
    let newWeekWorkedDays = state.week_worked_days;
    let newWeekRevenueSum = state.week_revenue_sum;
    let newWeekId = state.week_id || weekId;
    
    // Phase 1: Calibration (first 3 working days)
    if (state.calibrated === 0) {
      if (workedToday) {
        newCalibrationWorkedDays += 1;
        newCalibrationRevenueSum += dayRevenue;
      }
      
      // Check if calibration complete (3 working days)
      if (newCalibrationWorkedDays >= 3) {
        const avgRevenue = newCalibrationRevenueSum / newCalibrationWorkedDays;
        newCurrentLevel = getLevelByAvg(avgRevenue);
        newCalibrated = 1;
        newStreakDays = 0; // Start fresh after calibration (no streak yet)
        console.log(`[MOTIVATION_STATE] Seller ${sellerId} calibrated: level=${newCurrentLevel}, avg=${Math.round(avgRevenue)}`);
      }
    } 
    // Phase 2: Normal operation (calibrated sellers)
    else {
      const threshold = getStreakThreshold(state.current_level);
      
      if (!workedToday) {
        // Didn't work - reset streak
        newStreakDays = 0;
      } else if (dayRevenue > threshold) {
        // Exceeded threshold - extend streak
        newStreakDays += 1;
      } else {
        // Below threshold - reset streak
        newStreakDays = 0;
      }
    }
    
    // Phase 3: Weekly accumulators
    if (workedToday) {
      newWeekWorkedDays += 1;
      newWeekRevenueSum += dayRevenue;
    }
    
    // Phase 4: Weekly level roll (Sunday)
    if (isSundayToday && newWeekWorkedDays > 0) {
      const weekAvg = newWeekRevenueSum / newWeekWorkedDays;
      const newLevel = getLevelByAvg(weekAvg);
      
      if (newLevel !== newCurrentLevel) {
        console.log(`[MOTIVATION_STATE] Seller ${sellerId} weekly level change: ${newCurrentLevel} -> ${newLevel}, week_avg=${Math.round(weekAvg)}`);
      }
      
      newCurrentLevel = newLevel;
      // Reset weekly accumulators for next week
      newWeekWorkedDays = 0;
      newWeekRevenueSum = 0;
      // Streak is NOT reset
    }
    
    // Update week_id if changed
    if (newWeekId !== weekId) {
      newWeekId = weekId;
    }
    
    // Save state
    db.prepare(`
      UPDATE seller_motivation_state SET
        calibrated = ?,
        calibration_worked_days = ?,
        calibration_revenue_sum = ?,
        current_level = ?,
        streak_days = ?,
        last_eval_day = ?,
        week_id = ?,
        week_worked_days = ?,
        week_revenue_sum = ?
      WHERE seller_id = ?
    `).run(
      newCalibrated,
      newCalibrationWorkedDays,
      newCalibrationRevenueSum,
      newCurrentLevel,
      newStreakDays,
      businessDay,
      newWeekId,
      newWeekWorkedDays,
      newWeekRevenueSum,
      sellerId
    );
  }
  
  console.log(`[MOTIVATION_STATE] Updated ${sellers.length} sellers for ${businessDay}`);
}

/**
 * Get seller motivation state
 * @param {number} sellerId 
 * @returns {object|null}
 */
export function getSellerState(sellerId) {
  return db.prepare('SELECT * FROM seller_motivation_state WHERE seller_id = ?').get(sellerId);
}

/**
 * Get all sellers with their motivation state
 * @returns {array}
 */
export function getAllSellersState() {
  return db.prepare(`
    SELECT 
      u.id, u.username, u.zone,
      COALESCE(s.calibrated, 0) as calibrated,
      COALESCE(s.calibration_worked_days, 0) as calibration_worked_days,
      COALESCE(s.calibration_revenue_sum, 0) as calibration_revenue_sum,
      COALESCE(s.current_level, 'NONE') as current_level,
      COALESCE(s.streak_days, 0) as streak_days,
      s.last_eval_day,
      s.week_id,
      COALESCE(s.week_worked_days, 0) as week_worked_days,
      COALESCE(s.week_revenue_sum, 0) as week_revenue_sum
    FROM users u
    LEFT JOIN seller_motivation_state s ON s.seller_id = u.id
    WHERE u.role = 'seller' AND u.is_active = 1
  `).all();
}

export default {
  getLevelByAvg,
  getStreakMultiplier,
  getStreakThreshold,
  getSellerDayRevenue,
  updateSellerMotivationState,
  getSellerState,
  getAllSellersState,
  getWeekId,
  isSunday
};
