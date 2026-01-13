import Database from 'better-sqlite3';

const DB_FILE = 'database.sqlite';

// Connect to the database
const db = new Database(DB_FILE);

try {
  console.log('Starting database migration: Making boat_slots.price column nullable...');

  // Begin transaction
  db.exec('BEGIN TRANSACTION;');

  // Step 1: Create the new table with nullable price column
  db.exec(`
    CREATE TABLE boat_slots_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_id INTEGER NOT NULL REFERENCES boats(id),
      time TEXT NOT NULL,
      price INTEGER NULL,  -- Changed from NOT NULL to NULL
      capacity INTEGER NOT NULL,
      seats_left INTEGER NOT NULL,
      duration_minutes INTEGER NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      price_adult INTEGER NULL,
      price_child INTEGER NULL,
      price_teen INTEGER NULL,
      UNIQUE(boat_id, time)
    )
  `);

  // Step 2: Copy data from the old table to the new table
  db.exec(`
    INSERT INTO boat_slots_new (id, boat_id, time, price, capacity, seats_left, duration_minutes, is_active, price_adult, price_child, price_teen)
    SELECT id, boat_id, time, price, capacity, seats_left, duration_minutes, is_active, price_adult, price_child, price_teen
    FROM boat_slots
  `);

  // Step 3: Drop the old table
  db.exec('DROP TABLE boat_slots;');

  // Step 4: Rename the new table to the original name
  db.exec('ALTER TABLE boat_slots_new RENAME TO boat_slots;');

  // Commit transaction
  db.exec('COMMIT;');

  console.log('✅ Migration completed successfully!');
  console.log('The boat_slots.price column is now nullable (INTEGER NULL)');
  
} catch (error) {
  // Rollback transaction in case of error
  try {
    db.exec('ROLLBACK;');
  } catch (rollbackError) {
    console.error('Rollback failed:', rollbackError.message);
  }
  
  console.error('❌ Migration failed:', error.message);
} finally {
  db.close();
}