import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { makeApp } from '../_helpers/makeApp.js';

let app;
let db;
let seed;

let dispatcherToken;
let sellerAToken;
let sellerBToken;
let ownerToken;
let dispatcherId;

const dayWithDebt = '2099-08-01';
const dayWithoutDebt = '2099-08-02';

function toNum(v) {
  return Number(v || 0);
}

function getIsoWeekKey(isoDay) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function login(username, password) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password });
  expect(res.status).toBe(200);
  expect(res.body?.token).toBeTruthy();
  return res.body.token;
}

async function createPresale(token, payload) {
  const res = await request(app)
    .post('/api/selling/presales')
    .set('Authorization', `Bearer ${token}`)
    .send(payload);
  expect(res.status).toBe(201);
  expect(Number(res.body?.presale?.id || 0)).toBeGreaterThan(0);
  return res.body.presale;
}

async function acceptPayment(token, presaleId, payload) {
  const res = await request(app)
    .patch(`/api/selling/presales/${presaleId}/accept-payment`)
    .set('Authorization', `Bearer ${token}`)
    .send(payload);
  expect(res.status).toBe(200);
  return res.body;
}

async function cancelPresale(token, presaleId) {
  const res = await request(app)
    .patch(`/api/selling/presales/${presaleId}/cancel`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(res.status).toBe(200);
  return res.body;
}

async function transferPresale(token, presaleId, toSlotUid, toTripDate) {
  const res = await request(app)
    .post(`/api/selling/presales/${presaleId}/transfer`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      to_slot_uid: toSlotUid,
      to_trip_date: toTripDate,
    });
  expect(res.status).toBe(200);
  return res.body;
}

async function deletePresale(token, presaleId) {
  const res = await request(app)
    .patch(`/api/selling/presales/${presaleId}/delete`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(res.status).toBe(200);
  return res.body;
}

async function getShiftSummary(day) {
  const res = await request(app)
    .get(`/api/dispatcher/shift-ledger/summary?business_day=${day}`)
    .set('Authorization', `Bearer ${dispatcherToken}`);
  expect(res.status).toBe(200);
  expect(res.body?.ok).toBe(true);
  return res.body;
}

async function finishTrips(day) {
  db.prepare(`
    UPDATE generated_slots
    SET is_completed = 1, status = 'COMPLETED'
    WHERE trip_date = ?
  `).run(day);
}

async function closeShift(day) {
  const res = await request(app)
    .post('/api/dispatcher/shift/close')
    .set('Authorization', `Bearer ${dispatcherToken}`)
    .send({ business_day: day });
  expect(res.status).toBe(200);
  expect(res.body?.ok).toBe(true);
  return res.body;
}

async function depositToOwner(type, sellerId, amount, day) {
  const res = await request(app)
    .post('/api/dispatcher/shift/deposit')
    .set('Authorization', `Bearer ${dispatcherToken}`)
    .send({
      type,
      seller_id: sellerId,
      amount,
      business_day: day,
    });
  expect(res.status).toBe(200);
  expect(res.body?.ok).toBe(true);
}

function assertShiftFormula(summary) {
  expect(toNum(summary.collected_total)).toBe(
    toNum(summary.collected_cash) + toNum(summary.collected_card)
  );
  expect(toNum(summary.net_total)).toBe(
    toNum(summary.collected_total) - toNum(summary.refund_total)
  );

  const sellers = Array.isArray(summary.sellers) ? summary.sellers : [];
  const sellersDebt = sellers.reduce((sum, s) => {
    const cashDue = Math.max(0, toNum(s.cash_due_to_owner));
    const termDue = Math.max(0, toNum(s.terminal_due_to_owner ?? s.terminal_debt));
    return sum + cashDue + termDue;
  }, 0);

  expect(toNum(summary.sellers_debt_total)).toBe(sellersDebt);
  expect(toNum(summary.owner_cash_available)).toBe(
    toNum(summary.net_total) - toNum(summary.salary_due_total) - sellersDebt
  );
}

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
  seed = await seedBasicData(db);

  db.prepare(`
    INSERT OR IGNORE INTO owner_settings (id, settings_json)
    VALUES (1, '{}')
  `).run();

  db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES ('owner_full_funnel', 'password123', 'owner', 1)
  `).run();

  sellerAToken = await login('sellerA', 'password123');
  sellerBToken = await login('sellerB', 'password123');
  dispatcherToken = await login('dispatcher1', 'password123');
  ownerToken = await login('owner_full_funnel', 'password123');

  const me = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${dispatcherToken}`);
  dispatcherId = Number(me.body?.id || 0);

  db.prepare(`
    UPDATE generated_slots
    SET trip_date = ?, capacity = 90, seats_left = 90,
        price_adult = 10000, price_teen = 10000, price_child = 5000,
        is_active = 1, is_completed = 0, status = 'ACTIVE'
    WHERE id = ?
  `).run(dayWithDebt, seed.slots.generated.genSlot1);

  db.prepare(`
    UPDATE generated_slots
    SET trip_date = ?, capacity = 70, seats_left = 70,
        price_adult = 9000, price_teen = 9000, price_child = 4500,
        is_active = 1, is_completed = 0, status = 'ACTIVE'
    WHERE id = ?
  `).run(dayWithoutDebt, seed.slots.generated.genSlot2);
});

