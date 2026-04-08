/**
 * motivation/engine.mjs
 * Core motivation calculation engine - reusable across endpoints.
 * Extracted from owner.mjs to avoid formula duplication.
 */

import { getStreakMultiplier, getSellerState } from '../seller-motivation-state.mjs';
import {
  OWNER_SETTINGS_DEFAULTS,
  mergeOwnerSettings,
  resolveOwnerSettings,
} from '../owner-settings.mjs';
import { roundDownTo50 } from '../utils/money-rounding.mjs';

function roundToKopecks(amount) {
  return Math.round(Number(amount || 0) * 100) / 100;
}

function safeTableExists(db, tableName) {
  try {
    const row = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE name = ? AND type IN ('table','view') LIMIT 1")
      .get(tableName);
    return !!row;
  } catch {
    return false;
  }
}

function safeGetColumns(db, tableName) {
  try {
    if (!safeTableExists(db, tableName)) return new Set();
    const rows = db.prepare(`PRAGMA table_info('${tableName}')`).all();
    return new Set((rows || []).map((r) => r.name));
  } catch {
    return new Set();
  }
}

function hasCol(colsSet, name) {
  return colsSet && colsSet.has(name);
}

function normalizePointsZone(zone) {
  const value = String(zone || '').trim().toLowerCase();
  return ['hedgehog', 'center', 'sanatorium', 'stationary'].includes(value) ? value : null;
}

function resolveSellerOnlyCanonicalZone(boatType, zoneAtSale, sellerZone) {
  const saleZone = normalizePointsZone(zoneAtSale);
  if (saleZone) return saleZone;
  if (boatType === 'banana') return normalizePointsZone(sellerZone) || 'center';
  return 'center';
}

function getReserveTripDayExpr(db) {
  const presaleCols = safeGetColumns(db, 'presales');
  const ledgerCols = safeGetColumns(db, 'money_ledger');
  const presaleTripDayExpr = hasCol(presaleCols, 'business_day')
    ? "COALESCE(p.business_day, DATE(p.created_at))"
    : 'DATE(p.created_at)';

  if (hasCol(ledgerCols, 'trip_day')) {
    return `COALESCE(NULLIF(ml.trip_day, ''), ${presaleTripDayExpr})`;
  }

  return presaleTripDayExpr;
}

function getPayrollEligibilitySql(db) {
  const hasPresales = safeTableExists(db, 'presales');
  const ledgerCols = safeGetColumns(db, 'money_ledger');
  let tripDayExpr = 'NULL';

  if (hasCol(ledgerCols, 'trip_day')) {
    tripDayExpr = hasPresales
      ? getReserveTripDayExpr(db)
      : "NULLIF(ml.trip_day, '')";
  } else if (hasPresales) {
    tripDayExpr = getReserveTripDayExpr(db);
  }

  return {
    presaleJoinSql: hasPresales ? 'LEFT JOIN presales p ON p.id = ml.presale_id' : '',
    payrollEligiblePredicate: `(${tripDayExpr} IS NULL OR ${tripDayExpr} <= ?)`,
    earnedOnDayPredicate: `(((${tripDayExpr}) = ?) OR ((${tripDayExpr}) IS NULL AND DATE(ml.business_day) = ?)) AND DATE(ml.business_day) <= ?`,
    tripDayExpr,
  };
}

function calcFutureTripsReserveTotal(db, businessDay, options = {}) {
  try {
    if (!safeTableExists(db, 'money_ledger') || !safeTableExists(db, 'presales')) return 0;

    const ledgerCols = safeGetColumns(db, 'money_ledger');
    if (!hasCol(ledgerCols, 'business_day')) return 0;
    const role = typeof options === 'string' ? options : options?.role;
    const roleJoinSql = role ? 'LEFT JOIN users u ON u.id = ml.seller_id' : '';
    const rolePredicateSql = role ? 'AND u.role = ?' : '';

    const tripDayExpr = getReserveTripDayExpr(db);
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE
          WHEN ${tripDayExpr} > ? AND ml.type IN (
            'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
            'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
          ) THEN ABS(ml.amount)
          WHEN ${tripDayExpr} > ? AND ml.type = 'SALE_CANCEL_REVERSE' THEN -ABS(ml.amount)
          ELSE 0
        END), 0) AS reserve_total
      FROM money_ledger ml
      LEFT JOIN presales p ON p.id = ml.presale_id
      ${roleJoinSql}
      WHERE ml.business_day = ?
        AND ml.status = 'POSTED'
        AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
        ${rolePredicateSql}
        AND ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED',
          'SALE_CANCEL_REVERSE'
        )
    `).get(...(role ? [businessDay, businessDay, businessDay, role] : [businessDay, businessDay, businessDay]));

    return Math.max(0, Number(row?.reserve_total || 0));
  } catch {
    return 0;
  }
}

function calcEarnedTripDayRevenueTotal(db, businessDay, options = {}) {
  try {
    if (!safeTableExists(db, 'money_ledger')) return 0;

    const { presaleJoinSql, earnedOnDayPredicate } = getPayrollEligibilitySql(db);
    const role = typeof options === 'string' ? options : options?.role;
    const roleJoinSql = role ? 'JOIN users u ON u.id = ml.seller_id' : '';
    const rolePredicateSql = role ? 'AND u.role = ?' : '';
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE
          WHEN ml.type IN (
            'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
            'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
          ) THEN ABS(ml.amount)
          ELSE 0
        END), 0) AS revenue_gross,
        COALESCE(SUM(CASE
          WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount)
          ELSE 0
        END), 0) AS refunds
      FROM money_ledger ml
      ${presaleJoinSql}
      ${roleJoinSql}
      WHERE ml.status = 'POSTED'
        AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
        AND ${earnedOnDayPredicate}
        ${rolePredicateSql}
        AND ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED',
          'SALE_CANCEL_REVERSE'
        )
    `).get(...(role ? [businessDay, businessDay, businessDay, role] : [businessDay, businessDay, businessDay]));

    return Math.max(0, roundToKopecks(Number(row?.revenue_gross || 0) - Number(row?.refunds || 0)));
  } catch {
    return 0;
  }
}

function clampPercent(rawValue, fallback) {
  let value = Number(rawValue);
  if (!Number.isFinite(value)) value = Number(fallback);
  if (!Number.isFinite(value)) value = 0;
  if (value < 0) value = 0;
  if (value > 0.05) value = 0.05;
  return value;
}

function clampDispatcherTeamWeight(rawValue) {
  let value = Number(rawValue);
  if (!Number.isFinite(value)) value = 1;
  if (value < 1) value = 1;
  if (value > 1.5) value = 1.5;
  return value;
}

function allocateAmountByBasis(totalAmount, members, getBasis, options = {}) {
  const allocations = new Map();
  const normalizedTotal = roundToKopecks(totalAmount);
  if (!(normalizedTotal > 0) || !Array.isArray(members) || members.length === 0) {
    return allocations;
  }

  const fallback = options.fallback === 'none' ? 'none' : 'equal';
  const prepared = members
    .map((member) => {
      const userId = Number(member?.user_id);
      if (!Number.isFinite(userId) || userId <= 0) return null;
      return {
        user_id: userId,
        basis: Math.max(0, Number(getBasis(member) || 0))
      };
    })
    .filter(Boolean);

  if (prepared.length === 0) {
    return allocations;
  }

  let working = prepared.filter((entry) => entry.basis > 0);
  if (working.length === 0) {
    if (fallback === 'none') return allocations;
    working = prepared.map((entry) => ({ ...entry, basis: 1 }));
  }

  const basisTotal = working.reduce((sum, entry) => sum + Number(entry.basis || 0), 0);
  if (!(basisTotal > 0)) {
    return allocations;
  }

  let allocated = 0;
  working.forEach((entry, index) => {
    const share = index === working.length - 1
      ? roundToKopecks(normalizedTotal - allocated)
      : roundToKopecks((Number(entry.basis || 0) / basisTotal) * normalizedTotal);
    allocated = roundToKopecks(allocated + share);
    allocations.set(entry.user_id, share);
  });

  return allocations;
}

