import db from './db.js';
import { ensureSalesTransactionsSchema, createSalesTransactionsForCompletedSlot } from './sales-transactions.mjs';

// Auto-complete trips (slots) when start_time + 10 minutes has passed in Europe/Moscow.
// Safe-by-default: if required tables/columns are missing, it logs warning and does nothing.

const TZ = 'Europe/Moscow';
const TICK_MS = 30 * 1000;
const GRACE_MINUTES = 10;

function safe(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}

function tableExists(name) {
  return !!safe(() => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function columnExists(table, column) {
  return !!safe(() => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column), false);
}

function ensureColumn(table, column, ddl) {
  if (!tableExists(table)) return;
  if (columnExists(table, column)) return;
  safe(() => db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run());
}

function ensureSchema() {
  // Minimal lock/completion fields (add-only; safe).
  if (tableExists('generated_slots')) {
    ensureColumn('generated_slots', 'locked', "locked INTEGER DEFAULT 0");
    ensureColumn('generated_slots', 'is_completed', "is_completed INTEGER DEFAULT 0");
    ensureColumn('generated_slots', 'completed_at', "completed_at TEXT");
    ensureColumn('generated_slots', 'status', "status TEXT DEFAULT 'ACTIVE'");
  }
  if (tableExists('boat_slots')) {
    ensureColumn('boat_slots', 'locked', "locked INTEGER DEFAULT 0");
    ensureColumn('boat_slots', 'is_completed', "is_completed INTEGER DEFAULT 0");
    ensureColumn('boat_slots', 'completed_at', "completed_at TEXT");
    ensureColumn('boat_slots', 'status', "status TEXT DEFAULT 'ACTIVE'");
    // Some DBs might name date column differently; we don't force it.
  }

  // Audit log (optional)
  safe(() => db.prepare(`
    CREATE TABLE IF NOT EXISTS trip_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER,
      slot_source TEXT,
      event TEXT,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run());

  // Canonical money layer (owner source of truth)
  safe(() => ensureSalesTransactionsSchema(db));
}

function getTimeZoneOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUTC - date.getTime();
}

function tzLocalToEpochMs(dateStr, timeStr, timeZone) {
  // dateStr: YYYY-MM-DD, timeStr: HH:MM
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr).split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;

  const utcGuess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  return utcGuess - offset;
}

function moscowDayString(now = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  return dtf.format(now);
}

function fetchCandidates() {
  const out = [];

  // generated_slots: has trip_date + time
  if (tableExists('generated_slots') && columnExists('generated_slots', 'trip_date') && columnExists('generated_slots', 'time')) {
    const hasLocked = columnExists('generated_slots', 'locked');
    const hasCompleted = columnExists('generated_slots', 'is_completed');
    const where = [
      "is_active = 1",
      hasLocked ? "COALESCE(locked,0) = 0" : "1=1",
      hasCompleted ? "COALESCE(is_completed,0) = 0" : "1=1",
    ].join(' AND ');

    const rows = safe(() => db.prepare(`
      SELECT id, trip_date, time
      FROM generated_slots
      WHERE ${where}
      ORDER BY trip_date ASC, time ASC
      LIMIT 500
    `).all(), []);

    for (const r of rows) out.push({ source: 'generated_slots', id: r.id, trip_date: r.trip_date, time: r.time });
  }

  // boat_slots: may have trip_date or date; try common names.
  if (tableExists('boat_slots')) {
    const dateCol = columnExists('boat_slots', 'trip_date')
      ? 'trip_date'
      : (columnExists('boat_slots', 'date') ? 'date' : null);
    const timeCol = columnExists('boat_slots', 'time') ? 'time' : null;

    if (dateCol && timeCol) {
      const hasLocked = columnExists('boat_slots', 'locked');
      const hasCompleted = columnExists('boat_slots', 'is_completed');
      const where = [
        "is_active = 1",
        hasLocked ? "COALESCE(locked,0) = 0" : "1=1",
        hasCompleted ? "COALESCE(is_completed,0) = 0" : "1=1",
      ].join(' AND ');

      const rows = safe(() => db.prepare(`
        SELECT id, ${dateCol} AS trip_date, ${timeCol} AS time
        FROM boat_slots
        WHERE ${where}
        ORDER BY ${dateCol} ASC, ${timeCol} ASC
        LIMIT 500
      `).all(), []);

      for (const r of rows) out.push({ source: 'boat_slots', id: r.id, trip_date: r.trip_date, time: r.time });
    }
  }

  return out;
}

function markCompleted({ source, id }, completedAtIso) {
  const table = source;
  if (!tableExists(table)) return false;

  const sets = [];
  const params = [];

  if (columnExists(table, 'status')) { sets.push("status='COMPLETED'"); }
  if (columnExists(table, 'locked')) { sets.push('locked=1'); }
  if (columnExists(table, 'is_completed')) { sets.push('is_completed=1'); }
  if (columnExists(table, 'completed_at')) { sets.push('completed_at=?'); params.push(completedAtIso); }

  if (sets.length === 0) return false;

  const sql = `UPDATE ${table} SET ${sets.join(', ')} WHERE id=?`;
  params.push(id);
  const r = safe(() => db.prepare(sql).run(...params), null);
  return !!r && r.changes > 0;
}

function logEvent(slot_source, slot_id, event, detailObj) {
  if (!tableExists('trip_audit_log')) return;
  safe(() => db.prepare(
    `INSERT INTO trip_audit_log (slot_id, slot_source, event, detail) VALUES (?,?,?,?)`
  ).run(slot_id, slot_source, event, JSON.stringify(detailObj || {})));
}

function tick() {
  ensureSchema();

  const candidates = fetchCandidates();
  if (!candidates.length) return;

  const now = new Date();
  const nowEpoch = now.getTime();
  const completedAtIso = now.toISOString();

  const tx = db.transaction((toComplete) => {
    let changed = 0;
    for (const c of toComplete) {
      const ok = markCompleted(c, completedAtIso);
      if (ok) {
        changed++;
        logEvent(c.source, c.id, 'AUTO_COMPLETED', {
          rule: `start_time + ${GRACE_MINUTES}min`,
          timezone: TZ,
          completed_at: completedAtIso,
        });

        // Money becomes visible to owner only after auto-complete.
        // We write canonical sales_transactions here (safe + idempotent).
        safe(() => createSalesTransactionsForCompletedSlot(db, {
          slot_source: c.source,
          slot_id: c.id,
        }));
      }
    }
    return changed;
  });

  const due = [];

  // Optional fast guard by date (Moscow day) to avoid parsing far future dates
  const todayMsk = moscowDayString(now);

  for (const c of candidates) {
    if (!c.trip_date || !c.time) continue;
    // Skip far-future days quickly
    if (String(c.trip_date) > String(todayMsk)) continue;

    const startEpoch = tzLocalToEpochMs(c.trip_date, c.time, TZ);
    if (startEpoch == null) continue;

    const closeAt = startEpoch + GRACE_MINUTES * 60 * 1000;
    if (nowEpoch >= closeAt) due.push(c);
  }

  if (!due.length) return;

  const changed = safe(() => tx(due), 0);
  if (changed > 0) {
    console.log(`[AUTO_COMPLETE] completed=${changed} checked=${candidates.length} due=${due.length}`);
  }
}

let _timer = null;

export function startAutoCompleteTrips() {
  if (_timer) return;

  // First run
  safe(() => tick());

  _timer = setInterval(() => {
    safe(() => tick());
  }, TICK_MS);

  // Do not keep process alive just for timer
  if (typeof _timer.unref === 'function') _timer.unref();

  console.log(`[AUTO_COMPLETE] started tick=${TICK_MS}ms rule=+${GRACE_MINUTES}min tz=${TZ}`);
}

export function stopAutoCompleteTrips() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}
