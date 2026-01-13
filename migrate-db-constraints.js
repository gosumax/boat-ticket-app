import Database from 'better-sqlite3';

const DB_FILE = 'database.sqlite';

console.log('Starting database constraints migration (Phase 2)...');

try {
  // Connect to database
  const db = new Database(DB_FILE);
  
  // Check if this migration was already applied by checking for a specific setting
  const migrationCheck = db.prepare("SELECT COUNT(*) as count FROM settings WHERE key = 'db_constraints_v2'").get();
  
  if (migrationCheck.count > 0) {
    console.log('Database constraints migration already applied, skipping...');
    db.close();
    process.exit(0);
  }
  
  console.log('Applying database constraints migration...');
  
  // Check for any existing bad data before applying constraints
  console.log('Checking for existing bad data...');
  
  // Check for bad prices in generated_slots
  const badGeneratedSlots = db.prepare(`
    SELECT id, price_adult, price_child, price_teen, capacity, duration_minutes, trip_date, time
    FROM generated_slots 
    WHERE price_adult <= 0 OR capacity <= 0 OR duration_minutes <= 0
  `).all();
  
  if (badGeneratedSlots.length > 0) {
    console.log(`Found ${badGeneratedSlots.length} bad generated slots with invalid prices/capacity/duration:`);
    badGeneratedSlots.forEach(row => {
      console.log(`  ID ${row.id}: price_adult=${row.price_adult}, capacity=${row.capacity}, duration=${row.duration_minutes}, date=${row.trip_date}, time=${row.time}`);
    });
  } else {
    console.log('No bad data found in generated_slots');
  }
  
  // Create triggers to enforce constraints at the database level
  console.log('Creating triggers to enforce constraints...');
  
  // Trigger for INSERT on generated_slots to validate prices and capacity
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS validate_generated_slots_insert 
    BEFORE INSERT ON generated_slots
    FOR EACH ROW 
    BEGIN
      SELECT CASE
        WHEN NEW.price_adult <= 0 THEN 
          RAISE(ABORT, 'price_adult must be greater than 0')
        WHEN NEW.capacity <= 0 THEN 
          RAISE(ABORT, 'capacity must be greater than 0')
        WHEN NEW.duration_minutes <= 0 THEN 
          RAISE(ABORT, 'duration_minutes must be greater than 0')
        WHEN length(NEW.trip_date) != 10 THEN 
          RAISE(ABORT, 'trip_date must be in YYYY-MM-DD format (10 chars)')
        WHEN length(NEW.time) != 5 THEN 
          RAISE(ABORT, 'time must be in HH:MM format (5 chars)')
        WHEN NEW.is_active NOT IN (0, 1) THEN 
          RAISE(ABORT, 'is_active must be 0 or 1')
        WHEN NEW.price_child < 0 THEN 
          RAISE(ABORT, 'price_child must be greater than or equal to 0')
        WHEN NEW.price_teen IS NOT NULL AND NEW.price_teen < 0 THEN 
          RAISE(ABORT, 'price_teen must be greater than or equal to 0')
      END;
    END
  `);
  
  // Trigger for UPDATE on generated_slots to validate prices and capacity
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS validate_generated_slots_update 
    BEFORE UPDATE ON generated_slots
    FOR EACH ROW 
    BEGIN
      SELECT CASE
        WHEN NEW.price_adult <= 0 THEN 
          RAISE(ABORT, 'price_adult must be greater than 0')
        WHEN NEW.capacity <= 0 THEN 
          RAISE(ABORT, 'capacity must be greater than 0')
        WHEN NEW.duration_minutes <= 0 THEN 
          RAISE(ABORT, 'duration_minutes must be greater than 0')
        WHEN length(NEW.trip_date) != 10 THEN 
          RAISE(ABORT, 'trip_date must be in YYYY-MM-DD format (10 chars)')
        WHEN length(NEW.time) != 5 THEN 
          RAISE(ABORT, 'time must be in HH:MM format (5 chars)')
        WHEN NEW.is_active NOT IN (0, 1) THEN 
          RAISE(ABORT, 'is_active must be 0 or 1')
        WHEN NEW.price_child < 0 THEN 
          RAISE(ABORT, 'price_child must be greater than or equal to 0')
        WHEN NEW.price_teen IS NOT NULL AND NEW.price_teen < 0 THEN 
          RAISE(ABORT, 'price_teen must be greater than or equal to 0')
      END;
    END
  `);
  
  // Create unique index to prevent duplicate trips
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_slots_unique ON generated_slots(trip_date, time, boat_id)');
  
  // Create additional indexes for performance
  db.exec('CREATE INDEX IF NOT EXISTS idx_generated_slots_boat_date ON generated_slots(boat_id, trip_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_generated_slots_template ON generated_slots(schedule_template_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_generated_slots_active ON generated_slots(is_active)');
  
  console.log('Database constraints applied successfully!');
  
  // Mark that this migration was applied
  db.prepare("INSERT INTO settings (key, value) VALUES ('db_constraints_v2', 'true')").run();
  console.log('Migration marked as completed');
  
  // Test the constraints
  console.log('Testing constraints...');
  try {
    // This should fail
    db.prepare('INSERT INTO generated_slots (schedule_template_id, trip_date, boat_id, time, capacity, seats_left, duration_minutes, price_adult, price_child, price_teen, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(1, '2026-01-05', 1, '10:00', 10, 10, 120, 0, 0, 0, 1); // price_adult = 0 should fail
    console.log('ERROR: Constraint did not fire!');
  } catch (error) {
    console.log(`✓ Constraint correctly blocked invalid data: ${error.message}`);
  }
  
  // Clean up the test row if it was somehow inserted
  try {
    db.prepare('DELETE FROM generated_slots WHERE price_adult = 0').run();
  } catch (e) {
    // Ignore if deletion fails
  }
  
  db.close();
  console.log('Database constraints migration completed successfully!');
  
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}