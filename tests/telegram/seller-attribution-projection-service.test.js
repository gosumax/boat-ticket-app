import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTelegramPersistenceContext,
  TELEGRAM_SELLER_ATTRIBUTION_PROJECTION_VERSION,
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

function startAttribution(context, sourceBindingResult) {
  return context.services.sellerAttributionSessionStartService.startFromSourceBinding({
    source_binding_result: sourceBindingResult,
  });
}

function snapshotTelegramRowCounts(db) {
  return Object.fromEntries(
    TELEGRAM_TABLES.map((tableName) => [
      tableName,
      db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count,
    ])
  );
}

describe('telegram seller-attribution projection service', () => {
  let db;
  let startClock;
  let projectionClock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    startClock = createClock('2026-04-10T10:10:00.000Z');
    projectionClock = createClock('2026-04-10T12:00:00.000Z');
    context = createTelegramPersistenceContext(db, {
      sourceBindingNow: () => new Date('2026-04-10T10:05:00.000Z'),
      sellerAttributionSessionStartNow: startClock.now,
      sellerAttributionProjectionNow: projectionClock.now,
    });
  });

  it('reads a frozen active seller attribution projection by guest, source binding, and attribution session', () => {
    seedSource(context);
    const sourceBindingResult = persistSourceBinding(context, createStartUpdate());
    const startedAttribution = startAttribution(context, sourceBindingResult);
    const beforeReads = snapshotTelegramRowCounts(db);

    const current =
      context.services.sellerAttributionProjectionService
        .readCurrentAttributionStateForTelegramGuest({
          telegram_user_id: '777000111',
        });
    const bySourceBinding =
      context.services.sellerAttributionProjectionService
        .readAttributionBySourceBindingReference({
          source_binding_reference: sourceBindingResult.source_binding_reference,
        });
    const bySession =
      context.services.sellerAttributionProjectionService
        .readAttributionByAttributionSessionReference({
          attribution_session_reference:
            startedAttribution.attribution_session_reference,
        });

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeReads);
    expect(current).toMatchObject({
      response_version: TELEGRAM_SELLER_ATTRIBUTION_PROJECTION_VERSION,
      read_only: true,
      projection_only: true,
      attribution_status: 'ACTIVE',
      telegram_user_summary: {
        telegram_user_id: '777000111',
        display_name: 'Alex Boat',
      },
      source_binding_reference: sourceBindingResult.source_binding_reference,
      attribution_session_reference:
        startedAttribution.attribution_session_reference,
      seller_attribution_active: true,
      attribution_started_at_summary: {
        unix_seconds: 1775815800,
        iso: '2026-04-10T10:10:00.000Z',
      },
      attribution_expires_at_summary: {
        unix_seconds: 1775923800,
        iso: '2026-04-11T16:10:00.000Z',
      },
      no_attribution_reason: null,
      projection_source: {
        primary_data: 'telegram_seller_attribution_session_start_events',
        source_binding_data: 'telegram_guest_entry_source_binding_events',
        mutable_session_status_used: false,
        booking_data_used: false,
        money_data_used: false,
      },
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
    expect(bySourceBinding).toEqual(current);
    expect(bySession).toEqual(current);
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current.telegram_user_summary)).toBe(true);
    expect(Object.isFrozen(current.source_binding_reference)).toBe(true);
    expect(Object.isFrozen(current.attribution_session_reference)).toBe(true);
  });

  it('preserves an active seller attribution as current when a later source binding has no seller attribution', () => {
    seedSource(context);
    const sellerBinding = persistSourceBinding(context, createStartUpdate());
    const sellerAttribution = startAttribution(context, sellerBinding);

    startClock.set('2026-04-10T10:20:00.000Z');
    const noSellerBinding = persistSourceBinding(
      context,
      createStartUpdate({
        text: '/start',
        updateId: 987654322,
        messageId: 43,
      })
    );
    const noSellerAttribution = startAttribution(context, noSellerBinding);
    const beforeReads = snapshotTelegramRowCounts(db);

    const current =
      context.services.sellerAttributionProjectionService.readCurrentAttribution({
        telegram_user_id: '777000111',
      });
    const noSellerProjection =
      context.services.sellerAttributionProjectionService
        .readAttributionBySourceBindingReference(noSellerBinding);

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeReads);
    expect(current).toMatchObject({
      attribution_status: 'ACTIVE',
      source_binding_reference: sellerBinding.source_binding_reference,
      attribution_session_reference:
        sellerAttribution.attribution_session_reference,
      seller_attribution_active: true,
      no_attribution_reason: null,
    });
    expect(noSellerProjection).toMatchObject({
      attribution_status: 'NO_SELLER_ATTRIBUTION',
      source_binding_reference: noSellerBinding.source_binding_reference,
      attribution_session_reference: null,
      seller_attribution_active: false,
      no_attribution_reason: 'no_source_token_has_no_seller_attribution',
    });
    expect(noSellerAttribution.seller_attribution_active).toBe(false);
  });

  it('returns an expired read-only state without mutating the stored seller-attribution session', () => {
    seedSource(context);
    const sourceBindingResult = persistSourceBinding(context, createStartUpdate());
    const startedAttribution = startAttribution(context, sourceBindingResult);
    projectionClock.set('2026-04-11T17:00:00.000Z');
    const beforeReads = snapshotTelegramRowCounts(db);

    const projection =
      context.services.sellerAttributionProjectionService
        .readByAttributionSessionReference({
          attribution_session_reference:
            startedAttribution.attribution_session_reference,
        });

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeReads);
    expect(projection).toMatchObject({
      attribution_status: 'SELLER_ATTRIBUTION_EXPIRED',
      source_binding_reference: sourceBindingResult.source_binding_reference,
      attribution_session_reference:
        startedAttribution.attribution_session_reference,
      seller_attribution_active: false,
      no_attribution_reason: 'seller_attribution_expired',
      attribution_expires_at_summary: {
        iso: '2026-04-11T16:10:00.000Z',
      },
    });
    expect(
      context.repositories.sellerAttributionSessions.getById(1)
        .attribution_status
    ).toBe('ACTIVE');
  });

  it('returns an unavailable state for a persisted source binding before session start data exists', () => {
    const sourceBindingResult = persistSourceBinding(context, createStartUpdate());
    const beforeReads = snapshotTelegramRowCounts(db);

    const projection =
      context.services.sellerAttributionProjectionService
        .readAttributionBySourceBindingReference({
          source_binding_reference: sourceBindingResult.source_binding_reference,
        });

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeReads);
    expect(projection).toMatchObject({
      attribution_status: 'SELLER_ATTRIBUTION_UNAVAILABLE',
      telegram_user_summary: {
        telegram_user_id: '777000111',
        display_name: 'Alex Boat',
      },
      source_binding_reference: sourceBindingResult.source_binding_reference,
      attribution_session_reference: null,
      seller_attribution_active: false,
      attribution_started_at_summary: null,
      attribution_expires_at_summary: null,
      no_attribution_reason: 'seller_attribution_session_start_not_found',
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.source_binding_reference)).toBe(true);
  });

  it('rejects invalid and non-projectable attribution projection inputs deterministically without writes', () => {
    seedSource(context);
    const sourceBindingResult = persistSourceBinding(context, createStartUpdate());
    const startedAttribution = startAttribution(context, sourceBindingResult);

    expect(() =>
      context.services.sellerAttributionProjectionService.readCurrentAttribution({})
    ).toThrow('telegram_user_id is required');
    expect(() =>
      context.services.sellerAttributionProjectionService
        .readAttributionBySourceBindingReference({
          source_binding_reference: {
            reference_type: 'telegram_booking_request_event',
            source_binding_event_id: 1,
            guest_entry_event_id: 1,
          },
        })
    ).toThrow('Unsupported source-binding reference type');
    expect(() =>
      context.services.sellerAttributionProjectionService
        .readAttributionBySourceBindingReference({
          source_binding_event_id: 9999,
        })
    ).toThrow('Source-binding event not found');
    expect(() =>
      context.services.sellerAttributionProjectionService
        .readAttributionByAttributionSessionReference({
          attribution_session_reference: {
            ...startedAttribution.attribution_session_reference,
            seller_id: 999,
          },
        })
    ).toThrow('Attribution session reference mismatch');
    expect(() =>
      context.services.sellerAttributionProjectionService
        .readAttributionByAttributionSessionReference({
          seller_attribution_session_id: 9999,
        })
    ).toThrow('Attribution session start event not found: 9999');

    const storedEventPayload = db
      .prepare(
        `
          SELECT event_payload
          FROM telegram_seller_attribution_session_start_events
          WHERE attribution_start_event_id = 1
        `
      )
      .get().event_payload;
    db.prepare(
      `
        UPDATE telegram_seller_attribution_session_start_events
        SET event_payload = ?
        WHERE attribution_start_event_id = 1
      `
    ).run(
      JSON.stringify({
        ...JSON.parse(storedEventPayload),
        response_version: 'telegram_seller_attribution_session_start_result.v0',
      })
    );
    const beforeRejectedReads = snapshotTelegramRowCounts(db);

    expect(() =>
      context.services.sellerAttributionProjectionService
        .readAttributionBySourceBindingReference({
          source_binding_reference: sourceBindingResult.source_binding_reference,
        })
    ).toThrow('Seller-attribution start event is not projectable');
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeRejectedReads);
  });
});
