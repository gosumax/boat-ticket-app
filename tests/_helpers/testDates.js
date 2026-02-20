// testDates.js — centralized date utilities for tests
// ALWAYS use SQLite for date calculations to avoid UTC/local timezone mismatches.
// JavaScript Date uses UTC, while SQLite DATE('now','localtime') uses local timezone.
// In Moscow (UTC+3), this can cause a 1-day difference at certain hours.

/**
 * Get today's date in local timezone (YYYY-MM-DD)
 * @param {import('better-sqlite3').Database} db 
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function getTodayLocal(db) {
  const row = db.prepare(`SELECT DATE('now','localtime') as d`).get();
  return row.d;
}

/**
 * Get tomorrow's date in local timezone (YYYY-MM-DD)
 * @param {import('better-sqlite3').Database} db 
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function getTomorrowLocal(db) {
  const row = db.prepare(`SELECT DATE('now','localtime','+1 day') as d`).get();
  return row.d;
}

/**
 * Get yesterday's date in local timezone (YYYY-MM-DD)
 * @param {import('better-sqlite3').Database} db 
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function getYesterdayLocal(db) {
  const row = db.prepare(`SELECT DATE('now','localtime','-1 day') as d`).get();
  return row.d;
}

/**
 * Get a date relative to today with SQLite modifier
 * @param {import('better-sqlite3').Database} db 
 * @param {string} modifier - SQLite date modifier (e.g., '+2 days', '-7 days', '+1 month')
 * @returns {string} Date string in YYYY-MM-DD format
 */
export function getDateLocal(db, modifier) {
  const row = db.prepare(`SELECT DATE('now','localtime',?) as d`).get(modifier);
  return row.d;
}

/**
 * Get both today and tomorrow in a single query (optimization for seeders)
 * @param {import('better-sqlite3').Database} db 
 * @returns {{ today: string, tomorrow: string }}
 */
export function getTodayAndTomorrow(db) {
  const row = db.prepare(`
    SELECT 
      DATE('now','localtime') as today,
      DATE('now','localtime','+1 day') as tomorrow
  `).get();
  return { today: row.today, tomorrow: row.tomorrow };
}
