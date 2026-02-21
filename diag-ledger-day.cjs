const Database = require('better-sqlite3');
const db = new Database('D:/Проэкты/МОре/boat-ticket-app/database.sqlite');
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

console.log('\n6) NEW SQL - sellers with JOIN users (role=seller)');
console.log(db.prepare(`
  SELECT ml.seller_id AS seller_id, COALESCE(SUM(ml.amount),0) AS accepted
  FROM money_ledger ml
  JOIN users u ON u.id = ml.seller_id
  WHERE ml.business_day = ?
    AND ml.status = 'POSTED'
    AND ml.seller_id IS NOT NULL
    AND u.role = 'seller'
    AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
  GROUP BY ml.seller_id
`).all(d));

console.log('\n7) Users with role=seller');
console.log(db.prepare(`
  SELECT id, username, role FROM users WHERE role='seller'
`).all());

console.log('\n8) Users table (all)');
console.log(db.prepare(`
  SELECT id, username, role FROM users ORDER BY id
`).all());

console.log('\n9) Distribution by kind/seller_id/role');
console.log(db.prepare(`
  SELECT ml.kind, ml.seller_id, u.role, COUNT(*) c, SUM(ml.amount) s 
  FROM money_ledger ml 
  LEFT JOIN users u ON u.id=ml.seller_id 
  WHERE ml.business_day=? AND ml.status='POSTED' 
  GROUP BY ml.kind, ml.seller_id, u.role 
  ORDER BY ml.kind, ml.seller_id
`).all(d));
