// 12-shift-close-race-guard.test.js
// Tests that parallel shift close requests don't create duplicate ledger entries
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData, dispatcherToken, dispatcherId, dispatcher2Token, dispatcher2Id;

// Use fixed dates in 2033 to avoid conflicts
const RACE_DAY = '2033-01-15';

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  seedData = await seedBasicData(db);
  
  const hashedPassword = bcrypt.hashSync('password123', 10);
  
  // Create first dispatcher user
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_race1', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_race1', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Create second dispatcher user (for parallel close attempts)
  const dispatcher2Res = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_race2', hashedPassword);
  dispatcher2Id = dispatcher2Res.lastInsertRowid;
  dispatcher2Token = jwt.sign({ id: dispatcher2Id, username: 'test_dispatcher_race2', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
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

describe('SHIFT CLOSE RACE GUARD', () => {
  
  describe('CASE 1: Parallel shift close requests', () => {
    
    it('does not create duplicate ledger entries on parallel close', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add sales to generate fund
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(RACE_DAY, sellerId);
      
      // Execute two shift close requests in parallel
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/dispatcher/shift/close')
          .set('Authorization', `Bearer ${dispatcherToken}`)
          .send({ business_day: RACE_DAY }),
        request(app)
          .post('/api/dispatcher/shift/close')
          .set('Authorization', `Bearer ${dispatcher2Token}`)
          .send({ business_day: RACE_DAY })
      ]);
      
      // Both should succeed (idempotent) or one may return is_closed=true
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.ok).toBe(true);
      expect(res2.body.ok).toBe(true);
      
      // Check ledger entries count - should be exactly 1 for each type
      const weeklyCount = db.prepare(`
        SELECT COUNT(*) AS cnt FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
      `).get(RACE_DAY);
      
      const seasonCount = db.prepare(`
        SELECT COUNT(*) AS cnt FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
      `).get(RACE_DAY);
      
      // Critical: must be exactly 1, not 2
      expect(weeklyCount.cnt).toBe(1);
      expect(seasonCount.cnt).toBe(1);
      
      // Verify shift_closures also has only one row
      const closuresCount = db.prepare(`
        SELECT COUNT(*) AS cnt FROM shift_closures WHERE business_day = ?
      `).get(RACE_DAY);
      
      expect(closuresCount.cnt).toBe(1);
    });
  });
  
  describe('CASE 2: Sequential shift close requests', () => {
    
    it('second close returns is_closed=true and does not create duplicates', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add sales
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(RACE_DAY, sellerId);
      
      // First close
      const res1 = await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .send({ business_day: RACE_DAY });
      
      expect(res1.status).toBe(200);
      expect(res1.body.ok).toBe(true);
      expect(res1.body.is_closed).toBe(true);
      
      // Second close (idempotent)
      const res2 = await request(app)
        .post('/api/dispatcher/shift/close')
        .set('Authorization', `Bearer ${dispatcher2Token}`)
        .send({ business_day: RACE_DAY });
      
      expect(res2.status).toBe(200);
      expect(res2.body.ok).toBe(true);
      expect(res2.body.is_closed).toBe(true);
      
      // Check ledger entries count
      const weeklyCount = db.prepare(`
        SELECT COUNT(*) AS cnt FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
      `).get(RACE_DAY);
      
      const seasonCount = db.prepare(`
        SELECT COUNT(*) AS cnt FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
      `).get(RACE_DAY);
      
      expect(weeklyCount.cnt).toBe(1);
      expect(seasonCount.cnt).toBe(1);
    });
  });
  
  describe('CASE 3: Multiple parallel requests (stress)', () => {
    
    it('handles 3+ parallel requests without duplicates', async () => {
      const sellerId = seedData?.users?.sellerA?.id || db.prepare(`SELECT id FROM users WHERE role = 'seller' AND is_active = 1 LIMIT 1`).get()?.id;
      
      // Add sales
      db.prepare(`
        INSERT INTO money_ledger (type, kind, method, amount, status, business_day, seller_id)
        VALUES ('SALE_PREPAYMENT_CASH', 'SELLER_SHIFT', 'CASH', 100000, 'POSTED', ?, ?)
      `).run(RACE_DAY, sellerId);
      
      // Execute 3 parallel requests
      const results = await Promise.all([
        request(app).post('/api/dispatcher/shift/close').set('Authorization', `Bearer ${dispatcherToken}`).send({ business_day: RACE_DAY }),
        request(app).post('/api/dispatcher/shift/close').set('Authorization', `Bearer ${dispatcher2Token}`).send({ business_day: RACE_DAY }),
        request(app).post('/api/dispatcher/shift/close').set('Authorization', `Bearer ${dispatcherToken}`).send({ business_day: RACE_DAY })
      ]);
      
      // All should succeed
      for (const res of results) {
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
      }
      
      // Check ledger entries count - must still be exactly 1
      const weeklyCount = db.prepare(`
        SELECT COUNT(*) AS cnt FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_WEEKLY' AND status = 'POSTED'
      `).get(RACE_DAY);
      
      const seasonCount = db.prepare(`
        SELECT COUNT(*) AS cnt FROM money_ledger 
        WHERE business_day = ? AND kind = 'FUND' AND type = 'WITHHOLD_SEASON' AND status = 'POSTED'
      `).get(RACE_DAY);
      
      expect(weeklyCount.cnt).toBe(1);
      expect(seasonCount.cnt).toBe(1);
    });
  });
});
