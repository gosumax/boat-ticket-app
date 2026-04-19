import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';

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
  db.prepare(`INSERT INTO users (username, role, is_active) VALUES ('seller-a', 'seller', 1)`).run();
  return db;
}

function createClock(startIso) {
  let current = new Date(startIso);
  return {
    now: () => new Date(current),
    advanceHours(hours) {
      current = new Date(current.getTime() + hours * 60 * 60 * 1000);
    },
  };
}

function seedGuest(repositories) {
  return repositories.guestProfiles.create({
    telegram_user_id: 'tg-source-user',
    display_name: 'Source Guest',
    username: 'source_guest',
    language_code: 'ru',
    phone_e164: '+79991112233',
    consent_status: 'granted',
    profile_status: 'active',
  });
}

function seedSource(repositories, { code, type, qrToken, sellerId = null, name = null }) {
  const source = repositories.trafficSources.create({
    source_code: code,
    source_type: type,
    source_name: name || code,
    default_seller_id: sellerId,
    is_active: 1,
  });

  const qr = repositories.sourceQRCodes.create({
    qr_token: qrToken,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: { code },
    is_active: 1,
  });

  return { source, qr };
}

describe('telegram source attribution lifecycle', () => {
  let db;
  let repositories;
  let attributionService;
  let bookingRequestService;
  let guest;
  let clock;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T08:00:00.000Z');
    const context = createTelegramPersistenceContext(db);
    repositories = context.repositories;
    attributionService = context.services.attributionService;
    bookingRequestService = context.services.bookingRequestService;
    attributionService.now = clock.now;
    bookingRequestService.now = clock.now;
    guest = seedGuest(repositories);
  });

  it('binds the first source to a guest and records source entry events', () => {
    const sellerQr = seedSource(repositories, {
      code: 'seller-qr-a',
      type: 'seller_qr',
      qrToken: 'seller-qr-token-a',
      sellerId: 1,
    });

    const result = attributionService.registerGuestEntryFromSource({
      guest_profile_id: guest.guest_profile_id,
      traffic_source_id: sellerQr.source.traffic_source_id,
      source_qr_code_id: sellerQr.qr.source_qr_code_id,
      entry_channel: 'qr',
    });

    expect(result.isFirstSourceBound).toBe(true);
    expect(result.sourceFamily).toBe('seller_qr');
    expect(
      attributionService.listAnalyticsEvents(guest.guest_profile_id).map((event) => event.event_type)
    ).toEqual(['SOURCE_BOUND', 'SOURCE_ENTRY', 'ATTRIBUTION_STARTED']);
  });

  it('starts seller attribution for seller-family sources and resolves seller-attributed path', () => {
    const sellerDirect = seedSource(repositories, {
      code: 'seller-link-a',
      type: 'seller_direct_link',
      qrToken: 'seller-link-token-a',
      sellerId: 1,
    });

    attributionService.registerGuestEntryFromSource({
      guest_profile_id: guest.guest_profile_id,
      traffic_source_id: sellerDirect.source.traffic_source_id,
      source_qr_code_id: sellerDirect.qr.source_qr_code_id,
      entry_channel: 'messenger',
    });

    const activePath = attributionService.resolveActivePath(guest.guest_profile_id);
    expect(activePath.pathType).toBe('seller_attributed');
    expect(activePath.sellerAttributionSession.seller_id).toBe(1);
  });

  it('expires seller attribution after 30 hours and falls back to manual owner handling', () => {
    const sellerQr = seedSource(repositories, {
      code: 'seller-qr-expire',
      type: 'seller_qr',
      qrToken: 'seller-qr-expire-token',
      sellerId: 1,
    });

    attributionService.registerGuestEntryFromSource({
      guest_profile_id: guest.guest_profile_id,
      traffic_source_id: sellerQr.source.traffic_source_id,
      source_qr_code_id: sellerQr.qr.source_qr_code_id,
      entry_channel: 'qr',
    });

    clock.advanceHours(31);
    const activePath = attributionService.resolveActivePath(guest.guest_profile_id);

    expect(activePath.pathType).toBe('owner_manual');
    expect(
      attributionService.listAnalyticsEvents(guest.guest_profile_id).map((event) => event.event_type)
    ).toContain('ATTRIBUTION_EXPIRED');
  });

  it('preserves first seller source precedence for 30 hours', () => {
    const firstSeller = seedSource(repositories, {
      code: 'seller-qr-first',
      type: 'seller_qr',
      qrToken: 'seller-qr-first-token',
      sellerId: 1,
    });
    const secondSeller = seedSource(repositories, {
      code: 'seller-tshirt-second',
      type: 'seller_tshirt_qr',
      qrToken: 'seller-tshirt-second-token',
      sellerId: 1,
    });

    const first = attributionService.registerGuestEntryFromSource({
      guest_profile_id: guest.guest_profile_id,
      traffic_source_id: firstSeller.source.traffic_source_id,
      source_qr_code_id: firstSeller.qr.source_qr_code_id,
      entry_channel: 'qr',
    });
    const second = attributionService.registerGuestEntryFromSource({
      guest_profile_id: guest.guest_profile_id,
      traffic_source_id: secondSeller.source.traffic_source_id,
      source_qr_code_id: secondSeller.qr.source_qr_code_id,
      entry_channel: 'qr',
    });

    expect(first.sellerAttributionSession.seller_id).toBe(1);
    expect(second.sellerAttributionSession.seller_id).toBe(1);
    expect(attributionService.listSellerAttributionSessions(guest.guest_profile_id)).toHaveLength(1);
  });

  it('allows promo-first owner path to be overridden by seller before booking lock', () => {
    const promoQr = seedSource(repositories, {
      code: 'promo-a',
      type: 'promo_qr',
      qrToken: 'promo-token-a',
    });
    const sellerQr = seedSource(repositories, {
      code: 'seller-override-a',
      type: 'seller_qr',
      qrToken: 'seller-override-token-a',
      sellerId: 1,
    });

    const promoResult = attributionService.registerGuestEntryFromSource({
      guest_profile_id: guest.guest_profile_id,
      traffic_source_id: promoQr.source.traffic_source_id,
      source_qr_code_id: promoQr.qr.source_qr_code_id,
      entry_channel: 'qr',
    });
    const sellerResult = attributionService.registerGuestEntryFromSource({
      guest_profile_id: guest.guest_profile_id,
      traffic_source_id: sellerQr.source.traffic_source_id,
      source_qr_code_id: sellerQr.qr.source_qr_code_id,
      entry_channel: 'qr',
    });

    expect(promoResult.activePath.pathType).toBe('owner_manual');
    expect(sellerResult.attributionOutcome).toBe('seller_override_before_booking');
    expect(sellerResult.activePath.pathType).toBe('seller_attributed');
  });

  it('keeps manual owner path after expiry for later classification', () => {
    const sellerQr = seedSource(repositories, {
      code: 'seller-manual-fallback',
      type: 'seller_qr',
      qrToken: 'seller-manual-fallback-token',
      sellerId: 1,
    });

    attributionService.registerGuestEntryFromSource({
      guest_profile_id: guest.guest_profile_id,
      traffic_source_id: sellerQr.source.traffic_source_id,
      source_qr_code_id: sellerQr.qr.source_qr_code_id,
      entry_channel: 'qr',
    });

    clock.advanceHours(31);
    const resolved = attributionService.resolveActivePath(guest.guest_profile_id);

    expect(resolved.classification).toBe('manual_owner_handling');
    expect(resolved.sellerAttributionSession).toBeNull();
  });

  it('classifies the approved source families correctly', () => {
    expect(
      attributionService.classifySourceFamily({ sourceType: 'seller_qr', entryChannel: 'qr' })
    ).toBe('seller_qr');
    expect(
      attributionService.classifySourceFamily({ sourceType: 'seller_direct_link', entryChannel: 'messenger' })
    ).toBe('seller_direct_link');
    expect(
      attributionService.classifySourceFamily({ sourceType: 'seller_tshirt_qr', entryChannel: 'qr' })
    ).toBe('seller_tshirt_qr');
    expect(
      attributionService.classifySourceFamily({ sourceType: 'promo_qr', entryChannel: 'qr' })
    ).toBe('promo_qr');
    expect(
      attributionService.classifySourceFamily({ sourceType: 'point_qr', entryChannel: 'qr' })
    ).toBe('point_qr');
    expect(
      attributionService.classifySourceFamily({ sourceType: 'generic_qr', entryChannel: 'qr' })
    ).toBe('generic_qr');
    expect(
      attributionService.classifySourceFamily({ sourceType: 'bot_search_entry', entryChannel: 'search' })
    ).toBe('bot_search_entry');
    expect(
      attributionService.classifySourceFamily({ sourceType: 'messenger_link', entryChannel: 'messenger' })
    ).toBe('messenger_link');
    expect(
      attributionService.classifySourceFamily({ sourceType: 'other_campaign', entryChannel: 'campaign' })
    ).toBe('other_campaign');
  });

  it('does not allow seller override after booking logic has locked attribution context', () => {
    const promoQr = seedSource(repositories, {
      code: 'promo-lock-a',
      type: 'promo_qr',
      qrToken: 'promo-lock-token-a',
    });
    const sellerQr = seedSource(repositories, {
      code: 'seller-lock-a',
      type: 'seller_qr',
      qrToken: 'seller-lock-token-a',
      sellerId: 1,
    });

    attributionService.registerGuestEntryFromSource({
      guest_profile_id: guest.guest_profile_id,
      traffic_source_id: promoQr.source.traffic_source_id,
      source_qr_code_id: promoQr.qr.source_qr_code_id,
      entry_channel: 'qr',
    });

    const lockedSession = repositories.sellerAttributionSessions.create({
      guest_profile_id: guest.guest_profile_id,
      traffic_source_id: promoQr.source.traffic_source_id,
      source_qr_code_id: promoQr.qr.source_qr_code_id,
      seller_id: null,
      starts_at: '2026-04-10T08:00:00.000Z',
      expires_at: '2026-04-11T14:00:00.000Z',
      attribution_status: 'INACTIVE',
      binding_reason: 'promo_qr',
    });

    bookingRequestService.createBookingRequest({
      guest_profile_id: guest.guest_profile_id,
      seller_attribution_session_id: lockedSession.seller_attribution_session_id,
      requested_trip_date: '2026-04-11',
      requested_time_slot: '12:00',
      requested_seats: 2,
      requested_ticket_mix: { adult: 2 },
      contact_phone_e164: '+79991112233',
    });

    const result = attributionService.registerGuestEntryFromSource({
      guest_profile_id: guest.guest_profile_id,
      traffic_source_id: sellerQr.source.traffic_source_id,
      source_qr_code_id: sellerQr.qr.source_qr_code_id,
      entry_channel: 'qr',
    });

    expect(result.attributionOutcome).toBe('blocked_by_booking_lock');
    expect(result.activePath.pathType).toBe('owner_manual');
  });
});
