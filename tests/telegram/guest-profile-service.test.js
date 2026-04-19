import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';

const TELEGRAM_TABLES = Object.freeze([
  'telegram_guest_profiles',
  'telegram_traffic_sources',
  'telegram_source_qr_codes',
  'telegram_seller_attribution_sessions',
  'telegram_guest_entries',
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
  db.prepare(`INSERT INTO users (id, username, role, is_active) VALUES (1, 'seller-a', 'seller', 1)`).run();
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

function wireClock(context, clock) {
  context.services.attributionService.now = clock.now;
  context.services.bookingRequestService.now = clock.now;
  context.services.presaleHandoffService.now = clock.now;
  context.services.handoffExecutionService.now = clock.now;
}

function snapshotTelegramRowCounts(db) {
  return Object.fromEntries(
    TELEGRAM_TABLES.map((tableName) => [
      tableName,
      db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count,
    ])
  );
}

function seedGuest(context, suffix = '1001') {
  return context.repositories.guestProfiles.create({
    telegram_user_id: `tg-guest-profile-${suffix}`,
    display_name: `Guest Profile ${suffix}`,
    username: `guest_profile_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999666${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
}

function seedSource(context, { suffix, sourceType = 'seller_qr', sellerId = 1 }) {
  const source = context.repositories.trafficSources.create({
    source_code: `guest-profile-source-${suffix}`,
    source_type: sourceType,
    source_name: `Guest Profile Source ${suffix}`,
    default_seller_id: sellerId,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: `guest-profile-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: { zone: `guest-profile-zone-${suffix}` },
    is_active: 1,
  });

  return { source, qr };
}

function seedGuestProfileScenario(context, clock, suffix = '1001') {
  wireClock(context, clock);
  const guest = seedGuest(context, suffix);
  const primarySource = seedSource(context, { suffix: `${suffix}-primary` });
  const secondarySource = seedSource(context, {
    suffix: `${suffix}-secondary`,
    sourceType: 'promo_qr',
    sellerId: null,
  });
  const attribution = context.services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: primarySource.source.traffic_source_id,
    source_qr_code_id: primarySource.qr.source_qr_code_id,
    entry_channel: 'qr',
  });

  clock.advanceMinutes(1);
  context.services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: secondarySource.source.traffic_source_id,
    source_qr_code_id: secondarySource.qr.source_qr_code_id,
    entry_channel: 'qr',
  });

  clock.advanceMinutes(1);
  const firstRequest = context.services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id:
      attribution.sellerAttributionSession.seller_attribution_session_id,
    requested_trip_date: '2026-04-11',
    requested_time_slot: '12:00',
    requested_seats: 2,
    requested_ticket_mix: { adult: 2 },
    requested_prepayment_amount: 1000,
    currency: 'RUB',
    contact_phone_e164: guest.phone_e164,
  });
  context.services.bookingRequestService.cancelRequestByGuest(
    firstRequest.bookingRequest.booking_request_id,
    {
      actorType: 'guest',
      actorId: String(guest.guest_profile_id),
    }
  );

  clock.advanceMinutes(1);
  const secondRequest = context.services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id:
      attribution.sellerAttributionSession.seller_attribution_session_id,
    requested_trip_date: '2026-04-12',
    requested_time_slot: '14:30',
    requested_seats: 3,
    requested_ticket_mix: { adult: 2, child: 1 },
    requested_prepayment_amount: 1500,
    currency: 'RUB',
    contact_phone_e164: guest.phone_e164,
  });
  const confirmed = context.services.bookingRequestService.confirmPrepayment(
    secondRequest.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: `payment-${suffix}`,
    }
  );
  context.services.presaleHandoffService.prepareHandoff(
    confirmed.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: `prepared-${suffix}`,
    }
  );
  context.services.handoffExecutionService.queueForHandoff(
    confirmed.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: `queue-${suffix}`,
      queueReason: 'guest_profile_read_model_seed',
    }
  );

  return {
    guest,
    primarySource,
    secondarySource,
    firstRequestId: firstRequest.bookingRequest.booking_request_id,
    secondRequestId: confirmed.bookingRequest.booking_request_id,
  };
}

