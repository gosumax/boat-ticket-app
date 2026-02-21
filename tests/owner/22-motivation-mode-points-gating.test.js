// 22-motivation-mode-points-gating.test.js — Mode-based points gating
// Tests that points calculation is ONLY active in adaptive mode
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, ownerToken, ownerUserId;

// Test users
let sellerId, dispatcherId, boatId, slotId;

// Fixed test date
const TEST_DAY = '2030-01-15';

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
  
  // Create dispatcher
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  
  // Create boat (speed type for points calculation)
  const boatRes = db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
    VALUES (?, 'speed', 1, 1000, 500, 750)
  `).run('Test Speed Boat');
  boatId = boatRes.lastInsertRowid;
  
  // Create boat_slot
  const slotRes = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, is_active, price_adult, price_child, price_teen, duration_minutes)
    VALUES (?, '10:00', 1000, 10, 10, 1, 1000, 500, 750, 60)
  `).run(boatId);
  slotId = slotRes.lastInsertRowid;
});

beforeEach(() => {
  // Clean up snapshots and reset settings
  db.prepare(`DELETE FROM motivation_day_settings`).run();
  db.prepare(`DELETE FROM money_ledger WHERE business_day = ?`).run(TEST_DAY);
  db.prepare(`DELETE FROM presales WHERE business_day = ?`).run(TEST_DAY);
  db.prepare(`DELETE FROM sales_transactions_canonical WHERE business_day = ?`).run(TEST_DAY);
  db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
});

