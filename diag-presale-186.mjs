// Detailed analysis for presale_id=245 (CANCELLED after shift close)
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, 'database.sqlite'));

const presaleId = 245;

console.log(`\n=== PRESALE ${presaleId} (CANCELLED after shift close on 2026-02-21) ===\n`);

console.log('=== PRESALE ROW ===');
const presale = db.prepare(`SELECT id, seller_id, business_day, total_price, prepayment_amount, status FROM presales WHERE id = ?`).get(presaleId);
console.log(presale);

console.log('\n=== MONEY_LEDGER FOR THIS PRESALE ===');
const ledger = db.prepare(`
  SELECT id, business_day, kind, type, amount, method, status, seller_id, event_time
  FROM money_ledger WHERE presale_id = ? ORDER BY id
`).all(presaleId);
console.table(ledger);

console.log('\n=== SHIFT CLOSURES for 2026-02-21 ===');
const closure = db.prepare(`SELECT business_day, closed_at, closed_by FROM shift_closures WHERE business_day = '2026-02-21'`).get();
console.log(closure);

db.close();
