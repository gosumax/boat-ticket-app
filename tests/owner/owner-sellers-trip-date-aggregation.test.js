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

describe('OWNER SELLERS trip-date aggregation', () => {
  let ownerToken;
  let today;
  let yesterday;
  let boatId;
  let todaySellerId;
  let yesterdaySellerId;

  beforeAll(() => {
    addColumnIfMissing('presales', 'business_day', 'business_day TEXT NULL');
    addColumnIfMissing('boat_slots', 'trip_date', 'trip_date TEXT NULL');
    addColumnIfMissing('tickets', 'business_day', 'business_day TEXT NULL');

    today = db.prepare(`SELECT DATE('now','localtime') AS day`).get().day;
    yesterday = db.prepare(`SELECT DATE(?,'-1 day') AS day`).get(today).day;

    const passwordHash = bcrypt.hashSync('password123', 10);
    const ownerId = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, 'owner', 1)
    `).run(`owner_sellers_tripdate_${Date.now()}`, passwordHash).lastInsertRowid;
    ownerToken = jwt.sign({ id: ownerId, role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });

    todaySellerId = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, 'seller', 1)
    `).run(`seller_today_${Date.now()}`, passwordHash).lastInsertRowid;
    yesterdaySellerId = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, 'seller', 1)
    `).run(`seller_yesterday_${Date.now()}`, passwordHash).lastInsertRowid;

    boatId = db.prepare(`
      INSERT INTO boats (name, is_active, type, price_adult)
      VALUES ('Seller Regression Boat', 1, 'speed', 3000)
    `).run().lastInsertRowid;
  });

  beforeEach(() => {
    db.prepare('DELETE FROM tickets').run();
    db.prepare('DELETE FROM money_ledger').run();
    db.prepare('DELETE FROM presales').run();
    db.prepare('DELETE FROM boat_slots').run();
  });

  test('separates today and yesterday by canonical trip_date even when ledger payment days are reversed', async () => {
    const insertSlot = db.prepare(`
      INSERT INTO boat_slots (boat_id, time, capacity, seats_left, is_active, trip_date)
      VALUES (?, ?, 20, 20, 1, ?)
    `);
    const todaySlotId = insertSlot.run(boatId, '10:00', today).lastInsertRowid;
    const yesterdaySlotId = insertSlot.run(boatId, '11:00', yesterday).lastInsertRowid;

    const insertPresale = db.prepare(`
      INSERT INTO presales (
        boat_slot_id, customer_name, customer_phone, number_of_seats, total_price,
        prepayment_amount, status, slot_uid, business_day, seller_id,
        payment_cash_amount, payment_card_amount
      )
      VALUES (?, ?, '79990000000', ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)
    `);

    const todayPresaleId = insertPresale.run(
      todaySlotId,
      'Today trip',
      2,
      4000,
      4000,
      `boat_slot:${todaySlotId}`,
      today,
      todaySellerId,
      4000,
      0
    ).lastInsertRowid;

    const yesterdayPresaleId = insertPresale.run(
      yesterdaySlotId,
      'Yesterday trip',
      2,
      6000,
      6000,
      `boat_slot:${yesterdaySlotId}`,
      yesterday,
      yesterdaySellerId,
      0,
      6000
    ).lastInsertRowid;

    const insertTicket = db.prepare(`
      INSERT INTO tickets (presale_id, boat_slot_id, ticket_code, status, price, business_day)
      VALUES (?, ?, ?, 'ACTIVE', ?, ?)
    `);
    insertTicket.run(todayPresaleId, todaySlotId, 'TODAY-1', 2500, yesterday);
    insertTicket.run(todayPresaleId, todaySlotId, 'TODAY-2', 1500, yesterday);
    insertTicket.run(yesterdayPresaleId, yesterdaySlotId, 'YDAY-1', 3000, today);
    insertTicket.run(yesterdayPresaleId, yesterdaySlotId, 'YDAY-2', 3000, today);

    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (presale_id, seller_id, amount, method, status, kind, type, business_day)
      VALUES (?, ?, ?, ?, 'POSTED', 'SELLER_SHIFT', ?, ?)
    `);
    insertLedger.run(todayPresaleId, todaySellerId, 4000, 'CASH', 'SALE_ACCEPTED_CASH', yesterday);
    insertLedger.run(yesterdayPresaleId, yesterdaySellerId, 6000, 'CARD', 'SALE_ACCEPTED_CARD', today);

    const todayRes = await request(app)
      .get('/api/owner/sellers?preset=today')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(todayRes.status).toBe(200);
    expect(Number(todayRes.body.data?.totals?.revenue_forecast || 0)).toBe(4000);
    expect((todayRes.body.data?.items || []).length).toBe(1);
    expect(Number(todayRes.body.data?.items?.[0]?.seller_id || 0)).toBe(Number(todaySellerId));
    expect(Number(todayRes.body.data?.items?.[0]?.revenue_forecast || 0)).toBe(4000);

    const yesterdayRes = await request(app)
      .get('/api/owner/sellers?preset=yesterday')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(yesterdayRes.status).toBe(200);
    expect(Number(yesterdayRes.body.data?.totals?.revenue_forecast || 0)).toBe(6000);
    expect((yesterdayRes.body.data?.items || []).length).toBe(1);
    expect(Number(yesterdayRes.body.data?.items?.[0]?.seller_id || 0)).toBe(Number(yesterdaySellerId));
    expect(Number(yesterdayRes.body.data?.items?.[0]?.revenue_forecast || 0)).toBe(6000);
  });
});
