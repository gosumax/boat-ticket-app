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

function seedPreparedRequest(context, clock, suffix) {
  wireClock(context, clock);

  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-exec-${suffix}`,
    display_name: `Execution Guest ${suffix}`,
    username: `execution_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7998111${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-exec-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Execution ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-exec-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `execution-zone-${suffix}` },
    is_active: 1,
  });

  const attributionResult = services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    entry_channel: 'qr',
  });

  const lifecycleResult = services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id:
      attributionResult.sellerAttributionSession.seller_attribution_session_id,
    requested_trip_date: '2026-04-12',
    requested_time_slot: '14:00',
    requested_seats: 2,
    requested_ticket_mix: { adult: 2 },
    requested_prepayment_amount: 3200,
    currency: 'RUB',
    contact_phone_e164: `+7998111${suffix}`,
  });

  const confirmed = services.bookingRequestService.confirmPrepayment(
    lifecycleResult.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: `payment-${suffix}`,
    }
  );

  const prepared = services.presaleHandoffService.prepareHandoff(
    confirmed.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: `prepared-${suffix}`,
    }
  );

  return {
    bookingRequestId: confirmed.bookingRequest.booking_request_id,
    prepared,
  };
}

describe('telegram handoff execution state layer', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T10:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('marks a prepared request as queued and reads the current execution state separately', () => {
    const seeded = seedPreparedRequest(context, clock, '1001');

    const first = context.services.handoffExecutionService.markQueued({
      booking_request_reference: seeded.prepared.booking_request_reference,
      actor_type: 'system',
      actor_id: 'queue-worker',
      queue_reason: 'seller_ready_for_queue',
      queue_metadata: { lane: 'alpha' },
      idempotency_key: 'queue-1001',
    });
    const second = context.services.handoffExecutionService.markQueued({
      booking_request_reference: seeded.prepared.booking_request_reference,
      actor_type: 'system',
      actor_id: 'queue-worker',
      queue_reason: 'seller_ready_for_queue',
      queue_metadata: { lane: 'alpha' },
      idempotency_key: 'queue-1001',
    });
    const readback =
      context.services.handoffExecutionQueryService.readCurrentExecutionStateByBookingRequestReference(
        {
          booking_request_reference: seeded.prepared.booking_request_reference,
        }
      );

    expect(second).toEqual(first);
    expect(first.execution_state).toBe('queued_for_handoff');
    expect(first.execution_event_reference.event_type).toBe('HANDOFF_QUEUED');
    expect(first.latest_execution_timestamp_summary.iso).toBe('2026-04-10T10:00:00.000Z');
    expect(first.idempotency_key).toBe('queue-1001');
    expect(first.transition).toEqual({
      queue_reason: 'seller_ready_for_queue',
      queue_metadata: { lane: 'alpha' },
    });
    expect(readback.current_execution_state).toBe('queued_for_handoff');
    expect(readback.execution_history).toHaveLength(1);
    expect(readback.execution_history[0].execution_state).toBe('queued_for_handoff');
    expect(readback.execution_history[0].transition.queue_reason).toBe(
      'seller_ready_for_queue'
    );
    expect(readback.execution_history[0].execution_event_reference.booking_request_event_id).toBe(
      first.execution_event_reference.booking_request_event_id
    );
    expect(readback.snapshot_payload.metadata.production_presale_not_created).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(readback)).toBe(true);
    expect(Object.isFrozen(readback.execution_history)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });

  it('raises an idempotency conflict when the same queued state is retried with a different payload', () => {
    const seeded = seedPreparedRequest(context, clock, '1002');

    context.services.handoffExecutionService.markQueued({
      booking_request_reference: seeded.prepared.booking_request_reference,
      queue_reason: 'seller_ready_for_queue',
      queue_metadata: { lane: 'alpha' },
      idempotency_key: 'queue-1002',
    });

    expect(() =>
      context.services.handoffExecutionService.markQueued({
        booking_request_reference: seeded.prepared.booking_request_reference,
        queue_reason: 'different_reason',
        queue_metadata: { lane: 'beta' },
        idempotency_key: 'queue-1002',
      })
    ).toThrow('Idempotency conflict for queued_for_handoff');
  });

  it('persists started and blocked execution events and projects the ordered history', () => {
    const seeded = seedPreparedRequest(context, clock, '1003');

    context.services.handoffExecutionService.markQueued({
      booking_request_reference: seeded.prepared.booking_request_reference,
      queue_reason: 'ready',
    });
    clock.advanceMinutes(2);
    const started = context.services.handoffExecutionService.markStarted({
      booking_request_reference: seeded.prepared.booking_request_reference,
      actor_type: 'system',
      actor_id: 'starter-worker',
      start_reason: 'dispatching_to_presale_bridge',
      idempotency_key: 'start-1003',
    });
    clock.advanceMinutes(2);
    const blocked = context.services.handoffExecutionService.markBlocked({
      booking_request_reference: seeded.prepared.booking_request_reference,
      actor_type: 'system',
      actor_id: 'guard-worker',
      blocked_reason: 'slot_resolution_missing',
      retryable: true,
      block_metadata: { slot_uid: null },
      idempotency_key: 'block-1003',
    });
    const readback =
      context.services.handoffExecutionQueryService.readCurrentExecutionStateByBookingRequestReference(
        {
          booking_request_reference: seeded.prepared.booking_request_reference,
        }
      );

    expect(started.execution_state).toBe('handoff_started');
    expect(blocked.execution_state).toBe('handoff_blocked');
    expect(blocked.blocked_reason).toBe('slot_resolution_missing');
    expect(blocked.handoff_terminal).toBe(true);
    expect(readback.execution_history.map((item) => item.execution_state)).toEqual([
      'queued_for_handoff',
      'handoff_started',
      'handoff_blocked',
    ]);
    expect(readback.execution_history[2].blocked_reason).toBe('slot_resolution_missing');
    expect(readback.execution_history[2].transition).toMatchObject({
      blocked_reason: 'slot_resolution_missing',
      retryable: true,
      block_metadata: { slot_uid: null },
    });
  });

  it('marks a started handoff as consumed without creating presales or mutating booking status', () => {
    const seeded = seedPreparedRequest(context, clock, '1004');

    context.services.handoffExecutionService.markQueued({
      booking_request_reference: seeded.prepared.booking_request_reference,
      queue_reason: 'ready',
    });
    context.services.handoffExecutionService.markStarted({
      booking_request_reference: seeded.prepared.booking_request_reference,
      start_reason: 'handoff_runner_engaged',
    });

    const consumed = context.services.handoffExecutionService.markConsumed({
      booking_request_reference: seeded.prepared.booking_request_reference,
      actor_type: 'system',
      actor_id: 'consumer-worker',
      consume_reason: 'handoff_delivery_acknowledged',
      consume_metadata: { external_handoff_ref: 'dry-run-ref-1004' },
      idempotency_key: 'consume-1004',
    });
    const duplicate = context.services.handoffExecutionService.markConsumed({
      booking_request_reference: seeded.prepared.booking_request_reference,
      actor_type: 'system',
      actor_id: 'consumer-worker',
      consume_reason: 'handoff_delivery_acknowledged',
      consume_metadata: { external_handoff_ref: 'dry-run-ref-1004' },
      idempotency_key: 'consume-1004',
    });
    const readback =
      context.services.handoffExecutionQueryService.readCurrentExecutionStateByBookingRequestReference(
        {
          booking_request_reference: seeded.prepared.booking_request_reference,
        }
      );

    expect(duplicate).toEqual(consumed);
    expect(consumed.execution_state).toBe('handoff_consumed');
    expect(consumed.handoff_consumed).toBe(true);
    expect(consumed.handoff_terminal).toBe(true);
    expect(readback.execution_history.map((item) => item.execution_state)).toEqual([
      'queued_for_handoff',
      'handoff_started',
      'handoff_consumed',
    ]);
    expect(
      context.repositories.bookingRequests.getById(seeded.bookingRequestId).request_status
    ).toBe('PREPAYMENT_CONFIRMED');
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });

  it('projects handoff_prepared as the baseline current execution state before any execution event exists', () => {
    const seeded = seedPreparedRequest(context, clock, '1005');

    const readback =
      context.services.handoffExecutionQueryService.readCurrentExecutionStateByBookingRequestReference(
        {
          booking_request_reference: seeded.prepared.booking_request_reference,
        }
      );

    expect(readback.current_execution_state).toBe('handoff_prepared');
    expect(readback.execution_history).toEqual([]);
    expect(readback.handoff_snapshot_reference.reference_type).toBe('telegram_handoff_snapshot');
  });

  it('rejects execution transitions for requests that are not handoff-prepared', () => {
    wireClock(context, clock);

    const { repositories, services } = context;
    const guest = repositories.guestProfiles.create({
      telegram_user_id: 'tg-exec-unprepared',
      display_name: 'Execution Unprepared',
      username: 'execution_unprepared',
      language_code: 'ru',
      phone_e164: '+79982223344',
      consent_status: 'granted',
      profile_status: 'active',
    });
    const source = repositories.trafficSources.create({
      source_code: 'seller-exec-unprepared',
      source_type: 'seller_qr',
      source_name: 'Seller Execution Unprepared',
      default_seller_id: 1,
      is_active: 1,
    });
    const qr = repositories.sourceQRCodes.create({
      qr_token: 'seller-exec-unprepared-token',
      traffic_source_id: source.traffic_source_id,
      seller_id: 1,
      entry_context: { zone: 'execution-zone-unprepared' },
      is_active: 1,
    });
    const attributionResult = services.attributionService.registerGuestEntryFromSource({
      guest_profile_id: guest.guest_profile_id,
      traffic_source_id: source.traffic_source_id,
      source_qr_code_id: qr.source_qr_code_id,
      entry_channel: 'qr',
    });
    const lifecycleResult = services.bookingRequestService.createBookingRequest({
      guest_profile_id: guest.guest_profile_id,
      seller_attribution_session_id:
        attributionResult.sellerAttributionSession.seller_attribution_session_id,
      requested_trip_date: '2026-04-12',
      requested_time_slot: '16:00',
      requested_seats: 1,
      requested_ticket_mix: { adult: 1 },
      requested_prepayment_amount: 1500,
      currency: 'RUB',
      contact_phone_e164: '+79982223344',
    });
    const confirmed = services.bookingRequestService.confirmPrepayment(
      lifecycleResult.bookingRequest.booking_request_id,
      {
        actorType: 'system',
        actorId: 'payment-unprepared',
      }
    );

    expect(() =>
      context.services.handoffExecutionService.markQueued({
        booking_request_reference: {
          reference_type: 'telegram_booking_request',
          booking_request_id: confirmed.bookingRequest.booking_request_id,
          guest_profile_id: confirmed.bookingRequest.guest_profile_id,
          seller_attribution_session_id:
            confirmed.bookingRequest.seller_attribution_session_id,
        },
      })
    ).toThrow('not handoff-prepared');
  });

  it('rejects invalid transition order deterministically', () => {
    const seeded = seedPreparedRequest(context, clock, '1006');

    expect(() =>
      context.services.handoffExecutionService.markStarted({
        booking_request_reference: seeded.prepared.booking_request_reference,
      })
    ).toThrow('Invalid transition from handoff_prepared to handoff_started');
  });
});
