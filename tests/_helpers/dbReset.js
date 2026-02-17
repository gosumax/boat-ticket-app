// dbReset.js — full test DB reset and schema recreation
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resetTestDb() {
  const testDbPath = path.join(__dirname, '..', '..', '_testdata', 'test.sqlite');
  
  // Ensure _testdata directory exists
  const testDataDir = path.dirname(testDbPath);
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }
  
  // Remove existing test DB and any WAL/SHM files
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
  } catch (e) {
    console.warn('[TEST DB] Cleanup warning:', e.message);
  }
  
  // Create fresh DB
  const db = new Database(testDbPath);
  // Use DELETE journal mode for tests (no WAL concurrency issues)
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = OFF'); // Fast writes for tests
  db.pragma('foreign_keys = ON');
  
  // Load production schema
  const schemaPath = path.join(__dirname, 'schema_prod.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  
  // WORKAROUND: server/selling.mjs line 1223 queries boat_slots.trip_date
  // but production schema doesn't have it. Add NULL column for tests.
  try {
    db.exec(`ALTER TABLE boat_slots ADD COLUMN trip_date TEXT NULL`);
  } catch (e) {
    // Column may already exist if schema was updated
  }
  
  // WORKAROUND: server/selling.mjs line 1241 INSERTs presales.business_day
  // but production schema doesn't have it. Add NULL column for tests.
  try {
    db.exec(`ALTER TABLE presales ADD COLUMN business_day TEXT NULL`);
  } catch (e) {
    // Column may already exist
  }
  
  db.close();
  
  console.log('[TEST DB] Reset complete:', testDbPath);
  
  return testDbPath;
}

export function getTestDb() {
  const testDbPath = path.join(__dirname, '..', '..', '_testdata', 'test.sqlite');
  return new Database(testDbPath);
}

export function getTableCounts(db) {
  const tables = ['users', 'boats', 'boat_slots', 'generated_slots', 'presales', 'tickets', 'money_ledger', 'sales_transactions_canonical'];
  const counts = {};
  
  tables.forEach(table => {
    try {
      const result = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
      counts[table] = result.count;
    } catch (e) {
      counts[table] = 'ERROR';
    }
  });
  
  return counts;
}
