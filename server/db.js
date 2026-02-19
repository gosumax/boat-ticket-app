import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import bcrypt from "bcrypt";
import fs from "fs";
import { ensureOwnerRoleAndUser } from "./ownerSetup.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔒 ЖЁСТКО ФИКСИРУЕМ БАЗУ В КОРНЕ ПРОЕКТА (относительно server/)
// ENV OVERRIDE для тестов: process.env.DB_FILE
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "..", "database.sqlite");
const SALT_ROUNDS = 10;

// Initialize database
let db;
try {
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  console.log("[DB] Using database file:", DB_FILE);
} catch (error) {
  console.error("=== DATABASE INITIALIZATION ERROR ===");
  console.error("Failed to initialize SQLite database:", error);
  process.exit(1);
}

// Helper: get actual db file path (for debug)
export function getDatabaseFilePath() {
  try {
    const result = db.prepare("PRAGMA database_list").get();
    return result.file;
  } catch {
    return DB_FILE;
  }
}

// Create tables
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('seller', 'dispatcher', 'admin', 'owner')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Ensure OWNER role and seed owner user (safe migration)
  ensureOwnerRoleAndUser(db, { username: 'owner', password: 'owner123', saltRounds: SALT_ROUNDS });

  
  // Create boats table
  db.exec(`
    CREATE TABLE IF NOT EXISTS boats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      type TEXT,
      price_adult REAL NOT NULL DEFAULT 0,
      price_teen REAL NULL,
      price_child REAL NOT NULL DEFAULT 0
    )
  `);
  
  // Create boat_slots table
  db.exec(`
    CREATE TABLE IF NOT EXISTS boat_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_id INTEGER NOT NULL REFERENCES boats(id),
      time TEXT NOT NULL,
      price INTEGER NULL,
      capacity INTEGER NOT NULL,
      seats_left INTEGER NOT NULL,
      duration_minutes INTEGER NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      price_adult INTEGER NULL,
      price_child INTEGER NULL,
      price_teen INTEGER NULL,
      seller_cutoff_minutes INTEGER NULL,
      UNIQUE(boat_id, time)
    )
  `);
  
  // Create settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  
  // Create presales/bookings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS presales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_slot_id INTEGER NOT NULL REFERENCES boat_slots(id),
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      number_of_seats INTEGER NOT NULL,
      total_price INTEGER NOT NULL,
      prepayment_amount INTEGER NOT NULL DEFAULT 0,
      prepayment_comment TEXT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Check if boats table needs migration (add is_active column if missing)
  const boatsColumns = db.prepare("PRAGMA table_info(boats)").all();
  const hasIsActiveColumn = boatsColumns.some(column => column.name === 'is_active');
  const hasTypeColumn = boatsColumns.some(column => column.name === 'type');
  
  // Check if boat_slots table needs migration (add seats_left column if missing)
  const boatSlotsColumns = db.prepare("PRAGMA table_info(boat_slots)").all();
  const hasSeatsLeftColumn = boatSlotsColumns.some(column => column.name === 'seats_left');
  const hasCapacityColumn = boatSlotsColumns.some(column => column.name === 'capacity');

  if (!hasIsActiveColumn) {
    try {
      db.exec('ALTER TABLE boats ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
      console.log('Added is_active column to boats table');
    } catch (error) {
      // Column might already exist, ignore error
      console.log('is_active column may already exist in boats table');
    }
  }
  
  if (!hasTypeColumn) {
    try {
      db.exec('ALTER TABLE boats ADD COLUMN type TEXT');
      console.log('Added type column to boats table');
      
      // Update existing boats with appropriate types based on their names
      db.exec(`UPDATE boats SET type = 'speed' WHERE name LIKE '%Скоростная%'`);
      db.exec(`UPDATE boats SET type = 'cruise' WHERE name LIKE '%Прогулочная%'`);
      console.log('Updated existing boats with types');
    } catch (error) {
      // Column might already exist, ignore error
      console.log('type column may already exist in boats table');
    }
  }
  
  if (!hasSeatsLeftColumn) {
    try {
      db.exec('ALTER TABLE boat_slots ADD COLUMN seats_left INTEGER NOT NULL DEFAULT 12');
      console.log('Added seats_left column to boat_slots table');
    } catch (error) {
      // Column might already exist, ignore error
      console.log('seats_left column may already exist in boat_slots table');
    }
  }
  
  if (!hasCapacityColumn) {
    try {
      db.exec('ALTER TABLE boat_slots ADD COLUMN capacity INTEGER NOT NULL DEFAULT 12');
      console.log('Added capacity column to boat_slots table');
    } catch (error) {
      // Column might already exist, ignore error
      console.log('capacity column may already exist in boat_slots table');
    }
  }

  // ONE-TIME DATA NORMALIZATION - RUN ONLY ONCE
  // Check if we need to normalize existing data
  const normalizationCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'data_normalized_v1'").get();
  if (normalizationCheck.count === 0) {
    console.log('[TYPE NORMALIZE] Running one-time data normalization...');
    
    // Normalize boat types
    const cruiseResult = db.prepare(`UPDATE boats SET type='cruise' WHERE type IS NULL OR TRIM(type)='' OR LOWER(TRIM(type)) IN ('прогулочная','прогулочный','cruise')`).run();
    const speedResult = db.prepare(`UPDATE boats SET type='speed' WHERE LOWER(TRIM(type)) IN ('скоростная','speed')`).run();
    
    console.log(`[TYPE NORMALIZE] Normalized ${cruiseResult.changes} boats to cruise type and ${speedResult.changes} boats to speed type`);
    
    // Mark that we've run this normalization
    db.prepare("INSERT INTO settings (key, value) VALUES ('data_normalized_v1', 'true')").run();
    console.log('[TYPE NORMALIZE] Data normalization completed and marked as done');
  } else {
    console.log('[TYPE NORMALIZE] Data normalization already ran, skipping...');
  }
  
  // ONE-TIME SEATS_LEFT FIX - RUN ONLY ONCE
  // Check if we need to fix seats_left values
  const seatsLeftFixCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'seats_left_fix_v1'").get();
  if (seatsLeftFixCheck.count === 0) {
    console.log('[SEATS_LEFT_FIX] Running one-time seats_left fix...');
    
    // Fix boat slots where seats_left is NULL or <= 0
    const seatsLeftFixResult = db.prepare(`
      UPDATE boat_slots 
      SET seats_left = capacity 
      WHERE seats_left IS NULL OR seats_left <= 0
    `).run();
    
    console.log(`[SEATS_LEFT_FIX] Fixed ${seatsLeftFixResult.changes} boat slots with invalid seats_left values`);
    
    // Mark that we've run this fix
    db.prepare("INSERT INTO settings (key, value) VALUES ('seats_left_fix_v1', 'true')").run();
    console.log('[SEATS_LEFT_FIX] Seats left fix completed and marked as done');
  } else {
    console.log('[SEATS_LEFT_FIX] Seats left fix already ran, skipping...');
  }

  // ONE-TIME CAPACITY FIX - RUN ONLY ONCE
  // Check if we need to fix capacity values
  const capacityFixCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'capacity_fix_v1'").get();
  if (capacityFixCheck.count === 0) {
    console.log('[CAPACITY_FIX] Running one-time capacity fix...');
    
    // Fix boat slots where capacity is NULL or <= 0, set to default 12
    const capacityFixResult = db.prepare(`
      UPDATE boat_slots 
      SET capacity = 12, seats_left = 12
      WHERE capacity IS NULL OR capacity <= 0
    `).run();
    
    console.log(`[CAPACITY_FIX] Fixed ${capacityFixResult.changes} boat slots with invalid capacity values`);
    
    // Mark that we've run this fix
    db.prepare("INSERT INTO settings (key, value) VALUES ('capacity_fix_v1', 'true')").run();
    console.log('[CAPACITY_FIX] Capacity fix completed and marked as done');
  } else {
    console.log('[CAPACITY_FIX] Capacity fix already ran, skipping...');
  }

  // LIGHTWEIGHT DB MIGRATION - RUN EVERY TIME (SAFE)
  console.log('[TYPE MIGRATE] Running lightweight boat type migration...');

  // Update boats with speed variations to canonical 'speed'
  const speedMigrationResult = db.prepare(`
    UPDATE boats
    SET type = 'speed'
    WHERE lower(trim(type)) IN ('скоростная','скоростные','speed')
  `).run();

  // Update boats with cruise variations to canonical 'cruise'
  const cruiseMigrationResult = db.prepare(`
    UPDATE boats
    SET type = 'cruise'
    WHERE lower(trim(type)) IN ('прогулочная','прогулочные','cruise')
  `).run();

  console.log(`[TYPE MIGRATE] Updated ${speedMigrationResult.changes} boats to speed and ${cruiseMigrationResult.changes} boats to cruise`);

  // ONE-TIME BOAT TYPE FIX - RUN ONLY ONCE
  // Check if we need to fix boats with NULL or empty types
  const boatTypeFixCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'boat_type_fix_v1'").get();
  if (boatTypeFixCheck.count === 0) {
    console.log('[BOAT_TYPE_FIX] Running one-time boat type fix...');
    
    // Fix boats where type is NULL or empty, try to infer from name
    const speedTypeFixResult = db.prepare(`
      UPDATE boats 
      SET type = 'speed'
      WHERE (type IS NULL OR TRIM(type) = '') 
        AND name LIKE '%Скоростная%'
    `).run();
    
    const cruiseTypeFixResult = db.prepare(`
      UPDATE boats 
      SET type = 'cruise'
      WHERE (type IS NULL OR TRIM(type) = '') 
        AND name LIKE '%Прогулочная%'
    `).run();
    
    console.log(`[BOAT_TYPE_FIX] Fixed ${speedTypeFixResult.changes} speed boats and ${cruiseTypeFixResult.changes} cruise boats with missing types`);
    
    // Mark that we've run this fix
    db.prepare("INSERT INTO settings (key, value) VALUES ('boat_type_fix_v1', 'true')").run();
    console.log('[BOAT_TYPE_FIX] Boat type fix completed and marked as done');
  } else {
    console.log('[BOAT_TYPE_FIX] Boat type fix already ran, skipping...');
  }

  // ONE-TIME LEGACY DATA NORMALIZATION - RUN ONLY ONCE
  // Fix legacy rows with NULL/0 seats_left and/or NULL/0 capacity
  const legacyDataFixCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'legacy_data_fix_v1'").get();
  if (legacyDataFixCheck.count === 0) {
    console.log('[LEGACY_DATA_FIX] Running one-time legacy data normalization...');
    
    // Normalize capacities: For any boat_slots row where capacity IS NULL or capacity <= 0,
    // set a reasonable default capacity of 12 (consistent with existing fixes)
    // Also set seats_left to 12 to ensure consistency
    const capacityNormalizationResult = db.prepare(`
      UPDATE boat_slots 
      SET capacity = 12, seats_left = 12
      WHERE (capacity IS NULL OR capacity <= 0)
    `).run();
    
    console.log(`[LEGACY_DATA_FIX] Fixed ${capacityNormalizationResult.changes} boat slots with invalid capacity values`);
    
    // Normalize seats_left: For any boat_slots row where seats_left IS NULL or seats_left <= 0 AND capacity > 0,
    // set seats_left = capacity (This is legacy repair: seats_left should start equal to capacity for newly created slots.)
    const seatsLeftNormalizationResult = db.prepare(`
      UPDATE boat_slots 
      SET seats_left = capacity
      WHERE (seats_left IS NULL OR seats_left <= 0) 
        AND capacity > 0
    `).run();
    
    console.log(`[LEGACY_DATA_FIX] Fixed ${seatsLeftNormalizationResult.changes} boat slots with invalid seats_left values`);
    
    // Mark that we've run this fix
    db.prepare("INSERT INTO settings (key, value) VALUES ('legacy_data_fix_v1', 'true')").run();
    console.log('[LEGACY_DATA_FIX] Legacy data fix completed and marked as done');
  } else {
    console.log('[LEGACY_DATA_FIX] Legacy data fix already ran, skipping...');
  }

  // ONE-TIME PRESALES STATUS COLUMN ADDITION - RUN ONLY ONCE
  // Add status column to presales table for tracking presale state
  const presalesStatusCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'presales_status_column_v1'").get();
  if (presalesStatusCheck.count === 0) {
    console.log('[PRESALES_STATUS] Running one-time presales status column addition...');
    
    try {
      // Add status column to presales table with default value 'ACTIVE'
      db.exec("ALTER TABLE presales ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'");
      console.log('[PRESALES_STATUS] Added status column to presales table');
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('presales_status_column_v1', 'true')").run();
      console.log('[PRESALES_STATUS] Presales status column addition completed and marked as done');
    } catch (error) {
      // Column might already exist, ignore error
      console.log('[PRESALES_STATUS] Status column may already exist in presales table');
    }
  } else {
    console.log('[PRESALES_STATUS] Presales status column addition already ran, skipping...');
  }
  // ONE-TIME PRESALES SLOT_UID COLUMN ADDITION - RUN ONLY ONCE
// Add slot_uid column to presales table for linking presales to generated slots
const presalesSlotUidCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'presales_slot_uid_column_v1'").get();

if (presalesSlotUidCheck.count === 0) {
  console.log('[PRESALES_SLOT_UID] Running one-time presales slot_uid column addition...');

  try {
    // Add slot_uid column (nullable TEXT)
    db.exec("ALTER TABLE presales ADD COLUMN slot_uid TEXT NULL");
    console.log('[PRESALES_SLOT_UID] Added slot_uid column to presales table');

    // Optional index for faster lookups
    try {
      db.exec("CREATE INDEX IF NOT EXISTS idx_presales_slot_uid ON presales(slot_uid)");
    } catch (e) {}

    // Mark that we've run this migration
    db.prepare("INSERT INTO settings (key, value) VALUES ('presales_slot_uid_column_v1', 'true')").run();
    console.log('[PRESALES_SLOT_UID] Presales slot_uid column addition completed and marked as done');
  } catch (error) {
    // Column might already exist, ignore error but still mark migration
    console.log('[PRESALES_SLOT_UID] slot_uid column may already exist in presales table');
    db.prepare("INSERT INTO settings (key, value) VALUES ('presales_slot_uid_column_v1', 'true')").run();
  }
} else {
  console.log('[PRESALES_SLOT_UID] Presales slot_uid column addition already ran, skipping...');
}

  // ONE-TIME PRESALES TICKETS COLUMN ADDITION - RUN ONLY ONCE
  // Add tickets_json column to presales table for storing ticket breakdowns
  const presalesTicketsCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'presales_tickets_column_v1'").get();
  if (presalesTicketsCheck.count === 0) {
    console.log('[PRESALES_TICKETS] Running one-time presales tickets column addition...');
    
    try {
      // Add tickets_json column to presales table as nullable TEXT
      db.exec("ALTER TABLE presales ADD COLUMN tickets_json TEXT NULL");
      console.log('[PRESALES_TICKETS] Added tickets_json column to presales table');
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('presales_tickets_column_v1', 'true')").run();
      console.log('[PRESALES_TICKETS] Presales tickets column addition completed and marked as done');
    } catch (error) {
      // Column might already exist, ignore error
      console.log('[PRESALES_TICKETS] Tickets column may already exist in presales table');
    }
  } else {
    console.log('[PRESALES_TICKETS] Presales tickets column addition already ran, skipping...');
  }
  

  // ONE-TIME PRESALES PAYMENT COLUMNS ADDITION - SAFE (payment_method, payment_cash_amount, payment_card_amount)
  // Adds columns only if they are missing (prevents repeated ALTER TABLE errors)
  try {
    const cols = db.prepare("PRAGMA table_info(presales)").all().map(r => r.name);
    const needsPaymentMethod = !cols.includes('payment_method');
    const needsCash = !cols.includes('payment_cash_amount');
    const needsCard = !cols.includes('payment_card_amount');

    if (needsPaymentMethod) {
      db.prepare("ALTER TABLE presales ADD COLUMN payment_method TEXT NULL").run();
      console.log('[PRESALES_PAYMENT] Added payment_method column');
    }
    if (needsCash) {
      db.prepare("ALTER TABLE presales ADD COLUMN payment_cash_amount INTEGER NOT NULL DEFAULT 0").run();
      console.log('[PRESALES_PAYMENT] Added payment_cash_amount column');
    }
    if (needsCard) {
      db.prepare("ALTER TABLE presales ADD COLUMN payment_card_amount INTEGER NOT NULL DEFAULT 0").run();
      console.log('[PRESALES_PAYMENT] Added payment_card_amount column');
    }
  } catch (e) {
    console.log('[PRESALES_PAYMENT] Payment columns check/add skipped (table may not exist yet):', e?.message || e);
  }

  // ONE-TIME PRESALES BUSINESS_DAY COLUMN ADDITION - RUN ONLY ONCE
  // Add business_day column to presales table for correct Owner "Money" pending-by-trip-day calculation
  // This ensures pending presales are grouped by trip date, not by creation date
  const presalesBusinessDayCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'presales_business_day_v1'").get();
  if (presalesBusinessDayCheck.count === 0) {
    console.log('[PRESALES_BUSINESS_DAY] Running one-time presales business_day column addition...');
    
    try {
      const presalesCols = db.prepare("PRAGMA table_info(presales)").all().map(r => r.name);
      if (!presalesCols.includes('business_day')) {
        db.prepare("ALTER TABLE presales ADD COLUMN business_day TEXT NULL").run();
        console.log('[PRESALES_BUSINESS_DAY] Added business_day column to presales table');
      } else {
        console.log('[PRESALES_BUSINESS_DAY] business_day column already exists in presales table');
      }
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('presales_business_day_v1', 'true')").run();
      console.log('[PRESALES_BUSINESS_DAY] Column addition completed and marked as done');
    } catch (error) {
      console.log('[PRESALES_BUSINESS_DAY] Column addition failed:', error.message);
    }
  } else {
    console.log('[PRESALES_BUSINESS_DAY] business_day column addition already ran, skipping...');
  }

  // ONE-TIME PRESALES BUSINESS_DAY BACKFILL - RUN ONLY ONCE
  // Fill business_day for existing presales based on slot trip_date
  const presalesBusinessDayBackfillCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'presales_business_day_backfill_v1'").get();
  if (presalesBusinessDayBackfillCheck.count === 0) {
    console.log('[PRESALES_BUSINESS_DAY_BACKFILL] Running one-time presales business_day backfill...');
    
    try {
      // Step 1: Update presales with generated slots (slot_uid = 'generated:N')
      // Set business_day = generated_slots.trip_date
      const updateGeneratedResult = db.prepare(`
        UPDATE presales
        SET business_day = (
          SELECT gs.trip_date
          FROM generated_slots gs
          WHERE ('generated:' || gs.id) = presales.slot_uid
        )
        WHERE (business_day IS NULL OR business_day = '')
          AND slot_uid LIKE 'generated:%'
          AND EXISTS (
            SELECT 1 FROM generated_slots gs 
            WHERE ('generated:' || gs.id) = presales.slot_uid
          )
      `).run();
      console.log(`[PRESALES_BUSINESS_DAY_BACKFILL] updated_generated=${updateGeneratedResult.changes}`);

      // Step 2: Update presales with manual slots (boat_slots with trip_date)
      // Note: boat_slots may not have trip_date, so we check both boat_slot_id FK and manual: slot_uid
      try {
        const updateManualResult = db.prepare(`
          UPDATE presales
          SET business_day = (
            SELECT COALESCE(bs.trip_date, DATE(presales.created_at))
            FROM boat_slots bs
            WHERE bs.id = presales.boat_slot_id
          )
          WHERE (business_day IS NULL OR business_day = '')
            AND presales.boat_slot_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM boat_slots bs 
              WHERE bs.id = presales.boat_slot_id
            )
        `).run();
        console.log(`[PRESALES_BUSINESS_DAY_BACKFILL] updated_manual=${updateManualResult.changes}`);
      } catch (manualErr) {
        console.log('[PRESALES_BUSINESS_DAY_BACKFILL] manual slot update skipped:', manualErr.message);
      }

      // Step 3: Fallback - set business_day = DATE(created_at) for remaining rows
      const fallbackResult = db.prepare(`
        UPDATE presales
        SET business_day = DATE(created_at)
        WHERE (business_day IS NULL OR business_day = '')
      `).run();
      console.log(`[PRESALES_BUSINESS_DAY_BACKFILL] fallback_created_at=${fallbackResult.changes}`);

      // Step 4: Diagnostic - count rows still missing business_day
      const missingCount = db.prepare(`
        SELECT COUNT(1) as cnt FROM presales WHERE business_day IS NULL OR business_day = ''
      `).get();
      console.log(`[PRESALES_BUSINESS_DAY] missing_after_backfill=${missingCount.cnt}`);

      // Mark that we've run this backfill
      db.prepare("INSERT INTO settings (key, value) VALUES ('presales_business_day_backfill_v1', 'true')").run();
      console.log('[PRESALES_BUSINESS_DAY_BACKFILL] Backfill completed and marked as done');
    } catch (error) {
      console.log('[PRESALES_BUSINESS_DAY_BACKFILL] Backfill failed:', error.message);
    }
  } else {
    console.log('[PRESALES_BUSINESS_DAY_BACKFILL] business_day backfill already ran, skipping...');
  }

  // ONE-TIME BOAT TYPE COLUMN ADDITION - RUN ONLY ONCE
  // Add type column to boats table to support different boat types including 'banana'
  const boatTypeCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'boat_type_column_v1'").get();
  if (boatTypeCheck.count === 0) {
    console.log('[BOAT_TYPE] Running one-time boat type column addition...');
    
    try {
      // Add type column to boats table with default value 'cruise' for existing boats
      db.exec("ALTER TABLE boats ADD COLUMN type TEXT DEFAULT 'cruise'");
      
      // Update existing boats to have proper types based on their names
      db.exec(`UPDATE boats SET type = 'speed' WHERE name LIKE '%Скоростная%'`);
      db.exec(`UPDATE boats SET type = 'cruise' WHERE name LIKE '%Прогулочная%' AND type IS NULL`);
      
      console.log('[BOAT_TYPE] Added type column to boats table');
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('boat_type_column_v1', 'true')").run();
      console.log('[BOAT_TYPE] Boat type column addition completed and marked as done');
    } catch (error) {
      // Column might already exist, ignore error
      console.log('[BOAT_TYPE] Type column may already exist in boats table');
    }
  } else {
    console.log('[BOAT_TYPE] Boat type column addition already ran, skipping...');
  }
  
  // ONE-TIME BOAT_SLOT DURATION COLUMN ADDITION - RUN ONLY ONCE
  // Add duration_minutes column to boat_slots table to track trip duration
  const slotDurationCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'slot_duration_column_v1'").get();
  if (slotDurationCheck.count === 0) {
    console.log('[SLOT_DURATION] Running one-time slot duration column addition...');
    
    try {
      // Add duration_minutes column to boat_slots table as nullable INTEGER
      db.exec("ALTER TABLE boat_slots ADD COLUMN duration_minutes INTEGER NULL");
      
      console.log('[SLOT_DURATION] Added duration_minutes column to boat_slots table');
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('slot_duration_column_v1', 'true')").run();
      console.log('[SLOT_DURATION] Slot duration column addition completed and marked as done');
    } catch (error) {
      // Column might already exist, ignore error
      console.log('[SLOT_DURATION] Duration column may already exist in boat_slots table');
    }
  } else {
    console.log('[SLOT_DURATION] Slot duration column addition already ran, skipping...');
  }
  
  // ONE-TIME SLOT DURATION BACKFILL - RUN ONLY ONCE
  // Backfill existing slots with appropriate duration based on boat type
  const slotDurationBackfillCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'slot_duration_backfill_v1'").get();
  if (slotDurationBackfillCheck.count === 0) {
    console.log('[SLOT_DURATION_BACKFILL] Running one-time slot duration backfill...');
    
    try {
      // Update existing banana slots to have duration of 40 minutes
      const updateBananaSlotsResult = db.prepare(`
        UPDATE boat_slots 
        SET duration_minutes = 40 
        WHERE duration_minutes IS NULL 
        AND boat_id IN (
          SELECT id FROM boats WHERE type = 'banana'
        )
      `).run();
      
      // Update existing speed/cruise slots to have duration of 60 minutes
      const updateOtherSlotsResult = db.prepare(`
        UPDATE boat_slots 
        SET duration_minutes = 60 
        WHERE duration_minutes IS NULL
      `).run();
      
      console.log(`[SLOT_DURATION_BACKFILL] Updated ${updateBananaSlotsResult.changes} banana slots and ${updateOtherSlotsResult.changes} other slots with duration defaults`);
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('slot_duration_backfill_v1', 'true')").run();
      console.log('[SLOT_DURATION_BACKFILL] Slot duration backfill completed and marked as done');
    } catch (error) {
      // Log error but continue
      console.log('[SLOT_DURATION_BACKFILL] Error during slot duration backfill:', error.message);
    }
  } else {
    console.log('[SLOT_DURATION_BACKFILL] Slot duration backfill already ran, skipping...');
  }
  
  // ONE-TIME BOAT_SLOT PRICING COLUMNS ADDITION - RUN ONLY ONCE
  // Add price columns for different ticket types to boat_slots table
  const slotPricingCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'slot_pricing_columns_v1'").get();
  if (slotPricingCheck.count === 0) {
    console.log('[SLOT_PRICING] Running one-time slot pricing columns addition...');
    
    try {
      // Add price columns for different ticket types to boat_slots table
      db.exec("ALTER TABLE boat_slots ADD COLUMN price_adult INTEGER NULL");
      db.exec("ALTER TABLE boat_slots ADD COLUMN price_child INTEGER NULL");
      db.exec("ALTER TABLE boat_slots ADD COLUMN price_teen INTEGER NULL");
      
      console.log('[SLOT_PRICING] Added price columns to boat_slots table');
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('slot_pricing_columns_v1', 'true')").run();
      console.log('[SLOT_PRICING] Slot pricing columns addition completed and marked as done');
    } catch (error) {
      // Columns might already exist, ignore error
      console.log('[SLOT_PRICING] Pricing columns may already exist in boat_slots table');
    }
  } else {
    console.log('[SLOT_PRICING] Slot pricing columns addition already ran, skipping...');
  }
  
  // ONE-TIME BOAT PRICING COLUMNS ADDITION - RUN ONLY ONCE
  // Add default price columns to boats table
  const boatPricingCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'boat_pricing_columns_v1'").get();
  if (boatPricingCheck.count === 0) {
    console.log('[BOAT_PRICING] Running one-time boat pricing columns addition...');
    
    try {
      // Add default price columns to boats table
      const boatsColumns = db.prepare("PRAGMA table_info(boats)").all();
      const hasPriceAdultColumn = boatsColumns.some(column => column.name === 'price_adult');
      const hasPriceTeenColumn = boatsColumns.some(column => column.name === 'price_teen');
      const hasPriceChildColumn = boatsColumns.some(column => column.name === 'price_child');
      
      if (!hasPriceAdultColumn) {
        db.exec("ALTER TABLE boats ADD COLUMN price_adult REAL NOT NULL DEFAULT 0");
        console.log('[BOAT_PRICING] Added price_adult column to boats table');
      }
      if (!hasPriceTeenColumn) {
        db.exec("ALTER TABLE boats ADD COLUMN price_teen REAL NULL");
        console.log('[BOAT_PRICING] Added price_teen column to boats table');
      }
      if (!hasPriceChildColumn) {
        db.exec("ALTER TABLE boats ADD COLUMN price_child REAL NOT NULL DEFAULT 0");
        console.log('[BOAT_PRICING] Added price_child column to boats table');
      }
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('boat_pricing_columns_v1', 'true')").run();
      console.log('[BOAT_PRICING] Boat pricing columns addition completed and marked as done');
    } catch (error) {
      // Columns might already exist, ignore error
      console.log('[BOAT_PRICING] Pricing columns may already exist in boats table');
    }
  } else {
    console.log('[BOAT_PRICING] Boat pricing columns addition already ran, skipping...');
  }

  // ONE-TIME TRIP TEMPLATES TABLE CREATION - RUN ONLY ONCE
    // Create trip_templates table for trip template management
    const tripTemplatesTableCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'trip_templates_table_v1'").get();
    if (tripTemplatesTableCheck.count === 0) {
      console.log('[TRIP_TEMPLATES_TABLE] Running one-time trip templates table creation...');
      
      try {
        // Create trip_templates table
        db.exec(`
          CREATE TABLE IF NOT EXISTS trip_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_type TEXT NOT NULL CHECK(product_type IN ('speed', 'cruise', 'banana')),
            time TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL,
            capacity INTEGER NOT NULL,
            price_adult INTEGER NOT NULL,
            price_child INTEGER NOT NULL,
            price_teen INTEGER,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);
        
        console.log('[TRIP_TEMPLATES_TABLE] Created trip_templates table');
        
        // Mark that we've run this migration
        db.prepare("INSERT INTO settings (key, value) VALUES ('trip_templates_table_v1', 'true')").run();
        console.log('[TRIP_TEMPLATES_TABLE] Trip templates table creation completed and marked as done');
      } catch (error) {
        console.log('[TRIP_TEMPLATES_TABLE] Error during trip templates table creation:', error.message);
      }
    } else {
      console.log('[TRIP_TEMPLATES_TABLE] Trip templates table already created, skipping...');
    }
    
    
  // ONE-TIME TICKETS PAYMENT_METHOD COLUMN ADDITION - RUN ONLY ONCE
  const ticketsPaymentMethodCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'tickets_payment_method_column_v1'").get();
  if (ticketsPaymentMethodCheck.count === 0) {
    console.log('[TICKETS_PAYMENT_METHOD] Running one-time payment_method column addition...');
    try {
      const cols = db.prepare("PRAGMA table_info(tickets)").all();
      const hasCol = cols.some(c => c.name === 'payment_method');
      if (!hasCol) {
        db.exec("ALTER TABLE tickets ADD COLUMN payment_method TEXT NULL");
        console.log('[TICKETS_PAYMENT_METHOD] Added payment_method column to tickets table');
      }
      db.prepare("INSERT INTO settings (key, value) VALUES ('tickets_payment_method_column_v1','true')").run();
    } catch (e) {
      console.log('[TICKETS_PAYMENT_METHOD] Column may already exist');
      db.prepare("INSERT INTO settings (key, value) VALUES ('tickets_payment_method_column_v1','true')").run();
    }
  } else {
    console.log('[TICKETS_PAYMENT_METHOD] payment_method column already added, skipping...');
  }

// ONE-TIME TICKETS TABLE CREATION - RUN ONLY ONCE
  // Create tickets table for individual ticket tracking
  const ticketsTableCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'tickets_table_v1'").get();
  if (ticketsTableCheck.count === 0) {
    console.log('[TICKETS_TABLE] Running one-time tickets table creation...');
    
    try {
      // Create tickets table
      db.exec(`
        CREATE TABLE IF NOT EXISTS tickets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          presale_id INTEGER NOT NULL REFERENCES presales(id),
          boat_slot_id INTEGER NOT NULL REFERENCES boat_slots(id),
          ticket_code TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          price INTEGER NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      console.log('[TICKETS_TABLE] Created tickets table');
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('tickets_table_v1', 'true')").run();
      console.log('[TICKETS_TABLE] Tickets table creation completed and marked as done');
    } catch (error) {
      console.log('[TICKETS_TABLE] Error during tickets table creation:', error.message);
    }
  } else {
    console.log('[TICKETS_TABLE] Tickets table already created, skipping...');
  }
  
  // ONE-TIME SCHEDULE TEMPLATES TABLE CREATION - RUN ONLY ONCE
  // Create schedule_templates table for seasonal schedule templates
  const scheduleTemplatesTableCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'schedule_templates_table_v1'").get();
  if (scheduleTemplatesTableCheck.count === 0) {
    console.log('[SCHEDULE_TEMPLATES_TABLE] Running one-time schedule templates table creation...');
    
    try {
      // Create schedule_templates table
      db.exec(`
        CREATE TABLE IF NOT EXISTS schedule_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          weekday INTEGER NOT NULL CHECK(weekday >= 1 AND weekday <= 7),
          time TEXT NOT NULL,
          product_type TEXT NOT NULL CHECK(product_type IN ('speed', 'cruise', 'banana')),
          boat_id INTEGER REFERENCES boats(id),
          boat_type TEXT,
          capacity INTEGER NOT NULL,
          price_adult INTEGER NOT NULL,
          price_child INTEGER NOT NULL,
          price_teen INTEGER,
          duration_minutes INTEGER NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      console.log('[SCHEDULE_TEMPLATES_TABLE] Created schedule_templates table');
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('schedule_templates_table_v1', 'true')").run();
      console.log('[SCHEDULE_TEMPLATES_TABLE] Schedule templates table creation completed and marked as done');
    } catch (error) {
      console.log('[SCHEDULE_TEMPLATES_TABLE] Error during schedule templates table creation:', error.message);
    }
  } else {
    console.log('[SCHEDULE_TEMPLATES_TABLE] Schedule templates table already created, skipping...');
  }
  
  // ONE-TIME GENERATED SLOTS TABLE CREATION - RUN ONLY ONCE
  // Create generated_slots table for storing generated trip slots
  const generatedSlotsTableCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'generated_slots_table_v1'").get();
  if (generatedSlotsTableCheck.count === 0) {
    console.log('[GENERATED_SLOTS_TABLE] Running one-time generated slots table creation...');
    
    try {
      // Create generated_slots table
      db.exec(`
        CREATE TABLE IF NOT EXISTS generated_slots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          schedule_template_id INTEGER NOT NULL REFERENCES schedule_templates(id),
          trip_date TEXT NOT NULL,
          boat_id INTEGER NOT NULL REFERENCES boats(id),
          time TEXT NOT NULL,
          capacity INTEGER NOT NULL,
          seats_left INTEGER NOT NULL,
          duration_minutes INTEGER NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          price_adult INTEGER NOT NULL,
          price_child INTEGER NOT NULL,
          price_teen INTEGER,
          seller_cutoff_minutes INTEGER NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      console.log('[GENERATED_SLOTS_TABLE] Created generated_slots table');
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('generated_slots_table_v1', 'true')").run();
      console.log('[GENERATED_SLOTS_TABLE] Generated slots table creation completed and marked as done');
    } catch (error) {
      console.log('[GENERATED_SLOTS_TABLE] Error during generated slots table creation:', error.message);
    }
  } else {
    console.log('[GENERATED_SLOTS_TABLE] Generated slots table already created, skipping...');
  }
  
  // ONE-TIME GENERATED SLOTS UNIQUE CONSTRAINT - RUN ONLY ONCE
  // Add unique constraint to prevent duplicate generated trips
  const generatedSlotsUniqueConstraintCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'generated_slots_unique_constraint_v1'").get();
  if (generatedSlotsUniqueConstraintCheck.count === 0) {
    console.log('[GENERATED_SLOTS_UNIQUE_CONSTRAINT] Running one-time generated slots unique constraint creation...');
      
    try {
      // Create a unique index on trip_date, time, boat_id to prevent duplicates
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_slots_unique 
        ON generated_slots (trip_date, time, boat_id)
      `);
        
      console.log('[GENERATED_SLOTS_UNIQUE_CONSTRAINT] Created unique index on generated_slots (trip_date, time, boat_id)');
        
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('generated_slots_unique_constraint_v1', 'true')").run();
      console.log('[GENERATED_SLOTS_UNIQUE_CONSTRAINT] Generated slots unique constraint creation completed and marked as done');
    } catch (error) {
      console.log('[GENERATED_SLOTS_UNIQUE_CONSTRAINT] Error during unique constraint creation:', error.message);
    }
  } else {
    console.log('[GENERATED_SLOTS_UNIQUE_CONSTRAINT] Generated slots unique constraint already created, skipping...');
  }
  
  // ONE-TIME SCHEDULE TEMPLATE ITEMS TABLE CREATION - RUN ONLY ONCE
  // Create schedule_template_items table for storing template items with weekdays_mask
  const scheduleTemplateItemsTableCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'schedule_template_items_table_v1'").get();
  if (scheduleTemplateItemsTableCheck.count === 0) {
    console.log('[SCHEDULE_TEMPLATE_ITEMS_TABLE] Running one-time schedule template items table creation...');
    
    try {
      // Create schedule_template_items table
      db.exec(`
        CREATE TABLE IF NOT EXISTS schedule_template_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT,
          boat_id INTEGER REFERENCES boats(id),
          boat_type TEXT,
          type TEXT NOT NULL CHECK(type IN ('speed', 'cruise', 'banana')),
          departure_time TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL,
          capacity INTEGER NOT NULL,
          price_adult INTEGER NOT NULL,
          price_child INTEGER NOT NULL,
          price_teen INTEGER,
          weekdays_mask INTEGER NOT NULL DEFAULT 0, -- bitmask for weekdays (mon=1, tue=2, wed=4, thu=8, fri=16, sat=32, sun=64)
          is_active INTEGER NOT NULL DEFAULT 1,
          seller_cutoff_minutes INTEGER NULL,
          dispatcher_cutoff_minutes INTEGER NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      console.log('[SCHEDULE_TEMPLATE_ITEMS_TABLE] Created schedule_template_items table');
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('schedule_template_items_table_v1', 'true')").run();
      console.log('[SCHEDULE_TEMPLATE_ITEMS_TABLE] Schedule template items table creation completed and marked as done');
    } catch (error) {
      console.log('[SCHEDULE_TEMPLATE_ITEMS_TABLE] Error during schedule template items table creation:', error.message);
    }
  } else {
    console.log('[SCHEDULE_TEMPLATE_ITEMS_TABLE] Schedule template items table already created, skipping...');
  }
  
  // Seed initial admin user if no users exist
  try {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (userCount.count === 0) {
      const hashedPassword = bcrypt.hashSync('admin123', SALT_ROUNDS);
      const stmt = db.prepare(`
        INSERT INTO users (username, password_hash, role, is_active)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run('admin', hashedPassword, 'admin', 1);
      console.log('Initial admin user created:');
      console.log('Username: admin');
      console.log('Password: admin123');
      console.log('Please change this password immediately!');
    }
    
    // Seed initial owner user if no owner user exists
    const ownerUser = db.prepare('SELECT id FROM users WHERE username = ?').get('owner');
    if (!ownerUser) {
      const hashedPassword = bcrypt.hashSync('owner123', SALT_ROUNDS);
      const stmt = db.prepare(`
        INSERT INTO users (username, password_hash, role, is_active)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run('owner', hashedPassword, 'owner', 1);
      console.log('Initial owner user created:');
      console.log('Username: owner');
      console.log('Password: owner123');
    }
    
    // Seed initial boats ONLY if BOTH boats AND slots tables are empty
    const boatCount = db.prepare('SELECT COUNT(*) as count FROM boats').get();
    const slotCount = db.prepare('SELECT COUNT(*) as count FROM boat_slots').get();
    if (boatCount.count === 0 && slotCount.count === 0) {
      console.log('Seeding initial boats and slots...');
      
      // Insert boats
      const boats = [
        { name: 'Скоростная лодка 1', is_active: 1, type: 'speed' },
        { name: 'Скоростная лодка 2', is_active: 1, type: 'speed' },
        { name: 'Скоростная лодка 3', is_active: 1, type: 'speed' },
        { name: 'Прогулочная лодка 1', is_active: 1, type: 'cruise' },
        { name: 'Прогулочная лодка 2', is_active: 1, type: 'cruise' },
        { name: 'Прогулочная лодка 3', is_active: 1, type: 'cruise' }
      ];
      
      const boatStmt = db.prepare('INSERT INTO boats (name, is_active, type) VALUES (?, ?, ?)');
      const boatIds = [];
      
      boats.forEach(boat => {
        const result = boatStmt.run(boat.name, boat.is_active, boat.type);
        boatIds.push(result.lastInsertRowid);
      });
      
      // Insert boat slots
      const slots = [
        { boat_id: boatIds[0], time: '10:00', price: 1500, is_active: 1, seats_left: 12, capacity: 12 },
        { boat_id: boatIds[1], time: '12:00', price: 2000, is_active: 1, seats_left: 12, capacity: 12 },
        { boat_id: boatIds[2], time: '14:00', price: 2500, is_active: 1, seats_left: 12, capacity: 12 },
        { boat_id: boatIds[3], time: '10:00', price: 3500, is_active: 1, seats_left: 12, capacity: 12 },
        { boat_id: boatIds[4], time: '12:00', price: 4500, is_active: 1, seats_left: 12, capacity: 12 },
        { boat_id: boatIds[5], time: '16:00', price: 3000, is_active: 1, seats_left: 12, capacity: 12 },
        { boat_id: boatIds[0], time: '18:00', price: 1500, is_active: 1, seats_left: 12, capacity: 12 },
        { boat_id: boatIds[3], time: '18:00', price: 5000, is_active: 1, seats_left: 12, capacity: 12 }
      ];

      const slotStmt = db.prepare('INSERT INTO boat_slots (boat_id, time, price, is_active, seats_left, capacity) VALUES (?, ?, ?, ?, ?, ?)');
      slots.forEach(slot => {
        slotStmt.run(slot.boat_id, slot.time, slot.price, slot.is_active, slot.seats_left, slot.capacity);
      });
      
      console.log('Initial boats and slots seeded successfully');
    }
  } catch (error) {
    console.error('=== USER/BOAT SEEDING ERROR (SKIPPED) ===');
    console.error('Failed to seed initial data, continuing startup:', error?.message || error);
  }

  // ONE-TIME SELLER CUTOFF COLUMN ADDITION - RUN ONLY ONCE
  // Add seller_cutoff_minutes column to boat_slots table
  const sellerCutoffCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'seller_cutoff_column_v1'").get();
  if (sellerCutoffCheck.count === 0) {
    console.log('[SELLER_CUTOFF] Running one-time seller cutoff column addition...');
    
    try {
      // Add seller_cutoff_minutes column to boat_slots table
      db.exec("ALTER TABLE boat_slots ADD COLUMN seller_cutoff_minutes INTEGER NULL");
      
      console.log('[SELLER_CUTOFF] Added seller_cutoff_minutes column to boat_slots table');
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('seller_cutoff_column_v1', 'true')").run();
      console.log('[SELLER_CUTOFF] Seller cutoff column addition completed and marked as done');
    } catch (error) {
      // Column might already exist, ignore error
      console.log('[SELLER_CUTOFF] Seller cutoff column may already exist in boat_slots table');
    }
  } else {
    console.log('[SELLER_CUTOFF] Seller cutoff column addition already ran, skipping...');
  }

  // ONE-TIME SELLER CUTOFF COLUMN ADDITION FOR GENERATED_SLOTS - RUN ONLY ONCE
  // Add seller_cutoff_minutes column to generated_slots table if it doesn't exist
  const generatedSlotsSellerCutoffCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'generated_slots_seller_cutoff_column_v1'").get();
  if (generatedSlotsSellerCutoffCheck.count === 0) {
    console.log('[GENERATED_SLOTS_SELLER_CUTOFF] Running one-time seller cutoff column addition for generated_slots...');
    
    try {
      // Check if the column exists first
      const columns = db.prepare("PRAGMA table_info(generated_slots)").all();
      const columnExists = columns.some(col => col.name === 'seller_cutoff_minutes');
      
      if (!columnExists) {
        // Add seller_cutoff_minutes column to generated_slots table
        db.exec("ALTER TABLE generated_slots ADD COLUMN seller_cutoff_minutes INTEGER NULL");
        
        console.log('[GENERATED_SLOTS_SELLER_CUTOFF] Added seller_cutoff_minutes column to generated_slots table');
      } else {
        console.log('[GENERATED_SLOTS_SELLER_CUTOFF] seller_cutoff_minutes column already exists in generated_slots table');
      }
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('generated_slots_seller_cutoff_column_v1', 'true')").run();
      console.log('[GENERATED_SLOTS_SELLER_CUTOFF] Generated slots seller cutoff column addition completed and marked as done');
    } catch (error) {
      // Column might already exist, ignore error
      console.log('[GENERATED_SLOTS_SELLER_CUTOFF] Error during seller cutoff column addition:', error.message);
    }
  } else {
    console.log('[GENERATED_SLOTS_SELLER_CUTOFF] Generated slots seller cutoff column addition already ran, skipping...');
  }

  // ONE-TIME DISPATCHER CUTOFF COLUMN ADDITION FOR GENERATED_SLOTS - RUN ONLY ONCE
  // Add dispatcher_cutoff_minutes column to generated_slots table if it doesn't exist
  const generatedSlotsDispatcherCutoffCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'generated_slots_dispatcher_cutoff_column_v1'").get();
  if (generatedSlotsDispatcherCutoffCheck.count === 0) {
    console.log('[GENERATED_SLOTS_DISPATCHER_CUTOFF] Running one-time dispatcher cutoff column addition for generated_slots...');
    
    try {
      // Check if the column exists first
      const columns = db.prepare("PRAGMA table_info(generated_slots)").all();
      const columnExists = columns.some(col => col.name === 'dispatcher_cutoff_minutes');
      
      if (!columnExists) {
        // Add dispatcher_cutoff_minutes column to generated_slots table
        db.exec("ALTER TABLE generated_slots ADD COLUMN dispatcher_cutoff_minutes INTEGER NULL");
        
        console.log('[GENERATED_SLOTS_DISPATCHER_CUTOFF] Added dispatcher_cutoff_minutes column to generated_slots table');
      } else {
        console.log('[GENERATED_SLOTS_DISPATCHER_CUTOFF] dispatcher_cutoff_minutes column already exists in generated_slots table');
      }
      
      // Mark that we've run this migration
      db.prepare("INSERT INTO settings (key, value) VALUES ('generated_slots_dispatcher_cutoff_column_v1', 'true')").run();
      console.log('[GENERATED_SLOTS_DISPATCHER_CUTOFF] Generated slots dispatcher cutoff column addition completed and marked as done');
    } catch (error) {
      // Column might already exist, ignore error
      console.log('[GENERATED_SLOTS_DISPATCHER_CUTOFF] Error during dispatcher cutoff column addition:', error.message);
    }
  } else {
    console.log('[GENERATED_SLOTS_DISPATCHER_CUTOFF] Generated slots dispatcher cutoff column addition already ran, skipping...');
  }

} catch (error) {
  console.error('=== USER/BOAT SEEDING ERROR ===');
  console.error('Failed to seed initial data:', error);
  process.exit(1);
}



// =========================
// MANUAL (Owner offline input) schema (Task 10)
// IMPORTANT: additive-only. Does not affect seller/dispatcher/admin flows.
// Tables:
// - manual_batches: stores draft payload for a date range
// - manual_days: per-day flag for manual override (analytics priority manual > online)
// - manual_boat_stats: per-day aggregates per boat
// - manual_seller_stats: per-day aggregates per seller
// =========================
try {
  const manualSchemaCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'manual_owner_schema_v1'").get();
  if (manualSchemaCheck.count === 0) {
    console.log('[MANUAL_SCHEMA] Creating manual owner tables...');

    // Check if tables already exist (may have been migrated from a different schema)
    const manualBatchesExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='manual_batches'").get();
    const manualDaysExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='manual_days'").get();
    const manualBoatStatsExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='manual_boat_stats'").get();
    const manualSellerStatsExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='manual_seller_stats'").get();

    // Only create tables if they don't exist
    if (!manualBatchesExists) {
      db.exec(`
        CREATE TABLE manual_batches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date_from TEXT NOT NULL,
          date_to TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          locked INTEGER NOT NULL DEFAULT 0,
          locked_at TEXT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    }

    if (!manualDaysExists) {
      db.exec(`
        CREATE TABLE manual_days (
          period TEXT PRIMARY KEY,
          locked INTEGER NOT NULL DEFAULT 0
        )
      `);
    }

    if (!manualBoatStatsExists) {
      db.exec(`
        CREATE TABLE manual_boat_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          period TEXT NOT NULL,
          boat_id INTEGER NULL,
          revenue REAL NOT NULL DEFAULT 0,
          trips_completed INTEGER NOT NULL DEFAULT 0,
          seats_sold INTEGER NOT NULL DEFAULT 0
        )
      `);
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_manual_boat_stats_period ON manual_boat_stats(period)"); } catch {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_manual_boat_stats_boat ON manual_boat_stats(boat_id)"); } catch {}
    }

    if (!manualSellerStatsExists) {
      db.exec(`
        CREATE TABLE manual_seller_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          period TEXT NOT NULL,
          seller_id INTEGER NULL,
          revenue REAL NOT NULL DEFAULT 0,
          seats_sold INTEGER NOT NULL DEFAULT 0
        )
      `);
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_manual_seller_stats_period ON manual_seller_stats(period)"); } catch {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_manual_seller_stats_seller ON manual_seller_stats(seller_id)"); } catch {}
    }

    // Mark as done
    db.prepare("INSERT INTO settings (key, value) VALUES ('manual_owner_schema_v1', 'true')").run();
    console.log('[MANUAL_SCHEMA] Manual owner tables created and marked as done');
  } else {
    console.log('[MANUAL_SCHEMA] Manual owner tables already exist, skipping...');
  }
} catch (e) {
  console.log('[MANUAL_SCHEMA] Warning: could not create manual owner tables:', e?.message || e);
}

// =========================
// MANUAL V2: audit fields + period index
// =========================
try {
  const manualV2Check = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'manual_owner_schema_v2'").get();
  if (manualV2Check.count === 0) {
    console.log('[MANUAL_SCHEMA_V2] Adding audit fields to manual tables...');
    
    const mbCols = db.prepare("PRAGMA table_info(manual_batches)").all().map(r => r.name);
    const mdCols = db.prepare("PRAGMA table_info(manual_days)").all().map(r => r.name);
    
    // Add locked column if missing (for pre-existing tables)
    if (!mbCols.includes('locked')) {
      db.exec("ALTER TABLE manual_batches ADD COLUMN locked INTEGER NOT NULL DEFAULT 0");
    }
    if (!mbCols.includes('locked_at')) {
      db.exec("ALTER TABLE manual_batches ADD COLUMN locked_at TEXT NULL");
    }
    if (!mbCols.includes('created_at')) {
      db.exec("ALTER TABLE manual_batches ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))");
    }
    if (!mbCols.includes('updated_at')) {
      db.exec("ALTER TABLE manual_batches ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
    }
    if (!mdCols.includes('locked')) {
      db.exec("ALTER TABLE manual_days ADD COLUMN locked INTEGER NOT NULL DEFAULT 0");
    }
    
    if (!mbCols.includes('period')) {
      db.exec("ALTER TABLE manual_batches ADD COLUMN period TEXT NULL");
    }
    if (!mbCols.includes('created_by_user_id')) {
      db.exec("ALTER TABLE manual_batches ADD COLUMN created_by_user_id INTEGER NULL");
    }
    if (!mbCols.includes('updated_by_user_id')) {
      db.exec("ALTER TABLE manual_batches ADD COLUMN updated_by_user_id INTEGER NULL");
    }
    if (!mbCols.includes('locked_by_user_id')) {
      db.exec("ALTER TABLE manual_batches ADD COLUMN locked_by_user_id INTEGER NULL");
    }
    
    if (!mdCols.includes('locked_by_user_id')) {
      db.exec("ALTER TABLE manual_days ADD COLUMN locked_by_user_id INTEGER NULL");
    }
    if (!mdCols.includes('locked_at')) {
      db.exec("ALTER TABLE manual_days ADD COLUMN locked_at TEXT NULL");
    }
    
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_manual_batches_period ON manual_batches(period)"); } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_manual_batches_period_locked ON manual_batches(period, locked)"); } catch {}
    
    db.prepare("INSERT INTO settings (key, value) VALUES ('manual_owner_schema_v2', 'true')").run();
    console.log('[MANUAL_SCHEMA_V2] Audit fields added');
  }
} catch (e) {
  console.log('[MANUAL_SCHEMA_V2] Warning:', e?.message || e);
}

// =========================
// MANUAL V3: ensure locked column exists
// =========================
try {
  const mbCols = db.prepare("PRAGMA table_info(manual_batches)").all().map(r => r.name);
  const mdCols = db.prepare("PRAGMA table_info(manual_days)").all().map(r => r.name);
  
  if (!mbCols.includes('locked')) {
    console.log('[MANUAL_SCHEMA_V3] Adding locked column to manual_batches');
    db.exec("ALTER TABLE manual_batches ADD COLUMN locked INTEGER NOT NULL DEFAULT 0");
  }
  if (!mbCols.includes('locked_at')) {
    db.exec("ALTER TABLE manual_batches ADD COLUMN locked_at TEXT NULL");
  }
  if (!mbCols.includes('created_at')) {
    db.exec("ALTER TABLE manual_batches ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  }
  if (!mbCols.includes('updated_at')) {
    db.exec("ALTER TABLE manual_batches ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  }
  if (!mdCols.includes('locked')) {
    console.log('[MANUAL_SCHEMA_V3] Adding locked column to manual_days');
    db.exec("ALTER TABLE manual_days ADD COLUMN locked INTEGER NOT NULL DEFAULT 0");
  }
  console.log('[MANUAL_SCHEMA_V3] Columns verified');
} catch (e) {
  console.log('[MANUAL_SCHEMA_V3] Warning:', e?.message || e);
}

// =========================
// MANUAL V4: migrate period -> business_day, add missing columns
// =========================
try {
  const v4Check = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'manual_owner_schema_v4'").get();
  if (v4Check.count === 0) {
    console.log('[MANUAL_SCHEMA_V4] Migrating period -> business_day...');
    
    // manual_days: add business_day if missing, copy from period
    const mdCols = db.prepare("PRAGMA table_info(manual_days)").all().map(r => r.name);
    if (!mdCols.includes('business_day')) {
      db.exec("ALTER TABLE manual_days ADD COLUMN business_day TEXT NULL");
      // Copy from period if exists
      if (mdCols.includes('period')) {
        db.exec("UPDATE manual_days SET business_day = period WHERE business_day IS NULL");
      }
      console.log('[MANUAL_SCHEMA_V4] Added business_day to manual_days');
    }
    
    // manual_boat_stats: add business_day + new columns
    const mbCols = db.prepare("PRAGMA table_info(manual_boat_stats)").all().map(r => r.name);
    if (!mbCols.includes('business_day')) {
      db.exec("ALTER TABLE manual_boat_stats ADD COLUMN business_day TEXT NULL");
      if (mbCols.includes('period')) {
        db.exec("UPDATE manual_boat_stats SET business_day = period WHERE business_day IS NULL");
      }
      console.log('[MANUAL_SCHEMA_V4] Added business_day to manual_boat_stats');
    }
    if (!mbCols.includes('trips')) {
      db.exec("ALTER TABLE manual_boat_stats ADD COLUMN trips INTEGER NOT NULL DEFAULT 0");
    }
    if (!mbCols.includes('tickets')) {
      db.exec("ALTER TABLE manual_boat_stats ADD COLUMN tickets INTEGER NOT NULL DEFAULT 0");
    }
    if (!mbCols.includes('capacity')) {
      db.exec("ALTER TABLE manual_boat_stats ADD COLUMN capacity INTEGER NOT NULL DEFAULT 0");
    }
    
    // manual_seller_stats: add business_day + new columns
    const msCols = db.prepare("PRAGMA table_info(manual_seller_stats)").all().map(r => r.name);
    if (!msCols.includes('business_day')) {
      db.exec("ALTER TABLE manual_seller_stats ADD COLUMN business_day TEXT NULL");
      if (msCols.includes('period')) {
        db.exec("UPDATE manual_seller_stats SET business_day = period WHERE business_day IS NULL");
      }
      console.log('[MANUAL_SCHEMA_V4] Added business_day to manual_seller_stats');
    }
    if (!msCols.includes('trips')) {
      db.exec("ALTER TABLE manual_seller_stats ADD COLUMN trips INTEGER NOT NULL DEFAULT 0");
    }
    if (!msCols.includes('tickets')) {
      db.exec("ALTER TABLE manual_seller_stats ADD COLUMN tickets INTEGER NOT NULL DEFAULT 0");
    }
    
    // Create indexes on business_day
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_manual_boat_stats_business_day ON manual_boat_stats(business_day)"); } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_manual_seller_stats_business_day ON manual_seller_stats(business_day)"); } catch {}
    
    db.prepare("INSERT INTO settings (key, value) VALUES ('manual_owner_schema_v4', 'true')").run();
    console.log('[MANUAL_SCHEMA_V4] Migration completed');
  } else {
    console.log('[MANUAL_SCHEMA_V4] Already migrated, skipping...');
  }
} catch (e) {
  console.log('[MANUAL_SCHEMA_V4] Warning:', e?.message || e);
}

// =========================
// MOTIVATION DAY SETTINGS: snapshot of motivation settings per business_day
// Ensures motivation calculation for a day is fixed and doesn't change when owner updates settings
// =========================
try {
  const motivationDaySettingsCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'motivation_day_settings_v1'").get();
  if (motivationDaySettingsCheck.count === 0) {
    console.log('[MOTIVATION_DAY_SETTINGS] Creating motivation_day_settings table...');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS motivation_day_settings (
        business_day TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    
    db.prepare("INSERT INTO settings (key, value) VALUES ('motivation_day_settings_v1', 'true')").run();
    console.log('[MOTIVATION_DAY_SETTINGS] Table created and marked as done');
  } else {
    console.log('[MOTIVATION_DAY_SETTINGS] Table already exists, skipping...');
  }
} catch (e) {
  console.log('[MOTIVATION_DAY_SETTINGS] Warning:', e?.message || e);
}

// =========================
// PRESALES SELLER_ID: seller attribution for money_ledger
// Fixes: seller_id in money_ledger should come from presales.seller_id, not req.user.id (dispatcher)
// =========================
try {
  const presalesSellerIdCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'presales_seller_id_column_v1'").get();
  if (presalesSellerIdCheck.count === 0) {
    console.log('[PRESALES_SELLER_ID] Adding seller_id column to presales table...');
    
    try {
      const cols = db.prepare("PRAGMA table_info(presales)").all().map(r => r.name);
      if (!cols.includes('seller_id')) {
        db.exec("ALTER TABLE presales ADD COLUMN seller_id INTEGER NULL");
        console.log('[PRESALES_SELLER_ID] Added seller_id column to presales table');
      }
    } catch (e) {
      console.log('[PRESALES_SELLER_ID] Column may already exist:', e?.message || e);
    }
    
    db.prepare("INSERT INTO settings (key, value) VALUES ('presales_seller_id_column_v1', 'true')").run();
    console.log('[PRESALES_SELLER_ID] Migration completed');
  } else {
    console.log('[PRESALES_SELLER_ID] Migration already ran, skipping...');
  }
} catch (e) {
  console.log('[PRESALES_SELLER_ID] Warning:', e?.message || e);
}

export default db;


/* =========================
   MONEY LEDGER (Primary financial journal)
   Records all money movements: payments, deposits, reversals.
========================= */
try {
  const moneyLedgerCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'money_ledger_table_v1'").get();
  if (moneyLedgerCheck.count === 0) {
    console.log('[MONEY_LEDGER] Creating money_ledger table...');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS money_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presale_id INTEGER NULL,
        slot_id INTEGER NULL,
        trip_day TEXT NULL,
        business_day TEXT NULL,
        kind TEXT NOT NULL,
        type TEXT NOT NULL,
        method TEXT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'POSTED',
        seller_id INTEGER NULL,
        event_time TEXT DEFAULT CURRENT_TIMESTAMP,
        decision_final TEXT NULL
      )
    `);
    
    // Indexes for common queries
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_money_ledger_business_day ON money_ledger(business_day)"); } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_money_ledger_presale_id ON money_ledger(presale_id)"); } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_money_ledger_seller_id ON money_ledger(seller_id)"); } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_money_ledger_status ON money_ledger(status)"); } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_money_ledger_kind ON money_ledger(kind)"); } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_money_ledger_type ON money_ledger(type)"); } catch {}
    
    db.prepare("INSERT INTO settings (key, value) VALUES ('money_ledger_table_v1', 'true')").run();
    console.log('[MONEY_LEDGER] Table created and marked as done');
  } else {
    console.log('[MONEY_LEDGER] Table already exists, skipping...');
  }
} catch (e) {
  console.log('[MONEY_LEDGER] Warning:', e?.message || e);
}

