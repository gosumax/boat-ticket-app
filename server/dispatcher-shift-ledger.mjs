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
import { buildShiftCloseBreakdown, parseShiftCloseBreakdown } from './shift-close-breakdown.mjs';
import { findCanonicalShiftClosureRow } from './shift-closure-schema.mjs';

const authenticateToken = auth.authenticateToken || auth.default || auth;
const canDispatchManageSlots = auth.canDispatchManageSlots;

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
    const totalDue = Number(r.net_total ?? r.balance ?? NaN);
    if (Number.isFinite(totalDue)) {
      return sum + Math.max(0, totalDue);
    }
    const cashDue = Number(r.cash_due_to_owner ?? r.cash_balance ?? r.balance ?? 0);
    const terminalDue = Number(r.terminal_due_to_owner ?? r.terminal_debt ?? 0);
    return sum + Math.max(0, cashDue) + Math.max(0, terminalDue);
  }, 0);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function sumPositiveSellerCashDue(rows = []) {
  return (rows || []).reduce((sum, row) => {
    const due = Number(row?.cash_due_to_owner ?? row?.cash_balance ?? row?.cashRemaining ?? 0);
    return sum + Math.max(0, due);
  }, 0);
}

function sumPositiveSellerCardDue(rows = []) {
  return (rows || []).reduce((sum, row) => {
    const due = Number(row?.terminal_due_to_owner ?? row?.terminal_debt ?? row?.terminalDebt ?? 0);
    return sum + Math.max(0, due);
  }, 0);
}

function extractShiftMotivationWithhold(motivationResult) {
  const data = motivationResult?.data;
  if (!data) return null;

  const withhold = data.withhold || {};
  const settingsEffective = data.settings_effective || {};
  const seasonFromRevenue = Number(withhold.season_from_revenue ?? withhold.season_amount ?? 0);
  const seasonFromPrepaymentTransfer = Number(
    withhold.season_from_prepayment_transfer ??
    withhold.season_amount_from_cancelled_prepayment ??
    0
  );
  const seasonTotal = Number(
    withhold.season_total ??
    withhold.season_fund_total ??
    (seasonFromRevenue + seasonFromPrepaymentTransfer)
  );

  return {
    viklif_percent: Number(withhold.viklif_percent ?? 0),
    viklif_amount_raw: Number(withhold.viklif_amount_raw ?? 0),
    viklif_amount: Number(withhold.viklif_amount ?? 0),
    weekly_percent: Number(withhold.weekly_percent ?? 0),
    weekly_percent_configured: Number(withhold.weekly_percent_configured ?? 0),
    season_percent: Number(withhold.season_percent ?? 0),
    weekly_amount_raw: Number(withhold.weekly_amount_raw ?? 0),
    weekly_amount: Number(withhold.weekly_amount ?? 0),
    season_amount: seasonFromRevenue,
    season_from_revenue: seasonFromRevenue,
    season_amount_base: Number(withhold.season_amount_base ?? 0),
    season_amount_from_rounding: Number(withhold.season_amount_from_rounding ?? 0),
    season_fund_total: seasonTotal,
    season_total: seasonTotal,
    season_amount_from_cancelled_prepayment: seasonFromPrepaymentTransfer,
    season_from_prepayment_transfer: seasonFromPrepaymentTransfer,
    viklif_rounding_to_season_amount: Number(withhold.viklif_rounding_to_season_amount ?? 0),
    weekly_rounding_to_season_amount: Number(withhold.weekly_rounding_to_season_amount ?? 0),
    dispatcher_rounding_to_season_amount: Number(withhold.dispatcher_rounding_to_season_amount ?? 0),
    payouts_rounding_to_season_amount: Number(withhold.payouts_rounding_to_season_amount ?? 0),
    rounding_to_season_amount_total: Number(withhold.rounding_to_season_amount_total ?? 0),
    dispatcher_amount_total: Number(withhold.dispatcher_amount_total ?? 0),
    fund_total_original: Number(withhold.fund_total_original ?? 0),
    fund_total_after_withhold: Number(withhold.fund_total_after_withhold ?? data.salary_fund_total ?? 0),
    salary_fund_total: Number(data.salary_fund_total ?? withhold.fund_total_after_withhold ?? 0),
    dispatcher_percent_total: Number(
      withhold.dispatcher_percent_total ??
      settingsEffective.dispatcher_withhold_percent_total ??
      0
    ),
    dispatcher_percent_total_configured: Number(
      withhold.dispatcher_percent_total_configured ??
      settingsEffective.dispatcher_withhold_percent_total_configured ??
      settingsEffective.dispatcher_withhold_percent_total ??
      0
    ),
    dispatcher_percent_per_person: Number(
      withhold.dispatcher_percent_per_person ??
      settingsEffective.dispatcher_withhold_percent_per_person ??
      0
    ),
    active_dispatchers_count: Number(
      withhold.active_dispatchers_count ??
      data.dispatchers_today?.active_count ??
      0
    ),
  };
}

