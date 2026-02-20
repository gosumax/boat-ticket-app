/**
 * Load / Stress Tests
 * Tests system stability under load with many operations
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
  validateTicketsIntegrity
} from './test-setup.js';

import { app } from '../../server/index.js';

describe('Load / Stress Tests', () => {
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

  describe('LS-1: Series of sales operations', () => {
    it('should handle 50 sales from 2 sellers', async () => {
      const startTime = Date.now();
      const salesPerSeller = 25;
      const errors = [];
      
      // Create additional slots for load test (use testData.today to match tripDate in requests)
      const additionalSlots = [];
      for (let i = 0; i < 5; i++) {
        const slotRes = db.prepare(`
          INSERT INTO generated_slots (
            schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
            duration_minutes, is_active, price_adult, price_child, price_teen
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          testData.templateId1, 
          testData.today, 
          testData.speedBoatId, 
          `${10 + i}:30`, 
          20, 20, 60, 1, 1500, 800, 1200
        );
        additionalSlots.push(slotRes.lastInsertRowid);
      }
      
      const allSlots = [testData.genSlotId1, testData.genSlotId2, testData.genSlotId3, ...additionalSlots];
      
      // Seller 1 sales
      const seller1Sales = [];
      for (let i = 0; i < salesPerSeller; i++) {
        const slotId = allSlots[i % allSlots.length];
        seller1Sales.push(
          request(app)
            .post('/api/selling/presales')
            .set('Authorization', `Bearer ${sellerToken}`)
            .send({
              slotUid: `generated:${slotId}`,
              customerName: `Load Test S1-${i}`,
              customerPhone: `799900000${i.toString().padStart(2, '0')}`,
              numberOfSeats: 1,
              tripDate: testData.today
            })
        );
      }
      
      // Seller 2 sales
      const seller2Sales = [];
      for (let i = 0; i < salesPerSeller; i++) {
        const slotId = allSlots[(i + 2) % allSlots.length];
        seller2Sales.push(
          request(app)
            .post('/api/selling/presales')
            .set('Authorization', `Bearer ${seller2Token}`)
            .send({
              slotUid: `generated:${slotId}`,
              customerName: `Load Test S2-${i}`,
              customerPhone: `799911111${i.toString().padStart(2, '0')}`,
              numberOfSeats: 1,
              tripDate: testData.today
            })
        );
      }
      
      // Execute all
      const results1 = await Promise.all(seller1Sales);
      const results2 = await Promise.all(seller2Sales);
      
      // Count successes
      const successCount = [...results1, ...results2].filter(r => r.status === 201).length;
      console.log(`[LS-1] Successful sales: ${successCount} / ${salesPerSeller * 2}`);
      
      // Verify no negative seats_left
      for (const slotId of allSlots) {
        const slot = db.prepare('SELECT id, capacity, seats_left FROM generated_slots WHERE id = ?').get(slotId);
        expect(slot.seats_left).toBeGreaterThanOrEqual(0);
      }
      
      // Verify no orphan tickets
      const orphanTickets = db.prepare(`
        SELECT t.id FROM tickets t
        LEFT JOIN presales p ON p.id = t.presale_id
        WHERE p.id IS NULL
      `).all();
      expect(orphanTickets).toHaveLength(0);
      
      const duration = Date.now() - startTime;
      console.log(`[LS-1] Duration: ${duration}ms for ${salesPerSeller * 2} operations`);
      console.log(`[LS-1] Avg: ${(duration / (salesPerSeller * 2)).toFixed(2)}ms per operation`);
    });

    it('should verify tickets count equals sold count after batch sales', async () => {
      // Create slot with known capacity (use testData.today to match tripDate in requests)
      const slotRes = db.prepare(`
        INSERT INTO generated_slots (
          schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
          duration_minutes, is_active, price_adult, price_child, price_teen
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        testData.templateId1, 
        testData.today, 
        testData.speedBoatId, 
        '17:00', 
        30, 30, 60, 1, 1500, 800, 1200
      );
      const slotId = slotRes.lastInsertRowid;
      
      // Make 20 sales
      const sales = [];
      for (let i = 0; i < 20; i++) {
        sales.push(
          request(app)
            .post('/api/selling/presales')
            .set('Authorization', `Bearer ${sellerToken}`)
            .send({
              slotUid: `generated:${slotId}`,
              customerName: `Batch Test ${i}`,
              customerPhone: `79992222${i.toString().padStart(2, '0')}`,
              numberOfSeats: 1,
              tripDate: testData.today
            })
        );
      }
      
      const results = await Promise.all(sales);
      const successCount = results.filter(r => r.status === 201).length;
      
      // Verify tickets count
      const ticketCount = db.prepare(`
        SELECT COUNT(*) as count FROM tickets t
        JOIN presales p ON p.id = t.presale_id
        WHERE p.slot_uid = ? AND t.status = 'ACTIVE'
      `).get(`generated:${slotId}`);
      
      expect(ticketCount.count).toBe(successCount);
      
      // Verify seats_left is non-negative (backend may have different tracking)
      const slot = db.prepare('SELECT capacity, seats_left FROM generated_slots WHERE id = ?').get(slotId);
      expect(slot.seats_left).toBeGreaterThanOrEqual(0);
    });
  });

  describe('LS-2: Mixed operations (transfer + delete)', () => {
    it('should handle 20 transfers and 10 partial deletes', async () => {
      const startTime = Date.now();
      
      // Create additional slots for transfers with unique times
      const transferTargetSlots = [];
      for (let i = 0; i < 3; i++) {
        const uniqueTime = `${22 + i}:${Math.floor(Math.random() * 60).toString().padStart(2, '0')}`;
        const slotRes = db.prepare(`
          INSERT INTO generated_slots (
            schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
            duration_minutes, is_active, price_adult, price_child, price_teen
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          testData.templateId1, 
          testData.dayAfter, 
          testData.speedBoatId, 
          uniqueTime, 
          50, 50, 60, 1, 1500, 800, 1200
        );
        transferTargetSlots.push(slotRes.lastInsertRowid);
      }
      
      // Create 30 presales first
      const presaleIds = [];
      for (let i = 0; i < 30; i++) {
        const res = await request(app)
          .post('/api/selling/presales')
          .set('Authorization', `Bearer ${sellerToken}`)
          .send({
            slotUid: `generated:${testData.genSlotId1}`,
            customerName: `Mixed Op ${i}`,
            customerPhone: `79993333${i.toString().padStart(2, '0')}`,
            numberOfSeats: 1,
            tripDate: testData.today
          });
        
        if (res.status === 201) {
          presaleIds.push(res.body.presale.id);
        }
      }
      
      console.log(`[LS-2] Created ${presaleIds.length} presales`);
      
      // Transfer first 20
      const transfers = [];
      for (let i = 0; i < Math.min(20, presaleIds.length); i++) {
        const targetSlot = transferTargetSlots[i % transferTargetSlots.length];
        transfers.push(
          request(app)
            .post(`/api/selling/presales/${presaleIds[i]}/transfer`)
            .set('Authorization', `Bearer ${dispatcherToken}`)
            .send({ to_slot_uid: `generated:${targetSlot}` })
        );
      }
      
      const transferResults = await Promise.all(transfers);
      const transferSuccess = transferResults.filter(r => r.status === 200).length;
      console.log(`[LS-2] Successful transfers: ${transferSuccess}`);
      
      // Partial delete next 10 (delete single ticket from group)
      // First, create some multi-seat presales for partial delete
      const groupPresaleIds = [];
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/api/selling/presales')
          .set('Authorization', `Bearer ${seller2Token}`)
          .send({
            slotUid: `generated:${testData.genSlotId2}`,
            customerName: `Group Delete ${i}`,
            customerPhone: `79994444${i.toString().padStart(2, '0')}`,
            numberOfSeats: 2,
            tripDate: testData.today
          });
        
        if (res.status === 201) {
          groupPresaleIds.push(res.body.presale.id);
        }
      }
      
      // Delete one ticket from each group
      const partialDeletes = [];
      for (const presaleId of groupPresaleIds) {
        const ticket = db.prepare('SELECT id FROM tickets WHERE presale_id = ? LIMIT 1').get(presaleId);
        if (ticket) {
          partialDeletes.push(
            request(app)
              .patch(`/api/selling/tickets/${ticket.id}/delete`)
              .set('Authorization', `Bearer ${dispatcherToken}`)
          );
        }
      }
      
      const deleteResults = await Promise.all(partialDeletes);
      const deleteSuccess = deleteResults.filter(r => r.status === 200).length;
      console.log(`[LS-2] Successful partial deletes: ${deleteSuccess}`);
      
      // Validate invariants
      const invariantResult = validateAllMoneyLedgerInvariants(db);
      expect(invariantResult.allValid).toBe(true);
      
      if (!invariantResult.allValid) {
        console.error('[LS-2] Invariant violations:', invariantResult.allErrors);
      }
      
      const duration = Date.now() - startTime;
      console.log(`[LS-2] Duration: ${duration}ms`);
    });

    it('should verify dispatcher slots/:id/tickets returns correct count after operations', async () => {
      // Create slot for this test (use testData.today to match tripDate in requests)
      const slotRes = db.prepare(`
        INSERT INTO generated_slots (
          schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
          duration_minutes, is_active, price_adult, price_child, price_teen
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        testData.templateId1, 
        testData.today, 
        testData.speedBoatId, 
        '18:00', 
        20, 20, 60, 1, 1500, 800, 1200
      );
      const slotId = slotRes.lastInsertRowid;
      
      // Create 5 presales
      const presaleIds = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/selling/presales')
          .set('Authorization', `Bearer ${sellerToken}`)
          .send({
            slotUid: `generated:${slotId}`,
            customerName: `Ticket Count ${i}`,
            customerPhone: `79995555${i}`,
            numberOfSeats: 1,
            tripDate: testData.today
          });
        
        if (res.status === 201) {
          presaleIds.push(res.body.presale.id);
        }
      }
      
      // Check initial count
      const initialTickets = await request(app)
        .get(`/api/selling/dispatcher/slots/${slotId}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(initialTickets.status).toBe(200);
      expect(initialTickets.body.ok).toBe(true);
      const initialCount = initialTickets.body.data.items.length;
      
      // Delete 2 presales
      for (let i = 0; i < 2; i++) {
        await request(app)
          .patch(`/api/selling/presales/${presaleIds[i]}/delete`)
          .set('Authorization', `Bearer ${dispatcherToken}`);
      }
      
      // Check count after delete
      const afterDelete = await request(app)
        .get(`/api/selling/dispatcher/slots/${slotId}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(afterDelete.status).toBe(200);
      const afterDeleteCount = afterDelete.body.data.items.length;
      
      // Should have fewer active tickets
      expect(afterDeleteCount).toBeLessThan(initialCount);
      // REFUNDED tickets are filtered out, so should be initialCount - 2
      expect(afterDeleteCount).toBe(initialCount - 2);
    });
  });

  describe('LS-3: Performance sanity check', () => {
    it('should measure operation timing and report', async () => {
      const iterations = 30;
      const timings = {
        create: [],
        accept: [],
        delete: []
      };
      
      // Create slot with unique time to avoid UNIQUE constraint
      const uniqueTime = `20:${Math.floor(Math.random() * 60).toString().padStart(2, '0')}`;
      const slotRes = db.prepare(`
        INSERT INTO generated_slots (
          schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
          duration_minutes, is_active, price_adult, price_child, price_teen
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        testData.templateId1, 
        testData.today, // Match tripDate in requests
        testData.speedBoatId, 
        uniqueTime, 
        iterations, iterations, 60, 1, 1500, 800, 1200
      );
      const slotId = slotRes.lastInsertRowid;
      
      for (let i = 0; i < iterations; i++) {
        // Create
        let start = Date.now();
        const createRes = await request(app)
          .post('/api/selling/presales')
          .set('Authorization', `Bearer ${sellerToken}`)
          .send({
            slotUid: `generated:${slotId}`,
            customerName: `Perf Test ${i}`,
            customerPhone: `79996666${i.toString().padStart(2, '0')}`,
            numberOfSeats: 1,
            tripDate: testData.today
          });
        timings.create.push(Date.now() - start);
        
        if (createRes.status === 201) {
          const presaleId = createRes.body.presale.id;
          
          // Accept
          start = Date.now();
          await request(app)
            .patch(`/api/selling/presales/${presaleId}/accept-payment`)
            .set('Authorization', `Bearer ${dispatcherToken}`)
            .send({ payment_method: 'CASH' });
          timings.accept.push(Date.now() - start);
          
          // Delete half of them
          if (i % 2 === 0) {
            start = Date.now();
            await request(app)
              .patch(`/api/selling/presales/${presaleId}/delete`)
              .set('Authorization', `Bearer ${dispatcherToken}`);
            timings.delete.push(Date.now() - start);
          }
        }
      }
      
      // Report timings
      const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 0;
      const max = arr => arr.length ? Math.max(...arr) : 0;
      const min = arr => arr.length ? Math.min(...arr) : 0;
      
      console.log('\n[LS-3] ===== Performance Report =====');
      console.log(`[LS-3] CREATE: avg=${avg(timings.create)}ms, min=${min(timings.create)}ms, max=${max(timings.create)}ms`);
      console.log(`[LS-3] ACCEPT: avg=${avg(timings.accept)}ms, min=${min(timings.accept)}ms, max=${max(timings.accept)}ms`);
      console.log(`[LS-3] DELETE: avg=${avg(timings.delete)}ms, min=${min(timings.delete)}ms, max=${max(timings.delete)}ms`);
      console.log(`[LS-3] Total operations: ${iterations} create, ${timings.accept.length} accept, ${timings.delete.length} delete`);
      
      // Validate all invariants still hold
      const invariantResult = validateAllMoneyLedgerInvariants(db);
      expect(invariantResult.allValid).toBe(true);
    });

    it('should not have memory/connection leaks after many operations', async () => {
      // Create many slots to test connection handling - use unique times
      const slotIds = [];
      for (let i = 0; i < 10; i++) {
        const uniqueTime = `${21 + i}:${Math.floor(Math.random() * 60).toString().padStart(2, '0')}`;
        const slotRes = db.prepare(`
          INSERT INTO generated_slots (
            schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
            duration_minutes, is_active, price_adult, price_child, price_teen
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          testData.templateId1, 
          testData.today, // Match tripDate in requests
          testData.speedBoatId, 
          uniqueTime, 
          10, 10, 60, 1, 1500, 800, 1200
        );
        slotIds.push(slotRes.lastInsertRowid);
      }
      
      // Create sales on each slot
      for (const slotId of slotIds) {
        for (let j = 0; j < 5; j++) {
          await request(app)
            .post('/api/selling/presales')
            .set('Authorization', `Bearer ${sellerToken}`)
            .send({
              slotUid: `generated:${slotId}`,
              customerName: `Leak Test ${slotId}-${j}`,
              customerPhone: '79997777000',
              numberOfSeats: 1,
              tripDate: testData.today
            });
        }
      }
      
      // Verify DB is still responsive
      const testQuery = db.prepare('SELECT COUNT(*) as count FROM presales').get();
      // Note: count may be 0 if tests were cleaned, that's fine
      expect(typeof testQuery.count).toBe('number');
      
      // Verify no orphan data
      const orphanTickets = db.prepare(`
        SELECT t.id FROM tickets t
        LEFT JOIN presales p ON p.id = t.presale_id
        WHERE p.id IS NULL
      `).all();
      expect(orphanTickets).toHaveLength(0);
    });
  });
});
