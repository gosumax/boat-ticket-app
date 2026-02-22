import express from 'express';
import db from './db.js';
import { getStreakMultiplier, getSellerState } from './seller-motivation-state.mjs';
import { roundDownTo50 } from './utils/money-rounding.mjs';
import { calcMotivationDay } from './motivation/engine.mjs';

const router = express.Router();

// =====================
// Schema-safe helpers
// =====================
function pragmaTableInfo(table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all();
  } catch {
    return [];
  }
}

function hasColumn(table, col) {
  const cols = pragmaTableInfo(table);
  const c = String(col).toLowerCase();
  return cols.some((r) => String(r.name).toLowerCase() === c);
}

function pickFirstExisting(table, candidates, fallback) {
  for (const c of candidates) {
    if (hasColumn(table, c)) return c;
  }
  return fallback;
}

// Business rule:
// - Revenue = SUM(total_price) by TRIP DAY (use presales.business_day if present, else DATE(created_at)).
// - Cash/Card = only customer money received (exclude deposits/salary), from money_ledger POSTED.
// - Pending = revenue - (cash+card) (UI computes it).

function getTripDayExpr() {
  // Use presales.business_day as the reliable source of trip day.
  // After transfers, generated_slots.trip_date may be stale (points to old slot),
  // but business_day is updated to reflect the actual trip date.
  const presaleDayFallback = hasColumn('presales', 'business_day')
    ? 'COALESCE(p.business_day, DATE(p.created_at))'
    : 'DATE(p.created_at)';

  return presaleDayFallback;
}

function salesLedgerWhere() {
  // Only sales-related entries.
  // Keep it conservative to avoid counting deposits/salary.
  // Include both SELLER_SHIFT and DISPATCHER_SHIFT for totals.
  return `(
    (ml.kind='PAYMENT' AND ml.type='PRESALE_PAYMENT')
    OR (ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT') AND (ml.type LIKE 'SALE_ACCEPTED_%' OR ml.type LIKE 'SALE_PREPAYMENT_%'))
  )`;
}

// Helper: generate cash/card CASE expressions with MIXED support
function getCashCardCaseExprs() {
  const hasCashAmt = hasColumn('money_ledger', 'cash_amount');
  const hasCardAmt = hasColumn('money_ledger', 'card_amount');

  if (hasCashAmt && hasCardAmt) {
    // MIXED payments: split by cash_amount/card_amount
    return {
      cash: `CASE WHEN ml.method = 'CASH' THEN ml.amount WHEN ml.method = 'MIXED' THEN COALESCE(ml.cash_amount, 0) ELSE 0 END`,
      card: `CASE WHEN ml.method = 'CARD' THEN ml.amount WHEN ml.method = 'MIXED' THEN COALESCE(ml.card_amount, 0) ELSE 0 END`,
    };
  }
  // money_ledger doesn't have cash_amount/card_amount columns.
  // For MIXED payments, get the split from presales.payment_cash_amount/payment_card_amount
  // Return expressions that reference presales table (must JOIN)
  return {
    cash: `CASE 
      WHEN ml.method = 'CASH' THEN ml.amount 
      WHEN ml.method = 'MIXED' THEN COALESCE(p.payment_cash_amount, ml.amount) 
      WHEN ml.method = 'CARD' THEN 0
      ELSE 0 END`,
    card: `CASE 
      WHEN ml.method = 'CARD' THEN ml.amount 
      WHEN ml.method = 'MIXED' THEN COALESCE(p.payment_card_amount, 0) 
      WHEN ml.method = 'CASH' THEN 0
      ELSE 0 END`,
  };
}

function presetRange(preset) {
  const p = String(preset || 'today');
  // UI compatibility (OwnerBoatsView): today | yesterday | d7 | month | all
  if (p === 'd7') return presetRange('7d');
  if (p === 'month') return presetRange('30d');
  if (p === 'today') {
    return { from: "DATE('now','localtime')", to: "DATE('now','localtime')" };
  }
  if (p === 'yesterday') {
    return { from: "DATE('now','localtime','-1 day')", to: "DATE('now','localtime','-1 day')" };
  }
  if (p === '7d') {
    return { from: "DATE('now','localtime','-6 day')", to: "DATE('now','localtime')" };
  }
  if (p === '30d') {
    return { from: "DATE('now','localtime','-29 day')", to: "DATE('now','localtime')" };
  }
  if (p === '90d') {
    return { from: "DATE('now','localtime','-89 day')", to: "DATE('now','localtime')" };
  }
  // last_nonzero_day handled separately
  return { from: "DATE('now','localtime')", to: "DATE('now','localtime')" };
}

function resolveLastNonzeroDay() {
  const tripDayExpr = getTripDayExpr();
  const row = db
    .prepare(
      `SELECT ${tripDayExpr} AS day, COALESCE(SUM(p.total_price),0) AS revenue
       FROM presales p
       LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
       WHERE p.status='ACTIVE'
       GROUP BY ${tripDayExpr}
       HAVING revenue > 0
       ORDER BY day DESC
       LIMIT 1`
    )
    .get();
  return row?.day || null;
}

