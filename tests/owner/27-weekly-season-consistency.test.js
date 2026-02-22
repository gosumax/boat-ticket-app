// 27-weekly-season-consistency.test.js
// Tests financial consistency between daily withhold, ledger entries, and weekly/season reports
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData, ownerToken, ownerUserId, dispatcherToken, dispatcherId;

// Use fixed dates in 2032 to avoid conflicts
const BASE_DATE = '2032-03-02'; // Monday of W10

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  seedData = await seedBasicData(db);
  
  // Create owner user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const ownerRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'owner', 1)
  `).run('test_owner_consistency', hashedPassword);
  ownerUserId = ownerRes.lastInsertRowid;
  ownerToken = jwt.sign({ id: ownerUserId, username: 'test_owner_consistency', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Create dispatcher user
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_consistency', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_consistency', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Ensure owner_settings row exists
  db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
});

beforeEach(() => {
  // Clean up
  db.prepare(`DELETE FROM motivation_day_settings`).run();
  db.prepare(`DELETE FROM money_ledger`).run();
  db.prepare(`DELETE FROM shift_closures`).run();
  db.prepare(`UPDATE owner_settings SET settings_json = '{"motivationType":"team","motivation_percent":0.15}' WHERE id = 1`).run();
});

describe('WEEKLY/SEASON CONSISTENCY', () => {
  
  describe('CASE 1: Weekly consistency (7 days)', () => {
    
    it('weekly_pool_total_ledger equals daily_sum for 7 days of sales', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Create 7 days of sales (Mon-Sun of W10)
      for (let i = 0; i < 7; i++) {
        const day = new Date(BASE_DATE);
        day.setDate(day.getDate() + i);
        const dayStr = day.toISOString().split('T')[0];
        
        // Add sale for this day
        db.prepare(`
          INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
          VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
        `).run(dayStr, sellerId);
        
        // Close shift for this day to create withhold entries
        await request(app)
          .post('/api/dispatcher/shift/close')
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ business_day: dayStr });
      }
      
      // Call weekly endpoint for W10
      const weekRes = await request(app)
        .get('/api/owner/motivation/weekly?week=2032-W10')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(weekRes.status).toBe(200);
      expect(weekRes.body.ok).toBe(true);
      
      const data = weekRes.body.data;
      
      // Verify consistency fields exist
      expect(data.weekly_pool_total_ledger).toBeDefined();
      expect(data.weekly_pool_total_daily_sum).toBeDefined();
      expect(data.weekly_pool_diff).toBeDefined();
      expect(data.weekly_pool_is_consistent).toBeDefined();
      
      // Verify values
      expect(data.weekly_pool_total_ledger).toBeGreaterThan(0);
      expect(data.weekly_pool_total_daily_sum).toBeGreaterThan(0);
      expect(data.weekly_pool_diff).toBe(0);
      expect(data.weekly_pool_is_consistent).toBe(true);
    });
  });
  
  describe('CASE 2: Season consistency (several days)', () => {
    
    it('season_pool_total_ledger equals daily_sum for multiple days', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Create 5 days of sales in the same season (2032)
      const seasonDays = ['2032-05-10', '2032-05-11', '2032-05-12', '2032-06-01', '2032-06-02'];
      
      for (const dayStr of seasonDays) {
        // Add sale for this day
        db.prepare(`
          INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
          VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
        `).run(dayStr, sellerId);
        
        // Close shift for this day
        await request(app)
          .post('/api/dispatcher/shift/close')
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ business_day: dayStr });
      }
      
      // Call season endpoint for 2032
      const seasonRes = await request(app)
        .get('/api/owner/motivation/season?season_id=2032')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(seasonRes.status).toBe(200);
      expect(seasonRes.body.ok).toBe(true);
      
      const data = seasonRes.body.data;
      
      // Verify consistency fields exist
      expect(data.season_pool_total_ledger).toBeDefined();
      expect(data.season_pool_total_daily_sum).toBeDefined();
      expect(data.season_pool_diff).toBeDefined();
      expect(data.season_pool_is_consistent).toBeDefined();
      
      // Verify values
      expect(data.season_pool_total_ledger).toBeGreaterThan(0);
      expect(data.season_pool_total_daily_sum).toBeGreaterThan(0);
      expect(data.season_pool_diff).toBe(0);
      expect(data.season_pool_is_consistent).toBe(true);
    });
  });
  
  describe('CASE 3: Detect mismatch (artificial tampering)', () => {
    
    it('weekly_pool_is_consistent is false when ledger is tampered', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Create 3 days of sales
      for (let i = 0; i < 3; i++) {
        const day = new Date(BASE_DATE);
        day.setDate(day.getDate() + i);
        const dayStr = day.toISOString().split('T')[0];
        
        db.prepare(`
          INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
          VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
        `).run(dayStr, sellerId);
        
        await request(app)
          .post('/api/dispatcher/shift/close')
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ business_day: dayStr });
      }
      
      // Tamper: increase one ledger entry by 50
      db.prepare(`
        UPDATE money_ledger SET amount = amount + 50 
        WHERE kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
        LIMIT 1
      `).run();
      
      // Call weekly endpoint
      const weekRes = await request(app)
        .get('/api/owner/motivation/weekly?week=2032-W10')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(weekRes.status).toBe(200);
      
      const data = weekRes.body.data;
      
      // Verify mismatch is detected
      expect(data.weekly_pool_diff).not.toBe(0);
      expect(data.weekly_pool_is_consistent).toBe(false);
    });
  });
  
  describe('CASE 4: Custom weekly/season percent consistency', () => {
    
    it('consistency remains true with custom weekly/season percent', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Set custom weekly=1.2% (0.012) and season=0.7% (0.007)
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        weekly_withhold_percent_total: 0.012,
        season_withhold_percent_total: 0.007
      }));
      
      // Use different dates to avoid snapshot conflicts
      const customDays = ['2032-07-10', '2032-07-11', '2032-07-12'];
      
      for (const dayStr of customDays) {
        // Clear any cached settings
        db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(dayStr);
        
        // Add sale for this day
        db.prepare(`
          INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
          VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
        `).run(dayStr, sellerId);
        
        // Close shift for this day
        await request(app)
          .post('/api/dispatcher/shift/close')
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ business_day: dayStr });
      }
      
      // Call weekly endpoint for W28 (2032-07-10 is in week 28)
      const weekRes = await request(app)
        .get('/api/owner/motivation/weekly?week=2032-W28')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(weekRes.status).toBe(200);
      expect(weekRes.body.ok).toBe(true);
      
      const data = weekRes.body.data;
      
      // Verify consistency fields exist
      expect(data.weekly_pool_total_ledger).toBeDefined();
      expect(data.weekly_pool_total_daily_sum).toBeDefined();
      expect(data.weekly_pool_diff).toBeDefined();
      expect(data.weekly_pool_is_consistent).toBeDefined();
      
      // Verify values are positive (custom percent creates larger withhold)
      expect(data.weekly_pool_total_ledger).toBeGreaterThan(0);
      expect(data.weekly_pool_total_daily_sum).toBeGreaterThan(0);
      
      // CRITICAL: consistency must be true even with custom percent
      expect(data.weekly_pool_diff).toBe(0);
      expect(data.weekly_pool_is_consistent).toBe(true);
      
      // Verify custom percent is captured in day settings
      const daySettings = db.prepare(`
        SELECT settings_json FROM motivation_day_settings WHERE business_day = ?
      `).get('2032-07-10');
      
      expect(daySettings).toBeDefined();
      const parsedSettings = JSON.parse(daySettings.settings_json || '{}');
      expect(parsedSettings.weekly_withhold_percent_total).toBe(0.012);
      expect(parsedSettings.season_withhold_percent_total).toBe(0.007);
    });
    
    it('season consistency remains true with custom weekly/season percent', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Set custom weekly=1.5% (0.015) and season=0.8% (0.008)
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        weekly_withhold_percent_total: 0.015,
        season_withhold_percent_total: 0.008
      }));
      
      // Use different dates in 2032 season
      const customDays = ['2032-08-01', '2032-08-02', '2032-08-05'];
      
      for (const dayStr of customDays) {
        // Clear any cached settings
        db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(dayStr);
        
        // Add sale for this day
        db.prepare(`
          INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
          VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
        `).run(dayStr, sellerId);
        
        // Close shift for this day
        await request(app)
          .post('/api/dispatcher/shift/close')
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ business_day: dayStr });
      }
      
      // Call season endpoint for 2032
      const seasonRes = await request(app)
        .get('/api/owner/motivation/season?season_id=2032')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(seasonRes.status).toBe(200);
      expect(seasonRes.body.ok).toBe(true);
      
      const data = seasonRes.body.data;
      
      // Verify consistency fields exist
      expect(data.season_pool_total_ledger).toBeDefined();
      expect(data.season_pool_total_daily_sum).toBeDefined();
      expect(data.season_pool_diff).toBeDefined();
      expect(data.season_pool_is_consistent).toBeDefined();
      
      // CRITICAL: consistency must be true even with custom percent
      expect(data.season_pool_diff).toBe(0);
      expect(data.season_pool_is_consistent).toBe(true);
    });
  });
});
