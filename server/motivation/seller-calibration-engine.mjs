import {
  getSellerCompletedDailyMetrics,
  listSellerCompletedDailyMetrics,
  SELLER_COMPLETED_WORKED_DAY_MIN_SEATS,
} from './seller-completed-daily-base.mjs';
import {
  buildInitialSellerCalibrationState,
  ensureSellerCalibrationStateSchema,
  getSellerCalibrationState,
  SELLER_CALIBRATION_STATUSES,
  upsertSellerCalibrationState,
} from './seller-calibration-state.mjs';
import {
  formatYmdLocal,
  getIsoWeekIdForBusinessDay,
  getNextIsoWeekId,
  getIsoWeekRangeLocal,
  parseBusinessDayLocal,
} from '../utils/iso-week.mjs';

export const SELLER_CALIBRATION_LEVEL_THRESHOLDS = Object.freeze({
  WEAK: Object.freeze({ min: 0, max: 49999 }),
  MEDIUM: Object.freeze({ min: 50000, max: 59999 }),
  STRONG: Object.freeze({ min: 60000, max: 79999 }),
  TOP: Object.freeze({ min: 80000, max: Infinity }),
});

export const SELLER_CALIBRATION_STREAK_THRESHOLDS = Object.freeze({
  WEAK: 50000,
  MEDIUM: 60000,
  STRONG: 70000,
  TOP: 80000,
});

export const SELLER_CALIBRATION_STREAK_MULTIPLIERS = Object.freeze({
  0: 1,
  1: 1.1,
  2: 1.2,
  3: 1.3,
  4: 1.4,
  5: 1.5,
});

function normalizeBusinessDay(value, fieldName = 'businessDay') {
  const parsed = parseBusinessDayLocal(value);
  if (!parsed) {
    throw new Error(`${fieldName} must be a YYYY-MM-DD business day`);
  }
  return formatYmdLocal(parsed);
}

function normalizePositiveInteger(value, fieldName) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return normalized;
}

function listActiveSellerIds(db, { sellerIds = null } = {}) {
  if (!Array.isArray(sellerIds) || sellerIds.length === 0) {
    return db
      .prepare(`
        SELECT id
        FROM users
        WHERE role = 'seller'
          AND is_active = 1
        ORDER BY id ASC
      `)
      .all()
      .map((row) => Number(row.id));
  }

  const normalizedSellerIds = sellerIds.map((sellerId) => normalizePositiveInteger(sellerId, 'sellerId'));
  const placeholders = normalizedSellerIds.map(() => '?').join(', ');
  return db
    .prepare(`
      SELECT id
      FROM users
      WHERE role = 'seller'
        AND is_active = 1
        AND id IN (${placeholders})
      ORDER BY id ASC
    `)
    .all(...normalizedSellerIds)
    .map((row) => Number(row.id));
}

function compareIsoWeekIds(leftWeekId, rightWeekId) {
  const leftRange = getIsoWeekRangeLocal(leftWeekId);
  const rightRange = getIsoWeekRangeLocal(rightWeekId);
  const leftValue = String(leftRange?.dateFrom || '');
  const rightValue = String(rightRange?.dateFrom || '');
  return leftValue.localeCompare(rightValue);
}

function getPreviousBusinessDay(businessDay) {
  const parsed = parseBusinessDayLocal(businessDay);
  if (!parsed) return null;
  parsed.setDate(parsed.getDate() - 1);
  parsed.setHours(0, 0, 0, 0);
  return formatYmdLocal(parsed);
}

function toMetricRow(metrics, sellerId, businessDay) {
  const completedSeats = Math.max(0, Number(metrics?.completed_fully_paid_seats || 0));
  const completedRevenue = Math.max(0, Number(metrics?.completed_finished_revenue || 0));
  return {
    seller_id: Number(sellerId),
    business_day: businessDay,
    completed_finished_revenue: completedRevenue,
    completed_fully_paid_seats: completedSeats,
    worked_day: completedSeats >= SELLER_COMPLETED_WORKED_DAY_MIN_SEATS && completedRevenue > 0,
  };
}

