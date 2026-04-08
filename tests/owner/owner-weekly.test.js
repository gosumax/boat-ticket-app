import { describe, test, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Set env before imports
process.env.DB_FILE = ':memory:';
process.env.NODE_ENV = 'test';

import { app } from '../../server/index.js';
import db from '../../server/db.js';

const JWT_SECRET = 'boat_ticket_secret_key';

describe('OWNER MOTIVATION WEEKLY', () => {
  let ownerToken;

  beforeAll(async () => {
    // Create owner user and token
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const ownerId = insertUser.run('test_owner_weekly', hashedPassword, 'owner', 1).lastInsertRowid;
    ownerToken = jwt.sign({ id: ownerId, username: 'test_owner_weekly', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  });

  test('weekly endpoint returns ok with correct structure', async () => {
    const res = await request(app)
      .get('/api/owner/motivation/weekly')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    
    // Check required fields
    expect(res.body.data).toBeDefined();
    expect(res.body.data.week_id).toBeDefined();
    expect(res.body.data.date_from).toBeDefined();
    expect(res.body.data.date_to).toBeDefined();
    expect(Array.isArray(res.body.data.sellers)).toBe(true);
    expect(Array.isArray(res.body.data.top3)).toBe(true);
    expect(Array.isArray(res.body.data.top3_current)).toBe(true);
    expect(res.body.data.weekly_pool_total_current).toBeDefined();
    expect(res.body.data.weekly_distribution_current).toBeDefined();
    expect(res.body.data.weekly_distribution_current.first).toBe(0.5);
    expect(res.body.data.weekly_distribution_current.second).toBe(0.3);
    expect(res.body.data.weekly_distribution_current.third).toBe(0.2);
    
    // top3 length <= 3
    expect(res.body.data.top3.length).toBeLessThanOrEqual(3);
    
    // meta should have streak_mode
    expect(res.body.meta.streak_mode).toBe('current_state_multiplier');
  });

  test('weekly endpoint accepts week parameter', async () => {
    const res = await request(app)
      .get('/api/owner/motivation/weekly?week=2026-W07')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.week_id).toBe('2026-W07');
    // 2026-W07: date range depends on ISO week calculation
    expect(res.body.data.date_from).toBeDefined();
    expect(res.body.data.date_to).toBeDefined();
  });

  test('weekly endpoint uses ISO Monday-Sunday boundaries', async () => {
    const res = await request(app)
      .get('/api/owner/motivation/weekly?week=2026-W01')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.week_id).toBe('2026-W01');
    expect(res.body.data.date_from).toBe('2025-12-29');
    expect(res.body.data.date_to).toBe('2026-01-04');
  });

  test('weekly endpoint rejects invalid week format', async () => {
    const res = await request(app)
      .get('/api/owner/motivation/weekly?week=invalid')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('weekly endpoint rejects impossible ISO week number', async () => {
    const res = await request(app)
      .get('/api/owner/motivation/weekly?week=2021-W53')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('top3 is sorted by points desc', async () => {
    const res = await request(app)
      .get('/api/owner/motivation/weekly')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const top3 = res.body.data.top3;
    
    // If we have at least 2 entries, verify sorting
    if (top3.length >= 2) {
      expect(top3[0].points_week_total).toBeGreaterThanOrEqual(top3[1].points_week_total);
    }
    if (top3.length >= 3) {
      expect(top3[1].points_week_total).toBeGreaterThanOrEqual(top3[2].points_week_total);
    }
  });
});

describe('OWNER MOTIVATION SEASON', () => {
  let ownerToken;

  beforeAll(async () => {
    // Create owner user and token
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const ownerId = insertUser.run('test_owner_season', hashedPassword, 'owner', 1).lastInsertRowid;
    ownerToken = jwt.sign({ id: ownerId, username: 'test_owner_season', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  });

  test('season endpoint returns ok with correct structure', async () => {
    const res = await request(app)
      .get('/api/owner/motivation/season')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    
    // Check required fields
    expect(res.body.data).toBeDefined();
    expect(res.body.data.season_id).toBeDefined();
    expect(Array.isArray(res.body.data.sellers)).toBe(true);
    expect(Array.isArray(res.body.data.top3)).toBe(true);
    expect(res.body.data.season_pool_total_current).toBeDefined();
    expect(res.body.data.season_pool_rounding_total).toBeDefined();
    
    // top3 length <= 3
    expect(res.body.data.top3.length).toBeLessThanOrEqual(3);
  });

  test('season endpoint accepts season_id parameter', async () => {
    const res = await request(app)
      .get('/api/owner/motivation/season?season_id=2026')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_id).toBe('2026');
    expect(res.body.data.season_from).toBe('2026-05-01');
    expect(res.body.data.season_to).toBe('2026-10-01');
    expect(res.body.meta.season_rule_source).toBe('owner_settings.seasonStart/seasonEnd');
  });

  test('season endpoint uses owner_settings seasonStart/seasonEnd as canonical season rule', async () => {
    db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
      motivationType: 'team',
      motivation_percent: 0.15,
      seasonStart: '2037-05-10',
      seasonEnd: '2037-09-15',
      season_start_mmdd: '01-01',
      season_end_mmdd: '12-31',
    }));

    const res = await request(app)
      .get('/api/owner/motivation/season?season_id=2037')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_from).toBe('2037-05-10');
    expect(res.body.data.season_to).toBe('2037-09-15');
    expect(res.body.meta.season_rule_source).toBe('owner_settings.seasonStart/seasonEnd');

    db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
  });

  test('season endpoint uses MM-DD saved via owner settings save path after canonical sync', async () => {
    const saveRes = await request(app)
      .put('/api/owner/settings/full')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        season_start_mmdd: '01-01',
        season_end_mmdd: '12-01',
      });

    expect(saveRes.status).toBe(200);
    expect(saveRes.body.data.seasonStart).toBe('2026-01-01');
    expect(saveRes.body.data.seasonEnd).toBe('2026-12-01');

    const res = await request(app)
      .get('/api/owner/motivation/season?season_id=2026')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_from).toBe('2026-01-01');
    expect(res.body.data.season_to).toBe('2026-12-01');
    expect(res.body.meta.season_rule_source).toBe('owner_settings.seasonStart/seasonEnd');
  });

  test('season endpoint rejects invalid season_id format', async () => {
    const res = await request(app)
      .get('/api/owner/motivation/season?season_id=invalid')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('season top3 is sorted by points desc', async () => {
    const res = await request(app)
      .get('/api/owner/motivation/season')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const top3 = res.body.data.top3;
    
    // If we have at least 2 entries, verify sorting
    if (top3.length >= 2) {
      expect(top3[0].points_total).toBeGreaterThanOrEqual(top3[1].points_total);
    }
    if (top3.length >= 3) {
      expect(top3[1].points_total).toBeGreaterThanOrEqual(top3[2].points_total);
    }
  });

  test('season endpoint separates revenue, rounding and dispatcher decision fund metrics', async () => {
    db.prepare(`
      INSERT INTO money_ledger (kind, type, method, amount, status, business_day, event_time, decision_final)
      VALUES ('FUND', 'WITHHOLD_SEASON', 'INTERNAL', 300, 'POSTED', '2035-06-10', datetime('now'), 1)
    `).run();
    db.prepare(`
      INSERT INTO money_ledger (kind, type, method, amount, status, business_day, event_time, decision_final)
      VALUES ('FUND', 'SEASON_PREPAY_DELETE', 'INTERNAL', 700, 'POSTED', '2035-06-10', datetime('now'), 1)
    `).run();

    const res = await request(app)
      .get('/api/owner/motivation/season?season_id=2035')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_pool_total_ledger).toBe(1000);
    expect(res.body.data.season_pool_total_current).toBe(300);
    expect(res.body.data.season_pool_from_revenue_total).toBe(300);
    expect(res.body.data.season_pool_dispatcher_decision_total).toBe(700);
    expect(res.body.data.season_pool_manual_transfer_total).toBe(700);

    db.prepare(`DELETE FROM money_ledger WHERE business_day = '2035-06-10'`).run();
  });

  test('season ranking keeps only seller participants and excludes dispatchers', async () => {
    const sellerId = 98351;
    const sellerSilentId = 98352;
    const dispatcherId = 98353;

    db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone)
      VALUES (?, 'season_seller_active', 'hash', 'seller', 1, 'center')
    `).run(sellerId);
    db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone)
      VALUES (?, 'season_seller_silent', 'hash', 'seller', 1, 'hedgehog')
    `).run(sellerSilentId);
    db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone)
      VALUES (?, 'season_dispatcher', 'hash', 'dispatcher', 1, 'center')
    `).run(dispatcherId);

    db.prepare(`
      INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
      VALUES ('2036-05-10', ?, 1200, 12)
    `).run(sellerId);
    db.prepare(`
      INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
      VALUES ('2036-05-11', ?, 9999, 999)
    `).run(dispatcherId);

    db.prepare(`
      INSERT OR REPLACE INTO seller_season_stats (seller_id, season_id, revenue_total, points_total)
      VALUES (?, '2036', 1200, 12)
    `).run(sellerId);
    db.prepare(`
      INSERT OR REPLACE INTO seller_season_stats (seller_id, season_id, revenue_total, points_total)
      VALUES (?, '2036', 9999, 999)
    `).run(dispatcherId);

    const res = await request(app)
      .get('/api/owner/motivation/season?season_id=2036')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const sellers = res.body.data.sellers || [];
    expect(sellers.find((s) => Number(s.user_id) === sellerId)).toBeDefined();
    expect(sellers.find((s) => Number(s.user_id) === sellerSilentId)).toBeUndefined();
    expect(sellers.find((s) => Number(s.user_id) === dispatcherId)).toBeUndefined();
    expect(res.body.meta.season_stats_source).toBe('seller_day_stats');
    expect(res.body.meta.seller_ranking_scope).toBe('seller_participants_only');

    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id IN (?, ?, ?)`).run(sellerId, sellerSilentId, dispatcherId);
    db.prepare(`DELETE FROM seller_season_stats WHERE seller_id IN (?, ?, ?)`).run(sellerId, sellerSilentId, dispatcherId);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?)`).run(sellerId, sellerSilentId, dispatcherId);
  });
});

describe('SEASON IDEMPOTENCY', () => {
  let ownerToken;

  beforeAll(async () => {
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const ownerId = insertUser.run('test_owner_idempotency', hashedPassword, 'owner', 1).lastInsertRowid;
    ownerToken = jwt.sign({ id: ownerId, username: 'test_owner_idempotency', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  });

  test('repeated season update does not double-count points', async () => {
    // Import season-stats functions directly
    const { saveDayStats, updateSeasonStatsFromDay } = await import('../../server/season-stats.mjs');
    
    const businessDay = '2026-03-15';
    const seasonId = '2026';
    const sellerId = 99999; // Use high ID to avoid conflicts
    
    // Create a test seller
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active) VALUES (?, 'test_seller_idem', 'hash', 'seller', 1)`).run(sellerId);
    
    // Initial season stats (should be 0 or not exist)
    const beforeRow = db.prepare(`SELECT points_total FROM seller_season_stats WHERE seller_id = ? AND season_id = ?`).get(sellerId, seasonId);
    const beforePoints = Number(beforeRow?.points_total || 0);
    
    // Save day stats and apply to season (first time)
    const rows = [{ seller_id: sellerId, revenue_day: 50000, points_day_total: 123.45 }];
    saveDayStats(db, businessDay, rows);
    updateSeasonStatsFromDay(db, businessDay);
    
    // Check after first application
    const afterFirstRow = db.prepare(`SELECT points_total FROM seller_season_stats WHERE seller_id = ? AND season_id = ?`).get(sellerId, seasonId);
    const afterFirstPoints = Number(afterFirstRow?.points_total || 0);
    expect(afterFirstPoints).toBe(beforePoints + 123.45);
    
    // Try to apply again (simulating repeated shift_close)
    saveDayStats(db, businessDay, rows); // This is idempotent
    updateSeasonStatsFromDay(db, businessDay); // This should NOT double-count
    
    // Check after second application - should be same as first
    const afterSecondRow = db.prepare(`SELECT points_total FROM seller_season_stats WHERE seller_id = ? AND season_id = ?`).get(sellerId, seasonId);
    const afterSecondPoints = Number(afterSecondRow?.points_total || 0);
    expect(afterSecondPoints).toBe(afterFirstPoints); // No change!
    
    // Cleanup
    db.prepare(`DELETE FROM seller_season_applied_days WHERE seller_id = ?`).run(sellerId);
    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id = ?`).run(sellerId);
    db.prepare(`DELETE FROM seller_season_stats WHERE seller_id = ?`).run(sellerId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(sellerId);
  });
});

describe('DISPATCHER DAILY BONUS', () => {
  let ownerToken;

  beforeAll(async () => {
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const ownerId = insertUser.run('test_owner_disp_bonus', hashedPassword, 'owner', 1).lastInsertRowid;
    ownerToken = jwt.sign({ id: ownerId, username: 'test_owner_disp_bonus', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  });

  test('dispatcher bonus stays separate from seller payouts on owner day', async () => {
    const businessDay = '2026-04-01';
    const dispatcherId = 88888;
    
    // Create a test dispatcher
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active) VALUES (?, 'test_disp_active', 'hash', 'dispatcher', 1)`).run(dispatcherId);
    
    // Dispatcher sells tickets (same source as sellers - kind=SELLER_SHIFT with sale types)
    // This makes dispatcher "active" with personal_revenue_day > 0
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 50000, ?, 'POSTED', ?, datetime('now'))
    `).run(dispatcherId, businessDay);
    
    // Add some seller revenue for T calculation
    const sellerId = 88889;
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active) VALUES (?, 'test_seller_disp', 'hash', 'seller', 1)`).run(sellerId);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 50000, ?, 'POSTED', ?, datetime('now'))
    `).run(sellerId, businessDay);
    
    // Call motivation/day endpoint
    const res = await request(app)
      .get(`/api/owner/motivation/day?day=${businessDay}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    
    // Check dispatcher daily bonus fields
    expect(res.body.data.dispatcher_daily_percent).toBe(0.001);
    expect(res.body.data.active_dispatchers_count).toBe(1);
    
    // Owner day uses the shared owner calculation: base = 100000, per-dispatcher bonus = roundDownTo50(100000 * 0.001) = 100
    const expectedBonus = 100;
    expect(res.body.data.dispatcher_daily_bonus_total).toBe(expectedBonus);
    
    const sellerPayout = res.body.data.payouts.find(p => p.user_id === sellerId);
    const dispatcherPayout = res.body.data.payouts.find(p => p.user_id === dispatcherId);
    expect(res.body.data.participants).toBe(2);
    expect(res.body.data.active_dispatchers).toBe(1);
    expect(sellerPayout).toBeDefined();
    expect(dispatcherPayout).toBeDefined();
    expect(sellerPayout.personal_revenue_day).toBe(50000);
    
    // Cleanup
    db.prepare(`DELETE FROM money_ledger WHERE business_day = ?`).run(businessDay);
    db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(businessDay);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(dispatcherId, sellerId);
  });

  test('dispatcher with no sales revenue gets no bonus', async () => {
    const businessDay = '2026-04-02';
    const dispatcherId = 88887;
    
    // Create a test dispatcher (no sales revenue - no SELLER_SHIFT entries)
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active) VALUES (?, 'test_disp_inactive', 'hash', 'dispatcher', 1)`).run(dispatcherId);
    
    // Add some seller revenue for T calculation
    const sellerId = 88886;
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active) VALUES (?, 'test_seller_disp2', 'hash', 'seller', 1)`).run(sellerId);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 100000, ?, 'POSTED', ?, datetime('now'))
    `).run(sellerId, businessDay);
    
    // Call motivation/day endpoint
    const res = await request(app)
      .get(`/api/owner/motivation/day?day=${businessDay}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    
    // No active dispatchers (dispatcher has no sales revenue)
    expect(res.body.data.active_dispatchers_count).toBe(0);
    expect(res.body.data.dispatcher_daily_bonus_total).toBe(0);
    expect(res.body.data.participants).toBe(1);
    expect(res.body.data.active_dispatchers).toBe(0);
    
    // Cleanup
    db.prepare(`DELETE FROM money_ledger WHERE business_day = ?`).run(businessDay);
    db.prepare(`DELETE FROM motivation_day_settings WHERE business_day = ?`).run(businessDay);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(dispatcherId, sellerId);
  });
});

