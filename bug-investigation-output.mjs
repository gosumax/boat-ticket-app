// This script outputs diagnostic data to a JSON file
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'database.sqlite');

const output = {
  timestamp: new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
  database_file: DB_FILE,
  dates: null,
  presales: [],
  tickets: [],
  money_ledger: [],
  refunds: [],
  transactions: [],
  owner_summary: null,
  cancelled_presales: [],
  refunded_tickets: [],
  detailed_presale: null,
  error: null
};

try {
  const db = new Database(DB_FILE, { readonly: true });
  
  // 1. DATE CONTEXT
  output.dates = db.prepare("SELECT DATE('now','localtime') as today, DATE('now','localtime','+1 day') as tomorrow").get();
  const today = output.dates.today;
  
  // 2. LAST 10 PRESALES
  output.presales = db.prepare(`
    SELECT id, slot_uid, trip_date, status, payment_cash_amount, payment_card_amount, 
           created_at, updated_at, seller_id
    FROM presales 
    ORDER BY id DESC LIMIT 10
  `).all();
  
  // 3. LAST 20 TICKETS
  output.tickets = db.prepare(`
    SELECT id, presale_id, status, created_at, updated_at
    FROM tickets 
    ORDER BY id DESC LIMIT 20
  `).all();
  
  // 4. LAST 50 MONEY_LEDGER ENTRIES
  output.money_ledger = db.prepare(`
    SELECT id, business_day, type, amount, cash_amount, card_amount, method, presale_id, created_at
    FROM money_ledger 
    ORDER BY id DESC LIMIT 50
  `).all();
  
  // 5. SALE_CANCEL_REVERSE ENTRIES
  output.refunds = db.prepare(`
    SELECT id, business_day, type, amount, cash_amount, card_amount, method, presale_id, created_at
    FROM money_ledger 
    WHERE type = 'SALE_CANCEL_REVERSE'
    ORDER BY id DESC LIMIT 20
  `).all();
  
  // 6. LAST 50 SALES_TRANSACTIONS_CANONICAL
  output.transactions = db.prepare(`
    SELECT id, business_day, trip_date, type, amount, cash_amount, card_amount, status, presale_id, created_at
    FROM sales_transactions_canonical 
    ORDER BY id DESC LIMIT 50
  `).all();
  
  // 7. OWNER MONEY SUMMARY FOR TODAY
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
  
  output.owner_summary = {
    date: today,
    collected,
    refunds: refundTotal,
    net_total: (collected.collected_total || 0) - (refundTotal.refund_total || 0),
    net_cash: (collected.collected_cash || 0) - (refundTotal.refund_cash || 0)
  };
  
  // 8. CANCELLED PRESALES
  output.cancelled_presales = db.prepare(`
    SELECT id, status, payment_cash_amount, payment_card_amount, trip_date, created_at, updated_at
    FROM presales 
    WHERE status = 'CANCELLED'
    ORDER BY id DESC LIMIT 10
  `).all();
  
  // 9. REFUNDED TICKETS
  output.refunded_tickets = db.prepare(`
    SELECT id, presale_id, status, created_at, updated_at
    FROM tickets 
    WHERE status = 'REFUNDED'
    ORDER BY id DESC LIMIT 10
  `).all();
  
  // 10. DETAILED ANALYSIS OF LAST CANCELLED PRESALE
  if (output.cancelled_presales.length > 0) {
    const lastCancelledId = output.cancelled_presales[0].id;
    
    output.detailed_presale = {
      id: lastCancelledId,
      presale: db.prepare(`SELECT * FROM presales WHERE id = ?`).get(lastCancelledId),
      tickets: db.prepare(`SELECT * FROM tickets WHERE presale_id = ?`).all(lastCancelledId),
      ledger: db.prepare(`
        SELECT id, business_day, type, amount, cash_amount, card_amount, method, created_at
        FROM money_ledger WHERE presale_id = ? ORDER BY id
      `).all(lastCancelledId),
      transactions: db.prepare(`
        SELECT id, business_day, trip_date, type, amount, cash_amount, card_amount, status, created_at
        FROM sales_transactions_canonical WHERE presale_id = ? ORDER BY id
      `).all(lastCancelledId)
    };
  }
  
  db.close();
  
} catch (error) {
  output.error = error.message;
}

// Write output to file
const outputPath = path.join(__dirname, 'bug-investigation-output.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
console.log('Output written to:', outputPath);
console.log(JSON.stringify(output, null, 2));