// =====================
// GET /api/owner/money/summary?preset=
// Правила:
// - Собрано денег (cash/card/total) — по ДАТЕ ОПЛАТЫ из money_ledger
// - Билеты/Рейсы/Загрузка — по ДАТЕ РЕЙСА из presales.business_day
// - Только status='POSTED' и kind='SELLER_SHIFT'
// =====================
router.get('/money/summary', (req, res) => {
  try {
    // Поддержка явных from/to (приоритет над preset)
    const explicitFrom = req.query.from;
    const explicitTo = req.query.to;
    const preset = String(req.query.preset || 'today');
    let fromExpr, toExpr;
    if (explicitFrom && explicitTo) {
      fromExpr = `'${String(explicitFrom).replace(/'/g, "''")}'`;
      toExpr = `'${String(explicitTo).replace(/'/g, "''")}'`;
    } else {
      const r = presetRange(preset);
      fromExpr = r.from;
      toExpr = r.to;
    }

    // === СОБРАНО ДЕНЕГ: total из money_ledger, cash/card из sales_transactions_canonical ===
    // total — по ДАТЕ ОПЛАТЫ из money_ledger (для обратной совместимости)
    // cash/card — из sales_transactions_canonical где MIXED разнесён по cash_amount/card_amount

    // Total из money_ledger
    const collectedTotalRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS collected_total
         FROM money_ledger
         WHERE status = 'POSTED'
           AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
           AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
           AND DATE(business_day) BETWEEN ${fromExpr} AND ${toExpr}`
      )
      .get();

    // Cash/Card из sales_transactions_canonical (MIXED уже разнесён)
    let collectedCash = 0;
    let collectedCard = 0;
    let usedStc = false;
    try {
      const stcExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions_canonical'`).get();
      if (stcExists) {
        const stcCols = db.prepare(`PRAGMA table_info(sales_transactions_canonical)`).all().map(r => r.name);
        const hasCashAmt = stcCols.includes('cash_amount');
        const hasCardAmt = stcCols.includes('card_amount');
        const hasBusinessDay = stcCols.includes('business_day');

        // DO NOT use STC for collected_cash/collected_card!
        // STC.business_day = trip_date, but collected money must be queried by payment date.
        // Use money_ledger for collected amounts (it has business_day = payment date).
        // STC is used only for pending_amount and paid_by_trip_day (trip_date semantics).
        if (hasCashAmt && hasCardAmt && false) { // Force fallback to money_ledger
          const cashCardRow = db
            .prepare(
              `SELECT
                 COALESCE(SUM(cash_amount), 0) AS collected_cash,
                 COALESCE(SUM(card_amount), 0) AS collected_card
               FROM sales_transactions_canonical
               WHERE status = 'VALID'
                 AND DATE(business_day) BETWEEN ${fromExpr} AND ${toExpr}`
            )
            .get();
          collectedCash = Number(cashCardRow?.collected_cash || 0);
          collectedCard = Number(cashCardRow?.collected_card || 0);
          usedStc = true;
        }
      }
    } catch {
      // Fallback: leave as 0, will be populated from money_ledger below
    }

    // Fallback: если sales_transactions_canonical недоступна, читаем из money_ledger (старая логика)
    // JOIN с presales для MIXED payment split
    if (!usedStc) {
      const cashCardExpr = getCashCardCaseExprs();
      const hasCashAmt = hasColumn('money_ledger', 'cash_amount');
      const hasCardAmt = hasColumn('money_ledger', 'card_amount');
      
      let collectedRow;
      if (hasCashAmt && hasCardAmt) {
        // money_ledger has cash_amount/card_amount columns - no JOIN needed
        collectedRow = db
          .prepare(
            `SELECT
               COALESCE(SUM(${cashCardExpr.cash}), 0) AS collected_cash,
               COALESCE(SUM(${cashCardExpr.card}), 0) AS collected_card
             FROM money_ledger ml
             WHERE ml.status = 'POSTED'
               AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
               AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
               AND DATE(ml.business_day) BETWEEN ${fromExpr} AND ${toExpr}`
          )
          .get();
      } else {
        // money_ledger lacks cash_amount/card_amount - JOIN with presales for MIXED split
        collectedRow = db
          .prepare(
            `SELECT
               COALESCE(SUM(${cashCardExpr.cash}), 0) AS collected_cash,
               COALESCE(SUM(${cashCardExpr.card}), 0) AS collected_card
             FROM money_ledger ml
             LEFT JOIN presales p ON p.id = ml.presale_id
             WHERE ml.status = 'POSTED'
               AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
               AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
               AND DATE(ml.business_day) BETWEEN ${fromExpr} AND ${toExpr}`
          )
          .get();
      }
      collectedCash = Number(collectedRow?.collected_cash || 0);
      collectedCard = Number(collectedRow?.collected_card || 0);
    }

    const collectedTotal = Number(collectedTotalRow?.collected_total || 0);

    // === БИЛЕТЫ/РЕЙСЫ: из presales по ДАТЕ РЕЙСА ===
    // trip_date = generated_slots.trip_date для generated:* слотов, иначе boat_slots.trip_date, иначе fallback
    // Включаем только ACTIVE (исключаем CANCELLED)
    const seatsCol = pickFirstExisting('presales', ['number_of_seats', 'qty', 'seats'], null);
    const ticketsAgg = seatsCol ? `COALESCE(SUM(p.${seatsCol}),0)` : `COUNT(*)`;

    // Проверяем наличие нужных таблиц/колонок для точного trip_date
    const hasGs = hasColumn('generated_slots', 'trip_date');
    const hasBs = hasColumn('boat_slots', 'trip_date');

    let statsRow;
    if (hasGs && hasBs) {
      // Полный JOIN с generated_slots и boat_slots для точного trip_date
      statsRow = db
        .prepare(
          `SELECT
             ${ticketsAgg} AS tickets,
             COUNT(DISTINCT COALESCE(p.slot_uid, p.boat_slot_id)) AS trips
           FROM presales p
           LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
           LEFT JOIN generated_slots gs ON (
             p.slot_uid LIKE 'generated:%' 
             AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER)
           )
           WHERE p.status = 'ACTIVE'
             AND COALESCE(gs.trip_date, bs.trip_date, DATE(p.created_at)) BETWEEN ${fromExpr} AND ${toExpr}`
        )
        .get();
    } else {
      // Fallback: старая логика через getTripDayExpr
      const tripDayExpr = getTripDayExpr();
      statsRow = db
        .prepare(
          `SELECT
             ${ticketsAgg} AS tickets,
             COUNT(DISTINCT COALESCE(p.slot_uid, p.boat_slot_id)) AS trips
           FROM presales p
           LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
           WHERE p.status = 'ACTIVE'
             AND ${tripDayExpr} BETWEEN ${fromExpr} AND ${toExpr}`
        )
        .get();
    }

    // === ЗАГРУЗКА: оценка по generated_slots ===
    let fillPercent = 0;
    try {
      const gsSeatsLeftCol = pickFirstExisting('generated_slots', ['seats_left', 'seatsLeft', 'left'], null);
      const gsCapacityCol = pickFirstExisting('generated_slots', ['capacity', 'cap'], null);
      
      if (gsSeatsLeftCol && gsCapacityCol && hasGs) {
        // Продано: SUM(number_of_seats) по ACTIVE presales на generated slots за период
        // Капасити: SUM(capacity) по generated_slots за период
        const fillRow = db
          .prepare(
            `WITH sold AS (
               SELECT
                 COALESCE(SUM(p.${seatsCol || 'number_of_seats'}),0) AS sold_seats
               FROM presales p
               LEFT JOIN generated_slots gs ON (
                 p.slot_uid LIKE 'generated:%' 
                 AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER)
               )
               WHERE p.status = 'ACTIVE'
                 AND p.slot_uid LIKE 'generated:%'
                 AND gs.trip_date BETWEEN ${fromExpr} AND ${toExpr}
             ),
             caps AS (
               SELECT
                 COALESCE(SUM(gs.${gsCapacityCol}),0) AS total_capacity
               FROM generated_slots gs
               WHERE gs.trip_date BETWEEN ${fromExpr} AND ${toExpr}
                 AND gs.is_active = 1
             )
             SELECT 
               (SELECT sold_seats FROM sold) AS sold_sum,
               (SELECT total_capacity FROM caps) AS cap_sum`
          )
          .get();
        const soldSum = Number(fillRow?.sold_sum || 0);
        const capSum = Number(fillRow?.cap_sum || 0);
        if (capSum > 0) {
          fillPercent = Math.max(0, Math.min(100, Math.round((soldSum / capSum) * 100)));
        }
      } else {
        // Fallback: старая логика через seats_left
        const tripDayExpr = getTripDayExpr();
        const whereRange = `AND ${tripDayExpr} BETWEEN ${fromExpr} AND ${toExpr}`;
        if (gsSeatsLeftCol) {
          const fillRow = db
            .prepare(
              `WITH sold AS (
                 SELECT p.slot_uid AS slot_uid,
                        ${seatsCol ? `COALESCE(SUM(p.${seatsCol}),0)` : `COUNT(*)`} AS sold
                 FROM presales p
                 LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
                 WHERE p.status = 'ACTIVE'
                   AND p.slot_uid LIKE 'generated:%'
                   ${whereRange}
                 GROUP BY p.slot_uid
               ),
               cap AS (
                 SELECT sold.slot_uid AS slot_uid,
                        sold.sold AS sold,
                        (SELECT MAX(COALESCE(gs.${gsSeatsLeftCol},0),0)
                         FROM generated_slots gs
                         WHERE gs.id = CAST(substr(sold.slot_uid, 11) AS INTEGER)
                        ) AS seats_left
                 FROM sold
               )
               SELECT
                 COALESCE(SUM(sold),0) AS sold_sum,
                 COALESCE(SUM(sold + seats_left),0) AS cap_sum
               FROM cap`
            )
            .get();
          const soldSum = Number(fillRow?.sold_sum || 0);
          const capSum = Number(fillRow?.cap_sum || 0);
          if (capSum > 0) {
            fillPercent = Math.max(0, Math.min(100, Math.round((soldSum / capSum) * 100)));
          }
        }
      }
    } catch {
      // ignore
    }

    // === PENDING AMOUNT: ожидает оплаты по ДАТЕ РЕЙСА ===
    // pending = SUM(max(0, total_price - paid_sum)) для ACTIVE presales на период
    // paid_sum из sales_transactions_canonical (cash_amount + card_amount)
    let pendingAmount = 0;
    try {
      const stcExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions_canonical'`).get();
      if (stcExists) {
        const stcCols = db.prepare(`PRAGMA table_info(sales_transactions_canonical)`).all().map(r => r.name);
        const hasCashAmt = stcCols.includes('cash_amount');
        const hasCardAmt = stcCols.includes('card_amount');
        const hasPresaleId = stcCols.includes('presale_id');

        if (hasCashAmt && hasCardAmt && hasPresaleId && hasGs && hasBs) {
          // Используем точный trip_date через JOIN
          const pendingRow = db
            .prepare(
              `WITH paid AS (
                 SELECT presale_id, COALESCE(SUM(cash_amount + card_amount),0) AS paid_sum
                 FROM sales_transactions_canonical
                 WHERE status='VALID'
                 GROUP BY presale_id
               )
               SELECT
                 COALESCE(SUM(CASE
                   WHEN (p.total_price - COALESCE(paid.paid_sum,0)) > 0 THEN (p.total_price - COALESCE(paid.paid_sum,0))
                   ELSE 0
                 END),0) AS sum_pending
               FROM presales p
               LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
               LEFT JOIN generated_slots gs ON (
                 p.slot_uid LIKE 'generated:%' 
                 AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER)
               )
               LEFT JOIN paid ON paid.presale_id = p.id
               WHERE p.status='ACTIVE'
                 AND COALESCE(gs.trip_date, bs.trip_date, DATE(p.created_at)) BETWEEN ${fromExpr} AND ${toExpr}`
            )
            .get();
          pendingAmount = Number(pendingRow?.sum_pending || 0);
        } else if (hasCashAmt && hasCardAmt && hasPresaleId) {
          // Fallback: старая логика через getTripDayExpr
          const tripDayExpr = getTripDayExpr();
          const pendingRow = db
            .prepare(
              `WITH paid AS (
                 SELECT presale_id, COALESCE(SUM(cash_amount + card_amount),0) AS paid_sum
                 FROM sales_transactions_canonical
                 WHERE status='VALID'
                 GROUP BY presale_id
               )
               SELECT
                 COALESCE(SUM(CASE
                   WHEN (p.total_price - COALESCE(paid.paid_sum,0)) > 0 THEN (p.total_price - COALESCE(paid.paid_sum,0))
                   ELSE 0
                 END),0) AS sum_pending
               FROM presales p
               LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
               LEFT JOIN paid ON paid.presale_id = p.id
               WHERE p.status='ACTIVE'
                 AND ${tripDayExpr} BETWEEN ${fromExpr} AND ${toExpr}`
            )
            .get();
          pendingAmount = Number(pendingRow?.sum_pending || 0);
        }
      }
    } catch {
      // Fallback below
    }

    // Fallback: если stc недоступна, используем money_ledger
    if (pendingAmount === 0) {
      try {
        const tripDayExpr = getTripDayExpr();
        const pendingRow = db
          .prepare(
            `WITH paid AS (
               SELECT presale_id, COALESCE(SUM(amount),0) AS paid_sum
               FROM money_ledger ml
               WHERE ml.status='POSTED'
                 AND ${salesLedgerWhere()}
               GROUP BY presale_id
             )
             SELECT
               COALESCE(SUM(CASE
                 WHEN (p.total_price - COALESCE(paid.paid_sum,0)) > 0 THEN (p.total_price - COALESCE(paid.paid_sum,0))
                 ELSE 0
               END),0) AS sum_pending
             FROM presales p
             LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
             LEFT JOIN paid ON paid.presale_id = p.id
             WHERE p.status='ACTIVE'
               AND ${tripDayExpr} BETWEEN ${fromExpr} AND ${toExpr}`
          )
          .get();
        pendingAmount = Number(pendingRow?.sum_pending || 0);
      } catch {
        // ignore
      }
    }

    // === PAID BY TRIP DAY: оплачено за рейсы по ДАТЕ РЕЙСА ===
    // revenue/cash/card из sales_transactions_canonical, привязка к trip_date через presales
    let paidByTripDay = { revenue: 0, cash: 0, card: 0 };
    try {
      const stcExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions_canonical'`).get();
      if (stcExists) {
        const stcCols = db.prepare(`PRAGMA table_info(sales_transactions_canonical)`).all().map(r => r.name);
        const hasCashAmt = stcCols.includes('cash_amount');
        const hasCardAmt = stcCols.includes('card_amount');
        const hasPresaleId = stcCols.includes('presale_id');

        if (hasCashAmt && hasCardAmt && hasPresaleId && hasGs && hasBs) {
          // Используем точный trip_date через JOIN
          const paidRow = db
            .prepare(
              `SELECT
                 COALESCE(SUM(stc.cash_amount + stc.card_amount), 0) AS revenue,
                 COALESCE(SUM(stc.cash_amount), 0) AS cash,
                 COALESCE(SUM(stc.card_amount), 0) AS card
               FROM sales_transactions_canonical stc
               JOIN presales p ON p.id = stc.presale_id
               LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
               LEFT JOIN generated_slots gs ON (
                 p.slot_uid LIKE 'generated:%' 
                 AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER)
               )
               WHERE stc.status = 'VALID'
                 AND COALESCE(gs.trip_date, bs.trip_date, DATE(p.created_at)) BETWEEN ${fromExpr} AND ${toExpr}`
            )
            .get();
          paidByTripDay = {
            revenue: Number(paidRow?.revenue || 0),
            cash: Number(paidRow?.cash || 0),
            card: Number(paidRow?.card || 0),
          };
        } else if (hasCashAmt && hasCardAmt && hasPresaleId) {
          // Fallback: старая логика через getTripDayExpr
          const tripDayExpr = getTripDayExpr();
          const paidRow = db
            .prepare(
              `SELECT
                 COALESCE(SUM(stc.cash_amount + stc.card_amount), 0) AS revenue,
                 COALESCE(SUM(stc.cash_amount), 0) AS cash,
                 COALESCE(SUM(stc.card_amount), 0) AS card
               FROM sales_transactions_canonical stc
               JOIN presales p ON p.id = stc.presale_id
               LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
               WHERE stc.status = 'VALID'
                 AND ${tripDayExpr} BETWEEN ${fromExpr} AND ${toExpr}`
            )
            .get();
          paidByTripDay = {
            revenue: Number(paidRow?.revenue || 0),
            cash: Number(paidRow?.cash || 0),
            card: Number(paidRow?.card || 0),
          };
        }
      }
    } catch {
      // Fallback below
    }

    // Fallback: если stc недоступна, используем money_ledger
    if (paidByTripDay.revenue === 0 && paidByTripDay.cash === 0 && paidByTripDay.card === 0) {
      try {
        const tripDayExpr = getTripDayExpr();
        const cashCardExpr = getCashCardCaseExprs();
        const paidRow = db
          .prepare(
            `SELECT
               COALESCE(SUM(ml.amount), 0) AS revenue,
               COALESCE(SUM(${cashCardExpr.cash}), 0) AS cash,
               COALESCE(SUM(${cashCardExpr.card}), 0) AS card
             FROM money_ledger ml
             JOIN presales p ON p.id = ml.presale_id
             LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
             WHERE ml.status = 'POSTED'
               AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
               AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
               AND ${tripDayExpr} BETWEEN ${fromExpr} AND ${toExpr}`
          )
          .get();
        paidByTripDay = {
          revenue: Number(paidRow?.revenue || 0),
          cash: Number(paidRow?.cash || 0),
          card: Number(paidRow?.card || 0),
        };
      } catch {
        // ignore
      }
    }

    const tickets = Number(statsRow?.tickets || 0);
    const trips = Number(statsRow?.trips || 0);

    // === REFUNDS: из money_ledger (SALE_CANCEL_REVERSE) ===
    // Возвраты по ДАТЕ ОПЛАТЫ (business_day) - отрицательные суммы
    let refundTotal = 0;
    let refundCash = 0;
    let refundCard = 0;

    // Check if money_ledger has cash_amount/card_amount columns
    const mlHasCashAmt = hasColumn('money_ledger', 'cash_amount');
    const mlHasCardAmt = hasColumn('money_ledger', 'card_amount');

    if (mlHasCashAmt && mlHasCardAmt) {
      // money_ledger has split columns - direct query
      const refundRow = db
        .prepare(
          `SELECT
             COALESCE(SUM(ABS(amount)), 0) AS refund_total,
             COALESCE(SUM(ABS(cash_amount)), 0) AS refund_cash,
             COALESCE(SUM(ABS(card_amount)), 0) AS refund_card
           FROM money_ledger
           WHERE status = 'POSTED'
             AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
             AND type = 'SALE_CANCEL_REVERSE'
             AND DATE(business_day) BETWEEN ${fromExpr} AND ${toExpr}`
        )
        .get();
      refundTotal = Number(refundRow?.refund_total || 0);
      refundCash = Number(refundRow?.refund_cash || 0);
      refundCard = Number(refundRow?.refund_card || 0);
    } else {
      // money_ledger lacks split columns - use method field + JOIN with presales for MIXED
      // refund_total
      refundTotal = Number(
        db
          .prepare(
            `SELECT COALESCE(SUM(ABS(amount)), 0) AS refund_total
             FROM money_ledger
             WHERE status = 'POSTED'
               AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
               AND type = 'SALE_CANCEL_REVERSE'
               AND DATE(business_day) BETWEEN ${fromExpr} AND ${toExpr}`
          )
          .get()?.refund_total || 0
      );

      // refund_cash / refund_card: use method for CASH/CARD, JOIN presales for MIXED
      const refundSplitRow = db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN ml.method = 'CASH' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund_cash,
             COALESCE(SUM(CASE WHEN ml.method = 'CARD' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund_card,
             COALESCE(SUM(CASE WHEN ml.method = 'MIXED' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund_mixed
           FROM money_ledger ml
           WHERE ml.status = 'POSTED'
             AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
             AND ml.type = 'SALE_CANCEL_REVERSE'
             AND DATE(ml.business_day) BETWEEN ${fromExpr} AND ${toExpr}`
        )
        .get();

      refundCash = Number(refundSplitRow?.refund_cash || 0);
      refundCard = Number(refundSplitRow?.refund_card || 0);

      // For MIXED refunds, get split from presales.payment_cash_amount/payment_card_amount
      const refundMixed = Number(refundSplitRow?.refund_mixed || 0);
      if (refundMixed > 0) {
        const mixedSplitRow = db
          .prepare(
            `SELECT
               COALESCE(SUM(p.payment_cash_amount), 0) AS mixed_cash,
               COALESCE(SUM(p.payment_card_amount), 0) AS mixed_card
             FROM money_ledger ml
             JOIN presales p ON p.id = ml.presale_id
             WHERE ml.status = 'POSTED'
               AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
               AND ml.type = 'SALE_CANCEL_REVERSE'
               AND ml.method = 'MIXED'
               AND DATE(ml.business_day) BETWEEN ${fromExpr} AND ${toExpr}`
          )
          .get();
        refundCash += Number(mixedSplitRow?.mixed_cash || 0);
        refundCard += Number(mixedSplitRow?.mixed_card || 0);
      }
    }

    // === NET: collected - refunds ===
    const netTotal = collectedTotal - refundTotal;
    const netCash = collectedCash - refundCash;
    const netCard = collectedCard - refundCard;

    return res.json({
      ok: true,
      data: {
        preset,
        range: { from: null, to: null },
        totals: {
          revenue: collectedTotal,  // backward compat
          cash: collectedCash,
          card: collectedCard,
          collected_total: collectedTotal,
          collected_cash: collectedCash,
          collected_card: collectedCard,
          // Refund metrics
          refund_total: refundTotal,
          refund_cash: refundCash,
          refund_card: refundCard,
          // Net metrics
          net_total: netTotal,
          net_cash: netCash,
          net_card: netCard,
          pending_amount: pendingAmount,
          tickets,
          trips,
          fillPercent,
        },
        paid_by_trip_day: paidByTripDay,
      },
      meta: { warnings: [] },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'money summary failed' });
  }
});

// =====================
// GET /api/owner/money/pending-by-day?day=today|tomorrow|day2
// pending is grouped by TRIP DAY (same trip day expression)
// paid из sales_transactions_canonical, fallback на money_ledger
// =====================
function handlePendingByDay(req, res) {
  try {
    // Support both query param and path param
    const day = String(req.params?.day || req.query?.day || 'today');
    let targetExpr = "DATE('now','localtime')";
    if (day === 'tomorrow' || day === 'next') targetExpr = "DATE('now','localtime','+1 day')";
    if (day === 'day2' || day === 'day_after' || day === 'after_tomorrow' || day === 'dayAfter' || day === 'afterTomorrow') targetExpr = "DATE('now','localtime','+2 day')";

    const tripDayExpr = getTripDayExpr();

    const seatsCol = pickFirstExisting('presales', ['number_of_seats', 'qty', 'seats'], null);
    const ticketsAgg = seatsCol ? `COALESCE(SUM(p.${seatsCol}),0)` : `COUNT(*)`;

    // Попробовать использовать sales_transactions_canonical для paid
    let usedStc = false;
    let row;

    try {
      const stcExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions_canonical'`).get();
      if (stcExists) {
        const stcCols = db.prepare(`PRAGMA table_info(sales_transactions_canonical)`).all().map(r => r.name);
        const hasCashAmt = stcCols.includes('cash_amount');
        const hasCardAmt = stcCols.includes('card_amount');
        const hasPresaleId = stcCols.includes('presale_id');

        if (hasCashAmt && hasCardAmt && hasPresaleId) {
          row = db
            .prepare(
              `WITH paid AS (
                 SELECT presale_id, COALESCE(SUM(cash_amount + card_amount),0) AS paid_sum
                 FROM sales_transactions_canonical
                 WHERE status='VALID'
                 GROUP BY presale_id
               )
               SELECT
                 COALESCE(SUM(CASE
                   WHEN (p.total_price - COALESCE(paid.paid_sum,0)) > 0 THEN (p.total_price - COALESCE(paid.paid_sum,0))
                   ELSE 0
                 END),0) AS sum_pending,
                 ${ticketsAgg} AS tickets,
                 COUNT(DISTINCT COALESCE(p.slot_uid, p.boat_slot_id)) AS trips
               FROM presales p
               LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
               LEFT JOIN paid ON paid.presale_id = p.id
               WHERE p.status='ACTIVE'
                 AND ${tripDayExpr} = ${targetExpr}
                 AND (p.total_price - COALESCE(paid.paid_sum,0)) > 0`
            )
            .get();
          usedStc = true;
        }
      }
    } catch {
      // Fallback below
    }

    // Fallback: если stc недоступна, используем money_ledger (старая логика)
    if (!usedStc) {
      row = db
        .prepare(
          `WITH paid AS (
             SELECT presale_id, COALESCE(SUM(amount),0) AS paid_sum
             FROM money_ledger ml
             WHERE ml.status='POSTED'
               AND ${salesLedgerWhere()}
             GROUP BY presale_id
           )
           SELECT
             COALESCE(SUM(CASE
               WHEN (p.total_price - COALESCE(paid.paid_sum,0)) > 0 THEN (p.total_price - COALESCE(paid.paid_sum,0))
               ELSE 0
             END),0) AS sum_pending,
             ${ticketsAgg} AS tickets,
             COUNT(DISTINCT COALESCE(p.slot_uid, p.boat_slot_id)) AS trips
           FROM presales p
           LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
           LEFT JOIN paid ON paid.presale_id = p.id
           WHERE p.status='ACTIVE'
             AND ${tripDayExpr} = ${targetExpr}
             AND (p.total_price - COALESCE(paid.paid_sum,0)) > 0`
        )
        .get();
    }

    return res.json({
      ok: true,
      data: {
        day,
        // Keep multiple aliases for frontend compatibility.
        // Different UI revisions may read different keys (sum / sum_pending / amount / total).
        sum: Number(row?.sum_pending || 0),
        sum_pending: Number(row?.sum_pending || 0),
        amount: Number(row?.sum_pending || 0),
        total: Number(row?.sum_pending || 0),
        tickets: Number(row?.tickets || 0),
        trips: Number(row?.trips || 0),
      },
      meta: { warnings: [] },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'pending-by-day failed' });
  }
}

router.get('/money/pending-by-day', handlePendingByDay);
router.get('/money/pending-by-day/:day', handlePendingByDay);

// =====================
// GET /api/owner/money/compare-days?preset=7d|30d|90d
// График "Собрано по дням" — revenue из money_ledger, cash/card из sales_transactions_canonical
// =====================
router.get('/money/compare-days', (req, res) => {
  try {
    const preset = String(req.query.preset || '7d');
    const r = presetRange(preset);

    // Revenue из money_ledger по ДАТЕ ОПЛАТЫ (business_day)
    const revenueRows = db
      .prepare(
        `SELECT
           DATE(business_day) AS day,
           COALESCE(SUM(amount), 0) AS revenue
         FROM money_ledger
         WHERE status = 'POSTED'
           AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
           AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
           AND DATE(business_day) BETWEEN ${r.from} AND ${r.to}
         GROUP BY DATE(business_day)
         ORDER BY day ASC`
      )
      .all();

    // Cash/Card из money_ledger + presales JOIN для MIXED split
    // NOTE: Do NOT use STC here! STC.business_day = trip_date, but we need payment date.
    const cashCardByDay = new Map();
    {
      const cashCardExpr = getCashCardCaseExprs();
      const hasCashAmt = hasColumn('money_ledger', 'cash_amount');
      const hasCardAmt = hasColumn('money_ledger', 'card_amount');
      
      let mlRows;
      if (hasCashAmt && hasCardAmt) {
        // money_ledger has cash_amount/card_amount - no JOIN needed
        mlRows = db
          .prepare(
            `SELECT
               DATE(ml.business_day) AS day,
               COALESCE(SUM(${cashCardExpr.cash}), 0) AS cash,
               COALESCE(SUM(${cashCardExpr.card}), 0) AS card
             FROM money_ledger ml
             WHERE ml.status = 'POSTED'
               AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
               AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
               AND DATE(ml.business_day) BETWEEN ${r.from} AND ${r.to}
             GROUP BY DATE(ml.business_day)`
          )
          .all();
      } else {
        // money_ledger lacks cash_amount/card_amount - JOIN with presales for MIXED split
        mlRows = db
          .prepare(
            `SELECT
               DATE(ml.business_day) AS day,
               COALESCE(SUM(${cashCardExpr.cash}), 0) AS cash,
               COALESCE(SUM(${cashCardExpr.card}), 0) AS card
             FROM money_ledger ml
             LEFT JOIN presales p ON p.id = ml.presale_id
             WHERE ml.status = 'POSTED'
               AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
               AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
               AND DATE(ml.business_day) BETWEEN ${r.from} AND ${r.to}
             GROUP BY DATE(ml.business_day)`
          )
          .all();
      }
      for (const row of mlRows) {
        cashCardByDay.set(row.day, { cash: Number(row.cash || 0), card: Number(row.card || 0) });
      }
    }

    // === REFUNDS BY DAY: из money_ledger (SALE_CANCEL_REVERSE) ===
    const refundsByDay = new Map();
    {
      const refundRows = db
        .prepare(
          `SELECT
             DATE(business_day) AS day,
             COALESCE(SUM(ABS(amount)), 0) AS refund_total
           FROM money_ledger
           WHERE status = 'POSTED'
             AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
             AND type = 'SALE_CANCEL_REVERSE'
             AND DATE(business_day) BETWEEN ${r.from} AND ${r.to}
           GROUP BY DATE(business_day)`
        )
        .all();

      // Get refund cash/card split by day
      const hasCashAmt = hasColumn('money_ledger', 'cash_amount');
      const hasCardAmt = hasColumn('money_ledger', 'card_amount');

      if (hasCashAmt && hasCardAmt) {
        // money_ledger has split columns
        const refundSplitRows = db
          .prepare(
            `SELECT
               DATE(business_day) AS day,
               COALESCE(SUM(ABS(cash_amount)), 0) AS refund_cash,
               COALESCE(SUM(ABS(card_amount)), 0) AS refund_card
             FROM money_ledger
             WHERE status = 'POSTED'
               AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
               AND type = 'SALE_CANCEL_REVERSE'
               AND DATE(business_day) BETWEEN ${r.from} AND ${r.to}
             GROUP BY DATE(business_day)`
          )
          .all();
        for (const row of refundSplitRows) {
          refundsByDay.set(row.day, {
            refund_total: Number(refundRows.find(r => r.day === row.day)?.refund_total || 0),
            refund_cash: Number(row.refund_cash || 0),
            refund_card: Number(row.refund_card || 0),
          });
        }
      } else {
        // Use method field for split
        const refundSplitRows = db
          .prepare(
            `SELECT
               DATE(ml.business_day) AS day,
               COALESCE(SUM(CASE WHEN ml.method = 'CASH' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund_cash,
               COALESCE(SUM(CASE WHEN ml.method = 'CARD' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund_card
             FROM money_ledger ml
             WHERE ml.status = 'POSTED'
               AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
               AND ml.type = 'SALE_CANCEL_REVERSE'
               AND DATE(ml.business_day) BETWEEN ${r.from} AND ${r.to}
             GROUP BY DATE(ml.business_day)`
          )
          .all();
        for (const row of refundSplitRows) {
          refundsByDay.set(row.day, {
            refund_total: Number(refundRows.find(r => r.day === row.day)?.refund_total || 0),
            refund_cash: Number(row.refund_cash || 0),
            refund_card: Number(row.refund_card || 0),
          });
        }
        // Handle MIXED refunds
        const mixedRefundRows = db
          .prepare(
            `SELECT
               DATE(ml.business_day) AS day,
               COALESCE(SUM(p.payment_cash_amount), 0) AS mixed_cash,
               COALESCE(SUM(p.payment_card_amount), 0) AS mixed_card
             FROM money_ledger ml
             JOIN presales p ON p.id = ml.presale_id
             WHERE ml.status = 'POSTED'
               AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
               AND ml.type = 'SALE_CANCEL_REVERSE'
               AND ml.method = 'MIXED'
               AND DATE(ml.business_day) BETWEEN ${r.from} AND ${r.to}
             GROUP BY DATE(ml.business_day)`
          )
          .all();
        for (const row of mixedRefundRows) {
          const existing = refundsByDay.get(row.day) || { refund_total: 0, refund_cash: 0, refund_card: 0 };
          existing.refund_cash += Number(row.mixed_cash || 0);
          existing.refund_card += Number(row.mixed_card || 0);
          refundsByDay.set(row.day, existing);
        }
      }

      // Add refund_total entries without split
      for (const row of refundRows) {
        if (!refundsByDay.has(row.day)) {
          refundsByDay.set(row.day, {
            refund_total: Number(row.refund_total || 0),
            refund_cash: 0,
            refund_card: 0,
          });
        }
      }
    }

    // Merge revenue + cash/card + refunds by day
    const rows = revenueRows.map(row => {
      const day = row.day;
      const cc = cashCardByDay.get(day) || { cash: 0, card: 0 };
      const ref = refundsByDay.get(day) || { refund_total: 0, refund_cash: 0, refund_card: 0 };
      const revenue = Number(row.revenue || 0);
      return {
        day,
        revenue,
        cash: cc.cash,
        card: cc.card,
        refund_total: ref.refund_total,
        refund_cash: ref.refund_cash,
        refund_card: ref.refund_card,
        net_total: revenue - ref.refund_total,
        net_cash: cc.cash - ref.refund_cash,
        net_card: cc.card - ref.refund_card,
      };
    });

    return res.json({ ok: true, data: { preset, range: null, rows }, meta: { warnings: [] } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'compare-days failed' });
  }
});

// =====================
// GET /api/owner/money/compare-periods?presetA=7d&presetB=30d
// OR ?fromA=YYYY-MM-DD&toA=YYYY-MM-DD&fromB=YYYY-MM-DD&toB=YYYY-MM-DD
// A/B comparison of financial metrics by PAYMENT DATE (business_day)
// =====================
router.get('/money/compare-periods', (req, res) => {
  try {
    const warnings = [];

    // Determine date ranges: from/to takes priority over preset
    let rangeA, rangeB;
    if (req.query.fromA && req.query.toA) {
      rangeA = {
        from: "'" + String(req.query.fromA).replace(/[^0-9-]/g, '') + "'",
        to: "'" + String(req.query.toA).replace(/[^0-9-]/g, '') + "'"
      };
    } else {
      const presetA = String(req.query.presetA || '7d');
      rangeA = presetRange(presetA);
    }

    if (req.query.fromB && req.query.toB) {
      rangeB = {
        from: "'" + String(req.query.fromB).replace(/[^0-9-]/g, '') + "'",
        to: "'" + String(req.query.toB).replace(/[^0-9-]/g, '') + "'"
      };
    } else {
      const presetB = String(req.query.presetB || '30d');
      rangeB = presetRange(presetB);
    }

    // Helper to compute metrics for a period
    const cashCardExpr = getCashCardCaseExprs();
    const computePeriodMetrics = (fromExpr, toExpr) => {
      // Payments: SALE_PREPAYMENT_CASH, SALE_ACCEPTED_CASH, SALE_ACCEPTED_CARD, SALE_ACCEPTED_MIXED
      const paymentsRow = db
        .prepare(
          `SELECT
             COALESCE(SUM(ml.amount), 0) AS revenue_gross,
             COALESCE(SUM(${cashCardExpr.cash}), 0) AS cash,
             COALESCE(SUM(${cashCardExpr.card}), 0) AS card,
             COALESCE(SUM(CASE WHEN ml.method = 'MIXED' THEN ml.amount ELSE 0 END), 0) AS mixed
           FROM money_ledger ml
           LEFT JOIN presales p ON p.id = ml.presale_id
           WHERE ml.status = 'POSTED'
             AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
             AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
             AND DATE(ml.business_day) BETWEEN ${fromExpr} AND ${toExpr}`
        )
        .get();

      // Refunds: SALE_CANCEL_REVERSE with cash/card split
      const hasCashAmt = hasColumn('money_ledger', 'cash_amount');
      const hasCardAmt = hasColumn('money_ledger', 'card_amount');

      let refund = 0, refundCash = 0, refundCard = 0;
      if (hasCashAmt && hasCardAmt) {
        // money_ledger has split columns
        const refundsRow = db
          .prepare(
            `SELECT
               COALESCE(SUM(ABS(amount)), 0) AS refund_total,
               COALESCE(SUM(ABS(cash_amount)), 0) AS refund_cash,
               COALESCE(SUM(ABS(card_amount)), 0) AS refund_card
             FROM money_ledger
             WHERE status = 'POSTED'
               AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
               AND type = 'SALE_CANCEL_REVERSE'
               AND DATE(business_day) BETWEEN ${fromExpr} AND ${toExpr}`
          )
          .get();
        refund = Number(refundsRow?.refund_total || 0);
        refundCash = Number(refundsRow?.refund_cash || 0);
        refundCard = Number(refundsRow?.refund_card || 0);
      } else {
        // Fallback: use method field + JOIN presales for MIXED
        refund = Number(
          db
            .prepare(
              `SELECT COALESCE(SUM(ABS(amount)), 0) AS refund_total
               FROM money_ledger
               WHERE status = 'POSTED'
                 AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
                 AND type = 'SALE_CANCEL_REVERSE'
                 AND DATE(business_day) BETWEEN ${fromExpr} AND ${toExpr}`
            )
            .get()?.refund_total || 0
        );

        const refundSplitRow = db
          .prepare(
            `SELECT
               COALESCE(SUM(CASE WHEN method = 'CASH' THEN ABS(amount) ELSE 0 END), 0) AS refund_cash,
               COALESCE(SUM(CASE WHEN method = 'CARD' THEN ABS(amount) ELSE 0 END), 0) AS refund_card,
               COALESCE(SUM(CASE WHEN method = 'MIXED' THEN ABS(amount) ELSE 0 END), 0) AS refund_mixed
             FROM money_ledger
             WHERE status = 'POSTED'
               AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
               AND type = 'SALE_CANCEL_REVERSE'
               AND DATE(business_day) BETWEEN ${fromExpr} AND ${toExpr}`
          )
          .get();
        refundCash = Number(refundSplitRow?.refund_cash || 0);
        refundCard = Number(refundSplitRow?.refund_card || 0);

        // MIXED refunds: get split from presales
        const refundMixed = Number(refundSplitRow?.refund_mixed || 0);
        if (refundMixed > 0) {
          const mixedSplitRow = db
            .prepare(
              `SELECT
                 COALESCE(SUM(p.payment_cash_amount), 0) AS mixed_cash,
                 COALESCE(SUM(p.payment_card_amount), 0) AS mixed_card
               FROM money_ledger ml
               JOIN presales p ON p.id = ml.presale_id
               WHERE ml.status = 'POSTED'
                 AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
                 AND ml.type = 'SALE_CANCEL_REVERSE'
                 AND ml.method = 'MIXED'
                 AND DATE(ml.business_day) BETWEEN ${fromExpr} AND ${toExpr}`
            )
            .get();
          refundCash += Number(mixedSplitRow?.mixed_cash || 0);
          refundCard += Number(mixedSplitRow?.mixed_card || 0);
        }
      }

      const revenueGross = Number(paymentsRow?.revenue_gross || 0);
      const cash = Number(paymentsRow?.cash || 0);
      const card = Number(paymentsRow?.card || 0);
      const mixed = Number(paymentsRow?.mixed || 0);
      const revenueNet = revenueGross - refund;
      const netCash = cash - refundCash;
      const netCard = card - refundCard;

      // Share percentages
      const cashShare = revenueGross > 0 ? (cash / revenueGross) * 100 : 0;
      const cardShare = revenueGross > 0 ? (card / revenueGross) * 100 : 0;
      const mixedShare = revenueGross > 0 ? (mixed / revenueGross) * 100 : 0;

      return {
        revenue_gross: revenueGross,
        // Collected
        collected_total: revenueGross,
        collected_cash: cash,
        collected_card: card,
        // Refunds
        refund_total: refund,
        refund_cash: refundCash,
        refund_card: refundCard,
        // Net
        net_total: revenueNet,
        net_cash: netCash,
        net_card: netCard,
        // Legacy fields (backward compat)
        refund,
        revenue_net: revenueNet,
        cash,
        card,
        mixed,
        cash_share_percent: Math.round(cashShare * 10) / 10,
        card_share_percent: Math.round(cardShare * 10) / 10,
        mixed_share_percent: Math.round(mixedShare * 10) / 10,
      };
    };

    // Compute metrics for both periods
    const metricsA = computePeriodMetrics(rangeA.from, rangeA.to);
    const metricsB = computePeriodMetrics(rangeB.from, rangeB.to);

    // Compute deltas
    const computeDelta = (a, b) => {
      const abs = a - b;
      const percent = b !== 0 ? ((a - b) / b) * 100 : null;
      return { abs, percent: percent !== null ? Math.round(percent * 10) / 10 : null };
    };

    const delta = {
      revenue_gross_abs: computeDelta(metricsA.revenue_gross, metricsB.revenue_gross).abs,
      revenue_gross_percent: computeDelta(metricsA.revenue_gross, metricsB.revenue_gross).percent,
      revenue_net_abs: computeDelta(metricsA.revenue_net, metricsB.revenue_net).abs,
      revenue_net_percent: computeDelta(metricsA.revenue_net, metricsB.revenue_net).percent,
      cash_abs: computeDelta(metricsA.cash, metricsB.cash).abs,
      cash_percent: computeDelta(metricsA.cash, metricsB.cash).percent,
      card_abs: computeDelta(metricsA.card, metricsB.card).abs,
      card_percent: computeDelta(metricsA.card, metricsB.card).percent,
      mixed_abs: computeDelta(metricsA.mixed, metricsB.mixed).abs,
      mixed_percent: computeDelta(metricsA.mixed, metricsB.mixed).percent,
      refund_abs: computeDelta(metricsA.refund_total, metricsB.refund_total).abs,
      refund_percent: computeDelta(metricsA.refund_total, metricsB.refund_total).percent,
      // Net deltas
      net_total_abs: computeDelta(metricsA.net_total, metricsB.net_total).abs,
      net_total_percent: computeDelta(metricsA.net_total, metricsB.net_total).percent,
    };

    // Sanity checks
    if (metricsA.revenue_gross < metricsA.cash + metricsA.card + metricsA.mixed) {
      warnings.push('Period A: revenue_gross < cash+card+mixed (data inconsistency)');
    }
    if (metricsB.revenue_gross < metricsB.cash + metricsB.card + metricsB.mixed) {
      warnings.push('Period B: revenue_gross < cash+card+mixed (data inconsistency)');
    }
    if (metricsA.refund > metricsA.revenue_gross && metricsA.revenue_gross > 0) {
      warnings.push('Period A: refund > revenue_gross (possible sign error)');
    }
    if (metricsB.refund > metricsB.revenue_gross && metricsB.revenue_gross > 0) {
      warnings.push('Period B: refund > revenue_gross (possible sign error)');
    }

    // Extract clean from/to for response
    const fromA = rangeA.from.replace(/'/g, '');
    const toA = rangeA.to.replace(/'/g, '');
    const fromB = rangeB.from.replace(/'/g, '');
    const toB = rangeB.to.replace(/'/g, '');

    return res.json({
      ok: true,
      data: {
        periodA: {
          from: fromA,
          to: toA,
          ...metricsA,
        },
        periodB: {
          from: fromB,
          to: toB,
          ...metricsB,
        },
        delta,
      },
      meta: { warnings },
    });
  } catch (e) {
    console.error('[compare-periods] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'compare-periods failed' });
  }
});

// =====================
// GET /api/owner/money/compare-periods-daily?fromA=...&toA=...&fromB=...&toB=...&mode=daily|cumulative
// Daily breakdown for line chart (by PAYMENT DATE)
// =====================
router.get('/money/compare-periods-daily', (req, res) => {
  try {
    const fromA = String(req.query.fromA || '').replace(/[^0-9-]/g, '');
    const toA = String(req.query.toA || '').replace(/[^0-9-]/g, '');
    const fromB = String(req.query.fromB || '').replace(/[^0-9-]/g, '');
    const toB = String(req.query.toB || '').replace(/[^0-9-]/g, '');
    const mode = req.query.mode === 'cumulative' ? 'cumulative' : 'daily';

    if (!fromA || !toA || !fromB || !toB) {
      return res.status(400).json({ ok: false, error: 'Требуются fromA, toA, fromB, toB' });
    }

    // Helper to get daily revenue for a period
    const getDailyRevenue = (fromExpr, toExpr) => {
      const rows = db.prepare(`
        SELECT
          DATE(business_day) AS day,
          COALESCE(SUM(CASE WHEN type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN amount ELSE 0 END), 0) AS revenue_gross,
          COALESCE(SUM(CASE WHEN type = 'SALE_CANCEL_REVERSE' THEN ABS(amount) ELSE 0 END), 0) AS refund
        FROM money_ledger
        WHERE status = 'POSTED'
          AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
          AND type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
          AND DATE(business_day) BETWEEN '${fromExpr}' AND '${toExpr}'
        GROUP BY DATE(business_day)
        ORDER BY day ASC
      `).all();

      // Create a map for quick lookup
      const map = new Map();
      for (const r of rows) {
        map.set(r.day, {
          day: r.day,
          revenue_gross: Number(r.revenue_gross || 0),
          refund: Number(r.refund || 0),
          revenue_net: Number(r.revenue_gross || 0) - Number(r.refund || 0),
        });
      }
      return map;
    };

    const dailyA = getDailyRevenue(fromA, toA);
    const dailyB = getDailyRevenue(fromB, toB);

    // Determine max days in both periods
    const parseDate = (s) => new Date(s + 'T00:00:00');
    const daysInA = Math.ceil((parseDate(toA) - parseDate(fromA)) / 86400000) + 1;
    const daysInB = Math.ceil((parseDate(toB) - parseDate(fromB)) / 86400000) + 1;
    const maxDays = Math.max(daysInA, daysInB);

    // Build aligned data points
    const dataPoints = [];
    let cumA = 0, cumB = 0;

    for (let i = 0; i < maxDays; i++) {
      const dateA = new Date(parseDate(fromA).getTime() + i * 86400000).toISOString().split('T')[0];
      const dateB = new Date(parseDate(fromB).getTime() + i * 86400000).toISOString().split('T')[0];

      const dayA = dailyA.get(dateA);
      const dayB = dailyB.get(dateB);

      const revA = dayA?.revenue_net || 0;
      const revB = dayB?.revenue_net || 0;

      if (mode === 'cumulative') {
        cumA += revA;
        cumB += revB;
        dataPoints.push({
          day: i + 1,
          A: cumA,
          B: cumB,
          dateA: i < daysInA ? dateA : null,
          dateB: i < daysInB ? dateB : null,
        });
      } else {
        dataPoints.push({
          day: i + 1,
          A: revA,
          B: revB,
          dateA: i < daysInA ? dateA : null,
          dateB: i < daysInB ? dateB : null,
        });
      }
    }

    return res.json({
      ok: true,
      data: {
        periodA: { from: fromA, to: toA, days: daysInA },
        periodB: { from: fromB, to: toB, days: daysInB },
        mode,
        points: dataPoints,
      },
      meta: { warnings: [] },
    });
  } catch (e) {
    console.error('[compare-periods-daily] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'compare-periods-daily failed' });
  }
});

// =====================
// GET /api/owner/money/compare-boat-daily?boatId=ID&fromA..&toA..&fromB..&toB..&mode=daily|cumulative
// Daily revenue for a specific boat (by PAYMENT DATE)
// =====================
router.get('/money/compare-boat-daily', (req, res) => {
  try {
    const boatId = parseInt(req.query.boatId, 10);
    if (!boatId) {
      return res.status(400).json({ ok: false, error: 'Требуется boatId' });
    }

    const fromA = String(req.query.fromA || '').replace(/[^0-9-]/g, '');
    const toA = String(req.query.toA || '').replace(/[^0-9-]/g, '');
    const fromB = String(req.query.fromB || '').replace(/[^0-9-]/g, '');
    const toB = String(req.query.toB || '').replace(/[^0-9-]/g, '');
    const mode = req.query.mode === 'cumulative' ? 'cumulative' : 'daily';

    if (!fromA || !toA || !fromB || !toB) {
      return res.status(400).json({ ok: false, error: 'Требуются fromA, toA, fromB, toB' });
    }

    const warnings = [];

    // Get boat name
    const boatRow = db.prepare(`SELECT name FROM boats WHERE id = ?`).get(boatId);
    const boatName = boatRow?.name || `Boat ${boatId}`;

    // Helper to get daily revenue for a boat
    const getDailyRevenueForBoat = (fromExpr, toExpr) => {
      const rows = db.prepare(`
        SELECT
          DATE(ml.business_day) AS day,
          COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
          COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund
        FROM money_ledger ml
        LEFT JOIN presales p ON p.id = ml.presale_id
        LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
        WHERE ml.status = 'POSTED'
          AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
          AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
          AND bs.boat_id = ${boatId}
          AND DATE(ml.business_day) BETWEEN '${fromExpr}' AND '${toExpr}'
        GROUP BY DATE(ml.business_day)
        ORDER BY day ASC
      `).all();

      const map = new Map();
      for (const r of rows) {
        map.set(r.day, {
          day: r.day,
          revenue_gross: Number(r.revenue_gross || 0),
          refund: Number(r.refund || 0),
          revenue_net: Number(r.revenue_gross || 0) - Number(r.refund || 0),
        });
      }
      return map;
    };

    const dailyA = getDailyRevenueForBoat(fromA, toA);
    const dailyB = getDailyRevenueForBoat(fromB, toB);

    // Determine max days
    const parseDate = (s) => new Date(s + 'T00:00:00');
    const daysInA = Math.ceil((parseDate(toA) - parseDate(fromA)) / 86400000) + 1;
    const daysInB = Math.ceil((parseDate(toB) - parseDate(fromB)) / 86400000) + 1;
    const maxDays = Math.max(daysInA, daysInB);

    // Build points
    const dataPoints = [];
    let cumA = 0, cumB = 0;

    for (let i = 0; i < maxDays; i++) {
      const dateA = new Date(parseDate(fromA).getTime() + i * 86400000).toISOString().split('T')[0];
      const dateB = new Date(parseDate(fromB).getTime() + i * 86400000).toISOString().split('T')[0];

      const dayA = dailyA.get(dateA);
      const dayB = dailyB.get(dateB);

      const revA = dayA?.revenue_net || 0;
      const revB = dayB?.revenue_net || 0;

      if (mode === 'cumulative') {
        cumA += revA;
        cumB += revB;
        dataPoints.push({
          day: i + 1,
          A: cumA,
          B: cumB,
          dateA: i < daysInA ? dateA : null,
          dateB: i < daysInB ? dateB : null,
        });
      } else {
        dataPoints.push({
          day: i + 1,
          A: revA,
          B: revB,
          dateA: i < daysInA ? dateA : null,
          dateB: i < daysInB ? dateB : null,
        });
      }
    }

    return res.json({
      ok: true,
      data: {
        boatId,
        boatName,
        periodA: { from: fromA, to: toA, days: daysInA },
        periodB: { from: fromB, to: toB, days: daysInB },
        mode,
        points: dataPoints,
      },
      meta: { warnings },
    });
  } catch (e) {
    console.error('[compare-boat-daily] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'compare-boat-daily failed' });
  }
});

// =====================
// GET /api/owner/money/compare-seller-daily?sellerId=ID&fromA..&toA..&fromB..&toB..&mode=daily|cumulative
// Daily revenue for a specific seller (by PAYMENT DATE)
// =====================
router.get('/money/compare-seller-daily', (req, res) => {
  try {
    const sellerId = parseInt(req.query.sellerId, 10);
    if (!sellerId) {
      return res.status(400).json({ ok: false, error: 'Требуется sellerId' });
    }

    const fromA = String(req.query.fromA || '').replace(/[^0-9-]/g, '');
    const toA = String(req.query.toA || '').replace(/[^0-9-]/g, '');
    const fromB = String(req.query.fromB || '').replace(/[^0-9-]/g, '');
    const toB = String(req.query.toB || '').replace(/[^0-9-]/g, '');
    const mode = req.query.mode === 'cumulative' ? 'cumulative' : 'daily';

    if (!fromA || !toA || !fromB || !toB) {
      return res.status(400).json({ ok: false, error: 'Требуются fromA, toA, fromB, toB' });
    }

    const warnings = [];

    // Get seller username
    const sellerRow = db.prepare(`SELECT username FROM users WHERE id = ?`).get(sellerId);
    const sellerName = sellerRow?.username || `Seller ${sellerId}`;

    // Helper to get daily revenue for a seller
    const getDailyRevenueForSeller = (fromExpr, toExpr) => {
      const rows = db.prepare(`
        SELECT
          DATE(ml.business_day) AS day,
          COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
          COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund
        FROM money_ledger ml
        WHERE ml.status = 'POSTED'
          AND ml.kind = 'SELLER_SHIFT'
          AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
          AND ml.seller_id = ${sellerId}
          AND DATE(ml.business_day) BETWEEN '${fromExpr}' AND '${toExpr}'
        GROUP BY DATE(ml.business_day)
        ORDER BY day ASC
      `).all();

      const map = new Map();
      for (const r of rows) {
        map.set(r.day, {
          day: r.day,
          revenue_gross: Number(r.revenue_gross || 0),
          refund: Number(r.refund || 0),
          revenue_net: Number(r.revenue_gross || 0) - Number(r.refund || 0),
        });
      }
      return map;
    };

    const dailyA = getDailyRevenueForSeller(fromA, toA);
    const dailyB = getDailyRevenueForSeller(fromB, toB);

    // Determine max days
    const parseDate = (s) => new Date(s + 'T00:00:00');
    const daysInA = Math.ceil((parseDate(toA) - parseDate(fromA)) / 86400000) + 1;
    const daysInB = Math.ceil((parseDate(toB) - parseDate(fromB)) / 86400000) + 1;
    const maxDays = Math.max(daysInA, daysInB);

    // Build points
    const dataPoints = [];
    let cumA = 0, cumB = 0;

    for (let i = 0; i < maxDays; i++) {
      const dateA = new Date(parseDate(fromA).getTime() + i * 86400000).toISOString().split('T')[0];
      const dateB = new Date(parseDate(fromB).getTime() + i * 86400000).toISOString().split('T')[0];

      const dayA = dailyA.get(dateA);
      const dayB = dailyB.get(dateB);

      const revA = dayA?.revenue_net || 0;
      const revB = dayB?.revenue_net || 0;

      if (mode === 'cumulative') {
        cumA += revA;
        cumB += revB;
        dataPoints.push({
          day: i + 1,
          A: cumA,
          B: cumB,
          dateA: i < daysInA ? dateA : null,
          dateB: i < daysInB ? dateB : null,
        });
      } else {
        dataPoints.push({
          day: i + 1,
          A: revA,
          B: revB,
          dateA: i < daysInA ? dateA : null,
          dateB: i < daysInB ? dateB : null,
        });
      }
    }

    return res.json({
      ok: true,
      data: {
        sellerId,
        sellerName,
        periodA: { from: fromA, to: toA, days: daysInA },
        periodB: { from: fromB, to: toB, days: daysInB },
        mode,
        points: dataPoints,
      },
      meta: { warnings },
    });
  } catch (e) {
    console.error('[compare-seller-daily] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'compare-seller-daily failed' });
  }
});

// =====================
// GET /api/owner/money/compare-boats?fromA=...&toA=...&fromB=...&toB=...&limit=10&sort=delta_abs
// Compare revenue by boat between two periods (by PAYMENT DATE)
// =====================
router.get('/money/compare-boats', (req, res) => {
  try {
    const warnings = [];

    // Parse date ranges
    const fromA = String(req.query.fromA || '').replace(/[^0-9-]/g, '');
    const toA = String(req.query.toA || '').replace(/[^0-9-]/g, '');
    const fromB = String(req.query.fromB || '').replace(/[^0-9-]/g, '');
    const toB = String(req.query.toB || '').replace(/[^0-9-]/g, '');

    if (!fromA || !toA || !fromB || !toB) {
      return res.status(400).json({ ok: false, error: 'Требуются fromA, toA, fromB, toB' });
    }

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const sort = String(req.query.sort || 'delta_abs');

    // Helper to get boat metrics for a period
    const getBoatMetrics = (fromExpr, toExpr) => {
      // Link: money_ledger.presale_id -> presales.id -> presales.slot_uid OR presales.boat_slot_id -> boats
      // slot_uid can be 'generated:123' (generated_slots.id) or 'manual:...'
      const rows = db.prepare(`
        SELECT
          COALESCE(b.id, 0) AS boat_id,
          COALESCE(b.name, 'Неизвестно') AS boat_name,
          COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
          COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund
        FROM money_ledger ml
        LEFT JOIN presales p ON p.id = ml.presale_id
        LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
        LEFT JOIN boats b ON b.id = bs.boat_id
        WHERE ml.status = 'POSTED'
          AND ml.kind = 'SELLER_SHIFT'
          AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
          AND DATE(ml.business_day) BETWEEN '${fromExpr}' AND '${toExpr}'
        GROUP BY b.id
      `).all();

      const result = {};
      let unlinkedTotal = 0;
      for (const r of rows) {
        if (!r.boat_id || r.boat_id === 0) {
          unlinkedTotal += Number(r.revenue_gross || 0);
        } else {
          result[r.boat_id] = {
            boat_id: Number(r.boat_id),
            boat_name: r.boat_name,
            revenue_gross: Number(r.revenue_gross || 0),
            refund: Number(r.refund || 0),
            revenue_net: Number(r.revenue_gross || 0) - Number(r.refund || 0),
          };
        }
      }
      return { boats: result, unlinked: unlinkedTotal };
    };

    const metricsA = getBoatMetrics(fromA, toA);
    const metricsB = getBoatMetrics(fromB, toB);

    // Merge boats from both periods
    const allBoatIds = new Set([...Object.keys(metricsA.boats), ...Object.keys(metricsB.boats)]);
    const rows = [];

    for (const boatId of allBoatIds) {
      const a = metricsA.boats[boatId] || { revenue_gross: 0, refund: 0, revenue_net: 0 };
      const b = metricsB.boats[boatId] || { revenue_gross: 0, refund: 0, revenue_net: 0 };
      const boatName = metricsA.boats[boatId]?.boat_name || metricsB.boats[boatId]?.boat_name || 'Неизвестно';

      const deltaAbs = a.revenue_net - b.revenue_net;
      const deltaPct = b.revenue_net > 0 ? ((a.revenue_net - b.revenue_net) / b.revenue_net) * 100 : null;

      rows.push({
        boat_id: Number(boatId),
        boat_name: boatName,
        a: { revenue_gross: a.revenue_gross, refund: a.refund, revenue_net: a.revenue_net },
        b: { revenue_gross: b.revenue_gross, refund: b.refund, revenue_net: b.revenue_net },
        delta: {
          revenue_net_abs: deltaAbs,
          revenue_net_percent: deltaPct !== null ? Math.round(deltaPct * 10) / 10 : null,
        },
      });
    }

    // Sort
    rows.sort((x, y) => {
      if (sort === 'revenue_net_a') return y.a.revenue_net - x.a.revenue_net;
      if (sort === 'revenue_net_b') return y.b.revenue_net - x.b.revenue_net;
      if (sort === 'delta_abs') return Math.abs(y.delta.revenue_net_abs) - Math.abs(x.delta.revenue_net_abs);
      if (sort === 'delta_percent') {
        const yp = y.delta.revenue_net_percent ?? -Infinity;
        const xp = x.delta.revenue_net_percent ?? -Infinity;
        return yp - xp;
      }
      return 0;
    });

    const limitedRows = rows.slice(0, limit);

    // Warnings for unlinked
    const totalA = Object.values(metricsA.boats).reduce((s, b) => s + b.revenue_gross, 0) + metricsA.unlinked;
    const totalB = Object.values(metricsB.boats).reduce((s, b) => s + b.revenue_gross, 0) + metricsB.unlinked;
    if (metricsA.unlinked > 0 && totalA > 0) {
      const pct = Math.round((metricsA.unlinked / totalA) * 100);
      warnings.push(`Period A: ${pct}% payments cannot be attributed to boats (missing presale/slot link)`);
    }
    if (metricsB.unlinked > 0 && totalB > 0) {
      const pct = Math.round((metricsB.unlinked / totalB) * 100);
      warnings.push(`Period B: ${pct}% payments cannot be attributed to boats (missing presale/slot link)`);
    }

    return res.json({
      ok: true,
      data: {
        periodA: { from: fromA, to: toA },
        periodB: { from: fromB, to: toB },
        rows: limitedRows,
        total: rows.length,
      },
      meta: { warnings },
    });
  } catch (e) {
    console.error('[compare-boats] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'compare-boats failed' });
  }
});

// =====================
// GET /api/owner/money/compare-sellers?fromA=...&toA=...&fromB=...&toB=...&limit=10&sort=delta_abs
// Compare revenue by seller between two periods (by PAYMENT DATE)
// =====================
router.get('/money/compare-sellers', (req, res) => {
  try {
    const warnings = [];

    // Parse date ranges
    const fromA = String(req.query.fromA || '').replace(/[^0-9-]/g, '');
    const toA = String(req.query.toA || '').replace(/[^0-9-]/g, '');
    const fromB = String(req.query.fromB || '').replace(/[^0-9-]/g, '');
    const toB = String(req.query.toB || '').replace(/[^0-9-]/g, '');

    if (!fromA || !toA || !fromB || !toB) {
      return res.status(400).json({ ok: false, error: 'Требуются fromA, toA, fromB, toB' });
    }

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const sort = String(req.query.sort || 'delta_abs');

    // Helper to get seller metrics for a period
    const getSellerMetrics = (fromExpr, toExpr) => {
      // Link: money_ledger.seller_id OR money_ledger.presale_id -> presales.seller_id
      const rows = db.prepare(`
        SELECT
          COALESCE(u.id, 0) AS seller_id,
          COALESCE(u.username, 'Неизвестно') AS username,
          COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
          COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund
        FROM money_ledger ml
        LEFT JOIN users u ON u.id = ml.seller_id
        WHERE ml.status = 'POSTED'
          AND ml.kind = 'SELLER_SHIFT'
          AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
          AND DATE(ml.business_day) BETWEEN '${fromExpr}' AND '${toExpr}'
        GROUP BY u.id
      `).all();

      const result = {};
      let unlinkedTotal = 0;
      for (const r of rows) {
        if (!r.seller_id || r.seller_id === 0) {
          unlinkedTotal += Number(r.revenue_gross || 0);
        } else {
          result[r.seller_id] = {
            seller_id: Number(r.seller_id),
            username: r.username,
            revenue_gross: Number(r.revenue_gross || 0),
            refund: Number(r.refund || 0),
            revenue_net: Number(r.revenue_gross || 0) - Number(r.refund || 0),
          };
        }
      }
      return { sellers: result, unlinked: unlinkedTotal };
    };

    const metricsA = getSellerMetrics(fromA, toA);
    const metricsB = getSellerMetrics(fromB, toB);

    // Merge sellers from both periods
    const allSellerIds = new Set([...Object.keys(metricsA.sellers), ...Object.keys(metricsB.sellers)]);
    const rows = [];

    for (const sellerId of allSellerIds) {
      const a = metricsA.sellers[sellerId] || { revenue_gross: 0, refund: 0, revenue_net: 0 };
      const b = metricsB.sellers[sellerId] || { revenue_gross: 0, refund: 0, revenue_net: 0 };
      const username = metricsA.sellers[sellerId]?.username || metricsB.sellers[sellerId]?.username || 'Неизвестно';

      const deltaAbs = a.revenue_net - b.revenue_net;
      const deltaPct = b.revenue_net > 0 ? ((a.revenue_net - b.revenue_net) / b.revenue_net) * 100 : null;

      rows.push({
        seller_id: Number(sellerId),
        username,
        a: { revenue_gross: a.revenue_gross, refund: a.refund, revenue_net: a.revenue_net },
        b: { revenue_gross: b.revenue_gross, refund: b.refund, revenue_net: b.revenue_net },
        delta: {
          revenue_net_abs: deltaAbs,
          revenue_net_percent: deltaPct !== null ? Math.round(deltaPct * 10) / 10 : null,
        },
      });
    }

    // Sort
    rows.sort((x, y) => {
      if (sort === 'revenue_net_a') return y.a.revenue_net - x.a.revenue_net;
      if (sort === 'revenue_net_b') return y.b.revenue_net - x.b.revenue_net;
      if (sort === 'delta_abs') return Math.abs(y.delta.revenue_net_abs) - Math.abs(x.delta.revenue_net_abs);
      if (sort === 'delta_percent') {
        const yp = y.delta.revenue_net_percent ?? -Infinity;
        const xp = x.delta.revenue_net_percent ?? -Infinity;
        return yp - xp;
      }
      return 0;
    });

    const limitedRows = rows.slice(0, limit);

    // Warnings for unlinked
    const totalA = Object.values(metricsA.sellers).reduce((s, b) => s + b.revenue_gross, 0) + metricsA.unlinked;
    const totalB = Object.values(metricsB.sellers).reduce((s, b) => s + b.revenue_gross, 0) + metricsB.unlinked;
    if (metricsA.unlinked > 0 && totalA > 0) {
      const pct = Math.round((metricsA.unlinked / totalA) * 100);
      warnings.push(`Period A: ${pct}% payments cannot be attributed to sellers`);
    }
    if (metricsB.unlinked > 0 && totalB > 0) {
      const pct = Math.round((metricsB.unlinked / totalB) * 100);
      warnings.push(`Period B: ${pct}% payments cannot be attributed to sellers`);
    }

    return res.json({
      ok: true,
      data: {
        periodA: { from: fromA, to: toA },
        periodB: { from: fromB, to: toB },
        rows: limitedRows,
        total: rows.length,
      },
      meta: { warnings },
    });
  } catch (e) {
    console.error('[compare-sellers] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'compare-sellers failed' });
  }
});

// =====================
// GET /api/owner/motivation/day?day=YYYY-MM-DD
// Motivation calculation for a specific day with settings snapshot
// Modes: personal, team, adaptive
// =====================
router.get('/motivation/day', (req, res) => {
  try {
    const day = String(req.query.day || '').trim();
    
    // Use the shared calculation engine
    const result = calcMotivationDay(db, day);
    
    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    
    // Return in same format as before
    return res.json({
      ok: true,
      data: result.data,
      meta: { warnings: result.warnings }
    });
  } catch (e) {
    console.error('[owner/motivation/day] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'motivation calculation failed' });
  }
});

// =====================
// GET /api/owner/motivation/weekly?week=YYYY-Www
// Weekly leaderboard by points (sellers only, no payouts)
// =====================
router.get('/motivation/weekly', (req, res) => {
  try {
    // Parse week parameter or use current week
    let weekId = req.query.week;
    if (!weekId) {
      // Calculate current ISO week
      const now = new Date();
      const year = now.getFullYear();
      const oneJan = new Date(year, 0, 1);
      const days = Math.floor((now - oneJan) / 86400000);
      const weekNum = Math.ceil((days + oneJan.getDay() + 1) / 7);
      weekId = `${year}-W${String(weekNum).padStart(2, '0')}`;
    }
    
    // Validate week format
    if (!/^\d{4}-W\d{2}$/.test(weekId)) {
      return res.status(400).json({ ok: false, error: 'Invalid week format. Use YYYY-Www (e.g., 2026-W07)' });
    }
    
    // Parse week to get date range
    const [yearStr, weekStr] = weekId.split('-W');
    const year = parseInt(yearStr, 10);
    const weekNum = parseInt(weekStr, 10);
    
    // Calculate Monday of the week (ISO week: Monday = day 1)
    const simple = new Date(year, 0, 1 + (weekNum - 1) * 7);
    const dow = simple.getDay();
    const ISOweekStart = simple;
    if (dow <= 4) {
      ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    } else {
      ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    }
    
    const dateFrom = ISOweekStart.toISOString().split('T')[0];
    const dateToObj = new Date(ISOweekStart);
    dateToObj.setDate(dateToObj.getDate() + 6);
    const dateTo = dateToObj.toISOString().split('T')[0];
    
    // Get settings for coefficients (load from owner_settings table)
    const ownerRow = db.prepare("SELECT settings_json FROM owner_settings WHERE id = 1").get();
    const savedSettings = ownerRow?.settings_json ? JSON.parse(ownerRow.settings_json) : {};
    const settings = { ...OWNER_SETTINGS_DEFAULTS, ...savedSettings };
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
    
    // ====================
    // Calculate revenue_total_week from money_ledger (same source as day endpoint)
    // ====================
    const weeklyRevenueTotalRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
        COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refunds
      FROM money_ledger ml
      WHERE ml.status = 'POSTED'
        AND ml.kind = 'SELLER_SHIFT'
        AND DATE(ml.business_day) BETWEEN ? AND ?
    `).get(dateFrom, dateTo);
    
    const revenue_total_week = Math.max(0, Number(weeklyRevenueTotalRow?.revenue_gross || 0) - Number(weeklyRevenueTotalRow?.refunds || 0));
    
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
    
    // Get all active sellers
    const sellersRows = db.prepare(`
      SELECT id, username, zone FROM users WHERE role = 'seller' AND is_active = 1
    `).all();
    
    // Get seller zones map
    const sellerZoneMap = new Map((sellersRows || []).map(r => [Number(r.id), { name: r.username, zone: r.zone }]));
    
    // Get weekly revenue by seller and boat type (same logic as motivation/day)
    const weeklyRevenue = db.prepare(`
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
        AND DATE(ml.business_day) BETWEEN ? AND ?
        AND ml.seller_id IS NOT NULL
        AND ml.seller_id > 0
      GROUP BY ml.seller_id, COALESCE(b.type, gb.type), p.zone_at_sale
    `).all(dateFrom, dateTo);
    
    // Build weekly points by seller
    const weeklyPointsMap = new Map();
    
    // Initialize all sellers with zero
    for (const [sellerId, info] of sellerZoneMap) {
      weeklyPointsMap.set(sellerId, {
        user_id: sellerId,
        name: info.name,
        zone: info.zone,
        revenue_total_week: 0,
        points_week_base: 0
      });
    }
    
    // Calculate points_base for each revenue row
    for (const row of (weeklyRevenue || [])) {
      const sellerId = Number(row.seller_id);
      const boatType = row.boat_type || null;
      const zoneAtSale = row.zone_at_sale || null;
      const revenueGross = Number(row.revenue_gross || 0);
      const refunds = Number(row.refunds || 0);
      const revenueNet = Math.max(0, revenueGross - refunds);
      
      if (!boatType || !['speed', 'cruise', 'banana'].includes(boatType)) continue;
      
      let entry = weeklyPointsMap.get(sellerId);
      if (!entry) {
        entry = {
          user_id: sellerId,
          name: `Seller #${sellerId}`,
          zone: null,
          revenue_total_week: 0,
          points_week_base: 0
        };
        weeklyPointsMap.set(sellerId, entry);
      }
      
      const effectiveZone = zoneAtSale || entry.zone;
      const revenueInK = revenueNet / 1000;
      let pointsBase = 0;
      
      if (boatType === 'speed') {
        pointsBase = revenueInK * k_speed * getZoneK(effectiveZone);
      } else if (boatType === 'cruise') {
        pointsBase = revenueInK * k_cruise * getZoneK(effectiveZone);
      } else if (boatType === 'banana') {
        pointsBase = revenueInK * getBananaK(effectiveZone);
      }
      
      entry.revenue_total_week += revenueNet;
      entry.points_week_base += pointsBase;
    }
    
    // Apply current streak multiplier to each seller
    const sellers = [];
    for (const [sellerId, entry] of weeklyPointsMap) {
      const state = getSellerState(sellerId);
      const streakDays = state?.calibrated ? (state.streak_days || 0) : 0;
      const kStreak = getStreakMultiplier(streakDays);
      const pointsWeekTotal = Math.round(entry.points_week_base * kStreak * 100) / 100;
      
      sellers.push({
        ...entry,
        streak_days: streakDays,
        k_streak: kStreak,
        points_week_total: pointsWeekTotal
      });
    }
    
    // Sort: points desc, revenue desc, name asc
    sellers.sort((a, b) => {
      if (b.points_week_total !== a.points_week_total) return b.points_week_total - a.points_week_total;
      if (b.revenue_total_week !== a.revenue_total_week) return b.revenue_total_week - a.revenue_total_week;
      return (a.name || '').localeCompare(b.name || '');
    });
    
    // Assign ranks
    sellers.forEach((s, i) => { s.rank = i + 1; });
    
    // Top 3
    const top3 = sellers.slice(0, 3);
    
    // ====================
    // STEP 8: Weekly Payout Distribution (from ledger WITHHOLD_WEEKLY)
    // ====================
    
    // Calculate weekly_pool_total_ledger from money_ledger (sum of WITHHOLD_WEEKLY)
    // This is the ONLY source of truth for weekly pool
    const weeklyPoolLedgerRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS weekly_pool_total_ledger
      FROM money_ledger
      WHERE kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
        AND DATE(business_day) BETWEEN ? AND ?
    `).get(dateFrom, dateTo);
    const weekly_pool_total_ledger = Number(weeklyPoolLedgerRow?.weekly_pool_total_ledger || 0);
    
    // Use ledger sum as the pool total (no calculation from percent)
    const weekly_pool_total = weekly_pool_total_ledger;
    
    // === CONSISTENCY CHECK: daily_sum vs ledger ===
    // Get days with WITHHOLD_WEEKLY entries in the week range
    const withholdDays = db.prepare(`
      SELECT DISTINCT business_day FROM money_ledger
      WHERE kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
        AND DATE(business_day) BETWEEN ? AND ?
    `).all(dateFrom, dateTo);
    
    let weekly_pool_total_daily_sum = 0;
    for (const row of (withholdDays || [])) {
      const day = row.business_day;
      try {
        const dayResult = calcMotivationDay(db, day);
        weekly_pool_total_daily_sum += Number(dayResult?.data?.withhold?.weekly_amount || 0);
      } catch (e) {
        console.error(`[weekly consistency] calcMotivationDay error for ${day}:`, e);
      }
    }
    
    const weekly_pool_diff = weekly_pool_total_ledger - weekly_pool_total_daily_sum;
    const weekly_pool_is_consistent = (weekly_pool_diff === 0);
    
    // Distribution percentages based on number of sellers
    let weekly_distribution = { first: 0.5, second: 0.3, third: 0.2 };
    
    if (sellers.length === 1) {
      // Only 1 seller gets 100%
      weekly_distribution = { first: 1.0, second: 0, third: 0 };
    } else if (sellers.length === 2) {
      // 2 sellers: 60/40
      weekly_distribution = { first: 0.6, second: 0.4, third: 0 };
    }
    
    // Assign weekly_payout to each seller (rounded down to 50 RUB)
    sellers.forEach((s, idx) => {
      let weekly_payout = 0;
      if (idx === 0) {
        weekly_payout = roundDownTo50(weekly_pool_total * weekly_distribution.first);
      } else if (idx === 1) {
        weekly_payout = roundDownTo50(weekly_pool_total * weekly_distribution.second);
      } else if (idx === 2) {
        weekly_payout = roundDownTo50(weekly_pool_total * weekly_distribution.third);
      }
      s.weekly_payout = weekly_payout;
    });
    
    return res.json({
      ok: true,
      data: {
        week_id: weekId,
        date_from: dateFrom,
        date_to: dateTo,
        revenue_total_week,
        weekly_pool_total,
        weekly_pool_total_ledger,
        weekly_pool_total_daily_sum,
        weekly_pool_diff,
        weekly_pool_is_consistent,
        weekly_distribution,
        sellers,
        top3
      },
      meta: {
        points_rule: 'v3_zone_at_sale_fallback_user_zone_streak_multiplier',
        streak_mode: 'current_state_multiplier'
      }
    });
  } catch (e) {
    console.error('[owner/motivation/weekly] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'weekly motivation calculation failed' });
  }
});

// =====================
// GET /api/owner/motivation/season?season_id=YYYY
// Seasonal leaderboard by accumulated points with payouts for eligible sellers
// =====================
router.get('/motivation/season', (req, res) => {
  try {
    // Parse season_id parameter or use current year
    let seasonId = req.query.season_id;
    if (!seasonId) {
      // Use current year
      const now = new Date();
      seasonId = String(now.getFullYear());
    }
    
    // Validate season_id format (4-digit year)
    if (!/^\d{4}$/.test(seasonId)) {
      return res.status(400).json({ ok: false, error: 'Invalid season_id format. Use YYYY (e.g., 2026)' });
    }
    
    // Season date range
    const seasonFrom = `${seasonId}-01-01`;
    const seasonTo = `${seasonId}-12-31`;
    
    // End of September window (last 7 days of September)
    const endSepFrom = `${seasonId}-09-24`;
    const endSepTo = `${seasonId}-09-30`;
    const sepFrom = `${seasonId}-09-01`;
    const sepTo = `${seasonId}-09-30`;
    
    // Eligibility constants
    const MIN_WORKED_DAYS_SEASON = 75;
    const MIN_WORKED_DAYS_SEP = 20;
    const END_SEP_WINDOW_DAYS = 7;
    
    // Get all active sellers
    const sellersRows = db.prepare(`
      SELECT id, username, zone FROM users WHERE role = 'seller' AND is_active = 1
    `).all();
    
    // Get season stats from seller_season_stats
    const seasonStats = db.prepare(`
      SELECT seller_id, revenue_total, points_total
      FROM seller_season_stats
      WHERE season_id = ?
    `).all(seasonId);
    
    // Build stats map
    const statsMap = new Map();
    for (const stat of (seasonStats || [])) {
      statsMap.set(Number(stat.seller_id), {
        revenue_total: Number(stat.revenue_total || 0),
        points_total: Number(stat.points_total || 0)
      });
    }
    
    // Calculate eligibility for each seller
    const eligibilityMap = new Map();
    for (const seller of (sellersRows || [])) {
      const sellerId = Number(seller.id);
      
      // Worked days in season
      const workedDaysSeasonRow = db.prepare(`
        SELECT COUNT(*) AS cnt FROM seller_day_stats
        WHERE seller_id = ? AND business_day BETWEEN ? AND ? AND revenue_day > 0
      `).get(sellerId, seasonFrom, seasonTo);
      const worked_days_season = Number(workedDaysSeasonRow?.cnt || 0);
      
      // Worked days in September
      const workedDaysSepRow = db.prepare(`
        SELECT COUNT(*) AS cnt FROM seller_day_stats
        WHERE seller_id = ? AND business_day BETWEEN ? AND ? AND revenue_day > 0
      `).get(sellerId, sepFrom, sepTo);
      const worked_days_sep = Number(workedDaysSepRow?.cnt || 0);
      
      // Worked days in end-September window
      const workedDaysEndSepRow = db.prepare(`
        SELECT COUNT(*) AS cnt FROM seller_day_stats
        WHERE seller_id = ? AND business_day BETWEEN ? AND ? AND revenue_day > 0
      `).get(sellerId, endSepFrom, endSepTo);
      const worked_days_end_sep = Number(workedDaysEndSepRow?.cnt || 0);
      
      // Eligibility check
      const is_eligible = (worked_days_season >= MIN_WORKED_DAYS_SEASON) && 
                          (worked_days_sep >= MIN_WORKED_DAYS_SEP) && 
                          (worked_days_end_sep >= 1) ? 1 : 0;
      
      eligibilityMap.set(sellerId, {
        worked_days_season,
        worked_days_sep,
        worked_days_end_sep,
        is_eligible
      });
    }
    
    // Calculate revenue_total_season from money_ledger (same source as weekly)
    const seasonRevenueRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
        COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refunds
      FROM money_ledger ml
      WHERE ml.status = 'POSTED'
        AND ml.kind = 'SELLER_SHIFT'
        AND DATE(ml.business_day) BETWEEN ? AND ?
    `).get(seasonFrom, seasonTo);
    
    const revenue_total_season = Math.max(0, Number(seasonRevenueRow?.revenue_gross || 0) - Number(seasonRevenueRow?.refunds || 0));
    
    // Calculate season_pool_total_ledger from money_ledger (sum of WITHHOLD_SEASON)
    // This is the ONLY source of truth for season pool
    const seasonPoolLedgerRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS season_pool_total_ledger
      FROM money_ledger
      WHERE kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
        AND DATE(business_day) BETWEEN ? AND ?
    `).get(seasonFrom, seasonTo);
    const season_pool_total_ledger = Number(seasonPoolLedgerRow?.season_pool_total_ledger || 0);
    
    // Use ledger sum as the pool total (no calculation from percent)
    const season_pool_total = season_pool_total_ledger;
    
    // === CONSISTENCY CHECK: daily_sum vs ledger ===
    // Get days with WITHHOLD_SEASON entries in the season range
    const seasonWithholdDays = db.prepare(`
      SELECT DISTINCT business_day FROM money_ledger
      WHERE kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
        AND DATE(business_day) BETWEEN ? AND ?
    `).all(seasonFrom, seasonTo);
    
    let season_pool_total_daily_sum = 0;
    for (const row of (seasonWithholdDays || [])) {
      const day = row.business_day;
      try {
        const dayResult = calcMotivationDay(db, day);
        season_pool_total_daily_sum += Number(dayResult?.data?.withhold?.season_amount || 0);
      } catch (e) {
        console.error(`[season consistency] calcMotivationDay error for ${day}:`, e);
      }
    }
    
    const season_pool_diff = season_pool_total_ledger - season_pool_total_daily_sum;
    const season_pool_is_consistent = (season_pool_diff === 0);
    
    // Build sellers list with eligibility
    const sellers = (sellersRows || []).map(r => {
      const sellerId = Number(r.id);
      const stats = statsMap.get(sellerId) || { revenue_total: 0, points_total: 0 };
      const eligibility = eligibilityMap.get(sellerId) || { worked_days_season: 0, worked_days_sep: 0, worked_days_end_sep: 0, is_eligible: 0 };
      return {
        user_id: sellerId,
        name: r.username,
        zone: r.zone,
        revenue_total: stats.revenue_total,
        points_total: stats.points_total,
        worked_days_season: eligibility.worked_days_season,
        worked_days_sep: eligibility.worked_days_sep,
        worked_days_end_sep: eligibility.worked_days_end_sep,
        is_eligible: eligibility.is_eligible,
        season_payout: 0,
        season_share: 0
      };
    });
    
    // Calculate sum of points for eligible sellers
    const eligibleSellers = sellers.filter(s => s.is_eligible === 1);
    const eligible_count = eligibleSellers.length;
    const sum_points_eligible = eligibleSellers.reduce((sum, s) => sum + s.points_total, 0);
    
    // Calculate payouts for eligible sellers (proportional by points)
    let season_payouts_sum = 0;
    if (sum_points_eligible > 0 && eligible_count > 0) {
      for (const seller of sellers) {
        if (seller.is_eligible === 1 && seller.points_total > 0) {
          const rawPayout = season_pool_total * (seller.points_total / sum_points_eligible);
          seller.season_payout = roundDownTo50(Math.floor(rawPayout));
          seller.season_share = seller.points_total / sum_points_eligible;
          season_payouts_sum += seller.season_payout;
        }
      }
    }
    
    const season_payouts_remainder = season_pool_total - season_payouts_sum;
    
    // Sort: points_total desc, revenue_total desc, name asc
    sellers.sort((a, b) => {
      if (b.points_total !== a.points_total) return b.points_total - a.points_total;
      if (b.revenue_total !== a.revenue_total) return b.revenue_total - a.revenue_total;
      return (a.name || '').localeCompare(b.name || '');
    });
    
    // Assign ranks
    sellers.forEach((s, i) => { s.rank = i + 1; });
    
    // Top 3 (by points_total, not payouts)
    const top3 = sellers.slice(0, 3);
    
    return res.json({
      ok: true,
      data: {
        season_id: seasonId,
        season_from: seasonFrom,
        season_to: seasonTo,
        revenue_total_season,
        season_pool_total,
        season_pool_total_ledger,
        season_pool_total_daily_sum,
        season_pool_diff,
        season_pool_is_consistent,
        eligible_count,
        sum_points_eligible,
        season_payouts_sum,
        season_payouts_remainder,
        sellers,
        top3
      },
      meta: {
        season_payout_mode: 'eligible_all_proportional_by_points',
        eligibility_rules: {
          min_worked_days_season: MIN_WORKED_DAYS_SEASON,
          min_worked_days_sep: MIN_WORKED_DAYS_SEP,
          end_sep_window_days: END_SEP_WINDOW_DAYS
        },
        rounding: 'roundDownTo50'
      }
    });
  } catch (e) {
    console.error('[owner/motivation/season] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'season motivation calculation failed' });
  }
});

// =====================
// GET /api/owner/invariants?business_day=YYYY-MM-DD&week=YYYY-Wxx&season_id=YYYY
// Read-only endpoint to verify financial invariants
// =====================
router.get('/invariants', (req, res) => {
  try {
    const { business_day, week, season_id } = req.query;
    
    if (!business_day && !week && !season_id) {
      return res.status(400).json({ 
        ok: false, 
        error: 'At least one parameter required: business_day, week, or season_id' 
      });
    }
    
    const result = {
      ok: true,
      data: {}
    };
    
    // === DAY INVARIANTS ===
    if (business_day) {
      const dayErrors = [];
      const motivationResult = calcMotivationDay(db, business_day);
      
      if (motivationResult.error) {
        dayErrors.push(`calcMotivationDay error: ${motivationResult.error}`);
      }
      
      const w = motivationResult?.data?.withhold || {};
      const fundTotal = Number(w.fund_total_original || 0);
      const weeklyAmount = Number(w.weekly_amount || 0);
      const seasonAmount = Number(w.season_amount || 0);
      const dispatcherAmount = Number(w.dispatcher_amount_total || 0);
      const fundAfter = Number(w.fund_total_after_withhold || 0);
      
      // Check: fund_total_original - withhold == fund_total_after_withhold
      const expectedAfter = fundTotal - weeklyAmount - seasonAmount - dispatcherAmount;
      if (expectedAfter !== fundAfter) {
        dayErrors.push(`fund mismatch: ${fundTotal} - ${weeklyAmount} - ${seasonAmount} - ${dispatcherAmount} = ${expectedAfter}, but fund_total_after_withhold = ${fundAfter}`);
      }
      
      result.data.day = {
        business_day,
        ok: dayErrors.length === 0,
        errors: dayErrors,
        values: {
          fund_total_original: fundTotal,
          weekly_amount: weeklyAmount,
          season_amount: seasonAmount,
          dispatcher_amount_total: dispatcherAmount,
          fund_total_after_withhold: fundAfter
        }
      };
      
      // === IMMUTABILITY CHECK ===
      // Check if day is locked (has WITHHOLD entries)
      const isLocked = !!motivationResult?.data?.lock?.is_locked;
      const snapshotFound = !!motivationResult?.data?.lock?.snapshot_found;
      
      if (isLocked) {
        const immutabilityErrors = [];
        
        // Check snapshot exists
        if (!snapshotFound) {
          immutabilityErrors.push('locked day without snapshot');
        }
        
        // Get ledger amounts
        const ledgerWeeklyRow = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) AS total FROM money_ledger
          WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
        `).get(business_day);
        const ledgerWeekly = Number(ledgerWeeklyRow?.total || 0);
        
        const ledgerSeasonRow = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) AS total FROM money_ledger
          WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
        `).get(business_day);
        const ledgerSeason = Number(ledgerSeasonRow?.total || 0);
        
        // Compare calc (from snapshot) vs ledger
        const calcWeekly = weeklyAmount;
        const calcSeason = seasonAmount;
        
        if (ledgerWeekly !== calcWeekly) {
          immutabilityErrors.push(`ledger weekly (${ledgerWeekly}) differs from snapshot calc (${calcWeekly})`);
        }
        if (ledgerSeason !== calcSeason) {
          immutabilityErrors.push(`ledger season (${ledgerSeason}) differs from snapshot calc (${calcSeason})`);
        }
        
        result.data.immutability = {
          ok: immutabilityErrors.length === 0,
          errors: immutabilityErrors,
          details: {
            locked_day: true,
            snapshot_found: snapshotFound,
            ledger_weekly_amount: ledgerWeekly,
            ledger_season_amount: ledgerSeason,
            calc_weekly_amount: calcWeekly,
            calc_season_amount: calcSeason
          }
        };
      } else {
        // Day not locked - immutability is trivially OK
        result.data.immutability = {
          ok: true,
          errors: [],
          details: {
            locked_day: false,
            snapshot_found: snapshotFound
          }
        };
      }
    }
    
    // === WEEKLY INVARIANTS ===
    if (week) {
      const weekErrors = [];
      
      // Parse week (YYYY-Wxx)
      const weekMatch = week.match(/^(\d{4})-W(\d{2})$/);
      if (!weekMatch) {
        weekErrors.push(`Invalid week format: ${week}. Use YYYY-Wxx`);
      } else {
        const year = parseInt(weekMatch[1], 10);
        const weekNum = parseInt(weekMatch[2], 10);
        
        // Calculate week date range
        const jan4 = new Date(year, 0, 4);
        const dayOfWeek = jan4.getDay() || 7;
        const weekStart = new Date(jan4);
        weekStart.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        
        const dateFrom = weekStart.toISOString().split('T')[0];
        const dateTo = weekEnd.toISOString().split('T')[0];
        
        // Get ledger total
        const ledgerRow = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM money_ledger
          WHERE kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
            AND DATE(business_day) BETWEEN ? AND ?
        `).get(dateFrom, dateTo);
        const ledgerTotal = Number(ledgerRow?.total || 0);
        
        // Get daily sum
        const withholdDays = db.prepare(`
          SELECT DISTINCT business_day FROM money_ledger
          WHERE kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
            AND DATE(business_day) BETWEEN ? AND ?
        `).all(dateFrom, dateTo);
        
        let dailySum = 0;
        for (const row of (withholdDays || [])) {
          try {
            const dayResult = calcMotivationDay(db, row.business_day);
            dailySum += Number(dayResult?.data?.withhold?.weekly_amount || 0);
          } catch (e) {
            weekErrors.push(`calcMotivationDay error for ${row.business_day}: ${e.message}`);
          }
        }
        
        const diff = ledgerTotal - dailySum;
        const isConsistent = diff === 0;
        
        result.data.weekly = {
          week_id: week,
          date_from: dateFrom,
          date_to: dateTo,
          ok: isConsistent && weekErrors.length === 0,
          errors: weekErrors,
          diff,
          ledger_total: ledgerTotal,
          daily_sum: dailySum
        };
      }
    }
    
    // === SEASON INVARIANTS ===
    if (season_id) {
      const seasonErrors = [];
      
      if (!/^\d{4}$/.test(season_id)) {
        seasonErrors.push(`Invalid season_id format: ${season_id}. Use YYYY`);
      } else {
        const seasonFrom = `${season_id}-01-01`;
        const seasonTo = `${season_id}-12-31`;
        
        // Get ledger total
        const ledgerRow = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) AS total
          FROM money_ledger
          WHERE kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
            AND DATE(business_day) BETWEEN ? AND ?
        `).get(seasonFrom, seasonTo);
        const ledgerTotal = Number(ledgerRow?.total || 0);
        
        // Get daily sum
        const withholdDays = db.prepare(`
          SELECT DISTINCT business_day FROM money_ledger
          WHERE kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
            AND DATE(business_day) BETWEEN ? AND ?
        `).all(seasonFrom, seasonTo);
        
        let dailySum = 0;
        for (const row of (withholdDays || [])) {
          try {
            const dayResult = calcMotivationDay(db, row.business_day);
            dailySum += Number(dayResult?.data?.withhold?.season_amount || 0);
          } catch (e) {
            seasonErrors.push(`calcMotivationDay error for ${row.business_day}: ${e.message}`);
          }
        }
        
        const diff = ledgerTotal - dailySum;
        const isConsistent = diff === 0;
        
        result.data.season = {
          season_id,
          date_from: seasonFrom,
          date_to: seasonTo,
          ok: isConsistent && seasonErrors.length === 0,
          errors: seasonErrors,
          diff,
          ledger_total: ledgerTotal,
          daily_sum: dailySum
        };
      }
    }
    
    // === LEDGER UNIQUENESS ===
    // Check for duplicate WITHHOLD_WEEKLY/WITHHOLD_SEASON entries per business_day
    const duplicates = db.prepare(`
      SELECT business_day, type, COUNT(*) AS cnt
      FROM money_ledger
      WHERE kind = 'FUND' AND type IN ('WITHHOLD_WEEKLY', 'WITHHOLD_SEASON') AND status = 'POSTED'
      GROUP BY business_day, type
      HAVING COUNT(*) > 1
    `).all();
    
    result.data.ledger_uniqueness = {
      ok: duplicates.length === 0,
      duplicates: duplicates.map(d => ({
        business_day: d.business_day,
        type: d.type,
        count: d.cnt
      }))
    };
    
    return res.json(result);
  } catch (e) {
    console.error('[owner/invariants] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'invariants check failed' });
  }
});

// =====================
// GET /api/owner/boats?preset=today|yesterday|d7|month|all
// Aggregated by boat. Uses trip day expression (matches Money screens).
// =====================
router.get('/boats', (req, res) => {
  try {
    const preset = String(req.query.preset || 'today');
    const validPresets = ['today', 'yesterday', 'd7', '7d', 'month', 'all'];
    if (!validPresets.includes(preset)) {
      return res.status(400).json({ ok: false, error: 'Invalid preset. Use: today, yesterday, d7, month, all' });
    }
    const warnings = [];

    const tripDayExpr = getTripDayExpr();

    // Range
    let fromExpr = null;
    let toExpr = null;
    if (preset !== 'all') {
      const r = presetRange(preset);
      fromExpr = r.from;
      toExpr = r.to;
    }

    const seatsCol = pickFirstExisting('presales', ['number_of_seats', 'qty', 'seats'], null);
    const ticketsAgg = seatsCol ? `COALESCE(SUM(p.${seatsCol}),0)` : `COUNT(*)`;

    const boatTypeCol = pickFirstExisting('boats', ['boat_type', 'type', 'category'], null);

    // Per-boat aggregates (revenue/tickets/trips)
    const whereRange = fromExpr && toExpr ? `AND ${tripDayExpr} BETWEEN ${fromExpr} AND ${toExpr}` : '';

    const boatsRows = db
      .prepare(
        `SELECT
           b.id AS boat_id,
           b.name AS boat_name,
           ${boatTypeCol ? `b.${boatTypeCol} AS boat_type,` : `NULL AS boat_type,`}
           COALESCE(SUM(p.total_price),0) AS revenue,
           ${ticketsAgg} AS tickets,
           COUNT(DISTINCT COALESCE(p.slot_uid, p.boat_slot_id)) AS trips
         FROM presales p
         JOIN boat_slots bs ON bs.id = p.boat_slot_id
         JOIN boats b ON b.id = bs.boat_id
         WHERE p.status='ACTIVE'
           ${whereRange}
         GROUP BY b.id
         ORDER BY revenue DESC, tickets DESC, trips DESC, b.id ASC`
      )
      .all();

    const boats = (boatsRows || []).map((r) => ({
      boat_id: Number(r.boat_id),
      boat_name: r.boat_name,
      boat_type: r.boat_type,
      revenue: Number(r.revenue || 0),
      tickets: Number(r.tickets || 0),
      trips: Number(r.trips || 0),
      source: 'presales',
    }));

    const totals = boats.reduce(
      (acc, x) => {
        acc.revenue += Number(x.revenue || 0);
        acc.tickets += Number(x.tickets || 0);
        acc.trips += Number(x.trips || 0);
        return acc;
      },
      { revenue: 0, tickets: 0, trips: 0 }
    );

    // Fill percent (best-effort): if generated_slots has seats_left and we can estimate capacity per slot.
    // If not possible safely, return 0 (UI shows 0%).
    let fillPercent = 0;
    try {
      const gsSeatsLeftCol = pickFirstExisting('generated_slots', ['seats_left', 'seatsLeft', 'left'], null);
      if (gsSeatsLeftCol) {
        // estimate capacity per slot as sold + max(seats_left,0)
        const row = db
          .prepare(
            `WITH sold AS (
               SELECT p.slot_uid AS slot_uid,
                      ${seatsCol ? `COALESCE(SUM(p.${seatsCol}),0)` : `COUNT(*)`} AS sold
               FROM presales p
               LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
               WHERE p.status='ACTIVE'
                 AND p.slot_uid LIKE 'generated:%'
                 ${whereRange}
               GROUP BY p.slot_uid
             ),
             cap AS (
               SELECT sold.slot_uid AS slot_uid,
                      sold.sold AS sold,
                      (SELECT MAX(COALESCE(gs.${gsSeatsLeftCol},0),0)
                       FROM generated_slots gs
                       WHERE gs.id = CAST(substr(sold.slot_uid, 11) AS INTEGER)
                      ) AS seats_left
               FROM sold
             )
             SELECT
               COALESCE(SUM(sold),0) AS sold_sum,
               COALESCE(SUM(sold + seats_left),0) AS cap_sum
             FROM cap`
          )
          .get();

        const soldSum = Number(row?.sold_sum || 0);
        const capSum = Number(row?.cap_sum || 0);
        if (capSum > 0) {
          fillPercent = Math.max(0, Math.min(100, Math.round((soldSum / capSum) * 100)));
        }
      }
    } catch {
      // ignore, keep 0
    }

    return res.json({
      ok: true,
      data: {
        preset,
        range: preset === 'all' ? null : { from: null, to: null },
        totals: { ...totals, fillPercent },
        boats,
      },
      meta: { warnings },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'owner boats failed' });
  }
});

// =====================
// GET /api/owner/sellers/list
// Returns ALL sellers (directory) for zone assignment - NOT analytics
// =====================
router.get('/sellers/list', (req, res) => {
  try {
    // Get all sellers with their zone assignment
    const rows = db.prepare(`
      SELECT id, username, is_active, zone
      FROM users
      WHERE role = 'seller'
      ORDER BY id
    `).all();
    
    const items = (rows || []).map(r => ({
      id: Number(r.id),
      username: r.username,
      is_active: Boolean(r.is_active),
      zone: r.zone || null
    }));
    
    return res.json({
      ok: true,
      data: { items }
    });
  } catch (e) {
    console.error('[owner/sellers/list] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to get sellers list' });
  }
});

// =====================
// GET /api/owner/sellers?preset=today|yesterday|7d|month|all
// Список продавцов с метриками paid/pending/forecast
// =====================
router.get('/sellers', (req, res) => {
  try {
    const preset = String(req.query.preset || 'today');
    
    // Валидация preset
    const validPresets = ['today', 'yesterday', 'd7', '7d', 'month', 'all'];
    if (!validPresets.includes(preset)) {
      return res.status(400).json({ ok: false, error: 'Invalid preset. Use: today, yesterday, 7d, month, all' });
    }
    
    const warnings = [];
    
    // Диапазон дат
    let fromExpr, toExpr;
    if (preset === 'all') {
      fromExpr = "DATE('1970-01-01')";
      toExpr = "DATE('now','localtime')";
    } else {
      const r = presetRange(preset);
      fromExpr = r.from;
      toExpr = r.to;
    }
    
    // Основной запрос: агрегация по seller_id
    // PAID = SELLER_SHIFT с типами SALE_*
    // PENDING = EXPECT_PAYMENT
    const rows = db.prepare(`
      SELECT
        u.id AS seller_id,
        u.username AS seller_name,
        
        -- PAID (SELLER_SHIFT)
        COALESCE(SUM(CASE 
          WHEN ml.kind = 'SELLER_SHIFT' 
            AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED')
          THEN ml.amount 
          ELSE 0 
        END), 0) AS revenue_paid_raw,
        
        -- Refunds (SALE_CANCEL_REVERSE) - вычитаем из paid
        COALESCE(SUM(CASE 
          WHEN ml.kind = 'SELLER_SHIFT' AND ml.type = 'SALE_CANCEL_REVERSE' 
          THEN ABS(ml.amount) 
          ELSE 0 
        END), 0) AS refunds_raw,
        
        -- PENDING (EXPECT_PAYMENT)
        COALESCE(SUM(CASE 
          WHEN ml.kind = 'EXPECT_PAYMENT' 
          THEN ml.amount 
          ELSE 0 
        END), 0) AS revenue_pending_raw,
        
        -- Tickets paid (count of SELLER_SHIFT transactions)
        COUNT(DISTINCT CASE WHEN ml.kind = 'SELLER_SHIFT' THEN ml.id END) AS tickets_paid_raw,
        
        -- Tickets pending (count of EXPECT_PAYMENT transactions)
        COUNT(DISTINCT CASE WHEN ml.kind = 'EXPECT_PAYMENT' THEN ml.id END) AS tickets_pending_raw,
        
        -- Shifts count (distinct days with SELLER_SHIFT)
        COUNT(DISTINCT CASE WHEN ml.kind = 'SELLER_SHIFT' THEN DATE(ml.business_day) END) AS shifts_count_raw
        
      FROM money_ledger ml
      LEFT JOIN users u ON u.id = ml.seller_id
      WHERE ml.status = 'POSTED'
        AND DATE(ml.business_day) BETWEEN ${fromExpr} AND ${toExpr}
        AND ml.seller_id IS NOT NULL
        AND ml.seller_id > 0
      GROUP BY u.id
      ORDER BY 
        (COALESCE(SUM(CASE WHEN ml.kind = 'SELLER_SHIFT' AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN ml.kind = 'SELLER_SHIFT' AND ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0)
         + COALESCE(SUM(CASE WHEN ml.kind = 'EXPECT_PAYMENT' THEN ml.amount ELSE 0 END), 0)) DESC
    `).all();
    
    // Обработка результатов
    const items = (rows || []).map(r => {
      const revenuePaid = Math.max(0, Number(r.revenue_paid_raw || 0) - Number(r.refunds_raw || 0));
      const revenuePending = Number(r.revenue_pending_raw || 0);
      const revenueForecast = revenuePaid + revenuePending;
      
      const ticketsPaid = Number(r.tickets_paid_raw || 0);
      const ticketsPending = Number(r.tickets_pending_raw || 0);
      const ticketsTotal = ticketsPaid + ticketsPending;
      
      const shiftsCount = Number(r.shifts_count_raw || 0);
      
      // Средний чек (только если есть tickets_paid)
      const avgCheckPaid = ticketsPaid > 0 ? Math.round(revenuePaid / ticketsPaid) : null;
      
      return {
        seller_id: Number(r.seller_id),
        seller_name: r.seller_name || `Seller ${r.seller_id}`,
        revenue_paid: revenuePaid,
        revenue_pending: revenuePending,
        revenue_forecast: revenueForecast,
        tickets_paid: ticketsPaid,
        tickets_pending: ticketsPending,
        tickets_total: ticketsTotal,
        shifts_count: shiftsCount,
        avg_check_paid: avgCheckPaid
      };
    });
    
    // Сортировка по revenue_forecast DESC, затем по revenue_paid DESC
    items.sort((a, b) => {
      if (b.revenue_forecast !== a.revenue_forecast) return b.revenue_forecast - a.revenue_forecast;
      return b.revenue_paid - a.revenue_paid;
    });
    
    // Итоги
    const totals = items.reduce((acc, item) => {
      acc.revenue_paid += item.revenue_paid;
      acc.revenue_pending += item.revenue_pending;
      acc.revenue_forecast += item.revenue_forecast;
      return acc;
    }, { revenue_paid: 0, revenue_pending: 0, revenue_forecast: 0 });
    
    // Добавляем revenue_per_shift и share_percent
    const totalRevenuePaid = totals.revenue_paid || 0;
    items.forEach(item => {
      // Выручка на смену
      item.revenue_per_shift = item.shifts_count > 0 ? Math.round(item.revenue_paid / item.shifts_count) : null;
      // Доля в общей выручке (0..1)
      item.share_percent = totalRevenuePaid > 0 ? Math.round((item.revenue_paid / totalRevenuePaid) * 1000) / 1000 : null;
    });
    
    return res.json({
      ok: true,
      data: {
        preset,
        range: preset === 'all' ? null : { from: null, to: null },
        items,
        totals
      },
      meta: { warnings }
    });
  } catch (e) {
    console.error('[owner/sellers] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'sellers failed' });
  }
});

// =====================
// PUT /api/owner/sellers/:id/zone
// Update seller zone assignment
// =====================
router.put('/sellers/:id/zone', (req, res) => {
  try {
    const sellerId = Number(req.params.id);
    let { zone } = req.body || {};
    
    // Validate seller ID
    if (!sellerId || isNaN(sellerId)) {
      return res.status(400).json({ ok: false, error: 'Invalid seller ID' });
    }
    
    // Normalize zone: trim string, empty string -> null
    if (typeof zone === 'string') {
      zone = zone.trim();
      if (zone === '') zone = null;
    }
    
    // Validate zone value
    const validZones = ['hedgehog', 'center', 'sanatorium', 'stationary', null];
    if (zone !== null && !validZones.includes(zone)) {
      return res.status(400).json({ ok: false, error: 'Invalid zone. Must be one of: hedgehog, center, sanatorium, stationary, or null' });
    }
    
    // Check if seller exists and has role='seller'
    const seller = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(sellerId);
    if (!seller) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    if (seller.role !== 'seller') {
      return res.status(400).json({ ok: false, error: 'User is not a seller' });
    }
    
    // Update zone
    const result = db.prepare('UPDATE users SET zone = ? WHERE id = ? AND role = ?').run(zone, sellerId, 'seller');
    
    if (result.changes === 0) {
      return res.status(400).json({ ok: false, error: 'Failed to update zone' });
    }
    
    console.log(`[owner/sellers/zone] Updated seller ${sellerId} zone to: ${zone}`);
    
    return res.json({ 
      ok: true, 
      data: { 
        seller_id: sellerId, 
        seller_name: seller.username,
        zone: zone 
      } 
    });
  } catch (e) {
    console.error('[owner/sellers/zone] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to update zone' });
  }
});

// =====================
// GET /api/owner/money/collected-today-by-tripday
// "Собрано сегодня" (по ДАТЕ ОПЛАТЫ), сгруппировано по ДАТЕ РЕЙСА (presales.business_day)
// total_* из money_ledger, cash/card_* из sales_transactions_canonical
// =====================
router.get('/money/collected-today-by-tripday', (req, res) => {
  try {
    const todayExpr = "DATE('now','localtime')";
    const tomorrowExpr = "DATE('now','localtime','+1 day')";
    const day2Expr = "DATE('now','localtime','+2 day')";
    const tripDayExpr = getTripDayExpr();

    // Total из money_ledger (по ДАТЕ ОПЛАТЫ = сегодня, группируем по tripDayExpr)
    const totalRow = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${todayExpr} THEN ml.amount ELSE 0 END), 0) AS total_today,
           COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${tomorrowExpr} THEN ml.amount ELSE 0 END), 0) AS total_tomorrow,
           COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${day2Expr} THEN ml.amount ELSE 0 END), 0) AS total_day2
         FROM money_ledger ml
         JOIN presales p ON p.id = ml.presale_id
         WHERE ml.status = 'POSTED'
           AND ml.kind = 'SELLER_SHIFT'
           AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
           AND DATE(ml.business_day) = ${todayExpr}`
      )
      .get();

    // Cash/Card из sales_transactions_canonical (MIXED уже разнесён)
    let usedStc = false;
    let cashToday = 0, cardToday = 0;
    let cashTomorrow = 0, cardTomorrow = 0;
    let cashDay2 = 0, cardDay2 = 0;

    try {
      const stcExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions_canonical'`).get();
      if (stcExists) {
        const stcCols = db.prepare(`PRAGMA table_info(sales_transactions_canonical)`).all().map(r => r.name);
        const hasCashAmt = stcCols.includes('cash_amount');
        const hasCardAmt = stcCols.includes('card_amount');
        const hasBusinessDay = stcCols.includes('business_day');

        if (hasCashAmt && hasCardAmt && hasBusinessDay) {
          const stcRow = db
            .prepare(
              `SELECT
                 COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${todayExpr} THEN stc.cash_amount ELSE 0 END), 0) AS cash_today,
                 COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${todayExpr} THEN stc.card_amount ELSE 0 END), 0) AS card_today,
                 COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${tomorrowExpr} THEN stc.cash_amount ELSE 0 END), 0) AS cash_tomorrow,
                 COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${tomorrowExpr} THEN stc.card_amount ELSE 0 END), 0) AS card_tomorrow,
                 COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${day2Expr} THEN stc.cash_amount ELSE 0 END), 0) AS cash_day2,
                 COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${day2Expr} THEN stc.card_amount ELSE 0 END), 0) AS card_day2
               FROM sales_transactions_canonical stc
               JOIN presales p ON p.id = stc.presale_id
               WHERE stc.status = 'VALID'
                 AND DATE(stc.business_day) = ${todayExpr}`
            )
            .get();
          cashToday = Number(stcRow?.cash_today || 0);
          cardToday = Number(stcRow?.card_today || 0);
          cashTomorrow = Number(stcRow?.cash_tomorrow || 0);
          cardTomorrow = Number(stcRow?.card_tomorrow || 0);
          cashDay2 = Number(stcRow?.cash_day2 || 0);
          cardDay2 = Number(stcRow?.card_day2 || 0);
          usedStc = true;
        }
      }
    } catch {
      // Fallback below
    }

    // Fallback: если stc недоступна, читаем cash/card из money_ledger (старая логика)
    if (!usedStc) {
      const cashCardExpr = getCashCardCaseExprs();
      const mlRow = db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${todayExpr} THEN ${cashCardExpr.cash} ELSE 0 END), 0) AS cash_today,
             COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${todayExpr} THEN ${cashCardExpr.card} ELSE 0 END), 0) AS card_today,
             COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${tomorrowExpr} THEN ${cashCardExpr.cash} ELSE 0 END), 0) AS cash_tomorrow,
             COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${tomorrowExpr} THEN ${cashCardExpr.card} ELSE 0 END), 0) AS card_tomorrow,
             COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${day2Expr} THEN ${cashCardExpr.cash} ELSE 0 END), 0) AS cash_day2,
             COALESCE(SUM(CASE WHEN (${tripDayExpr}) = ${day2Expr} THEN ${cashCardExpr.card} ELSE 0 END), 0) AS card_day2
           FROM money_ledger ml
           JOIN presales p ON p.id = ml.presale_id
           WHERE ml.status = 'POSTED'
             AND ml.kind = 'SELLER_SHIFT'
             AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
             AND DATE(ml.business_day) = ${todayExpr}`
        )
        .get();
      cashToday = Number(mlRow?.cash_today || 0);
      cardToday = Number(mlRow?.card_today || 0);
      cashTomorrow = Number(mlRow?.cash_tomorrow || 0);
      cardTomorrow = Number(mlRow?.card_tomorrow || 0);
      cashDay2 = Number(mlRow?.cash_day2 || 0);
      cardDay2 = Number(mlRow?.card_day2 || 0);
    }

    const totalToday = Number(totalRow?.total_today || 0);
    const totalTomorrow = Number(totalRow?.total_tomorrow || 0);
    const totalDay2 = Number(totalRow?.total_day2 || 0);

    return res.json({
      ok: true,
      data: {
        collected_day: 'today',
        by_trip_day: {
          today: { revenue: totalToday, cash: cashToday, card: cardToday },
          tomorrow: { revenue: totalTomorrow, cash: cashTomorrow, card: cardTomorrow },
          day2: { revenue: totalDay2, cash: cashDay2, card: cardDay2 },
        },
      },
      meta: { warnings: [] },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'collected-today-by-tripday failed' });
  }
});

// =====================
// MANUAL / OFFLINE INPUT ENDPOINTS
// =====================

// Helper: merge multiple drafts into one payload
function mergeDrafts(drafts) {
  if (!drafts || drafts.length === 0) {
    return { comment: '', money: { cash: 0, card: 0, pending: 0 }, boats: [], sellers: [] };
  }
  
  const merged = {
    comment: '',
    money: { cash: 0, card: 0, pending: 0 },
    boats: [],
    sellers: []
  };
  
  // Merge comments (take longest)
  for (const d of drafts) {
    const p = d.payload;
    if (p?.comment && String(p.comment).length > merged.comment.length) {
      merged.comment = p.comment;
    }
    // Sum money
    merged.money.cash += Number(p?.money?.cash || 0);
    merged.money.card += Number(p?.money?.card || 0);
    merged.money.pending += Number(p?.money?.pending || 0);
  }
  
  // Merge boats by key (boat_id or name+type)
  const boatsMap = new Map();
  for (const d of drafts) {
    for (const b of (d.payload?.boats || [])) {
      const key = b.boat_id ? `id:${b.boat_id}` : `name:${b.name || ''}:${b.type || ''}`;
      const existing = boatsMap.get(key);
      if (existing) {
        existing.trips += Number(b.trips || 0);
        existing.seats += Number(b.seats || 0);
        existing.revenue += Number(b.revenue || 0);
      } else {
        boatsMap.set(key, {
          boat_id: b.boat_id || null,
          type: b.type || 'прогулочная',
          name: b.name || '',
          trips: Number(b.trips || 0),
          seats: Number(b.seats || 0),
          revenue: Number(b.revenue || 0)
        });
      }
    }
  }
  merged.boats = Array.from(boatsMap.values());
  
  // Merge sellers by key (seller_id or name)
  const sellersMap = new Map();
  for (const d of drafts) {
    for (const s of (d.payload?.sellers || [])) {
      const key = s.seller_id ? `id:${s.seller_id}` : `name:${s.name || ''}`;
      const existing = sellersMap.get(key);
      if (existing) {
        existing.revenue_paid += Number(s.revenue_paid || s.revenue || 0);
        existing.revenue_pending += Number(s.revenue_pending || 0);
        existing.seats += Number(s.seats || 0);
        if (s.contacts && existing.contacts && !existing.contacts.includes(s.contacts)) {
          existing.contacts = existing.contacts + '; ' + s.contacts;
        } else if (s.contacts) {
          existing.contacts = s.contacts;
        }
      } else {
        sellersMap.set(key, {
          seller_id: s.seller_id || null,
          name: s.name || '',
          revenue_paid: Number(s.revenue_paid || s.revenue || 0),
          revenue_pending: Number(s.revenue_pending || 0),
          seats: Number(s.seats || 0),
          contacts: s.contacts || null
        });
      }
    }
  }
  merged.sellers = Array.from(sellersMap.values());
  
  return merged;
}

// GET /api/owner/manual/day?date=YYYY-MM-DD
router.get('/manual/day', (req, res) => {
  try {
    const date = String(req.query.date || req.query.day || '').trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, error: 'Invalid date format (use YYYY-MM-DD)' });
    }
    
    const userId = req.user?.id;
    
    // Check if day is locked
    const dayRow = db.prepare('SELECT locked, locked_by_user_id, locked_at FROM manual_days WHERE business_day = ?').get(date);
    const isLocked = Boolean(dayRow?.locked);
    
    // Get all drafts for this period (locked=0)
    const draftRows = db.prepare(`
      SELECT mb.id, mb.payload_json, mb.created_by_user_id, mb.updated_at as saved_at,
             u.username as author_name
      FROM manual_batches mb
      LEFT JOIN users u ON u.id = mb.created_by_user_id
      WHERE mb.period = ? AND mb.locked = 0
      ORDER BY mb.updated_at DESC
    `).all(date);
    
    const drafts = (draftRows || []).map(r => ({
      id: r.id,
      author: { id: r.created_by_user_id, name: r.author_name || `User ${r.created_by_user_id}` },
      savedAt: r.saved_at,
      payload: JSON.parse(r.payload_json || '{}')
    }));
    
    // Get locked batch if exists
    const lockedRow = db.prepare(`
      SELECT mb.id, mb.payload_json, mb.locked_by_user_id, mb.locked_at,
             u.username as locked_by_name
      FROM manual_batches mb
      LEFT JOIN users u ON u.id = mb.locked_by_user_id
      WHERE mb.period = ? AND mb.locked = 1
      LIMIT 1
    `).get(date);
    
    let payload;
    let lockedBy = null;
    
    if (isLocked && lockedRow) {
      payload = JSON.parse(lockedRow.payload_json || '{}');
      lockedBy = { id: lockedRow.locked_by_user_id, name: lockedRow.locked_by_name };
    } else {
      payload = mergeDrafts(drafts);
    }
    
    // Calculate totals
    const paid = Number(payload.money?.cash || 0) + Number(payload.money?.card || 0);
    const pending = Number(payload.money?.pending || 0);
    const forecast = paid + pending;
    
    payload.money = payload.money || {};
    payload.money.paid = paid;
    payload.money.forecast = forecast;
    
    const boatsRevenue = (payload.boats || []).reduce((s, b) => s + Number(b.revenue || 0), 0);
    const sellersRevenuePaid = (payload.sellers || []).reduce((s, s2) => s + Number(s2.revenue_paid || 0), 0);
    const sellersRevenuePending = (payload.sellers || []).reduce((s, s2) => s + Number(s2.revenue_pending || 0), 0);
    const sellersRevenueForecast = sellersRevenuePaid + sellersRevenuePending;
    
    // Add forecast to each seller
    payload.sellers = (payload.sellers || []).map(s => ({
      ...s,
      revenue_forecast: Number(s.revenue_paid || 0) + Number(s.revenue_pending || 0)
    }));
    
    // Find current user's draft
    const myDraft = drafts.find(d => d.author.id === userId);
    
    res.json({
      ok: true,
      period: date,
      locked: isLocked,
      lockedAt: lockedRow?.locked_at || null,
      lockedBy,
      drafts: drafts.map(d => ({ id: d.id, author: d.author, savedAt: d.savedAt })),
      myDraftId: myDraft?.id || null,
      payload,
      totals: {
        boatsRevenue,
        sellersRevenuePaid,
        sellersRevenuePending,
        sellersRevenueForecast,
        cash: Number(payload.money?.cash || 0),
        card: Number(payload.money?.card || 0),
        pending,
        paid,
        forecast
      }
    });
  } catch (e) {
    console.error('[owner/manual/day] Error:', e);
    res.status(500).json({ ok: false, error: e?.message || 'Failed to load manual day' });
  }
});

// PUT /api/owner/manual/day
router.put('/manual/day', (req, res) => {
  try {
    const userId = req.user?.id;
    const body = req.body || {};
    
    let period = String(body.dateFrom || body.date || body.period || '').trim();
    if (!period || !/^\d{4}-\d{2}-\d{2}$/.test(period)) {
      return res.status(400).json({ ok: false, error: 'Invalid date format' });
    }
    
    // Check if dateFrom != dateTo
    if (body.dateFrom && body.dateTo && body.dateFrom !== body.dateTo) {
      return res.status(400).json({ ok: false, error: 'Only single-day periods allowed (dateFrom must equal dateTo)' });
    }
    
    // Check if day is locked
    const dayRow = db.prepare('SELECT locked FROM manual_days WHERE business_day = ?').get(period);
    if (dayRow?.locked) {
      return res.status(409).json({ ok: false, error: 'Period is locked' });
    }
    
    const payload = {
      comment: String(body.comment || ''),
      money: {
        cash: Number(body.money?.cash || body.cash || 0),
        card: Number(body.money?.card || body.card || 0),
        pending: Number(body.money?.pending || body.pending || 0)
      },
      boats: (body.boats || []).map(b => ({
        boat_id: b.boat_id || null,
        type: b.type || 'прогулочная',
        name: String(b.name || ''),
        trips: Number(b.trips || 0),
        seats: Number(b.seats || 0),
        revenue: Number(b.revenue || 0)
      })),
      sellers: (body.sellers || []).map(s => ({
        seller_id: s.seller_id || null,
        name: String(s.name || ''),
        revenue_paid: Number(s.revenue_paid || s.revenue || 0),
        revenue_pending: Number(s.revenue_pending || 0),
        seats: Number(s.seats || 0),
        contacts: s.contacts || null
      }))
    };
    
    const now = new Date().toISOString();
    const payloadJson = JSON.stringify(payload);
    
    // Upsert draft by period + user
    const existing = db.prepare(`
      SELECT id FROM manual_batches 
      WHERE period = ? AND created_by_user_id = ? AND locked = 0
    `).get(period, userId);
    
    let batchId;
    if (existing) {
      db.prepare(`
        UPDATE manual_batches 
        SET payload_json = ?, updated_at = ?, updated_by_user_id = ?, date_from = ?, date_to = ?
        WHERE id = ?
      `).run(payloadJson, now, userId, period, period, existing.id);
      batchId = existing.id;
    } else {
      const result = db.prepare(`
        INSERT INTO manual_batches (period, date_from, date_to, payload_json, locked, created_at, updated_at, created_by_user_id, updated_by_user_id)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).run(period, period, period, payloadJson, now, now, userId, userId);
      batchId = result.lastInsertRowid;
    }
    
    res.json({ ok: true, id: batchId, savedAt: now, period });
  } catch (e) {
    console.error('[owner/manual/day PUT] Error:', e);
    res.status(500).json({ ok: false, error: e?.message || 'Failed to save draft' });
  }
});

