// 28-invariants-endpoint.test.js — Owner invariants endpoint tests
// Tests day, weekly, season invariants and ledger uniqueness
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
const BASE_DAY = '2032-04-15';

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
  `).run('test_owner_invariants', hashedPassword);
  ownerUserId = ownerRes.lastInsertRowid;
  ownerToken = jwt.sign({ id: ownerUserId, username: 'test_owner_invariants', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Create dispatcher user
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_invariants', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_invariants', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
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

describe('INVARIANTS ENDPOINT', () => {
  
  describe('CASE 1: Day invariants OK', () => {
    
    it('returns day.ok=true when fund_total calculation is consistent', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add sales to generate fund
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(BASE_DAY, sellerId);
      
      // Close shift to create withhold entries
      await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: BASE_DAY });
      
      // Call invariants endpoint
      const res = await request(app)
        .get(`/api/owner/invariants?business_day=${BASE_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.day).toBeDefined();
      expect(res.body.data.day.ok).toBe(true);
      expect(res.body.data.day.errors).toHaveLength(0);
      expect(res.body.data.day.values.fund_total_original).toBeGreaterThan(0);
      expect(res.body.data.day.values.weekly_amount).toBeGreaterThanOrEqual(0);
      expect(res.body.data.day.values.season_amount).toBeGreaterThanOrEqual(0);
      
      // Verify: fund - withhold == fund_after
      const v = res.body.data.day.values;
      expect(v.fund_total_original - v.weekly_amount - v.season_amount - v.dispatcher_amount_total).toBe(v.fund_total_after_withhold);
    });
  });
  
  describe('CASE 2: Weekly/Season invariants OK', () => {
    
    it('returns weekly.ok=true and season.ok=true after shift closes', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Create 3 days of sales
      const days = ['2032-05-10', '2032-05-11', '2032-05-12'];
      
      for (const dayStr of days) {
        db.prepare(`
          INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
          VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
        `).run(dayStr, sellerId);
        
        await request(app)
          .post('/api/dispatcher/shift/close')
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ business_day: dayStr });
      }
      
      // Call invariants endpoint with both week and season
      const res = await request(app)
        .get('/api/owner/invariants?week=2032-W20&season_id=2032')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      
      // Weekly check
      expect(res.body.data.weekly).toBeDefined();
      expect(res.body.data.weekly.ok).toBe(true);
      expect(res.body.data.weekly.diff).toBe(0);
      expect(res.body.data.weekly.ledger_total).toBeGreaterThan(0);
      expect(res.body.data.weekly.daily_sum).toBeGreaterThan(0);
      expect(res.body.data.weekly.ledger_total).toBe(res.body.data.weekly.daily_sum);
      
      // Season check
      expect(res.body.data.season).toBeDefined();
      expect(res.body.data.season.ok).toBe(true);
      expect(res.body.data.season.diff).toBe(0);
      expect(res.body.data.season.ledger_total).toBe(res.body.data.season.daily_sum);
      
      // Ledger uniqueness
      expect(res.body.data.ledger_uniqueness).toBeDefined();
      expect(res.body.data.ledger_uniqueness.ok).toBe(true);
      expect(res.body.data.ledger_uniqueness.duplicates).toHaveLength(0);
    });
  });
  
  describe('CASE 3: Detect duplicates', () => {
    
    it('returns ledger_uniqueness.ok=false when duplicates exist', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add sales and close shift
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(BASE_DAY, sellerId);
      
      await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: BASE_DAY });
      
      // Manually insert duplicate WITHHOLD_WEEKLY
      db.prepare(`
        INSERT INTO money_ledger (kind, type, method, amount, status, seller_id, business_day, event_time, decision_final)
        VALUES ('FUND', 'WITHHOLD_WEEKLY', 'INTERNAL', 50, 'POSTED', NULL, ?, datetime('now'), 1)
      `).run(BASE_DAY);
      
      // Call invariants endpoint
      const res = await request(app)
        .get(`/api/owner/invariants?business_day=${BASE_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      
      // Ledger uniqueness should detect duplicate
      expect(res.body.data.ledger_uniqueness).toBeDefined();
      expect(res.body.data.ledger_uniqueness.ok).toBe(false);
      expect(res.body.data.ledger_uniqueness.duplicates).toHaveLength(1);
      expect(res.body.data.ledger_uniqueness.duplicates[0].business_day).toBe(BASE_DAY);
      expect(res.body.data.ledger_uniqueness.duplicates[0].type).toBe('WITHHOLD_WEEKLY');
      expect(res.body.data.ledger_uniqueness.duplicates[0].count).toBe(2);
    });
  });
  
  describe('CASE 4: Detect mismatch', () => {
    
    it('returns weekly.ok=false when ledger is tampered', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Create 3 days of sales
      const days = ['2032-06-01', '2032-06-02', '2032-06-03'];
      
      for (const dayStr of days) {
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
      
      // Call invariants endpoint
      const res = await request(app)
        .get('/api/owner/invariants?week=2032-W23')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      
      // Weekly should detect mismatch
      expect(res.body.data.weekly).toBeDefined();
      expect(res.body.data.weekly.ok).toBe(false);
      expect(res.body.data.weekly.diff).toBe(0);
      expect(res.body.data.weekly.ledger_total).toBe(res.body.data.weekly.daily_sum);
      expect(
        res.body.data.weekly.errors.some((e) => String(e).includes('recalculation drift'))
      ).toBe(true);
    });
  });
  
  describe('Parameter validation', () => {
    
    it('returns 400 when no parameters provided', async () => {
      const res = await request(app)
        .get('/api/owner/invariants')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain('At least one parameter required');
    });
    
    it('validates week format', async () => {
      const res = await request(app)
        .get('/api/owner/invariants?week=invalid')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.weekly.ok).toBe(false);
      expect(res.body.data.weekly.errors).toBeDefined();
      expect(res.body.data.weekly.errors[0]).toContain('Invalid week format');
    });
    
    it('validates season_id format', async () => {
      const res = await request(app)
        .get('/api/owner/invariants?season_id=invalid')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.season.ok).toBe(false);
      expect(res.body.data.season.errors).toBeDefined();
      expect(res.body.data.season.errors[0]).toContain('Invalid season_id format');
    });
  });
});
