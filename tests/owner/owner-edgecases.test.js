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

describe('OWNER EDGE CASES', () => {
  let day;
  let ownerToken;
  let testBoatId;
  let testSellerId;
  let testSlotId;

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

    // Create test boat_slot
    const insertSlot = db.prepare(`
      INSERT INTO boat_slots (boat_id, time, capacity, seats_left, is_active)
      VALUES (?, ?, ?, ?, ?)
    `);
    testSlotId = insertSlot.run(testBoatId, '10:00', 100, 100, 1).lastInsertRowid;
  });

  beforeEach(() => {
    // Clear tables for isolation
    db.prepare('DELETE FROM sales_transactions_canonical').run();
    db.prepare('DELETE FROM money_ledger').run();
    db.prepare('DELETE FROM presales').run();
  });

  test('cancel reduces boats revenue', async () => {
    // Insert presale
    const insertPresale = db.prepare(`
      INSERT INTO presales (customer_name, customer_phone, number_of_seats, total_price, business_day, status, boat_slot_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertPresale.run('Test', '79991234567', 2, 3000, day, 'ACTIVE', testSlotId);

    // Get before
    const before = await request(app)
      .get('/api/owner/boats?preset=today')
      .set('Authorization', `Bearer ${ownerToken}`);

    const beforeBoat = before.body.data?.boats?.find(b => b.boat_id === testBoatId);
    const beforeRevenue = Number(beforeBoat?.revenue || 0);
    expect(beforeRevenue).toBe(3000);

    // Cancel the presale
    db.prepare("UPDATE presales SET status='CANCELLED' WHERE boat_slot_id=?").run(testSlotId);

    // Get after
    const after = await request(app)
      .get('/api/owner/boats?preset=today')
      .set('Authorization', `Bearer ${ownerToken}`);

    const afterBoat = after.body.data?.boats?.find(b => b.boat_id === testBoatId);
    const afterRevenue = Number(afterBoat?.revenue || 0);

    // Revenue should be reduced (cancelled presales are excluded)
    expect(afterRevenue).toBe(0);
    expect(afterRevenue).toBeLessThan(beforeRevenue);
  });

  test('partial payment does not inflate seller revenue', async () => {
    // Create a presale with partial prepayment
    const insertPresale = db.prepare(`
      INSERT INTO presales (customer_name, customer_phone, number_of_seats, total_price, business_day, status, boat_slot_id, prepayment_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const presaleId = insertPresale.run('Test', '79991234567', 2, 3000, day, 'ACTIVE', testSlotId, 1000).lastInsertRowid;

    // Insert ledger entry for partial payment (only what was actually paid)
    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (presale_id, seller_id, amount, method, status, kind, type, business_day)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertLedger.run(presaleId, testSellerId, 1000, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_PREPAYMENT_CASH', day);

    const res = await request(app)
      .get('/api/owner/sellers?preset=today')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const found = res.body.data?.items?.find(s => s.seller_id === testSellerId);

    // Seller revenue should only be the actual payment (1000), not total_price (3000)
    expect(Number(found?.revenue_paid || 0)).toBe(1000);
  });

  test('multiple payments on same presale sum correctly', async () => {
    // Create a presale
    const insertPresale = db.prepare(`
      INSERT INTO presales (customer_name, customer_phone, number_of_seats, total_price, business_day, status, boat_slot_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const presaleId = insertPresale.run('Test', '79991234567', 2, 3000, day, 'ACTIVE', testSlotId).lastInsertRowid;

    // Insert multiple ledger entries for same presale
    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (presale_id, seller_id, amount, method, status, kind, type, business_day)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertLedger.run(presaleId, testSellerId, 1000, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_PREPAYMENT_CASH', day);
    insertLedger.run(presaleId, testSellerId, 2000, 'CARD', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CARD', day);

    const res = await request(app)
      .get('/api/owner/sellers?preset=today')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const found = res.body.data?.items?.find(s => s.seller_id === testSellerId);

    // Seller revenue should sum all payments
    expect(Number(found?.revenue_paid || 0)).toBe(3000);
  });

});
