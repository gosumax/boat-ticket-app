import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTelegramPersistenceContext,
  TELEGRAM_GUEST_ROUTING_DECISION_VERSION,
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

describe('telegram guest-routing decision service', () => {
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

  it('routes an actively attributed Telegram guest to the seller through all public APIs', () => {
    seedSellerSource(context);
    const sourceBindingResult = persistSourceBinding(context, createStartUpdate());
    const startedAttribution = startAttribution(context, sourceBindingResult);
    const attributionProjection =
      context.services.sellerAttributionProjectionService
        .readCurrentAttributionStateForTelegramGuest({
          telegram_user_id: '777000111',
        });
    const beforeReads = snapshotTelegramRowCounts(db);

    const current =
      context.services.guestRoutingDecisionService
        .decideCurrentRoutingForTelegramGuest({
          telegram_user_id: '777000111',
        });
    const bySourceBinding =
      context.services.guestRoutingDecisionService
        .decideRoutingFromSourceBindingReference({
          source_binding_reference: sourceBindingResult.source_binding_reference,
        });
    const byAttribution =
      context.services.guestRoutingDecisionService
        .decideRoutingFromCurrentAttributionData({
          attribution_projection: attributionProjection,
          source_binding_result: sourceBindingResult,
        });

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeReads);
    expect(current).toMatchObject({
      response_version: TELEGRAM_GUEST_ROUTING_DECISION_VERSION,
      read_only: true,
      decision_only: true,
      routing_status: 'seller_attributed',
      telegram_user_summary: {
        telegram_user_id: '777000111',
        display_name: 'Alex Boat',
      },
      guest_entry_reference: sourceBindingResult.guest_entry_reference,
      source_binding_reference: sourceBindingResult.source_binding_reference,
      attribution_session_reference:
        startedAttribution.attribution_session_reference,
      current_route_target: {
        route_target_type: 'seller',
        seller_id: 1,
        seller_attribution_session_id: 1,
      },
      current_route_reason: 'active_seller_attribution',
      seller_attribution_active: true,
      attribution_status: 'ACTIVE',
      source_binding_status: 'resolved_seller_source',
      no_op_guards: {
        source_binding_created: false,
        seller_attribution_created: false,
        booking_created: false,
        queue_created: false,
        production_webhook_route_invoked: false,
        bot_command_handler_invoked: false,
        mini_app_ui_invoked: false,
        admin_ui_invoked: false,
        money_ledger_written: false,
      },
    });
    expect(bySourceBinding).toEqual(current);
    expect(byAttribution).toEqual(current);
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current.telegram_user_summary)).toBe(true);
    expect(Object.isFrozen(current.guest_entry_reference)).toBe(true);
    expect(Object.isFrozen(current.source_binding_reference)).toBe(true);
    expect(Object.isFrozen(current.attribution_session_reference)).toBe(true);
    expect(Object.isFrozen(current.current_route_target)).toBe(true);
  });

  it('keeps active seller attribution as the current route even after a later unassigned entry', () => {
    seedSellerSource(context);
    const sellerBinding = persistSourceBinding(context, createStartUpdate());
    const sellerAttribution = startAttribution(context, sellerBinding);
    startClock.set('2026-04-10T10:20:00.000Z');
    persistSourceBinding(
      context,
      createStartUpdate({
        text: '/start',
        updateId: 987654322,
        messageId: 43,
      })
    );
    const beforeReads = snapshotTelegramRowCounts(db);

    const current =
      context.services.guestRoutingDecisionService.decideCurrentRouting({
        telegram_user_id: '777000111',
      });

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeReads);
    expect(current).toMatchObject({
      routing_status: 'seller_attributed',
      guest_entry_reference: sellerBinding.guest_entry_reference,
      source_binding_reference: sellerBinding.source_binding_reference,
      attribution_session_reference:
        sellerAttribution.attribution_session_reference,
      seller_attribution_active: true,
      current_route_reason: 'active_seller_attribution',
    });
  });

  it.each([
    {
      text: '/start owner-desk-a',
      routingStatus: 'owner_manual',
      routeTargetType: 'owner_manual',
      routeReason: 'resolved_owner_source',
      sourceBindingStatus: 'resolved_owner_source',
    },
    {
      text: '/start promo-token-a',
      routingStatus: 'generic_unassigned',
      routeTargetType: 'generic_unassigned',
      routeReason: 'resolved_generic_source',
      sourceBindingStatus: 'resolved_generic_source',
    },
    {
      text: '/start mystery-token-a',
      routingStatus: 'unresolved_source_manual',
      routeTargetType: 'manual_review',
      routeReason: 'unresolved_source_token',
      sourceBindingStatus: 'unresolved_source_token',
    },
    {
      text: '/start',
      routingStatus: 'no_source_manual',
      routeTargetType: 'manual_review',
      routeReason: 'no_source_token',
      sourceBindingStatus: 'no_source_token',
    },
  ])(
    'routes inactive attribution for $sourceBindingStatus according to approved source rules',
    ({ text, routingStatus, routeTargetType, routeReason, sourceBindingStatus }) => {
      const sourceBindingResult = persistSourceBinding(
        context,
        createStartUpdate({ text })
      );
      startAttribution(context, sourceBindingResult);
      const beforeReads = snapshotTelegramRowCounts(db);

      const decision =
        context.services.guestRoutingDecisionService
          .decideRoutingFromSourceBindingReference(sourceBindingResult);

      expect(snapshotTelegramRowCounts(db)).toEqual(beforeReads);
      expect(decision).toMatchObject({
        response_version: TELEGRAM_GUEST_ROUTING_DECISION_VERSION,
        routing_status: routingStatus,
        guest_entry_reference: sourceBindingResult.guest_entry_reference,
        source_binding_reference: sourceBindingResult.source_binding_reference,
        attribution_session_reference: null,
        current_route_target: {
          route_target_type: routeTargetType,
          seller_id: null,
          seller_attribution_session_id: null,
        },
        current_route_reason: routeReason,
        seller_attribution_active: false,
        attribution_status: 'NO_SELLER_ATTRIBUTION',
        source_binding_status: sourceBindingStatus,
      });
      expect(Object.isFrozen(decision)).toBe(true);
    }
  );

  it('routes expired seller attribution to manual attribution-expired handling', () => {
    seedSellerSource(context);
    const sourceBindingResult = persistSourceBinding(context, createStartUpdate());
    startAttribution(context, sourceBindingResult);
    projectionClock.set('2026-04-11T17:00:00.000Z');
    const beforeReads = snapshotTelegramRowCounts(db);

    const decision =
      context.services.guestRoutingDecisionService
        .decideCurrentRoutingForTelegramGuest({
          telegram_user_id: '777000111',
        });

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeReads);
    expect(decision).toMatchObject({
      routing_status: 'attribution_expired_manual',
      guest_entry_reference: sourceBindingResult.guest_entry_reference,
      source_binding_reference: sourceBindingResult.source_binding_reference,
      attribution_session_reference: {
        seller_attribution_session_id: 1,
        seller_id: 1,
      },
      current_route_target: {
        route_target_type: 'manual_review',
        seller_id: null,
        seller_attribution_session_id: null,
      },
      current_route_reason: 'seller_attribution_expired',
      seller_attribution_active: false,
      attribution_status: 'SELLER_ATTRIBUTION_EXPIRED',
    });
  });

  it('rejects invalid or incompatible routing inputs deterministically without writes', () => {
    seedSellerSource(context);
    const sourceBindingResult = persistSourceBinding(context, createStartUpdate());
    startAttribution(context, sourceBindingResult);
    const noSourceBinding = persistSourceBinding(
      context,
      createStartUpdate({
        text: '/start',
        updateId: 987654322,
        messageId: 43,
      })
    );
    const attributionProjection =
      context.services.sellerAttributionProjectionService
        .readCurrentAttributionStateForTelegramGuest({
          telegram_user_id: '777000111',
        });
    const beforeRejectedReads = snapshotTelegramRowCounts(db);

    expect(() =>
      context.services.guestRoutingDecisionService.decideCurrentRouting({})
    ).toThrow('telegram_user_id is required');
    expect(() =>
      context.services.guestRoutingDecisionService
        .decideRoutingFromSourceBindingReference({
          source_binding_reference: {
            reference_type: 'telegram_booking_request_event',
            source_binding_event_id: 1,
            guest_entry_event_id: 1,
          },
        })
    ).toThrow('Unsupported source-binding reference type');
    expect(() =>
      context.services.guestRoutingDecisionService
        .decideRoutingFromCurrentAttributionData({
          attribution_projection: attributionProjection,
          source_binding_result: noSourceBinding,
        })
    ).toThrow('attribution projection/source-binding reference mismatch');
    expect(() =>
      context.services.guestRoutingDecisionService
        .decideRoutingFromCurrentAttributionData({
          ...attributionProjection,
          response_version: 'telegram_seller_attribution_projection.v0',
        })
    ).toThrow('Unsupported attribution projection version');
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeRejectedReads);
  });
});
