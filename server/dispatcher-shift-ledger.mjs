/**
 * dispatcher-shift-ledger.mjs
 *
 * SAFE shift ledger summary for Dispatcher UI.
 *
 * Fixes:
 * - Removes hard dependency on sales_transactions_canonical.seller_id
 * - Uses column-existence checks (PRAGMA table_info)
 * - Never executes SQL at import time (prevents startup errors)
 * - Always returns JSON (even with partial/older DB schema)
 */

import express from 'express';
import db from './db.js';
import * as auth from './auth.js';
import { calcMotivationDay } from './motivation/engine.mjs';

const authenticateToken = auth.authenticateToken || auth.default || auth;

const router = express.Router();

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getLocalYMD(d = new Date()) {
  // local date (not UTC)
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

function safeTableExists(tableName) {
  try {
    const row = db
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE name = ? AND type IN ('table','view') LIMIT 1"
      )
      .get(tableName);
    return !!row;
  } catch {
    return false;
  }
}

function safeGetColumns(tableName) {
  try {
    if (!safeTableExists(tableName)) return new Set();
    const rows = db.prepare(`PRAGMA table_info('${tableName}')`).all();
    return new Set((rows || []).map((r) => r.name));
  } catch {
    return new Set();
  }
}

function hasCol(colsSet, name) {
  return colsSet && colsSet.has(name);
}

function safeSum(sql, params = []) {
  try {
    const row = db.prepare(sql).get(...params);
    const v = row ? Object.values(row)[0] : 0;
    return Number(v || 0);
  } catch {
    return 0;
  }
}