function getFundsWithholdCashToday(motivationWithhold) {
  if (!motivationWithhold) return 0;
  const seasonFromRevenue = Number(
    motivationWithhold.season_from_revenue ??
    motivationWithhold.season_amount ??
    0
  );
  const dispatcherAmount = Number(motivationWithhold.dispatcher_amount_total || 0);
  return roundMoney(
    Number(motivationWithhold.weekly_amount || 0) +
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

export function calcShiftOwnerCashMetrics({
  netCash = 0,
  salaryDueTotal = 0,
  salaryPaidCash = 0,
  salaryPaidTotal = 0,
  sellers = [],
  futureTripsReserveCash = 0,
  fundsWithholdCashToday = 0,
} = {}) {
  const sellerCashDebtTotal = roundMoney(sumPositiveSellerCashDue(sellers));
  const sellerCardDebtTotal = roundMoney(sumPositiveSellerCardDue(sellers));
  const sellerDebtTotal = roundMoney(sellerCashDebtTotal + sellerCardDebtTotal);
  const salaryRemainingTotal = roundMoney(Math.max(0, Number(salaryDueTotal || 0) - Number(salaryPaidTotal || 0)));
  const ownerCashAvailableWithoutFutureReserve = roundMoney(
    Number(netCash || 0) -
    Number(salaryPaidCash || 0) -
    sellerCashDebtTotal -
    salaryRemainingTotal
  );
  const ownerCashAvailableAfterFutureReserveCash = roundMoney(
    ownerCashAvailableWithoutFutureReserve - Number(futureTripsReserveCash || 0)
  );
  const ownerCashAvailableAfterReserveAndFundsCash = roundMoney(
    ownerCashAvailableAfterFutureReserveCash - Number(fundsWithholdCashToday || 0)
  );

  return {
    seller_cash_debt_total: sellerCashDebtTotal,
    seller_card_debt_total: sellerCardDebtTotal,
    seller_debt_total: sellerDebtTotal,
    salary_remaining_total: salaryRemainingTotal,
    owner_cash_available_without_future_reserve: ownerCashAvailableWithoutFutureReserve,
    owner_cash_available_after_future_reserve_cash: ownerCashAvailableAfterFutureReserveCash,
    owner_cash_available_after_reserve_and_funds_cash: ownerCashAvailableAfterReserveAndFundsCash,
    owner_handover_cash_final: ownerCashAvailableAfterReserveAndFundsCash,
  };
}

function isSellerRole(role) {
  return String(role || '').toLowerCase() === 'seller';
}

function isSellerUserId(userId) {
  const id = Number(userId || 0);
  if (!Number.isFinite(id) || id <= 0) return false;
  try {
    const row = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
    return isSellerRole(row?.role);
  } catch {
    return false;
  }
}

function getParticipantCollectedTotal(row) {
  return Number(
    row?.collected_total ??
    row?.accepted ??
    row?.total_collected ??
    row?.personal_revenue_day ??
    0
  );
}

function getParticipantSalaryTotal(row) {
  return Number(
    row?.salary_due_total ??
    row?.salary_due ??
    row?.salary_accrued ??
    row?.total ??
    0
  );
}

function shouldKeepParticipantRow(row) {
  const sellerId = Number(row?.seller_id ?? row?.sellerId ?? row?.id ?? 0);
  if (!Number.isFinite(sellerId) || sellerId <= 0) return false;

  const role = String(row?.role || '').toLowerCase();
  if (role === 'dispatcher') {
    return getParticipantCollectedTotal(row) > 0 || getParticipantSalaryTotal(row) > 0;
  }
  if (isSellerRole(role)) return true;
  return isSellerUserId(sellerId);
}

function applyPayoutFields(row, payout) {
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

function createSyntheticParticipantRowFromPayout(payout) {
  const userId = Number(payout?.user_id || 0);
  const role = String(payout?.role || '').toLowerCase() === 'dispatcher' ? 'dispatcher' : 'seller';
  const personalRevenueDay = Number(payout?.personal_revenue_day || payout?.revenue || 0);
  const participantName = String(
    payout?.name ||
    (role === 'dispatcher' ? `Dispatcher #${userId}` : `Seller #${userId}`)
  );

  return applyPayoutFields({
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
    refund_total: 0,
    net_total: 0,
    deposit_cash: 0,
    deposit_card: 0,
    cash_due_to_owner: 0,
    personal_revenue_day: personalRevenueDay,
  }, payout);
}

function mergeParticipantRowsWithPayouts(rows = [], payoutsByUserId = new Map()) {
  const mergedRows = (rows || []).map((row) => ({ ...row }));
  const rowIndexByUserId = new Map(
    mergedRows.map((row, index) => [Number(row?.seller_id ?? row?.sellerId ?? row?.id ?? 0), index])
  );

  for (const [userId, payout] of payoutsByUserId.entries()) {
    const index = rowIndexByUserId.get(Number(userId));
    if (index === undefined) {
      mergedRows.push(createSyntheticParticipantRowFromPayout(payout));
      rowIndexByUserId.set(Number(userId), mergedRows.length - 1);
      continue;
    }
    mergedRows[index] = applyPayoutFields(mergedRows[index], payout);
  }

  return mergedRows
    .map((row) => {
      const userId = Number(row?.seller_id ?? row?.sellerId ?? row?.id ?? 0);
      return payoutsByUserId.has(userId)
        ? applyPayoutFields(row, payoutsByUserId.get(userId))
        : applyPayoutFields(row, null);
    })
    .filter(shouldKeepParticipantRow);
}

function getReserveTripDayExpr() {
  const presaleCols = safeGetColumns('presales');
  const ledgerCols = safeGetColumns('money_ledger');
  const presaleTripDayExpr = hasCol(presaleCols, 'business_day')
    ? "COALESCE(p.business_day, DATE(p.created_at))"
    : 'DATE(p.created_at)';

  if (hasCol(ledgerCols, 'trip_day')) {
    return `COALESCE(NULLIF(ml.trip_day, ''), ${presaleTripDayExpr})`;
  }

  return presaleTripDayExpr;
}

function getLegacyMixedSplitCorrections({
  businessDay,
  ledgerHasCashAmount = false,
  ledgerHasCardAmount = false,
  hasPresales = false,
} = {}) {
  const empty = {
    rootCashDelta: 0,
    rootCardDelta: 0,
    bySeller: new Map(),
  };

  if (!safeTableExists('money_ledger')) return empty;
  const hasCanonical = safeTableExists('sales_transactions_canonical');
  if (!hasPresales && !hasCanonical) return empty;

  const ledgerCashAmountSelect = ledgerHasCashAmount ? 'ml.cash_amount' : 'NULL';
  const ledgerCardAmountSelect = ledgerHasCardAmount ? 'ml.card_amount' : 'NULL';
  const mixedRowsToday = safeAll(
    `SELECT
       ml.id,
       ml.presale_id,
       ml.seller_id,
       ml.type,
       ABS(ml.amount) AS amount,
       ${ledgerCashAmountSelect} AS ledger_cash_amount,
       ${ledgerCardAmountSelect} AS ledger_card_amount,
       p.payment_cash_amount,
       p.payment_card_amount
     FROM money_ledger ml
     LEFT JOIN presales p ON p.id = ml.presale_id
     WHERE ml.business_day = ?
       AND ml.status = 'POSTED'
       AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
       AND ml.type IN ('SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_MIXED')
     ORDER BY ml.id ASC`,
    [businessDay]
  );

  if (!Array.isArray(mixedRowsToday) || mixedRowsToday.length === 0) {
    return empty;
  }

  const mixedRowsById = new Map(
    mixedRowsToday.map((row) => [Number(row.id || 0), row])
  );
  const presaleIds = Array.from(new Set(
    mixedRowsToday
      .map((row) => Number(row?.presale_id || 0))
      .filter((presaleId) => Number.isFinite(presaleId) && presaleId > 0)
  ));

  if (presaleIds.length === 0) {
    return empty;
  }

  const placeholders = presaleIds.map(() => '?').join(', ');
  const canonicalSplitByPresale = new Map();
  if (hasCanonical) {
    const rows = safeAll(
      `SELECT
         presale_id,
         COALESCE(SUM(cash_amount), 0) AS cash_total,
         COALESCE(SUM(card_amount), 0) AS card_total
       FROM sales_transactions_canonical
       WHERE presale_id IN (${placeholders})
         AND status = 'VALID'
       GROUP BY presale_id`,
      presaleIds
    );

    for (const row of rows || []) {
      canonicalSplitByPresale.set(Number(row.presale_id), {
        cash: Number(row.cash_total || 0),
        card: Number(row.card_total || 0),
      });
    }
  }

  const presaleSplitByPresale = new Map();
  if (hasPresales) {
    const rows = safeAll(
      `SELECT
         id,
         payment_cash_amount,
         payment_card_amount
       FROM presales
       WHERE id IN (${placeholders})`,
      presaleIds
    );

    for (const row of rows || []) {
      presaleSplitByPresale.set(Number(row.id), {
        cash: Number(row.payment_cash_amount || 0),
        card: Number(row.payment_card_amount || 0),
      });
    }
  }

  const historyRows = safeAll(
    `SELECT
       id,
       presale_id,
       type,
       method,
       ABS(amount) AS amount
     FROM money_ledger
     WHERE presale_id IN (${placeholders})
       AND status = 'POSTED'
       AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
       AND type IN (
         'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
         'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED',
         'SALE_CANCEL_REVERSE'
       )
     ORDER BY presale_id ASC, id ASC`,
    presaleIds
  );

  const historyByPresale = new Map();
  for (const row of historyRows || []) {
    const presaleId = Number(row?.presale_id || 0);
    if (!historyByPresale.has(presaleId)) {
      historyByPresale.set(presaleId, []);
    }
    historyByPresale.get(presaleId).push(row);
  }

  const actualMixedSplitByRowId = new Map();
  const resolveTargetSplit = (presaleId) => {
    const canonical = canonicalSplitByPresale.get(presaleId);
    const canonicalTotal = Number(canonical?.cash || 0) + Number(canonical?.card || 0);
    if (canonicalTotal > 0) {
      return canonical;
    }

    const presale = presaleSplitByPresale.get(presaleId);
    const presaleTotal = Number(presale?.cash || 0) + Number(presale?.card || 0);
    if (presaleTotal > 0) {
      return presale;
    }

    return null;
  };

  const resolveMixedSaleSplit = ({ amount, targetCash, targetCard, usedCash, usedCard }) => {
    const normalizedAmount = Math.max(0, Number(amount || 0));
    const normalizedTargetCash = Math.max(0, Number(targetCash || 0));
    const normalizedTargetCard = Math.max(0, Number(targetCard || 0));
    if (!(normalizedAmount > 0) || (normalizedTargetCash + normalizedTargetCard) <= 0) {
      return null;
    }

    let cash = Math.max(0, Math.min(normalizedAmount, normalizedTargetCash - Number(usedCash || 0)));
    let card = Math.max(0, Math.min(normalizedAmount - cash, normalizedTargetCard - Number(usedCard || 0)));
    let residual = roundMoney(normalizedAmount - cash - card);

    if (residual > 0) {
      const cardHeadroom = Math.max(0, normalizedTargetCard - Number(usedCard || 0) - card);
      const addToCard = Math.min(residual, cardHeadroom);
      card += addToCard;
      residual = roundMoney(residual - addToCard);
    }

    if (residual > 0) {
      const cashHeadroom = Math.max(0, normalizedTargetCash - Number(usedCash || 0) - cash);
      const addToCash = Math.min(residual, cashHeadroom);
      cash += addToCash;
      residual = roundMoney(residual - addToCash);
    }

    if (residual > 0) {
      const preferCard = normalizedTargetCard >= normalizedTargetCash;
      if (preferCard) card += residual;
      else cash += residual;
    }

    return {
      cash: roundMoney(cash),
      card: roundMoney(normalizedAmount - cash),
    };
  };

  for (const presaleId of presaleIds) {
    const targetSplit = resolveTargetSplit(presaleId);
    const history = historyByPresale.get(presaleId) || [];
    let runningCash = 0;
    let runningCard = 0;

    for (const row of history) {
      const rowType = String(row?.type || '').toUpperCase();
      const rowMethod = String(row?.method || '').toUpperCase();
      const amount = Math.max(0, Number(row?.amount || 0));

      if (!(amount > 0)) continue;

      if (rowType === 'SALE_PREPAYMENT_CASH' || rowType === 'SALE_ACCEPTED_CASH') {
        runningCash = roundMoney(runningCash + amount);
        continue;
      }

      if (rowType === 'SALE_PREPAYMENT_CARD' || rowType === 'SALE_ACCEPTED_CARD') {
        runningCard = roundMoney(runningCard + amount);
        continue;
      }

      if (rowType === 'SALE_PREPAYMENT_MIXED' || rowType === 'SALE_ACCEPTED_MIXED') {
        const resolved = resolveMixedSaleSplit({
          amount,
          targetCash: targetSplit?.cash,
          targetCard: targetSplit?.card,
          usedCash: runningCash,
          usedCard: runningCard,
        }) || { cash: amount, card: 0 };

        runningCash = roundMoney(runningCash + Number(resolved.cash || 0));
        runningCard = roundMoney(runningCard + Number(resolved.card || 0));

        if (mixedRowsById.has(Number(row.id || 0))) {
          actualMixedSplitByRowId.set(Number(row.id || 0), resolved);
        }
        continue;
      }

      if (rowType === 'SALE_CANCEL_REVERSE') {
        if (rowMethod === 'CARD') {
          runningCard = roundMoney(Math.max(0, runningCard - amount));
          continue;
        }

        if (rowMethod === 'MIXED') {
          const totalRunning = roundMoney(runningCash + runningCard);
          if (totalRunning > 0) {
            const refundCash = Math.min(runningCash, Math.round((amount * runningCash) / totalRunning));
            const refundCard = Math.min(runningCard, amount - refundCash);
            runningCash = roundMoney(Math.max(0, runningCash - refundCash));
            runningCard = roundMoney(Math.max(0, runningCard - refundCard));
          } else {
            runningCash = roundMoney(Math.max(0, runningCash - amount));
          }
          continue;
        }

        runningCash = roundMoney(Math.max(0, runningCash - amount));
      }
    }
  }

  const bySeller = new Map();
  let rootCashDelta = 0;
  let rootCardDelta = 0;

  for (const row of mixedRowsToday) {
    const rowId = Number(row?.id || 0);
    if (!Number.isFinite(rowId) || rowId <= 0) continue;

    const ledgerCash = Number(row?.ledger_cash_amount || 0);
    const ledgerCard = Number(row?.ledger_card_amount || 0);
    const hasLedgerSplit = Math.abs(ledgerCash) > 0 || Math.abs(ledgerCard) > 0;
    if (hasLedgerSplit) continue;

    const fallbackCash = hasLedgerSplit
      ? ledgerCash
      : hasPresales
        ? Number(row?.payment_cash_amount ?? row?.amount ?? 0)
        : Number(row?.amount || 0);
    const fallbackCard = hasLedgerSplit
      ? ledgerCard
      : hasPresales
        ? Number(row?.payment_card_amount ?? 0)
        : 0;

    const actual = actualMixedSplitByRowId.get(rowId);
    if (!actual) continue;

    const cashDelta = roundMoney(Number(actual.cash || 0) - fallbackCash);
    const cardDelta = roundMoney(Number(actual.card || 0) - fallbackCard);

    if (cashDelta === 0 && cardDelta === 0) continue;

    rootCashDelta = roundMoney(rootCashDelta + cashDelta);
    rootCardDelta = roundMoney(rootCardDelta + cardDelta);

    const sellerId = Number(row?.seller_id || 0);
    if (!Number.isFinite(sellerId) || sellerId <= 0) continue;

    if (!bySeller.has(sellerId)) {
      bySeller.set(sellerId, {
        collectedCashDelta: 0,
        collectedCardDelta: 0,
        prepaymentCashDelta: 0,
        prepaymentCardDelta: 0,
      });
    }

    const sellerDelta = bySeller.get(sellerId);
    sellerDelta.collectedCashDelta = roundMoney(sellerDelta.collectedCashDelta + cashDelta);
    sellerDelta.collectedCardDelta = roundMoney(sellerDelta.collectedCardDelta + cardDelta);

    if (String(row?.type || '').toUpperCase() === 'SALE_PREPAYMENT_MIXED') {
      sellerDelta.prepaymentCashDelta = roundMoney(sellerDelta.prepaymentCashDelta + cashDelta);
      sellerDelta.prepaymentCardDelta = roundMoney(sellerDelta.prepaymentCardDelta + cardDelta);
    }
  }

  return {
    rootCashDelta,
    rootCardDelta,
    bySeller,
  };
}

export function calcFutureTripsReserveByPaymentDay({ businessDay, ledgerCols, hasLedger, ledgerHasBDay }) {
  if (!hasLedger || !ledgerHasBDay || !safeTableExists('presales')) {
    return { cash: 0, card: 0, total: 0, unresolvedTripDayCount: 0 };
  }

  const ledgerHasCashAmt = hasCol(ledgerCols, 'cash_amount');
  const ledgerHasCardAmt = hasCol(ledgerCols, 'card_amount');
  const tripDayExpr = getReserveTripDayExpr();
  const mixedCashExpr = ledgerHasCashAmt
    ? `CASE
         WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 OR ABS(COALESCE(ml.card_amount, 0)) > 0
           THEN COALESCE(ml.cash_amount, 0)
         ELSE COALESCE(p.payment_cash_amount, ml.amount)
       END`
    : 'COALESCE(p.payment_cash_amount, ml.amount)';
  const mixedCardExpr = ledgerHasCardAmt
    ? `CASE
         WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 OR ABS(COALESCE(ml.card_amount, 0)) > 0
           THEN COALESCE(ml.card_amount, 0)
         ELSE COALESCE(p.payment_card_amount, 0)
       END`
    : 'COALESCE(p.payment_card_amount, 0)';
  const mixedRefundCashExpr = ledgerHasCashAmt
    ? "CASE WHEN COALESCE(ml.cash_amount, 0) > 0 THEN ABS(COALESCE(ml.cash_amount, 0)) ELSE ABS(COALESCE(p.payment_cash_amount, 0)) END"
    : 'ABS(COALESCE(p.payment_cash_amount, 0))';
  const mixedRefundCardExpr = ledgerHasCardAmt
    ? "CASE WHEN COALESCE(ml.card_amount, 0) > 0 THEN ABS(COALESCE(ml.card_amount, 0)) ELSE ABS(COALESCE(p.payment_card_amount, 0)) END"
    : 'ABS(COALESCE(p.payment_card_amount, 0))';

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
  const refundCashExpr = `CASE
    WHEN ml.method = 'CASH' THEN ABS(ml.amount)
    WHEN ml.method = 'MIXED' THEN ${mixedRefundCashExpr}
    ELSE 0
  END`;
  const refundCardExpr = `CASE
    WHEN ml.method = 'CARD' THEN ABS(ml.amount)
    WHEN ml.method = 'MIXED' THEN ${mixedRefundCardExpr}
    ELSE 0
  END`;

  const reserveRow = safeAll(
    `SELECT
      COALESCE(SUM(CASE
        WHEN ${tripDayExpr} > ? AND ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
        ) THEN ${cashExpr}
        WHEN ${tripDayExpr} > ? AND ml.type = 'SALE_CANCEL_REVERSE' THEN -(${refundCashExpr})
        ELSE 0
      END), 0) AS reserve_cash,
      COALESCE(SUM(CASE
        WHEN ${tripDayExpr} > ? AND ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
        ) THEN ${cardExpr}
        WHEN ${tripDayExpr} > ? AND ml.type = 'SALE_CANCEL_REVERSE' THEN -(${refundCardExpr})
        ELSE 0
      END), 0) AS reserve_card
     FROM money_ledger ml
     LEFT JOIN presales p ON p.id = ml.presale_id
     WHERE ml.business_day = ?
       AND ml.status = 'POSTED'
       AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
       AND ml.type IN (
         'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
         'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED',
         'SALE_CANCEL_REVERSE'
       )`,
    [businessDay, businessDay, businessDay, businessDay, businessDay]
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

export function calcLiveUiLedgerTotals(businessDay) {
  const defaults = {
    live_source: 'ledger',
    owner_cash_today: 0,
    sellers_collect_total: 0,
    sellers: [],
    collected_total: 0,
    collected_cash: 0,
    collected_card: 0,
    collected_split_unallocated: 0,
    refund_total: 0,
    refund_cash: 0,
    refund_card: 0,
    net_total: 0,
    net_cash: 0,
    net_card: 0,
  };

  const hasLedger = safeTableExists('money_ledger');
  if (!hasLedger) return defaults;

  const ledgerCols = safeGetColumns('money_ledger');
  const ledgerHasBDay = hasCol(ledgerCols, 'business_day');
  const ledgerHasType = hasCol(ledgerCols, 'type');
  const ledgerHasSeller = hasCol(ledgerCols, 'seller_id');
  const ledgerHasStatus = hasCol(ledgerCols, 'status');
  const ledgerHasKind = hasCol(ledgerCols, 'kind');
  const ledgerHasMethod = hasCol(ledgerCols, 'method');

  if (!ledgerHasBDay || !ledgerHasType) return defaults;

  const hasPresales = safeTableExists('presales');
  const ledgerHasCashAmount = hasCol(ledgerCols, 'cash_amount');
  const ledgerHasCardAmount = hasCol(ledgerCols, 'card_amount');
  const mixedCashExpr = ledgerHasCashAmount
    ? hasPresales
    ? `CASE
         WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 OR ABS(COALESCE(ml.card_amount, 0)) > 0
           THEN COALESCE(ml.cash_amount, 0)
         ELSE COALESCE(p.payment_cash_amount, ml.amount)
       END`
    : `CASE
         WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 OR ABS(COALESCE(ml.card_amount, 0)) > 0
           THEN COALESCE(ml.cash_amount, 0)
         ELSE ml.amount
       END`
    : hasPresales
    ? 'COALESCE(p.payment_cash_amount, ml.amount)'
    : 'ml.amount';
  const mixedCardExpr = ledgerHasCardAmount
    ? hasPresales
    ? `CASE
         WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 OR ABS(COALESCE(ml.card_amount, 0)) > 0
           THEN COALESCE(ml.card_amount, 0)
         ELSE COALESCE(p.payment_card_amount, 0)
       END`
    : `CASE
         WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 OR ABS(COALESCE(ml.card_amount, 0)) > 0
           THEN COALESCE(ml.card_amount, 0)
         ELSE 0
       END`
    : hasPresales
    ? 'COALESCE(p.payment_card_amount, 0)'
    : '0';
  const mixedRefundCashExpr = ledgerHasCashAmount
    ? `CASE
         WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 THEN ABS(COALESCE(ml.cash_amount, 0))
         ${hasPresales ? "WHEN ABS(COALESCE(p.payment_cash_amount, 0)) > 0 THEN ABS(COALESCE(p.payment_cash_amount, 0))" : ''}
         ELSE ABS(ml.amount)
       END`
    : hasPresales
    ? "CASE WHEN ABS(COALESCE(p.payment_cash_amount, 0)) > 0 THEN ABS(COALESCE(p.payment_cash_amount, 0)) ELSE ABS(ml.amount) END"
    : 'ABS(ml.amount)';
  const mixedRefundCardExpr = ledgerHasCardAmount
    ? `CASE
         WHEN ABS(COALESCE(ml.card_amount, 0)) > 0 THEN ABS(COALESCE(ml.card_amount, 0))
         ${hasPresales ? "WHEN ABS(COALESCE(p.payment_card_amount, 0)) > 0 THEN ABS(COALESCE(p.payment_card_amount, 0))" : ''}
         ELSE 0
       END`
    : hasPresales
    ? 'ABS(COALESCE(p.payment_card_amount, 0))'
    : '0';
  const refundCashSql = ledgerHasMethod
    ? `CASE
         WHEN ml.type = 'SALE_CANCEL_REVERSE' AND ml.method = 'CASH' THEN ABS(ml.amount)
         WHEN ml.type = 'SALE_CANCEL_REVERSE' AND ml.method = 'MIXED' THEN ${mixedRefundCashExpr}
         ELSE 0
       END`
    : `CASE
         WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ${mixedRefundCashExpr}
         ELSE 0
       END`;
  const refundCardSql = ledgerHasMethod
    ? `CASE
         WHEN ml.type = 'SALE_CANCEL_REVERSE' AND ml.method = 'CARD' THEN ABS(ml.amount)
         WHEN ml.type = 'SALE_CANCEL_REVERSE' AND ml.method = 'MIXED' THEN ${mixedRefundCardExpr}
         ELSE 0
       END`
    : `CASE
         WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ${mixedRefundCardExpr}
         ELSE 0
       END`;
  const sellerRefundCashExpr = ledgerHasMethod
    ? `CASE
         WHEN ml.method = 'CASH' THEN ABS(ml.amount)
         WHEN ml.method = 'MIXED' THEN ${mixedRefundCashExpr}
         ELSE 0
       END`
    : mixedRefundCashExpr;
  const sellerRefundCardExpr = ledgerHasMethod
    ? `CASE
         WHEN ml.method = 'CARD' THEN ABS(ml.amount)
         WHEN ml.method = 'MIXED' THEN ${mixedRefundCardExpr}
         ELSE 0
       END`
    : mixedRefundCardExpr;
  const legacyMixedCorrections = getLegacyMixedSplitCorrections({
    businessDay,
    ledgerHasCashAmount,
    ledgerHasCardAmount,
    hasPresales,
  });

  const baseWhere = ['ml.business_day = ?'];
  const baseParams = [businessDay];
  if (ledgerHasStatus) baseWhere.push("ml.status = 'POSTED'");
  if (ledgerHasKind) baseWhere.push("ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')");
  const baseWhereSql = baseWhere.join(' AND ');
  const collectedRow = safeAll(
    `SELECT
       COALESCE(SUM(CASE
         WHEN ml.type IN (
           'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
           'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
         ) THEN ABS(ml.amount)
         ELSE 0
       END), 0) AS collected_total,
       COALESCE(SUM(CASE
         WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH') THEN ABS(ml.amount)
         WHEN ml.type IN ('SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_MIXED') THEN ${mixedCashExpr}
         ELSE 0
       END), 0) AS collected_cash,
       COALESCE(SUM(CASE
         WHEN ml.type IN ('SALE_PREPAYMENT_CARD','SALE_ACCEPTED_CARD') THEN ABS(ml.amount)
         WHEN ml.type IN ('SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_MIXED') THEN ${mixedCardExpr}
         ELSE 0
       END), 0) AS collected_card
     FROM money_ledger ml
     LEFT JOIN presales p ON p.id = ml.presale_id
     WHERE ${baseWhereSql}
       AND ml.type IN (
         'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
         'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
       )`,
    baseParams
  )?.[0] || {};
  const refundRow = safeAll(
    `SELECT
       COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund_total,
       COALESCE(SUM(${refundCashSql}), 0) AS refund_cash,
       COALESCE(SUM(${refundCardSql}), 0) AS refund_card
     FROM money_ledger ml
     LEFT JOIN presales p ON p.id = ml.presale_id
     WHERE ${baseWhereSql}
       AND ml.type = 'SALE_CANCEL_REVERSE'`,
    baseParams
  )?.[0] || {};

  const collectedTotal = Number(collectedRow.collected_total || 0);
  const collectedCash = Number(collectedRow.collected_cash || 0) + Number(legacyMixedCorrections.rootCashDelta || 0);
  const collectedCard = Number(collectedRow.collected_card || 0) + Number(legacyMixedCorrections.rootCardDelta || 0);
  const refundTotal = Number(refundRow.refund_total || 0);
  const refundCash = Number(refundRow.refund_cash || 0);
  const refundCard = Number(refundRow.refund_card || 0);
  const netTotal = roundMoney(collectedTotal - refundTotal);
  const netCash = roundMoney(collectedCash - refundCash);
  const netCard = roundMoney(collectedCard - refundCard);
  const ownerCashToday = roundMoney(collectedTotal - refundTotal);

  if (!ledgerHasSeller) {
    return {
      live_source: 'ledger',
      owner_cash_today: Number(ownerCashToday || 0),
      sellers_collect_total: 0,
      sellers: [],
      collected_total: collectedTotal,
      collected_cash: collectedCash,
      collected_card: collectedCard,
      collected_split_unallocated: 0,
      refund_total: refundTotal,
      refund_cash: refundCash,
      refund_card: refundCard,
      net_total: netTotal,
      net_cash: netCash,
      net_card: netCard,
    };
  }
  const sellerRows = safeAll(
    `SELECT
       ml.seller_id AS seller_id,
       u.username AS seller_name,
       COALESCE(SUM(CASE
         WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH') THEN ABS(ml.amount)
         WHEN ml.type IN ('SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_MIXED') THEN ${mixedCashExpr}
         WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN -(${sellerRefundCashExpr})
         ELSE 0
       END), 0) AS collected_cash,
       COALESCE(SUM(CASE
         WHEN ml.type IN ('SALE_PREPAYMENT_CARD','SALE_ACCEPTED_CARD') THEN ABS(ml.amount)
         WHEN ml.type IN ('SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_MIXED') THEN ${mixedCardExpr}
         WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN -(${sellerRefundCardExpr})
         ELSE 0
       END), 0) AS collected_card,
       COALESCE(SUM(CASE
         WHEN ml.type = 'SALE_PREPAYMENT_CASH' THEN ABS(ml.amount)
         WHEN ml.type = 'SALE_PREPAYMENT_MIXED' THEN ${mixedCashExpr}
         WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN -(${sellerRefundCashExpr})
         ELSE 0
       END), 0) AS prepayment_cash,
       COALESCE(SUM(CASE
         WHEN ml.type = 'SALE_PREPAYMENT_CARD' THEN ABS(ml.amount)
         WHEN ml.type = 'SALE_PREPAYMENT_MIXED' THEN ${mixedCardExpr}
         WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN -(${sellerRefundCardExpr})
         ELSE 0
       END), 0) AS prepayment_card,
       COALESCE(SUM(CASE
         WHEN ml.type IN (
           'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
           'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
         ) THEN ABS(ml.amount)
         WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN -ABS(ml.amount)
         ELSE 0
       END), 0) AS collected_total,
       COALESCE(SUM(CASE
         WHEN ${ledgerHasKind ? "ml.kind = 'SELLER_SHIFT'" : '1 = 1'}
          AND ml.type IN (
            'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
            'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
          ) THEN ABS(ml.amount)
         WHEN ${ledgerHasKind ? "ml.kind = 'SELLER_SHIFT'" : '1 = 1'}
          AND ml.type = 'SALE_CANCEL_REVERSE' THEN -ABS(ml.amount)
         ELSE 0
       END), 0) AS accepted_seller_shift
     FROM money_ledger ml
     LEFT JOIN presales p ON p.id = ml.presale_id
     JOIN users u ON u.id = ml.seller_id AND u.role = 'seller'
     WHERE ${baseWhereSql}
       AND ml.seller_id IS NOT NULL
       ${ledgerHasKind ? "AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')" : ''}
       AND ml.type IN (
         'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
         'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED',
         'SALE_CANCEL_REVERSE'
       )
     GROUP BY ml.seller_id, u.username
     ORDER BY collected_total DESC, ml.seller_id ASC`,
    baseParams
  );

  const depositRows = safeAll(
    `SELECT
       ml.seller_id AS seller_id,
       COALESCE(SUM(CASE
         WHEN ml.type = 'DEPOSIT_TO_OWNER_CASH' ${ledgerHasMethod ? "OR (ml.type LIKE 'DEPOSIT_TO_OWNER%' AND ml.method = 'CASH')" : ''}
         THEN ml.amount
         ELSE 0
       END), 0) AS deposit_cash,
       COALESCE(SUM(CASE
         WHEN ml.type = 'DEPOSIT_TO_OWNER_CARD' ${ledgerHasMethod ? "OR (ml.type LIKE 'DEPOSIT_TO_OWNER%' AND ml.method = 'CARD')" : ''}
         THEN ml.amount
         ELSE 0
       END), 0) AS deposit_card,
       COALESCE(SUM(ml.amount), 0) AS deposit_total
     FROM money_ledger ml
     JOIN users u ON u.id = ml.seller_id AND u.role = 'seller'
     WHERE ml.business_day = ?
       ${ledgerHasStatus ? "AND ml.status = 'POSTED'" : ''}
       ${ledgerHasKind ? "AND ml.kind = 'DISPATCHER_SHIFT'" : ''}
       AND ml.seller_id IS NOT NULL
       AND ml.type LIKE 'DEPOSIT_TO_OWNER%'
     GROUP BY ml.seller_id`,
    [businessDay]
  );

  const salesBySeller = new Map((sellerRows || []).map((r) => [Number(r.seller_id), r]));
  const depositsBySeller = new Map((depositRows || []).map((r) => [Number(r.seller_id), r]));
  const sellerIds = Array.from(new Set([
    ...Array.from(salesBySeller.keys()),
    ...Array.from(depositsBySeller.keys()),
  ])).sort((a, b) => a - b);

  const sellers = sellerIds.map((sellerId) => {
    const sale = salesBySeller.get(sellerId) || {};
    const dep = depositsBySeller.get(sellerId) || {};
    const sellerName = String(
      sale.seller_name ||
      db.prepare('SELECT username FROM users WHERE id = ?').get(sellerId)?.username ||
      `Seller #${sellerId}`
    );

    const mixedCorrection = legacyMixedCorrections.bySeller.get(sellerId) || {};
    const collectedCash = roundMoney(
      Number(sale.collected_cash || 0) + Number(mixedCorrection.collectedCashDelta || 0)
    );
    const collectedCard = roundMoney(
      Number(sale.collected_card || 0) + Number(mixedCorrection.collectedCardDelta || 0)
    );
    const collectedTotal = Number(sale.collected_total || (collectedCash + collectedCard));
    const acceptedSellerShift = Number(sale.accepted_seller_shift ?? collectedTotal);
    const prepaymentCash = roundMoney(
      Number(sale.prepayment_cash || 0) + Number(mixedCorrection.prepaymentCashDelta || 0)
    );
    const prepaymentCard = roundMoney(
      Number(sale.prepayment_card || 0) + Number(mixedCorrection.prepaymentCardDelta || 0)
    );
    const depositCash = Number(dep.deposit_cash || 0);
    const depositCard = Number(dep.deposit_card || 0);
    const depositTotal = Number(dep.deposit_total || 0);

    const cashDueToOwner = roundMoney(Math.max(0, prepaymentCash - depositCash));
    const terminalDueToOwner = roundMoney(Math.max(0, prepaymentCard - depositCard));
    const totalDue = roundMoney(cashDueToOwner + terminalDueToOwner);

    return {
      seller_id: sellerId,
      seller_name: sellerName,
      name: sellerName,
      role: 'seller',
      accepted: acceptedSellerShift,
      deposited: depositTotal,
      balance: totalDue,
      cash_balance: cashDueToOwner,
      terminal_debt: terminalDueToOwner,
      terminal_due_to_owner: terminalDueToOwner,
      status: totalDue === 0 ? 'CLOSED' : totalDue > 0 ? 'DEBT' : 'OVERPAID',
      collected_total: collectedTotal,
      collected_cash: collectedCash,
      collected_card: collectedCard,
      collected_mixed: 0,
      refund_total: 0,
      net_total: totalDue,
      deposit_cash: depositCash,
      deposit_card: depositCard,
      cash_due_to_owner: cashDueToOwner,
    };
  });

  return {
    live_source: 'ledger',
    owner_cash_today: Number(ownerCashToday || 0),
    sellers_collect_total: Number(sumPositiveSellerLiabilities(sellers)),
    sellers,
    collected_total: collectedTotal,
    collected_cash: collectedCash,
    collected_card: collectedCard,
    collected_split_unallocated: 0,
    refund_total: refundTotal,
    refund_cash: refundCash,
    refund_card: refundCard,
    net_total: netTotal,
    net_cash: netCash,
    net_card: netCard,
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

router.get('/summary', authenticateToken, canDispatchManageSlots, (req, res) => {
  const businessDay =
    String(req.query.business_day || req.query.trip_day || req.query.day || '').trim() ||
    getLocalYMD();
  let liveUiTotalsCache = null;
  const getLiveUiTotals = () => {
    if (!liveUiTotalsCache) {
      liveUiTotalsCache = calcLiveUiLedgerTotals(businessDay);
    }
    return liveUiTotalsCache;
  };


  // --- Shift closure snapshot (do not recompute past days) ---
  let closureSnapshot = null;
  let source = 'live';
  const hasClosures = safeTableExists('shift_closures');
  if (hasClosures) {
    try {
      const row = findCanonicalShiftClosureRow(db, businessDay, {
        columns: [
          'id',
          'business_day',
          'closed_at',
          'closed_by',
          'total_revenue',
          'collected_total',
          'collected_cash',
          'collected_card',
          'refund_total',
          'refund_cash',
          'refund_card',
          'net_total',
          'net_cash',
          'net_card',
          'deposit_cash',
          'deposit_card',
          'salary_due',
          'salary_paid_cash',
          'salary_paid_card',
          'salary_paid_total',
          'sellers_json',
          'cashbox_json',
          'calculation_json',
        ],
      });

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
    const storedShiftCloseBreakdown = parseShiftCloseBreakdown(snap.calculation_json);

    // Enhance sellers with extended contract fields (same as live branch)
    // and keep only actual sellers in seller money movement tables.
    const sellers = sellersFromSnapshot.map((r) => {
      const role = String(r.role || '').toLowerCase();
      const deposit_cash = Number(r.deposit_cash || r.deposited_cash || 0);
      const deposit_card = Number(r.deposit_card || r.deposited_card || 0);
      const terminal_due_to_owner = Number(r.terminal_due_to_owner ?? r.terminal_debt ?? 0);
      const snapshotBalance = Number(r.balance ?? 0);
      const cash_due_to_owner = role === 'dispatcher'
        ? Number(r.cash_due_to_owner ?? 0)
        : Number(r.cash_due_to_owner ?? snapshotBalance);
      const accepted = Number(r.accepted ?? r.collected_total ?? 0);
      const deposited = Number(r.deposited ?? (deposit_cash + deposit_card));
      const balance = role === 'dispatcher'
        ? Number(r.balance ?? 0)
        : Number(r.balance ?? (accepted - deposited));
      const collected_cash = role === 'dispatcher'
        ? Number(r.collected_cash || 0)
        : Number(r.collected_cash ?? (cash_due_to_owner + deposit_cash));
      const collected_card = role === 'dispatcher'
        ? Number(r.collected_card || 0)
        : Number(r.collected_card ?? (terminal_due_to_owner + deposit_card));
      const collected_total = Number(
        r.collected_total ??
        (role === 'dispatcher'
          ? (r.personal_revenue_day ?? (collected_cash + collected_card))
          : (collected_cash + collected_card))
      );
      const participantName =
        r.seller_name ||
        r.name ||
        (role === 'dispatcher' ? `Dispatcher #${r.seller_id}` : `РџСЂРѕРґР°РІРµС† #${r.seller_id}`);
      
      return {
        ...r,
        seller_id: Number(r.seller_id || 0),
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
        seller_name: participantName,
        name: participantName,
        role: role || r.role || null,
        accepted: Number(r.accepted ?? collected_total),
        deposited,
        balance,
        collected_total,
        refund_total: Number(r.refund_total || 0),
        net_total: Number(r.net_total ?? balance),
        status: role === 'dispatcher'
          ? String(r.status || 'CLOSED')
          : (balance === 0 ? 'CLOSED' : balance > 0 ? 'DEBT' : 'OVERPAID'),
        salary_accrued: Number(r.salary_accrued || r.salary_due_total || r.salary_due || 0),
        team_part: Number(r.team_part || 0),
        individual_part: Number(r.individual_part || 0),
        total_raw: Number(r.total_raw || 0),
        salary_rounding_to_season: Number(r.salary_rounding_to_season || 0),
        personal_revenue_day: Number(r.personal_revenue_day || collected_total || 0),
      };
    }).filter(shouldKeepParticipantRow);

    const salary_total = Number(snap.salary_due || 0);

    // --- Motivation withhold from engine (snapshot branch) ---
    let motivationWithhold = storedShiftCloseBreakdown?.withhold || null;
    let snapshotPayoutsByUserId = new Map();
    let salaryBase = Number(
      storedShiftCloseBreakdown?.totals?.salary_base ??
      cashboxData?.salary_base ??
      Math.max(0, roundMoney(Number(snap.net_total || 0)))
    );
    if (!storedShiftCloseBreakdown) {
      try {
        const motivationResult = calcMotivationDay(
          db,
          businessDay,
          getShiftCloseMotivationOptions(req.user)
        );
        if (motivationResult?.data) {
          salaryBase = Number(motivationResult.data.salary_base ?? salaryBase);
          motivationWithhold = extractShiftMotivationWithhold(motivationResult);
          if (Array.isArray(motivationResult.data.payouts)) {
            for (const payout of motivationResult.data.payouts) {
              snapshotPayoutsByUserId.set(Number(payout.user_id), payout);
            }
          }
        }
      } catch (e) {
        console.error('[MOTIVATION_WITHHOLD_SNAPSHOT] Error:', e?.message || e);
      }
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

    const sellersForResponse = mergeParticipantRowsWithPayouts(sellers, snapshotPayoutsByUserId);
    const sellersAcceptedTotalResponse = sellersForResponse.reduce((sum, r) => sum + Number(r.accepted || 0), 0);
    const sellersDepositedTotalResponse = sellersForResponse.reduce((sum, r) => sum + Number(r.deposited || 0), 0);
    const sellersBalanceTotalResponse = sellersForResponse.reduce((sum, r) => sum + Number(r.balance || 0), 0);
    const sellersDebtTotalResponse = sumPositiveSellerLiabilities(sellersForResponse);
    const ownerCashAvailable = Number(snap.net_total || 0) - Number(snap.salary_due || 0) - sellersDebtTotalResponse;
    const futureTripsReserveCash = Number(cashboxData?.future_trips_reserve_cash || 0);
    const futureTripsReserveCard = Number(cashboxData?.future_trips_reserve_card || cashboxData?.future_trips_reserve_terminal || 0);
    const futureTripsReserveTotal = Number(cashboxData?.future_trips_reserve_total || (futureTripsReserveCash + futureTripsReserveCard));
    const fundsWithholdCashToday = cashboxData?.funds_withhold_cash_today != null
      ? Number(cashboxData.funds_withhold_cash_today)
      : getFundsWithholdCashToday(motivationWithhold);
    const ownerCashMetrics = calcShiftOwnerCashMetrics({
      netCash: Number(snap.net_cash || 0),
      salaryDueTotal: Number(snap.salary_due || 0),
      salaryPaidCash: Number(snap.salary_paid_cash || 0),
      salaryPaidTotal: Number(snap.salary_paid_total || 0),
      sellers: sellersForResponse,
      futureTripsReserveCash,
      fundsWithholdCashToday,
    });
    const ownerCashAvailableAfterFutureReserveCash = cashboxData?.owner_cash_available_after_future_reserve_cash != null
      ? Number(cashboxData.owner_cash_available_after_future_reserve_cash)
      : ownerCashMetrics.owner_cash_available_after_future_reserve_cash;
    const ownerCashAvailableAfterReserveAndFundsCash = cashboxData?.owner_cash_available_after_reserve_and_funds_cash != null
      ? Number(cashboxData.owner_cash_available_after_reserve_and_funds_cash)
      : ownerCashMetrics.owner_cash_available_after_reserve_and_funds_cash;
    const ownerHandoverCashFinal = cashboxData?.owner_handover_cash_final != null
      ? Number(cashboxData.owner_handover_cash_final)
      : ownerCashMetrics.owner_handover_cash_final;
    const unresolvedTripDayCount = Number(cashboxData?.future_trips_reserve_unresolved_trip_day_count || 0);
    const liveUiTotals = getLiveUiTotals();
    const liveSellersForUi = Array.isArray(liveUiTotals?.sellers) ? liveUiTotals.sellers : [];
    const shiftCloseBreakdown = storedShiftCloseBreakdown || buildShiftCloseBreakdown({
      businessDay,
      source: 'snapshot_fallback',
      sellers: sellersForResponse,
      collectedCash: Number(snap.collected_cash || 0),
      collectedCard: Number(snap.collected_card || 0),
      collectedTotal: Number(snap.collected_total || 0),
      reserveCash: futureTripsReserveCash,
      reserveCard: futureTripsReserveCard,
      reserveTotal: futureTripsReserveTotal,
      salaryBase,
      salaryDueTotal: Number(snap.salary_due || 0),
      salaryPaidCash: Number(snap.salary_paid_cash || 0),
      salaryPaidCard: Number(snap.salary_paid_card || 0),
      salaryPaidTotal: Number(snap.salary_paid_total || 0),
      ownerCashMetrics,
      fundsWithholdCashToday,
      motivationWithhold,
    });

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
      sellers_live: liveSellersForUi,
      sellers_accepted_total: sellersAcceptedTotalResponse,
      sellers_deposited_total: sellersDepositedTotalResponse,
      sellers_balance_total: sellersBalanceTotalResponse,
      sellers_collect_total: Number(shiftCloseBreakdown.totals.collect_from_sellers ?? sellersDebtTotalResponse),
      owner_cash_today: Number(shiftCloseBreakdown.totals.owner_cash_today ?? ownerHandoverCashFinal),
      weekly_fund: Number(shiftCloseBreakdown.totals.weekly_fund ?? 0),
      season_fund_total: Number(shiftCloseBreakdown.totals.season_fund_total ?? 0),
      final_salary_total: Number(shiftCloseBreakdown.totals.final_salary_total ?? snap.salary_due ?? 0),
      salary_to_pay: Number(shiftCloseBreakdown.totals.final_salary_total ?? snap.salary_due ?? 0),

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
      salary_base: Number(shiftCloseBreakdown.totals.salary_base ?? cashboxData?.salary_base ?? salaryBase),
      salary_paid_cash: Number(snap.salary_paid_cash || 0),
      salary_paid_card: Number(snap.salary_paid_card || 0),
      salary_paid_total: Number(snap.salary_paid_total || 0),
      sellers_debt_total: sellersDebtTotalResponse,
      owner_cash_available: ownerCashAvailable,
      owner_cash_available_without_future_reserve: Number(
        shiftCloseBreakdown.totals.owner_cash_before_reserve ?? ownerCashMetrics.owner_cash_available_without_future_reserve
      ),
      owner_cash_available_after_future_reserve_cash: Number(
        shiftCloseBreakdown.totals.owner_cash_after_reserve ?? ownerCashAvailableAfterFutureReserveCash
      ),
      owner_cash_available_after_reserve_and_funds_cash: ownerCashAvailableAfterReserveAndFundsCash,
      owner_handover_cash_final: Number(shiftCloseBreakdown.totals.owner_cash_today ?? ownerHandoverCashFinal),
      funds_withhold_cash_today: Number(shiftCloseBreakdown.totals.funds_withhold_cash_today ?? fundsWithholdCashToday),
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
      motivation_withhold: motivationWithhold,
      shift_close_breakdown: shiftCloseBreakdown
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
    const mixedCashExpr = ledgerHasCashAmount
      ? `CASE
           WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 OR ABS(COALESCE(ml.card_amount, 0)) > 0
             THEN COALESCE(ml.cash_amount, 0)
           ELSE COALESCE(p.payment_cash_amount, 0)
         END`
      : 'COALESCE(p.payment_cash_amount, 0)';
    const mixedCardExpr = ledgerHasCardAmount
      ? `CASE
           WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 OR ABS(COALESCE(ml.card_amount, 0)) > 0
             THEN COALESCE(ml.card_amount, 0)
           ELSE COALESCE(p.payment_card_amount, 0)
         END`
      : 'COALESCE(p.payment_card_amount, 0)';

    // Seller money movement: keep only real sellers (exclude dispatcher/admin/owner users).
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
      JOIN users su ON su.id = ml.seller_id AND su.role = 'seller'
      WHERE ml.business_day = ?
        AND ml.status = 'POSTED'
        AND ml.seller_id IS NOT NULL
        AND ml.kind = 'SELLER_SHIFT'
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
      `SELECT ml.seller_id AS seller_id,
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
       FROM money_ledger ml
       JOIN users su ON su.id = ml.seller_id AND su.role = 'seller'
       WHERE business_day = ?
         AND status = 'POSTED'
         AND kind = 'DISPATCHER_SHIFT'
         AND type LIKE 'DEPOSIT_TO_OWNER%'
         AND ml.seller_id IS NOT NULL
       GROUP BY ml.seller_id`,
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
          `SELECT ml.seller_id AS seller_id,
                  COALESCE(SUM(amount),0) AS deposit_total,
                  COALESCE(SUM(CASE WHEN ${ledgerHasMethod ? "method = 'CASH'" : `${typeCol} = 'DEPOSIT_TO_OWNER_CASH'`} THEN amount ELSE 0 END),0) AS deposit_cash,
                  COALESCE(SUM(CASE WHEN ${ledgerHasMethod ? "method = 'CARD'" : `${typeCol} = 'DEPOSIT_TO_OWNER_CARD'`} THEN amount ELSE 0 END),0) AS deposit_card
           FROM money_ledger ml
           JOIN users su ON su.id = ml.seller_id AND su.role = 'seller'
           ${baseWhereSql}
           AND ml.seller_id IS NOT NULL
           GROUP BY ml.seller_id
           ORDER BY deposit_total DESC, ml.seller_id ASC`,
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
      `SELECT DISTINCT ml.seller_id AS seller_id
       FROM money_ledger ml
       JOIN users su ON su.id = ml.seller_id AND su.role = 'seller'
       WHERE ml.business_day = ?
         AND ml.status = 'POSTED'
         AND ml.seller_id IS NOT NULL
         AND ml.kind = 'SELLER_SHIFT'
         AND ml.type IN (
           'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
           'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED',
           'SALE_CANCEL_REVERSE'
         )`,
      [businessDay]
    );
    const acceptedRows = safeAll(
      `SELECT ml.seller_id AS seller_id, COALESCE(SUM(ml.amount),0) AS accepted
       FROM money_ledger ml
       JOIN users su ON su.id = ml.seller_id AND su.role = 'seller'
       WHERE ml.business_day = ?
         AND ml.status = 'POSTED'
         AND ml.seller_id IS NOT NULL
         AND ml.kind = 'SELLER_SHIFT'
         AND ml.type IN (
           'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
           'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
         )
       GROUP BY ml.seller_id`,
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
  }).filter(shouldKeepParticipantRow);
  const liveUiTotals = getLiveUiTotals();
  const liveUiSellerRows = Array.isArray(liveUiTotals?.sellers) ? liveUiTotals.sellers : [];
  const liveUiSellerIds = new Set(liveUiSellerRows.map((seller) => Number(seller?.seller_id || 0)));
  const baseRowsForResponse = (
    liveUiSellerRows.length > 0
      ? [
          ...liveUiSellerRows,
          ...sellers.filter((seller) => (
            String(seller?.role || '').toLowerCase() !== 'seller' &&
            !liveUiSellerIds.has(Number(seller?.seller_id || 0))
          )),
        ]
      : sellers
  ).map((seller) => ({ ...seller }));

  // --- SALARY_DUE from motivation engine ---
  // Call motivation engine to get payouts for this business day
  let salary_due_total = 0;
  let payoutsByUserId = new Map();
  let motivationWithhold = null;
  let motivationData = null;
  let salary_base = 0;
  
  try {
    const motivationResult = calcMotivationDay(
      db,
      businessDay,
      getShiftCloseMotivationOptions(req.user)
    );
    if (motivationResult?.data?.payouts) {
      for (const payout of motivationResult.data.payouts) {
        payoutsByUserId.set(payout.user_id, payout);
        salary_due_total += Number(payout.total || 0);
      }
    }
    
    // Extract withhold info for UI
    if (motivationResult?.data) {
      motivationData = motivationResult.data;
      salary_base = Number(motivationResult.data.salary_base ?? salary_base);
      motivationWithhold = extractShiftMotivationWithhold(motivationResult);
    }
  } catch (e) {
    console.error('[SALARY_DUE_CALC] Error:', e?.message || e);
  }
  const sellersForResponse = mergeParticipantRowsWithPayouts(baseRowsForResponse, payoutsByUserId);

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

  refundTotal = Number(liveUiTotals?.refund_total ?? refundTotal ?? 0);
  refundCash = Number(liveUiTotals?.refund_cash ?? refundCash ?? 0);
  refundCard = Number(liveUiTotals?.refund_card ?? refundCard ?? 0);

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

    // Cash/Card breakdown with MIXED support (same logic as owner.mjs).
    // When split columns exist but historical rows are empty, fallback to presales split.
    const mixedCashExpr = (ledgerHasCashAmt && ledgerHasCardAmt)
      ? `CASE
           WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 OR ABS(COALESCE(ml.card_amount, 0)) > 0
             THEN COALESCE(ml.cash_amount, 0)
           ELSE COALESCE(p.payment_cash_amount, ml.amount)
         END`
      : 'COALESCE(p.payment_cash_amount, ml.amount)';
    const mixedCardExpr = (ledgerHasCashAmt && ledgerHasCardAmt)
      ? `CASE
           WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 OR ABS(COALESCE(ml.card_amount, 0)) > 0
             THEN COALESCE(ml.card_amount, 0)
           ELSE COALESCE(p.payment_card_amount, 0)
         END`
      : 'COALESCE(p.payment_card_amount, 0)';

    collectedCash = safeSum(
      `SELECT COALESCE(SUM(
        CASE WHEN ml.method = 'CASH' THEN ml.amount
             WHEN ml.method = 'MIXED' THEN ${mixedCashExpr}
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
             WHEN ml.method = 'MIXED' THEN ${mixedCardExpr}
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

  collectedTotal = Number(liveUiTotals?.collected_total ?? collectedTotal ?? 0);
  collectedCash = Number(liveUiTotals?.collected_cash ?? collectedCash ?? 0);
  collectedCard = Number(liveUiTotals?.collected_card ?? collectedCard ?? 0);

  // Net metrics: collected - refunds (SAME LOGIC AS OWNER)
  const netCash = collectedCash - refundCash;
  const netCard = collectedCard - refundCard;
  const netTotal = netCash + netCard;
  // Alias for backward compatibility (deprecated)
  const netRevenue = netTotal;

  // Salary placeholder (13%) like UI note; can be replaced later by motivation engine
  const salary_total = Number(salary_due_total || 0);

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
  salary_base = salary_base || Math.max(0, roundMoney(netTotal - futureTripsReserveTotal));

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
    const mixedCashExpr = ledgerHasCashAmt
      ? `CASE
           WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 OR ABS(COALESCE(ml.card_amount, 0)) > 0
             THEN COALESCE(ml.cash_amount, 0)
           ELSE COALESCE(p.payment_cash_amount, ml.amount)
         END`
      : 'COALESCE(p.payment_cash_amount, ml.amount)';
    const mixedCardExpr = ledgerHasCardAmt
      ? `CASE
           WHEN ABS(COALESCE(ml.cash_amount, 0)) > 0 OR ABS(COALESCE(ml.card_amount, 0)) > 0
             THEN COALESCE(ml.card_amount, 0)
           ELSE COALESCE(p.payment_card_amount, 0)
         END`
      : 'COALESCE(p.payment_card_amount, 0)';
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
    explain.cashflow_today.refund_cash = Number(refundCash || 0);
    explain.cashflow_today.refund_terminal = Number(refundCard || 0);

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

  const liveSource = String(liveUiTotals?.live_source || 'ledger');
  const sellersAcceptedTotalResponse = sellersForResponse.reduce((sum, r) => sum + Number(r.accepted || 0), 0);
  const sellersDepositedTotalResponse = sellersForResponse.reduce((sum, r) => sum + Number(r.deposited || 0), 0);
  const sellersBalanceTotalResponse = sellersForResponse.reduce((sum, r) => sum + Number(r.balance || 0), 0);
  const sellersDebtTotalResponse = sumPositiveSellerLiabilities(sellersForResponse);
  const responseCollectedTotal = Number(liveUiTotals?.collected_total ?? collectedTotal ?? 0);
  const responseCollectedCash = Number(liveUiTotals?.collected_cash ?? collectedCash ?? 0);
  const responseCollectedCard = Number(liveUiTotals?.collected_card ?? collectedCard ?? 0);
  const responseCollectedSplitUnallocated = 0;
  const responseRefundTotal = Number(liveUiTotals?.refund_total ?? refundTotal ?? 0);
  const responseRefundCash = Number(liveUiTotals?.refund_cash ?? refundCash ?? 0);
  const responseRefundCard = Number(liveUiTotals?.refund_card ?? refundCard ?? 0);
  const responseNetTotal = responseCollectedTotal - responseRefundTotal;
  const responseNetCash = responseCollectedCash - responseRefundCash;
  const responseNetCard = responseCollectedCard - responseRefundCard;
  const responseNetRevenue = responseNetTotal;
  const ownerCashAvailable = responseNetTotal - Number(salary_due_total || 0) - sellersDebtTotalResponse;
  const liveSellersForUi = sellersForResponse;
  const sellersCollectTotal = sellersDebtTotalResponse;
  const fundsWithholdCashToday = getFundsWithholdCashToday(motivationWithhold);
  const ownerCashMetrics = calcShiftOwnerCashMetrics({
    netCash: responseNetCash,
    salaryDueTotal: salary_due_total,
    salaryPaidCash,
    salaryPaidTotal,
    sellers: sellersForResponse,
    futureTripsReserveCash,
    fundsWithholdCashToday,
  });
  const ownerCashToday = ownerCashMetrics.owner_handover_cash_final;
  const shiftCloseBreakdown = buildShiftCloseBreakdown({
    businessDay,
    source,
    sellers: sellersForResponse,
    collectedCash: responseCollectedCash,
    collectedCard: responseCollectedCard,
    collectedTotal: responseCollectedTotal,
    reserveCash: futureTripsReserveCash,
    reserveCard: futureTripsReserveCard,
    reserveTotal: futureTripsReserveTotal,
    salaryBase: salary_base,
    salaryDueTotal: salary_due_total,
    salaryPaidCash,
    salaryPaidCard,
    salaryPaidTotal,
    ownerCashMetrics,
    fundsWithholdCashToday,
    motivationData,
    motivationWithhold,
  });

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

    // COLLECTED MONEY (live prefers ACTIVE presales + ACTIVE tickets)
    collected_total: responseCollectedTotal,
    collected_cash: responseCollectedCash,
    collected_card: responseCollectedCard,
    collected_split_unallocated: responseCollectedSplitUnallocated,
    live_source: liveSource,

    // UI-friendly sellers
    sellers: sellersForResponse,
    sellers_live: liveSellersForUi,
    sellers_accepted_total: sellersAcceptedTotalResponse,
    sellers_deposited_total: sellersDepositedTotalResponse,
    sellers_balance_total: sellersBalanceTotalResponse,
    sellers_collect_total: Number(shiftCloseBreakdown.totals.collect_from_sellers ?? sellersCollectTotal),
    owner_cash_today: Number(shiftCloseBreakdown.totals.owner_cash_today ?? ownerCashToday),
    weekly_fund: Number(shiftCloseBreakdown.totals.weekly_fund ?? 0),
    season_fund_total: Number(shiftCloseBreakdown.totals.season_fund_total ?? 0),
    final_salary_total: Number(shiftCloseBreakdown.totals.final_salary_total ?? salary_due_total ?? 0),
    salary_to_pay: Number(shiftCloseBreakdown.totals.final_salary_total ?? salary_due_total ?? 0),

    // Dispatcher totals (DISPATCHER_SHIFT kind aggregated)
    dispatcher,

    // Flat totals (most UIs just read these)
    revenue: salesRevenue,
    qty: salesQty,
    cash: salesCash,
    card: salesCard,

    // Refunds (SALE_CANCEL_REVERSE)
    refund_total: responseRefundTotal,
    refund_cash: responseRefundCash,
    refund_card: responseRefundCard,

    // Net metrics (net_total is primary; net_revenue is deprecated alias)
    net_total: responseNetTotal,
    net_revenue: responseNetRevenue,  // deprecated alias for backward compat
    net_cash: responseNetCash,
    net_card: responseNetCard,

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
      total: responseRefundTotal,
      cash: responseRefundCash,
      card: responseRefundCard,
    },
    net: {
      total: responseNetTotal,
      revenue: responseNetRevenue,  // deprecated alias
      cash: responseNetCash,
      card: responseNetCard,
    },
    collected: {
      total: responseCollectedTotal,
      cash: responseCollectedCash,
      card: responseCollectedCard,
      split_unallocated: responseCollectedSplitUnallocated,
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
    salary_base: Number(shiftCloseBreakdown.totals.salary_base ?? salary_base),
    salary_paid_cash: salaryPaidCash,
    salary_paid_card: salaryPaidCard,
    salary_paid_total: salaryPaidTotal,
    sellers_debt_total: sellersDebtTotalResponse,
    owner_cash_available: ownerCashAvailable,
    owner_cash_available_without_future_reserve: Number(
      shiftCloseBreakdown.totals.owner_cash_before_reserve ?? ownerCashMetrics.owner_cash_available_without_future_reserve
    ),
    owner_cash_available_after_future_reserve_cash: Number(
      shiftCloseBreakdown.totals.owner_cash_after_reserve ?? ownerCashMetrics.owner_cash_available_after_future_reserve_cash
    ),
    owner_cash_available_after_reserve_and_funds_cash: ownerCashMetrics.owner_cash_available_after_reserve_and_funds_cash,
    owner_handover_cash_final: Number(shiftCloseBreakdown.totals.owner_cash_today ?? ownerCashMetrics.owner_handover_cash_final),
    funds_withhold_cash_today: Number(shiftCloseBreakdown.totals.funds_withhold_cash_today ?? fundsWithholdCashToday),
    
    // Motivation withhold breakdown
    motivation_withhold: motivationWithhold,
    shift_close_breakdown: shiftCloseBreakdown
  });
});

export default router;

