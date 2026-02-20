// shift-salary-payout.test.js — tests for salary payout functionality
// Tests:
// 1) Salary payout inserts into money_ledger
// 2) Summary live reflects salary_paid_cash
// 3) After close, summary snapshot reflects same salary_paid_cash
// 4) Payout blocked when shift closed
// 5) Payout blocked when trips not finished (gate)
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
  testDay = '2099-07-20';
  
  // Create dispatcher user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_salary', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_salary', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Create an active generated_slot for the test day and mark as completed (to allow operations)
  const boatId = seedData.boats.speed;
  const templateRes = db.prepare(`
    INSERT INTO schedule_templates (weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, duration_minutes, is_active)
    VALUES (1, '10:00', 'speed', ?, 'speed', 12, 1000, 500, 60, 1)
  `).run(boatId);
  
  const templateId = templateRes.lastInsertRowid;
  
  // Create the generated_slot (already completed to allow operations)
  const slotRes = db.prepare(`
    INSERT INTO generated_slots (
      schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
      duration_minutes, is_active, price_adult, price_child, price_teen,
      is_completed, status
    ) VALUES (?, ?, ?, '10:00', 12, 10, 60, 1, 1000, 500, 0, 1, 'COMPLETED')
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

describe('DISPATCHER SALARY PAYOUT', () => {
  it('1) Salary payout inserts into money_ledger', async () => {
    const payoutRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        type: 'SALARY_PAYOUT_CASH',
        amount: 5000,
        business_day: testDay
      });
    
    console.log('[TEST 1] Salary payout response:', payoutRes.status, payoutRes.body);
    expect(payoutRes.status).toBe(200);
    expect(payoutRes.body.ok).toBe(true);
    expect(payoutRes.body.type).toBe('SALARY_PAYOUT_CASH');
    expect(payoutRes.body.amount).toBe(5000);
    
    // Verify the ledger entry
    const ledgerRow = db.prepare(`
      SELECT * FROM money_ledger 
      WHERE type = 'SALARY_PAYOUT_CASH' 
        AND business_day = ? 
        AND kind = 'DISPATCHER_SHIFT'
      ORDER BY id DESC LIMIT 1
    `).get(testDay);
    
    expect(ledgerRow).toBeDefined();
    expect(Number(ledgerRow.amount)).toBe(5000);
    
    console.log('[TEST 1] PASS: Salary payout inserted into money_ledger');
  });
  
  it('2) Summary live reflects salary_paid_cash', async () => {
    const summaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${testDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    console.log('[TEST 2] Summary:', summaryRes.status, 'salary_paid_cash:', summaryRes.body.salary_paid_cash, 'salary_paid_total:', summaryRes.body.salary_paid_total);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.is_closed).toBe(false);
    expect(summaryRes.body.salary_paid_cash).toBeGreaterThanOrEqual(5000);
    expect(summaryRes.body.salary_paid_total).toBeGreaterThanOrEqual(5000);
    
    console.log('[TEST 2] PASS: Summary reflects salary payouts');
  });
  
  it('3) After close, summary snapshot reflects same salary_paid_cash', async () => {
    // Close the shift
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: testDay });
    
    console.log('[TEST 3] Close response:', closeRes.status, closeRes.body);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.closed).toBe(true);
    
    // Get summary again - should be snapshot
    const summaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${testDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    console.log('[TEST 3] Snapshot summary:', summaryRes.status, 'is_closed:', summaryRes.body.is_closed, 'salary_paid_cash:', summaryRes.body.salary_paid_cash);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.is_closed).toBe(true);
    expect(summaryRes.body.source).toBe('snapshot');
    expect(summaryRes.body.salary_paid_cash).toBeGreaterThanOrEqual(5000);
    expect(summaryRes.body.salary_paid_total).toBeGreaterThanOrEqual(5000);
    
    console.log('[TEST 3] PASS: Snapshot reflects salary payouts');
  });
  
  it('4) Payout blocked when shift closed', async () => {
    const payoutRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        type: 'SALARY_PAYOUT_CASH',
        amount: 3000,
        business_day: testDay
      });
    
    console.log('[TEST 4] Payout after close:', payoutRes.status, payoutRes.body);
    expect(payoutRes.status).toBe(400);
    expect(payoutRes.body.ok).toBe(false);
    expect(payoutRes.body.error).toContain('закрыта');
    
    console.log('[TEST 4] PASS: Payout blocked when shift closed');
  });
  
  it('5) Payout blocked when trips not finished (gate)', async () => {
    // Create another test day with unfinished trips
    const unfinishedDay = '2099-07-21';
    
    // Create an UNFINISHED slot for this day
    const boatId = seedData.boats.speed;
    const templateRes = db.prepare(`
      INSERT INTO schedule_templates (weekday, time, product_type, boat_id, boat_type, capacity, price_adult, price_child, duration_minutes, is_active)
      VALUES (1, '10:00', 'speed', ?, 'speed', 12, 1000, 500, 60, 1)
    `).run(boatId);
    
    const templateId = templateRes.lastInsertRowid;
    
    db.prepare(`
      INSERT INTO generated_slots (
        schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
        duration_minutes, is_active, price_adult, price_child, price_teen,
        is_completed, status
      ) VALUES (?, ?, ?, '10:00', 12, 10, 60, 1, 1000, 500, 0, 0, 'ACTIVE')
    `).run(templateId, unfinishedDay, boatId);
    
    // Try salary payout - should be blocked
    const payoutRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        type: 'SALARY_PAYOUT_CASH',
        amount: 2000,
        business_day: unfinishedDay
      });
    
    console.log('[TEST 5] Payout with unfinished trips:', payoutRes.status, payoutRes.body);
    expect(payoutRes.status).toBe(400);
    expect(payoutRes.body.ok).toBe(false);
    expect(payoutRes.body.error).toContain('незавершённые рейсы');
    
    console.log('[TEST 5] PASS: Payout blocked when trips not finished');
  });
});
