import Database from 'better-sqlite3';

const DB_FILE = './database.sqlite';

console.log('Testing new schedule template items table...');

try {
  const db = new Database(DB_FILE);
  console.log('✓ Database connection successful');
  
  // Check if schedule_template_items table exists
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table';").all();
  console.log('All tables:', tables.map(t => t.name));
  
  // Check if schedule_template_items exists
  const scheduleTemplateItemsTable = tables.find(t => t.name === 'schedule_template_items');
  if (scheduleTemplateItemsTable) {
    console.log('✓ schedule_template_items table exists');
    
    // Check columns
    const columns = db.prepare("PRAGMA table_info(schedule_template_items);").all();
    console.log('schedule_template_items columns:', columns.map(c => c.name));
    
    // Check if weekdays_mask column exists
    const weekdaysMaskColumn = columns.find(c => c.name === 'weekdays_mask');
    if (weekdaysMaskColumn) {
      console.log('✓ weekdays_mask column exists in schedule_template_items');
    } else {
      console.log('✗ weekdays_mask column missing in schedule_template_items');
    }
  } else {
    console.log('✗ schedule_template_items table does not exist');
  }
  
  // Check if schedule_templates table exists
  const scheduleTemplatesTable = tables.find(t => t.name === 'schedule_templates');
  if (scheduleTemplatesTable) {
    console.log('✓ schedule_templates table exists');
  } else {
    console.log('✗ schedule_templates table does not exist');
  }
  
  // Check if generated_slots table exists
  const generatedSlotsTable = tables.find(t => t.name === 'generated_slots');
  if (generatedSlotsTable) {
    console.log('✓ generated_slots table exists');
  } else {
    console.log('✗ generated_slots table does not exist');
  }
  
  // Check if schedule_templates_compat view exists
  const views = db.prepare("SELECT name FROM sqlite_master WHERE type='view';").all();
  console.log('Views:', views.map(v => v.name));
  
  const compatView = views.find(v => v.name === 'schedule_templates_compat');
  if (compatView) {
    console.log('✓ schedule_templates_compat view exists');
  } else {
    console.log('✗ schedule_templates_compat view does not exist');
  }
  
  console.log('\nDatabase schema check completed!');
  
} catch (error) {
  console.error('Database test failed:', error);
}