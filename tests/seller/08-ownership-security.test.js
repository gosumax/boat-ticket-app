// 08-ownership-security.test.js — Test presale ownership security
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { httpLog } from '../_helpers/httpLog.js';

let app, db, seedData, tokenA, tokenB, presaleIdA;

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
  const loginResA = await request(app)
    .post('/api/auth/login')
    .send({ username: 'sellerA', password: 'password123' });
  tokenA = loginResA.body.token;
  
  // Login sellerB
  const loginResB = await request(app)
    .post('/api/auth/login')
    .send({ username: 'sellerB', password: 'password123' });
  tokenB = loginResB.body.token;
  
  // Create presale with sellerA
  const presalePayload = {
    slotUid: `manual:${seedData.slots.manual.slot7}`,
    customerName: 'Security Test Customer',
    customerPhone: '+79991234567',
    numberOfSeats: 1,
    prepaymentAmount: 500
  };
  
  const presaleRes = await request(app)
    .post('/api/selling/presales')
    .set('Authorization', `Bearer ${tokenA}`)
    .send(presalePayload);
  
  if (presaleRes.status !== 201) {
    console.log('\n[SETUP FAIL] Create presale for security test');
    console.log('Payload:', JSON.stringify(presalePayload, null, 2));
    console.log('Response:', JSON.stringify(presaleRes.body, null, 2));
  }
  
  presaleIdA = presaleRes.body.presale.id;
});

describe('SELLER OWNERSHIP SECURITY', () => {
  it('PATCH /api/selling/presales/:id/payment - sellerB cannot update sellerA presale', async () => {
    const payload = {
      additionalPayment: 500  // API expects additionalPayment
    };
    
    const start = Date.now();
    const res = await request(app)
      .patch(`/api/selling/presales/${presaleIdA}/payment`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send(payload);
    const duration = Date.now() - start;
    httpLog.log('PATCH', `/api/selling/presales/${presaleIdA}/payment`, res.status, duration);
    
    console.log('\n[TEST] Cross-seller payment attempt:', res.status, res.body);
    
    expect(res.status).toBe(403);
  });
  
  it('PATCH /api/selling/presales/:id/cancel - sellerB cannot cancel sellerA presale', async () => {
    const start = Date.now();
    const res = await request(app)
      .patch(`/api/selling/presales/${presaleIdA}/cancel`)
      .set('Authorization', `Bearer ${tokenB}`);
    const duration = Date.now() - start;
    httpLog.log('PATCH', `/api/selling/presales/${presaleIdA}/cancel`, res.status, duration);
    
    console.log('\n[TEST] Cross-seller cancel attempt:', res.status, res.body);
    
    expect(res.status).toBe(403);
  });
  
  it('PATCH /api/selling/presales/:id/transfer - sellerB cannot transfer sellerA presale', async () => {
    console.log('[B] token ok');
    
    // Check DB state before transfer attempt
    const rowBefore = db.prepare('SELECT id, seller_id, slot_uid FROM presales WHERE id = ?').get(presaleIdA);
    console.log('[DB presale before transfer]', rowBefore);
    
    const payload = {
      to_slot_uid: `manual:${seedData.slots.manual.slot3}`  // API expects to_slot_uid
    };
    
    const start = Date.now();
    const res = await request(app)
      .patch(`/api/selling/presales/${presaleIdA}/transfer`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send(payload);
    const duration = Date.now() - start;
    httpLog.log('PATCH', `/api/selling/presales/${presaleIdA}/transfer`, res.status, duration);
    
    console.log('[B] transfer', res.status, res.body);
    
    // Check DB state after transfer attempt
    const rowAfter = db.prepare('SELECT id, seller_id, slot_uid FROM presales WHERE id = ?').get(presaleIdA);
    console.log('[DB presale after transfer]', rowAfter);
    
    expect(res.status).toBe(403);
  });
});
