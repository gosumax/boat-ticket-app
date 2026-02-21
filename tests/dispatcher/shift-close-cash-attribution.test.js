// shift-close-cash-attribution.test.js — Regression test for cash attribution bug
// Scenario:
//   1. Seller creates presale with partial prepayment (1000 CASH of 3000 total)
//   2. Dispatcher accepts remaining payment (2000 CASH)
//   3. Dispatcher calls GET /api/dispatcher/shift-ledger/summary?business_day=...
//   4. ASSERT: seller.accepted should be 1000 (only what seller took)
//      BUG: Currently shows 3000 (dispatcher's doplata is attributed to seller)
//   5. ASSERT: collected_total should be 3000 (day sees all payments)
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
let sellerToken, sellerId;
let dispatcherToken, dispatcherId;
let today, tomorrow;

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
  tomorrow = getTomorrowLocal(db);
  
  // Get seller from seedData
  sellerId = seedData.users.sellerA.id;
  
  // Login sellerA
  const sellerLoginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'sellerA', password: 'password123' });
  sellerToken = sellerLoginRes.body.token;
  
  // Create dispatcher user (seedData creates dispatcher1, but we need a fresh one)
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_cash', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_cash', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  console.log('[SETUP] today:', today, 'tomorrow:', tomorrow);
  console.log('[SETUP] sellerId:', sellerId, 'dispatcherId:', dispatcherId);
  console.log('[SETUP] genSlot1:', seedData.slots.generated.genSlot1);
});

