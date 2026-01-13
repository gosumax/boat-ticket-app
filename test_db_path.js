import Database from 'better-sqlite3';
import path from 'path';

// Test the database path resolution
const DB_FILE = path.resolve(process.cwd(), 'database.sqlite');
console.log('Current working directory:', process.cwd());
console.log('Resolved DB path:', DB_FILE);

try {
  const db = new Database(DB_FILE);
  console.log('Database opened successfully');
  
  // Test if boat_settings table exists
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='boat_settings'
  `).get();
  
  if (tableExists) {
    console.log('✅ boat_settings table exists');
    
    // Check if it has data
    const count = db.prepare('SELECT COUNT(*) as count FROM boat_settings').get();
    console.log(`boat_settings has ${count.count} rows`);
  } else {
    console.log('❌ boat_settings table does not exist');
  }
  
  db.close();
} catch (error) {
  console.error('Database error:', error.message);
}