/* =========================
   SALES TRANSACTIONS CANONICAL (Owner analytics layer)
   Per-ticket financial records for cash/card breakdown.
========================= */
try {
  const canonCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'sales_transactions_canonical_table_v1'").get();
  if (canonCheck.count === 0) {
    console.log('[SALES_TRANSACTIONS_CANONICAL] Creating table...');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS sales_transactions_canonical (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER UNIQUE,
        presale_id INTEGER NULL,
        slot_id INTEGER NULL,
        boat_id INTEGER NULL,
        slot_uid TEXT NULL,
        slot_source TEXT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        cash_amount INTEGER NOT NULL DEFAULT 0,
        card_amount INTEGER NOT NULL DEFAULT 0,
        method TEXT NULL,
        status TEXT NOT NULL DEFAULT 'VALID',
        business_day TEXT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Indexes
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_canon_presale_id ON sales_transactions_canonical(presale_id)"); } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_canon_business_day ON sales_transactions_canonical(business_day)"); } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_canon_status ON sales_transactions_canonical(status)"); } catch {}
    try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_canon_ticket_id ON sales_transactions_canonical(ticket_id)"); } catch {}
    
    db.prepare("INSERT INTO settings (key, value) VALUES ('sales_transactions_canonical_table_v1', 'true')").run();
    console.log('[SALES_TRANSACTIONS_CANONICAL] Table created');
  } else {
    console.log('[SALES_TRANSACTIONS_CANONICAL] Table already exists, skipping...');
  }
} catch (e) {
  console.log('[SALES_TRANSACTIONS_CANONICAL] Warning:', e?.message || e);
}

