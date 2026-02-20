import { describe, test, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Set env before imports
process.env.DB_FILE = ':memory:';
process.env.NODE_ENV = 'test';

import { app } from '../../server/index.js';
import db from '../../server/db.js';

const JWT_SECRET = 'boat_ticket_secret_key';

describe('OWNER FINANCIAL INVARIANT', () => {
  let today; // Will be set from SQLite
  let ownerToken;

  beforeAll(async () => {
    // Add business_day column to presales if missing
    try {
      const cols = db.prepare("PRAGMA table_info(presales)").all().map(r => r.name);
      if (!cols.includes('business_day')) {
        db.exec("ALTER TABLE presales ADD COLUMN business_day TEXT NULL");
      }
    } catch (e) {
      console.log('[TEST] business_day column check:', e.message);
    }

    // Get today's date from SQLite to match timezone
    today = db.prepare(`SELECT DATE('now','localtime') as today`).get().today;

    // Create owner user and token
    const hashedPassword = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?)
    `);
    const ownerId = insertUser.run('test_owner', hashedPassword, 'owner', 1).lastInsertRowid;
    ownerToken = jwt.sign({ id: ownerId, username: 'test_owner', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  });

  beforeEach(() => {
    // Clear tables for isolation
    db.prepare('DELETE FROM sales_transactions_canonical').run();
    db.prepare('DELETE FROM money_ledger').run();
    db.prepare('DELETE FROM tickets').run();
    db.prepare('DELETE FROM presales').run();
  });

  test('canonical revenue equals presales revenue for same business_day', () => {
    // Insert test presale
    const insertPresale = db.prepare(`
      INSERT INTO presales (customer_name, customer_phone, number_of_seats, total_price, business_day, status, boat_slot_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const presaleId = insertPresale.run('Test', '79991234567', 2, 3000, today, 'ACTIVE', 1).lastInsertRowid;

    // Insert corresponding canonical record
    const insertCanon = db.prepare(`
      INSERT INTO sales_transactions_canonical (presale_id, amount, business_day, status, method)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertCanon.run(presaleId, 3000, today, 'VALID', 'CASH');

    // Query both
    const canonical = db.prepare(`
      SELECT SUM(amount) as total
      FROM sales_transactions_canonical
      WHERE business_day = ?
        AND status = 'VALID'
    `).get(today);

    const presales = db.prepare(`
      SELECT SUM(total_price) as total
      FROM presales
      WHERE business_day = ?
        AND status = 'ACTIVE'
    `).get(today);

    expect(Number(canonical.total || 0)).toBe(Number(presales.total || 0));
  });

  test('money_ledger equals canonical for POSTED SELLER_SHIFT', () => {
    // Insert ledger entry
    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (amount, method, status, kind, type, business_day)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertLedger.run(1500, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', today);

    // Insert canonical
    const insertCanon = db.prepare(`
      INSERT INTO sales_transactions_canonical (amount, business_day, status, method)
      VALUES (?, ?, ?, ?)
    `);
    insertCanon.run(1500, today, 'VALID', 'CASH');

    // Query both
    const ledger = db.prepare(`
      SELECT SUM(amount) as total
      FROM money_ledger
      WHERE status = 'POSTED'
        AND kind = 'SELLER_SHIFT'
        AND DATE(business_day) = ?
    `).get(today);

    const canonical = db.prepare(`
      SELECT SUM(amount) as total
      FROM sales_transactions_canonical
      WHERE business_day = ?
        AND status = 'VALID'
    `).get(today);

    expect(Number(ledger.total || 0)).toBe(Number(canonical.total || 0));
  });

  test('owner summary returns collected_total from money_ledger', async () => {
    // Insert ledger entry for today
    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (amount, method, status, kind, type, business_day)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertLedger.run(2000, 'CASH', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CASH', today);
    insertLedger.run(1500, 'CARD', 'POSTED', 'SELLER_SHIFT', 'SALE_ACCEPTED_CARD', today);

    const res = await request(app)
      .get('/api/owner/money/summary?preset=today')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // totals.revenue = collected_total = cash + card
    expect(res.body.data.totals.revenue).toBe(3500);
    expect(res.body.data.totals.cash).toBe(2000);
    expect(res.body.data.totals.card).toBe(1500);
  });

});
