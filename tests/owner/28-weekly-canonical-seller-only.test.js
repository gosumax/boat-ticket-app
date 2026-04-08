import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';
const WEEK_ID = '2026-W14';

let app;
let db;
let ownerToken;

function insertPresale({ sellerId, boatSlotId, totalPrice, businessDay, zoneAtSale }) {
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
    VALUES (?, ?, 'Weekly Test', '123', 1, ?, 'ACTIVE', ?, ?)
  `).run(sellerId, boatSlotId, totalPrice, businessDay, zoneAtSale ?? null).lastInsertRowid;
}

describe('OWNER WEEKLY CANONICAL SELLER-ONLY', () => {
  beforeAll(async () => {
    resetTestDb();
    app = await makeApp();
    db = getTestDb();

    const passwordHash = bcrypt.hashSync('password123', 10);
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active)
      VALUES (1000, 'owner_weekly_canonical', ?, 'owner', 1)
    `).run(passwordHash);

    ownerToken = jwt.sign(
      { id: 1000, username: 'owner_weekly_canonical', role: 'owner' },
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
    db.prepare(`DELETE FROM users WHERE id IN (4, 7, 12, 13, 14)`).run();
    db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
      weekly_percent: 0.01,
      k_speed: 1.2,
      k_cruise: 3,
      k_zone_hedgehog: 1.3,
      k_zone_center: 1,
      k_zone_sanatorium: 0.8,
      k_zone_stationary: 0.7,
      k_banana_hedgehog: 2.7,
      k_banana_center: 2.2,
      k_banana_sanatorium: 1.2,
      k_banana_stationary: 1,
    }));
  });

  it('builds weekly ranking from seller-only canonical weekly base and keeps top-3 payouts aligned', async () => {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active, zone)
      VALUES
        (4, '1', 'hash', 'seller', 1, 'center'),
        (7, 'maxim', 'hash', 'seller', 1, 'center'),
        (12, 'dispatcher12', 'hash', 'dispatcher', 1, 'center'),
        (13, 'seller', 'hash', 'seller', 1, 'hedgehog')
    `).run();

    const speedBoatId = db.prepare(`
      INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
      VALUES ('Weekly Speed', 'speed', 1, 1000, 500, 750)
    `).run().lastInsertRowid;
    const cruiseBoatId = db.prepare(`
      INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
      VALUES ('Weekly Cruise', 'cruise', 1, 1000, 500, 750)
    `).run().lastInsertRowid;
    const bananaBoatId = db.prepare(`
      INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
      VALUES ('Weekly Banana', 'banana', 1, 1000, 500, 750)
    `).run().lastInsertRowid;

    const speedSlotId = db.prepare(`
      INSERT INTO boat_slots (
        boat_id, time, price, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, trip_date, is_active, seller_cutoff_minutes
      )
      VALUES (?, '10:00', 1000, 20, 20, 1000, 500, 750, 60, '2026-03-30', 1, 30)
    `).run(speedBoatId).lastInsertRowid;
    const cruiseSlotId = db.prepare(`
      INSERT INTO boat_slots (
        boat_id, time, price, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, trip_date, is_active, seller_cutoff_minutes
      )
      VALUES (?, '11:00', 1000, 20, 20, 1000, 500, 750, 60, '2026-03-31', 1, 30)
    `).run(cruiseBoatId).lastInsertRowid;
    const bananaSlotId = db.prepare(`
      INSERT INTO boat_slots (
        boat_id, time, price, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, trip_date, is_active, seller_cutoff_minutes
      )
      VALUES (?, '12:00', 1000, 20, 20, 1000, 500, 750, 60, '2026-04-01', 1, 30)
    `).run(bananaBoatId).lastInsertRowid;

    insertPresale({ sellerId: 13, boatSlotId: cruiseSlotId, totalPrice: 29000, businessDay: '2026-03-30', zoneAtSale: null });
    insertPresale({ sellerId: 13, boatSlotId: speedSlotId, totalPrice: 28000, businessDay: '2026-03-31', zoneAtSale: null });
    insertPresale({ sellerId: 13, boatSlotId: bananaSlotId, totalPrice: 2400, businessDay: '2026-04-01', zoneAtSale: null });

    insertPresale({ sellerId: 7, boatSlotId: speedSlotId, totalPrice: 65000, businessDay: '2026-04-02', zoneAtSale: 'center' });

    insertPresale({ sellerId: 4, boatSlotId: cruiseSlotId, totalPrice: 9000, businessDay: '2026-04-03', zoneAtSale: null });
    insertPresale({ sellerId: 4, boatSlotId: speedSlotId, totalPrice: 27000, businessDay: '2026-04-04', zoneAtSale: null });

    insertPresale({ sellerId: 12, boatSlotId: speedSlotId, totalPrice: 99900, businessDay: '2026-04-05', zoneAtSale: 'center' });

    const res = await request(app)
      .get(`/api/owner/motivation/weekly?week=${WEEK_ID}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { data, meta } = res.body;
    expect(meta.ranking_source).toBe('seller_only_weekly_canonical_presales');
    expect(meta.payout_schedule).toBe('sunday_top3_by_points');

    expect(data.date_from).toBe('2026-03-30');
    expect(data.date_to).toBe('2026-04-05');
    expect(data.revenue_total_week).toBe(160400);
    expect(data.weekly_pool_total).toBe(1604);
    expect(data.weekly_pool_total_current).toBe(1604);

    expect(data.sellers.map((s) => s.user_id)).toEqual([13, 7, 4]);
    expect(data.top3.map((s) => s.user_id)).toEqual([13, 7, 4]);
    expect(data.top3_current.map((s) => s.user_id)).toEqual([13, 7, 4]);
    expect(data.sellers.some((s) => s.user_id === 12)).toBe(false);
    expect(data.sellers.some((s) => /Seller\s*#?\s*12/i.test(String(s.name || '')))).toBe(false);

    const seller13 = data.sellers.find((s) => s.user_id === 13);
    const seller7 = data.sellers.find((s) => s.user_id === 7);
    const seller4 = data.sellers.find((s) => s.user_id === 4);

    expect(seller13.revenue_total_week).toBe(59400);
    expect(seller7.revenue_total_week).toBe(65000);
    expect(seller4.revenue_total_week).toBe(36000);

    expect(seller13.points_week_total).toBeCloseTo(127.08, 2);
    expect(seller7.points_week_total).toBeCloseTo(78, 2);
    expect(seller4.points_week_total).toBeCloseTo(59.4, 2);

    expect(data.weekly_distribution).toEqual({ first: 0.5, second: 0.3, third: 0.2 });
    expect(data.weekly_distribution_current).toEqual({ first: 0.5, second: 0.3, third: 0.2 });

    expect(data.top3_current.map((s) => s.weekly_payout_current)).toEqual([802, 481, 321]);
    expect(
      data.sellers
        .slice(0, 3)
        .map((s) => s.weekly_payout_current)
    ).toEqual([802, 481, 321]);
  });

  it('keeps top-3 prizes separate while weekly ranking includes every seller with weekly sales', async () => {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active, zone)
      VALUES
        (4, '1', 'hash', 'seller', 1, 'center'),
        (7, 'maxim', 'hash', 'seller', 1, 'center'),
        (12, 'dispatcher12', 'hash', 'dispatcher', 1, 'center'),
        (13, 'seller', 'hash', 'seller', 1, 'hedgehog'),
        (14, 'anna', 'hash', 'seller', 1, 'sanatorium')
    `).run();

    const speedBoatId = db.prepare(`
      INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
      VALUES ('Weekly Speed Full Ranking', 'speed', 1, 1000, 500, 750)
    `).run().lastInsertRowid;
    const cruiseBoatId = db.prepare(`
      INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
      VALUES ('Weekly Cruise Full Ranking', 'cruise', 1, 1000, 500, 750)
    `).run().lastInsertRowid;

    const speedSlotId = db.prepare(`
      INSERT INTO boat_slots (
        boat_id, time, price, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, trip_date, is_active, seller_cutoff_minutes
      )
      VALUES (?, '10:00', 1000, 20, 20, 1000, 500, 750, 60, '2026-03-30', 1, 30)
    `).run(speedBoatId).lastInsertRowid;
    const cruiseSlotId = db.prepare(`
      INSERT INTO boat_slots (
        boat_id, time, price, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, trip_date, is_active, seller_cutoff_minutes
      )
      VALUES (?, '11:00', 1000, 20, 20, 1000, 500, 750, 60, '2026-03-31', 1, 30)
    `).run(cruiseBoatId).lastInsertRowid;

    insertPresale({ sellerId: 13, boatSlotId: cruiseSlotId, totalPrice: 30000, businessDay: '2026-03-30', zoneAtSale: null });
    insertPresale({ sellerId: 7, boatSlotId: speedSlotId, totalPrice: 25000, businessDay: '2026-04-01', zoneAtSale: 'center' });
    insertPresale({ sellerId: 4, boatSlotId: speedSlotId, totalPrice: 15000, businessDay: '2026-04-02', zoneAtSale: 'center' });
    insertPresale({ sellerId: 14, boatSlotId: speedSlotId, totalPrice: 5000, businessDay: '2026-04-03', zoneAtSale: 'sanatorium' });
    insertPresale({ sellerId: 12, boatSlotId: speedSlotId, totalPrice: 99900, businessDay: '2026-04-04', zoneAtSale: 'center' });

    const res = await request(app)
      .get(`/api/owner/motivation/weekly?week=${WEEK_ID}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const { data, meta } = res.body;
    expect(meta.ranking_source).toBe('seller_only_weekly_canonical_presales');
    expect(data.sellers.map((s) => s.user_id)).toEqual([13, 7, 4, 14]);
    expect(data.sellers).toHaveLength(4);
    expect(data.top3.map((s) => s.user_id)).toEqual([13, 7, 4]);
    expect(data.top3_current.map((s) => s.user_id)).toEqual([13, 7, 4]);
    expect(data.top3).toHaveLength(3);
    expect(data.top3_current).toHaveLength(3);
    expect(data.sellers.some((s) => s.user_id === 12)).toBe(false);

    const anna = data.sellers.find((s) => s.user_id === 14);
    expect(anna).toBeDefined();
    expect(anna.name).toBe('anna');
    expect(anna.zone).toBe('sanatorium');
    expect(anna.points_week_total).toBeCloseTo(4.8, 2);

    for (let i = 1; i < data.sellers.length; i += 1) {
      expect(Number(data.sellers[i - 1].points_week_total)).toBeGreaterThanOrEqual(Number(data.sellers[i].points_week_total));
    }
  });
});
