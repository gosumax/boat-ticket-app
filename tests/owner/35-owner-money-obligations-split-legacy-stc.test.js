import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app;
let db;
let seedData;
let ownerToken;

describe('OWNER MONEY SUMMARY: tomorrow obligations split survives legacy STC mismatch', () => {
  beforeAll(async () => {
    resetTestDb();
    app = await makeApp();
    db = getTestDb();
    seedData = await seedBasicData(db);

    const hashedPassword = bcrypt.hashSync('password123', 10);
    const ownerRes = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, 'owner', 1)
    `).run('test_owner_obligations_split', hashedPassword);
    ownerToken = jwt.sign(
      { id: ownerRes.lastInsertRowid, username: 'test_owner_obligations_split', role: 'owner' },
      JWT_SECRET,
      { expiresIn: '24h' },
    );
  });

  it('keeps tomorrow cash/card split from payment-day ledger even when STC business_day follows trip day', async () => {
    const businessDay = '2026-04-02';
    const tomorrow = '2026-04-03';
    const sellerId = Number(seedData?.users?.sellerA?.id || 0);
    const dispatcherId = Number(seedData?.users?.dispatcher?.id || 0);
    const todaySlotId = Number(seedData?.slots?.manual?.slot1 || 0);
    const tomorrowSlotId = Number(seedData?.slots?.manual?.slot2 || 0);
    const tomorrowGeneratedId = Number(seedData?.slots?.generated?.genSlot1 || 0);

    expect(sellerId).toBeGreaterThan(0);
    expect(dispatcherId).toBeGreaterThan(0);
    expect(todaySlotId).toBeGreaterThan(0);
    expect(tomorrowSlotId).toBeGreaterThan(0);
    expect(tomorrowGeneratedId).toBeGreaterThan(0);

    db.prepare(`UPDATE boat_slots SET trip_date = ? WHERE id = ?`).run(businessDay, todaySlotId);
    db.prepare(`UPDATE boat_slots SET trip_date = ? WHERE id = ?`).run(tomorrow, tomorrowSlotId);
    db.prepare(`UPDATE generated_slots SET trip_date = ? WHERE id = ?`).run(tomorrow, tomorrowGeneratedId);
    db.prepare(`INSERT OR IGNORE INTO owner_settings (id, settings_json) VALUES (1, '{}')`).run();
    db.prepare(`UPDATE owner_settings SET settings_json = ? WHERE id = 1`).run(JSON.stringify({
      motivationType: 'team',
      motivation_percent: 0.15,
      team_share: 0.5,
      individual_share: 0.5,
      teamIncludeSellers: true,
      teamIncludeDispatchers: true,
      dispatcher_withhold_percent_total: 0.002,
      weekly_withhold_percent_total: 0.008,
      season_withhold_percent_total: 0.005,
      viklif_withhold_percent_total: 0,
    }));
    db.prepare(`DELETE FROM motivation_day_settings WHERE business_day IN (?, ?)`).run(businessDay, tomorrow);

    const insertPresale = db.prepare(`
      INSERT INTO presales (
        boat_slot_id,
        customer_name,
        customer_phone,
        number_of_seats,
        total_price,
        prepayment_amount,
        status,
        slot_uid,
        payment_method,
        payment_cash_amount,
        payment_card_amount,
        seller_id,
        business_day
      )
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)
    `);

    const insertLedger = db.prepare(`
      INSERT INTO money_ledger (
        presale_id,
        slot_id,
        trip_day,
        business_day,
        kind,
        type,
        method,
        amount,
        status,
        seller_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?)
    `);

    const insertStc = db.prepare(`
      INSERT INTO sales_transactions_canonical (
        presale_id,
        slot_id,
        slot_uid,
        slot_source,
        amount,
        cash_amount,
        card_amount,
        method,
        status,
        business_day
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'VALID', ?)
    `);

    const todayPresale = insertPresale.run(
      todaySlotId,
      'Today Split Activator',
      '+79990000001',
      1,
      1000,
      1000,
      null,
      'CASH',
      1000,
      0,
      sellerId,
      businessDay,
    );
    insertLedger.run(
      todayPresale.lastInsertRowid,
      todaySlotId,
      businessDay,
      businessDay,
      'SELLER_SHIFT',
      'SALE_ACCEPTED_CASH',
      'CASH',
      1000,
      sellerId,
    );
    insertStc.run(
      todayPresale.lastInsertRowid,
      todaySlotId,
      null,
      'boat_slots',
      1000,
      1000,
      0,
      'CASH',
      businessDay,
    );

    const tomorrowCashPresale = insertPresale.run(
      tomorrowSlotId,
      'Tomorrow Cash',
      '+79990000002',
      1,
      2200,
      2200,
      `generated:${tomorrowGeneratedId}`,
      'CASH',
      2200,
      0,
      dispatcherId,
      tomorrow,
    );
    insertLedger.run(
      tomorrowCashPresale.lastInsertRowid,
      tomorrowSlotId,
      tomorrow,
      businessDay,
      'DISPATCHER_SHIFT',
      'SALE_ACCEPTED_CASH',
      'CASH',
      2200,
      dispatcherId,
    );
    insertStc.run(
      tomorrowCashPresale.lastInsertRowid,
      tomorrowSlotId,
      `generated:${tomorrowGeneratedId}`,
      'generated_slots',
      2200,
      2200,
      0,
      'CASH',
      tomorrow,
    );

    const tomorrowCardPresale = insertPresale.run(
      tomorrowSlotId,
      'Tomorrow Card',
      '+79990000003',
      1,
      11000,
      11000,
      `generated:${tomorrowGeneratedId}`,
      'CARD',
      0,
      11000,
      dispatcherId,
      tomorrow,
    );
    insertLedger.run(
      tomorrowCardPresale.lastInsertRowid,
      tomorrowSlotId,
      tomorrow,
      businessDay,
      'DISPATCHER_SHIFT',
      'SALE_ACCEPTED_CARD',
      'CARD',
      11000,
      dispatcherId,
    );
    insertStc.run(
      tomorrowCardPresale.lastInsertRowid,
      tomorrowSlotId,
      `generated:${tomorrowGeneratedId}`,
      'generated_slots',
      11000,
      0,
      11000,
      'CARD',
      tomorrow,
    );

    const res = await request(app)
      .get(`/api/owner/money/summary?from=${businessDay}&to=${businessDay}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);

    const ownerDecisionMetrics = res.body?.data?.owner_decision_metrics || {};
    const totals = res.body?.data?.totals || {};

    expect(Number(ownerDecisionMetrics.obligations_tomorrow_cash || 0)).toBeCloseTo(2200, 6);
    expect(Number(ownerDecisionMetrics.obligations_tomorrow_card || 0)).toBeCloseTo(11000, 6);
    expect(Number(ownerDecisionMetrics.obligations_tomorrow_total || 0)).toBeCloseTo(13200, 6);
    expect(Number(totals.obligations_tomorrow_cash || 0)).toBeCloseTo(2200, 6);
    expect(Number(totals.obligations_tomorrow_card || 0)).toBeCloseTo(11000, 6);
    expect(Number(totals.obligations_tomorrow_total || 0)).toBeCloseTo(13200, 6);
  });
});