describe('FULL FUNNEL: seller / dispatcher / owner financial chain', () => {
  it('covers operations, attribution, shift close debt/no-debt, owner summary and motivation ledgers', async () => {
    const sellerAId = Number(seed.users.sellerA.id);
    const sellerBId = Number(seed.users.sellerB.id);
    const slotDebt = `generated:${seed.slots.generated.genSlot1}`;
    const slotNoDebt = `generated:${seed.slots.generated.genSlot2}`;

    // 1) Seller presale with CASH prepayment + dispatcher top-up accept (doplata).
    const prepayPresale = await createPresale(sellerAToken, {
      slotUid: slotDebt,
      tripDate: dayWithDebt,
      customerName: 'Seller Prepay',
      customerPhone: '+79990000001',
      numberOfSeats: 2,
      prepaymentAmount: 1000,
      payment_method: 'CASH',
    });
    const prepayPresaleId = Number(prepayPresale.id);
    const prepayRemaining = toNum(prepayPresale.total_price) - toNum(prepayPresale.prepayment_amount);
    await acceptPayment(dispatcherToken, prepayPresaleId, { payment_method: 'CASH' });

    // 2) Seller full payment CARD.
    const sellerCardPresale = await createPresale(sellerAToken, {
      slotUid: slotDebt,
      tripDate: dayWithDebt,
      customerName: 'Seller Card',
      customerPhone: '+79990000002',
      numberOfSeats: 5,
      prepaymentAmount: 0,
    });
    await acceptPayment(sellerAToken, Number(sellerCardPresale.id), { payment_method: 'CARD' });

    // 3) Dispatcher sells from own name + MIXED payment.
    const dispatcherMixedPresale = await createPresale(dispatcherToken, {
      slotUid: slotDebt,
      tripDate: dayWithDebt,
      customerName: 'Dispatcher Mixed',
      customerPhone: '+79990000003',
      numberOfSeats: 1,
      prepaymentAmount: 0,
    });
    await acceptPayment(dispatcherToken, Number(dispatcherMixedPresale.id), {
      payment_method: 'MIXED',
      cash_amount: 4000,
      card_amount: 6000,
    });

    // 4) Dispatcher creates on behalf of sellerB, sellerB accepts CARD.
    const onBehalfPresale = await createPresale(dispatcherToken, {
      slotUid: slotDebt,
      tripDate: dayWithDebt,
      customerName: 'On Behalf',
      customerPhone: '+79990000004',
      numberOfSeats: 5,
      prepaymentAmount: 0,
      sellerId: sellerBId,
    });
    await acceptPayment(sellerBToken, Number(onBehalfPresale.id), { payment_method: 'CARD' });

    // 5) Cancel / reverse after accepted sale.
    const cancelPresaleObj = await createPresale(dispatcherToken, {
      slotUid: slotDebt,
      tripDate: dayWithDebt,
      customerName: 'Cancel Reverse',
      customerPhone: '+79990000005',
      numberOfSeats: 1,
      prepaymentAmount: 0,
    });
    await acceptPayment(dispatcherToken, Number(cancelPresaleObj.id), { payment_method: 'CASH' });
    await cancelPresale(dispatcherToken, Number(cancelPresaleObj.id));

    // 6) Transfer + delete chain across business_day (coverage for move/remove flow).
    const transferDeletePresale = await createPresale(dispatcherToken, {
      slotUid: slotDebt,
      tripDate: dayWithDebt,
      customerName: 'Transfer Delete',
      customerPhone: '+79990000008',
      numberOfSeats: 1,
      prepaymentAmount: 0,
    });
    await transferPresale(
      dispatcherToken,
      Number(transferDeletePresale.id),
      slotNoDebt,
      dayWithoutDebt,
    );
    const transferredRow = db.prepare(`
      SELECT slot_uid, business_day
      FROM presales
      WHERE id = ?
    `).get(Number(transferDeletePresale.id));
    expect(String(transferredRow?.slot_uid || '')).toBe(slotNoDebt);
    expect(String(transferredRow?.business_day || '')).toBe(dayWithoutDebt);
    await deletePresale(dispatcherToken, Number(transferDeletePresale.id));

    // Attributed top-up row must belong to dispatcher, not sellerA.
    const topupLedger = db.prepare(`
      SELECT seller_id, kind, type, amount
      FROM money_ledger
      WHERE presale_id = ?
        AND status = 'POSTED'
        AND type LIKE 'SALE_ACCEPTED%'
      ORDER BY id DESC
      LIMIT 1
    `).get(prepayPresaleId);
    expect(Number(topupLedger?.seller_id || 0)).toBe(dispatcherId);
    expect(String(topupLedger?.kind || '')).toBe('DISPATCHER_SHIFT');
    expect(toNum(topupLedger?.amount)).toBe(prepayRemaining);

    // Dispatcher-on-behalf keeps presale ownership on sellerB.
    const onBehalfOwner = db.prepare(`
      SELECT seller_id
      FROM presales
      WHERE id = ?
    `).get(Number(onBehalfPresale.id));
    expect(Number(onBehalfOwner?.seller_id || 0)).toBe(sellerBId);

    const reverseCount = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM money_ledger
      WHERE presale_id = ?
        AND status = 'POSTED'
        AND type = 'SALE_CANCEL_REVERSE'
    `).get(Number(cancelPresaleObj.id));
    expect(Number(reverseCount?.cnt || 0)).toBeGreaterThan(0);

    // LIVE summary for debt day.
    const debtLive = await getShiftSummary(dayWithDebt);
    assertShiftFormula(debtLive);

    const sellerALive = (debtLive.sellers || []).find((s) => Number(s.seller_id) === sellerAId);
    const dispatcherLive = (debtLive.sellers || []).find((s) => Number(s.seller_id) === dispatcherId);
    expect(sellerALive).toBeDefined();
    expect(dispatcherLive).toBeDefined();

    // seller.accepted/cash must not absorb dispatcher top-up.
    expect(toNum(sellerALive.collected_cash)).toBe(0);
    expect(toNum(sellerALive.collected_card)).toBeGreaterThan(0);
    expect(toNum(dispatcherLive.collected_cash)).toBeGreaterThan(0);

    const sellerAAcceptedLedgerDay = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM money_ledger
      WHERE business_day = ?
        AND seller_id = ?
        AND status = 'POSTED'
        AND type LIKE 'SALE_ACCEPTED%'
    `).get(dayWithDebt, sellerAId);
    expect(toNum(sellerALive.accepted)).toBe(toNum(sellerAAcceptedLedgerDay?.total));

    await finishTrips(dayWithDebt);
    await closeShift(dayWithDebt);

    const debtSnapshot = await getShiftSummary(dayWithDebt);
    expect(debtSnapshot.source).toBe('snapshot');
    assertShiftFormula(debtSnapshot);
    expect(toNum(debtSnapshot.sellers_debt_total)).toBeGreaterThan(0);

    // Second day: close without debts.
    const noDebtCash = await createPresale(sellerBToken, {
      slotUid: slotNoDebt,
      tripDate: dayWithoutDebt,
      customerName: 'No Debt Cash',
      customerPhone: '+79990000006',
      numberOfSeats: 3,
      prepaymentAmount: 0,
    });
    await acceptPayment(sellerBToken, Number(noDebtCash.id), { payment_method: 'CASH' });

    const noDebtCard = await createPresale(dispatcherToken, {
      slotUid: slotNoDebt,
      tripDate: dayWithoutDebt,
      customerName: 'No Debt Card',
      customerPhone: '+79990000007',
      numberOfSeats: 2,
      prepaymentAmount: 0,
      sellerId: sellerAId,
    });
    await acceptPayment(sellerAToken, Number(noDebtCard.id), { payment_method: 'CARD' });

    await finishTrips(dayWithoutDebt);

    const clearLiveBefore = await getShiftSummary(dayWithoutDebt);
    assertShiftFormula(clearLiveBefore);
    expect(toNum(clearLiveBefore.sellers_debt_total)).toBeGreaterThan(0);

    for (const s of clearLiveBefore.sellers || []) {
      const sid = Number(s.seller_id);
      if (!sid) continue;
      const cashDue = Math.max(0, Math.trunc(toNum(s.cash_due_to_owner)));
      const termDue = Math.max(0, Math.trunc(toNum(s.terminal_due_to_owner ?? s.terminal_debt)));
      if (cashDue > 0) {
        await depositToOwner('DEPOSIT_TO_OWNER_CASH', sid, cashDue, dayWithoutDebt);
      }
      if (termDue > 0) {
        await depositToOwner('DEPOSIT_TO_OWNER_CARD', sid, termDue, dayWithoutDebt);
      }
    }

    const clearLiveAfter = await getShiftSummary(dayWithoutDebt);
    assertShiftFormula(clearLiveAfter);
    expect(toNum(clearLiveAfter.sellers_debt_total)).toBe(0);

    await closeShift(dayWithoutDebt);
    const clearSnapshot = await getShiftSummary(dayWithoutDebt);
    expect(clearSnapshot.source).toBe('snapshot');
    assertShiftFormula(clearSnapshot);
    expect(toNum(clearSnapshot.sellers_debt_total)).toBe(0);

    // Owner summary invariants after all operations.
    const ownerSummary = await request(app)
      .get(`/api/owner/money/summary?from=${dayWithDebt}&to=${dayWithoutDebt}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(ownerSummary.status).toBe(200);
    expect(ownerSummary.body?.ok).toBe(true);

    const totals = ownerSummary.body?.data?.totals || {};
    expect(toNum(totals.collected_total)).toBe(toNum(totals.collected_cash) + toNum(totals.collected_card));
    expect(toNum(totals.net_total)).toBe(toNum(totals.collected_total) - toNum(totals.refund_total));

    // Weekly/season ledger aggregation after mixed operations.
    const weekKey = getIsoWeekKey(dayWithoutDebt);
    const weekly = await request(app)
      .get(`/api/owner/motivation/weekly?week=${weekKey}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(weekly.status).toBe(200);
    expect(weekly.body?.ok).toBe(true);

    const weekFrom = weekly.body?.data?.date_from;
    const weekTo = weekly.body?.data?.date_to;
    const weeklyLedger = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM money_ledger
      WHERE type = 'WITHHOLD_WEEKLY'
        AND status = 'POSTED'
        AND business_day BETWEEN ? AND ?
    `).get(weekFrom, weekTo);

    expect(toNum(weekly.body?.data?.weekly_pool_total_ledger)).toBe(toNum(weeklyLedger?.total));
    expect(toNum(weekly.body?.data?.weekly_pool_total_ledger)).toBeGreaterThan(0);

    const season = await request(app)
      .get('/api/owner/motivation/season?season_id=2099')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(season.status).toBe(200);
    expect(season.body?.ok).toBe(true);

    const seasonLedger = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM money_ledger
      WHERE type = 'WITHHOLD_SEASON'
        AND status = 'POSTED'
        AND business_day BETWEEN '2099-01-01' AND '2099-12-31'
    `).get();

    expect(toNum(season.body?.data?.season_pool_total_ledger)).toBe(toNum(seasonLedger?.total));
    expect(toNum(season.body?.data?.season_pool_total_ledger)).toBeGreaterThan(0);

    const sellerBState = db.prepare(`
      SELECT streak_days
      FROM seller_motivation_state
      WHERE seller_id = ?
    `).get(sellerBId);
    expect(sellerBState).toBeDefined();
    expect(toNum(sellerBState?.streak_days)).toBeGreaterThanOrEqual(0);
  });
});
