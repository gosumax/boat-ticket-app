// 04-presale-payment-update.test.js — Update presale payment
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { resetTestDb, getTestDb, getTableCounts } from '../_helpers/dbReset.js';
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
  
  // Create a presale to test payment update
  const presalePayload = {
    slotUid: `manual:${seedData.slots.manual.slot2}`,
    customerName: 'Payment Test Customer',
    customerPhone: '+79991234567',
    numberOfSeats: 1,
    prepaymentAmount: 500
  };
  
  const presaleRes = await request(app)
    .post('/api/selling/presales')
    .set('Authorization', `Bearer ${token}`)
    .send(presalePayload);
  
  if (presaleRes.status !== 201) {
    console.log('\n[SETUP FAIL] Create presale for payment update test');
    console.log('Payload:', JSON.stringify(presalePayload, null, 2));
    console.log('Response:', JSON.stringify(presaleRes.body, null, 2));
    throw new Error(`Presale creation failed with status ${presaleRes.status}`);
  }
  
  presaleId = presaleRes.body.presale.id;
});

describe('SELLER PRESALE PAYMENT UPDATE', () => {
  it('PATCH /api/selling/presales/:id/payment - update payment', async () => {
    console.log('[TEST DEBUG] Starting payment update test with presaleId:', presaleId);
    
    const countsBefore = getTableCounts(db);
    
    const payload = {
      additionalPayment: 500  // API expects additionalPayment, not prepaymentAmount
    };
    
    const start = Date.now();
    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    const duration = Date.now() - start;
    httpLog.log('PATCH', `/api/selling/presales/${presaleId}/payment`, res.status, duration);
    
    console.log('[TEST DEBUG] Response status:', res.status);
    console.log('[TEST DEBUG] Response body:', JSON.stringify(res.body, null, 2));
    
    if (res.status !== 200) {
      console.log('\n[TEST FAIL] Payment update');
      console.log('Payload:', JSON.stringify(payload, null, 2));
      console.log('Response:', JSON.stringify(res.body, null, 2));
    }
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    
    const countsAfter = getTableCounts(db);
    console.log('\n[DB CHANGES] money_ledger:', countsBefore.money_ledger, '->', countsAfter.money_ledger);
  });
  
  it('PATCH /api/selling/presales/:id/payment - reject overpayment', async () => {
    // After first test, presale is fully paid (remaining_amount = 0)
    // Attempting another payment should be rejected as overpayment
    const payload = {
      additionalPayment: 200  // Would exceed total_price
    };
    
    const start = Date.now();
    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    const duration = Date.now() - start;
    httpLog.log('PATCH', `/api/selling/presales/${presaleId}/payment`, res.status, duration);
    
    console.log('[PAY1]', res.status, res.body);
    
    // Second identical payment (should also be rejected)
    const start2 = Date.now();
    const res2 = await request(app)
      .patch(`/api/selling/presales/${presaleId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    const duration2 = Date.now() - start2;
    httpLog.log('PATCH', `/api/selling/presales/${presaleId}/payment`, res2.status, duration2);
    
    console.log('[PAY2]', res2.status, res2.body);
    
    // Expect overpayment prevention
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/exceed|баланс/i);
  });
});
