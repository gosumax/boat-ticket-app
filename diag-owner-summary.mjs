// Simulate Owner Money Summary API response
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, 'database.sqlite'));

const today = db.prepare(`SELECT DATE('now','localtime') as d`).get().d;
const tomorrow = db.prepare(`SELECT DATE('now','localtime','+1 day') as d`).get().d;

console.log(`\n=== OWNER MONEY SUMMARY SIMULATION ===`);
console.log(`Today: ${today}, Tomorrow: ${tomorrow}\n`);

// Simulate /api/owner/money/summary?from=TODAY&to=TODAY
console.log(`=== 1. SUMMARY FOR TODAY (${today}) ===`);

// From money_ledger (payment date based)
const mlToday = db.prepare(`
  SELECT 
    SUM(CASE WHEN amount > 0 AND type NOT LIKE '%CANCEL%' THEN amount ELSE 0 END) as collected_total,
    SUM(CASE WHEN amount > 0 AND type NOT LIKE '%CANCEL%' AND method = 'CASH' THEN amount ELSE 0 END) as collected_cash,
    SUM(CASE WHEN amount > 0 AND type NOT LIKE '%CANCEL%' AND method = 'CARD' THEN amount ELSE 0 END) as collected_card,
    SUM(CASE WHEN amount < 0 AND type LIKE '%CANCEL%' THEN ABS(amount) ELSE 0 END) as refund_total,
    SUM(CASE WHEN amount < 0 AND type LIKE '%CANCEL%' AND method = 'CASH' THEN ABS(amount) ELSE 0 END) as refund_cash,
    SUM(CASE WHEN amount < 0 AND type LIKE '%CANCEL%' AND method = 'CARD' THEN ABS(amount) ELSE 0 END) as refund_card
  FROM money_ledger 
  WHERE business_day = ? AND kind = 'SELLER_SHIFT'
`).get(today);

console.log('Money Ledger (SELLER_SHIFT) for today:');
console.log(mlToday);

// From sales_transactions_canonical (trip date based)
const stcToday = db.prepare(`
  SELECT 
    SUM(amount) as revenue,
    SUM(cash_amount) as cash,
    SUM(card_amount) as card
  FROM sales_transactions_canonical 
  WHERE business_day = ? AND status = 'VALID'
`).get(today);
console.log('\nSales Transactions Canonical (VALID) for today:');
console.log(stcToday);

// paid_by_trip_day - tickets for trips TOMORROW but paid TODAY
const paidByTripDay = db.prepare(`
  SELECT 
    SUM(stc.amount) as revenue,
    SUM(stc.cash_amount) as cash,
    SUM(stc.card_amount) as card
  FROM sales_transactions_canonical stc
  JOIN presales p ON p.id = stc.presale_id
  WHERE stc.business_day = ? 
    AND stc.status = 'VALID'
`).get(today);
console.log('\npaid_by_trip_day (trips paid today):');
console.log(paidByTripDay);

console.log(`\n=== 2. SUMMARY FOR TOMORROW (${tomorrow}) ===`);

// From sales_transactions_canonical for trip date = tomorrow
const stcTomorrow = db.prepare(`
  SELECT 
    SUM(amount) as revenue,
    SUM(cash_amount) as cash,
    SUM(card_amount) as card
  FROM sales_transactions_canonical 
  WHERE business_day = ?
`).get(tomorrow);
console.log('Sales Transactions Canonical for tomorrow (trip date):');
console.log(stcTomorrow);

console.log('\n=== 3. PENDING AMOUNT (presales for tomorrow with partial payment) ===');
const pending = db.prepare(`
  SELECT 
    p.id,
    p.total_price,
    p.prepayment_amount,
    p.payment_cash_amount,
    p.payment_card_amount,
    p.status,
    (p.total_price - COALESCE(p.payment_cash_amount, 0) - COALESCE(p.payment_card_amount, 0)) as pending
  FROM presales p
  WHERE p.status NOT IN ('CANCELLED', 'REFUNDED')
    AND p.total_price > COALESCE(p.payment_cash_amount, 0) + COALESCE(p.payment_card_amount, 0)
`).all();
console.log('Presales with pending amount:');
console.table(pending);

// Check what "collected today" would show
console.log('\n=== 4. WHAT OWNER SEES AS "COLECTED TODAY" ===');

// According to the API logic, collected_total comes from money_ledger SELLER_SHIFT for business_day
const collectedFromML = db.prepare(`
  SELECT 
    business_day,
    type,
    method,
    SUM(amount) as total
  FROM money_ledger 
  WHERE kind = 'SELLER_SHIFT'
  GROUP BY business_day, type, method
  ORDER BY business_day DESC
  LIMIT 20
`).all();
console.log('Money Ledger SELLER_SHIFT by business_day:');
console.table(collectedFromML);

db.close();
