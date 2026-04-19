import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';
import {
  buildTelegramBridgeReason,
  buildTelegramCanonicalPresaleReference,
  buildTelegramRealPresaleBridgeExecutionResult,
} from '../../shared/telegram/index.js';

function createGuestIdentity(context, seedData, suffix) {
  const { repositories, services } = context;
  const sellerId = seedData.users.sellerA.id;
  const telegramUserId = `tg-bridge-linkage-${suffix}`;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: telegramUserId,
    display_name: `Bridge Linkage Guest ${suffix}`,
    username: `bridge_linkage_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7997777${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-bridge-linkage-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Bridge Linkage ${suffix}`,
    default_seller_id: sellerId,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-bridge-linkage-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: { zone: `bridge-linkage-zone-${suffix}` },
    is_active: 1,
  });

  const attributionResult = services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    entry_channel: 'qr',
  });

  return {
    guestProfileId: guest.guest_profile_id,
    sellerAttributionSessionId:
      attributionResult.sellerAttributionSession.seller_attribution_session_id,
    telegramUserId,
  };
}

function createPreparedBookingRequest(
  context,
  seedData,
  identity,
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
  const { services } = context;

  const lifecycleResult = services.bookingRequestService.createBookingRequest({
    guest_profile_id: identity.guestProfileId,
    seller_attribution_session_id: identity.sellerAttributionSessionId,
    requested_trip_date: seedData.slots.generated.tomorrow,
    requested_time_slot: '12:00',
    requested_seats: requestedSeats,
    requested_ticket_mix: requestedTicketMix,
    requested_prepayment_amount: requestedPrepaymentAmount,
    currency: 'RUB',
    contact_phone_e164: `+7997777${suffix}`,
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
      queue_reason: 'bridge_linkage_test',
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
      start_reason: 'bridge_linkage_test',
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
      consume_reason: 'bridge_linkage_test',
      idempotency_key: `consume-${suffix}`,
    });
  }

  return {
    bookingRequestId: confirmed.bookingRequest.booking_request_id,
  };
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
    executionTimestampIso: '2099-01-01T00:00:00.000Z',
    guardDecision: {
      decision: 'eligible',
      decision_code: 'ELIGIBLE_FOR_FUTURE_REAL_BRIDGE',
      message: 'Execution remained eligible before a downstream block',
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
    executionTimestampIso: '2099-01-01T00:05:00.000Z',
    guardDecision: {
      decision: 'eligible',
      decision_code: 'ELIGIBLE_FOR_FUTURE_REAL_BRIDGE',
      message: 'Execution remained eligible before a downstream failure',
    },
  });
}

