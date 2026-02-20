// 10-seller-ui-scenarios-pricing.test.js — Test seller UI scenarios: ticket categories, totals, prepayment
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { resetTestDb, getTestDb, getTableCounts } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { httpLog } from '../_helpers/httpLog.js';

let app, db, seedData, token, slotUid, priceAdult, priceTeen, priceChild;

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
  
  // Use slot9 (manual slot with capacity 10 for multiple tests)
  // From seedBasic.js: slot9 has price_adult=1000, price_child=500, price_teen=750
  slotUid = `manual:${seedData.slots.manual.slot9}`;
  priceAdult = 1000;
  priceChild = 500;
  priceTeen = 750;
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

describe('SELLER UI SCENARIOS - PRICING & CATEGORIES', () => {
  // CASE A: 1 adult, prepayment 0
  it('A: 1 adult, prepayment 0', async () => {
    const payload = {
      slotUid,
      customerName: 'Customer A',
      customerPhone: '+79990000001',
      numberOfSeats: 1,
      tickets: { adult: 1, teen: 0, child: 0 },
      prepaymentAmount: 0
    };
    
    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    
    // Log response shape once for debugging
    console.log('[CASE A] Response shape:', JSON.stringify(res.body, null, 2));
    
    expect(res.status).toBe(201);
    expect(res.body.presale).toHaveProperty('id');
    expect(res.body.presale.number_of_seats).toBe(1);
    expect(res.body.presale.total_price).toBe(priceAdult);
    expect(res.body.presale.prepayment_amount).toBe(0);
    expect(res.body.presale.remaining_amount).toBe(priceAdult);
    
    // Get tickets
    const presaleId = res.body.presale.id;
    const ticketsRes = await request(app)
      .get(`/api/selling/presales/${presaleId}/tickets`)
      .set('Authorization', `Bearer ${token}`);
    
    console.log('[CASE A] Tickets:', JSON.stringify(ticketsRes.body, null, 2));
    
    expect(ticketsRes.status).toBe(200);
    expect(Array.isArray(ticketsRes.body)).toBe(true);
    expect(ticketsRes.body.length).toBe(1);
    expect(ticketsRes.body[0].price).toBe(priceAdult);
  });
  
  // CASE B: 1 child, prepayment 0
  it('B: 1 child, prepayment 0', async () => {
    const payload = {
      slotUid,
      customerName: 'Customer B',
      customerPhone: '+79990000002',
      numberOfSeats: 1,
      tickets: { adult: 0, teen: 0, child: 1 },
      prepaymentAmount: 0
    };
    
    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    
    expect(res.status).toBe(201);
    expect(res.body.presale.number_of_seats).toBe(1);
    expect(res.body.presale.total_price).toBe(priceChild);
    expect(res.body.presale.prepayment_amount).toBe(0);
    expect(res.body.presale.remaining_amount).toBe(priceChild);
    
    // Get tickets
    const presaleId = res.body.presale.id;
    const ticketsRes = await request(app)
      .get(`/api/selling/presales/${presaleId}/tickets`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(ticketsRes.status).toBe(200);
    expect(ticketsRes.body.length).toBe(1);
    expect(ticketsRes.body[0].price).toBe(priceChild);
  });
  
  // CASE C: 1 teen, prepayment 0
  it('C: 1 teen, prepayment 0', async () => {
    const payload = {
      slotUid,
      customerName: 'Customer C',
      customerPhone: '+79990000003',
      numberOfSeats: 1,
      tickets: { adult: 0, teen: 1, child: 0 },
      prepaymentAmount: 0
    };
    
    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    
    expect(res.status).toBe(201);
    expect(res.body.presale.number_of_seats).toBe(1);
    expect(res.body.presale.total_price).toBe(priceTeen);
    expect(res.body.presale.prepayment_amount).toBe(0);
    expect(res.body.presale.remaining_amount).toBe(priceTeen);
    
    // Get tickets
    const presaleId = res.body.presale.id;
    const ticketsRes = await request(app)
      .get(`/api/selling/presales/${presaleId}/tickets`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(ticketsRes.status).toBe(200);
    expect(ticketsRes.body.length).toBe(1);
    expect(ticketsRes.body[0].price).toBe(priceTeen);
  });
  
  // CASE D: adult+teen (1+1), prepayment 500
  it('D: adult+teen (1+1), prepayment 500', async () => {
    const payload = {
      slotUid,
      customerName: 'Customer D',
      customerPhone: '+79990000004',
      numberOfSeats: 2,
      tickets: { adult: 1, teen: 1, child: 0 },
      prepaymentAmount: 500
    };
    
    const expectedTotal = priceAdult + priceTeen; // 1000 + 750 = 1750
    const expectedRemaining = expectedTotal - 500; // 1250
    
    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    
    expect(res.status).toBe(201);
    expect(res.body.presale.number_of_seats).toBe(2);
    expect(res.body.presale.total_price).toBe(expectedTotal);
    expect(res.body.presale.prepayment_amount).toBe(500);
    expect(res.body.presale.remaining_amount).toBe(expectedRemaining);
    
    // Get tickets
    const presaleId = res.body.presale.id;
    const ticketsRes = await request(app)
      .get(`/api/selling/presales/${presaleId}/tickets`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(ticketsRes.status).toBe(200);
    expect(ticketsRes.body.length).toBe(2);
    
    // Check each ticket price matches its category
    const prices = ticketsRes.body.map(t => t.price).sort((a, b) => a - b);
    expect(prices).toEqual([priceTeen, priceAdult].sort((a, b) => a - b));
  });
  
  // CASE E: teen+child (1+1), prepayment 1000
  it('E: teen+child (1+1), prepayment 1000', async () => {
    const payload = {
      slotUid,
      customerName: 'Customer E',
      customerPhone: '+79990000005',
      numberOfSeats: 2,
      tickets: { adult: 0, teen: 1, child: 1 },
      prepaymentAmount: 1000
    };
    
    const expectedTotal = priceTeen + priceChild; // 750 + 500 = 1250
    const expectedRemaining = expectedTotal - 1000; // 250
    
    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    
    expect(res.status).toBe(201);
    expect(res.body.presale.number_of_seats).toBe(2);
    expect(res.body.presale.total_price).toBe(expectedTotal);
    expect(res.body.presale.prepayment_amount).toBe(1000);
    expect(res.body.presale.remaining_amount).toBe(expectedRemaining);
    
    // Get tickets
    const presaleId = res.body.presale.id;
    const ticketsRes = await request(app)
      .get(`/api/selling/presales/${presaleId}/tickets`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(ticketsRes.status).toBe(200);
    expect(ticketsRes.body.length).toBe(2);
    
    const prices = ticketsRes.body.map(t => t.price).sort((a, b) => a - b);
    expect(prices).toEqual([priceChild, priceTeen].sort((a, b) => a - b));
  });
  
  // CASE F: adult+teen+child (1+1+1), prepayment chips (500 then +500)
  it('F: adult+teen+child (1+1+1), prepayment 500 then +500', async () => {
    const payload = {
      slotUid,
      customerName: 'Customer F',
      customerPhone: '+79990000006',
      numberOfSeats: 3,
      tickets: { adult: 1, teen: 1, child: 1 },
      prepaymentAmount: 500
    };
    
    const expectedTotal = priceAdult + priceTeen + priceChild; // 1000 + 750 + 500 = 2250
    
    // Step 1: Create with prepayment 500
    const res = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    
    expect(res.status).toBe(201);
    expect(res.body.presale.total_price).toBe(expectedTotal);
    expect(res.body.presale.prepayment_amount).toBe(500);
    expect(res.body.presale.remaining_amount).toBe(expectedTotal - 500);
    
    const presaleId = res.body.presale.id;
    
    // Step 2: Add additional payment 500
    const paymentRes = await request(app)
      .patch(`/api/selling/presales/${presaleId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ additionalPayment: 500 });
    
    expect(paymentRes.status).toBe(200);
    expect(paymentRes.body.prepayment_amount).toBe(1000); // 500 + 500
    expect(paymentRes.body.remaining_amount).toBe(expectedTotal - 1000);
    
    // Step 3: Try to overpay (should reject)
    const overpayRes = await request(app)
      .patch(`/api/selling/presales/${presaleId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ additionalPayment: 2000 }); // Exceeds remaining
    
    expect(overpayRes.status).toBe(400);
    expect(overpayRes.body).toHaveProperty('error');
  });
  
  // CASE G: Cancel presale
  it('G: Cancel presale', async () => {
    // Create presale
    const payload = {
      slotUid,
      customerName: 'Customer G',
      customerPhone: '+79990000007',
      numberOfSeats: 1,
      tickets: { adult: 1, teen: 0, child: 0 },
      prepaymentAmount: 500
    };
    
    const createRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    
    expect(createRes.status).toBe(201);
    const presaleId = createRes.body.presale.id;
    
    // Cancel presale
    const cancelRes = await request(app)
      .patch(`/api/selling/presales/${presaleId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body).toHaveProperty('ok');
    expect(cancelRes.body.status).toBe('CANCELLED');
    
    // Verify DB state
    const presaleRow = db.prepare('SELECT id, status FROM presales WHERE id = ?').get(presaleId);
    expect(presaleRow.status).toBe('CANCELLED');
  });
});
