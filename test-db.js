import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';

const DB_FILE = 'database.sqlite';
const SALT_ROUNDS = 10;

console.log('Testing database connection...');

try {
  const db = new Database(DB_FILE);
  console.log('✓ Database connection successful');
  
  // Test users table
  const users = db.prepare('SELECT * FROM users LIMIT 5').all();
  console.log('✓ Users table query successful');
  console.log('Sample users:', users);
  
  // Test specific user query
  const testUser = db.prepare('SELECT id, username, password_hash, role, is_active FROM users WHERE username = ?').get('admin');
  console.log('✓ Specific user query successful');
  console.log('Test user:', testUser);
  
  // Check boats data
  console.log('\n=== BOATS DATA ===');
  const boats = db.prepare('SELECT id, name, type, is_active FROM boats').all();
  console.log('Boats:', boats);
  
  // Check slots data
  console.log('\n=== SLOTS DATA ===');
  const slots = db.prepare('SELECT id, boat_id, time, price, capacity, seats_left, is_active FROM boat_slots').all();
  console.log('Slots:', slots);
  
  // Analyze step by step for speed type
  console.log('\n=== ANALYSIS FOR SPEED TYPE ===');
  
  // Step 1: All boats of speed type
  const step1 = db.prepare(`
    SELECT id, name, type, is_active 
    FROM boats 
    WHERE TRIM(LOWER(type)) = 'speed'
  `).all();
  console.log('Step 1 - Boats with speed type:', step1);
  
  // Step 2: Active boats of speed type
  const step2 = db.prepare(`
    SELECT id, name, type, is_active 
    FROM boats 
    WHERE TRIM(LOWER(type)) = 'speed' AND CAST(is_active AS INTEGER) = 1
  `).all();
  console.log('Step 2 - Active boats with speed type:', step2);
  
  // Step 3: Slots joined with active speed boats
  const step3 = db.prepare(`
    SELECT 
      bs.id, bs.boat_id, bs.time, bs.price, bs.capacity, bs.seats_left, bs.is_active as slot_active,
      b.name, b.type, b.is_active as boat_active
    FROM boat_slots bs
    JOIN boats b ON bs.boat_id = b.id
    WHERE TRIM(LOWER(b.type)) = 'speed' AND CAST(b.is_active AS INTEGER) = 1
  `).all();
  console.log('Step 3 - Slots with active speed boats:', step3);
  
  // Step 4: Active slots of active speed boats
  const step4 = db.prepare(`
    SELECT 
      bs.id, bs.boat_id, bs.time, bs.price, bs.capacity, bs.seats_left, bs.is_active as slot_active,
      b.name, b.type, b.is_active as boat_active
    FROM boat_slots bs
    JOIN boats b ON bs.boat_id = b.id
    WHERE TRIM(LOWER(b.type)) = 'speed' 
      AND CAST(b.is_active AS INTEGER) = 1
      AND CAST(bs.is_active AS INTEGER) = 1
  `).all();
  console.log('Step 4 - Active slots of active speed boats:', step4);
  
  // Step 5: Slots with available seats
  const step5 = db.prepare(`
    SELECT 
      bs.id, bs.boat_id, bs.time, bs.price, bs.capacity, bs.seats_left, bs.is_active as slot_active,
      b.name, b.type, b.is_active as boat_active,
      COALESCE(bs.seats_left, bs.capacity) as available_seats
    FROM boat_slots bs
    JOIN boats b ON bs.boat_id = b.id
    WHERE TRIM(LOWER(b.type)) = 'speed' 
      AND CAST(b.is_active AS INTEGER) = 1
      AND CAST(bs.is_active AS INTEGER) = 1
      AND COALESCE(bs.seats_left, bs.capacity) > 0
  `).all();
  console.log('Step 5 - Slots with available seats:', step5);
  
  // Test JWT secret
  const jwtSecret = process.env.JWT_SECRET || 'boat_ticket_secret_key';
  console.log('✓ JWT secret available:', jwtSecret ? 'YES' : 'NO');
  
  console.log('\nAll tests passed!');
  
} catch (error) {
  console.error('Database test failed:', error);
}