import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

process.env.DB_FILE = ':memory:';
process.env.NODE_ENV = 'test';

import { app } from '../../server/index.js';
import db from '../../server/db.js';

const JWT_SECRET = 'boat_ticket_secret_key';

function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

describe('OWNER BOATS ticket-first aggregation', () => {
  let ownerToken;
  let today;
  let yesterday;
  let tomorrow;
  let speedBoatId;
  let cruiseBoatId;
  let bananaBoatId;

  beforeAll(() => {
    addColumnIfMissing('presales', 'business_day', 'business_day TEXT NULL');
    addColumnIfMissing('tickets', 'business_day', 'business_day TEXT NULL');
    addColumnIfMissing('boat_slots', 'trip_date', 'trip_date TEXT NULL');

    today = db.prepare(`SELECT DATE('now','localtime') AS day`).get().day;
    yesterday = db.prepare(`SELECT DATE(?,'-1 day') AS day`).get(today).day;
    tomorrow = db.prepare(`SELECT DATE(?,'+1 day') AS day`).get(today).day;

    const passwordHash = bcrypt.hashSync('password123', 10);
    const ownerId = db
      .prepare(`
        INSERT INTO users (username, password_hash, role, is_active)
        VALUES (?, ?, 'owner', 1)
      `)
      .run(`owner_boats_regression_${Date.now()}`, passwordHash).lastInsertRowid;
    ownerToken = jwt.sign({ id: ownerId, role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });

    const insertBoat = db.prepare(`
      INSERT INTO boats (name, is_active, type, price_adult, price_child, price_teen)
      VALUES (?, 1, ?, ?, ?, ?)
    `);
    speedBoatId = insertBoat.run('Regression Speed Boat', 'speed', 3000, 1500, 2000).lastInsertRowid;
    cruiseBoatId = insertBoat.run('Regression Cruise Boat', 'cruise', 1800, 400, 900).lastInsertRowid;
    bananaBoatId = insertBoat.run('Regression Banana Boat', 'banana', 2200, 700, 0).lastInsertRowid;
  });

  beforeEach(() => {
    db.prepare('DELETE FROM tickets').run();
    db.prepare('DELETE FROM presales').run();
    db.prepare('DELETE FROM generated_slots').run();
    db.prepare('DELETE FROM boat_slots').run();
  });

  test('counts active tickets once and keeps only same-day real trips within range', async () => {
    const insertSlot = db.prepare(`
      INSERT INTO boat_slots (boat_id, time, capacity, seats_left, is_active, trip_date, price_adult, price_child, price_teen)
      VALUES (?, ?, 20, 20, 1, ?, ?, ?, ?)
    `);
    const speedMorningSlotId = insertSlot.run(speedBoatId, '09:00', today, 3000, 1500, 2000).lastInsertRowid;
    const speedEveningSlotId = insertSlot.run(speedBoatId, '21:00', today, 3000, 1000, 2000).lastInsertRowid;
    const speedLateSlotId = insertSlot.run(speedBoatId, '23:20', today, 2000, 500, 1000).lastInsertRowid;
    const cruiseSlotId = insertSlot.run(cruiseBoatId, '23:30', today, 1800, 400, 900).lastInsertRowid;
    const bananaSlotId = insertSlot.run(bananaBoatId, '23:40', today, 2200, 700, 0).lastInsertRowid;
    const bananaFutureSlotId = insertSlot.run(bananaBoatId, '23:50', tomorrow, 2200, 700, 0).lastInsertRowid;

    const insertPresale = db.prepare(`
      INSERT INTO presales (
        boat_slot_id, customer_name, customer_phone, number_of_seats, total_price,
        prepayment_amount, status, slot_uid, business_day, created_at, updated_at
      )
      VALUES (?, ?, '79990000000', ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
    `);
    const insertTicket = db.prepare(`
      INSERT INTO tickets (
        presale_id, boat_slot_id, ticket_code, status, price, business_day, created_at, updated_at
      )
      VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
    `);

    function createPresaleWithTickets({
      slotId,
      slotUid,
      customerName,
      seats,
      ticketPrice,
      presaleBusinessDay,
      ticketDays,
    }) {
      const totalPrice = seats * ticketPrice;
      const presaleId = insertPresale.run(
        slotId,
        customerName,
        seats,
        totalPrice,
        totalPrice,
        slotUid,
        presaleBusinessDay,
        `${presaleBusinessDay} 10:00:00`,
        `${presaleBusinessDay} 10:00:00`
      ).lastInsertRowid;

      ticketDays.forEach((ticketDay, index) => {
        insertTicket.run(
          presaleId,
          slotId,
          `${slotUid}-T${index + 1}`,
          ticketPrice,
          ticketDay,
          `${ticketDay} 10:00:00`,
          `${ticketDay} 10:00:00`
        );
      });
    }

    createPresaleWithTickets({
      slotId: speedMorningSlotId,
      slotUid: 'generated:9001',
      customerName: 'Speed mixed day',
      seats: 11,
      ticketPrice: 3000,
      presaleBusinessDay: today,
      ticketDays: [today, today, today, today, today, today, today, yesterday, yesterday, yesterday, yesterday],
    });
    createPresaleWithTickets({
      slotId: speedEveningSlotId,
      slotUid: 'generated:9002',
      customerName: 'Speed evening',
      seats: 10,
      ticketPrice: 3000,
      presaleBusinessDay: today,
      ticketDays: Array(10).fill(today),
    });
    createPresaleWithTickets({
      slotId: speedLateSlotId,
      slotUid: 'generated:9003',
      customerName: 'Speed late',
      seats: 10,
      ticketPrice: 2000,
      presaleBusinessDay: today,
      ticketDays: Array(10).fill(today),
    });
    createPresaleWithTickets({
      slotId: cruiseSlotId,
      slotUid: 'generated:9004',
      customerName: 'Cruise same day',
      seats: 10,
      ticketPrice: 1800,
      presaleBusinessDay: today,
      ticketDays: Array(10).fill(today),
    });
    createPresaleWithTickets({
      slotId: bananaSlotId,
      slotUid: 'generated:9005',
      customerName: 'Banana same day',
      seats: 12,
      ticketPrice: 2200,
      presaleBusinessDay: today,
      ticketDays: Array(12).fill(today),
    });
    createPresaleWithTickets({
      slotId: bananaFutureSlotId,
      slotUid: 'generated:9006',
      customerName: 'Banana future trip',
      seats: 6,
      ticketPrice: 2200,
      presaleBusinessDay: tomorrow,
      ticketDays: Array(6).fill(today),
    });

    const res = await request(app)
      .get('/api/owner/boats?preset=today')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);

    const boats = res.body.data?.boats || [];
    const totals = res.body.data?.totals || {};
    const speed = boats.find((boat) => boat.boat_id === speedBoatId);
    const cruise = boats.find((boat) => boat.boat_id === cruiseBoatId);
    const banana = boats.find((boat) => boat.boat_id === bananaBoatId);

    expect(Number(speed?.revenue || 0)).toBe(83000);
    expect(Number(speed?.tickets || 0)).toBe(31);
    expect(Number(speed?.trips || 0)).toBe(3);
    expect(Number(speed?.capacity || 0)).toBe(60);
    expect(Number(speed?.fillPercent || 0)).toBe(51.7);

    expect(Number(cruise?.revenue || 0)).toBe(18000);
    expect(Number(cruise?.tickets || 0)).toBe(10);
    expect(Number(cruise?.trips || 0)).toBe(1);
    expect(Number(cruise?.capacity || 0)).toBe(20);
    expect(Number(cruise?.fillPercent || 0)).toBe(50);

    expect(Number(banana?.revenue || 0)).toBe(26400);
    expect(Number(banana?.tickets || 0)).toBe(12);
    expect(Number(banana?.trips || 0)).toBe(1);
    expect(Number(banana?.capacity || 0)).toBe(20);
    expect(Number(banana?.fillPercent || 0)).toBe(60);

    expect(Number(totals.revenue || 0)).toBe(127400);
    expect(Number(totals.tickets || 0)).toBe(53);
    expect(Number(totals.trips || 0)).toBe(5);
    expect(Number(totals.capacity || 0)).toBe(100);
    expect(Number(totals.fillPercent || 0)).toBe(53);
  });
});
