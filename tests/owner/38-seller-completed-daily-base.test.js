import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import {
  getSellerCompletedDailyMetrics,
  listSellerCompletedDailyMetrics,
  SELLER_COMPLETED_WORKED_DAY_MIN_SEATS,
} from '../../server/motivation/seller-completed-daily-base.mjs';

let db;

function insertSeller(id, username) {
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, is_active)
    VALUES (?, ?, 'hash', 'seller', 1)
  `).run(id, username);
}

function insertBoat(name, type = 'speed') {
  return db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
    VALUES (?, ?, 1, 3000, 1500, 2250)
  `).run(name, type).lastInsertRowid;
}

function insertScheduleTemplate(boatId, { time = '10:00', productType = 'speed' } = {}) {
  return db.prepare(`
    INSERT INTO schedule_templates (
      weekday, time, product_type, boat_id, boat_type, capacity,
      price_adult, price_child, price_teen, duration_minutes, is_active
    )
    VALUES (1, ?, ?, ?, ?, 30, 3000, 1500, 2250, 60, 1)
  `).run(time, productType, boatId, productType).lastInsertRowid;
}

function insertBoatSlot(boatId, {
  tripDate,
  time = '10:00',
  isCompleted = 1,
  status = 'COMPLETED',
} = {}) {
  return db.prepare(`
    INSERT INTO boat_slots (
      boat_id, time, price, capacity, seats_left,
      price_adult, price_child, price_teen, duration_minutes,
      trip_date, is_active, seller_cutoff_minutes, is_completed, status
    )
    VALUES (?, ?, 3000, 30, 30, 3000, 1500, 2250, 60, ?, 1, 30, ?, ?)
  `).run(boatId, time, tripDate, isCompleted, status).lastInsertRowid;
}

function insertGeneratedSlot(templateId, boatId, {
  tripDate,
  time = '10:00',
  isCompleted = 1,
  status = 'COMPLETED',
} = {}) {
  return db.prepare(`
    INSERT INTO generated_slots (
      schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
      duration_minutes, is_active, price_adult, price_child, price_teen,
      is_completed, status
    )
    VALUES (?, ?, ?, ?, 30, 30, 60, 1, 3000, 1500, 2250, ?, ?)
  `).run(templateId, tripDate, boatId, time, isCompleted, status).lastInsertRowid;
}

function insertPresale({
  sellerId,
  boatSlotId,
  slotUid,
  businessDay,
  numberOfSeats,
  totalPrice,
  status = 'ACTIVE',
}) {
  return db.prepare(`
    INSERT INTO presales (
      boat_slot_id, slot_uid, seller_id,
      customer_name, customer_phone, number_of_seats,
      total_price, prepayment_amount, status, business_day
    )
    VALUES (?, ?, ?, 'Buyer', '79990000000', ?, ?, 0, ?, ?)
  `).run(boatSlotId, slotUid, sellerId, numberOfSeats, totalPrice, status, businessDay).lastInsertRowid;
}

