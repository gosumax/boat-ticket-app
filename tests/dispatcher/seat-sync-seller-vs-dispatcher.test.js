// seat-sync-seller-vs-dispatcher.test.js — contract test for seat count sync
// Ensures seller and dispatcher endpoints report identical occupied seat counts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { resetTestDb, getTestDb } from '../_helpers/dbReset.js';
import { makeApp } from '../_helpers/makeApp.js';
import { getTodayLocal } from '../_helpers/testDates.js';

const JWT_SECRET = process.env.JWT_SECRET || 'boat_ticket_secret_key';
const SALT_ROUNDS = 10;

let app, db;
let sellerToken, dispatcherToken;
let sellerId, dispatcherId;
let boatId, templateId, genSlotId;
let today;

/**
 * Count occupied seats directly from SQL for a given slot_uid
 * Counts tickets with statuses that should occupy seats
 */
function countOccupiedBySql(slotUid) {
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM tickets t
    JOIN presales p ON p.id = t.presale_id
    WHERE p.slot_uid = ?
      AND t.status IN ('ACTIVE','PAID','UNPAID','RESERVED','PARTIALLY_PAID','CONFIRMED','USED')
  `).get(slotUid);
  return row.count;
}

/**
 * Count REFUNDED tickets for a given slot_uid
 */
function countRefundedBySql(slotUid) {
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM tickets t
    JOIN presales p ON p.id = t.presale_id
    WHERE p.slot_uid = ?
      AND t.status = 'REFUNDED'
  `).get(slotUid);
  return row.count;
}

