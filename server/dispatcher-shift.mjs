import express from 'express';
import db from './db.js';
import { allTripsFinished } from './dispatcher-shift-ledger.mjs';
import { updateSellerMotivationState, getStreakMultiplier, getSellerState } from './seller-motivation-state.mjs';
import { saveDayStats, updateSeasonStatsFromDay } from './season-stats.mjs';

const router = express.Router();

// Helper: ensure cashbox_json column exists in shift_closures
let cashboxColumnEnsured = false;
function ensureCashboxColumn() {
  if (cashboxColumnEnsured) return;
  try {
    const cols = db.prepare("PRAGMA table_info(shift_closures)").all().map(r => r.name);
    if (!cols.includes('cashbox_json')) {
      db.prepare('ALTER TABLE shift_closures ADD COLUMN cashbox_json TEXT').run();
      console.log('[SHIFT_CLOSURES] Added cashbox_json column');
    }
    cashboxColumnEnsured = true;
  } catch (e) {
    // Column might already exist or table doesn't exist yet
    if (!e.message?.includes('duplicate column')) {
      console.error('[SHIFT_CLOSURES] ensureCashboxColumn error:', e.message);
    }
    cashboxColumnEnsured = true;
  }
}

// Helper: get local business day
function getLocalBusinessDay() {
  return db.prepare("SELECT DATE('now','localtime') AS d").get()?.d;
}

