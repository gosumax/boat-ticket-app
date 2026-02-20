import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Set env before imports
process.env.DB_FILE = ':memory:';
process.env.NODE_ENV = 'test';

import { app } from '../../server/index.js';
import db from '../../server/db.js';

const JWT_SECRET = 'boat_ticket_secret_key';

describe('OWNER BOATS & SELLERS INVARIANT', () => {
  let day;
  let ownerToken;
  let testBoatId;
  let testSellerId;

  beforeAll(async () => {
    // Add business_day column to presales if missing
    try {
      const cols = db.prepare("PRAGMA table_info(presales)").all().map(r => r.name);
      if (!cols.includes('business_day')) {
        db.exec("ALTER TABLE presales ADD COLUMN business_day TEXT NULL");
      }
    } catch (e) {
      // ignore
    }

    // Get today's date from SQLite
    day = db.prepare("SELECT DATE('now','localtime') as d").get().d;

    // Create owner user and token
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const ownerId = insertUser.run('test_owner', hashedPassword, 'owner', 1).lastInsertRowid;
    ownerToken = jwt.sign({ id: ownerId, username: 'test_owner', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });

    // Create test boat
    const insertBoat = db.prepare(`
      INSERT INTO boats (name, is_active, type, price_adult)
      VALUES (?, ?, ?, ?)
    `);
    testBoatId = insertBoat.run('Test Boat', 1, 'speed', 1500).lastInsertRowid;

    // Create test seller
    testSellerId = insertUser.run('test_seller', hashedPassword, 'seller', 1).lastInsertRowid;
  });

  beforeEach(() => {
    // Clear tables for isolation
    db.prepare('DELETE FROM sales_transactions_canonical').run();
    db.prepare('DELETE FROM money_ledger').run();
    db.prepare('DELETE FROM presales').run();
    db.prepare('DELETE FROM boat_slots').run();
  });

  test('boats revenue equals presales grouped by boat', async () => {
    // Create boat_slot linked to the boat
    const insertSlot = db.prepare(`
      INSERT INTO boat_slots (boat_id, time, capacity, seats_left, is_active)
      VALUES (?, ?, ?, ?, ?)
    `);
    const slotId = insertSlot.run(testBoatId, '10:00', 100, 100, 1).lastInsertRowid;

    // Insert presale records (boats endpoint uses presales, not canonical)
    const insertPresale = db.prepare(`
      INSERT INTO presales (customer_name, customer_phone, number_of_seats, total_price, business_day, status, boat_slot_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertPresale.run('Test1', '79991234567', 2, 3000, day, 'ACTIVE', slotId);
    insertPresale.run('Test2', '79991234568', 1, 2000, day, 'ACTIVE', slotId);

    const res = await request(app)
      .get('/api/owner/boats?preset=today')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const apiBoats = res.body.data?.boats || [];

    // Find the test boat
    const found = apiBoats.find(b => b.boat_id === testBoatId);
    expect(Number(found?.revenue || 0)).toBe(5000); // 3000 + 2000
  });

  test('sellers revenue equals money_ledger grouped by seller', async () => {
    // Insert money_ledger records for the seller (owner endpoint uses money_ledger)
    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (seller_id, amount, method, status, kind, type, business_day)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertLedger.run(testSellerId, 2500, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', day);
    insertLedger.run(testSellerId, 1500, 'CARD', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CARD', day);

    const res = await request(app)
      .get('/api/owner/sellers?preset=today')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const apiSellers = res.body.data?.items || [];

    // Find the test seller
    const found = apiSellers.find(s => s.seller_id === testSellerId);
    // seller endpoint returns revenue_paid = cash + card from ledger
    expect(Number(found?.revenue_paid || 0)).toBe(4000);
  });

});
