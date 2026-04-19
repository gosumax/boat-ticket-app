import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTelegramPersistenceContext,
  TELEGRAM_GUEST_ENTRY_PERSISTENCE_RESULT_VERSION,
  TELEGRAM_GUEST_ENTRY_STATUS_RECORDED,
} from '../../server/telegram/index.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  return db;
}

function createStartUpdate(overrides = {}) {
  const messageOverrides = overrides.message || {};
  const baseMessage = {
    message_id: 42,
    date: 1775815200,
    text: '/start seller-qr-token-a',
    from: {
      id: 777000111,
      is_bot: false,
      first_name: 'Alex',
      last_name: 'Boat',
      username: 'alex_boat',
      language_code: 'ru',
    },
    chat: {
      id: 777000111,
      type: 'private',
      first_name: 'Alex',
      last_name: 'Boat',
      username: 'alex_boat',
    },
  };

  return {
    update_id: 987654321,
    ...overrides,
    message: {
      ...baseMessage,
      ...messageOverrides,
    },
  };
}

function normalizeStartUpdate(context, rawUpdate = createStartUpdate()) {
  return context.services.startUpdateNormalizationService.normalizeStartUpdate(rawUpdate);
}

function countGuestEntryEvents(db) {
  return db
    .prepare('SELECT COUNT(*) AS count FROM telegram_guest_entry_events')
    .get().count;
}

describe('telegram guest-entry persistence service', () => {
  let db;
  let context;

  beforeEach(() => {
    db = createTestDb();
    context = createTelegramPersistenceContext(db);
  });

  it('persists an immutable source-free entry event from a normalized /start result', () => {
    const normalized = normalizeStartUpdate(context);

    const result = context.services.guestEntryPersistenceService.persistGuestEntry(normalized);

    expect(result).toMatchObject({
      response_version: TELEGRAM_GUEST_ENTRY_PERSISTENCE_RESULT_VERSION,
      entry_status: TELEGRAM_GUEST_ENTRY_STATUS_RECORDED,
      telegram_user_summary: {
        telegram_user_id: '777000111',
        is_bot: false,
        first_name: 'Alex',
        last_name: 'Boat',
        username: 'alex_boat',
        language_code: 'ru',
        display_name: 'Alex Boat',
      },
      telegram_chat_summary: {
        telegram_chat_id: '777000111',
        chat_type: 'private',
        first_name: 'Alex',
        last_name: 'Boat',
        username: 'alex_boat',
        display_name: 'Alex Boat',
      },
      normalized_start_payload: {
        raw_payload: 'seller-qr-token-a',
        normalized_payload: 'seller-qr-token-a',
        has_payload: true,
      },
      source_token: 'seller-qr-token-a',
      persisted_entry_reference: {
        reference_type: 'telegram_guest_entry_event',
        guest_entry_event_id: 1,
        idempotency_key: 'telegram_guest_entry:start_update=987654321:message=42',
      },
      dedupe_key: 'telegram_guest_entry:start_update=987654321:message=42',
      idempotency_key: 'telegram_guest_entry:start_update=987654321:message=42',
      event_timestamp_summary: {
        unix_seconds: 1775815200,
        iso: '2026-04-10T10:00:00.000Z',
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.telegram_user_summary)).toBe(true);
    expect(Object.isFrozen(result.telegram_chat_summary)).toBe(true);
    expect(Object.isFrozen(result.normalized_start_payload)).toBe(true);
    expect(Object.isFrozen(result.persisted_entry_reference)).toBe(true);
    expect(countGuestEntryEvents(db)).toBe(1);

    const stored = context.repositories.guestEntryEvents.getById(1);
    expect(stored).toMatchObject({
      entry_status: TELEGRAM_GUEST_ENTRY_STATUS_RECORDED,
      telegram_update_id: 987654321,
      telegram_message_id: 42,
      source_token: 'seller-qr-token-a',
      idempotency_key: result.idempotency_key,
      dedupe_key: result.dedupe_key,
    });
    expect(stored.entry_payload.no_op_guards).toEqual({
      source_binding_created: false,
      seller_attribution_created: false,
      booking_created: false,
      bot_handler_invoked: false,
      production_route_invoked: false,
      mini_app_ui_invoked: false,
      money_ledger_written: false,
    });
  });

  it('returns the same persisted result for the exact same entry replay', () => {
    const normalized = normalizeStartUpdate(context);
    const first = context.services.guestEntryPersistenceService.persistGuestEntry(normalized);

    const second = context.services.guestEntryPersistenceService.persistGuestEntry(normalized);

    expect(second).toEqual(first);
    expect(countGuestEntryEvents(db)).toBe(1);
  });

  it('rejects payload drift for the same idempotency key', () => {
    const normalized = normalizeStartUpdate(context);
    context.services.guestEntryPersistenceService.persistGuestEntry(normalized);
    const drifted = normalizeStartUpdate(
      context,
      createStartUpdate({
        message: {
          text: '/start seller-qr-token-b',
        },
      })
    );

    expect(() =>
      context.services.guestEntryPersistenceService.persistGuestEntry(drifted)
    ).toThrow(
      '[TELEGRAM_GUEST_ENTRY_PERSISTENCE] Idempotency conflict for guest entry: telegram_guest_entry:start_update=987654321:message=42'
    );
    expect(countGuestEntryEvents(db)).toBe(1);
  });

  it('rejects invalid and unsupported normalized inputs deterministically', () => {
    const normalized = normalizeStartUpdate(context);

    expect(() =>
      context.services.guestEntryPersistenceService.persistGuestEntry(createStartUpdate())
    ).toThrow('[TELEGRAM_GUEST_ENTRY_PERSISTENCE] Unsupported normalized event type: unknown');
    expect(() =>
      context.services.guestEntryPersistenceService.persistGuestEntry({
        ...normalized,
        normalized_event_type: 'telegram.unsupported',
      })
    ).toThrow('Unsupported normalized event type: telegram.unsupported');
    expect(() =>
      context.services.guestEntryPersistenceService.persistGuestEntry({
        ...normalized,
        start_command_present: false,
      })
    ).toThrow('normalized /start command is required');
    expect(() =>
      context.services.guestEntryPersistenceService.persistGuestEntry({
        ...normalized,
        normalized_start_payload: null,
      })
    ).toThrow('normalized_start_payload is required');
  });
});