export function getSellerCalibrationLevelForAverageRevenue(avgRevenue) {
  const revenue = Math.max(0, Number(avgRevenue || 0));
  if (revenue >= SELLER_CALIBRATION_LEVEL_THRESHOLDS.TOP.min) return 'TOP';
  if (revenue >= SELLER_CALIBRATION_LEVEL_THRESHOLDS.STRONG.min) return 'STRONG';
  if (revenue >= SELLER_CALIBRATION_LEVEL_THRESHOLDS.MEDIUM.min) return 'MEDIUM';
  return 'WEAK';
}

export function getSellerCalibrationStreakThreshold(level) {
  const normalizedLevel = String(level || '').trim().toUpperCase();
  return SELLER_CALIBRATION_STREAK_THRESHOLDS[normalizedLevel] ?? null;
}

export function getSellerCalibrationStreakMultiplier(streakDays) {
  const normalizedDays = Math.max(0, Math.floor(Number(streakDays) || 0));
  if (normalizedDays >= 5) return SELLER_CALIBRATION_STREAK_MULTIPLIERS[5];
  return SELLER_CALIBRATION_STREAK_MULTIPLIERS[normalizedDays] ?? 1;
}

function activatePendingLevelIfNeeded(state, businessDay) {
  const currentWeekId = getIsoWeekIdForBusinessDay(businessDay);
  if (!currentWeekId || state.effective_week_id === currentWeekId) {
    return { ...state };
  }

  const nextState = {
    ...state,
    effective_week_id: currentWeekId,
    worked_days_in_week: 0,
    completed_revenue_sum_week: 0,
  };

  if (
    state.pending_next_week_level &&
    state.pending_week_id &&
    compareIsoWeekIds(currentWeekId, state.pending_week_id) >= 0
  ) {
    nextState.effective_level = state.pending_next_week_level;
    nextState.pending_next_week_level = null;
    nextState.pending_week_id = null;
    nextState.calibration_status = SELLER_CALIBRATION_STATUSES.CALIBRATED;
  }

  return nextState;
}

function applyDailyMetricsToState(state, metrics, businessDay) {
  const metricRow = toMetricRow(metrics, state.seller_id, businessDay);
  const revenue = metricRow.completed_finished_revenue;
  const workedDay = Boolean(metricRow.worked_day);
  const previousStreakDays = Math.max(0, Number(state.streak_days || 0));
  const previousLastCompletedWorkday = state.last_completed_workday || null;
  const previousBusinessDay = getPreviousBusinessDay(businessDay);
  const nextState = {
    ...state,
    streak_days: 0,
    streak_multiplier: 1,
  };

  if (workedDay) {
    nextState.worked_days_in_week = Math.max(0, Number(state.worked_days_in_week || 0)) + 1;
    nextState.completed_revenue_sum_week = Math.max(0, Number(state.completed_revenue_sum_week || 0)) + revenue;
    nextState.last_completed_workday = businessDay;
  }

  if (!nextState.effective_level) {
    return nextState;
  }

  const threshold = getSellerCalibrationStreakThreshold(nextState.effective_level);
  const qualifiesForStreak = workedDay && threshold != null && revenue >= threshold;
  if (!qualifiesForStreak) {
    return nextState;
  }

  const isConsecutive = (
    previousStreakDays > 0 &&
    previousLastCompletedWorkday != null &&
    previousLastCompletedWorkday === previousBusinessDay
  );
  nextState.streak_days = isConsecutive ? previousStreakDays + 1 : 1;
  nextState.streak_multiplier = getSellerCalibrationStreakMultiplier(nextState.streak_days);
  return nextState;
}

