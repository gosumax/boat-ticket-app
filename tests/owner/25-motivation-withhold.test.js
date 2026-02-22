// 25-motivation-withhold.test.js — Withhold calculation from fundTotal
// Tests that withhold is calculated correctly from fundTotal and dispatchers_today are identified
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, ownerToken, ownerUserId;

// Use fixed dates far in the future to avoid conflicts
const DAY1 = '2030-01-15';

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
  
  // Create 2 dispatchers
  const d1 = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('dispatcher1', hashedPassword);
  const d2 = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('dispatcher2', hashedPassword);
  
  // Create 1 seller (not dispatcher)
  db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'seller', 1)
  `).run('seller1', hashedPassword);
});

beforeEach(() => {
  // Clean up
  db.prepare(`DELETE FROM motivation_day_settings`).run();
  db.prepare(`DELETE FROM money_ledger`).run();
  db.prepare(`UPDATE owner_settings SET settings_json = '{"motivationType":"adaptive","motivation_percent":0.15}' WHERE id = 1`).run();
});

describe('MOTIVATION WITHHOLD', () => {
  
  describe('A) Withhold fields exist and have correct structure', () => {
    
    it('returns withhold object with all expected fields', async () => {
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.withhold).toBeDefined();
      expect(res.body.data.withhold.weekly_percent).toBe(0.008);
      expect(res.body.data.withhold.season_percent).toBe(0.005);
      expect(res.body.data.withhold.dispatcher_percent_total).toBe(0.002);
      expect(res.body.data.withhold.dispatcher_percent_per_person).toBe(0.001);
      expect(typeof res.body.data.withhold.weekly_amount).toBe('number');
      expect(typeof res.body.data.withhold.season_amount).toBe('number');
      expect(typeof res.body.data.withhold.dispatcher_amount_total).toBe('number');
      expect(typeof res.body.data.withhold.fund_total_original).toBe('number');
      expect(typeof res.body.data.withhold.fund_total_after_withhold).toBe('number');
    });
    
    it('returns dispatchers_today object with all expected fields', async () => {
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.dispatchers_today).toBeDefined();
      expect(Array.isArray(res.body.data.dispatchers_today.active_ids)).toBe(true);
      expect(typeof res.body.data.dispatchers_today.active_count).toBe('number');
      expect(typeof res.body.data.dispatchers_today.active_ids_raw_count).toBe('number');
      expect(res.body.data.dispatchers_today.per_dispatcher_percent).toBe(0.001);
      expect(Array.isArray(res.body.data.dispatchers_today.per_dispatcher_amounts)).toBe(true);
    });
  });
  
  describe('B) Withhold calculation with revenue', () => {
    
    it('calculates withhold correctly with large fundTotal (100000)', async () => {
      // Get seller id (role='seller', NOT dispatcher)
      const seller = db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get();
      const sellerId = seller?.id || 4;
      
      // Create a sale in money_ledger for a seller (NOT dispatcher)
      // fundTotal = 100000 * 0.15 = 15000
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 100000, 'POSTED', ?, ?, datetime('now'))
      `).run(sellerId, DAY1);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      const d = res.body.data;
      
      // fundTotal = 15000
      expect(d.fundTotal).toBe(15000);
      
      // weekly = roundDownTo50(15000 * 0.008) = roundDownTo50(120) = 100
      expect(d.withhold.weekly_amount).toBe(100);
      
      // season = roundDownTo50(15000 * 0.005) = roundDownTo50(75) = 50
      expect(d.withhold.season_amount).toBe(50);
      
      // No dispatcher sales today (only seller sales)
      expect(d.dispatchers_today.active_count).toBe(0);
      expect(d.withhold.dispatcher_amount_total).toBe(0);
      
      // fund_after = 15000 - 100 - 50 - 0 = 14850
      expect(d.withhold.fund_total_after_withhold).toBe(14850);
    });
    
    it('rounds withhold down to nearest 50', async () => {
      // Get seller id
      const seller = db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get();
      const sellerId = seller?.id || 4;
      
      // Create sales for fundTotal = 18600 (like in production)
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 124000, 'POSTED', ?, ?, datetime('now'))
      `).run(sellerId, DAY1);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      const d = res.body.data;
      
      // fundTotal = 18600
      expect(d.fundTotal).toBe(18600);
      
      // weekly = roundDownTo50(18600 * 0.008) = roundDownTo50(148.8) = 100
      expect(d.withhold.weekly_amount).toBe(100);
      
      // season = roundDownTo50(18600 * 0.005) = roundDownTo50(93) = 50
      expect(d.withhold.season_amount).toBe(50);
    });
  });
  
  describe('C) Active dispatchers detection', () => {
    
    it('identifies dispatchers with sales today as active', async () => {
      // Create sales for a dispatcher (user_id = 1 or 2)
      const dispatchers = db.prepare(`SELECT id FROM users WHERE role = 'dispatcher'`).all();
      const d1Id = dispatchers[0].id;
      const d2Id = dispatchers[1].id;
      
      // Get seller id
      const seller = db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get();
      const sellerId = seller?.id || 4;
      
      // Dispatcher 1 has a sale today
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('DISPATCHER_SHIFT', 'SALE_ACCEPTED_CASH', 50000, 'POSTED', ?, ?, datetime('now'))
      `).run(d1Id, DAY1);
      
      // Dispatcher 2 has a sale today
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('DISPATCHER_SHIFT', 'SALE_ACCEPTED_CASH', 30000, 'POSTED', ?, ?, datetime('now'))
      `).run(d2Id, DAY1);
      
      // Also add seller sale for fundTotal
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 50000, 'POSTED', ?, ?, datetime('now'))
      `).run(sellerId, DAY1);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      const d = res.body.data;
      
      // Both dispatchers should be active
      expect(d.dispatchers_today.active_count).toBe(2);
      expect(d.dispatchers_today.active_ids).toContain(d1Id);
      expect(d.dispatchers_today.active_ids).toContain(d2Id);
      
      // Each dispatcher gets 0.1% of fundTotal
      // fundTotal = 130000 * 0.15 = 19500
      // per_dispatcher = roundDownTo50(19500 * 0.001) = roundDownTo50(19.5) = 0
      expect(d.dispatchers_today.per_dispatcher_amounts).toHaveLength(2);
    });
    
    it('caps active dispatchers to max 2', async () => {
      // Create 3 dispatchers (one more)
      const hashedPassword = bcrypt.hashSync('password123', 10);
      db.prepare(`
        INSERT INTO users (username, password_hash, role, is_active)
        VALUES (?, ?, 'dispatcher', 1)
      `).run('dispatcher3', hashedPassword);
      
      const dispatchers = db.prepare(`SELECT id FROM users WHERE role = 'dispatcher'`).all();
      
      // All 3 have sales today
      for (const d of dispatchers) {
        db.prepare(`
          INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
          VALUES ('DISPATCHER_SHIFT', 'SALE_ACCEPTED_CASH', 20000, 'POSTED', ?, ?, datetime('now'))
        `).run(d.id, DAY1);
      }
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      const data = res.body.data;
      
      // Raw count should be 3 (all dispatchers with sales)
      expect(data.dispatchers_today.active_ids_raw_count).toBe(3);
      
      // But active_count is capped to 2
      expect(data.dispatchers_today.active_count).toBe(2);
      
      // And only 2 get withhold amounts
      expect(data.dispatchers_today.per_dispatcher_amounts.length).toBe(2);
      
      // active_ids should also be capped to 2
      expect(data.dispatchers_today.active_ids.length).toBe(2);
    });
    
    it('dispatcher with only refunds/cancels is NOT active', async () => {
      const dispatchers = db.prepare(`SELECT id FROM users WHERE role = 'dispatcher'`).all();
      const d1Id = dispatchers[0].id;
      
      // Get seller id
      const seller = db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get();
      const sellerId = seller?.id || 4;
      
      // Dispatcher has a CANCEL (not a sale)
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('SELLER_SHIFT', 'SALE_CANCEL_REVERSE', -10000, 'POSTED', ?, ?, datetime('now'))
      `).run(d1Id, DAY1);
      
      // Add some seller sale for fundTotal
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 100000, 'POSTED', ?, ?, datetime('now'))
      `).run(sellerId, DAY1);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      
      // Dispatcher should NOT be active (no positive sales)
      expect(res.body.data.dispatchers_today.active_count).toBe(0);
    });
  });
  
  describe('D) Fund after withhold calculation', () => {
    
    it('fund_total_after_withhold = original - weekly - season - dispatcher_total', async () => {
      const dispatchers = db.prepare(`SELECT id FROM users WHERE role = 'dispatcher'`).all();
      const d1Id = dispatchers[0].id;
      
      // Get seller id
      const seller = db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get();
      const sellerId = seller?.id || 4;
      
      // Large sales for significant fundTotal (only seller, not dispatcher)
      // fundTotal = 500000 * 0.15 = 75000
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 500000, 'POSTED', ?, ?, datetime('now'))
      `).run(sellerId, DAY1);
      
      // Dispatcher sale to activate (but separate from main fundTotal calculation)
      // Note: dispatcher sales ALSO count toward revenue_total
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('DISPATCHER_SHIFT', 'SALE_ACCEPTED_CASH', 50000, 'POSTED', ?, ?, datetime('now'))
      `).run(d1Id, DAY1);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      const d = res.body.data;
      
      // revenue_total = 500000 + 50000 = 550000
      // fundTotal = 550000 * 0.15 = 82500
      expect(d.fundTotal).toBe(82500);
      
      const original = d.withhold.fund_total_original;
      const weekly = d.withhold.weekly_amount;
      const season = d.withhold.season_amount;
      const dispatcher = d.withhold.dispatcher_amount_total;
      const after = d.withhold.fund_total_after_withhold;
      
      // Verify formula
      expect(after).toBe(original - weekly - season - dispatcher);
      
      // Verify specific values
      // weekly = roundDownTo50(82500 * 0.008) = roundDownTo50(660) = 650
      expect(weekly).toBe(650);
      // season = roundDownTo50(82500 * 0.005) = roundDownTo50(412.5) = 400
      expect(season).toBe(400);
      // dispatcher = roundDownTo50(82500 * 0.001) = roundDownTo50(82.5) = 50
      expect(dispatcher).toBe(50);
      // after = 82500 - 650 - 400 - 50 = 81400
      expect(after).toBe(81400);
    });
  });
  
  describe('E) Existing fields unchanged', () => {
    
    it('existing response fields remain unchanged', async () => {
      // Get seller id
      const seller = db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get();
      const sellerId = seller?.id || 4;
      
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 100000, 'POSTED', ?, ?, datetime('now'))
      `).run(sellerId, DAY1);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      const d = res.body.data;
      
      // Existing fields
      expect(d.business_day).toBe(DAY1);
      expect(d.mode).toBeDefined();
      expect(d.revenue_total).toBeDefined();
      expect(d.motivation_percent).toBeDefined();
      expect(d.fundPercent).toBeDefined();
      expect(d.fundTotal).toBeDefined();
      expect(d.participants).toBeDefined();
      expect(d.active_sellers).toBeDefined();
      expect(d.active_dispatchers).toBeDefined();
      expect(d.dispatcher_daily_percent).toBeDefined();
      expect(d.active_dispatchers_count).toBeDefined();
      expect(d.dispatcher_daily_bonus_total).toBeDefined();
      expect(Array.isArray(d.payouts)).toBe(true);
    });
  });
  
  describe('F) Configurable dispatcher withhold percent', () => {
    
    it('uses custom dispatcher_withhold_percent_total from settings', async () => {
      // Get seller id
      const seller = db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get();
      const sellerId = seller?.id || 4;
      
      // Set custom dispatcher_withhold_percent_total = 0.004 (0.4%)
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        dispatcher_withhold_percent_total: 0.004
      }));
      
      // Clear any day settings snapshot
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY1);
      
      // Add revenue
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 100000, 'POSTED', ?, ?, datetime('now'))
      `).run(sellerId, DAY1);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      const d = res.body.data;
      
      // Custom percent should be used
      expect(d.withhold.dispatcher_percent_total).toBe(0.004);
      expect(d.withhold.dispatcher_percent_per_person).toBe(0.002);
      expect(d.settings_effective.dispatcher_withhold_percent_total).toBe(0.004);
      expect(d.settings_effective.dispatcher_withhold_percent_per_person).toBe(0.002);
      
      // No active dispatchers, so dispatcher withhold should be 0
      expect(d.withhold.dispatcher_amount_total).toBe(0);
    });
    
    it('applies custom percent to dispatcher withhold calculation', async () => {
      // Get dispatcher and seller ids
      const dispatchers = db.prepare(`SELECT id FROM users WHERE role = 'dispatcher'`).all();
      const d1Id = dispatchers[0]?.id;
      const seller = db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get();
      const sellerId = seller?.id || 4;
      
      // Set custom dispatcher_withhold_percent_total = 0.004 (0.4%)
      // per-person = 0.002
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        dispatcher_withhold_percent_total: 0.004
      }));
      
      // Use a different day to avoid snapshot issues
      const DAY2 = '2030-01-16';
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY2);
      
      // Add dispatcher sale
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('DISPATCHER_SHIFT', 'SALE_ACCEPTED_CASH', 100000, 'POSTED', ?, ?, datetime('now'))
      `).run(d1Id, DAY2);
      
      // Add seller sale
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 100000, 'POSTED', ?, ?, datetime('now'))
      `).run(sellerId, DAY2);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY2}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      const d = res.body.data;
      
      // fundTotal = 200000 * 0.15 = 30000
      expect(d.fundTotal).toBe(30000);
      
      // dispatcher_per_person = roundDownTo50(30000 * 0.002) = roundDownTo50(60) = 50
      expect(d.dispatchers_today.per_dispatcher_amounts[0].amount).toBe(50);
      
      // dispatcher_total = 50 (1 dispatcher)
      expect(d.withhold.dispatcher_amount_total).toBe(50);
    });
    
    it('fallback to default 0.002 when settings are null/empty', async () => {
      // Reset settings to empty
      db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
      
      // Use a different day
      const DAY3 = '2030-01-17';
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY3);
      
      // Get seller id
      const seller = db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get();
      const sellerId = seller?.id || 4;
      
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 100000, 'POSTED', ?, ?, datetime('now'))
      `).run(sellerId, DAY3);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY3}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      const d = res.body.data;
      
      // Should fallback to default 0.002
      expect(d.withhold.dispatcher_percent_total).toBe(0.002);
      expect(d.withhold.dispatcher_percent_per_person).toBe(0.001);
    });
  });
  
  describe('E) Custom weekly/season withhold percent', () => {
    
    it('uses custom weekly and season withhold percent from settings', async () => {
      // Set custom weekly=1.2% (0.012) and season=0.3% (0.003)
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        weekly_withhold_percent_total: 0.012,
        season_withhold_percent_total: 0.003
      }));
      
      // Use a different day
      const DAY4 = '2030-01-18';
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY4);
      
      // Get seller id
      const seller = db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get();
      const sellerId = seller?.id || 4;
      
      // fundTotal = 100000 * 0.15 = 15000
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 100000, 'POSTED', ?, ?, datetime('now'))
      `).run(sellerId, DAY4);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY4}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      const d = res.body.data;
      
      // fundTotal = 15000
      expect(d.fundTotal).toBe(15000);
      
      // Custom percent should be used
      expect(d.withhold.weekly_percent).toBe(0.012);
      expect(d.withhold.season_percent).toBe(0.003);
      expect(d.settings_effective.weekly_withhold_percent_total).toBe(0.012);
      expect(d.settings_effective.season_withhold_percent_total).toBe(0.003);
      
      // weekly_amount = roundDownTo50(15000 * 0.012) = roundDownTo50(180) = 150
      expect(d.withhold.weekly_amount).toBe(150);
      
      // season_amount = roundDownTo50(15000 * 0.003) = roundDownTo50(45) = 0
      expect(d.withhold.season_amount).toBe(0);
    });
    
    it('fallback to default weekly/season percent when settings are null/empty', async () => {
      // Reset settings to empty
      db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
      
      // Use a different day
      const DAY5 = '2030-01-19';
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY5);
      
      // Get seller id
      const seller = db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get();
      const sellerId = seller?.id || 4;
      
      db.prepare(`
        INSERT INTO money_ledger (kind, type, amount, status, seller_id, business_day, event_time)
        VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 100000, 'POSTED', ?, ?, datetime('now'))
      `).run(sellerId, DAY5);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY5}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      const d = res.body.data;
      
      // Should fallback to defaults
      expect(d.withhold.weekly_percent).toBe(0.008);
      expect(d.withhold.season_percent).toBe(0.005);
    });
    
    it('clamps weekly/season percent to max 5%', async () => {
      // Set percent above max
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        weekly_withhold_percent_total: 0.10,  // 10% - should be clamped to 5%
        season_withhold_percent_total: -0.05   // negative - should be clamped to 0
      }));
      
      // Use a different day
      const DAY6 = '2030-01-20';
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY6);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY6}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      const d = res.body.data;
      
      // Should be clamped
      expect(d.withhold.weekly_percent).toBe(0.05);
      expect(d.withhold.season_percent).toBe(0);
    });
  });
});
