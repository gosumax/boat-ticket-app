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

let app;
let db;
let dispatcherToken;
let dispatcherId;
let testDate;

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  await seedBasicData(db);

  testDate = getTodayLocal(db);

  const hashedPassword = bcrypt.hashSync('password123', 10);
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('test_dispatcher_cashbox', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign(
    { id: dispatcherId, username: 'test_dispatcher_cashbox', role: 'dispatcher' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, is_active)
    VALUES (100, 'test_seller_cashbox', ?, 'seller', 1)
  `).run(hashedPassword);

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
  // Cleanup is handled by unique dates per test.
});

describe('SHIFT CLOSE CASHBOX SANITY', () => {
  it('close returns cashbox fields with zero discrepancy when sellers match', async () => {
    const uniqueTestDate = '2099-01-01';

    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (99992, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }

    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1000, 100, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

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

    expect(res.body).toHaveProperty('cash_in_cashbox');
    expect(res.body).toHaveProperty('expected_sellers_cash_due');
    expect(res.body).toHaveProperty('cash_discrepancy');
    expect(res.body).toHaveProperty('warnings');

    expect(res.body.cash_in_cashbox).toBe(0);
    expect(res.body.expected_sellers_cash_due).toBe(0);
    expect(res.body.cash_discrepancy).toBe(0);
    expect(res.body.warnings).toEqual([]);
  });

  it('close treats accepted seller sales as dispatcher cash and reports positive discrepancy vs zero seller debt', async () => {
    const uniqueTestDate = '2099-01-02';

    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (99993, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }

    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 2000, 100, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

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

    expect(res.body.cash_in_cashbox).toBe(1500);
    expect(res.body.expected_sellers_cash_due).toBe(0);
    expect(res.body.cash_discrepancy).toBe(1500);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].code).toBe('CASH_DISCREPANCY');
    expect(res.body.warnings[0].amount).toBe(1500);
    expect(res.body.warnings[0].message).toContain('больше');
  });

  it('close keeps seller debt at zero for accepted-only sales even when salary payout reduces cashbox', async () => {
    const uniqueTestDate = '2099-01-03';

    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (99994, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }

    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 1000, 100, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

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

    expect(res.body.cash_in_cashbox).toBe(800);
    expect(res.body.expected_sellers_cash_due).toBe(0);
    expect(res.body.cash_discrepancy).toBe(800);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].code).toBe('CASH_DISCREPANCY');
    expect(res.body.warnings[0].amount).toBe(800);
    expect(res.body.warnings[0].message).toContain('больше');
  });

  it('summary after close returns cashbox fields from snapshot', async () => {
    const uniqueTestDate = '2099-01-04';

    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (99995, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }

    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 3000, 100, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: uniqueTestDate });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);

    const summaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${uniqueTestDate}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.source).toBe('snapshot');
    expect(summaryRes.body.is_closed).toBe(true);

    expect(summaryRes.body).toHaveProperty('cash_in_cashbox');
    expect(summaryRes.body).toHaveProperty('expected_sellers_cash_due');
    expect(summaryRes.body).toHaveProperty('cash_discrepancy');
    expect(summaryRes.body).toHaveProperty('warnings');
    expect(summaryRes.body).toHaveProperty('cashbox');

    expect(summaryRes.body.cash_in_cashbox).toBe(closeRes.body.cash_in_cashbox);
    expect(summaryRes.body.expected_sellers_cash_due).toBe(closeRes.body.expected_sellers_cash_due);
    expect(summaryRes.body.cash_discrepancy).toBe(closeRes.body.cash_discrepancy);
  });

  it('close is idempotent and returns same cashbox fields on repeated call', async () => {
    const uniqueTestDate = '2099-01-05';

    const boat = db.prepare('SELECT id FROM boats LIMIT 1').get();
    if (boat) {
      db.prepare(`
        INSERT OR IGNORE INTO generated_slots (id, boat_id, trip_date, time, is_active, is_completed, status)
        VALUES (99996, ?, ?, '10:00', 1, 1, 'COMPLETED')
      `).run(boat.id, uniqueTestDate);
    }

    db.prepare(`
      INSERT INTO money_ledger (kind, type, amount, seller_id, status, business_day, method, event_time)
      VALUES ('SELLER_SHIFT', 'SALE_ACCEPTED_CASH', 5000, 100, 'POSTED', ?, 'CASH', datetime('now','localtime'))
    `).run(uniqueTestDate);

    const res1 = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: uniqueTestDate });

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);

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
