// 00-date-consistency.test.js — guard test for date consistency
// Verifies that all test date calculations use SQLite localtime
// to prevent UTC/local timezone mismatches.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { getTodayLocal, getTomorrowLocal, getTodayAndTomorrow } from '../_helpers/testDates.js';

let db;

beforeAll(() => {
  resetTestDb();
  db = getTestDb();
});

afterAll(() => {
  if (db) db.close();
});

describe('DATE CONSISTENCY GUARD', () => {
  it('getTodayLocal returns YYYY-MM-DD format', () => {
    const today = getTodayLocal(db);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getTomorrowLocal returns YYYY-MM-DD format', () => {
    const tomorrow = getTomorrowLocal(db);
    expect(tomorrow).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getTomorrowLocal is exactly 1 day after getTodayLocal', () => {
    const today = getTodayLocal(db);
    const tomorrow = getTomorrowLocal(db);
    
    // Parse dates and verify difference
    const todayDate = new Date(today + 'T00:00:00');
    const tomorrowDate = new Date(tomorrow + 'T00:00:00');
    const diffMs = tomorrowDate - todayDate;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    
    expect(diffDays).toBe(1);
  });

  it('getTodayAndTomorrow returns both dates in one query', () => {
    const { today, tomorrow } = getTodayAndTomorrow(db);
    
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tomorrow).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(today).toBe(getTodayLocal(db));
    expect(tomorrow).toBe(getTomorrowLocal(db));
  });

  it('seedBasic generated_slots.trip_date matches getTomorrowLocal', async () => {
    const seedData = await seedBasicData(db);
    const expectedTomorrow = getTomorrowLocal(db);
    
    // Check that generated slots have correct trip_date
    const slots = db.prepare(`
      SELECT id, trip_date FROM generated_slots
    `).all();
    
    expect(slots.length).toBeGreaterThan(0);
    
    for (const slot of slots) {
      expect(slot.trip_date).toBe(expectedTomorrow);
    }
    
    // Also verify the returned seedData contains correct tomorrow
    expect(seedData.slots.generated.tomorrow).toBe(expectedTomorrow);
  });

  it('SQLite localtime matches itself (sanity check)', () => {
    // This test would fail if SQLite's localtime were inconsistent
    const result1 = db.prepare(`SELECT DATE('now','localtime') as d`).get();
    const result2 = db.prepare(`SELECT DATE('now','localtime') as d`).get();
    
    expect(result1.d).toBe(result2.d);
    expect(result1.d).toBe(getTodayLocal(db));
  });
});
