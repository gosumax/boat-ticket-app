import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import normalizeSummary from '../../src/utils/normalizeSummary.js';

let app;
let db;
let seedData;
let sellerToken;
let dispatcherToken;
let sellerId;
let dispatcherId;

async function login(username, password) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  expect(res.status).toBe(200);
  expect(res.body?.token).toBeTruthy();
  return res.body.token;
}

async function getShiftSummary(businessDay) {
  return request(app)
    .get(`/api/dispatcher/shift-ledger/summary?business_day=${businessDay}`)
    .set('Authorization', `Bearer ${dispatcherToken}`);
}

function getTodayBusinessDay() {
  return String(db.prepare(`SELECT DATE('now','localtime') AS d`).get()?.d || '');
}

function getSellerRow(summaryBody) {
  return (summaryBody?.sellers || []).find((row) => Number(row?.seller_id) === Number(sellerId));
}

function getDispatcherRow(summaryBody) {
  const normalized = normalizeSummary(summaryBody, {
    currentUser: { id: dispatcherId, username: 'dispatcher1', role: 'dispatcher' },
  });
  return (normalized?.sellers || []).find((row) => Number(row?.seller_id) === Number(dispatcherId));
}

describe('seller-created + dispatcher-accepted money split regression', () => {
  beforeAll(async () => {
    resetTestDb();
    db = getTestDb();
    seedData = await seedBasicData(db);
    app = await makeApp();

    sellerToken = await login('sellerA', 'password123');
    dispatcherToken = await login('dispatcher1', 'password123');
    sellerId = Number(seedData.users.sellerA.id);
    dispatcherId = Number(seedData.users.dispatcher.id);
  });

  it('keeps seller debt tied only to seller-accepted prepayment and keeps dispatcher mixed split exact', async () => {
    const businessDay = getTodayBusinessDay();

    // Scenario A: seller creates ticket 3000 with mixed prepayment 500 cash + 500 card.
    const scenarioARes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        slotUid: `manual:${seedData.slots.manual.slot9}`,
        customerName: 'Scenario A',
        customerPhone: '+79990001001',
        numberOfSeats: 3,
        prepaymentAmount: 1000,
        payment_method: 'MIXED',
        cash_amount: 500,
        card_amount: 500,
      });

    expect(scenarioARes.status).toBe(201);
    const presaleAId = Number(scenarioARes.body?.presale?.id || 0);
    const scenarioATotal = Number(scenarioARes.body?.presale?.total_price || 0);
    expect(presaleAId).toBeGreaterThan(0);
    expect(scenarioATotal).toBe(3000);

    const summaryAfterARes = await getShiftSummary(businessDay);
    expect(summaryAfterARes.status).toBe(200);
    const sellerAfterA = getSellerRow(summaryAfterARes.body);
    expect(sellerAfterA).toBeDefined();
    expect(Number(sellerAfterA?.cash_due_to_owner || 0)).toBe(500);
    expect(Number(sellerAfterA?.terminal_due_to_owner || 0)).toBe(500);

    // Scenario B: dispatcher accepts remaining 2000 as mixed 1000 cash + 1000 card.
    const scenarioBAcceptRes = await request(app)
      .patch(`/api/selling/presales/${presaleAId}/accept-payment`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        payment_method: 'MIXED',
        cash_amount: 1000,
        card_amount: 1000,
      });

    expect(scenarioBAcceptRes.status).toBe(200);

    const summaryAfterBRes = await getShiftSummary(businessDay);
    expect(summaryAfterBRes.status).toBe(200);
    const sellerAfterB = getSellerRow(summaryAfterBRes.body);
    expect(sellerAfterB).toBeDefined();
    expect(Number(sellerAfterB?.cash_due_to_owner || 0)).toBe(500);
    expect(Number(sellerAfterB?.terminal_due_to_owner || 0)).toBe(500);

    const dispatcherAfterB = getDispatcherRow(summaryAfterBRes.body);
    expect(dispatcherAfterB).toBeDefined();
    expect(Number(dispatcherAfterB?.collected_cash || 0)).toBe(1000);
    expect(Number(dispatcherAfterB?.collected_card || 0)).toBe(1000);

    // Scenario C: new ticket 3000, seller prepayment 1000 cash, dispatcher accepts remaining mixed 1000/1000.
    const scenarioCRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        slotUid: `manual:${seedData.slots.manual.slot9}`,
        customerName: 'Scenario C',
        customerPhone: '+79990001002',
        numberOfSeats: 3,
        prepaymentAmount: 1000,
        payment_method: 'CASH',
      });

    expect(scenarioCRes.status).toBe(201);
    const presaleCId = Number(scenarioCRes.body?.presale?.id || 0);
    const scenarioCTotal = Number(scenarioCRes.body?.presale?.total_price || 0);
    expect(presaleCId).toBeGreaterThan(0);
    expect(scenarioCTotal).toBe(3000);

    const summaryBeforeCAcceptRes = await getShiftSummary(businessDay);
    expect(summaryBeforeCAcceptRes.status).toBe(200);
    const sellerBeforeCAccept = getSellerRow(summaryBeforeCAcceptRes.body);
    expect(sellerBeforeCAccept).toBeDefined();
    expect(Number(sellerBeforeCAccept?.cash_due_to_owner || 0)).toBe(1500);
    expect(Number(sellerBeforeCAccept?.terminal_due_to_owner || 0)).toBe(500);

    const scenarioCAcceptRes = await request(app)
      .patch(`/api/selling/presales/${presaleCId}/accept-payment`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        payment_method: 'MIXED',
        cash_amount: 1000,
        card_amount: 1000,
      });

    expect(scenarioCAcceptRes.status).toBe(200);

    const summaryAfterCRes = await getShiftSummary(businessDay);
    expect(summaryAfterCRes.status).toBe(200);
    const sellerAfterC = getSellerRow(summaryAfterCRes.body);
    expect(sellerAfterC).toBeDefined();
    expect(Number(sellerAfterC?.cash_due_to_owner || 0)).toBe(1500);
    expect(Number(sellerAfterC?.terminal_due_to_owner || 0)).toBe(500);

    const dispatcherAfterC = getDispatcherRow(summaryAfterCRes.body);
    expect(dispatcherAfterC).toBeDefined();
    expect(Number(dispatcherAfterC?.collected_cash || 0)).toBe(2000);
    expect(Number(dispatcherAfterC?.collected_card || 0)).toBe(2000);
  });
});
