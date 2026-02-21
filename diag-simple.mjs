// Minimal diagnostic - outputs simple key-value pairs
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.sqlite');

console.log('=== START DIAGNOSTIC ===');
console.log('DB_FILE:', DB_FILE);

try {
  const db = new Database(DB_FILE, { readonly: true });
  
  // Date
  const dates = db.prepare("SELECT DATE('now','localtime') as today").get();
  console.log('TODAY:', dates.today);
  
  // Count presales
  const presaleCount = db.prepare("SELECT COUNT(*) as count FROM presales").get();
  console.log('PRESALE_COUNT:', presaleCount.count);
  
  // Last presale
  const lastPresale = db.prepare("SELECT id, status, payment_cash_amount, payment_card_amount FROM presales ORDER BY id DESC LIMIT 1").get();
  console.log('LAST_PRESALE:', JSON.stringify(lastPresale));
  
  // Count money_ledger
  const ledgerCount = db.prepare("SELECT COUNT(*) as count FROM money_ledger").get();
  console.log('LEDGER_COUNT:', ledgerCount.count);
  
  // Count SALE_CANCEL_REVERSE
  const refundCount = db.prepare("SELECT COUNT(*) as count FROM money_ledger WHERE type = 'SALE_CANCEL_REVERSE'").get();
  console.log('REFUND_COUNT:', refundCount.count);
  
  // Last refund if any
  if (refundCount.count > 0) {
    const lastRefund = db.prepare("SELECT id, business_day, type, amount, method, presale_id FROM money_ledger WHERE type = 'SALE_CANCEL_REVERSE' ORDER BY id DESC LIMIT 1").get();
    console.log('LAST_REFUND:', JSON.stringify(lastRefund));
  }
  
  // Cancelled presales
  const cancelledCount = db.prepare("SELECT COUNT(*) as count FROM presales WHERE status = 'CANCELLED'").get();
  console.log('CANCELLED_COUNT:', cancelledCount.count);
  
  if (cancelledCount.count > 0) {
    const lastCancelled = db.prepare("SELECT id, status, payment_cash_amount, payment_card_amount FROM presales WHERE status = 'CANCELLED' ORDER BY id DESC LIMIT 1").get();
    console.log('LAST_CANCELLED:', JSON.stringify(lastCancelled));
    
    // Get ledger for this presale
    const cancelledLedger = db.prepare("SELECT id, type, amount, method FROM money_ledger WHERE presale_id = ? ORDER BY id").all(lastCancelled.id);
    console.log('CANCELLED_LEDGER:', JSON.stringify(cancelledLedger));
  }
  
  // Owner summary for today
  const today = dates.today;
  const collected = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM money_ledger
    WHERE business_day = ? AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD')
  `).get(today);
  console.log('COLLECTED_TODAY:', JSON.stringify(collected));
  
  const refundsToday = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total
    FROM money_ledger
    WHERE business_day = ? AND type = 'SALE_CANCEL_REVERSE'
  `).get(today);
  console.log('REFUNDS_TODAY:', JSON.stringify(refundsToday));
  
  db.close();
  console.log('=== END DIAGNOSTIC ===');
  
} catch (error) {
  console.log('ERROR:', error.message);
}
