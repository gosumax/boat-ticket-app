// Detailed analysis for presale_id=186
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, 'database.sqlite'));

const presaleId = 186;

console.log(`\n=== DETAILED ANALYSIS FOR PRESALE ${presaleId} ===\n`);

console.log('=== PRESALE ROW ===');
const presale = db.prepare(`SELECT * FROM presales WHERE id = ?`).get(presaleId);
console.log(presale);

console.log('\n=== TICKETS FOR THIS PRESALE ===');
const tickets = db.prepare(`SELECT * FROM tickets WHERE presale_id = ?`).all(presaleId);
console.table(tickets);

console.log('\n=== MONEY_LEDGER FOR THIS PRESALE ===');
const ledger = db.prepare(`
  SELECT id, business_day, kind, type, amount, method, status, event_time
  FROM money_ledger WHERE presale_id = ? ORDER BY id
`).all(presaleId);
console.table(ledger);

console.log('\n=== SALES_TRANSACTIONS_CANONICAL FOR THIS PRESALE ===');
const stc = db.prepare(`
  SELECT * FROM sales_transactions_canonical WHERE presale_id = ? ORDER BY id
`).all(presaleId);
console.table(stc);

console.log('\n=== OWNER MONEY SUMMARY (today) ===');
const today = db.prepare(`SELECT DATE('now','localtime') as d`).get().d;
console.log('Today:', today);

// Sum money_ledger for today
const mlToday = db.prepare(`
  SELECT 
    kind,
    type,
    SUM(amount) as total_amount,
    method
  FROM money_ledger 
  WHERE business_day = ?
  GROUP BY kind, type, method
  ORDER BY kind, type, method
`).all(today);
console.log('\nMoney Ledger by type for today:');
console.table(mlToday);

// Total collected
const collected = db.prepare(`
  SELECT 
    SUM(CASE WHEN amount > 0 AND kind = 'SELLER_SHIFT' THEN amount ELSE 0 END) as collected_positive,
    SUM(CASE WHEN amount < 0 AND type = 'SALE_CANCEL_REVERSE' THEN amount ELSE 0 END) as refunds_negative,
    SUM(amount) as net
  FROM money_ledger 
  WHERE business_day = ? AND kind = 'SELLER_SHIFT'
`).get(today);
console.log('\nCollected/refunds for today (SELLER_SHIFT):');
console.log(collected);

// Check sales_transactions_canonical for today
const stcToday = db.prepare(`
  SELECT 
    SUM(amount) as total_amount,
    SUM(cash_amount) as total_cash,
    SUM(card_amount) as total_card
  FROM sales_transactions_canonical 
  WHERE business_day = ? AND status = 'VALID'
`).get(today);
console.log('\nSales Transactions Canonical (VALID) for today:');
console.log(stcToday);

db.close();
