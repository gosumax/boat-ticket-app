// Check ledger entries for presale 245
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.sqlite');

const db = new Database(DB_FILE, { readonly: true });

console.log('=== MONEY_LEDGER for presale_id = 245 ===');
const ledger = db.prepare(`
  SELECT id, business_day, kind, type, method, amount, status, seller_id, presale_id, event_time
  FROM money_ledger
  WHERE presale_id = 245
  ORDER BY id ASC
`).all();
console.log(JSON.stringify(ledger, null, 2));

console.log('\n=== PRESALE 245 ===');
const presale = db.prepare(`
  SELECT id, seller_id, business_day, total_price, prepayment_amount, status
  FROM presales
  WHERE id = 245
`).get();
console.log(JSON.stringify(presale, null, 2));

db.close();