/* =========================
   SALES TRANSACTIONS (CANONICAL MONEY LAYER)
   Additive-only. Does NOT affect seller/dispatcher flows yet.
========================= */
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_day TEXT NOT NULL,
      presale_id INTEGER NULL,
      slot_id INTEGER NULL,
      slot_uid TEXT NULL,
      slot_source TEXT NULL, -- generated_slots | manual
      amount INTEGER NOT NULL DEFAULT 0,
      qty INTEGER NOT NULL DEFAULT 0,
      method TEXT NULL, -- CASH | CARD
      status TEXT NOT NULL DEFAULT 'VALID',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch (e) {
  console.log('[SALES_TRANSACTIONS] create skipped:', e?.message || e);
}


/* =========================
   STEP 5: Append-only sales_transactions auto-fill (future-only)
   Goal: start populating canonical money layer WITHOUT touching seller/dispatcher/admin code.
   Approach: SQLite trigger on tickets INSERT -> sales_transactions INSERT OR IGNORE.
   Notes:
   - Uses presales.slot_uid when available to infer slot_source/slot_id.
   - Safe-by-default: if required columns are missing, trigger is not created.
========================= */
try {
  // Ensure sales_transactions has ticket_id column + unique index (idempotent)
  try {
    const stCols = db.prepare("PRAGMA table_info(sales_transactions)").all().map(r => r.name);
    if (!stCols.includes("ticket_id")) {
      db.exec("ALTER TABLE sales_transactions ADD COLUMN ticket_id INTEGER NULL");
      console.log("[SALES_TRANSACTIONS] Added ticket_id column");
    }
  } catch {}

  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_transactions_ticket_id ON sales_transactions(ticket_id) WHERE ticket_id IS NOT NULL");
  } catch {}

  const hasTickets = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tickets'").get();
  if (!hasTickets) {
    console.log("[TRIGGER] tickets table missing, skipping trigger setup");
  } else {
    const tCols = db.prepare("PRAGMA table_info(tickets)").all().map(r => r.name);
    const hasPresales = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='presales'").get();
    const pCols = hasPresales ? db.prepare("PRAGMA table_info(presales)").all().map(r => r.name) : [];

    const hasTicketCreatedAt = tCols.includes("created_at");
    const hasTicketBusinessDay = tCols.includes("business_day");
    const hasTicketMethod = tCols.includes("payment_method");
    const hasTicketStatus = tCols.includes("status");
    const hasPresaleId = tCols.includes("presale_id");
    const hasSlotId = tCols.includes("boat_slot_id");

    const hasPresalesSlotUid = hasPresales && pCols.includes("slot_uid");

    // Minimum required: price + (business_day or created_at) + boat_slot_id
    if (tCols.includes("price") && (hasTicketBusinessDay || hasTicketCreatedAt) && hasSlotId) {
      const businessDayExpr = hasTicketBusinessDay ? "NEW.business_day" : "DATE(NEW.created_at)";
      const methodExpr = hasTicketMethod ? "NEW.payment_method" : "NULL";
      const statusExpr = hasTicketStatus
        ? "CASE WHEN NEW.status IN ('ACTIVE','USED') THEN 'VALID' ELSE 'INVALID' END"
        : "'VALID'";

      const presaleExpr = hasPresaleId ? "NEW.presale_id" : "NULL";

      const slotUidExpr = (hasPresaleId && hasPresalesSlotUid)
        ? "(SELECT slot_uid FROM presales WHERE id = NEW.presale_id)"
        : "NULL";

      const slotSourceExpr = (hasPresaleId && hasPresalesSlotUid)
        ? "CASE WHEN (SELECT slot_uid FROM presales WHERE id = NEW.presale_id) LIKE 'generated:%' THEN 'generated_slots' " +
          "WHEN (SELECT slot_uid FROM presales WHERE id = NEW.presale_id) LIKE 'manual:%' THEN 'manual' ELSE NULL END"
        : "NULL";

      const slotIdExpr = (hasPresaleId && hasPresalesSlotUid)
        ? "CASE WHEN instr((SELECT slot_uid FROM presales WHERE id = NEW.presale_id), ':') > 0 " +
          "THEN CAST(substr((SELECT slot_uid FROM presales WHERE id = NEW.presale_id), instr((SELECT slot_uid FROM presales WHERE id = NEW.presale_id), ':') + 1) AS INTEGER) " +
          "ELSE NULL END"
        : "NULL";

      try { db.exec("DROP TRIGGER IF EXISTS trg_TICKETS_TO_SALES_TRANSACTIONS"); } catch {}

      db.exec(`
        CREATE TRIGGER trg_TICKETS_TO_SALES_TRANSACTIONS
        AFTER INSERT ON tickets
        BEGIN
          INSERT OR IGNORE INTO sales_transactions (
            business_day,
            presale_id,
            slot_id,
            slot_uid,
            slot_source,
            amount,
            qty,
            method,
            status,
            ticket_id
          ) VALUES (
            ${businessDayExpr},
            ${presaleExpr},
            ${slotIdExpr},
            ${slotUidExpr},
            ${slotSourceExpr},
            COALESCE(NEW.price,0),
            1,
            ${methodExpr},
            ${statusExpr},
            NEW.id
          );
        END;
      `);

      console.log("[TRIGGER] trg_TICKETS_TO_SALES_TRANSACTIONS created");
    } else {
      console.log("[TRIGGER] trg_TICKETS_TO_SALES_TRANSACTIONS skipped (missing required tickets columns)");
    }
  }
} catch (e) {
  console.log("[TRIGGER] tickets->sales_transactions setup failed:", e?.message || e);
}


