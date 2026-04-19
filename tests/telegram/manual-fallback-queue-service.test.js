import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import { TELEGRAM_MANUAL_FALLBACK_ACTIONS } from '../../shared/telegram/index.js';

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
      customer_name TEXT,
      customer_phone TEXT,
      number_of_seats INTEGER,
      total_price INTEGER,
      prepayment_amount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      slot_uid TEXT NULL,
      payment_method TEXT NULL,
      payment_cash_amount INTEGER DEFAULT 0,
      payment_card_amount INTEGER DEFAULT 0,
      seller_id INTEGER NULL,
      business_day TEXT NULL,
      tickets_json TEXT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(
    `INSERT INTO users (username, role, is_active) VALUES ('seller-a', 'seller', 1)`
  ).run();
  db.prepare(
    `INSERT INTO users (username, role, is_active) VALUES ('seller-b', 'seller', 1)`
  ).run();
  return db;
}

function createClock(startIso) {
  let current = new Date(startIso);
  return {
    now: () => new Date(current),
    set(isoTimestamp) {
      current = new Date(isoTimestamp);
    },
    advanceMinutes(minutes) {
      current = new Date(current.getTime() + minutes * 60 * 1000);
    },
  };
}

function wireClock(context, clock) {
  context.services.bookingRequestService.now = clock.now;
  context.services.presaleHandoffService.now = clock.now;
  context.services.handoffExecutionService.now = clock.now;
  context.services.manualFallbackQueueService.now = clock.now;
}

function listEvents(context, bookingRequestId) {
  return context.repositories.bookingRequestEvents.listBy(
    { booking_request_id: bookingRequestId },
    { orderBy: 'booking_request_event_id ASC', limit: 100 }
  );
}

