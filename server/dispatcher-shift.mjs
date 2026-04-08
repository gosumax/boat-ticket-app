import express from 'express';
import db from './db.js';
import {
  allTripsFinished,
  calcFutureTripsReserveByPaymentDay,
} from './dispatcher-shift-ledger.mjs';
import { resolveOwnerSettings } from './owner-settings.mjs';
import { updateSellerMotivationState, getStreakMultiplier, getSellerState } from './seller-motivation-state.mjs';
import { runSellerCalibrationEngineForDay } from './motivation/seller-calibration-engine.mjs';
import { saveDayStats, updateSeasonStatsFromDay } from './season-stats.mjs';
import {
  buildUnifiedShiftClosureSnapshot,
  persistUnifiedShiftClosureSnapshot,
} from './shift-closure-backfill.mjs';
import {
  ensureCanonicalShiftClosureColumns,
  findCanonicalShiftClosureRow,
  listLegacyShiftClosureBusinessDays,
} from './shift-closure-schema.mjs';

const router = express.Router();

function getExistingShiftClosureSnapshot(businessDay) {
  const day = String(businessDay || '').trim();
  if (!day) return null;
  return findCanonicalShiftClosureRow(db, day, {
    columns: ['id', 'business_day', 'closed_at', 'closed_by', 'calculation_json', 'cashbox_json'],
  });
}

// Helper: get local business day
function getLocalBusinessDay() {
  return db.prepare("SELECT DATE('now','localtime') AS d").get()?.d;
}

// Helper: check if shift is closed for business_day
function isShiftClosed(businessDay) {
  try {
    const day = String(businessDay || '').trim();
    return Boolean(getExistingShiftClosureSnapshot(day)) || listLegacyShiftClosureBusinessDays(db).includes(day);
  } catch {
    return false;  // Table doesn't exist or error
  }
}

function hasColumn(tableName, columnName) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${tableName})`).all().map(r => r.name);
    return cols.includes(columnName);
  } catch {
    return false;
  }
}

function calcFutureTripsReserveForBusinessDay(businessDay) {
  try {
    const ledgerCols = new Set(db.prepare(`PRAGMA table_info(money_ledger)`).all().map((r) => r.name));
    return calcFutureTripsReserveByPaymentDay({
      businessDay,
      ledgerCols,
      hasLedger: ledgerCols.size > 0,
      ledgerHasBDay: ledgerCols.has('business_day'),
    });
  } catch {
    return { cash: 0, card: 0, total: 0, unresolvedTripDayCount: 0 };
  }
}

function getFundsWithholdCashToday(withhold) {
  if (!withhold) return 0;
  const seasonFromRevenue = Number(
    withhold.season_from_revenue ??
    withhold.season_amount ??
    0
  );
  const dispatcherAmount = Number(withhold.dispatcher_amount_total || 0);
  return (
    Number(withhold.weekly_amount || 0) +
    seasonFromRevenue +
    dispatcherAmount
  );
}

function getShiftCloseMotivationOptions(user) {
  const role = String(user?.role || '').toLowerCase();
  return {
    profile: 'dispatcher_shift_close',
    dispatcherUserId: role === 'dispatcher' ? Number(user?.id || 0) : null,
  };
}

function applySnapshotPayoutFields(row, payout) {
  const base = { ...row };
  if (!payout) {
    return {
      ...base,
      salary_due: Number(base.salary_due || 0),
      salary_due_total: Number(base.salary_due_total || base.salary_due || 0),
      salary_accrued: Number(base.salary_accrued || base.salary_due_total || base.salary_due || 0),
      team_part: Number(base.team_part || 0),
      individual_part: Number(base.individual_part || 0),
      dispatcher_daily_bonus: Number(base.dispatcher_daily_bonus || 0),
      total_raw: Number(base.total_raw || 0),
      salary_rounding_to_season: Number(base.salary_rounding_to_season || 0),
      personal_revenue_day: Number(base.personal_revenue_day || base.collected_total || 0),
    };
  }

  return {
    ...base,
    salary_due: Number(payout.total || 0),
    salary_due_total: Number(payout.total || 0),
    salary_accrued: Number(payout.total || 0),
    team_part: Number(payout.team_part || 0),
    individual_part: Number(payout.individual_part || 0),
    dispatcher_daily_bonus: Number(payout.dispatcher_daily_bonus || 0),
    total_raw: Number(payout.total_raw || payout.total || 0),
    salary_rounding_to_season: Number(payout.salary_rounding_to_season || 0),
    personal_revenue_day: Number(payout.personal_revenue_day || payout.revenue || base.personal_revenue_day || base.collected_total || 0),
  };
}

function createSnapshotParticipantRowFromPayout(payout) {
  const userId = Number(payout?.user_id || 0);
  const role = String(payout?.role || '').toLowerCase() === 'dispatcher' ? 'dispatcher' : 'seller';
  const personalRevenueDay = Number(payout?.personal_revenue_day || payout?.revenue || 0);
  const participantName = String(
    payout?.name ||
    (role === 'dispatcher' ? `Dispatcher #${userId}` : `Seller #${userId}`)
  );

  return applySnapshotPayoutFields({
    seller_id: userId,
    seller_name: participantName,
    name: participantName,
    role,
    accepted: personalRevenueDay,
    deposited: 0,
    balance: 0,
    cash_balance: 0,
    terminal_debt: 0,
    terminal_due_to_owner: 0,
    status: 'CLOSED',
    collected_total: personalRevenueDay,
    collected_cash: 0,
    collected_card: 0,
    deposit_cash: 0,
    deposit_card: 0,
    cash_due_to_owner: 0,
    personal_revenue_day: personalRevenueDay,
  }, payout);
}

