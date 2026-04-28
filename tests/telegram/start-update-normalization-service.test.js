import { describe, expect, it } from 'vitest';
import {
  TELEGRAM_START_UPDATE_NORMALIZED_EVENT_TYPE,
  TelegramStartUpdateNormalizationService,
} from '../../server/telegram/index.js';

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

describe('telegram start-update normalization service', () => {
  it('normalizes an inbound /start message update with a source token', () => {
    const service = new TelegramStartUpdateNormalizationService();

    const normalized = service.normalizeStartUpdate(createStartUpdate());

    expect(normalized).toMatchObject({
      normalized_event_type: TELEGRAM_START_UPDATE_NORMALIZED_EVENT_TYPE,
      telegram_update_id: 987654321,
      telegram_message_id: 42,
      telegram_user: {
        telegram_user_id: '777000111',
        is_bot: false,
        first_name: 'Alex',
        last_name: 'Boat',
        username: 'alex_boat',
        language_code: 'ru',
        display_name: 'Alex Boat',
      },
      telegram_chat: {
        telegram_chat_id: '777000111',
        chat_type: 'private',
        first_name: 'Alex',
        last_name: 'Boat',
        username: 'alex_boat',
        display_name: 'Alex Boat',
      },
      message_text: '/start seller-qr-token-a',
      start_command_present: true,
      start_command: {
        command: '/start',
        bot_username: null,
      },
      normalized_start_payload: {
        raw_payload: 'seller-qr-token-a',
        normalized_payload: 'seller-qr-token-a',
        has_payload: true,
      },
      source_token: 'seller-qr-token-a',
      message_timestamp: {
        unix_seconds: 1775815200,
        iso: '2026-04-10T10:00:00.000Z',
      },
      safe_raw_reference: {
        raw_update_type: 'message',
        telegram_update_id: 987654321,
        telegram_message_id: 42,
        telegram_chat_id: '777000111',
        telegram_user_id: '777000111',
        update_keys: ['message', 'update_id'],
      },
    });
    expect(normalized.safe_raw_reference.message_keys).toEqual([
      'chat',
      'date',
      'from',
      'message_id',
      'text',
    ]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.telegram_user)).toBe(true);
    expect(Object.isFrozen(normalized.telegram_chat)).toBe(true);
    expect(Object.isFrozen(normalized.normalized_start_payload)).toBe(true);
    expect(Object.isFrozen(normalized.safe_raw_reference.message_keys)).toBe(true);
  });

  it('normalizes /start without a payload and with a bot username mention', () => {
    const service = new TelegramStartUpdateNormalizationService();

    const normalized = service.normalizeStartUpdate(
      createStartUpdate({
        message: {
          text: '/start@BoatTicketBot',
          chat: {
            id: -100123456789,
            type: 'supergroup',
            title: 'Boat Tickets',
          },
        },
      })
    );

    expect(normalized).toMatchObject({
      telegram_chat: {
        telegram_chat_id: '-100123456789',
        chat_type: 'supergroup',
        title: 'Boat Tickets',
        display_name: 'Boat Tickets',
      },
      start_command: {
        command: '/start',
        bot_username: 'BoatTicketBot',
      },
      normalized_start_payload: {
        raw_payload: null,
        normalized_payload: null,
        has_payload: false,
      },
      source_token: null,
    });
  });

  it('keeps a non-token start payload while withholding the source token', () => {
    const service = new TelegramStartUpdateNormalizationService();

    const normalized = service.normalizeStartUpdate(
      createStartUpdate({
        message: {
          text: '/start payload with spaces',
        },
      })
    );

    expect(normalized.normalized_start_payload).toEqual({
      raw_payload: 'payload with spaces',
      normalized_payload: 'payload with spaces',
      has_payload: true,
    });
    expect(normalized.source_token).toBeNull();
  });

  it('extracts seller source token from composite handoff payload', () => {
    const service = new TelegramStartUpdateNormalizationService();

    const normalized = service.normalizeStartUpdate(
      createStartUpdate({
        message: {
          text: '/start seller-direct-link-42__p123',
        },
      })
    );

    expect(normalized.normalized_start_payload).toEqual({
      raw_payload: 'seller-direct-link-42__p123',
      normalized_payload: 'seller-direct-link-42__p123',
      has_payload: true,
    });
    expect(normalized.source_token).toBe('seller-direct-link-42');
  });

  it('rejects unsupported update shapes deterministically', () => {
    const service = new TelegramStartUpdateNormalizationService();

    expect(() =>
      service.normalizeStartUpdate({
        update_id: 11,
        callback_query: { id: 'callback-a' },
      })
    ).toThrow('Unsupported non-message update');
    expect(() =>
      service.normalizeStartUpdate(
        createStartUpdate({
          message: {
            text: 'hello',
          },
        })
      )
    ).toThrow('Unsupported message without /start command');
    expect(() =>
      service.normalizeStartUpdate(
        createStartUpdate({
          message: {
            from: null,
          },
        })
      )
    ).toThrow('message.from must contain a usable Telegram user');
    expect(() =>
      service.normalizeStartUpdate(
        createStartUpdate({
          message: {
            chat: { id: null, type: 'private' },
          },
        })
      )
    ).toThrow('message.chat.id must be a usable Telegram id');
  });
});
