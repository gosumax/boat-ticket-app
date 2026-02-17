// 07-presale-tickets.test.js — Fetch tickets for presale
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { getTestDb } from '../_helpers/dbReset.js';
import { loadSeedData } from '../_helpers/loadSeedData.js';
import { makeApp } from '../_helpers/makeApp.js';
import { httpLog } from '../_helpers/httpLog.js';

let app, db, seedData, token, presaleId;

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
  
  // Create a presale
  const presalePayload = {
    slotUid: `manual:${seedData.slots.manual.slot6}`,
    customerName: 'Tickets Test Customer',
    customerPhone: '+79991234567',
    numberOfSeats: 3,
    prepaymentAmount: 1000
  };
  
  const presaleRes = await request(app)
    .post('/api/selling/presales')
    .set('Authorization', `Bearer ${token}`)
    .send(presalePayload);
  
  if (presaleRes.status !== 201) {
    console.log('\n[SETUP FAIL] Create presale for tickets test');
    console.log('Payload:', JSON.stringify(presalePayload, null, 2));
    console.log('Response:', JSON.stringify(presaleRes.body, null, 2));
  }
  
  presaleId = presaleRes.body.presale.id;
});

describe('SELLER PRESALE TICKETS', () => {
  it('GET /api/selling/presales/:id/tickets - fetch tickets for presale', async () => {
    const start = Date.now();
    const res = await request(app)
      .get(`/api/selling/presales/${presaleId}/tickets`)
      .set('Authorization', `Bearer ${token}`);
    const duration = Date.now() - start;
    httpLog.log('GET', `/api/selling/presales/${presaleId}/tickets`, res.status, duration);
    
    console.log('\n[TEST] Tickets response:', JSON.stringify(res.body, null, 2));
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
