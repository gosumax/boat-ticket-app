const Database = require('better-sqlite3');
const db = new Database('X:/database.sqlite');

console.log('=== Today ===');
console.log(db.prepare("SELECT DATE('now','localtime') AS today").get());

console.log('\n=== Generated slots with future trip_date ===');
const future = db.prepare(`
  SELECT id, trip_date, time, capacity, seats_left 
  FROM generated_slots 
  WHERE trip_date > DATE('now','localtime') 
    AND is_active = 1 
  ORDER BY trip_date 
  LIMIT 5
`).all();
console.log(future);

console.log('\n=== Today slots ===');
const today = db.prepare(`
  SELECT id, trip_date, time, capacity, seats_left 
  FROM generated_slots 
  WHERE trip_date = DATE('now','localtime') 
    AND is_active = 1 
  ORDER BY time 
  LIMIT 5
`).all();
console.log(today);
