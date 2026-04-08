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

describe('OWNER BOATS drill-down details', () => {
  let ownerToken;
  let today;

  beforeAll(() => {
    addColumnIfMissing('presales', 'business_day', 'business_day TEXT NULL');
    addColumnIfMissing('tickets', 'business_day', 'business_day TEXT NULL');
    addColumnIfMissing('boat_slots', 'trip_date', 'trip_date TEXT NULL');

    today = db.prepare(`SELECT DATE('now','localtime') AS day`).get().day;

    const passwordHash = bcrypt.hashSync('password123', 10);
    const ownerId = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, 'owner', 1)
    `).run(`owner_boats_drilldown_${Date.now()}`, passwordHash).lastInsertRowid;

    ownerToken = jwt.sign({ id: ownerId, role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  });

  beforeEach(() => {
    db.prepare('DELETE FROM tickets').run();
    db.prepare('DELETE FROM money_ledger').run();
    db.prepare('DELETE FROM presales').run();
    db.prepare('DELETE FROM generated_slots').run();
    db.prepare('DELETE FROM boat_slots').run();
    db.prepare('DELETE FROM boats').run();
  });

  test('returns compact share plus drill-down metrics per boat', async () => {
    const insertBoat = db.prepare(`
      INSERT INTO boats (name, is_active, type, price_adult, price_child, price_teen)
      VALUES (?, 1, ?, ?, ?, ?)
    `);
    const mainBoatId = insertBoat.run('Drilldown Boat', 'speed', 2000, 1000, 1500).lastInsertRowid;
    const secondBoatId = insertBoat.run('Second Boat', 'cruise', 1000, 500, 800).lastInsertRowid;

    const insertSlot = db.prepare(`
      INSERT INTO boat_slots (boat_id, time, capacity, seats_left, is_active, trip_date, price, price_adult, price_child, price_teen)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `);
    const morningSlotId = insertSlot.run(mainBoatId, '09:00', 10, 10, today, 2000, 2000, 1000, 1500).lastInsertRowid;
    const noonSlotId = insertSlot.run(mainBoatId, '12:00', 8, 8, today, 2500, 2500, 1200, 1800).lastInsertRowid;
    const secondBoatSlotId = insertSlot.run(secondBoatId, '14:00', 5, 5, today, 1000, 1000, 500, 800).lastInsertRowid;

    const insertPresale = db.prepare(`
      INSERT INTO presales (
        boat_slot_id, customer_name, customer_phone, number_of_seats, total_price,
        prepayment_amount, status, slot_uid, business_day, created_at, updated_at,
        tickets_json, payment_cash_amount, payment_card_amount, payment_method
      )
      VALUES (?, ?, '79990000000', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertTicket = db.prepare(`
      INSERT INTO tickets (
        presale_id, boat_slot_id, ticket_code, status, price, business_day, created_at, updated_at
      )
      VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
    `);

    const morningPresaleId = insertPresale.run(
      morningSlotId,
      'Morning Active',
      4,
      6500,
      6500,
      'ACTIVE',
      `boat_slot:${morningSlotId}`,
      today,
      `${today} 08:00:00`,
      `${today} 08:00:00`,
      JSON.stringify({ adult: 2, teen: 1, child: 1 }),
      2000,
      4500,
      'MIXED'
    ).lastInsertRowid;

    [2000, 2000, 1500, 1000].forEach((price, index) => {
      insertTicket.run(
        morningPresaleId,
        morningSlotId,
        `MAIN-AM-${index + 1}`,
        price,
        today,
        `${today} 08:00:00`,
        `${today} 08:00:00`
      );
    });

    const noonPresaleId = insertPresale.run(
      noonSlotId,
      'Noon Active',
      8,
      20000,
      20000,
      'ACTIVE',
      `boat_slot:${noonSlotId}`,
      today,
      `${today} 09:00:00`,
      `${today} 09:00:00`,
      JSON.stringify({ adult: 8, teen: 0, child: 0 }),
      5000,
      15000,
      'MIXED'
    ).lastInsertRowid;

    Array(8).fill(2500).forEach((price, index) => {
      insertTicket.run(
        noonPresaleId,
        noonSlotId,
        `MAIN-NOON-${index + 1}`,
        price,
        today,
        `${today} 09:00:00`,
        `${today} 09:00:00`
      );
    });

    const cancelledPresaleId = insertPresale.run(
      morningSlotId,
      'Cancelled Order',
      2,
      4000,
      4000,
      'CANCELLED',
      `boat_slot:${morningSlotId}`,
      today,
      `${today} 10:00:00`,
      `${today} 10:00:00`,
      JSON.stringify({ adult: 2, teen: 0, child: 0 }),
      0,
      4000,
      'CARD'
    ).lastInsertRowid;

    const secondBoatPresaleId = insertPresale.run(
      secondBoatSlotId,
      'Second Boat Active',
      5,
      5000,
      5000,
      'ACTIVE',
      `boat_slot:${secondBoatSlotId}`,
      today,
      `${today} 11:00:00`,
      `${today} 11:00:00`,
      JSON.stringify({ adult: 5, teen: 0, child: 0 }),
      5000,
      0,
      'CASH'
    ).lastInsertRowid;

    Array(5).fill(1000).forEach((price, index) => {
      insertTicket.run(
        secondBoatPresaleId,
        secondBoatSlotId,
        `SECOND-${index + 1}`,
        price,
        today,
        `${today} 11:00:00`,
        `${today} 11:00:00`
      );
    });

    db.prepare(`
      INSERT INTO money_ledger (
        presale_id, slot_id, trip_day, event_time, kind, method, amount, status, seller_id, business_day, type
      )
      VALUES (?, ?, ?, ?, 'SELLER_SHIFT', 'CARD', ?, 'POSTED', NULL, ?, 'SALE_CANCEL_REVERSE')
    `).run(cancelledPresaleId, morningSlotId, today, `${today} 12:00:00`, -4000, today);

    const res = await request(app)
      .get('/api/owner/boats?preset=today')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);

    const boats = res.body.data?.boats || [];
    const mainBoat = boats.find((boat) => boat.boat_id === mainBoatId);
    const secondBoat = boats.find((boat) => boat.boat_id === secondBoatId);

    expect(Number(mainBoat?.revenue || 0)).toBe(26500);
    expect(Number(mainBoat?.tickets || 0)).toBe(12);
    expect(Number(mainBoat?.trips || 0)).toBe(2);
    expect(Number(mainBoat?.capacity || 0)).toBe(18);
    expect(Number(mainBoat?.fillPercent || 0)).toBe(66.7);
    expect(Number(mainBoat?.sharePercent || 0)).toBe(84.1);

    expect(Number(mainBoat?.details?.avgCheck || 0)).toBe(2208);
    expect(Number(mainBoat?.details?.avgRevenuePerTrip || 0)).toBe(13250);
    expect(Number(mainBoat?.details?.avgPassengersPerTrip || 0)).toBe(6);
    expect(Number(mainBoat?.details?.freeSeats || 0)).toBe(6);
    expect(Number(mainBoat?.details?.lostPotential?.seats || 0)).toBe(6);
    expect(Number(mainBoat?.details?.lostPotential?.revenue || 0)).toBe(12000);
    expect(Number(mainBoat?.details?.lostPotential?.maxRevenue || 0)).toBe(38500);
    expect(Number(mainBoat?.details?.potentialRevenuePercent || 0)).toBe(68.8);
    expect(Number(mainBoat?.details?.fullTripsCount || 0)).toBe(1);

    expect(Number(mainBoat?.details?.bestTrip?.revenue || 0)).toBe(20000);
    expect(String(mainBoat?.details?.bestTrip?.date || '')).toBe(today);
    expect(String(mainBoat?.details?.bestTrip?.time || '')).toBe('12:00');
    expect(Number(mainBoat?.details?.worstTrip?.revenue || 0)).toBe(6500);
    expect(String(mainBoat?.details?.worstTrip?.date || '')).toBe(today);
    expect(String(mainBoat?.details?.worstTrip?.time || '')).toBe('09:00');

    expect(Number(mainBoat?.details?.cancellations?.count || 0)).toBe(1);
    expect(Number(mainBoat?.details?.cancellations?.amount || 0)).toBe(4000);
    expect(Number(mainBoat?.details?.refunds?.count || 0)).toBe(1);
    expect(Number(mainBoat?.details?.refunds?.amount || 0)).toBe(4000);

    expect(mainBoat?.details?.ticketTypes?.available).toBe(true);
    expect(Number(mainBoat?.details?.ticketTypes?.adult || 0)).toBe(10);
    expect(Number(mainBoat?.details?.ticketTypes?.teen || 0)).toBe(1);
    expect(Number(mainBoat?.details?.ticketTypes?.child || 0)).toBe(1);
    expect(Number(mainBoat?.details?.paymentMethods?.cash || 0)).toBe(7000);
    expect(Number(mainBoat?.details?.paymentMethods?.card || 0)).toBe(19500);

    expect(Number(secondBoat?.revenue || 0)).toBe(5000);
    expect(Number(secondBoat?.sharePercent || 0)).toBe(15.9);
  });

  test('marks ticket type breakdown unavailable when current data is not reliable', async () => {
    const boatId = db.prepare(`
      INSERT INTO boats (name, is_active, type, price_adult, price_child, price_teen)
      VALUES ('Legacy Boat', 1, 'speed', 1500, 800, 1200)
    `).run().lastInsertRowid;

    const slotId = db.prepare(`
      INSERT INTO boat_slots (boat_id, time, capacity, seats_left, is_active, trip_date, price, price_adult, price_child, price_teen)
      VALUES (?, '10:30', 6, 6, 1, ?, 1500, 1500, 800, 1200)
    `).run(boatId, today).lastInsertRowid;

    const presaleId = db.prepare(`
      INSERT INTO presales (
        boat_slot_id, customer_name, customer_phone, number_of_seats, total_price,
        prepayment_amount, status, slot_uid, business_day, created_at, updated_at,
        tickets_json, payment_cash_amount, payment_card_amount, payment_method
      )
      VALUES (?, 'Legacy Customer', '79990000001', 2, 3000, 3000, 'ACTIVE', ?, ?, ?, ?, NULL, 3000, 0, 'CASH')
    `).run(slotId, `boat_slot:${slotId}`, today, `${today} 10:30:00`, `${today} 10:30:00`).lastInsertRowid;

    [1500, 1500].forEach((price, index) => {
      db.prepare(`
        INSERT INTO tickets (presale_id, boat_slot_id, ticket_code, status, price, business_day, created_at, updated_at)
        VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
      `).run(presaleId, slotId, `LEGACY-${index + 1}`, price, today, `${today} 10:30:00`, `${today} 10:30:00`);
    });

    const res = await request(app)
      .get('/api/owner/boats?preset=today')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);

    const boat = (res.body.data?.boats || []).find((item) => item.boat_id === boatId);
    expect(boat).toBeTruthy();
    expect(boat?.details?.ticketTypes?.available).toBe(false);
    expect(Number(boat?.details?.paymentMethods?.cash || 0)).toBe(3000);
    expect(Number(boat?.details?.paymentMethods?.card || 0)).toBe(0);
  });
});
