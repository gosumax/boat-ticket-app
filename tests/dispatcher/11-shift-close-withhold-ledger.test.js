// 11-shift-close-withhold-ledger.test.js
// Tests that shift close creates withhold ledger entries (idempotent)
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData, dispatcherToken, dispatcherId, ownerToken;

// Use fixed dates far in the future
const DAY1 = '2032-01-15';

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  seedData = await seedBasicData(db);
  
  // Create owner user for motivation API
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const ownerRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'owner', 1)
  `).run('test_owner_ledger', hashedPassword);
  ownerToken = jwt.sign({ id: ownerRes.lastInsertRowid, username: 'test_owner_ledger', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Create dispatcher user
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_withhold', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_withhold', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
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

describe('SHIFT CLOSE WITHHOLD LEDGER', () => {
  
  describe('CASE 1: Ledger entries created on shift close', () => {
    
    it('creates WITHHOLD_WEEKLY and WITHHOLD_SEASON ledger entries', async () => {
      // Get seller from seedData
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add sales to generate fund
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(DAY1, sellerId);
      
      // Close shift
      const closeRes = await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: DAY1 });
      
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.ok).toBe(true);
      
      // Check ledger entries exist
      const weeklyEntry = db.prepare(`
        SELECT * FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
      `).get(DAY1);
      
      const seasonEntry = db.prepare(`
        SELECT * FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
      `).get(DAY1);
      
      expect(weeklyEntry).toBeDefined();
      expect(weeklyEntry).not.toBeNull();
      expect(weeklyEntry.amount).toBeGreaterThan(0);
      expect(weeklyEntry.method).toBe('INTERNAL');
      expect(weeklyEntry.seller_id).toBeNull();
      
      expect(seasonEntry).toBeDefined();
      expect(seasonEntry).not.toBeNull();
      expect(seasonEntry.amount).toBeGreaterThan(0);
    });
    
    it('ledger amounts match calcMotivationDay withhold amounts', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add sales to generate fund: fundTotal = 100000 * 0.15 = 15000
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(DAY1, sellerId);
      
      // Get expected amounts from calcMotivationDay
      // Import calcMotivationDay would require ES modules, so we calculate expected:
      // weekly = roundDownTo50(15000 * 0.008) = roundDownTo50(120) = 100
      // season base = 15000 * 0.005 = 75 (season is not rounded to 50)
      const expectedWeekly = 100;
      const expectedSeasonBase = 75;
      
      // Close shift
      await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: DAY1 });
      
      const weeklyEntry = db.prepare(`
        SELECT amount FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_WEEKLY'
      `).get(DAY1);
      
      const seasonEntry = db.prepare(`
        SELECT amount FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_SEASON'
      `).get(DAY1);
      
      expect(weeklyEntry.amount).toBe(expectedWeekly);
      expect(Number(seasonEntry.amount)).toBeGreaterThanOrEqual(expectedSeasonBase);
    });
  });
  
  describe('CASE 2: Idempotency - no duplicates on repeated close', () => {
    
    it('does not create duplicate entries on second close', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add sales
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(DAY1, sellerId);
      
      // First close
      const closeRes1 = await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: DAY1 });
      
      expect(closeRes1.status).toBe(200);
      
      // Count entries after first close
      const countAfter1 = db.prepare(`
        SELECT COUNT(*) AS cnt FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type IN ('WITHHOLD_WEEKLY', 'WITHHOLD_SEASON')
      `).get(DAY1);
      
      expect(countAfter1.cnt).toBe(2);
      
      // Second close (idempotent - should skip ledger insertion)
      const closeRes2 = await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: DAY1 });
      
      expect(closeRes2.status).toBe(200);
      expect(closeRes2.body.is_closed).toBe(true);
      
      // Count entries after second close - should still be 2
      const countAfter2 = db.prepare(`
        SELECT COUNT(*) AS cnt FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type IN ('WITHHOLD_WEEKLY', 'WITHHOLD_SEASON')
      `).get(DAY1);
      
      expect(countAfter2.cnt).toBe(2);
    });
  });
  
  describe('CASE 3: Zero sales = no withhold entries', () => {
    
    it('does not create entries when there are no sales', async () => {
      // No sales for DAY1
      
      // Close shift
      await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: DAY1 });
      
      // Check no withhold entries
      const count = db.prepare(`
        SELECT COUNT(*) AS cnt FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type IN ('WITHHOLD_WEEKLY', 'WITHHOLD_SEASON')
      `).get(DAY1);
      
      expect(count.cnt).toBe(0);
    });
  });
  
  describe('CASE 4: Custom owner settings affect withhold calculation', () => {
    
    it('ledger amounts match calcMotivationDay with custom owner settings', async () => {
      const DAY4 = '2032-01-20';
      
      // Set custom dispatcher_withhold_percent_total = 0.004 (0.4%)
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        dispatcher_withhold_percent_total: 0.004
      }));
      
      // Clear any cached motivation_day_settings
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY4);
      
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add dispatcher sale (dispatcher becomes active for withhold)
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'DISPATCHER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(DAY4, dispatcherId);
      
      // Add seller sale for fundTotal
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(DAY4, sellerId);
      
      // Get expected amounts from /api/owner/motivation/day (calls calcMotivationDay internally)
      const motivationRes = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY4}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(motivationRes.status).toBe(200);
      const expectedWeekly = Number(motivationRes.body?.data?.withhold?.weekly_amount || 0);
      const expectedSeason = Number(motivationRes.body?.data?.withhold?.season_amount || 0);
      
      expect(expectedWeekly).toBeGreaterThan(0);
      expect(expectedSeason).toBeGreaterThan(0);
      
      // Close shift
      const closeRes = await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: DAY4 });
      
      expect(closeRes.status).toBe(200);
      
      // Read ledger entries
      const ledgerWeekly = db.prepare(`
        SELECT amount FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
        LIMIT 1
      `).get(DAY4);
      
      const ledgerSeason = db.prepare(`
        SELECT amount FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
        LIMIT 1
      `).get(DAY4);
      
      // Verify ledger amounts match calcMotivationDay results
      if (expectedWeekly > 0) {
        expect(ledgerWeekly).toBeDefined();
        expect(ledgerWeekly).not.toBeNull();
        expect(Number(ledgerWeekly.amount)).toBe(expectedWeekly);
      } else {
        expect(ledgerWeekly).toBeUndefined();
      }
      
      if (expectedSeason > 0) {
        expect(ledgerSeason).toBeDefined();
        expect(ledgerSeason).not.toBeNull();
        expect(Number(ledgerSeason.amount)).toBe(expectedSeason);
      } else {
        expect(ledgerSeason).toBeUndefined();
      }
      
      // Idempotency: second close should not create duplicates
      const closeRes2 = await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: DAY4 });
      
      expect(closeRes2.status).toBe(200);
      expect(closeRes2.body.is_closed).toBe(true);
      
      const weeklyCount = db.prepare(`
        SELECT COUNT(1) AS c FROM money_ledger
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
      `).get(DAY4).c;
      
      const seasonCount = db.prepare(`
        SELECT COUNT(1) AS c FROM money_ledger
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
      `).get(DAY4).c;
      
      if (expectedWeekly > 0) expect(weeklyCount).toBe(1); else expect(weeklyCount).toBe(0);
      if (expectedSeason > 0) expect(seasonCount).toBe(1); else expect(seasonCount).toBe(0);
      
      // Also verify settings were captured in snapshot
      const daySettings = db.prepare(`
        SELECT settings_json FROM motivation_day_settings WHERE business_day = ?
      `).get(DAY4);
      
      expect(daySettings).toBeDefined();
      const parsedSettings = JSON.parse(daySettings.settings_json || '{}');
      expect(parsedSettings.dispatcher_withhold_percent_total).toBe(0.004);
    });
  });
  
  describe('CASE 5: Custom weekly/season withhold percent', () => {
    
    it('ledger amounts match calcMotivationDay with custom weekly/season settings', async () => {
      const DAY5 = '2032-01-25';
      
      // Set custom weekly=1.2% (0.012) and season=0.7% (0.007)
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        weekly_withhold_percent_total: 0.012,
        season_withhold_percent_total: 0.007
      }));
      
      // Clear any cached motivation_day_settings
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY5);
      
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add seller sale for fundTotal: 100000 * 0.15 = 15000
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(DAY5, sellerId);
      
      // Get expected amounts from /api/owner/motivation/day
      const motivationRes = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY5}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(motivationRes.status).toBe(200);
      const expectedWeekly = Number(motivationRes.body?.data?.withhold?.weekly_amount || 0);
      const expectedSeason = Number(motivationRes.body?.data?.withhold?.season_amount || 0);
      
      // Verify custom percent is being used
      expect(motivationRes.body?.data?.withhold?.weekly_percent).toBe(0.012);
      expect(motivationRes.body?.data?.withhold?.season_percent).toBe(0.007);
      
      // weekly = roundDownTo50(15000 * 0.012) = roundDownTo50(180) = 150
      expect(expectedWeekly).toBe(150);
      // season base = 15000 * 0.007 = 105 (season is not rounded to 50)
      expect(expectedSeason).toBeGreaterThanOrEqual(105);
      
      // Close shift
      const closeRes = await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: DAY5 });
      
      expect(closeRes.status).toBe(200);
      
      // Read ledger entries
      const ledgerWeekly = db.prepare(`
        SELECT amount FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
        LIMIT 1
      `).get(DAY5);
      
      const ledgerSeason = db.prepare(`
        SELECT amount FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
        LIMIT 1
      `).get(DAY5);
      
      // Verify ledger amounts match calcMotivationDay results
      expect(ledgerWeekly).toBeDefined();
      expect(ledgerWeekly).not.toBeNull();
      expect(Number(ledgerWeekly.amount)).toBe(expectedWeekly);
      
      expect(ledgerSeason).toBeDefined();
      expect(ledgerSeason).not.toBeNull();
      expect(Number(ledgerSeason.amount)).toBe(expectedSeason);
      
      // Also verify settings were captured in snapshot
      const daySettings = db.prepare(`
        SELECT settings_json FROM motivation_day_settings WHERE business_day = ?
      `).get(DAY5);
      
      expect(daySettings).toBeDefined();
      const parsedSettings = JSON.parse(daySettings.settings_json || '{}');
      expect(parsedSettings.weekly_withhold_percent_total).toBe(0.012);
      expect(parsedSettings.season_withhold_percent_total).toBe(0.007);
    });
  });
});
