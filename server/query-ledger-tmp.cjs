const db = require('better-sqlite3')('../database.sqlite');

console.log('=== SALE_PREPAYMENT ledger entries ===');
const rows = db.prepare("SELECT id,business_day,kind,type,method,amount,status,seller_id,presale_id,slot_id,event_time FROM money_ledger WHERE type LIKE 'SALE_PREPAYMENT%' ORDER BY id DESC LIMIT 10").all();
console.log(JSON.stringify(rows, null, 2));
