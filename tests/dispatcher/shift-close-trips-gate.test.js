// shift-close-trips-gate.test.js — tests for trip completion gate
// Tests:
// 1) With unfinished trip → summary returns all_trips_finished=false
// 2) With unfinished trip → deposit returns 400
// 3) With unfinished trip → close returns 400
// 4) After marking trip finished → operations allowed
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData, dispatcherToken, dispatcherId;
let testDay;
let testSlotId;

beforeAll(async () => {
  // STEP 1: Reset test DB
  resetTestDb();
  
  // STEP 2: Initialize app
  app = await makeApp();
  
  // STEP 3: Get DB connection and seed test data
  db = getTestDb();
  seedData = await seedBasicData(db);
  
  // Use a unique test day that won't conflict with other tests
  testDay = '2099-06-15';
  
  // Create dispatcher user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_trips', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_trips', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Create an active generated_slot for the test day
  // First, need a schedule_template
  const boatId = seedData.boats.speed;
  const templateRes = db.prepare(`
    INSERT INTO schedule_templates (weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, duration_minutes, is_active)
    VALUES (1, '10:00', 'speed', ?, 'speed', 12, 1000, 500, 60, 1)
  `).run(boatId);
  
  const templateId = templateRes.lastInsertRowid;
  
  // Create the generated_slot (active, not completed)
  const slotRes = db.prepare(`
    INSERT INTO generated_slots (
      schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
      duration_minutes, is_active, price_adult, price_child, price_teen,
      is_completed, status
    ) VALUES (?, ?, ?, '10:00', 12, 10, 60, 1, 1000, 500, 0, 0, 'ACTIVE')
  `).run(templateId, testDay, boatId);
  testSlotId = slotRes.lastInsertRowid;
  
  console.log('[SETUP] testDay:', testDay, 'dispatcherId:', dispatcherId, 'testSlotId:', testSlotId, 'boatId:', boatId, 'templateId:', templateId);
});

afterAll(() => {
  // Cleanup: mark slot as completed to not affect other tests
  try {
    db.prepare(`UPDATE generated_slots SET is_completed = 1, status = 'COMPLETED' WHERE id = ?`).run(testSlotId);
  } catch {}
});

describe('DISPATCHER TRIP COMPLETION GATE', () => {
  it('1) With unfinished trip → summary returns all_trips_finished=false', async () => {
    const summaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${testDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    console.log('[TEST 1] Summary:', summaryRes.status, 'all_trips_finished:', summaryRes.body.all_trips_finished, 'open_trips_count:', summaryRes.body.open_trips_count);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.all_trips_finished).toBe(false);
    expect(summaryRes.body.open_trips_count).toBeGreaterThanOrEqual(1);
    
    console.log('[TEST 1] PASS: Summary shows unfinished trips');
  });
  
  it('2) With unfinished trip → deposit returns 400', async () => {
    const depositRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        type: 'DEPOSIT_TO_OWNER_CASH',
        amount: 1000,
        business_day: testDay
      });
    
    console.log('[TEST 2] Deposit with unfinished trips:', depositRes.status, depositRes.body);
    expect(depositRes.status).toBe(400);
    expect(depositRes.body.ok).toBe(false);
    expect(depositRes.body.error).toContain('незавершённые рейсы');
    expect(depositRes.body).toHaveProperty('open_trips_count');
    
    console.log('[TEST 2] PASS: Deposit blocked due to unfinished trips');
  });
  
  it('3) With unfinished trip → close returns 400', async () => {
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: testDay });
    
    console.log('[TEST 3] Close with unfinished trips:', closeRes.status, closeRes.body);
    expect(closeRes.status).toBe(400);
    expect(closeRes.body.ok).toBe(false);
    expect(closeRes.body.error).toContain('незавершённые рейсы');
    expect(closeRes.body).toHaveProperty('open_trips_count');
    
    console.log('[TEST 3] PASS: Close blocked due to unfinished trips');
  });
  
  it('4) After marking trip finished → operations allowed', async () => {
    // Mark the slot as completed
    db.prepare(`UPDATE generated_slots SET is_completed = 1, status = 'COMPLETED' WHERE id = ?`).run(testSlotId);
    
    // Verify summary now shows all_trips_finished=true
    const summaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${testDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    console.log('[TEST 4] After completion, summary:', summaryRes.status, 'all_trips_finished:', summaryRes.body.all_trips_finished, 'open_trips_count:', summaryRes.body.open_trips_count);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.all_trips_finished).toBe(true);
    expect(summaryRes.body.open_trips_count).toBe(0);
    
    // Deposit should now be allowed
    const depositRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        type: 'DEPOSIT_TO_OWNER_CASH',
        amount: 500,
        business_day: testDay
      });
    
    console.log('[TEST 4] Deposit after completion:', depositRes.status, depositRes.body);
    expect(depositRes.status).toBe(200);
    expect(depositRes.body.ok).toBe(true);
    
    // Close should now be allowed
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: testDay });
    
    console.log('[TEST 4] Close after completion:', closeRes.status, closeRes.body);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.closed).toBe(true);
    
    console.log('[TEST 4] PASS: Operations allowed after trips finished');
  });
});
