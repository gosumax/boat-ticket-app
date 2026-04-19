import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTelegramPersistenceContext,
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_START_RESULT_VERSION,
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_STARTED_EVENT_TYPE,
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_SKIPPED_EVENT_TYPE,
} from '../../server/telegram/index.js';

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
  `);
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (1, 'seller-a', 'seller', 1)`
  ).run();
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

function createClock(startIso) {
  let current = new Date(startIso);
  return {
    now: () => new Date(current),
    set(iso) {
      current = new Date(iso);
    },
  };
}

function seedSource(
  context,
  {
    code = 'seller-qr-a',
    type = 'seller_qr',
    qrToken = 'seller-qr-token-a',
    sellerId = 1,
  } = {}
) {
  const source = context.repositories.trafficSources.create({
    source_code: code,
    source_type: type,
    source_name: code,
    default_seller_id: sellerId,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: qrToken,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: { code },
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

function countRows(db, tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

describe('telegram seller-attribution session start service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:10:00.000Z');
    context = createTelegramPersistenceContext(db, {
      sourceBindingNow: () => new Date('2026-04-10T10:05:00.000Z'),
      sellerAttributionSessionStartNow: clock.now,
    });
  });

  it('starts one seller attribution session from a persisted resolved seller source binding', () => {
    seedSource(context);
    const sourceBindingResult = persistSourceBinding(context, createStartUpdate());

    const result =
      context.services.sellerAttributionSessionStartService
        .startSellerAttributionFromSourceBinding(sourceBindingResult);

    expect(result).toMatchObject({
      response_version: TELEGRAM_SELLER_ATTRIBUTION_SESSION_START_RESULT_VERSION,
      attribution_status: 'ACTIVE',
      no_attribution_reason: null,
      telegram_user_summary: {
        telegram_user_id: '777000111',
        display_name: 'Alex Boat',
      },
      telegram_guest_summary: {
        guest_profile_id: 1,
        telegram_user_id: '777000111',
        display_name: 'Alex Boat',
        profile_status: 'active',
      },
      source_binding_reference: sourceBindingResult.source_binding_reference,
      attribution_session_reference: {
        reference_type: 'telegram_seller_attribution_session',
        seller_attribution_session_id: 1,
        guest_profile_id: 1,
        traffic_source_id: 1,
        source_qr_code_id: 1,
        seller_id: 1,
        attribution_status: 'ACTIVE',
      },
      seller_attribution_active: true,
      attribution_started_at_summary: {
        unix_seconds: 1775815800,
        iso: '2026-04-10T10:10:00.000Z',
      },
      attribution_expires_at_summary: {
        unix_seconds: 1775923800,
        iso: '2026-04-11T16:10:00.000Z',
      },
      dedupe_key: 'telegram_seller_attribution_session_start:source_binding_event=1',
      idempotency_key: 'telegram_seller_attribution_session_start:source_binding_event=1',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.telegram_user_summary)).toBe(true);
    expect(Object.isFrozen(result.source_binding_reference)).toBe(true);
    expect(Object.isFrozen(result.attribution_session_reference)).toBe(true);
    expect(countRows(db, 'telegram_seller_attribution_sessions')).toBe(1);
    expect(countRows(db, 'telegram_seller_attribution_session_start_events')).toBe(1);
    expect(countRows(db, 'telegram_booking_requests')).toBe(0);

    const storedSession = context.repositories.sellerAttributionSessions.getById(1);
    expect(storedSession).toMatchObject({
      guest_profile_id: 1,
      traffic_source_id: 1,
      source_qr_code_id: 1,
      seller_id: 1,
      starts_at: '2026-04-10T10:10:00.000Z',
      expires_at: '2026-04-11T16:10:00.000Z',
      attribution_status: 'ACTIVE',
      binding_reason: 'seller_qr',
    });

    const storedEvent =
      context.repositories.sellerAttributionSessionStartEvents.getById(1);
    expect(storedEvent).toMatchObject({
      source_binding_event_id: 1,
      seller_attribution_session_id: 1,
      event_type: TELEGRAM_SELLER_ATTRIBUTION_SESSION_STARTED_EVENT_TYPE,
      attribution_status: 'ACTIVE',
      seller_attribution_active: 1,
      idempotency_key:
        'telegram_seller_attribution_session_start:source_binding_event=1',
    });
    expect(storedEvent.event_payload.no_op_guards).toEqual({
      seller_attribution_created: true,
      booking_created: false,
      production_webhook_route_invoked: false,
      bot_command_handler_invoked: false,
      mini_app_ui_invoked: false,
      admin_ui_invoked: false,
      money_ledger_written: false,
    });
  });

  it.each([
    {
      text: '/start owner-desk-a',
      reason: 'resolved_owner_source_has_no_seller_attribution',
    },
    {
      text: '/start promo-token-a',
      reason: 'resolved_generic_source_has_no_seller_attribution',
    },
    {
      text: '/start',
      reason: 'no_source_token_has_no_seller_attribution',
    },
    {
      text: '/start mystery-token-a',
      reason: 'unresolved_source_token_has_no_seller_attribution',
    },
  ])('skips seller attribution for $text', ({ text, reason }) => {
    const sourceBindingResult = persistSourceBinding(
      context,
      createStartUpdate({ text })
    );

    const result =
      context.services.sellerAttributionSessionStartService.startFromSourceBinding({
        source_binding_result: sourceBindingResult,
      });

    expect(result).toMatchObject({
      response_version: TELEGRAM_SELLER_ATTRIBUTION_SESSION_START_RESULT_VERSION,
      attribution_status: 'NO_SELLER_ATTRIBUTION',
      no_attribution_reason: reason,
      source_binding_reference: sourceBindingResult.source_binding_reference,
      attribution_session_reference: null,
      seller_attribution_active: false,
      attribution_started_at_summary: null,
      attribution_expires_at_summary: null,
      idempotency_key: 'telegram_seller_attribution_session_start:source_binding_event=1',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(countRows(db, 'telegram_seller_attribution_sessions')).toBe(0);
    expect(countRows(db, 'telegram_seller_attribution_session_start_events')).toBe(1);

    const storedEvent =
      context.repositories.sellerAttributionSessionStartEvents.getById(1);
    expect(storedEvent).toMatchObject({
      source_binding_event_id: 1,
      seller_attribution_session_id: null,
      event_type: TELEGRAM_SELLER_ATTRIBUTION_SESSION_SKIPPED_EVENT_TYPE,
      attribution_status: 'NO_SELLER_ATTRIBUTION',
      no_attribution_reason: reason,
      seller_attribution_active: 0,
    });
  });

  it('returns the same persisted result for an exact seller-attribution start replay', () => {
    seedSource(context);
    const sourceBindingResult = persistSourceBinding(context, createStartUpdate());
    const first =
      context.services.sellerAttributionSessionStartService.start(sourceBindingResult);
    clock.set('2026-04-10T11:15:00.000Z');

    const second =
      context.services.sellerAttributionSessionStartService.start(sourceBindingResult);

    expect(second).toEqual(first);
    expect(countRows(db, 'telegram_seller_attribution_sessions')).toBe(1);
    expect(countRows(db, 'telegram_seller_attribution_session_start_events')).toBe(1);
  });

  it('creates runtime traffic-source and qr linkage from source-registry token when missing', () => {
    context.services.sourceRegistryService.createSourceRegistryItem({
      source_reference: 'seller-qr-token-a',
      source_family: 'seller_source',
      source_type: 'seller_qr',
      source_token: 'seller-qr-token-a',
      seller_id: 1,
    });
    const sourceBindingResult = persistSourceBinding(context, createStartUpdate());

    const result =
      context.services.sellerAttributionSessionStartService.start(sourceBindingResult);

    expect(result).toMatchObject({
      attribution_status: 'ACTIVE',
      seller_attribution_active: true,
      attribution_session_reference: {
        source_qr_code_id: 1,
        traffic_source_id: 1,
        seller_id: 1,
      },
    });
    expect(countRows(db, 'telegram_traffic_sources')).toBe(1);
    expect(countRows(db, 'telegram_source_qr_codes')).toBe(1);
    expect(countRows(db, 'telegram_seller_attribution_sessions')).toBe(1);
  });

  it('throws a deterministic idempotency conflict for payload drift on the same start key', () => {
    seedSource(context);
    const sourceBindingResult = persistSourceBinding(context, createStartUpdate());
    context.services.sellerAttributionSessionStartService.start(sourceBindingResult);
    const driftedSourceBindingResult = {
      ...sourceBindingResult,
      telegram_user_summary: {
        ...sourceBindingResult.telegram_user_summary,
        display_name: 'Drifted Guest',
      },
    };

    expect(() =>
      context.services.sellerAttributionSessionStartService.start(
        driftedSourceBindingResult
      )
    ).toThrow(
      '[TELEGRAM_SELLER_ATTRIBUTION_SESSION_START] Idempotency conflict for seller-attribution session start: telegram_seller_attribution_session_start:source_binding_event=1'
    );
    expect(countRows(db, 'telegram_seller_attribution_sessions')).toBe(1);
    expect(countRows(db, 'telegram_seller_attribution_session_start_events')).toBe(1);
  });

  it('rejects invalid or incompatible source-binding inputs deterministically', () => {
    const sourceBindingResult = persistSourceBinding(context, createStartUpdate());

    expect(() =>
      context.services.sellerAttributionSessionStartService.start({
        response_version: 'telegram_start_source_token_resolution.v1',
      })
    ).toThrow('Unsupported source-binding result version');

    expect(() =>
      context.services.sellerAttributionSessionStartService.start({
        ...sourceBindingResult,
        source_binding_reference: {
          ...sourceBindingResult.source_binding_reference,
          source_binding_event_id: 999,
        },
      })
    ).toThrow('Source-binding event not found: 999');

    expect(() =>
      context.services.sellerAttributionSessionStartService.start(
        sourceBindingResult
      )
    ).toThrow('Source QR code not found for source token: seller-qr-token-a');

    seedSource(context, {
      code: 'seller-qr-wrong-type',
      type: 'promo_qr',
      qrToken: 'seller-qr-token-a',
      sellerId: 1,
    });
    expect(() =>
      context.services.sellerAttributionSessionStartService.start(
        sourceBindingResult
      )
    ).toThrow('Resolved source family does not match traffic source type: promo_qr');
  });
});