describe('telegram bridge linkage projection service', () => {
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

  it('reads bridged_to_presale linkage and lists bridged Telegram requests after a successful orchestration', () => {
    const context = createTelegramPersistenceContext(db);
    const identity = createGuestIdentity(context, seedData, '8001');
    const seeded = createPreparedBookingRequest(context, seedData, identity, '8001');
    const slotUid = `generated:${seedData.slots.generated.genSlot2}`;

    const orchestration =
      context.services.realPresaleHandoffOrchestratorService.orchestrate(
        seeded.bookingRequestId,
        {
          actorType: 'system',
          actorId: 'bridge-linkage-reader',
          slotUid,
          paymentMethod: 'CARD',
        }
      );
    const current =
      context.services.bridgeLinkageProjectionService.readCurrentBridgeLinkageByBookingRequestReference(
        seeded.bookingRequestId
      );
    const list =
      context.services.bridgeLinkageProjectionService.listBridgedTelegramRequests();

    expect(current.bridge_linkage_state).toBe('bridged_to_presale');
    expect(current.lifecycle_state).toBe('prepayment_confirmed');
    expect(current.handoff_readiness_state).toBe('ready_for_handoff');
    expect(current.execution_state).toBe('handoff_consumed');
    expect(current.created_presale_reference).toEqual(
      buildTelegramCanonicalPresaleReference(
        orchestration.created_presale_reference.presale_id
      )
    );
    expect(list.item_count).toBe(1);
    expect(list.items[0]).toEqual(current);
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(list)).toBe(true);
  });

  it('projects not_bridged and already_consumed deterministically from current execution state', () => {
    const context = createTelegramPersistenceContext(db);
    const notBridgedIdentity = createGuestIdentity(context, seedData, '8002');
    const alreadyConsumedIdentity = createGuestIdentity(context, seedData, '8003');
    const notBridged = createPreparedBookingRequest(
      context,
      seedData,
      notBridgedIdentity,
      '8002'
    );
    const alreadyConsumed = createPreparedBookingRequest(
      context,
      seedData,
      alreadyConsumedIdentity,
      '8003',
      {
        queue: true,
        start: true,
        consume: true,
      }
    );

    const currentNotBridged =
      context.services.bridgeLinkageProjectionService.readCurrentBridgeLinkageByBookingRequestReference(
        notBridged.bookingRequestId
      );
    const currentAlreadyConsumed =
      context.services.bridgeLinkageProjectionService.readCurrentBridgeLinkageByBookingRequestReference(
        alreadyConsumed.bookingRequestId
      );

    expect(currentNotBridged.bridge_linkage_state).toBe('not_bridged');
    expect(currentNotBridged.execution_state).toBe('handoff_prepared');
    expect(currentNotBridged.created_presale_reference).toBeNull();
    expect(currentAlreadyConsumed.bridge_linkage_state).toBe('already_consumed');
    expect(currentAlreadyConsumed.execution_state).toBe('handoff_consumed');
    expect(currentAlreadyConsumed.created_presale_reference).toBeNull();
  });

  it('projects bridge_blocked and returns the latest blocked outcome for a Telegram guest', () => {
    const blockedExecutor = vi.fn((payload) =>
      buildBlockedResult(payload, 'CAPACITY_EXCEEDED', 'Injected blocked bridge result')
    );
    const context = createTelegramPersistenceContext(db, {
      executeRealPresaleHandoff: blockedExecutor,
    });
    const identity = createGuestIdentity(context, seedData, '8004');
    const blockedRequest = createPreparedBookingRequest(
      context,
      seedData,
      identity,
      '8004'
    );

    context.services.realPresaleHandoffOrchestratorService.orchestrate(
      blockedRequest.bookingRequestId,
      {
        actorType: 'system',
        actorId: 'bridge-linkage-reader',
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        paymentMethod: 'CARD',
      }
    );

    const current =
      context.services.bridgeLinkageProjectionService.readCurrentBridgeLinkageByBookingRequestReference(
        blockedRequest.bookingRequestId
      );
    const latest =
      context.services.bridgeLinkageProjectionService.readLatestBridgeOutcomeForTelegramGuest(
        {
          telegram_user_id: identity.telegramUserId,
        }
      );

    expect(blockedExecutor).toHaveBeenCalledTimes(1);
    expect(current.bridge_linkage_state).toBe('bridge_blocked');
    expect(current.execution_state).toBe('handoff_blocked');
    expect(current.created_presale_reference).toBeNull();
    expect(latest.booking_request_reference.booking_request_id).toBe(
      blockedRequest.bookingRequestId
    );
    expect(latest.bridge_linkage_state).toBe('bridge_blocked');
  });

  it('projects bridge_failed when orchestration recorded a failed bridge outcome', () => {
    const failureExecutor = vi.fn((payload) =>
      buildFailureResult(
        payload,
        'BRIDGE_EXECUTION_THROWN_TEST',
        'Injected bridge failure result'
      )
    );
    const context = createTelegramPersistenceContext(db, {
      executeRealPresaleHandoff: failureExecutor,
    });
    const identity = createGuestIdentity(context, seedData, '8005');
    const failedRequest = createPreparedBookingRequest(
      context,
      seedData,
      identity,
      '8005'
    );

    context.services.realPresaleHandoffOrchestratorService.orchestrate(
      failedRequest.bookingRequestId,
      {
        actorType: 'system',
        actorId: 'bridge-linkage-reader',
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        paymentMethod: 'CARD',
      }
    );

    const current =
      context.services.bridgeLinkageProjectionService.readCurrentBridgeLinkageByBookingRequestReference(
        failedRequest.bookingRequestId
      );

    expect(failureExecutor).toHaveBeenCalledTimes(1);
    expect(current.bridge_linkage_state).toBe('bridge_failed');
    expect(current.execution_state).toBe('handoff_blocked');
    expect(current.created_presale_reference).toBeNull();
  });
});
