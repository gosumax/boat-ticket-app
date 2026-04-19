import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTelegramPersistenceContext,
  TELEGRAM_GUEST_PROFILE_AGGREGATE_VERSION,
  TELEGRAM_GUEST_TIMELINE_PROJECTION_VERSION,
  TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
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
    CREATE TABLE presales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_slot_id INTEGER NULL,
      status TEXT DEFAULT 'ACTIVE',
      slot_uid TEXT NULL,
      business_day TEXT NULL
    );
    CREATE TABLE tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      presale_id INTEGER NOT NULL REFERENCES presales(id),
      boat_slot_id INTEGER NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
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
    advanceMinutes(minutes) {
      current = new Date(current.getTime() + minutes * 60 * 1000);
    },
  };
}

function createStartUpdate({
  text = '/start seller-qr-token-a',
  updateId = 987654321,
  messageId = 42,
} = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
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

function wireClock(context, clock) {
  context.services.attributionService.now = clock.now;
  context.services.bookingRequestService.now = clock.now;
  context.services.presaleHandoffService.now = clock.now;
  context.services.handoffExecutionService.now = clock.now;
}

function seedSource(
  context,
  { code, type = 'seller_qr', qrToken, sellerId = 1 } = {}
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

  const sourceBindingResult =
    context.services.sourceBindingPersistenceService.persistSourceBinding({
      guest_entry_result: guestEntryResult,
      source_resolution_result: sourceResolutionResult,
    });

  return { guestEntryResult, sourceBindingResult };
}

function createBookingRequest(context, guestProfileId, sellerAttributionSessionId, tripSuffix) {
  return context.services.bookingRequestService.createBookingRequest({
    guest_profile_id: guestProfileId,
    seller_attribution_session_id: sellerAttributionSessionId,
    requested_trip_date: `2026-04-${tripSuffix}`,
    requested_time_slot: '12:00',
    requested_seats: 2,
    requested_ticket_mix: { adult: 2 },
    requested_prepayment_amount: 1000,
    currency: 'RUB',
    contact_phone_e164: '+79990001122',
  }).bookingRequest;
}

function appendBookingEvent(context, { bookingRequestId, eventType, eventAt, payload = {} }) {
  const bookingRequest = context.repositories.bookingRequests.getById(bookingRequestId);
  const hold = context.repositories.bookingHolds.findOneBy({
    booking_request_id: bookingRequestId,
  });

  return context.repositories.bookingRequestEvents.create({
    booking_request_id: bookingRequestId,
    booking_hold_id: hold?.booking_hold_id || null,
    seller_attribution_session_id: bookingRequest.seller_attribution_session_id,
    event_type: eventType,
    event_at: eventAt,
    actor_type: 'system',
    actor_id: 'test',
    event_payload: payload,
  });
}

function setupJourney(context, clock) {
  wireClock(context, clock);
  const sellerSource = seedSource(context, {
    code: 'seller-source-a',
    type: 'seller_qr',
    qrToken: 'seller-qr-token-a',
    sellerId: 1,
  });
  seedSource(context, {
    code: 'owner-source-a',
    type: 'owner_source',
    qrToken: 'owner-desk-a',
    sellerId: null,
  });

  const sellerBinding = persistSourceBinding(
    context,
    createStartUpdate({ text: '/start seller-qr-token-a', updateId: 111, messageId: 11 })
  );
  const sellerAttributionStart =
    context.services.sellerAttributionSessionStartService.startFromSourceBinding({
      source_binding_result: sellerBinding.sourceBindingResult,
    });

  const skippedBinding = persistSourceBinding(
    context,
    createStartUpdate({ text: '/start owner-desk-a', updateId: 112, messageId: 12 })
  );
  context.services.sellerAttributionSessionStartService.startFromSourceBinding({
    source_binding_result: skippedBinding.sourceBindingResult,
  });

  const guestProfileId =
    sellerAttributionStart.telegram_guest_summary.guest_profile_id;
  const sellerSessionId =
    sellerAttributionStart.attribution_session_reference.seller_attribution_session_id;

  context.services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guestProfileId,
    traffic_source_id: sellerSource.source.traffic_source_id,
    source_qr_code_id: sellerSource.qr.source_qr_code_id,
    entry_channel: 'qr',
  });
  clock.advanceMinutes(1);

  const expiredRequest = createBookingRequest(
    context,
    guestProfileId,
    sellerSessionId,
    '11'
  );
  context.services.bookingRequestService.extendHoldOnce(
    expiredRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: 'extend',
    }
  );
  context.services.bookingRequestService.expireHold(expiredRequest.booking_request_id, {
    actorType: 'system',
    actorId: 'expire',
  });
  clock.advanceMinutes(1);

  const cancelledRequest = createBookingRequest(
    context,
    guestProfileId,
    sellerSessionId,
    '12'
  );
  context.services.bookingRequestService.cancelRequestByGuest(
    cancelledRequest.booking_request_id,
    {
      actorType: 'guest',
      actorId: String(guestProfileId),
    }
  );
  clock.advanceMinutes(1);

  const blockedRequest = createBookingRequest(
    context,
    guestProfileId,
    sellerSessionId,
    '13'
  );
  context.services.bookingRequestService.confirmPrepayment(
    blockedRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: 'pay-blocked',
    }
  );
  context.services.presaleHandoffService.prepareHandoff(
    blockedRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: 'prepared-blocked',
    }
  );
  context.services.handoffExecutionService.queueForHandoff(
    blockedRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: 'queue-blocked',
      queueReason: 'timeline-test',
    }
  );
  context.services.handoffExecutionService.startHandoff(
    blockedRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: 'start-blocked',
    }
  );
  appendBookingEvent(context, {
    bookingRequestId: blockedRequest.booking_request_id,
    eventType: 'HANDOFF_BLOCKED',
    eventAt: '2026-04-10T10:45:00.000Z',
    payload: { blocked_reason: 'bridge_guard_blocked' },
  });
  appendBookingEvent(context, {
    bookingRequestId: blockedRequest.booking_request_id,
    eventType: 'REAL_PRESALE_HANDOFF_FAILED',
    eventAt: '2026-04-10T10:46:00.000Z',
    payload: { outcome_code: 'adapter_failed', message: 'adapter failed in test' },
  });
  appendBookingEvent(context, {
    bookingRequestId: blockedRequest.booking_request_id,
    eventType: 'HANDOFF_CONSUMED',
    eventAt: '2026-04-10T10:47:00.000Z',
    payload: { consumed_reason: 'timeline_coverage' },
  });

  return {
    guestProfileId,
    blockedRequestId: blockedRequest.booking_request_id,
  };
}