// POST /api/owner/manual/lock
router.post('/manual/lock', (req, res) => {
  try {
    const userId = req.user?.id;
    const body = req.body || {};
    
    let period = String(body.date || body.period || body.day || '').trim();
    if (!period || !/^\d{4}-\d{2}-\d{2}$/.test(period)) {
      return res.status(400).json({ ok: false, error: 'Invalid date format' });
    }
    
    // Check if already locked
    const dayRow = db.prepare('SELECT locked FROM manual_days WHERE business_day = ?').get(period);
    if (dayRow?.locked) {
      return res.status(409).json({ ok: false, error: 'Already locked' });
    }
    
    // Get all drafts
    const draftRows = db.prepare(`
      SELECT id, payload_json, created_by_user_id
      FROM manual_batches
      WHERE period = ? AND locked = 0
    `).all(period);
    
    if (!draftRows || draftRows.length === 0) {
      return res.status(400).json({ ok: false, error: 'No drafts to lock' });
    }
    
    const drafts = draftRows.map(r => ({
      id: r.id,
      payload: JSON.parse(r.payload_json || '{}')
    }));
    
    const mergedPayload = mergeDrafts(drafts);
    const now = new Date().toISOString();
    const payloadJson = JSON.stringify(mergedPayload);
    
    // Mark all drafts as locked
    db.prepare(`
      UPDATE manual_batches 
      SET locked = 1, locked_at = ?, locked_by_user_id = ?, payload_json = ?
      WHERE period = ? AND locked = 0
    `).run(now, userId, payloadJson, period);
    
    // Mark day as locked (business_day is PRIMARY KEY, set both locked and is_locked)
    db.prepare(`
      INSERT INTO manual_days (business_day, locked, is_locked, locked_by_user_id, locked_at)
      VALUES (?, 1, 1, ?, ?)
      ON CONFLICT(business_day) DO UPDATE SET locked = 1, is_locked = 1, locked_by_user_id = ?, locked_at = ?
    `).run(period, userId, now, userId, now);
    
    // Clean old stats for this period before inserting new ones
    db.prepare('DELETE FROM manual_boat_stats WHERE business_day = ?').run(period);
    db.prepare('DELETE FROM manual_seller_stats WHERE business_day = ?').run(period);
    
    // Fill manual_boat_stats
    for (const b of (mergedPayload.boats || [])) {
      if (b.boat_id) {
        try {
          db.prepare(`
            INSERT INTO manual_boat_stats (business_day, boat_id, revenue, trips, tickets, capacity)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            period,
            b.boat_id,
            b.revenue || 0,
            b.trips || 0,
            b.seats || 0,
            b.capacity || 0
          );
        } catch {}
      }
    }
    
    // Fill manual_seller_stats
    for (const s of (mergedPayload.sellers || [])) {
      if (s.seller_id) {
        try {
          db.prepare(`
            INSERT INTO manual_seller_stats (business_day, seller_id, revenue, trips, tickets)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            period,
            s.seller_id,
            (s.revenue_paid || 0) + (s.revenue_pending || 0),
            s.trips || 0,
            s.seats || 0
          );
        } catch {}
      }
    }
    
    const paid = Number(mergedPayload.money?.cash || 0) + Number(mergedPayload.money?.card || 0);
    const pending = Number(mergedPayload.money?.pending || 0);
    
    res.json({
      ok: true,
      locked: true,
      period,
      lockedAt: now,
      lockedBy: { id: userId },
      totals: {
        paid,
        pending,
        forecast: paid + pending
      }
    });
  } catch (e) {
    console.error('[owner/manual/lock] Error:', e);
    res.status(500).json({ ok: false, error: e?.message || 'Failed to lock period' });
  }
});

