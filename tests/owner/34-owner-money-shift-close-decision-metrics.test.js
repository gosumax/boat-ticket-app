import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { getTodayLocal, getTomorrowLocal } from '../_helpers/testDates.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';

let app;
let db;
let seedData;
let ownerToken;
let dispatcherToken;
let sellerToken;
let today;
let tomorrow;
let day2;

describe('OWNER MONEY SUMMARY: SHIFT CLOSE DECISION METRICS', () => {
  beforeAll(async () => {
    resetTestDb();
    app = await makeApp();
    db = getTestDb();
    seedData = await seedBasicData(db);
    today = getTodayLocal(db);
    tomorrow = getTomorrowLocal(db);
    day2 = db.prepare(`SELECT DATE(?, '+1 day') AS d`).get(tomorrow)?.d;

    const hashedPassword = bcrypt.hashSync('password123', 10);

    const ownerRes = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, 'owner', 1)
    `).run('test_owner_shift_close_metrics', hashedPassword);
    ownerToken = jwt.sign(
      { id: ownerRes.lastInsertRowid, username: 'test_owner_shift_close_metrics', role: 'owner' },
      JWT_SECRET,
      { expiresIn: '24h' },
    );

    const dispatcherRes = db.prepare(`
      INSERT INTO users (username, password_hash, role, is_active)
      VALUES (?, ?, 'dispatcher', 1)
    `).run('test_dispatcher_shift_close_metrics', hashedPassword);
    dispatcherToken = jwt.sign(
      { id: dispatcherRes.lastInsertRowid, username: 'test_dispatcher_shift_close_metrics', role: 'dispatcher' },
      JWT_SECRET,
      { expiresIn: '24h' },
    );

    const sellerLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'sellerA', password: 'password123' });
    sellerToken = sellerLoginRes.body.token;
  });

  it('owner decision metrics match dispatcher shift summary for the same day', async () => {
    const sourceGeneratedSlot = db.prepare(`
      SELECT schedule_template_id, boat_id, price_adult, price_child, price_teen, duration_minutes, seller_cutoff_minutes
      FROM generated_slots
      WHERE id = ?
    `).get(seedData.slots.generated.genSlot1);

    const day2SlotRes = db.prepare(`
      INSERT INTO generated_slots (
        schedule_template_id, boat_id, time, trip_date, capacity, seats_left,
        price_adult, price_child, price_teen, duration_minutes, is_active, seller_cutoff_minutes
      )
      VALUES (?, ?, '16:00', ?, 2, 2, ?, ?, ?, ?, 1, ?)
    `).run(
      sourceGeneratedSlot.schedule_template_id,
      sourceGeneratedSlot.boat_id,
      day2,
      sourceGeneratedSlot.price_adult,
      sourceGeneratedSlot.price_child,
      sourceGeneratedSlot.price_teen,
      sourceGeneratedSlot.duration_minutes,
      sourceGeneratedSlot.seller_cutoff_minutes,
    );

    const createPresaleRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        slotUid: `generated:${seedData.slots.generated.genSlot1}`,
        tripDate: tomorrow,
        customerName: 'Shift Close Sync Customer',
        customerPhone: '+79993334455',
        numberOfSeats: 2,
        prepaymentAmount: 2000,
        payment_method: 'MIXED',
        cash_amount: 1200,
        card_amount: 800,
      });

    expect(createPresaleRes.status).toBe(201);

    const createDay2PresaleRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        slotUid: `generated:${day2SlotRes.lastInsertRowid}`,
        tripDate: day2,
        customerName: 'Shift Close Day2 Customer',
        customerPhone: '+79990001122',
        numberOfSeats: 1,
        prepaymentAmount: 500,
        payment_method: 'CASH',
      });

    expect(createDay2PresaleRes.status).toBe(201);

    const dispatcherSummaryRes = await request(app)
      .get(`/api/dispatcher/shift-ledger/summary?business_day=${today}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    expect(dispatcherSummaryRes.status).toBe(200);
    expect(dispatcherSummaryRes.body?.ok).toBe(true);

    const ownerSummaryRes = await request(app)
      .get(`/api/owner/money/summary?from=${today}&to=${today}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerSummaryRes.status).toBe(200);
    expect(ownerSummaryRes.body?.ok).toBe(true);

    const ownerData = ownerSummaryRes.body?.data || {};
    const ownerDecisionMetrics = ownerData.owner_decision_metrics || {};
    const ownerTotals = ownerData.totals || {};
    const dispatcherBody = dispatcherSummaryRes.body || {};
    const dispatcherWithhold = dispatcherBody.motivation_withhold || {};
    const dispatcherShiftCloseTotals = dispatcherBody.shift_close_breakdown?.totals || {};
    const motivationDayRes = await request(app)
      .get(`/api/owner/motivation/day?day=${today}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(motivationDayRes.status).toBe(200);
    expect(motivationDayRes.body?.ok).toBe(true);
    const motivationDayWithhold = motivationDayRes.body?.data?.withhold || {};

    expect(ownerDecisionMetrics.business_day).toBe(today);
    expect(ownerDecisionMetrics.source).toBe('shift_close_breakdown');

    expect(Number(ownerDecisionMetrics.can_take_cash_today || 0)).toBeCloseTo(Number(dispatcherBody.owner_cash_today || 0), 6);
    expect(Number(ownerDecisionMetrics.received_cash_today || 0)).toBeCloseTo(Number(dispatcherBody.collected_cash || 0), 6);
    expect(Number(ownerDecisionMetrics.received_card_today || 0)).toBeCloseTo(Number(dispatcherBody.collected_card || 0), 6);
    expect(Number(ownerDecisionMetrics.received_total_today || 0)).toBeCloseTo(Number(dispatcherBody.collected_total || 0), 6);
    expect(Number(ownerDecisionMetrics.withhold_weekly_today || 0)).toBeCloseTo(Number(dispatcherBody.weekly_fund || 0), 6);
    expect(Number(ownerDecisionMetrics.withhold_season_today || 0)).toBeCloseTo(
      Number(
        dispatcherShiftCloseTotals.season_from_revenue ??
        dispatcherWithhold.season_from_revenue ??
        dispatcherWithhold.season_amount ??
        0
      ),
      6
    );
    expect(Number(ownerDecisionMetrics.obligations_tomorrow_cash || 0)).toBeCloseTo(1200, 6);
    expect(Number(ownerDecisionMetrics.obligations_tomorrow_card || 0)).toBeCloseTo(800, 6);
    expect(Number(ownerDecisionMetrics.obligations_tomorrow_total || 0)).toBeCloseTo(2000, 6);
    expect(Number(ownerDecisionMetrics.reserve_future_cash || 0)).toBeCloseTo(Number(dispatcherBody.future_trips_reserve_cash || 0), 6);
    expect(Number(ownerDecisionMetrics.reserve_future_card || 0)).toBeCloseTo(Number(dispatcherBody.future_trips_reserve_card || 0), 6);
    expect(Number(ownerDecisionMetrics.reserve_future_total || 0)).toBeCloseTo(Number(dispatcherBody.future_trips_reserve_total || 0), 6);
    expect(Number(ownerDecisionMetrics.reserve_future_total || 0)).toBeCloseTo(2500, 6);
    expect(Number(ownerDecisionMetrics.reserve_future_total || 0)).toBeGreaterThan(Number(ownerDecisionMetrics.obligations_tomorrow_total || 0));

    expect(Number(ownerTotals.owner_cash_today || 0)).toBeCloseTo(Number(dispatcherBody.owner_cash_today || 0), 6);
    expect(Number(ownerTotals.weekly_fund || 0)).toBeCloseTo(Number(dispatcherBody.weekly_fund || 0), 6);
    expect(Number(ownerTotals.funds_withhold_weekly_today || 0)).toBeCloseTo(Number(motivationDayWithhold.weekly_amount || 0), 6);
    expect(Number(ownerTotals.funds_withhold_season_today || 0)).toBeCloseTo(Number(motivationDayWithhold.season_amount || 0), 6);
    expect(Number(ownerTotals.season_fund_total || 0)).toBeCloseTo(Number(dispatcherBody.season_fund_total || 0), 6);
    expect(Number(ownerTotals.obligations_tomorrow_cash || 0)).toBeCloseTo(1200, 6);
    expect(Number(ownerTotals.obligations_tomorrow_card || 0)).toBeCloseTo(800, 6);
    expect(Number(ownerTotals.obligations_tomorrow_total || 0)).toBeCloseTo(2000, 6);
  });
});
