// Temporary diagnostic script for refund bug investigation
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, 'database.sqlite'));

console.log('\n=== DATE CONTEXT ===');
const dates = db.prepare(`SELECT DATE('now','localtime') as today, DATE('now','localtime','+1 day') as tomorrow`).get();
console.log('today:', dates.today);
console.log('tomorrow:', dates.tomorrow);

console.log('\n=== LAST 10 PRESALES ===');
const presales = db.prepare(`
  SELECT id, slot_uid, status, payment_cash_amount, payment_card_amount, 
         total_price, prepayment_amount, created_at, updated_at, seller_id
  FROM presales 
  ORDER BY id DESC LIMIT 10
`).all();
console.table(presales);

console.log('\n=== LAST 20 TICKETS ===');
const tickets = db.prepare(`
  SELECT id, presale_id, status, created_at, updated_at
  FROM tickets 
  ORDER BY id DESC LIMIT 20
`).all();
console.table(tickets);

console.log('\n=== LAST 50 MONEY_LEDGER ===');
const ledger = db.prepare(`
  SELECT id, business_day, kind, type, amount, method, presale_id, status, event_time
  FROM money_ledger 
  ORDER BY id DESC LIMIT 50
`).all();
console.table(ledger);

console.log('\n=== LAST 50 SALES_TRANSACTIONS_CANONICAL ===');
const stc = db.prepare(`
  SELECT id, business_day, amount, cash_amount, card_amount, status, presale_id, created_at
  FROM sales_transactions_canonical 
  ORDER BY id DESC LIMIT 50
`).all();
console.table(stc);

db.close();
