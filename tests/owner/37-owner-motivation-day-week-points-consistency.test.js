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

describe('OWNER MOTIVATION DAY/WEEK POINTS CONSISTENCY', () => {
  beforeAll(async () => {
    resetTestDb();
    app = await makeApp();
    db = getTestDb();

    const passwordHash = bcrypt.hashSync('password123', 10);
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active)
      VALUES (1001, 'owner_motivation_consistency', ?, 'owner', 1)
    `).run(passwordHash);

    ownerToken = jwt.sign(
      { id: 1001, username: 'owner_motivation_consistency', role: 'owner' },
      JWT_SECRET,
      { expiresIn: '24h' },
    );

    db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
  });

  beforeEach(() => {
    db.prepare(`DELETE FROM tickets`).run();
    db.prepare(`DELETE FROM presales`).run();
    db.prepare(`DELETE FROM boat_slots`).run();
    db.prepare(`DELETE FROM boats`).run();
    db.prepare(`DELETE FROM money_ledger`).run();
    db.prepare(`DELETE FROM motivation_day_settings`).run();
    db.prepare(`DELETE FROM seller_motivation_state`).run();
    db.prepare(`DELETE FROM seller_day_stats`).run();
    db.prepare(`DELETE FROM users WHERE id IN (2001)`).run();

    db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
      motivationType: 'adaptive',
      k_speed: 1.2,
      k_zone_center: 1.0,
      k_cruise: 3.0,
      k_zone_hedgehog: 1.3,
      k_zone_sanatorium: 0.8,
      k_zone_stationary: 0.7,
      k_banana_hedgehog: 2.7,
      k_banana_center: 2.2,
      k_banana_sanatorium: 1.2,
      k_banana_stationary: 1.0,
    }));
  });

  it('returns the same fractional points in day and weekly views for the same seller data', async () => {
    const sellerId = 2001;
    const businessDay = '2026-04-06';
    const weekId = '2026-W15';

    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active, zone)
      VALUES (?, 'fractional_points_seller', 'hash', 'seller', 1, 'center')
    `).run(sellerId);

    const boatId = db.prepare(`
      INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
      VALUES ('Fractional Speed Boat', 'speed', 1, 3000, 1500, 2250)
    `).run().lastInsertRowid;

    const slotId = db.prepare(`
      INSERT INTO boat_slots (
        boat_id, time, price, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, trip_date, is_active, seller_cutoff_minutes
      )
      VALUES (?, '10:00', 3000, 10, 10, 3000, 1500, 2250, 60, ?, 1, 30)
    `).run(boatId, businessDay).lastInsertRowid;

    const presaleId = db.prepare(`
      INSERT INTO presales (
        seller_id, boat_slot_id, customer_name, customer_phone, number_of_seats,
        total_price, status, business_day, zone_at_sale
      )
      VALUES (?, ?, 'Buyer', '123', 1, 3000, 'ACTIVE', ?, 'center')
    `).run(sellerId, slotId, businessDay).lastInsertRowid;

    db.prepare(`
      INSERT INTO money_ledger (
        kind, type, amount, seller_id, presale_id, status, business_day, event_time
      )
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 3000, ?, ?, 'POSTED', ?, datetime('now'))
    `).run(sellerId, presaleId, businessDay);

    const dayRes = await request(app)
      .get(`/api/owner/motivation/day?day=${businessDay}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    const weeklyRes = await request(app)
      .get(`/api/owner/motivation/weekly?week=${weekId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(dayRes.status).toBe(200);
    expect(weeklyRes.status).toBe(200);

    const dayPoints = Number(
      dayRes.body.data.points_by_user.find((row) => Number(row.user_id) === sellerId)?.points_total || 0,
    );
    const weeklyPoints = Number(
      weeklyRes.body.data.sellers.find((row) => Number(row.user_id) === sellerId)?.points_week_total || 0,
    );

    expect(dayPoints).toBeCloseTo(3.6, 6);
    expect(weeklyPoints).toBeCloseTo(3.6, 6);
    expect(weeklyPoints).toBeCloseTo(dayPoints, 6);
  });
});
