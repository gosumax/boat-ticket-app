// 20-owner-settings-contract.test.js — Owner Settings persistence contract
// Tests PUT → GET persistence, legacy fields, validation
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
  `).run('test_owner', hashedPassword);
  ownerUserId = ownerRes.lastInsertRowid;
  ownerToken = jwt.sign({ id: ownerUserId, username: 'test_owner', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Ensure owner_settings row exists
  db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
});

beforeEach(() => {
  // Reset settings to known state before each test
  db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
});

describe('OWNER SETTINGS CONTRACT', () => {
  
  describe('A) PUT → GET persistence', () => {
    
    it('persists motivationType', async () => {
      const payload = { motivationType: 'adaptive' };
      
      const putRes = await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      expect(putRes.status).toBe(200);
      expect(putRes.body.ok).toBe(true);
      expect(putRes.body.data.motivationType).toBe('adaptive');
      
      // Verify GET returns same value
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.motivationType).toBe('adaptive');
    });
    
    it('persists motivation_percent as fraction', async () => {
      const payload = { motivation_percent: 0.25 };
      
      const putRes = await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      expect(putRes.status).toBe(200);
      expect(putRes.body.data.motivation_percent).toBe(0.25);
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.motivation_percent).toBe(0.25);
    });
    
    it('persists weekly_percent and season_percent', async () => {
      const payload = { weekly_percent: 0.02, season_percent: 0.03 };
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.weekly_percent).toBe(0.02);
      expect(getRes.body.data.season_percent).toBe(0.03);
    });
    
    it('persists individual_share and team_share', async () => {
      const payload = { individual_share: 0.6, team_share: 0.4 };
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.individual_share).toBe(0.6);
      expect(getRes.body.data.team_share).toBe(0.4);
    });
    
    it('persists k_speed, k_cruise coefficients', async () => {
      const payload = { k_speed: 2.0, k_cruise: 1.5 };
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.k_speed).toBe(2);
      expect(getRes.body.data.k_cruise).toBe(1.5);
    });
    
    it('persists k_zone_* coefficients', async () => {
      const payload = { k_zone_center: 1.5, k_zone_sanatorium: 0.6 };
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.k_zone_center).toBe(1.5);
      expect(getRes.body.data.k_zone_sanatorium).toBe(0.6);
    });
    
    it('persists k_banana_* coefficients', async () => {
      const payload = { k_banana_center: 2.5, k_banana_sanatorium: 0.8 };
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.k_banana_center).toBe(2.5);
      expect(getRes.body.data.k_banana_sanatorium).toBe(0.8);
    });
    
    it('persists all fields in single PUT', async () => {
      const payload = {
        motivationType: 'adaptive',
        motivation_percent: 0.20,
        weekly_percent: 0.015,
        season_percent: 0.025,
        individual_share: 0.55,
        team_share: 0.45,
        k_speed: 1.8,
        k_cruise: 2.5,
        k_zone_center: 1.2,
        k_zone_sanatorium: 0.9,
        k_banana_center: 2.0,
        k_banana_sanatorium: 1.0
      };
      
      const putRes = await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      expect(putRes.status).toBe(200);
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.motivationType).toBe('adaptive');
      expect(getRes.body.data.motivation_percent).toBe(0.20);
      expect(getRes.body.data.weekly_percent).toBe(0.015);
      expect(getRes.body.data.season_percent).toBe(0.025);
      expect(getRes.body.data.individual_share).toBe(0.55);
      expect(getRes.body.data.team_share).toBe(0.45);
      expect(getRes.body.data.k_speed).toBe(1.8);
      expect(getRes.body.data.k_cruise).toBe(2.5);
      expect(getRes.body.data.k_zone_center).toBe(1.2);
      expect(getRes.body.data.k_zone_sanatorium).toBe(0.9);
      expect(getRes.body.data.k_banana_center).toBe(2.0);
      expect(getRes.body.data.k_banana_sanatorium).toBe(1.0);
    });
  });
  
  describe('B) Legacy computed fields (not stored)', () => {
    
    it('returns motivationPercentLegacy = motivation_percent * 100', async () => {
      const payload = { motivation_percent: 0.25 };
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.motivation_percent).toBe(0.25);
      expect(getRes.body.data.motivationPercentLegacy).toBe(25);
      
      // Verify legacy field is NOT in DB
      const row = db.prepare('SELECT settings_json FROM owner_settings WHERE id = 1').get();
      const parsed = JSON.parse(row.settings_json || '{}');
      expect(parsed.motivationPercentLegacy).toBeUndefined();
      expect(parsed.motivation_percent).toBe(0.25);
    });
    
    it('returns toWeeklyFundLegacy = weekly_percent * 100', async () => {
      const payload = { weekly_percent: 0.02 };
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.weekly_percent).toBe(0.02);
      expect(getRes.body.data.toWeeklyFundLegacy).toBe(2);
    });
    
    it('returns toSeasonFundLegacy = season_percent * 100', async () => {
      const payload = { season_percent: 0.03 };
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.season_percent).toBe(0.03);
      expect(getRes.body.data.toSeasonFundLegacy).toBe(3);
    });
    
    it('returns coefSpeed = k_speed', async () => {
      const payload = { k_speed: 2.0 };
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.k_speed).toBe(2);
      expect(getRes.body.data.coefSpeed).toBe(2);
      
      // Verify coefSpeed is NOT stored
      const row = db.prepare('SELECT settings_json FROM owner_settings WHERE id = 1').get();
      const parsed = JSON.parse(row.settings_json || '{}');
      expect(parsed.coefSpeed).toBeUndefined();
    });
    
    it('returns coefWalk = k_cruise', async () => {
      const payload = { k_cruise: 1.5 };
      
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.k_cruise).toBe(1.5);
      expect(getRes.body.data.coefWalk).toBe(1.5);
    });
  });
  
  describe('C) Share normalization', () => {
    
    it('normalizes individual_share + team_share != 1', async () => {
      const payload = { individual_share: 0.7, team_share: 0.5 }; // Sum = 1.2
      
      const putRes = await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(payload);
      
      expect(putRes.status).toBe(200);
      
      // Should normalize to 0.7/1.2 = 0.5833..., 0.5/1.2 = 0.4167...
      const sum = putRes.body.data.individual_share + putRes.body.data.team_share;
      expect(Math.abs(sum - 1)).toBeLessThan(0.01);
    });
  });
  
  describe('D) Defaults when empty', () => {
    
    it('returns defaults when settings_json is empty', async () => {
      db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.status).toBe(200);
      // Default motivationType is "team"
      expect(getRes.body.data.motivationType).toBe('team');
      // Default motivation_percent is 0.15
      expect(getRes.body.data.motivation_percent).toBe(0.15);
    });
  });
  
  describe('E) Overwrite behavior', () => {
    
    it('PUT overwrites existing settings completely', async () => {
      // First PUT
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'adaptive', motivation_percent: 0.25, k_speed: 2.0 });
      
      // Second PUT with different values
      await request(app)
        .put('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ motivationType: 'team', motivation_percent: 0.10 });
      
      const getRes = await request(app)
        .get('/api/owner/settings/full')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(getRes.body.data.motivationType).toBe('team');
      expect(getRes.body.data.motivation_percent).toBe(0.10);
      // k_speed should return to default since not specified in second PUT
      expect(getRes.body.data.k_speed).toBe(1.2); // default
    });
  });
});
