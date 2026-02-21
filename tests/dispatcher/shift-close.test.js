// shift-close.test.js — tests for dispatcher shift close with snapshot
// Tests:
// 1) Close shift → summary returns source='snapshot'
// 2) After close → deposit returns 400
// 3) Second close → 409
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { getTodayLocal } from '../_helpers/testDates.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData, dispatcherToken, dispatcherId;
let today;

beforeAll(async () => {
  // STEP 1: Reset test DB
  resetTestDb();
  
  // STEP 2: Initialize app
  app = await makeApp();
  
  // STEP 3: Get DB connection and seed test data
  db = getTestDb();
  seedData = await seedBasicData(db);
  
  // Get dates
  today = getTodayLocal(db);
  
  // Create dispatcher user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_close', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_close', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  console.log('[SETUP] today:', today, 'dispatcherId:', dispatcherId);
});

describe('DISPATCHER SHIFT CLOSE', () => {
  it('1) Close shift → summary returns source=snapshot', async () => {
    // First, verify summary shows live
    const beforeRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${today}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    console.log('[TEST 1] Before close:', beforeRes.status, 'source:', beforeRes.body.source);
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.source).toBe('live');
    expect(beforeRes.body.is_closed).toBe(false);
    
    // Close the shift
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: today });
    
    console.log('[TEST 1] Close response:', closeRes.status, closeRes.body);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(closeRes.body.closed).toBe(true);
    expect(closeRes.body.business_day).toBe(today);
    
    // Verify summary now shows snapshot
    const afterRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${today}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    console.log('[TEST 1] After close:', afterRes.status, 'source:', afterRes.body.source, 'is_closed:', afterRes.body.is_closed);
    expect(afterRes.status).toBe(200);
    expect(afterRes.body.source).toBe('snapshot');
    expect(afterRes.body.is_closed).toBe(true);
    expect(afterRes.body).toHaveProperty('closed_at');
    expect(afterRes.body).toHaveProperty('closed_by');
    
    console.log('[TEST 1] PASS: Close creates snapshot');
  });
  
  it('2) After close → deposit returns 409 SHIFT_CLOSED', async () => {
    const depositRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        type: 'DEPOSIT_TO_OWNER_CASH',
        amount: 1000,
        business_day: today
      });
    
    console.log('[TEST 2] Deposit after close:', depositRes.status, depositRes.body);
    expect(depositRes.status).toBe(409);
    expect(depositRes.body.ok).toBe(false);
    expect(depositRes.body.code).toBe('SHIFT_CLOSED');
    
    console.log('[TEST 2] PASS: Deposit blocked after close');
  });
  
  it('3) Second close → idempotent (ok:true, is_closed:true)', async () => {
    const secondCloseRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: today });
    
    console.log('[TEST 3] Second close:', secondCloseRes.status, secondCloseRes.body);
    expect(secondCloseRes.status).toBe(200);
    expect(secondCloseRes.body.ok).toBe(true);
    expect(secondCloseRes.body.is_closed).toBe(true);
    expect(secondCloseRes.body.source).toBe('snapshot');
    
    console.log('[TEST 3] PASS: Second close is idempotent');
  });
  
  it('4) Summary snapshot values match live before close', async () => {
    // Use a different day that's not closed
    const otherDay = '2099-12-31';
    
    // Get live values
    const liveRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${otherDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    expect(liveRes.status).toBe(200);
    expect(liveRes.body.source).toBe('live');
    
    // Close this day
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: otherDay });
    
    expect(closeRes.status).toBe(200);
    
    // Get snapshot values
    const snapshotRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${otherDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.body.source).toBe('snapshot');
    
    // Verify key fields match
    expect(snapshotRes.body.total_revenue).toBe(liveRes.body.total_revenue);
    expect(snapshotRes.body.collected_total).toBe(liveRes.body.collected_total);
    expect(snapshotRes.body.collected_cash).toBe(liveRes.body.collected_cash);
    expect(snapshotRes.body.collected_card).toBe(liveRes.body.collected_card);
    expect(snapshotRes.body.refund_total).toBe(liveRes.body.refund_total);
    expect(snapshotRes.body.net_total).toBe(liveRes.body.net_total);
    
    console.log('[TEST 4] PASS: Snapshot values match live values');
  });
});
