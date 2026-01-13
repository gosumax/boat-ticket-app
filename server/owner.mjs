import express from 'express';
import db from './db.js';
import { authenticateToken } from './auth.js';

const router = express.Router();

/* =========================
   OWNER ONLY middleware
========================= */
function canOwnerAccess(req, res, next) {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'owner') return res.status(403).json({ error: 'OWNER_ONLY' });
    return next();
  } catch {
    return res.status(403).json({ error: 'OWNER_ONLY' });
  }
}

/* =========================
   Safe DB helpers (NO CRASH)
========================= */
function safeGet(sql, params = [], fallback = null) {
  try {
    const row = db.prepare(sql).get(params);
    return row ?? fallback;
  } catch {
    return fallback;
  }
}

function safeAll(sql, params = [], fallback = []) {
  try {
    const rows = db.prepare(sql).all(params);
    return rows ?? fallback;
  } catch {
    return fallback;
  }
}

function safeRun(sql, params = []) {
  try {
    return db.prepare(sql).run(params);
  } catch {
    return null;
  }
}

function tableExists(name) {
  const r = safeGet(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [name],
    null
  );
  return !!r;
}

function columnExists(table, column) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === column);
  } catch {
    return false;
  }
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

/* =========================
   SETTINGS storage (NO CRASH)
========================= */
function ensureOwnerSettingsTable() {
  safeRun(`
    CREATE TABLE IF NOT EXISTS owner_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      currency TEXT DEFAULT 'RUB',
      timezone TEXT DEFAULT 'Europe/Moscow',
      owner_name TEXT DEFAULT '',
      company_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      payout_target_rub INTEGER DEFAULT 0,
      motivation_mode TEXT DEFAULT 'v1',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const row = safeGet(`SELECT id FROM owner_settings WHERE id=1`, [], null);
  if (!row) safeRun(`INSERT INTO owner_settings (id) VALUES (1)`);
}

/* =========================================================
   GET /api/owner/dashboard
   Агрегаты: today/yesterday/month + avg_check + trips + fill%
            + topBoat/topSeller + revenueByDays(7)
   НЕ ПАДАТЬ при отсутствии таблиц/полей.
========================================================= */
router.get('/dashboard', authenticateToken, canOwnerAccess, (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayStr = fmtDate(today);
    const yestStr = fmtDate(yesterday);
    const monthStr = fmtDate(monthStart);

    // если нет tickets — всё нули
    const hasTickets = tableExists('tickets');
    const hasBoatSlots = tableExists('boat_slots');
    const hasBoats = tableExists('boats');
    const hasUsers = tableExists('users');
    const hasCreatedAt = hasTickets && columnExists('tickets', 'created_at');
    const hasStatus = hasTickets && columnExists('tickets', 'status');
    const hasBoatSlotId = hasTickets && columnExists('tickets', 'boat_slot_id');
    const hasSellerId = hasTickets && columnExists('tickets', 'seller_id');

    const statusFilter = hasStatus ? `status IN ('ACTIVE','USED') AND ` : ``;
    const dateFilter = hasCreatedAt ? `DATE(created_at)=?` : `1=0`; // если created_at нет — 0

    const revToday = hasTickets
      ? safeGet(
          `SELECT COALESCE(SUM(price),0) AS v FROM tickets WHERE ${statusFilter}${dateFilter}`,
          [todayStr],
          { v: 0 }
        ).v
      : 0;

    const revYest = hasTickets
      ? safeGet(
          `SELECT COALESCE(SUM(price),0) AS v FROM tickets WHERE ${statusFilter}DATE(created_at)=?`,
          [yestStr],
          { v: 0 }
        )?.v ?? 0
      : 0;

    const revMonth = hasTickets && hasCreatedAt
      ? safeGet(
          `SELECT COALESCE(SUM(price),0) AS v FROM tickets WHERE ${statusFilter}DATE(created_at) >= ?`,
          [monthStr],
          { v: 0 }
        ).v
      : 0;

    const ticketsToday = hasTickets && hasCreatedAt
      ? safeGet(
          `SELECT COALESCE(COUNT(*),0) AS c FROM tickets WHERE ${statusFilter}DATE(created_at)=?`,
          [todayStr],
          { c: 0 }
        ).c
      : 0;

    const ticketsMonth = hasTickets && hasCreatedAt
      ? safeGet(
          `SELECT COALESCE(COUNT(*),0) AS c FROM tickets WHERE ${statusFilter}DATE(created_at) >= ?`,
          [monthStr],
          { c: 0 }
        ).c
      : 0;

    const avgCheckToday = ticketsToday > 0 ? Math.round(revToday / ticketsToday) : 0;
    const avgCheckMonth = ticketsMonth > 0 ? Math.round(revMonth / ticketsMonth) : 0;

    const tripsToday = hasTickets && hasBoatSlotId && hasCreatedAt
      ? safeGet(
          `SELECT COALESCE(COUNT(DISTINCT boat_slot_id),0) AS c
           FROM tickets
           WHERE ${statusFilter}DATE(created_at)=?`,
          [todayStr],
          { c: 0 }
        ).c
      : 0;

    const tripsMonth = hasTickets && hasBoatSlotId && hasCreatedAt
      ? safeGet(
          `SELECT COALESCE(COUNT(DISTINCT boat_slot_id),0) AS c
           FROM tickets
           WHERE ${statusFilter}DATE(created_at) >= ?`,
          [monthStr],
          { c: 0 }
        ).c
      : 0;

    // fill%: считаем только если есть boat_slots + tickets.boat_slot_id + tickets.created_at
    let fillToday = 0;
    let fillMonth = 0;

    if (hasBoatSlots && hasTickets && hasBoatSlotId && hasCreatedAt) {
      const fillTodayRow = safeGet(
        `
        SELECT
          COALESCE(SUM(x.sold),0) AS sold,
          COALESCE(SUM(x.cap),0)  AS cap
        FROM (
          SELECT
            bs.id,
            COALESCE(COUNT(t.id),0) AS sold,
            COALESCE(bs.capacity,0) AS cap
          FROM boat_slots bs
          LEFT JOIN tickets t
            ON t.boat_slot_id = bs.id
           AND ${statusFilter}DATE(t.created_at)=?
          GROUP BY bs.id
        ) x
        `,
        [todayStr],
        { sold: 0, cap: 0 }
      );

      fillToday = fillTodayRow.cap > 0 ? Math.round((fillTodayRow.sold / fillTodayRow.cap) * 100) : 0;

      const fillMonthRow = safeGet(
        `
        SELECT
          COALESCE(SUM(x.sold),0) AS sold,
          COALESCE(SUM(x.cap),0)  AS cap
        FROM (
          SELECT
            bs.id,
            COALESCE(COUNT(t.id),0) AS sold,
            COALESCE(bs.capacity,0) AS cap
          FROM boat_slots bs
          LEFT JOIN tickets t
            ON t.boat_slot_id = bs.id
           AND ${statusFilter}DATE(t.created_at) >= ?
          GROUP BY bs.id
        ) x
        `,
        [monthStr],
        { sold: 0, cap: 0 }
      );

      fillMonth = fillMonthRow.cap > 0 ? Math.round((fillMonthRow.sold / fillMonthRow.cap) * 100) : 0;
    }

    // topBoat today (если нет схемы — null/0)
    let topBoat = { name: null, type: null, revenue: 0, tickets: 0 };
    if (hasTickets && hasBoatSlots && hasBoats && hasBoatSlotId && hasCreatedAt) {
      topBoat = safeGet(
        `
        SELECT
          b.name AS name,
          COALESCE(b.type,'') AS type,
          COALESCE(SUM(t.price),0) AS revenue,
          COALESCE(COUNT(t.id),0) AS tickets
        FROM tickets t
        JOIN boat_slots bs ON bs.id = t.boat_slot_id
        JOIN boats b ON b.id = bs.boat_id
        WHERE ${statusFilter}DATE(t.created_at)=?
        GROUP BY b.id
        ORDER BY revenue DESC
        LIMIT 1
        `,
        [todayStr],
        topBoat
      ) || topBoat;
    }

    // topSeller today (если нет seller_id/users — null/0)
    let topSeller = { name: null, revenue: 0, tickets: 0 };
    if (hasTickets && hasUsers && hasSellerId && hasCreatedAt) {
      topSeller = safeGet(
        `
        SELECT
          COALESCE(u.username, u.name, ('seller#' || u.id)) AS name,
          COALESCE(SUM(t.price),0) AS revenue,
          COALESCE(COUNT(t.id),0) AS tickets
        FROM tickets t
        JOIN users u ON u.id = t.seller_id
        WHERE ${statusFilter}DATE(t.created_at)=?
        GROUP BY u.id
        ORDER BY revenue DESC
        LIMIT 1
        `,
        [todayStr],
        topSeller
      ) || topSeller;
    }

    // revenueByDays last 7
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push(fmtDate(d));
    }

    const revenueByDays = days.map((d) => {
      const v = (hasTickets && hasCreatedAt)
        ? (safeGet(
            `SELECT COALESCE(SUM(price),0) AS v FROM tickets WHERE ${statusFilter}DATE(created_at)=?`,
            [d],
            { v: 0 }
          )?.v ?? 0)
        : 0;
      return { date: d, revenue: v };
    });

    
    // payments (safe, may be not ready)
    const hasPaymentMethod = hasTickets && columnExists('tickets','payment_method');
    let paymentsReady = false;
    let payCash = 0;
    let payCard = 0;

    if (hasPaymentMethod && hasCreatedAt) {
      paymentsReady = true;
      payCash = safeGet(
        `SELECT COALESCE(SUM(price),0) AS v FROM tickets WHERE ${statusFilter}DATE(created_at)=? AND payment_method='cash'`,
        [todayStr],
        { v: 0 }
      ).v;
      payCard = safeGet(
        `SELECT COALESCE(SUM(price),0) AS v FROM tickets WHERE ${statusFilter}DATE(created_at)=? AND payment_method='card'`,
        [todayStr],
        { v: 0 }
      ).v;
    }

    // byProduct today (safe)
    let byProduct = { speed:0, cruise:0, banana:0, fishing:0 };
    if (hasTickets && hasBoatSlots && hasBoats && hasCreatedAt) {
      const rows = safeAll(
        `
        SELECT COALESCE(b.type,'') AS type, COALESCE(SUM(t.price),0) AS v
        FROM tickets t
        JOIN boat_slots bs ON bs.id = t.boat_slot_id
        JOIN boats b ON b.id = bs.boat_id
        WHERE ${statusFilter}DATE(t.created_at)=?
        GROUP BY b.type
        `,
        [todayStr],
        []
      );
      for (const r of rows) {
        if (r.type === 'speed') byProduct.speed += r.v;
        else if (r.type === 'cruise') byProduct.cruise += r.v;
        else if (r.type === 'banana') byProduct.banana += r.v;
        else if (r.type === 'fishing') byProduct.fishing += r.v;
      }
    }

return res.json({
      today: { revenue: revToday, tickets: ticketsToday, trips: tripsToday, avgCheck: avgCheckToday, fillPercent: fillToday, payments: { cash: payCash, card: payCard, ready: paymentsReady }, byProduct },
      yesterday: { revenue: revYest },
      month: { revenue: revMonth, tickets: ticketsMonth, trips: tripsMonth, avgCheck: avgCheckMonth, fillPercent: fillMonth },
      topBoat: { name: topBoat.name, type: topBoat.type, revenue: topBoat.revenue, tickets: topBoat.tickets },
      topSeller: { name: topSeller.name, revenue: topSeller.revenue, tickets: topSeller.tickets },
      revenueByDays
    });
  } catch (e) {
    console.error('OWNER dashboard error', e);
    return res.status(500).json({ error: 'OWNER_DASHBOARD_FAILED' });
  }
});

/* =========================================================
   GET /api/owner/boats
   Список лодок + today/month агрегаты
   НЕ ПАДАТЬ при отсутствии таблиц.
========================================================= */
router.get('/boats', authenticateToken, canOwnerAccess, (req, res) => {
  try {
    if (!tableExists('boats')) return res.json([]);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayStr = fmtDate(today);
    const monthStr = fmtDate(monthStart);

    const hasTickets = tableExists('tickets');
    const hasBoatSlots = tableExists('boat_slots');
    const hasCreatedAt = hasTickets && columnExists('tickets', 'created_at');
    const hasStatus = hasTickets && columnExists('tickets', 'status');
    const hasBoatSlotId = hasTickets && columnExists('tickets', 'boat_slot_id');

    const statusFilter = hasStatus ? `t.status IN ('ACTIVE','USED') AND ` : ``;

    // базовый список лодок (без падения)
    const boatsBase = safeAll(
      `
      SELECT
        b.id AS boat_id,
        b.name AS boat_name,
        COALESCE(b.type,'') AS boat_type
      FROM boats b
      ORDER BY b.id DESC
      `
    );

    // если нет tickets/slots — вернём только базу с нулями
    if (!hasTickets || !hasBoatSlots || !hasCreatedAt || !hasBoatSlotId) {
      return res.json(
        boatsBase.map((b) => ({
          boat_id: b.boat_id,
          boat_name: b.boat_name,
          boat_type: b.boat_type,
          today: { revenue: 0, tickets: 0, trips: 0, avgCheck: 0, fillPercent: 0 },
          month: { revenue: 0, tickets: 0, trips: 0, avgCheck: 0, fillPercent: 0 }
        }))
      );
    }

    const todayRows = safeAll(
      `
      SELECT
        b.id AS boat_id,
        COALESCE(SUM(t.price),0) AS revenue_today,
        COALESCE(COUNT(t.id),0) AS tickets_today,
        COALESCE(COUNT(DISTINCT bs.id),0) AS trips_today,
        COALESCE(SUM(bs.capacity),0) AS cap_sum_today
      FROM boats b
      LEFT JOIN boat_slots bs ON bs.boat_id = b.id
      LEFT JOIN tickets t
        ON t.boat_slot_id = bs.id
       AND ${statusFilter}DATE(t.created_at)=?
      GROUP BY b.id
      `,
      [todayStr],
      []
    );

    const monthRows = safeAll(
      `
      SELECT
        b.id AS boat_id,
        COALESCE(SUM(t.price),0) AS revenue_month,
        COALESCE(COUNT(t.id),0) AS tickets_month,
        COALESCE(COUNT(DISTINCT bs.id),0) AS trips_month,
        COALESCE(SUM(bs.capacity),0) AS cap_sum_month
      FROM boats b
      LEFT JOIN boat_slots bs ON bs.boat_id = b.id
      LEFT JOIN tickets t
        ON t.boat_slot_id = bs.id
       AND ${statusFilter}DATE(t.created_at) >= ?
      GROUP BY b.id
      `,
      [monthStr],
      []
    );

    const todayMap = new Map(todayRows.map((r) => [r.boat_id, r]));
    const monthMap = new Map(monthRows.map((r) => [r.boat_id, r]));

    const out = boatsBase.map((b) => {
      const t = todayMap.get(b.boat_id) || {};
      const m = monthMap.get(b.boat_id) || {};

      const fillToday = (t.cap_sum_today || 0) > 0 ? Math.round(((t.tickets_today || 0) / t.cap_sum_today) * 100) : 0;
      const fillMonth = (m.cap_sum_month || 0) > 0 ? Math.round(((m.tickets_month || 0) / m.cap_sum_month) * 100) : 0;

      const avgCheckToday = (t.tickets_today || 0) > 0 ? Math.round((t.revenue_today || 0) / t.tickets_today) : 0;
      const avgCheckMonth = (m.tickets_month || 0) > 0 ? Math.round((m.revenue_month || 0) / m.tickets_month) : 0;

      return {
        boat_id: b.boat_id,
        boat_name: b.boat_name,
        boat_type: b.boat_type,
        today: {
          revenue: t.revenue_today || 0,
          tickets: t.tickets_today || 0,
          trips: t.trips_today || 0,
          avgCheck: avgCheckToday,
          fillPercent: fillToday,
        },
        month: {
          revenue: m.revenue_month || 0,
          tickets: m.tickets_month || 0,
          trips: m.trips_month || 0,
          avgCheck: avgCheckMonth,
          fillPercent: fillMonth,
        },
      };
    });

    return res.json(out);
  } catch (e) {
    console.error('OWNER boats error', e);
    return res.status(500).json({ error: 'OWNER_BOATS_FAILED' });
  }
});

/* =========================================================
   GET /api/owner/sellers
   today/month leaderboard
   Если нет users или нет tickets.seller_id — вернуть [].
========================================================= */
router.get('/sellers', authenticateToken, canOwnerAccess, (req, res) => {
  try {
    const hasTickets = tableExists('tickets');
    const hasUsers = tableExists('users');
    if (!hasTickets || !hasUsers) return res.json([]);

    const hasSellerId = columnExists('tickets', 'seller_id');
    const hasCreatedAt = columnExists('tickets', 'created_at');
    if (!hasSellerId || !hasCreatedAt) return res.json([]);

    const hasStatus = columnExists('tickets', 'status');
    const statusFilter = hasStatus ? `t.status IN ('ACTIVE','USED') AND ` : ``;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayStr = fmtDate(today);
    const monthStr = fmtDate(monthStart);

    const todayRows = safeAll(
      `
      SELECT
        u.id AS seller_id,
        COALESCE(u.username, u.name, ('seller#' || u.id)) AS seller_name,
        COALESCE(SUM(t.price),0) AS revenue_today,
        COALESCE(COUNT(t.id),0) AS tickets_today
      FROM tickets t
      JOIN users u ON u.id = t.seller_id
      WHERE ${statusFilter}DATE(t.created_at)=?
      GROUP BY u.id
      ORDER BY revenue_today DESC
      `,
      [todayStr],
      []
    );

    const monthRows = safeAll(
      `
      SELECT
        u.id AS seller_id,
        COALESCE(SUM(t.price),0) AS revenue_month,
        COALESCE(COUNT(t.id),0) AS tickets_month
      FROM tickets t
      JOIN users u ON u.id = t.seller_id
      WHERE ${statusFilter}DATE(t.created_at) >= ?
      GROUP BY u.id
      ORDER BY revenue_month DESC
      `,
      [monthStr],
      []
    );

    const monthMap = new Map(monthRows.map((r) => [r.seller_id, r]));

    const out = todayRows.map((r) => {
      const m = monthMap.get(r.seller_id) || {};
      return {
        seller_id: r.seller_id,
        seller_name: r.seller_name,
        today: {
          revenue: r.revenue_today || 0,
          tickets: r.tickets_today || 0,
        },
        month: {
          revenue: m.revenue_month || 0,
          tickets: m.tickets_month || 0,
        },
      };
    });

    return res.json(out);
  } catch (e) {
    console.error('OWNER sellers error', e);
    return res.status(500).json({ error: 'OWNER_SELLERS_FAILED' });
  }
});

/* =========================================================
   GET /api/owner/finance
   Простой отчёт: totals + last 30 days (если tickets.created_at есть)
========================================================= */
router.get('/finance', authenticateToken, canOwnerAccess, (req, res) => {
  try {
    const hasTickets = tableExists('tickets');
    const hasCreatedAt = hasTickets && columnExists('tickets', 'created_at');
    const hasStatus = hasTickets && columnExists('tickets', 'status');
    const statusFilter = hasStatus ? `status IN ('ACTIVE','USED') AND ` : ``;

    if (!hasTickets || !hasCreatedAt) {
      return res.json({
        rangeDays: 30,
        totals: { revenue: 0, tickets: 0 },
        days: []
      });
    }

    const rows = safeAll(
      `
      SELECT
        date(created_at) AS day,
        COALESCE(SUM(price),0) AS revenue,
        COALESCE(COUNT(id),0) AS tickets
      FROM tickets
      WHERE ${statusFilter}date(created_at) >= date('now','-30 day')
      GROUP BY date(created_at)
      ORDER BY day ASC
      `
    );

    const days = rows.map((r) => ({
      day: r.day,
      revenue: Number(r.revenue || 0),
      tickets: Number(r.tickets || 0),
    }));

    const totals = {
      revenue: days.reduce((a, x) => a + (x.revenue || 0), 0),
      tickets: days.reduce((a, x) => a + (x.tickets || 0), 0),
    };

    return res.json({ rangeDays: 30, totals, days });
  } catch (e) {
    console.error('OWNER finance error', e);
    return res.status(500).json({ error: 'OWNER_FINANCE_FAILED' });
  }
});

/* =========================================================
   GET /api/owner/settings
========================================================= */
router.get('/settings', authenticateToken, canOwnerAccess, (req, res) => {
  try {
    ensureOwnerSettingsTable();
    const row = safeGet(`SELECT * FROM owner_settings WHERE id=1`, [], {}) || {};
    return res.json({
      settings: {
        currency: row.currency ?? 'RUB',
        timezone: row.timezone ?? 'Europe/Moscow',
        ownerName: row.owner_name ?? '',
        companyName: row.company_name ?? '',
        phone: row.phone ?? '',
        payoutTargetRub: Number(row.payout_target_rub ?? 0),
        motivationMode: row.motivation_mode ?? 'v1',
        updatedAt: row.updated_at ?? null,
      }
    });
  } catch (e) {
    console.error('OWNER settings get error', e);
    return res.status(500).json({ error: 'OWNER_SETTINGS_GET_FAILED' });
  }
});

/* =========================================================
   PUT /api/owner/settings
========================================================= */
router.put('/settings', authenticateToken, canOwnerAccess, (req, res) => {
  try {
    ensureOwnerSettingsTable();
    const p = req?.body || {};

    const currency = typeof p.currency === 'string' ? p.currency : 'RUB';
    const timezone = typeof p.timezone === 'string' ? p.timezone : 'Europe/Moscow';
    const ownerName = typeof p.ownerName === 'string' ? p.ownerName : '';
    const companyName = typeof p.companyName === 'string' ? p.companyName : '';
    const phone = typeof p.phone === 'string' ? p.phone : '';
    const payoutTargetRub =
      typeof p.payoutTargetRub === 'number' && Number.isFinite(p.payoutTargetRub)
        ? Math.trunc(p.payoutTargetRub)
        : 0;
    const motivationMode = typeof p.motivationMode === 'string' ? p.motivationMode : 'v1';

    safeRun(
      `
      UPDATE owner_settings
      SET
        currency = ?,
        timezone = ?,
        owner_name = ?,
        company_name = ?,
        phone = ?,
        payout_target_rub = ?,
        motivation_mode = ?,
        updated_at = datetime('now')
      WHERE id = 1
      `,
      [currency, timezone, ownerName, companyName, phone, payoutTargetRub, motivationMode]
    );

    const row = safeGet(`SELECT * FROM owner_settings WHERE id=1`, [], {}) || {};
    return res.json({
      ok: true,
      settings: {
        currency: row.currency ?? 'RUB',
        timezone: row.timezone ?? 'Europe/Moscow',
        ownerName: row.owner_name ?? '',
        companyName: row.company_name ?? '',
        phone: row.phone ?? '',
        payoutTargetRub: Number(row.payout_target_rub ?? 0),
        motivationMode: row.motivation_mode ?? 'v1',
        updatedAt: row.updated_at ?? null,
      }
    });
  } catch (e) {
    console.error('OWNER settings put error', e);
    return res.status(500).json({ error: 'OWNER_SETTINGS_PUT_FAILED' });
  }
});

export default router;
