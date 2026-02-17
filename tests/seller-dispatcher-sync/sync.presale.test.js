/**
 * Seller-Dispatcher Sync: Presale Operations Tests
 * Tests presale-specific operations and visibility
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

describe('Seller-Dispatcher Sync: Presale Operations', () => {
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
  
  describe('Presale Creation by Seller', () => {
    it('should create presale and sync customer details to dispatcher', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId2}`,
          customerName: 'Detailed Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      // Verify full data in DB
      const presale = db.prepare(`
        SELECT id, customer_name, customer_phone, number_of_seats, total_price, seller_id
        FROM presales WHERE id = ?
      `).get(presaleId);
      
      expect(presale.customer_name).toBe('Detailed Client');
      expect(presale.customer_phone).toBe('79991234567');
      expect(presale.number_of_seats).toBe(1);
      expect(presale.seller_id).toBe(testData.sellerId);
      
      // Dispatcher sees all details
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId2}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const tickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      const myTickets = tickets.filter(t => t.customer_name === 'Detailed Client');
      expect(myTickets.length).toBeGreaterThan(0);
    });
    
    it('should create multiple presales for same customer', async () => {
      // First booking
      await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Repeat Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      // Second booking
      await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Repeat Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      // Dispatcher sees both
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
      expect(boardingRes.body.ok).toBe(true);
      const tickets = Array.isArray(boardingRes.body?.data?.items) ? boardingRes.body.data.items : [];
      const repeatTickets = tickets.filter(t => t.customer_name === 'Repeat Client');
      expect(repeatTickets.length).toBeGreaterThanOrEqual(2);
    });
  });
  
  describe('Presale Status Visibility', () => {
    it('should show ACTIVE presale immediately', async () => {
      const saleRes = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Active Client',
          customerPhone: '79991234567',
          numberOfSeats: 1,
          tripDate: testData.tomorrow
        });
      
      expect(saleRes.status).toBe(201);
      const presaleId = saleRes.body.presale.id;
      
      const presale = db.prepare('SELECT status FROM presales WHERE id = ?').get(presaleId);
      expect(presale.status).toBe('ACTIVE');
      
      // Dispatcher sees ACTIVE status
      const boardingRes = await request(app)
        .get(`/api/selling/dispatcher/slots/${testData.genSlotId1}/tickets`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(boardingRes.status).toBe(200);
    });
  });
});