function safeAll(sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

function sumPositiveSellerLiabilities(rows = []) {
  return (rows || []).reduce((sum, r) => {
    const cashDue = Number(r.cash_due_to_owner ?? r.cash_balance ?? r.balance ?? 0);
    const terminalDue = Number(r.terminal_due_to_owner ?? r.terminal_debt ?? 0);
    return sum + Math.max(0, cashDue) + Math.max(0, terminalDue);
  }, 0);
}

function getReserveTripDayExpr() {
  const presaleCols = safeGetColumns('presales');
  if (hasCol(presaleCols, 'business_day')) {
    return "COALESCE(p.business_day, DATE(p.created_at))";
  }
  return 'DATE(p.created_at)';
}

function calcFutureTripsReserveByPaymentDay({ businessDay, ledgerCols, hasLedger, ledgerHasBDay }) {
  if (!hasLedger || !ledgerHasBDay || !safeTableExists('presales')) {
    return { cash: 0, card: 0, total: 0, unresolvedTripDayCount: 0 };
  }

  const ledgerHasCashAmt = hasCol(ledgerCols, 'cash_amount');
  const ledgerHasCardAmt = hasCol(ledgerCols, 'card_amount');
  const tripDayExpr = getReserveTripDayExpr();
  const mixedCashExpr = ledgerHasCashAmt ? 'COALESCE(ml.cash_amount, 0)' : 'COALESCE(p.payment_cash_amount, ml.amount)';
  const mixedCardExpr = ledgerHasCardAmt ? 'COALESCE(ml.card_amount, 0)' : 'COALESCE(p.payment_card_amount, 0)';

  const cashExpr = `CASE
    WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH') OR ml.method = 'CASH' THEN ml.amount
    WHEN ml.type IN ('SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_MIXED') OR ml.method = 'MIXED' THEN ${mixedCashExpr}
    ELSE 0
  END`;
  const cardExpr = `CASE
    WHEN ml.type IN ('SALE_PREPAYMENT_CARD','SALE_ACCEPTED_CARD') OR ml.method = 'CARD' THEN ml.amount
    WHEN ml.type IN ('SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_MIXED') OR ml.method = 'MIXED' THEN ${mixedCardExpr}
    ELSE 0
  END`;

  const reserveRow = safeAll(
    `SELECT
      COALESCE(SUM(CASE WHEN ${tripDayExpr} > ? THEN ${cashExpr} ELSE 0 END), 0) AS reserve_cash,
      COALESCE(SUM(CASE WHEN ${tripDayExpr} > ? THEN ${cardExpr} ELSE 0 END), 0) AS reserve_card
     FROM money_ledger ml
     LEFT JOIN presales p ON p.id = ml.presale_id
     WHERE ml.business_day = ?
       AND ml.status = 'POSTED'
       AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
       AND ml.type IN (
         'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
         'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
       )`,
    [businessDay, businessDay, businessDay]
  )?.[0];

  const unresolvedTripDayCount = safeSum(
    `SELECT COALESCE(COUNT(*), 0) AS v
     FROM money_ledger ml
     LEFT JOIN presales p ON p.id = ml.presale_id
     WHERE ml.business_day = ?
       AND ml.status = 'POSTED'
       AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
       AND ml.type IN (
         'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
         'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
       )
       AND (${tripDayExpr} IS NULL)`,
    [businessDay]
  );

  const cash = Number(reserveRow?.reserve_cash || 0);
  const card = Number(reserveRow?.reserve_card || 0);
  return {
    cash,
    card,
    total: cash + card,
    unresolvedTripDayCount: Number(unresolvedTripDayCount || 0),
  };
}

/**
 * Count open (not finished) trips for a business_day.
 * A trip is "open" if:
 *   - is_active = 1 AND is_completed = 0 (not manually completed)
 *   - AND current time is before trip start + duration
 * Uses same logic as SlotManagement.jsx and auto-complete-trips.mjs
 */
function getOpenTripsCount(businessDay) {
  try {
    if (!safeTableExists('generated_slots')) return 0;

    const gsCols = safeGetColumns('generated_slots');
    if (!hasCol(gsCols, 'trip_date') || !hasCol(gsCols, 'time')) return 0;

    const hasCompleted = hasCol(gsCols, 'is_completed');
    const hasStatus = hasCol(gsCols, 'status');

    // Count all active slots for the business_day that are not completed
    // A slot is "open" if: is_active=1 AND is_completed=0 AND status != 'COMPLETED'
    const where = [
      'is_active = 1',
      'trip_date = ?',
    ];
    if (hasCompleted) where.push('COALESCE(is_completed, 0) = 0');
    if (hasStatus) where.push("COALESCE(status, 'ACTIVE') != 'COMPLETED'");

    const countRow = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM generated_slots
      WHERE ${where.join(' AND ')}
    `).get(businessDay);

    return Number(countRow?.cnt || 0);
  } catch (e) {
    console.error('[GET_OPEN_TRIPS_COUNT] Error:', e?.message || e);
    return 0;
  }
}

/**
 * Export helper for use in other modules (dispatcher-shift.mjs)
 */
export function allTripsFinished(businessDay) {
  return getOpenTripsCount(businessDay) === 0;
}

router.get('/summary', authenticateToken, (req, res) => {
  const businessDay =
    String(req.query.business_day || req.query.trip_day || req.query.day || '').trim() ||
    getLocalYMD();


  // --- Shift closure snapshot (do not recompute past days) ---
  let closureSnapshot = null;
  let source = 'live';
  const hasClosures = safeTableExists('shift_closures');
  if (hasClosures) {
    try {
      const row = db.prepare(`
        SELECT
          id, business_day, closed_at, closed_by,
          total_revenue, collected_total, collected_cash, collected_card,
          refund_total, refund_cash, refund_card,
          net_total, net_cash, net_card,
          deposit_cash, deposit_card,
          salary_due, salary_paid_cash, salary_paid_card, salary_paid_total,
          sellers_json,
          cashbox_json
        FROM shift_closures
        WHERE business_day = ?
        LIMIT 1
      `).get(businessDay);

      if (row) {
        closureSnapshot = row;
        source = 'snapshot';
      }
    } catch (e) {
      // fall through to live calculation
    }
  }

  // --- If closed, return snapshot values ---
  if (closureSnapshot) {
    const snap = closureSnapshot;
    let sellersFromSnapshot = [];
    try {
      if (snap.sellers_json) {
        sellersFromSnapshot = JSON.parse(snap.sellers_json);
      }
    } catch {}

    // Parse cashbox_json if present
    let cashboxData = null;
    try {
      if (snap.cashbox_json) {
        cashboxData = JSON.parse(snap.cashbox_json);
      }
    } catch {}

    // Enhance sellers with extended contract fields (same as live branch)
    const sellers = sellersFromSnapshot.map((r) => {
      const accepted = Number(r.accepted || 0);
      const deposited = Number(r.deposited || 0);
      const balance = Number(r.balance ?? (accepted - deposited));
      // Use stored terminal_due_to_owner if available, else fallback to terminal_debt or 0
      const terminal_due_to_owner = Number(r.terminal_due_to_owner ?? r.terminal_debt ?? 0);
      const cash_due_to_owner = Number(r.cash_due_to_owner ?? balance);
      
      // Reconstruct collected_cash/collected_card from due + deposit
      // collected_cash = prepay_cash = cash_due_to_owner + deposit_cash
      // collected_card = prepay_card = terminal_due_to_owner + deposit_card
      const deposit_cash = Number(r.deposit_cash || r.deposited_cash || 0);
      const deposit_card = Number(r.deposit_card || r.deposited_card || 0);
      const collected_cash = Number(r.collected_cash ?? (cash_due_to_owner + deposit_cash));
      const collected_card = Number(r.collected_card ?? (terminal_due_to_owner + deposit_card));
      
      return {
        ...r,
        seller_id: r.seller_id,
        seller_name: r.name || `Продавец #${r.seller_id}`,
        name: r.name || `Продавец #${r.seller_id}`,
        collected_total: collected_cash + collected_card,
        collected_cash,
        collected_card,
        refund_total: 0,
        net_total: balance,
        deposit_cash,
        deposit_card,
        cash_due_to_owner,
        cash_balance: cash_due_to_owner,
        terminal_debt: terminal_due_to_owner,
        terminal_due_to_owner,
        status: balance === 0 ? 'CLOSED' : balance > 0 ? 'DEBT' : 'OVERPAID',
        // Salary fields (snapshot may not have per-seller, default to 0)
        salary_due: Number(r.salary_due || 0),
        salary_due_total: Number(r.salary_due_total || r.salary_due || 0),
        salary_accrued: Number(r.salary_accrued || r.salary_due_total || 0),
      };
    });

    const salary_total = Math.round(Number(snap.total_revenue || 0) * 0.13);

    // --- Motivation withhold from engine (snapshot branch) ---
    let motivationWithhold = null;
    try {
      const motivationResult = calcMotivationDay(db, businessDay);
      if (motivationResult?.data) {
        motivationWithhold = {
          weekly_amount_raw: motivationResult.data.withhold?.weekly_amount_raw ?? 0,
          weekly_amount: motivationResult.data.withhold?.weekly_amount ?? 0,
          season_amount: motivationResult.data.withhold?.season_amount ?? 0,
          season_amount_base: motivationResult.data.withhold?.season_amount_base ?? 0,
          season_amount_from_rounding: motivationResult.data.withhold?.season_amount_from_rounding ?? 0,
          weekly_rounding_to_season_amount: motivationResult.data.withhold?.weekly_rounding_to_season_amount ?? 0,
          dispatcher_rounding_to_season_amount: motivationResult.data.withhold?.dispatcher_rounding_to_season_amount ?? 0,
          payouts_rounding_to_season_amount: motivationResult.data.withhold?.payouts_rounding_to_season_amount ?? 0,
          rounding_to_season_amount_total: motivationResult.data.withhold?.rounding_to_season_amount_total ?? 0,
          dispatcher_amount_total: motivationResult.data.withhold?.dispatcher_amount_total ?? 0,
          fund_total_original: motivationResult.data.withhold?.fund_total_original ?? 0,
          fund_total_after_withhold: motivationResult.data.withhold?.fund_total_after_withhold ?? 0,
          dispatcher_percent_total: motivationResult.data.settings_effective?.dispatcher_withhold_percent_total ?? 0.002,
          dispatcher_percent_per_person: motivationResult.data.settings_effective?.dispatcher_withhold_percent_per_person ?? 0.001,
          active_dispatchers_count: motivationResult.data.dispatchers_today?.active_count ?? 0
        };
      }
    } catch (e) {
      console.error('[MOTIVATION_WITHHOLD_SNAPSHOT] Error:', e?.message || e);
    }

    // Dispatcher totals (from snapshot)
    const dispatcher = {
      collected_total: 0,
      collected_cash: 0,
      collected_card: 0,
      refund_total: 0,
      net_total: 0,
      deposit_cash: Number(snap.deposit_cash || 0),
      deposit_card: Number(snap.deposit_card || 0),
      salary_paid_cash: Number(snap.salary_paid_cash || 0),
      salary_paid_card: Number(snap.salary_paid_card || 0),
      salary_paid_total: Number(snap.salary_paid_total || 0),
    };

    const sellersForResponse = [...sellers];
    if (sellersForResponse.length === 0 && Number(snap.collected_total || 0) > 0) {
      sellersForResponse.push({
        seller_id: 0,
        seller_name: 'Диспетчер (источник выручки)',
        name: 'Диспетчер (источник выручки)',
        role: 'dispatcher',
        accepted: Number(snap.collected_total || 0),
        deposited: 0,
        balance: 0,
        cash_balance: 0,
        terminal_debt: 0,
        terminal_due_to_owner: 0,
        status: 'CLOSED',
        collected_total: Number(snap.collected_total || 0),
        collected_cash: Number(snap.collected_cash || 0),
        collected_card: Number(snap.collected_card || 0),
        refund_total: 0,
        net_total: 0,
        deposit_cash: 0,
        deposit_card: 0,
        cash_due_to_owner: 0,
        salary_due: 0,
        salary_due_total: 0,
        salary_accrued: 0,
      });
    }
    const sellersAcceptedTotalResponse = sellersForResponse.reduce((sum, r) => sum + Number(r.accepted || 0), 0);
    const sellersDepositedTotalResponse = sellersForResponse.reduce((sum, r) => sum + Number(r.deposited || 0), 0);
    const sellersBalanceTotalResponse = sellersForResponse.reduce((sum, r) => sum + Number(r.balance || 0), 0);
    const sellersDebtTotalResponse = sumPositiveSellerLiabilities(sellersForResponse);
    const ownerCashAvailable = Number(snap.net_total || 0) - Number(snap.salary_due || 0) - sellersDebtTotalResponse;
    const futureTripsReserveCash = Number(cashboxData?.future_trips_reserve_cash || 0);
    const futureTripsReserveCard = Number(cashboxData?.future_trips_reserve_card || cashboxData?.future_trips_reserve_terminal || 0);
    const futureTripsReserveTotal = Number(cashboxData?.future_trips_reserve_total || (futureTripsReserveCash + futureTripsReserveCard));
    const ownerCashAvailableAfterFutureReserveCash = cashboxData?.owner_cash_available_after_future_reserve_cash != null
      ? Number(cashboxData.owner_cash_available_after_future_reserve_cash)
      : ownerCashAvailable - futureTripsReserveCash;
    const unresolvedTripDayCount = Number(cashboxData?.future_trips_reserve_unresolved_trip_day_count || 0);

    return res.json({
      ok: true,
      business_day: businessDay,
      source: 'snapshot',
      is_closed: true,
      closed_at: snap.closed_at,
      closed_by: snap.closed_by,

      // UI-friendly totals (from snapshot)
      total_revenue: Number(snap.total_revenue || 0),
      cash_total: Number(snap.collected_cash || 0),  // alias for compatibility
      card_total: Number(snap.collected_card || 0),  // alias for compatibility
      salary_total,

      // COLLECTED MONEY (from snapshot)
      collected_total: Number(snap.collected_total || 0),
      collected_cash: Number(snap.collected_cash || 0),
      collected_card: Number(snap.collected_card || 0),

      // UI-friendly sellers (from snapshot)
      sellers: sellersForResponse,
      sellers_accepted_total: sellersAcceptedTotalResponse,
      sellers_deposited_total: sellersDepositedTotalResponse,
      sellers_balance_total: sellersBalanceTotalResponse,

      // Dispatcher totals (DISPATCHER_SHIFT kind aggregated)
      dispatcher,

      // Flat totals
      revenue: Number(snap.total_revenue || 0),
      qty: 0,  // not stored in snapshot
      cash: Number(snap.collected_cash || 0),
      card: Number(snap.collected_card || 0),

      // Refunds (from snapshot)
      refund_total: Number(snap.refund_total || 0),
      refund_cash: Number(snap.refund_cash || 0),
      refund_card: Number(snap.refund_card || 0),

      // Net metrics (from snapshot)
      net_total: Number(snap.net_total || 0),
      net_revenue: Number(snap.net_total || 0),  // deprecated alias
      net_cash: Number(snap.net_cash || 0),
      net_card: Number(snap.net_card || 0),

      deposit_cash: Number(snap.deposit_cash || 0),
      deposit_card: Number(snap.deposit_card || 0),
      deposit_total: Number(snap.deposit_cash || 0) + Number(snap.deposit_card || 0),

      // Structured
      sales: {
        revenue: Number(snap.total_revenue || 0),
        qty: 0,
        cash: Number(snap.collected_cash || 0),
        card: Number(snap.collected_card || 0),
      },
      refunds: {
        total: Number(snap.refund_total || 0),
        cash: Number(snap.refund_cash || 0),
        card: Number(snap.refund_card || 0),
      },
      net: {
        total: Number(snap.net_total || 0),
        revenue: Number(snap.net_total || 0),
        cash: Number(snap.net_cash || 0),
        card: Number(snap.net_card || 0),
      },
      collected: {
        total: Number(snap.collected_total || 0),
        cash: Number(snap.collected_cash || 0),
        card: Number(snap.collected_card || 0),
      },
      ledger: {
        deposit_to_owner: {
          total: Number(snap.deposit_cash || 0) + Number(snap.deposit_card || 0),
          cash: Number(snap.deposit_cash || 0),
          card: Number(snap.deposit_card || 0),
        },
        by_seller: [],
      },

      // Trip completion status (snapshot: always finished)
      open_trips_count: 0,
      all_trips_finished: true,

      // Salary payouts (from snapshot)
      salary_due: Number(snap.salary_due || 0),
      salary_due_total: Number(snap.salary_due || 0),  // alias for backward compat
      salary_paid_cash: Number(snap.salary_paid_cash || 0),
      salary_paid_card: Number(snap.salary_paid_card || 0),
      salary_paid_total: Number(snap.salary_paid_total || 0),
      sellers_debt_total: sellersDebtTotalResponse,
      owner_cash_available: ownerCashAvailable,
      owner_cash_available_without_future_reserve: ownerCashAvailable,
      owner_cash_available_after_future_reserve_cash: ownerCashAvailableAfterFutureReserveCash,
      future_trips_reserve_cash: futureTripsReserveCash,
      future_trips_reserve_card: futureTripsReserveCard,
      future_trips_reserve_total: futureTripsReserveTotal,
      reserve_future_trips: {
        cash: futureTripsReserveCash,
        card: futureTripsReserveCard,
        total: futureTripsReserveTotal,
      },
      explain: {
        liabilities: {
          future_trips_reserve_cash: futureTripsReserveCash,
          future_trips_reserve_terminal: futureTripsReserveCard,
          prepayment_future_cash: futureTripsReserveCash,
          prepayment_future_terminal: futureTripsReserveCard,
        },
        unresolved_trip_day_count: unresolvedTripDayCount,
      },

      // Cashbox sanity check (from snapshot cashbox_json)
      cash_in_cashbox: cashboxData?.cash_in_cashbox ?? null,
      expected_sellers_cash_due: cashboxData?.expected_sellers_cash_due ?? null,
      cash_discrepancy: cashboxData?.cash_discrepancy ?? null,
      warnings: cashboxData?.warnings ?? [],
      cashbox: cashboxData ?? null,
      
      // Motivation withhold breakdown
      motivation_withhold: motivationWithhold
    });
  }

  // --- LIVE CALCULATION (shift not closed yet) ---


  const canonicalCols = safeGetColumns('sales_transactions_canonical');
  const ledgerCols = safeGetColumns('money_ledger');

  // --- Sales totals (overall day), without seller_id dependency ---
  const hasCanonical = safeTableExists('sales_transactions_canonical');
  const canonicalHasCash = hasCol(canonicalCols, 'cash_amount');
  const canonicalHasCard = hasCol(canonicalCols, 'card_amount');
  const canonicalHasStatus = hasCol(canonicalCols, 'status');
  const canonicalHasBDay = hasCol(canonicalCols, 'business_day');

  let salesRevenue = 0;
  let salesQty = 0;
  let salesCash = 0;
  let salesCard = 0;

  if (hasCanonical && canonicalHasBDay) {
    const where = [];
    const params = [];

    where.push('business_day = ?');
    params.push(businessDay);

    if (canonicalHasStatus) {
      // canonical uses VALID / REFUNDED / CANCELLED etc.
      where.push("status = 'VALID'");
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    salesRevenue = safeSum(
      `SELECT COALESCE(SUM(amount),0) AS v FROM sales_transactions_canonical ${whereSql}`,
      params
    );

    salesQty = safeSum(
      `SELECT COALESCE(SUM(qty),0) AS v FROM sales_transactions_canonical ${whereSql}`,
      params
    );

    if (canonicalHasCash) {
      salesCash = safeSum(
        `SELECT COALESCE(SUM(cash_amount),0) AS v FROM sales_transactions_canonical ${whereSql}`,
        params
      );
    }

    if (canonicalHasCard) {
      salesCard = safeSum(
        `SELECT COALESCE(SUM(card_amount),0) AS v FROM sales_transactions_canonical ${whereSql}`,
        params
      );
    }
  }

  // --- Ledger totals (shift actions), with seller_id supported here ---
  const hasLedger = safeTableExists('money_ledger');
  const ledgerHasBDay = hasCol(ledgerCols, 'business_day');
  const ledgerHasType = hasCol(ledgerCols, 'type');
  const ledgerHasEventType = hasCol(ledgerCols, 'event_type');
  const ledgerHasMethod = hasCol(ledgerCols, 'method');
  const ledgerHasKind = hasCol(ledgerCols, 'kind');
  const ledgerHasSeller = hasCol(ledgerCols, 'seller_id');
  const ledgerHasStatus = hasCol(ledgerCols, 'status');

  let depositToOwnerCash = 0;
  let depositToOwnerCard = 0;
  let depositToOwnerTotal = 0;

  let ledgerBySeller = [];

  // --- Per-user collected breakdown by method (cash/card) ---
  let sellerPrepayByMethod = new Map(); // seller_id -> {prepay_cash, prepay_card}

  if (hasLedger && ledgerHasBDay && ledgerHasSeller && ledgerHasType) {
    const ledgerHasCashAmount = hasCol(ledgerCols, 'cash_amount');
    const ledgerHasCardAmount = hasCol(ledgerCols, 'card_amount');
    const mixedCashExpr = ledgerHasCashAmount ? 'COALESCE(ml.cash_amount, 0)' : 'COALESCE(p.payment_cash_amount, 0)';
    const mixedCardExpr = ledgerHasCardAmount ? 'COALESCE(ml.card_amount, 0)' : 'COALESCE(p.payment_card_amount, 0)';

    // Collect per-user cash/card from all sales kinds so dispatcher-only users are visible in UI.
    const prepayRows = safeAll(
      `SELECT
        ml.seller_id AS seller_id,
        COALESCE(SUM(
          CASE
            WHEN ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_ACCEPTED_CASH') THEN ml.amount
            WHEN ml.type IN ('SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_MIXED') THEN ${mixedCashExpr}
            WHEN ml.type = 'SALE_CANCEL_REVERSE' AND ml.method = 'CASH' THEN ml.amount
            WHEN ml.type = 'SALE_CANCEL_REVERSE' AND ml.method = 'MIXED' THEN -${mixedCashExpr}
            ELSE 0
          END
        ),0) AS prepay_cash,
        COALESCE(SUM(
          CASE
            WHEN ml.type IN ('SALE_PREPAYMENT_CARD', 'SALE_ACCEPTED_CARD') THEN ml.amount
            WHEN ml.type IN ('SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_MIXED') THEN ${mixedCardExpr}
            WHEN ml.type = 'SALE_CANCEL_REVERSE' AND ml.method = 'CARD' THEN ml.amount
            WHEN ml.type = 'SALE_CANCEL_REVERSE' AND ml.method = 'MIXED' THEN -${mixedCardExpr}
            ELSE 0
          END
        ),0) AS prepay_card
      FROM money_ledger ml
      LEFT JOIN presales p ON p.id = ml.presale_id
      WHERE ml.business_day = ?
        AND ml.status = 'POSTED'
        AND ml.seller_id IS NOT NULL
        AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
        AND ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED',
          'SALE_CANCEL_REVERSE'
        )
      GROUP BY ml.seller_id`,
      [businessDay]
    );
    sellerPrepayByMethod = new Map((prepayRows || []).map(r => [r.seller_id, {
      prepay_cash: Number(r.prepay_cash || 0),
      prepay_card: Number(r.prepay_card || 0)
    }]));
  }

  // --- Per-user deposit breakdown by method (cash/card) ---
  let sellerDepositByMethod = new Map(); // seller_id -> {deposit_cash, deposit_card}

  if (hasLedger && ledgerHasBDay && ledgerHasSeller) {
    const depCashByMethodExpr = ledgerHasMethod ? "WHEN type LIKE 'DEPOSIT_TO_OWNER%' AND method = 'CASH' THEN amount" : '';
    const depCardByMethodExpr = ledgerHasMethod ? "WHEN type LIKE 'DEPOSIT_TO_OWNER%' AND method = 'CARD' THEN amount" : '';
    const depRows = safeAll(
      `SELECT seller_id AS seller_id,
              COALESCE(SUM(CASE
                WHEN type = 'DEPOSIT_TO_OWNER_CASH' THEN amount
                ${depCashByMethodExpr}
                ELSE 0
              END),0) AS deposit_cash,
              COALESCE(SUM(CASE
                WHEN type = 'DEPOSIT_TO_OWNER_CARD' THEN amount
                ${depCardByMethodExpr}
                ELSE 0
              END),0) AS deposit_card
       FROM money_ledger
       WHERE business_day = ?
         AND status = 'POSTED'
         AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
         AND type LIKE 'DEPOSIT_TO_OWNER%'
         AND seller_id IS NOT NULL
       GROUP BY seller_id`,
      [businessDay]
    );
    sellerDepositByMethod = new Map((depRows || []).map(r => [r.seller_id, {
      deposit_cash: Number(r.deposit_cash || 0),
      deposit_card: Number(r.deposit_card || 0)
    }]));
  }

  if (hasLedger && ledgerHasBDay) {
    const where = ['business_day = ?'];
    const params = [businessDay];

    if (ledgerHasStatus) where.push("status = 'POSTED'");
    if (ledgerHasKind) where.push("kind = 'DISPATCHER_SHIFT'");

    const typeCol = ledgerHasType ? 'type' : ledgerHasEventType ? 'event_type' : null;

    if (typeCol) {
      // deposits can be DEPOSIT_TO_OWNER_CASH / DEPOSIT_TO_OWNER_CARD / DEPOSIT_TO_OWNER
      // keep it flexible: LIKE 'DEPOSIT_TO_OWNER%'
      const baseWhereSql = `WHERE ${where.join(' AND ')} AND ${typeCol} LIKE 'DEPOSIT_TO_OWNER%'`;

      // totals
      depositToOwnerTotal = safeSum(
        `SELECT COALESCE(SUM(amount),0) AS v FROM money_ledger ${baseWhereSql}`,
        params
      );

      // by method if present; else by suffix in type
      if (ledgerHasMethod) {
        depositToOwnerCash = safeSum(
          `SELECT COALESCE(SUM(amount),0) AS v FROM money_ledger ${baseWhereSql} AND method = 'CASH'`,
          params
        );
        depositToOwnerCard = safeSum(
          `SELECT COALESCE(SUM(amount),0) AS v FROM money_ledger ${baseWhereSql} AND method = 'CARD'`,
          params
        );
      } else {
        depositToOwnerCash = safeSum(
          `SELECT COALESCE(SUM(amount),0) AS v FROM money_ledger ${baseWhereSql} AND ${typeCol} = 'DEPOSIT_TO_OWNER_CASH'`,
          params
        );
        depositToOwnerCard = safeSum(
          `SELECT COALESCE(SUM(amount),0) AS v FROM money_ledger ${baseWhereSql} AND ${typeCol} = 'DEPOSIT_TO_OWNER_CARD'`,
          params
        );
      }

      // per seller (only if seller_id exists)
      if (ledgerHasSeller) {
        const rows = safeAll(
          `SELECT seller_id AS seller_id,
                  COALESCE(SUM(amount),0) AS deposit_total,
                  COALESCE(SUM(CASE WHEN ${ledgerHasMethod ? "method = 'CASH'" : `${typeCol} = 'DEPOSIT_TO_OWNER_CASH'`} THEN amount ELSE 0 END),0) AS deposit_cash,
                  COALESCE(SUM(CASE WHEN ${ledgerHasMethod ? "method = 'CARD'" : `${typeCol} = 'DEPOSIT_TO_OWNER_CARD'`} THEN amount ELSE 0 END),0) AS deposit_card
           FROM money_ledger
           ${baseWhereSql}
           GROUP BY seller_id
           ORDER BY deposit_total DESC, seller_id ASC`,
          params
        );
        ledgerBySeller = rows || [];
      }
    }
  }


  // --- Sellers for UI ---
  let sellersRaw = [];
  if (hasLedger && ledgerHasBDay && ledgerHasSeller) {
    const activityRows = safeAll(
      `SELECT DISTINCT seller_id AS seller_id
       FROM money_ledger
       WHERE business_day = ?
         AND status = 'POSTED'
         AND seller_id IS NOT NULL
         AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
         AND type IN (
           'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
           'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED',
           'SALE_CANCEL_REVERSE'
         )`,
      [businessDay]
    );
    const acceptedRows = safeAll(
      `SELECT seller_id AS seller_id, COALESCE(SUM(amount),0) AS accepted
       FROM money_ledger
       WHERE business_day = ?
         AND status = 'POSTED'
         AND seller_id IS NOT NULL
         AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
         AND type IN (
           'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
           'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
         )
       GROUP BY seller_id`,
      [businessDay]
    );
    const depMap = new Map((ledgerBySeller || []).map((r) => [r.seller_id, r]));
    const accMap = new Map((acceptedRows || []).map((r) => [r.seller_id, r]));
    const activitySellerIds = (activityRows || []).map((r) => r.seller_id);
    const sellerIds = Array.from(new Set([
      ...Array.from(depMap.keys()),
      ...Array.from(accMap.keys()),
      ...activitySellerIds,
      ...Array.from(sellerPrepayByMethod.keys()),
      ...Array.from(sellerDepositByMethod.keys()),
    ])).sort((a,b)=>Number(a)-Number(b));
    sellersRaw = sellerIds.map((sid) => {
      const acc = Number(accMap.get(sid)?.accepted || 0);
      const dep = Number(depMap.get(sid)?.deposit_total || 0);
      return { seller_id: sid, accepted: acc, deposited: dep, balance: acc - dep };
    });
  }

  const combinedRaw = [...(sellersRaw || [])];

  const sellers = combinedRaw.map((r) => {
    try {
      const accepted = Number(r.accepted || 0);
      const deposited = Number(r.deposited || 0);

      let sellerRole = 'seller';
      let sellerName = `Продавец #${r.seller_id}`;
      try {
        const userRow = db.prepare('SELECT username, role FROM users WHERE id = ?').get(r.seller_id);
        if (userRow?.role) sellerRole = String(userRow.role);
        if (userRow?.username) {
          sellerName = sellerRole === 'dispatcher' ? `Диспетчер: ${userRow.username}` : userRow.username;
        } else if (sellerRole === 'dispatcher') {
          sellerName = `Диспетчер #${r.seller_id}`;
        }
      } catch {}

      const prepayInfo = sellerPrepayByMethod.get(r.seller_id) || { prepay_cash: 0, prepay_card: 0 };
      const sellerDepositInfo = sellerDepositByMethod.get(r.seller_id) || { deposit_cash: 0, deposit_card: 0 };

      const prepay_cash = Number(prepayInfo.prepay_cash || 0);
      const prepay_card = Number(prepayInfo.prepay_card || 0);
      const seller_dep_cash = Number(sellerDepositInfo.deposit_cash || 0);
      const seller_dep_card = Number(sellerDepositInfo.deposit_card || 0);

      const cash_due_to_owner = prepay_cash - seller_dep_cash;
      const terminal_due_to_owner = prepay_card - seller_dep_card;
      const total_due = cash_due_to_owner + terminal_due_to_owner;
      const status = total_due === 0 ? 'CLOSED' : total_due > 0 ? 'DEBT' : 'OVERPAID';
      const netTotal = total_due;

      return {
        seller_id: r.seller_id,
        seller_name: sellerName,
        name: sellerName,
        role: sellerRole,
        accepted,
        deposited,
        balance: total_due,
        cash_balance: cash_due_to_owner,
        terminal_debt: terminal_due_to_owner,
        terminal_due_to_owner,
        status,
        collected_total: prepay_cash + prepay_card,
        collected_cash: prepay_cash,
        collected_card: prepay_card,
        refund_total: 0,
        net_total: netTotal,
        deposit_cash: seller_dep_cash,
        deposit_card: seller_dep_card,
        cash_due_to_owner,
      };
    } catch (e) {
      console.error('[SELLER_MAP_ERROR]', e?.message || e);
      return {
        seller_id: r.seller_id,
        seller_name: `Продавец #${r.seller_id}`,
        name: `Продавец #${r.seller_id}`,
        role: 'seller',
        accepted: 0,
        deposited: 0,
        balance: 0,
        cash_balance: 0,
        terminal_debt: 0,
        terminal_due_to_owner: 0,
        status: 'CLOSED',
        collected_total: 0,
        collected_cash: 0,
        collected_card: 0,
        refund_total: 0,
        net_total: 0,
        deposit_cash: 0,
        deposit_card: 0,
        cash_due_to_owner: 0,
      };
    }
  });
  // --- SALARY_DUE from motivation engine ---
  // Call motivation engine to get payouts for this business day
  let salary_due_total = 0;
  let payoutsByUserId = new Map();
  let motivationWithhold = null;
  
  try {
    const motivationResult = calcMotivationDay(db, businessDay);
    if (motivationResult?.data?.payouts) {
      for (const payout of motivationResult.data.payouts) {
        payoutsByUserId.set(payout.user_id, payout);
        salary_due_total += Number(payout.total || 0);
      }
    }
    
    // Extract withhold info for UI
    if (motivationResult?.data) {
      motivationWithhold = {
        weekly_amount_raw: motivationResult.data.withhold?.weekly_amount_raw ?? 0,
        weekly_amount: motivationResult.data.withhold?.weekly_amount ?? 0,
        season_amount: motivationResult.data.withhold?.season_amount ?? 0,
        season_amount_base: motivationResult.data.withhold?.season_amount_base ?? 0,
        season_amount_from_rounding: motivationResult.data.withhold?.season_amount_from_rounding ?? 0,
        weekly_rounding_to_season_amount: motivationResult.data.withhold?.weekly_rounding_to_season_amount ?? 0,
        dispatcher_rounding_to_season_amount: motivationResult.data.withhold?.dispatcher_rounding_to_season_amount ?? 0,
        payouts_rounding_to_season_amount: motivationResult.data.withhold?.payouts_rounding_to_season_amount ?? 0,
        rounding_to_season_amount_total: motivationResult.data.withhold?.rounding_to_season_amount_total ?? 0,
        dispatcher_amount_total: motivationResult.data.withhold?.dispatcher_amount_total ?? 0,
        fund_total_original: motivationResult.data.withhold?.fund_total_original ?? 0,
        fund_total_after_withhold: motivationResult.data.withhold?.fund_total_after_withhold ?? 0,
        dispatcher_percent_total: motivationResult.data.settings_effective?.dispatcher_withhold_percent_total ?? 0.002,
        dispatcher_percent_per_person: motivationResult.data.settings_effective?.dispatcher_withhold_percent_per_person ?? 0.001,
        active_dispatchers_count: motivationResult.data.dispatchers_today?.active_count ?? 0
      };
    }
    
    // Enrich sellers with salary_due fields
    for (const seller of sellers) {
      const payout = payoutsByUserId.get(seller.seller_id);
      if (payout) {
        seller.salary_due = payout.total;
        seller.salary_due_total = payout.total;
        seller.salary_accrued = payout.total;
      } else {
        seller.salary_due = 0;
        seller.salary_due_total = 0;
        seller.salary_accrued = 0;
      }
    }
  } catch (e) {
    console.error('[SALARY_DUE_CALC] Error:', e?.message || e);
    // On error, all sellers get 0 salary_due
    for (const seller of sellers) {
      seller.salary_due = 0;
      seller.salary_due_total = 0;
      seller.salary_accrued = 0;
    }
  }

  // --- Refunds from money_ledger (SALE_CANCEL_REVERSE) ---
  let refundTotal = 0;
  let refundCash = 0;
  let refundCard = 0;

  if (hasLedger && ledgerHasBDay) {
    const refundWhere = ['business_day = ?'];
    const refundParams = [businessDay];
    if (ledgerHasStatus) refundWhere.push("status = 'POSTED'");
    if (ledgerHasKind) refundWhere.push("kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')");
    refundWhere.push("type = 'SALE_CANCEL_REVERSE'");

    const refundWhereSql = `WHERE ${refundWhere.join(' AND ')}`;

    refundTotal = safeSum(
      `SELECT COALESCE(SUM(ABS(amount)), 0) AS v FROM money_ledger ${refundWhereSql}`,
      refundParams
    );

    if (ledgerHasMethod) {
      refundCash = safeSum(
        `SELECT COALESCE(SUM(CASE WHEN method = 'CASH' THEN ABS(amount) ELSE 0 END), 0) AS v FROM money_ledger ${refundWhereSql}`,
        refundParams
      );
      refundCard = safeSum(
        `SELECT COALESCE(SUM(CASE WHEN method = 'CARD' THEN ABS(amount) ELSE 0 END), 0) AS v FROM money_ledger ${refundWhereSql}`,
        refundParams
      );
      // MIXED refunds - get split from presales
      const mixedRefund = safeSum(
        `SELECT COALESCE(SUM(CASE WHEN method = 'MIXED' THEN ABS(amount) ELSE 0 END), 0) AS v FROM money_ledger ${refundWhereSql}`,
        refundParams
      );
      if (mixedRefund > 0) {
        const mixedSplitRow = safeAll(
          `SELECT
             COALESCE(SUM(p.payment_cash_amount), 0) AS mixed_cash,
             COALESCE(SUM(p.payment_card_amount), 0) AS mixed_card
           FROM money_ledger ml
           JOIN presales p ON p.id = ml.presale_id
           ${refundWhereSql} AND ml.method = 'MIXED'`,
          refundParams
        );
        if (mixedSplitRow && mixedSplitRow[0]) {
          refundCash += Number(mixedSplitRow[0].mixed_cash || 0);
          refundCard += Number(mixedSplitRow[0].mixed_card || 0);
        }
      }
    }
  }

  // --- COLLECTED CASH/CARD from money_ledger (SAME LOGIC AS OWNER) ---
  // This is the authoritative source for collected money, NOT sales_transactions_canonical
  // because money_ledger.business_day = payment date, canonical.business_day = trip_date
  let collectedCash = 0;
  let collectedCard = 0;
  let collectedTotal = 0;

  if (hasLedger && ledgerHasBDay) {
    const ledgerHasCashAmt = hasCol(ledgerCols, 'cash_amount');
    const ledgerHasCardAmt = hasCol(ledgerCols, 'card_amount');

    // Collected total from money_ledger
    collectedTotal = safeSum(
      `SELECT COALESCE(SUM(amount), 0) AS v FROM money_ledger
       WHERE status = 'POSTED'
         AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
         AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
         AND business_day = ?`,
      [businessDay]
    );

    // Cash/Card breakdown with MIXED support (same logic as owner.mjs)
    if (ledgerHasCashAmt && ledgerHasCardAmt) {
      // money_ledger has cash_amount/card_amount columns
      collectedCash = safeSum(
        `SELECT COALESCE(SUM(
          CASE WHEN method = 'CASH' THEN amount
               WHEN method = 'MIXED' THEN COALESCE(cash_amount, 0)
               ELSE 0 END
        ), 0) AS v FROM money_ledger
        WHERE status = 'POSTED'
          AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
          AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
          AND business_day = ?`,
        [businessDay]
      );
      collectedCard = safeSum(
        `SELECT COALESCE(SUM(
          CASE WHEN method = 'CARD' THEN amount
               WHEN method = 'MIXED' THEN COALESCE(card_amount, 0)
               ELSE 0 END
        ), 0) AS v FROM money_ledger
        WHERE status = 'POSTED'
          AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
          AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
          AND business_day = ?`,
        [businessDay]
      );
    } else {
      // Fallback: JOIN with presales for MIXED split
      collectedCash = safeSum(
        `SELECT COALESCE(SUM(
          CASE WHEN ml.method = 'CASH' THEN ml.amount
               WHEN ml.method = 'MIXED' THEN COALESCE(p.payment_cash_amount, ml.amount)
               ELSE 0 END
        ), 0) AS v FROM money_ledger ml
        LEFT JOIN presales p ON p.id = ml.presale_id
        WHERE ml.status = 'POSTED'
          AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
          AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
          AND ml.business_day = ?`,
        [businessDay]
      );
      collectedCard = safeSum(
        `SELECT COALESCE(SUM(
          CASE WHEN ml.method = 'CARD' THEN ml.amount
               WHEN ml.method = 'MIXED' THEN COALESCE(p.payment_card_amount, 0)
               ELSE 0 END
        ), 0) AS v FROM money_ledger ml
        LEFT JOIN presales p ON p.id = ml.presale_id
        WHERE ml.status = 'POSTED'
          AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
          AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
          AND ml.business_day = ?`,
        [businessDay]
      );
    }
  }

  // Net metrics: collected - refunds (SAME LOGIC AS OWNER)
  const netCash = collectedCash - refundCash;
  const netCard = collectedCard - refundCard;
  const netTotal = netCash + netCard;
  // Alias for backward compatibility (deprecated)
  const netRevenue = netTotal;

  // Salary placeholder (13%) like UI note; can be replaced later by motivation engine
  const salary_total = Math.round(Number(salesRevenue || 0) * 0.13);

  // --- Salary payouts from money_ledger (DISPATCHER_SHIFT) ---
  let salaryPaidCash = 0;
  let salaryPaidCard = 0;
  let salaryPaidTotal = 0;

  if (hasLedger && ledgerHasBDay) {
    salaryPaidCash = safeSum(
      `SELECT COALESCE(SUM(amount), 0) AS v FROM money_ledger
       WHERE status = 'POSTED'
         AND kind = 'DISPATCHER_SHIFT'
         AND type = 'SALARY_PAYOUT_CASH'
         AND business_day = ?`,
      [businessDay]
    );
    salaryPaidCard = safeSum(
      `SELECT COALESCE(SUM(amount), 0) AS v FROM money_ledger
       WHERE status = 'POSTED'
         AND kind = 'DISPATCHER_SHIFT'
         AND type = 'SALARY_PAYOUT_CARD'
         AND business_day = ?`,
      [businessDay]
    );
    salaryPaidTotal = salaryPaidCash + salaryPaidCard;
  }

  const futureTripsReserve = calcFutureTripsReserveByPaymentDay({
    businessDay,
    ledgerCols,
    hasLedger,
    ledgerHasBDay,
  });
  const futureTripsReserveCash = Number(futureTripsReserve.cash || 0);
  const futureTripsReserveCard = Number(futureTripsReserve.card || 0);
  const futureTripsReserveTotal = Number(futureTripsReserve.total || 0);
  const unresolvedTripDayCount = Number(futureTripsReserve.unresolvedTripDayCount || 0);

  // --- Dispatcher aggregated totals (DISPATCHER_SHIFT kind) ---
  // Dispatcher operations: deposits to owner, salary payouts
  const dispatcher = {
    collected_total: 0,  // Dispatcher doesn't collect directly; sellers do
    collected_cash: 0,
    collected_card: 0,
    refund_total: 0,
    net_total: 0,
    deposit_cash: depositToOwnerCash,
    deposit_card: depositToOwnerCard,
    salary_paid_cash: salaryPaidCash,
    salary_paid_card: salaryPaidCard,
    salary_paid_total: salaryPaidTotal,
  };

  // --- EXPLAIN section: human-readable breakdown ---
  // This section provides detailed breakdown of cash flows for UI tooltips
  const explain = {
    cashflow_today: {},
    liabilities: {},
    revenue_hint: {},
    unresolved_trip_day_count: 0,
  };

  if (hasLedger && ledgerHasBDay) {
    // 1) PAID SALES TODAY (SALE_ACCEPTED_* for trips today or without trip_date)
    // These are full payments received today
    const paidSalesRows = safeAll(`
      SELECT 
        ml.method,
        COALESCE(SUM(ml.amount), 0) AS total,
        COALESCE(SUM(CASE WHEN ml.method = 'CASH' THEN ml.amount ELSE 0 END), 0) AS cash_total,
        COALESCE(SUM(CASE WHEN ml.method = 'CARD' THEN ml.amount ELSE 0 END), 0) AS card_total
      FROM money_ledger ml
      WHERE ml.business_day = ?
        AND ml.status = 'POSTED'
        AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
        AND ml.type IN ('SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED')
    `, [businessDay]);
    const paidRow = paidSalesRows?.[0] || {};
    explain.cashflow_today.paid_sales_cash = Number(paidRow.cash_total || 0);
    explain.cashflow_today.paid_sales_terminal = Number(paidRow.card_total || 0);

    // 2) PREPAYMENTS TODAY (for hint) + RESERVE OF FUTURE TRIPS (cash/card/total)
    const ledgerHasCashAmt = hasCol(ledgerCols, 'cash_amount');
    const ledgerHasCardAmt = hasCol(ledgerCols, 'card_amount');
    const mixedCashExpr = ledgerHasCashAmt ? 'COALESCE(ml.cash_amount, 0)' : 'COALESCE(p.payment_cash_amount, ml.amount)';
    const mixedCardExpr = ledgerHasCardAmt ? 'COALESCE(ml.card_amount, 0)' : 'COALESCE(p.payment_card_amount, 0)';
    const prepaymentTodayRow = safeAll(`
      SELECT
        COALESCE(SUM(CASE
          WHEN ml.type = 'SALE_PREPAYMENT_CASH' OR ml.method = 'CASH' THEN ml.amount
          WHEN ml.type = 'SALE_PREPAYMENT_MIXED' OR ml.method = 'MIXED' THEN ${mixedCashExpr}
          ELSE 0
        END), 0) AS prepay_cash,
        COALESCE(SUM(CASE
          WHEN ml.type = 'SALE_PREPAYMENT_CARD' OR ml.method = 'CARD' THEN ml.amount
          WHEN ml.type = 'SALE_PREPAYMENT_MIXED' OR ml.method = 'MIXED' THEN ${mixedCardExpr}
          ELSE 0
        END), 0) AS prepay_card
      FROM money_ledger ml
      LEFT JOIN presales p ON p.id = ml.presale_id
      WHERE ml.business_day = ?
        AND ml.status = 'POSTED'
        AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
        AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED')
    `, [businessDay])?.[0] || {};
    const allPrepayCash = Number(prepaymentTodayRow.prepay_cash || 0);
    const allPrepayCard = Number(prepaymentTodayRow.prepay_card || 0);

    explain.liabilities.future_trips_reserve_cash = futureTripsReserveCash;
    explain.liabilities.future_trips_reserve_terminal = futureTripsReserveCard;
    explain.liabilities.future_trips_reserve_total = futureTripsReserveTotal;
    // Legacy aliases (field names kept for backward compatibility).
    explain.liabilities.prepayment_future_cash = futureTripsReserveCash;
    explain.liabilities.prepayment_future_terminal = futureTripsReserveCard;
    explain.cashflow_today.prepayment_today_cash = allPrepayCash;
    explain.cashflow_today.prepayment_today_terminal = allPrepayCard;
    explain.cashflow_today.prepayment_today_total = allPrepayCash + allPrepayCard;
    explain.cashflow_today.future_prepay_share = futureTripsReserveTotal;
    explain.unresolved_trip_day_count = unresolvedTripDayCount;

    // 3) REFUNDS (SALE_CANCEL_REVERSE)
    const refundRows = safeAll(`
      SELECT 
        COALESCE(SUM(CASE WHEN method = 'CASH' THEN ABS(amount) ELSE 0 END), 0) AS refund_cash,
        COALESCE(SUM(CASE WHEN method = 'CARD' THEN ABS(amount) ELSE 0 END), 0) AS refund_card
      FROM money_ledger
      WHERE business_day = ?
        AND status = 'POSTED'
        AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
        AND type = 'SALE_CANCEL_REVERSE'
    `, [businessDay]);
    const refundRow = refundRows?.[0] || {};
    explain.cashflow_today.refund_cash = Number(refundRow.refund_cash || 0);
    explain.cashflow_today.refund_terminal = Number(refundRow.refund_card || 0);

    // 4) OWNER DEPOSITS (already computed above)
    explain.cashflow_today.owner_deposit_cash = depositToOwnerCash;
    explain.cashflow_today.owner_deposit_terminal = depositToOwnerCard;

    // 5) SALARY PAYOUTS (already computed above)
    explain.cashflow_today.salary_paid_cash = salaryPaidCash;
    explain.cashflow_today.salary_paid_terminal = salaryPaidCard;

    // 6) REVENUE HINT - fully paid sales today (estimated)
    explain.revenue_hint.paid_today_cash = explain.cashflow_today.paid_sales_cash + allPrepayCash;
    explain.revenue_hint.paid_today_terminal = explain.cashflow_today.paid_sales_terminal + allPrepayCard;
    explain.revenue_hint.future_liabilities_cash = futureTripsReserveCash;
    explain.revenue_hint.future_liabilities_terminal = futureTripsReserveCard;
    explain.revenue_hint.prepayment_today_total = allPrepayCash + allPrepayCard;
    explain.revenue_hint.note = 'prepayment_today = все предоплаты за сегодня; future_liabilities = оплаты/предоплаты, полученные сегодня за будущие рейсы (обязательства до поездки/возврата)';
  }

  const sellersForResponse = [...sellers];
  if (sellersForResponse.length === 0 && Number(collectedTotal || 0) > 0) {
    sellersForResponse.push({
      seller_id: 0,
      seller_name: 'Диспетчер (источник выручки)',
      name: 'Диспетчер (источник выручки)',
      role: 'dispatcher',
      accepted: Number(collectedTotal || 0),
      deposited: 0,
      balance: 0,
      cash_balance: 0,
      terminal_debt: 0,
      terminal_due_to_owner: 0,
      status: 'CLOSED',
      collected_total: Number(collectedTotal || 0),
      collected_cash: Number(collectedCash || 0),
      collected_card: Number(collectedCard || 0),
      refund_total: 0,
      net_total: 0,
      deposit_cash: 0,
      deposit_card: 0,
      cash_due_to_owner: 0,
      salary_due: 0,
      salary_due_total: 0,
      salary_accrued: 0,
    });
  }
  const sellersAcceptedTotalResponse = sellersForResponse.reduce((sum, r) => sum + Number(r.accepted || 0), 0);
  const sellersDepositedTotalResponse = sellersForResponse.reduce((sum, r) => sum + Number(r.deposited || 0), 0);
  const sellersBalanceTotalResponse = sellersForResponse.reduce((sum, r) => sum + Number(r.balance || 0), 0);
  const sellersDebtTotalResponse = sumPositiveSellerLiabilities(sellersForResponse);
  const ownerCashAvailable = Number(netTotal || 0) - Number(salary_due_total || 0) - sellersDebtTotalResponse;
  const ownerCashAvailableAfterFutureReserveCash = ownerCashAvailable - futureTripsReserveCash;

  // --- Response: keep both nested and flat keys for backward compatibility ---
  res.json({
    ok: true,
    business_day: businessDay,
    source,
    is_closed: source === 'snapshot',

    // UI-friendly totals
    total_revenue: salesRevenue,
    cash_total: salesCash,
    card_total: salesCard,
    salary_total,

    // COLLECTED MONEY (from money_ledger - SAME LOGIC AS OWNER)
    // These are the authoritative fields for "how much money was collected"
    collected_total: collectedTotal,
    collected_cash: collectedCash,
    collected_card: collectedCard,

    // UI-friendly sellers
    sellers: sellersForResponse,
    sellers_accepted_total: sellersAcceptedTotalResponse,
    sellers_deposited_total: sellersDepositedTotalResponse,
    sellers_balance_total: sellersBalanceTotalResponse,

    // Dispatcher totals (DISPATCHER_SHIFT kind aggregated)
    dispatcher,

    // Flat totals (most UIs just read these)
    revenue: salesRevenue,
    qty: salesQty,
    cash: salesCash,
    card: salesCard,

    // Refunds (SALE_CANCEL_REVERSE)
    refund_total: refundTotal,
    refund_cash: refundCash,
    refund_card: refundCard,

    // Net metrics (net_total is primary; net_revenue is deprecated alias)
    net_total: netTotal,
    net_revenue: netRevenue,  // deprecated alias for backward compat
    net_cash: netCash,
    net_card: netCard,

    deposit_cash: depositToOwnerCash,
    deposit_card: depositToOwnerCard,
    deposit_total: depositToOwnerTotal,
    future_trips_reserve_cash: futureTripsReserveCash,
    future_trips_reserve_card: futureTripsReserveCard,
    future_trips_reserve_total: futureTripsReserveTotal,
    reserve_future_trips: {
      cash: futureTripsReserveCash,
      card: futureTripsReserveCard,
      total: futureTripsReserveTotal,
    },

    // Structured (for future expansion)
    sales: {
      revenue: salesRevenue,
      qty: salesQty,
      cash: salesCash,
      card: salesCard,
    },
    refunds: {
      total: refundTotal,
      cash: refundCash,
      card: refundCard,
    },
    net: {
      total: netTotal,
      revenue: netRevenue,  // deprecated alias
      cash: netCash,
      card: netCard,
    },
    collected: {
      total: collectedTotal,
      cash: collectedCash,
      card: collectedCard,
    },
    ledger: {
      deposit_to_owner: {
        total: depositToOwnerTotal,
        cash: depositToOwnerCash,
        card: depositToOwnerCard,
      },
      by_seller: ledgerBySeller,
    },

    // EXPLAIN section for human-readable breakdown
    explain,

    // Debug about schema presence (safe, helps support)
    _schema: {
      sales_transactions_canonical: {
        exists: safeTableExists('sales_transactions_canonical'),
        has_seller_id: hasCol(canonicalCols, 'seller_id'),
        has_payment_method: hasCol(canonicalCols, 'payment_method') || hasCol(canonicalCols, 'method'),
        has_cash_amount: hasCol(canonicalCols, 'cash_amount'),
        has_card_amount: hasCol(canonicalCols, 'card_amount'),
      },
      money_ledger: {
        exists: safeTableExists('money_ledger'),
        has_seller_id: hasCol(ledgerCols, 'seller_id'),
        has_type: hasCol(ledgerCols, 'type'),
        has_event_type: hasCol(ledgerCols, 'event_type'),
        has_method: hasCol(ledgerCols, 'method'),
      },
    },

    // Trip completion status (live: computed)
    open_trips_count: getOpenTripsCount(businessDay),
    all_trips_finished: getOpenTripsCount(businessDay) === 0,

    // Salary payouts (from motivation engine + money_ledger)
    salary_due: salary_due_total,
    salary_due_total: salary_due_total,  // alias for backward compat
    salary_paid_cash: salaryPaidCash,
    salary_paid_card: salaryPaidCard,
    salary_paid_total: salaryPaidTotal,
    sellers_debt_total: sellersDebtTotalResponse,
    owner_cash_available: ownerCashAvailable,
    owner_cash_available_without_future_reserve: ownerCashAvailable,
    owner_cash_available_after_future_reserve_cash: ownerCashAvailableAfterFutureReserveCash,
    
    // Motivation withhold breakdown
    motivation_withhold: motivationWithhold
  });
});

export default router;