function upsertParticipant(map, participant) {
  const userId = Number(participant?.user_id);
  if (!Number.isFinite(userId) || userId <= 0) return;
  if (!map.has(userId)) {
    map.set(userId, {
      ...participant,
      user_id: userId,
      revenue: Math.max(0, Number(participant?.revenue || 0))
    });
  }
}

function getUserNameById(db, userId, fallbackRole = 'dispatcher') {
  const normalizedUserId = Number(userId || 0);
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    return `${fallbackRole === 'seller' ? 'Seller' : 'Dispatcher'} #${normalizedUserId || 0}`;
  }

  try {
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(normalizedUserId);
    const username = String(row?.username || '').trim();
    if (username) return username;
  } catch {
    // Fall through to deterministic fallback name.
  }

  return `${fallbackRole === 'seller' ? 'Seller' : 'Dispatcher'} #${normalizedUserId}`;
}

function resolveShiftCloseDispatcherUserId(db, requestedUserId) {
  const normalizedRequestedUserId = Number(requestedUserId || 0);
  if (Number.isFinite(normalizedRequestedUserId) && normalizedRequestedUserId > 0) {
    try {
      const requestedRow = db
        .prepare('SELECT id FROM users WHERE id = ? AND role = ? AND is_active = 1')
        .get(normalizedRequestedUserId, 'dispatcher');
      if (requestedRow?.id) return Number(requestedRow.id);
    } catch {
      // Fall back to deterministic single-dispatcher detection below.
    }
  }

  try {
    const activeDispatchers = db
      .prepare('SELECT id FROM users WHERE role = ? AND is_active = 1 ORDER BY id ASC')
      .all('dispatcher');
    if (activeDispatchers.length === 1) {
      return Number(activeDispatchers[0].id);
    }
  } catch {
    return null;
  }

  return null;
}

function getUnattributedDispatcherRevenue(db, day) {
  try {
    const { presaleJoinSql, payrollEligiblePredicate } = getPayrollEligibilitySql(db);
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE
          WHEN ml.type IN (
            'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
            'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
          ) THEN ABS(ml.amount)
          ELSE 0
        END), 0) AS revenue_gross,
        COALESCE(SUM(CASE
          WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount)
          ELSE 0
        END), 0) AS refunds
      FROM money_ledger ml
      ${presaleJoinSql}
      WHERE ml.status = 'POSTED'
        AND ml.kind = 'DISPATCHER_SHIFT'
        AND DATE(ml.business_day) = ?
        AND ${payrollEligiblePredicate}
        AND ml.seller_id IS NULL
        AND ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED',
          'SALE_CANCEL_REVERSE'
        )
    `).get(day, day);

    return Math.max(0, Number(row?.revenue_gross || 0) - Number(row?.refunds || 0));
  } catch {
    return 0;
  }
}

function calcSeasonPrepayRoutedAmount(db, businessDay) {
  try {
    if (!safeTableExists(db, 'money_ledger')) return 0;
    const row = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM money_ledger
      WHERE kind = 'FUND'
        AND type = 'SEASON_PREPAY_DELETE'
        AND status = 'POSTED'
        AND DATE(business_day) = ?
    `).get(businessDay);
    return Math.max(0, Number(row?.total || 0));
  } catch {
    return 0;
  }
}

// OWNER_SETTINGS_DEFAULTS moved to ../owner-settings.mjs
const RETIRED_OWNER_SETTINGS_DEFAULTS = {
  // Business settings
  businessName: "Морские прогулки",
  timezone: "Europe/Moscow (UTC+3)",
  currency: "RUB",
  seasonStart: "2026-05-01",
  seasonEnd: "2026-10-01",
  
  // Analytics thresholds
  badDay: 350000,
  normalDay: 550000,
  goodDay: 800000,
  baseCompareDays: 7,
  
  // Motivation settings (final system) - stored as fractions
  motivationType: "team",
  motivation_percent: 0.15,
  individual_share: 0.60,
  team_share: 0.40,
  daily_activation_threshold: 200000,
  seller_series_threshold: 40000,
  dispatchers_series_threshold: 55000,
  season_min_days_N: 1,
  
  // Team participation
  teamIncludeSellers: true,
  teamIncludeDispatchers: true,
  
  // Product coefficients
  k_speed: 1.2,
  k_cruise: 3.0,
  k_fishing: 5.0,
  k_zone_hedgehog: 1.3,
  k_zone_center: 1.0,
  k_zone_sanatorium: 0.8,
  k_zone_stationary: 0.7,
  k_banana_hedgehog: 2.7,
  k_banana_center: 2.2,
  k_banana_sanatorium: 1.2,
  k_banana_stationary: 1.0,
  k_dispatchers: 1.0,
  
  // Triggers/notifications
  lowLoad: 45,
  highLoad: 85,
  minSellerRevenue: 30000,
  notifyBadRevenue: true,
  notifyLowLoad: true,
  notifyLowSeller: false,
  notifyChannel: "inapp",
  
  // Withhold settings (USED FOR LEDGER ENTRIES)
  viklif_withhold_percent_total: 0,
  dispatcher_withhold_percent_total: 0.002,   // 0.2% total cap for dispatcher withhold
  weekly_withhold_percent_total: 0.008,       // 0.8% withhold for weekly pool
  season_withhold_percent_total: 0.005        // 0.5% withhold for season pool
};

/**
 * Calculate motivation payouts for a specific business day.
 * This is the core calculation engine used by both owner and dispatcher endpoints.
 * 
 * @param {Object} db - better-sqlite3 database instance
 * @param {string} day - Business day in YYYY-MM-DD format
 * @param {Object} options - Internal calculation profile/options
 * @returns {Object} Motivation data with payouts array
 */
