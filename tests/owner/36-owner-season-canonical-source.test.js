import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app;
let db;
let ownerToken;

function insertPresale({ sellerId, boatSlotId, totalPrice, businessDay, zoneAtSale = null }) {
  return db.prepare(`
    INSERT INTO presales (
      seller_id,
      boat_slot_id,
      customer_name,
      customer_phone,
      number_of_seats,
      total_price,
      status,
      business_day,
      zone_at_sale
    )
    VALUES (?, ?, 'Season Canon', '123', 1, ?, 'ACTIVE', ?, ?)
  `).run(sellerId, boatSlotId, totalPrice, businessDay, zoneAtSale).lastInsertRowid;
}

function insertSaleLedger({ sellerId, presaleId, amount, businessDay, method = 'CASH' }) {
  db.prepare(`
    INSERT INTO money_ledger (
      presale_id,
      seller_id,
      kind,
      type,
      method,
      amount,
      status,
      business_day,
      event_time
    )
    VALUES (?, ?, 'SELLER_SHIFT', 'SALE_PREPAYMENT_CASH', ?, ?, 'POSTED', ?, datetime('now'))
  `).run(presaleId, sellerId, method, amount, businessDay);
}

function insertCanonicalSale({ presaleId, slotId, boatId, amount, businessDay }) {
  db.prepare(`
    INSERT INTO sales_transactions_canonical (
      presale_id,
      slot_id,
      boat_id,
      amount,
      cash_amount,
      card_amount,
      status,
      business_day,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, 0, 'VALID', ?, datetime('now'))
  `).run(presaleId, slotId, boatId, amount, amount, businessDay);
}

