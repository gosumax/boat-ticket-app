import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTelegramPersistenceContext,
  TELEGRAM_BOOKING_REQUEST_HOLD_EXTENSION_RESULT_VERSION,
} from '../../server/telegram/index.js';

const TELEGRAM_TABLES = Object.freeze([
  'telegram_guest_profiles',
  'telegram_traffic_sources',
  'telegram_source_qr_codes',
  'telegram_seller_attribution_sessions',
  'telegram_seller_attribution_session_start_events',
  'telegram_guest_entries',
  'telegram_guest_entry_events',
  'telegram_guest_entry_source_binding_events',
  'telegram_booking_requests',
  'telegram_booking_holds',
  'telegram_booking_request_events',
  'telegram_content_blocks',
  'telegram_notifications',
  'telegram_analytics_events',
  'telegram_post_trip_messages',
  'telegram_post_trip_offers',
]);

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      role TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE presales (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE generated_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_date TEXT,
      time TEXT,
      capacity INTEGER NOT NULL,
      seats_left INTEGER
    );
    CREATE TABLE boat_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_date TEXT,
      time TEXT,
      capacity INTEGER NOT NULL,
      seats_left INTEGER
    );
  `);
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (1, 'seller-a', 'seller', 1)`
  ).run();
  db.prepare(
    `
      INSERT INTO generated_slots (id, trip_date, time, capacity, seats_left)
      VALUES (42, '2026-04-11', '12:00', 12, 12)
    `
  ).run();
  return db;
}

function createClock(startIso) {
  let current = new Date(startIso);
  return {
    now: () => new Date(current),
    set(iso) {
      current = new Date(iso);
    },
  };
}

function createStartUpdate({
  text = '/start seller-qr-token-a',
  updateId = 987654321,
  messageId = 42,
  telegramUserId = 777000111,
} = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: 1775815200,
      text,
      from: {
        id: telegramUserId,
        is_bot: false,
        first_name: 'Alex',
        last_name: 'Boat',
        username: 'alex_boat',
        language_code: 'ru',
      },
      chat: {
        id: telegramUserId,
        type: 'private',
        first_name: 'Alex',
        last_name: 'Boat',
        username: 'alex_boat',
      },
    },
  };
}

function seedSellerSource(context) {
  const source = context.repositories.trafficSources.create({
    source_code: 'seller-qr-a',
    source_type: 'seller_qr',
    source_name: 'seller-qr-a',
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: 'seller-qr-token-a',
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { code: 'seller-qr-a' },
    is_active: 1,
  });

  return { source, qr };
}

function persistSourceBinding(context, update) {
  const normalized =
    context.services.startUpdateNormalizationService.normalizeStartUpdate(update);
  const guestEntryResult =
    context.services.guestEntryPersistenceService.persistGuestEntry(normalized);
  const sourceResolutionResult =
    context.services.startSourceTokenResolutionService.resolveStartSourceToken({
      normalized_start_event: normalized,
      guest_entry_projection_item:
        context.services.guestEntryProjectionService.readGuestEntryItemByPersistedReference({
          persisted_entry_reference: guestEntryResult.persisted_entry_reference,
        }),
    });

  return context.services.sourceBindingPersistenceService.persistSourceBinding({
    guest_entry_result: guestEntryResult,
    source_resolution_result: sourceResolutionResult,
  });
}

function createSellerRouteDecision(context) {
  seedSellerSource(context);
  const sourceBindingResult = persistSourceBinding(context, createStartUpdate());
  context.services.sellerAttributionSessionStartService.startFromSourceBinding({
    source_binding_result: sourceBindingResult,
  });

  return context.services.guestRoutingDecisionService.decideCurrentRouting({
    telegram_user_id: '777000111',
  });
}

