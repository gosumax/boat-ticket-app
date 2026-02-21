import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, 'server', 'database.sqlite');
console.log('DB Path:', dbPath);

try {
  const db = new Database(dbPath);
  
  // Get slot 195
  const slot = db.prepare(`
    SELECT id, boat_id, capacity, seats_left, trip_date, time, is_active
    FROM generated_slots 
    WHERE id = 195
  `).get();
  
  console.log('\n=== Slot 195 ===');
  console.log(JSON.stringify(slot, null, 2));
  
  // Get ticket count for slot 195
  const ticketCount = db.prepare(`
    SELECT 
      t.status,
      COUNT(*) as count
    FROM tickets t
    JOIN presales p ON t.presale_id = p.id
    WHERE p.slot_uid = 'generated:195'
    GROUP BY t.status
  `).all();
  
  console.log('\n=== Tickets by status for generated:195 ===');
  console.log(JSON.stringify(ticketCount, null, 2));
  
  // Get total active tickets (same logic as seller endpoint)
  const activeCount = db.prepare(`
    SELECT COUNT(*) as active_tickets
    FROM tickets t
    JOIN presales p ON t.presale_id = p.id
    WHERE p.slot_uid = 'generated:195'
      AND t.status IN ('ACTIVE','PAID','UNPAID','RESERVED','PARTIALLY_PAID','CONFIRMED','USED')
  `).get();
  
  console.log('\n=== Active tickets (7 statuses) ===');
  console.log(JSON.stringify(activeCount, null, 2));
  
  // Calculate available seats
  if (slot && activeCount) {
    const available = slot.capacity - activeCount.active_tickets;
    console.log('\n=== Calculated ===');
    console.log(`Capacity: ${slot.capacity}`);
    console.log(`Active tickets: ${activeCount.active_tickets}`);
    console.log(`Available seats: ${available}`);
  }
  
  // Get all presales for this slot
  const presales = db.prepare(`
    SELECT id, slot_uid, seller_id, number_of_seats, status
    FROM presales
    WHERE slot_uid = 'generated:195'
  `).all();
  
  console.log('\n=== Presales for generated:195 ===');
  console.log(JSON.stringify(presales, null, 2));
  
  db.close();
} catch (e) {
  console.error('Error:', e.message);
}
