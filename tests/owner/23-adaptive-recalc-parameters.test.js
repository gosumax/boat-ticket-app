// 23-adaptive-recalc-parameters.test.js — Parameter recalculation tests
// Tests that changing settings recalculates motivation correctly
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, ownerToken, ownerUserId;

// Test users
let sellerId, boatSpeedId, boatCruiseId, boatBananaId, slotSpeedId, slotCruiseId, slotBananaId;

// Different test days for each scenario
const DAY1 = '2030-02-01';
const DAY2 = '2030-02-02';
const DAY3 = '2030-02-03';
const DAY4 = '2030-02-04';
const DAY5 = '2030-02-05';
const DAY6 = '2030-02-06';

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  
  // Create owner user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const ownerRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'owner', 1)
  `).run('test_owner', hashedPassword);
  ownerUserId = ownerRes.lastInsertRowid;
  ownerToken = jwt.sign({ id: ownerUserId, username: 'test_owner', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Ensure owner_settings row exists
  db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
  
  // Create seller with zone
  const sellerRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active, zone)
    VALUES (?, ?, 'seller', 1, 'center')
  `).run('test_seller', hashedPassword);
  sellerId = sellerRes.lastInsertRowid;
  
  // Create boats of different types
  const speedBoatRes = db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child)
    VALUES (?, 'speed', 1, 1000, 500)
  `).run('Speed Test Boat');
  boatSpeedId = speedBoatRes.lastInsertRowid;
  
  const cruiseBoatRes = db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child)
    VALUES (?, 'cruise', 1, 800, 400)
  `).run('Cruise Test Boat');
  boatCruiseId = cruiseBoatRes.lastInsertRowid;
  
  const bananaBoatRes = db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child)
    VALUES (?, 'banana', 1, 500, 250)
  `).run('Banana Test Boat');
  boatBananaId = bananaBoatRes.lastInsertRowid;
  
  // Create slots for each boat type
  const slotSpeedRes = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, is_active, price_adult, price_child, duration_minutes)
    VALUES (?, '10:00', 1000, 10, 10, 1, 1000, 500, 60)
  `).run(boatSpeedId);
  slotSpeedId = slotSpeedRes.lastInsertRowid;
  
  const slotCruiseRes = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, is_active, price_adult, price_child, duration_minutes)
    VALUES (?, '11:00', 800, 20, 20, 1, 800, 400, 120)
  `).run(boatCruiseId);
  slotCruiseId = slotCruiseRes.lastInsertRowid;
  
  const slotBananaRes = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, is_active, price_adult, price_child, duration_minutes)
    VALUES (?, '12:00', 500, 8, 8, 1, 500, 250, 30)
  `).run(boatBananaId);
  slotBananaId = slotBananaRes.lastInsertRowid;
});

beforeEach(() => {
  // Clean up all test data
  db.prepare(`DELETE FROM motivation_day_settings`).run();
  [DAY1, DAY2, DAY3, DAY4, DAY5, DAY6].forEach(day => {
    db.prepare(`DELETE FROM money_ledger WHERE business_day = ?`).run(day);
    db.prepare(`DELETE FROM presales WHERE business_day = ?`).run(day);
    db.prepare(`DELETE FROM sales_transactions_canonical WHERE business_day = ?`).run(day);
  });
  db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
});

