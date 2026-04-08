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

describe('OWNER COMPARE SYNC', () => {
  let ownerToken;
  let today;
  let yesterday;
  let testBoatId;
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

    // Get dates from SQLite
    today = db.prepare("SELECT DATE('now','localtime') as d").get().d;
    yesterday = db.prepare("SELECT DATE('now','localtime','-1 day') as d").get().d;

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

    // Create test boat_slot
    const insertSlot = db.prepare(`
      INSERT INTO boat_slots (boat_id, time, capacity, seats_left, is_active)
      VALUES (?, ?, ?, ?, ?)
    `);
    testSlotId = insertSlot.run(testBoatId, '10:00', 100, 100, 1).lastInsertRowid;
  });

  beforeEach(() => {
    // Clear tables for isolation
    db.prepare('DELETE FROM money_ledger').run();
    db.prepare('DELETE FROM presales').run();
  });

  test('compare-days matches money_ledger by business_day', async () => {
    // Insert money_ledger entries for both days
    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (amount, method, status, kind, type, business_day)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    // Yesterday: 2000 cash
    insertLedger.run(2000, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', yesterday);
    // Today: 3000 cash + 1500 card
    insertLedger.run(3000, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', today);
    insertLedger.run(1500, 'CARD', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CARD', today);

    // Call API
    const res = await request(app)
      .get(`/api/owner/money/compare-days?preset=7d`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);

    // Find today and yesterday in the response rows
    const rows = res.body?.data?.rows || [];
    const todayRow = rows.find(r => r.day === today);
    const yesterdayRow = rows.find(r => r.day === yesterday);

    // Verify today totals
    expect(Number(todayRow?.revenue || 0)).toBe(4500); // 3000 + 1500
    expect(Number(todayRow?.cash || 0)).toBe(3000);
    expect(Number(todayRow?.card || 0)).toBe(1500);

    // Verify yesterday totals
    expect(Number(yesterdayRow?.revenue || 0)).toBe(2000);
    expect(Number(yesterdayRow?.cash || 0)).toBe(2000);
  });

  test('compare-periods equals money_ledger sum in range', async () => {
    const from = yesterday;
    const to = today;

    // Insert money_ledger entries
    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (amount, method, status, kind, type, business_day)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertLedger.run(2000, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', yesterday);
    insertLedger.run(3000, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', today);
    insertLedger.run(1500, 'CARD', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CARD', today);

    const res = await request(app)
      .get(`/api/owner/money/compare-periods?fromA=${from}&toA=${to}&fromB=${from}&toB=${to}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);

    // Both periods should have same totals (same date range)
    const periodA = res.body?.data?.periodA;
    const periodB = res.body?.data?.periodB;

    // Total: 2000 + 3000 + 1500 = 6500
    expect(Number(periodA?.revenue_gross || 0)).toBe(6500);
    expect(Number(periodB?.revenue_gross || 0)).toBe(6500);
  });

  test('compare-boats matches presales grouped by boat', async () => {
    // Insert presales for the test boat
    const insertPresale = db.prepare(`
      INSERT INTO presales (customer_name, customer_phone, number_of_seats, total_price, business_day, status, boat_slot_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const presaleId1 = insertPresale.run('Test1', '79991234567', 2, 3000, today, 'ACTIVE', testSlotId).lastInsertRowid;
    const presaleId2 = insertPresale.run('Test2', '79991234568', 1, 1500, yesterday, 'ACTIVE', testSlotId).lastInsertRowid;

    // Insert money_ledger entries linked to presales (compare-boats uses money_ledger)
    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (presale_id, amount, method, status, kind, type, business_day)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertLedger.run(presaleId1, 3000, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', today);
    insertLedger.run(presaleId2, 1500, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', yesterday);

    const res = await request(app)
      .get(`/api/owner/money/compare-boats?fromA=${yesterday}&toA=${today}&fromB=${yesterday}&toB=${today}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);

    const rows = res.body?.data?.rows || [];
    const testBoat = rows.find(r => r.boat_id === testBoatId);

    // Total revenue: 3000 + 1500 = 4500
    expect(Number(testBoat?.a?.revenue_gross || 0)).toBe(4500);
  });

  test('compare-sellers matches money_ledger grouped by seller', async () => {
    // Create test seller
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const sellerId = insertUser.run('test_seller_compare', hashedPassword, 'seller', 1).lastInsertRowid;

    // Insert money_ledger entries for seller
    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (seller_id, amount, method, status, kind, type, business_day)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertLedger.run(sellerId, 2000, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', today);
    insertLedger.run(sellerId, 1500, 'CARD', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CARD', yesterday);

    const res = await request(app)
      .get(`/api/owner/money/compare-sellers?fromA=${yesterday}&toA=${today}&fromB=${yesterday}&toB=${today}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);

    const rows = res.body?.data?.rows || [];
    const testSeller = rows.find(r => r.seller_id === sellerId);

    // Total revenue: 2000 + 1500 = 3500
    expect(Number(testSeller?.a?.revenue_gross || 0)).toBe(3500);
  });

  test('compare-boat-daily supports same period with two boats', async () => {
    const insertBoat = db.prepare(`
      INSERT INTO boats (name, is_active, type, price_adult)
      VALUES (?, ?, ?, ?)
    `);
    const boat2Id = insertBoat.run('Second Test Boat', 1, 'speed', 1500).lastInsertRowid;

    const insertSlot = db.prepare(`
      INSERT INTO boat_slots (boat_id, time, capacity, seats_left, is_active)
      VALUES (?, ?, ?, ?, ?)
    `);
    const slot2Id = insertSlot.run(boat2Id, '12:00', 100, 100, 1).lastInsertRowid;

    const insertPresale = db.prepare(`
      INSERT INTO presales (customer_name, customer_phone, number_of_seats, total_price, business_day, status, boat_slot_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const presaleA = insertPresale.run('Boat A', '79991230001', 1, 1500, yesterday, 'ACTIVE', testSlotId).lastInsertRowid;
    const presaleB = insertPresale.run('Boat B', '79991230002', 2, 3000, today, 'ACTIVE', slot2Id).lastInsertRowid;

    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (presale_id, amount, method, status, kind, type, business_day)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertLedger.run(presaleA, 1500, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', yesterday);
    insertLedger.run(presaleB, 3000, 'CARD', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CARD', today);

    const res = await request(app)
      .get(`/api/owner/money/compare-boat-daily?boatIdA=${testBoatId}&boatIdB=${boat2Id}&from=${yesterday}&to=${today}&mode=daily`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body?.data?.comparisonType).toBe('entities');
    expect(res.body?.data?.entityAName).toBe('Test Boat');
    expect(res.body?.data?.entityBName).toBe('Second Test Boat');
    expect(res.body?.data?.points).toHaveLength(2);
    expect(Number(res.body?.data?.points?.[0]?.A || 0)).toBe(1500);
    expect(Number(res.body?.data?.points?.[0]?.B || 0)).toBe(0);
    expect(Number(res.body?.data?.points?.[1]?.A || 0)).toBe(0);
    expect(Number(res.body?.data?.points?.[1]?.B || 0)).toBe(3000);
  });

  test('compare-seller-daily supports same period with one or two sellers', async () => {
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const sellerAId = insertUser.run('seller_compare_a', hashedPassword, 'seller', 1).lastInsertRowid;
    const sellerBId = insertUser.run('seller_compare_b', hashedPassword, 'seller', 1).lastInsertRowid;

    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (seller_id, amount, method, status, kind, type, business_day)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertLedger.run(sellerAId, 1000, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', yesterday);
    insertLedger.run(sellerAId, 500, 'CARD', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CARD', today);
    insertLedger.run(sellerBId, 700, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', today);

    const twoSellerRes = await request(app)
      .get(`/api/owner/money/compare-seller-daily?sellerIdA=${sellerAId}&sellerIdB=${sellerBId}&from=${yesterday}&to=${today}&mode=cumulative`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(twoSellerRes.status).toBe(200);
    expect(twoSellerRes.body?.data?.comparisonType).toBe('entities');
    expect(twoSellerRes.body?.data?.points).toHaveLength(2);
    expect(Number(twoSellerRes.body?.data?.points?.[1]?.A || 0)).toBe(1500);
    expect(Number(twoSellerRes.body?.data?.points?.[1]?.B || 0)).toBe(700);

    const oneSellerRes = await request(app)
      .get(`/api/owner/money/compare-seller-daily?sellerIdA=${sellerAId}&from=${yesterday}&to=${today}&mode=daily`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(oneSellerRes.status).toBe(200);
    expect(oneSellerRes.body?.data?.entityBName ?? null).toBeNull();
    expect(Number(oneSellerRes.body?.data?.points?.[0]?.B || 0)).toBe(0);
    expect(Number(oneSellerRes.body?.data?.points?.[1]?.A || 0)).toBe(500);
  });

});