function appendTelegramRequestEvent(
  context,
  {
    bookingRequestId,
    eventType,
    eventAt,
    actorType = 'system',
    actorId = null,
    eventPayload = {},
  }
) {
  const bookingRequest = context.repositories.bookingRequests.getById(bookingRequestId);
  const bookingHold = context.repositories.bookingHolds.findOneBy({
    booking_request_id: bookingRequestId,
  });

  return context.repositories.bookingRequestEvents.create({
    booking_request_id: bookingRequestId,
    booking_hold_id: bookingHold?.booking_hold_id || null,
    seller_attribution_session_id: bookingRequest.seller_attribution_session_id,
    event_type: eventType,
    event_at: eventAt,
    actor_type: actorType,
    actor_id: actorId,
    event_payload: eventPayload,
  });
}

describe('telegram guest profile read-only service', () => {
  let db;
  let context;
  let clock;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('aggregates guest basics, source entries, attribution, booking history, handoff state, and the active request', () => {
    const seeded = seedGuestProfileScenario(context, clock, '1001');
    const beforeCounts = snapshotTelegramRowCounts(db);

    const view = context.services.guestProfileService.readGuestProfileView({
      booking_request_id: seeded.secondRequestId,
    });

    expect(view.guest_identity).toMatchObject({
      guest_profile_id: seeded.guest.guest_profile_id,
      telegram_user_id: seeded.guest.telegram_user_id,
      display_name: 'Guest Profile 1001',
      phone_e164: seeded.guest.phone_e164,
      consent_status: 'granted',
      profile_status: 'active',
    });
    expect(view.source_entry_history).toHaveLength(2);
    expect(view.source_entry_history.map((item) => item.traffic_source.source_code)).toEqual([
      seeded.primarySource.source.source_code,
      seeded.secondarySource.source.source_code,
    ]);
    expect(view.attribution_history).toHaveLength(1);
    expect(view.booking_request_history.map((item) => item.booking_request.request_status)).toEqual([
      'GUEST_CANCELLED',
      'PREPAYMENT_CONFIRMED',
    ]);
    expect(view.current_active_request.booking_request.booking_request_id).toBe(
      seeded.secondRequestId
    );
    expect(view.current_active_request.handoff_state).toMatchObject({
      current_execution_state: 'queued_for_handoff',
      handoff_terminal: false,
      current_orchestration_outcome: null,
      orchestration_attempt_count: 0,
    });
    expect(view.current_active_request.presale_linkage_state).toMatchObject({
      linked_to_presale: false,
      confirmed_presale_id: null,
      request_status: 'PREPAYMENT_CONFIRMED',
    });
    expect(view.current_active_request.canonical_linkage_state).toMatchObject({
      projection_version: 'telegram_guest_profile_canonical_linkage_projection_v1',
      read_only: true,
      canonical_source: 'canonical_presales_and_tickets_read_only',
      confirmed_presale_id: null,
      linkage_status: 'not_linked',
      degradation_reason: null,
      degradation_reasons: [],
      canonical_presale: {
        exists: false,
        presale_id: null,
        status: null,
      },
      linked_ticket_summary: {
        read_status: 'not_applicable',
        total_count: null,
        status_counts: [],
      },
      trip_linkage_summary: {
        derivation_status: 'not_applicable',
        derivable: false,
      },
    });
    expect(view.timeline_projection).toMatchObject({
      projection_version: 'telegram_guest_profile_timeline_projection_v1',
      read_only: true,
      projection_source: {
        primary_data: 'telegram_booking_requests_and_events',
        presale_identifier_usage: 'telegram_booking_request.confirmed_presale_id_only',
        presale_domain_lookup_used: false,
        canonical_ticket_lookup_used: false,
      },
    });
    expect(view.timeline_projection.state_buckets).toMatchObject({
      telegram_confirmed_not_yet_ticketed: [
        {
          booking_request_id: seeded.secondRequestId,
          request_status: 'PREPAYMENT_CONFIRMED',
          confirmed_presale_id: null,
          terminal_reason: null,
        },
      ],
      linked_to_presale: [],
      completed_cancelled_expired: [
        {
          booking_request_id: seeded.firstRequestId,
          request_status: 'GUEST_CANCELLED',
          confirmed_presale_id: null,
          terminal_reason: 'GUEST_CANCELLED',
        },
      ],
    });
    expect(
      view.timeline_projection.guest_ticket_timeline.find(
        (item) =>
          item.booking_request_id === seeded.secondRequestId &&
          item.source_event_type === 'PREPAYMENT_CONFIRMED'
      )
    ).toMatchObject({
      timeline_status: 'prepayment_confirmed',
      ticket_status: 'PAYMENT_CONFIRMED',
      state_group: 'telegram_confirmed_not_yet_ticketed',
      confirmed_presale_id: null,
    });
    expect(
      view.timeline_projection.guest_ticket_timeline.find(
        (item) =>
          item.booking_request_id === seeded.firstRequestId &&
          item.source_event_type === 'GUEST_CANCELLED'
      )
    ).toMatchObject({
      ticket_status: 'CANCELLED',
      state_group: 'completed_cancelled_expired',
    });
    const secondProgression =
      view.timeline_projection.request_to_handoff_to_presale_progression.find(
        (item) => item.booking_request_id === seeded.secondRequestId
      );
    expect(secondProgression.current_phase).toBe('telegram_confirmed_not_yet_ticketed');
    expect(secondProgression.steps.map((step) => `${step.step}:${step.step_status}`)).toEqual([
      'request_received:completed',
      'telegram_confirmed_not_yet_ticketed:completed',
      'handoff_prepared:completed',
      'handoff_queued:completed',
      'handoff_started:pending',
      'handoff_completed_or_blocked:not_applicable',
      'linked_to_presale:pending',
    ]);
    expect(
      view.current_active_request.booking_request_events.map((event) => event.event_type)
    ).toEqual([
      'REQUEST_CREATED',
      'HOLD_STARTED',
      'PREPAYMENT_CONFIRMED',
      'HANDOFF_PREPARED',
      'HANDOFF_QUEUED',
    ]);
    expect(view.requested_booking_request_id).toBe(seeded.secondRequestId);
    expect(view.resolved_by).toEqual(['booking_request_id']);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.current_active_request)).toBe(true);
    expect(Object.isFrozen(view.timeline_projection)).toBe(true);
    expect(Object.isFrozen(view.current_active_request.canonical_linkage_state)).toBe(true);
    expect(Object.isFrozen(view.timeline_projection.guest_ticket_timeline[0])).toBe(true);
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeCounts);
  });

  it('resolves by Telegram identity and enriches linked canonical presale/ticket state read-only', () => {
    const seeded = seedGuestProfileScenario(context, clock, '2002');
    db.prepare(`
      INSERT INTO presales (id, boat_slot_id, status, slot_uid, business_day)
      VALUES (77, 42, 'ACTIVE', 'generated:42', '2026-04-12')
    `).run();
    db.prepare(`
      INSERT INTO tickets (presale_id, boat_slot_id, status)
      VALUES
        (77, 42, 'ACTIVE'),
        (77, 42, 'ACTIVE'),
        (77, 42, 'USED')
    `).run();
    context.repositories.bookingRequests.updateById(seeded.secondRequestId, {
      request_status: 'CONFIRMED_TO_PRESALE',
      confirmed_presale_id: 77,
      last_status_at: '2026-04-10T10:30:00.000Z',
    });
    appendTelegramRequestEvent(context, {
      bookingRequestId: seeded.secondRequestId,
      eventType: 'TICKET_SENT',
      eventAt: '2026-04-10T10:31:00.000Z',
      actorId: 'ticket-delivery',
      eventPayload: { delivery_provider: 'telegram' },
    });
    appendTelegramRequestEvent(context, {
      bookingRequestId: seeded.secondRequestId,
      eventType: 'REMINDER_SENT',
      eventAt: '2026-04-10T10:32:00.000Z',
      actorId: 'trip-reminder',
      eventPayload: { reminder_kind: 'pre_boarding' },
    });
    appendTelegramRequestEvent(context, {
      bookingRequestId: seeded.secondRequestId,
      eventType: 'BOARDING_SENT',
      eventAt: '2026-04-10T10:33:00.000Z',
      actorId: 'boarding',
      eventPayload: { boarding_notice: true },
    });
    const beforeCounts = snapshotTelegramRowCounts(db);

    const view = context.services.guestProfileService.readGuestProfileView({
      telegram_user_id: seeded.guest.telegram_user_id,
    });
    const linkedRequest = view.booking_request_history.find(
      (item) => item.booking_request.booking_request_id === seeded.secondRequestId
    );

    expect(view.requested_booking_request_id).toBeNull();
    expect(view.resolved_by).toEqual(['telegram_user_id']);
    expect(linkedRequest.presale_linkage_state).toMatchObject({
      linked_to_presale: true,
      confirmed_presale_id: 77,
      linkage_source: 'telegram_booking_request.confirmed_presale_id',
      request_status: 'CONFIRMED_TO_PRESALE',
    });
    expect(linkedRequest.canonical_linkage_state).toMatchObject({
      projection_version: 'telegram_guest_profile_canonical_linkage_projection_v1',
      read_only: true,
      canonical_source: 'canonical_presales_and_tickets_read_only',
      confirmed_presale_id: 77,
      linkage_status: 'enriched',
      degradation_reason: null,
      degradation_reasons: [],
      canonical_presale: {
        exists: true,
        presale_id: 77,
        status: 'ACTIVE',
      },
      linked_ticket_summary: {
        read_status: 'readable',
        total_count: 3,
        status_counts: [
          { status: 'ACTIVE', count: 2 },
          { status: 'USED', count: 1 },
        ],
      },
      trip_linkage_summary: {
        derivation_status: 'derived',
        derivable: true,
        derivation_source: 'canonical_presale_and_tickets',
        slot_uid: 'generated:42',
        boat_slot_id: 42,
        business_day: '2026-04-12',
        inconsistency_reasons: [],
      },
    });
    expect(linkedRequest.handoff_state.current_execution_state).toBe('queued_for_handoff');
    expect(view.current_active_request).toBeNull();
    expect(view.timeline_projection.state_buckets.linked_to_presale).toEqual([
      {
        booking_request_id: seeded.secondRequestId,
        request_status: 'CONFIRMED_TO_PRESALE',
        confirmed_presale_id: 77,
        terminal_reason: null,
      },
    ]);
    expect(
      view.timeline_projection.guest_ticket_timeline.filter(
        (item) =>
          item.booking_request_id === seeded.secondRequestId &&
          item.state_group === 'linked_to_presale'
      ).map((item) => item.ticket_status)
    ).toEqual(['TICKET_READY', 'TICKET_READY', 'REMINDER_SENT', 'BOARDING_READY']);
    expect(
      view.timeline_projection.trip_timeline_status_history.find(
        (item) =>
          item.booking_request_id === seeded.secondRequestId &&
          item.source_event_type === 'PRESALE_LINKED'
      )
    ).toMatchObject({
      timeline_status: 'presale_linked',
      state_group: 'linked_to_presale',
      confirmed_presale_id: 77,
      linkage_source: 'telegram_booking_request.confirmed_presale_id',
      requested_trip: {
        requested_trip_date: '2026-04-12',
        requested_time_slot: '14:30',
        requested_seats: 3,
        requested_ticket_mix: { adult: 2, child: 1 },
      },
    });
    const linkedProgression =
      view.timeline_projection.request_to_handoff_to_presale_progression.find(
        (item) => item.booking_request_id === seeded.secondRequestId
      );
    expect(linkedProgression.current_phase).toBe('linked_to_presale');
    expect(linkedProgression.steps.at(-1)).toMatchObject({
      step: 'linked_to_presale',
      step_status: 'completed',
      state_group: 'linked_to_presale',
      confirmed_presale_id: 77,
      source_type: 'telegram_booking_request',
      source_event_type: 'PRESALE_LINKED',
    });
    expect(linkedRequest.confirmed_presale).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales WHERE id = 77').get().count).toBe(1);
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeCounts);
  });

  it('returns a degraded canonical linkage result when the linked presale is missing', () => {
    const seeded = seedGuestProfileScenario(context, clock, '2102');
    db.pragma('foreign_keys = OFF');
    context.repositories.bookingRequests.updateById(seeded.secondRequestId, {
      request_status: 'CONFIRMED_TO_PRESALE',
      confirmed_presale_id: 404,
      last_status_at: '2026-04-10T10:40:00.000Z',
    });
    db.pragma('foreign_keys = ON');
    const beforeCounts = snapshotTelegramRowCounts(db);

    const view = context.services.guestProfileService.readGuestProfileView({
      booking_request_id: seeded.secondRequestId,
    });
    const linkedRequest = view.booking_request_history.find(
      (item) => item.booking_request.booking_request_id === seeded.secondRequestId
    );

    expect(linkedRequest.presale_linkage_state).toMatchObject({
      linked_to_presale: true,
      confirmed_presale_id: 404,
      linkage_source: 'telegram_booking_request.confirmed_presale_id',
    });
    expect(linkedRequest.canonical_linkage_state).toMatchObject({
      confirmed_presale_id: 404,
      linkage_status: 'degraded',
      degradation_reason: 'canonical_presale_missing',
      degradation_reasons: ['canonical_presale_missing'],
      canonical_presale: {
        exists: false,
        presale_id: null,
        status: null,
      },
      linked_ticket_summary: {
        read_status: 'not_applicable',
        total_count: null,
        status_counts: [],
      },
      trip_linkage_summary: {
        derivation_status: 'not_applicable',
        derivable: false,
      },
    });
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeCounts);
  });

  it('returns degraded canonical linkage when ticket trip linkage is inconsistent', () => {
    const seeded = seedGuestProfileScenario(context, clock, '2202');
    db.prepare(`
      INSERT INTO presales (id, boat_slot_id, status, slot_uid, business_day)
      VALUES (88, 42, 'ACTIVE', 'generated:42', '2026-04-12')
    `).run();
    db.prepare(`
      INSERT INTO tickets (presale_id, boat_slot_id, status)
      VALUES
        (88, 42, 'ACTIVE'),
        (88, 43, 'ACTIVE')
    `).run();
    context.repositories.bookingRequests.updateById(seeded.secondRequestId, {
      request_status: 'CONFIRMED_TO_PRESALE',
      confirmed_presale_id: 88,
      last_status_at: '2026-04-10T10:45:00.000Z',
    });
    const beforeCounts = snapshotTelegramRowCounts(db);

    const view = context.services.guestProfileService.readGuestProfileView({
      booking_request_id: seeded.secondRequestId,
    });
    const linkedRequest = view.booking_request_history.find(
      (item) => item.booking_request.booking_request_id === seeded.secondRequestId
    );

    expect(linkedRequest.canonical_linkage_state).toMatchObject({
      confirmed_presale_id: 88,
      linkage_status: 'degraded',
      degradation_reason: 'multiple_ticket_boat_slot_ids',
      degradation_reasons: ['multiple_ticket_boat_slot_ids'],
      canonical_presale: {
        exists: true,
        presale_id: 88,
        status: 'ACTIVE',
      },
      linked_ticket_summary: {
        read_status: 'readable',
        total_count: 2,
        status_counts: [{ status: 'ACTIVE', count: 2 }],
      },
      trip_linkage_summary: {
        derivation_status: 'degraded_inconsistent',
        derivable: false,
        slot_uid: null,
        boat_slot_id: null,
        business_day: null,
        inconsistency_reasons: ['multiple_ticket_boat_slot_ids'],
      },
    });
    expect(snapshotTelegramRowCounts(db)).toEqual(beforeCounts);
  });

  it('rejects ambiguous or mismatched identities instead of guessing a profile', () => {
    const seeded = seedGuestProfileScenario(context, clock, '3003');
    context.repositories.guestProfiles.create({
      telegram_user_id: 'tg-guest-profile-other',
      display_name: 'Other Guest Profile',
      username: 'other_guest_profile',
      language_code: 'ru',
      phone_e164: seeded.guest.phone_e164,
      consent_status: 'granted',
      profile_status: 'active',
    });

    expect(() =>
      context.services.guestProfileService.readGuestProfileView({
        phone_e164: seeded.guest.phone_e164,
      })
    ).toThrow('Ambiguous guest profile phone identity');
    expect(() =>
      context.services.guestProfileService.readGuestProfileView({
        booking_request_id: seeded.secondRequestId,
        telegram_user_id: 'tg-guest-profile-other',
      })
    ).toThrow('Booking request does not match guest identity');
  });
});