// Helper to create a sale for a specific day and boat type
function createSale(day, amount, sellerUserId, boatType = 'speed', zoneAtSale = 'center') {
  let slotId;
  if (boatType === 'speed') slotId = slotSpeedId;
  else if (boatType === 'cruise') slotId = slotCruiseId;
  else if (boatType === 'banana') slotId = slotBananaId;
  else slotId = slotSpeedId;
  
  // Create presale
  const presaleRes = db.prepare(`
    INSERT INTO presales (customer_name, customer_phone, number_of_seats, total_price, business_day, status, boat_slot_id, seller_id, zone_at_sale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('Test Customer', '79991234567', 1, amount, day, 'ACTIVE', slotId, sellerUserId, zoneAtSale);
  const presaleId = presaleRes.lastInsertRowid;
  
  // Create money_ledger entry
  db.prepare(`
    INSERT INTO money_ledger (presale_id, slot_id, trip_day, business_day, kind, type, method, amount, status, seller_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(presaleId, slotId, day, day, 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 'CASH', amount, 'POSTED', sellerUserId);
  
  return presaleId;
}

describe('ADAPTIVE RECALCULATION PARAMETERS', () => {
  
  describe('A) motivation_percent change affects fundTotal', () => {
    
    it('fundTotal changes proportionally with motivation_percent', async () => {
      // Set motivation_percent = 0.14
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          motivation_percent: 0.14,
          individual_share: 0.6,
          team_share: 0.4
        });
      
      createSale(DAY1, 100000, sellerId, 'speed'); // 100k revenue
      
      const res1 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const fundTotal1 = res1.body.data.fundTotal;
      
      // Delete snapshot and change to 0.16
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY2);
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          motivation_percent: 0.16,
          individual_share: 0.6,
          team_share: 0.4
        });
      
      createSale(DAY2, 100000, sellerId, 'speed'); // Same 100k revenue
      
      const res2 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY2}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const fundTotal2 = res2.body.data.fundTotal;
      
      // fundTotal2 should be 0.16/0.14 times fundTotal1
      const ratio = fundTotal2 / fundTotal1;
      expect(ratio).toBeCloseTo(0.16 / 0.14, 1);
    });
    
    it('higher motivation_percent creates larger fund', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          motivation_percent: 0.10
        });
      
      createSale(DAY1, 50000, sellerId);
      
      const res1 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const fundLow = res1.body.data.fundTotal;
      
      // Reset for new test
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY2);
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          motivation_percent: 0.25
        });
      
      createSale(DAY2, 50000, sellerId); // Same revenue
      
      const res2 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY2}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const fundHigh = res2.body.data.fundTotal;
      
      expect(fundHigh).toBeGreaterThan(fundLow);
    });
  });
  
  describe('B) individual_share/team_share affect fund distribution', () => {
    
    it('individual_share + team_share = 1.0 normalizes', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          motivation_percent: 0.20,
          individual_share: 0.6,
          team_share: 0.4
        });
      
      createSale(DAY1, 100000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.individualFund).toBeDefined();
      expect(res.body.data.teamFund).toBeDefined();
      
      // individualFund + teamFund should equal fundTotal
      const sum = res.body.data.individualFund + res.body.data.teamFund;
      expect(sum).toBeCloseTo(res.body.data.fundTotal, -1); // Within 10 RUB due to rounding
    });
    
    it('changing individual_share changes distribution', async () => {
      // 60% individual, 40% team
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          motivation_percent: 0.20,
          individual_share: 0.6,
          team_share: 0.4
        });
      
      createSale(DAY1, 100000, sellerId);
      
      const res1 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const ratio1 = res1.body.data.individualFund / res1.body.data.teamFund;
      
      // Reset for new test
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY2);
      
      // 80% individual, 20% team
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          motivation_percent: 0.20,
          individual_share: 0.8,
          team_share: 0.2
        });
      
      createSale(DAY2, 100000, sellerId);
      
      const res2 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY2}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const ratio2 = res2.body.data.individualFund / res2.body.data.teamFund;
      
      // ratio2 (4:1) should be greater than ratio1 (3:2)
      expect(ratio2).toBeGreaterThan(ratio1);
    });
  });
  
  describe('C) k_speed/k_cruise affect points', () => {
    
    it('higher k_speed produces more points for same revenue', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 1.0,
          k_zone_center: 1.0
        });
      
      createSale(DAY1, 10000, sellerId, 'speed');
      
      const res1 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const points1 = res1.body.data.points_by_user.find(p => p.user_id === sellerId)?.points_total || 0;
      
      // Reset for new test
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY2);
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 2.0,
          k_zone_center: 1.0
        });
      
      createSale(DAY2, 10000, sellerId, 'speed');
      
      const res2 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY2}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const points2 = res2.body.data.points_by_user.find(p => p.user_id === sellerId)?.points_total || 0;
      
      // Double k_speed should double points
      expect(points2).toBeCloseTo(points1 * 2, 0);
    });
    
    it('higher k_cruise produces more points for cruise revenue', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_cruise: 1.0,
          k_zone_center: 1.0
        });
      
      createSale(DAY1, 10000, sellerId, 'cruise');
      
      const res1 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const points1 = res1.body.data.points_by_user.find(p => p.user_id === sellerId)?.points_total || 0;
      
      // Reset for new test
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY2);
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_cruise: 3.0,
          k_zone_center: 1.0
        });
      
      createSale(DAY2, 10000, sellerId, 'cruise');
      
      const res2 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY2}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const points2 = res2.body.data.points_by_user.find(p => p.user_id === sellerId)?.points_total || 0;
      
      // Triple k_cruise should triple points
      expect(points2).toBeCloseTo(points1 * 3, 0);
    });
  });
  
  describe('D) k_zone coefficients affect points', () => {
    
    it('k_zone_center affects center zone points', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 1.0,
          k_zone_center: 1.0
        });
      
      createSale(DAY1, 10000, sellerId, 'speed', 'center');
      
      const res1 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const points1 = res1.body.data.points_by_user.find(p => p.user_id === sellerId)?.points_total || 0;
      
      // Reset for new test
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY2);
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 1.0,
          k_zone_center: 1.5
        });
      
      createSale(DAY2, 10000, sellerId, 'speed', 'center');
      
      const res2 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY2}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const points2 = res2.body.data.points_by_user.find(p => p.user_id === sellerId)?.points_total || 0;
      
      // 1.5x zone coefficient should multiply points
      expect(points2).toBeCloseTo(points1 * 1.5, 0);
    });
    
    it('k_zone_sanatorium affects sanatorium zone points', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 1.0,
          k_zone_sanatorium: 0.5
        });
      
      createSale(DAY1, 10000, sellerId, 'speed', 'sanatorium');
      
      const res1 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const points1 = res1.body.data.points_by_user.find(p => p.user_id === sellerId)?.points_total || 0;
      
      // Reset for new test
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY2);
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 1.0,
          k_zone_sanatorium: 1.0
        });
      
      createSale(DAY2, 10000, sellerId, 'speed', 'sanatorium');
      
      const res2 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY2}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const points2 = res2.body.data.points_by_user.find(p => p.user_id === sellerId)?.points_total || 0;
      
      // Doubling k_zone_sanatorium should double points
      expect(points2).toBeCloseTo(points1 * 2, 0);
    });
    
    it('center zone gets more points than sanatorium with higher coefficient', async () => {
      // Create second seller for sanatorium zone
      const seller2Res = db.prepare(`
        INSERT INTO users (username, password_hash, role, is_active, zone)
        VALUES (?, ?, 'seller', 1, 'sanatorium')
      `).run('test_seller2', bcrypt.hashSync('password123', 10));
      const seller2Id = seller2Res.lastInsertRowid;
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 1.0,
          k_zone_center: 1.5,
          k_zone_sanatorium: 0.6
        });
      
      createSale(DAY1, 10000, sellerId, 'speed', 'center');
      createSale(DAY1, 10000, seller2Id, 'speed', 'sanatorium');
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const centerPoints = res.body.data.points_by_user.find(p => p.user_id === sellerId)?.points_total || 0;
      const sanatoriumPoints = res.body.data.points_by_user.find(p => p.user_id === seller2Id)?.points_total || 0;
      
      // Center coefficient 1.5 vs sanatorium 0.6 = 2.5x ratio
      expect(centerPoints).toBeGreaterThan(sanatoriumPoints);
      expect(centerPoints / sanatoriumPoints).toBeCloseTo(1.5 / 0.6, 0);
    });
  });
  
  describe('E) k_banana coefficients affect banana points', () => {
    
    it('k_banana_center affects banana points in center zone', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_banana_center: 1.0
        });
      
      createSale(DAY1, 5000, sellerId, 'banana', 'center');
      
      const res1 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const points1 = res1.body.data.points_by_user.find(p => p.user_id === sellerId)?.points_total || 0;
      
      // Reset for new test
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY2);
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_banana_center: 2.0
        });
      
      createSale(DAY2, 5000, sellerId, 'banana', 'center');
      
      const res2 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY2}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const points2 = res2.body.data.points_by_user.find(p => p.user_id === sellerId)?.points_total || 0;
      
      // Double k_banana_center should double points
      expect(points2).toBeCloseTo(points1 * 2, 0);
    });
    
    it('k_banana_sanatorium affects banana points in sanatorium zone', async () => {
      // Create seller in sanatorium zone
      const seller2Res = db.prepare(`
        INSERT INTO users (username, password_hash, role, is_active, zone)
        VALUES (?, ?, 'seller', 1, 'sanatorium')
      `).run('test_seller_san', bcrypt.hashSync('password123', 10));
      const seller2Id = seller2Res.lastInsertRowid;
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_banana_sanatorium: 0.8
        });
      
      createSale(DAY1, 5000, seller2Id, 'banana', 'sanatorium');
      
      const res1 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const points1 = res1.body.data.points_by_user.find(p => p.user_id === seller2Id)?.points_total || 0;
      
      // Reset for new test
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY2);
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_banana_sanatorium: 1.6
        });
      
      createSale(DAY2, 5000, seller2Id, 'banana', 'sanatorium');
      
      const res2 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY2}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const points2 = res2.body.data.points_by_user.find(p => p.user_id === seller2Id)?.points_total || 0;
      
      // Double k_banana_sanatorium should double points
      expect(points2).toBeCloseTo(points1 * 2, 0);
    });
  });
  
  describe('F) Multiple revenue types aggregate correctly', () => {
    
    it('seller with speed + cruise revenue gets combined points', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 1.0,
          k_cruise: 2.0,
          k_zone_center: 1.0
        });
      
      // Create sales for both types
      createSale(DAY1, 10000, sellerId, 'speed', 'center'); // 10 points
      createSale(DAY1, 10000, sellerId, 'cruise', 'center'); // 20 points (k_cruise=2)
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const pointsEntry = res.body.data.points_by_user.find(p => p.user_id === sellerId);
      expect(pointsEntry).toBeDefined();
      
      // Check revenue_by_type
      expect(pointsEntry.revenue_by_type.speed).toBe(10000);
      expect(pointsEntry.revenue_by_type.cruise).toBe(10000);
      
      // Check points_total includes both
      expect(pointsEntry.points_by_type.speed).toBeGreaterThan(0);
      expect(pointsEntry.points_by_type.cruise).toBeGreaterThan(0);
      expect(pointsEntry.points_total).toBeGreaterThan(0);
    });
    
    it('revenue_total is sum of all types', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive' });
      
      createSale(DAY1, 5000, sellerId, 'speed');
      createSale(DAY1, 3000, sellerId, 'cruise');
      createSale(DAY1, 2000, sellerId, 'banana');
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const pointsEntry = res.body.data.points_by_user.find(p => p.user_id === sellerId);
      expect(pointsEntry.revenue_total).toBe(20000);
    });
  });
});
