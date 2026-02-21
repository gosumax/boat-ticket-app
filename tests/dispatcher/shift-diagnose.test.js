/**
 * Test: Shift Diagnose Endpoint
 * Verifies diagnostic endpoint returns correct status for shift close
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { getTodayLocal } from '../_helpers/testDates.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, dispatcherToken, dispatcherId;
let testDate;

beforeAll(async () => {
  // Reset test DB
  resetTestDb();
  
  // Initialize app
  app = await makeApp();
  
  // Get DB connection and seed test data
  db = getTestDb();
  await seedBasicData(db);
  
  // Get today's date for test
  testDate = getTodayLocal(db);
  
  // Create dispatcher user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_diagnose', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_diagnose', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  console.log('[SETUP] testDate:', testDate, 'dispatcherId:', dispatcherId);
});

describe('SHIFT DIAGNOSE ENDPOINT', () => {
  it('returns ok=true with ledger_stats for day without close', async () => {
    const uniqueTestDate = `2099-03-01`;
    
    // Ensure trips are completed for this date
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (89901, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }
    
    // Create some sales
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 5000, 200, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);
    
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CARD', 3000, 200, 'POSTED', ?, 'CARD', datetime('now','localtime'))
    `).run(uniqueTestDate);

    const res = await request(app)
      .get(`/api/dispatcher/shift/diagnose?business_day=${uniqueTestDate}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.business_day).toBe(uniqueTestDate);
    
    // Not closed
    expect(res.body.is_closed).toBe(false);
    
    // Trips finished
    expect(res.body.all_trips_finished).toBe(true);
    expect(res.body.open_trips_count).toBe(0);
    
    // Ledger stats present
    expect(res.body.ledger_stats).toBeDefined();
    expect(res.body.ledger_stats.sale_count).toBeGreaterThanOrEqual(2);
    expect(res.body.ledger_stats.refund_count).toBe(0);
    expect(res.body.ledger_stats.deposit_count).toBe(0);
    expect(res.body.ledger_stats.salary_count).toBe(0);
    
    // No discrepancy yet (not closed)
    expect(res.body.has_cashbox_discrepancy).toBe(false);
    expect(res.body.cash_discrepancy).toBe(null);
    
    // Notes: NO_SALES should NOT be present (we have sales)
    expect(res.body.notes).not.toContain('SHIFT_CLOSED');
    expect(res.body.notes).not.toContain('NO_SALES');
  });

  it('returns is_closed=true with cash_discrepancy after close', async () => {
    const uniqueTestDate = `2099-03-02`;
    
    // Ensure trips are completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (89902, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }
    
    // Create sale
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 3000, 200, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);
    
    // Partial deposit (not full - will create discrepancy)
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('DISPATCHER_SHIFT', 'DEPOSIT_TO_OWNER_CASH', 1000, 200, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

    // Close the shift
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: uniqueTestDate });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.is_closed).toBe(true);

    // Now diagnose
    const res = await request(app)
      .get(`/api/dispatcher/shift/diagnose?business_day=${uniqueTestDate}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    
    // Closed
    expect(res.body.is_closed).toBe(true);
    
    // Cash discrepancy present (from snapshot)
    expect(res.body.cash_discrepancy).not.toBe(null);
    
    // Notes contains SHIFT_CLOSED
    expect(res.body.notes).toContain('SHIFT_CLOSED');
    
    // Ledger stats
    expect(res.body.ledger_stats.sale_count).toBeGreaterThanOrEqual(1);
    expect(res.body.ledger_stats.deposit_count).toBeGreaterThanOrEqual(1);
  });

  it('returns NO_SALES note when no sales for day', async () => {
    const uniqueTestDate = `2099-03-03`;
    
    // Ensure trips are completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (89903, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }
    
    // No sales for this day

    const res = await request(app)
      .get(`/api/dispatcher/shift/diagnose?business_day=${uniqueTestDate}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.is_closed).toBe(false);
    
    // NO_SALES note
    expect(res.body.notes).toContain('NO_SALES');
    expect(res.body.ledger_stats.sale_count).toBe(0);
  });

  it('returns OPEN_TRIPS note when trips not completed', async () => {
    const uniqueTestDate = `2099-03-04`;
    
    // Create schedule_template and generated_slot for open trip
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (!boat) {
      console.log('No boat found, skipping test');
      return;
    }
    
    // Create template
    const templateRes = db.prepare(`
      INSERT INTO schedule_templates (weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, duration_minutes, is_active)
      VALUES (1, '10:00', 'speed', ?, 'speed', 12, 1000, 500, 60, 1)
    `).run(boat.id);
    const templateId = templateRes.lastInsertRowid;
    
    // Create open (not completed) generated_slot
    db.prepare(`
      INSERT INTO generated_slots (
        schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
        duration_minutes, is_active, price_adult, price_child, price_teen,
        is_completed, status
      ) VALUES (?, ?, ?, '10:00', 12, 10, 60, 1, 1000, 500, 0, 0, 'ACTIVE')
    `).run(templateId, uniqueTestDate, boat.id);

    const res = await request(app)
      .get(`/api/dispatcher/shift/diagnose?business_day=${uniqueTestDate}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    
    // Open trips detected
    expect(res.body.all_trips_finished).toBe(false);
    expect(res.body.open_trips_count).toBeGreaterThanOrEqual(1);
    expect(res.body.notes).toContain('OPEN_TRIPS');
  });
});
