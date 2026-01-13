import Database from 'better-sqlite3';

const DB_FILE = 'database.sqlite';

// Connect to the database
const db = new Database(DB_FILE);

try {
  console.log('Starting database migration: Updating boat_slots table schema...');

  // Check if the boat_slots table has the required columns
  const columns = db.prepare("PRAGMA table_info(boat_slots)").all();
  const columnNames = columns.map(col => col.name);

  console.log('Current boat_slots columns:', columnNames);

  // Check if we need to migrate by checking for missing columns
  const hasPriceAdult = columnNames.includes('price_adult');
  const hasPriceChild = columnNames.includes('price_child');
  const hasPriceTeen = columnNames.includes('price_teen');
  const hasCapacity = columnNames.includes('capacity');
  const hasSeatsLeft = columnNames.includes('seats_left');
  const hasDurationMinutes = columnNames.includes('duration_minutes');

  if (!hasCapacity || !hasSeatsLeft) {
    // Add missing columns that were added later
    if (!hasCapacity) {
      try {
        db.exec('ALTER TABLE boat_slots ADD COLUMN capacity INTEGER NOT NULL DEFAULT 12');
        console.log('Added capacity column');
      } catch (err) {
        console.log('Capacity column may already exist');
      }
    }
    
    if (!hasSeatsLeft) {
      try {
        db.exec('ALTER TABLE boat_slots ADD COLUMN seats_left INTEGER NOT NULL DEFAULT 12');
        console.log('Added seats_left column');
      } catch (err) {
        console.log('Seats_left column may already exist');
      }
    }
    
    if (!hasDurationMinutes) {
      try {
        db.exec('ALTER TABLE boat_slots ADD COLUMN duration_minutes INTEGER NULL');
        console.log('Added duration_minutes column');
      } catch (err) {
        console.log('Duration_minutes column may already exist');
      }
    }
    
    if (!hasPriceAdult) {
      try {
        db.exec('ALTER TABLE boat_slots ADD COLUMN price_adult INTEGER NULL');
        console.log('Added price_adult column');
      } catch (err) {
        console.log('Price_adult column may already exist');
      }
    }
    
    if (!hasPriceChild) {
      try {
        db.exec('ALTER TABLE boat_slots ADD COLUMN price_child INTEGER NULL');
        console.log('Added price_child column');
      } catch (err) {
        console.log('Price_child column may already exist');
      }
    }
    
    if (!hasPriceTeen) {
      try {
        db.exec('ALTER TABLE boat_slots ADD COLUMN price_teen INTEGER NULL');
        console.log('Added price_teen column');
      } catch (err) {
        console.log('Price_teen column may already exist');
      }
    }
  }

  // Now we need to recreate the table to make the price column nullable
  // First, check if price column is currently NOT NULL
  const priceColumn = columns.find(col => col.name === 'price');
  if (priceColumn && priceColumn.notnull === 1) {
    console.log('Recreating boat_slots table to make price column nullable...');
    
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
      SELECT id, boat_id, time, 
             CASE WHEN price IS NOT NULL THEN price ELSE NULL END,
             COALESCE(capacity, 12), 
             COALESCE(seats_left, 12), 
             duration_minutes, 
             is_active, 
             price_adult, 
             price_child, 
             price_teen
      FROM boat_slots
    `);

    // Step 3: Drop the old table
    db.exec('DROP TABLE boat_slots;');

    // Step 4: Rename the new table to the original name
    db.exec('ALTER TABLE boat_slots_new RENAME TO boat_slots;');

    // Commit transaction
    db.exec('COMMIT;');

    console.log('✅ Table recreation completed successfully!');
  } else {
    console.log('✅ Price column is already nullable or migration not needed');
  }

  console.log('✅ Migration completed successfully!');
  console.log('The boat_slots table now has the correct schema with nullable price column');
  
} catch (error) {
  // Rollback transaction in case of error
  try {
    db.exec('ROLLBACK;');
  } catch (rollbackError) {
    console.error('Rollback failed:', rollbackError.message);
  }
  
  console.error('❌ Migration failed:', error.message);
  console.error('Error details:', error);
} finally {
  db.close();
}