/* =========================
   STEP 8: Keep sales_transactions in sync on ticket UPDATE/DELETE
   - UPDATE: adjust amount/business_day/method, set VALID/INVALID by ticket status
   - DELETE: mark as INVALID
   Safe-by-default: only created when required columns exist.
========================= */
try {
  const hasTickets = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tickets'").get();
  const hasST = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_transactions'").get();
  if (hasTickets && hasST) {
    const tCols = db.prepare("PRAGMA table_info(tickets)").all().map(r => r.name);
    const hasBusinessDay = tCols.includes("business_day");
    const hasCreatedAt = tCols.includes("created_at");
    const hasStatus = tCols.includes("status");
    const hasPrice = tCols.includes("price");
    const hasMethod = tCols.includes("payment_method");

    const businessDayExpr = hasBusinessDay ? "NEW.business_day" : (hasCreatedAt ? "DATE(NEW.created_at)" : "NULL");
    const statusExpr = hasStatus
      ? "CASE WHEN NEW.status IN ('ACTIVE','USED') THEN 'VALID' ELSE 'INVALID' END"
      : "'VALID'";
    const methodExpr = hasMethod ? "NEW.payment_method" : "method";

    if (businessDayExpr !== "NULL" && hasPrice) {
      try { db.exec("DROP TRIGGER IF EXISTS trg_TICKETS_TO_SALES_TRANSACTIONS_UPDATE"); } catch {}
      db.exec(`
        CREATE TRIGGER trg_TICKETS_TO_SALES_TRANSACTIONS_UPDATE
        AFTER UPDATE ON tickets
        BEGIN
          UPDATE sales_transactions
          SET business_day = ${businessDayExpr},
              amount = COALESCE(NEW.price,0),
              method = ${methodExpr},
              status = ${statusExpr}
          WHERE ticket_id = NEW.id;
        END;
      `);
      console.log("[TRIGGER] trg_TICKETS_TO_SALES_TRANSACTIONS_UPDATE created");
    } else {
      console.log("[TRIGGER] trg_TICKETS_TO_SALES_TRANSACTIONS_UPDATE skipped (missing required tickets columns)");
    }

    try { db.exec("DROP TRIGGER IF EXISTS trg_TICKETS_TO_SALES_TRANSACTIONS_DELETE"); } catch {}
    db.exec(`
      CREATE TRIGGER trg_TICKETS_TO_SALES_TRANSACTIONS_DELETE
      AFTER DELETE ON tickets
      BEGIN
        UPDATE sales_transactions
        SET status = 'INVALID'
        WHERE ticket_id = OLD.id;
      END;
    `);
    console.log("[TRIGGER] trg_TICKETS_TO_SALES_TRANSACTIONS_DELETE created");
  }
} catch (e) {
  console.log("[TRIGGER] update/delete sync setup failed:", e?.message || e);
}


