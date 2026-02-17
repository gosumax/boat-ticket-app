/**
 * Dispatcher Transfer API Tests (Supertest) - REAL BACKEND
 * Tests real transfer endpoints from server/selling.mjs
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

// Helper functions for seat count assertions
async function getBoatSlotSeatsLeft(db, boatSlotId) {
  return db.prepare('SELECT seats_left, capacity FROM boat_slots WHERE id = ?').get(boatSlotId);
}

async function getPresaleBoatSlotId(db, presaleId) {
  return db.prepare('SELECT boat_slot_id FROM presales WHERE id = ?').get(presaleId)?.boat_slot_id;
}

describe('Dispatcher Transfer API (Real Backend)', () => {
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
  
  describe('6️⃣ Перенос всего билета на другую дату', () => {
    let presaleId;
    
    beforeEach(async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Transfer Client',
          customerPhone: '79991234567',
          numberOfSeats: 2,
          tripDate: testData.today
        });
      
      if (res.status !== 201) {
        console.log('Presale creation failed:', res.status, JSON.stringify(res.body, null, 2));
      }
      
      presaleId = res.body?.presale?.id;
    });
    
    it('should transfer presale to different slot', async () => {
      const res = await request(app)
        .post(`/api/selling/presales/${presaleId}/transfer`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          to_slot_uid: `generated:${testData.genSlotId3}`
        });
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.movedSeats).toBe(2);
      
      // Check seats decreased in target boat_slot
      const newBoatSlotId = await getPresaleBoatSlotId(db, presaleId);
      const targetSeats = (await getBoatSlotSeatsLeft(db, newBoatSlotId)).seats_left;
      expect(targetSeats).toBe(10); // 12 - 2
    });
    
    it('should update slot_uid after transfer', async () => {
      await request(app)
        .post(`/api/selling/presales/${presaleId}/transfer`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          to_slot_uid: `generated:${testData.genSlotId3}`
        });
      
      const presale = db.prepare('SELECT slot_uid FROM presales WHERE id = ?').get(presaleId);
      expect(presale.slot_uid).toBe(`generated:${testData.genSlotId3}`);
    });
    
    it('should require to_slot_uid', async () => {
      const res = await request(app)
        .post(`/api/selling/presales/${presaleId}/transfer`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({});
      
      expect(res.status).toBe(400);
    });
    
    it('should reject transfer to non-existent slot', async () => {
      const res = await request(app)
        .post(`/api/selling/presales/${presaleId}/transfer`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          to_slot_uid: 'generated:9999'
        });
      
      expect(res.status).not.toBe(200);
    });
  });
  
  describe('8️⃣ Перенос обратно', () => {
    let presaleId;
    
    beforeEach(async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Back Transfer Client',
          customerPhone: '79991234569',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      presaleId = res.body.presale.id;
    });
    
    it('should transfer presale back to original slot', async () => {
      // Transfer to slot 3
      await request(app)
        .post(`/api/selling/presales/${presaleId}/transfer`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          to_slot_uid: `generated:${testData.genSlotId3}`
        });
      
      // Transfer back to slot 1
      const res = await request(app)
        .post(`/api/selling/presales/${presaleId}/transfer`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          to_slot_uid: `generated:${testData.genSlotId1}`
        });
      
      expect(res.status).toBe(200);
      
      const presale = db.prepare('SELECT slot_uid FROM presales WHERE id = ?').get(presaleId);
      expect(presale.slot_uid).toBe(`generated:${testData.genSlotId1}`);
    });
    
    it('should maintain correct seat counts after back transfer', async () => {
      const initialBoatSlotId = await getPresaleBoatSlotId(db, presaleId);
      const initialSeats = (await getBoatSlotSeatsLeft(db, initialBoatSlotId)).seats_left;
      
      // Transfer away
      await request(app)
        .post(`/api/selling/presales/${presaleId}/transfer`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          to_slot_uid: `generated:${testData.genSlotId3}`
        });
      
      // Transfer back
      await request(app)
        .post(`/api/selling/presales/${presaleId}/transfer`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          to_slot_uid: `generated:${testData.genSlotId1}`
        });
      
      const finalBoatSlotId = await getPresaleBoatSlotId(db, presaleId);
      const finalSeats = (await getBoatSlotSeatsLeft(db, finalBoatSlotId)).seats_left;
      expect(finalSeats).toBe(initialSeats);
    });
  });
  
  describe('Transfer Authorization', () => {
    let presaleId;
    
    beforeEach(async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Auth Test',
          customerPhone: '79991234569',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      presaleId = res.body.presale.id;
    });
    
    it('should reject unauthenticated transfer', async () => {
      const res = await request(app)
        .post(`/api/selling/presales/${presaleId}/transfer`)
        .send({
          to_slot_uid: `generated:${testData.genSlotId3}`
        });
      
      expect(res.status).toBe(401);
    });
    
    it('should reject transfer of non-existent presale', async () => {
      const res = await request(app)
        .post('/api/selling/presales/9999/transfer')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          to_slot_uid: `generated:${testData.genSlotId3}`
        });
      
      expect(res.status).not.toBe(200);
    });
  });
  
  describe('Database Verification', () => {
    it('should update presales.slot_uid after transfer', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'DB Transfer Test',
          customerPhone: '79991234599',
          numberOfSeats: 1,
          tripDate: testData.today
        });
      
      const presaleId = res.body.presale.id;
      
      await request(app)
        .post(`/api/selling/presales/${presaleId}/transfer`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          to_slot_uid: `generated:${testData.genSlotId3}`
        });
      
      const presale = db.prepare('SELECT slot_uid FROM presales WHERE id = ?').get(presaleId);
      expect(presale.slot_uid).toBe(`generated:${testData.genSlotId3}`);
    });
    
    it('should update boat_slots.seats_left for both slots', async () => {
      const res = await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          slotUid: `generated:${testData.genSlotId1}`,
          customerName: 'Seats Transfer Test',
          customerPhone: '79991234599',
          numberOfSeats: 2,
          tripDate: testData.today
        });
      
      const presaleId = res.body.presale.id;
      
      // Verify target boat_slot has correct seats after transfer
      await request(app)
        .post(`/api/selling/presales/${presaleId}/transfer`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({
          to_slot_uid: `generated:${testData.genSlotId3}`
        });
      
      // After transfer, check new boat_slot_id has reduced seats
      const newBoatSlotId = await getPresaleBoatSlotId(db, presaleId);
      const targetAfter = (await getBoatSlotSeatsLeft(db, newBoatSlotId)).seats_left;
      expect(targetAfter).toBe(10); // 12 - 2
    });
  });
});
