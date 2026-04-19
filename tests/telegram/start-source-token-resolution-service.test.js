import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  createTelegramPersistenceContext,
  TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE,
  TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION,
  TELEGRAM_START_SOURCE_TOKEN_RESOLUTION_VERSION,
  TelegramStartSourceTokenResolutionService,
  TelegramStartUpdateNormalizationService,
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

function createStartUpdate({ text = '/start seller-qr-token-a' } = {}) {
  return {
    update_id: 987654321,
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

function normalizeStart(text) {
  return new TelegramStartUpdateNormalizationService()
    .normalizeStartUpdate(createStartUpdate({ text }));
}

function snapshotTelegramRowCounts(db) {
  return Object.fromEntries(
    TELEGRAM_TABLES.map((tableName) => [
      tableName,
      db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count,
    ])
  );
}

describe('telegram start-source token resolution service', () => {
  it('resolves seller-family source tokens from normalized /start events', () => {
    const service = new TelegramStartSourceTokenResolutionService();

    const result = service.resolveStartSourceToken(
      normalizeStart('/start Seller-QR-Token-A')
    );

    expect(result).toMatchObject({
      response_version: TELEGRAM_START_SOURCE_TOKEN_RESOLUTION_VERSION,
      read_only: true,
      resolution_status: 'resolved_seller_source',
      raw_source_token: 'Seller-QR-Token-A',
      normalized_source_token: 'seller-qr-token-a',
      has_source_token: true,
      source_family: 'seller_qr',
      source_resolution_reason: 'source_token_matches_seller_family_prefix',
      resolution_input_kind: 'normalized_start_event',
      resolved_by: 'start-source-token-resolution-service',
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
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.no_op_guards)).toBe(true);
  });

  it('classifies owner, generic, and unresolved source tokens deterministically', () => {
    const service = new TelegramStartSourceTokenResolutionService();

    expect(service.resolveStartSourceToken(normalizeStart('/start seller-maxim-1')))
      .toMatchObject({
        resolution_status: 'resolved_seller_source',
        normalized_source_token: 'seller-maxim-1',
        source_family: 'seller_qr',
        source_resolution_reason: 'source_token_matches_seller_family_prefix',
      });
    expect(service.resolveStartSourceToken(normalizeStart('/start owner-desk-a')))
      .toMatchObject({
        resolution_status: 'resolved_owner_source',
        normalized_source_token: 'owner-desk-a',
        source_family: 'owner_source',
        source_resolution_reason: 'source_token_matches_owner_family_prefix',
      });
    expect(service.resolveSourceToken(normalizeStart('/start promo-token-a')))
      .toMatchObject({
        resolution_status: 'resolved_generic_source',
        normalized_source_token: 'promo-token-a',
        source_family: 'promo_qr',
        source_resolution_reason: 'source_token_matches_generic_family_prefix',
      });
    expect(service.resolve(normalizeStart('/start mystery-token-a')))
      .toMatchObject({
        resolution_status: 'unresolved_source_token',
        normalized_source_token: 'mystery-token-a',
        source_family: null,
        source_resolution_reason:
          'source_token_does_not_match_telegram_boundary_rules',
      });
  });

  it('keeps no-source-token results stable for empty or non-token start payloads', () => {
    const service = new TelegramStartSourceTokenResolutionService();

    const withoutPayload = service.resolveStartSourceToken(normalizeStart('/start'));
    const nonTokenPayload = service.resolveStartSourceToken(
      normalizeStart('/start payload with spaces')
    );

    expect(withoutPayload).toMatchObject({
      resolution_status: 'no_source_token',
      raw_source_token: null,
      normalized_source_token: null,
      has_source_token: false,
      source_family: null,
      source_resolution_reason: 'normalized_start_payload_has_no_source_token',
    });
    expect(nonTokenPayload).toMatchObject({
      resolution_status: 'no_source_token',
      raw_source_token: null,
      normalized_source_token: null,
      has_source_token: false,
      source_family: null,
      source_resolution_reason: 'normalized_start_payload_has_no_source_token',
    });
    expect(Object.isFrozen(nonTokenPayload)).toBe(true);
  });

  it('accepts guest-entry projection items and combined matching inputs without writes', () => {
    const db = createTestDb();
    const context = createTelegramPersistenceContext(db);
    const normalized = context.services.startUpdateNormalizationService
      .normalizeStartUpdate(createStartUpdate({ text: '/start seller-link-token-a' }));
    const persisted = context.services.guestEntryPersistenceService
      .persistGuestEntry(normalized);
    const projection = context.services.guestEntryProjectionService
      .readGuestEntryItemByPersistedReference({
        persisted_entry_reference: persisted.persisted_entry_reference,
      });
    const beforeResolutionCounts = snapshotTelegramRowCounts(db);

    const fromProjection = context.services.startSourceTokenResolutionService
      .resolveStartSourceToken(projection);
    const fromCombined = context.services.startSourceTokenResolutionService
      .resolveStartSourceToken({
        normalized_start_event: normalized,
        guest_entry_projection_item: projection,
      });

    expect(snapshotTelegramRowCounts(db)).toEqual(beforeResolutionCounts);
    expect(projection).toMatchObject({
      response_version: TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION,
      projection_item_type: TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE,
    });
    expect(fromProjection).toMatchObject({
      resolution_status: 'resolved_seller_source',
      normalized_source_token: 'seller-link-token-a',
      source_family: 'seller_direct_link',
      resolution_input_kind: 'guest_entry_projection_item',
    });
    expect(fromCombined).toMatchObject({
      resolution_status: 'resolved_seller_source',
      normalized_source_token: 'seller-link-token-a',
      source_family: 'seller_direct_link',
      resolution_input_kind: 'combined_start_source_input',
    });
    expect(Object.isFrozen(fromProjection)).toBe(true);
    expect(Object.isFrozen(fromCombined)).toBe(true);
  });

  it('rejects invalid or unsupported inputs deterministically', () => {
    const service = new TelegramStartSourceTokenResolutionService();
    const normalized = normalizeStart('/start seller-qr-token-a');

    expect(() => service.resolveStartSourceToken(null))
      .toThrow('source resolution input must be an object');
    expect(() => service.resolveStartSourceToken({}))
      .toThrow('Unsupported source resolution input');
    expect(() =>
      service.resolveStartSourceToken({
        normalized_start_event: normalized,
        guest_entry_projection_item: {
          response_version: TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION,
          projection_item_type: TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE,
          normalized_start_payload: {
            raw_payload: 'promo-token-a',
            normalized_payload: 'promo-token-a',
            has_payload: true,
          },
          source_token: 'promo-token-a',
        },
      })
    ).toThrow('source token inputs must match');
    expect(() =>
      service.resolveStartSourceToken({
        ...normalized,
        source_token: 'bad token',
      })
    ).toThrow('source token must contain only letters');
  });
});
