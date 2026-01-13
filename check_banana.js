import Database from 'better-sqlite3';
const db = new Database('database.sqlite');

// Check if the price columns exist in boat_slots table
const columns = db.prepare('PRAGMA table_info(boat_slots)').all();
console.log('boat_slots columns:', columns.map(c => ({ name: c.name, type: c.type })));

// Check if any boats have type 'banana'
const bananaBoats = db.prepare('SELECT * FROM boats WHERE type = "banana" LIMIT 3').all();
console.log('Existing banana boats:', bananaBoats);

// Check if there are any slots for banana type
const bananaSlots = db.prepare(`
  SELECT bs.*, b.type as boat_type 
  FROM boat_slots bs 
  JOIN boats b ON bs.boat_id = b.id 
  WHERE b.type = "banana" 
  LIMIT 3
`).all();
console.log('Existing banana slots:', bananaSlots);

console.log('Schema check completed.');