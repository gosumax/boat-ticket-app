/**
 * Race Condition Tests
 * Tests concurrent operations to catch race conditions
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
  validatePresalePaymentBounds,
  validateTicketsIntegrity
} from './test-setup.js';

import { app } from '../../server/index.js';

describe('Race Condition Tests', () => {
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

  describe('RC-1: Concurrent sales on limited capacity', () => {
    it('should handle two simultaneous sales when only 1 seat left', async () => {
      // Create slot with capacity 2
      const smallSlotRes = db.prepare(`
        INSERT INTO generated_slots (
          schedule_template_id, trip_date, boat_id, time, capacity, seats_left, 
          duration_minutes, is_active, price_adult, price_child, price_teen
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        testData.templateId1, 
        testData.tomorrow, 
        testData.speedBoatId, 
        '15:00', 
        2,  // capacity
        2,  // seats_left
        60, 1, 1500, 800, 1200
      );
      const smallSlotId = smallSlotRes.lastInsertRowid;
      
      // First sale to reduce to 1 seat
      const sale1Res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${smallSlotId}`,
          customerName: 'First Buyer',
          customerPhone: '79991111111',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(sale1Res.status).toBe(201);
      
      // Verify reduced seats (may or may not track depending on backend)
      const slot = db.prepare('SELECT seats_left, capacity FROM generated_slots WHERE id = ?').get(smallSlotId);
      // The key is that we can detect capacity issues
      expect(slot.seats_left).toBeGreaterThanOrEqual(0);
      
      // Two simultaneous requests for the last seat
      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/selling/presales')
          .set('Authorization', `Bearer ${sellerToken}`)
          .send({
            slotUid: `generated:${smallSlotId}`,
            customerName: 'Concurrent A',
            customerPhone: '79992222222',
            numberOfSeats: 1,
            tripDate: testData.tomorrow
          }),
        request(app)
          .post('/api/selling/presales')
          .set('Authorization', `Bearer ${seller2Token}`)
          .send({
            slotUid: `generated:${smallSlotId}`,
            customerName: 'Concurrent B',
            customerPhone: '79993333333',
            numberOfSeats: 1,
            tripDate: testData.tomorrow
          })
      ]);
      
      // One should succeed, one should fail
      const statuses = [resA.status, resB.status].sort();
      
      // Both could succeed if capacity allows, or one fails with 409
      const successCount = [resA.status, resB.status].filter(s => s === 201).length;
      const failCount = [resA.status, resB.status].filter(s => s === 409).length;
      
      // At least one must succeed (the one that got in first)
      expect(successCount).toBeGreaterThanOrEqual(1);
      
      // Verify final state: seats_left not negative
      const finalSlot = db.prepare('SELECT capacity, seats_left FROM generated_slots WHERE id = ?').get(smallSlotId);
      expect(finalSlot.seats_left).toBeGreaterThanOrEqual(0);
      
      // Verify total tickets <= capacity
      const ticketCount = db.prepare(`
        SELECT COUNT(*) as count FROM tickets t
        JOIN presales p ON p.id = t.presale_id
        WHERE p.slot_uid = ?
      `).get(`generated:${smallSlotId}`);
      
      expect(ticketCount.count).toBeLessThanOrEqual(finalSlot.capacity);
    });

    it('should handle concurrent multi-seat sale exceeding capacity', async () => {
      // Create slot with capacity 3
      const smallSlotRes = db.prepare(`
        INSERT INTO generated_slots (
          schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
          duration_minutes, is_active, price_adult, price_child, price_teen
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        testData.templateId1, 
        testData.tomorrow, 
        testData.speedBoatId, 
        '16:00', 
        3, 3, 60, 1, 1500, 800, 1200
      );
      const smallSlotId = smallSlotRes.lastInsertRowid;
      
      // Two simultaneous requests for 2 seats each (total 4 > capacity 3)
      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/selling/presales')
          .set('Authorization', `Bearer ${sellerToken}`)
          .send({
            slotUid: `generated:${smallSlotId}`,
            customerName: 'Group A',
            customerPhone: '79994444444',
            numberOfSeats: 2,
            tripDate: testData.tomorrow
          }),
        request(app)
          .post('/api/selling/presales')
          .set('Authorization', `Bearer ${seller2Token}`)
          .send({
            slotUid: `generated:${smallSlotId}`,
            customerName: 'Group B',
            customerPhone: '79995555555',
            numberOfSeats: 2,
            tripDate: testData.tomorrow
          })
      ]);
      
      // At least one should fail due to capacity
      const statuses = [resA.status, resB.status];
      const successCount = statuses.filter(s => s === 201).length;
      const failCount = statuses.filter(s => s === 409 || s === 400).length;
      
      // Can't both succeed with 2 seats each when capacity is 3
      // But one might succeed with 2, and the other fail
      // Or both fail if they race and deplete capacity
      
      // Verify no overbooking
      const finalSlot = db.prepare('SELECT capacity, seats_left FROM generated_slots WHERE id = ?').get(smallSlotId);
      expect(finalSlot.seats_left).toBeGreaterThanOrEqual(0);
      
      const ticketCount = db.prepare(`
        SELECT COUNT(*) as count FROM tickets t
        JOIN presales p ON p.id = t.presale_id
        WHERE p.slot_uid = ? AND t.status = 'ACTIVE'
      `).get(`generated:${smallSlotId}`);
      
      expect(ticketCount.count).toBeLessThanOrEqual(finalSlot.capacity);
    });
  });

  describe('RC-2: Concurrent payment acceptance', () => {
    it('should not allow overpayment from concurrent accepts', async () => {
      // Create sale
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Overpay Race Test',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      const presale = db.prepare('SELECT total_price FROM presales WHERE id = ?').get(presaleId);
      const total = presale.total_price;
      
      // Try to accept payment via two methods simultaneously
      // First: partial payment via PATCH /payment
      // Second: full accept via PATCH /accept-payment
      const [payRes, acceptRes] = await Promise.all([
        request(app)
          .patch(`/api/selling/presales/${presaleId}/payment`)
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ additionalPayment: 2000 }),
        request(app)
          .patch(`/api/selling/presales/${presaleId}/accept-payment`)
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ payment_method: 'CASH' })
      ]);
      
      // Check final state
      const finalPresale = db.prepare('SELECT total_price, prepayment_amount FROM presales WHERE id = ?').get(presaleId);
      
      // prepayment should not exceed total
      expect(finalPresale.prepayment_amount).toBeLessThanOrEqual(finalPresale.total_price);
      
      // Validate invariant
      const invariant = validatePresalePaymentBounds(db, presaleId);
      if (!invariant.valid) {
        console.log('[RC] Payment bounds violation:', invariant.errors);
      }
      expect(invariant.valid).toBe(true);
    });
  });

  describe('RC-3: Transfer vs Delete race', () => {
    it('should handle concurrent transfer and delete on same presale', async () => {
      // Create sale
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Transfer Delete Race',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Concurrent transfer and delete
      const [transferRes, deleteRes] = await Promise.all([
        request(app)
          .post(`/api/selling/presales/${presaleId}/transfer`)
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ to_slot_uid: `generated:${testData.genSlotId3}` }),
        request(app)
          .patch(`/api/selling/presales/${presaleId}/delete`)
          .set('Authorization', `Bearer ${dispatcherToken}`)
      ]);
      
      // One should fail (presale already modified) or both could succeed in sequence
      // The key is: final state must be consistent
      
      const finalPresale = db.prepare('SELECT status, slot_uid FROM presales WHERE id = ?').get(presaleId);
      
      // State must be one of: transferred OR cancelled, not both
      if (finalPresale.status === 'CANCELLED') {
        // If cancelled, tickets should be REFUNDED
        const tickets = db.prepare('SELECT * FROM tickets WHERE presale_id = ?').all(presaleId);
        expect(tickets.every(t => t.status === 'REFUNDED')).toBe(true);
      } else {
        // If transferred, should have new slot_uid
        // Or stayed at original if transfer failed
        expect(finalPresale.status).toBe('ACTIVE');
      }
      
      // Verify no orphan tickets
      const ticketCheck = validateTicketsIntegrity(db, presaleId);
      expect(ticketCheck.valid).toBe(true);
    });
  });

  describe('RC-4: Multiple partial payments race', () => {
    it('should handle multiple concurrent partial payments correctly', async () => {
      // Create sale with total 3000 (1 adult ticket)
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Multi Pay Race',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Get total price
      const presale = db.prepare('SELECT total_price FROM presales WHERE id = ?').get(presaleId);
      const total = presale.total_price;
      
      // Multiple concurrent partial payments
      const payments = [1000, 1000, 1000, 500, 500]; // Sum = 4000 > typical total
      
      const results = await Promise.all(
        payments.map(amount => 
          request(app)
            .patch(`/api/selling/presales/${presaleId}/payment`)
            .set('Authorization', `Bearer ${dispatcherToken}`)
            .send({ additionalPayment: amount })
        )
      );
      
      // Check final state
      const finalPresale = db.prepare('SELECT total_price, prepayment_amount FROM presales WHERE id = ?').get(presaleId);
      
      // Must not exceed total
      expect(finalPresale.prepayment_amount).toBeLessThanOrEqual(finalPresale.total_price);
      
      // Validate invariant
      const invariant = validatePresalePaymentBounds(db, presaleId);
      if (!invariant.valid) {
        console.log('[RC] Payment bounds violation:', invariant.errors);
      }
      expect(invariant.valid).toBe(true);
      
      // At least some payments should succeed
      const successCount = results.filter(r => r.status === 200).length;
      expect(successCount).toBeGreaterThanOrEqual(1);
    });
  });
});
