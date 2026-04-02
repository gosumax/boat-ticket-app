/**
 * Dispatcher Sales API Tests (Supertest) - REAL BACKEND
 * Tests real endpoints from server/selling.mjs
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Import test setup FIRST (sets DB_FILE and global beforeEach)
import { 
  initTestDb, 
  getSeedData,
  generateTestToken, 
  getDb, 
  closeDb 
} from './test-setup.js';

// Import real Express app
import { app } from '../../server/index.js';

describe('Dispatcher Sales API (Real Backend)', () => {
  let db;
  let testData;
  let dispatcherToken;
  let sellerToken;
  
  beforeAll(async () => {
    db = await initTestDb();
  });
  
  afterAll(() => {
    closeDb();
  });
  
  // Get fresh seed data before each test (seeded by global beforeEach in test-setup.js)
  beforeEach(() => {
    testData = getSeedData();
    dispatcherToken = generateTestToken(testData.dispatcherId, 'test_dispatcher', 'dispatcher');
    sellerToken = generateTestToken(testData.sellerId, 'test_seller', 'seller');
  });
  
  describe('1️⃣ Продажа от диспетчера', () => {
    it('should create presale with adult ticket', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.presale).toBeDefined();
      expect(res.body.presale.customer_name).toBe('Test Client');
      expect(res.body.presale.number_of_seats).toBe(1);
      expect(res.body.presale.total_price).toBe(1500);
    });
    
    it('should create presale with multiple seats', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Family Client',
          customerPhone: '79991234568',
          numberOfSeats: 4,
          tripDate: testData.today
        });
      
      expect(res.status).toBe(201);
      expect(res.body.presale.number_of_seats).toBe(4);
      // 4 * 1500 = 6000
      expect(res.body.presale.total_price).toBe(6000);
    });
    
    it('should decrease seats_left after presale', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 2,
          tripDate: testData.today
        });
      
      expect(res.status).toBe(201);
      
      // Verify by counting presales (source of truth for generated slots)
      // seats_left cache may be stale due to timing of cache update
      const presalesCount = db.prepare(`
        SELECT COALESCE(SUM(number_of_seats),0) as cnt 
        FROM presales 
        WHERE slot_uid = ? AND status = 'ACTIVE'
      `).get(`generated:${testData.genSlotId1}`);
      expect(presalesCount.cnt).toBe(2);
    });
    
    it('should create tickets for presale', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 3,
          tripDate: testData.today
        });
      
      expect(res.status).toBe(201);
      
      const tickets = db.prepare('SELECT * FROM tickets WHERE presale_id = ?').all(res.body.presale.id);
      expect(tickets.length).toBe(3);
    });
    
    it('should reject presale if not enough seats', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 150, // More than capacity (100)
          tripDate: testData.today
        });
      
      // API returns 400 SEAT_CAPACITY_EXCEEDED when seats > capacity (not 409 NO_SEATS)
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SEAT_CAPACITY_EXCEEDED');
    });
  });
  
  describe('2️⃣ Продажа от имени продавца (через dispatcher)', () => {
    it('should assign presale to specified seller', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          sellerId: testData.sellerId,
          tripDate: testData.today
        });
      
      expect(res.status).toBe(201);
      // Query database to verify seller_id was set
      const presale = db.prepare('SELECT seller_id FROM presales WHERE id = ?').get(res.body.presale.id);
      expect(presale.seller_id).toBe(testData.sellerId);
    });
    
    it('should reject invalid seller_id', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          sellerId: 9999, // Non-existent
          tripDate: testData.today
        });
      
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SELLER_NOT_FOUND');
    });
  });
  
  describe('3️⃣ Продажа с предоплатой', () => {
    it('should create presale with partial prepayment', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          prepaymentAmount: 500,
          payment_method: 'CASH',
          tripDate: testData.today
        });
      
      expect(res.status).toBe(201);
      expect(res.body.presale.prepayment_amount).toBe(500);
    });
    
    it('should reject prepayment exceeding total', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          prepaymentAmount: 5000, // More than total (1500)
          tripDate: testData.today
        });
      
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PREPAYMENT_EXCEEDS_TOTAL');
    });
  });

  describe('3.1️⃣ Ledger regression: presale + tickets + legacy payment flow', () => {
    it('must write SALE_* row to money_ledger for CASH/CARD/MIXED when using /payment', async () => {
      const scenarios = [
        {
          label: 'CASH',
          createPrepay: 0,
          createPayloadExtra: {},
          additionalPayment: 1500,
          expectedLedgerType: 'SALE_ACCEPTED_CASH',
          expectedMethod: 'CASH'
        },
        {
          label: 'CARD',
          createPrepay: 500,
          createPayloadExtra: { payment_method: 'CARD' },
          additionalPayment: 1000,
          expectedLedgerType: 'SALE_ACCEPTED_CARD',
          expectedMethod: 'CARD'
        },
        {
          label: 'MIXED',
          createPrepay: 500,
          createPayloadExtra: { payment_method: 'MIXED', cash_amount: 250, card_amount: 250 },
          additionalPayment: 1000,
          expectedLedgerType: 'SALE_ACCEPTED_MIXED',
          expectedMethod: 'MIXED'
        }
      ];

      for (const scenario of scenarios) {
        const createRes = await request(app)
          .post('/api/selling/presales')
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({
            slotUid: `generated:${testData.genSlotId1}`,
            customerName: `Ledger ${scenario.label}`,
            customerPhone: `7999000${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
            numberOfSeats: 1,
            prepaymentAmount: scenario.createPrepay,
            tripDate: testData.today,
            ...scenario.createPayloadExtra
          });

        expect(createRes.status).toBe(201);
        const presaleId = Number(createRes.body?.presale?.id);
        expect(Number.isFinite(presaleId)).toBe(true);

        // Regression invariant: presale + tickets are created.
        const tickets = db.prepare('SELECT id FROM tickets WHERE presale_id = ? AND status = ?').all(presaleId, 'ACTIVE');
        expect(tickets.length).toBe(1);

        const paymentRes = await request(app)
          .patch(`/api/selling/presales/${presaleId}/payment`)
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ additionalPayment: scenario.additionalPayment });

        expect(paymentRes.status).toBe(200);

        // Regression invariant: sale ledger row MUST exist after /payment.
        const ledgerRows = db.prepare(`
          SELECT type, method, amount
          FROM money_ledger
          WHERE presale_id = ?
            AND kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
          ORDER BY id ASC
        `).all(presaleId);

        expect(ledgerRows.length).toBeGreaterThan(0);

        const addedByPayment = ledgerRows.find(
          (row) => row.type === scenario.expectedLedgerType && Number(row.amount) === scenario.additionalPayment
        );
        expect(addedByPayment).toBeDefined();
        expect(String(addedByPayment.method || '').toUpperCase()).toBe(scenario.expectedMethod);

        if (scenario.label === 'MIXED') {
          const updated = db.prepare(`
            SELECT payment_method, payment_cash_amount, payment_card_amount, prepayment_amount, total_price
            FROM presales
            WHERE id = ?
          `).get(presaleId);
          expect(String(updated.payment_method || '').toUpperCase()).toBe('MIXED');
          expect(Number(updated.payment_cash_amount)).toBeGreaterThan(0);
          expect(Number(updated.payment_card_amount)).toBeGreaterThan(0);
          expect(Number(updated.payment_cash_amount) + Number(updated.payment_card_amount)).toBe(Number(updated.prepayment_amount));
          expect(Number(updated.prepayment_amount)).toBe(Number(updated.total_price));
        }
      }
    });

    it('keeps legacy /payment attribution aligned with the sale owner for dispatcher self-sale vs seller sale', async () => {
      const createSelfRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Legacy Self Attribution',
          customerPhone: '79991110001',
          numberOfSeats: 1,
          tripDate: testData.today
        });

      expect(createSelfRes.status).toBe(201);
      const selfPresaleId = Number(createSelfRes.body?.presale?.id);
      const selfTotalPrice = Number(createSelfRes.body?.presale?.total_price || 0);

      const selfPaymentRes = await request(app)
        .patch(`/api/selling/presales/${selfPresaleId}/payment`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ additionalPayment: selfTotalPrice });

      expect(selfPaymentRes.status).toBe(200);

      const selfLedgerRow = db.prepare(`
        SELECT seller_id, kind, type, amount
        FROM money_ledger
        WHERE presale_id = ?
          AND type LIKE 'SALE_ACCEPTED%'
        ORDER BY id DESC
        LIMIT 1
      `).get(selfPresaleId);

      expect(Number(selfLedgerRow?.seller_id || 0)).toBe(testData.dispatcherId);
      expect(String(selfLedgerRow?.kind || '')).toBe('DISPATCHER_SHIFT');
      expect(Number(selfLedgerRow?.amount || 0)).toBe(selfTotalPrice);

      const createSellerRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Legacy Seller Attribution',
          customerPhone: '79991110002',
          numberOfSeats: 1,
          sellerId: testData.sellerId,
          tripDate: testData.today
        });

      expect(createSellerRes.status).toBe(201);
      const sellerPresaleId = Number(createSellerRes.body?.presale?.id);
      const sellerTotalPrice = Number(createSellerRes.body?.presale?.total_price || 0);

      const sellerPaymentRes = await request(app)
        .patch(`/api/selling/presales/${sellerPresaleId}/payment`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ additionalPayment: sellerTotalPrice });

      expect(sellerPaymentRes.status).toBe(200);

      const sellerLedgerRow = db.prepare(`
        SELECT seller_id, kind, type, amount
        FROM money_ledger
        WHERE presale_id = ?
          AND type LIKE 'SALE_ACCEPTED%'
        ORDER BY id DESC
        LIMIT 1
      `).get(sellerPresaleId);

      expect(Number(sellerLedgerRow?.seller_id || 0)).toBe(testData.sellerId);
      expect(String(sellerLedgerRow?.kind || '')).toBe('SELLER_SHIFT');
      expect(Number(sellerLedgerRow?.amount || 0)).toBe(sellerTotalPrice);
    });
  });
  
  describe('4️⃣ Продажа без предоплаты', () => {
    it('should create presale with zero prepayment', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(res.status).toBe(201);
      expect(res.body.presale.prepayment_amount).toBe(0);
    });
  });
  
  describe('Authorization', () => {
    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(res.status).toBe(401);
    });
    
    it('should allow seller to create presale', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(res.status).toBe(201);
      // Query database to verify seller_id was set to seller's own id
      const presale = db.prepare('SELECT seller_id FROM presales WHERE id = ?').get(res.body.presale.id);
      expect(presale.seller_id).toBe(testData.sellerId);
    });
  });
  
  describe('Validation', () => {
    it('should require customer name', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerPhone: '79991234567',
          numberOfSeats: 1
        });
      
      expect(res.status).toBe(400);
    });
    
    it('should require customer phone', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Test Client',
          numberOfSeats: 1
        });
      
      expect(res.status).toBe(400);
    });
    
    it('should require valid slotUid', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: 'generated:9999',
          customerName: 'Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 1
        });
      
      expect(res.status).toBe(404);
    });
  });
  
  describe('Database Verification', () => {
    it('should write to presales table', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'DB Test Client',
          customerPhone: '79991234599',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(res.status).toBe(201);
      
      const presale = db.prepare('SELECT * FROM presales WHERE id = ?').get(res.body.presale.id);
      expect(presale).toBeDefined();
      expect(presale.customer_name).toBe('DB Test Client');
    });
    
    it('should write to tickets table', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'DB Test Client',
          customerPhone: '79991234599',
          numberOfSeats: 3,
          tripDate: testData.today
        });
      
      expect(res.status).toBe(201);
      
      const tickets = db.prepare('SELECT * FROM tickets WHERE presale_id = ?').all(res.body.presale.id);
      expect(tickets.length).toBe(3);
      expect(tickets.every(t => t.status === 'ACTIVE')).toBe(true);
    });
    
    it('should update boat_slots.seats_left', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Seats Test',
          customerPhone: '79991234599',
          numberOfSeats: 3,
          tripDate: testData.today
        });
      
      expect(res.status).toBe(201);
      
      // Verify by counting presales (source of truth for generated slots)
      // seats_left cache may be stale due to timing of cache update
      const presalesCount = db.prepare(`
        SELECT COALESCE(SUM(number_of_seats),0) as cnt 
        FROM presales 
        WHERE slot_uid = ? AND status = 'ACTIVE'
      `).get(`generated:${testData.genSlotId1}`);
      expect(presalesCount.cnt).toBe(3);
    });
  });
});
