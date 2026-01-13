import Database from 'better-sqlite3';

const DB_FILE = 'database.sqlite';

console.log('Testing database constraints...');

try {
  const db = new Database(DB_FILE);
  
  // Test 1: Try to insert a generated slot with invalid price (should fail)
  console.log('Test 1: Trying to insert generated slot with price_adult = 0 (should fail)...');
  try {
    const result = db.prepare(`
      INSERT INTO generated_slots 
      (schedule_template_id, trip_date, boat_id, time, capacity, seats_left, 
       duration_minutes, is_active, price_adult, price_child, price_teen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, '2026-01-06', 1, '10:00', 10, 10, 120, 1, 0, 100, 200);
    console.log('ERROR: Insert with invalid price should have failed but succeeded!');
  } catch (error) {
    console.log(`✓ Correctly blocked invalid price: ${error.message}`);
  }
  
  // Test 2: Try to insert a generated slot with invalid capacity (should fail)
  console.log('Test 2: Trying to insert generated slot with capacity = 0 (should fail)...');
  try {
    const result = db.prepare(`
      INSERT INTO generated_slots 
      (schedule_template_id, trip_date, boat_id, time, capacity, seats_left, 
       duration_minutes, is_active, price_adult, price_child, price_teen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, '2026-01-06', 1, '10:00', 0, 0, 120, 1, 3000, 100, 200);
    console.log('ERROR: Insert with invalid capacity should have failed but succeeded!');
  } catch (error) {
    console.log(`✓ Correctly blocked invalid capacity: ${error.message}`);
  }
  
  // Test 3: Try to insert a generated slot with invalid duration (should fail)
  console.log('Test 3: Trying to insert generated slot with duration_minutes = 0 (should fail)...');
  try {
    const result = db.prepare(`
      INSERT INTO generated_slots 
      (schedule_template_id, trip_date, boat_id, time, capacity, seats_left, 
       duration_minutes, is_active, price_adult, price_child, price_teen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, '2026-01-06', 1, '10:00', 10, 10, 0, 1, 3000, 100, 200);
    console.log('ERROR: Insert with invalid duration should have failed but succeeded!');
  } catch (error) {
    console.log(`✓ Correctly blocked invalid duration: ${error.message}`);
  }
  
  // Test 4: Try to insert a generated slot with invalid time format (should fail)
  console.log('Test 4: Trying to insert generated slot with invalid time format (should fail)...');
  try {
    const result = db.prepare(`
      INSERT INTO generated_slots 
      (schedule_template_id, trip_date, boat_id, time, capacity, seats_left, 
       duration_minutes, is_active, price_adult, price_child, price_teen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, '2026-01-06', 1, '25:00', 10, 10, 120, 1, 3000, 100, 200);
    console.log('ERROR: Insert with invalid time format should have failed but succeeded!');
  } catch (error) {
    console.log(`✓ Correctly blocked invalid time format: ${error.message}`);
  }
  
  // Test 5: Try to insert a valid generated slot (should succeed)
  console.log('Test 5: Trying to insert valid generated slot (should succeed)...');
  try {
    const result = db.prepare(`
      INSERT INTO generated_slots 
      (schedule_template_id, trip_date, boat_id, time, capacity, seats_left, 
       duration_minutes, is_active, price_adult, price_child, price_teen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, '2026-01-06', 1, '10:00', 10, 10, 120, 1, 3000, 100, 200);
    console.log('✓ Valid insert succeeded');
    
    // Clean up the test record
    db.prepare('DELETE FROM generated_slots WHERE trip_date = ? AND time = ? AND boat_id = ?', '2026-01-06', '10:00', 1).run();
    console.log('✓ Test record cleaned up');
  } catch (error) {
    console.log(`ERROR: Valid insert failed: ${error.message}`);
  }
  
  db.close();
  console.log('Constraint tests completed!');
  
} catch (error) {
  console.error('Test failed:', error);
}