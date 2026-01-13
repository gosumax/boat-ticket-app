const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'server', 'database.sqlite');

if (fs.existsSync(dbPath)) {
  const db = new Database(dbPath);
  console.log('=== Generated Slots (Active) ===');
  try {
    const genSlots = db.prepare('SELECT id, trip_date, is_active, boat_id FROM generated_slots WHERE is_active=1 ORDER BY trip_date DESC LIMIT 20').all();
    console.log(JSON.stringify(genSlots, null, 2));
  } catch (error) {
    console.error('Error querying generated_slots:', error.message);
  }
  
  console.log('\n=== Current Date ===');
  try {
    const today = db.prepare("SELECT date('now') as db_today").get();
    console.log(today);
  } catch (error) {
    console.error('Error getting current date:', error.message);
  }
  
  console.log('\n=== Manual Slots (Active) ===');
  try {
    const manualSlots = db.prepare('SELECT id, is_active, boat_id, capacity, seats_left FROM boat_slots WHERE is_active=1 LIMIT 10').all();
    console.log(JSON.stringify(manualSlots, null, 2));
  } catch (error) {
    console.error('Error querying boat_slots:', error.message);
  }
  
  db.close();
} else {
  console.log('Database file not found at:', dbPath);
  console.log('Server directory exists:', fs.existsSync(path.join(__dirname, 'server')));
  if (fs.existsSync(path.join(__dirname, 'server'))) {
    console.log('Files:', fs.readdirSync(path.join(__dirname, 'server')));
  }
}