describe('DISPATCHER SHIFT CLOSE: CASH ATTRIBUTION BUG', () => {
  it('seller.accepted should equal ONLY seller-collected prepayment, NOT dispatcher doplata', async () => {
    // STEP 1: Seller creates presale with partial prepayment
    // total_price = 3000 (3 adult tickets at 1000 each)
    // prepayment = 1000 (CASH)
    // Use genSlot2 which has capacity=5
    const presalePayload = {
      slotUid: `generated:${seedData.slots.generated.genSlot2}`,
      tripDate: tomorrow,
      customerName: 'Cash Attribution Test Customer',
      customerPhone: '+79998887766',
      numberOfSeats: 3,  // 3 * 1000 = 3000 total
      prepaymentAmount: 1000,  // Partial prepayment
      payment_method: 'CASH'
    };
    
    console.log('[STEP 1] Seller creating presale:', presalePayload);
    
    const presaleRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(presalePayload);
    
    if (presaleRes.status !== 201) {
      throw new Error(`[PRESALE CREATE FAILED] status=${presaleRes.status} body=${JSON.stringify(presaleRes.body)}`);
    }
    
    const presaleId = presaleRes.body.presale.id;
    const totalPrice = presaleRes.body.presale.total_price;
    const prepaymentAmount = presaleRes.body.presale.prepayment_amount;
    
    console.log('[STEP 1] Created presale:', presaleId, 'total_price:', totalPrice, 'prepayment:', prepaymentAmount);
    
    expect(presaleRes.status).toBe(201);
    expect(totalPrice).toBe(3000);
    expect(prepaymentAmount).toBe(1000);
    
    // STEP 2: Dispatcher accepts remaining payment (2000 CASH)
    const acceptPayload = {
      payment_method: 'CASH'
    };
    
    console.log('[STEP 2] Dispatcher accepting remaining payment:', acceptPayload);
    
    const acceptRes = await request(app)
      .patch(`/api/selling/presales/${presaleId}/accept-payment`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send(acceptPayload);
    
    console.log('[STEP 2] Accept payment response:', acceptRes.status, acceptRes.body);
    
    expect(acceptRes.status).toBe(200);
    
    // Verify presale is fully paid
    const updatedPresale = db.prepare('SELECT total_price, prepayment_amount FROM presales WHERE id = ?').get(presaleId);
    console.log('[STEP 2] Updated presale:', updatedPresale);
    expect(updatedPresale.prepayment_amount).toBe(updatedPresale.total_price);
    
    // STEP 3: Dispatcher calls shift-ledger summary
    // IMPORTANT: business_day semantics:
    // - Seller's prepayment money_ledger entry has business_day = TODAY (payment date)
    // - Dispatcher's accept-payment entry has business_day = presale.business_day = TRIP_DATE (tomorrow)
    // 
    // BUG: The dispatcher's accept-payment incorrectly attributes to the seller's balance.
    // To see this bug, we need to query by the presale's business_day (trip_date), not today.
    // 
    // But actually, let's query by TODAY first to see the prepayment only.
    // Then query by presale's business_day to see if dispatcher's payment is attributed to seller.
    
    // Get presale's business_day (should be trip_date = tomorrow)
    const presaleRow = db.prepare('SELECT business_day FROM presales WHERE id = ?').get(presaleId);
    const presaleBusinessDay = presaleRow?.business_day || today;
    console.log('[STEP 3] Presale business_day:', presaleBusinessDay, 'today:', today);
    
    // First, check today's summary (should show only seller's prepayment)
    const summaryTodayRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${today}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    console.log('[STEP 3a] Today summary response:', summaryTodayRes.status);
    console.log('[STEP 3a] Today summary body:', JSON.stringify(summaryTodayRes.body, null, 2));
    
    expect(summaryTodayRes.status).toBe(200);
    expect(summaryTodayRes.body.ok).toBe(true);
    
    const sellersToday = summaryTodayRes.body.sellers || [];
    const sellerEntryToday = sellersToday.find(s => Number(s.seller_id) === Number(sellerId));
    const sellerAcceptedToday = Number(sellerEntryToday?.accepted || 0);
    
    console.log('[STEP 3a] Today: seller.accepted =', sellerAcceptedToday);
    
    // TODAY: seller should only have their prepayment (dispatcher's entry has different business_day)
    expect(sellerAcceptedToday).toBe(1000);
    expect(Number(summaryTodayRes.body.collected_total || 0)).toBe(1000);
    
    // Now check the presale's business_day summary (should show dispatcher's payment attributed to seller - BUG!)
    const summaryPresaleDayRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${presaleBusinessDay}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    console.log('[STEP 3b] Presale business_day summary response:', summaryPresaleDayRes.status);
    console.log('[STEP 3b] Presale business_day summary body:', JSON.stringify(summaryPresaleDayRes.body, null, 2));
    
    expect(summaryPresaleDayRes.status).toBe(200);
    expect(summaryPresaleDayRes.ok).toBe(true);
    
    // STEP 4: Find seller entry in sellers[] for presale's business_day
    const sellers = summaryPresaleDayRes.body.sellers || [];
    console.log('[STEP 4] Sellers array:', JSON.stringify(sellers, null, 2));
    
    const sellerEntry = sellers.find(s => Number(s.seller_id) === Number(sellerId));
    
    console.log('[STEP 4] Found seller entry:', sellerEntry);
    
    // ASSERTION 1: seller.accepted should be 0 (seller didn't collect on trip_date)
    // BUG: Currently shows 2000 because dispatcher's doplata is attributed to seller
    const sellerAccepted = Number(sellerEntry?.accepted || 0);
    
    console.log('[ASSERTION 1] seller.accepted =', sellerAccepted, 'expected = 0 (BUG: shows 2000)');
    
    // The BUG is that dispatcher's payment is attributed to seller (seller_id from presale),
    // not to dispatcher. So seller.accepted should be 0 (seller didn't collect on trip_date),
    // but it shows 2000 (dispatcher's payment).
    expect(sellerAccepted).toBe(0);  // BUG: will fail with 2000
    
    // ASSERTION 2: collected_total should be 2000 (dispatcher's payment on trip_date)
    const collectedTotal = Number(summaryPresaleDayRes.body.collected_total || 0);
    
    console.log('[ASSERTION 2] collected_total =', collectedTotal, 'expected = 2000');
    
    expect(collectedTotal).toBe(2000);
    
    console.log('[TEST COMPLETE] If you see this, the bug is fixed!');
    console.log('[EXPLANATION] The bug is: when dispatcher calls accept-payment, the money_ledger entry');
    console.log('[EXPLANATION] has seller_id from presale (original seller), not dispatcher who actually collected.');
  });
});
