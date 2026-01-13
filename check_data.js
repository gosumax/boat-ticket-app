const db = require('./server/db.js');

console.log('=== BOATS ===');
const boats = db.prepare('SELECT id, name, type, is_active FROM boats').all();
console.log(boats);

console.log('\n=== SLOTS ===');
const slots = db.prepare('SELECT id, boat_id, time, price, capacity, seats_left, is_active FROM boat_slots').all();
console.log(slots);

console.log('\n=== JOINED DATA FOR SPEED TYPE ===');
const joinedData = db.prepare(`
  SELECT 
    bs.id as slot_id,
    bs.boat_id,
    bs.time,
    bs.price,
    bs.capacity,
    bs.seats_left,
    bs.is_active as slot_active,
    b.name as boat_name,
    b.type as boat_type,
    b.is_active as boat_active,
    COALESCE(bs.seats_left, bs.capacity) as available_seats
  FROM boat_slots bs
  JOIN boats b ON bs.boat_id = b.id
  WHERE TRIM(LOWER(b.type)) = 'speed'
`).all();
console.log(joinedData);

console.log('\n=== FILTER STEP BY STEP ===');

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
    bs.id, bs.boat_id, bs.time, bs.price, bs.capacity, bs.seats_left, bs.is_active,
    b.name, b.type, b.is_active
  FROM boat_slots bs
  JOIN boats b ON bs.boat_id = b.id
  WHERE TRIM(LOWER(b.type)) = 'speed' AND CAST(b.is_active AS INTEGER) = 1
`).all();
console.log('Step 3 - Slots with active speed boats:', step3);

// Step 4: Active slots of active speed boats
const step4 = db.prepare(`
  SELECT 
    bs.id, bs.boat_id, bs.time, bs.price, bs.capacity, bs.seats_left, bs.is_active,
    b.name, b.type, b.is_active
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
    bs.id, bs.boat_id, bs.time, bs.price, bs.capacity, bs.seats_left, bs.is_active,
    b.name, b.type, b.is_active,
    COALESCE(bs.seats_left, bs.capacity) as available_seats
  FROM boat_slots bs
  JOIN boats b ON bs.boat_id = b.id
  WHERE TRIM(LOWER(b.type)) = 'speed' 
    AND CAST(b.is_active AS INTEGER) = 1
    AND CAST(bs.is_active AS INTEGER) = 1
    AND COALESCE(bs.seats_left, bs.capacity) > 0
`).all();
console.log('Step 5 - Slots with available seats:', step5);