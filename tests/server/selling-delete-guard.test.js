import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp } from '../_helpers/makeApp.js';

// Test tokens and app
let app;
let ownerToken;

describe('DELETE /api/selling/presales/:id/delete - SHIFT_CLOSED guard', () => {
  beforeAll(async () => {
    // Create app with all routes mounted
    app = await makeApp();
    
    // Get tokens - using owner since canDispatchManageSlots allows owner
    const ownerLogin = await request(app).post('/api/auth/login').send({ username: 'owner', password: 'owner123' });
    ownerToken = ownerLogin.body.token;
  });
  
  beforeEach(async () => {
    // Clean shift_closures before each test
    const db = (await import('../../server/db.js')).default;
    db.prepare(`DELETE FROM shift_closures`).run();
  });
  
  it('should return 409 SHIFT_CLOSED when trying to delete presale from closed day', async () => {
    const db = (await import('../../server/db.js')).default;
    
    // Find a presale with payments that's still ACTIVE
    const presale = db.prepare(`
      SELECT p.id, p.business_day
      FROM presales p
      JOIN money_ledger ml ON ml.presale_id = p.id
      WHERE p.status = 'ACTIVE' AND ml.status = 'POSTED'
      LIMIT 1
    `).get();
    
    if (!presale) {
      console.log('No presale with payments found, skipping test');
      return;
    }
    
    // Close the shift for this business_day
    db.prepare(`INSERT INTO shift_closures (business_day, closed_at, closed_by) VALUES (?, datetime('now'), 1)`).run(presale.business_day);
    
    // Try to delete - should fail with 409
    const res = await request(app)
      .patch(`/api/selling/presales/${presale.id}/delete`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      code: 'SHIFT_CLOSED'
    });
    expect(res.body.message).toContain('закрыта');
    
    // Cleanup: remove the shift closure
    db.prepare(`DELETE FROM shift_closures WHERE business_day = ?`).run(presale.business_day);
  });
  
  it('should allow delete when shift is NOT closed', async () => {
    const db = (await import('../../server/db.js')).default;
    
    // Find an ACTIVE presale with payments
    const presale = db.prepare(`
      SELECT p.id, p.business_day, p.status
      FROM presales p
      JOIN money_ledger ml ON ml.presale_id = p.id
      WHERE p.status = 'ACTIVE' AND ml.status = 'POSTED'
      LIMIT 1
    `).get();
    
    if (!presale) {
      console.log('No presale with payments found, skipping test');
      return;
    }
    
    // Ensure shift is NOT closed for this day
    db.prepare(`DELETE FROM shift_closures WHERE business_day = ?`).run(presale.business_day);
    
    // Delete should succeed
    const res = await request(app)
      .patch(`/api/selling/presales/${presale.id}/delete`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      status: 'CANCELLED'
    });
  });
  
  it('blocks delete when shift is closed', async () => {
    const db = (await import('../../server/db.js')).default;
    const testBusinessDay = '2026-01-01';
    
    // Clean up any existing data for this test day
    db.prepare(`DELETE FROM shift_closures WHERE business_day = ?`).run(testBusinessDay);
    db.prepare(`DELETE FROM presales WHERE business_day = ?`).run(testBusinessDay);
    
    // 1. Ensure a boat exists (needed for boat_slot)
    let boat = db.prepare(`SELECT id FROM boats LIMIT 1`).get();
    if (!boat) {
      db.prepare(`INSERT INTO boats (name, is_active, type, price_adult, price_child) VALUES (?, 1, 'speed', 1000, 500)`).run('TestBoat');
      boat = db.prepare(`SELECT id FROM boats LIMIT 1`).get();
    }
    const boatId = boat.id;
    
    // 2. Create a boat_slot for the test with unique time
    const uniqueTime = `10:${Math.floor(Math.random()*50 + 10)}`;
    db.prepare(`
      INSERT INTO boat_slots (boat_id, time, price, is_active, seats_left, capacity)
      VALUES (?, ?, 1000, 1, 10, 10)
    `).run(boatId, uniqueTime);
    const slot = db.prepare(`SELECT last_insert_rowid() AS id`).get();
    const slotId = slot.id;
    
    // 3. Create a minimal presale with business_day = '2026-01-01' and boat_slot_id
    const createPresale = db.prepare(`
      INSERT INTO presales (
        boat_slot_id, business_day, seller_id, slot_uid, customer_name, 
        customer_phone, number_of_seats, total_price, prepayment_amount, status,
        payment_method, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    const result = createPresale.run(
      slotId,            // boat_slot_id (required)
      testBusinessDay,   // business_day
      1,                 // seller_id
      'generated:999',   // slot_uid (dummy)
      'Test Customer',   // customer_name
      '79990000000',     // customer_phone (required)
      1,                 // number_of_seats
      1000,              // total_price
      1000,              // prepayment_amount (fully paid)
      'ACTIVE',          // status
      'cash'             // payment_method
    );
    const presaleId = result.lastInsertRowid;
    
    // Add a money_ledger entry so the guard checks business_day
    db.prepare(`
      INSERT INTO money_ledger (
        business_day, kind, type, method, amount, status, 
        seller_id, presale_id, event_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      testBusinessDay,      // business_day
      'SELLER_SHIFT',       // kind
      'SALE_ACCEPTED_CASH', // type
      'cash',               // method
      1000,                 // amount
      'POSTED',             // status
      1,                    // seller_id
      presaleId             // presale_id
    );
    
    // 4. Close the shift for this business_day
    db.prepare(`
      INSERT INTO shift_closures (business_day, closed_at, closed_by)
      VALUES (?, datetime('now'), 1)
    `).run(testBusinessDay);
    
    // 5. Try to delete - should fail with 409
    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/delete`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    // 6. Expect 409 SHIFT_CLOSED
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SHIFT_CLOSED');
    expect(res.body.message).toContain('закрыта');
    
    // Cleanup
    db.prepare(`DELETE FROM money_ledger WHERE presale_id = ?`).run(presaleId);
    db.prepare(`DELETE FROM presales WHERE id = ?`).run(presaleId);
    db.prepare(`DELETE FROM boat_slots WHERE id = ?`).run(slotId);
    db.prepare(`DELETE FROM shift_closures WHERE business_day = ?`).run(testBusinessDay);
  });
});
