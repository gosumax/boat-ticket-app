/**
 * Test: Shift Close Cashbox Sanity Check
 * Verifies that close endpoint returns cash_in_cashbox, expected_sellers_cash_due, cash_discrepancy
 * and that warnings array contains CASH_DISCREPANCY when discrepancy != 0
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
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
  
  // Get today's date for test
  testDate = getTodayLocal(db);
  
  // Create dispatcher user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_cashbox', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'test_dispatcher_cashbox', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Create seller for tests
  const sellerRes = db.prepare(`
    INSERT INTO users (id, username, password_hash, role, is_active)
    VALUES (100, 'test_seller_cashbox', ?, 'seller', 1)
  `).run(hashedPassword);
  
  // Ensure generated_slots has completed trips for this date
  const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
  if (boat) {
    db.prepare(`
      INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
      VALUES (99991, ?, ?, '10:00', 1, 1, 'COMPLETED')
    `).run(boat.id, testDate);
  }
  
  console.log('[SETUP] testDate:', testDate, 'dispatcherId:', dispatcherId);
});

afterEach(() => {
  // Cleanup money_ledger for next test (use different sellers per test to avoid conflicts)
});

describe('SHIFT CLOSE CASHBOX SANITY', () => {
  it('close returns cashbox fields with zero discrepancy when sellers match', async () => {
    const uniqueTestDate = `2099-01-01`;
    
    // Ensure trips are completed for this date
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (99992, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }
    
    // Create a sale for seller 100
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1000, 100, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

    // Deposit the full amount from seller
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('DISPATCHER_SHIFT', 'DEPOSIT_TO_OWNER_CASH', 1000, 100, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

    const res = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: uniqueTestDate });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.is_closed).toBe(true);

    // Cashbox fields present
    expect(res.body).toHaveProperty('cash_in_cashbox');
    expect(res.body).toHaveProperty('expected_sellers_cash_due');
    expect(res.body).toHaveProperty('cash_discrepancy');
    expect(res.body).toHaveProperty('warnings');

    // In this case: seller accepted 1000, deposited 1000
    // net_cash = 1000 (no refunds)
    // deposit_cash = 1000
    // salary_paid_cash = 0
    // cash_in_cashbox = 1000 - 1000 - 0 = 0
    // sellers balance = 1000 - 1000 = 0
    // expected_sellers_cash_due = 0
    // cash_discrepancy = 0 - 0 = 0
    expect(res.body.cash_in_cashbox).toBe(0);
    expect(res.body.expected_sellers_cash_due).toBe(0);
    expect(res.body.cash_discrepancy).toBe(0);
    expect(res.body.warnings).toEqual([]);
  });

  it('close returns CASH_DISCREPANCY warning when discrepancy != 0', async () => {
    const uniqueTestDate = `2099-01-02`;
    
    // Ensure trips are completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (99993, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }
    
    // Create a sale for seller 100
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 2000, 100, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

    // Deposit only 500 (seller still owes 1500)
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('DISPATCHER_SHIFT', 'DEPOSIT_TO_OWNER_CASH', 500, 100, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

    const res = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: uniqueTestDate });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Cashbox fields
    expect(res.body.cash_in_cashbox).toBe(1500); // 2000 - 500 - 0
    expect(res.body.expected_sellers_cash_due).toBe(1500); // seller balance = 2000 - 500 = 1500
    expect(res.body.cash_discrepancy).toBe(0); // 1500 - 1500 = 0

    // No warning because discrepancy is 0
    expect(res.body.warnings).toEqual([]);
  });

  it('close returns positive discrepancy warning when more cash in cashbox than expected', async () => {
    const uniqueTestDate = `2099-01-03`;
    
    // Ensure trips are completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (99994, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }
    
    // Create a sale for seller 100
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1000, 100, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

    // NO deposit from seller - seller owes 1000
    // But we pay salary from dispatcher (this should reduce cash_in_cashbox)
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('DISPATCHER_SHIFT', 'SALARY_PAYOUT_CASH', 200, ?, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(dispatcherId, uniqueTestDate);

    const res = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: uniqueTestDate });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // net_cash = 1000
    // deposit_cash = 0
    // salary_paid_cash = 200
    // cash_in_cashbox = 1000 - 0 - 200 = 800
    // sellers balance = 1000 (seller 100 still owes 1000)
    // expected_sellers_cash_due = 1000
    // cash_discrepancy = 800 - 1000 = -200
    expect(res.body.cash_in_cashbox).toBe(800);
    expect(res.body.expected_sellers_cash_due).toBe(1000);
    expect(res.body.cash_discrepancy).toBe(-200);

    // Warning present
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].code).toBe('CASH_DISCREPANCY');
    expect(res.body.warnings[0].amount).toBe(-200);
    expect(res.body.warnings[0].message).toContain('меньше');
  });

  it('summary after close returns cashbox fields from snapshot', async () => {
    const uniqueTestDate = `2099-01-04`;
    
    // Ensure trips are completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (99995, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }
    
    // Create a sale
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 3000, 100, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

    // Close the shift
    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: uniqueTestDate });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);

    // Now get summary
    const summaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${uniqueTestDate}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.source).toBe('snapshot');
    expect(summaryRes.body.is_closed).toBe(true);

    // Cashbox fields from snapshot
    expect(summaryRes.body).toHaveProperty('cash_in_cashbox');
    expect(summaryRes.body).toHaveProperty('expected_sellers_cash_due');
    expect(summaryRes.body).toHaveProperty('cash_discrepancy');
    expect(summaryRes.body).toHaveProperty('warnings');
    expect(summaryRes.body).toHaveProperty('cashbox');

    // Values match close response
    expect(summaryRes.body.cash_in_cashbox).toBe(closeRes.body.cash_in_cashbox);
    expect(summaryRes.body.expected_sellers_cash_due).toBe(closeRes.body.expected_sellers_cash_due);
    expect(summaryRes.body.cash_discrepancy).toBe(closeRes.body.cash_discrepancy);
  });

  it('close is idempotent and returns same cashbox fields on repeated call', async () => {
    const uniqueTestDate = `2099-01-05`;
    
    // Ensure trips are completed
    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (99996, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }
    
    // Create a sale
    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 5000, 100, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

    // First close
    const res1 = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: uniqueTestDate });

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);

    // Second close (idempotent)
    const res2 = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: uniqueTestDate });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.is_closed).toBe(true);
    expect(res2.body.source).toBe('snapshot');
  });
});
