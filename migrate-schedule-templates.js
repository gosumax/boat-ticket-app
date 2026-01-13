import Database from 'better-sqlite3';
import fs from 'fs';

const DB_FILE = 'database.sqlite';

console.log('Starting schedule templates migration...');

try {
  // Connect to database
  const db = new Database(DB_FILE);
  
  // 1. Check if the new schedule_template_items table exists
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='schedule_template_items'
  `).get();

  if (!tableExists) {
    console.log('Creating schedule_template_items table...');
    
    // Create the new schedule_template_items table
    db.exec(`
      CREATE TABLE schedule_template_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        boat_id INTEGER REFERENCES boats(id),
        boat_type TEXT,
        type TEXT NOT NULL CHECK(type IN ('speed', 'cruise', 'banana')),
        departure_time TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        capacity INTEGER NOT NULL,
        price_adult INTEGER NOT NULL,
        price_child INTEGER NOT NULL,
        price_teen INTEGER,
        weekdays_mask INTEGER NOT NULL DEFAULT 0, -- bitmask for weekdays (mon=1, tue=2, wed=4, thu=8, fri=16, sat=32, sun=64)
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('Created schedule_template_items table');
  } else {
    console.log('schedule_template_items table already exists');
  }

  // Check if weekdays_mask column exists in schedule_template_items
  const columns = db.prepare("PRAGMA table_info(schedule_template_items)").all();
  const hasWeekdaysMask = columns.some(col => col.name === 'weekdays_mask');
  
  if (!hasWeekdaysMask) {
    console.log('Adding weekdays_mask column to schedule_template_items...');
    db.exec('ALTER TABLE schedule_template_items ADD COLUMN weekdays_mask INTEGER NOT NULL DEFAULT 0');
    console.log('Added weekdays_mask column');
  }

  // 2. Check if the old schedule_templates table exists
  let oldTableExists = false;
  try {
    const oldTableCheck = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='schedule_templates'
    `).get();
    oldTableExists = !!oldTableCheck;
  } catch (err) {
    console.log('Error checking for old schedule_templates table:', err.message);
    oldTableExists = false;  // If there's an error checking, assume table doesn't exist
  }
  
  if (oldTableExists) {
    console.log('Found old schedule_templates table, checking for data to migrate...');
    
    // Migrate existing schedule_templates data to schedule_template_items
    const existingTemplates = db.prepare(`
      SELECT 
        id, weekday, time, product_type, boat_id, boat_type, capacity, 
        price_adult, price_child, price_teen, duration_minutes, is_active
      FROM schedule_templates
      ORDER BY id
    `).all();
    
    if (existingTemplates.length > 0) {
      console.log(`Found ${existingTemplates.length} existing schedule templates to migrate`);
      
      // Group templates by their common properties (excluding weekday)
      const groupedTemplates = {};
      
      for (const template of existingTemplates) {
        // Create a key based on all properties except weekday
        const key = `${template.boat_id || 'null'}-${template.product_type}-${template.time}-${template.duration_minutes}-${template.capacity}-${template.price_adult}-${template.price_child}-${template.price_teen || 'null'}-${template.is_active}`;
        
        if (!groupedTemplates[key]) {
          groupedTemplates[key] = {
            name: `Template for ${template.product_type} at ${template.time}`,
            boat_id: template.boat_id,
            boat_type: template.boat_type,
            type: template.product_type,
            departure_time: template.time,
            duration_minutes: template.duration_minutes,
            capacity: template.capacity,
            price_adult: template.price_adult,
            price_child: template.price_child,
            price_teen: template.price_teen,
            is_active: template.is_active,
            weekdays_mask: 0,
            original_templates: []
          };
        }
        
        // Add the weekday to the mask (weekday: 1=Monday, 7=Sunday)
        const dayBit = Math.pow(2, template.weekday - 1); // 1=Monday=2^0=1, 2=Tuesday=2^1=2, etc.
        groupedTemplates[key].weekdays_mask |= dayBit;
        groupedTemplates[key].original_templates.push(template);
      }
      
      console.log(`Grouped into ${Object.keys(groupedTemplates).length} unique template items`);
      
      // Check if new table already has items (migration already run)
      const existingItemsCount = db.prepare('SELECT COUNT(*) as count FROM schedule_template_items').get().count;
      
      if (existingItemsCount === 0) {
        // Insert the grouped templates into the new table
        const insertStmt = db.prepare(`
          INSERT INTO schedule_template_items 
          (name, boat_id, boat_type, type, departure_time, duration_minutes, capacity, 
           price_adult, price_child, price_teen, weekdays_mask, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        let migratedCount = 0;
        for (const key in groupedTemplates) {
          const item = groupedTemplates[key];
          insertStmt.run(
            item.name,
            item.boat_id,
            item.boat_type,
            item.type,
            item.departure_time,
            item.duration_minutes,
            item.capacity,
            item.price_adult,
            item.price_child,
            item.price_teen,
            item.weekdays_mask,
            item.is_active
          );
          migratedCount++;
        }
        
        console.log(`Migrated ${migratedCount} template items to new structure`);
        console.log('Migration completed successfully!');
      } else {
        console.log(`New table already has ${existingItemsCount} items, skipping migration (idempotent operation)`);
      }
    } else {
      console.log('No existing schedule templates found to migrate');
    }
  } else {
    console.log('No old schedule_templates table found - fresh database or already migrated');
    console.log('New table schedule_template_items is ready for use');
  }

  // 3. Create a view to maintain backward compatibility if needed
  console.log('Creating backward compatibility view...');
  
  // Drop the view if it exists
  try {
    db.exec('DROP VIEW IF EXISTS schedule_templates_compat');
  } catch (e) {
    // Ignore error if view doesn't exist
  }
  
  // Create a view that expands the new structure back to the old format
  db.exec(`
    CREATE VIEW schedule_templates_compat AS
    SELECT 
      sti.id * 1000 + 1 AS id,  -- Create unique IDs for each weekday
      1 AS weekday,
      sti.departure_time AS time,
      sti.type AS product_type,
      sti.boat_id,
      sti.boat_type,
      sti.capacity,
      sti.is_active,
      sti.price_adult,
      sti.price_child,
      sti.price_teen,
      sti.duration_minutes,
      sti.created_at,
      sti.updated_at
    FROM schedule_template_items sti
    WHERE (sti.weekdays_mask & 1) != 0  -- Monday
    
    UNION ALL
    
    SELECT 
      sti.id * 1000 + 2 AS id,
      2 AS weekday,
      sti.departure_time AS time,
      sti.type AS product_type,
      sti.boat_id,
      sti.boat_type,
      sti.capacity,
      sti.is_active,
      sti.price_adult,
      sti.price_child,
      sti.price_teen,
      sti.duration_minutes,
      sti.created_at,
      sti.updated_at
    FROM schedule_template_items sti
    WHERE (sti.weekdays_mask & 2) != 0  -- Tuesday
    
    UNION ALL
    
    SELECT 
      sti.id * 1000 + 3 AS id,
      3 AS weekday,
      sti.departure_time AS time,
      sti.type AS product_type,
      sti.boat_id,
      sti.boat_type,
      sti.capacity,
      sti.is_active,
      sti.price_adult,
      sti.price_child,
      sti.price_teen,
      sti.duration_minutes,
      sti.created_at,
      sti.updated_at
    FROM schedule_template_items sti
    WHERE (sti.weekdays_mask & 4) != 0  -- Wednesday
    
    UNION ALL
    
    SELECT 
      sti.id * 1000 + 4 AS id,
      4 AS weekday,
      sti.departure_time AS time,
      sti.type AS product_type,
      sti.boat_id,
      sti.boat_type,
      sti.capacity,
      sti.is_active,
      sti.price_adult,
      sti.price_child,
      sti.price_teen,
      sti.duration_minutes,
      sti.created_at,
      sti.updated_at
    FROM schedule_template_items sti
    WHERE (sti.weekdays_mask & 8) != 0  -- Thursday
    
    UNION ALL
    
    SELECT 
      sti.id * 1000 + 5 AS id,
      5 AS weekday,
      sti.departure_time AS time,
      sti.type AS product_type,
      sti.boat_id,
      sti.boat_type,
      sti.capacity,
      sti.is_active,
      sti.price_adult,
      sti.price_child,
      sti.price_teen,
      sti.duration_minutes,
      sti.created_at,
      sti.updated_at
    FROM schedule_template_items sti
    WHERE (sti.weekdays_mask & 16) != 0  -- Friday
    
    UNION ALL
    
    SELECT 
      sti.id * 1000 + 6 AS id,
      6 AS weekday,
      sti.departure_time AS time,
      sti.type AS product_type,
      sti.boat_id,
      sti.boat_type,
      sti.capacity,
      sti.is_active,
      sti.price_adult,
      sti.price_child,
      sti.price_teen,
      sti.duration_minutes,
      sti.created_at,
      sti.updated_at
    FROM schedule_template_items sti
    WHERE (sti.weekdays_mask & 32) != 0  -- Saturday
    
    UNION ALL
    
    SELECT 
      sti.id * 1000 + 7 AS id,
      7 AS weekday,
      sti.departure_time AS time,
      sti.type AS product_type,
      sti.boat_id,
      sti.boat_type,
      sti.capacity,
      sti.is_active,
      sti.price_adult,
      sti.price_child,
      sti.price_teen,
      sti.duration_minutes,
      sti.created_at,
      sti.updated_at
    FROM schedule_template_items sti
    WHERE (sti.weekdays_mask & 64) != 0  -- Sunday
  `);
  
  console.log('Backward compatibility view created');

  console.log('Schedule templates migration completed successfully!');
  console.log('New table: schedule_template_items with weekdays_mask support');
  console.log('Backward compatibility: schedule_templates_compat view available');

  db.close();
  console.log('Migration script completed successfully!');

} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}