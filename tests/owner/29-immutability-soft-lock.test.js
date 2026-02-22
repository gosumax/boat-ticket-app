// 29-immutability-soft-lock.test.js — Soft-lock for closed days
// Tests that locked days use snapshot settings and are immutable
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData, ownerToken, ownerUserId, dispatcherToken, dispatcherId;

// Use fixed dates in 2034 to avoid conflicts
const LOCK_DAY = '2034-01-15';

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
  `).run('test_owner_lock', hashedPassword);
  ownerUserId = ownerRes.lastInsertRowid;
  ownerToken = jwt.sign({ id: ownerUserId, username: 'test_owner_lock', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Create dispatcher user
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_lock', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_lock', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Ensure owner_settings row exists
  db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
});

beforeEach(() => {
  // Clean up
  db.prepare(`DELETE FROM motivation_day_settings`).run();
  db.prepare(`DELETE FROM money_ledger`).run();
  db.prepare(`DELETE FROM shift_closures`).run();
  db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
    motivationType: 'team',
    motivation_percent: 0.15,
    weekly_withhold_percent_total: 0.008,
    season_withhold_percent_total: 0.005,
    dispatcher_withhold_percent_total: 0.002
  }));
});

describe('IMMUTABILITY SOFT-LOCK', () => {
  
  describe('CASE 1: Locked day uses snapshot, not current settings', () => {
    
    it('motivation/day returns snapshot settings after owner changes them', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Set initial settings
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        weekly_withhold_percent_total: 0.008,
        season_withhold_percent_total: 0.005,
        dispatcher_withhold_percent_total: 0.002
      }));
      
      // Add sales
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(LOCK_DAY, sellerId);
      
      // Close shift (creates ledger + snapshot)
      const closeRes = await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: LOCK_DAY });
      
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.ok).toBe(true);
      
      // Verify ledger entries exist
      const ledgerBefore = db.prepare(`
        SELECT type, amount FROM money_ledger
        WHERE business_day = ? AND kind = 'FUND' AND status = 'POSTED'
      `).all(LOCK_DAY);
      
      expect(ledgerBefore.length).toBeGreaterThanOrEqual(2);
      const weeklyBefore = ledgerBefore.find(r => r.type === 'WITHHOLD_WEEKLY')?.amount;
      const seasonBefore = ledgerBefore.find(r => r.type === 'WITHHOLD_SEASON')?.amount;
      
      // Change owner settings to different percentages
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        weekly_withhold_percent_total: 0.02,   // Changed from 0.008
        season_withhold_percent_total: 0.02,   // Changed from 0.005
        dispatcher_withhold_percent_total: 0.01 // Changed from 0.002
      }));
      
      // Call motivation/day for locked day
      const dayRes = await request(app)
        .get(`/api/owner/motivation/day?day=${LOCK_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(dayRes.status).toBe(200);
      
      // Verify lock info
      expect(dayRes.body.data.lock).toBeDefined();
      expect(dayRes.body.data.lock.is_locked).toBe(true);
      expect(dayRes.body.data.lock.snapshot_found).toBe(true);
      expect(dayRes.body.data.lock.settings_source).toBe('snapshot');
      
      // Verify withhold uses OLD percentages from snapshot
      expect(dayRes.body.data.withhold.weekly_percent).toBe(0.008);
      expect(dayRes.body.data.withhold.season_percent).toBe(0.005);
      
      // Verify amounts match ledger (not new calculation)
      expect(dayRes.body.data.withhold.weekly_amount).toBe(weeklyBefore);
      expect(dayRes.body.data.withhold.season_amount).toBe(seasonBefore);
    });
  });
  
  describe('CASE 2: Shift close on locked day does not change ledger', () => {
    
    it('second close does not recalculate or insert new entries', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add sales
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(LOCK_DAY, sellerId);
      
      // First close
      const close1 = await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: LOCK_DAY });
      
      expect(close1.status).toBe(200);
      
      // Get ledger amounts after first close
      const ledgerAfter1 = db.prepare(`
        SELECT type, SUM(amount) as total FROM money_ledger
        WHERE business_day = ? AND kind = 'FUND' AND status = 'POSTED'
        GROUP BY type
      `).all(LOCK_DAY);
      
      const weeklyAfter1 = Number(ledgerAfter1.find(r => r.type === 'WITHHOLD_WEEKLY')?.total || 0);
      const seasonAfter1 = Number(ledgerAfter1.find(r => r.type === 'WITHHOLD_SEASON')?.total || 0);
      
      // Count entries
      const countAfter1 = db.prepare(`
        SELECT COUNT(*) as cnt FROM money_ledger
        WHERE business_day = ? AND kind = 'FUND' AND type IN ('WITHHOLD_WEEKLY', 'WITHHOLD_SEASON')
      `).get(LOCK_DAY);
      
      // Change settings
      db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
        motivationType: 'team',
        motivation_percent: 0.15,
        weekly_withhold_percent_total: 0.03,
        season_withhold_percent_total: 0.025
      }));
      
      // Second close
      const close2 = await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: LOCK_DAY });
      
      expect(close2.status).toBe(200);
      
      // Get ledger amounts after second close
      const ledgerAfter2 = db.prepare(`
        SELECT type, SUM(amount) as total FROM money_ledger
        WHERE business_day = ? AND kind = 'FUND' AND status = 'POSTED'
        GROUP BY type
      `).all(LOCK_DAY);
      
      const weeklyAfter2 = Number(ledgerAfter2.find(r => r.type === 'WITHHOLD_WEEKLY')?.total || 0);
      const seasonAfter2 = Number(ledgerAfter2.find(r => r.type === 'WITHHOLD_SEASON')?.total || 0);
      
      // Count entries after second close
      const countAfter2 = db.prepare(`
        SELECT COUNT(*) as cnt FROM money_ledger
        WHERE business_day = ? AND kind = 'FUND' AND type IN ('WITHHOLD_WEEKLY', 'WITHHOLD_SEASON')
      `).get(LOCK_DAY);
      
      // Amounts should be the same
      expect(weeklyAfter2).toBe(weeklyAfter1);
      expect(seasonAfter2).toBe(seasonAfter1);
      
      // Count should be the same
      expect(countAfter2.cnt).toBe(countAfter1.cnt);
    });
  });
  
  describe('CASE 3: Invariants detects ledger tamper', () => {
    
    it('immutability.ok=false when ledger is manually changed', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add sales
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(LOCK_DAY, sellerId);
      
      // Close shift
      await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: LOCK_DAY });
      
      // Tamper: increase ledger amount
      db.prepare(`
        UPDATE money_ledger SET amount = amount + 50 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
      `).run(LOCK_DAY);
      
      // Call invariants
      const res = await request(app)
        .get(`/api/owner/invariants?business_day=${LOCK_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.immutability).toBeDefined();
      expect(res.body.data.immutability.ok).toBe(false);
      expect(res.body.data.immutability.details.locked_day).toBe(true);
      expect(res.body.data.immutability.errors.length).toBeGreaterThan(0);
      
      // Error should mention ledger differs
      const errorMsg = res.body.data.immutability.errors[0];
      expect(errorMsg).toContain('differs');
    });
  });
  
  describe('CASE 4: Locked day without snapshot flagged', () => {
    
    it('immutability.ok=false when locked day has no snapshot', async () => {
      const day2 = '2034-02-20';
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add sales
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(day2, sellerId);
      
      // Close shift (creates ledger + snapshot)
      await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: day2 });
      
      // Manually delete snapshot to simulate missing snapshot
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(day2);
      
      // Call invariants
      const res = await request(app)
        .get(`/api/owner/invariants?business_day=${day2}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.immutability).toBeDefined();
      expect(res.body.data.immutability.ok).toBe(false);
      expect(res.body.data.immutability.details.snapshot_found).toBe(false);
      expect(res.body.data.immutability.errors).toContain('locked day without snapshot');
    });
  });
  
  describe('CASE 5: Unlocked day immutability is OK', () => {
    
    it('immutability.ok=true for unlocked day', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add sales but DON'T close shift
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(LOCK_DAY, sellerId);
      
      // Call invariants
      const res = await request(app)
        .get(`/api/owner/invariants?business_day=${LOCK_DAY}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.data.immutability).toBeDefined();
      expect(res.body.data.immutability.ok).toBe(true);
      expect(res.body.data.immutability.details.locked_day).toBe(false);
    });
  });
});
