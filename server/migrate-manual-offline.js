/**
 * boat-ticket-app/server/migrate-manual-offline.js
 *
 * Manual (offline) data layer for Owner analytics.
 * Priority: manual > online.
 * Safe on empty DB.
 *
 * Run once: node server/migrate-manual-offline.js
 */

import Database from "better-sqlite3";

const DB_FILE = process.env.DB_FILE || "database.sqlite";
const db = new Database(DB_FILE);

function exec(sql) {
  try {
    db.exec(sql);
    return true;
  } catch (e) {
    console.error("[MANUAL_MIGRATE_ERROR]", e.message);
    return false;
  }
}

try {
  console.log("[MANUAL_MIGRATE] start");

  exec(`
    CREATE TABLE IF NOT EXISTS manual_days (
      period TEXT PRIMARY KEY,          -- YYYY-MM-DD
      locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS manual_boat_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period TEXT NOT NULL,
      boat_id INTEGER,
      revenue INTEGER NOT NULL CHECK (revenue >= 0),
      trips_completed INTEGER NOT NULL CHECK (trips_completed >= 0),
      seats_sold INTEGER NOT NULL CHECK (seats_sold >= 0),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(period, boat_id),
      FOREIGN KEY (period) REFERENCES manual_days(period)
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS manual_seller_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period TEXT NOT NULL,
      seller_id INTEGER,
      revenue INTEGER NOT NULL CHECK (revenue >= 0),
      seats_sold INTEGER NOT NULL CHECK (seats_sold >= 0),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(period, seller_id),
      FOREIGN KEY (period) REFERENCES manual_days(period)
    );
  `);

  console.log("[MANUAL_MIGRATE] OK");
} finally {
  db.close();
}
