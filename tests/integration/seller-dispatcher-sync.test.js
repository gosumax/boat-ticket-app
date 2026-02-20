// seller-dispatcher-sync.test.js — Integration test: seller sale syncs to dispatcher view via DB
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { loadSeedData } from '../_helpers/loadSeedData.js';
import { makeApp } from '../_helpers/makeApp.js';

describe('INTEGRATION: seller → dispatcher sync', () => {
  let app, db, seedData;
  let sellerToken, dispatcherToken;
  let slotUid, initialSeatsLeft;
  let sellerAId, dispatcherId; // Actual IDs from DB

  beforeAll(async () => {
    // Reset DB and re-seed for clean state
    resetTestDb();
    db = getTestDb();
    const freshSeedData = await seedBasicData(db);
    db.close();
    
    // Reopen after seed
    db = getTestDb();
    seedData = loadSeedData();
    
    // Get actual IDs from fresh seed data
    sellerAId = freshSeedData.users.sellerA.id;
    dispatcherId = freshSeedData.users.dispatcher.id;
    console.log('[TEST] Fresh IDs - sellerA:', sellerAId, 'dispatcher:', dispatcherId);
    
    app = await makeApp();
    
    // Verify slot capacity
    const slotRow = db.prepare('SELECT seats_left, capacity FROM boat_slots WHERE id = ?').get(seedData.slots.manual.slot9);
    console.log('[TEST] Slot9 state - seats_left:', slotRow.seats_left, 'capacity:', slotRow.capacity);
    initialSeatsLeft = slotRow.seats_left;

    // 1. Login seller
    const sellerLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'sellerA', password: 'password123' });
    sellerToken = sellerLogin.body.token;
    
    if (!sellerToken) {
      throw new Error('Failed to login sellerA: ' + JSON.stringify(sellerLogin.body));
    }

    // 2. Login dispatcher
    const dispatcherLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dispatcher1', password: 'password123' });
    dispatcherToken = dispatcherLogin.body.token;
    
    if (!dispatcherToken) {
      throw new Error('Failed to login dispatcher1: ' + JSON.stringify(dispatcherLogin.body));
    }

    // 3. Use manual slot9 (capacity 15)
    slotUid = `manual:${seedData.slots.manual.slot9}`;
  });

  it('Seller sale must reflect in DB (presales, tickets, slot inventory)', async () => {
    // ====================================================
    // A) SELLER CREATES PRESALE
    // ====================================================
    const create = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        slotUid,
        customerName: 'Sync Test Customer',
        customerPhone: '+79990000099',
        numberOfSeats: 4,
        tickets: { adult: 2, teen: 0, child: 2 },
        prepaymentAmount: 1000,
        tripDate: new Date().toISOString().split('T')[0] // Add tripDate for manual slot
      });

    expect(create.status).toBe(201);

    const presaleId = create.body.presale.id;
    const totalPrice = create.body.presale.total_price;
    const prepaymentAmount = 1000;
    const remaining = totalPrice - prepaymentAmount;

    expect(totalPrice).toBeGreaterThan(0);
    expect(remaining).toBe(totalPrice - prepaymentAmount);

    // ====================================================
    // B) VERIFY DB STATE: presales table
    // ====================================================
    const presaleRow = db.prepare(`
      SELECT id, number_of_seats, total_price, prepayment_amount, status, seller_id
      FROM presales
      WHERE id = ?
    `).get(presaleId);

    expect(presaleRow).toBeDefined();
    expect(presaleRow.number_of_seats).toBe(4);
    expect(presaleRow.total_price).toBe(totalPrice);
    expect(presaleRow.prepayment_amount).toBe(prepaymentAmount);
    expect(presaleRow.status).toBe('ACTIVE');
    expect(presaleRow.seller_id).toBe(sellerAId); // sellerA id

    // Compute remaining from DB
    const dbRemaining = presaleRow.total_price - presaleRow.prepayment_amount;
    expect(dbRemaining).toBe(remaining);

    // ====================================================
    // C) VERIFY DB STATE: tickets table
    // ====================================================
    const tickets = db.prepare(`
      SELECT id, presale_id, price, status
      FROM tickets
      WHERE presale_id = ?
    `).all(presaleId);

    expect(tickets.length).toBe(4);

    // All tickets should be ACTIVE
    tickets.forEach(ticket => {
      expect(ticket.status).toBe('ACTIVE');
      expect(ticket.presale_id).toBe(presaleId);
      expect(ticket.price).toBeGreaterThan(0);
    });

    // Sum of ticket prices should equal total_price
    const ticketSum = tickets.reduce((sum, t) => sum + t.price, 0);
    expect(ticketSum).toBe(totalPrice);

    // ====================================================
    // D) VERIFY DB STATE: slot inventory (seats_left)
    // ====================================================
    const slotAfter = db.prepare(`
      SELECT seats_left, capacity
      FROM boat_slots
      WHERE id = ?
    `).get(seedData.slots.manual.slot9);

    const expectedSeatsLeft = initialSeatsLeft - 4;
    expect(slotAfter.seats_left).toBe(expectedSeatsLeft);

    // ====================================================
    // E) VERIFY DB STATE: sales_transactions_canonical (after create)
    // ====================================================
    const canonicalRows = db.prepare(`
      SELECT id, presale_id, status, amount
      FROM sales_transactions_canonical
      WHERE presale_id = ?
    `).all(presaleId);

    // Should have VALID canonical rows for prepayment
    expect(canonicalRows.length).toBeGreaterThan(0);

    const validRows = canonicalRows.filter(r => r.status === 'VALID');
    const validSum = validRows.reduce((sum, r) => sum + r.amount, 0);
    // VALID sum may be totalPrice (all tickets) or prepaymentAmount (depends on trigger logic)
    expect(validSum).toBeGreaterThanOrEqual(prepaymentAmount);
    expect(validSum).toBeLessThanOrEqual(totalPrice);

    // ====================================================
    // F) ADDITIONAL PAYMENT (pay remaining)
    // ====================================================
    const paymentRes = await request(app)
      .patch(`/api/selling/presales/${presaleId}/payment`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ additionalPayment: remaining });

    expect(paymentRes.status).toBe(200);
    expect(paymentRes.body.prepayment_amount).toBe(totalPrice);

    // ====================================================
    // G) VERIFY DB STATE: after additional payment
    // ====================================================
    const presaleAfterPay = db.prepare(`
      SELECT prepayment_amount, total_price
      FROM presales
      WHERE id = ?
    `).get(presaleId);

    expect(presaleAfterPay.prepayment_amount).toBe(totalPrice);

    // Check canonical sum = totalPrice
    const canonicalAfterPay = db.prepare(`
      SELECT id, presale_id, status, amount
      FROM sales_transactions_canonical
      WHERE presale_id = ?
    `).all(presaleId);

    const validRowsAfterPay = canonicalAfterPay.filter(r => r.status === 'VALID');
    const validSumAfterPay = validRowsAfterPay.reduce((sum, r) => sum + r.amount, 0);
    expect(validSumAfterPay).toBe(totalPrice);

    // Check tickets still ACTIVE, count = 4
    const ticketsAfterPay = db.prepare(`
      SELECT id, status
      FROM tickets
      WHERE presale_id = ?
    `).all(presaleId);

    expect(ticketsAfterPay.length).toBe(4);
    ticketsAfterPay.forEach(t => {
      expect(t.status).toBe('ACTIVE');
    });

    // ====================================================
    // H) SUMMARY LOG
    // ====================================================
    console.log('\n[SYNC TEST SUMMARY]');
    console.log('Presale ID:', presaleId);
    console.log('Total Price:', totalPrice);
    console.log('Initial Prepayment:', prepaymentAmount);
    console.log('Additional Payment:', remaining);
    console.log('Final Prepayment:', presaleAfterPay.prepayment_amount);
    console.log('Tickets Created:', tickets.length);
    console.log('Slot Seats Left:', slotAfter.seats_left, '(was', initialSeatsLeft, ')');
    console.log('Canonical VALID Sum (after payment):', validSumAfterPay);
  });

  it('Dispatcher sale with sellerId must set presales.seller_id correctly', async () => {
    // Reset slot capacity before this test
    db.prepare('UPDATE boat_slots SET seats_left = capacity WHERE id = ?').run(seedData.slots.manual.slot9);
    
    // Create presale as dispatcher with sellerId = sellerA
    const create = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        slotUid: `manual:${seedData.slots.manual.slot9}`,
        customerName: 'Dispatcher Test Customer',
        customerPhone: '+79990000088',
        numberOfSeats: 2,
        tickets: { adult: 2, teen: 0, child: 0 },
        prepaymentAmount: 500,
        sellerId: sellerAId,  // sellerA id
        tripDate: new Date().toISOString().split('T')[0] // Add tripDate for manual slot
      });

    expect(create.status).toBe(201);
    expect(create.body.ok).toBe(true);
    expect(create.body.presale).toHaveProperty('id');

    const presaleId = create.body.presale.id;

    // Verify DB state: presales.seller_id should be 1 (sellerA)
    const presaleRow = db.prepare(`
      SELECT id, seller_id, customer_name, number_of_seats, total_price, prepayment_amount
      FROM presales
      WHERE id = ?
    `).get(presaleId);

    expect(presaleRow).toBeDefined();
    expect(presaleRow.seller_id).toBe(sellerAId); // sellerA id
    expect(presaleRow.customer_name).toBe('Dispatcher Test Customer');
    expect(presaleRow.number_of_seats).toBe(2);

    console.log('\n[DISPATCHER SALE WITH SELLER_ID TEST]');
    console.log('Presale ID:', presaleId);
    console.log('Seller ID (DB):', presaleRow.seller_id);
    console.log('Total Price:', presaleRow.total_price);
    console.log('Prepayment:', presaleRow.prepayment_amount);
  });

  it('Dispatcher sale with invalid sellerId must return 400', async () => {
    const create = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        slotUid: `manual:${seedData.slots.manual.slot9}`,
        customerName: 'Invalid Seller Test',
        customerPhone: '+79990000077',
        numberOfSeats: 1,
        tickets: { adult: 1, teen: 0, child: 0 },
        prepaymentAmount: 0,
        sellerId: 99999  // Non-existent seller
      });

    expect(create.status).toBe(400);
    expect(create.body.ok).toBe(false);
    expect(create.body.code).toBe('SELLER_NOT_FOUND');
    expect(create.body.message).toMatch(/недоступен/);
  });

  it('Dispatcher sale WITHOUT sellerId must use dispatcher id as fallback', async () => {
    // Reset slot capacity before this test
    db.prepare('UPDATE boat_slots SET seats_left = capacity WHERE id = ?').run(seedData.slots.manual.slot9);
    
    // Create presale as dispatcher WITHOUT sellerId param
    const create = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        slotUid: `manual:${seedData.slots.manual.slot9}`,
        customerName: 'Dispatcher Fallback Test',
        customerPhone: '+79990000066',
        numberOfSeats: 1,
        tickets: { adult: 1, teen: 0, child: 0 },
        prepaymentAmount: 0,
        tripDate: new Date().toISOString().split('T')[0] // Add tripDate for manual slot
        // NO sellerId field
      });

    expect(create.status).toBe(201);
    expect(create.body.ok).toBe(true);
    expect(create.body.presale).toHaveProperty('id');

    const presaleId = create.body.presale.id;

    // Verify DB state: presales.seller_id should be 3 (dispatcher1 id)
    const presaleRow = db.prepare(`
      SELECT id, seller_id, customer_name
      FROM presales
      WHERE id = ?
    `).get(presaleId);

    expect(presaleRow).toBeDefined();
    expect(presaleRow.seller_id).toBe(dispatcherId); // dispatcher1 id from seed
    expect(presaleRow.customer_name).toBe('Dispatcher Fallback Test');

    console.log('\n[DISPATCHER SALE WITHOUT SELLER_ID TEST]');
    console.log('Presale ID:', presaleId);
    console.log('Seller ID (DB):', presaleRow.seller_id, '(expected: dispatcher1 id =', dispatcherId, ')');
  });
});
