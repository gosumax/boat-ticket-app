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

router.get('/summary', authenticateToken, (req, res) => {
  const businessDay =
    String(req.query.business_day || req.query.trip_day || req.query.day || '').trim() ||
    getLocalYMD();


  // --- Shift closure snapshot (do not recompute past days) ---
  let closureRows = null;
  let source = 'live';
  const hasClosures = safeTableExists('shift_closures');
  if (hasClosures) {
    try {
      const rows = db.prepare(`
        SELECT seller_id, accepted, deposited, balance
        FROM shift_closures
        WHERE business_day = ?
        ORDER BY seller_id ASC
      `).all(businessDay);

      if (rows && rows.length) {
        closureRows = rows;
        source = 'shift_closures';
      }
    } catch (e) {
      // fall through to live calculation
    }
  }


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
  let sellersRaw = closureRows;
  // Live fallback: compute balances from money_ledger when no closure snapshot
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

  // Salary placeholder (13%) like UI note; can be replaced later by motivation engine
  const salary_total = Math.round(Number(salesRevenue || 0) * 0.13);

  // --- Response: keep both nested and flat keys for backward compatibility ---
  res.json({
    ok: true,
    business_day: businessDay,
    source,
    is_closed: source === 'shift_closures',

    // UI-friendly totals
    total_revenue: salesRevenue,
    cash_total: salesCash,
    card_total: salesCard,
    salary_total,

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
  });
});

export default router;