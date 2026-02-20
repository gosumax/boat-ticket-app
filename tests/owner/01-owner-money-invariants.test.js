// 01-owner-money-invariants.test.js — инварианты аналитики Owner
// Проверяем, что owner money endpoints корректно считают:
// - MIXED payments (cash/card split)
// - pending_amount vs paid_by_trip_day согласованность
// - compare-days cash + card == revenue
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb, getTableCounts } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { httpLog } from '../_helpers/httpLog.js';
import { getTodayLocal, getTomorrowLocal } from '../_helpers/testDates.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData, sellerToken, ownerToken, ownerUserId;
let today, tomorrow;

beforeAll(async () => {
  httpLog.clear();
  
  // STEP 1: Reset test DB
  resetTestDb();
  
  // STEP 2: Initialize app
  app = await makeApp();
  
  // STEP 3: Get DB connection and seed test data
  db = getTestDb();
  seedData = await seedBasicData(db);
  
  // Get dates using centralized SQLite utility
  today = getTodayLocal(db);
  tomorrow = getTomorrowLocal(db);
  
  // Create owner user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const ownerRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'owner', 1)
  `).run('test_owner', hashedPassword);
  ownerUserId = ownerRes.lastInsertRowid;
  ownerToken = jwt.sign({ id: ownerUserId, username: 'test_owner', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Login sellerA
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'sellerA', password: 'password123' });
  sellerToken = loginRes.body.token;
  
  console.log('[SETUP] today:', today, 'tomorrow:', tomorrow);
});

describe('OWNER MONEY INVARIANTS', () => {
  // Track created presales for cleanup/verification
  let presale1Id, presale2Id;
  
  it('A) MIXED payment: collected_cash + collected_card == collected_total', async () => {
    // Create presale with MIXED payment: cash=1200, card=800, total=2000
    // Use generated slot for tomorrow with explicit tripDate
    // genSlot1 has capacity=2, price=1000 per adult
    // NOTE: business_day will be today (payment date), not trip_date
    const payload = {
      slotUid: `generated:${seedData.slots.generated.genSlot1}`,
      tripDate: tomorrow,
      customerName: 'MIXED Test Customer',
      customerPhone: '+79991111111',
      numberOfSeats: 2,
      prepaymentAmount: 2000,  // 2 seats * 1000 per adult
      payment_method: 'MIXED',
      cash_amount: 1200,
      card_amount: 800
    };
    
    console.log('[TEST A] Creating presale with MIXED payment:', payload);
    
    const presaleRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(payload);
    
    if (presaleRes.status !== 201) {
      throw new Error(`[PRESALE CREATE FAILED] status=${presaleRes.status} body=${JSON.stringify(presaleRes.body)}`);
    }
    presale1Id = presaleRes.body.presale.id;
    console.log('[TEST A] Created presale:', presale1Id, 'total_price:', presaleRes.body.presale.total_price);
    
    // Call owner summary for today (business_day = payment date = today)
    const summaryRes = await request(app)
      .get(`/api/owner/money/summary?from=${today}&to=${today}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    console.log('[TEST A] Summary response:', summaryRes.status, JSON.stringify(summaryRes.body, null, 2));
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.ok).toBe(true);
    
    const totals = summaryRes.body.data.totals;
    
    // STRICT INVARIANT: exact amounts
    expect(Number(totals.cash)).toBe(1200);
    expect(Number(totals.card)).toBe(800);
    expect(Number(totals.collected_total)).toBe(2000);
    expect(Number(totals.cash) + Number(totals.card)).toBe(Number(totals.collected_total));
  });
  
  it('B) pending_amount и paid_by_trip_day согласованы', async () => {
    // Create presale with partial payment: total=5000, paid=2000
    // Use genSlot2 which has capacity=5
    // NOTE: pending_amount and paid_by_trip_day are computed by TRIP DATE, not payment date.
    // The presale has tripDate=tomorrow, so we must query by tomorrow to see pending.
    const payload = {
      slotUid: `generated:${seedData.slots.generated.genSlot2}`,
      tripDate: tomorrow,
      customerName: 'Partial Payment Customer',
      customerPhone: '+79992222222',
      numberOfSeats: 5,
      prepaymentAmount: 2000,  // Partial payment (2000 of 5000)
      payment_method: 'CASH'
    };
      
    console.log('[TEST B] Creating presale with partial payment:', payload);
      
    const presaleRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(payload);
      
    if (presaleRes.status !== 201) {
      throw new Error(`[PRESALE CREATE FAILED] status=${presaleRes.status} body=${JSON.stringify(presaleRes.body)}`);
    }
    presale2Id = presaleRes.body.presale.id;
      
    const totalPrice = presaleRes.body.presale.total_price;
    console.log('[TEST B] Created presale total_price:', totalPrice);
      
    // Call owner summary for TOMORROW (trip_date) to see pending_amount and paid_by_trip_day
    const summaryRes = await request(app)
      .get(`/api/owner/money/summary?from=${tomorrow}&to=${tomorrow}`)
      .set('Authorization', `Bearer ${ownerToken}`);
      
    console.log('[TEST B] Summary response:', summaryRes.status);
    expect(summaryRes.status).toBe(200);
      
    const totals = summaryRes.body.data.totals;
    const paidByTripDay = summaryRes.body.data.paid_by_trip_day;
      
    console.log(`[TEST B] pending_amount: ${totals.pending_amount}, paid_by_trip_day.revenue: ${paidByTripDay?.revenue}`);
      
    // INVARIANT: pending_amount + paid_sum == total_price (by trip date)
    // Test A: total=2000, paid=2000, pending=0
    // Test B: total=5000, paid=2000, pending=3000
    // Both presales have trip_date=tomorrow, so when querying by tomorrow:
    // - pending_amount = 3000 (only Test B has pending)
    // - paid_by_trip_day.revenue = 4000 (both tests paid 2000 each)
    expect(Number(totals.pending_amount)).toBe(3000);
    expect(Number(paidByTripDay.revenue)).toBe(4000);
      
    // Verify response structure
    expect(summaryRes.body.data).toHaveProperty('paid_by_trip_day');
    expect(paidByTripDay).toHaveProperty('revenue');
    expect(paidByTripDay).toHaveProperty('cash');
    expect(paidByTripDay).toHaveProperty('card');
  });
  
  it('C) compare-days: cash + card == revenue per day', async () => {
    // Use existing data from tests A+B (business_day = today, not trip_date)
    const compareRes = await request(app)
      .get('/api/owner/money/compare-days?preset=7d')
      .set('Authorization', `Bearer ${ownerToken}`);
    
    console.log('[TEST C] Compare-days response:', compareRes.status);
    expect(compareRes.status).toBe(200);
    expect(compareRes.body.ok).toBe(true);
    
    const rows = compareRes.body.data?.rows || [];
    console.log('[TEST C] Days with revenue:', rows.length);
    console.log('[TEST C] All days:', rows.map(r => `${r.day}: cash=${r.cash} card=${r.card} rev=${r.revenue}`).join(', '));
    
    // Find today's row (business_day = payment date = today)
    const todayRow = rows.find(r => r.day === today);
    
    expect(todayRow).toBeDefined();
    
    const rowCash = Number(todayRow.cash);
    const rowCard = Number(todayRow.card);
    const rowRevenue = Number(todayRow.revenue);
    
    console.log(`[TEST C] Today: cash(${rowCash}) + card(${rowCard}) = ${rowCash + rowCard} vs revenue(${rowRevenue})`);
    
    // STRICT INVARIANT: cash + card MUST equal revenue
    if (rowCash + rowCard !== rowRevenue) {
      // Diagnostic SQL queries
      const mlRows = db.prepare(`
        SELECT amount, kind, status, business_day
        FROM money_ledger
        WHERE DATE(business_day) = ?
          AND kind = 'SELLER_SHIFT'
          AND status = 'POSTED'
      `).all(today);
      
      const mlSum = mlRows.reduce((sum, r) => sum + Number(r.amount), 0);
      
      const stcRows = db.prepare(`
        SELECT cash_amount, card_amount, business_day, status
        FROM sales_transactions_canonical
        WHERE DATE(business_day) = ?
          AND status = 'VALID'
      `).all(today);
      
      const stcCash = stcRows.reduce((sum, r) => sum + Number(r.cash_amount), 0);
      const stcCard = stcRows.reduce((sum, r) => sum + Number(r.card_amount), 0);
      
      const errorMsg = [
        `INVARIANT VIOLATION: cash + card != revenue`,
        `compare-days row: cash=${rowCash}, card=${rowCard}, revenue=${rowRevenue}, sum=${rowCash + rowCard}`,
        `money_ledger SUM(amount) for ${today}: ${mlSum}`,
        `sales_transactions_canonical for ${today}: cash=${stcCash}, card=${stcCard}, total=${stcCash + stcCard}`,
        `ML rows: ${JSON.stringify(mlRows)}`,
        `STC rows: ${JSON.stringify(stcRows)}`
      ].join('\n');
      
      throw new Error(errorMsg);
    }
    
    expect(rowCash + rowCard).toBe(rowRevenue);
  });
  
  it('Fallback: paid_by_trip_day returns zeros when stc unavailable', async () => {
    // This test verifies the response format even with no data for the preset
    const summaryRes = await request(app)
      .get('/api/owner/money/summary?preset=90d')
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.data).toHaveProperty('paid_by_trip_day');
    
    const paid = summaryRes.body.data.paid_by_trip_day;
    expect(typeof paid.revenue).toBe('number');
    expect(typeof paid.cash).toBe('number');
    expect(typeof paid.card).toBe('number');
    
    console.log('[TEST FALLBACK] 90d preset paid_by_trip_day:', paid);
  });
});