describe('WEEKLY PAYOUT DISTRIBUTION', () => {
  let ownerToken;

  beforeAll(async () => {
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const ownerId = insertUser.run('test_owner_weekly_payout', hashedPassword, 'owner', 1).lastInsertRowid;
    ownerToken = jwt.sign({ id: ownerId, username: 'test_owner_weekly_payout', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  });

  test('weekly payout distribution 50/30/20 for 3+ sellers', async () => {
    const weekId = '2026-W15';
    const businessDay1 = '2026-04-06'; // Monday of W15
    const businessDay2 = '2026-04-07';
    
    // Create 3 sellers with different revenue (to ensure ranking)
    const seller1 = 90001;
    const seller2 = 90002;
    const seller3 = 90003;
    
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'test_w_seller1', 'hash', 'seller', 1, 'center')`).run(seller1);
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'test_w_seller2', 'hash', 'seller', 1, 'center')`).run(seller2);
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'test_w_seller3', 'hash', 'seller', 1, 'center')`).run(seller3);
    
    // Create a boat and slot for generating points
    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Test Weekly Boat', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    
    // Create presales for each seller
    const presale1 = db.prepare(`INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale) VALUES (?, ?, 'Test', '123', 1, 50000, ?, 'center')`).run(seller1, slotId, businessDay1).lastInsertRowid;
    const presale2 = db.prepare(`INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale) VALUES (?, ?, 'Test', '123', 1, 30000, ?, 'center')`).run(seller2, slotId, businessDay1).lastInsertRowid;
    const presale3 = db.prepare(`INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale) VALUES (?, ?, 'Test', '123', 1, 20000, ?, 'center')`).run(seller3, slotId, businessDay1).lastInsertRowid;
    
    // Create money_ledger entries (SELLER_SHIFT with sale types)
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 50000, ?, ?, 'POSTED', ?, datetime('now'))
    `).run(seller1, presale1, businessDay1);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 30000, ?, ?, 'POSTED', ?, datetime('now'))
    `).run(seller2, presale2, businessDay1);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 20000, ?, ?, 'POSTED', ?, datetime('now'))
    `).run(seller3, presale3, businessDay1);
    
    // Call weekly endpoint
    const res = await request(app)
      .get(`/api/owner/motivation/weekly?week=${weekId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    
    // Check response structure
    expect(res.body.data.revenue_total_week).toBeDefined();
    expect(res.body.data.weekly_pool_total).toBeDefined();
    expect(res.body.data.weekly_distribution).toBeDefined();
    
    // Check distribution (default 50/30/20 for 3+ sellers)
    expect(res.body.data.weekly_distribution.first).toBe(0.5);
    expect(res.body.data.weekly_distribution.second).toBe(0.3);
    expect(res.body.data.weekly_distribution.third).toBe(0.2);
    
    // Verify sellers have weekly_payout
    const sellers = res.body.data.sellers;
    expect(sellers.length).toBeGreaterThanOrEqual(3);
    
    // Find our test sellers
    const s1 = sellers.find(s => s.user_id === seller1);
    const s2 = sellers.find(s => s.user_id === seller2);
    const s3 = sellers.find(s => s.user_id === seller3);
    
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    expect(s3).toBeDefined();
    
    // Verify payouts are assigned correctly (rank 1 = 50%, rank 2 = 30%, rank 3 = 20%)
    const poolTotal = res.body.data.weekly_pool_total;
    
    // Sellers should be sorted by points, so verify payouts
    if (s1.rank === 1) {
      expect(s1.weekly_payout).toBe(Math.floor(poolTotal * 0.5));
    } else if (s1.rank === 2) {
      expect(s1.weekly_payout).toBe(Math.floor(poolTotal * 0.3));
    } else if (s1.rank === 3) {
      expect(s1.weekly_payout).toBe(Math.floor(poolTotal * 0.2));
    }
    
    // Cleanup
    db.prepare(`DELETE FROM money_ledger WHERE business_day IN (?, ?)`).run(businessDay1, businessDay2);
    db.prepare(`DELETE FROM presales WHERE business_day IN (?, ?)`).run(businessDay1, businessDay2);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?)`).run(seller1, seller2, seller3);
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
  });

  test('weekly payout 100% for single seller', async () => {
    const weekId = '2026-W16';
    const businessDay = '2026-04-13'; // Monday of W16
    
    // Create only 1 seller
    const sellerId = 90011;
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'test_w_single', 'hash', 'seller', 1, 'center')`).run(sellerId);
    
    // Create a boat and slot
    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Test Weekly Single Boat', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    
    // Create presale and ledger entry
    const presaleId = db.prepare(`INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale) VALUES (?, ?, 'Test', '123', 1, 100000, ?, 'center')`).run(sellerId, slotId, businessDay).lastInsertRowid;
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 100000, ?, ?, 'POSTED', ?, datetime('now'))
    `).run(sellerId, presaleId, businessDay);
    
    // Call weekly endpoint
    const res = await request(app)
      .get(`/api/owner/motivation/weekly?week=${weekId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    
    // Check distribution for single seller (100%)
    expect(res.body.data.weekly_distribution.first).toBe(1.0);
    expect(res.body.data.weekly_distribution.second).toBe(0);
    expect(res.body.data.weekly_distribution.third).toBe(0);
    
    // Find our seller
    const seller = res.body.data.sellers.find(s => s.user_id === sellerId);
    expect(seller).toBeDefined();
    expect(seller.rank).toBe(1);
    expect(seller.weekly_payout).toBe(res.body.data.weekly_pool_total);
    
    // Cleanup
    db.prepare(`DELETE FROM money_ledger WHERE business_day = ?`).run(businessDay);
    db.prepare(`DELETE FROM presales WHERE business_day = ?`).run(businessDay);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(sellerId);
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
  });

  test('weekly payout 60/40 for two sellers', async () => {
    const weekId = '2026-W17';
    const businessDay = '2026-04-20'; // Monday of W17
    
    // Create 2 sellers
    const seller1 = 90021;
    const seller2 = 90022;
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'test_w_two1', 'hash', 'seller', 1, 'center')`).run(seller1);
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'test_w_two2', 'hash', 'seller', 1, 'center')`).run(seller2);
    
    // Create a boat and slot
    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Test Weekly Two Boat', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    
    // Create presales and ledger entries
    const presale1 = db.prepare(`INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale) VALUES (?, ?, 'Test', '123', 1, 60000, ?, 'center')`).run(seller1, slotId, businessDay).lastInsertRowid;
    const presale2 = db.prepare(`INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale) VALUES (?, ?, 'Test', '123', 1, 40000, ?, 'center')`).run(seller2, slotId, businessDay).lastInsertRowid;
    
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 60000, ?, ?, 'POSTED', ?, datetime('now'))
    `).run(seller1, presale1, businessDay);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 40000, ?, ?, 'POSTED', ?, datetime('now'))
    `).run(seller2, presale2, businessDay);
    
    // Call weekly endpoint
    const res = await request(app)
      .get(`/api/owner/motivation/weekly?week=${weekId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    
    // Check distribution for two sellers (60/40)
    expect(res.body.data.weekly_distribution.first).toBe(0.6);
    expect(res.body.data.weekly_distribution.second).toBe(0.4);
    expect(res.body.data.weekly_distribution.third).toBe(0);
    
    const poolTotal = res.body.data.weekly_pool_total;
    
    // Find our sellers
    const s1 = res.body.data.sellers.find(s => s.user_id === seller1);
    const s2 = res.body.data.sellers.find(s => s.user_id === seller2);
    
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    
    // Verify payouts based on rank
    const seller1Payout = s1.rank === 1 ? Math.floor(poolTotal * 0.6) : Math.floor(poolTotal * 0.4);
    const seller2Payout = s2.rank === 1 ? Math.floor(poolTotal * 0.6) : Math.floor(poolTotal * 0.4);
    
    expect(s1.weekly_payout).toBe(seller1Payout);
    expect(s2.weekly_payout).toBe(seller2Payout);
    
    // Cleanup
    db.prepare(`DELETE FROM money_ledger WHERE business_day = ?`).run(businessDay);
    db.prepare(`DELETE FROM presales WHERE business_day = ?`).run(businessDay);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(seller1, seller2);
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
  });
});

