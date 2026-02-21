// shift-close-locks-deposits.test.js — Test that deposits are blocked after shift close
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { getTodayLocal, getTomorrowLocal } from '../_helpers/testDates.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData;
let dispatcherToken, dispatcherId;
let today;

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  seedData = await seedBasicData(db);
  
  today = getTodayLocal(db);
  
  // Create dispatcher
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_lock', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_lock', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
});

describe('DISPATCHER SHIFT CLOSE: LOCK DEPOSITS AFTER CLOSE', () => {
  it('POST /deposit returns 409 SHIFT_CLOSED after shift is closed', async () => {
    // Arrange: Create a minimal ledger entry for today
    db.prepare(`
      INSERT INTO money_ledger (kind, type, method, amount, seller_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_PREPAYMENT_CASH', 'CASH', 1000, 1, 'POSTED', ?, datetime('now','localtime'))
    `).run(today);
    
    // Ensure no open trips for today
    db.prepare(`
      UPDATE generated_slots SET is_completed = 1 WHERE trip_date = ?
    `).run(today);
    
    // Act 1: Close shift
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: today });
    
    console.log('[CLOSE] status:', closeRes.status, 'body:', closeRes.body);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(closeRes.body.business_day).toBe(today);
    
    // Act 2: Try DEPOSIT_TO_OWNER_CASH - should fail with 409
    const depositCashRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        business_day: today,
        type: 'DEPOSIT_TO_OWNER_CASH',
        amount: 500,
        seller_id: 1
      });
    
    console.log('[DEPOSIT CASH] status:', depositCashRes.status, 'body:', depositCashRes.body);
    expect(depositCashRes.status).toBe(409);
    expect(depositCashRes.body.ok).toBe(false);
    expect(depositCashRes.body.code).toBe('SHIFT_CLOSED');
    
    // Act 3: Try SALARY_PAYOUT_CASH - should also fail with 409
    const salaryRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        business_day: today,
        type: 'SALARY_PAYOUT_CASH',
        amount: 100
      });
    
    console.log('[SALARY PAYOUT] status:', salaryRes.status, 'body:', salaryRes.body);
    expect(salaryRes.status).toBe(409);
    expect(salaryRes.body.ok).toBe(false);
    expect(salaryRes.body.code).toBe('SHIFT_CLOSED');
  });
  
  it('POST /close is idempotent - returns ok:true with is_closed:true if already closed', async () => {
    const anotherDay = '2099-01-01';  // Use a different day
    
    // Create minimal ledger entry
    db.prepare(`
      INSERT INTO money_ledger (kind, type, method, amount, seller_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_PREPAYMENT_CASH', 'CASH', 500, 1, 'POSTED', ?, datetime('now','localtime'))
    `).run(anotherDay);
    
    // Ensure no open trips
    db.prepare(`
      UPDATE generated_slots SET is_completed = 1 WHERE trip_date = ?
    `).run(anotherDay);
    
    // Close shift
    const close1 = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: anotherDay });
    
    expect(close1.status).toBe(200);
    expect(close1.body.ok).toBe(true);
    const closedAt = close1.body.closed_at;
    const closedBy = close1.body.closed_by;
    
    // Close again - should be idempotent
    const close2 = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: anotherDay });
    
    console.log('[CLOSE IDEMPOTENT] status:', close2.status, 'body:', close2.body);
    expect(close2.status).toBe(200);
    expect(close2.body.ok).toBe(true);
    expect(close2.body.is_closed).toBe(true);
    expect(close2.body.source).toBe('snapshot');
    expect(close2.body.business_day).toBe(anotherDay);
    // Should return same closed_at/closed_by
    expect(close2.body.closed_at).toBe(closedAt);
    expect(close2.body.closed_by).toBe(closedBy);
  });
  
  it('GET /summary returns source=snapshot after close', async () => {
    const summaryDay = '2099-02-01';
    
    // Create minimal ledger entry
    db.prepare(`
      INSERT INTO money_ledger (kind, type, method, amount, seller_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_PREPAYMENT_CASH', 'CASH', 2000, 1, 'POSTED', ?, datetime('now','localtime'))
    `).run(summaryDay);
    
    // Ensure no open trips
    db.prepare(`
      UPDATE generated_slots SET is_completed = 1 WHERE trip_date = ?
    `).run(summaryDay);
    
    // Get live summary first
    const summaryLive = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${summaryDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    expect(summaryLive.status).toBe(200);
    expect(summaryLive.body.source).toBe('live');
    const liveCollected = summaryLive.body.collected_total;
    
    // Close shift
    await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: summaryDay });
    
    // Get snapshot summary
    const summarySnap = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${summaryDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    console.log('[SUMMARY SNAP] source:', summarySnap.body.source, 'collected:', summarySnap.body.collected_total);
    expect(summarySnap.status).toBe(200);
    expect(summarySnap.body.source).toBe('snapshot');
    expect(summarySnap.body.is_closed).toBe(true);
    // Totals should match what was live before close
    expect(summarySnap.body.collected_total).toBe(liveCollected);
  });
});
