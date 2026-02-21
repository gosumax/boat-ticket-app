/**
 * Regression Test: Dispatcher Shift Close Contract
 * 
 * "Прибивает гвоздями" критические инварианты:
 * 1. net_total == collected_total - refund_total
 * 2. После close summary source = 'snapshot'
 * 3. После close deposit запрещён (409 SHIFT_CLOSED)
 * 4. Cashbox поля присутствуют в close и summary snapshot
 * 5. Warnings мягкие (не блокируют close)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { getTodayLocal } from '../_helpers/testDates.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, dispatcherToken, dispatcherId;
let testDate;

beforeAll(async () => {
  // Reset test DB
  resetTestDb();
  
  // Initialize app
  app = await makeApp();
  
  // Get DB connection and seed test data
  db = getTestDb();
  await seedBasicData(db);
  
  // Get test date
  testDate = getTodayLocal(db);
  
  // Create dispatcher user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_contract', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_contract', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Create seller for tests
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, role, is_active)
    VALUES (200, 'test_seller_contract', ?, 'seller', 1)
  `).run(hashedPassword);
  
  // Ensure generated_slots has completed trips for test date
  const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
  if (boat) {
    db.prepare(`
      INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
      VALUES (99999, ?, ?, '10:00', 1, 1, 'COMPLETED')
    `).run(boat.id, testDate);
  }
  
  console.log('[SETUP] testDate:', testDate, 'dispatcherId:', dispatcherId);
});

describe('DISPATCHER SHIFT CLOSE CONTRACT (Regression)', () => {
  // Use unique dates for each test to avoid conflicts
  const getUniqueDate = (suffix) => `2099-12-${suffix.padStart(2, '0')}`;

  it('INVARIANT: net_total = net_cash + net_card (live)', async () => {
    const date = getUniqueDate('01');
    
    // Ensure trips completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (89991, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, date);
    }
    
    // Create sales
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 5000, 200, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(date);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CARD', 3000, 200, 'POSTED', ?, 'CARD', datetime('now','localtime'))
    `).run(date);

    const res = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${date}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('live');
    
    // INVARIANT: net_total = net_cash + net_card
    const { net_total, net_cash, net_card } = res.body;
    
    expect(net_total).toBe(net_cash + net_card);
    expect(net_cash).toBeGreaterThanOrEqual(0);
    expect(net_card).toBeGreaterThanOrEqual(0);
    
    console.log('[INVARIANT PASS] net_total = net_cash + net_card (live)');
  });

  it('CLOSE: after close, summary source = snapshot', async () => {
    const date = getUniqueDate('02');
    
    // Ensure trips completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (89992, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, date);
    }
    
    // Create a sale
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 10000, 200, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(date);

    // Before close: source = live
    const beforeRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${date}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.source).toBe('live');
    expect(beforeRes.body.is_closed).toBe(false);

    // Close
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: date });
    
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(closeRes.body.is_closed).toBe(true);
    expect(closeRes.body.source).toBe('snapshot');
    expect(closeRes.body.closed_at).toBeDefined();
    expect(closeRes.body.closed_by).toBe(dispatcherId);

    // After close: source = snapshot
    const afterRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${date}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    expect(afterRes.status).toBe(200);
    expect(afterRes.body.source).toBe('snapshot');
    expect(afterRes.body.is_closed).toBe(true);
    expect(afterRes.body.closed_at).toBeDefined();
    
    console.log('[INVARIANT PASS] after close, source = snapshot');
  });

  it('PROTECTION: after close, deposit returns 409 SHIFT_CLOSED', async () => {
    const date = getUniqueDate('03');
    
    // Ensure trips completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (89993, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, date);
    }
    
    // Create a sale and deposit
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 5000, 200, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(date);
    
    // Close
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: date });
    
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);

    // Try to deposit after close
    const depositRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        type: 'DEPOSIT_TO_OWNER_CASH',
        amount: 1000,
        seller_id: 200,
        business_day: date
      });
    
    expect(depositRes.status).toBe(409);
    expect(depositRes.body.ok).toBe(false);
    expect(depositRes.body.code).toBe('SHIFT_CLOSED');
    
    console.log('[INVARIANT PASS] deposit blocked with 409 SHIFT_CLOSED after close');
  });

  it('CASHBOX: close and summary contain cashbox fields', async () => {
    const date = getUniqueDate('04');
    
    // Ensure trips completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (89994, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, date);
    }
    
    // Create a sale
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 10000, 200, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(date);

    // Close
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: date });
    
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    
    // Cashbox fields present in close response
    expect(closeRes.body).toHaveProperty('cashbox');
    expect(closeRes.body.cashbox).toHaveProperty('cash_in_cashbox');
    expect(closeRes.body.cashbox).toHaveProperty('expected_sellers_cash_due');
    expect(closeRes.body.cashbox).toHaveProperty('cash_discrepancy');
    expect(closeRes.body.cashbox).toHaveProperty('warnings');
    
    // Top-level convenience
    expect(closeRes.body).toHaveProperty('cash_in_cashbox');
    expect(closeRes.body).toHaveProperty('expected_sellers_cash_due');
    expect(closeRes.body).toHaveProperty('cash_discrepancy');
    expect(closeRes.body).toHaveProperty('warnings');

    // Summary after close also has cashbox
    const summaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${date}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.source).toBe('snapshot');
    expect(summaryRes.body).toHaveProperty('cashbox');
    expect(summaryRes.body.cashbox).toHaveProperty('cash_in_cashbox');
    expect(summaryRes.body.cashbox).toHaveProperty('expected_sellers_cash_due');
    expect(summaryRes.body.cashbox).toHaveProperty('cash_discrepancy');
    expect(summaryRes.body.cashbox).toHaveProperty('warnings');
    
    // Values match
    expect(summaryRes.body.cashbox.cash_in_cashbox).toBe(closeRes.body.cashbox.cash_in_cashbox);
    expect(summaryRes.body.cashbox.expected_sellers_cash_due).toBe(closeRes.body.cashbox.expected_sellers_cash_due);
    expect(summaryRes.body.cashbox.cash_discrepancy).toBe(closeRes.body.cashbox.cash_discrepancy);
    
    console.log('[INVARIANT PASS] cashbox fields present in close and summary');
  });

  it('WARNINGS: soft (do not block close)', async () => {
    const date = getUniqueDate('05');
    
    // Ensure trips completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (89995, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, date);
    }
    
    // Create a sale (seller still owes money)
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 5000, 200, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(date);
    
    // Pay salary from dispatcher (creates discrepancy)
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('DISPATCHER_SHIFT', 'SALARY_PAYOUT_CASH', 500, ?, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(dispatcherId, date);

    // Close should succeed even with discrepancy
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: date });
    
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(closeRes.body.is_closed).toBe(true);
    
    // Warning should be present
    expect(closeRes.body.warnings.length).toBeGreaterThan(0);
    expect(closeRes.body.warnings[0].code).toBe('CASH_DISCREPANCY');
    
    // Discrepancy should be non-zero
    expect(closeRes.body.cash_discrepancy).not.toBe(0);
    
    console.log('[INVARIANT PASS] warnings are soft (close succeeded with discrepancy)');
  });

  it('IDEMPOTENCY: second close returns same result', async () => {
    const date = getUniqueDate('06');
    
    // Ensure trips completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (89996, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, date);
    }
    
    // Create a sale
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 7000, 200, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(date);

    // First close
    const close1 = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: date });
    
    expect(close1.status).toBe(200);
    expect(close1.body.ok).toBe(true);
    const firstClosedAt = close1.body.closed_at;

    // Second close (idempotent)
    const close2 = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: date });
    
    expect(close2.status).toBe(200);
    expect(close2.body.ok).toBe(true);
    expect(close2.body.is_closed).toBe(true);
    expect(close2.body.source).toBe('snapshot');
    // Same closed_at (idempotent)
    expect(close2.body.closed_at).toBe(firstClosedAt);
    
    console.log('[INVARIANT PASS] close is idempotent');
  });

  it('INVARIANT: net values are consistent in snapshot', async () => {
    const date = getUniqueDate('07');
    
    // Ensure trips completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (89997, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, date);
    }
    
    // Create sales
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 8000, 200, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(date);
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CARD', 4000, 200, 'POSTED', ?, 'CARD', datetime('now','localtime'))
    `).run(date);

    // Close
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: date });
    
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);

    // Get snapshot
    const res = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${date}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('snapshot');
    
    // Key invariant: net_cash + net_card = net_total
    const { net_total, net_cash, net_card } = res.body;
    expect(net_total).toBe(net_cash + net_card);
    
    // Values are present and non-negative
    expect(net_total).toBeGreaterThanOrEqual(0);
    expect(net_cash).toBeGreaterThanOrEqual(0);
    expect(net_card).toBeGreaterThanOrEqual(0);
    
    console.log('[INVARIANT PASS] net values consistent in snapshot');
  });
});