describe('ROUNDING TO 50', () => {
  let ownerToken;

  beforeAll(async () => {
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const ownerId = insertUser.run('test_owner_rounding', hashedPassword, 'owner', 1).lastInsertRowid;
    ownerToken = jwt.sign({ id: ownerId, username: 'test_owner_rounding', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  });

  test('weekly_payout is rounded down to nearest 50', async () => {
    const weekId = '2026-W20';
    const businessDay = '2026-05-11'; // Monday of W20
    
    // Create seller
    const sellerId = 91001;
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'test_round_seller', 'hash', 'seller', 1, 'center')`).run(sellerId);
    
    // Create boat and slot
    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Test Rounding Boat', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    
    // Create presale and ledger entry - 10499 RUB to test rounding
    // With weekly_percent = 0.01, weekly_pool_total = floor(10499 * 0.01) = 104
    // 50% of 104 = 52 -> roundDownTo50(52) = 50
    const presaleId = db.prepare(`INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale) VALUES (?, ?, 'Test', '123', 1, 10499, ?, 'center')`).run(sellerId, slotId, businessDay).lastInsertRowid;
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 10499, ?, ?, 'POSTED', ?, datetime('now'))
    `).run(sellerId, presaleId, businessDay);
    
    // Call weekly endpoint
    const res = await request(app)
      .get(`/api/owner/motivation/weekly?week=${weekId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    
    // weekly_pool_total = floor(10499 * 0.01) = 104
    expect(res.body.data.weekly_pool_total).toBe(104);
    
    // Find seller and check weekly_payout is rounded down to 50
    const seller = res.body.data.sellers.find(s => s.user_id === sellerId);
    expect(seller).toBeDefined();
    // 100% of 104 = 104, rounded down to 50 = 100
    expect(seller.weekly_payout).toBe(100);
    
    // Cleanup
    db.prepare(`DELETE FROM money_ledger WHERE business_day = ?`).run(businessDay);
    db.prepare(`DELETE FROM presales WHERE business_day = ?`).run(businessDay);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(sellerId);
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
  });

  test('roundDownTo50 utility function', async () => {
    const { roundDownTo50 } = await import('../../server/utils/money-rounding.mjs');
    
    // Test cases from the spec
    expect(roundDownTo50(10499)).toBe(10450);
    expect(roundDownTo50(10450)).toBe(10450);
    expect(roundDownTo50(10401)).toBe(10400);
    expect(roundDownTo50(49)).toBe(0);
    expect(roundDownTo50(50)).toBe(50);
    expect(roundDownTo50(100)).toBe(100);
    expect(roundDownTo50(149)).toBe(100);
    expect(roundDownTo50(150)).toBe(150);
    expect(roundDownTo50(0)).toBe(0);
    expect(roundDownTo50(null)).toBe(0);
    expect(roundDownTo50(undefined)).toBe(0);
  });
});

describe('SEASON ELIGIBILITY', () => {
  let ownerToken;

  beforeAll(async () => {
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const ownerId = insertUser.run('test_owner_season_elig', hashedPassword, 'owner', 1).lastInsertRowid;
    ownerToken = jwt.sign({ id: ownerId, username: 'test_owner_season_elig', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  });

  test('seller with 75+ season days, 20+ sep days, 1+ end-sep day is eligible', async () => {
    const seasonId = '2038';
    const sellerId = 92001;

    db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
      seasonStart: '2038-05-01',
      seasonEnd: '2038-10-01',
    }));
    
    // Create seller
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'eligible_seller', 'hash', 'seller', 1, 'center')`).run(sellerId);
    
    // Create 75 worked days in season (May-Jul within configured season)
    for (let day = 1; day <= 31; day++) {
      const date = `2038-05-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(sellerId, date);
    }
    for (let day = 1; day <= 30; day++) {
      const date = `2038-06-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(sellerId, date);
    }
    for (let day = 1; day <= 14; day++) {
      const date = `2038-07-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(sellerId, date);
    }
    
    // Create 20 worked days in September (including 1 in end-sep window)
    for (let day = 1; day <= 19; day++) {
      const date = `2038-09-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(sellerId, date);
    }
    // Add 1 day in end-sep window (Sep 25)
    db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(sellerId, '2038-09-25');
    
    // Call season endpoint
    const res = await request(app)
      .get(`/api/owner/motivation/season?season_id=${seasonId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    
    const seller = res.body.data.sellers.find(s => s.user_id === sellerId);
    expect(seller).toBeDefined();
    expect(seller.is_eligible).toBe(1);
    expect(seller.worked_days_season).toBeGreaterThanOrEqual(75);
    expect(seller.worked_days_sep).toBeGreaterThanOrEqual(20);
    expect(seller.worked_days_end_sep).toBeGreaterThanOrEqual(1);
    
    // Cleanup
    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id = ?`).run(sellerId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(sellerId);
    db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
  });

  test('seller with insufficient days is not eligible', async () => {
    const seasonId = '2038';
    const sellerId = 92002;

    db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
      seasonStart: '2038-05-01',
      seasonEnd: '2038-10-01',
    }));
    
    // Create seller
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'not_eligible_seller', 'hash', 'seller', 1, 'center')`).run(sellerId);
    
    // Only 50 days in season, 10 in sep, 0 in end-sep window
    for (let day = 1; day <= 50; day++) {
      const date = `2038-05-${String(day).padStart(2, '0')}`;
      try {
        db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(sellerId, date);
      } catch (e) { /* ignore */ }
    }
    for (let day = 1; day <= 10; day++) {
      const date = `2038-09-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(sellerId, date);
    }
    
    // Call season endpoint
    const res = await request(app)
      .get(`/api/owner/motivation/season?season_id=${seasonId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    
    const seller = res.body.data.sellers.find(s => s.user_id === sellerId);
    expect(seller).toBeDefined();
    expect(seller.is_eligible).toBe(0);
    
    // Cleanup
    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id = ?`).run(sellerId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(sellerId);
    db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
  });
});

