// Migration: Fix FK constraint for generated_slots.schedule_template_id
import Database from 'better-sqlite3';
const db = new Database('./database.sqlite');

console.log('=== MIGRATION: Fix schedule_template FK ===\n');

// Step 1: Check if schedule_templates has records
const templateCount = db.prepare('SELECT COUNT(1) as c FROM schedule_templates').get();
console.log('Step 1: schedule_templates count:', templateCount.c);

// Step 2: Create default template if needed
let defaultTemplateId;
if (templateCount.c === 0) {
  // schedule_templates schema has: weekday (1-7), time, product_type, boat_id, capacity, price_adult, price_child, duration_minutes, is_active
  // weekday is a single day 1-7, not a bitmask
  const result = db.prepare(`
    INSERT INTO schedule_templates (weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, price_teen, duration_minutes, is_active)
    VALUES (1, '00:00', 'speed', NULL, 'speed', 12, 0, 0, NULL, 120, 1)
  `).run();
  defaultTemplateId = result.lastInsertRowid;
  console.log('Step 2: Created default schedule_template with id:', defaultTemplateId);
} else {
  const firstTemplate = db.prepare('SELECT id FROM schedule_templates LIMIT 1').get();
  defaultTemplateId = firstTemplate.id;
  console.log('Step 2: Using existing schedule_template id:', defaultTemplateId);
}

// Step 3: Check if schedule_template_items has schedule_template_id column
const stiColumns = db.prepare('PRAGMA table_info(schedule_template_items)').all();
const hasScheduleTemplateId = stiColumns.some(col => col.name === 'schedule_template_id');
console.log('Step 3: schedule_template_items has schedule_template_id column:', hasScheduleTemplateId);

// Step 4: Add column if missing
if (!hasScheduleTemplateId) {
  db.prepare(`ALTER TABLE schedule_template_items ADD COLUMN schedule_template_id INTEGER REFERENCES schedule_templates(id)`).run();
  console.log('Step 4: Added schedule_template_id column to schedule_template_items');
} else {
  console.log('Step 4: Column already exists, skipping');
}

// Step 5: Update existing items to reference the default template
const updateResult = db.prepare(`UPDATE schedule_template_items SET schedule_template_id = ? WHERE schedule_template_id IS NULL`).run(defaultTemplateId);
console.log('Step 5: Updated', updateResult.changes, 'schedule_template_items rows');

// Step 6: Verify
const items = db.prepare('SELECT id, name, schedule_template_id FROM schedule_template_items').all();
console.log('\nStep 6: Verification - schedule_template_items:');
console.table(items);

const templates = db.prepare('SELECT id FROM schedule_templates').all();
console.log('\nschedule_templates:');
console.table(templates);

db.close();
console.log('\n=== MIGRATION COMPLETE ===');
