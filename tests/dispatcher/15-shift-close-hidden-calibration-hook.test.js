import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { getTestDb, resetTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import { getTomorrowLocal } from '../_helpers/testDates.js';

let app;
let db;
let seedData;
let dispatcherToken;
let businessDay;

async function loginAs(username) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ username, password: 'password123' });

  expect(response.status).toBe(200);
  expect(response.body?.token).toBeTruthy();
  return response.body.token;
}

function insertPresale({
  sellerId,
  boatSlotId,
  generatedSlotId,
  businessDay: businessDayInput,
  numberOfSeats,
  totalPrice,
}) {
  return db.prepare(`
    INSERT INTO presales (
      boat_slot_id, slot_uid, seller_id,
      customer_name, customer_phone, number_of_seats,
      total_price, prepayment_amount, status, business_day
    )
    VALUES (?, ?, ?, 'Calibration Buyer', '79990000000', ?, ?, 0, 'ACTIVE', ?)
  `).run(
    boatSlotId,
    `generated:${generatedSlotId}`,
    sellerId,
    numberOfSeats,
    totalPrice,
    businessDayInput,
  ).lastInsertRowid;
}

function insertTicket({ presaleId, boatSlotId, ticketCode, price }) {
  return db.prepare(`
    INSERT INTO tickets (
      presale_id, boat_slot_id, ticket_code, status, price
    )
    VALUES (?, ?, ?, 'ACTIVE', ?)
  `).run(presaleId, boatSlotId, ticketCode, price).lastInsertRowid;
}

function insertCanonicalTicket({
  ticketId,
  presaleId,
  slotId,
  boatId,
  generatedSlotId,
  businessDay: businessDayInput,
  amount,
}) {
  db.prepare(`
    INSERT INTO sales_transactions_canonical (
      ticket_id, presale_id, slot_id, boat_id, slot_uid,
      amount, cash_amount, card_amount, method, status, business_day
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'CASH', 'VALID', ?)
  `).run(
    ticketId,
    presaleId,
    slotId,
    boatId,
    `generated:${generatedSlotId}`,
    amount,
    amount,
    businessDayInput,
  );
}

function insertCompletedSellerFoundationDay({
  sellerId,
  generatedSlotId,
  boatSlotId,
  boatId,
  businessDay: businessDayInput,
  seats = 5,
  seatPrice = 12000,
}) {
  const totalPrice = seats * seatPrice;
  const presaleId = insertPresale({
    sellerId,
    boatSlotId,
    generatedSlotId,
    businessDay: businessDayInput,
    numberOfSeats: seats,
    totalPrice,
  });

  for (let index = 0; index < seats; index += 1) {
    const ticketId = insertTicket({
      presaleId,
      boatSlotId,
      ticketCode: `HOOK-${sellerId}-${index + 1}`,
      price: seatPrice,
    });
    insertCanonicalTicket({
      ticketId,
      presaleId,
      slotId: boatSlotId,
      boatId,
      generatedSlotId,
      businessDay: businessDayInput,
      amount: seatPrice,
    });
  }
}

beforeAll(async () => {
  resetTestDb();
  app = await makeApp();
  db = getTestDb();
});

beforeEach(async () => {
  db.exec(`
    DELETE FROM shift_closures;
    DELETE FROM seller_calibration_state;
    DELETE FROM seller_motivation_state;
    DELETE FROM seller_day_stats;
    DELETE FROM seller_season_stats;
    DELETE FROM seller_season_applied_days;
    DELETE FROM money_ledger;
    DELETE FROM sales_transactions_canonical;
    DELETE FROM tickets;
    DELETE FROM presales;
    DELETE FROM generated_slots;
    DELETE FROM schedule_templates;
    DELETE FROM boat_slots;
    DELETE FROM boats;
    DELETE FROM users WHERE role IN ('seller', 'dispatcher');
  `);

  seedData = await seedBasicData(db);
  dispatcherToken = await loginAs('dispatcher1');
  businessDay = getTomorrowLocal(db);

  db.prepare(`
    UPDATE generated_slots
    SET is_completed = 1,
        status = 'COMPLETED',
        trip_date = ?
    WHERE id IN (?, ?)
  `).run(
    businessDay,
    seedData.slots.generated.genSlot1,
    seedData.slots.generated.genSlot2,
  );
});

describe('dispatcher shift close hidden calibration hook', () => {
  it('runs the new sidecar calibration engine on finalized shift close without changing the legacy runtime output path', async () => {
    insertCompletedSellerFoundationDay({
      sellerId: seedData.users.sellerA.id,
      generatedSlotId: seedData.slots.generated.genSlot1,
      boatSlotId: seedData.slots.manual.slot2,
      boatId: seedData.boats.speed,
      businessDay,
      seats: 5,
      seatPrice: 12000,
    });

    const closeRes = await request(app)
      .post('/api/dispatcher/shift/close')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ business_day: businessDay });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.ok).toBe(true);
    expect(closeRes.body.source).toBe('snapshot');
    expect(closeRes.body.business_day).toBe(businessDay);
    expect(closeRes.body).not.toHaveProperty('seller_calibration_state');

    const hiddenState = db.prepare(`
      SELECT *
      FROM seller_calibration_state
      WHERE seller_id = ?
    `).get(seedData.users.sellerA.id);

    expect(hiddenState).toMatchObject({
      seller_id: seedData.users.sellerA.id,
      calibration_status: 'uncalibrated',
      effective_level: null,
      pending_next_week_level: null,
      worked_days_in_week: 1,
      completed_revenue_sum_week: 60000,
      last_completed_workday: businessDay,
      streak_days: 0,
      streak_multiplier: 1,
    });

    const legacyState = db.prepare(`
      SELECT *
      FROM seller_motivation_state
      WHERE seller_id = ?
    `).get(seedData.users.sellerA.id);

    expect(legacyState).toMatchObject({
      seller_id: seedData.users.sellerA.id,
      calibrated: 0,
      current_level: 'NONE',
      streak_days: 0,
      last_eval_day: businessDay,
    });
  });
});