// =====================
// GET /api/owner/settings/full
// Returns owner settings with defaults if not set
// =====================
const OWNER_SETTINGS_DEFAULTS = {
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
  motivation_percent: 0.15,           // доля (0.15 = 15%)
  individual_share: 0.60,            // доля индивидуального фонда
  team_share: 0.40,                  // доля командного фонда
  daily_activation_threshold: 200000,
  seller_series_threshold: 40000,
  dispatchers_series_threshold: 55000,
  season_min_days_N: 1,
  
  // Team participation
  teamIncludeSellers: true,
  teamIncludeDispatchers: true,
  
  // Product coefficients (k_*) - all > 0
  k_speed: 1.2,
  k_cruise: 3.0,
  k_fishing: 5.0,
  // Zone coefficients for speed/cruise (motivation v1)
  k_zone_hedgehog: 1.3,
  k_zone_center: 1.0,
  k_zone_sanatorium: 0.8,
  k_zone_stationary: 0.7,
  // Banana zone coefficients
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
  dispatcher_withhold_percent_total: 0.002,   // 0.2% total cap for dispatcher withhold
  weekly_withhold_percent_total: 0.008,       // 0.8% withhold for weekly pool
  season_withhold_percent_total: 0.005        // 0.5% withhold for season pool
};

