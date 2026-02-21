import Database from 'better-sqlite3';
const db = new Database('./database.sqlite', {readonly:true});

const today = '2026-02-19';
const fromExpr = `'${today}'`;
const toExpr = `'${today}'`;

console.log('=== OWNER MONEY SUMMARY SIMULATION ===');
console.log('Date range:', today, 'to', today);
console.log('');

// Collected total (from owner.mjs lines 153-162)
const collectedTotalRow = db.prepare(`
  SELECT COALESCE(SUM(amount), 0) AS collected_total
  FROM money_ledger
  WHERE status = 'POSTED'
    AND kind = 'SELLER_SHIFT'
    AND type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
    AND DATE(business_day) BETWEEN ${fromExpr} AND ${toExpr}
`).get();

console.log('COLLECTED TOTAL:', collectedTotalRow.collected_total);

// Cash/Card split (owner.mjs lines 200-240)
// Since money_ledger doesn't have cash_amount/card_amount, use method
const collectedRow = db.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN method = 'CASH' THEN amount ELSE 0 END), 0) AS collected_cash,
    COALESCE(SUM(CASE WHEN method = 'CARD' THEN amount ELSE 0 END), 0) AS collected_card
  FROM money_ledger ml
  WHERE ml.status = 'POSTED'
    AND ml.kind = 'SELLER_SHIFT'
    AND ml.type IN ('SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD', 'SALE_PREPAYMENT_MIXED', 'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED')
    AND DATE(ml.business_day) BETWEEN ${fromExpr} AND ${toExpr}
`).get();

console.log('COLLECTED CASH:', collectedRow.collected_cash);
console.log('COLLECTED CARD:', collectedRow.collected_card);

// Refund total (owner.mjs lines 566-648)
const refundRow = db.prepare(`
  SELECT COALESCE(SUM(ABS(amount)), 0) AS refund_total
  FROM money_ledger
  WHERE status = 'POSTED'
    AND kind = 'SELLER_SHIFT'
    AND type = 'SALE_CANCEL_REVERSE'
    AND DATE(business_day) BETWEEN ${fromExpr} AND ${toExpr}
`).get();

console.log('REFUND TOTAL:', refundRow.refund_total);

// Refund cash/card split
const refundSplitRow = db.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN method = 'CASH' THEN ABS(amount) ELSE 0 END), 0) AS refund_cash,
    COALESCE(SUM(CASE WHEN method = 'CARD' THEN ABS(amount) ELSE 0 END), 0) AS refund_card
  FROM money_ledger ml
  WHERE ml.status = 'POSTED'
    AND ml.kind = 'SELLER_SHIFT'
    AND ml.type = 'SALE_CANCEL_REVERSE'
    AND DATE(ml.business_day) BETWEEN ${fromExpr} AND ${toExpr}
`).get();

console.log('REFUND CASH:', refundSplitRow.refund_cash);
console.log('REFUND CARD:', refundSplitRow.refund_card);

// Net
const netTotal = collectedTotalRow.collected_total - refundRow.refund_total;
const netCash = collectedRow.collected_cash - refundSplitRow.refund_cash;
const netCard = collectedRow.collected_card - refundSplitRow.refund_card;

console.log('');
console.log('=== FINAL VALUES (what Owner UI should show) ===');
console.log('collected_total:', collectedTotalRow.collected_total);
console.log('collected_cash:', collectedRow.collected_cash);
console.log('collected_card:', collectedRow.collected_card);
console.log('refund_total:', refundRow.refund_total);
console.log('refund_cash:', refundSplitRow.refund_cash);
console.log('refund_card:', refundSplitRow.refund_card);
console.log('net_total:', netTotal);
console.log('net_cash:', netCash);
console.log('net_card:', netCard);

// Check for EXPECT_PAYMENT entries that are NOT counted
console.log('');
console.log('=== ADDITIONAL ENTRIES (NOT counted in Owner summary) ===');
const expectPaymentRefunds = db.prepare(`
  SELECT id, business_day, kind, type, amount, presale_id
  FROM money_ledger
  WHERE type = 'SALE_CANCEL_REVERSE'
    AND kind != 'SELLER_SHIFT'
`).all();

if (expectPaymentRefunds.length > 0) {
  console.log('REFUNDS with kind != SELLER_SHIFT (NOT counted):');
  console.table(expectPaymentRefunds);
} else {
  console.log('No additional refund entries');
}
