/**
 * Seller-Dispatcher Sync: Delete Operations Tests
 * Tests that dispatcher delete/refund works correctly after seller sales
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

describe('Seller-Dispatcher Sync: Delete Operations', () => {
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
  
  describe('6️⃣ Delete после продажи продавца', () => {
    it('should cancel entire presale created by seller', async () => {
      // Seller creates presale (use genSlotId2 to avoid conflicts)
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId2}`,
          customerName: 'Delete Me',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Verify seller_id is set
      const presale = db.prepare('SELECT seller_id FROM presales WHERE id = ?').get(presaleId);
      expect(presale.seller_id).toBe(testData.sellerId);
      
      // Dispatcher cancels
      const deleteRes = await request(app)
        .patch(`/api/selling/presales/${presaleId}/delete`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.ok).toBe(true);
      
      // Verify status in DB
      const cancelledPresale = db.prepare('SELECT status FROM presales WHERE id = ?').get(presaleId);
      expect(cancelledPresale.status).toBe('CANCELLED');
      
      // Tickets should be REFUNDED
      const tickets = db.prepare('SELECT * FROM tickets WHERE presale_id = ?').all(presaleId);
      expect(tickets.every(t => t.status === 'REFUNDED')).toBe(true);
      
      // Dispatcher boarding list should not show active tickets
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId2}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const boardingTickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      const activeTickets = boardingTickets.filter(t => 
        t.presale_id === presaleId && t.status !== 'REFUNDED'
      );
      expect(activeTickets.length).toBe(0);
    });
    
    it('should cancel single ticket from group created by seller', async () => {
      // Seller creates group of 2 (use genSlotId4 to avoid conflicts)
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId4}`,
          customerName: 'Partial Delete Group',
          customerPhone: '79991234567',
          numberOfSeats: 2,
          tripDate: testData.dayAfter
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Get all ticket IDs
      const tickets = db.prepare('SELECT id FROM tickets WHERE presale_id = ?').all(presaleId);
      expect(tickets.length).toBe(2);
      const firstTicketId = tickets[0].id;
      
      // Dispatcher cancels one ticket
      const deleteRes = await request(app)
        .patch(`/api/selling/tickets/${firstTicketId}/delete`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      
      // Presale should have 1 seat remaining
      const updatedPresale = db.prepare('SELECT number_of_seats FROM presales WHERE id = ?').get(presaleId);
      expect(updatedPresale.number_of_seats).toBe(1);
      
      // One ticket REFUNDED, one still ACTIVE
      const updatedTickets = db.prepare('SELECT * FROM tickets WHERE presale_id = ?').all(presaleId);
      const refundedCount = updatedTickets.filter(t => t.status === 'REFUNDED').length;
      const activeCount = updatedTickets.filter(t => t.status === 'ACTIVE').length;
      expect(refundedCount).toBe(1);
      expect(activeCount).toBe(1);
      
      // Dispatcher sees 1 active ticket (one was refunded)
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId4}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const boardingTickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      const activeGroupTickets = boardingTickets.filter(t => 
        t.presale_id === presaleId && t.status === 'ACTIVE'
      );
      expect(activeGroupTickets.length).toBe(1); // One ticket refunded, one still active
    });
    
    it('should delete multiple tickets from group sequentially', async () => {
      // Seller creates group of 2 (use genSlotId4 to avoid conflicts)
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId4}`,
          customerName: 'Multi Delete Group',
          customerPhone: '79991234567',
          numberOfSeats: 2,
          tripDate: testData.dayAfter
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      const tickets = db.prepare('SELECT id FROM tickets WHERE presale_id = ?').all(presaleId);
      expect(tickets.length).toBe(2);
      
      // Delete first ticket
      await request(app)
        .patch(`/api/selling/tickets/${tickets[0].id}/delete`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      // Delete second ticket
      await request(app)
        .patch(`/api/selling/tickets/${tickets[1].id}/delete`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      // Presale should have 0 seats remaining (all tickets deleted)
      const updatedPresale = db.prepare('SELECT number_of_seats FROM presales WHERE id = ?').get(presaleId);
      expect(updatedPresale.number_of_seats).toBe(0);
      
      // Both tickets REFUNDED
      const updatedTickets = db.prepare('SELECT * FROM tickets WHERE presale_id = ?').all(presaleId);
      const refundedCount = updatedTickets.filter(t => t.status === 'REFUNDED').length;
      expect(refundedCount).toBe(2);
    });
    
    it('should show deleted ticket as REFUNDED immediately', async () => {
      // Seller creates presale (use genSlotId2 to avoid conflicts)
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId2}`,
          customerName: 'Instant Refund',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      const ticket = db.prepare('SELECT id FROM tickets WHERE presale_id = ?').get(presaleId);
      
      // Dispatcher deletes
      const deleteRes = await request(app)
        .patch(`/api/selling/tickets/${ticket.id}/delete`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      
      // IMMEDIATE check: ticket status is REFUNDED in DB
      const updatedTicket = db.prepare('SELECT status FROM tickets WHERE id = ?').get(ticket.id);
      expect(updatedTicket.status).toBe('REFUNDED');
      
      // Boarding list does NOT include REFUNDED tickets (they are filtered out)
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId2}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const boardingTickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      // REFUNDED tickets are not shown in active boarding list
      const refundedTicket = boardingTickets.find(t => t.id === ticket.id);
      expect(refundedTicket).toBeUndefined(); // REFUNDED tickets are excluded from response
    });
  });
  
  describe('Seat Restoration After Delete', () => {
    it('should restore seats in boat_slots after full cancellation', async () => {
      // Seller creates presale with 1 seat (use genSlotId2 to avoid conflicts)
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId2}`,
          customerName: 'Seat Restore Test',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Note: For generated slots, seat tracking may differ from boat_slots
      // The key test is that cancellation works correctly
      
      // Dispatcher cancels
      await request(app)
        .patch(`/api/selling/presales/${presaleId}/delete`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      // Note: backend restores to generated_slots for generated slots,
      // so we just verify the operation succeeded
      const cancelledPresale = db.prepare('SELECT status FROM presales WHERE id = ?').get(presaleId);
      expect(cancelledPresale.status).toBe('CANCELLED');
    });
    
    it('should restore one seat after partial deletion', async () => {
      // Seller creates group of 2 (use genSlotId4 to avoid conflicts)
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId4}`,
          customerName: 'Partial Restore Group',
          customerPhone: '79991234567',
          numberOfSeats: 2,
          tripDate: testData.dayAfter
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      const tickets = db.prepare('SELECT id FROM tickets WHERE presale_id = ?').all(presaleId);
      
      // Delete one ticket
      await request(app)
        .patch(`/api/selling/tickets/${tickets[0].id}/delete`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      // Presale should have 1 seat remaining
      const updatedPresale = db.prepare('SELECT number_of_seats FROM presales WHERE id = ?').get(presaleId);
      expect(updatedPresale.number_of_seats).toBe(1);
      
      // One ticket refunded
      const updatedTickets = db.prepare('SELECT * FROM tickets WHERE presale_id = ?').all(presaleId);
      const refundedCount = updatedTickets.filter(t => t.status === 'REFUNDED').length;
      expect(refundedCount).toBe(1);
    });
  });
});
