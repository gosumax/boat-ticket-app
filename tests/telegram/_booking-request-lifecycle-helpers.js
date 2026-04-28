import Database from 'better-sqlite3';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';

export const TELEGRAM_TABLES = Object.freeze([
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

export function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      public_display_name TEXT,
      public_phone_e164 TEXT,
      role TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE presales (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE boats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      type TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      price_adult REAL NOT NULL DEFAULT 0,
      price_teen REAL NULL,
      price_child REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE generated_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_template_id INTEGER NULL,
      boat_id INTEGER,
      trip_date TEXT,
      time TEXT,
      capacity INTEGER NOT NULL,
      seats_left INTEGER,
      duration_minutes INTEGER NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      price_adult INTEGER NULL,
      price_child INTEGER NULL,
      price_teen INTEGER NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE boat_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_id INTEGER,
      trip_date TEXT,
      time TEXT,
      price INTEGER NULL,
      capacity INTEGER NOT NULL,
      seats_left INTEGER,
      duration_minutes INTEGER NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      price_adult INTEGER NULL,
      price_child INTEGER NULL,
      price_teen INTEGER NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (1, 'seller-a', 'seller', 1)`
  ).run();
  db.prepare(
    `
      INSERT INTO boats (id, name, type, is_active, price_adult, price_teen, price_child)
      VALUES (1, 'Sea Breeze', 'speed', 1, 1800, 1600, 1200)
    `
  ).run();
  db.prepare(
    `
      INSERT INTO generated_slots (id, boat_id, trip_date, time, capacity, seats_left, is_active)
      VALUES
        (41, 1, '2036-04-11', '10:00', 12, 12, 1),
        (42, 1, '2026-04-11', '12:00', 12, 12, 1)
    `
  ).run();
  return db;
}

export function createClock(startIso) {
  let current = new Date(startIso);
  return {
    now: () => new Date(current),
    set(iso) {
      current = new Date(iso);
    },
    advanceMinutes(minutes) {
      current = new Date(current.getTime() + minutes * 60 * 1000);
    },
  };
}

export function createStartUpdate({
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

export function seedSellerSource(context) {
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
    entry_context: {
      code: 'seller-qr-a',
      seller_contact: {
        name: 'Seller A',
        phone_e164: '+79991112233',
      },
    },
    is_active: 1,
  });

  return { source, qr };
}

export function persistSourceBinding(context, update = createStartUpdate()) {
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

export function createSellerRouteDecision(context) {
  seedSellerSource(context);
  const sourceBindingResult = persistSourceBinding(context, createStartUpdate());
  context.services.sellerAttributionSessionStartService.startFromSourceBinding({
    source_binding_result: sourceBindingResult,
  });

  return context.services.guestRoutingDecisionService.decideCurrentRouting({
    telegram_user_id: '777000111',
  });
}

export function createBookingInput(decision, overrides = {}) {
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

export function createLifecycleTestContext({
  creationNow = '2026-04-10T10:30:00.000Z',
  activationNow = '2026-04-10T10:31:00.000Z',
  extensionNow = '2026-04-10T10:35:00.000Z',
  expiryNow = '2026-04-10T10:47:00.000Z',
  cancelNow = '2026-04-10T10:40:00.000Z',
  confirmationNow = '2026-04-10T10:41:00.000Z',
} = {}) {
  const db = createTestDb();
  const clocks = {
    creation: createClock(creationNow),
    activation: createClock(activationNow),
    extension: createClock(extensionNow),
    expiry: createClock(expiryNow),
    cancel: createClock(cancelNow),
    confirmation: createClock(confirmationNow),
  };
  const context = createTelegramPersistenceContext(db, {
    sourceBindingNow: () => new Date('2026-04-10T10:05:00.000Z'),
    sellerAttributionSessionStartNow: () => new Date('2026-04-10T10:10:00.000Z'),
    sellerAttributionProjectionNow: () => new Date('2026-04-10T10:20:00.000Z'),
    bookingRequestCreationNow: clocks.creation.now,
    bookingRequestHoldActivationNow: clocks.activation.now,
    bookingRequestHoldExtensionNow: clocks.extension.now,
    bookingRequestHoldExpiryNow: clocks.expiry.now,
    bookingRequestGuestCancelBeforePrepaymentNow: clocks.cancel.now,
    bookingRequestPrepaymentConfirmationNow: clocks.confirmation.now,
  });

  return { db, context, clocks };
}

export function createBookingRequest(context, overrides = {}) {
  const decision = createSellerRouteDecision(context);

  return context.services.bookingRequestCreationService.createBookingRequest(
    createBookingInput(decision, overrides)
  );
}

export function activateHold(context, creationResult) {
  return context.services.bookingRequestHoldActivationService.activateHold({
    booking_request_creation_result: creationResult,
  });
}

export function extendHold(context, activeHoldState) {
  return context.services.bookingRequestHoldExtensionService.extendHold({
    booking_request_hold_activation_result: activeHoldState,
  });
}

export function expireHold(context, activeHoldState) {
  return context.services.bookingRequestHoldExpiryService.expireHold({
    active_hold_state: activeHoldState,
  });
}

export function countRows(db, tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

export function snapshotTelegramRowCounts(db) {
  return Object.fromEntries(
    TELEGRAM_TABLES.map((tableName) => [tableName, countRows(db, tableName)])
  );
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