describe('telegram guest-profile aggregate service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db, {
      sourceBindingNow: clock.now,
      sellerAttributionSessionStartNow: clock.now,
    });
  });

  it('builds an additive frozen aggregate profile by booking-request reference', () => {
    const journey = setupJourney(context, clock);
    db.prepare(`
      INSERT INTO presales (id, boat_slot_id, status, slot_uid, business_day)
      VALUES (77, 42, 'ACTIVE', 'generated:42', '2026-04-13')
    `).run();
    db.prepare(`
      INSERT INTO tickets (presale_id, boat_slot_id, status)
      VALUES (77, 42, 'ACTIVE'), (77, 42, 'USED')
    `).run();
    context.repositories.bookingRequests.updateById(journey.blockedRequestId, {
      request_status: 'CONFIRMED_TO_PRESALE',
      confirmed_presale_id: 77,
      last_status_at: '2026-04-10T10:47:00.000Z',
    });

    const result =
      context.services.guestProfileAggregateService.readGuestProfileByBookingRequestReference({
        booking_request_reference: {
          reference_type: 'telegram_booking_request',
          booking_request_id: journey.blockedRequestId,
        },
      });

    expect(result.response_version).toBe(TELEGRAM_GUEST_PROFILE_AGGREGATE_VERSION);
    expect(result.read_mode).toBe('booking_request_reference');
    expect(result.telegram_user_summary.telegram_user_id).toBe('777000111');
    expect(result.latest_route_summary.current_route_target).toBeTruthy();
    expect(result.latest_route_summary.current_route_reason).toBeTruthy();
    expect(result.latest_attribution_summary.attribution_status).toBe('NO_SELLER_ATTRIBUTION');
    expect(result.latest_source_summary.source_summary_type).toBe('source_binding');
    expect(result.latest_bridge_linkage_summary.canonical_enrich_summary).toMatchObject({
      response_version: 'telegram_guest_profile_canonical_enrich.v1',
      enrich_status: 'enriched',
      canonical_presale_reference: {
        reference_type: 'canonical_presale',
        presale_id: 77,
      },
      canonical_presale_status_summary: {
        linkage_status: 'enriched',
        presale_exists: true,
        presale_status: 'ACTIVE',
      },
      ticket_count_summary: {
        read_status: 'readable',
        total_count: 2,
      },
    });
    expect(result.guest_profile_status_summary.status).toBe('bridged_to_presale');
    expect(result.latest_timestamp_summary).not.toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.latest_bridge_linkage_summary)).toBe(true);
  });

  it('projects a deterministic guest timeline by telegram-user reference', () => {
    setupJourney(context, clock);

    const timeline =
      context.services.guestProfileAggregateService.readGuestTimelineByTelegramUserReference(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: '777000111',
          },
        }
      );

    expect(timeline.response_version).toBe(TELEGRAM_GUEST_TIMELINE_PROJECTION_VERSION);
    expect(timeline.read_mode).toBe('telegram_user_reference');
    expect(timeline.timeline_items.length).toBeGreaterThan(0);
    for (let index = 1; index < timeline.timeline_items.length; index += 1) {
      expect(timeline.timeline_items[index].timestamp_summary.unix_seconds).toBeGreaterThanOrEqual(
        timeline.timeline_items[index - 1].timestamp_summary.unix_seconds
      );
    }

    const eventTypes = new Set(timeline.timeline_items.map((item) => item.event_type));
    expect(eventTypes).toEqual(
      new Set([
        'BOT_ENTRY',
        'SOURCE_BINDING',
        'ATTRIBUTION_STARTED',
        'NO_ATTRIBUTION_OUTCOME',
        'BOOKING_REQUEST_CREATED',
        'HOLD_STARTED',
        'HOLD_EXTENDED',
        'HOLD_EXPIRED',
        'GUEST_CANCEL_BEFORE_PREPAYMENT',
        'PREPAYMENT_CONFIRMED',
        'HANDOFF_PREPARED',
        'HANDOFF_STARTED',
        'HANDOFF_BLOCKED',
        'HANDOFF_CONSUMED',
        'BRIDGE_OUTCOME',
      ])
    );
    expect(Object.isFrozen(timeline)).toBe(true);
    expect(Object.isFrozen(timeline.timeline_items[0])).toBe(true);
  });

  it('degrades canonical enrich safely when linked canonical data is missing', () => {
    const journey = setupJourney(context, clock);
    db.pragma('foreign_keys = OFF');
    context.repositories.bookingRequests.updateById(journey.blockedRequestId, {
      request_status: 'CONFIRMED_TO_PRESALE',
      confirmed_presale_id: 404,
      last_status_at: '2026-04-10T10:48:00.000Z',
    });
    db.pragma('foreign_keys = ON');

    const result =
      context.services.guestProfileAggregateService.readGuestProfileByBookingRequestReference({
        booking_request_id: journey.blockedRequestId,
      });

    expect(result.latest_bridge_linkage_summary.canonical_enrich_summary).toMatchObject({
      enrich_status: 'degraded',
      degradation_reason: 'canonical_presale_missing',
      canonical_presale_reference: {
        reference_type: 'canonical_presale',
        presale_id: 404,
      },
    });
  });

  it('rejects invalid, ambiguous, and non-projectable inputs deterministically', () => {
    setupJourney(context, clock);
    context.repositories.guestProfiles.create({
      telegram_user_id: 'tg-second-guest',
      display_name: 'Second Guest',
      username: 'second_guest',
      language_code: 'ru',
      phone_e164: '+79991112233',
      consent_status: 'granted',
      profile_status: 'active',
    });
    context.repositories.guestProfiles.create({
      telegram_user_id: 'tg-third-guest',
      display_name: 'Third Guest',
      username: 'third_guest',
      language_code: 'ru',
      phone_e164: '+79991112233',
      consent_status: 'granted',
      profile_status: 'active',
    });
    const brokenGuestEntry = context.services.guestEntryPersistenceService.persistGuestEntry(
      context.services.startUpdateNormalizationService.normalizeStartUpdate(
        createStartUpdate({
          text: '/start broken-source',
          updateId: 113,
          messageId: 13,
        })
      )
    );
    context.repositories.guestEntrySourceBindingEvents.create({
      guest_entry_event_id: brokenGuestEntry.persisted_entry_reference.guest_entry_event_id,
      event_type: TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
      binding_status: 'resolved_seller_source',
      telegram_user_summary: { telegram_user_id: '777000111' },
      guest_entry_reference: brokenGuestEntry.persisted_entry_reference,
      raw_source_token: 'broken-source',
      normalized_source_token: 'broken-source',
      resolved_source_family: 'seller_qr',
      source_resolution_outcome: 'resolved_seller_source',
      source_resolution_summary: { response_version: 'broken' },
      event_at: 'broken-timestamp',
      event_timestamp_summary: {},
      binding_payload: { response_version: 'broken' },
      idempotency_key: 'broken-source-binding-row',
      dedupe_key: 'broken-source-binding-row',
      binding_signature: {},
    });

    expect(() =>
      context.services.guestProfileAggregateService.readGuestProfileByBookingRequestReference({
        booking_request_reference: { booking_request_id: 'not-a-number' },
      })
    ).toThrow('booking_request_reference.booking_request_id must be a positive integer');
    expect(() =>
      context.services.guestProfileAggregateService.readGuestProfileByContactPhoneReference({
        contact_phone_reference: {
          reference_type: 'telegram_contact_phone',
          phone_e164: '+79991112233',
        },
      })
    ).toThrow('Ambiguous guest profile phone identity');
    expect(() =>
      context.services.guestProfileAggregateService.readGuestTimelineByTelegramUserReference({
        telegram_user_id: '777000111',
      })
    ).toThrow('Source-binding event is not projectable');
  });
});