// Helper: get open trips count for error message
function getOpenTripsCountForError(businessDay) {
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM generated_slots
      WHERE is_active = 1
        AND trip_date = ?
        AND COALESCE(is_completed, 0) = 0
        AND COALESCE(status, 'ACTIVE') != 'COMPLETED'
    `).get(businessDay);
    return Number(row?.cnt || 0);
  } catch {
    return 0;
  }
}

// Allowed deposit types (strict whitelist)
const ALLOWED_DEPOSIT_TYPES = [
  'DEPOSIT_TO_OWNER_CASH',
  'DEPOSIT_TO_OWNER_CARD',
  'SALARY_PAYOUT_CASH',
  'SALARY_PAYOUT_CARD',
];

// GET /api/dispatcher/shift/diagnose
// Diagnostic endpoint for shift close status (read-only)
router.get('/diagnose', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Требуется авторизация' });
    }

    const businessDay = req.query?.business_day || getLocalBusinessDay();

    // Check if shift is closed
    const closure = getExistingShiftClosureSnapshot(businessDay);

    const is_closed = !!closure;

    // Trip status
    const open_trips_count = getOpenTripsCountForError(businessDay);
    const all_trips_finished = open_trips_count === 0;

    // Parse cashbox from closure if exists
    let cashboxData = null;
    let warnings = [];
    let cash_discrepancy = null;
    let has_cashbox_discrepancy = false;
    let has_warnings = false;

    if (closure?.cashbox_json) {
      try {
        cashboxData = JSON.parse(closure.cashbox_json);
        warnings = cashboxData.warnings || [];
        cash_discrepancy = cashboxData.cash_discrepancy ?? null;
        has_cashbox_discrepancy = cash_discrepancy !== null && cash_discrepancy !== 0;
        has_warnings = warnings.length > 0;
      } catch {}
    }

    // Ledger stats
    const ledgerStats = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN 1 ELSE 0 END), 0) AS sale_count,
        COALESCE(SUM(CASE WHEN type = 'SALE_CANCEL_REVERSE' THEN 1 ELSE 0 END), 0) AS refund_count,
        COALESCE(SUM(CASE WHEN type LIKE 'DEPOSIT_TO_OWNER%' THEN 1 ELSE 0 END), 0) AS deposit_count,
        COALESCE(SUM(CASE WHEN type LIKE 'SALARY_PAYOUT%' THEN 1 ELSE 0 END), 0) AS salary_count
      FROM money_ledger
      WHERE business_day = ?
        AND status = 'POSTED'
    `).get(businessDay);

    const ledger_stats = {
      sale_count: Number(ledgerStats?.sale_count || 0),
      refund_count: Number(ledgerStats?.refund_count || 0),
      deposit_count: Number(ledgerStats?.deposit_count || 0),
      salary_count: Number(ledgerStats?.salary_count || 0),
    };

    // Build notes
    const notes = [];
    if (is_closed) notes.push('SHIFT_CLOSED');
    if (open_trips_count > 0) notes.push('OPEN_TRIPS');
    if (has_cashbox_discrepancy) notes.push('CASH_DISCREPANCY');
    if (ledger_stats.sale_count === 0) notes.push('NO_SALES');

    res.json({
      ok: true,
      business_day: businessDay,
      is_closed,
      all_trips_finished,
      open_trips_count,
      has_cashbox_discrepancy,
      cash_discrepancy,
      has_warnings,
      warnings,
      ledger_stats,
      notes,
    });
  } catch (e) {
    console.error('[DISPATCHER SHIFT DIAGNOSE ERROR]', e);
    res.status(500).json({ ok: false, error: 'Ошибка сервера' });
  }
});

// POST /api/dispatcher/shift/deposit
// Auth & role check applied at mount level in index.js
router.post('/deposit', (req, res) => {
  try {
    const { type, amount, seller_id, business_day } = req.body;

    // Strict validation: amount must be positive number
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({ ok: false, error: 'Сумма должна быть положительным числом' });
    }

    // Strict validation: type must be in whitelist
    if (!type || !ALLOWED_DEPOSIT_TYPES.includes(type)) {
      return res.status(400).json({ ok: false, error: 'Недопустимый тип операции' });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Требуется авторизация' });
    }

    // Server-calculated business_day (ignore client input if any)
    const businessDay = business_day || getLocalBusinessDay();

    // LOCK: Check if shift already closed
    if (isShiftClosed(businessDay)) {
      return res.status(409).json({
        ok: false,
        code: 'SHIFT_CLOSED',
        business_day: businessDay,
        message: 'Shift is already closed'
      });
    }

    // GATE: Check if all trips finished before allowing deposit/salary
    if (!allTripsFinished(businessDay)) {
      const openTripsCount = getOpenTripsCountForError(businessDay);
      return res.status(400).json({
        ok: false,
        error: 'Нельзя провести операцию: есть незавершённые рейсы.',
        open_trips_count: openTripsCount,
      });
    }

    // Protection: check for recent duplicate deposit (same user, type, business_day within last 60 seconds)
    const recentDuplicate = db.prepare(`
      SELECT 1 FROM money_ledger
      WHERE seller_id = ?
        AND type = ?
        AND business_day = ?
        AND kind = 'DISPATCHER_SHIFT'
        AND status = 'POSTED'
        AND datetime(event_time) >= datetime('now', '-60 seconds', 'localtime')
      LIMIT 1
    `).get(userId, type, businessDay);

    if (recentDuplicate) {
      return res.status(409).json({ ok: false, error: 'Дубликат операции: такая запись уже создана менее минуты назад' });
    }

    // Determine seller_id for ledger entry
    const ledgerSellerId = seller_id || userId;

    // IMPORTANT: shift-ledger summary filters by business_day, so we must fill it here
    db.prepare(`
      INSERT INTO money_ledger (
        kind,
        type,
        amount,
        seller_id,
        status,
        event_time,
        business_day,
        trip_day
      ) VALUES (
        'DISPATCHER_SHIFT',
        ?,
        ?,
        ?,
        'POSTED',
        datetime('now','localtime'),
        ?,
        ?
      )
    `).run(type, numAmount, ledgerSellerId, businessDay, businessDay);

    res.json({ ok: true, business_day: businessDay, type, amount: numAmount });
  } catch (e) {
    console.error('[DISPATCHER SHIFT DEPOSIT ERROR]', e);
    res.status(500).json({ ok: false, error: 'Ошибка сервера' });
  }
});

