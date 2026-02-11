/**
 * boat-ticket-app/server/migrate-owner-settings.js
 *
 * Owner settings versioning + day snapshots.
 * Past days are never recalculated.
 *
 * Run once: node server/migrate-owner-settings.js
 */

import Database from "better-sqlite3";

const DB_FILE = process.env.DB_FILE || "database.sqlite";
const db = new Database(DB_FILE);

function exec(sql) {
  try {
    db.exec(sql);
    return true;
  } catch (e) {
    console.error("[OWNER_SETTINGS_MIGRATE_ERROR]", e.message);
    return false;
  }
}

try {
  console.log("[OWNER_SETTINGS_MIGRATE] start");

  exec(`
    CREATE TABLE IF NOT EXISTS owner_settings_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      payload_json TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      active_from_day TEXT NOT NULL
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS owner_day_snapshots (
      business_day TEXT PRIMARY KEY,
      settings_version_id INTEGER NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (settings_version_id)
        REFERENCES owner_settings_versions(id)
    );
  `);

  console.log("[OWNER_SETTINGS_MIGRATE] OK");
} finally {
  db.close();
}
