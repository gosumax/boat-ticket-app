import Database from 'better-sqlite3';
const db = new Database('./database.sqlite', {readonly:true});

const today = '2026-02-19';

// Exact query from owner.mjs
const refund = db.prepare(`
  SELECT COALESCE(SUM(ABS(amount)), 0) AS refund_total
  FROM money_ledger
  WHERE status = ?
    AND kind = ?
    AND type = ?
    AND DATE(business_day) = ?
`).get('POSTED', 'SELLER_SHIFT', 'SALE_CANCEL_REVERSE', today);

console.log('Owner API refund query (SELLER_SHIFT only):', JSON.stringify(refund));

// All SALE_CANCEL_REVERSE entries
const allRefunds = db.prepare(`
  SELECT id, business_day, kind, type, amount, status
  FROM money_ledger 
  WHERE type = 'SALE_CANCEL_REVERSE'
`).all();

console.log('\nAll SALE_CANCEL_REVERSE entries:');
console.table(allRefunds);

// Also check collected total
const collected = db.prepare(`
  SELECT COALESCE(SUM(amount), 0) AS collected_total
  FROM money_ledger
  WHERE status = ?
    AND kind = ?
    AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
    AND DATE(business_day) = ?
`).get('POSTED', 'SELLER_SHIFT', today);

console.log('\nOwner API collected query:', JSON.stringify(collected));

console.log('\nNet total should be:', collected.collected_total - refund.refund_total);
