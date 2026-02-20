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
          sellers_json
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

    const sellers_accepted_total = sellersFromSnapshot.reduce((s, r) => s + Number(r.accepted || 0), 0);
    const sellers_deposited_total = sellersFromSnapshot.reduce((s, r) => s + Number(r.deposited || 0), 0);
    const sellers_balance_total = sellersFromSnapshot.reduce((s, r) => s + Number(r.balance || 0), 0);

    const salary_total = Math.round(Number(snap.total_revenue || 0) * 0.13);

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
      sellers: sellersFromSnapshot,
      sellers_accepted_total,
      sellers_deposited_total,
      sellers_balance_total,

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
      salary_paid_cash: Number(snap.salary_paid_cash || 0),
      salary_paid_card: Number(snap.salary_paid_card || 0),
      salary_paid_total: Number(snap.salary_paid_total || 0),
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
  let sellersRaw = null;  // Live calculation always
  // Live fallback: compute balances from money_ledger
  if ((!sellersRaw || !sellersRaw.length) && hasLedger && ledgerHasBDay && ledgerHasSeller) {
    const accWhere = ['business_day = ?'];
    const accParams = [businessDay];
    if (ledgerHasStatus) accWhere.push("status = 'POSTED'");
    if (ledgerHasKind) accWhere.push("kind = 'SELLER_SHIFT'");
    const accWhereSql = `WHERE ${accWhere.join(' AND ')}`;
    const acceptedRows = safeAll(
      `SELECT seller_id AS seller_id, COALESCE(SUM(amount),0) AS accepted FROM money_ledger ${accWhereSql} GROUP BY seller_id`,
      accParams
    );
    const depMap = new Map((ledgerBySeller || []).map((r) => [r.seller_id, r]));
    const accMap = new Map((acceptedRows || []).map((r) => [r.seller_id, r]));
    const sellerIds = Array.from(new Set([
      ...Array.from(depMap.keys()),
      ...Array.from(accMap.keys()),
    ])).sort((a,b)=>Number(a)-Number(b));
    sellersRaw = sellerIds.map((sid) => {
      const acc = Number(accMap.get(sid)?.accepted || 0);
      const dep = Number(depMap.get(sid)?.deposit_total || 0);
      return { seller_id: sid, accepted: acc, deposited: dep, balance: acc - dep };
    });
  }

  const sellers = (sellersRaw || []).map((r) => {
    const accepted = Number(r.accepted || 0);
    const deposited = Number(r.deposited || 0);
    const balance = Number(r.balance ?? (accepted - deposited));
    return {
      seller_id: r.seller_id,
      accepted,
      deposited,
      balance,
      // aliases used by UI
      cash_balance: balance,
      terminal_debt: 0,
      status: balance === 0 ? 'CLOSED' : balance > 0 ? 'DEBT' : 'OVERPAID',
    };
  });

  const sellers_accepted_total = sellers.reduce((s, r) => s + Number(r.accepted || 0), 0);
  const sellers_deposited_total = sellers.reduce((s, r) => s + Number(r.deposited || 0), 0);
  const sellers_balance_total = sellers.reduce((s, r) => s + Number(r.balance || 0), 0);

  // --- Refunds from money_ledger (SALE_CANCEL_REVERSE) ---
  let refundTotal = 0;
  let refundCash = 0;
  let refundCard = 0;

  if (hasLedger && ledgerHasBDay) {
    const refundWhere = ['business_day = ?'];
    const refundParams = [businessDay];
    if (ledgerHasStatus) refundWhere.push("status = 'POSTED'");
    if (ledgerHasKind) refundWhere.push("kind = 'SELLER_SHIFT'");
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
         AND kind = 'SELLER_SHIFT'
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
          AND kind = 'SELLER_SHIFT'
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
          AND kind = 'SELLER_SHIFT'
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
          AND ml.kind = 'SELLER_SHIFT'
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
          AND ml.kind = 'SELLER_SHIFT'
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
    sellers,
    sellers_accepted_total,
    sellers_deposited_total,
    sellers_balance_total,


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

    // Salary payouts (from money_ledger)
    salary_due: 0,  // TEMP: will come from motivation engine
    salary_paid_cash: salaryPaidCash,
    salary_paid_card: salaryPaidCard,
    salary_paid_total: salaryPaidTotal,
  });
});

export default router;