// Helper to create a sale for the test day
function createSale(amount, sellerUserId, zoneAtSale = 'center') {
  // Create presale
  const presaleRes = db.prepare(`
    INSERT INTO presales (customer_name, customer_phone, number_of_seats, total_price, business_day, status, boat_slot_id, seller_id, zone_at_sale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('Test Customer', '79991234567', 1, amount, TEST_DAY, 'ACTIVE', slotId, sellerUserId, zoneAtSale);
  const presaleId = presaleRes.lastInsertRowid;
  
  // Create money_ledger entry
  db.prepare(`
    INSERT INTO money_ledger (presale_id, slot_id, trip_day, business_day, kind, type, method, amount, status, seller_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(presaleId, slotId, TEST_DAY, TEST_DAY, 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 'CASH', amount, 'POSTED', sellerUserId);
  
  // Create canonical transaction
  db.prepare(`
    INSERT INTO sales_transactions_canonical (presale_id, slot_id, boat_id, amount, business_day, status, method)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(presaleId, slotId, boatId, amount, TEST_DAY, 'VALID', 'CASH');
  
  return presaleId;
}

describe('MOTIVATION MODE POINTS GATING', () => {
  
  describe('A) Adaptive mode - points ENABLED', () => {
    
    it('returns points_enabled=true in adaptive mode', async () => {
      // Set adaptive mode
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          individual_share: 0.6,
          team_share: 0.4,
          k_speed: 2.0,
          k_zone_center: 1.5
        });
      
      // Create a sale
      createSale(3000, sellerId, 'center');
      
      // Get motivation day
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe('adaptive');
      expect(res.body.data.points_enabled).toBe(true);
    });
    
    it('returns points_rule in adaptive mode', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive' });
      
      createSale(2000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.points_rule).not.toBeNull();
      expect(res.body.data.points_rule).toContain('zone');
    });
    
    it('returns non-empty points_by_user in adaptive mode with sales', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 2.0,
          k_zone_center: 1.5
        });
      
      createSale(5000, sellerId, 'center');
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.points_by_user).toBeDefined();
      expect(Array.isArray(res.body.data.points_by_user)).toBe(true);
      
      // Find seller in points_by_user
      const sellerPoints = res.body.data.points_by_user.find(p => p.user_id === sellerId);
      expect(sellerPoints).toBeDefined();
      expect(sellerPoints.points_total).toBeGreaterThan(0);
    });
    
    it('calculates points_total > 0 for seller with revenue', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 1.2,
          k_zone_center: 1.0
        });
      
      createSale(10000, sellerId, 'center'); // 10000 RUB revenue
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const sellerPoints = res.body.data.points_by_user.find(p => p.user_id === sellerId);
      expect(sellerPoints).toBeDefined();
      // Points = (revenue / 1000) * k_speed * k_zone
      // = (10000 / 1000) * 1.2 * 1.0 = 12 points
      expect(sellerPoints.points_total).toBeGreaterThan(0);
    });
    
    it('includes zone in payouts for adaptive mode', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive' });
      
      createSale(3000, sellerId, 'center');
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const sellerPayout = res.body.data.payouts.find(p => p.user_id === sellerId);
      expect(sellerPayout).toBeDefined();
      expect(sellerPayout.zone).toBe('center');
      expect(sellerPayout.points_total).toBeGreaterThanOrEqual(0);
    });
  });
  
  describe('B) Team mode - points DISABLED', () => {
    
    it('returns points_enabled=false in team mode', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'team' });
      
      createSale(5000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe('team');
      expect(res.body.data.points_enabled).toBe(false);
    });
    
    it('returns points_rule=null in team mode', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'team' });
      
      createSale(5000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.points_rule).toBeNull();
    });
    
    it('returns empty points_by_user in team mode', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'team' });
      
      createSale(5000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.points_by_user).toEqual([]);
    });
    
    it('returns points_total=0 and zone=null in payouts for team mode', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'team' });
      
      createSale(5000, sellerId, 'center');
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const sellerPayout = res.body.data.payouts.find(p => p.user_id === sellerId);
      expect(sellerPayout).toBeDefined();
      expect(sellerPayout.points_total).toBe(0);
      expect(sellerPayout.zone).toBeNull();
    });
    
    it('still calculates payouts in team mode (just no points)', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'team',
          motivation_percent: 0.15
        });
      
      createSale(10000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.revenue_total).toBe(10000);
      expect(res.body.data.fundTotal).toBeGreaterThan(0); // 15% fund
      
      // Payouts should exist (team division)
      const sellerPayout = res.body.data.payouts.find(p => p.user_id === sellerId);
      expect(sellerPayout).toBeDefined();
      expect(sellerPayout.total).toBeGreaterThan(0); // Has payout
      expect(sellerPayout.points_total).toBe(0); // But no points
    });
  });
  
  describe('C) Personal mode - points DISABLED', () => {
    
    it('returns points_enabled=false in personal mode', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'personal' });
      
      createSale(5000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.mode).toBe('personal');
      expect(res.body.data.points_enabled).toBe(false);
    });
    
    it('returns points_rule=null in personal mode', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'personal' });
      
      createSale(5000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.points_rule).toBeNull();
    });
    
    it('returns empty points_by_user in personal mode', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'personal' });
      
      createSale(5000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.points_by_user).toEqual([]);
    });
    
    it('returns points_total=0 and zone=null in payouts for personal mode', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'personal' });
      
      createSale(5000, sellerId, 'center');
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const sellerPayout = res.body.data.payouts.find(p => p.user_id === sellerId);
      expect(sellerPayout).toBeDefined();
      expect(sellerPayout.points_total).toBe(0);
      expect(sellerPayout.zone).toBeNull();
    });
    
    it('still calculates payouts in personal mode (just no points)', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'personal',
          motivation_percent: 0.20
        });
      
      createSale(10000, sellerId);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.revenue_total).toBe(10000);
      expect(res.body.data.fundTotal).toBeGreaterThan(0); // 20% fund
      
      const sellerPayout = res.body.data.payouts.find(p => p.user_id === sellerId);
      expect(sellerPayout).toBeDefined();
      expect(sellerPayout.total).toBeGreaterThan(0); // Has payout
      expect(sellerPayout.points_total).toBe(0); // But no points
    });
  });
  
  describe('D) Mode switching preserves points gating', () => {
    
    it('switching from team to adaptive enables points', async () => {
      // Start with team mode
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'team' });
      
      createSale(5000, sellerId);
      
      // Delete snapshot for new day
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(TEST_DAY);
      
      // Switch to adaptive
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 1.5
        });
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.mode).toBe('adaptive');
      expect(res.body.data.points_enabled).toBe(true);
      expect(res.body.data.points_by_user.length).toBeGreaterThan(0);
    });
    
    it('switching from adaptive to team disables points', async () => {
      // Start with adaptive mode
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 2.0
        });
      
      createSale(5000, sellerId);
      
      // Delete snapshot for new day
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(TEST_DAY);
      
      // Switch to team
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'team' });
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.mode).toBe('team');
      expect(res.body.data.points_enabled).toBe(false);
      expect(res.body.data.points_by_user).toEqual([]);
    });
  });
  
  describe('E) Zone-based point differences (adaptive only)', () => {
    
    it('different zones produce different points', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 1.0,
          k_zone_center: 1.5,
          k_zone_sanatorium: 0.8
        });
      
      // Create two sales with same amount but different zones
      // Use different sellers to avoid aggregation
      const seller2Res = db.prepare(`
        INSERT INTO users (username, password_hash, role, is_active, zone)
        VALUES (?, ?, 'seller', 1, 'sanatorium')
      `).run('test_seller2', bcrypt.hashSync('password123', 10));
      const seller2Id = seller2Res.lastInsertRowid;
      
      // Clean previous data for clean test
      db.prepare(`DELETE FROM money_ledger WHERE business_day = ?`).run(TEST_DAY);
      db.prepare(`DELETE FROM presales WHERE business_day = ?`).run(TEST_DAY);
      
      createSale(10000, sellerId, 'center'); // center zone
      createSale(10000, seller2Id, 'sanatorium'); // sanatorium zone
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${TEST_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const centerPoints = res.body.data.points_by_user.find(p => p.user_id === sellerId)?.points_total || 0;
      const sanatoriumPoints = res.body.data.points_by_user.find(p => p.user_id === seller2Id)?.points_total || 0;
      
      // Center should have more points than sanatorium (1.5 vs 0.8 coefficient)
      expect(centerPoints).toBeGreaterThan(sanatoriumPoints);
    });
  });
});
