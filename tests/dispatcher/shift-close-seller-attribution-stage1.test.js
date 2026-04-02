import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { getTestDb, resetTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';
import { getTodayLocal, getTomorrowLocal } from '../_helpers/testDates.js';

let app;
let db;
let seedData;
let dispatcherToken;
let dispatcherId;
let sellerId;
let today;
let tomorrow;

async function loginAs(username) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ username, password: 'password123' });

  expect(response.status).toBe(200);
  expect(response.body?.token).toBeTruthy();
  return response.body.token;
}

function finishTripsForDay(day) {
  db.prepare(`
    UPDATE generated_slots
    SET is_completed = 1,
        status = 'COMPLETED'
    WHERE trip_date = ?
  `).run(day);
}

async function getShiftSummary(token, day) {
  return request(app)
    .get(`/api/dispatcher/shift-ledger/summary?business_day=${encodeURIComponent(day)}`)
    .set('Authorization', `Bearer ${token}`);
}

async function closeShift(token, day) {
  finishTripsForDay(day);
  return request(app)
    .post('/api/dispatcher/shift/close')
    .set('Authorization', `Bearer ${token}`)
    .send({ business_day: day });
}

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  seedData = await seedBasicData(db);

  today = getTodayLocal(db);
  tomorrow = getTomorrowLocal(db);

  dispatcherToken = await loginAs('dispatcher1');
  const dispatcherMe = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${dispatcherToken}`);
  dispatcherId = Number(dispatcherMe.body?.id || 0);

  sellerId = Number(seedData?.users?.sellerA?.id || 0);
});

beforeEach(() => {
  db.exec(`
    DELETE FROM tickets;
    DELETE FROM presales;
    DELETE FROM money_ledger;
    DELETE FROM shift_closures;
    DELETE FROM sales_transactions;
    DELETE FROM sales_transactions_canonical;
    DELETE FROM seller_day_stats;
    DELETE FROM seller_season_stats;
    DELETE FROM seller_season_applied_days;
    DELETE FROM seller_motivation_state;
  `);

  db.prepare(`
    UPDATE generated_slots
    SET seats_left = capacity,
        is_active = 1,
        is_completed = 0,
        status = 'ACTIVE',
        trip_date = CASE
          WHEN id = ? THEN ?
          WHEN id = ? THEN ?
          ELSE trip_date
        END
    WHERE id IN (?, ?)
  `).run(
    seedData.slots.generated.genSlot1,
    today,
    seedData.slots.generated.genSlot2,
    tomorrow,
    seedData.slots.generated.genSlot1,
    seedData.slots.generated.genSlot2
  );

  db.prepare(`
    UPDATE boat_slots
    SET seats_left = capacity
  `).run();
});

describe('Stage 1 seller attribution for dispatcher flows', () => {
  it('dispatcher self-sale stays in dispatcher cashbox and never creates seller collect', async () => {
    const createRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        tripDate: tomorrow,
        customerName: 'Dispatcher Self Sale',
        customerPhone: '+79991110011',
        numberOfSeats: 1,
        prepaymentAmount: 0,
      });

    expect(createRes.status).toBe(201);
    const presaleId = Number(createRes.body?.presale?.id || 0);
    const totalPrice = Number(createRes.body?.presale?.total_price || 0);
    expect(presaleId).toBeGreaterThan(0);
    expect(totalPrice).toBeGreaterThan(0);

    const acceptRes = await request(app)
      .patch(`/api/selling/presales/${presaleId}/accept-payment`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ payment_method: 'CASH' });

    expect(acceptRes.status).toBe(200);

    const ledgerRow = db.prepare(`
      SELECT seller_id, kind, type, amount
      FROM money_ledger
      WHERE presale_id = ?
        AND status = 'POSTED'
        AND type LIKE 'SALE_ACCEPTED%'
      ORDER BY id DESC
      LIMIT 1
    `).get(presaleId);

    expect(Number(ledgerRow?.seller_id || 0)).toBe(dispatcherId);
    expect(String(ledgerRow?.kind || '')).toBe('DISPATCHER_SHIFT');
    expect(Number(ledgerRow?.amount || 0)).toBe(totalPrice);

    const liveSummaryRes = await getShiftSummary(dispatcherToken, today);
    expect(liveSummaryRes.status).toBe(200);
    expect(liveSummaryRes.body.ok).toBe(true);
    expect(Number(liveSummaryRes.body.collected_total || 0)).toBe(totalPrice);
    expect(Number(liveSummaryRes.body.sellers_collect_total || 0)).toBe(0);
    expect(Number(liveSummaryRes.body.sellers_debt_total || 0)).toBe(0);

    const dispatcherSellerRow = (liveSummaryRes.body.sellers || []).find((seller) => Number(seller.seller_id) === dispatcherId);
    expect(dispatcherSellerRow).toBeUndefined();

    const closeRes = await closeShift(dispatcherToken, today);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(Number(closeRes.body.cash_in_cashbox || 0)).toBe(totalPrice);
    expect(Number(closeRes.body.expected_sellers_cash_due || 0)).toBe(0);

    const snapshotRes = await getShiftSummary(dispatcherToken, today);
    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.body.source).toBe('snapshot');
    expect(Number(snapshotRes.body.sellers_collect_total || 0)).toBe(0);
  });

  it('dispatcher presale attributed to seller keeps partial prepayment inside seller collect in live and snapshot close', async () => {
    const createRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        tripDate: tomorrow,
        customerName: 'Seller Prepayment Attribution',
        customerPhone: '+79991110012',
        numberOfSeats: 1,
        sellerId,
        prepaymentAmount: 1000,
        payment_method: 'CASH',
      });

    expect(createRes.status).toBe(201);
    const presaleId = Number(createRes.body?.presale?.id || 0);
    expect(presaleId).toBeGreaterThan(0);

    const ledgerRow = db.prepare(`
      SELECT seller_id, kind, type, amount
      FROM money_ledger
      WHERE presale_id = ?
        AND status = 'POSTED'
        AND type LIKE 'SALE_PREPAYMENT%'
      ORDER BY id DESC
      LIMIT 1
    `).get(presaleId);

    expect(Number(ledgerRow?.seller_id || 0)).toBe(sellerId);
    expect(String(ledgerRow?.kind || '')).toBe('SELLER_SHIFT');
    expect(Number(ledgerRow?.amount || 0)).toBe(1000);

    const liveSummaryRes = await getShiftSummary(dispatcherToken, today);
    expect(liveSummaryRes.status).toBe(200);
    expect(liveSummaryRes.body.ok).toBe(true);
    expect(Number(liveSummaryRes.body.collected_total || 0)).toBe(1000);
    expect(Number(liveSummaryRes.body.sellers_collect_total || 0)).toBe(1000);
    expect(Number(liveSummaryRes.body.sellers_debt_total || 0)).toBe(1000);

    const sellerRow = (liveSummaryRes.body.sellers || []).find((seller) => Number(seller.seller_id) === sellerId);
    expect(sellerRow).toBeDefined();
    expect(Number(sellerRow?.collected_total || 0)).toBe(1000);
    expect(Number(sellerRow?.cash_due_to_owner || 0)).toBe(1000);

    const closeRes = await closeShift(dispatcherToken, today);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(Number(closeRes.body.cash_in_cashbox || 0)).toBe(1000);
    expect(Number(closeRes.body.expected_sellers_cash_due || 0)).toBe(1000);

    const snapshotRes = await getShiftSummary(dispatcherToken, today);
    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.body.source).toBe('snapshot');
    expect(Number(snapshotRes.body.sellers_collect_total || 0)).toBe(1000);

    const snapshotSellerRow = (snapshotRes.body.sellers || []).find((seller) => Number(seller.seller_id) === sellerId);
    expect(snapshotSellerRow).toBeDefined();
    expect(Number(snapshotSellerRow?.cash_due_to_owner || 0)).toBe(1000);
  });

  it('dispatcher full payment on behalf of seller stays out of seller debt even before deposit', async () => {
    const createRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        tripDate: tomorrow,
        customerName: 'Seller Full Attribution',
        customerPhone: '+79991110013',
        numberOfSeats: 1,
        sellerId,
        prepaymentAmount: 0,
      });

    expect(createRes.status).toBe(201);
    const presaleId = Number(createRes.body?.presale?.id || 0);
    const totalPrice = Number(createRes.body?.presale?.total_price || 0);
    expect(presaleId).toBeGreaterThan(0);
    expect(totalPrice).toBeGreaterThan(0);

    const acceptRes = await request(app)
      .patch(`/api/selling/presales/${presaleId}/accept-payment`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ payment_method: 'CASH' });

    expect(acceptRes.status).toBe(200);

    const ledgerRow = db.prepare(`
      SELECT seller_id, kind, type, amount
      FROM money_ledger
      WHERE presale_id = ?
        AND status = 'POSTED'
        AND type LIKE 'SALE_ACCEPTED%'
      ORDER BY id DESC
      LIMIT 1
    `).get(presaleId);

    expect(Number(ledgerRow?.seller_id || 0)).toBe(sellerId);
    expect(String(ledgerRow?.kind || '')).toBe('SELLER_SHIFT');
    expect(Number(ledgerRow?.amount || 0)).toBe(totalPrice);

    const beforeDepositRes = await getShiftSummary(dispatcherToken, today);
    expect(beforeDepositRes.status).toBe(200);
    expect(Number(beforeDepositRes.body.sellers_collect_total || 0)).toBe(0);
    expect(Number(beforeDepositRes.body.sellers_debt_total || 0)).toBe(0);

    const sellerRowBeforeDeposit = (beforeDepositRes.body.sellers || []).find((seller) => Number(seller.seller_id) === sellerId);
    expect(sellerRowBeforeDeposit).toBeDefined();
    expect(Number(sellerRowBeforeDeposit?.collected_total || 0)).toBe(totalPrice);
    expect(Number(sellerRowBeforeDeposit?.cash_due_to_owner || 0)).toBe(0);

    finishTripsForDay(today);
    const depositRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        business_day: today,
        type: 'DEPOSIT_TO_OWNER_CASH',
        seller_id: sellerId,
        amount: totalPrice,
      });

    expect(depositRes.status).toBe(200);
    expect(depositRes.body.ok).toBe(true);

    const afterDepositRes = await getShiftSummary(dispatcherToken, today);
    expect(afterDepositRes.status).toBe(200);
    expect(Number(afterDepositRes.body.sellers_collect_total || 0)).toBe(0);
    expect(Number(afterDepositRes.body.sellers_debt_total || 0)).toBe(0);

    const sellerRowAfterDeposit = (afterDepositRes.body.sellers || []).find((seller) => Number(seller.seller_id) === sellerId);
    expect(sellerRowAfterDeposit).toBeDefined();
    expect(Number(sellerRowAfterDeposit?.cash_due_to_owner || 0)).toBe(0);

    const closeRes = await closeShift(dispatcherToken, today);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(Number(closeRes.body.expected_sellers_cash_due || 0)).toBe(0);

    const snapshotRes = await getShiftSummary(dispatcherToken, today);
    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.body.source).toBe('snapshot');
    expect(Number(snapshotRes.body.sellers_collect_total || 0)).toBe(0);
    expect(Number(snapshotRes.body.sellers_debt_total || 0)).toBe(0);
  });

  it('dispatcher mixed sale on behalf of seller keeps collected split but does not create seller debt', async () => {
    const createRes = await request(app)
      .post('/api/selling/presales')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        tripDate: tomorrow,
        customerName: 'Seller Mixed Attribution',
        customerPhone: '+79991110014',
        numberOfSeats: 1,
        sellerId,
        prepaymentAmount: 0,
      });

    expect(createRes.status).toBe(201);
    const presaleId = Number(createRes.body?.presale?.id || 0);
    const totalPrice = Number(createRes.body?.presale?.total_price || 0);
    expect(presaleId).toBeGreaterThan(0);
    expect(totalPrice).toBeGreaterThan(0);

    const cashPart = Math.floor(totalPrice / 2);
    const cardPart = totalPrice - cashPart;

    const acceptRes = await request(app)
      .patch(`/api/selling/presales/${presaleId}/accept-payment`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        payment_method: 'MIXED',
        cash_amount: cashPart,
        card_amount: cardPart,
      });

    expect(acceptRes.status).toBe(200);

    const ledgerCols = new Set(db.prepare(`PRAGMA table_info(money_ledger)`).all().map((row) => row.name));
    const ledgerSelect = [
      'seller_id',
      'kind',
      'type',
      'amount',
      'method',
      ledgerCols.has('cash_amount') ? 'cash_amount' : 'NULL AS cash_amount',
      ledgerCols.has('card_amount') ? 'card_amount' : 'NULL AS card_amount',
    ].join(', ');
    const ledgerRow = db.prepare(`
      SELECT ${ledgerSelect}
      FROM money_ledger
      WHERE presale_id = ?
        AND status = 'POSTED'
        AND type LIKE 'SALE_ACCEPTED%'
      ORDER BY id DESC
      LIMIT 1
    `).get(presaleId);

    expect(Number(ledgerRow?.seller_id || 0)).toBe(sellerId);
    expect(String(ledgerRow?.kind || '')).toBe('SELLER_SHIFT');
    expect(String(ledgerRow?.type || '')).toBe('SALE_ACCEPTED_MIXED');
    expect(Number(ledgerRow?.amount || 0)).toBe(totalPrice);
    if (ledgerCols.has('cash_amount')) {
      expect(Number(ledgerRow?.cash_amount || 0)).toBe(cashPart);
    }
    if (ledgerCols.has('card_amount')) {
      expect(Number(ledgerRow?.card_amount || 0)).toBe(cardPart);
    }

    const beforeDepositRes = await getShiftSummary(dispatcherToken, today);
    expect(beforeDepositRes.status).toBe(200);
    expect(Number(beforeDepositRes.body.collected_total || 0)).toBe(totalPrice);
    expect(Number(beforeDepositRes.body.collected_cash || 0)).toBe(cashPart);
    expect(Number(beforeDepositRes.body.collected_card || 0)).toBe(cardPart);
    expect(Number(beforeDepositRes.body.sellers_collect_total || 0)).toBe(0);
    expect(Number(beforeDepositRes.body.sellers_debt_total || 0)).toBe(0);

    const sellerRowBeforeDeposit = (beforeDepositRes.body.sellers || []).find((seller) => Number(seller.seller_id) === sellerId);
    expect(sellerRowBeforeDeposit).toBeDefined();
    expect(Number(sellerRowBeforeDeposit?.collected_cash || 0)).toBe(cashPart);
    expect(Number(sellerRowBeforeDeposit?.collected_card || 0)).toBe(cardPart);
    expect(Number(sellerRowBeforeDeposit?.cash_due_to_owner || 0)).toBe(0);
    expect(Number(sellerRowBeforeDeposit?.terminal_due_to_owner || 0)).toBe(0);

    finishTripsForDay(today);

    const depositCashRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        business_day: today,
        type: 'DEPOSIT_TO_OWNER_CASH',
        seller_id: sellerId,
        amount: cashPart,
      });

    expect(depositCashRes.status).toBe(200);
    expect(depositCashRes.body.ok).toBe(true);

    const depositCardRes = await request(app)
      .post('/api/dispatcher/shift/deposit')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        business_day: today,
        type: 'DEPOSIT_TO_OWNER_CARD',
        seller_id: sellerId,
        amount: cardPart,
      });

    expect(depositCardRes.status).toBe(200);
    expect(depositCardRes.body.ok).toBe(true);

    const afterDepositRes = await getShiftSummary(dispatcherToken, today);
    expect(afterDepositRes.status).toBe(200);
    expect(Number(afterDepositRes.body.sellers_collect_total || 0)).toBe(0);
    expect(Number(afterDepositRes.body.sellers_debt_total || 0)).toBe(0);

    const sellerRowAfterDeposit = (afterDepositRes.body.sellers || []).find((seller) => Number(seller.seller_id) === sellerId);
    expect(sellerRowAfterDeposit).toBeDefined();
    expect(Number(sellerRowAfterDeposit?.cash_due_to_owner || 0)).toBe(0);
    expect(Number(sellerRowAfterDeposit?.terminal_due_to_owner || 0)).toBe(0);

    const closeRes = await closeShift(dispatcherToken, today);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(Number(closeRes.body.expected_sellers_cash_due || 0)).toBe(0);

    const snapshotRes = await getShiftSummary(dispatcherToken, today);
    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.body.source).toBe('snapshot');
    expect(Number(snapshotRes.body.collected_total || 0)).toBe(totalPrice);
    expect(Number(snapshotRes.body.collected_cash || 0)).toBe(cashPart);
    expect(Number(snapshotRes.body.collected_card || 0)).toBe(cardPart);
    expect(Number(snapshotRes.body.sellers_collect_total || 0)).toBe(0);
    expect(Number(snapshotRes.body.sellers_debt_total || 0)).toBe(0);
  });
});