export function calcMotivationDay(db, day, options = {}) {
  const warnings = [];
  const profile = options?.profile === 'dispatcher_shift_close'
    ? 'dispatcher_shift_close'
    : 'default';
  const shiftCloseFormulaEnabled = profile === 'dispatcher_shift_close';
  const sellerOnlyScope = !shiftCloseFormulaEnabled && options?.scope === 'seller_only';
  
  // Validate date format
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { error: 'Invalid day format (use YYYY-MM-DD)', data: null };
  }
  
  // ====================
  // STEP 0: Check if day is LOCKED (has WITHHOLD entries)
  // ====================
  const lockedDayRow = db.prepare(`
    SELECT 1 FROM money_ledger
    WHERE business_day = ? AND kind = 'FUND' AND type IN ('WITHHOLD_WEEKLY', 'WITHHOLD_SEASON') AND status = 'POSTED'
    LIMIT 1
  `).get(day);
  
  const isLocked = !!lockedDayRow;
  
  // ====================
  // STEP 1: Get or create day settings snapshot
  // ====================
  let daySettingsRow = db.prepare('SELECT settings_json FROM motivation_day_settings WHERE business_day = ?').get(day);
  let settings;
  let snapshotFound = false;
  let settingsSource = 'fallback';
  
  if (daySettingsRow?.settings_json) {
    settings = JSON.parse(daySettingsRow.settings_json);
    snapshotFound = true;
    settingsSource = 'snapshot';
  } else if (isLocked) {
    // Locked day without snapshot - use defaults (will be flagged in invariants)
    settings = mergeOwnerSettings();
    settingsSource = 'fallback';
    warnings.push('Locked day has no settings snapshot');
  } else {
    settings = resolveOwnerSettings(db);
    settingsSource = 'owner_settings';
    
    const now = new Date().toISOString();
    try {
      db.prepare('INSERT INTO motivation_day_settings (business_day, settings_json, created_at) VALUES (?, ?, ?)').run(day, JSON.stringify(settings), now);
    } catch (e) {
      // Snapshot may exist from concurrent call - ignore
    }
  }
  
  // Guard: ensure settings is always a valid object (defensive, no mutation of defaults)
  settings = mergeOwnerSettings(settings);
  
  const mode = settings.motivationType || 'team';
  const p = Number(settings.motivation_percent ?? 0.15);
  const fundPercent = Math.round(p * 100);
  
  // ====================
  // STEP 2: Calculate revenue for the day
  // ====================
  const revenueRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
      COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refunds
    FROM money_ledger ml
    WHERE ml.status = 'POSTED'
      AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
      AND DATE(ml.business_day) = ?
  `).get(day);

  const revenueTotalPaymentDay = Math.max(0, Number(revenueRow?.revenue_gross || 0) - Number(revenueRow?.refunds || 0));
  const sellerEarnedRevenueTotal = calcEarnedTripDayRevenueTotal(db, day, { role: 'seller' });
  const earned_revenue_total = sellerOnlyScope
    ? sellerEarnedRevenueTotal
    : calcEarnedTripDayRevenueTotal(db, day);
  const futureTripsReserveTotal = sellerOnlyScope
    ? calcFutureTripsReserveTotal(db, day, { role: 'seller' })
    : calcFutureTripsReserveTotal(db, day);
  const revenue_total = sellerOnlyScope
    ? sellerEarnedRevenueTotal
    : revenueTotalPaymentDay;
  const salary_base = sellerOnlyScope
    ? Math.max(0, roundToKopecks(earned_revenue_total))
    : Math.max(0, roundToKopecks(revenueTotalPaymentDay - futureTripsReserveTotal));
  const fundTotal = roundToKopecks(salary_base * p);
  const withholdBaseRevenue = sellerOnlyScope
    ? salary_base
    : (shiftCloseFormulaEnabled ? salary_base : revenue_total);
  const { presaleJoinSql, payrollEligiblePredicate, earnedOnDayPredicate } = getPayrollEligibilitySql(db);
  const revenueScopePredicate = sellerOnlyScope
    ? earnedOnDayPredicate
    : `DATE(ml.business_day) = ? AND ${payrollEligiblePredicate}`;
  const revenueScopeParams = sellerOnlyScope ? [day, day, day] : [day, day];
  
  // ====================
  // STEP 2.5: Calculate WITHHOLDS from fundTotal
  // ====================
  const MAX_ACTIVE_DISPATCHERS = 2;
  
  const viklifPercentTotal = shiftCloseFormulaEnabled
    ? 0
    : clampPercent(
        settings.viklif_withhold_percent_total,
        0
      );
  const weeklyPercentTotal = clampPercent(
    settings.weekly_withhold_percent_total,
    OWNER_SETTINGS_DEFAULTS.weekly_withhold_percent_total
  );
  const seasonPercentTotal = clampPercent(
    settings.season_withhold_percent_total,
    OWNER_SETTINGS_DEFAULTS.season_withhold_percent_total
  );
  const dispatcherPercentTotal = clampPercent(
    settings.dispatcher_withhold_percent_total,
    0.002
  );
  const dispatcherPercentPerPerson = dispatcherPercentTotal / 2;
  
  // Find dispatchers with payroll-eligible sales today (trip day <= business day).
  const dispatchersWithSalesTodayRaw = db.prepare(`
    SELECT DISTINCT ml.seller_id
    FROM money_ledger ml
    ${presaleJoinSql}
    JOIN users u ON u.id = ml.seller_id
    WHERE ml.status = 'POSTED'
      AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
      AND ${revenueScopePredicate}
      AND ml.seller_id IS NOT NULL
      AND ml.seller_id > 0
      AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED')
      AND u.role = 'dispatcher'
  `).all(...revenueScopeParams);

  let activeDispatchersTodayIdsRaw = (dispatchersWithSalesTodayRaw || []).map((r) => Number(r.seller_id));
  const unattributedDispatcherRevenue = shiftCloseFormulaEnabled
    ? getUnattributedDispatcherRevenue(db, day)
    : 0;
  const shiftCloseDispatcherUserId = shiftCloseFormulaEnabled
    ? resolveShiftCloseDispatcherUserId(db, options?.dispatcherUserId)
    : null;
  if (shiftCloseFormulaEnabled && unattributedDispatcherRevenue > 0) {
    if (Number.isFinite(shiftCloseDispatcherUserId) && shiftCloseDispatcherUserId > 0) {
      if (!activeDispatchersTodayIdsRaw.includes(shiftCloseDispatcherUserId)) {
        activeDispatchersTodayIdsRaw = [...activeDispatchersTodayIdsRaw, shiftCloseDispatcherUserId];
      }
    } else {
      warnings.push('Dispatcher shift close has unattributed dispatcher revenue without a dispatcher user mapping');
    }
  }

  // Cap to max 2 active dispatchers
  const activeDispatchersTodayIds = activeDispatchersTodayIdsRaw.slice(0, MAX_ACTIVE_DISPATCHERS);
  const activeDispatchersTodayCount = activeDispatchersTodayIds.length;

  const weeklyPercentEffective = shiftCloseFormulaEnabled
    ? weeklyPercentTotal
    : Number(
        (weeklyPercentTotal + (activeDispatchersTodayCount === 1 ? dispatcherPercentPerPerson : 0)).toFixed(6)
      );
  const dispatcherPercentAppliedTotal = Number(
    (dispatcherPercentPerPerson * activeDispatchersTodayCount).toFixed(6)
  );
  
  // Calculate withhold amounts:
  // - weekly can be rounded down to 50
  // - season is never rounded and receives all rounding remainders
  const weekly_withhold_amount_raw = roundToKopecks(withholdBaseRevenue * weeklyPercentEffective);
  const weekly_withhold_amount = roundDownTo50(weekly_withhold_amount_raw);
  const weekly_rounding_to_season = roundToKopecks(Math.max(0, weekly_withhold_amount_raw - weekly_withhold_amount));
  const viklif_withhold_amount_raw = roundToKopecks(withholdBaseRevenue * viklifPercentTotal);
  const viklif_withhold_amount = roundDownTo50(viklif_withhold_amount_raw);
  const viklif_rounding_to_season = roundToKopecks(Math.max(0, viklif_withhold_amount_raw - viklif_withhold_amount));
  const season_withhold_amount_base = roundToKopecks(withholdBaseRevenue * seasonPercentTotal);
  const season_prepay_routed_amount = roundToKopecks(calcSeasonPrepayRoutedAmount(db, day));
  
  // Dispatcher withhold: per-person percent (capped to max 2)
  const dispatcher_withhold_per_person_raw = activeDispatchersTodayCount > 0
    ? roundToKopecks(withholdBaseRevenue * dispatcherPercentPerPerson)
    : 0;
  const dispatcher_withhold_per_person = activeDispatchersTodayCount > 0
    ? roundDownTo50(dispatcher_withhold_per_person_raw)
    : 0;
  const dispatcher_withhold_amounts = activeDispatchersTodayIds.map(dispatcherId => ({
    dispatcher_id: dispatcherId,
    amount: dispatcher_withhold_per_person
  }));
  const dispatcher_withhold_total = dispatcher_withhold_amounts.reduce((sum, d) => sum + d.amount, 0);
  const dispatcher_withhold_rounding_to_season = roundToKopecks(
    Math.max(0, dispatcher_withhold_per_person_raw - dispatcher_withhold_per_person) * activeDispatchersTodayCount
  );
  
  // Final season value is shown as a total pool, but manual prepayment transfers
  // do not reduce the current day motivation fund / owner handover.
  let season_withhold_amount = roundToKopecks(
    season_withhold_amount_base +
    weekly_rounding_to_season +
    viklif_rounding_to_season +
    dispatcher_withhold_rounding_to_season
  );
  let season_fund_total = roundToKopecks(season_withhold_amount + season_prepay_routed_amount);
  let payouts_rounding_to_season = 0;
  let rounding_to_season_amount_total = roundToKopecks(
    weekly_rounding_to_season +
    viklif_rounding_to_season +
    dispatcher_withhold_rounding_to_season
  );
  let fundTotal_after_withhold = roundToKopecks(
    shiftCloseFormulaEnabled
      ? fundTotal - weekly_withhold_amount - viklif_withhold_amount - season_withhold_amount
      : fundTotal - weekly_withhold_amount - viklif_withhold_amount - season_withhold_amount - dispatcher_withhold_total
  );
  
  // ====================
  // STEP 3: Get sellers with revenue for the day
  // ====================
  const usersWithRevenue = db.prepare(`
    SELECT
      ml.seller_id,
      u.username,
      u.role,
      COALESCE(SUM(CASE
        WHEN ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
        ) THEN ABS(ml.amount)
        ELSE 0
      END), 0) AS revenue_gross,
      COALESCE(SUM(CASE
        WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount)
        ELSE 0
      END), 0) AS refunds
    FROM money_ledger ml
    ${presaleJoinSql}
    JOIN users u ON u.id = ml.seller_id
    WHERE ml.status = 'POSTED'
      AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
      AND ${revenueScopePredicate}
      AND ml.seller_id IS NOT NULL
      AND ml.seller_id > 0
      AND ml.type IN (
        'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
        'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED',
        'SALE_CANCEL_REVERSE'
      )
    GROUP BY ml.seller_id, u.username, u.role
  `).all(...revenueScopeParams);
  
  const activeSellersList = (usersWithRevenue || [])
    .filter((row) => String(row.role || '').toLowerCase() === 'seller')
    .map((row) => ({
      user_id: Number(row.seller_id),
      role: 'seller',
      name: row.username,
      revenue: Math.max(0, Number(row.revenue_gross || 0) - Number(row.refunds || 0))
    }));
  const activeDispatchersRevenueList = (usersWithRevenue || [])
    .filter((row) => String(row.role || '').toLowerCase() === 'dispatcher')
    .map((row) => ({
      user_id: Number(row.seller_id),
      role: 'dispatcher',
      name: row.username,
      revenue: Math.max(0, Number(row.revenue_gross || 0) - Number(row.refunds || 0))
    }));
  if (
    shiftCloseFormulaEnabled &&
    unattributedDispatcherRevenue > 0 &&
    Number.isFinite(shiftCloseDispatcherUserId) &&
    shiftCloseDispatcherUserId > 0
  ) {
    const unattributedDispatcherName = getUserNameById(db, shiftCloseDispatcherUserId, 'dispatcher');
    const existingIndex = activeDispatchersRevenueList.findIndex(
      (dispatcher) => Number(dispatcher.user_id) === Number(shiftCloseDispatcherUserId)
    );
    if (existingIndex >= 0) {
      const existing = activeDispatchersRevenueList[existingIndex];
      activeDispatchersRevenueList[existingIndex] = {
        ...existing,
        revenue: Math.max(0, Number(existing.revenue || 0) + unattributedDispatcherRevenue)
      };
    } else {
      activeDispatchersRevenueList.push({
        user_id: Number(shiftCloseDispatcherUserId),
        role: 'dispatcher',
        name: unattributedDispatcherName,
        revenue: unattributedDispatcherRevenue
      });
    }
  }
  
  // ====================
  // STEP 4: Get active dispatchers
  // ====================
  const dispatchersList = db.prepare(`
    SELECT id, username
    FROM users
    WHERE role = 'dispatcher' AND is_active = 1
  `).all();
  
  const dispatchersById = new Map((dispatchersList || []).map((dispatcher) => [Number(dispatcher.id), dispatcher]));
  const activeDispatchersRevenueMap = new Map(
    (activeDispatchersRevenueList || []).map((dispatcher) => [dispatcher.user_id, dispatcher.revenue])
  );
  const activeDispatchersTodayList = activeDispatchersTodayIds
    .map((dispatcherId) => dispatchersById.get(Number(dispatcherId)))
    .filter(Boolean)
    .map((dispatcher) => ({
      user_id: Number(dispatcher.id),
      role: 'dispatcher',
      name: dispatcher.username,
      revenue: Math.max(0, Number(activeDispatchersRevenueMap.get(Number(dispatcher.id)) || 0))
    }));
  
  let active_dispatchers = activeDispatchersTodayList.length;
  let active_sellers = activeSellersList.length;
  
  // ====================
  // STEP 4.5: Build revenue map
  // ====================
  const personalRevenueMap = new Map();
  const personalRevenueParticipants = sellerOnlyScope
    ? activeSellersList
    : [...activeSellersList, ...activeDispatchersRevenueList];
  for (const participant of personalRevenueParticipants) {
    personalRevenueMap.set(participant.user_id, participant.revenue);
  }
  
  // ====================
  // STEP 5: Build payouts based on mode
  // ====================
  let payouts = [];
  let participants = 0;
  let team_share = 0;
  let individual_share = 0;
  let teamFund = 0;
  let individualFund = 0;
  let teamPerPerson = 0;
  
  if (mode === 'personal') {
    participants = active_sellers;
    active_dispatchers = 0;
    
    payouts = activeSellersList.map(seller => {
      const pay = Math.round(seller.revenue * p);
      return {
        user_id: seller.user_id,
        role: 'seller',
        name: seller.name,
        revenue: seller.revenue,
        team_part: 0,
        individual_part: pay,
        total: pay
      };
    });
    
  } else if (mode === 'team') {
    const teamIncludeSellers = settings.teamIncludeSellers !== false;
    const teamIncludeDispatchers = settings.teamIncludeDispatchers !== false;
    
    const teamMembersMap = new Map();
    
    if (teamIncludeSellers) {
      activeSellersList.forEach(s => {
        teamMembersMap.set(s.user_id, {
          user_id: s.user_id,
          role: 'seller',
          name: s.name,
          revenue: s.revenue
        });
      });
    }
    
    if (teamIncludeDispatchers) {
      (dispatchersList || []).forEach(d => {
        const uid = Number(d.id);
        if (!teamMembersMap.has(uid)) {
          teamMembersMap.set(uid, {
            user_id: uid,
            role: 'dispatcher',
            name: d.username,
            revenue: 0
          });
        }
      });
    }
    
    const teamMembers = Array.from(teamMembersMap.values());
    participants = teamMembers.length;
    
    if (participants > 0) {
      teamPerPerson = Math.round(fundTotal / participants);
      
      payouts = teamMembers.map(m => ({
        user_id: m.user_id,
        role: m.role,
        name: m.name,
        revenue: m.revenue,
        team_part: teamPerPerson,
        individual_part: 0,
        total: teamPerPerson
      }));
    } else {
      warnings.push('Нет участников для распределения фонда');
    }
    
  } else if (mode === 'adaptive') {
    team_share = Number(settings.team_share ?? 0.4);
    individual_share = Number(settings.individual_share ?? 0.6);
    
    const shareSum = team_share + individual_share;
    if (Math.abs(shareSum - 1) > 0.0001) {
      if (shareSum > 0) {
        team_share = team_share / shareSum;
        individual_share = individual_share / shareSum;
      } else {
        team_share = 1;
        individual_share = 0;
      }
    }
    
    teamFund = Math.round(fundTotal * team_share);
    individualFund = Math.round(fundTotal * individual_share);
    
    const teamIncludeSellers = settings.teamIncludeSellers !== false;
    const teamIncludeDispatchers = settings.teamIncludeDispatchers !== false;
    
    const teamMembersMap = new Map();
    
    if (teamIncludeSellers) {
      activeSellersList.forEach(s => {
        teamMembersMap.set(s.user_id, {
          user_id: s.user_id,
          role: 'seller',
          name: s.name,
          revenue: s.revenue
        });
      });
    }
    
    if (teamIncludeDispatchers) {
      (dispatchersList || []).forEach(d => {
        const uid = Number(d.id);
        if (!teamMembersMap.has(uid)) {
          teamMembersMap.set(uid, {
            user_id: uid,
            role: 'dispatcher',
            name: d.username,
            revenue: 0
          });
        }
      });
    }
    
    const teamMembers = Array.from(teamMembersMap.values());
    participants = teamMembers.length;
    
    if (participants > 0) {
      teamPerPerson = Math.round(teamFund / participants);
    }
    
    const k_dispatchers = Number(settings.k_dispatchers ?? 1.0);
    
    const sellersWithWeight = activeSellersList.map(s => {
      const weighted_revenue = Math.round(s.revenue * k_dispatchers);
      return { ...s, weighted_revenue };
    });
    
    const W_total = sellersWithWeight.reduce((sum, s) => sum + s.weighted_revenue, 0);
    
    payouts = teamMembers.map(m => {
      const team_part = teamPerPerson;
      let individual_part = 0;
      let weighted_revenue = null;
      
      if (m.role === 'seller') {
        const sellerData = sellersWithWeight.find(s => s.user_id === m.user_id);
        if (sellerData) {
          weighted_revenue = sellerData.weighted_revenue;
          if (W_total > 0) {
            individual_part = Math.round((weighted_revenue / W_total) * individualFund);
          }
        }
      }
      
      return {
        user_id: m.user_id,
        role: m.role,
        name: m.name,
        revenue: m.revenue,
        ...(weighted_revenue !== null ? { weighted_revenue } : {}),
        team_part,
        individual_part,
        total: team_part + individual_part
      };
    });
  }
  
  // ====================
  // STEP 5.5: Calculate POINTS (adaptive mode only)
  // ====================
  let pointsByUserMap = new Map();
  let points_by_user = [];
  
  if (mode === 'adaptive') {
    const activeSellerIdSet = new Set(activeSellersList.map((seller) => seller.user_id));
    const sellerZones = db.prepare(`SELECT id, zone FROM users WHERE role = 'seller'`).all();
    const sellerZoneMap = new Map((sellerZones || []).map(r => [Number(r.id), r.zone]));
    const canonicalCols = safeGetColumns(db, 'sales_transactions_canonical');
    const canonicalHasBoatId = hasCol(canonicalCols, 'boat_id');
    const canonicalBoatTypeExpr = canonicalHasBoatId
      ? 'COALESCE(cb.type, gb.type, b.type)'
      : 'COALESCE(gb.type, b.type)';
    const ticketsExist = safeTableExists(db, 'tickets');
    const ticketCols = safeGetColumns(db, 'tickets');
    const ticketActivePredicate = hasCol(ticketCols, 'status')
      ? `AND t.status = 'ACTIVE'`
      : '';
    const revenueBySellerAndType = (
      sellerOnlyScope &&
      safeTableExists(db, 'sales_transactions_canonical') &&
      safeTableExists(db, 'presales')
    )
      ? db.prepare(`
          WITH valid_canonical_presales AS (
            SELECT
              stc.presale_id
              ${canonicalHasBoatId ? ', MAX(stc.boat_id) AS canonical_boat_id' : ''}
            FROM sales_transactions_canonical stc
            WHERE stc.status = 'VALID'
              AND DATE(stc.business_day) = ?
              AND stc.presale_id IS NOT NULL
            GROUP BY stc.presale_id
          ),
          scoped_presales AS (
            SELECT
              p.id AS presale_id,
              p.seller_id,
              u.username AS seller_name,
              u.zone AS seller_zone,
              p.zone_at_sale,
              ${canonicalBoatTypeExpr} AS boat_type,
              CAST(COALESCE(p.total_price, 0) AS INTEGER) AS presale_revenue
            FROM valid_canonical_presales vcp
            JOIN presales p ON p.id = vcp.presale_id
            JOIN users u ON u.id = p.seller_id
            LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
            LEFT JOIN generated_slots gs
              ON p.slot_uid LIKE 'generated:%'
             AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER)
            LEFT JOIN boats b ON b.id = bs.boat_id
            LEFT JOIN boats gb ON gb.id = gs.boat_id
            ${canonicalHasBoatId ? 'LEFT JOIN boats cb ON cb.id = vcp.canonical_boat_id' : ''}
            WHERE p.seller_id IS NOT NULL
              AND p.seller_id > 0
              AND u.role = 'seller'
              AND COALESCE(u.is_active, 1) = 1
          )
          ${ticketsExist ? `,
          ticket_rows AS (
            SELECT
              sp.presale_id AS presale_id,
              CAST(COALESCE(t.price, 0) AS INTEGER) AS revenue
            FROM scoped_presales sp
            JOIN tickets t ON t.presale_id = sp.presale_id
            WHERE 1 = 1
              ${ticketActivePredicate}
          ),
          presale_fallback_rows AS (
            SELECT
              sp.presale_id AS presale_id,
              sp.presale_revenue AS revenue
            FROM scoped_presales sp
            WHERE NOT EXISTS (
              SELECT 1
              FROM tickets t
              WHERE t.presale_id = sp.presale_id
                ${ticketActivePredicate}
            )
          ),
          source_rows AS (
            SELECT * FROM ticket_rows
            UNION ALL
            SELECT * FROM presale_fallback_rows
          )` : `,
          source_rows AS (
            SELECT
              sp.presale_id AS presale_id,
              sp.presale_revenue AS revenue
            FROM scoped_presales sp
          )`}
          SELECT
            sp.seller_id,
            sp.seller_name,
            sp.seller_zone,
            sp.zone_at_sale,
            sp.boat_type,
            COALESCE(SUM(sr.revenue), 0) AS revenue_gross,
            0 AS refunds
          FROM scoped_presales sp
          LEFT JOIN source_rows sr ON sr.presale_id = sp.presale_id
          GROUP BY
            sp.seller_id,
            sp.seller_name,
            sp.seller_zone,
            sp.zone_at_sale,
            sp.boat_type
        `).all(day)
      : db.prepare(`
          SELECT
            ml.seller_id,
            COALESCE(b.type, gb.type) AS boat_type,
            p.zone_at_sale,
            COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
            COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refunds
          FROM money_ledger ml
          LEFT JOIN presales p ON p.id = ml.presale_id
          LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
          LEFT JOIN generated_slots gs ON (p.slot_uid LIKE 'generated:%' AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER))
          LEFT JOIN boats b ON b.id = bs.boat_id
          LEFT JOIN boats gb ON gb.id = gs.boat_id
          WHERE ml.status = 'POSTED'
            AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
            AND ${revenueScopePredicate}
            AND ml.seller_id IS NOT NULL
            AND ml.seller_id > 0
            AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
          GROUP BY ml.seller_id, COALESCE(b.type, gb.type), p.zone_at_sale
        `).all(...revenueScopeParams);
    
    const k_speed = Number(settings.k_speed ?? 1.2);
    const k_cruise = Number(settings.k_cruise ?? 3.0);
    const k_zone_hedgehog = Number(settings.k_zone_hedgehog ?? 1.3);
    const k_zone_center = Number(settings.k_zone_center ?? 1.0);
    const k_zone_sanatorium = Number(settings.k_zone_sanatorium ?? 0.8);
    const k_zone_stationary = Number(settings.k_zone_stationary ?? 0.7);
    const k_banana_hedgehog = Number(settings.k_banana_hedgehog ?? 2.7);
    const k_banana_center = Number(settings.k_banana_center ?? 2.2);
    const k_banana_sanatorium = Number(settings.k_banana_sanatorium ?? 1.2);
    const k_banana_stationary = Number(settings.k_banana_stationary ?? 1.0);
    
    const getZoneK = (zone) => {
      if (zone === 'hedgehog') return k_zone_hedgehog;
      if (zone === 'center') return k_zone_center;
      if (zone === 'sanatorium') return k_zone_sanatorium;
      if (zone === 'stationary') return k_zone_stationary;
      return 1.0;
    };
    
    const getBananaK = (zone) => {
      if (zone === 'hedgehog') return k_banana_hedgehog;
      if (zone === 'center') return k_banana_center;
      if (zone === 'sanatorium') return k_banana_sanatorium;
      if (zone === 'stationary') return k_banana_stationary;
      return 1.0;
    };
    
    pointsByUserMap = new Map();
    
    activeSellersList.forEach(s => {
      const zone = sellerZoneMap.get(s.user_id) || null;
      const state = getSellerState(s.user_id);
      const streakDays = state?.calibrated ? (state.streak_days || 0) : 0;
      const kStreak = getStreakMultiplier(streakDays);
      pointsByUserMap.set(s.user_id, {
        user_id: s.user_id,
        role: 'seller',
        name: s.name,
        zone,
        revenue_total: sellerOnlyScope ? 0 : Number(s.revenue || 0),
        revenue_by_type: { speed: 0, cruise: 0, banana: 0 },
        points_by_type: { speed: 0, cruise: 0, banana: 0 },
        points_base: 0,
        points_total: 0,
        calibrated: state?.calibrated || 0,
        current_level: state?.current_level || 'NONE',
        streak_days: streakDays,
        k_streak: kStreak
      });
    });
    
    for (const row of (revenueBySellerAndType || [])) {
      const sellerId = Number(row.seller_id);
      if (!sellerOnlyScope && !activeSellerIdSet.has(sellerId)) continue;
      const boatType = row.boat_type || null;
      const zoneAtSale = row.zone_at_sale || null;
      const sellerZone = row.seller_zone ?? sellerZoneMap.get(sellerId) ?? null;
      const revenueGross = Number(row.revenue_gross || 0);
      const refunds = Number(row.refunds || 0);
      const revenueNet = Math.max(0, revenueGross - refunds);
      
      if (!boatType || !['speed', 'cruise', 'banana'].includes(boatType)) continue;
      
      let entry = pointsByUserMap.get(sellerId);
      if (!entry) {
        const zone = sellerZoneMap.get(sellerId) || null;
        const state = getSellerState(sellerId);
        const streakDays = state?.calibrated ? (state.streak_days || 0) : 0;
        const kStreak = getStreakMultiplier(streakDays);
        entry = {
          user_id: sellerId,
          role: 'seller',
          name: row.seller_name || `Seller #${sellerId}`,
          zone: sellerZone ?? zone,
          revenue_total: 0,
          revenue_by_type: { speed: 0, cruise: 0, banana: 0 },
          points_by_type: { speed: 0, cruise: 0, banana: 0 },
          points_base: 0,
          points_total: 0,
          calibrated: state?.calibrated || 0,
          current_level: state?.current_level || 'NONE',
          streak_days: streakDays,
          k_streak: kStreak
        };
        pointsByUserMap.set(sellerId, entry);
      }
      
      entry.revenue_by_type[boatType] += revenueNet;
      entry.revenue_total += revenueNet;
      
      const effectiveZone = sellerOnlyScope
        ? resolveSellerOnlyCanonicalZone(boatType, zoneAtSale, sellerZone ?? entry.zone)
        : (zoneAtSale || entry.zone);
      const revenueInK = revenueNet / 1000;
      let pointsBase = 0;
      
      if (boatType === 'speed') {
        pointsBase = revenueInK * k_speed * getZoneK(effectiveZone);
      } else if (boatType === 'cruise') {
        pointsBase = revenueInK * k_cruise * getZoneK(effectiveZone);
      } else if (boatType === 'banana') {
        pointsBase = revenueInK * getBananaK(effectiveZone);
      }
      
      entry.points_by_type[boatType] += pointsBase;
      entry.points_base += pointsBase;
    }
    
    for (const [sellerId, entry] of pointsByUserMap) {
      if (entry.role === 'seller') {
        entry.points_total = Math.round(entry.points_base * entry.k_streak * 100) / 100;
      }
    }
    
    if (!sellerOnlyScope) {
      for (const dispatcher of (activeDispatchersTodayList || [])) {
        const uid = Number(dispatcher.user_id);
        if (!pointsByUserMap.has(uid)) {
          pointsByUserMap.set(uid, {
            user_id: uid,
            role: 'dispatcher',
            name: dispatcher.name,
            zone: null,
            revenue_total: Number(dispatcher.revenue || 0),
            revenue_by_type: { speed: 0, cruise: 0, banana: 0 },
            points_by_type: { speed: 0, cruise: 0, banana: 0 },
            points_base: 0,
            points_total: 0,
            calibrated: 0,
            current_level: 'NONE',
            streak_days: 0,
            k_streak: 1.0
          });
        }
      }
    }

    points_by_user = Array.from(pointsByUserMap.values());
  }

  // Rebuild payouts from the agreed day model:
  // revenue-based withholds + manual season transfer -> salary fund after withhold -> team/individual split.
  // Raw fund-after can go negative when a manual season transfer exceeds the motivation pool,
  // but payable salary cannot, so the actual salary pool is clamped at zero.
  const salaryFundPool = Math.max(0, roundToKopecks(
    shiftCloseFormulaEnabled
      ? fundTotal_after_withhold - dispatcher_withhold_total
      : fundTotal_after_withhold
  ));
  const stage3TeamIncludeSellers = settings.teamIncludeSellers !== false;
  const stage3TeamIncludeDispatchers = settings.teamIncludeDispatchers !== false;
  const stage3DispatcherWeight = clampDispatcherTeamWeight(settings.k_dispatchers ?? 1.0);
  const stage3PayoutByUserId = new Map();
  const stage3IndividualMetricByUserId = new Map();
  const stage3AllRevenueParticipantsMap = new Map();

  activeSellersList.forEach((seller) => upsertParticipant(stage3AllRevenueParticipantsMap, seller));
  if (!sellerOnlyScope) {
    activeDispatchersRevenueList.forEach((dispatcher) => upsertParticipant(stage3AllRevenueParticipantsMap, dispatcher));
  }
  const stage3AllRevenueParticipants = Array.from(stage3AllRevenueParticipantsMap.values());

  const ensureStage3Payout = (member) => {
    const userId = Number(member.user_id);
    if (!stage3PayoutByUserId.has(userId)) {
      stage3PayoutByUserId.set(userId, {
        user_id: userId,
        role: member.role,
        name: member.name,
        revenue: Math.max(0, Number(member.revenue || personalRevenueMap.get(userId) || 0)),
        team_part: 0,
        individual_part: 0,
        dispatcher_daily_bonus: 0,
        total_raw: 0,
        total: 0
      });
    }
    return stage3PayoutByUserId.get(userId);
  };

  payouts = [];
  participants = 0;
  team_share = 0;
  individual_share = 0;
  teamFund = 0;
  individualFund = 0;
  teamPerPerson = 0;
  active_dispatchers = sellerOnlyScope ? 0 : activeDispatchersTodayList.length;
  active_sellers = activeSellersList.length;
  const useTeamIndividualSplitModel = shiftCloseFormulaEnabled || mode === 'adaptive';

  if (mode === 'personal' && !useTeamIndividualSplitModel) {
    individual_share = 1;
    individualFund = salaryFundPool;
    participants = stage3AllRevenueParticipants.length;
    active_dispatchers = activeDispatchersRevenueList.length;

    const individualAllocations = allocateAmountByBasis(
      individualFund,
      stage3AllRevenueParticipants,
      (participant) => Number(participant.revenue || 0),
      { fallback: 'none' }
    );

    if (individualFund > 0 && individualAllocations.size === 0) {
      warnings.push('No participant revenue found for personal motivation allocation');
    }

    stage3AllRevenueParticipants.forEach((participant) => {
      const payout = ensureStage3Payout(participant);
      const participantRevenue = Math.max(0, Number(participant.revenue || 0));
      stage3IndividualMetricByUserId.set(participant.user_id, participantRevenue);
      payout.individual_part = Number(individualAllocations.get(participant.user_id) || 0);
      payout.total_raw = roundToKopecks(payout.team_part + payout.individual_part);
      payout.total = payout.total_raw;
    });
  } else {
    if (mode === 'team' && !useTeamIndividualSplitModel) {
      team_share = 1;
      teamFund = salaryFundPool;
    } else {
      team_share = Number(settings.team_share ?? 0.4);
      individual_share = Number(settings.individual_share ?? 0.6);

      const shareSum = team_share + individual_share;
      if (Math.abs(shareSum - 1) > 0.0001) {
        if (shareSum > 0) {
          team_share = team_share / shareSum;
          individual_share = individual_share / shareSum;
        } else {
          team_share = 1;
          individual_share = 0;
        }
      }

      teamFund = roundToKopecks(salaryFundPool * team_share);
      individualFund = roundToKopecks(salaryFundPool - teamFund);
    }

    const teamMembersMap = new Map();
    if (stage3TeamIncludeSellers) {
      activeSellersList.forEach((seller) => {
        teamMembersMap.set(seller.user_id, {
          user_id: seller.user_id,
          role: 'seller',
          name: seller.name,
          revenue: seller.revenue
        });
      });
    }
    if (!sellerOnlyScope && stage3TeamIncludeDispatchers) {
      activeDispatchersRevenueList.forEach((dispatcher) => {
        if (!teamMembersMap.has(dispatcher.user_id)) {
          teamMembersMap.set(dispatcher.user_id, {
            user_id: dispatcher.user_id,
            role: 'dispatcher',
            name: dispatcher.name,
            revenue: dispatcher.revenue
          });
        }
      });
    }

    const stage3TeamMembers = Array.from(teamMembersMap.values());
    participants = stage3TeamMembers.length;
    teamPerPerson = participants > 0 ? roundToKopecks(teamFund / participants) : 0;

    if (teamFund > 0) {
      const teamAllocations = allocateAmountByBasis(
        teamFund,
        stage3TeamMembers,
        (member) => (member.role === 'dispatcher' ? stage3DispatcherWeight : 1),
        { fallback: 'equal' }
      );

      if (teamAllocations.size > 0) {
        stage3TeamMembers.forEach((member) => {
          const payout = ensureStage3Payout(member);
          payout.team_part = Number(teamAllocations.get(member.user_id) || 0);
          payout.total_raw = roundToKopecks(payout.team_part + payout.individual_part);
          payout.total = payout.total_raw;
        });
      } else {
        warnings.push('No team weights available for motivation allocation');
      }
    }

    if (individualFund > 0) {
      const individualAllocations = allocateAmountByBasis(
        individualFund,
        stage3AllRevenueParticipants,
        (participant) => Number(participant.revenue || 0),
        { fallback: 'none' }
      );

      if (individualAllocations.size > 0) {
        stage3AllRevenueParticipants.forEach((participant) => {
          const revenueMetric = Math.max(0, Number(participant.revenue || 0));
          stage3IndividualMetricByUserId.set(participant.user_id, revenueMetric);
          const payout = ensureStage3Payout(participant);
          payout.individual_part = Number(individualAllocations.get(participant.user_id) || 0);
          payout.total_raw = roundToKopecks(payout.team_part + payout.individual_part);
          payout.total = payout.total_raw;
        });
      } else {
        warnings.push('No participant revenue available for individual motivation allocation');
      }
    }
  }

  payouts = Array.from(stage3PayoutByUserId.values()).map((payout) => {
    const stage3Metric = stage3IndividualMetricByUserId.get(payout.user_id);
    return {
      ...payout,
      ...(stage3Metric != null ? { weighted_revenue: Number(stage3Metric) } : {})
    };
  });
  
  // ====================
  // STEP 5.6: Dispatcher Daily Bonus
  // ====================
  const dispatcherDailyPercent = dispatcherPercentPerPerson;
  const activeDispatchersCount = activeDispatchersTodayList.length;
  const dispatcherDailyBonus = dispatcher_withhold_per_person;
  const dispatcherDailyBonusTotal = dispatcher_withhold_total;

  const activeDispatcherUserIds = new Set(activeDispatchersTodayList.map((dispatcher) => Number(dispatcher.user_id)));

  const payoutsWithDispatcherBonus = (Array.isArray(payouts) ? payouts : []).map((payout) => {
    const personalRevenue = personalRevenueMap.get(payout.user_id) || 0;
    const isActiveDispatcher = activeDispatcherUserIds.has(payout.user_id);
    const dispatcherBonus = isActiveDispatcher ? dispatcherDailyBonus : 0;
    const totalRaw = shiftCloseFormulaEnabled
      ? roundToKopecks(Number((payout.total_raw ?? payout.total) || 0) + dispatcherBonus)
      : roundToKopecks(Number((payout.total_raw ?? payout.total) || 0));
    return {
      ...payout,
      dispatcher_daily_bonus: dispatcherBonus,
      personal_revenue_day: personalRevenue,
      total_raw: totalRaw,
      total: totalRaw
    };
  });
  
  payouts = payoutsWithDispatcherBonus;
  
  // ====================
  // STEP 5.7: Apply rounding to payouts
  // ====================
  payouts_rounding_to_season = roundToKopecks(
    (Array.isArray(payouts) ? payouts : []).reduce((sum, p) => {
      const totalRaw = Number((p?.total_raw ?? p?.total) || 0);
      const totalRounded = roundDownTo50(totalRaw);
      return sum + Math.max(0, totalRaw - totalRounded);
    }, 0)
  );

  rounding_to_season_amount_total = roundToKopecks(
    weekly_rounding_to_season +
    viklif_rounding_to_season +
    dispatcher_withhold_rounding_to_season +
    payouts_rounding_to_season
  );
  season_withhold_amount = roundToKopecks(season_withhold_amount_base + rounding_to_season_amount_total);
  season_fund_total = roundToKopecks(season_withhold_amount + season_prepay_routed_amount);
  fundTotal_after_withhold = roundToKopecks(
    shiftCloseFormulaEnabled
      ? fundTotal - weekly_withhold_amount - viklif_withhold_amount - season_withhold_amount + payouts_rounding_to_season
      : fundTotal - weekly_withhold_amount - viklif_withhold_amount - season_withhold_amount - dispatcher_withhold_total
  );

  payouts = payouts.map(p => ({
    ...p,
    total_raw: roundToKopecks(Number((p.total_raw ?? p.total) || 0)),
    salary_rounding_to_season: roundToKopecks(
      Math.max(
        0,
        Number((p.total_raw ?? p.total) || 0) - roundDownTo50(Number((p.total_raw ?? p.total) || 0))
      )
    ),
    total: roundDownTo50(Number((p.total_raw ?? p.total) || 0)),
    individual_part: roundToKopecks(p.individual_part),
    team_part: roundToKopecks(p.team_part),
    dispatcher_daily_bonus: roundToKopecks(p.dispatcher_daily_bonus)
  }));
  
  // ====================
  // STEP 6: Build response
  // ====================
  const safeNum = (val) => Number.isFinite(Number(val)) ? Number(val) : 0;
  const safeWarnings = Array.isArray(warnings) ? warnings : [];
  
  const meaningfulPayouts = (Array.isArray(payouts) ? payouts : [])
    .filter(p => safeNum(p?.total) > 0);
  
  const payoutsWithPoints = meaningfulPayouts.map(payout => {
    const pointsEntry = pointsByUserMap.get(payout.user_id);
    return {
      ...payout,
      points_total: mode === 'adaptive' ? (pointsEntry?.points_total ?? 0) : 0,
      zone: mode === 'adaptive' ? (pointsEntry?.zone ?? null) : null
    };
  });
  
  const safeRevenueTotal = safeNum(revenue_total);
  const safeFundTotal = safeNum(fundTotal);
  const safeFundPercent = safeNum(fundPercent);
  const safeMotivationPercent = safeNum(p);
  const safeTeamPerPerson = safeNum(teamPerPerson);
  const safeFundTotalAfterWithhold = safeNum(Math.max(0, fundTotal_after_withhold));
  const safeSeasonFromRevenue = safeNum(season_withhold_amount);
  const safeSeasonFundTotal = safeNum(season_fund_total);
  const safeSeasonPrepayRoutedAmount = safeNum(season_prepay_routed_amount);
  
  const finalParticipants = meaningfulPayouts.length;
  const finalActiveSellers = meaningfulPayouts.filter(p => p?.role === 'seller').length;
  const finalActiveDispatchers = meaningfulPayouts.filter(p => p?.role === 'dispatcher').length;
  
  const data = {
    business_day: day,
    mode,
    revenue_total: safeRevenueTotal,
    earned_revenue_total,
    salary_base,
    future_trips_reserve_total: futureTripsReserveTotal,
    motivation_percent: safeMotivationPercent,
    fundPercent: safeFundPercent,
    fundTotal: safeFundTotal,
    salary_fund_total: safeFundTotalAfterWithhold,
    participants: finalParticipants,
    active_sellers: finalActiveSellers,
    active_dispatchers: finalActiveDispatchers,
    dispatcher_daily_percent: dispatcherDailyPercent,
    active_dispatchers_count: activeDispatchersCount,
    dispatcher_daily_bonus_total: dispatcherDailyBonusTotal,
    payouts: payoutsWithPoints,
    points_enabled: mode === 'adaptive',
    points_rule: mode === 'adaptive' ? 'v3_zone_at_sale_fallback_user_zone_streak_multiplier' : null,
    points_by_user: mode === 'adaptive' ? points_by_user : [],
    // Additional mode-specific fields
    team_share,
    individual_share,
    teamFund,
    individualFund,
    teamPerPerson: safeTeamPerPerson,
    // NEW: Withhold breakdown
    withhold: {
      viklif_percent: viklifPercentTotal,
      viklif_amount_raw: viklif_withhold_amount_raw,
      viklif_amount: viklif_withhold_amount,
      weekly_percent: weeklyPercentEffective,
      weekly_percent_configured: weeklyPercentTotal,
      season_percent: seasonPercentTotal,
      dispatcher_percent_total: dispatcherPercentAppliedTotal,
      dispatcher_percent_total_configured: dispatcherPercentTotal,
      dispatcher_percent_per_person: dispatcherPercentPerPerson,
      weekly_amount_raw: weekly_withhold_amount_raw,
      weekly_amount: weekly_withhold_amount,
      season_amount: safeSeasonFromRevenue,
      season_from_revenue: safeSeasonFromRevenue,
      season_fund_total: safeSeasonFundTotal,
      season_total: safeSeasonFundTotal,
      season_amount_base: season_withhold_amount_base,
      season_amount_from_rounding: rounding_to_season_amount_total,
      season_amount_from_cancelled_prepayment: safeSeasonPrepayRoutedAmount,
      season_from_prepayment_transfer: safeSeasonPrepayRoutedAmount,
      viklif_rounding_to_season_amount: viklif_rounding_to_season,
      weekly_rounding_to_season_amount: weekly_rounding_to_season,
      dispatcher_rounding_to_season_amount: dispatcher_withhold_rounding_to_season,
      payouts_rounding_to_season_amount: payouts_rounding_to_season,
      rounding_to_season_amount_total,
      dispatcher_amount_total: dispatcher_withhold_total,
      fund_total_original: safeFundTotal,
      fund_total_after_withhold: fundTotal_after_withhold
    },
    // NEW: Dispatchers with sales today
    dispatchers_today: {
      active_ids: activeDispatchersTodayIds,
      active_count: activeDispatchersTodayCount,
      active_ids_raw_count: activeDispatchersTodayIdsRaw.length,
      per_dispatcher_percent: dispatcherPercentPerPerson,
      per_dispatcher_amounts: dispatcher_withhold_amounts
    },
    // NEW: Effective settings used for withhold calculation
    settings_effective: {
      viklif_withhold_percent_total: viklifPercentTotal,
      weekly_withhold_percent_total: weeklyPercentEffective,
      weekly_withhold_percent_total_configured: weeklyPercentTotal,
      season_withhold_percent_total: seasonPercentTotal,
      dispatcher_withhold_percent_total: dispatcherPercentAppliedTotal,
      dispatcher_withhold_percent_total_configured: dispatcherPercentTotal,
      dispatcher_withhold_percent_per_person: dispatcherPercentPerPerson
    },
    settings_snapshot: { ...settings },
    // NEW: Lock status for immutability
    lock: {
      is_locked: isLocked,
      snapshot_found: snapshotFound,
      settings_source: settingsSource
    }
  };
  
  // Clean up mode-inappropriate fields
  if (mode === 'personal' && !useTeamIndividualSplitModel) {
    delete data.teamPerPerson;
    delete data.team_share;
    delete data.individual_share;
    delete data.teamFund;
    delete data.individualFund;
  } else if (mode === 'team' && !useTeamIndividualSplitModel) {
    delete data.team_share;
    delete data.individual_share;
    delete data.teamFund;
    delete data.individualFund;
  }
  
  return { data, warnings: safeWarnings, error: null };
}

export default { calcMotivationDay, OWNER_SETTINGS_DEFAULTS };