// Helper: check if shift is closed for business_day
function isShiftClosed(businessDay) {
  try {
    const row = db.prepare('SELECT 1 FROM shift_closures WHERE business_day = ? LIMIT 1').get(businessDay);
    return !!row;
  } catch {
    return false;  // Table doesn't exist or error
  }
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
    const closure = isShiftClosed(businessDay) ? db.prepare(`
      SELECT closed_at, closed_by, cashbox_json 
      FROM shift_closures 
      WHERE business_day = ? 
      LIMIT 1
    `).get(businessDay) : null;

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

    // Check if already closed - return idempotent success
    const existingClosure = isShiftClosed(businessDay) ? db.prepare(`
      SELECT closed_at, closed_by FROM shift_closures WHERE business_day = ? LIMIT 1
    `).get(businessDay) : null;
    
    if (existingClosure) {
      return res.json({
        ok: true,
        business_day: businessDay,
        is_closed: true,
        source: 'snapshot',
        closed_at: existingClosure.closed_at,
        closed_by: existingClosure.closed_by
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

    // Get live summary values (same logic as /summary endpoint)
    // We need to duplicate the calculation here to get all values in one transaction
    const summaryRow = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) AS total_revenue
      FROM sales_transactions_canonical
      WHERE business_day = ? AND status = 'VALID'
    `).get(businessDay);
    const totalRevenue = Number(summaryRow?.total_revenue || 0);

    // Check if money_ledger has cash_amount/card_amount columns
    const ledgerCols = db.prepare(`PRAGMA table_info(money_ledger)`).all().map(r => r.name);
    const hasCashAmt = ledgerCols.includes('cash_amount');
    const hasCardAmt = ledgerCols.includes('card_amount');

    // Collected from money_ledger
    let collectedTotal = 0;
    let collectedCash = 0;
    let collectedCard = 0;

    if (hasCashAmt && hasCardAmt) {
      // money_ledger has cash_amount/card_amount columns - use them directly
      const collectedRow = db.prepare(`
        SELECT
          COALESCE(SUM(amount), 0) AS collected_total,
          COALESCE(SUM(CASE
            WHEN method = 'CASH' THEN amount
            WHEN method = 'MIXED' THEN COALESCE(cash_amount, 0)
            ELSE 0
          END), 0) AS collected_cash,
          COALESCE(SUM(CASE
            WHEN method = 'CARD' THEN amount
            WHEN method = 'MIXED' THEN COALESCE(card_amount, 0)
            ELSE 0
          END), 0) AS collected_card
        FROM money_ledger
        WHERE status = 'POSTED'
          AND kind = 'SELLER_SHIFT'
          AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
          AND business_day = ?
      `).get(businessDay);
      collectedTotal = Number(collectedRow?.collected_total || 0);
      collectedCash = Number(collectedRow?.collected_cash || 0);
      collectedCard = Number(collectedRow?.collected_card || 0);
    } else {
      // money_ledger lacks cash_amount/card_amount - JOIN with presales for MIXED split
      const collectedRow = db.prepare(`
        SELECT
          COALESCE(SUM(ml.amount), 0) AS collected_total,
          COALESCE(SUM(CASE
            WHEN ml.method = 'CASH' THEN ml.amount
            WHEN ml.method = 'MIXED' THEN COALESCE(p.payment_cash_amount, 0)
            WHEN ml.method = 'CARD' THEN ml.amount
            ELSE 0
          END), 0) AS collected_cash,
          COALESCE(SUM(CASE
            WHEN ml.method = 'CARD' THEN ml.amount
            WHEN ml.method = 'MIXED' THEN COALESCE(p.payment_card_amount, 0)
            ELSE 0
          END), 0) AS collected_card
        FROM money_ledger ml
        LEFT JOIN presales p ON p.id = ml.presale_id
        WHERE ml.status = 'POSTED'
          AND ml.kind = 'SELLER_SHIFT'
          AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
          AND ml.business_day = ?
      `).get(businessDay);
      collectedTotal = Number(collectedRow?.collected_total || 0);
      collectedCash = Number(collectedRow?.collected_cash || 0);
      collectedCard = Number(collectedRow?.collected_card || 0);
    }

    // Refunds
    const refundRow = db.prepare(`
      SELECT
        COALESCE(SUM(ABS(amount)), 0) AS refund_total,
        COALESCE(SUM(CASE WHEN method = 'CASH' THEN ABS(amount) ELSE 0 END), 0) AS refund_cash,
        COALESCE(SUM(CASE WHEN method = 'CARD' THEN ABS(amount) ELSE 0 END), 0) AS refund_card
      FROM money_ledger
      WHERE status = 'POSTED'
        AND kind = 'SELLER_SHIFT'
        AND type = 'SALE_CANCEL_REVERSE'
        AND business_day = ?
    `).get(businessDay);
    const refundTotal = Number(refundRow?.refund_total || 0);
    const refundCash = Number(refundRow?.refund_cash || 0);
    const refundCard = Number(refundRow?.refund_card || 0);

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

    // Sellers data
    const sellersRows = db.prepare(`
      SELECT
        ml.seller_id,
        COALESCE(SUM(CASE WHEN ml.kind = 'SELLER_SHIFT' AND ml.type LIKE 'SALE_%' THEN ml.amount ELSE 0 END), 0) AS accepted,
        COALESCE(SUM(CASE WHEN ml.kind = 'DISPATCHER_SHIFT' AND ml.type LIKE 'DEPOSIT_TO_OWNER%' THEN ml.amount ELSE 0 END), 0) AS deposited
      FROM money_ledger ml
      WHERE ml.business_day = ?
        AND ml.status = 'POSTED'
        AND ml.seller_id IS NOT NULL
      GROUP BY ml.seller_id
    `).all(businessDay);
    
    const sellers = (sellersRows || []).map(r => ({
      seller_id: r.seller_id,
      accepted: Number(r.accepted || 0),
      deposited: Number(r.deposited || 0),
      balance: Number(r.accepted || 0) - Number(r.deposited || 0),
      cash_balance: Number(r.accepted || 0) - Number(r.deposited || 0),
      terminal_debt: 0,
      status: (Number(r.accepted || 0) - Number(r.deposited || 0)) === 0 ? 'CLOSED' : 'DEBT'
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
    const salaryDue = 0;  // TEMP: will come from motivation engine

    // --- CASHBOX SANITY CHECK ---
    // Ensure cashbox_json column exists
    ensureCashboxColumn();

    // Cash in cashbox = net_cash - deposit_cash - salary_paid_cash
    const cash_in_cashbox = netCash - depositCash - salaryPaidCash;

    // Expected sellers cash due = sum of positive cash_due_to_owner (balance)
    const expected_sellers_cash_due = sellers.reduce((sum, s) => {
      const due = Math.max(0, Number(s.balance || s.cash_balance || 0));
      return sum + due;
    }, 0);

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
      warnings
    });

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
        cashbox_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      cashboxJson
    );

    console.log(`[SHIFT_CLOSE] business_day=${businessDay} closed_by=${userId} total_revenue=${totalRevenue} collected=${collectedTotal}`);

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
      const ownerRow = db.prepare("SELECT settings_json FROM owner_settings WHERE id = 1").get();
      const savedSettings = ownerRow?.settings_json ? JSON.parse(ownerRow.settings_json) : {};
      
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
        warnings
      },
      // Top-level convenience fields
      cash_in_cashbox,
      expected_sellers_cash_due,
      cash_discrepancy,
      warnings
    });
  } catch (e) {
    console.error('[DISPATCHER SHIFT CLOSE ERROR]', e);
    res.status(500).json({ ok: false, error: 'Ошибка сервера' });
  }
});

export default router;