function createBookingInput(decision, overrides = {}) {
  return {
    telegram_guest: decision.telegram_user_summary,
    current_telegram_routing_decision: decision,
    requested_trip_slot_reference: {
      reference_type: 'telegram_requested_trip_slot_reference',
      requested_trip_date: '2026-04-11',
      requested_time_slot: '12:00',
      slot_uid: 'generated:42',
      boat_slot_id: 42,
    },
    requested_seats: 2,
    requested_prepayment_amount: 1000,
    contact_phone: '+79990000000',
    idempotency_key: 'telegram-booking-create-1',
    ...overrides,
  };
}

function createBookingRequest(context) {
  const decision = createSellerRouteDecision(context);

  return context.services.bookingRequestCreationService.createBookingRequest(
    createBookingInput(decision)
  );
}

function activateHold(context, creationResult) {
  return context.services.bookingRequestHoldActivationService.activateHold({
    booking_request_creation_result: creationResult,
  });
}

function extendHold(context, activeHoldState) {
  return context.services.bookingRequestHoldExtensionService.extendHold({
    booking_request_hold_activation_result: activeHoldState,
  });
}

function createActiveHoldState(context) {
  return activateHold(context, createBookingRequest(context));
}

function countRows(db, tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function snapshotTelegramRowCounts(db) {
  return Object.fromEntries(
    TELEGRAM_TABLES.map((tableName) => [
      tableName,
      countRows(db, tableName),
    ])
  );
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('telegram booking-request hold extension service', () => {
  let db;
  let creationClock;
  let activationClock;
  let extensionClock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    creationClock = createClock('2026-04-10T10:30:00.000Z');
    activationClock = createClock('2026-04-10T10:31:00.000Z');
    extensionClock = createClock('2026-04-10T10:35:00.000Z');
    context = createTelegramPersistenceContext(db, {
      sourceBindingNow: () => new Date('2026-04-10T10:05:00.000Z'),
      sellerAttributionSessionStartNow: () => new Date('2026-04-10T10:10:00.000Z'),
      sellerAttributionProjectionNow: () => new Date('2026-04-10T10:20:00.000Z'),
      bookingRequestCreationNow: creationClock.now,
      bookingRequestHoldActivationNow: activationClock.now,
      bookingRequestHoldExtensionNow: extensionClock.now,
    });
  });

  it('extends an existing active initial hold by 10 minutes and writes one immutable event', () => {
    const activeHoldState = createActiveHoldState(context);

    const result = extendHold(context, activeHoldState);

    expect(result).toMatchObject({
      response_version: TELEGRAM_BOOKING_REQUEST_HOLD_EXTENSION_RESULT_VERSION,
      hold_status: 'EXTENDED',
      telegram_user_summary: {
        telegram_user_id: '777000111',
        display_name: 'Alex Boat',
      },
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: 1,
        guest_profile_id: 1,
        seller_attribution_session_id: 1,
      },
      hold_reference: {
        reference_type: 'telegram_booking_hold',
        booking_hold_id: 1,
        booking_request_id: 1,
      },
      requested_trip_slot_reference: {
        reference_type: 'telegram_requested_trip_slot_reference',
        requested_trip_date: '2026-04-11',
        requested_time_slot: '12:00',
        slot_uid: 'generated:42',
        boat_slot_id: 42,
      },
      requested_seats: 2,
      original_hold_expires_at_summary: {
        iso: '2026-04-10T10:46:00.000Z',
        unix_seconds: 1775817960,
      },
      extended_hold_expires_at_summary: {
        iso: '2026-04-10T10:56:00.000Z',
        unix_seconds: 1775818560,
      },
      hold_active: true,
      extension_applied: true,
      dedupe_key:
        'telegram_booking_request_hold_extend:telegram_booking_request_hold_activate:telegram-booking-create-1',
      idempotency_key:
        'telegram_booking_request_hold_extend:telegram_booking_request_hold_activate:telegram-booking-create-1',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.telegram_user_summary)).toBe(true);
    expect(Object.isFrozen(result.booking_request_reference)).toBe(true);
    expect(Object.isFrozen(result.hold_reference)).toBe(true);
    expect(Object.isFrozen(result.requested_trip_slot_reference)).toBe(true);
    expect(Object.isFrozen(result.original_hold_expires_at_summary)).toBe(true);
    expect(Object.isFrozen(result.extended_hold_expires_at_summary)).toBe(true);

    expect(countRows(db, 'telegram_booking_requests')).toBe(1);
    expect(countRows(db, 'telegram_booking_holds')).toBe(1);
    expect(countRows(db, 'telegram_booking_request_events')).toBe(3);
    expect(countRows(db, 'presales')).toBe(0);

    expect(context.repositories.bookingRequests.getById(1)).toMatchObject({
      request_status: 'HOLD_ACTIVE',
      last_status_at: '2026-04-10T10:35:00.000Z',
    });
    expect(context.repositories.bookingHolds.getById(1)).toMatchObject({
      hold_expires_at: '2026-04-10T10:56:00.000Z',
      hold_status: 'EXTENDED',
      started_at: '2026-04-10T10:31:00.000Z',
      last_extended_at: '2026-04-10T10:35:00.000Z',
    });

    const event = context.repositories.bookingRequestEvents.getById(3);
    expect(event).toMatchObject({
      booking_request_id: 1,
      booking_hold_id: 1,
      seller_attribution_session_id: 1,
      event_type: 'HOLD_EXTENDED',
      event_at: '2026-04-10T10:35:00.000Z',
      actor_type: 'telegram_guest',
      actor_id: '777000111',
    });
    expect(event.event_payload).toMatchObject({
      hold_extension_source: 'telegram_booking_request_hold_extension_service',
      hold_status: 'EXTENDED',
      hold_active: true,
      extension_applied: true,
      dedupe_key:
        'telegram_booking_request_hold_extend:telegram_booking_request_hold_activate:telegram-booking-create-1',
      idempotency_key:
        'telegram_booking_request_hold_extend:telegram_booking_request_hold_activate:telegram-booking-create-1',
      no_op_guards: {
        booking_hold_created: false,
        hold_extension_created: true,
        hold_expire_cleanup_run: false,
        prepayment_confirmed: false,
        presale_created: false,
        production_webhook_route_invoked: false,
        bot_command_handler_invoked: false,
        mini_app_ui_invoked: false,
        admin_ui_invoked: false,
        money_ledger_written: false,
      },
    });
    expect(event.event_payload.hold_extension_result).toEqual(result);
  });

  it('replays exact hold extension without another hold or event write', () => {
    const activeHoldState = createActiveHoldState(context);
    const first = extendHold(context, activeHoldState);
    extensionClock.set('2026-04-10T11:35:00.000Z');

    const second = extendHold(context, activeHoldState);

    expect(second).toEqual(first);
    expect(countRows(db, 'telegram_booking_holds')).toBe(1);
    expect(countRows(db, 'telegram_booking_request_events')).toBe(3);
  });

  it('throws a deterministic conflict for extension payload drift under the same idempotency key', () => {
    const activeHoldState = createActiveHoldState(context);
    extendHold(context, activeHoldState);
    const driftedActiveHoldState = cloneJson(activeHoldState);
    driftedActiveHoldState.requested_seats = 3;

    expect(() => extendHold(context, driftedActiveHoldState)).toThrow(
      '[TELEGRAM_BOOKING_REQUEST_HOLD_EXTENSION] Idempotency conflict for booking request hold extension: telegram_booking_request_hold_extend:telegram_booking_request_hold_activate:telegram-booking-create-1'
    );
    expect(countRows(db, 'telegram_booking_holds')).toBe(1);
    expect(countRows(db, 'telegram_booking_request_events')).toBe(3);
  });

  it('rejects invalid references and missing active hold state without writes', () => {
    const missingStateCounts = snapshotTelegramRowCounts(db);
    expect(() => extendHold(context, null)).toThrow('active hold state is required');
    expect(snapshotTelegramRowCounts(db)).toEqual(missingStateCounts);

    const activeHoldState = createActiveHoldState(context);
    const beforeRejectedExtension = snapshotTelegramRowCounts(db);
    const invalidBookingReference = cloneJson(activeHoldState);
    invalidBookingReference.booking_request_reference.reference_type = 'legacy_presale';
    const invalidHoldReference = cloneJson(activeHoldState);
    invalidHoldReference.hold_reference.reference_type = 'legacy_hold';
    const missingBooking = cloneJson(activeHoldState);
    missingBooking.booking_request_reference.booking_request_id = 999;
    missingBooking.hold_reference.booking_request_id = 999;
    const missingHold = cloneJson(activeHoldState);
    missingHold.hold_reference.booking_hold_id = 999;

    expect(() => extendHold(context, invalidBookingReference)).toThrow(
      'Unsupported booking-request reference type: legacy_presale'
    );
    expect(() => extendHold(context, invalidHoldReference)).toThrow(
      'Unsupported hold reference type: legacy_hold'
    );
    expect(() => extendHold(context, missingBooking)).toThrow(
      'Booking request not found: 999'
    );
    expect(() => extendHold(context, missingHold)).toThrow(
      'Booking hold not found: 999'
    );
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeRejectedExtension);
  });

  it('rejects no active hold, already extended hold, and expired hold deterministically', () => {
    const noActiveHoldState = createActiveHoldState(context);
    context.repositories.bookingHolds.updateById(1, {
      hold_status: 'RELEASED',
    });
    const beforeNoActive = snapshotTelegramRowCounts(db);
    expect(() => extendHold(context, noActiveHoldState)).toThrow(
      'No active hold for booking request: 1'
    );
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeNoActive);

    db = createTestDb();
    extensionClock = createClock('2026-04-10T10:35:00.000Z');
    context = createTelegramPersistenceContext(db, {
      sourceBindingNow: () => new Date('2026-04-10T10:05:00.000Z'),
      sellerAttributionSessionStartNow: () => new Date('2026-04-10T10:10:00.000Z'),
      sellerAttributionProjectionNow: () => new Date('2026-04-10T10:20:00.000Z'),
      bookingRequestCreationNow: creationClock.now,
      bookingRequestHoldActivationNow: activationClock.now,
      bookingRequestHoldExtensionNow: extensionClock.now,
    });
    const alreadyExtendedState = createActiveHoldState(context);
    context.repositories.bookingHolds.updateById(1, {
      hold_status: 'EXTENDED',
      last_extended_at: '2026-04-10T10:34:00.000Z',
    });
    const beforeAlreadyExtended = snapshotTelegramRowCounts(db);
    expect(() => extendHold(context, alreadyExtendedState)).toThrow(
      'Hold already extended for booking request: 1'
    );
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeAlreadyExtended);

    db = createTestDb();
    extensionClock = createClock('2026-04-10T10:47:00.000Z');
    context = createTelegramPersistenceContext(db, {
      sourceBindingNow: () => new Date('2026-04-10T10:05:00.000Z'),
      sellerAttributionSessionStartNow: () => new Date('2026-04-10T10:10:00.000Z'),
      sellerAttributionProjectionNow: () => new Date('2026-04-10T10:20:00.000Z'),
      bookingRequestCreationNow: creationClock.now,
      bookingRequestHoldActivationNow: activationClock.now,
      bookingRequestHoldExtensionNow: extensionClock.now,
    });
    const expiredHoldState = createActiveHoldState(context);
    const beforeExpired = snapshotTelegramRowCounts(db);
    expect(() => extendHold(context, expiredHoldState)).toThrow(
      'Active hold is expired for booking request: 1'
    );
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeExpired);
  });
});
