// 10-shift-summary-motivation-withhold.test.js
// Tests that dispatcher shift summary returns correct motivation_withhold with owner settings
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData, dispatcherToken, dispatcherId;

// Use fixed dates far in the future to avoid conflicts
const DAY1 = '2031-01-15';

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  seedData = await seedBasicData(db);
  
  // Create dispatcher user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_motivation', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_motivation', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Ensure owner_settings row exists with defaults
  db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
});

beforeEach(() => {
  // Clean up motivation day settings to force fresh reads
  db.prepare(`DELETE FROM motivation_day_settings`).run();
  // Reset owner_settings to defaults
  db.prepare(`UPDATE owner_settings SET settings_json = '{"motivationType":"team","motivation_percent":0.15}' WHERE id = 1`).run();
});

describe('DISPATCHER SHIFT SUMMARY - motivation_withhold', () => {
  
  describe('CASE 1: Settings missing/default - fallback to 0.002', () => {
    
    it('returns motivation_withhold with default dispatcher_percent_total (0.002)', async () => {
      const res = await request(app)
        .get(`/api/dispatcher/shift-ledger/summary?business_day=${DAY1}`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.motivation_withhold).toBeDefined();
      expect(res.body.motivation_withhold).not.toBeNull();
      
      // Default values
      expect(res.body.motivation_withhold.dispatcher_percent_total).toBe(0.002);
      expect(res.body.motivation_withhold.dispatcher_percent_per_person).toBe(0.001);
      
      // All other fields should be numbers
      expect(typeof res.body.motivation_withhold.weekly_amount).toBe('number');
      expect(typeof res.body.motivation_withhold.season_amount).toBe('number');
      expect(typeof res.body.motivation_withhold.dispatcher_amount_total).toBe('number');
      expect(typeof res.body.motivation_withhold.fund_total_original).toBe('number');
      expect(typeof res.body.motivation_withhold.fund_total_after_withhold).toBe('number');
      expect(typeof res.body.motivation_withhold.active_dispatchers_count).toBe('number');
    });
    
    it('returns motivation_withhold when owner_settings row is empty', async () => {
      // Clear owner_settings completely
      db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
      
      const DAY2 = '2031-01-16';
      const res = await request(app)
        .get(`/api/dispatcher/shift-ledger/summary?business_day=${DAY2}`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.motivation_withhold).toBeDefined();
      expect(res.body.motivation_withhold).not.toBeNull();
      
      // Should fallback to default 0.002
      expect(res.body.motivation_withhold.dispatcher_percent_total).toBe(0.002);
      expect(res.body.motivation_withhold.dispatcher_percent_per_person).toBe(0.001);
    });
  });
  
  describe('CASE 2: Custom owner settings (0.4%)', () => {
    
    it('uses custom dispatcher_withhold_percent_total from owner_settings', async () => {
      // Set custom dispatcher_withhold_percent_total = 0.004 (0.4%)
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        dispatcher_withhold_percent_total: 0.004
      }));
      
      const DAY3 = '2031-01-17';
      const res = await request(app)
        .get(`/api/dispatcher/shift-ledger/summary?business_day=${DAY3}`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.motivation_withhold).toBeDefined();
      expect(res.body.motivation_withhold).not.toBeNull();
      
      // Custom values
      expect(res.body.motivation_withhold.dispatcher_percent_total).toBe(0.004);
      expect(res.body.motivation_withhold.dispatcher_percent_per_person).toBe(0.002);
    });
    
    it('snapshot branch also uses custom settings', async () => {
      // Set custom dispatcher_withhold_percent_total = 0.004 (0.4%)
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        dispatcher_withhold_percent_total: 0.004
      }));
      
      const DAY4 = '2031-01-18';
      
      // First close the shift
      const closeRes = await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: DAY4 });
      
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.ok).toBe(true);
      
      // Now get summary - should come from snapshot
      const res = await request(app)
        .get(`/api/dispatcher/shift-ledger/summary?business_day=${DAY4}`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.source).toBe('snapshot');
      expect(res.body.motivation_withhold).toBeDefined();
      expect(res.body.motivation_withhold).not.toBeNull();
      
      // Custom values from snapshot
      expect(res.body.motivation_withhold.dispatcher_percent_total).toBe(0.004);
      expect(res.body.motivation_withhold.dispatcher_percent_per_person).toBe(0.002);
    });
  });
  
  describe('CASE 3: Active dispatchers with custom percent', () => {
    
    it('calculates dispatcher_amount_total with custom percent when dispatcher has sales', async () => {
      // Set custom dispatcher_withhold_percent_total = 0.004 (0.4%)
      // per-person = 0.002
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        dispatcher_withhold_percent_total: 0.004
      }));
      
      const DAY5 = '2031-01-19';
      
      // Get seller from seedData
      const sellerId = seedData?.users?.sellerA?.id || seedData?.sellers?.[0]?.id;
      if (!sellerId) {
        // Create a seller if not exists
        const hashedPassword = bcrypt.hashSync('password123', 10);
        const sellerRes = db.prepare(`
          INSERT INTO users (username, password_hash, role, is_active)
          VALUES (?, ?, 'seller', 1)
        `).run('test_seller_motivation', hashedPassword);
      }
      const actualSellerId = sellerId || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add dispatcher sale (dispatcher is active)
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'DISPATCHER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(DAY5, dispatcherId);
      
      // Add seller sale for fundTotal
      if (actualSellerId) {
        db.prepare(`
          INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
          VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
        `).run(DAY5, actualSellerId);
      }
      
      const res = await request(app)
        .get(`/api/dispatcher/shift-ledger/summary?business_day=${DAY5}`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.motivation_withhold).toBeDefined();
      expect(res.body.motivation_withhold).not.toBeNull();
      
      // Custom percent
      expect(res.body.motivation_withhold.dispatcher_percent_total).toBe(0.004);
      expect(res.body.motivation_withhold.dispatcher_percent_per_person).toBe(0.002);
      
      // Active dispatchers should be 1 (the test dispatcher)
      expect(res.body.motivation_withhold.active_dispatchers_count).toBeGreaterThanOrEqual(1);
      
      // fund_total_original = 200000 * 0.15 = 30000
      expect(res.body.motivation_withhold.fund_total_original).toBe(30000);
      
      // dispatcher_amount_total should be calculated
      // per_person = roundDownTo50(30000 * 0.002) = roundDownTo50(60) = 50
      // For 1 active dispatcher: total = 50
      expect(res.body.motivation_withhold.dispatcher_amount_total).toBe(50);
    });
  });
  
  describe('CASE 4: Sequential calls - settings do not stick', () => {
    
    it('custom 0.004 then empty => 0.004 then fallback 0.002', async () => {
      // CALL A: custom 0.004
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        dispatcher_withhold_percent_total: 0.004
      }));
      
      const DAY_A = '2031-02-01';
      const resA = await request(app)
        .get(`/api/dispatcher/shift-ledger/summary?business_day=${DAY_A}`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(resA.status).toBe(200);
      expect(resA.body.motivation_withhold.dispatcher_percent_total).toBe(0.004);
      
      // CALL B: reset to empty => fallback to 0.002
      db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run('2031-02-02');
      
      const DAY_B = '2031-02-02';
      const resB = await request(app)
        .get(`/api/dispatcher/shift-ledger/summary?business_day=${DAY_B}`)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      
      expect(resB.status).toBe(200);
      expect(resB.body.motivation_withhold.dispatcher_percent_total).toBe(0.002);
    });
  });
});

// CURL COMMAND:
// curl "http://localhost:3001/api/dispatcher/shift-ledger/summary?business_day=2026-02-21" -H "Authorization: Bearer <TOKEN>"