// Helper: clamp value to min
function clampMin(v, min) {
  const n = Number(v);
  if (isNaN(n)) return null;
  return Math.max(min, n);
}

// Helper: build full normalized settings from input (STRICT: no merge, explicit field mapping)
function buildFullSettings(body, defaults) {
  const normalized = { ...defaults };
  
  // === PERCENT FIELDS: LEGACY (always divide by 100) ===
  if (body.motivationPercent !== undefined) {
    normalized.motivation_percent = Number(body.motivationPercent) / 100;
  }
  
  // === PERCENT FIELDS: NEW FORMAT (use as-is) - overrides legacy ===
  if (body.motivation_percent !== undefined) {
    normalized.motivation_percent = Number(body.motivation_percent);
  }
  
  // === MOTIVATION TYPE-SPECIFIC PERCENT FIELDS (0..100 -> 0..1) ===
  if (body.motivationPersonalPercent !== undefined) {
    normalized.motivation_personal_percent = Number(body.motivationPersonalPercent) / 100;
  }
  if (body.motivationTeamPercent !== undefined) {
    normalized.motivation_team_percent = Number(body.motivationTeamPercent) / 100;
  }
  
  // === STRING FIELDS ===
  ['businessName', 'timezone', 'currency', 'seasonStart', 'seasonEnd', 'motivationType', 'notifyChannel'].forEach(k => {
    if (body[k] !== undefined) normalized[k] = String(body[k]);
  });
  
  // === BOOLEAN FIELDS ===
  ['teamIncludeSellers', 'teamIncludeDispatchers', 'notifyBadRevenue', 'notifyLowLoad', 'notifyLowSeller'].forEach(k => {
    if (body[k] !== undefined) normalized[k] = Boolean(body[k]);
  });
  
  // === NUMERIC FIELDS (direct) ===
  ['badDay', 'normalDay', 'goodDay', 'baseCompareDays', 'daily_activation_threshold', 
   'seller_series_threshold', 'dispatchers_series_threshold', 'season_min_days_N',
   'lowLoad', 'highLoad', 'minSellerRevenue'].forEach(k => {
    if (body[k] !== undefined) normalized[k] = Number(body[k]);
  });
  
  // === SHARE FIELDS (come as fractions from frontend) ===
  if (body.individual_share !== undefined) {
    normalized.individual_share = Number(body.individual_share);
  }
  if (body.team_share !== undefined) {
    normalized.team_share = Number(body.team_share);
  }
  
  // === WITHHOLD PERCENT FIELDS (come as percent from frontend, stored as fraction) ===
  if (body.dispatcherWithholdPercentTotal !== undefined) {
    normalized.dispatcher_withhold_percent_total = Number(body.dispatcherWithholdPercentTotal) / 100;
  }
  if (body.dispatcher_withhold_percent_total !== undefined) {
    normalized.dispatcher_withhold_percent_total = Number(body.dispatcher_withhold_percent_total);
  }
  
  // Weekly withhold percent (come as percent from frontend, stored as fraction)
  if (body.weeklyWithholdPercentTotal !== undefined) {
    normalized.weekly_withhold_percent_total = Number(body.weeklyWithholdPercentTotal) / 100;
  }
  if (body.weekly_withhold_percent_total !== undefined) {
    normalized.weekly_withhold_percent_total = Number(body.weekly_withhold_percent_total);
  }
  
  // Season withhold percent (come as percent from frontend, stored as fraction)
  if (body.seasonWithholdPercentTotal !== undefined) {
    normalized.season_withhold_percent_total = Number(body.seasonWithholdPercentTotal) / 100;
  }
  if (body.season_withhold_percent_total !== undefined) {
    normalized.season_withhold_percent_total = Number(body.season_withhold_percent_total);
  }
  
  // Validate: individual_share + team_share = 1 (normalize if needed)
  const indShare = normalized.individual_share ?? 0.60;
  const teamShare = normalized.team_share ?? 0.40;
  if (Math.abs(indShare + teamShare - 1) > 0.01) {
    const total = indShare + teamShare;
    if (total > 0) {
      normalized.individual_share = indShare / total;
      normalized.team_share = teamShare / total;
    }
  }
  
  // === COEFFICIENT FIELDS: LEGACY -> FINAL MAPPING ===
  if (body.coefSpeed !== undefined) normalized.k_speed = clampMin(body.coefSpeed, 0.0001);
  if (body.coefWalk !== undefined) normalized.k_cruise = clampMin(body.coefWalk, 0.0001);
  if (body.coefFishing !== undefined) normalized.k_fishing = clampMin(body.coefFishing, 0.0001);
  if (body.coefBanana !== undefined) normalized.k_banana = clampMin(body.coefBanana, 0.0001);
  if (body.zoneYozhik !== undefined) normalized.k_banana_hedgehog = clampMin(body.zoneYozhik, 0.0001);
  if (body.zoneCenter !== undefined) normalized.k_banana_center = clampMin(body.zoneCenter, 0.0001);
  if (body.zoneSanatorka !== undefined) normalized.k_banana_sanatorium = clampMin(body.zoneSanatorka, 0.0001);
  if (body.zoneStationary !== undefined) normalized.k_banana_stationary = clampMin(body.zoneStationary, 0.0001);
  
  // === DIRECT k_* FIELDS (override legacy) ===
  ['k_speed', 'k_cruise', 'k_fishing', 'k_banana_hedgehog', 'k_banana_center', 
   'k_banana_sanatorium', 'k_banana_stationary', 'k_dispatchers',
   'k_zone_hedgehog', 'k_zone_center', 'k_zone_sanatorium', 'k_zone_stationary'].forEach(k => {
    if (body[k] !== undefined) normalized[k] = clampMin(body[k], 0.0001);
  });
  
  return normalized;
}

