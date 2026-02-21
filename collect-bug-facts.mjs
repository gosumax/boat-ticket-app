import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.sqlite');

console.log('=== BUG INVESTIGATION: Owner "Собрано сегодня" not decreasing after refund ===\n');
console.log('Database file:', DB_FILE);
console.log('Timestamp:', new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }));
console.log('');

try {
  const db = new Database(DB_FILE, { readonly: true });
  
  // 1. Get today/tomorrow in SQLite localtime
  console.log('=== 1. DATE CONTEXT ===');
  const dates = db.prepare("SELECT DATE('now','localtime') as today, DATE('now','localtime','+1 day') as tomorrow").get();
  console.log('SQLite localtime:', dates);
  console.log('');
  
  // 2. Last 10 presales
  console.log('=== 2. LAST 10 PRESALES ===');
  const presales = db.prepare(`
    SELECT id, slot_uid, trip_date, status, payment_cash_amount, payment_card_amount, 
           created_at, updated_at, seller_id
    FROM presales 
    ORDER BY id DESC LIMIT 10
  `).all();
  console.table(presales);
  console.log('');
  
  // 3. Last 20 tickets
  console.log('=== 3. LAST 20 TICKETS ===');
  const tickets = db.prepare(`
    SELECT id, presale_id, status, created_at, updated_at
    FROM tickets 
    ORDER BY id DESC LIMIT 20
  `).all();
  console.table(tickets);
  console.log('');
  
  // 4. Last 50 money_ledger entries (CRITICAL FOR BUG)
  console.log('=== 4. LAST 50 MONEY_LEDGER ENTRIES (looking for SALE_CANCEL_REVERSE) ===');
  const ledger = db.prepare(`
    SELECT id, business_day, type, amount, cash_amount, card_amount, method, presale_id, created_at
    FROM money_ledger 
    ORDER BY id DESC LIMIT 50
  `).all();
  console.table(ledger);
  console.log('');
  
  // 5. Check specifically for SALE_CANCEL_REVERSE entries
  console.log('=== 5. SALE_CANCEL_REVERSE ENTRIES (REFUNDS) ===');
  const refunds = db.prepare(`
    SELECT id, business_day, type, amount, cash_amount, card_amount, method, presale_id, created_at
    FROM money_ledger 
    WHERE type = 'SALE_CANCEL_REVERSE'
    ORDER BY id DESC LIMIT 20
  `).all();
  if (refunds.length === 0) {
    console.log('⚠️ NO SALE_CANCEL_REVERSE ENTRIES FOUND');
  } else {
    console.table(refunds);
  }
  console.log('');
  
  // 6. Last 50 sales_transactions_canonical
  console.log('=== 6. LAST 50 SALES_TRANSACTIONS_CANONICAL ===');
  const transactions = db.prepare(`
    SELECT id, business_day, trip_date, type, amount, cash_amount, card_amount, status, presale_id, created_at
    FROM sales_transactions_canonical 
    ORDER BY id DESC LIMIT 50
  `).all();
  console.table(transactions);
  console.log('');
  
  // 7. Summary for today (simulating Owner money view)
  console.log('=== 7. OWNER MONEY SUMMARY FOR TODAY ===');
  const today = dates.today;
  
  const collected = db.prepare(`
    SELECT 
      COALESCE(SUM(amount), 0) as collected_total,
      COALESCE(SUM(cash_amount), 0) as collected_cash,
      COALESCE(SUM(card_amount), 0) as collected_card
    FROM money_ledger
    WHERE business_day = ?
      AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 
                   'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
  `).get(today);
  
  const refundTotal = db.prepare(`
    SELECT 
      COALESCE(SUM(ABS(amount)), 0) as refund_total,
      COALESCE(SUM(ABS(cash_amount)), 0) as refund_cash,
      COALESCE(SUM(ABS(card_amount)), 0) as refund_card
    FROM money_ledger
    WHERE business_day = ?
      AND type = 'SALE_CANCEL_REVERSE'
  `).get(today);
  
  console.log('Date:', today);
  console.log('Collected:', collected);
  console.log('Refunds:', refundTotal);
  console.log('Net total:', (collected.collected_total || 0) - (refundTotal.refund_total || 0));
  console.log('Net cash:', (collected.collected_cash || 0) - (refundTotal.refund_cash || 0));
  console.log('');
  
  // 8. Find presales with CANCELLED status
  console.log('=== 8. CANCELLED PRESALES ===');
  const cancelled = db.prepare(`
    SELECT id, status, payment_cash_amount, payment_card_amount, trip_date, created_at, updated_at
    FROM presales 
    WHERE status = 'CANCELLED'
    ORDER BY id DESC LIMIT 10
  `).all();
  if (cancelled.length === 0) {
    console.log('No cancelled presales found');
  } else {
    console.table(cancelled);
  }
  console.log('');
  
  // 9. Find tickets with REFUNDED status
  console.log('=== 9. REFUNDED TICKETS ===');
  const refunded = db.prepare(`
    SELECT id, presale_id, status, created_at, updated_at
    FROM tickets 
    WHERE status = 'REFUNDED'
    ORDER BY id DESC LIMIT 10
  `).all();
  if (refunded.length === 0) {
    console.log('No refunded tickets found');
  } else {
    console.table(refunded);
  }
  
  db.close();
  console.log('\n=== INVESTIGATION COMPLETE ===');
  
} catch (error) {
  console.error('ERROR:', error.message);
  process.exit(1);
}
