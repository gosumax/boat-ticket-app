import Database from 'better-sqlite3';
const db = new Database('./database.sqlite');

console.log('=== SQLITE DATE CONTEXT ===');
const dates = db.prepare(`SELECT DATE('now','localtime') as today, DATE('now','localtime','+30 day') as plus30`).get();
console.log('SQLite dates:', dates);

// Test weekday calculation
const weekdayResult = db.prepare(`SELECT STRFTIME('%w', DATE('now','localtime')) as weekday`).get();
console.log('STRFTIME %w (0=Sunday):', weekdayResult.weekday);

// JavaScript weekday
const jsDate = new Date();
console.log('JS getDay() (0=Sunday):', jsDate.getDay());

// Test bit calculation
const jsDay = jsDate.getDay();
const dayOfWeek = jsDay === 0 ? 7 : jsDay;
const dayBit = Math.pow(2, dayOfWeek - 1);
console.log(`Day of week (1=Mon..7=Sun): ${dayOfWeek}`);
console.log(`Day bit (1<<${dayOfWeek-1}): ${dayBit}`);

// Check if template mask matches today
const templates = db.prepare('SELECT id, name, weekdays_mask FROM schedule_template_items WHERE is_active = 1').all();
console.log('\n=== TEMPLATE WEEKDAY CHECK ===');
for (const t of templates) {
  const matches = (t.weekdays_mask & dayBit) !== 0;
  console.log(`Template ${t.id} "${t.name}": mask=${t.weekdays_mask}, dayBit=${dayBit}, matches=${matches}`);
}

// Check boats
const boats = db.prepare('SELECT id, name, is_active FROM boats').all();
console.log('\n=== BOATS ===');
console.table(boats);

// Check generated_slots
const slotCount = db.prepare('SELECT COUNT(1) as c FROM generated_slots').get();
console.log('\n=== GENERATED_SLOTS ===');
console.log('Count:', slotCount.c);

// Check if schedule_templates table exists
const scheduleTemplatesTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schedule_templates'").get();
console.log('\n=== SCHEDULE_TEMPLATES TABLE ===');
console.log('Exists:', scheduleTemplatesTable ? true : false);

// Get schedule_templates data if exists
if (scheduleTemplatesTable) {
  const stData = db.prepare('SELECT * FROM schedule_templates').all();
  console.log('schedule_templates data:');
  console.table(stData);
}

// Check all tables
const allTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('\n=== ALL TABLES ===');
console.table(allTables);

db.close();