describe('SEASON PAYOUT PROPORTIONAL', () => {
  let ownerToken;

  beforeAll(async () => {
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const ownerId = insertUser.run('test_owner_season_payout', hashedPassword, 'owner', 1).lastInsertRowid;
    ownerToken = jwt.sign({ id: ownerId, username: 'test_owner_season_payout', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  });

  test('season payout splits the unified season fund equally across eligible sellers when scheme=all', async () => {
    const seasonId = '2039';
    const seller1 = 93001;
    const seller2 = 93002;
    
    // Create sellers
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'eligible_seller1', 'hash', 'seller', 1, 'center')`).run(seller1);
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'eligible_seller2', 'hash', 'seller', 1, 'center')`).run(seller2);
    
    // Create season stats with points
    db.prepare(`INSERT OR IGNORE INTO seller_season_stats (seller_id, season_id, revenue_total, points_total) VALUES (?, ?, ?, ?)`).run(seller1, seasonId, 1000000, 100000);
    db.prepare(`INSERT OR IGNORE INTO seller_season_stats (seller_id, season_id, revenue_total, points_total) VALUES (?, ?, ?, ?)`).run(seller2, seasonId, 500000, 50000);

    db.prepare(`INSERT OR REPLACE INTO owner_settings (id, settings_json) VALUES (1, ?)`).run(JSON.stringify({
      season_percent: 0.01,
      season_withhold_percent_total: 0.01,
      season_payout_scheme: 'all',
      seasonStart: '2039-05-01',
      seasonEnd: '2039-10-01',
    }));
    
    // Make both eligible (75+ season days, 20+ sep days, 1+ end-sep day)
    for (let day = 1; day <= 31; day++) {
      const date = `2039-05-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, date);
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller2, date);
    }
    for (let day = 1; day <= 30; day++) {
      const date = `2039-06-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, date);
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller2, date);
    }
    for (let day = 1; day <= 14; day++) {
      const date = `2039-07-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, date);
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller2, date);
    }
    for (let day = 1; day <= 20; day++) {
      const date = `2039-09-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, date);
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller2, date);
    }
    // Add end-sep window day
    db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, '2039-09-25');
    db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller2, '2039-09-26');
    db.prepare(`
      INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
      VALUES ('2039-09-25', ?, 1000, 100000)
    `).run(seller1);
    db.prepare(`
      INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
      VALUES ('2039-09-26', ?, 1000, 50000)
    `).run(seller2);
    
    // Create boat and slot for money_ledger
    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Season Test Boat', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    
    // Revenue-driven season part = 10000, manual dispatcher transfer = 5000, unified fund = 15000
    const presaleId = db.prepare(`INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale) VALUES (?, ?, 'Test', '123', 1, 1000000, '2039-06-15', 'center')`).run(seller1, slotId).lastInsertRowid;
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1000000, ?, ?, 'POSTED', '2039-06-15', datetime('now'))
    `).run(seller1, presaleId);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, status, business_day, event_time)
      VALUES ('FUND', 'WITHHOLD_SEASON', 10000, 'POSTED', '2039-06-15', datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, status, business_day, event_time)
      VALUES ('FUND', 'SEASON_PREPAY_DELETE', 5000, 'POSTED', '2039-06-15', datetime('now'))
    `).run();
    
    // Call season endpoint
    const res = await request(app)
      .get(`/api/owner/motivation/season?season_id=${seasonId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_percent).toBe(0.01);
    expect(res.body.data.season_pool_total).toBe(10000);
    expect(res.body.data.season_pool_from_revenue_total).toBe(10000);
    expect(res.body.data.season_pool_dispatcher_decision_total).toBe(5000);
    expect(res.body.data.season_pool_total_ledger).toBe(15000);
    expect(res.body.data.season_payout_fund_total).toBe(15000);
    expect(res.body.data.season_payout_scheme).toBe('all');
    expect(res.body.data.eligible_count).toBe(2);
    expect(res.body.data.sum_points_eligible).toBe(150000);
    
    const s1 = res.body.data.sellers.find(s => s.user_id === seller1);
    const s2 = res.body.data.sellers.find(s => s.user_id === seller2);
    
    expect(s1.is_eligible).toBe(1);
    expect(s2.is_eligible).toBe(1);
    
    expect(s1.season_payout).toBe(7500);
    expect(s2.season_payout).toBe(7500);
    expect(s1.season_share).toBeCloseTo(0.5, 6);
    expect(s2.season_share).toBeCloseTo(0.5, 6);
    expect(res.body.data.season_payouts_sum).toBe(15000);
    expect(res.body.data.season_payouts_remainder).toBe(0);
    
    // Cleanup
    db.prepare(`DELETE FROM money_ledger WHERE business_day = '2039-06-15'`).run();
    db.prepare(`DELETE FROM presales WHERE business_day = '2039-06-15'`).run();
    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id IN (?, ?)`).run(seller1, seller2);
    db.prepare(`DELETE FROM seller_season_stats WHERE seller_id IN (?, ?)`).run(seller1, seller2);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(seller1, seller2);
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
    db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
  });

  test('season payout keeps the full unified season fund when scheme=all and only one seller is eligible', async () => {
    const seasonId = '2040';
    const seller1 = 93003;
    
    // Create seller
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'eligible_seller3', 'hash', 'seller', 1, 'center')`).run(seller1);
    
    // Create season stats with points
    db.prepare(`INSERT OR IGNORE INTO seller_season_stats (seller_id, season_id, revenue_total, points_total) VALUES (?, ?, ?, ?)`).run(seller1, seasonId, 1000000, 100000);

    db.prepare(`INSERT OR REPLACE INTO owner_settings (id, settings_json) VALUES (1, ?)`).run(JSON.stringify({
      season_percent: 0.01,
      season_withhold_percent_total: 0.01,
      season_payout_scheme: 'all',
      seasonStart: '2040-05-01',
      seasonEnd: '2040-10-01',
    }));
    
    // Make eligible
    for (let day = 1; day <= 31; day++) {
      const date = `2040-05-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, date);
    }
    for (let day = 1; day <= 30; day++) {
      const date = `2040-06-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, date);
    }
    for (let day = 1; day <= 14; day++) {
      const date = `2040-07-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, date);
    }
    for (let day = 1; day <= 20; day++) {
      const date = `2040-09-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, date);
    }
    db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, '2040-09-25');
    db.prepare(`
      INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
      VALUES ('2040-09-25', ?, 1000, 100000)
    `).run(seller1);
    
    // Create boat and slot
    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Season Test Boat 2', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    
    // With one eligible seller, the full season fund should go to that seller.
    const presaleId = db.prepare(`INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale) VALUES (?, ?, 'Test', '123', 1, 1504900, '2040-06-16', 'center')`).run(seller1, slotId).lastInsertRowid;
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1504900, ?, ?, 'POSTED', '2040-06-16', datetime('now'))
    `).run(seller1, presaleId);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, status, business_day, event_time)
      VALUES ('FUND', 'WITHHOLD_SEASON', 15049, 'POSTED', '2040-06-16', datetime('now'))
    `).run();
    
    const res = await request(app)
      .get(`/api/owner/motivation/season?season_id=${seasonId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_pool_total).toBe(15049);
    expect(res.body.data.season_pool_total_ledger).toBe(15049);
    expect(res.body.data.season_payout_fund_total).toBe(15049);
    expect(res.body.data.eligible_count).toBe(1);
    
    const s1 = res.body.data.sellers.find(s => s.user_id === seller1);
    expect(s1.season_payout).toBe(15049);
    expect(res.body.data.season_payouts_sum).toBe(15049);
    expect(res.body.data.season_payouts_remainder).toBe(0);
    
    // Cleanup
    db.prepare(`DELETE FROM money_ledger WHERE business_day = '2040-06-16'`).run();
    db.prepare(`DELETE FROM presales WHERE business_day = '2040-06-16'`).run();
    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id = ?`).run(seller1);
    db.prepare(`DELETE FROM seller_season_stats WHERE seller_id = ?`).run(seller1);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(seller1);
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
    db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
  });

  test('season payout scheme all shows equal forecast even when one seller has not met qualification yet', async () => {
    const seasonId = '2040';
    const seller1 = 93004;
    const seller2 = 93005;

    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'forecast_all_1', 'hash', 'seller', 1, 'center')`).run(seller1);
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'forecast_all_2', 'hash', 'seller', 1, 'center')`).run(seller2);

    db.prepare(`INSERT OR REPLACE INTO owner_settings (id, settings_json) VALUES (1, ?)`).run(JSON.stringify({
      season_percent: 0.01,
      season_withhold_percent_total: 0.01,
      season_payout_scheme: 'all',
      seasonStart: '2040-05-01',
      seasonEnd: '2040-10-01',
    }));

    const seller1Dates = [
      ...Array.from({ length: 31 }, (_, i) => `2040-05-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 30 }, (_, i) => `2040-06-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 14 }, (_, i) => `2040-07-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 20 }, (_, i) => `2040-09-${String(i + 1).padStart(2, '0')}`),
    ];
    const seller2Dates = Array.from({ length: 15 }, (_, i) => `2040-05-${String(i + 1).padStart(2, '0')}`);

    seller1Dates.forEach((businessDay) => {
      db.prepare(`
        INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
        VALUES (?, ?, 1000)
      `).run(seller1, businessDay);
    });
    db.prepare(`
      INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
      VALUES (?, '2040-09-25', 1000)
    `).run(seller1);

    seller2Dates.forEach((businessDay) => {
      db.prepare(`
        INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
        VALUES (?, ?, 1000)
      `).run(seller2, businessDay);
    });
    db.prepare(`
      INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
      VALUES ('2040-09-25', ?, 1000, 200)
    `).run(seller1);
    db.prepare(`
      INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
      VALUES ('2040-05-15', ?, 1000, 100)
    `).run(seller2);

    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Season Forecast All Boat', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    const presaleId = db.prepare(`
      INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale)
      VALUES (?, ?, 'Forecast All', '123', 1, 1500000, '2040-06-16', 'center')
    `).run(seller1, slotId).lastInsertRowid;
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1500000, ?, ?, 'POSTED', '2040-06-16', datetime('now'))
    `).run(seller1, presaleId);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, status, business_day, event_time)
      VALUES ('FUND', 'WITHHOLD_SEASON', 15000, 'POSTED', '2040-06-16', datetime('now'))
    `).run();

    const res = await request(app)
      .get(`/api/owner/motivation/season?season_id=${seasonId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_payout_scheme).toBe('all');
    expect(res.body.data.season_payout_recipient_count).toBe(2);
    expect(res.body.data.eligible_count).toBe(1);
    expect(res.body.data.season_payouts_sum).toBe(15000);
    expect(res.body.data.season_payouts_remainder).toBe(0);

    const sellers = res.body.data.sellers || [];
    expect(sellers.find((seller) => seller.user_id === seller1)?.is_eligible).toBe(1);
    expect(sellers.find((seller) => seller.user_id === seller1)?.season_payout).toBe(7500);
    expect(sellers.find((seller) => seller.user_id === seller1)?.season_payout_recipient).toBe(1);
    expect(sellers.find((seller) => seller.user_id === seller2)?.is_eligible).toBe(0);
    expect(sellers.find((seller) => seller.user_id === seller2)?.season_payout).toBe(7500);
    expect(sellers.find((seller) => seller.user_id === seller2)?.season_payout_recipient).toBe(1);

    db.prepare(`DELETE FROM money_ledger WHERE business_day = '2040-06-16'`).run();
    db.prepare(`DELETE FROM presales WHERE business_day = '2040-06-16'`).run();
    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id IN (?, ?)`).run(seller1, seller2);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(seller1, seller2);
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
    db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
  });

  test('season payout scheme top3 pays 50/30/20 to the top-3 eligible sellers from the unified season fund', async () => {
    const seasonId = '2041';
    const sellerIds = [93011, 93012, 93013, 93014];
    const pointTotals = [100, 90, 80, 70];

    sellerIds.forEach((sellerId, index) => {
      db.prepare(`
        INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone)
        VALUES (?, ?, 'hash', 'seller', 1, 'center')
      `).run(sellerId, `eligible_top3_${index + 1}`);
    });

    db.prepare(`INSERT OR REPLACE INTO owner_settings (id, settings_json) VALUES (1, ?)`).run(JSON.stringify({
      season_percent: 0.01,
      season_withhold_percent_total: 0.01,
      season_payout_scheme: 'top3',
      seasonStart: '2041-05-01',
      seasonEnd: '2041-10-01',
    }));

    const workingDates = [
      ...Array.from({ length: 31 }, (_, i) => `2041-05-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 30 }, (_, i) => `2041-06-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 14 }, (_, i) => `2041-07-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 20 }, (_, i) => `2041-09-${String(i + 1).padStart(2, '0')}`),
    ];

    sellerIds.forEach((sellerId) => {
      workingDates.forEach((businessDay) => {
        db.prepare(`
          INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
          VALUES (?, ?, 1000)
        `).run(sellerId, businessDay);
      });
      db.prepare(`
        INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
        VALUES (?, '2041-09-25', 1000)
      `).run(sellerId);
    });

    sellerIds.forEach((sellerId, index) => {
      db.prepare(`
        INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
        VALUES ('2041-09-25', ?, 1000, ?)
      `).run(sellerId, pointTotals[index]);
    });

    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Season Top3 Boat', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    const presaleId = db.prepare(`
      INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale)
      VALUES (?, ?, 'Top3', '123', 1, 2700000, '2041-09-25', 'center')
    `).run(sellerIds[0], slotId).lastInsertRowid;
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 2700000, ?, ?, 'POSTED', '2041-09-25', datetime('now'))
    `).run(sellerIds[0], presaleId);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, status, business_day, event_time)
      VALUES ('FUND', 'WITHHOLD_SEASON', 27000, 'POSTED', '2041-09-25', datetime('now'))
    `).run();

    const res = await request(app)
      .get(`/api/owner/motivation/season?season_id=${seasonId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_payout_scheme).toBe('top3');
    expect(res.body.data.season_payout_fund_total).toBe(27000);
    expect(res.body.data.season_pool_from_revenue_total).toBe(27000);
    expect(res.body.meta.season_payout_mode).toBe('eligible_top3_weighted_by_rank');
    expect(res.body.data.season_payout_recipient_count).toBe(3);

    const sellers = res.body.data.sellers || [];
    expect(sellers.map((seller) => seller.user_id)).toEqual(sellerIds);
    expect(sellers.find((seller) => seller.user_id === sellerIds[0])?.season_payout).toBe(13500);
    expect(sellers.find((seller) => seller.user_id === sellerIds[0])?.season_share).toBeCloseTo(0.5, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[1])?.season_payout).toBe(8100);
    expect(sellers.find((seller) => seller.user_id === sellerIds[1])?.season_share).toBeCloseTo(0.3, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[2])?.season_payout).toBe(5400);
    expect(sellers.find((seller) => seller.user_id === sellerIds[2])?.season_share).toBeCloseTo(0.2, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[3])?.season_payout).toBe(0);
    expect(sellers.find((seller) => seller.user_id === sellerIds[3])?.season_payout_recipient).toBe(0);
    expect(res.body.data.season_payouts_sum).toBe(27000);
    expect(res.body.data.season_payouts_remainder).toBe(0);

    db.prepare(`DELETE FROM money_ledger WHERE business_day = '2041-09-25'`).run();
    db.prepare(`DELETE FROM presales WHERE business_day = '2041-09-25'`).run();
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id IN (?, ?, ?, ?)`).run(...sellerIds);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?, ?)`).run(...sellerIds);
    db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
  });

  test('season payout scheme top3 keeps forecast visible by ranking even when only two sellers are qualified', async () => {
    const seasonId = '2042';
    const sellerIds = [93021, 93022, 93023];
    const pointTotals = [200, 150, 500];

    sellerIds.forEach((sellerId, index) => {
      db.prepare(`
        INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone)
        VALUES (?, ?, 'hash', 'seller', 1, 'center')
      `).run(sellerId, `partial_top3_${index + 1}`);
    });

    db.prepare(`INSERT OR REPLACE INTO owner_settings (id, settings_json) VALUES (1, ?)`).run(JSON.stringify({
      season_percent: 0.01,
      season_withhold_percent_total: 0.01,
      season_payout_scheme: 'top3',
      seasonStart: '2042-05-01',
      seasonEnd: '2042-10-01',
    }));

    const seller12WorkingDates = [
      ...Array.from({ length: 31 }, (_, i) => `2042-05-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 30 }, (_, i) => `2042-06-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 14 }, (_, i) => `2042-07-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 20 }, (_, i) => `2042-09-${String(i + 1).padStart(2, '0')}`),
    ];
    const seller3WorkingDates = Array.from({ length: 10 }, (_, i) => `2042-05-${String(i + 1).padStart(2, '0')}`);

    sellerIds.slice(0, 2).forEach((sellerId) => {
      seller12WorkingDates.forEach((businessDay) => {
        db.prepare(`
          INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
          VALUES (?, ?, 1000)
        `).run(sellerId, businessDay);
      });
      db.prepare(`
        INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
        VALUES (?, '2042-09-25', 1000)
      `).run(sellerId);
    });

    seller3WorkingDates.forEach((businessDay) => {
      db.prepare(`
        INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
        VALUES (?, ?, 1000)
      `).run(sellerIds[2], businessDay);
    });

    sellerIds.forEach((sellerId, index) => {
      db.prepare(`
        INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
        VALUES ('2042-09-25', ?, 1000, ?)
      `).run(sellerId, pointTotals[index]);
    });

    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Season Top3 Partial Boat', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    const presaleId = db.prepare(`
      INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale)
      VALUES (?, ?, 'Top3 Partial', '123', 1, 1000100, '2042-09-25', 'center')
    `).run(sellerIds[0], slotId).lastInsertRowid;
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1000100, ?, ?, 'POSTED', '2042-09-25', datetime('now'))
    `).run(sellerIds[0], presaleId);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, status, business_day, event_time)
      VALUES ('FUND', 'WITHHOLD_SEASON', 10001, 'POSTED', '2042-09-25', datetime('now'))
    `).run();

    const res = await request(app)
      .get(`/api/owner/motivation/season?season_id=${seasonId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_payout_scheme).toBe('top3');
    expect(res.body.data.season_payout_recipient_count).toBe(3);
    expect(res.body.data.eligible_count).toBe(2);
    expect(res.body.data.season_payouts_sum).toBe(10001);
    expect(res.body.data.season_payouts_remainder).toBe(0);

    const sellers = res.body.data.sellers || [];
    expect(sellers.find((seller) => seller.user_id === sellerIds[2])?.is_eligible).toBe(0);
    expect(sellers.find((seller) => seller.user_id === sellerIds[2])?.season_payout).toBe(5000.5);
    expect(sellers.find((seller) => seller.user_id === sellerIds[2])?.season_share).toBeCloseTo(0.5, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[2])?.season_payout_recipient).toBe(1);
    expect(sellers.find((seller) => seller.user_id === sellerIds[0])?.is_eligible).toBe(1);
    expect(sellers.find((seller) => seller.user_id === sellerIds[0])?.season_payout).toBe(3000.3);
    expect(sellers.find((seller) => seller.user_id === sellerIds[0])?.season_share).toBeCloseTo(0.3, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[1])?.is_eligible).toBe(1);
    expect(sellers.find((seller) => seller.user_id === sellerIds[1])?.season_payout).toBe(2000.2);
    expect(sellers.find((seller) => seller.user_id === sellerIds[1])?.season_share).toBeCloseTo(0.2, 6);

    db.prepare(`DELETE FROM money_ledger WHERE business_day = '2042-09-25'`).run();
    db.prepare(`DELETE FROM presales WHERE business_day = '2042-09-25'`).run();
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id IN (?, ?, ?)`).run(...sellerIds);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?)`).run(...sellerIds);
    db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
  });

  test('season payout scheme top5 pays 35/25/18/12/10 across the top-5 qualified sellers', async () => {
    const seasonId = '2043';
    const sellerIds = [93031, 93032, 93033, 93034, 93035, 93036];
    const pointTotals = [500, 400, 300, 200, 100, 50];

    sellerIds.forEach((sellerId, index) => {
      db.prepare(`
        INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone)
        VALUES (?, ?, 'hash', 'seller', 1, 'center')
      `).run(sellerId, `eligible_top5_${index + 1}`);
    });

    db.prepare(`INSERT OR REPLACE INTO owner_settings (id, settings_json) VALUES (1, ?)`).run(JSON.stringify({
      season_percent: 0.01,
      season_withhold_percent_total: 0.01,
      season_payout_scheme: 'top5',
      seasonStart: '2043-05-01',
      seasonEnd: '2043-10-01',
    }));

    const workingDates = [
      ...Array.from({ length: 31 }, (_, i) => `2043-05-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 30 }, (_, i) => `2043-06-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 14 }, (_, i) => `2043-07-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 20 }, (_, i) => `2043-09-${String(i + 1).padStart(2, '0')}`),
    ];

    sellerIds.forEach((sellerId) => {
      workingDates.forEach((businessDay) => {
        db.prepare(`
          INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
          VALUES (?, ?, 1000)
        `).run(sellerId, businessDay);
      });
      db.prepare(`
        INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
        VALUES (?, '2043-09-25', 1000)
      `).run(sellerId);
    });

    sellerIds.forEach((sellerId, index) => {
      db.prepare(`
        INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
        VALUES ('2043-09-25', ?, 1000, ?)
      `).run(sellerId, pointTotals[index]);
    });

    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Season Top5 Boat', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    const presaleId = db.prepare(`
      INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale)
      VALUES (?, ?, 'Top5', '123', 1, 1000000, '2043-09-25', 'center')
    `).run(sellerIds[0], slotId).lastInsertRowid;
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1000000, ?, ?, 'POSTED', '2043-09-25', datetime('now'))
    `).run(sellerIds[0], presaleId);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, status, business_day, event_time)
      VALUES ('FUND', 'WITHHOLD_SEASON', 10000, 'POSTED', '2043-09-25', datetime('now'))
    `).run();

    const res = await request(app)
      .get(`/api/owner/motivation/season?season_id=${seasonId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_payout_scheme).toBe('top5');
    expect(res.body.meta.season_payout_mode).toBe('eligible_top5_weighted_by_rank');
    expect(res.body.data.season_payout_recipient_count).toBe(5);
    expect(res.body.data.season_payouts_sum).toBe(10000);
    expect(res.body.data.season_payouts_remainder).toBe(0);

    const sellers = res.body.data.sellers || [];
    expect(sellers.map((seller) => seller.user_id)).toEqual(sellerIds);
    expect(sellers.find((seller) => seller.user_id === sellerIds[0])?.season_payout).toBe(3500);
    expect(sellers.find((seller) => seller.user_id === sellerIds[0])?.season_share).toBeCloseTo(0.35, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[1])?.season_payout).toBe(2500);
    expect(sellers.find((seller) => seller.user_id === sellerIds[1])?.season_share).toBeCloseTo(0.25, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[2])?.season_payout).toBe(1800);
    expect(sellers.find((seller) => seller.user_id === sellerIds[2])?.season_share).toBeCloseTo(0.18, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[3])?.season_payout).toBe(1200);
    expect(sellers.find((seller) => seller.user_id === sellerIds[3])?.season_share).toBeCloseTo(0.12, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[4])?.season_payout).toBe(1000);
    expect(sellers.find((seller) => seller.user_id === sellerIds[4])?.season_share).toBeCloseTo(0.1, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[5])?.season_payout).toBe(0);
    expect(sellers.find((seller) => seller.user_id === sellerIds[5])?.season_payout_recipient).toBe(0);

    db.prepare(`DELETE FROM money_ledger WHERE business_day = '2043-09-25'`).run();
    db.prepare(`DELETE FROM presales WHERE business_day = '2043-09-25'`).run();
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id IN (?, ?, ?, ?, ?, ?)`).run(...sellerIds);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?, ?, ?, ?)`).run(...sellerIds);
    db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
  });

  test('season payout scheme top5 keeps forecast visible by ranking even when only four sellers are qualified', async () => {
    const seasonId = '2044';
    const sellerIds = [93041, 93042, 93043, 93044, 93045];
    const pointTotals = [400, 300, 200, 100, 500];

    sellerIds.forEach((sellerId, index) => {
      db.prepare(`
        INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone)
        VALUES (?, ?, 'hash', 'seller', 1, 'center')
      `).run(sellerId, `partial_top5_${index + 1}`);
    });

    db.prepare(`INSERT OR REPLACE INTO owner_settings (id, settings_json) VALUES (1, ?)`).run(JSON.stringify({
      season_percent: 0.01,
      season_withhold_percent_total: 0.01,
      season_payout_scheme: 'top5',
      seasonStart: '2044-05-01',
      seasonEnd: '2044-10-01',
    }));

    const seller1234WorkingDates = [
      ...Array.from({ length: 31 }, (_, i) => `2044-05-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 30 }, (_, i) => `2044-06-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 14 }, (_, i) => `2044-07-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 20 }, (_, i) => `2044-09-${String(i + 1).padStart(2, '0')}`),
    ];
    const seller5WorkingDates = Array.from({ length: 15 }, (_, i) => `2044-05-${String(i + 1).padStart(2, '0')}`);

    sellerIds.slice(0, 4).forEach((sellerId) => {
      seller1234WorkingDates.forEach((businessDay) => {
        db.prepare(`
          INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
          VALUES (?, ?, 1000)
        `).run(sellerId, businessDay);
      });
      db.prepare(`
        INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
        VALUES (?, '2044-09-25', 1000)
      `).run(sellerId);
    });

    seller5WorkingDates.forEach((businessDay) => {
      db.prepare(`
        INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day)
        VALUES (?, ?, 1000)
      `).run(sellerIds[4], businessDay);
    });

    sellerIds.forEach((sellerId, index) => {
      db.prepare(`
        INSERT OR REPLACE INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
        VALUES ('2044-09-25', ?, 1000, ?)
      `).run(sellerId, pointTotals[index]);
    });

    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Season Top5 Partial Boat', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    const presaleId = db.prepare(`
      INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale)
      VALUES (?, ?, 'Top5 Partial', '123', 1, 1000000, '2044-09-25', 'center')
    `).run(sellerIds[0], slotId).lastInsertRowid;
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1000000, ?, ?, 'POSTED', '2044-09-25', datetime('now'))
    `).run(sellerIds[0], presaleId);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, status, business_day, event_time)
      VALUES ('FUND', 'WITHHOLD_SEASON', 10000, 'POSTED', '2044-09-25', datetime('now'))
    `).run();

    const res = await request(app)
      .get(`/api/owner/motivation/season?season_id=${seasonId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_payout_scheme).toBe('top5');
    expect(res.body.data.season_payout_recipient_count).toBe(5);
    expect(res.body.data.eligible_count).toBe(4);
    expect(res.body.data.season_payouts_sum).toBe(10000);
    expect(res.body.data.season_payouts_remainder).toBe(0);

    const sellers = res.body.data.sellers || [];
    expect(sellers.find((seller) => seller.user_id === sellerIds[4])?.is_eligible).toBe(0);
    expect(sellers.find((seller) => seller.user_id === sellerIds[4])?.season_payout).toBe(3500);
    expect(sellers.find((seller) => seller.user_id === sellerIds[4])?.season_share).toBeCloseTo(0.35, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[4])?.season_payout_recipient).toBe(1);
    expect(sellers.find((seller) => seller.user_id === sellerIds[0])?.season_payout).toBe(2500);
    expect(sellers.find((seller) => seller.user_id === sellerIds[0])?.season_share).toBeCloseTo(0.25, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[1])?.season_payout).toBe(1800);
    expect(sellers.find((seller) => seller.user_id === sellerIds[1])?.season_share).toBeCloseTo(0.18, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[2])?.season_payout).toBe(1200);
    expect(sellers.find((seller) => seller.user_id === sellerIds[2])?.season_share).toBeCloseTo(0.12, 6);
    expect(sellers.find((seller) => seller.user_id === sellerIds[3])?.season_payout).toBe(1000);
    expect(sellers.find((seller) => seller.user_id === sellerIds[3])?.season_share).toBeCloseTo(0.1, 6);

    db.prepare(`DELETE FROM money_ledger WHERE business_day = '2044-09-25'`).run();
    db.prepare(`DELETE FROM presales WHERE business_day = '2044-09-25'`).run();
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id IN (?, ?, ?, ?, ?)`).run(...sellerIds);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?, ?, ?)`).run(...sellerIds);
    db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
  });
});
