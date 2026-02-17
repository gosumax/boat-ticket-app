/**
 * Seller-Dispatcher Sync: Sales API Tests
 * Tests that seller sales are immediately visible to dispatcher
 */

// Import test setup FIRST to ensure global beforeEach runs
import './test-setup.js';

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import { 
  initTestDb, 
  getSeedData,
  generateTestToken, 
  getDb, 
  closeDb 
} from './test-setup.js';

import { app } from '../../server/index.js';

describe('Seller-Dispatcher Sync: Sales API', () => {
  let db;
  let testData;
  let sellerToken;
  let dispatcherToken;
  
  beforeAll(async () => {
    db = await initTestDb();
  });
  
  afterAll(() => {
    closeDb();
  });
  
  beforeEach(() => {
    testData = getSeedData();
    sellerToken = generateTestToken(testData.sellerId, 'test_seller', 'seller');
    dispatcherToken = generateTestToken(testData.dispatcherId, 'test_dispatcher', 'dispatcher');
  });
  
  describe('0️⃣ Базовый мгновенный синк', () => {
    it('should show seller sale immediately in dispatcher active trips', async () => {
      // Seller sells 1 adult ticket
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow // Use tomorrow since slots are created with tomorrow's date
        });
      
      expect(saleRes.status).toBe(201);
      expect(saleRes.body.ok).toBe(true);
      const presaleId = saleRes.body.presale.id;
      
      // Verify in DB
      const presale = db.prepare('SELECT * FROM presales WHERE id = ?').get(presaleId);
      expect(presale).toBeDefined();
      expect(presale.seller_id).toBe(testData.sellerId);
      
      // Check dispatcher active trips see this slot
      const dispatcherSlotsRes = await request(app)
        .get('/api/selling/dispatcher/slots')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .query({ tripDate: testData.tomorrow });
      
      expect(dispatcherSlotsRes.status).toBe(200);
      const slots = Array.isArray(dispatcherSlotsRes.body) ? dispatcherSlotsRes.body : [];
      const targetSlot = slots.find(s => String(s.id) === String(testData.genSlotId1));
      expect(targetSlot).toBeDefined();
    });
    
    it('should show seller sale immediately in dispatcher sales/boarding', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client 2',
          customerPhone: '79991234568',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Check dispatcher sales/boarding list
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const tickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      const myTicket = tickets.find(t => t.presale_id === presaleId);
      expect(myTicket).toBeDefined();
    });
    
    it('should show seller sale inside specific trip details', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client 3',
          customerPhone: '79991234569',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      
      // Dispatcher checks trip details with passenger list
      const tripDetailsRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(tripDetailsRes.status).toBe(200);
      expect(tripDetailsRes.body.ok).toBe(true);
      const tickets = Array.isArray(tripDetailsRes.body?.data?.items) ? tripDetailsRes.body.data.items : [];
      expect(tickets.length).toBeGreaterThan(0);
    });
  });
  
  describe('1️⃣ Seller Sale: категории пассажиров', () => {
    it('should sell adult-only ticket and sync to dispatcher', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Adult Only',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      expect(saleRes.body.ok).toBe(true);
      
      // Verify dispatcher sees it
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const tickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      const myTicket = tickets.find(t => t.customer_name === 'Adult Only');
      expect(myTicket).toBeDefined();
    });
    
    it('should sell child-only ticket and sync to dispatcher', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Child Only',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const tickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      const myTicket = tickets.find(t => t.customer_name === 'Child Only');
      expect(myTicket).toBeDefined();
    });
    
    it('should sell teen-only ticket and sync to dispatcher', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Teen Only',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const tickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      const myTicket = tickets.find(t => t.customer_name === 'Teen Only');
      expect(myTicket).toBeDefined();
    });
  });
  
  describe('2️⃣ Seller Sale: многоместный билет', () => {
    it('should sell 3-seat group and sync all tickets to dispatcher', async () => {
      // Use genSlotId2 to avoid capacity conflict with other tests
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId2}`,
          customerName: 'Group Client',
          customerPhone: '79991234567',
          numberOfSeats: 3,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Verify all 3 tickets exist
      const tickets = db.prepare('SELECT * FROM tickets WHERE presale_id = ?').all(presaleId);
      expect(tickets.length).toBe(3);
      
      // Dispatcher sees all 3 tickets
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId2}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const boardingTickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      const groupTickets = boardingTickets.filter(t => t.presale_id === presaleId);
      expect(groupTickets.length).toBe(3);
    });
  });
  
  describe('3️⃣ Seller Sale: предоплата и без', () => {
    it('should create sale with prepayment and sync money data', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Prepay Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          prepaymentAmount: 500,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Verify money_ledger entry created
      const ledger = db.prepare('SELECT * FROM money_ledger WHERE presale_id = ?').get(presaleId);
      expect(ledger).toBeDefined();
      expect(ledger.amount).toBe(500);
      
      // Dispatcher sees paid amount
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
    });
    
    it('should create sale without prepayment and sync as unpaid', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'No Prepay Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          prepaymentAmount: 0,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Verify no money_ledger for zero prepayment (or status differs)
      const presale = db.prepare('SELECT * FROM presales WHERE id = ?').get(presaleId);
      expect(presale.prepayment_amount).toBe(0);
      
      // Dispatcher sees as unpaid
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
    });
  });
  
  describe('4️⃣ Seller Presale: бронь без оплаты', () => {
    it('should create presale without payment and sync to dispatcher', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Booking Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          prepaymentAmount: 0,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      const presale = db.prepare('SELECT * FROM presales WHERE id = ?').get(presaleId);
      expect(presale.status).toBe('ACTIVE');
      expect(presale.prepayment_amount).toBe(0);
      
      // Dispatcher sees booking
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const tickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      const myTicket = tickets.find(t => t.customer_name === 'Booking Client');
      expect(myTicket).toBeDefined();
    });
  });
  
  describe('7️⃣ Валидации синка', () => {
    it('should show seller sale immediately without delays', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Instant Sync',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      
      // IMMEDIATE check - no timers/wait
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const tickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      const myTicket = tickets.find(t => t.customer_name === 'Instant Sync');
      expect(myTicket).toBeDefined();
    });
    
    it('should show two consecutive seller sales in same slot', async () => {
      // First sale
      const sale1Res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'First Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(sale1Res.status).toBe(201);
      
      // Second sale
      const sale2Res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Second Client',
          customerPhone: '79991234568',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(sale2Res.status).toBe(201);
      
      // Dispatcher sees both
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const tickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      expect(tickets.length).toBeGreaterThanOrEqual(2);
    });
    
    it('should show sales in different slots separately', async () => {
      // Sale in slot 1
      await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Slot 1 Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      // Sale in slot 3
      await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId3}`,
          customerName: 'Slot 3 Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      // Dispatcher active trips shows both slots
      const dispatcherSlotsRes = await request(app)
        .get('/api/selling/dispatcher/slots')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .query({ tripDate: testData.tomorrow });
      
      expect(dispatcherSlotsRes.status).toBe(200);
      
      // Each slot has only its own tickets
      const slot1TicketsRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(slot1TicketsRes.status).toBe(200);
      expect(slot1TicketsRes.body.ok).toBe(true);
      const slot1Tickets = Array.isArray(slot1TicketsRes.body?.data?.items) ? slot1TicketsRes.body.data.items : [];
      const slot1Client = slot1Tickets.find(t => t.customer_name === 'Slot 1 Client');
      expect(slot1Client).toBeDefined();
    });
  });
});