import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import {
  buildTelegramBridgeReason,
  buildTelegramCanonicalPresaleReference,
  buildTelegramRealPresaleBridgeExecutionResult,
} from '../../shared/telegram/index.js';

function listRealOrchestrationEvents(context, bookingRequestId) {
  return context.repositories.bookingRequestEvents
    .listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 100 }
    )
    .filter((event) => event.event_type.startsWith('REAL_PRESALE_HANDOFF_'));
}

function seedBookingRequest(
  context,
  seedData,
  suffix,
  {
    queue = false,
    start = false,
    consume = false,
    requestedSeats = 2,
    requestedTicketMix = { adult: 1, child: 1 },
    requestedPrepaymentAmount = 1500,
  } = {}
) {
  const { repositories, services } = context;
  const sellerId = seedData.users.sellerA.id;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-real-orchestrator-${suffix}`,
    display_name: `Real Orchestrator Guest ${suffix}`,
    username: `real_orchestrator_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7997666${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-real-orchestrator-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Real Orchestrator ${suffix}`,
    default_seller_id: sellerId,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-real-orchestrator-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: { zone: `real-orchestrator-zone-${suffix}` },
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
    requested_trip_date: seedData.slots.generated.tomorrow,
    requested_time_slot: '12:00',
    requested_seats: requestedSeats,
    requested_ticket_mix: requestedTicketMix,
    requested_prepayment_amount: requestedPrepaymentAmount,
    currency: 'RUB',
    contact_phone_e164: `+7997666${suffix}`,
  });

  const confirmed = services.bookingRequestService.confirmPrepayment(
    lifecycleResult.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: `payment-${suffix}`,
    }
  );

  services.presaleHandoffService.prepareHandoff(confirmed.bookingRequest.booking_request_id, {
    actorType: 'system',
    actorId: `prepared-${suffix}`,
  });

  if (queue) {
    services.handoffExecutionService.markQueued({
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: confirmed.bookingRequest.booking_request_id,
      },
      actor_type: 'system',
      actor_id: `queue-${suffix}`,
      queue_reason: 'real_bridge_orchestrator_test',
      idempotency_key: `queue-${suffix}`,
    });
  }

  if (start) {
    services.handoffExecutionService.markStarted({
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: confirmed.bookingRequest.booking_request_id,
      },
      actor_type: 'system',
      actor_id: `start-${suffix}`,
      start_reason: 'real_bridge_orchestrator_test',
      idempotency_key: `start-${suffix}`,
    });
  }

  if (consume) {
    services.handoffExecutionService.markConsumed({
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: confirmed.bookingRequest.booking_request_id,
      },
      actor_type: 'system',
      actor_id: `consume-${suffix}`,
      consume_reason: 'real_bridge_orchestrator_test',
      idempotency_key: `consume-${suffix}`,
    });
  }

  return {
    bookingRequestId: confirmed.bookingRequest.booking_request_id,
  };
}

function setPreparedSnapshot(context, bookingRequestId, mutateSnapshot) {
  const preparedEvent = context.repositories.bookingRequestEvents.findOneBy(
    {
      booking_request_id: bookingRequestId,
      event_type: 'HANDOFF_PREPARED',
    },
    { orderBy: 'booking_request_event_id DESC' }
  );
  const baseSnapshot =
    preparedEvent.event_payload.handoff_snapshot ?? preparedEvent.event_payload.payload;
  const nextSnapshot = mutateSnapshot(baseSnapshot);

  context.repositories.bookingRequestEvents.updateById(
    preparedEvent.booking_request_event_id,
    {
      event_payload: {
        ...preparedEvent.event_payload,
        handoff_snapshot: nextSnapshot,
        payload: nextSnapshot,
      },
    }
  );
}

function markPreparedSnapshotSlotResolved(context, bookingRequestId, slotUid) {
  setPreparedSnapshot(context, bookingRequestId, (snapshot) => ({
    ...snapshot,
    trip: {
      ...snapshot.trip,
      slot_uid: slotUid,
      slot_resolution_required: false,
    },
  }));
}

function buildSuccessResult(payload, presaleId) {
  return buildTelegramRealPresaleBridgeExecutionResult({
    bookingRequestReference: payload.bookingRequestReference,
    handoffSnapshotReference: payload.handoffSnapshotReference,
    bridgeExecutionStatus: 'presale_created',
    bridgeExecutionCode: 'PRESALE_CREATED',
    bridgeExecutionMessage: 'Injected bridge success result',
    createdPresaleReference: buildTelegramCanonicalPresaleReference(presaleId),
    executionTimestampIso: '2026-04-14T10:00:00.000Z',
    guardDecision: {
      decision: 'eligible',
      decision_code: 'ELIGIBLE_FOR_FUTURE_REAL_BRIDGE',
      message: 'Execution remained eligible at bridge time',
    },
    adapterResult: {
      outcome: 'success',
      confirmed_presale_id: presaleId,
    },
  });
}

function buildBlockedResult(payload, code, message) {
  return buildTelegramRealPresaleBridgeExecutionResult({
    bookingRequestReference: payload.bookingRequestReference,
    handoffSnapshotReference: payload.handoffSnapshotReference,
    bridgeExecutionStatus: 'bridge_blocked',
    bridgeExecutionCode: code,
    bridgeExecutionMessage: message,
    blockedReason: buildTelegramBridgeReason({
      code,
      message,
    }),
    executionTimestampIso: '2026-04-14T10:00:00.000Z',
    guardDecision: {
      decision: 'eligible',
      decision_code: 'ELIGIBLE_FOR_FUTURE_REAL_BRIDGE',
      message: 'Execution remained eligible before a downstream domain block',
    },
    adapterResult: {
      outcome: 'blocked',
      outcome_code: code,
      message,
    },
  });
}

function buildFailureResult(payload, code, message) {
  return buildTelegramRealPresaleBridgeExecutionResult({
    bookingRequestReference: payload.bookingRequestReference,
    handoffSnapshotReference: payload.handoffSnapshotReference,
    bridgeExecutionStatus: 'bridge_failed',
    bridgeExecutionCode: code,
    bridgeExecutionMessage: message,
    failureReason: buildTelegramBridgeReason({
      code,
      message,
    }),
    executionTimestampIso: '2026-04-14T10:00:00.000Z',
    guardDecision: {
      decision: 'eligible',
      decision_code: 'ELIGIBLE_FOR_FUTURE_REAL_BRIDGE',
      message: 'Execution remained eligible before a downstream failure',
    },
    adapterResult: {
      outcome: 'failure',
      outcome_code: code,
      message,
    },
  });
}

describe('telegram real presale handoff orchestrator service', () => {
  let db;
  let seedData;
  let createTelegramPersistenceContext;

  beforeEach(async () => {
    vi.resetModules();
    resetTestDb();

    const dbModule = await import('../../server/db.js');
    db = dbModule.default;
    seedData = await seedBasicData(db);
    ({ createTelegramPersistenceContext } = await import('../../server/telegram/index.js'));
  });

  it('queues, starts, consumes, and replays an idempotent successful bridge run', () => {
    const executor = vi.fn((payload) => buildSuccessResult(payload, 9101));
    const context = createTelegramPersistenceContext(db, {
      executeRealPresaleHandoff: executor,
    });
    const seeded = seedBookingRequest(context, seedData, '7001');
    const slotUid = `generated:${seedData.slots.generated.genSlot2}`;

    markPreparedSnapshotSlotResolved(context, seeded.bookingRequestId, slotUid);

    const first =
      context.services.realPresaleHandoffOrchestratorService.orchestrate(
        seeded.bookingRequestId,
        {
          actorType: 'system',
          actorId: 'real-bridge-orchestrator',
          slotUid,
          paymentMethod: 'CARD',
        }
      );
    const second =
      context.services.realPresaleHandoffOrchestratorService.orchestrate(
        seeded.bookingRequestId,
        {
          actorType: 'system',
          actorId: 'real-bridge-orchestrator',
          slotUid,
          paymentMethod: 'CARD',
        }
      );

    expect(executor).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first.orchestration_status).toBe('presale_created');
    expect(first.current_orchestration_outcome).toBe('success');
    expect(first.eligibility_state).toBe('eligible_for_bridge');
    expect(first.execution_state).toBe('handoff_consumed');
    expect(first.created_presale_reference).toEqual(
      buildTelegramCanonicalPresaleReference(9101)
    );
    expect(first.latest_run.adapter_invoked).toBe(true);
    expect(first.latest_run.dry_run_contract_result.adapter_status).toBe('dry_run_valid');
    expect(first.latest_run.request_input).toEqual({
      slotUid,
      paymentMethod: 'CARD',
      cashAmount: null,
      cardAmount: null,
    });
    expect(
      context.services.handoffExecutionQueryService.readExecutionState(
        seeded.bookingRequestId
      ).current_execution_state
    ).toBe('handoff_consumed');
    expect(listRealOrchestrationEvents(context, seeded.bookingRequestId).map((event) => event.event_type)).toEqual([
      'REAL_PRESALE_HANDOFF_ATTEMPTED',
      'REAL_PRESALE_HANDOFF_SUCCEEDED',
    ]);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('returns bridge_blocked without invoking the bridge executor when the handoff was already consumed', () => {
    const executor = vi.fn();
    const context = createTelegramPersistenceContext(db, {
      executeRealPresaleHandoff: executor,
    });
    const seeded = seedBookingRequest(context, seedData, '7002', {
      queue: true,
      start: true,
      consume: true,
    });
    const slotUid = `generated:${seedData.slots.generated.genSlot2}`;

    markPreparedSnapshotSlotResolved(context, seeded.bookingRequestId, slotUid);

    const result =
      context.services.realPresaleHandoffOrchestratorService.orchestrate(
        seeded.bookingRequestId,
        {
          actorType: 'system',
          actorId: 'real-bridge-orchestrator',
          slotUid,
          paymentMethod: 'CARD',
        }
      );

    expect(executor).not.toHaveBeenCalled();
    expect(result.orchestration_status).toBe('bridge_blocked');
    expect(result.current_orchestration_outcome).toBe('blocked');
    expect(result.eligibility_state).toBe('already_consumed');
    expect(result.execution_state).toBe('handoff_consumed');
    expect(result.blocked_reason).toMatchObject({
      code: 'already_consumed',
    });
    expect(result.latest_run.adapter_invoked).toBe(false);
    expect(listRealOrchestrationEvents(context, seeded.bookingRequestId).map((event) => event.event_type)).toEqual([
      'REAL_PRESALE_HANDOFF_ATTEMPTED',
      'REAL_PRESALE_HANDOFF_BLOCKED',
    ]);
  });

  it('marks the handoff blocked when the bridge executor returns a blocked result', () => {
    const executor = vi.fn((payload) =>
      buildBlockedResult(payload, 'CAPACITY_EXCEEDED', 'Injected blocked bridge result')
    );
    const context = createTelegramPersistenceContext(db, {
      executeRealPresaleHandoff: executor,
    });
    const seeded = seedBookingRequest(context, seedData, '7003');
    const slotUid = `generated:${seedData.slots.generated.genSlot2}`;

    markPreparedSnapshotSlotResolved(context, seeded.bookingRequestId, slotUid);

    const result =
      context.services.realPresaleHandoffOrchestratorService.orchestrate(
        seeded.bookingRequestId,
        {
          actorType: 'system',
          actorId: 'real-bridge-orchestrator',
          slotUid,
          paymentMethod: 'CARD',
        }
      );

    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.orchestration_status).toBe('bridge_blocked');
    expect(result.current_orchestration_outcome).toBe('blocked');
    expect(result.eligibility_state).toBe('eligible_for_bridge');
    expect(result.execution_state).toBe('handoff_blocked');
    expect(result.blocked_reason).toMatchObject({
      code: 'CAPACITY_EXCEEDED',
      message: 'Injected blocked bridge result',
    });
    expect(result.latest_run.adapter_invoked).toBe(true);
    expect(
      context.services.handoffExecutionQueryService.readExecutionState(
        seeded.bookingRequestId
      ).current_execution_state
    ).toBe('handoff_blocked');
    expect(listRealOrchestrationEvents(context, seeded.bookingRequestId).map((event) => event.event_type)).toEqual([
      'REAL_PRESALE_HANDOFF_ATTEMPTED',
      'REAL_PRESALE_HANDOFF_BLOCKED',
    ]);
  });

  it('marks the handoff blocked but keeps a bridge_failed orchestration outcome on executor failure', () => {
    const executor = vi.fn((payload) =>
      buildFailureResult(
        payload,
        'BRIDGE_EXECUTION_THROWN_TEST',
        'Injected bridge failure result'
      )
    );
    const context = createTelegramPersistenceContext(db, {
      executeRealPresaleHandoff: executor,
    });
    const seeded = seedBookingRequest(context, seedData, '7004');
    const slotUid = `generated:${seedData.slots.generated.genSlot2}`;

    markPreparedSnapshotSlotResolved(context, seeded.bookingRequestId, slotUid);

    const result =
      context.services.realPresaleHandoffOrchestratorService.orchestrate(
        seeded.bookingRequestId,
        {
          actorType: 'system',
          actorId: 'real-bridge-orchestrator',
          slotUid,
          paymentMethod: 'CARD',
        }
      );

    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.orchestration_status).toBe('bridge_failed');
    expect(result.current_orchestration_outcome).toBe('failure');
    expect(result.eligibility_state).toBe('eligible_for_bridge');
    expect(result.execution_state).toBe('handoff_blocked');
    expect(result.failure_reason).toMatchObject({
      code: 'BRIDGE_EXECUTION_THROWN_TEST',
      message: 'Injected bridge failure result',
    });
    expect(result.latest_run.adapter_invoked).toBe(true);
    expect(listRealOrchestrationEvents(context, seeded.bookingRequestId).map((event) => event.event_type)).toEqual([
      'REAL_PRESALE_HANDOFF_ATTEMPTED',
      'REAL_PRESALE_HANDOFF_FAILED',
    ]);
  });

  it('raises a deterministic idempotency conflict when the same request is retried with different input', () => {
    const executor = vi.fn((payload) => buildSuccessResult(payload, 9105));
    const context = createTelegramPersistenceContext(db, {
      executeRealPresaleHandoff: executor,
    });
    const seeded = seedBookingRequest(context, seedData, '7005');
    const firstSlotUid = `generated:${seedData.slots.generated.genSlot2}`;
    const secondSlotUid = `generated:${seedData.slots.generated.genSlot1}`;

    markPreparedSnapshotSlotResolved(context, seeded.bookingRequestId, firstSlotUid);

    context.services.realPresaleHandoffOrchestratorService.orchestrate(
      seeded.bookingRequestId,
      {
        actorType: 'system',
        actorId: 'real-bridge-orchestrator',
        slotUid: firstSlotUid,
        paymentMethod: 'CARD',
      }
    );

    expect(() =>
      context.services.realPresaleHandoffOrchestratorService.orchestrate(
        seeded.bookingRequestId,
        {
          actorType: 'system',
          actorId: 'real-bridge-orchestrator',
          slotUid: secondSlotUid,
          paymentMethod: 'CARD',
        }
      )
    ).toThrow('Idempotency conflict');
    expect(executor).toHaveBeenCalledTimes(1);
  });
});
