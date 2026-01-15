
// ONE-TIME FIX v2: Recalculate seats_left for ALL boat slots
// Counts ACTIVE tickets + ACTIVE presales (number_of_seats)
// Run once: node recalc_all_slots_v2.mjs

import db from './db.js';

function recalcSlotSeatsLeft(boat_slot_id) {
  const capRow = db.prepare(`SELECT capacity FROM boat_slots WHERE id = ?`).get(boat_slot_id);
  if (!capRow) return;

  const activeTickets = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM tickets
    WHERE boat_slot_id = ? AND status = 'ACTIVE'
  `).get(boat_slot_id)?.cnt || 0;

  const activePresalesSeats = db.prepare(`
    SELECT COALESCE(SUM(number_of_seats), 0) as cnt
    FROM presales
    WHERE boat_slot_id = ? AND status = 'ACTIVE'
  `).get(boat_slot_id)?.cnt || 0;

  const used = activeTickets + activePresalesSeats;
  const seatsLeft = Math.max(0, (capRow.capacity || 0) - used);

  db.prepare(`UPDATE boat_slots SET seats_left = ? WHERE id = ?`).run(seatsLeft, boat_slot_id);
}

const slots = db.prepare(`SELECT id FROM boat_slots`).all();

for (const s of slots) {
  recalcSlotSeatsLeft(s.id);
}

console.log(`[OK] Recalculated seats_left for ${slots.length} slots (tickets + presales)`);
