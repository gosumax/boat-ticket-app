import express from 'express';
import db from './db.js';

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
  return `(
    (ml.kind='PAYMENT' AND ml.type='PRESALE_PAYMENT')
    OR (ml.kind='SELLER_SHIFT' AND (ml.type LIKE 'SALE_ACCEPTED_%' OR ml.type LIKE 'SALE_PREPAYMENT_%'))
  )`;
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
    const preset = String(req.query.preset || 'today');
    const r = presetRange(preset);
    const fromExpr = r.from;
    const toExpr = r.to;

    // === СОБРАНО ДЕНЕГ: из money_ledger по ДАТЕ ОПЛАТЫ ===
    // Используем money_ledger.business_day как дату оплаты
    // Только POSTED, только SELLER_SHIFT (не EXPECT_PAYMENT)
    // Типы: SALE_PREPAYMENT_CASH, SALE_ACCEPTED_CASH, SALE_ACCEPTED_CARD, SALE_ACCEPTED_MIXED, SALE_CANCEL_REVERSE
    const collectedRow = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE
             WHEN method = 'CASH' THEN amount
             WHEN method = 'CARD' THEN 0
             WHEN method = 'MIXED' THEN amount
             ELSE 0
           END), 0) AS collected_cash,
           COALESCE(SUM(CASE
             WHEN method = 'CARD' THEN amount
             WHEN method = 'CASH' THEN 0
             WHEN method = 'MIXED' THEN 0
             ELSE 0
           END), 0) AS collected_card,
           COALESCE(SUM(amount), 0) AS collected_total
         FROM money_ledger
         WHERE status = 'POSTED'
           AND kind = 'SELLER_SHIFT'
           AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
           AND DATE(business_day) BETWEEN ${fromExpr} AND ${toExpr}`
      )
      .get();

    // === БИЛЕТЫ/РЕЙСЫ: из presales по ДАТЕ РЕЙСА (business_day) ===
    // Включаем только ACTIVE (исключаем CANCELLED)
    const tripDayExpr = getTripDayExpr();
    const seatsCol = pickFirstExisting('presales', ['number_of_seats', 'qty', 'seats'], null);
    const ticketsAgg = seatsCol ? `COALESCE(SUM(p.${seatsCol}),0)` : `COUNT(*)`;

    const statsRow = db
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

    // === ЗАГРУЗКА: оценка по generated_slots ===
    let fillPercent = 0;
    try {
      const gsSeatsLeftCol = pickFirstExisting('generated_slots', ['seats_left', 'seatsLeft', 'left'], null);
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
    } catch {
      // ignore
    }

    const collectedTotal = Number(collectedRow?.collected_total || 0);
    const collectedCash = Number(collectedRow?.collected_cash || 0);
    const collectedCard = Number(collectedRow?.collected_card || 0);
    const tickets = Number(statsRow?.tickets || 0);
    const trips = Number(statsRow?.trips || 0);

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
          tickets,
          trips,
          fillPercent,
        },
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

    const row = db
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
// График "Собрано по дням" — по ДАТЕ ОПЛАТЫ из money_ledger
// =====================
router.get('/money/compare-days', (req, res) => {
  try {
    const preset = String(req.query.preset || '7d');
    const r = presetRange(preset);

    // Данные из money_ledger по ДАТЕ ОПЛАТЫ (business_day)
    const rows = db
      .prepare(
        `SELECT
           DATE(business_day) AS day,
           COALESCE(SUM(amount), 0) AS revenue,
           COALESCE(SUM(CASE WHEN method = 'CASH' THEN amount ELSE 0 END), 0) AS cash,
           COALESCE(SUM(CASE WHEN method = 'CARD' THEN amount ELSE 0 END), 0) AS card
         FROM money_ledger
         WHERE status = 'POSTED'
           AND kind = 'SELLER_SHIFT'
           AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
           AND DATE(business_day) BETWEEN ${r.from} AND ${r.to}
         GROUP BY DATE(business_day)
         ORDER BY day ASC`
      )
      .all();

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
    const computePeriodMetrics = (fromExpr, toExpr) => {
      // Payments: SALE_PREPAYMENT_CASH, SALE_ACCEPTED_CASH, SALE_ACCEPTED_CARD, SALE_ACCEPTED_MIXED
      const paymentsRow = db
        .prepare(
          `SELECT
             COALESCE(SUM(amount), 0) AS revenue_gross,
             COALESCE(SUM(CASE WHEN method = 'CASH' THEN amount ELSE 0 END), 0) AS cash,
             COALESCE(SUM(CASE WHEN method = 'CARD' THEN amount ELSE 0 END), 0) AS card,
             COALESCE(SUM(CASE WHEN method = 'MIXED' THEN amount ELSE 0 END), 0) AS mixed
           FROM money_ledger
           WHERE status = 'POSTED'
             AND kind = 'SELLER_SHIFT'
             AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
             AND DATE(business_day) BETWEEN ${fromExpr} AND ${toExpr}`
        )
        .get();

      // Refunds: SALE_CANCEL_REVERSE
      const refundsRow = db
        .prepare(
          `SELECT COALESCE(SUM(ABS(amount)), 0) AS refund
           FROM money_ledger
           WHERE status = 'POSTED'
             AND kind = 'SELLER_SHIFT'
             AND type = 'SALE_CANCEL_REVERSE'
             AND DATE(business_day) BETWEEN ${fromExpr} AND ${toExpr}`
        )
        .get();

      const revenueGross = Number(paymentsRow?.revenue_gross || 0);
      const cash = Number(paymentsRow?.cash || 0);
      const card = Number(paymentsRow?.card || 0);
      const mixed = Number(paymentsRow?.mixed || 0);
      const refund = Number(refundsRow?.refund || 0);
      const revenueNet = revenueGross - refund;

      // Share percentages
      const cashShare = revenueGross > 0 ? (cash / revenueGross) * 100 : 0;
      const cardShare = revenueGross > 0 ? (card / revenueGross) * 100 : 0;
      const mixedShare = revenueGross > 0 ? (mixed / revenueGross) * 100 : 0;

      return {
        revenue_gross: revenueGross,
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
      refund_abs: computeDelta(metricsA.refund, metricsB.refund).abs,
      refund_percent: computeDelta(metricsA.refund, metricsB.refund).percent,
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
          COALESCE(SUM(CASE WHEN type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN amount ELSE 0 END), 0) AS revenue_gross,
          COALESCE(SUM(CASE WHEN type = 'SALE_CANCEL_REVERSE' THEN ABS(amount) ELSE 0 END), 0) AS refund
        FROM money_ledger
        WHERE status = 'POSTED'
          AND kind = 'SELLER_SHIFT'
          AND type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
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
          COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
          COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund
        FROM money_ledger ml
        LEFT JOIN presales p ON p.id = ml.presale_id
        LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
        WHERE ml.status = 'POSTED'
          AND ml.kind = 'SELLER_SHIFT'
          AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
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
          COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
          COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund
        FROM money_ledger ml
        WHERE ml.status = 'POSTED'
          AND ml.kind = 'SELLER_SHIFT'
          AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
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
          COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
          COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund
        FROM money_ledger ml
        LEFT JOIN presales p ON p.id = ml.presale_id
        LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
        LEFT JOIN boats b ON b.id = bs.boat_id
        WHERE ml.status = 'POSTED'
          AND ml.kind = 'SELLER_SHIFT'
          AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
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
          COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
          COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refund
        FROM money_ledger ml
        LEFT JOIN users u ON u.id = ml.seller_id
        WHERE ml.status = 'POSTED'
          AND ml.kind = 'SELLER_SHIFT'
          AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
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
    
    // Validate date format
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return res.status(400).json({ ok: false, error: 'Invalid day format (use YYYY-MM-DD)' });
    }
    
    const warnings = [];
    
    // ====================
    // STEP 1: Get or create day settings snapshot
    // ====================
    let daySettingsRow = db.prepare('SELECT settings_json FROM motivation_day_settings WHERE business_day = ?').get(day);
    let settings;
    
    if (daySettingsRow?.settings_json) {
      // Use existing snapshot
      settings = JSON.parse(daySettingsRow.settings_json);
    } else {
      // Create new snapshot from current owner settings
      const ownerRow = db.prepare("SELECT settings_json FROM owner_settings WHERE id = 1").get();
      const savedSettings = ownerRow?.settings_json ? JSON.parse(ownerRow.settings_json) : {};
      settings = { ...OWNER_SETTINGS_DEFAULTS, ...savedSettings };
      
      // Save snapshot
      const now = new Date().toISOString();
      db.prepare('INSERT INTO motivation_day_settings (business_day, settings_json, created_at) VALUES (?, ?, ?)').run(day, JSON.stringify(settings), now);
      warnings.push('Создан слепок настроек дня');
    }
    
    const mode = settings.motivationType || 'team';
    const p = Number(settings.motivation_percent ?? 0.15);
    const fundPercent = Math.round(p * 100);
    
    // ====================
    // STEP 2: Calculate revenue for the day
    // ====================
    const revenueRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
        COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refunds
      FROM money_ledger ml
      WHERE ml.status = 'POSTED'
        AND ml.kind = 'SELLER_SHIFT'
        AND DATE(ml.business_day) = ?
    `).get(day);
    
    const revenue_total = Math.max(0, Number(revenueRow?.revenue_gross || 0) - Number(revenueRow?.refunds || 0));
    const fundTotal = Math.round(revenue_total * p);
    
    // ====================
    // STEP 3: Get sellers with revenue for the day
    // ====================
    const sellersWithRevenue = db.prepare(`
      SELECT
        ml.seller_id,
        u.username,
        COALESCE(SUM(ml.amount), 0) AS revenue
      FROM money_ledger ml
      JOIN users u ON u.id = ml.seller_id
      WHERE ml.status = 'POSTED'
        AND ml.kind = 'SELLER_SHIFT'
        AND DATE(ml.business_day) = ?
        AND ml.seller_id IS NOT NULL
        AND ml.seller_id > 0
        AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED')
      GROUP BY ml.seller_id
    `).all(day);
    
    const activeSellersList = (sellersWithRevenue || []).map(r => ({
      user_id: Number(r.seller_id),
      name: r.username,
      revenue: Math.max(0, Number(r.revenue || 0))
    }));
    
    // ====================
    // STEP 4: Get active dispatchers (users with role='dispatcher', for team part only)
    // ====================
    const dispatchersList = db.prepare(`
      SELECT id, username
      FROM users
      WHERE role = 'dispatcher' AND is_active = 1
    `).all();
    
    // Set of seller user_ids for deduplication
    const sellerUserIds = new Set(activeSellersList.map(s => s.user_id));
    
    // Dispatchers who are NOT also sellers (for count)
    const pureDispatchersList = (dispatchersList || []).filter(d => !sellerUserIds.has(Number(d.id)));
    
    let active_dispatchers = pureDispatchersList.length;
    let active_sellers = activeSellersList.length;
    
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
      // ====================
      // PERSONAL MODE: Simple individual, NO dispatchers, NO smart rules
      // ====================
      participants = active_sellers;
      active_dispatchers = 0; // Personal mode: dispatchers do not participate
      
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
      
      // fundTotal must equal sum of payouts
      const payoutSum = payouts.reduce((sum, p) => sum + p.total, 0);
      
    } else if (mode === 'team') {
      // ====================
      // TEAM MODE: Equal split, NO smart rules
      // ====================
      const teamIncludeSellers = settings.teamIncludeSellers !== false;
      const teamIncludeDispatchers = settings.teamIncludeDispatchers !== false;
      
      // Build participant list with deduplication by user_id
      // Seller takes priority over dispatcher role
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
          // Only add if not already a seller (dedup)
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
      // ====================
      // ADAPTIVE MODE: Full system with coefficients/bonuses
      // ====================
      team_share = Number(settings.team_share ?? 0.4);
      individual_share = Number(settings.individual_share ?? 0.6);
      
      // Normalize shares if needed
      const shareSum = team_share + individual_share;
      if (Math.abs(shareSum - 1) > 0.0001) {
        warnings.push(`team_share+individual_share != 1, доли нормализованы (${team_share}+${individual_share}=${shareSum})`);
        if (shareSum > 0) {
          team_share = team_share / shareSum;
          individual_share = individual_share / shareSum;
        } else {
          team_share = 1;
          individual_share = 0;
          warnings.push('Доли были 0/0, применено team_share=1');
        }
      }
      
      teamFund = Math.round(fundTotal * team_share);
      individualFund = Math.round(fundTotal * individual_share);
      
      // Build participant list for team part with deduplication
      // Seller takes priority over dispatcher role
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
          // Only add if not already a seller (dedup)
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
      
      // Team part
      if (participants > 0) {
        teamPerPerson = Math.round(teamFund / participants);
      }
      
      // Individual part: calculate weighted_revenue for sellers
      // For now, use revenue as weighted_revenue (can be extended with coefficients)
      const k_dispatchers = Number(settings.k_dispatchers ?? 1.0);
      
      // Calculate weighted revenue for each seller
      const sellersWithWeight = activeSellersList.map(s => {
        // Basic weighted_revenue = revenue * k_dispatchers (simplified for now)
        // Can be extended with boat type coefficients, banana zone coefficients, etc.
        const weighted_revenue = Math.round(s.revenue * k_dispatchers);
        return {
          ...s,
          weighted_revenue
        };
      });
      
      const W_total = sellersWithWeight.reduce((sum, s) => sum + s.weighted_revenue, 0);
      
      // Build payouts
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
      
      if (W_total === 0 && individualFund > 0) {
        warnings.push('W_total=0, индивидуальная часть не распределена');
      }
    }
    
    // ====================
    // STEP 6: Build response
    // ====================
    
    // Helper: safe number (don't mask NaN)
    const safeNum = (val) => Number.isFinite(Number(val)) ? Number(val) : 0;
    
    // Ensure warnings/payouts are always arrays
    const safeWarnings = Array.isArray(warnings) ? warnings : [];
    
    // Filter payouts: exclude zero-total entries (no meaningful payout)
    const meaningfulPayouts = (Array.isArray(payouts) ? payouts : [])
      .filter(p => safeNum(p?.total) > 0);
    
    // Safe numeric fields for response
    const safeRevenueTotal = safeNum(revenue_total);
    const safeFundTotal = safeNum(fundTotal);
    const safeFundPercent = safeNum(fundPercent);
    const safeParticipants = safeNum(participants);
    const safeActiveSellers = safeNum(active_sellers);
    const safeActiveDispatchers = safeNum(active_dispatchers);
    const safeMotivationPercent = safeNum(p);
    const safeTeamPerPerson = safeNum(teamPerPerson);
    
    // Stage C: Derive counters from meaningful payouts for UI consistency
    // participants == payouts.length, active_* by role
    const finalParticipants = meaningfulPayouts.length;
    const finalActiveSellers = meaningfulPayouts.filter(p => p?.role === 'seller').length;
    const finalActiveDispatchers = meaningfulPayouts.filter(p => p?.role === 'dispatcher').length;
    
    const response = {
      ok: true,
      data: {
        business_day: day,
        mode,
        revenue_total: safeRevenueTotal,
        motivation_percent: safeMotivationPercent,
        fundPercent: safeFundPercent,
        fundTotal: safeFundTotal,
        participants: finalParticipants,
        active_sellers: finalActiveSellers,
        active_dispatchers: finalActiveDispatchers,
        payouts: meaningfulPayouts
      },
      meta: { warnings: safeWarnings }
    };
    
    // Add mode-specific fields
    if (mode === 'team') {
      response.data.teamPerPerson = safeTeamPerPerson;
    } else if (mode === 'adaptive') {
      response.data.team_share = team_share;
      response.data.individual_share = individual_share;
      response.data.teamFund = teamFund;
      response.data.individualFund = individualFund;
      response.data.teamPerPerson = safeTeamPerPerson;
    }
    
    // Cleanup: remove mode-inappropriate fields
    if (mode === 'personal') {
      delete response.data.teamPerPerson;
      delete response.data.team_share;
      delete response.data.individual_share;
      delete response.data.teamFund;
      delete response.data.individualFund;
    } else if (mode === 'team') {
      delete response.data.team_share;
      delete response.data.individual_share;
      delete response.data.teamFund;
      delete response.data.individualFund;
    }
    // For adaptive: keep all fields
    
    return res.json(response);
  } catch (e) {
    console.error('[owner/motivation/day] Error:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'motivation calculation failed' });
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
            AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED')
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
        (COALESCE(SUM(CASE WHEN ml.kind = 'SELLER_SHIFT' AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0)
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
// =====================
router.get('/money/collected-today-by-tripday', (req, res) => {
  try {
    const todayExpr = "DATE('now','localtime')";
    const tomorrowExpr = "DATE('now','localtime','+1 day')";
    const day2Expr = "DATE('now','localtime','+2 day')";

    // Из money_ledger по ДАТЕ ОПЛАТЫ = сегодня, группируем по presales.business_day (дата рейса)
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN p.business_day = ${todayExpr} THEN ml.amount ELSE 0 END), 0) AS total_today,
           COALESCE(SUM(CASE WHEN p.business_day = ${todayExpr} AND ml.method = 'CASH' THEN ml.amount ELSE 0 END), 0) AS cash_today,
           COALESCE(SUM(CASE WHEN p.business_day = ${todayExpr} AND ml.method = 'CARD' THEN ml.amount ELSE 0 END), 0) AS card_today,
           COALESCE(SUM(CASE WHEN p.business_day = ${tomorrowExpr} THEN ml.amount ELSE 0 END), 0) AS total_tomorrow,
           COALESCE(SUM(CASE WHEN p.business_day = ${tomorrowExpr} AND ml.method = 'CASH' THEN ml.amount ELSE 0 END), 0) AS cash_tomorrow,
           COALESCE(SUM(CASE WHEN p.business_day = ${tomorrowExpr} AND ml.method = 'CARD' THEN ml.amount ELSE 0 END), 0) AS card_tomorrow,
           COALESCE(SUM(CASE WHEN p.business_day = ${day2Expr} THEN ml.amount ELSE 0 END), 0) AS total_day2,
           COALESCE(SUM(CASE WHEN p.business_day = ${day2Expr} AND ml.method = 'CASH' THEN ml.amount ELSE 0 END), 0) AS cash_day2,
           COALESCE(SUM(CASE WHEN p.business_day = ${day2Expr} AND ml.method = 'CARD' THEN ml.amount ELSE 0 END), 0) AS card_day2
         FROM money_ledger ml
         JOIN presales p ON p.id = ml.presale_id
         WHERE ml.status = 'POSTED'
           AND ml.kind = 'SELLER_SHIFT'
           AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
           AND DATE(ml.business_day) = ${todayExpr}`
      )
      .get();

    const totalToday = Number(row?.total_today || 0);
    const cashToday = Number(row?.cash_today || 0);
    const cardToday = Number(row?.card_today || 0);
    const totalTomorrow = Number(row?.total_tomorrow || 0);
    const cashTomorrow = Number(row?.cash_tomorrow || 0);
    const cardTomorrow = Number(row?.card_tomorrow || 0);
    const totalDay2 = Number(row?.total_day2 || 0);
    const cashDay2 = Number(row?.cash_day2 || 0);
    const cardDay2 = Number(row?.card_day2 || 0);

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
  weekly_percent: 0.01,              // доля (0.01 = 1%)
  season_percent: 0.02,              // доля (0.02 = 2%)
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
  notifyChannel: "inapp"
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
  if (body.toWeeklyFund !== undefined) {
    normalized.weekly_percent = Number(body.toWeeklyFund) / 100;
  }
  if (body.toSeasonFund !== undefined) {
    normalized.season_percent = Number(body.toSeasonFund) / 100;
  }
  
  // === PERCENT FIELDS: NEW FORMAT (use as-is) - overrides legacy ===
  if (body.motivation_percent !== undefined) {
    normalized.motivation_percent = Number(body.motivation_percent);
  }
  if (body.weekly_percent !== undefined) {
    normalized.weekly_percent = Number(body.weekly_percent);
  }
  if (body.season_percent !== undefined) {
    normalized.season_percent = Number(body.season_percent);
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
   'k_banana_sanatorium', 'k_banana_stationary', 'k_dispatchers'].forEach(k => {
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
  result.toWeeklyFundLegacy = (settings.weekly_percent ?? 0.01) * 100;
  result.toSeasonFundLegacy = (settings.season_percent ?? 0.02) * 100;
  
  // Motivation type-specific percent legacy fields
  const personalP = settings.motivation_personal_percent ?? settings.motivation_percent ?? 0.15;
  const teamP = settings.motivation_team_percent ?? settings.motivation_percent ?? 0.15;
  result.motivationPersonalPercentLegacy = Math.round(personalP * 100);
  result.motivationTeamPercentLegacy = Math.round(teamP * 100);
  
  // Boat coefficient legacy aliases (frontend uses these names)
  result.coefSpeed = settings.k_speed ?? 1.2;
  result.coefWalk = settings.k_cruise ?? 3.0;
  result.coefFishing = settings.k_fishing ?? 5.0;
  
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
