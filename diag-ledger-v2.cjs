const Database = require('better-sqlite3');
const db = new Database('C:/boat-app/database.sqlite');
const d = '2026-02-21';

console.log('DAY=', d);
console.log('\n1) kind/status counts');
console.log(db.prepare(`
  SELECT kind, status, COUNT(*) c, SUM(amount) s 
  FROM money_ledger 
  WHERE business_day=? 
  GROUP BY kind, status 
  ORDER BY kind, status
`).all(d));

console.log('\n2) seller_shift by seller_id+status');
console.log(db.prepare(`
  SELECT seller_id, status, COUNT(*) c, SUM(amount) s 
  FROM money_ledger 
  WHERE business_day=? AND kind='SELLER_SHIFT' 
  GROUP BY seller_id, status 
  ORDER BY seller_id, status
`).all(d));

console.log('\n3) seller_shift seller_id NULL count');
console.log(db.prepare(`
  SELECT COUNT(*) c 
  FROM money_ledger 
  WHERE business_day=? AND kind='SELLER_SHIFT' AND seller_id IS NULL
`).get(d));

console.log('\n4) dispatcher_shift by seller_id+status');
console.log(db.prepare(`
  SELECT seller_id, status, COUNT(*) c, SUM(amount) s 
  FROM money_ledger 
  WHERE business_day=? AND kind='DISPATCHER_SHIFT' 
  GROUP BY seller_id, status 
  ORDER BY seller_id, status
`).all(d));

console.log('\n5) ALL rows for this day (sample)');
console.log(db.prepare(`
  SELECT * FROM money_ledger 
  WHERE business_day=? 
  LIMIT 20
`).all(d));