/* =========================
   STEP 13: Performance indexes (additive-only)
========================= */
try {
  // sales_transactions indexes
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_sales_tx_day ON sales_transactions(business_day)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_sales_tx_status ON sales_transactions(status)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_sales_tx_ticket_id ON sales_transactions(ticket_id)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_sales_tx_day_status ON sales_transactions(business_day, status)"); } catch {}

  // tickets indexes (only if columns exist)
  try {
    const tCols = db.prepare("PRAGMA table_info(tickets)").all().map(r => r.name);
    if (tCols.includes('business_day')) {
      db.exec("CREATE INDEX IF NOT EXISTS idx_tickets_business_day ON tickets(business_day)");
    }
    if (tCols.includes('created_at')) {
      db.exec("CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at)");
    }
    if (tCols.includes('status')) {
      db.exec("CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)");
    }
  } catch {}
} catch (e) {
  console.log('[INDEXES] setup failed:', e?.message || e);
}


/* =========================
   STEP 17: Owner audit log (additive-only)
========================= */
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS owner_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      action TEXT NOT NULL,
      request_id TEXT,
      meta_json TEXT,
      ip TEXT
    );
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_owner_audit_created_at ON owner_audit_log(created_at)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_owner_audit_action ON owner_audit_log(action)"); } catch {}
} catch (e) {
  console.log('[OWNER_AUDIT_LOG] init failed:', e?.message || e);
}

/* =========================
   OWNER SETTINGS: persistent owner configuration
   Single-row JSON storage for motivation coefficients and thresholds.
========================= */
try {
  const ownerSettingsCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'owner_settings_table_v1'").get();
  if (ownerSettingsCheck.count === 0) {
    console.log('[OWNER_SETTINGS] Creating owner_settings table...');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS owner_settings (
        id INTEGER PRIMARY KEY,
        settings_json TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Insert default row so UPDATE in API works
    db.prepare("INSERT OR IGNORE INTO owner_settings (id, settings_json, updated_at) VALUES (1, '{}', datetime('now'))").run();
    
    console.log('[OWNER_SETTINGS] Created owner_settings table');
    
    db.prepare("INSERT INTO settings (key, value) VALUES ('owner_settings_table_v1', 'true')").run();
    console.log('[OWNER_SETTINGS] Table creation marked as done');
  } else {
    console.log('[OWNER_SETTINGS] owner_settings table already exists, skipping...');
  }
} catch (e) {
  console.log('[OWNER_SETTINGS] init failed:', e?.message || e);
}
