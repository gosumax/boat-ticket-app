// Database Snapshot - Read-only diagnostic
import Database from 'better-sqlite3';

const db = new Database('database.sqlite', { readonly: true });

console.log('=== DATABASE SNAPSHOT ===\n');

// Users
console.log('--- USERS ---');
const users = db.prepare('SELECT id, username, role, is_active FROM users').all();
console.table(users);

// Boats
console.log('\n--- BOATS ---');
const boats = db.prepare('SELECT id, name, type, is_active FROM boats').all();
console.table(boats);

// Schedule Templates
console.log('\n--- SCHEDULE_TEMPLATES ---');
const templates = db.prepare('SELECT id, weekday, time, product_type, boat_id, is_active FROM schedule_templates').all();
console.table(templates);

// Schedule Template Items with schedule_template_id
console.log('\n--- SCHEDULE_TEMPLATE_ITEMS ---');
try {
  const items = db.prepare(`
    SELECT id, name, boat_id, type, departure_time, is_active 
    FROM schedule_template_items
  `).all();
  console.table(items);
} catch(e) {
  console.log('Error:', e.message);
}

// Generated Slots
console.log('\n--- GENERATED_SLOTS ---');
const slotCount = db.prepare('SELECT COUNT(1) as c FROM generated_slots').get();
console.log('Total count:', slotCount.c);
const slotsByDate = db.prepare(`
  SELECT trip_date, COUNT(1) as count, SUM(capacity) as total_capacity, SUM(seats_left) as total_seats_left
  FROM generated_slots 
  GROUP BY trip_date 
  ORDER BY trip_date 
  LIMIT 10
`).all();
console.table(slotsByDate);

// Presales
console.log('\n--- PRESALES ---');
const presaleCount = db.prepare('SELECT COUNT(1) as c FROM presales').get();
console.log('Total count:', presaleCount.c);
const presaleByStatus = db.prepare(`
  SELECT status, COUNT(1) as count, SUM(total_price) as total_price, SUM(prepayment_amount) as total_prepaid
  FROM presales 
  GROUP BY status
`).all();
console.table(presaleByStatus);

// Tickets
console.log('\n--- TICKETS ---');
const ticketCount = db.prepare('SELECT COUNT(1) as c FROM tickets').get();
console.log('Total count:', ticketCount.c);
const ticketsByStatus = db.prepare(`
  SELECT status, COUNT(1) as count, SUM(price) as total_price
  FROM tickets 
  GROUP BY status
`).all();
console.table(ticketsByStatus);

// Money Ledger
console.log('\n--- MONEY_LEDGER ---');
const ledgerCount = db.prepare('SELECT COUNT(1) as c FROM money_ledger').get();
console.log('Total count:', ledgerCount.c);
const ledgerByType = db.prepare(`
  SELECT kind, type, COUNT(1) as count, SUM(amount) as total_amount
  FROM money_ledger 
  GROUP BY kind, type
  ORDER BY kind, type
`).all();
console.table(ledgerByType);

// Sales Transactions Canonical
console.log('\n--- SALES_TRANSACTIONS_CANONICAL ---');
const canonCount = db.prepare('SELECT COUNT(1) as c FROM sales_transactions_canonical').get();
console.log('Total count:', canonCount.c);
const canonByMethod = db.prepare(`
  SELECT method, status, COUNT(1) as count, SUM(amount) as total_amount
  FROM sales_transactions_canonical 
  GROUP BY method, status
`).all();
console.table(canonByMethod);

// Owner Settings
console.log('\n--- OWNER_SETTINGS ---');
const ownerSettings = db.prepare('SELECT * FROM owner_settings').get();
if (ownerSettings) {
  console.log('  id:', ownerSettings.id);
  console.log('  timezone:', ownerSettings.timezone);
  console.log('  motivation_mode:', ownerSettings.motivation_mode);
  console.log('  currency:', ownerSettings.currency);
} else {
  console.log('  (no settings)');
}

// Motivation Day Settings
console.log('\n--- MOTIVATION_DAY_SETTINGS ---');
const motivationCount = db.prepare('SELECT COUNT(1) as c FROM motivation_day_settings').get();
console.log('Total count:', motivationCount.c);

db.close();
console.log('\n=== SNAPSHOT COMPLETE ===');
