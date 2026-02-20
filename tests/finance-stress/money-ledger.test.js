/**
 * Money Ledger Consistency Tests
 * Validates strict invariants for money_ledger and financial records
 */

import './test-setup.js';

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import { 
  initTestDb, 
  getSeedData,
  generateTestToken, 
  getDb, 
  closeDb,
  validateAllMoneyLedgerInvariants,
  validateMoneyLedgerBasic,
  validatePresalePaymentBounds,
  validateMoneyLedgerKinds,
  validateTicketsIntegrity
} from './test-setup.js';

import { app } from '../../server/index.js';

describe('Money Ledger Consistency', () => {
  let db;
  let testData;
  let sellerToken;
  let seller2Token;
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
    seller2Token = generateTestToken(testData.seller2Id, 'test_seller2', 'seller');
    dispatcherToken = generateTestToken(testData.dispatcherId, 'test_dispatcher', 'dispatcher');
  });

  describe('ML-INV-1: Basic record structure', () => {
    it('should have all required fields in money_ledger after sale', async () => {
      // Create sale with prepayment
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Ledger Test Client',
          customerPhone: '79991234567',
          numberOfSeats: 2,
          prepaymentAmount: 1000,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      
      // Validate basic structure
      const basicCheck = validateMoneyLedgerBasic(db);
      expect(basicCheck.valid).toBe(true);
      expect(basicCheck.errors).toHaveLength(0);
    });

    it('should have valid ledger records after accept-payment', async () => {
      // Create sale
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Accept Ledger Test',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Accept payment
      const acceptRes = await request(app)
        .patch(`/api/selling/presales/${presaleId}/accept-payment`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ payment_method: 'CASH' });
      
      expect(acceptRes.status).toBe(200);
      
      // Validate basic structure
      const basicCheck = validateMoneyLedgerBasic(db);
      expect(basicCheck.valid).toBe(true);
      
      // Check that ledger has the record
      const ledger = db.prepare(`
        SELECT * FROM money_ledger 
        WHERE presale_id = ? AND kind = 'SELLER_SHIFT'
      `).all(presaleId);
      
      expect(ledger.length).toBeGreaterThan(0);
      ledger.forEach(row => {
        expect(row.kind).toBeDefined();
        expect(row.type).toBeDefined();
        expect(row.amount).toBeGreaterThan(0);
        expect(row.status).toBe('POSTED');
      });
    });
  });

  describe('ML-INV-2: Payment bounds per presale', () => {
    it('should never allow paid > total after any operation', async () => {
      const operations = [
        { name: 'sale with prepayment', prepay: 500 },
        { name: 'sale without prepayment', prepay: 0 }
      ];
      
      for (const op of operations) {
        // Fresh presale for each operation
        const saleRes = await request(app)
          .post('/api/selling/presales')
          .set('Authorization', `Bearer ${sellerToken}`)
          .send({
            slotUid: `generated:${testData.genSlotId1}`,
            customerName: `Bounds Test ${op.name}`,
            customerPhone: '79991234567',
            numberOfSeats: 1,
            prepaymentAmount: op.prepay,
            tripDate: testData.today
          });
        
        expect(saleRes.status).toBe(201);
        const presaleId = saleRes.body.presale.id;
        
        // Get actual total to compare
        const presale = db.prepare('SELECT total_price, prepayment_amount FROM presales WHERE id = ?').get(presaleId);
        console.log(`[ML-INV-2] ${op.name}: total=${presale.total_price}, prepay=${presale.prepayment_amount}`);
        
        // Validate invariant for THIS presale only
        const invariant = validatePresalePaymentBounds(db, presaleId);
        if (!invariant.valid) {
          console.log('[ML-INV-2] Violation:', invariant.errors);
        }
        expect(invariant.valid).toBe(true);
      }
    });

    it('should maintain bounds after partial payments', async () => {
      // Create sale
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Partial Bounds Test',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      const presale = db.prepare('SELECT total_price FROM presales WHERE id = ?').get(presaleId);
      
      // Multiple partial payments
      const payments = [500, 500, 500];
      for (const payment of payments) {
        await request(app)
          .patch(`/api/selling/presales/${presaleId}/payment`)
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ additionalPayment: payment });
        
        // Validate after each
        const invariant = validatePresalePaymentBounds(db, presaleId);
        expect(invariant.valid).toBe(true);
      }
    });
  });

  describe('ML-INV-3: Kind/Type whitelist', () => {
    it('should only use valid kinds in money_ledger', async () => {
      // Create various operations
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Kind Test',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          prepaymentAmount: 500,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Accept payment
      await request(app)
        .patch(`/api/selling/presales/${presaleId}/accept-payment`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ payment_method: 'CARD' });
      
      // Validate kinds
      const kindsCheck = validateMoneyLedgerKinds(db);
      expect(kindsCheck.valid).toBe(true);
      expect(kindsCheck.errors).toHaveLength(0);
    });
  });

  describe('Full invariant validation after operations', () => {
    const testOperations = [
      { 
        name: 'simple sale',
        fn: async (tokens, data) => {
          return request(app)
            .post('/api/selling/presales')
            .set('Authorization', `Bearer ${tokens.seller}`)
            .send({
              slotUid: `generated:${data.genSlotId1}`,
              customerName: 'Op Test 1',
              customerPhone: '79991234567',
              numberOfSeats: 1,
              tripDate: data.today
            });
        }
      },
      {
        name: 'sale with prepayment',
        fn: async (tokens, data) => {
          return request(app)
            .post('/api/selling/presales')
            .set('Authorization', `Bearer ${tokens.seller}`)
            .send({
              slotUid: `generated:${data.genSlotId1}`,
              customerName: 'Op Test 2',
              customerPhone: '79991234567',
              numberOfSeats: 2,
              prepaymentAmount: 1000,
              tripDate: data.today
            });
        }
      },
      {
        name: 'sale + accept payment',
        fn: async (tokens, data) => {
          const saleRes = await request(app)
            .post('/api/selling/presales')
            .set('Authorization', `Bearer ${tokens.seller}`)
            .send({
              slotUid: `generated:${data.genSlotId1}`,
              customerName: 'Op Test 3',
              customerPhone: '79991234567',
              numberOfSeats: 1,
              tripDate: data.today
            });
          
          if (saleRes.status === 201) {
            await request(app)
              .patch(`/api/selling/presales/${saleRes.body.presale.id}/accept-payment`)
              .set('Authorization', `Bearer ${tokens.dispatcher}`)
              .send({ payment_method: 'CASH' });
          }
          
          return saleRes;
        }
      },
      {
        name: 'sale + transfer',
        fn: async (tokens, data) => {
          const saleRes = await request(app)
            .post('/api/selling/presales')
            .set('Authorization', `Bearer ${tokens.seller}`)
            .send({
              slotUid: `generated:${data.genSlotId1}`,
              customerName: 'Op Test 4',
              customerPhone: '79991234567',
              numberOfSeats: 1,
              tripDate: data.today
            });
          
          if (saleRes.status === 201) {
            await request(app)
              .post(`/api/selling/presales/${saleRes.body.presale.id}/transfer`)
              .set('Authorization', `Bearer ${tokens.dispatcher}`)
              .send({ to_slot_uid: `generated:${data.genSlotId3}` });
          }
          
          return saleRes;
        }
      },
      {
        name: 'sale + delete',
        fn: async (tokens, data) => {
          const saleRes = await request(app)
            .post('/api/selling/presales')
            .set('Authorization', `Bearer ${tokens.seller}`)
            .send({
              slotUid: `generated:${data.genSlotId1}`,
              customerName: 'Op Test 5',
              customerPhone: '79991234567',
              numberOfSeats: 1,
              tripDate: data.today
            });
          
          if (saleRes.status === 201) {
            await request(app)
              .patch(`/api/selling/presales/${saleRes.body.presale.id}/delete`)
              .set('Authorization', `Bearer ${tokens.dispatcher}`);
          }
          
          return saleRes;
        }
      }
    ];

    for (const op of testOperations) {
      it(`should maintain all invariants after: ${op.name}`, async () => {
        const tokens = { seller: sellerToken, dispatcher: dispatcherToken };
        const res = await op.fn(tokens, testData);
        expect(res.status).toBe(201);
        
        // Run full invariant validation
        const invariantResult = validateAllMoneyLedgerInvariants(db);
        if (!invariantResult.allValid) {
          console.log('[ML-INV] Violations:', invariantResult.allErrors);
        }
        expect(invariantResult.allValid).toBe(true);
        
        if (!invariantResult.allValid) {
          console.error('Invariant violations:', invariantResult.allErrors);
        }
      });
    }
  });

  describe('Tickets integrity validation', () => {
    it('should have valid tickets after sale', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Ticket Integrity Test',
          customerPhone: '79991234567',
          numberOfSeats: 3,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Validate tickets
      const ticketCheck = validateTicketsIntegrity(db, presaleId);
      expect(ticketCheck.valid).toBe(true);
      expect(ticketCheck.ticketCount).toBe(3);
      expect(ticketCheck.activeCount).toBe(3);
    });

    it('should have REFUNDED tickets after cancel', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Cancel Integrity Test',
          customerPhone: '79991234567',
          numberOfSeats: 2,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Cancel
      await request(app)
        .patch(`/api/selling/presales/${presaleId}/delete`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      // Validate tickets are refunded
      const ticketCheck = validateTicketsIntegrity(db, presaleId);
      expect(ticketCheck.valid).toBe(true);
      expect(ticketCheck.presaleStatus).toBe('CANCELLED');
      expect(ticketCheck.refundedCount).toBe(2);
      expect(ticketCheck.activeCount).toBe(0);
    });
  });
});
