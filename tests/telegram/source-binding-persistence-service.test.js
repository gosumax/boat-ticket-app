import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTelegramPersistenceContext,
  TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
  TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION,
} from '../../server/telegram/index.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  return db;
}

function createStartUpdate({ text = '/start seller-qr-token-a', updateId = 987654321 } = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: 42,
      date: 1775815200,
      text,
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
    },
  };
}

function persistGuestEntryAndResolveSource(context, update) {
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

  return {
    guestEntryResult,
    sourceResolutionResult,
  };
}

function countSourceBindingEvents(db) {
  return db
    .prepare('SELECT COUNT(*) AS count FROM telegram_guest_entry_source_binding_events')
    .get().count;
}

describe('telegram source-binding persistence service', () => {
  let db;
  let context;

  beforeEach(() => {
    db = createTestDb();
    context = createTelegramPersistenceContext(db, {
      sourceBindingNow: () => new Date('2026-04-10T10:05:00.000Z'),
    });
  });

  it.each([
    {
      text: '/start',
      bindingStatus: 'no_source_token',
      rawSourceToken: null,
      normalizedSourceToken: null,
      resolvedSourceFamily: null,
    },
    {
      text: '/start mystery-token-a',
      bindingStatus: 'unresolved_source_token',
      rawSourceToken: 'mystery-token-a',
      normalizedSourceToken: 'mystery-token-a',
      resolvedSourceFamily: null,
    },
    {
      text: '/start seller-qr-token-a',
      bindingStatus: 'resolved_seller_source',
      rawSourceToken: 'seller-qr-token-a',
      normalizedSourceToken: 'seller-qr-token-a',
      resolvedSourceFamily: 'seller_qr',
    },
    {
      text: '/start owner-desk-a',
      bindingStatus: 'resolved_owner_source',
      rawSourceToken: 'owner-desk-a',
      normalizedSourceToken: 'owner-desk-a',
      resolvedSourceFamily: 'owner_source',
    },
    {
      text: '/start promo-token-a',
      bindingStatus: 'resolved_generic_source',
      rawSourceToken: 'promo-token-a',
      normalizedSourceToken: 'promo-token-a',
      resolvedSourceFamily: 'promo_qr',
    },
  ])(
    'persists one immutable $bindingStatus source-binding event',
    ({
      text,
      bindingStatus,
      rawSourceToken,
      normalizedSourceToken,
      resolvedSourceFamily,
    }) => {
      const { guestEntryResult, sourceResolutionResult } =
        persistGuestEntryAndResolveSource(context, createStartUpdate({ text }));

      const result =
        context.services.sourceBindingPersistenceService.persistSourceBinding({
          guest_entry_result: guestEntryResult,
          source_resolution_result: sourceResolutionResult,
        });

      expect(result).toMatchObject({
        response_version: TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION,
        binding_status: bindingStatus,
        telegram_user_summary: {
          telegram_user_id: '777000111',
          display_name: 'Alex Boat',
        },
        guest_entry_reference: guestEntryResult.persisted_entry_reference,
        source_binding_reference: {
          reference_type: 'telegram_guest_entry_source_binding_event',
          source_binding_event_id: 1,
          guest_entry_event_id:
            guestEntryResult.persisted_entry_reference.guest_entry_event_id,
          event_type: TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
          idempotency_key: 'telegram_source_binding:guest_entry_event=1',
        },
        raw_source_token: rawSourceToken,
        normalized_source_token: normalizedSourceToken,
        resolved_source_family: resolvedSourceFamily,
        source_resolution_outcome: bindingStatus,
        source_resolution_summary: {
          response_version: sourceResolutionResult.response_version,
          resolution_status: bindingStatus,
        },
        dedupe_key: 'telegram_source_binding:guest_entry_event=1',
        idempotency_key: 'telegram_source_binding:guest_entry_event=1',
        event_timestamp_summary: {
          source_binding_event_timestamp: {
            unix_seconds: 1775815500,
            iso: '2026-04-10T10:05:00.000Z',
          },
          guest_entry_event_timestamp: {
            unix_seconds: 1775815200,
            iso: '2026-04-10T10:00:00.000Z',
          },
        },
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.telegram_user_summary)).toBe(true);
      expect(Object.isFrozen(result.guest_entry_reference)).toBe(true);
      expect(Object.isFrozen(result.source_binding_reference)).toBe(true);
      expect(Object.isFrozen(result.event_timestamp_summary)).toBe(true);
      expect(countSourceBindingEvents(db)).toBe(1);

      const stored =
        context.repositories.guestEntrySourceBindingEvents.getById(1);
      expect(stored).toMatchObject({
        guest_entry_event_id:
          guestEntryResult.persisted_entry_reference.guest_entry_event_id,
        event_type: TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
        binding_status: bindingStatus,
        raw_source_token: rawSourceToken,
        normalized_source_token: normalizedSourceToken,
        resolved_source_family: resolvedSourceFamily,
        source_resolution_outcome: bindingStatus,
        idempotency_key: 'telegram_source_binding:guest_entry_event=1',
        dedupe_key: 'telegram_source_binding:guest_entry_event=1',
      });
      expect(stored.binding_payload.no_op_guards).toEqual({
        seller_attribution_created: false,
        booking_created: false,
        production_webhook_route_invoked: false,
        bot_command_handler_invoked: false,
        mini_app_ui_invoked: false,
        admin_ui_invoked: false,
        money_ledger_written: false,
      });
    }
  );

  it('returns the same persisted result for an exact source-binding replay', () => {
    const { guestEntryResult, sourceResolutionResult } =
      persistGuestEntryAndResolveSource(context, createStartUpdate());
    const first =
      context.services.sourceBindingPersistenceService.persistSourceBinding(
        guestEntryResult,
        sourceResolutionResult
      );

    const second =
      context.services.sourceBindingPersistenceService.persistSourceBinding(
        guestEntryResult,
        sourceResolutionResult
      );

    expect(second).toEqual(first);
    expect(countSourceBindingEvents(db)).toBe(1);
  });

  it('throws a deterministic idempotency conflict for payload drift on the same binding key', () => {
    const { guestEntryResult, sourceResolutionResult } =
      persistGuestEntryAndResolveSource(context, createStartUpdate());
    context.services.sourceBindingPersistenceService.persistSourceBinding({
      guest_entry_result: guestEntryResult,
      source_resolution_result: sourceResolutionResult,
    });
    const driftedResolution = {
      ...sourceResolutionResult,
      source_resolution_reason: 'drifted_resolution_reason',
    };

    expect(() =>
      context.services.sourceBindingPersistenceService.persistSourceBinding({
        guest_entry_result: guestEntryResult,
        source_resolution_result: driftedResolution,
      })
    ).toThrow(
      '[TELEGRAM_SOURCE_BINDING_PERSISTENCE] Idempotency conflict for source binding: telegram_source_binding:guest_entry_event=1'
    );
    expect(countSourceBindingEvents(db)).toBe(1);
  });

  it('rejects incompatible guest-entry/source-resolution pairs deterministically', () => {
    const { guestEntryResult, sourceResolutionResult } =
      persistGuestEntryAndResolveSource(context, createStartUpdate());
    const otherResolution =
      context.services.startSourceTokenResolutionService.resolveStartSourceToken(
        context.services.startUpdateNormalizationService.normalizeStartUpdate(
          createStartUpdate({
            text: '/start promo-token-a',
            updateId: 987654322,
          })
        )
      );

    expect(() =>
      context.services.sourceBindingPersistenceService.persistSourceBinding({
        guest_entry_result: guestEntryResult,
        source_resolution_result: otherResolution,
      })
    ).toThrow('guest-entry source token does not match source resolution');
    expect(() =>
      context.services.sourceBindingPersistenceService.persistSourceBinding({
        guest_entry_result: {
          ...guestEntryResult,
          response_version: 'telegram_guest_entry_legacy.v0',
        },
        source_resolution_result: sourceResolutionResult,
      })
    ).toThrow('Unsupported guest-entry result version');
    expect(() =>
      context.services.sourceBindingPersistenceService.persistSourceBinding({
        guest_entry_result: {
          ...guestEntryResult,
          persisted_entry_reference: {
            ...guestEntryResult.persisted_entry_reference,
            guest_entry_event_id: 999,
          },
        },
        source_resolution_result: sourceResolutionResult,
      })
    ).toThrow('Guest-entry event not found: 999');

    expect(countSourceBindingEvents(db)).toBe(0);
  });
});
