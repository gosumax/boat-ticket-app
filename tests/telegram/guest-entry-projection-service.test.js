import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTelegramPersistenceContext,
  TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE,
  TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION,
  TELEGRAM_GUEST_ENTRY_STATUS_RECORDED,
} from '../../server/telegram/index.js';

const TELEGRAM_TABLES = Object.freeze([
  'telegram_guest_profiles',
  'telegram_traffic_sources',
  'telegram_source_qr_codes',
  'telegram_seller_attribution_sessions',
  'telegram_guest_entries',
  'telegram_guest_entry_events',
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
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  return db;
}

function createStartUpdate({
  updateId = 987654321,
  messageId = 42,
  unixSeconds = 1775815200,
  telegramUserId = 777000111,
  firstName = 'Alex',
  lastName = 'Boat',
  username = 'alex_boat',
  payload = 'seller-qr-token-a',
} = {}) {
  const text = payload === null ? '/start' : `/start ${payload}`;

  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: unixSeconds,
      text,
      from: {
        id: telegramUserId,
        is_bot: false,
        first_name: firstName,
        last_name: lastName,
        username,
        language_code: 'ru',
      },
      chat: {
        id: telegramUserId,
        type: 'private',
        first_name: firstName,
        last_name: lastName,
        username,
      },
    },
  };
}

function persistStartGuestEntry(context, update) {
  const normalized =
    context.services.startUpdateNormalizationService.normalizeStartUpdate(update);

  return context.services.guestEntryPersistenceService.persistGuestEntry(normalized);
}

function snapshotTelegramRowCounts(db) {
  return Object.fromEntries(
    TELEGRAM_TABLES.map((tableName) => [
      tableName,
      db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count,
    ])
  );
}

