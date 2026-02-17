// 09-idempotency-and-negative.test.js — Idempotency and negative tests
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getTestDb, getTableCounts } from '../_helpers/dbReset.js';
import { loadSeedData } from '../_helpers/loadSeedData.js';
import { makeApp } from '../_helpers/makeApp.js';
import { httpLog } from '../_helpers/httpLog.js';

let app, db, seedData, token;

beforeAll(async () => {
  httpLog.clear();
  db = getTestDb();
  seedData = loadSeedData();
  app = await makeApp();
  
  // Login sellerA
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'sellerA', password: 'password123' });
  token = loginRes.body.token;
});

afterAll(() => {
  httpLog.printSummary();
  
  console.log('\n========================================');
  console.log('FINAL DB STATE');
  console.log('========================================');
  const counts = getTableCounts(db);
  console.table(counts);
  console.log('========================================\n');
});

describe('SELLER IDEMPOTENCY & NEGATIVE TESTS', () => {
  it('POST /api/selling/presales - reject negative tickets', async () => {
    const payload = {
      slotUid: `manual:${seedData.slots.manual.slot2}`,
      customerName: 'Negative Test',
      customerPhone: '+79991234567',
      numberOfSeats: -1,  // Negative numberOfSeats
      prepaymentAmount: 0
    };
    
    const start = Date.now();
    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    const duration = Date.now() - start;
    httpLog.log('POST', '/api/selling/presales', res.status, duration);
    
    console.log('\n[TEST] Negative tickets attempt:', res.status, res.body);
    
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
  
  it('POST /api/selling/presales - reject invalid slot_uid', async () => {
    const payload = {
      slotUid: 'invalid:999999',
      customerName: 'Invalid Slot Test',
      customerPhone: '+79991234567',
      numberOfSeats: 1,
      prepaymentAmount: 0
    };
    
    const start = Date.now();
    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    const duration = Date.now() - start;
    httpLog.log('POST', '/api/selling/presales', res.status, duration);
    
    console.log('\n[TEST] Invalid slot_uid attempt:', res.status, res.body);
    
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
  
  it('POST /api/selling/presales - reject missing customer name', async () => {
    const payload = {
      slotUid: `manual:${seedData.slots.manual.slot2}`,
      customerPhone: '+79991234567',
      numberOfSeats: 1,  // Missing customerName
      prepaymentAmount: 0
    };
    
    const start = Date.now();
    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    const duration = Date.now() - start;
    httpLog.log('POST', '/api/selling/presales', res.status, duration);
    
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
