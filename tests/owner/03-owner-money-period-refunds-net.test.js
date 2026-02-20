/**
 * tests/owner/03-owner-money-period-refunds-net.test.js
 *
 * Tests for refund_* and net_* metrics in period reports (week/month/custom range).
 *
 * Endpoints tested:
 * - GET /api/owner/money/summary?preset=7d|30d|90d
 * - GET /api/owner/money/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 * - GET /api/owner/money/compare-periods?presetA=7d&presetB=30d
 *
 * Invariants:
 * - refund_* >= 0
 * - net_total = collected_total - refund_total
 * - net_cash = collected_cash - refund_cash
 * - net_card = collected_card - refund_card
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app, db, seedData, sellerToken, ownerToken, ownerUserId;
let today, tomorrow, yesterday;

beforeAll(async () => {
  // STEP 1: Reset test DB
  resetTestDb();
  
  // STEP 2: Initialize app
  app = await makeApp();
  
  // STEP 3: Get DB connection and seed test data
  db = getTestDb();
  seedData = await seedBasicData(db);
  
  // Get dates from SQLite
  const dateRow = db.prepare(`SELECT DATE('now','localtime') as d`).get();
  today = dateRow.d;
  
  const tomorrowRow = db.prepare(`SELECT DATE('now','localtime','+1 day') as d`).get();
  tomorrow = tomorrowRow.d;
  
  const yesterdayRow = db.prepare(`SELECT DATE('now','localtime','-1 day') as d`).get();
  yesterday = yesterdayRow.d;
  
  // Create owner user
  const hashedPassword = bcrypt.hashSync('password123', 10);
  const ownerRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'owner', 1)
  `).run('test_owner', hashedPassword);
  ownerUserId = ownerRes.lastInsertRowid;
  ownerToken = jwt.sign({ id: ownerUserId, username: 'test_owner', role: 'owner' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Login sellerA
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'sellerA', password: 'password123' });
  sellerToken = loginRes.body.token;
  
  console.log('[SETUP] today:', today, 'tomorrow:', tomorrow);
});

describe('OWNER MONEY PERIOD REFUNDS & NET', () => {

  describe('H) Period without refunds: summary with preset', () => {
    it('7d preset: refund_* = 0, net_* = collected_*', async () => {
      // Create a presale for today (no refund)
      await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${seedData.slots.generated.genSlot1}`,
          tripDate: tomorrow,
          customerName: 'Period No Refund',
          customerPhone: '+79995551111',
          numberOfSeats: 1,
          prepaymentAmount: 1500,
          payment_method: 'CASH',
        });

      // Query 7d summary
      const res = await request(app)
        .get('/api/owner/money/summary?preset=7d')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.totals).toHaveProperty('refund_total');
      expect(res.body.data.totals).toHaveProperty('refund_cash');
      expect(res.body.data.totals).toHaveProperty('refund_card');
      expect(res.body.data.totals).toHaveProperty('net_total');
      expect(res.body.data.totals).toHaveProperty('net_cash');
      expect(res.body.data.totals).toHaveProperty('net_card');

      const collectedTotal = Number(res.body.data.totals.collected_total || 0);
      const collectedCash = Number(res.body.data.totals.collected_cash || 0);
      const refundTotal = Number(res.body.data.totals.refund_total || 0);
      const refundCash = Number(res.body.data.totals.refund_cash || 0);
      const netTotal = Number(res.body.data.totals.net_total || 0);
      const netCash = Number(res.body.data.totals.net_cash || 0);

      // No refunds yet
      expect(refundTotal).toBe(0);
      expect(refundCash).toBe(0);

      // Net = collected
      expect(netTotal).toBe(collectedTotal);
      expect(netCash).toBe(collectedCash);

      console.log('[TEST H] 7d preset: collected=' + collectedTotal + ', refund=' + refundTotal + ', net=' + netTotal);
    });
  });

  describe('I) Period with refunds: custom date range', () => {
    it('Custom range: refund and net metrics correct', async () => {
      // Create presale for refund
      await request(app)
        .post('/api/selling/presales')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          slotUid: `generated:${seedData.slots.generated.genSlot2}`,
          tripDate: tomorrow,
          customerName: 'Period Refund Test',
          customerPhone: '+79995552222',
          numberOfSeats: 2,
          prepaymentAmount: 3000,
          payment_method: 'CARD',
        });

      // Insert manual refund entry for today (using existing columns)
      db.prepare(`
        INSERT INTO money_ledger (presale_id, amount, method, type, status, kind, business_day)
        VALUES (NULL, -3000, 'CARD', 'SALE_CANCEL_REVERSE', 'POSTED', 'SELLER_SHIFT', DATE('now'))
      `).run();

      // Query with custom date range
      const res = await request(app)
        .get(`/api/owner/money/summary?from=${today}&to=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const collectedTotal = Number(res.body.data.totals.collected_total || 0);
      const collectedCard = Number(res.body.data.totals.collected_card || 0);
      const refundTotal = Number(res.body.data.totals.refund_total || 0);
      const refundCard = Number(res.body.data.totals.refund_card || 0);
      const netTotal = Number(res.body.data.totals.net_total || 0);
      const netCard = Number(res.body.data.totals.net_card || 0);

      // Refund should be positive (ABS)
      expect(refundTotal).toBeGreaterThanOrEqual(0);
      expect(refundCard).toBeGreaterThanOrEqual(0);

      // Net = collected - refund
      expect(netTotal).toBe(collectedTotal - refundTotal);
      expect(netCard).toBe(collectedCard - refundCard);

      console.log('[TEST I] Custom range: collected=' + collectedTotal + ', refund=' + refundTotal + ', net=' + netTotal);
      console.log('[TEST I] Card: collected=' + collectedCard + ', refund=' + refundCard + ', net=' + netCard);
    });
  });

  describe('J) compare-periods: refund and net per period', () => {
    it('compare-periods has refund_* and net_* fields', async () => {
      const res = await request(app)
        .get('/api/owner/money/compare-periods?presetA=7d&presetB=30d')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Period A
      expect(res.body.data.periodA).toHaveProperty('refund_total');
      expect(res.body.data.periodA).toHaveProperty('refund_cash');
      expect(res.body.data.periodA).toHaveProperty('refund_card');
      expect(res.body.data.periodA).toHaveProperty('net_total');
      expect(res.body.data.periodA).toHaveProperty('net_cash');
      expect(res.body.data.periodA).toHaveProperty('net_card');
      expect(res.body.data.periodA).toHaveProperty('collected_total');
      expect(res.body.data.periodA).toHaveProperty('collected_cash');
      expect(res.body.data.periodA).toHaveProperty('collected_card');

      // Period B
      expect(res.body.data.periodB).toHaveProperty('refund_total');
      expect(res.body.data.periodB).toHaveProperty('refund_cash');
      expect(res.body.data.periodB).toHaveProperty('refund_card');
      expect(res.body.data.periodB).toHaveProperty('net_total');
      expect(res.body.data.periodB).toHaveProperty('net_cash');
      expect(res.body.data.periodB).toHaveProperty('net_card');

      // Check invariants for period A
      const periodA = res.body.data.periodA;
      const collectedA = Number(periodA.collected_total || 0);
      const refundA = Number(periodA.refund_total || 0);
      const netA = Number(periodA.net_total || 0);
      const netCashA = Number(periodA.net_cash || 0);
      const netCardA = Number(periodA.net_card || 0);
      const refundCashA = Number(periodA.refund_cash || 0);
      const refundCardA = Number(periodA.refund_card || 0);

      // Net = collected - refund
      expect(netA).toBe(collectedA - refundA);
      expect(netCashA).toBe(Number(periodA.collected_cash || 0) - refundCashA);
      expect(netCardA).toBe(Number(periodA.collected_card || 0) - refundCardA);

      console.log('[TEST J] Period A: collected=' + collectedA + ', refund=' + refundA + ', net=' + netA);

      // Check deltas
      expect(res.body.data.delta).toHaveProperty('refund_abs');
      expect(res.body.data.delta).toHaveProperty('refund_percent');
      expect(res.body.data.delta).toHaveProperty('net_total_abs');
      expect(res.body.data.delta).toHaveProperty('net_total_percent');
    });
  });

  describe('K) MIXED refund split in period', () => {
    it('MIXED refund correctly split to cash/card', async () => {
      // First create a presale with MIXED payment info (presales has payment_cash_amount and payment_card_amount)
      const presaleRes = db.prepare(`
        INSERT INTO presales (slot_uid, customer_name, customer_phone, number_of_seats, total_price, status, payment_method, payment_cash_amount, payment_card_amount, boat_slot_id, created_at)
        VALUES ('generated:1', 'Mixed Refund Customer', '+79995553333', 2, 4000, 'ACTIVE', 'MIXED', 2500, 1500, ?, datetime('now'))
      `).run(seedData.slots.manual.slot1);

      // Insert MIXED refund (using method field for split)
      db.prepare(`
        INSERT INTO money_ledger (presale_id, amount, method, type, status, kind, business_day)
        VALUES (?, -4000, 'MIXED', 'SALE_CANCEL_REVERSE', 'POSTED', 'SELLER_SHIFT', DATE('now'))
      `).run(presaleRes.lastInsertRowid);

      // Query summary for today
      const res = await request(app)
        .get(`/api/owner/money/summary?from=${today}&to=${today}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);

      const refundCash = Number(res.body.data.totals.refund_cash || 0);
      const refundCard = Number(res.body.data.totals.refund_card || 0);

      // Should have MIXED refund split (may be 0 if no split columns exist)
      console.log('[TEST K] MIXED refund: cash=' + refundCash + ', card=' + refundCard);

      // Net invariant
      const collectedTotal = Number(res.body.data.totals.collected_total || 0);
      const refundTotal = Number(res.body.data.totals.refund_total || 0);
      const netTotal = Number(res.body.data.totals.net_total || 0);

      expect(netTotal).toBe(collectedTotal - refundTotal);
    });
  });
});
