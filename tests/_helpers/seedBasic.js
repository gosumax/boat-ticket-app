// seedBasic.js — seed minimal data for seller tests
import bcrypt from 'bcrypt';
import { getTomorrowLocal } from './testDates.js';

const SALT_ROUNDS = 10;

export async function seedBasicData(db) {
  // Clear existing data first (in case server/db.js auto-seeded)
  try { db.exec('DELETE FROM generated_slots'); } catch (e) {}
  try { db.exec('DELETE FROM schedule_template_items'); } catch (e) {}
  try { db.exec('DELETE FROM schedule_templates'); } catch (e) {}
  try { db.exec('DELETE FROM boat_slots'); } catch (e) {}
  try { db.exec('DELETE FROM boats'); } catch (e) {}
  try { db.exec('DELETE FROM users WHERE role IN ("seller", "dispatcher")'); } catch (e) {}
  try { db.exec('DELETE FROM tickets'); } catch (e) {}
  try { db.exec('DELETE FROM presales'); } catch (e) {}
  try { db.exec('DELETE FROM sales_transactions_canonical'); } catch (e) {}
  try { db.exec('DELETE FROM money_ledger'); } catch (e) {}
  
  // Create 2 sellers
  const passwordHashSellerA = await bcrypt.hash('password123', SALT_ROUNDS);
  const passwordHashSellerB = await bcrypt.hash('password123', SALT_ROUNDS);
  
  const sellerA = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'seller', 1)
  `).run('sellerA', passwordHashSellerA);
  
  const sellerB = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'seller', 1)
  `).run('sellerB', passwordHashSellerB);
  
  // Create 1 dispatcher (optional, for completeness)
  const passwordHashDispatcher = await bcrypt.hash('password123', SALT_ROUNDS);
  const dispatcher = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('dispatcher1', passwordHashDispatcher);
  
  // Create boats
  const boatSpeed = db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
    VALUES (?, 'speed', 1, 1000, 500, 750)
  `).run('Скоростная 1');
  
  const boatCruise = db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
    VALUES (?, 'cruise', 1, 800, 400, 600)
  `).run('Прогулочная 1');
  
  // Create schedule_templates for generated_slots foreign key
  // FK references schedule_templates(id)
  const templateSpeed = db.prepare(`
    INSERT INTO schedule_templates (weekday, time, product_type, boat_id, capacity, price_adult, price_child, price_teen, duration_minutes, is_active)
    VALUES (1, '10:00', 'speed', ?, 12, 1000, 500, 750, 60, 1)
  `).run(boatSpeed.lastInsertRowid);
  
  const templateSpeed2 = db.prepare(`
    INSERT INTO schedule_templates (weekday, time, product_type, boat_id, capacity, price_adult, price_child, price_teen, duration_minutes, is_active)
    VALUES (1, '12:00', 'speed', ?, 12, 1000, 500, 750, 60, 1)
  `).run(boatSpeed.lastInsertRowid);
  
  // Create boat_slots (manual slots)
  // Slot 1: capacity 2 (for transfer-full test)
  const slot1 = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, seller_cutoff_minutes)
    VALUES (?, '10:00', 1000, 2, 2, 1000, 500, 750, 60, 1, 30)
  `).run(boatSpeed.lastInsertRowid);
  
  // Slot 2: capacity 5 (for test 04 - payment update)
  const slot2 = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, seller_cutoff_minutes)
    VALUES (?, '12:00', 1000, 5, 5, 1000, 500, 750, 60, 1, 30)
  `).run(boatSpeed.lastInsertRowid);
  
  // Slot 3: capacity 5 (for test 05 - cancel)
  const slot3 = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, seller_cutoff_minutes)
    VALUES (?, '13:00', 1000, 5, 5, 1000, 500, 750, 60, 1, 30)
  `).run(boatSpeed.lastInsertRowid);
  
  // Slot 4: capacity 5 (for test 06 - transfer source)
  const slot4 = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, seller_cutoff_minutes)
    VALUES (?, '14:00', 1000, 5, 5, 1000, 500, 750, 60, 1, 30)
  `).run(boatSpeed.lastInsertRowid);
  
  // Slot 5: capacity 5 (for test 06 - transfer target)
  const slot5 = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, seller_cutoff_minutes)
    VALUES (?, '15:00', 1000, 5, 5, 1000, 500, 750, 60, 1, 30)
  `).run(boatSpeed.lastInsertRowid);
  
  // Slot 6: capacity 5 (for test 07 - tickets)
  const slot6 = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, seller_cutoff_minutes)
    VALUES (?, '16:00', 1000, 5, 5, 1000, 500, 750, 60, 1, 30)
  `).run(boatSpeed.lastInsertRowid);
  
  // Slot 7: capacity 5 (for test 08 - ownership security)
  const slot7 = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, seller_cutoff_minutes)
    VALUES (?, '17:00', 1000, 5, 5, 1000, 500, 750, 60, 1, 30)
  `).run(boatSpeed.lastInsertRowid);
  
  // Slot 8: cruise boat (for transfer tests)
  const slot8 = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, seller_cutoff_minutes)
    VALUES (?, '14:00', 800, 3, 3, 800, 400, 600, 120, 1, 30)
  `).run(boatCruise.lastInsertRowid);
  
  // Slot 9: capacity 15 (for test 10 - UI scenarios pricing, needs 11 seats total)
  const slot9 = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, seller_cutoff_minutes)
    VALUES (?, '18:00', 1000, 15, 15, 1000, 500, 750, 60, 1, 30)
  `).run(boatSpeed.lastInsertRowid);
  
  // Create generated_slots for tomorrow
  // Use centralized SQLite date utility to ensure consistency
  const tomorrowStr = getTomorrowLocal(db);
  
  const genSlot1 = db.prepare(`
    INSERT INTO generated_slots (schedule_template_id, boat_id, time, trip_date, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, seller_cutoff_minutes)
    VALUES (?, ?, '10:00', ?, 2, 2, 1000, 500, 750, 60, 1, 30)
  `).run(templateSpeed.lastInsertRowid, boatSpeed.lastInsertRowid, tomorrowStr);
  
  const genSlot2 = db.prepare(`
    INSERT INTO generated_slots (schedule_template_id, boat_id, time, trip_date, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, seller_cutoff_minutes)
    VALUES (?, ?, '12:00', ?, 5, 5, 1000, 500, 750, 60, 1, 30)
  `).run(templateSpeed2.lastInsertRowid, boatSpeed.lastInsertRowid, tomorrowStr);
  
  console.log('[SEED] Created users:', { 
    sellerA: sellerA.lastInsertRowid, 
    sellerB: sellerB.lastInsertRowid,
    dispatcher: dispatcher.lastInsertRowid
  });
  console.log('[SEED] Created boats:', { 
    boatSpeed: boatSpeed.lastInsertRowid, 
    boatCruise: boatCruise.lastInsertRowid 
  });
  console.log('[SEED] Created boat_slots:', {
    slot1: slot1.lastInsertRowid,
    slot2: slot2.lastInsertRowid,
    slot3: slot3.lastInsertRowid,
    slot4: slot4.lastInsertRowid,
    slot5: slot5.lastInsertRowid,
    slot6: slot6.lastInsertRowid,
    slot7: slot7.lastInsertRowid,
    slot8: slot8.lastInsertRowid,
    slot9: slot9.lastInsertRowid
  });
  console.log('[SEED] Created generated_slots:', {
    genSlot1: genSlot1.lastInsertRowid,
    genSlot2: genSlot2.lastInsertRowid,
    tomorrow: tomorrowStr
  });
  
  return {
    users: {
      sellerA: { id: sellerA.lastInsertRowid, username: 'sellerA' },
      sellerB: { id: sellerB.lastInsertRowid, username: 'sellerB' },
      dispatcher: { id: dispatcher.lastInsertRowid, username: 'dispatcher1' }
    },
    boats: {
      speed: boatSpeed.lastInsertRowid,
      cruise: boatCruise.lastInsertRowid
    },
    slots: {
      manual: {
        slot1: slot1.lastInsertRowid,
        slot2: slot2.lastInsertRowid,
        slot3: slot3.lastInsertRowid,
        slot4: slot4.lastInsertRowid,
        slot5: slot5.lastInsertRowid,
        slot6: slot6.lastInsertRowid,
        slot7: slot7.lastInsertRowid,
        slot8: slot8.lastInsertRowid,
        slot9: slot9.lastInsertRowid
      },
      generated: {
        genSlot1: genSlot1.lastInsertRowid,
        genSlot2: genSlot2.lastInsertRowid,
        tomorrow: tomorrowStr
      }
    }
  };
}
