// 05-presale-cancel.test.js — Cancel presale
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
  
  // Create a presale to cancel
  const presalePayload = {
    slotUid: `manual:${seedData.slots.manual.slot3}`,
    customerName: 'Cancel Test Customer',
    customerPhone: '+79991234567',
    numberOfSeats: 1,
    prepaymentAmount: 500
  };
  
  const presaleRes = await request(app)
    .post('/api/selling/presales')
    .set('Authorization', `Bearer ${token}`)
    .send(presalePayload);
  
  if (presaleRes.status !== 201) {
    console.log('\n[SETUP FAIL] Create presale for cancel test');
    console.log('Payload:', JSON.stringify(presalePayload, null, 2));
    console.log('Response:', JSON.stringify(presaleRes.body, null, 2));
  }
  
  presaleId = presaleRes.body.presale.id;
});

describe('SELLER PRESALE CANCEL', () => {
  it('PATCH /api/selling/presales/:id/cancel - cancel presale', async () => {
    const countsBefore = getTableCounts(db);
    
    const start = Date.now();
    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    const duration = Date.now() - start;
    httpLog.log('PATCH', `/api/selling/presales/${presaleId}/cancel`, res.status, duration);
    
    console.log('\n[TEST] Cancel response:', JSON.stringify(res.body, null, 2));
    
    expect(res.status).toBe(200);
    
    const countsAfter = getTableCounts(db);
    console.log('\n[DB CHANGES] presales:', countsBefore.presales, '->', countsAfter.presales);
    console.log('[DB CHANGES] sales_transactions:', countsBefore.sales_transactions_canonical, '->', countsAfter.sales_transactions_canonical);
  });
  
  it('PATCH /api/selling/presales/:id/cancel - idempotent (cancel twice)', async () => {
    const countsBefore = getTableCounts(db);
    
    const start = Date.now();
    const res = await request(app)
      .patch(`/api/selling/presales/${presaleId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    const duration = Date.now() - start;
    httpLog.log('PATCH', `/api/selling/presales/${presaleId}/cancel`, res.status, duration);
    
    // Should either succeed again or return acceptable status (not create duplicate reverse)
    expect([200, 400, 409]).toContain(res.status);
    
    const countsAfter = getTableCounts(db);
    // Verify no duplicate reverse entries
    expect(countsAfter.sales_transactions_canonical).toBe(countsBefore.sales_transactions_canonical);
  });
});
