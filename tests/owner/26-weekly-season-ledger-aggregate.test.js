// 26-weekly-season-ledger-aggregate.test.js
// Tests that owner weekly/season endpoints return ledger-based totals matching daily withholdings
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, ownerToken, ownerUserId;

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  
  // Create owner user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const ownerRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'owner', 1)
  `).run('test_owner_weekly', hashedPassword);
  ownerUserId = ownerRes.lastInsertRowid;
  ownerToken = jwt.sign({ id: ownerUserId, username: 'test_owner_weekly', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Ensure owner_settings row exists
  db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
  
  // Create a seller
  db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'seller', 1)
  `).run('test_seller_weekly', hashedPassword);
});

beforeEach(() => {
  // Clean up
  db.prepare(`DELETE FROM motivation_day_settings`).run();
  db.prepare(`DELETE FROM money_ledger`).run();
  db.prepare(`UPDATE owner_settings SET settings_json = '{"motivationType":"team","motivation_percent":0.15}' WHERE id = 1`).run();
});

describe('OWNER WEEKLY/SEASON LEDGER AGGREGATE', () => {
  
  describe('CASE 1: Weekly ledger total matches sum of daily withholdings', () => {
    
    it('weekly_pool_total_ledger equals sum of WITHHOLD_WEEKLY entries', async () => {
      // Call endpoint first to see what date range it calculates for W01
      const preRes = await request(app)
        .get('/api/owner/motivation/weekly?week=2033-W01')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(preRes.status).toBe(200);
      const dateFrom = preRes.body.data.date_from;
      const dateTo = preRes.body.data.date_to;
      
      // Insert entries exactly within the calculated date range
      const numDays = 3;
      const weeklyAmounts = [100, 150, 200];
      const seasonAmounts = [50, 75, 100];
      
      const now = new Date().toISOString();
      
      // Parse dateFrom and add entries for first 3 days
      const startDate = new Date(dateFrom);
      for (let i = 0; i < numDays; i++) {
        const day = new Date(startDate);
        day.setDate(day.getDate() + i);
        const dayStr = day.toISOString().split('T')[0];
        
        db.prepare(`
          INSERT INTO money_ledger (kind, type, method, amount, status, seller_id, business_day, event_time, decision_final)
          VALUES ('FUND', 'WITHHOLD_WEEKLY', 'INTERNAL', ?, 'POSTED', NULL, ?, ?, 1)
        `).run(weeklyAmounts[i], dayStr, now);
        
        db.prepare(`
          INSERT INTO money_ledger (kind, type, method, amount, status, seller_id, business_day, event_time, decision_final)
          VALUES ('FUND', 'WITHHOLD_SEASON', 'INTERNAL', ?, 'POSTED', NULL, ?, ?, 1)
        `).run(seasonAmounts[i], dayStr, now);
      }
      
      const expectedWeeklyTotal = weeklyAmounts.reduce((a, b) => a + b, 0);
      
      // Call weekly endpoint again
      const res = await request(app)
        .get('/api/owner/motivation/weekly?week=2033-W01')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.weekly_pool_total_ledger).toBeDefined();
      expect(res.body.data.weekly_pool_total_ledger).toBe(expectedWeeklyTotal);
    });
    
    it('weekly_pool_total_ledger is 0 when no entries exist', async () => {
      const res = await request(app)
        .get('/api/owner/motivation/weekly?week=2033-W02')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.weekly_pool_total_ledger).toBe(0);
    });
  });
  
  describe('CASE 2: Season ledger total matches sum of daily withholdings', () => {
    
    it('season_pool_total_ledger equals sum of WITHHOLD_SEASON entries', async () => {
      // Insert withhold ledger entries for a season (2033)
      const seasonDays = ['2033-01-01', '2033-02-15', '2033-03-20', '2033-06-10'];
      const seasonAmounts = [100, 200, 150, 300];
      
      const now = new Date().toISOString();
      
      seasonDays.forEach((day, i) => {
        db.prepare(`
          INSERT INTO money_ledger (kind, type, method, amount, status, seller_id, business_day, event_time, decision_final)
          VALUES ('FUND', 'WITHHOLD_SEASON', 'INTERNAL', ?, 'POSTED', NULL, ?, ?, 1)
        `).run(seasonAmounts[i], day, now);
      });
      
      const expectedSeasonTotal = seasonAmounts.reduce((a, b) => a + b, 0);
      
      // Call season endpoint
      const res = await request(app)
        .get('/api/owner/motivation/season?season_id=2033')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.season_pool_total_ledger).toBeDefined();
      expect(res.body.data.season_pool_total_ledger).toBe(expectedSeasonTotal);
    });
    
    it('season_pool_total_ledger excludes entries from other seasons', async () => {
      const now = new Date().toISOString();
      
      // Insert entry for 2033
      db.prepare(`
        INSERT INTO money_ledger (kind, type, method, amount, status, seller_id, business_day, event_time, decision_final)
        VALUES ('FUND', 'WITHHOLD_SEASON', 'INTERNAL', 100, 'POSTED', NULL, '2033-06-01', ?, 1)
      `).run(now);
      
      // Insert entry for 2034 (different season)
      db.prepare(`
        INSERT INTO money_ledger (kind, type, method, amount, status, seller_id, business_day, event_time, decision_final)
        VALUES ('FUND', 'WITHHOLD_SEASON', 'INTERNAL', 200, 'POSTED', NULL, '2034-06-01', ?, 1)
      `).run(now);
      
      // Query season 2033
      const res = await request(app)
        .get('/api/owner/motivation/season?season_id=2033')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.season_pool_total_ledger).toBe(100);
      
      // Query season 2034
      const res2 = await request(app)
        .get('/api/owner/motivation/season?season_id=2034')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res2.status).toBe(200);
      expect(res2.data?.season_pool_total_ledger || res2.body?.data?.season_pool_total_ledger).toBe(200);
    });
  });
  
  describe('CASE 3: Old fields unchanged', () => {
    
    it('weekly_pool_total still calculated from revenue percent', async () => {
      // Insert sales for the week
      const sellerId = db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      const weekDays = ['2033-01-03', '2033-01-04'];
      weekDays.forEach(day => {
        db.prepare(`
          INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
          VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
        `).run(day, sellerId);
      });
      
      const res = await request(app)
        .get('/api/owner/motivation/weekly?week=2033-W01')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.weekly_pool_total).toBeDefined();
      // weekly_pool_total = revenue * 0.01 = 200000 * 0.01 = 2000
      expect(res.body.data.weekly_pool_total).toBe(2000);
    });
  });
});
