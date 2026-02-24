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

    it('weekly_pool_total_current is calculated from factual current-week data (even before shift close)', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;

      // Sales exist, but no shift close yet -> no WITHHOLD_WEEKLY ledger entries.
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(BASE_DATE, sellerId);

      const weekRes = await request(app)
        .get('/api/owner/motivation/weekly?week=2032-W10')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(weekRes.status).toBe(200);
      expect(weekRes.body.ok).toBe(true);

      const data = weekRes.body.data;
      expect(data.weekly_pool_total_ledger).toBe(0);
      expect(data.weekly_pool_total_current).toBeGreaterThan(0);
      expect(data.weekly_distribution_current).toEqual({ first: 0.5, second: 0.3, third: 0.2 });
      expect(data.top3_current.length).toBeGreaterThan(0);
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

    it('season_pool_diff stays zero for locked/unlocked mix in normal flow', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      const lockedDays = ['2032-09-01', '2032-09-02'];
      const openDay = '2032-09-03';

      for (const dayStr of [...lockedDays, openDay]) {
        db.prepare(`
          INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
          VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
        `).run(dayStr, sellerId);
      }

      for (const dayStr of lockedDays) {
        await request(app)
          .post('/api/dispatcher/shift/close')
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ business_day: dayStr });
      }

      const seasonRes = await request(app)
        .get('/api/owner/motivation/season?season_id=2032')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(seasonRes.status).toBe(200);
      expect(seasonRes.body.ok).toBe(true);
      expect(seasonRes.body.data.season_pool_diff).toBe(0);
      expect(seasonRes.body.data.season_pool_is_consistent).toBe(true);
      expect(seasonRes.body.data.season_pool_total_ledger).toBeGreaterThan(0);
      expect(Array.isArray(seasonRes.body.meta?.consistency_diagnostics?.warnings)).toBe(true);
      expect(seasonRes.body.meta.consistency_diagnostics.warnings).toHaveLength(0);
    });

    it('applies custom season_start_mmdd/season_end_mmdd range for pool and points', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        season_start_mmdd: '05-10',
        season_end_mmdd: '05-12'
      }));

      const inRangeDays = ['2032-05-10', '2032-05-12'];
      const outOfRangeDay = '2032-06-01';
      for (const dayStr of [...inRangeDays, outOfRangeDay]) {
        db.prepare(`
          INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
          VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
        `).run(dayStr, sellerId);

        await request(app)
          .post('/api/dispatcher/shift/close')
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ business_day: dayStr });
      }

      // Force deterministic day totals to verify points/revenue are filtered strictly by range.
      db.prepare(`
        INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
        VALUES (?, ?, ?, ?)
      `).run('2032-05-10', sellerId, 1000, 10);
      db.prepare(`
        INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
        VALUES (?, ?, ?, ?)
      `).run('2032-05-12', sellerId, 2000, 20);
      db.prepare(`
        INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
        VALUES (?, ?, ?, ?)
      `).run('2032-06-01', sellerId, 9999, 999);

      const seasonRes = await request(app)
        .get('/api/owner/motivation/season?season_id=2032')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(seasonRes.status).toBe(200);
      expect(seasonRes.body.ok).toBe(true);
      expect(seasonRes.body.data.season_from).toBe('2032-05-10');
      expect(seasonRes.body.data.season_to).toBe('2032-05-12');
      expect(seasonRes.body.data.season_pool_diff).toBe(0);
      expect(seasonRes.body.data.season_pool_is_consistent).toBe(true);

      const inRangeLedger = Number(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM money_ledger
        WHERE kind = 'FUND' AND type IN ('WITHHOLD_SEASON', 'SEASON_PREPAY_DELETE') AND status = 'POSTED'
          AND DATE(business_day) BETWEEN '2032-05-10' AND '2032-05-12'
      `).get()?.total || 0);
      const outOfRangeLedger = Number(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM money_ledger
        WHERE kind = 'FUND' AND type IN ('WITHHOLD_SEASON', 'SEASON_PREPAY_DELETE') AND status = 'POSTED'
          AND DATE(business_day) = '2032-06-01'
      `).get()?.total || 0);

      expect(outOfRangeLedger).toBeGreaterThan(0);
      expect(Number(seasonRes.body.data.season_pool_total_ledger || 0)).toBe(inRangeLedger);

      const seller = (seasonRes.body.data.sellers || []).find((s) => Number(s.user_id) === Number(sellerId));
      expect(seller).toBeDefined();
      expect(Number(seller.points_total || 0)).toBe(30);
      expect(Number(seller.revenue_total || 0)).toBe(3000);
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
      
      // Verify tampering is detected via diagnostics
      expect(data.weekly_pool_diff).toBe(0);
      expect(data.weekly_pool_is_consistent).toBe(false);
      expect(Array.isArray(weekRes.body.meta?.consistency_diagnostics?.warnings)).toBe(true);
      expect(
        weekRes.body.meta.consistency_diagnostics.warnings.some((w) => String(w).includes('recalculation drift'))
      ).toBe(true);
    });

    it('season tampering returns diagnostics block without changing existing data fields', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      const seasonDays = ['2032-10-01', '2032-10-02', '2032-10-03'];

      for (const dayStr of seasonDays) {
        db.prepare(`
          INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
          VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
        `).run(dayStr, sellerId);

        await request(app)
          .post('/api/dispatcher/shift/close')
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ business_day: dayStr });
      }

      const cleanRes = await request(app)
        .get('/api/owner/motivation/season?season_id=2032')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(cleanRes.status).toBe(200);
      expect(cleanRes.body.ok).toBe(true);
      const cleanDataKeys = Object.keys(cleanRes.body.data).sort();

      db.prepare(`
        UPDATE money_ledger
        SET amount = amount + 50
        WHERE rowid = (
          SELECT rowid
          FROM money_ledger
          WHERE kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
          LIMIT 1
        )
      `).run();

      const dirtyRes = await request(app)
        .get('/api/owner/motivation/season?season_id=2032')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(dirtyRes.status).toBe(200);
      expect(dirtyRes.body.ok).toBe(true);
      expect(dirtyRes.body.data.season_pool_diff).toBe(0);
      expect(dirtyRes.body.data.season_pool_is_consistent).toBe(false);
      expect(Object.keys(dirtyRes.body.data).sort()).toEqual(cleanDataKeys);
      expect(Array.isArray(dirtyRes.body.meta?.consistency_diagnostics?.warnings)).toBe(true);
      expect(
        dirtyRes.body.meta.consistency_diagnostics.warnings.some((w) => String(w).includes('recalculation drift'))
      ).toBe(true);
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
