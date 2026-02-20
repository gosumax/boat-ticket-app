// 06-presale-transfer.test.js — Transfer presale to another slot
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { httpLog } from '../_helpers/httpLog.js';

let app, db, seedData, token, presaleId;

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
  
  // Create a presale to transfer
  const presalePayload = {
    slotUid: `manual:${seedData.slots.manual.slot4}`,
    customerName: 'Transfer Test Customer',
    customerPhone: '+79991234567',
    numberOfSeats: 1,
    prepaymentAmount: 500
  };
  
  const presaleRes = await request(app)
    .post('/api/selling/presales')
    .set('Authorization', `Bearer ${token}`)
    .send(presalePayload);
  
  if (presaleRes.status !== 201) {
    console.log('\n[SETUP FAIL] Create presale for transfer test');
    console.log('Payload:', JSON.stringify(presalePayload, null, 2));
    console.log('Response:', JSON.stringify(presaleRes.body, null, 2));
  }
  
  presaleId = presaleRes.body.presale.id;
});

describe('SELLER PRESALE TRANSFER', () => {
  it('PATCH /api/selling/presales/:id/transfer - transfer to another slot', async () => {
    const payload = {
      to_slot_uid: `manual:${seedData.slots.manual.slot5}`  // API expects to_slot_uid
    };
    
    const start = Date.now();
    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/transfer`)
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    const duration = Date.now() - start;
    httpLog.log('PATCH', `/api/selling/presales/${presaleId}/transfer`, res.status, duration);
    
    if (res.status !== 200) {
      console.log('\n[TEST FAIL] Transfer presale');
      console.log('Payload:', JSON.stringify(payload, null, 2));
      console.log('Response:', JSON.stringify(res.body, null, 2));
    }
    
    expect(res.status).toBe(200);
  });
  
  it('PATCH /api/selling/presales/:id/transfer - reject transfer to full slot', async () => {
    // Create presale that fills slot1 (capacity 2)
    const fillPayload = {
      slotUid: `manual:${seedData.slots.manual.slot1}`,
      customerName: 'Fill Slot Customer',
      customerPhone: '+79991111111',
      numberOfSeats: 2,
      prepaymentAmount: 0
    };
    
    const fillRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(fillPayload);
    
    // Try to transfer another presale into full slot
    const transferPayload = {
      to_slot_uid: `manual:${seedData.slots.manual.slot1}`  // API expects to_slot_uid
    };
    
    const start = Date.now();
    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/transfer`)
      .set('Authorization', `Bearer ${token}`)
      .send(transferPayload);
    const duration = Date.now() - start;
    httpLog.log('PATCH', `/api/selling/presales/${presaleId}/transfer`, res.status, duration);
    
    console.log('\n[TEST] Transfer to full slot response:', res.status, res.body);
    
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
