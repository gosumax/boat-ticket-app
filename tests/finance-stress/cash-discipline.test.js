/**
 * Cash Discipline Tests
 * Tests that money flows correctly through the payment lifecycle
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
  validatePresalePaymentBounds
} from './test-setup.js';

import { app } from '../../server/index.js';

describe('Cash Discipline', () => {
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

  describe('CD-1: Seller sale without prepayment → dispatcher accepts payment in parts', () => {
    it('should create presale without prepayment', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'No Prepay Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Verify presale has no prepayment
      const presale = db.prepare('SELECT * FROM presales WHERE id = ?').get(presaleId);
      expect(presale.prepayment_amount).toBe(0);
      expect(presale.status).toBe('ACTIVE');
      
      // Verify unpaid amount equals total
      const remaining = presale.total_price - presale.prepayment_amount;
      expect(remaining).toBe(presale.total_price);
    });

    it('should accept partial payment and track remaining', async () => {
      // Create presale
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Partial Pay Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      const presale = db.prepare('SELECT total_price FROM presales WHERE id = ?').get(presaleId);
      const totalPrice = presale.total_price;
      
      // Accept first partial payment via PATCH /presales/:id/payment
      const payment1Res = await request(app)
        .patch(`/api/selling/presales/${presaleId}/payment`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ additionalPayment: 1000 });
      
      expect(payment1Res.status).toBe(200);
      
      // Verify prepayment increased
      const after1 = db.prepare('SELECT prepayment_amount, total_price FROM presales WHERE id = ?').get(presaleId);
      expect(after1.prepayment_amount).toBe(1000);
      
      // Accept second partial payment
      const payment2Res = await request(app)
        .patch(`/api/selling/presales/${presaleId}/payment`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ additionalPayment: totalPrice - 1000 });
      
      expect(payment2Res.status).toBe(200);
      
      // Verify fully paid
      const after2 = db.prepare('SELECT prepayment_amount, total_price FROM presales WHERE id = ?').get(presaleId);
      expect(after2.prepayment_amount).toBe(totalPrice);
    });

    it('should reject overpayment (cannot accept more than total)', async () => {
      // Create presale
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Overpay Test',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      const presale = db.prepare('SELECT total_price FROM presales WHERE id = ?').get(presaleId);
      const totalPrice = presale.total_price;
      
      // Try to accept payment exceeding total
      const overpayRes = await request(app)
        .patch(`/api/selling/presales/${presaleId}/payment`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ additionalPayment: totalPrice + 1000 });
      
      // Should reject with 400 (payment exceeds remaining balance)
      expect(overpayRes.status).toBe(400);
      
      // Verify prepayment unchanged
      const after = db.prepare('SELECT prepayment_amount FROM presales WHERE id = ?').get(presaleId);
      expect(after.prepayment_amount).toBe(0);
    });
  });

  describe('CD-2: Prepayment + additional payment', () => {
    it('should create presale with prepayment and track correctly', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Prepay Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          prepaymentAmount: 500,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Verify prepayment recorded
      const presale = db.prepare('SELECT total_price, prepayment_amount FROM presales WHERE id = ?').get(presaleId);
      expect(presale.prepayment_amount).toBe(500);
      
      // Check remaining
      const remaining = presale.total_price - presale.prepayment_amount;
      expect(remaining).toBe(presale.total_price - 500);
    });

    it('should accept remaining payment and mark as fully paid', async () => {
      // Create with prepayment
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Full Pay Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          prepaymentAmount: 500,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      const presale = db.prepare('SELECT total_price, prepayment_amount FROM presales WHERE id = ?').get(presaleId);
      const remaining = presale.total_price - presale.prepayment_amount;
      
      // Accept remaining via accept-payment (full payment)
      const acceptRes = await request(app)
        .patch(`/api/selling/presales/${presaleId}/accept-payment`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          payment_method: 'CASH'
        });
      
      expect(acceptRes.status).toBe(200);
      
      // Verify fully paid
      const after = db.prepare('SELECT prepayment_amount, total_price, payment_cash_amount, payment_card_amount FROM presales WHERE id = ?').get(presaleId);
      expect(after.prepayment_amount).toBe(after.total_price);
      expect(after.payment_cash_amount).toBe(remaining);
      
      // Validate invariant: paid <= total
      const invariant = validatePresalePaymentBounds(db, presaleId);
      expect(invariant.valid).toBe(true);
    });
  });

  describe('CD-3: Cancel/Refund', () => {
    it('should cancel presale and mark tickets as REFUNDED', async () => {
      // Create and pay
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Cancel Client',
          customerPhone: '79991234567',
          numberOfSeats: 2,
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
      
      // Cancel via delete endpoint
      const deleteRes = await request(app)
        .patch(`/api/selling/presales/${presaleId}/delete`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(deleteRes.status).toBe(200);
      
      // Verify presale cancelled
      const presale = db.prepare('SELECT status FROM presales WHERE id = ?').get(presaleId);
      expect(presale.status).toBe('CANCELLED');
      
      // Verify tickets refunded
      const tickets = db.prepare('SELECT * FROM tickets WHERE presale_id = ?').all(presaleId);
      expect(tickets.every(t => t.status === 'REFUNDED')).toBe(true);
    });

    it('should not accept payment for CANCELLED presale', async () => {
      // Create and cancel
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Cancelled Pay Test',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Cancel first
      const deleteRes = await request(app)
        .patch(`/api/selling/presales/${presaleId}/delete`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(deleteRes.status).toBe(200);
      
      // Try to accept payment (should fail)
      const acceptRes = await request(app)
        .patch(`/api/selling/presales/${presaleId}/accept-payment`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ payment_method: 'CASH' });
      
      expect(acceptRes.status).toBe(400);
      expect(acceptRes.body.error).toMatch(/status/i);
    });
  });

  describe('CD-4: Mixed payments (cash + card)', () => {
    it('should accept MIXED payment and split correctly', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Mixed Pay Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      const presale = db.prepare('SELECT total_price FROM presales WHERE id = ?').get(presaleId);
      const total = presale.total_price;
      
      // Accept with MIXED: 1000 cash, rest card
      const cashPart = 1000;
      const cardPart = total - cashPart;
      
      const acceptRes = await request(app)
        .patch(`/api/selling/presales/${presaleId}/accept-payment`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          payment_method: 'MIXED',
          cash_amount: cashPart,
          card_amount: cardPart
        });
      
      expect(acceptRes.status).toBe(200);
      
      // Verify split in presale
      const after = db.prepare('SELECT payment_method, payment_cash_amount, payment_card_amount, prepayment_amount, total_price FROM presales WHERE id = ?').get(presaleId);
      expect(after.payment_method).toBe('MIXED');
      expect(after.payment_cash_amount).toBe(cashPart);
      expect(after.payment_card_amount).toBe(cardPart);
      expect(after.prepayment_amount).toBe(total);
      
      // Verify money_ledger entry
      const ledger = db.prepare(`
        SELECT * FROM money_ledger 
        WHERE presale_id = ? AND kind = 'SELLER_SHIFT' AND type LIKE 'SALE_ACCEPTED%'
      `).get(presaleId);
      expect(ledger).toBeDefined();
      expect(ledger.amount).toBe(total);
    });

    it('should validate MIXED payment amounts sum to total', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Invalid Mix Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      const presale = db.prepare('SELECT total_price FROM presales WHERE id = ?').get(presaleId);
      const total = presale.total_price;
      
      // Try invalid MIXED: amounts don't sum to remaining (which is total when no prepayment)
      // Use wrong amounts that don't add up to total
      const acceptRes = await request(app)
        .patch(`/api/selling/presales/${presaleId}/accept-payment`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          payment_method: 'MIXED',
          cash_amount: 800,
          card_amount: 400  // 800+400=1200 != 1500 (total)
        });
      
      // Should reject with 400 because cash + card != remaining amount
      expect(acceptRes.status).toBe(400);
    });
  });
});
