/**
 * boat-ticket-app/server/migrate-slots-union.js
 *
 * Creates VIEW slots_union (canonical slots layer for analytics).
 * Safe on missing tables: builds view from existing tables only.
 *
 * Run once: node server/migrate-slots-union.js
 */

import Database from "better-sqlite3";

const DB_FILE = process.env.DB_FILE || "database.sqlite";
const db = new Database(DB_FILE);

function tableExists(name) {
  try {
    const row = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?`
      )
      .get(name);
    return !!row;
  } catch {
    return false;
  }
}

function execSafe(sql) {
  try {
    db.exec(sql);
    return { ok: true };
  } catch (e) {
    console.error(
      "[SLOTS_UNION_MIGRATE_ERROR] message=" + e.message + " stack=" + e.stack
    );
    return { ok: false, error: e };
  }
}

try {
  console.log("[SLOTS_UNION_MIGRATE] db=" + DB_FILE);

  // Drop previous view if exists
  execSafe(`DROP VIEW IF EXISTS slots_union;`);

  const hasBoatSlots = tableExists("boat_slots");
  const hasGeneratedSlots = tableExists("generated_slots");

  if (!hasBoatSlots && !hasGeneratedSlots) {
    console.log(
      "[SLOTS_UNION_MIGRATE] WARN: missing both boat_slots and generated_slots. Creating empty view."
    );
    // Empty view with required columns
    execSafe(`
      CREATE VIEW slots_union AS
      SELECT
        CAST(NULL AS INTEGER) AS slot_id,
        CAST(NULL AS TEXT) AS slot_source,
        CAST(NULL AS INTEGER) AS boat_id,
        CAST(NULL AS TEXT) AS trip_date,
        CAST(NULL AS TEXT) AS start_time,
        CAST(NULL AS TEXT) AS start_dt,
        CAST(NULL AS INTEGER) AS capacity,
        CAST(NULL AS INTEGER) AS is_active,
        CAST(NULL AS INTEGER) AS is_completed,
        CAST(NULL AS TEXT) AS completed_at,
        CAST(NULL AS INTEGER) AS locked
      WHERE 0;
    `);

    console.log("[SLOTS_UNION_MIGRATE] OK (empty view)");
    process.exit(0);
  }

  const selects = [];

  // boat_slots: no date => represent as template-like rows without trip_date
  if (hasBoatSlots) {
    selects.push(`
      SELECT
        bs.id AS slot_id,
        'boat_slots' AS slot_source,
        bs.boat_id AS boat_id,
        NULL AS trip_date,
        bs.time AS start_time,
        NULL AS start_dt,
        COALESCE(bs.capacity, 0) AS capacity,
        COALESCE(bs.is_active, 1) AS is_active,
        0 AS is_completed,
        NULL AS completed_at,
        0 AS locked
      FROM boat_slots bs
    `);
  }

  // generated_slots: has trip_date + time
  if (hasGeneratedSlots) {
    // Some schemas may not have locked/completed_at, so we guard by COALESCE on columns that exist in most setups.
    // If columns do not exist, this view will fail; to avoid that, we don't reference unknown columns here.
    // We only use columns that are present in your current generated_slots creation (trip_date, time, capacity, is_active).
    selects.push(`
      SELECT
        gs.id AS slot_id,
        'generated' AS slot_source,
        gs.boat_id AS boat_id,
        gs.trip_date AS trip_date,
        gs.time AS start_time,
        (gs.trip_date || ' ' || gs.time) AS start_dt,
        COALESCE(gs.capacity, 0) AS capacity,
        COALESCE(gs.is_active, 1) AS is_active,
        0 AS is_completed,
        NULL AS completed_at,
        0 AS locked
      FROM generated_slots gs
    `);
  }

  const viewSql = `
    CREATE VIEW slots_union AS
    ${selects.join("\nUNION ALL\n")}
  `;

  const r = execSafe(viewSql);
  if (!r.ok) process.exit(1);

  console.log(
    "[SLOTS_UNION_MIGRATE] OK created slots_union from: " +
      [hasBoatSlots ? "boat_slots" : null, hasGeneratedSlots ? "generated_slots" : null]
        .filter(Boolean)
        .join(", ")
  );
} finally {
  db.close();
}
