import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app;
let db;
let seedData;
let dispatcherToken;

function signToken({ id, username, role }) {
  return jwt.sign({ id, username, role }, JWT_SECRET, { expiresIn: '24h' });
}

function seedTemplateItemWithFutureSlots({ name, departureTime, slotTimeA, slotTimeB }) {
  const itemInsert = db.prepare(`
    INSERT INTO schedule_template_items (
      name, boat_id, type, departure_time, duration_minutes, capacity,
      price_adult, price_child, price_teen, weekdays_mask, is_active
    ) VALUES (?, ?, 'speed', ?, 60, 12, 1000, 500, 750, 1, 1)
  `).run(name, seedData.boats.speed, departureTime);

  const itemId = Number(itemInsert.lastInsertRowid);

  db.prepare(`
    INSERT INTO generated_slots (
      schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
      duration_minutes, is_active, price_adult, price_child, price_teen
    ) VALUES (?, '2099-12-31', ?, ?, 12, 12, 60, 1, 1000, 500, 750)
  `).run(itemId, seedData.boats.speed, slotTimeA);

  db.prepare(`
    INSERT INTO generated_slots (
      schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
      duration_minutes, is_active, price_adult, price_child, price_teen
    ) VALUES (?, '2100-01-01', ?, ?, 12, 12, 60, 1, 1000, 500, 750)
  `).run(itemId, seedData.boats.speed, slotTimeB);

  return itemId;
}

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  seedData = await seedBasicData(db);

  dispatcherToken = signToken({
    id: Number(seedData.users.dispatcher.id),
    username: seedData.users.dispatcher.username,
    role: 'dispatcher',
  });
});

describe('schedule-template item delete regressions', () => {
  it('deletes future trips with camelCase flag and returns count', async () => {
    const itemId = seedTemplateItemWithFutureSlots({
      name: 'camel-case-delete',
      departureTime: '18:00',
      slotTimeA: '18:00',
      slotTimeB: '18:30',
    });

    const res = await request(app)
      .delete(`/api/selling/schedule-template-items/${itemId}?deleteFutureTrips=true`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.deletedFutureTrips).toBe(true);
    expect(Number(res.body.futureTripsDeleted)).toBeGreaterThanOrEqual(2);

    const itemRow = db.prepare('SELECT id FROM schedule_template_items WHERE id = ?').get(itemId);
    const slotsCount = db.prepare('SELECT COUNT(*) AS c FROM generated_slots WHERE schedule_template_id = ?').get(itemId);

    expect(itemRow).toBeUndefined();
    expect(Number(slotsCount?.c || 0)).toBe(0);
  });

  it('supports legacy snake_case flag and still deletes future trips', async () => {
    const itemId = seedTemplateItemWithFutureSlots({
      name: 'snake-case-delete',
      departureTime: '19:00',
      slotTimeA: '19:00',
      slotTimeB: '19:30',
    });

    const res = await request(app)
      .delete(`/api/selling/schedule-template-items/${itemId}?delete_future_trips=1`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.deletedFutureTrips).toBe(true);
    expect(Number(res.body.futureTripsDeleted)).toBeGreaterThanOrEqual(2);

    const slotsCount = db.prepare('SELECT COUNT(*) AS c FROM generated_slots WHERE schedule_template_id = ?').get(itemId);
    expect(Number(slotsCount?.c || 0)).toBe(0);
  });
});