// Helper: add computed legacy fields for response (not stored in DB)
function addLegacyFields(settings) {
  const result = { ...settings };
  // Computed legacy percent fields (always synchronized)
  // Use the raw fraction value, multiply by 100, preserve decimals
  result.motivationPercentLegacy = (settings.motivation_percent ?? 0.15) * 100;
  
  // Motivation type-specific percent legacy fields
  const personalP = settings.motivation_personal_percent ?? settings.motivation_percent ?? 0.15;
  const teamP = settings.motivation_team_percent ?? settings.motivation_percent ?? 0.15;
  result.motivationPersonalPercentLegacy = Math.round(personalP * 100);
  result.motivationTeamPercentLegacy = Math.round(teamP * 100);
  
  // Boat coefficient legacy aliases (frontend uses these names)
  result.coefSpeed = settings.k_speed ?? 1.2;
  result.coefWalk = settings.k_cruise ?? 3.0;
  result.coefFishing = settings.k_fishing ?? 5.0;
  
  // Withhold percent field (show as percent in UI)
  result.dispatcherWithholdPercentTotalLegacy = (settings.dispatcher_withhold_percent_total ?? 0.002) * 100;
  result.weeklyWithholdPercentTotalLegacy = (settings.weekly_withhold_percent_total ?? 0.008) * 100;
  result.seasonWithholdPercentTotalLegacy = (settings.season_withhold_percent_total ?? 0.005) * 100;
  
  return result;
}

