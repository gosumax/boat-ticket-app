import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_SELLER_ACTION_TYPES,
  TELEGRAM_SELLER_QUEUE_STATES,
} from '../../shared/telegram/index.js';

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
      id INTEGER PRIMARY KEY AUTOINCREMENT
    );
  `);
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (1, 'seller-one', 'seller', 1)`
  ).run();
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (2, 'seller-two', 'seller', 1)`
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
  };
}

function setAttributionInactive(context, bookingRequestId) {
  const bookingRequest = context.repositories.bookingRequests.getById(bookingRequestId);
  context.repositories.sellerAttributionSessions.updateById(
    bookingRequest.seller_attribution_session_id,
    {
      attribution_status: 'EXPIRED',
      expires_at: '2026-01-01T00:00:00.000Z',
    }
  );
}

function seedSellerRequest(
  context,
  {
    sellerId = 1,
    suffix,
    requestedTripDate = '2026-04-11',
    requestedTimeSlot = '12:00',
    requestedSeats = 2,
    requestedPrepaymentAmount = 1000,
  }
) {
  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-seller-op-${suffix}`,
    display_name: `Seller Ops Guest ${suffix}`,
    username: `seller_ops_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999111${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-op-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Ops Source ${suffix}`,
    default_seller_id: sellerId,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-op-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: { zone: `seller-op-zone-${suffix}` },
    is_active: 1,
  });
  const attribution = services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    entry_channel: 'qr',
  });
  const lifecycle = services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id:
      attribution.sellerAttributionSession.seller_attribution_session_id,
    requested_trip_date: requestedTripDate,
    requested_time_slot: requestedTimeSlot,
    requested_seats: requestedSeats,
    requested_ticket_mix: { adult: requestedSeats },
    requested_prepayment_amount: requestedPrepaymentAmount,
    currency: 'RUB',
    contact_phone_e164: `+7999111${suffix}`,
  });

  return {
    bookingRequestId: lifecycle.bookingRequest.booking_request_id,
    sellerId,
  };
}

