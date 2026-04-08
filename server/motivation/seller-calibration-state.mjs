import {
  getIsoWeekIdForBusinessDay,
  getNextIsoWeekId,
  parseBusinessDayLocal,
  parseIsoWeekId,
} from '../utils/iso-week.mjs';

export const SELLER_CALIBRATION_STATUSES = Object.freeze({
  UNCALIBRATED: 'uncalibrated',
  CALIBRATED: 'calibrated',
  INSUFFICIENT_DATA: 'insufficient_data',
});

export const SELLER_CALIBRATION_LEVELS = Object.freeze([
  'WEAK',
  'MEDIUM',
  'STRONG',
  'TOP',
]);

const LEVEL_SET = new Set(SELLER_CALIBRATION_LEVELS);
const LEVEL_ALIASES = Object.freeze({
  MID: 'MEDIUM',
});
const STATUS_SET = new Set(Object.values(SELLER_CALIBRATION_STATUSES));

function normalizePositiveInteger(value, fieldName) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return normalized;
}

function normalizeNonNegativeInteger(value, fieldName) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return normalized;
}

function normalizeBusinessDay(value, fieldName, { allowNull = true } = {}) {
  if (value == null || value === '') {
    if (allowNull) return null;
    throw new Error(`${fieldName} must be a YYYY-MM-DD business day`);
  }

  const parsed = parseBusinessDayLocal(value);
  if (!parsed) {
    throw new Error(`${fieldName} must be a YYYY-MM-DD business day`);
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeWeekId(value, fieldName, { allowNull = true } = {}) {
  if (value == null || value === '') {
    if (allowNull) return null;
    throw new Error(`${fieldName} must be a valid ISO week id`);
  }

  const parsed = parseIsoWeekId(value);
  if (!parsed) {
    throw new Error(`${fieldName} must be a valid ISO week id`);
  }

  return parsed.week_id;
}

function normalizeLevel(value, fieldName) {
  if (value == null || value === '') return null;
  const normalizedRaw = String(value).trim().toUpperCase();
  const normalized = LEVEL_ALIASES[normalizedRaw] || normalizedRaw;
  if (!LEVEL_SET.has(normalized)) {
    throw new Error(`${fieldName} must be one of ${SELLER_CALIBRATION_LEVELS.join(', ')}`);
  }
  return normalized;
}

function normalizeCalibrationStatus(value) {
  const normalized = String(value || SELLER_CALIBRATION_STATUSES.UNCALIBRATED).trim().toLowerCase();
  if (!STATUS_SET.has(normalized)) {
    throw new Error(`calibrationStatus must be one of ${Array.from(STATUS_SET).join(', ')}`);
  }
  return normalized;
}

function normalizeStreakMultiplier(value) {
  const normalized = value == null || value === '' ? 1 : Number(value);
  if (!Number.isFinite(normalized) || normalized < 1) {
    throw new Error('streakMultiplier must be a finite number >= 1');
  }
  return Math.round(normalized * 1000) / 1000;
}

function normalizeStateRow(row) {
  if (!row) return null;
  return {
    seller_id: Number(row.seller_id),
    calibration_status: String(row.calibration_status || SELLER_CALIBRATION_STATUSES.UNCALIBRATED),
    effective_level: row.effective_level == null ? null : String(row.effective_level),
    pending_next_week_level: row.pending_next_week_level == null ? null : String(row.pending_next_week_level),
    streak_days: Number(row.streak_days || 0),
    streak_multiplier: Number(row.streak_multiplier || 1),
    last_completed_workday: row.last_completed_workday == null ? null : String(row.last_completed_workday),
    worked_days_in_week: Number(row.worked_days_in_week || 0),
    completed_revenue_sum_week: Number(row.completed_revenue_sum_week || 0),
    effective_week_id: String(row.effective_week_id),
    pending_week_id: row.pending_week_id == null ? null : String(row.pending_week_id),
    created_at: row.created_at == null ? null : String(row.created_at),
    updated_at: row.updated_at == null ? null : String(row.updated_at),
  };
}

function normalizeStateInput(input = {}) {
  const sellerId = normalizePositiveInteger(input.sellerId ?? input.seller_id, 'sellerId');
  const calibrationStatus = normalizeCalibrationStatus(input.calibrationStatus ?? input.calibration_status);
  const effectiveLevel = normalizeLevel(input.effectiveLevel ?? input.effective_level, 'effectiveLevel');
  const pendingNextWeekLevel = normalizeLevel(
    input.pendingNextWeekLevel ?? input.pending_next_week_level,
    'pendingNextWeekLevel'
  );
  const businessDay = normalizeBusinessDay(
    input.businessDay ?? input.business_day,
    'businessDay',
    { allowNull: true }
  );
  const effectiveWeekId = normalizeWeekId(
    input.effectiveWeekId ?? input.effective_week_id,
    'effectiveWeekId',
    { allowNull: true }
  ) || (businessDay ? getIsoWeekIdForBusinessDay(businessDay) : null);

  if (!effectiveWeekId) {
    throw new Error('effectiveWeekId or businessDay is required');
  }

  let pendingWeekId = normalizeWeekId(
    input.pendingWeekId ?? input.pending_week_id,
    'pendingWeekId',
    { allowNull: true }
  );

  if (pendingNextWeekLevel && !pendingWeekId) {
    pendingWeekId = getNextIsoWeekId(effectiveWeekId);
  }

  if (!pendingNextWeekLevel && pendingWeekId) {
    throw new Error('pendingNextWeekLevel is required when pendingWeekId is set');
  }

  if (pendingWeekId) {
    const expectedPendingWeekId = getNextIsoWeekId(effectiveWeekId);
    if (pendingWeekId !== expectedPendingWeekId) {
      throw new Error('pendingWeekId must be the next ISO week after effectiveWeekId');
    }
  }

  if (calibrationStatus === SELLER_CALIBRATION_STATUSES.CALIBRATED && !effectiveLevel) {
    throw new Error('effectiveLevel is required when calibrationStatus is calibrated');
  }

  if (calibrationStatus === SELLER_CALIBRATION_STATUSES.UNCALIBRATED && effectiveLevel) {
    throw new Error('effectiveLevel must be null when calibrationStatus is uncalibrated');
  }

  return {
    seller_id: sellerId,
    calibration_status: calibrationStatus,
    effective_level: effectiveLevel,
    pending_next_week_level: pendingNextWeekLevel,
    streak_days: normalizeNonNegativeInteger(input.streakDays ?? input.streak_days ?? 0, 'streakDays'),
    streak_multiplier: normalizeStreakMultiplier(input.streakMultiplier ?? input.streak_multiplier),
    last_completed_workday: normalizeBusinessDay(
      input.lastCompletedWorkday ?? input.last_completed_workday,
      'lastCompletedWorkday',
      { allowNull: true }
    ),
    worked_days_in_week: normalizeNonNegativeInteger(
      input.workedDaysInWeek ?? input.worked_days_in_week ?? 0,
      'workedDaysInWeek'
    ),
    completed_revenue_sum_week: normalizeNonNegativeInteger(
      input.completedRevenueSumWeek ?? input.completed_revenue_sum_week ?? 0,
      'completedRevenueSumWeek'
    ),
    effective_week_id: effectiveWeekId,
    pending_week_id: pendingWeekId,
  };
}

export function ensureSellerCalibrationStateSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seller_calibration_state (
      seller_id INTEGER PRIMARY KEY,
      calibration_status TEXT NOT NULL DEFAULT 'uncalibrated'
        CHECK (calibration_status IN ('uncalibrated', 'calibrated', 'insufficient_data')),
      effective_level TEXT NULL,
      pending_next_week_level TEXT NULL,
      streak_days INTEGER NOT NULL DEFAULT 0 CHECK (streak_days >= 0),
      streak_multiplier REAL NOT NULL DEFAULT 1.0 CHECK (streak_multiplier >= 1),
      last_completed_workday TEXT NULL,
      worked_days_in_week INTEGER NOT NULL DEFAULT 0 CHECK (worked_days_in_week >= 0),
      completed_revenue_sum_week INTEGER NOT NULL DEFAULT 0 CHECK (completed_revenue_sum_week >= 0),
      effective_week_id TEXT NOT NULL,
      pending_week_id TEXT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_seller_calibration_state_effective_week
    ON seller_calibration_state(effective_week_id)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_seller_calibration_state_pending_week
    ON seller_calibration_state(pending_week_id)
  `);
}

export function buildInitialSellerCalibrationState({ sellerId, businessDay }) {
  return normalizeStateInput({
    sellerId,
    businessDay,
    calibrationStatus: SELLER_CALIBRATION_STATUSES.UNCALIBRATED,
    effectiveLevel: null,
    pendingNextWeekLevel: null,
    streakDays: 0,
    streakMultiplier: 1,
    lastCompletedWorkday: null,
    workedDaysInWeek: 0,
    completedRevenueSumWeek: 0,
  });
}

export function getSellerCalibrationState(db, sellerId) {
  ensureSellerCalibrationStateSchema(db);
  const normalizedSellerId = normalizePositiveInteger(sellerId, 'sellerId');
  const row = db
    .prepare('SELECT * FROM seller_calibration_state WHERE seller_id = ?')
    .get(normalizedSellerId);
  return normalizeStateRow(row);
}

export function listSellerCalibrationStates(db, { sellerIds } = {}) {
  ensureSellerCalibrationStateSchema(db);

  if (!Array.isArray(sellerIds) || sellerIds.length === 0) {
    return db
      .prepare('SELECT * FROM seller_calibration_state ORDER BY seller_id ASC')
      .all()
      .map(normalizeStateRow);
  }

  const normalizedSellerIds = sellerIds.map((sellerId) => normalizePositiveInteger(sellerId, 'sellerId'));
  const placeholders = normalizedSellerIds.map(() => '?').join(', ');
  return db
    .prepare(`SELECT * FROM seller_calibration_state WHERE seller_id IN (${placeholders}) ORDER BY seller_id ASC`)
    .all(...normalizedSellerIds)
    .map(normalizeStateRow);
}

export function upsertSellerCalibrationState(db, input = {}) {
  ensureSellerCalibrationStateSchema(db);
  const state = normalizeStateInput(input);

  db.prepare(`
    INSERT INTO seller_calibration_state (
      seller_id,
      calibration_status,
      effective_level,
      pending_next_week_level,
      streak_days,
      streak_multiplier,
      last_completed_workday,
      worked_days_in_week,
      completed_revenue_sum_week,
      effective_week_id,
      pending_week_id,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(seller_id) DO UPDATE SET
      calibration_status = excluded.calibration_status,
      effective_level = excluded.effective_level,
      pending_next_week_level = excluded.pending_next_week_level,
      streak_days = excluded.streak_days,
      streak_multiplier = excluded.streak_multiplier,
      last_completed_workday = excluded.last_completed_workday,
      worked_days_in_week = excluded.worked_days_in_week,
      completed_revenue_sum_week = excluded.completed_revenue_sum_week,
      effective_week_id = excluded.effective_week_id,
      pending_week_id = excluded.pending_week_id,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    state.seller_id,
    state.calibration_status,
    state.effective_level,
    state.pending_next_week_level,
    state.streak_days,
    state.streak_multiplier,
    state.last_completed_workday,
    state.worked_days_in_week,
    state.completed_revenue_sum_week,
    state.effective_week_id,
    state.pending_week_id
  );

  return getSellerCalibrationState(db, state.seller_id);
}

export default {
  buildInitialSellerCalibrationState,
  ensureSellerCalibrationStateSchema,
  getSellerCalibrationState,
  listSellerCalibrationStates,
  SELLER_CALIBRATION_LEVELS,
  SELLER_CALIBRATION_STATUSES,
  upsertSellerCalibrationState,
};
