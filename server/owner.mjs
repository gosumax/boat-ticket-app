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
  // Prefer actual trip date for generated slots when available.
  // This prevents "pending/revenue for today" from including tickets moved to tomorrow.

  const gsDayCol = pickFirstExisting('generated_slots', ['trip_date', 'trip_day', 'day', 'date'], null);

  // If boat_slots.start_time exists AND the caller JOINs boat_slots as "bs",
  // prefer DATE(bs.start_time) as the trip day for regular slots.
  const hasBoatSlotsStart = hasColumn('boat_slots', 'start_time');

  const presaleDayFallback = hasColumn('presales', 'business_day')
    ? 'COALESCE(p.business_day, DATE(p.created_at))'
    : 'DATE(p.created_at)';

  if (gsDayCol) {
    // NOTE: slot_uid format is "generated:<id>".
    // For non-generated slots: use boat_slots.start_time when present (requires JOIN boat_slots bs).
    return `CASE
      WHEN p.slot_uid LIKE 'generated:%' THEN (
        SELECT DATE(gs.${gsDayCol})
        FROM generated_slots gs
        WHERE gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER)
      )
      ELSE ${hasBoatSlotsStart ? `COALESCE(DATE(bs.start_time), ${presaleDayFallback})` : presaleDayFallback}
    END`;
  }

  return hasBoatSlotsStart ? `COALESCE(DATE(bs.start_time), ${presaleDayFallback})` : presaleDayFallback;
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
// =====================
router.get('/money/summary', (req, res) => {
  try {
    const preset = String(req.query.preset || 'today');

    let fromExpr;
    let toExpr;
    if (preset === 'last_nonzero_day') {
      const day = resolveLastNonzeroDay();
      if (!day) {
        return res.json({
          ok: true,
          data: {
            preset,
            range: null,
            totals: { revenue: 0, cash: 0, card: 0 },
          },
          meta: { warnings: ['no revenue days found'] },
        });
      }
      fromExpr = `'${day}'`;
      toExpr = `'${day}'`;
    } else {
      const r = presetRange(preset);
      fromExpr = r.from;
      toExpr = r.to;
    }

    const tripDayExpr = getTripDayExpr();

    const revenueRow = db
      .prepare(
        `SELECT COALESCE(SUM(p.total_price),0) AS revenue
         FROM presales p
         LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
         WHERE p.status='ACTIVE'
           AND ${tripDayExpr} BETWEEN ${fromExpr} AND ${toExpr}`
      )
      .get();

    const paidRow = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN ml.method='CASH' THEN ml.amount ELSE 0 END),0) AS cash,
           COALESCE(SUM(CASE WHEN ml.method='CARD' THEN ml.amount ELSE 0 END),0) AS card
         FROM money_ledger ml
         WHERE ml.status='POSTED'
           AND ml.business_day BETWEEN ${fromExpr} AND ${toExpr}
           AND ${salesLedgerWhere()}`
      )
      .get();

    const revenue = Number(revenueRow?.revenue || 0);
    const cash = Number(paidRow?.cash || 0);
    const card = Number(paidRow?.card || 0);

    return res.json({
      ok: true,
      data: {
        preset,
        range: { from: null, to: null },
        totals: { revenue, cash, card },
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
router.get('/money/pending-by-day', (req, res) => {
  try {
    const day = String(req.query.day || 'today');
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
});

// =====================
// GET /api/owner/money/compare-days?preset=7d|30d|90d
// Rows are by trip day.
// =====================
router.get('/money/compare-days', (req, res) => {
  try {
    const preset = String(req.query.preset || '7d');
    const r = presetRange(preset);
    const tripDayExpr = getTripDayExpr();

    const rows = db
      .prepare(
        `WITH paid AS (
           SELECT business_day AS day,
             COALESCE(SUM(CASE WHEN method='CASH' THEN amount ELSE 0 END),0) AS cash,
             COALESCE(SUM(CASE WHEN method='CARD' THEN amount ELSE 0 END),0) AS card
           FROM money_ledger ml
           WHERE ml.status='POSTED'
             AND ml.business_day BETWEEN ${r.from} AND ${r.to}
             AND ${salesLedgerWhere()}
           GROUP BY business_day
         ),
         rev AS (
           SELECT ${tripDayExpr} AS day, COALESCE(SUM(total_price),0) AS revenue
           FROM presales p
           LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
           WHERE p.status='ACTIVE'
             AND ${tripDayExpr} BETWEEN ${r.from} AND ${r.to}
           GROUP BY ${tripDayExpr}
         )
         SELECT
           rev.day AS day,
           rev.revenue AS revenue,
           COALESCE(paid.cash,0) AS cash,
           COALESCE(paid.card,0) AS card
         FROM rev
         LEFT JOIN paid ON paid.day = rev.day
         ORDER BY rev.day ASC`
      )
      .all();

    return res.json({ ok: true, data: { preset, range: null, rows }, meta: { warnings: [] } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'compare-days failed' });
  }
});

// =====================
// GET /api/owner/boats?preset=today|yesterday|d7|month|all
// Aggregated by boat. Uses trip day expression (matches Money screens).
// =====================
router.get('/boats', (req, res) => {
  try {
    const preset = String(req.query.preset || 'today');
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

export default router;
