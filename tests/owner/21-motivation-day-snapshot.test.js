// 21-motivation-day-snapshot.test.js — Motivation day snapshot behavior
// Tests that first call to /motivation/day creates snapshot, subsequent calls use it
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, ownerToken, ownerUserId;

// Use fixed dates far in the future to avoid conflicts
const DAY1 = '2030-01-01';
const DAY2 = '2030-01-02';

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
});

beforeEach(() => {
  // Clean up snapshots and reset settings
  db.prepare(`DELETE FROM motivation_day_settings`).run();
  db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
});

describe('MOTIVATION DAY SNAPSHOT', () => {
  
  describe('A) First call creates snapshot', () => {
    
    it('creates snapshot on first call for new day', async () => {
      // Set settings
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive', motivation_percent: 0.15 });
      
      // First call - should create snapshot
      const res1 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res1.status).toBe(200);
      expect(res1.body.data.mode).toBe('adaptive');
      expect(res1.body.data.motivation_percent).toBe(0.15);
      
      // Verify snapshot exists in DB
      const row = db.prepare('SELECT settings_json FROM motivation_day_settings WHERE business_day = ?').get(DAY1);
      expect(row).toBeDefined();
      expect(row.settings_json).toContain('adaptive');
    });
    
    it('snapshot includes all relevant settings', async () => {
      const settings = {
        motivationType: 'adaptive',
        motivation_percent: 0.20,
        individual_share: 0.6,
        team_share: 0.4,
        k_speed: 2.0,
        k_cruise: 1.5,
        k_zone_center: 1.3,
        k_zone_sanatorium: 0.9
      };
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(settings);
      
      await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const row = db.prepare('SELECT settings_json FROM motivation_day_settings WHERE business_day = ?').get(DAY1);
      const snapshot = JSON.parse(row.settings_json);
      
      expect(snapshot.motivationType).toBe('adaptive');
      expect(snapshot.motivation_percent).toBe(0.20);
      expect(snapshot.individual_share).toBe(0.6);
      expect(snapshot.team_share).toBe(0.4);
      expect(snapshot.k_speed).toBe(2);
    });
  });
  
  describe('B) Snapshot is immutable after creation', () => {
    
    it('snapshot does NOT change when owner settings change', async () => {
      // Step 1: Set initial settings
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive', motivation_percent: 0.15 });
      
      // Step 2: Delete any existing snapshot
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY1);
      
      // Step 3: First call creates snapshot with 0.15
      const res1 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res1.body.data.motivation_percent).toBe(0.15);
      
      // Step 4: Change owner settings
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive', motivation_percent: 0.25 });
      
      // Step 5: Second call should STILL return 0.15 (from snapshot)
      const res2 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res2.body.data.motivation_percent).toBe(0.15);
      expect(res2.body.data.mode).toBe('adaptive');
    });
    
    it('new day uses updated settings after snapshot delete', async () => {
      // Set initial settings
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive', motivation_percent: 0.15 });
      
      // Create snapshot for DAY1
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY1);
      await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      // Change settings
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'team', motivation_percent: 0.25 });
      
      // DAY1 should still have old settings
      const res1 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res1.body.data.motivation_percent).toBe(0.15);
      expect(res1.body.data.mode).toBe('adaptive');
      
      // DAY2 (new day) should have new settings
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY2);
      const res2 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY2}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res2.body.data.motivation_percent).toBe(0.25);
      expect(res2.body.data.mode).toBe('team');
    });
  });
  
  describe('C) Snapshot recreation after delete', () => {
    
    it('deleted snapshot is recreated with current settings', async () => {
      // Set settings A
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive', motivation_percent: 0.10 });
      
      // Create snapshot
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY1);
      await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      // Change settings B
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'team', motivation_percent: 0.20 });
      
      // DAY1 still has old snapshot
      const before = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(before.body.data.motivation_percent).toBe(0.10);
      
      // Delete snapshot
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY1);
      
      // Recreate - should use current settings
      const after = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(after.body.data.motivation_percent).toBe(0.20);
      expect(after.body.data.mode).toBe('team');
    });
  });
  
  describe('D) Mode persistence in snapshot', () => {
    
    it('team mode is preserved in snapshot', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'team' });
      
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY1);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.mode).toBe('team');
      
      // Change to adaptive
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive' });
      
      // Should still be team
      const res2 = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res2.body.data.mode).toBe('team');
    });
    
    it('personal mode is preserved in snapshot', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'personal' });
      
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY1);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.mode).toBe('personal');
    });
    
    it('adaptive mode is preserved in snapshot', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive', individual_share: 0.7, team_share: 0.3 });
      
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY1);
      
      const res = await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.body.data.mode).toBe('adaptive');
      expect(res.body.data.individual_share).toBe(0.7);
      expect(res.body.data.team_share).toBe(0.3);
    });
  });
  
  describe('E) Coefficient persistence in snapshot', () => {
    
    it('k_* coefficients are preserved in snapshot', async () => {
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          motivationType: 'adaptive',
          k_speed: 2.5,
          k_cruise: 4.0,
          k_zone_center: 1.8,
          k_banana_center: 3.0
        });
      
      db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(DAY1);
      
      await request(app)
        .get(`/api/owner/motivation/day?day=${DAY1}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      const row = db.prepare('SELECT settings_json FROM motivation_day_settings WHERE business_day = ?').get(DAY1);
      const snapshot = JSON.parse(row.settings_json);
      
      expect(snapshot.k_speed).toBe(2.5);
      expect(snapshot.k_cruise).toBe(4);
      expect(snapshot.k_zone_center).toBe(1.8);
      expect(snapshot.k_banana_center).toBe(3);
      
      // Change settings
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ k_speed: 1.0, k_cruise: 1.0 });
      
      // Snapshot should still have old values
      const row2 = db.prepare('SELECT settings_json FROM motivation_day_settings WHERE business_day = ?').get(DAY1);
      const snapshot2 = JSON.parse(row2.settings_json);
      
      expect(snapshot2.k_speed).toBe(2.5);
    });
  });
});