router.get('/settings/full', (req, res) => {
  try {
    const row = db.prepare("SELECT settings_json FROM owner_settings WHERE id = 1").get();
    
    if (!row || !row.settings_json) {
      // Return defaults with legacy fields
      const settings = addLegacyFields({ ...OWNER_SETTINGS_DEFAULTS });
      return res.json({ ok: true, data: settings });
    }
    
    const saved = JSON.parse(row.settings_json || '{}');
    
    // Merge with defaults to ensure complete object (saved overrides defaults)
    const settings = addLegacyFields({ ...OWNER_SETTINGS_DEFAULTS, ...saved });
    
    return res.json({ ok: true, data: settings });
  } catch (e) {
    console.error('[owner/settings/full GET] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to load settings' });
  }
});

// =====================
// PUT /api/owner/settings/full
// Saves FULL settings object (not patch) with validation and format conversion
// =====================
router.put('/settings/full', (req, res) => {
  try {
    const body = req.body || {};
    
    // RAW BODY DUMP - trace exactly what we receive
    console.log('\n========== PUT /owner/settings/full ==========');
    console.log('[RAW BODY] Full body keys:', Object.keys(body));
    console.log('[RAW BODY] toWeeklyFund:', body.toWeeklyFund, typeof body.toWeeklyFund);
    console.log('[RAW BODY] toSeasonFund:', body.toSeasonFund, typeof body.toSeasonFund);
    console.log('[RAW BODY] motivationPercent:', body.motivationPercent, typeof body.motivationPercent);
    console.log('[RAW BODY] weekly_percent:', body.weekly_percent, typeof body.weekly_percent);
    console.log('[RAW BODY] season_percent:', body.season_percent, typeof body.season_percent);
    console.log('[RAW BODY] motivation_percent:', body.motivation_percent, typeof body.motivation_percent);
    console.log('===============================================\n');
    
    // 1. Start from defaults only (no merge from existing - prevents stale data)
    const settings = buildFullSettings(body, OWNER_SETTINGS_DEFAULTS);
    
    // Debug log result
    console.log('[RESULT] weekly_percent:', settings.weekly_percent);
    console.log('[RESULT] season_percent:', settings.season_percent);
    console.log('[RESULT] motivation_percent:', settings.motivation_percent);
    
    // 2. Save FULL settings object to DB
    const now = new Date().toISOString();
    const jsonStr = JSON.stringify(settings);
    
    console.log('[DB SAVE] Saving to DB:', jsonStr.substring(0, 200) + '...');
    
    db.prepare(`
      UPDATE owner_settings SET settings_json = ?, updated_at = ? WHERE id = 1
    `).run(jsonStr, now);
    
    // 3. Return with computed legacy fields
    const responseSettings = addLegacyFields(settings);
    console.log('[owner/settings/full PUT] Response legacy:', {
      motivationPercentLegacy: responseSettings.motivationPercentLegacy,
      toWeeklyFundLegacy: responseSettings.toWeeklyFundLegacy,
      toSeasonFundLegacy: responseSettings.toSeasonFundLegacy
    });
    return res.json({ ok: true, data: responseSettings });
  } catch (e) {
    console.error('[owner/settings/full PUT] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to save settings' });
  }
});

export default router;