function finalizeCompletedIsoWeek(state, businessDay) {
  const weekRange = getIsoWeekRangeLocal(state.effective_week_id);
  if (!weekRange || weekRange.dateTo !== businessDay) {
    return { ...state };
  }

  const workedDaysInWeek = Math.max(0, Number(state.worked_days_in_week || 0));
  if (workedDaysInWeek < 3) {
    return {
      ...state,
      pending_next_week_level: null,
      pending_week_id: null,
      calibration_status: state.effective_level
        ? SELLER_CALIBRATION_STATUSES.INSUFFICIENT_DATA
        : SELLER_CALIBRATION_STATUSES.UNCALIBRATED,
    };
  }

  const completedRevenueSumWeek = Math.max(0, Number(state.completed_revenue_sum_week || 0));
  const averageRevenue = completedRevenueSumWeek / workedDaysInWeek;
  return {
    ...state,
    calibration_status: state.effective_level
      ? SELLER_CALIBRATION_STATUSES.CALIBRATED
      : SELLER_CALIBRATION_STATUSES.UNCALIBRATED,
    pending_next_week_level: getSellerCalibrationLevelForAverageRevenue(averageRevenue),
    pending_week_id: getNextIsoWeekId(state.effective_week_id),
  };
}

export function updateSellerCalibrationStateForDay(db, { sellerId, businessDay, metrics = null } = {}) {
  ensureSellerCalibrationStateSchema(db);
  const normalizedSellerId = normalizePositiveInteger(sellerId, 'sellerId');
  const normalizedBusinessDay = normalizeBusinessDay(businessDay);
  const resolvedMetrics = metrics || getSellerCompletedDailyMetrics(db, {
    sellerId: normalizedSellerId,
    businessDay: normalizedBusinessDay,
  });

  const currentState = getSellerCalibrationState(db, normalizedSellerId)
    || buildInitialSellerCalibrationState({
      sellerId: normalizedSellerId,
      businessDay: normalizedBusinessDay,
    });

  const weekActivatedState = activatePendingLevelIfNeeded(currentState, normalizedBusinessDay);
  const dailyAppliedState = applyDailyMetricsToState(weekActivatedState, resolvedMetrics, normalizedBusinessDay);
  const finalizedState = finalizeCompletedIsoWeek(dailyAppliedState, normalizedBusinessDay);

  return upsertSellerCalibrationState(db, finalizedState);
}

export function runSellerCalibrationEngineForDay(db, businessDay, { sellerIds = null } = {}) {
  ensureSellerCalibrationStateSchema(db);
  const normalizedBusinessDay = normalizeBusinessDay(businessDay);
  const activeSellerIds = listActiveSellerIds(db, { sellerIds });
  if (activeSellerIds.length === 0) {
    return {
      business_day: normalizedBusinessDay,
      processed_sellers: 0,
      seller_states: [],
    };
  }

  const metricRows = listSellerCompletedDailyMetrics(db, {
    dateFrom: normalizedBusinessDay,
    dateTo: normalizedBusinessDay,
  });
  const metricsBySellerId = new Map(
    (metricRows || []).map((row) => [Number(row.seller_id), row])
  );
  const sellerStates = [];

  const runInTransaction = db.transaction(() => {
    for (const sellerId of activeSellerIds) {
      sellerStates.push(updateSellerCalibrationStateForDay(db, {
        sellerId,
        businessDay: normalizedBusinessDay,
        metrics: metricsBySellerId.get(Number(sellerId)) || null,
      }));
    }
  });

  runInTransaction();

  return {
    business_day: normalizedBusinessDay,
    processed_sellers: sellerStates.length,
    seller_states: sellerStates,
  };
}

export default {
  getSellerCalibrationLevelForAverageRevenue,
  getSellerCalibrationStreakMultiplier,
  getSellerCalibrationStreakThreshold,
  runSellerCalibrationEngineForDay,
  SELLER_CALIBRATION_LEVEL_THRESHOLDS,
  SELLER_CALIBRATION_STREAK_MULTIPLIERS,
  SELLER_CALIBRATION_STREAK_THRESHOLDS,
  updateSellerCalibrationStateForDay,
};