function seedActiveTelegramHoldForSlot({
  slotUid,
  requestedSeats,
  sellerUserId,
  telegramUserId,
  holdExpiresAtIso,
}) {
  const nowIso = new Date().toISOString();
  const parsedSlotId = Number(String(slotUid || '').split(':')[1] || 0);
  const slotRow = db
    .prepare(
      `
        SELECT trip_date, time
        FROM generated_slots
        WHERE id = ?
      `
    )
    .get(parsedSlotId);
  const requestedTripDate = slotRow?.trip_date || getTodayLocal(db);
  const requestedTimeSlot = slotRow?.time || '10:00';
  const qrSuffix = `${telegramUserId}-${Date.now()}`;

  const guestProfileResult = db
    .prepare(
      `
        INSERT INTO telegram_guest_profiles
          (
            telegram_user_id,
            display_name,
            username,
            language_code,
            phone_e164,
            consent_status,
            profile_status
          )
        VALUES (?, ?, ?, 'ru', ?, 'GRANTED', 'ACTIVE')
      `
    )
    .run(
      telegramUserId,
      `Guest ${telegramUserId}`,
      `guest_${telegramUserId}`,
      `+7999${String(Math.floor(Math.random() * 9000000) + 1000000)}`
    );
  const guestProfileId = Number(guestProfileResult.lastInsertRowid);

  const trafficSourceResult = db
    .prepare(
      `
        INSERT INTO telegram_traffic_sources
          (source_code, source_type, source_name, default_seller_id, is_active)
        VALUES (?, 'qr', ?, ?, 1)
      `
    )
    .run(
      `src-${qrSuffix}`,
      `Source ${qrSuffix}`,
      sellerUserId
    );
  const trafficSourceId = Number(trafficSourceResult.lastInsertRowid);

  const qrCodeResult = db
    .prepare(
      `
        INSERT INTO telegram_source_qr_codes
          (qr_token, traffic_source_id, seller_id, entry_context, is_active)
        VALUES (?, ?, ?, '{}', 1)
      `
    )
    .run(
      `qr-${qrSuffix}`,
      trafficSourceId,
      sellerUserId
    );
  const sourceQrId = Number(qrCodeResult.lastInsertRowid);

  const attributionSessionResult = db
    .prepare(
      `
        INSERT INTO telegram_seller_attribution_sessions
          (
            guest_profile_id,
            traffic_source_id,
            source_qr_code_id,
            seller_id,
            starts_at,
            expires_at,
            attribution_status,
            binding_reason
          )
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 'source_qr_entry')
      `
    )
    .run(
      guestProfileId,
      trafficSourceId,
      sourceQrId,
      sellerUserId,
      nowIso,
      new Date(Date.now() + 30 * 60 * 1000).toISOString()
    );
  const sellerAttributionSessionId = Number(attributionSessionResult.lastInsertRowid);

  const bookingRequestResult = db
    .prepare(
      `
        INSERT INTO telegram_booking_requests
          (
            guest_profile_id,
            seller_attribution_session_id,
            requested_trip_date,
            requested_time_slot,
            requested_seats,
            requested_ticket_mix,
            contact_phone_e164,
            request_status,
            created_at,
            last_status_at
          )
        VALUES (?, ?, ?, ?, ?, '{}', '+79990001122', 'HOLD_ACTIVE', ?, ?)
      `
    )
    .run(
      guestProfileId,
      sellerAttributionSessionId,
      requestedTripDate,
      requestedTimeSlot,
      requestedSeats,
      nowIso,
      nowIso
    );
  const bookingRequestId = Number(bookingRequestResult.lastInsertRowid);

  const holdResult = db
    .prepare(
      `
        INSERT INTO telegram_booking_holds
          (
            booking_request_id,
            hold_scope,
            hold_expires_at,
            hold_status,
            requested_amount,
            currency,
            started_at
          )
        VALUES (?, 'booking_request', ?, 'ACTIVE', 0, 'RUB', ?)
      `
    )
    .run(
      bookingRequestId,
      holdExpiresAtIso,
      nowIso
    );
  const bookingHoldId = Number(holdResult.lastInsertRowid);

  db.prepare(
    `
      INSERT INTO telegram_booking_request_events
        (
          booking_request_id,
          booking_hold_id,
          seller_attribution_session_id,
          event_type,
          event_at,
          actor_type,
          actor_id,
          event_payload
        )
      VALUES (?, ?, ?, 'REQUEST_CREATED', ?, 'telegram_guest', ?, ?)
    `
  ).run(
    bookingRequestId,
    bookingHoldId,
    sellerAttributionSessionId,
    nowIso,
    telegramUserId,
    JSON.stringify({
      creation_result: {
        requested_trip_slot_reference: {
          slot_uid: slotUid,
          requested_trip_date: requestedTripDate,
          requested_time_slot: requestedTimeSlot,
        },
      },
      requested_trip_slot_reference: {
        slot_uid: slotUid,
        requested_trip_date: requestedTripDate,
        requested_time_slot: requestedTimeSlot,
      },
    })
  );

  return {
    bookingRequestId,
    bookingHoldId,
  };
}

