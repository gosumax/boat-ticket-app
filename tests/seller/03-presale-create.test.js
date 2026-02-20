// 03-presale-create.test.js — Create presale as seller
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { resetTestDb, getTestDb, getTableCounts } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { httpLog } from '../_helpers/httpLog.js';

let app, db, seedData, token;

beforeAll(async () => {
  httpLog.clear();
  
  // STEP 1: Reset test DB (delete + recreate from schema_prod.sql)
  resetTestDb();
  
  // STEP 2: Initialize app (imports server/db.js which will create tables)
  app = await makeApp();
  
  // STEP 3: Get DB connection and seed test data
  db = getTestDb();
  seedData = await seedBasicData(db);
  
  // Login sellerA
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'sellerA', password: 'password123' });
  token = loginRes.body.token;
});

afterAll(() => {
  httpLog.printSummary();
  
  console.log('\n========================================');
  console.log('DB EFFECTS SUMMARY');
  console.log('========================================');
  const counts = getTableCounts(db);
  console.table(counts);
  console.log('========================================\n');
});

describe('SELLER PRESALE CREATE', () => {
  it('POST /api/selling/presales - create presale on manual slot', async () => {
    const countsBefore = getTableCounts(db);
    
    const payload = {
      slotUid: `manual:${seedData.slots.manual.slot2}`,
      customerName: 'Test Customer',
      customerPhone: '+79991234567',
      numberOfSeats: 2,  // Use numberOfSeats instead of tickets breakdown
      prepaymentAmount: 500,
      prepaymentComment: 'Partial payment'
    };
    
    const start = Date.now();
    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    const duration = Date.now() - start;
    httpLog.log('POST', '/api/selling/presales', res.status, duration);
    
    if (res.status !== 201) {
      console.log('\n[TEST FAIL] Create presale on manual slot');
      console.log('Payload sent:', JSON.stringify(payload, null, 2));
      console.log('Response:', JSON.stringify(res.body, null, 2));
    }
    
    expect(res.status).toBe(201);
    expect(res.body.presale).toHaveProperty('id');
    expect(res.body.presale.customer_name).toBe('Test Customer');
    expect(res.body.presale.total_price).toBeGreaterThan(0);
    
    const countsAfter = getTableCounts(db);
    console.log('\n[DB CHANGES] presales:', countsBefore.presales, '->', countsAfter.presales);
    expect(countsAfter.presales).toBe(countsBefore.presales + 1);
  });
  
  it('POST /api/selling/presales - create presale on generated slot', async () => {
    const payload = {
      slotUid: `generated:${seedData.slots.generated.genSlot2}`,
      customerName: 'Customer 2',
      customerPhone: '+79997654321',
      numberOfSeats: 2,
      prepaymentAmount: 2000,
      tripDate: seedData.slots.generated.tomorrow
    };
    
    const start = Date.now();
    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    const duration = Date.now() - start;
    httpLog.log('POST', '/api/selling/presales', res.status, duration);
    
    if (res.status !== 201) {
      console.log('\n[TEST FAIL] Create presale on generated slot');
      console.log('Payload sent:', JSON.stringify(payload, null, 2));
      console.log('Response:', JSON.stringify(res.body, null, 2));
    }
    
    expect(res.status).toBe(201);
    expect(res.body.presale.customer_name).toBe('Customer 2');
  });
  
  it('POST /api/selling/presales - reject overbooking', async () => {
    // Slot1 has capacity 2, try to book 3 seats
    const payload = {
      slotUid: `manual:${seedData.slots.manual.slot1}`,
      customerName: 'Overbook Test',
      customerPhone: '+79991111111',
      numberOfSeats: 3,
      prepaymentAmount: 0
    };
    
    const start = Date.now();
    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    const duration = Date.now() - start;
    httpLog.log('POST', '/api/selling/presales', res.status, duration);
    
    console.log('\n[TEST] Overbook attempt response:', res.status, res.body);
    
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