function insertTicket({ presaleId, boatSlotId, code, price, status = 'ACTIVE' }) {
  db.prepare(`
    INSERT INTO tickets (
      presale_id,
      boat_slot_id,
      ticket_code,
      status,
      price
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(presaleId, boatSlotId, code, status, price);
}

describe('OWNER SEASON CANONICAL SOURCE', () => {
  beforeAll(async () => {
    resetTestDb();
    app = await makeApp();
    db = getTestDb();

    const passwordHash = bcrypt.hashSync('password123', 10);
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active)
      VALUES (5000, 'owner_season_canonical', ?, 'owner', 1)
    `).run(passwordHash);

    ownerToken = jwt.sign(
      { id: 5000, username: 'owner_season_canonical', role: 'owner' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
  });

  beforeEach(() => {
    db.prepare(`DELETE FROM tickets`).run();
    db.prepare(`DELETE FROM presales`).run();
    db.prepare(`DELETE FROM boat_slots`).run();
    db.prepare(`DELETE FROM boats`).run();
    db.prepare(`DELETE FROM money_ledger`).run();
    db.prepare(`DELETE FROM seller_day_stats`).run();
    db.prepare(`DELETE FROM seller_season_stats`).run();
    db.prepare(`DELETE FROM seller_season_applied_days`).run();
    db.prepare(`DELETE FROM sales_transactions_canonical`).run();
    db.prepare(`DELETE FROM motivation_day_settings`).run();
    db.prepare(`DELETE FROM shift_closures`).run();
    db.prepare(`DELETE FROM users WHERE id IN (5101, 5102, 5103)`).run();

    db.prepare(`
      UPDATE owner_settings
      SET settings_json = ?
      WHERE id = 1
    `).run(JSON.stringify({
      motivationType: 'adaptive',
      motivation_percent: 0.15,
      weekly_percent: 0.01,
      season_percent: 0.02,
      weekly_withhold_percent_total: 0.008,
      season_withhold_percent_total: 0.005,
      dispatcher_withhold_percent_total: 0.002,
      seasonStart: '2026-01-01',
      seasonEnd: '2026-12-01',
      season_start_mmdd: '01-01',
      season_end_mmdd: '12-01',
      k_speed: 1.2,
      k_cruise: 3,
      k_zone_center: 1,
      k_zone_hedgehog: 1.3,
      k_zone_sanatorium: 0.8,
      k_zone_stationary: 0.7,
      k_banana_hedgehog: 2.7,
      k_banana_center: 2.2,
      k_banana_sanatorium: 1.2,
      k_banana_stationary: 1,
    }));
  });

  it('prefers seller-only canonical day logic for season cards and ranking while keeping dispatcher transfers on ledger', async () => {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active, zone)
      VALUES
        (5101, 'season_seller_alpha', 'hash', 'seller', 1, 'center'),
        (5102, 'season_seller_beta', 'hash', 'seller', 1, 'hedgehog'),
        (5103, 'season_dispatcher', 'hash', 'dispatcher', 1, 'center')
    `).run();

    const speedBoatId = db.prepare(`
      INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
      VALUES ('Season Canon Speed', 'speed', 1, 1000, 500, 750)
    `).run().lastInsertRowid;
    const bananaBoatId = db.prepare(`
      INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
      VALUES ('Season Canon Banana', 'banana', 1, 1000, 500, 750)
    `).run().lastInsertRowid;

    const speedSlotDay1 = db.prepare(`
      INSERT INTO boat_slots (
        boat_id, time, price, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, trip_date, is_active, seller_cutoff_minutes
      )
      VALUES (?, '10:00', 1000, 20, 20, 1000, 500, 750, 60, '2026-04-02', 1, 30)
    `).run(speedBoatId).lastInsertRowid;
    const bananaSlotDay1 = db.prepare(`
      INSERT INTO boat_slots (
        boat_id, time, price, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, trip_date, is_active, seller_cutoff_minutes
      )
      VALUES (?, '11:00', 1000, 20, 20, 1000, 500, 750, 60, '2026-04-02', 1, 30)
    `).run(bananaBoatId).lastInsertRowid;
    const speedSlotDay2 = db.prepare(`
      INSERT INTO boat_slots (
        boat_id, time, price, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, trip_date, is_active, seller_cutoff_minutes
      )
      VALUES (?, '12:00', 1000, 20, 20, 1000, 500, 750, 60, '2026-04-03', 1, 30)
    `).run(speedBoatId).lastInsertRowid;

    const presaleAlphaDay1 = insertPresale({
      sellerId: 5101,
      boatSlotId: speedSlotDay1,
      totalPrice: 30000,
      businessDay: '2026-04-02',
      zoneAtSale: 'center',
    });
    const presaleBetaDay1 = insertPresale({
      sellerId: 5102,
      boatSlotId: bananaSlotDay1,
      totalPrice: 26400,
      businessDay: '2026-04-02',
      zoneAtSale: 'hedgehog',
    });
    const presaleAlphaDay2 = insertPresale({
      sellerId: 5101,
      boatSlotId: speedSlotDay2,
      totalPrice: 30000,
      businessDay: '2026-04-03',
      zoneAtSale: 'center',
    });

    insertSaleLedger({ sellerId: 5101, presaleId: presaleAlphaDay1, amount: 30000, businessDay: '2026-04-02' });
    insertSaleLedger({ sellerId: 5102, presaleId: presaleBetaDay1, amount: 26400, businessDay: '2026-04-02' });
    insertSaleLedger({ sellerId: 5101, presaleId: presaleAlphaDay2, amount: 30000, businessDay: '2026-04-03' });
    insertCanonicalSale({ presaleId: presaleAlphaDay1, slotId: speedSlotDay1, boatId: speedBoatId, amount: 30000, businessDay: '2026-04-02' });
    insertCanonicalSale({ presaleId: presaleBetaDay1, slotId: bananaSlotDay1, boatId: bananaBoatId, amount: 26400, businessDay: '2026-04-02' });
    insertCanonicalSale({ presaleId: presaleAlphaDay2, slotId: speedSlotDay2, boatId: speedBoatId, amount: 30000, businessDay: '2026-04-03' });

    db.prepare(`
      INSERT INTO money_ledger (kind, type, method, amount, status, business_day, event_time, decision_final)
      VALUES ('FUND', 'SEASON_PREPAY_DELETE', 'INTERNAL', 1000, 'POSTED', '2026-04-02', datetime('now'), 1)
    `).run();

    expect(db.prepare(`SELECT COUNT(*) AS c FROM seller_day_stats`).get().c).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS c FROM seller_season_stats`).get().c).toBe(0);
    expect(db.prepare(`
      SELECT COUNT(*) AS c
      FROM money_ledger
      WHERE kind = 'FUND' AND type = 'WITHHOLD_SEASON'
    `).get().c).toBe(0);

    const day2Res = await request(app)
      .get('/api/owner/motivation/day?day=2026-04-02')
      .set('Authorization', `Bearer ${ownerToken}`);
    const day3Res = await request(app)
      .get('/api/owner/motivation/day?day=2026-04-03')
      .set('Authorization', `Bearer ${ownerToken}`);
    const seasonRes = await request(app)
      .get('/api/owner/motivation/season?season_id=2026')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(day2Res.status).toBe(200);
    expect(day3Res.status).toBe(200);
    expect(seasonRes.status).toBe(200);
    expect(seasonRes.body.ok).toBe(true);
    expect(seasonRes.body.meta.season_stats_source).toBe('seller_only_motivation_day_canonical');

    const dayResponses = [day2Res.body.data, day3Res.body.data];
    const expectedSeasonFromRevenueTotal = dayResponses.reduce(
      (sum, day) => sum + Number(day?.withhold?.season_amount_base ?? day?.withhold?.season_from_revenue ?? day?.withhold?.season_amount ?? 0),
      0
    );
    const expectedRoundingTotal = dayResponses.reduce(
      (sum, day) => sum + Number(day?.withhold?.rounding_to_season_amount_total ?? 0),
      0
    );
    const expectedRankingMap = new Map();

    for (const day of dayResponses) {
      for (const row of (Array.isArray(day?.payouts) ? day.payouts : [])) {
        if (String(row?.role || '') !== 'seller') continue;
        const sellerId = Number(row?.user_id);
        if (!Number.isFinite(sellerId) || sellerId <= 0) continue;
        const existing = expectedRankingMap.get(sellerId) || {
          user_id: sellerId,
          name: row?.name || `User ${sellerId}`,
          zone: row?.zone ?? null,
          revenue_total: 0,
          points_total: 0,
        };
        existing.name = row?.name || existing.name;
        existing.zone = row?.zone ?? existing.zone ?? null;
        existing.revenue_total += Number(row?.personal_revenue_day ?? row?.revenue ?? 0);
        existing.points_total += Number(row?.points_total ?? 0);
        expectedRankingMap.set(sellerId, existing);
      }
    }

    const expectedRanking = [...expectedRankingMap.values()].sort((a, b) => {
      if (b.points_total !== a.points_total) return b.points_total - a.points_total;
      if (b.revenue_total !== a.revenue_total) return b.revenue_total - a.revenue_total;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    expect(Number(seasonRes.body.data.season_pool_total_current || 0)).toBeCloseTo(expectedSeasonFromRevenueTotal, 6);
    expect(Number(seasonRes.body.data.season_pool_from_revenue_total || 0)).toBeCloseTo(expectedSeasonFromRevenueTotal, 6);
    expect(Number(seasonRes.body.data.season_pool_rounding_total || 0)).toBeCloseTo(expectedRoundingTotal, 6);
    expect(Number(seasonRes.body.data.season_pool_dispatcher_decision_total || 0)).toBe(1000);
    expect(Number(seasonRes.body.data.season_pool_manual_transfer_total || 0)).toBe(1000);
    expect(Number(seasonRes.body.data.season_pool_total_ledger || 0)).toBe(1000);
    expect(Number(seasonRes.body.data.season_pool_total_daily_sum || 0)).toBe(1000);

    const sellers = Array.isArray(seasonRes.body.data.sellers) ? seasonRes.body.data.sellers : [];
    expect(sellers.length).toBe(expectedRanking.length);
    expect(sellers.map((seller) => Number(seller.user_id))).toEqual(expectedRanking.map((seller) => Number(seller.user_id)));
    expect(sellers.find((seller) => Number(seller.user_id) === 5103)).toBeUndefined();

    for (const seller of sellers) {
      const expectedSeller = expectedRanking.find((row) => Number(row.user_id) === Number(seller.user_id));
      expect(expectedSeller).toBeDefined();
      expect(Number(seller.points_total || 0)).toBeCloseTo(Number(expectedSeller.points_total || 0), 6);
      expect(Number(seller.revenue_total || 0)).toBeCloseTo(Number(expectedSeller.revenue_total || 0), 6);
    }
  });

  it('ignores orphan seller ledger rows when season ranking is built from canonical valid rows', async () => {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active, zone)
      VALUES
        (5101, 'season_orphan_ok', 'hash', 'seller', 1, 'center'),
        (5102, 'season_orphan_ignored', 'hash', 'seller', 1, 'hedgehog')
    `).run();

    const speedBoatId = db.prepare(`
      INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
      VALUES ('Season Orphan Boat', 'speed', 1, 1000, 500, 750)
    `).run().lastInsertRowid;
    const speedSlotId = db.prepare(`
      INSERT INTO boat_slots (
        boat_id, time, price, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, trip_date, is_active, seller_cutoff_minutes
      )
      VALUES (?, '09:00', 1000, 20, 20, 1000, 500, 750, 60, '2026-04-02', 1, 30)
    `).run(speedBoatId).lastInsertRowid;

    const goodPresaleId = insertPresale({
      sellerId: 5101,
      boatSlotId: speedSlotId,
      totalPrice: 15000,
      businessDay: '2026-04-02',
      zoneAtSale: 'center',
    });

    insertSaleLedger({ sellerId: 5101, presaleId: goodPresaleId, amount: 15000, businessDay: '2026-04-02' });
    insertCanonicalSale({ presaleId: goodPresaleId, slotId: speedSlotId, boatId: speedBoatId, amount: 15000, businessDay: '2026-04-02' });

    db.prepare(`
      INSERT INTO money_ledger (
        presale_id,
        seller_id,
        kind,
        type,
        method,
        amount,
        status,
        business_day,
        event_time
      )
      VALUES (999999, 5102, 'SELLER_SHIFT', 'SALE_PREPAYMENT_CASH', 'CASH', 90000, 'POSTED', '2026-04-02', datetime('now'))
    `).run();

    const seasonRes = await request(app)
      .get('/api/owner/motivation/season?season_id=2026')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(seasonRes.status).toBe(200);
    expect(seasonRes.body.ok).toBe(true);
    expect(seasonRes.body.meta.season_stats_source).toBe('seller_only_motivation_day_canonical');

    const sellers = Array.isArray(seasonRes.body.data.sellers) ? seasonRes.body.data.sellers : [];
    expect(sellers.map((seller) => Number(seller.user_id))).toEqual([5101]);
    expect(sellers[0].name).toBe('season_orphan_ok');
    expect(Number(sellers[0].points_total || 0)).toBeCloseTo(18, 6);
    expect(Number(sellers[0].revenue_total || 0)).toBeCloseTo(15000, 6);
    expect(sellers.find((seller) => Number(seller.user_id) === 5102)).toBeUndefined();
  });

  it('uses canonical presale revenue for season points instead of raw canonical payment amount', async () => {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active, zone)
      VALUES (5101, 'season_ticket_value', 'hash', 'seller', 1, 'center')
    `).run();

    const speedBoatId = db.prepare(`
      INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
      VALUES ('Season Ticket Value Boat', 'speed', 1, 1000, 500, 750)
    `).run().lastInsertRowid;
    const speedSlotId = db.prepare(`
      INSERT INTO boat_slots (
        boat_id, time, price, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, trip_date, is_active, seller_cutoff_minutes
      )
      VALUES (?, '13:00', 1000, 20, 20, 1000, 500, 750, 60, '2026-04-02', 1, 30)
    `).run(speedBoatId).lastInsertRowid;

    const presaleId = insertPresale({
      sellerId: 5101,
      boatSlotId: speedSlotId,
      totalPrice: 10000,
      businessDay: '2026-04-02',
      zoneAtSale: 'center',
    });

    insertTicket({ presaleId, boatSlotId: speedSlotId, code: 'T-1', price: 4000 });
    insertTicket({ presaleId, boatSlotId: speedSlotId, code: 'T-2', price: 6000 });
    insertSaleLedger({ sellerId: 5101, presaleId, amount: 4000, businessDay: '2026-04-02' });
    insertCanonicalSale({ presaleId, slotId: speedSlotId, boatId: speedBoatId, amount: 4000, businessDay: '2026-04-02' });

    const seasonRes = await request(app)
      .get('/api/owner/motivation/season?season_id=2026')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(seasonRes.status).toBe(200);
    expect(seasonRes.body.ok).toBe(true);
    expect(seasonRes.body.meta.season_stats_source).toBe('seller_only_motivation_day_canonical');

    const sellers = Array.isArray(seasonRes.body.data.sellers) ? seasonRes.body.data.sellers : [];
    expect(sellers).toHaveLength(1);
    expect(Number(sellers[0].revenue_total || 0)).toBeCloseTo(10000, 6);
    expect(Number(sellers[0].points_total || 0)).toBeCloseTo(12, 6);
  });

  it('includes canonical valid sales days in season snapshot even when seller sale ledger rows are absent', async () => {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active, zone)
      VALUES (5101, 'season_canonical_day_only', 'hash', 'seller', 1, 'center')
    `).run();

    const speedBoatId = db.prepare(`
      INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
      VALUES ('Season Canon Day Boat', 'speed', 1, 1000, 500, 750)
    `).run().lastInsertRowid;
    const speedSlotId = db.prepare(`
      INSERT INTO boat_slots (
        boat_id, time, price, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, trip_date, is_active, seller_cutoff_minutes
      )
      VALUES (?, '14:00', 1000, 20, 20, 1000, 500, 750, 60, '2026-04-02', 1, 30)
    `).run(speedBoatId).lastInsertRowid;

    const presaleId = insertPresale({
      sellerId: 5101,
      boatSlotId: speedSlotId,
      totalPrice: 15000,
      businessDay: '2026-04-02',
      zoneAtSale: 'center',
    });

    insertCanonicalSale({ presaleId, slotId: speedSlotId, boatId: speedBoatId, amount: 15000, businessDay: '2026-04-02' });

    const seasonRes = await request(app)
      .get('/api/owner/motivation/season?season_id=2026')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(seasonRes.status).toBe(200);
    expect(seasonRes.body.ok).toBe(true);

    const sellers = Array.isArray(seasonRes.body.data.sellers) ? seasonRes.body.data.sellers : [];
    expect(sellers).toHaveLength(1);
    expect(Number(sellers[0].revenue_total || 0)).toBeCloseTo(15000, 6);
    expect(Number(sellers[0].points_total || 0)).toBeCloseTo(18, 6);
  });
});