beforeAll(async () => {
  // STEP 1: Reset test DB
  resetTestDb();
  
  // STEP 2: Initialize app
  app = await makeApp();
  
  // STEP 3: Get DB connection
  db = getTestDb();
  today = getTodayLocal(db);
  
  // Create users
  const hashedPassword = await bcrypt.hash('password123', SALT_ROUNDS);
  
  const sellerRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'seller', 1)
  `).run('seller_sync_test', hashedPassword);
  sellerId = sellerRes.lastInsertRowid;
  sellerToken = jwt.sign({ id: sellerId, username: 'seller_sync_test', role: 'seller' }, JWT_SECRET, { expiresIn: '24h' });
  
  const dispatcherRes = db.prepare(`
    INSERT INTO users (username, password_hash, role, is_active)
    VALUES (?, ?, 'dispatcher', 1)
  `).run('dispatcher_sync_test', hashedPassword);
  dispatcherId = dispatcherRes.lastInsertRowid;
  dispatcherToken = jwt.sign({ id: dispatcherId, username: 'dispatcher_sync_test', role: 'dispatcher' }, JWT_SECRET, { expiresIn: '24h' });
  
  // Create boat with type 'speed' (seller endpoint filters by boat type)
  const boatRes = db.prepare(`
    INSERT INTO boats (name, type, is_active, price_adult, price_child, price_teen)
    VALUES (?, 'speed', 1, 1000, 500, 750)
  `).run('BoatSpeed');
  boatId = boatRes.lastInsertRowid;
  
  // Create schedule_template (FK for generated_slots)
  const templateRes = db.prepare(`
    INSERT INTO schedule_templates (weekday, time, product_type, boat_id, capacity, price_adult, price_child, price_teen, duration_minutes, is_active)
    VALUES (1, '10:00', 'speed', ?, 12, 1000, 500, 750, 60, 1)
  `).run(boatId);
  templateId = templateRes.lastInsertRowid;
  
  // Create boat_slot for FK reference in presales
  const boatSlotRes = db.prepare(`
    INSERT INTO boat_slots (boat_id, time, price, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active, trip_date)
    VALUES (?, '10:00', 1000, 12, 12, 1000, 500, 750, 60, 1, ?)
  `).run(boatId, today);
  const boatSlotId = boatSlotRes.lastInsertRowid;
  
  // Create generated_slots with id=195 and capacity=12
  // Use tomorrow's date to avoid time-based cutoff filters
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const genSlotRes = db.prepare(`
    INSERT INTO generated_slots (id, schedule_template_id, boat_id, time, trip_date, capacity, seats_left, price_adult, price_child, price_teen, duration_minutes, is_active)
    VALUES (195, ?, ?, '10:00', ?, 12, 12, 1000, 500, 750, 60, 1)
  `).run(templateId, boatId, tomorrow);
  genSlotId = genSlotRes.lastInsertRowid;
  
  console.log('[SETUP] Created genSlotId:', genSlotId, 'boatId:', boatId, 'trip_date:', tomorrow);
  
  // Seed presales + tickets for slot_uid='generated:195'
  // 9 ACTIVE tickets (should be counted)
  // 6 REFUNDED tickets with CANCELLED presale (should NOT be counted)
  
  // Create presale with 9 ACTIVE tickets
  const presale1Res = db.prepare(`
    INSERT INTO presales (boat_slot_id, slot_uid, seller_id, customer_name, customer_phone, number_of_seats, total_price, prepayment_amount, status, business_day)
    VALUES (?, 'generated:195', ?, 'Customer Active', '79991112233', 9, 9000, 9000, 'ACTIVE', ?)
  `).run(boatSlotId, sellerId, today);
  const presale1Id = presale1Res.lastInsertRowid;
  
  // Create 9 ACTIVE tickets
  for (let i = 0; i < 9; i++) {
    db.prepare(`
      INSERT INTO tickets (presale_id, boat_slot_id, ticket_code, status, price)
      VALUES (?, ?, ?, 'ACTIVE', 1000)
    `).run(presale1Id, boatSlotId, `TKT-ACTIVE-${i + 1}`);
  }
  
  // Create presale with 6 REFUNDED tickets (CANCELLED presale)
  const presale2Res = db.prepare(`
    INSERT INTO presales (boat_slot_id, slot_uid, seller_id, customer_name, customer_phone, number_of_seats, total_price, prepayment_amount, status, business_day)
    VALUES (?, 'generated:195', ?, 'Customer Cancelled', '79994445566', 6, 6000, 0, 'CANCELLED', ?)
  `).run(boatSlotId, sellerId, today);
  const presale2Id = presale2Res.lastInsertRowid;
  
  // Create 6 REFUNDED tickets
  for (let i = 0; i < 6; i++) {
    db.prepare(`
      INSERT INTO tickets (presale_id, boat_slot_id, ticket_code, status, price)
      VALUES (?, ?, ?, 'REFUNDED', 1000)
    `).run(presale2Id, boatSlotId, `TKT-REFUNDED-${i + 1}`);
  }
  
  console.log('[SETUP] Created 9 ACTIVE + 6 REFUNDED tickets for slot generated:195');
  
  // Verify data
  const ticketCounts = db.prepare(`
    SELECT t.status, COUNT(*) as count
    FROM tickets t
    JOIN presales p ON t.presale_id = p.id
    WHERE p.slot_uid = 'generated:195'
    GROUP BY t.status
  `).all();
  console.log('[SETUP] Ticket counts by status:', ticketCounts);
});

describe('SELLER vs DISPATCHER SEAT SYNC', () => {
  it('seller and dispatcher report identical occupied seat count for same slot', async () => {
    // ARRANGE: Slot has capacity=12, 9 ACTIVE tickets, 6 REFUNDED (not counted)
    const expectedOccupied = 9;
    const expectedFree = 3;
    const slotUid = 'generated:195';
    
    // ACT 0: Get SQL ground truth
    const occupiedSql = countOccupiedBySql(slotUid);
    console.log('[SQL] occupiedBySql:', occupiedSql, 'for slotUid:', slotUid);
    
    // ACT 1: Call seller endpoint
    const sellerRes = await request(app)
      .get('/api/selling/boats/speed/slots')
      .set('Authorization', `Bearer ${sellerToken}`);
    
    console.log('[SELLER] Status:', sellerRes.status);
    console.log('[SELLER] Body keys:', Object.keys(sellerRes.body));
    
    // If seller endpoint fails, log and fail test with details
    if (sellerRes.status !== 200) {
      console.log('[SELLER] Error body:', JSON.stringify(sellerRes.body, null, 2));
    }
    expect(sellerRes.status).toBe(200);
    
    // ACT 2: Call dispatcher endpoint
    const dispatcherRes = await request(app)
      .get('/api/selling/dispatcher/slots')
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    console.log('[DISPATCHER] Status:', dispatcherRes.status);
    
    if (dispatcherRes.status !== 200) {
      console.log('[DISPATCHER] Error body:', JSON.stringify(dispatcherRes.body, null, 2));
    }
    expect(dispatcherRes.status).toBe(200);
    
    // ASSERT: Find slot 195 in both responses
    const sellerSlots = sellerRes.body?.slots || sellerRes.body || [];
    const dispatcherSlots = Array.isArray(dispatcherRes.body) ? dispatcherRes.body : (dispatcherRes.body?.slots || []);
    
    console.log('[SELLER] Slots count:', sellerSlots.length);
    console.log('[DISPATCHER] Slots count:', dispatcherSlots.length);
    
    // Find our test slot by id=195 or slot_uid='generated:195'
    const sellerSlot = sellerSlots.find(s => s.id === 195 || s.slot_uid === 'generated:195' || s.slotUid === 'generated:195');
    const dispatcherSlot = dispatcherSlots.find(s => s.id === 195 || s.slot_uid === 'generated:195' || s.slotUid === 'generated:195');
    
    // Debug: if not found, print all slot keys
    if (!sellerSlot && sellerSlots.length > 0) {
      console.log('[SELLER] First slot keys:', Object.keys(sellerSlots[0]));
      console.log('[SELLER] First slot:', JSON.stringify(sellerSlots[0], null, 2));
    }
    if (!dispatcherSlot && dispatcherSlots.length > 0) {
      console.log('[DISPATCHER] First slot keys:', Object.keys(dispatcherSlots[0]));
    }
    
    expect(sellerSlot).toBeDefined();
    expect(dispatcherSlot).toBeDefined();
    
    console.log('[SELLER SLOT]:', JSON.stringify(sellerSlot, null, 2));
    console.log('[DISPATCHER SLOT]:', JSON.stringify(dispatcherSlot, null, 2));
    
    // Calculate occupied seats
    // Endpoint returns: available_seats (seller) or seats_left (dispatcher)
    // Occupied = capacity - available
    
    const sellerCapacity = sellerSlot.capacity || sellerSlot.boat_capacity || 12;
    const sellerAvailable = sellerSlot.available_seats ?? sellerSlot.seats_left ?? sellerSlot.seatsAvailable;
    const sellerOccupied = sellerCapacity - sellerAvailable;
    
    const dispatcherCapacity = dispatcherSlot.capacity || dispatcherSlot.boat_capacity || 12;
    const dispatcherAvailable = dispatcherSlot.seats_left ?? dispatcherSlot.available_seats;
    const dispatcherOccupied = dispatcherCapacity - dispatcherAvailable;
    
    console.log('[SELLER] capacity:', sellerCapacity, 'available:', sellerAvailable, 'occupied:', sellerOccupied);
    console.log('[DISPATCHER] capacity:', dispatcherCapacity, 'available:', dispatcherAvailable, 'occupied:', dispatcherOccupied);
    
    // ASSERT: All three sources must match
    expect(sellerOccupied).toBe(dispatcherOccupied);
    expect(sellerOccupied).toBe(occupiedSql);
    expect(dispatcherOccupied).toBe(occupiedSql);
    
    // ASSERT: Both must equal expected 9
    expect(sellerOccupied).toBe(expectedOccupied);
    expect(dispatcherOccupied).toBe(expectedOccupied);
    expect(occupiedSql).toBe(expectedOccupied);
    
    // ASSERT: Free seats must match and equal capacity - occupiedSql
    expect(sellerAvailable).toBe(dispatcherAvailable);
    expect(sellerAvailable).toBe(sellerCapacity - occupiedSql);
    expect(sellerAvailable).toBe(expectedFree);
    
    console.log('[PASS] Seller, dispatcher and SQL seat counts are synchronized');
  });
  
  it('both endpoints count only valid ticket statuses (exclude REFUNDED)', async () => {
    // Verify that REFUNDED tickets are NOT counted
    // Slot has 9 ACTIVE + 6 REFUNDED = 15 total tickets
    // Only 9 should be counted
    const slotUid = 'generated:195';
    
    // Get SQL ground truth
    const occupiedSql = countOccupiedBySql(slotUid);
    const refundedSql = countRefundedBySql(slotUid);
    console.log('[SQL] occupiedBySql:', occupiedSql, 'refundedBySql:', refundedSql);
    
    const dispatcherRes = await request(app)
      .get('/api/selling/dispatcher/slots')
      .set('Authorization', `Bearer ${dispatcherToken}`);
    
    expect(dispatcherRes.status).toBe(200);
    
    const sellerRes = await request(app)
      .get('/api/selling/boats/speed/slots')
      .set('Authorization', `Bearer ${sellerToken}`);
    
    expect(sellerRes.status).toBe(200);
    
    const dispatcherSlots = Array.isArray(dispatcherRes.body) ? dispatcherRes.body : [];
    const slot = dispatcherSlots.find(s => s.id === 195 || s.slot_uid === 'generated:195');
    
    const sellerSlots = sellerRes.body?.slots || sellerRes.body || [];
    const sellerSlot = sellerSlots.find(s => s.id === 195 || s.slot_uid === 'generated:195' || s.slotUid === 'generated:195');
    
    expect(slot).toBeDefined();
    expect(sellerSlot).toBeDefined();
    
    const capacity = slot.capacity || 12;
    const available = slot.seats_left ?? slot.available_seats;
    const dispatcherOccupied = capacity - available;
    
    const sellerCapacity = sellerSlot.capacity || sellerSlot.boat_capacity || 12;
    const sellerAvailable = sellerSlot.available_seats ?? sellerSlot.seats_left ?? sellerSlot.seatsAvailable;
    const sellerOccupied = sellerCapacity - sellerAvailable;
    
    // ASSERT: Both endpoints match SQL
    expect(dispatcherOccupied).toBe(occupiedSql);
    expect(sellerOccupied).toBe(occupiedSql);
    
    // REFUNDED tickets should NOT be counted
    // If they were counted, occupied would be 15
    expect(dispatcherOccupied).toBe(9);
    expect(dispatcherOccupied).toBeLessThan(15);
    
    // Verify REFUNDED count exists but doesn't affect occupied
    expect(refundedSql).toBe(6); // We created 6 REFUNDED tickets
    expect(dispatcherOccupied).toBe(occupiedSql); // Only valid statuses counted
    expect(dispatcherOccupied + refundedSql).toBe(15); // Total tickets = 9 + 6
    
    console.log('[PASS] REFUNDED tickets correctly excluded from seat count');
    console.log('[PASS] Endpoints match SQL: dispatcher=', dispatcherOccupied, 'seller=', sellerOccupied, 'sql=', occupiedSql);
  });

  it('applies active Telegram hold to seller+dispatcher availability and restores seats after hold expiry', async () => {
    const slotUid = 'generated:195';
    const holdSeats = 2;
    const holdExpiryIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const seededHold = seedActiveTelegramHoldForSlot({
      slotUid,
      requestedSeats: holdSeats,
      sellerUserId: sellerId,
      telegramUserId: `tg-hold-${Date.now()}`,
      holdExpiresAtIso: holdExpiryIso,
    });

    const sellerWithHoldRes = await request(app)
      .get('/api/selling/boats/speed/slots')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(sellerWithHoldRes.status).toBe(200);

    const dispatcherWithHoldRes = await request(app)
      .get('/api/selling/dispatcher/slots')
      .set('Authorization', `Bearer ${dispatcherToken}`);
    expect(dispatcherWithHoldRes.status).toBe(200);

    const sellerWithHoldSlot = (sellerWithHoldRes.body?.slots || []).find(
      (slot) => slot.slot_uid === slotUid
    );
    const dispatcherWithHoldSlot = (Array.isArray(dispatcherWithHoldRes.body) ? dispatcherWithHoldRes.body : []).find(
      (slot) => slot.slot_uid === slotUid
    );

    expect(sellerWithHoldSlot).toBeDefined();
    expect(dispatcherWithHoldSlot).toBeDefined();

    expect(Number(sellerWithHoldSlot.seats_left)).toBe(1);
    expect(Number(dispatcherWithHoldSlot.seats_left)).toBe(1);
    expect(Number(sellerWithHoldSlot.telegram_active_hold_seats)).toBe(holdSeats);
    expect(Number(dispatcherWithHoldSlot.telegram_active_hold_seats)).toBe(holdSeats);
    expect(String(sellerWithHoldSlot.telegram_hold_expires_at || '')).toBe(holdExpiryIso);
    expect(String(dispatcherWithHoldSlot.telegram_hold_expires_at || '')).toBe(holdExpiryIso);

    db.prepare(
      `
        UPDATE telegram_booking_holds
        SET hold_expires_at = datetime('now', '-1 minute')
        WHERE booking_hold_id = ?
      `
    ).run(seededHold.bookingHoldId);

    const sellerAfterExpiryRes = await request(app)
      .get('/api/selling/boats/speed/slots')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(sellerAfterExpiryRes.status).toBe(200);

    const dispatcherAfterExpiryRes = await request(app)
      .get('/api/selling/dispatcher/slots')
      .set('Authorization', `Bearer ${dispatcherToken}`);
    expect(dispatcherAfterExpiryRes.status).toBe(200);

    const sellerAfterExpirySlot = (sellerAfterExpiryRes.body?.slots || []).find(
      (slot) => slot.slot_uid === slotUid
    );
    const dispatcherAfterExpirySlot = (Array.isArray(dispatcherAfterExpiryRes.body) ? dispatcherAfterExpiryRes.body : []).find(
      (slot) => slot.slot_uid === slotUid
    );

    expect(sellerAfterExpirySlot).toBeDefined();
    expect(dispatcherAfterExpirySlot).toBeDefined();

    expect(Number(sellerAfterExpirySlot.seats_left)).toBe(3);
    expect(Number(dispatcherAfterExpirySlot.seats_left)).toBe(3);
    expect(Number(sellerAfterExpirySlot.telegram_active_hold_seats || 0)).toBe(0);
    expect(Number(dispatcherAfterExpirySlot.telegram_active_hold_seats || 0)).toBe(0);
    expect(sellerAfterExpirySlot.telegram_hold_expires_at).toBeNull();
    expect(dispatcherAfterExpirySlot.telegram_hold_expires_at).toBeNull();
  });
});
