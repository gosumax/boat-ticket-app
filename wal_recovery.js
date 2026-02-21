import Database from 'better-sqlite3';
import fs from 'fs';

console.log('=== BACKUP FILE CHECK ===');

const backupFiles = [
  'database.sqlite',
  'database.sqlite.RESTORE',
  'database.sqlite.BACKUP_NOW',
  'database.sqlite.BACKUP_REFUND_BUG',
  'database.sqlite.CURRENT_STATE_19_02',
];

for (const file of backupFiles) {
  console.log(`\n--- Checking ${file} ---`);
  if (!fs.existsSync(file)) {
    console.log('  NOT FOUND');
    continue;
  }
  
  const stat = fs.statSync(file);
  console.log('  Size:', stat.size, 'bytes');
  console.log('  Modified:', stat.mtime);
  
  try {
    const db = new Database(file, { readonly: true });
    console.log('  Open: OK');
    
    try {
      const integrity = db.pragma('integrity_check');
      if (integrity[0] && integrity[0].integrity_check === 'ok') {
        console.log('  Integrity: OK');
      } else {
        console.log('  Integrity:', JSON.stringify(integrity));
      }
    } catch (e) {
      console.log('  Integrity: FAILED -', e.message);
    }
    
    // Count rows in key tables
    const tables = ['users', 'boats', 'generated_slots', 'presales', 'money_ledger'];
    console.log('  Row counts:');
    for (const table of tables) {
      try {
        const result = db.prepare(`SELECT COUNT(1) as c FROM ${table}`).get();
        console.log(`    ${table}: ${result.c}`);
      } catch (e) {
        console.log(`    ${table}: ERROR`);
      }
    }
    
    db.close();
  } catch (err) {
    console.log('  Open: FAILED -', err.message);
  }
}

console.log('\n=== CHECK COMPLETE ===');
