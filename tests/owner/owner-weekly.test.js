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
    expect(res.body.data.season_from).toBe('2026-01-01');
    expect(res.body.data.season_to).toBe('2026-12-31');
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

  test('dispatcher with sales revenue gets daily bonus', async () => {
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
    
    // T = 100000 (50000 + 50000), bonus = floor(T * 0.001) = floor(100) = 100
    const expectedBonus = 100;
    expect(res.body.data.dispatcher_daily_bonus_total).toBe(expectedBonus);
    
    // Find dispatcher in payouts - dispatcher sold tickets so has personal_revenue_day
    const dispatcherPayout = res.body.data.payouts.find(p => p.user_id === dispatcherId);
    expect(dispatcherPayout).toBeDefined();
    expect(dispatcherPayout.dispatcher_daily_bonus).toBe(expectedBonus);
    expect(dispatcherPayout.personal_revenue_day).toBe(50000);
    
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
    const seasonId = '2026';
    const sellerId = 92001;
    
    // Create seller
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'eligible_seller', 'hash', 'seller', 1, 'center')`).run(sellerId);
    
    // Create 75 worked days in season (Jan-Mar)
    for (let day = 1; day <= 75; day++) {
      const date = `2026-01-${String(day).padStart(2, '0')}`;
      try {
        db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(sellerId, date);
      } catch (e) { /* ignore date overflow */ }
    }
    // Use Feb for remaining days
    for (let day = 1; day <= 10; day++) {
      const date = `2026-02-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(sellerId, date);
    }
    
    // Create 20 worked days in September (including 1 in end-sep window)
    for (let day = 1; day <= 19; day++) {
      const date = `2026-09-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(sellerId, date);
    }
    // Add 1 day in end-sep window (Sep 25)
    db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(sellerId, '2026-09-25');
    
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
  });

  test('seller with insufficient days is not eligible', async () => {
    const seasonId = '2026';
    const sellerId = 92002;
    
    // Create seller
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'not_eligible_seller', 'hash', 'seller', 1, 'center')`).run(sellerId);
    
    // Only 50 days in season, 10 in sep, 0 in end-sep window
    for (let day = 1; day <= 50; day++) {
      const date = `2026-02-${String(day).padStart(2, '0')}`;
      try {
        db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(sellerId, date);
      } catch (e) { /* ignore */ }
    }
    for (let day = 1; day <= 10; day++) {
      const date = `2026-09-${String(day).padStart(2, '0')}`;
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

  test('season payout is proportional to points for eligible sellers', async () => {
    const seasonId = '2026';
    const seller1 = 93001;
    const seller2 = 93002;
    
    // Create sellers
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'eligible_seller1', 'hash', 'seller', 1, 'center')`).run(seller1);
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'eligible_seller2', 'hash', 'seller', 1, 'center')`).run(seller2);
    
    // Create season stats with points
    db.prepare(`INSERT OR IGNORE INTO seller_season_stats (seller_id, season_id, revenue_total, points_total) VALUES (?, ?, ?, ?)`).run(seller1, seasonId, 1000000, 100000);
    db.prepare(`INSERT OR IGNORE INTO seller_season_stats (seller_id, season_id, revenue_total, points_total) VALUES (?, ?, ?, ?)`).run(seller2, seasonId, 500000, 50000);
    
    // Make both eligible (75+ season days, 20+ sep days, 1+ end-sep day)
    for (let day = 1; day <= 75; day++) {
      const date = `2026-01-${String(day).padStart(2, '0')}`;
      try {
        db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, date);
        db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller2, date);
      } catch (e) {}
    }
    for (let day = 1; day <= 20; day++) {
      const date = `2026-09-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, date);
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller2, date);
    }
    // Add end-sep window day
    db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, '2026-09-25');
    db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller2, '2026-09-26');
    
    // Create boat and slot for money_ledger
    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Season Test Boat', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    
    // Create revenue in money_ledger for season_pool_total
    // With season_percent=0.01, revenue=1500000 => pool=15000
    // Set season_percent in owner_settings
    db.prepare(`INSERT OR REPLACE INTO owner_settings (id, settings_json) VALUES (1, ?)`).run(JSON.stringify({ season_percent: 0.01 }));
    
    const presaleId = db.prepare(`INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale) VALUES (?, ?, 'Test', '123', 1, 1500000, '2026-06-15', 'center')`).run(seller1, slotId).lastInsertRowid;
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1500000, ?, ?, 'POSTED', '2026-06-15', datetime('now'))
    `).run(seller1, presaleId);
    
    // Call season endpoint
    const res = await request(app)
      .get(`/api/owner/motivation/season?season_id=${seasonId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_percent).toBe(0.01);
    expect(res.body.data.season_pool_total).toBe(15000);
    expect(res.body.data.eligible_count).toBe(2);
    expect(res.body.data.sum_points_eligible).toBe(150000);
    
    const s1 = res.body.data.sellers.find(s => s.user_id === seller1);
    const s2 = res.body.data.sellers.find(s => s.user_id === seller2);
    
    expect(s1.is_eligible).toBe(1);
    expect(s2.is_eligible).toBe(1);
    
    // seller1: 100000/150000 * 15000 = 10000 -> roundDownTo50 = 10000
    // seller2: 50000/150000 * 15000 = 5000 -> roundDownTo50 = 5000
    expect(s1.season_payout).toBe(10000);
    expect(s2.season_payout).toBe(5000);
    expect(s1.season_share).toBeCloseTo(0.666667, 4);
    expect(s2.season_share).toBeCloseTo(0.333333, 4);
    
    // Remainder should be 0 (both payouts are exact multiples of 50)
    expect(res.body.data.season_payouts_sum).toBe(15000);
    expect(res.body.data.season_payouts_remainder).toBe(0);
    
    // Cleanup
    db.prepare(`DELETE FROM money_ledger WHERE business_day = '2026-06-15'`).run();
    db.prepare(`DELETE FROM presales WHERE business_day = '2026-06-15'`).run();
    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id IN (?, ?)`).run(seller1, seller2);
    db.prepare(`DELETE FROM seller_season_stats WHERE seller_id IN (?, ?)`).run(seller1, seller2);
    db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(seller1, seller2);
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
    db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
  });

  test('season payout with rounding remainder', async () => {
    const seasonId = '2026';
    const seller1 = 93003;
    
    // Create seller
    db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active, zone) VALUES (?, 'eligible_seller3', 'hash', 'seller', 1, 'center')`).run(seller1);
    
    // Create season stats with points
    db.prepare(`INSERT OR IGNORE INTO seller_season_stats (seller_id, season_id, revenue_total, points_total) VALUES (?, ?, ?, ?)`).run(seller1, seasonId, 1000000, 100000);
    
    // Make eligible
    for (let day = 1; day <= 75; day++) {
      const date = `2026-01-${String(day).padStart(2, '0')}`;
      try {
        db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, date);
      } catch (e) {}
    }
    for (let day = 1; day <= 20; day++) {
      const date = `2026-09-${String(day).padStart(2, '0')}`;
      db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, date);
    }
    db.prepare(`INSERT OR IGNORE INTO seller_day_stats (seller_id, business_day, revenue_day) VALUES (?, ?, 1000)`).run(seller1, '2026-09-25');
    
    // Create boat and slot
    const boatId = db.prepare(`INSERT INTO boats (name, type) VALUES ('Season Test Boat 2', 'speed')`).run().lastInsertRowid;
    const slotId = db.prepare(`INSERT INTO boat_slots (boat_id, time, capacity, seats_left) VALUES (?, '10:00', 10, 10)`).run(boatId).lastInsertRowid;
    
    // Set season_percent to create remainder: revenue=1504900 => pool=15049
    // With 1 eligible seller with 100000 points: payout = 15049 -> roundDownTo50 = 15000, remainder = 49
    db.prepare(`INSERT OR REPLACE INTO owner_settings (id, settings_json) VALUES (1, ?)`).run(JSON.stringify({ season_percent: 0.01 }));
    
    const presaleId = db.prepare(`INSERT INTO presales (seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats, total_price, business_day, zone_at_sale) VALUES (?, ?, 'Test', '123', 1, 1504900, '2026-06-16', 'center')`).run(seller1, slotId).lastInsertRowid;
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, presale_id, status, business_day, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1504900, ?, ?, 'POSTED', '2026-06-16', datetime('now'))
    `).run(seller1, presaleId);
    
    const res = await request(app)
      .get(`/api/owner/motivation/season?season_id=${seasonId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.season_pool_total).toBe(15049);
    expect(res.body.data.eligible_count).toBe(1);
    
    const s1 = res.body.data.sellers.find(s => s.user_id === seller1);
    expect(s1.season_payout).toBe(15000);
    expect(res.body.data.season_payouts_sum).toBe(15000);
    expect(res.body.data.season_payouts_remainder).toBe(49);
    
    // Cleanup
    db.prepare(`DELETE FROM money_ledger WHERE business_day = '2026-06-16'`).run();
    db.prepare(`DELETE FROM presales WHERE business_day = '2026-06-16'`).run();
    db.prepare(`DELETE FROM seller_day_stats WHERE seller_id = ?`).run(seller1);
    db.prepare(`DELETE FROM seller_season_stats WHERE seller_id = ?`).run(seller1);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(seller1);
    db.prepare(`DELETE FROM boat_slots WHERE boat_id = ?`).run(boatId);
    db.prepare(`DELETE FROM boats WHERE id = ?`).run(boatId);
    db.prepare(`UPDATE owner_settings SET settings_json = '{}' WHERE id = 1`).run();
  });
});