function insertTicket({ presaleId, boatSlotId, ticketCode, price, status = 'ACTIVE' }) {
  return db.prepare(`
    INSERT INTO tickets (
      presale_id, boat_slot_id, ticket_code, status, price
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(presaleId, boatSlotId, ticketCode, status, price).lastInsertRowid;
}

function insertCanonicalTicket({
  ticketId,
  presaleId,
  slotId,
  boatId,
  slotUid,
  businessDay,
  amount,
  cashAmount,
  cardAmount = 0,
  status = 'VALID',
}) {
  db.prepare(`
    INSERT INTO sales_transactions_canonical (
      ticket_id, presale_id, slot_id, boat_id, slot_uid,
      amount, cash_amount, card_amount, method, status, business_day
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ticketId,
    presaleId,
    slotId,
    boatId,
    slotUid,
    amount,
    cashAmount,
    cardAmount,
    cardAmount > 0 && cashAmount > 0 ? 'MIXED' : (cardAmount > 0 ? 'CARD' : 'CASH'),
    status,
    businessDay,
  );
}

function createGeneratedPresaleWithCanonicalTickets({
  sellerId,
  boatId,
  templateId,
  tripDate,
  seatPrices,
  generatedTime = '10:00',
  generatedCompleted = 1,
  generatedStatus = 'COMPLETED',
  presaleStatus = 'ACTIVE',
  ticketStatus = 'ACTIVE',
  canonicalStatus = 'VALID',
  canonicalCashRatio = 1,
}) {
  const boatSlotId = insertBoatSlot(boatId, {
    tripDate,
    time: generatedTime,
    isCompleted: generatedCompleted,
    status: generatedStatus,
  });
  const generatedSlotId = insertGeneratedSlot(templateId, boatId, {
    tripDate,
    time: generatedTime,
    isCompleted: generatedCompleted,
    status: generatedStatus,
  });
  const totalPrice = seatPrices.reduce((sum, price) => sum + Number(price || 0), 0);
  const presaleId = insertPresale({
    sellerId,
    boatSlotId,
    slotUid: `generated:${generatedSlotId}`,
    businessDay: tripDate,
    numberOfSeats: seatPrices.length,
    totalPrice,
    status: presaleStatus,
  });

  seatPrices.forEach((price, index) => {
    const ticketId = insertTicket({
      presaleId,
      boatSlotId,
      ticketCode: `TKT-${presaleId}-${index + 1}`,
      price,
      status: ticketStatus,
    });

    insertCanonicalTicket({
      ticketId,
      presaleId,
      slotId: boatSlotId,
      boatId,
      slotUid: `generated:${generatedSlotId}`,
      businessDay: tripDate,
      amount: price,
      cashAmount: Math.floor(Number(price) * Number(canonicalCashRatio)),
      cardAmount: 0,
      status: canonicalStatus,
    });
  });

  return { boatSlotId, generatedSlotId, presaleId };
}

describe('SELLER COMPLETED DAILY BASE', () => {
  beforeAll(() => {
    resetTestDb();
    db = getTestDb();
  });

  beforeEach(() => {
    db.prepare(`DELETE FROM sales_transactions_canonical`).run();
    db.prepare(`DELETE FROM tickets`).run();
    db.prepare(`DELETE FROM presales`).run();
    db.prepare(`DELETE FROM generated_slots`).run();
    db.prepare(`DELETE FROM schedule_templates`).run();
    db.prepare(`DELETE FROM boat_slots`).run();
    db.prepare(`DELETE FROM boats`).run();
    db.prepare(`DELETE FROM users WHERE id IN (6101, 6102)`).run();
  });

  it('builds seller/day completed metrics from fully-paid finished ticket rows and applies the 5-seat worked-day rule', () => {
    insertSeller(6101, 'seller_completed_base');
    insertSeller(6102, 'other_seller');

    const boatId = insertBoat('Completed Base Boat');
    const templateId = insertScheduleTemplate(boatId);

    createGeneratedPresaleWithCanonicalTickets({
      sellerId: 6101,
      boatId,
      templateId,
      tripDate: '2026-04-01',
      seatPrices: [3000, 3000],
      generatedTime: '10:00',
    });
    createGeneratedPresaleWithCanonicalTickets({
      sellerId: 6101,
      boatId,
      templateId,
      tripDate: '2026-04-01',
      seatPrices: [3000, 3000, 3000],
      generatedTime: '11:00',
    });
    createGeneratedPresaleWithCanonicalTickets({
      sellerId: 6101,
      boatId,
      templateId,
      tripDate: '2026-04-02',
      seatPrices: [2500, 2500, 2500, 2500],
      generatedTime: '12:00',
    });
    createGeneratedPresaleWithCanonicalTickets({
      sellerId: 6102,
      boatId,
      templateId,
      tripDate: '2026-04-01',
      seatPrices: [4000, 4000, 4000, 4000, 4000, 4000],
      generatedTime: '13:00',
    });

    const dayOne = getSellerCompletedDailyMetrics(db, {
      sellerId: 6101,
      businessDay: '2026-04-01',
    });
    const dayTwo = getSellerCompletedDailyMetrics(db, {
      sellerId: 6101,
      businessDay: '2026-04-02',
    });
    const rangeRows = listSellerCompletedDailyMetrics(db, {
      sellerId: 6101,
      dateFrom: '2026-04-01',
      dateTo: '2026-04-02',
    });

    expect(dayOne.completed_finished_revenue).toBe(15000);
    expect(dayOne.completed_fully_paid_seats).toBe(SELLER_COMPLETED_WORKED_DAY_MIN_SEATS);
    expect(dayOne.worked_day).toBe(true);

    expect(dayTwo.completed_finished_revenue).toBe(10000);
    expect(dayTwo.completed_fully_paid_seats).toBe(4);
    expect(dayTwo.worked_day).toBe(false);

    expect(rangeRows).toEqual([
      {
        seller_id: 6101,
        business_day: '2026-04-01',
        completed_finished_revenue: 15000,
        completed_fully_paid_seats: 5,
        worked_day: true,
      },
      {
        seller_id: 6101,
        business_day: '2026-04-02',
        completed_finished_revenue: 10000,
        completed_fully_paid_seats: 4,
        worked_day: false,
      },
    ]);
  });

  it('keeps future trips and incomplete prepayments out of the completed seller base', () => {
    insertSeller(6101, 'seller_completed_base');

    const boatId = insertBoat('Future Exclusion Boat');
    const templateId = insertScheduleTemplate(boatId);

    createGeneratedPresaleWithCanonicalTickets({
      sellerId: 6101,
      boatId,
      templateId,
      tripDate: '2026-04-03',
      seatPrices: [3000, 3000, 3000],
      generatedTime: '10:00',
      generatedCompleted: 0,
      generatedStatus: 'ACTIVE',
    });
    createGeneratedPresaleWithCanonicalTickets({
      sellerId: 6101,
      boatId,
      templateId,
      tripDate: '2026-04-04',
      seatPrices: [3000, 3000],
      generatedTime: '11:00',
      canonicalCashRatio: 0.5,
    });

    expect(getSellerCompletedDailyMetrics(db, {
      sellerId: 6101,
      businessDay: '2026-04-03',
    })).toEqual({
      seller_id: 6101,
      business_day: '2026-04-03',
      completed_finished_revenue: 0,
      completed_fully_paid_seats: 0,
      worked_day: false,
    });

    expect(getSellerCompletedDailyMetrics(db, {
      sellerId: 6101,
      businessDay: '2026-04-04',
    })).toEqual({
      seller_id: 6101,
      business_day: '2026-04-04',
      completed_finished_revenue: 0,
      completed_fully_paid_seats: 0,
      worked_day: false,
    });
  });

  it('excludes refunded and cancelled cases from the completed foundation source', () => {
    insertSeller(6101, 'seller_completed_base');

    const boatId = insertBoat('Refund Exclusion Boat');
    const templateId = insertScheduleTemplate(boatId);

    createGeneratedPresaleWithCanonicalTickets({
      sellerId: 6101,
      boatId,
      templateId,
      tripDate: '2026-04-05',
      seatPrices: [3000, 3000],
      generatedTime: '10:00',
      ticketStatus: 'REFUNDED',
      canonicalStatus: 'VOID',
    });
    createGeneratedPresaleWithCanonicalTickets({
      sellerId: 6101,
      boatId,
      templateId,
      tripDate: '2026-04-05',
      seatPrices: [3000, 3000],
      generatedTime: '11:00',
      presaleStatus: 'CANCELLED',
    });

    expect(getSellerCompletedDailyMetrics(db, {
      sellerId: 6101,
      businessDay: '2026-04-05',
    })).toEqual({
      seller_id: 6101,
      business_day: '2026-04-05',
      completed_finished_revenue: 0,
      completed_fully_paid_seats: 0,
      worked_day: false,
    });
  });
});
