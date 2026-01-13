import db from './server/db.js';

// Check generated slots 28 and 29 with their seat availability
const sql = `
  SELECT gs.*, b.name as boat_name, b.is_active as boat_is_active,
    (gs.capacity - COALESCE(ticket_counts.active_tickets, 0)) as available_seats
  FROM generated_slots gs
  JOIN boats b ON gs.boat_id = b.id
  LEFT JOIN (
    SELECT 
      boat_slot_id,
      COUNT(*) as active_tickets
    FROM tickets 
    WHERE status IN ('ACTIVE', 'USED')
    GROUP BY boat_slot_id
  ) ticket_counts ON gs.id = ticket_counts.boat_slot_id
  WHERE gs.id IN (28, 29)
`;

const slots = db.prepare(sql).all();
console.log('Generated slots 28/29:', slots);

// Also check for any generated slots that would be available for selling
const availableSlots = db.prepare(`
  SELECT gs.id, gs.boat_id, gs.trip_date, gs.time, gs.capacity, b.name as boat_name, b.is_active as boat_is_active,
    (gs.capacity - COALESCE(ticket_counts.active_tickets, 0)) as available_seats
  FROM generated_slots gs
  JOIN boats b ON gs.boat_id = b.id
  LEFT JOIN (
    SELECT 
      boat_slot_id,
      COUNT(*) as active_tickets
    FROM tickets 
    WHERE status IN ('ACTIVE', 'USED')
    GROUP BY boat_slot_id
  ) ticket_counts ON gs.id = ticket_counts.boat_slot_id
  WHERE gs.is_active = 1
  AND (gs.capacity - COALESCE(ticket_counts.active_tickets, 0)) > 0
`).all();
console.log('Available generated slots:', availableSlots);