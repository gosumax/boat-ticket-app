import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTelegramPersistenceContext,
  TELEGRAM_BOOKING_REQUEST_CREATION_RESULT_VERSION,
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
  `);
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (1, 'seller-a', 'seller', 1)`
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

describe('telegram booking-request creation service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:30:00.000Z');
    context = createTelegramPersistenceContext(db, {
      sourceBindingNow: () => new Date('2026-04-10T10:05:00.000Z'),
      sellerAttributionSessionStartNow: () => new Date('2026-04-10T10:10:00.000Z'),
      sellerAttributionProjectionNow: () => new Date('2026-04-10T10:20:00.000Z'),
      bookingRequestCreationNow: clock.now,
    });
  });

  it('creates one immutable Telegram booking request result from a seller route decision', () => {
    const decision = createSellerRouteDecision(context);

    const result =
      context.services.bookingRequestCreationService.createBookingRequest(
        createBookingInput(decision)
      );

    expect(result).toMatchObject({
      response_version: TELEGRAM_BOOKING_REQUEST_CREATION_RESULT_VERSION,
      booking_request_status: 'NEW',
      telegram_user_summary: {
        telegram_user_id: '777000111',
        display_name: 'Alex Boat',
      },
      current_route_target: {
        route_target_type: 'seller',
        seller_id: 1,
        seller_attribution_session_id: 1,
      },
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: 1,
        guest_profile_id: 1,
        seller_attribution_session_id: 1,
      },
      requested_trip_slot_reference: {
        reference_type: 'telegram_requested_trip_slot_reference',
        requested_trip_date: '2026-04-11',
        requested_time_slot: '12:00',
        slot_uid: 'generated:42',
        boat_slot_id: 42,
      },
      requested_seats: 2,
      requested_prepayment_amount: 1000,
      contact_phone_summary: {
        phone_e164: '+79990000000',
        phone_last4: '0000',
      },
      dedupe_key: 'telegram-booking-create-1',
      idempotency_key: 'telegram-booking-create-1',
      event_timestamp_summary: {
        iso: '2026-04-10T10:30:00.000Z',
        unix_seconds: 1775817000,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.telegram_user_summary)).toBe(true);
    expect(Object.isFrozen(result.current_route_target)).toBe(true);
    expect(Object.isFrozen(result.booking_request_reference)).toBe(true);
    expect(Object.isFrozen(result.requested_trip_slot_reference)).toBe(true);
    expect(Object.isFrozen(result.contact_phone_summary)).toBe(true);

    expect(countRows(db, 'telegram_booking_requests')).toBe(1);
    expect(countRows(db, 'telegram_booking_holds')).toBe(0);
    expect(countRows(db, 'telegram_booking_request_events')).toBe(1);

    const bookingRequest = context.repositories.bookingRequests.getById(1);
    expect(bookingRequest).toMatchObject({
      guest_profile_id: 1,
      seller_attribution_session_id: 1,
      requested_trip_date: '2026-04-11',
      requested_time_slot: '12:00',
      requested_seats: 2,
      requested_ticket_mix: {},
      contact_phone_e164: '+79990000000',
      request_status: 'NEW',
      created_at: '2026-04-10T10:30:00.000Z',
      last_status_at: '2026-04-10T10:30:00.000Z',
    });

    const event = context.repositories.bookingRequestEvents.getById(1);
    expect(event).toMatchObject({
      booking_request_id: 1,
      booking_hold_id: null,
      seller_attribution_session_id: 1,
      event_type: 'REQUEST_CREATED',
      event_at: '2026-04-10T10:30:00.000Z',
      actor_type: 'telegram_guest',
      actor_id: '777000111',
    });
    expect(event.event_payload).toMatchObject({
      booking_request_creation_source: 'telegram_booking_request_creation_service',
      dedupe_key: 'telegram-booking-create-1',
      idempotency_key: 'telegram-booking-create-1',
      no_op_guards: {
        booking_request_created: true,
        booking_hold_created: false,
        seat_hold_created: false,
        prepayment_confirmed: false,
        presale_created: false,
        production_webhook_route_invoked: false,
        bot_command_handler_invoked: false,
        mini_app_ui_invoked: false,
        admin_ui_invoked: false,
        money_ledger_written: false,
      },
    });
    expect(event.event_payload.creation_result).toEqual(result);
  });

  it('replays an exact create-request idempotency key without another write', () => {
    const decision = createSellerRouteDecision(context);
    const input = createBookingInput(decision);
    const first =
      context.services.bookingRequestCreationService.createBookingRequest(input);
    clock.set('2026-04-10T11:30:00.000Z');

    const second =
      context.services.bookingRequestCreationService.createBookingRequest(input);

    expect(second).toEqual(first);
    expect(countRows(db, 'telegram_booking_requests')).toBe(1);
    expect(countRows(db, 'telegram_booking_request_events')).toBe(1);
    expect(countRows(db, 'telegram_booking_holds')).toBe(0);
  });

  it('persists requested_ticket_mix when buyer ticket counters submit a mixed selection', () => {
    const decision = createSellerRouteDecision(context);

    const result =
      context.services.bookingRequestCreationService.createBookingRequest(
        createBookingInput(decision, {
          requested_seats: 4,
          requested_ticket_mix: {
            adult: 2,
            teen: 1,
            child: 1,
          },
          idempotency_key: 'telegram-booking-create-mixed',
        })
      );

    expect(result.requested_seats).toBe(4);
    expect(context.repositories.bookingRequests.getById(1)).toMatchObject({
      requested_seats: 4,
      requested_ticket_mix: {
        adult: 2,
        teen: 1,
        child: 1,
      },
    });
  });

  it('throws a deterministic conflict for payload drift under the same idempotency key', () => {
    const decision = createSellerRouteDecision(context);
    context.services.bookingRequestCreationService.createBookingRequest(
      createBookingInput(decision)
    );

    expect(() =>
      context.services.bookingRequestCreationService.createBookingRequest(
        createBookingInput(decision, { requested_seats: 3 })
      )
    ).toThrow(
      '[TELEGRAM_BOOKING_REQUEST_CREATION] Idempotency conflict for booking request creation: telegram-booking-create-1'
    );
    expect(countRows(db, 'telegram_booking_requests')).toBe(1);
    expect(countRows(db, 'telegram_booking_request_events')).toBe(1);
  });

  it('rejects invalid create-request inputs without writes', () => {
    const decision = createSellerRouteDecision(context);
    const beforeRejectedCreates = snapshotTelegramRowCounts(db);

    expect(() =>
      context.services.bookingRequestCreationService.createBookingRequest({
        ...createBookingInput(decision),
        current_telegram_routing_decision: null,
      })
    ).toThrow('routing decision is required');
    expect(() =>
      context.services.bookingRequestCreationService.createBookingRequest(
        createBookingInput(decision, { requested_seats: 0 })
      )
    ).toThrow('requested_seats must be a positive integer');
    expect(() =>
      context.services.bookingRequestCreationService.createBookingRequest(
        createBookingInput(decision, { requested_prepayment_amount: -1 })
      )
    ).toThrow('requested_prepayment_amount must be a non-negative integer');
    expect(() =>
      context.services.bookingRequestCreationService.createBookingRequest(
        createBookingInput(decision, { contact_phone: '79990000000' })
      )
    ).toThrow('contact_phone must be a valid E.164 phone number');
    expect(() =>
      context.services.bookingRequestCreationService.createBookingRequest(
        createBookingInput(decision, {
          requested_trip_slot_reference: {
            reference_type: 'canonical_boat_slot',
            slot_uid: 'generated:42',
          },
        })
      )
    ).toThrow('Unsupported trip/slot reference type');
    expect(() =>
      context.services.bookingRequestCreationService.createBookingRequest(
        createBookingInput(decision, {
          current_telegram_routing_decision: {
            ...decision,
            routing_status: 'owner_manual',
            seller_attribution_active: false,
            current_route_target: {
              route_target_type: 'owner_manual',
              seller_id: null,
              seller_attribution_session_id: null,
            },
          },
        })
      )
    ).toThrow('Unsupported routing decision for create-request flow: owner_manual');

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeRejectedCreates);
  });

  it('rejects a second active create request for the same guest with a different idempotency key', () => {
    const decision = createSellerRouteDecision(context);
    context.services.bookingRequestCreationService.createBookingRequest(
      createBookingInput(decision)
    );

    expect(() =>
      context.services.bookingRequestCreationService.createBookingRequest(
        createBookingInput(decision, {
          idempotency_key: 'telegram-booking-create-2',
          requested_trip_slot_reference: {
            reference_type: 'telegram_requested_trip_slot_reference',
            requested_trip_date: '2026-04-12',
            requested_time_slot: '14:30',
          },
        })
      )
    ).toThrow('Guest already has an active booking request: 1');
    expect(countRows(db, 'telegram_booking_requests')).toBe(1);
    expect(countRows(db, 'telegram_booking_request_events')).toBe(1);
  });
});