describe('telegram guest-entry projection service', () => {
  let db;
  let context;

  beforeEach(() => {
    db = createTestDb();
    context = createTelegramPersistenceContext(db);
  });

  it('lists frozen guest-entry history for a Telegram guest from persisted events only', () => {
    const later = persistStartGuestEntry(
      context,
      createStartUpdate({
        updateId: 5002,
        messageId: 52,
        unixSeconds: 1775815500,
        payload: 'seller-qr-token-later',
      })
    );
    const earlier = persistStartGuestEntry(
      context,
      createStartUpdate({
        updateId: 5001,
        messageId: 51,
        unixSeconds: 1775815200,
        payload: 'seller-qr-token-earlier',
      })
    );
    persistStartGuestEntry(
      context,
      createStartUpdate({
        updateId: 6001,
        messageId: 61,
        unixSeconds: 1775815320,
        telegramUserId: 888000222,
        firstName: 'Other',
        lastName: 'Guest',
        username: 'other_guest',
        payload: 'other-token',
      })
    );
    const beforeProjectionCounts = snapshotTelegramRowCounts(db);

    const history =
      context.services.guestEntryProjectionService
        .listGuestEntryHistoryForTelegramGuest({
          telegram_user_id: '777000111',
          limit: 10,
        });

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeProjectionCounts);
    expect(history).toMatchObject({
      response_version: TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION,
      read_only: true,
      projection_only: true,
      source: 'persisted_telegram_guest_entry_events',
      telegram_user_id: '777000111',
      history_order: 'event_timestamp_asc_guest_entry_event_id_asc',
      item_count: 2,
      no_op_guards: {
        source_binding_created: false,
        seller_attribution_created: false,
        booking_created: false,
        production_webhook_route_invoked: false,
        bot_command_handler_invoked: false,
        mini_app_ui_invoked: false,
        admin_ui_invoked: false,
        money_ledger_written: false,
      },
    });
    expect(history.items.map((item) => item.persisted_entry_reference))
      .toEqual([earlier.persisted_entry_reference, later.persisted_entry_reference]);
    expect(history.items[0]).toMatchObject({
      response_version: TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION,
      projection_item_type: TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE,
      entry_status: TELEGRAM_GUEST_ENTRY_STATUS_RECORDED,
      telegram_user_summary: {
        telegram_user_id: '777000111',
        display_name: 'Alex Boat',
      },
      telegram_chat_summary: {
        telegram_chat_id: '777000111',
        chat_type: 'private',
        display_name: 'Alex Boat',
      },
      normalized_start_payload: {
        raw_payload: 'seller-qr-token-earlier',
        normalized_payload: 'seller-qr-token-earlier',
        has_payload: true,
      },
      source_token: 'seller-qr-token-earlier',
      dedupe_key: 'telegram_guest_entry:start_update=5001:message=51',
      idempotency_key: 'telegram_guest_entry:start_update=5001:message=51',
      event_timestamp_summary: {
        unix_seconds: 1775815200,
        iso: '2026-04-10T10:00:00.000Z',
      },
      read_only: true,
      projection_only: true,
      projected_by: 'telegram_guest_entry_projection_service',
    });
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history.items)).toBe(true);
    expect(Object.isFrozen(history.items[0])).toBe(true);
    expect(Object.isFrozen(history.items[0].telegram_user_summary)).toBe(true);
    expect(Object.isFrozen(history.items[0].persisted_entry_reference)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_guest_profiles').get().count)
      .toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_booking_requests').get().count)
      .toBe(0);
  });

  it('reads one guest-entry item by persisted reference and reads the latest guest entry', () => {
    const first = persistStartGuestEntry(
      context,
      createStartUpdate({
        updateId: 7001,
        messageId: 71,
        unixSeconds: 1775815200,
        payload: null,
      })
    );
    const latest = persistStartGuestEntry(
      context,
      createStartUpdate({
        updateId: 7002,
        messageId: 72,
        unixSeconds: 1775815800,
        payload: 'latest-token',
      })
    );
    const beforeReads = snapshotTelegramRowCounts(db);

    const read =
      context.services.guestEntryProjectionService
        .readGuestEntryItemByPersistedReference({
          persisted_entry_reference: first.persisted_entry_reference,
        });
    const latestRead =
      context.services.guestEntryProjectionService
        .readLatestGuestEntryForTelegramGuest({
          telegram_user_id: '777000111',
        });

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeReads);
    expect(read).toMatchObject({
      source_token: null,
      persisted_entry_reference: first.persisted_entry_reference,
      normalized_start_payload: {
        raw_payload: null,
        normalized_payload: null,
        has_payload: false,
      },
    });
    expect(latestRead).toMatchObject({
      source_token: 'latest-token',
      persisted_entry_reference: latest.persisted_entry_reference,
      event_timestamp_summary: {
        iso: '2026-04-10T10:10:00.000Z',
      },
    });
    expect(
      context.services.guestEntryProjectionService.readGuestEntryItem(
        latest.persisted_entry_reference.guest_entry_event_id
      )
    ).toEqual(latestRead);
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(latestRead)).toBe(true);
  });

  it('rejects invalid and non-projectable guest-entry items deterministically without writes', () => {
    const persisted = persistStartGuestEntry(context, createStartUpdate());
    const eventId = persisted.persisted_entry_reference.guest_entry_event_id;

    expect(() =>
      context.services.guestEntryProjectionService.readGuestEntryItem({
        persisted_entry_reference: {
          ...persisted.persisted_entry_reference,
          idempotency_key: 'mismatched-key',
        },
      })
    ).toThrow('Guest-entry reference idempotency key mismatch');

    const entryPayload = db
      .prepare(
        `
          SELECT entry_payload
          FROM telegram_guest_entry_events
          WHERE guest_entry_event_id = ?
        `
      )
      .get(eventId).entry_payload;
    const tamperedPayload = {
      ...JSON.parse(entryPayload),
      guest_entry_persistence_source: 'legacy_guest_entry_import',
    };

    db.prepare(
      `
        UPDATE telegram_guest_entry_events
        SET entry_payload = ?
        WHERE guest_entry_event_id = ?
      `
    ).run(JSON.stringify(tamperedPayload), eventId);
    const beforeRejectedReads = snapshotTelegramRowCounts(db);

    expect(() =>
      context.services.guestEntryProjectionService.readGuestEntryItem({
        persisted_entry_reference: persisted.persisted_entry_reference,
      })
    ).toThrow('Guest-entry event source is not projectable');
    expect(() =>
      context.services.guestEntryProjectionService.listGuestEntryHistory({
        telegram_user_id: '777000111',
      })
    ).toThrow('Guest-entry event source is not projectable');
    expect(() =>
      context.services.guestEntryProjectionService.readGuestEntryItem({
        persisted_entry_reference: {
          reference_type: 'telegram_booking_request_event',
          guest_entry_event_id: eventId,
        },
      })
    ).toThrow('Unsupported guest-entry reference type');
    expect(() =>
      context.services.guestEntryProjectionService.readGuestEntryItem({
        guest_entry_event_id: 9999,
      })
    ).toThrow('Guest-entry item not found');
    expect(() =>
      context.services.guestEntryProjectionService.listGuestEntryHistory({})
    ).toThrow('telegram_user_id is required');

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeRejectedReads);
  });
});