function seedBookingRequest(
  context,
  clock,
  {
    suffix,
    sourceType,
    sourceName,
    sellerId,
    attributionStatus,
    expiresAt,
    bindingReason,
    confirmPrepayment = false,
    prepareHandoff = false,
    queueHandoff = false,
    requestedPrepaymentAmount = 3200,
  }
) {
  wireClock(context, clock);

  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-manual-fallback-${suffix}`,
    display_name: `Manual Fallback Guest ${suffix}`,
    username: `manual_fallback_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999777${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `manual-fallback-source-${suffix}`,
    source_type: sourceType,
    source_name: sourceName,
    default_seller_id: sellerId,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `manual-fallback-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: { zone: `manual-fallback-zone-${suffix}` },
    is_active: 1,
  });
  const attributionSession = repositories.sellerAttributionSessions.create({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    seller_id: sellerId,
    starts_at: clock.now().toISOString(),
    expires_at: expiresAt,
    attribution_status: attributionStatus,
    binding_reason: bindingReason,
  });

  const lifecycle = services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id: attributionSession.seller_attribution_session_id,
    requested_trip_date: '2026-04-12',
    requested_time_slot: '12:00',
    requested_seats: 2,
    requested_ticket_mix: { adult: 2 },
    requested_prepayment_amount: requestedPrepaymentAmount,
    currency: 'RUB',
    contact_phone_e164: `+7999777${suffix}`,
  });

  const bookingRequestId = lifecycle.bookingRequest.booking_request_id;

  if (confirmPrepayment) {
    services.bookingRequestService.confirmPrepayment(
      bookingRequestId,
      {
        actorType: 'system',
        actorId: `payment-${suffix}`,
      }
    );
  }

  if (prepareHandoff) {
    services.presaleHandoffService.prepareHandoff(
      bookingRequestId,
      {
        actorType: 'system',
        actorId: `handoff-${suffix}`,
      }
    );
  }

  if (queueHandoff) {
    services.handoffExecutionService.queueForHandoff(bookingRequestId, {
      actorType: 'system',
      actorId: `queue-${suffix}`,
      queueReason: `manual_fallback_queue_${suffix}`,
    });
  }

  return {
    guest,
    source,
    qr,
    attributionSession,
    bookingRequestId,
  };
}

describe('telegram manual fallback queue service', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T12:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('lists only fallback requests for the documented manual cases', () => {
    const activeSeller = seedBookingRequest(context, clock, {
      suffix: '5001',
      sourceType: 'seller_qr',
      sourceName: 'Active Seller Source',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:30:00.000Z',
      bindingReason: 'seller_qr',
    });
    clock.advanceMinutes(5);
    const noActiveSeller = seedBookingRequest(context, clock, {
      suffix: '5002',
      sourceType: 'seller_qr',
      sourceName: 'Inactive Seller Source',
      sellerId: 1,
      attributionStatus: 'INACTIVE',
      expiresAt: '2026-04-10T12:35:00.000Z',
      bindingReason: 'seller_qr',
    });
    clock.advanceMinutes(5);
    const expiredAttribution = seedBookingRequest(context, clock, {
      suffix: '5003',
      sourceType: 'seller_qr',
      sourceName: 'Expired Seller Source',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T11:55:00.000Z',
      bindingReason: 'seller_qr',
    });
    clock.advanceMinutes(5);
    const missingSeller = seedBookingRequest(context, clock, {
      suffix: '5004',
      sourceType: 'seller_qr',
      sourceName: 'Missing Seller Source',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:35:00.000Z',
      bindingReason: 'seller_qr',
    });
    clock.advanceMinutes(5);
    const nonSellerRouting = seedBookingRequest(context, clock, {
      suffix: '5005',
      sourceType: 'promo_qr',
      sourceName: 'Promo Fallback Source',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:35:00.000Z',
      bindingReason: 'promo_qr',
      confirmPrepayment: true,
      prepareHandoff: true,
      queueHandoff: true,
    });

    const queue = context.services.manualFallbackQueueService.listManualFallbackQueue({
      limit: 10,
    });
    const requestIds = queue.items.map((item) => item.booking_request.booking_request_id);
    const queueItemFor = (bookingRequestId) =>
      queue.items.find((item) => item.booking_request.booking_request_id === bookingRequestId);
    const noActiveSellerItem = queueItemFor(noActiveSeller.bookingRequestId);
    const expiredAttributionItem = queueItemFor(expiredAttribution.bookingRequestId);
    const missingSellerItem = queueItemFor(missingSeller.bookingRequestId);

    expect(requestIds).toContain(noActiveSeller.bookingRequestId);
    expect(requestIds).toContain(expiredAttribution.bookingRequestId);
    expect(requestIds).toContain(missingSeller.bookingRequestId);
    expect(requestIds).toContain(nonSellerRouting.bookingRequestId);
    expect(requestIds).not.toContain(activeSeller.bookingRequestId);
    expect(queue.items[0].booking_request.booking_request_id).toBe(nonSellerRouting.bookingRequestId);
    expect(queue.items[0].manual_fallback_classification.manual_fallback_reason).toBe(
      'non_seller_routing'
    );
    expect(noActiveSellerItem.manual_fallback_classification.manual_fallback_reason).toBe(
      'no_active_seller_attribution'
    );
    expect(expiredAttributionItem.manual_fallback_classification.manual_fallback_reason).toBe(
      'expired_attribution'
    );
    expect(missingSellerItem.manual_fallback_classification.manual_fallback_reason).toBe(
      'missing_seller'
    );
    expect(Object.isFrozen(queue)).toBe(true);
    expect(Object.isFrozen(queue.items)).toBe(true);
    expect(Object.isFrozen(queue.items[0])).toBe(true);
    expect(Object.isFrozen(queue.items[0].manual_fallback_classification)).toBe(true);
  });

  it('returns frozen attribution context, handoff snapshot, and current execution state for fallback reads', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '6001',
      sourceType: 'promo_qr',
      sourceName: 'Promo Snapshot Source',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
      bindingReason: 'promo_qr',
      confirmPrepayment: true,
      prepareHandoff: true,
      queueHandoff: true,
    });

    context.repositories.trafficSources.updateById(seeded.source.traffic_source_id, {
      source_name: 'Mutated Promo Snapshot Source',
    });

    const readback = context.services.manualFallbackQueueService.readManualFallbackRequest(
      seeded.bookingRequestId
    );

    expect(readback.queue_item_type).toBe('manual_fallback_request');
    expect(readback.booking_request.booking_request_id).toBe(seeded.bookingRequestId);
    expect(readback.manual_fallback_classification.manual_fallback_reason).toBe(
      'non_seller_routing'
    );
    expect(readback.current_telegram_execution_state).toBe('queued_for_handoff');
    expect(readback.handoff_snapshot.booking_request_id).toBe(seeded.bookingRequestId);
    expect(readback.handoff_snapshot.attribution_context.source_name).toBe(
      'Promo Snapshot Source'
    );
    expect(readback.attribution_context.source_name).toBe('Mutated Promo Snapshot Source');
    expect(Object.isFrozen(readback)).toBe(true);
    expect(Object.isFrozen(readback.attribution_context)).toBe(true);
    expect(Object.isFrozen(readback.handoff_snapshot)).toBe(true);
    expect(Object.isFrozen(readback.handoff_snapshot.attribution_context)).toBe(true);
    expect(() =>
      context.services.manualFallbackQueueService.readManualFallbackRequest(
        seeded.bookingRequestId + 999
      )
    ).toThrow('Booking request not found');
  });

  it('rejects reads for requests that are not manual fallback candidates', () => {
    const activeSeller = seedBookingRequest(context, clock, {
      suffix: '7001',
      sourceType: 'seller_qr',
      sourceName: 'Active Seller Read',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
      bindingReason: 'seller_qr',
    });

    expect(() =>
      context.services.manualFallbackQueueService.readManualFallbackRequest(
        activeSeller.bookingRequestId
      )
    ).toThrow('not a manual fallback request');
  });

  it('records call_started manual fallback actions idempotently and only for fallback requests', () => {
    const manual = seedBookingRequest(context, clock, {
      suffix: '8001',
      sourceType: 'promo_qr',
      sourceName: 'Promo Manual Call',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
      bindingReason: 'promo_qr',
    });
    const activeSeller = seedBookingRequest(context, clock, {
      suffix: '8002',
      sourceType: 'seller_qr',
      sourceName: 'Active Seller Manual Reject',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
      bindingReason: 'seller_qr',
    });

    const first = context.services.manualFallbackQueueService.recordManualFallbackAction({
      bookingRequestId: manual.bookingRequestId,
      action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.call_started,
      idempotencyKey: 'manual-call-8001',
      actorType: 'owner',
      actorId: 'owner-1',
      actionPayload: { channel: 'phone' },
    });
    const second = context.services.manualFallbackQueueService.recordManualFallbackAction({
      bookingRequestId: manual.bookingRequestId,
      action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.call_started,
      idempotencyKey: 'manual-call-8001',
      actorType: 'owner',
      actorId: 'owner-1',
      actionPayload: { channel: 'phone' },
    });
    const events = listEvents(context, manual.bookingRequestId);

    expect(first.outcome).toBe('applied');
    expect(second.outcome).toBe('idempotent_replay');
    expect(second.event.booking_request_event_id).toBe(first.event.booking_request_event_id);
    expect(first.action).toBe(TELEGRAM_MANUAL_FALLBACK_ACTIONS.call_started);
    expect(first.queue_item.available_actions).toEqual([
      TELEGRAM_MANUAL_FALLBACK_ACTIONS.call_started,
      TELEGRAM_MANUAL_FALLBACK_ACTIONS.not_reached,
      TELEGRAM_MANUAL_FALLBACK_ACTIONS.assign_to_seller,
      TELEGRAM_MANUAL_FALLBACK_ACTIONS.manual_prepayment_confirmed,
    ]);
    expect(first.event.event_type).toBe('MANUAL_FALLBACK_CALL_STARTED');
    expect(events.filter((event) => event.event_type === 'MANUAL_FALLBACK_CALL_STARTED')).toHaveLength(1);
    expect(first.event.event_payload).toMatchObject({
      idempotency_key: 'manual-call-8001',
      manual_fallback_action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.call_started,
      action_source: 'telegram_manual_fallback_queue',
      prior_request_status: 'HOLD_ACTIVE',
      request_status: 'HOLD_ACTIVE',
    });
    expect(
      first.event.event_payload.manual_fallback_classification.manual_fallback_reason
    ).toBe('non_seller_routing');
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
    expect(() =>
      context.services.manualFallbackQueueService.recordManualFallbackAction({
        bookingRequestId: activeSeller.bookingRequestId,
        action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.call_started,
        idempotencyKey: 'manual-call-active-seller-8002',
      })
    ).toThrow('not a manual fallback request');
  });

  it('records not_reached through lifecycle events idempotently and rejects payload drift', () => {
    const manual = seedBookingRequest(context, clock, {
      suffix: '9001',
      sourceType: 'promo_qr',
      sourceName: 'Promo Manual Not Reached',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
      bindingReason: 'promo_qr',
    });

    const first = context.services.manualFallbackQueueService.recordManualFallbackAction({
      bookingRequestId: manual.bookingRequestId,
      action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.not_reached,
      idempotencyKey: 'manual-not-reached-9001',
      actorType: 'owner',
      actorId: 'owner-1',
      actionPayload: { outcome_note: 'no answer' },
    });
    const second = context.services.manualFallbackQueueService.recordManualFallbackAction({
      bookingRequestId: manual.bookingRequestId,
      action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.not_reached,
      idempotencyKey: 'manual-not-reached-9001',
      actorType: 'owner',
      actorId: 'owner-1',
      actionPayload: { outcome_note: 'no answer' },
    });
    const events = listEvents(context, manual.bookingRequestId);

    expect(first.outcome).toBe('applied');
    expect(second.outcome).toBe('idempotent_replay');
    expect(second.event.booking_request_event_id).toBe(first.event.booking_request_event_id);
    expect(first.queue_item.booking_request.request_status).toBe('SELLER_NOT_REACHED');
    expect(first.queue_item.booking_hold.hold_status).toBe('RELEASED');
    expect(first.queue_item.available_actions).toEqual([]);
    expect(first.event.event_type).toBe('SELLER_NOT_REACHED');
    expect(first.event.event_payload).toMatchObject({
      idempotency_key: 'manual-not-reached-9001',
      manual_fallback_action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.not_reached,
      action_source: 'telegram_manual_fallback_queue',
      prior_request_status: 'HOLD_ACTIVE',
      request_status: 'SELLER_NOT_REACHED',
    });
    expect(events.filter((event) => event.event_type === 'SELLER_NOT_REACHED')).toHaveLength(1);
    expect(() =>
      context.services.manualFallbackQueueService.recordManualFallbackAction({
        bookingRequestId: manual.bookingRequestId,
        action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.not_reached,
        idempotencyKey: 'manual-not-reached-9001',
        actorType: 'owner',
        actorId: 'owner-1',
        actionPayload: { outcome_note: 'different note' },
      })
    ).toThrow('Idempotency conflict');
  });

  it('assigns manual fallback requests into a seller-owned attribution path idempotently', () => {
    const manual = seedBookingRequest(context, clock, {
      suffix: '9201',
      sourceType: 'promo_qr',
      sourceName: 'Promo Manual Assign',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
      bindingReason: 'promo_qr',
    });
    const activeSeller = seedBookingRequest(context, clock, {
      suffix: '9202',
      sourceType: 'seller_qr',
      sourceName: 'Active Seller Assign Reject',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
      bindingReason: 'seller_qr',
    });
    const priorAttribution = context.repositories.sellerAttributionSessions.getById(
      context.repositories.bookingRequests.getById(manual.bookingRequestId)
        .seller_attribution_session_id
    );

    const first = context.services.manualFallbackQueueService.recordManualFallbackAction({
      bookingRequestId: manual.bookingRequestId,
      action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.assign_to_seller,
      idempotencyKey: 'manual-assign-9201',
      actorType: 'owner',
      actorId: 'owner-1',
      actionPayload: { seller_id: 2 },
    });
    const second = context.services.manualFallbackQueueService.recordManualFallbackAction({
      bookingRequestId: manual.bookingRequestId,
      action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.assign_to_seller,
      idempotencyKey: 'manual-assign-9201',
      actorType: 'owner',
      actorId: 'owner-1',
      actionPayload: { seller_id: 2 },
    });
    const updatedRequest = context.repositories.bookingRequests.getById(manual.bookingRequestId);
    const nextAttribution = context.repositories.sellerAttributionSessions.getById(
      updatedRequest.seller_attribution_session_id
    );
    const events = listEvents(context, manual.bookingRequestId);
    const sellerQueue = context.services.sellerWorkQueueService.listSellerWorkQueue(2);

    expect(first.outcome).toBe('applied');
    expect(second.outcome).toBe('idempotent_replay');
    expect(second.event.booking_request_event_id).toBe(first.event.booking_request_event_id);
    expect(first.queue_item).toBeNull();
    expect(second.queue_item).toBeNull();
    expect(updatedRequest.seller_attribution_session_id).not.toBe(
      priorAttribution.seller_attribution_session_id
    );
    expect(nextAttribution).toMatchObject({
      seller_id: 2,
      binding_reason: 'seller_direct_link',
      attribution_status: 'ACTIVE',
    });
    expect(first.event.event_type).toBe('MANUAL_FALLBACK_ASSIGNED_TO_SELLER');
    expect(first.event.event_payload).toMatchObject({
      idempotency_key: 'manual-assign-9201',
      manual_fallback_action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.assign_to_seller,
      action_source: 'telegram_manual_fallback_queue',
      prior_seller_attribution_session_id:
        priorAttribution.seller_attribution_session_id,
      seller_attribution_session_id: nextAttribution.seller_attribution_session_id,
      seller_id: 2,
      source_ownership: 'seller',
      path_type: 'seller_attributed',
    });
    expect(
      events.filter((event) => event.event_type === 'MANUAL_FALLBACK_ASSIGNED_TO_SELLER')
    ).toHaveLength(1);
    expect(sellerQueue.items.map((item) => item.booking_request.booking_request_id)).toContain(
      manual.bookingRequestId
    );
    expect(() =>
      context.services.manualFallbackQueueService.readManualFallbackRequest(
        manual.bookingRequestId
      )
    ).toThrow('not a manual fallback request');
    expect(() =>
      context.services.manualFallbackQueueService.recordManualFallbackAction({
        bookingRequestId: manual.bookingRequestId,
        action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.assign_to_seller,
        idempotencyKey: 'manual-assign-9201',
        actorType: 'owner',
        actorId: 'owner-1',
        actionPayload: { seller_id: 1 },
      })
    ).toThrow('Idempotency conflict');

    context.services.bookingRequestService.confirmPrepayment(manual.bookingRequestId, {
      actorType: 'seller',
      actorId: '2',
    });
    const prepared = context.services.presaleHandoffService.prepareHandoff(
      manual.bookingRequestId,
      {
        actorType: 'system',
        actorId: 'handoff-after-assign',
      }
    );

    expect(prepared.payload.source).toMatchObject({
      seller_id: 2,
      source_family: 'seller_direct_link',
      source_ownership: 'seller',
      path_type: 'seller_attributed',
    });
    expect(() =>
      context.services.manualFallbackQueueService.recordManualFallbackAction({
        bookingRequestId: activeSeller.bookingRequestId,
        action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.assign_to_seller,
        idempotencyKey: 'manual-assign-active-seller-9202',
        actionPayload: { seller_id: 2 },
      })
    ).toThrow('not a manual fallback request');
  });

  it('confirms manual fallback prepayment and queues the isolated handoff path idempotently', () => {
    const manual = seedBookingRequest(context, clock, {
      suffix: '9301',
      sourceType: 'promo_qr',
      sourceName: 'Promo Manual Prepayment',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
      bindingReason: 'promo_qr',
    });
    const activeSeller = seedBookingRequest(context, clock, {
      suffix: '9302',
      sourceType: 'seller_qr',
      sourceName: 'Active Seller Prepayment Reject',
      sellerId: 1,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
      bindingReason: 'seller_qr',
    });

    const first = context.services.manualFallbackQueueService.recordManualFallbackAction({
      bookingRequestId: manual.bookingRequestId,
      action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.manual_prepayment_confirmed,
      idempotencyKey: 'manual-prepayment-9301',
      actorType: 'owner',
      actorId: 'owner-1',
      actionPayload: { confirmation_source: 'owner_manual' },
    });
    const second = context.services.manualFallbackQueueService.recordManualFallbackAction({
      bookingRequestId: manual.bookingRequestId,
      action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.manual_prepayment_confirmed,
      idempotencyKey: 'manual-prepayment-9301',
      actorType: 'owner',
      actorId: 'owner-1',
      actionPayload: { confirmation_source: 'owner_manual' },
    });
    const events = listEvents(context, manual.bookingRequestId);
    const eventTypes = events.map((event) => event.event_type);
    const queuedEvent = events.find((event) => event.event_type === 'HANDOFF_QUEUED');

    expect(first.outcome).toBe('applied');
    expect(second.outcome).toBe('idempotent_replay');
    expect(second.event.booking_request_event_id).toBe(first.event.booking_request_event_id);
    expect(first.queue_item.booking_request.request_status).toBe('PREPAYMENT_CONFIRMED');
    expect(first.queue_item.booking_hold.hold_status).toBe('CONVERTED');
    expect(first.queue_item.available_actions).toEqual([]);
    expect(first.handoff_prepared.handoffState).toBe('READY_FOR_PRESALE_HANDOFF');
    expect(first.handoff_execution.current_execution_state).toBe('queued_for_handoff');
    expect(first.event.event_type).toBe('PREPAYMENT_CONFIRMED');
    expect(first.event.event_payload).toMatchObject({
      idempotency_key: 'manual-prepayment-9301',
      manual_fallback_action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.manual_prepayment_confirmed,
      action_source: 'telegram_manual_fallback_queue',
      prior_request_status: 'HOLD_ACTIVE',
      request_status: 'PREPAYMENT_CONFIRMED',
    });
    expect(queuedEvent.event_payload.transition).toMatchObject({
      queue_reason: 'manual_fallback_prepayment_confirmed',
      queue_metadata: {
        idempotency_key: 'manual-prepayment-9301',
        manual_fallback_action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.manual_prepayment_confirmed,
        confirmation_event_id: first.event.booking_request_event_id,
      },
    });
    expect(eventTypes.filter((eventType) => eventType === 'PREPAYMENT_CONFIRMED')).toHaveLength(1);
    expect(eventTypes.filter((eventType) => eventType === 'HANDOFF_PREPARED')).toHaveLength(1);
    expect(eventTypes.filter((eventType) => eventType === 'HANDOFF_QUEUED')).toHaveLength(1);
    expect(eventTypes).not.toContain('REAL_PRESALE_HANDOFF_ATTEMPTED');
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
    expect(() =>
      context.services.manualFallbackQueueService.recordManualFallbackAction({
        bookingRequestId: manual.bookingRequestId,
        action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.manual_prepayment_confirmed,
        idempotencyKey: 'manual-prepayment-9301',
        actorType: 'owner',
        actorId: 'owner-1',
        actionPayload: { confirmation_source: 'different_manual_source' },
      })
    ).toThrow('Idempotency conflict');
    expect(() =>
      context.services.manualFallbackQueueService.recordManualFallbackAction({
        bookingRequestId: activeSeller.bookingRequestId,
        action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.manual_prepayment_confirmed,
        idempotencyKey: 'manual-prepayment-active-seller-9302',
      })
    ).toThrow('not a manual fallback request');
  });

  it('rejects manual fallback actions after prepayment is final without advancing handoff', () => {
    const manual = seedBookingRequest(context, clock, {
      suffix: '9101',
      sourceType: 'promo_qr',
      sourceName: 'Promo Final Manual',
      sellerId: null,
      attributionStatus: 'ACTIVE',
      expiresAt: '2026-04-10T12:45:00.000Z',
      bindingReason: 'promo_qr',
      confirmPrepayment: true,
      prepareHandoff: true,
      queueHandoff: true,
    });
    const before = context.services.handoffExecutionQueryService.readExecutionState(
      manual.bookingRequestId
    );

    expect(() =>
      context.services.manualFallbackQueueService.recordManualFallbackAction({
        bookingRequestId: manual.bookingRequestId,
        action: TELEGRAM_MANUAL_FALLBACK_ACTIONS.call_started,
        idempotencyKey: 'manual-call-final-9101',
      })
    ).toThrow('after prepayment is final');

    const after = context.services.handoffExecutionQueryService.readExecutionState(
      manual.bookingRequestId
    );
    const events = listEvents(context, manual.bookingRequestId);

    expect(after.current_execution_state).toBe(before.current_execution_state);
    expect(after.execution_history).toEqual(before.execution_history);
    expect(events.map((event) => event.event_type)).not.toContain(
      'MANUAL_FALLBACK_CALL_STARTED'
    );
  });
});
