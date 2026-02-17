/**
 * Test setup for dispatcher tests using REAL backend
 * 
 * CRITICAL: DB_FILE must be set BEFORE importing db.js
 * This file must be imported BEFORE any server imports
 */

// Set in-memory DB BEFORE any server imports
process.env.DB_FILE = ':memory:';
process.env.NODE_ENV = 'test';

import { beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from '../../server/db.js';

// JWT secret (matches auth.js default for non-production)
export const JWT_SECRET = 'boat_ticket_secret_key';

// Cached seed data for current test
let currentSeedData = null;

/**
 * Initialize the in-memory database with schema
 * Must be called before tests run
 */
export async function initTestDb() {
  // Create boat_settings table (not created by default migrations)
  // This is needed for resolveSlotByUid function
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS boat_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        boat_id INTEGER NOT NULL UNIQUE REFERENCES boats(id) ON DELETE CASCADE,
        seller_cutoff_minutes INTEGER NOT NULL DEFAULT 10,
        dispatcher_cutoff_minutes INTEGER NOT NULL DEFAULT 0
      )
    `);
  } catch (e) {
    // Table may already exist
  }
  
  return db;
}

/**
 * Seed minimal test data
 * Returns IDs for use in tests
 * PURE FUNCTION - does not clear tables, assumes tables are empty
 */
export function seedTestData() {
  const saltRounds = 10;
  const hashedPassword = bcrypt.hashSync('password123', saltRounds);
  
  // Create users
  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, ?, ?)
  `);
  
  const dispatcherId = insertUser.run('test_dispatcher', hashedPassword, 'dispatcher', 1).lastInsertRowid;
  const sellerId = insertUser.run('test_seller', hashedPassword, 'seller', 1).lastInsertRowid;
  const seller2Id = insertUser.run('test_seller2', hashedPassword, 'seller', 1).lastInsertRowid;
  
  // Create boats
  const insertBoat = db.prepare(`
    INSERT INTO boats (name, is_active, type, price_adult, price_teen, price_child)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const speedBoatId = insertBoat.run('Test Speed Boat', 1, 'speed', 1500, 1200, 800).lastInsertRowid;
  const cruiseBoatId = insertBoat.run('Test Cruise Boat', 1, 'cruise', 2000, 1500, 1000).lastInsertRowid;
  
  // Create boat_slots (manual slots)
  // Use TOMORROW to ensure we're always in the future regardless of current UTC time
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const dayAfter = new Date(Date.now() + 172800000).toISOString().split('T')[0];
  
  // Calculate slot time: 10:00 on tomorrow's date to avoid any timezone issues
  const slotTime = '10:00';
  const slotDate = tomorrow; // Always use tomorrow to be safe
  
  console.log(`[SEED_DATA] Creating slots with date=${slotDate}, time=${slotTime} (tomorrow at 10:00)`);
  
  // Define slot times BEFORE using them
  const slotTime1 = '10:00';
  const slotTime2 = '11:00';
  
  const insertSlot = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, duration_minutes, is_active, price_adult, price_child, price_teen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const slotId1 = insertSlot.run(speedBoatId, slotTime1, 1500, 100, 100, 60, 1, 1500, 800, 1200).lastInsertRowid;
  const slotId2 = insertSlot.run(cruiseBoatId, slotTime2, 2000, 100, 100, 60, 1, 2000, 1000, 1500).lastInsertRowid;
  
  // Create schedule_templates (required for generated_slots)
  const insertTemplate = db.prepare(`
    INSERT INTO schedule_templates (weekday, time, product_type, boat_id, capacity, price_adult, price_child, price_teen, duration_minutes, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  // Use different times for each template to avoid UNIQUE constraint violations
  const templateId1 = insertTemplate.run(1, slotTime1, 'speed', speedBoatId, 100, 1500, 800, 1200, 60, 1).lastInsertRowid;
  const templateId2 = insertTemplate.run(1, slotTime2, 'cruise', cruiseBoatId, 100, 2000, 1000, 1500, 60, 1).lastInsertRowid;
  
  // Create generated_slots (with schedule_template_id)
  // Use future date to avoid SALES_CLOSED cutoff check
  const insertGenSlot = db.prepare(`
    INSERT INTO generated_slots (schedule_template_id, trip_date, boat_id, time, capacity, seats_left, duration_minutes, is_active, price_adult, price_child, price_teen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const genSlotId1 = insertGenSlot.run(templateId1, slotDate, speedBoatId, slotTime1, 100, 100, 60, 1, 1500, 800, 1200).lastInsertRowid;
  const genSlotId2 = insertGenSlot.run(templateId2, slotDate, cruiseBoatId, slotTime2, 100, 100, 60, 1, 2000, 1000, 1500).lastInsertRowid;
  const genSlotId3 = insertGenSlot.run(templateId1, tomorrow, speedBoatId, '12:00', 100, 100, 60, 1, 1500, 800, 1200).lastInsertRowid; // Different time for tomorrow
  const genSlotId4 = insertGenSlot.run(templateId1, dayAfter, speedBoatId, '14:00', 100, 100, 60, 1, 1500, 800, 1200).lastInsertRowid; // Different time for day after
  
  // Debug: verify generated_slots were created with correct dates
  const verifySlots = db.prepare('SELECT id, trip_date, time FROM generated_slots WHERE id IN (?, ?, ?, ?)').all(genSlotId1, genSlotId2, genSlotId3, genSlotId4);
  console.log(`[SEED_VERIFY] Generated slots:`, verifySlots);
  
  currentSeedData = {
    dispatcherId,
    sellerId,
    seller2Id,
    speedBoatId,
    cruiseBoatId,
    slotId1,
    slotId2,
    templateId1,
    templateId2,
    genSlotId1,
    genSlotId2,
    genSlotId3,
    genSlotId4,
    today,
    tomorrow,
    dayAfter
  };
  
  return currentSeedData;
}

/**
 * Generate JWT token using same method as auth.js
 */
export function generateTestToken(userId, username, role) {
  return jwt.sign({ id: userId, username, role }, JWT_SECRET, { expiresIn: '24h' });
}

/**
 * Get the database instance for direct queries in tests
 */
export function getDb() {
  return db;
}

/**
 * Get current seed data (for tests that need to access seeded IDs)
 */
export function getSeedData() {
  return currentSeedData;
}

/**
 * Clear all tables for test isolation
 */
export function clearTables() {
  // Disable FK for clean wipe
  db.prepare('PRAGMA foreign_keys = OFF').run();

  // Wipe (order matters - dependents first)
  const tables = [
    'sales_transactions_canonical',
    'money_ledger',
    'tickets',
    'presales',
    'generated_slots',
    'boat_slots',
    'boat_settings',
    'schedule_templates',
    'schedule_template_items',
    'boats',
    'users',
    'seller_working_zones',
    'working_zones',
    'owner_settings',
    'owner_audit_log',
    'manual_batches',
    'manual_boat_stats',
    'manual_days',
    'manual_seller_stats',
    'motivation_day_settings',
  ];

  for (const t of tables) {
    try {
      const result = db.prepare(`DELETE FROM ${t}`).run();
      console.log(`[CLEAR_TABLES] Deleted from ${t}: ${result.changes} rows`);
    } catch(e) {
      console.log(`[CLEAR_TABLES] Error deleting from ${t}:`, e.message);
    }
  }

  // Reset autoincrement counters
  try { 
    const seqResult = db.prepare(`DELETE FROM sqlite_sequence`).run();
    console.log(`[CLEAR_TABLES] Reset sqlite_sequence`);
  } catch(e) {
    console.log(`[CLEAR_TABLES] Error resetting sqlite_sequence:`, e.message);
  }

  db.prepare('PRAGMA foreign_keys = ON').run();
}

/**
 * Close database connection
 */
export function closeDb() {
  if (db) {
    db.close();
  }
}

// Global beforeEach - runs before EACH test in ALL dispatcher test files
beforeEach(() => {
  clearTables();
  seedTestData();
});