// POST /api/dispatcher/shift/close
// Close the shift for business_day - creates immutable snapshot
router.post('/close', (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Требуется авторизация' });
    }

    const businessDay = req.body?.business_day || getLocalBusinessDay();
    ensureCanonicalShiftClosureColumns(db);

    // Check if already closed - return idempotent success
    const existingClosure = getExistingShiftClosureSnapshot(businessDay);
    
    if (existingClosure) {
      let existingBreakdown = null;
      try {
        if (existingClosure.calculation_json) {
          existingBreakdown = JSON.parse(existingClosure.calculation_json);
        }
      } catch {}

      return res.json({
        ok: true,
        business_day: businessDay,
        is_closed: true,
        source: 'snapshot',
        closed_at: existingClosure.closed_at,
        closed_by: existingClosure.closed_by,
        shift_close_breakdown: existingBreakdown,
        weekly_fund: Number(existingBreakdown?.totals?.weekly_fund ?? 0),
        season_fund_total: Number(existingBreakdown?.totals?.season_fund_total ?? 0),
        final_salary_total: Number(existingBreakdown?.totals?.final_salary_total ?? 0),
        salary_to_pay: Number(existingBreakdown?.totals?.final_salary_total ?? 0),
        owner_cash_today: Number(existingBreakdown?.totals?.owner_cash_today ?? 0),
      });
    }

    // GATE: Check if all trips finished before closing shift
    if (!allTripsFinished(businessDay)) {
      const openTripsCount = getOpenTripsCountForError(businessDay);
      return res.status(400).json({
        ok: false,
        error: 'Нельзя закрыть смену: есть незавершённые рейсы.',
        open_trips_count: openTripsCount,
      });
    }

    const canonicalSnapshot = buildUnifiedShiftClosureSnapshot(db, {
      businessDay,
      closedBy: userId,
      dispatcherUserId: userId,
      snapshotSource: 'snapshot',
    });
    persistUnifiedShiftClosureSnapshot(db, canonicalSnapshot);

    const canonicalBreakdown = canonicalSnapshot.shift_close_breakdown || null;
    const canonicalCashbox = canonicalSnapshot.cashbox || {};
    const canonicalClosedAt = canonicalSnapshot.closed_at;

    console.log(
      `[SHIFT_CLOSE] business_day=${businessDay} closed_by=${userId} total_revenue=${Number(canonicalSnapshot.total_revenue || 0)} collected=${Number(canonicalSnapshot.collected_total || 0)}`
    );

    const canonicalDayLocked = db.prepare(`
      SELECT 1 FROM money_ledger
      WHERE business_day = ? AND kind = 'FUND' AND type IN ('WITHHOLD_VIKLIF', 'WITHHOLD_WEEKLY', 'WITHHOLD_SEASON') AND status = 'POSTED'
      LIMIT 1
    `).get(businessDay);

    if (canonicalDayLocked) {
      console.log(`[SHIFT_CLOSE] Day ${businessDay} is already locked, skipping withhold recalculation`);
    } else {
      try {
        const canonicalViklifAmount = Number(canonicalSnapshot.motivation_withhold?.viklif_amount || 0);
        const canonicalWeeklyAmount = Number(canonicalSnapshot.motivation_withhold?.weekly_amount || 0);
        const canonicalSeasonAmount = Number(canonicalSnapshot.motivation_withhold?.season_amount || 0);
        const canonicalNow = new Date().toISOString();

        const insertCanonicalWithhold = db.transaction(() => {
          const canonicalExistingViklif = db.prepare(`
            SELECT 1 FROM money_ledger
            WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_VIKLIF' AND status = 'POSTED'
            LIMIT 1
          `).get(businessDay);
          if (!canonicalExistingViklif && canonicalViklifAmount > 0) {
            db.prepare(`
              INSERT INTO money_ledger (kind, type, method, amount, status, seller_id, business_day, event_time, decision_final)
              VALUES ('FUND', 'WITHHOLD_VIKLIF', 'INTERNAL', ?, 'POSTED', NULL, ?, ?, 1)
            `).run(canonicalViklifAmount, businessDay, canonicalNow);
          }

          const canonicalExistingWeekly = db.prepare(`
            SELECT 1 FROM money_ledger
            WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
            LIMIT 1
          `).get(businessDay);
          if (!canonicalExistingWeekly && canonicalWeeklyAmount > 0) {
            db.prepare(`
              INSERT INTO money_ledger (kind, type, method, amount, status, seller_id, business_day, event_time, decision_final)
              VALUES ('FUND', 'WITHHOLD_WEEKLY', 'INTERNAL', ?, 'POSTED', NULL, ?, ?, 1)
            `).run(canonicalWeeklyAmount, businessDay, canonicalNow);
          }

          const canonicalExistingSeason = db.prepare(`
            SELECT 1 FROM money_ledger
            WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
            LIMIT 1
          `).get(businessDay);
          if (!canonicalExistingSeason && canonicalSeasonAmount > 0) {
            db.prepare(`
              INSERT INTO money_ledger (kind, type, method, amount, status, seller_id, business_day, event_time, decision_final)
              VALUES ('FUND', 'WITHHOLD_SEASON', 'INTERNAL', ?, 'POSTED', NULL, ?, ?, 1)
            `).run(canonicalSeasonAmount, businessDay, canonicalNow);
          }
        });

        insertCanonicalWithhold();
      } catch (withholdError) {
        console.error('[SHIFT_CLOSE_WITHHOLD_LEDGER_ERROR]', withholdError);
      }
    }

    try {
      updateSellerMotivationState(businessDay);
    } catch (motivationError) {
      console.error('[SHIFT_CLOSE_MOTIVATION_STATE_ERROR]', motivationError);
    }

    try {
      runSellerCalibrationEngineForDay(db, businessDay);
    } catch (calibrationError) {
      console.error('[SHIFT_CLOSE_SELLER_CALIBRATION_ENGINE_ERROR]', calibrationError);
    }

    try {
      const canonicalSavedSettings = resolveOwnerSettings(db);
      const canonicalKSpeed = Number(canonicalSavedSettings.k_speed ?? 1.2);
      const canonicalKCruise = Number(canonicalSavedSettings.k_cruise ?? 3.0);
      const canonicalKZoneHedgehog = Number(canonicalSavedSettings.k_zone_hedgehog ?? 1.3);
      const canonicalKZoneCenter = Number(canonicalSavedSettings.k_zone_center ?? 1.0);
      const canonicalKZoneSanatorium = Number(canonicalSavedSettings.k_zone_sanatorium ?? 0.8);
      const canonicalKZoneStationary = Number(canonicalSavedSettings.k_zone_stationary ?? 0.7);
      const canonicalKBananaHedgehog = Number(canonicalSavedSettings.k_banana_hedgehog ?? 2.7);
      const canonicalKBananaCenter = Number(canonicalSavedSettings.k_banana_center ?? 2.2);
      const canonicalKBananaSanatorium = Number(canonicalSavedSettings.k_banana_sanatorium ?? 1.2);
      const canonicalKBananaStationary = Number(canonicalSavedSettings.k_banana_stationary ?? 1.0);

      const getCanonicalZoneK = (zone) => {
        if (zone === 'hedgehog') return canonicalKZoneHedgehog;
        if (zone === 'center') return canonicalKZoneCenter;
        if (zone === 'sanatorium') return canonicalKZoneSanatorium;
        if (zone === 'stationary') return canonicalKZoneStationary;
        return 1.0;
      };

      const getCanonicalBananaK = (zone) => {
        if (zone === 'hedgehog') return canonicalKBananaHedgehog;
        if (zone === 'center') return canonicalKBananaCenter;
        if (zone === 'sanatorium') return canonicalKBananaSanatorium;
        if (zone === 'stationary') return canonicalKBananaStationary;
        return 1.0;
      };

      const canonicalSellerZones = db.prepare(`SELECT id, zone FROM users WHERE role = 'seller'`).all();
      const canonicalSellerZoneMap = new Map((canonicalSellerZones || []).map((row) => [Number(row.id), row.zone]));
      const canonicalRevenueBySellerAndType = db.prepare(`
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
          AND ml.kind = 'SELLER_SHIFT'
          AND DATE(ml.business_day) = ?
          AND ml.seller_id IS NOT NULL
          AND ml.seller_id > 0
          AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
        GROUP BY ml.seller_id, COALESCE(b.type, gb.type), p.zone_at_sale
      `).all(businessDay);
      const canonicalSellerStatsMap = new Map();

      for (const row of (canonicalRevenueBySellerAndType || [])) {
        const sellerId = Number(row.seller_id);
        const boatType = row.boat_type || null;
        const zoneAtSale = row.zone_at_sale || null;
        const revenueGross = Number(row.revenue_gross || 0);
        const refunds = Number(row.refunds || 0);
        const revenueNet = Math.max(0, revenueGross - refunds);
        if (!boatType || !['speed', 'cruise', 'banana'].includes(boatType)) continue;

        let entry = canonicalSellerStatsMap.get(sellerId);
        if (!entry) {
          const sellerZone = canonicalSellerZoneMap.get(sellerId) || null;
          const state = getSellerState(sellerId);
          const streakDays = state?.calibrated ? (state.streak_days || 0) : 0;
          const kStreak = getStreakMultiplier(streakDays);
          entry = { seller_id: sellerId, revenue_day: 0, points_base: 0, zone: sellerZone, k_streak: kStreak };
          canonicalSellerStatsMap.set(sellerId, entry);
        }

        entry.revenue_day += revenueNet;
        const effectiveZone = zoneAtSale || entry.zone;
        const revenueInK = revenueNet / 1000;

        if (boatType === 'speed') {
          entry.points_base += revenueInK * canonicalKSpeed * getCanonicalZoneK(effectiveZone);
        } else if (boatType === 'cruise') {
          entry.points_base += revenueInK * canonicalKCruise * getCanonicalZoneK(effectiveZone);
        } else if (boatType === 'banana') {
          entry.points_base += revenueInK * getCanonicalBananaK(effectiveZone);
        }
      }

      const canonicalSeasonRows = Array.from(canonicalSellerStatsMap.values()).map((entry) => ({
        seller_id: entry.seller_id,
        revenue_day: entry.revenue_day,
        points_day_total: Math.round(entry.points_base * entry.k_streak * 100) / 100,
      }));

      saveDayStats(db, businessDay, canonicalSeasonRows);
      updateSeasonStatsFromDay(db, businessDay);
    } catch (seasonError) {
      console.error('[SHIFT_CLOSE_SEASON_STATS_ERROR]', seasonError);
    }

    return res.json({
      ok: true,
      business_day: businessDay,
      closed: true,
      is_closed: true,
      source: 'snapshot',
      closed_at: canonicalClosedAt,
      closed_by: userId,
      totals: {
        total_revenue: Number(canonicalSnapshot.total_revenue || 0),
        collected_total: Number(canonicalSnapshot.collected_total || 0),
        collected_cash: Number(canonicalSnapshot.collected_cash || 0),
        collected_card: Number(canonicalSnapshot.collected_card || 0),
        refund_total: Number(canonicalSnapshot.refund_total || 0),
        net_total: Number(canonicalSnapshot.net_total || 0),
        deposit_cash: Number(canonicalSnapshot.deposit_cash || 0),
        deposit_card: Number(canonicalSnapshot.deposit_card || 0),
      },
      cashbox: {
        cash_in_cashbox: Number(canonicalCashbox.cash_in_cashbox || 0),
        expected_sellers_cash_due: Number(canonicalCashbox.expected_sellers_cash_due || 0),
        deposits_cash_total: Number(canonicalCashbox.deposits_cash_total || canonicalSnapshot.deposit_cash || 0),
        salary_paid_cash: Number(canonicalCashbox.salary_paid_cash || canonicalSnapshot.salary_paid_cash || 0),
        cash_discrepancy: Number(canonicalCashbox.cash_discrepancy || 0),
        warnings: Array.isArray(canonicalCashbox.warnings) ? canonicalCashbox.warnings : [],
        future_trips_reserve_cash: Number(canonicalBreakdown?.totals?.reserve_cash ?? canonicalCashbox.future_trips_reserve_cash ?? 0),
        future_trips_reserve_card: Number(canonicalBreakdown?.totals?.reserve_card ?? canonicalCashbox.future_trips_reserve_card ?? 0),
        future_trips_reserve_total: Number(canonicalBreakdown?.totals?.reserve_total ?? canonicalCashbox.future_trips_reserve_total ?? 0),
        salary_base: Number(canonicalBreakdown?.totals?.salary_base ?? canonicalCashbox.salary_base ?? 0),
        funds_withhold_cash_today: Number(canonicalBreakdown?.totals?.funds_withhold_cash_today ?? canonicalCashbox.funds_withhold_cash_today ?? 0),
        owner_cash_available_after_future_reserve_cash: Number(
          canonicalBreakdown?.totals?.owner_cash_after_reserve ??
          canonicalCashbox.owner_cash_available_after_future_reserve_cash ??
          0
        ),
        owner_cash_available_after_reserve_and_funds_cash: Number(
          canonicalCashbox.owner_cash_available_after_reserve_and_funds_cash ??
          canonicalBreakdown?.totals?.owner_cash_today ??
          0
        ),
        owner_handover_cash_final: Number(
          canonicalBreakdown?.totals?.owner_cash_today ??
          canonicalCashbox.owner_handover_cash_final ??
          0
        ),
      },
      cash_in_cashbox: Number(canonicalCashbox.cash_in_cashbox || 0),
      expected_sellers_cash_due: Number(canonicalCashbox.expected_sellers_cash_due || 0),
      cash_discrepancy: Number(canonicalCashbox.cash_discrepancy || 0),
      warnings: Array.isArray(canonicalCashbox.warnings) ? canonicalCashbox.warnings : [],
      future_trips_reserve_cash: Number(canonicalBreakdown?.totals?.reserve_cash ?? canonicalCashbox.future_trips_reserve_cash ?? 0),
      future_trips_reserve_card: Number(canonicalBreakdown?.totals?.reserve_card ?? canonicalCashbox.future_trips_reserve_card ?? 0),
      future_trips_reserve_total: Number(canonicalBreakdown?.totals?.reserve_total ?? canonicalCashbox.future_trips_reserve_total ?? 0),
      salary_base: Number(canonicalBreakdown?.totals?.salary_base ?? canonicalCashbox.salary_base ?? 0),
      funds_withhold_cash_today: Number(canonicalBreakdown?.totals?.funds_withhold_cash_today ?? canonicalCashbox.funds_withhold_cash_today ?? 0),
      owner_cash_available_after_future_reserve_cash: Number(
        canonicalBreakdown?.totals?.owner_cash_after_reserve ??
        canonicalCashbox.owner_cash_available_after_future_reserve_cash ??
        0
      ),
      owner_cash_available_after_reserve_and_funds_cash: Number(
        canonicalCashbox.owner_cash_available_after_reserve_and_funds_cash ??
        canonicalBreakdown?.totals?.owner_cash_today ??
        0
      ),
      owner_handover_cash_final: Number(
        canonicalBreakdown?.totals?.owner_cash_today ??
        canonicalCashbox.owner_handover_cash_final ??
        0
      ),
      owner_cash_today: Number(canonicalBreakdown?.totals?.owner_cash_today ?? canonicalSnapshot.owner_cash_today ?? 0),
      weekly_fund: Number(canonicalBreakdown?.totals?.weekly_fund ?? canonicalSnapshot.weekly_fund ?? 0),
      season_fund_total: Number(canonicalBreakdown?.totals?.season_fund_total ?? canonicalSnapshot.season_fund_total ?? 0),
      final_salary_total: Number(canonicalBreakdown?.totals?.final_salary_total ?? canonicalSnapshot.final_salary_total ?? 0),
      salary_to_pay: Number(canonicalBreakdown?.totals?.final_salary_total ?? canonicalSnapshot.salary_to_pay ?? 0),
      motivation_withhold: canonicalBreakdown?.withhold ?? canonicalSnapshot.motivation_withhold ?? null,
      shift_close_breakdown: canonicalBreakdown,
    });

    // Get live summary values (same logic as /summary endpoint)
    // We need to duplicate the calculation here to get all values in one transaction
    const summaryRow = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) AS total_revenue
      FROM sales_transactions_canonical
      WHERE business_day = ? AND status = 'VALID'
    `).get(businessDay);
    const totalRevenue = Number(summaryRow?.total_revenue || 0);

    const ledgerCols = db.prepare(`PRAGMA table_info(money_ledger)`).all().map(r => r.name);
    const liveUiTotals = calcLiveUiLedgerTotals(businessDay);
    const collectedTotal = Number(liveUiTotals?.collected_total || 0);
    const collectedCash = Number(liveUiTotals?.collected_cash || 0);
    const collectedCard = Number(liveUiTotals?.collected_card || 0);
    const refundTotal = Number(liveUiTotals?.refund_total || 0);
    const refundCash = Number(liveUiTotals?.refund_cash || 0);
    const refundCard = Number(liveUiTotals?.refund_card || 0);

    // Net metrics
    const netCash = collectedCash - refundCash;
    const netCard = collectedCard - refundCard;
    const netTotal = netCash + netCard;

    // Deposits to owner (dispatcher shift kind)
    const depositRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'DEPOSIT_TO_OWNER_CASH' THEN amount ELSE 0 END), 0) AS deposit_cash,
        COALESCE(SUM(CASE WHEN type = 'DEPOSIT_TO_OWNER_CARD' THEN amount ELSE 0 END), 0) AS deposit_card
      FROM money_ledger
      WHERE status = 'POSTED'
        AND kind = 'DISPATCHER_SHIFT'
        AND type LIKE 'DEPOSIT_TO_OWNER%'
        AND business_day = ?
    `).get(businessDay);
    const depositCash = Number(depositRow?.deposit_cash || 0);
    const depositCard = Number(depositRow?.deposit_card || 0);

    // Sellers/dispatchers data for snapshot UI ("По продавцам")
    const mixedCashExpr = ledgerCols.includes('cash_amount') ? 'COALESCE(ml.cash_amount, 0)' : 'COALESCE(p.payment_cash_amount, 0)';
    const mixedCardExpr = ledgerCols.includes('card_amount') ? 'COALESCE(ml.card_amount, 0)' : 'COALESCE(p.payment_card_amount, 0)';
    const sellersRows = db.prepare(`
      SELECT
        ml.seller_id,
        COALESCE(SUM(CASE
          WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED')
          THEN ml.amount ELSE 0 END), 0) AS collected_total,
        COALESCE(SUM(CASE
          WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH') THEN ml.amount
          WHEN ml.type IN ('SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_MIXED') THEN ${mixedCashExpr}
          WHEN ml.type = 'SALE_CANCEL_REVERSE' AND ml.method = 'CASH' THEN ml.amount
          WHEN ml.type = 'SALE_CANCEL_REVERSE' AND ml.method = 'MIXED' THEN -${mixedCashExpr}
          ELSE 0 END), 0) AS collected_cash,
        COALESCE(SUM(CASE
          WHEN ml.type IN ('SALE_PREPAYMENT_CARD','SALE_ACCEPTED_CARD') THEN ml.amount
          WHEN ml.type IN ('SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_MIXED') THEN ${mixedCardExpr}
          WHEN ml.type = 'SALE_CANCEL_REVERSE' AND ml.method = 'CARD' THEN ml.amount
          WHEN ml.type = 'SALE_CANCEL_REVERSE' AND ml.method = 'MIXED' THEN -${mixedCardExpr}
          ELSE 0 END), 0) AS collected_card,
        COALESCE(SUM(CASE
          WHEN ml.type = 'DEPOSIT_TO_OWNER_CASH' THEN ml.amount
          WHEN ml.type LIKE 'DEPOSIT_TO_OWNER%' AND ml.method = 'CASH' THEN ml.amount
          ELSE 0 END), 0) AS deposit_cash,
        COALESCE(SUM(CASE
          WHEN ml.type = 'DEPOSIT_TO_OWNER_CARD' THEN ml.amount
          WHEN ml.type LIKE 'DEPOSIT_TO_OWNER%' AND ml.method = 'CARD' THEN ml.amount
          ELSE 0 END), 0) AS deposit_card
      FROM money_ledger ml
      LEFT JOIN presales p ON p.id = ml.presale_id
      JOIN users u ON u.id = ml.seller_id AND u.role = 'seller'
      WHERE ml.business_day = ?
        AND ml.status = 'POSTED'
        AND ml.seller_id IS NOT NULL
        AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
      GROUP BY ml.seller_id
    `).all(businessDay);
    
    const sellersLegacy = (sellersRows || []).map(r => {
      const collectedCashByUser = Number(r.collected_cash || 0);
      const collectedCardByUser = Number(r.collected_card || 0);
      const depositCashByUser = Number(r.deposit_cash || 0);
      const depositCardByUser = Number(r.deposit_card || 0);
      const cashDue = collectedCashByUser - depositCashByUser;
      const terminalDue = collectedCardByUser - depositCardByUser;
      const balance = cashDue + terminalDue;
      const status = balance === 0 ? 'CLOSED' : balance > 0 ? 'DEBT' : 'OVERPAID';

      let sellerName = `Продавец #${r.seller_id}`;
            try {
        const userRow = db.prepare('SELECT username FROM users WHERE id = ?').get(r.seller_id);
        if (userRow?.username) {
          sellerName = userRow.username;
        }
      } catch {}

      return {
        seller_id: Number(r.seller_id || 0),
        seller_name: sellerName,
        name: sellerName,
        role: 'seller',
        accepted: Number(r.collected_total || 0),
        deposited: depositCashByUser + depositCardByUser,
        balance,
        cash_balance: cashDue,
        terminal_debt: terminalDue,
        terminal_due_to_owner: terminalDue,
        status,
        collected_total: Number(r.collected_total || 0),
        collected_cash: collectedCashByUser,
        collected_card: collectedCardByUser,
        deposit_cash: depositCashByUser,
        deposit_card: depositCardByUser,
        cash_due_to_owner: cashDue
      };
    });

    const sellers = (Array.isArray(liveUiTotals?.sellers) ? liveUiTotals.sellers : []).map((seller) => ({
      ...seller,
    }));

    // Salary payouts from money_ledger (DISPATCHER_SHIFT)
    const salaryPaidRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'SALARY_PAYOUT_CASH' THEN amount ELSE 0 END), 0) AS salary_paid_cash,
        COALESCE(SUM(CASE WHEN type = 'SALARY_PAYOUT_CARD' THEN amount ELSE 0 END), 0) AS salary_paid_card
      FROM money_ledger
      WHERE status = 'POSTED'
        AND kind = 'DISPATCHER_SHIFT'
        AND type IN ('SALARY_PAYOUT_CASH', 'SALARY_PAYOUT_CARD')
        AND business_day = ?
    `).get(businessDay);
    const salaryPaidCash = Number(salaryPaidRow?.salary_paid_cash || 0);
    const salaryPaidCard = Number(salaryPaidRow?.salary_paid_card || 0);
    const salaryPaidTotal = salaryPaidCash + salaryPaidCard;
    
    // Salary due from motivation engine + per-seller breakdown
    let salaryDue = 0;
    let salaryBase = Math.max(0, netTotal);
    let fundsWithholdCashToday = 0;
    let payoutsByUserId = new Map();
    let motivationData = null;
    let motivationWithhold = null;
    try {
      const motivationResult = calcMotivationDay(
        db,
        businessDay,
        getShiftCloseMotivationOptions(req.user)
      );
      if (motivationResult?.data?.payouts) {
        for (const p of motivationResult.data.payouts) {
          payoutsByUserId.set(Number(p.user_id), p);
        }
        salaryDue = motivationResult.data.payouts.reduce((sum, p) => sum + Number(p.total || 0), 0);
      }
      if (motivationResult?.data) {
        motivationData = motivationResult.data;
        motivationWithhold = motivationResult.data.withhold || null;
        salaryBase = Number(motivationResult.data.salary_base ?? salaryBase);
        fundsWithholdCashToday = getFundsWithholdCashToday(motivationResult.data.withhold);
      }
    } catch (e) {
      salaryDue = 0;
    }
    
    // Add per-participant salary fields to sellers_json and persist dispatcher rows too.
    for (let index = 0; index < sellers.length; index += 1) {
      const seller = sellers[index];
      const sid = Number(seller.seller_id);
      sellers[index] = applySnapshotPayoutFields(seller, payoutsByUserId.get(sid));
    }
    for (const [userId, payout] of payoutsByUserId.entries()) {
      const exists = sellers.some((seller) => Number(seller?.seller_id || 0) === Number(userId));
      if (!exists) {
        sellers.push(createSnapshotParticipantRowFromPayout(payout));
      }
    }

    // --- CASHBOX SANITY CHECK ---
    // Ensure snapshot JSON columns exist
    ensureShiftClosureJsonColumns();

    // Cash in cashbox = net_cash - deposit_cash - salary_paid_cash
    const cash_in_cashbox = netCash - depositCash - salaryPaidCash;

    // Expected sellers cash due = sum of positive cash_due_to_owner
    const expected_sellers_cash_due = sellers.reduce((sum, s) => {
      const due = Math.max(0, Number(s.cash_due_to_owner ?? s.cash_balance ?? s.balance ?? 0));
      return sum + due;
    }, 0);

    const sellers_debt_total = sellers.reduce((sum, s) => {
      const cashDue = Math.max(0, Number(s.cash_due_to_owner ?? s.cash_balance ?? s.balance ?? 0));
      const terminalDue = Math.max(0, Number(s.terminal_due_to_owner ?? s.terminal_debt ?? 0));
      return sum + cashDue + terminalDue;
    }, 0);

    const futureTripsReserve = calcFutureTripsReserveForBusinessDay(businessDay);
    const owner_cash_available = netTotal - salaryDue - sellers_debt_total;
    const ownerCashMetrics = calcShiftOwnerCashMetrics({
      netCash,
      salaryDueTotal: salaryDue,
      salaryPaidCash,
      salaryPaidTotal,
      sellers,
      futureTripsReserveCash: Number(futureTripsReserve.cash || 0),
      fundsWithholdCashToday,
    });
    const owner_cash_available_after_future_reserve_cash = ownerCashMetrics.owner_cash_available_after_future_reserve_cash;
    const owner_cash_available_after_reserve_and_funds_cash = ownerCashMetrics.owner_cash_available_after_reserve_and_funds_cash;
    const owner_handover_cash_final = ownerCashMetrics.owner_handover_cash_final;

    // Cash discrepancy = cash_in_cashbox - expected_sellers_cash_due
    const cash_discrepancy = cash_in_cashbox - expected_sellers_cash_due;

    // Warnings (soft, non-blocking)
    const warnings = [];
    if (cash_discrepancy !== 0) {
      warnings.push({
        code: 'CASH_DISCREPANCY',
        amount: cash_discrepancy,
        message: cash_discrepancy > 0
          ? `В кассе больше наличных на ${Math.abs(cash_discrepancy)} ₽, чем ожидалось от продавцов`
          : `В кассе меньше наличных на ${Math.abs(cash_discrepancy)} ₽, чем ожидалось от продавцов`
      });
    }

    // Cashbox JSON for snapshot
    const cashboxJson = JSON.stringify({
      cash_in_cashbox,
      expected_sellers_cash_due,
      deposits_cash_total: depositCash,
      salary_paid_cash: salaryPaidCash,
      cash_discrepancy,
      warnings,
      future_trips_reserve_cash: Number(futureTripsReserve.cash || 0),
      future_trips_reserve_card: Number(futureTripsReserve.card || 0),
      future_trips_reserve_total: Number(futureTripsReserve.total || 0),
      future_trips_reserve_unresolved_trip_day_count: Number(futureTripsReserve.unresolvedTripDayCount || 0),
      salary_base: salaryBase,
      funds_withhold_cash_today: fundsWithholdCashToday,
      owner_cash_available,
      owner_cash_available_after_future_reserve_cash,
      owner_cash_available_after_reserve_and_funds_cash,
      owner_handover_cash_final
    });
    const shiftCloseBreakdown = buildShiftCloseBreakdown({
      businessDay,
      source: 'snapshot',
      sellers,
      collectedCash,
      collectedCard,
      collectedTotal,
      reserveCash: Number(futureTripsReserve.cash || 0),
      reserveCard: Number(futureTripsReserve.card || 0),
      reserveTotal: Number(futureTripsReserve.total || 0),
      salaryBase,
      salaryDueTotal: salaryDue,
      salaryPaidCash,
      salaryPaidCard,
      salaryPaidTotal,
      ownerCashMetrics,
      fundsWithholdCashToday,
      motivationData,
      motivationWithhold,
    });
    const calculationJson = JSON.stringify(shiftCloseBreakdown);

    // Insert snapshot
    db.prepare(`
      INSERT INTO shift_closures (
        business_day,
        closed_by,
        total_revenue,
        collected_total,
        collected_cash,
        collected_card,
        refund_total,
        refund_cash,
        refund_card,
        net_total,
        net_cash,
        net_card,
        deposit_cash,
        deposit_card,
        salary_due,
        salary_paid_cash,
        salary_paid_card,
        salary_paid_total,
        sellers_json,
        cashbox_json,
        calculation_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      businessDay,
      userId,
      totalRevenue,
      collectedTotal,
      collectedCash,
      collectedCard,
      refundTotal,
      refundCash,
      refundCard,
      netTotal,
      netCash,
      netCard,
      depositCash,
      depositCard,
      salaryDue,
      salaryPaidCash,
      salaryPaidCard,
      salaryPaidTotal,
      JSON.stringify(sellers),
      cashboxJson,
      calculationJson
    );

    console.log(`[SHIFT_CLOSE] business_day=${businessDay} closed_by=${userId} total_revenue=${totalRevenue} collected=${collectedTotal}`);

    // --- INSERT WITHHOLD LEDGER ENTRIES (idempotent, race-safe) ---
    // SOFT-LOCK: Check if day is already locked (has WITHHOLD entries)
    const isDayLocked = db.prepare(`
      SELECT 1 FROM money_ledger
      WHERE business_day = ? AND kind = 'FUND' AND type IN ('WITHHOLD_VIKLIF', 'WITHHOLD_WEEKLY', 'WITHHOLD_SEASON') AND status = 'POSTED'
      LIMIT 1
    `).get(businessDay);
    
    if (isDayLocked) {
      console.log(`[SHIFT_CLOSE] Day ${businessDay} is already locked, skipping withhold recalculation`);
    } else {
      // Get withhold amounts from motivation engine
      try {
        const motivationResult = calcMotivationDay(
          db,
          businessDay,
          getShiftCloseMotivationOptions(req.user)
        );
        const viklifAmount = Number(motivationResult?.data?.withhold?.viklif_amount || 0);
        const weeklyAmount = Number(motivationResult?.data?.withhold?.weekly_amount || 0);
        const seasonAmount = Number(motivationResult?.data?.withhold?.season_amount || 0);
        
        const now = new Date().toISOString();
        
        // Use transaction for atomic check-and-insert (prevents race condition)
        const insertWithhold = db.transaction(() => {
          // Check VIKLIF
          const existingViklif = db.prepare(`
            SELECT 1 FROM money_ledger
            WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_VIKLIF' AND status = 'POSTED'
            LIMIT 1
          `).get(businessDay);

          if (!existingViklif && viklifAmount > 0) {
            db.prepare(`
              INSERT INTO money_ledger (kind, type, method, amount, status, seller_id, business_day, event_time, decision_final)
              VALUES ('FUND', 'WITHHOLD_VIKLIF', 'INTERNAL', ?, 'POSTED', NULL, ?, ?, 1)
            `).run(viklifAmount, businessDay, now);
            console.log(`[SHIFT_CLOSE] Inserted WITHHOLD_VIKLIF ledger: ${viklifAmount} for ${businessDay}`);
          }

          // Check WEEKLY
          const existingWeekly = db.prepare(`
            SELECT 1 FROM money_ledger 
            WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
            LIMIT 1
          `).get(businessDay);
          
          if (!existingWeekly && weeklyAmount > 0) {
            db.prepare(`
              INSERT INTO money_ledger (kind, type, method, amount, status, seller_id, business_day, event_time, decision_final)
              VALUES ('FUND', 'WITHHOLD_WEEKLY', 'INTERNAL', ?, 'POSTED', NULL, ?, ?, 1)
            `).run(weeklyAmount, businessDay, now);
            console.log(`[SHIFT_CLOSE] Inserted WITHHOLD_WEEKLY ledger: ${weeklyAmount} for ${businessDay}`);
          }
          
          // Check SEASON
          const existingSeason = db.prepare(`
            SELECT 1 FROM money_ledger 
            WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
            LIMIT 1
          `).get(businessDay);
          
          if (!existingSeason && seasonAmount > 0) {
            db.prepare(`
              INSERT INTO money_ledger (kind, type, method, amount, status, seller_id, business_day, event_time, decision_final)
              VALUES ('FUND', 'WITHHOLD_SEASON', 'INTERNAL', ?, 'POSTED', NULL, ?, ?, 1)
            `).run(seasonAmount, businessDay, now);
            console.log(`[SHIFT_CLOSE] Inserted WITHHOLD_SEASON ledger: ${seasonAmount} for ${businessDay}`);
          }
        });
        
        // Execute transaction
        insertWithhold();
      } catch (withholdError) {
        console.error('[SHIFT_CLOSE_WITHHOLD_LEDGER_ERROR]', withholdError);
        // Don't fail the shift close if withhold ledger insertion fails
      }
    }

    // Get closed_at from the inserted row
    const closedRow = db.prepare(`SELECT closed_at FROM shift_closures WHERE business_day = ? LIMIT 1`).get(businessDay);
    const closedAt = closedRow?.closed_at;

    // Update seller motivation state (calibration, level, streak)
    try {
      updateSellerMotivationState(businessDay);
    } catch (motivationError) {
      console.error('[SHIFT_CLOSE_MOTIVATION_STATE_ERROR]', motivationError);
      // Don't fail the shift close if motivation state update fails
    }

    // Update seller season stats (accumulation)
    try {
      // Load owner settings for coefficients
      const savedSettings = resolveOwnerSettings(db);
      
      // Coefficients from settings (defaults match OWNER_SETTINGS_DEFAULTS in owner.mjs)
      const k_speed = Number(savedSettings.k_speed ?? 1.2);
      const k_cruise = Number(savedSettings.k_cruise ?? 3.0);
      const k_zone_hedgehog = Number(savedSettings.k_zone_hedgehog ?? 1.3);
      const k_zone_center = Number(savedSettings.k_zone_center ?? 1.0);
      const k_zone_sanatorium = Number(savedSettings.k_zone_sanatorium ?? 0.8);
      const k_zone_stationary = Number(savedSettings.k_zone_stationary ?? 0.7);
      const k_banana_hedgehog = Number(savedSettings.k_banana_hedgehog ?? 2.7);
      const k_banana_center = Number(savedSettings.k_banana_center ?? 2.2);
      const k_banana_sanatorium = Number(savedSettings.k_banana_sanatorium ?? 1.2);
      const k_banana_stationary = Number(savedSettings.k_banana_stationary ?? 1.0);
      
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
      
      // Get seller zones from users table
      const sellerZones = db.prepare(`SELECT id, zone FROM users WHERE role = 'seller'`).all();
      const sellerZoneMap = new Map((sellerZones || []).map(r => [Number(r.id), r.zone]));
      
      // Get revenue by seller and boat type (same query as owner/motivation/day)
      const revenueBySellerAndType = db.prepare(`
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
          AND ml.kind = 'SELLER_SHIFT'
          AND DATE(ml.business_day) = ?
          AND ml.seller_id IS NOT NULL
          AND ml.seller_id > 0
          AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
        GROUP BY ml.seller_id, COALESCE(b.type, gb.type), p.zone_at_sale
      `).all(businessDay);
      
      // Build seller stats map
      const sellerStatsMap = new Map();
      
      for (const row of (revenueBySellerAndType || [])) {
        const sellerId = Number(row.seller_id);
        const boatType = row.boat_type || null;
        const zoneAtSale = row.zone_at_sale || null;
        const revenueGross = Number(row.revenue_gross || 0);
        const refunds = Number(row.refunds || 0);
        const revenueNet = Math.max(0, revenueGross - refunds);
        
        if (!boatType || !['speed', 'cruise', 'banana'].includes(boatType)) continue;
        
        let entry = sellerStatsMap.get(sellerId);
        if (!entry) {
          const sellerZone = sellerZoneMap.get(sellerId) || null;
          const state = getSellerState(sellerId);
          const streakDays = state?.calibrated ? (state.streak_days || 0) : 0;
          const kStreak = getStreakMultiplier(streakDays);
          entry = {
            seller_id: sellerId,
            revenue_day: 0,
            points_base: 0,
            zone: sellerZone,
            k_streak: kStreak
          };
          sellerStatsMap.set(sellerId, entry);
        }
        
        entry.revenue_day += revenueNet;
        const effectiveZone = zoneAtSale || entry.zone;
        const revenueInK = revenueNet / 1000;
        
        if (boatType === 'speed') {
          entry.points_base += revenueInK * k_speed * getZoneK(effectiveZone);
        } else if (boatType === 'cruise') {
          entry.points_base += revenueInK * k_cruise * getZoneK(effectiveZone);
        } else if (boatType === 'banana') {
          entry.points_base += revenueInK * getBananaK(effectiveZone);
        }
      }
      
      // Build rows for day stats snapshot
      const seasonRows = Array.from(sellerStatsMap.values()).map(e => ({
        seller_id: e.seller_id,
        revenue_day: e.revenue_day,
        points_day_total: Math.round(e.points_base * e.k_streak * 100) / 100
      }));
      
      // Save daily stats snapshot (idempotent - replaces if exists)
      saveDayStats(db, businessDay, seasonRows);
      
      // Update season stats from daily snapshot (idempotent - uses applied_days)
      updateSeasonStatsFromDay(db, businessDay);
    } catch (seasonError) {
      console.error('[SHIFT_CLOSE_SEASON_STATS_ERROR]', seasonError);
      // Don't fail the shift close if season stats update fails
    }

    res.json({
      ok: true,
      business_day: businessDay,
      closed: true,
      is_closed: true,
      source: 'snapshot',
      closed_at: closedAt,
      closed_by: userId,
      totals: {
        total_revenue: totalRevenue,
        collected_total: collectedTotal,
        collected_cash: collectedCash,
        collected_card: collectedCard,
        refund_total: refundTotal,
        net_total: netTotal,
        deposit_cash: depositCash,
        deposit_card: depositCard
      },
      // Cashbox sanity check fields
      cashbox: {
        cash_in_cashbox,
        expected_sellers_cash_due,
        deposits_cash_total: depositCash,
        salary_paid_cash: salaryPaidCash,
        cash_discrepancy,
        warnings,
        future_trips_reserve_cash: Number(futureTripsReserve.cash || 0),
        future_trips_reserve_card: Number(futureTripsReserve.card || 0),
        future_trips_reserve_total: Number(futureTripsReserve.total || 0),
        salary_base: salaryBase,
        funds_withhold_cash_today: fundsWithholdCashToday,
        owner_cash_available_after_future_reserve_cash,
        owner_cash_available_after_reserve_and_funds_cash,
        owner_handover_cash_final
      },
      // Top-level convenience fields
      cash_in_cashbox,
      expected_sellers_cash_due,
      cash_discrepancy,
      warnings,
      future_trips_reserve_cash: Number(futureTripsReserve.cash || 0),
      future_trips_reserve_card: Number(futureTripsReserve.card || 0),
      future_trips_reserve_total: Number(futureTripsReserve.total || 0),
      salary_base: salaryBase,
      funds_withhold_cash_today: fundsWithholdCashToday,
      owner_cash_available_after_future_reserve_cash,
      owner_cash_available_after_reserve_and_funds_cash,
      owner_handover_cash_final,
      motivation_withhold: shiftCloseBreakdown.withhold,
      shift_close_breakdown: shiftCloseBreakdown
    });
  } catch (e) {
    console.error('[DISPATCHER SHIFT CLOSE ERROR]', e);
    res.status(500).json({ ok: false, error: 'Ошибка сервера' });
  }
});

export default router;
