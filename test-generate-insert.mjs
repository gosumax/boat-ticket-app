// Test generate slots logic directly
import Database from 'better-sqlite3';
const db = new Database('./database.sqlite');

console.log('=== TEST GENERATE SLOTS ===\n');

// Get dates
const dates = db.prepare("SELECT DATE('now','localtime') as today, DATE('now','localtime','+30 day') as plus30").get();
console.log('Date range:', dates.today, 'to', dates.plus30);

// Get active template items with schedule_template_id
const items = db.prepare(`
  SELECT sti.*, b.is_active as boat_is_active
  FROM schedule_template_items sti
  LEFT JOIN boats b ON sti.boat_id = b.id
  WHERE sti.is_active = 1
`).all();

console.log('\nActive template items:', items.length);
for (const item of items) {
  console.log(`  Item ${item.id}: schedule_template_id=${item.schedule_template_id}, boat_id=${item.boat_id}, boat_is_active=${item.boat_is_active}`);
}

// Test insert for first item
if (items.length > 0) {
  const item = items[0];
  const tripDate = dates.today;
  
  console.log('\nTesting INSERT for item', item.id, '...');
  
  try {
    const result = db.prepare(`
      INSERT INTO generated_slots (
        schedule_template_id, trip_date, boat_id, time, capacity, seats_left, 
        duration_minutes, is_active, price_adult, price_child, price_teen,
        seller_cutoff_minutes, dispatcher_cutoff_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.schedule_template_id,
      tripDate,
      item.boat_id,
      item.departure_time,
      item.capacity,
      item.capacity,
      item.duration_minutes,
      1,
      item.price_adult,
      item.price_child,
      item.price_teen,
      item.seller_cutoff_minutes || null,
      item.dispatcher_cutoff_minutes || null
    );
    
    console.log('SUCCESS! Inserted with id:', result.lastInsertRowid);
    
    // Verify
    const slot = db.prepare('SELECT id, schedule_template_id, trip_date, boat_id, time FROM generated_slots WHERE id = ?').get(result.lastInsertRowid);
    console.log('Created slot:', slot);
    
    // Clean up test slot
    db.prepare('DELETE FROM generated_slots WHERE id = ?').run(result.lastInsertRowid);
    console.log('Test slot cleaned up.');
    
  } catch (error) {
    console.error('ERROR:', error.message);
  }
}

db.close();
console.log('\n=== TEST COMPLETE ===');