describe('telegram seller-operation services', () => {
  let db;
  let context;
  let clock;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    context.services.attributionService.now = clock.now;
    context.services.bookingRequestService.now = clock.now;
    context.services.sellerWorkQueueQueryService.now = clock.now;
    context.services.sellerActionService.now = clock.now;
  });

  it('projects seller work-queue items by seller and state with frozen stable outputs', () => {
    const waiting = seedSellerRequest(context, { sellerId: 1, suffix: '1001' });
    const holdExtended = seedSellerRequest(context, { sellerId: 1, suffix: '1002' });
    const prepayment = seedSellerRequest(context, { sellerId: 1, suffix: '1003' });
    const closed = seedSellerRequest(context, { sellerId: 1, suffix: '1004' });
    const otherSeller = seedSellerRequest(context, { sellerId: 2, suffix: '1005' });

    context.services.bookingRequestService.extendHoldOnce(holdExtended.bookingRequestId);
    context.services.bookingRequestService.confirmPrepayment(prepayment.bookingRequestId);
    context.services.bookingRequestService.markSellerNotReached(closed.bookingRequestId);

    const sellerQueue =
      context.services.sellerWorkQueueQueryService.listCurrentSellerWorkQueueItemsBySellerReference(
        {
          seller_reference: {
            reference_type: 'seller_user',
            seller_id: 1,
          },
        }
      );
    const states = new Set(sellerQueue.items.map((item) => item.queue_state));
    const requestIds = sellerQueue.items.map(
      (item) => item.booking_request_reference.booking_request_id
    );

    expect(states).toEqual(new Set(TELEGRAM_SELLER_QUEUE_STATES));
    expect(requestIds).toContain(waiting.bookingRequestId);
    expect(requestIds).toContain(holdExtended.bookingRequestId);
    expect(requestIds).toContain(prepayment.bookingRequestId);
    expect(requestIds).toContain(closed.bookingRequestId);
    expect(requestIds).not.toContain(otherSeller.bookingRequestId);

    const oneItem =
      context.services.sellerWorkQueueQueryService.readSellerWorkQueueItemByBookingRequestReference(
        {
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: holdExtended.bookingRequestId,
          },
        }
      );
    expect(oneItem).toMatchObject({
      queue_state: 'hold_extended_waiting',
      seller_reference: {
        reference_type: 'seller_user',
        seller_id: 1,
      },
      current_route_target: {
        route_target_type: 'seller',
      },
      requested_trip_slot_reference: {
        requested_trip_date: '2026-04-11',
        requested_time_slot: '12:00',
      },
      requested_seats_count: 2,
      requested_prepayment_amount: 1000,
      lifecycle_state: 'HOLD_ACTIVE',
      hold_state_summary: {
        hold_status: 'EXTENDED',
      },
    });

    const filtered =
      context.services.sellerWorkQueueQueryService.listSellerWorkQueueItemsByActiveHandlingState(
        {
          seller_reference: {
            reference_type: 'seller_user',
            seller_id: 1,
          },
          active_handling_state: 'hold_extended_waiting',
        }
      );

    expect(filtered.item_count).toBe(1);
    expect(filtered.items[0].booking_request_reference.booking_request_id).toBe(
      holdExtended.bookingRequestId
    );
    expect(Object.isFrozen(sellerQueue)).toBe(true);
    expect(Object.isFrozen(sellerQueue.items[0])).toBe(true);
    expect(Object.isFrozen(oneItem)).toBe(true);
  });

  it('records call_started and not_reached with strict idempotency and deterministic rejects', () => {
    const actionable = seedSellerRequest(context, { sellerId: 1, suffix: '2001' });
    const second = seedSellerRequest(context, { sellerId: 1, suffix: '2002' });

    const applied = context.services.sellerActionService.recordSellerAction({
      seller_reference: {
        reference_type: 'seller_user',
        seller_id: 1,
      },
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: actionable.bookingRequestId,
      },
      action_type: TELEGRAM_SELLER_ACTION_TYPES.call_started,
      idempotency_key: 'seller-action-2001',
    });
    const replay = context.services.sellerActionService.recordSellerAction({
      seller_reference: {
        reference_type: 'seller_user',
        seller_id: 1,
      },
      booking_request_reference: actionable.bookingRequestId,
      action_type: TELEGRAM_SELLER_ACTION_TYPES.call_started,
      idempotency_key: 'seller-action-2001',
    });

    expect(applied).toMatchObject({
      action_status: 'applied',
      action_type: TELEGRAM_SELLER_ACTION_TYPES.call_started,
      seller_reference: {
        seller_id: 1,
      },
      lifecycle_queue_state_summary: {
        lifecycle_state: 'CONTACT_IN_PROGRESS',
        queue_state: 'waiting_for_seller_contact',
      },
      idempotency_key: 'seller-action-2001',
      dedupe_key: 'seller-action-2001',
    });
    expect(replay.action_status).toBe('idempotent_replay');
    expect(replay.action_event_reference.booking_request_event_id).toBe(
      applied.action_event_reference.booking_request_event_id
    );

    expect(() =>
      context.services.sellerActionService.recordSellerAction({
        seller_reference: {
          reference_type: 'seller_user',
          seller_id: 1,
        },
        booking_request_reference: actionable.bookingRequestId,
        action_type: TELEGRAM_SELLER_ACTION_TYPES.not_reached,
        idempotency_key: 'seller-action-2001',
      })
    ).toThrow('Idempotency conflict');

    const notReached = context.services.sellerActionService.recordSellerAction({
      seller_reference: {
        reference_type: 'seller_user',
        seller_id: 1,
      },
      booking_request_reference: second.bookingRequestId,
      action_type: TELEGRAM_SELLER_ACTION_TYPES.not_reached,
      idempotency_key: 'seller-action-2002',
    });
    expect(notReached.lifecycle_queue_state_summary.queue_state).toBe('no_longer_actionable');

    expect(() =>
      context.services.sellerActionService.recordSellerAction({
        seller_reference: {
          reference_type: 'seller_user',
          seller_id: 2,
        },
        booking_request_reference: second.bookingRequestId,
        action_type: TELEGRAM_SELLER_ACTION_TYPES.call_started,
        idempotency_key: 'seller-action-wrong-seller',
      })
    ).toThrow('Wrong seller');

    const inactivePath = seedSellerRequest(context, { sellerId: 1, suffix: '2003' });
    setAttributionInactive(context, inactivePath.bookingRequestId);
    expect(() =>
      context.services.sellerActionService.recordSellerAction({
        seller_reference: {
          reference_type: 'seller_user',
          seller_id: 1,
        },
        booking_request_reference: inactivePath.bookingRequestId,
        action_type: TELEGRAM_SELLER_ACTION_TYPES.call_started,
        idempotency_key: 'seller-action-inactive',
      })
    ).toThrow('No active seller path');

    const alreadyClosed = seedSellerRequest(context, { sellerId: 1, suffix: '2004' });
    context.services.bookingRequestService.markSellerNotReached(alreadyClosed.bookingRequestId);
    expect(() =>
      context.services.sellerActionService.recordSellerAction({
        seller_reference: {
          reference_type: 'seller_user',
          seller_id: 1,
        },
        booking_request_reference: alreadyClosed.bookingRequestId,
        action_type: TELEGRAM_SELLER_ACTION_TYPES.call_started,
        idempotency_key: 'seller-action-closed',
      })
    ).toThrow('no longer actionable');

    expect(() =>
      context.services.sellerActionService.recordSellerAction({
        seller_reference: {
          reference_type: 'seller_user',
          seller_id: 1,
        },
        booking_request_reference: 9999,
        action_type: TELEGRAM_SELLER_ACTION_TYPES.call_started,
        idempotency_key: 'seller-action-missing',
      })
    ).toThrow('Invalid booking request reference');
  });

  it('projects seller request handling state with seller actions and handoff/linkage summary', () => {
    const newForSeller = seedSellerRequest(context, { sellerId: 1, suffix: '3001' });
    const contactInProgress = seedSellerRequest(context, { sellerId: 1, suffix: '3002' });
    const sellerNotReached = seedSellerRequest(context, { sellerId: 1, suffix: '3003' });
    const prepaymentConfirmed = seedSellerRequest(context, { sellerId: 1, suffix: '3004' });
    const handedOff = seedSellerRequest(context, { sellerId: 1, suffix: '3005' });
    const noLongerActionable = seedSellerRequest(context, { sellerId: 1, suffix: '3006' });

    context.services.sellerActionService.recordSellerAction({
      seller_reference: {
        reference_type: 'seller_user',
        seller_id: 1,
      },
      booking_request_reference: contactInProgress.bookingRequestId,
      action_type: TELEGRAM_SELLER_ACTION_TYPES.call_started,
      idempotency_key: 'seller-state-contact',
    });
    context.services.sellerActionService.recordSellerAction({
      seller_reference: {
        reference_type: 'seller_user',
        seller_id: 1,
      },
      booking_request_reference: sellerNotReached.bookingRequestId,
      action_type: TELEGRAM_SELLER_ACTION_TYPES.not_reached,
      idempotency_key: 'seller-state-not-reached',
    });
    context.services.bookingRequestService.confirmPrepayment(
      prepaymentConfirmed.bookingRequestId
    );
    context.services.bookingRequestService.confirmPrepayment(handedOff.bookingRequestId);
    const presaleId = db.prepare('INSERT INTO presales DEFAULT VALUES').run().lastInsertRowid;
    context.repositories.bookingRequests.updateById(handedOff.bookingRequestId, {
      request_status: 'CONFIRMED_TO_PRESALE',
      confirmed_presale_id: presaleId,
      last_status_at: '2026-04-10T10:05:00.000Z',
    });
    context.services.bookingRequestService.cancelRequestByGuest(
      noLongerActionable.bookingRequestId
    );

    const list =
      context.services.sellerRequestStateProjectionService.listSellerHandlingStatesForSeller(
        {
          seller_reference: {
            reference_type: 'seller_user',
            seller_id: 1,
          },
        }
      );
    const byRequestId = new Map(
      list.items.map((item) => [item.booking_request_reference.booking_request_id, item])
    );

    expect(byRequestId.get(newForSeller.bookingRequestId).current_seller_handling_state).toBe(
      'new_for_seller'
    );
    expect(
      byRequestId.get(contactInProgress.bookingRequestId).current_seller_handling_state
    ).toBe('contact_in_progress');
    expect(
      byRequestId.get(contactInProgress.bookingRequestId).last_seller_action.action_type
    ).toBe(TELEGRAM_SELLER_ACTION_TYPES.call_started);
    expect(
      byRequestId.get(sellerNotReached.bookingRequestId).current_seller_handling_state
    ).toBe('seller_not_reached');
    expect(
      byRequestId.get(prepaymentConfirmed.bookingRequestId).current_seller_handling_state
    ).toBe('prepayment_confirmed');
    expect(byRequestId.get(handedOff.bookingRequestId).current_seller_handling_state).toBe(
      'handed_off'
    );
    expect(
      byRequestId.get(handedOff.bookingRequestId).handoff_linkage_summary.created_presale_reference
    ).toMatchObject({
      reference_type: 'canonical_presale',
      presale_id: presaleId,
    });
    expect(
      byRequestId.get(noLongerActionable.bookingRequestId).current_seller_handling_state
    ).toBe('no_longer_actionable');

    const single =
      context.services.sellerRequestStateProjectionService.readCurrentSellerHandlingStateByBookingRequestReference(
        handedOff.bookingRequestId
      );
    expect(single.current_seller_handling_state).toBe('handed_off');
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list.items[0])).toBe(true);
    expect(Object.isFrozen(single)).toBe(true);
  });
});
