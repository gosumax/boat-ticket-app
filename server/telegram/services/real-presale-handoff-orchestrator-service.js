import { createHash } from 'node:crypto';
import {
  buildTelegramBridgeReason,
  buildTelegramCanonicalPresaleReference,
  buildTelegramRealPresaleBridgeExecutionResult,
  freezeTelegramHandoffValue,
  TELEGRAM_REAL_PRESALE_BRIDGE_EXECUTION_STATUSES,
  TELEGRAM_REAL_PRESALE_HANDOFF_ATTEMPT_EVENT_TYPE,
  TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATOR_NAME,
  TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATOR_VERSION,
  TELEGRAM_REAL_PRESALE_HANDOFF_RESULT_EVENT_TYPES,
} from '../../../shared/telegram/index.js';

const DEFAULT_ADAPTER_EXECUTION_MODE = 'real_presale_bridge_execution_service';

function normalizeNullableString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeRequestInput({
  slotUid = null,
  paymentMethod = null,
  cashAmount = null,
  cardAmount = null,
} = {}) {
  return freezeTelegramHandoffValue({
    slotUid: normalizeNullableString(slotUid),
    paymentMethod: paymentMethod ? String(paymentMethod).trim().toUpperCase() : null,
    cashAmount: normalizeNullableNumber(cashAmount),
    cardAmount: normalizeNullableNumber(cardAmount),
  });
}

function buildIdempotencyKey(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function resultOutcomeForStatus(status) {
  if (status === 'presale_created') {
    return 'success';
  }
  if (status === 'bridge_blocked') {
    return 'blocked';
  }
  if (status === 'bridge_failed') {
    return 'failure';
  }

  return null;
}

function resultEventTypeForStatus(status) {
  const resultOutcome = resultOutcomeForStatus(status);
  return resultOutcome ? TELEGRAM_REAL_PRESALE_HANDOFF_RESULT_EVENT_TYPES[resultOutcome] : null;
}

function legacyBridgeStatusFromOutcome(outcome) {
  if (outcome === 'success') {
    return 'presale_created';
  }
  if (outcome === 'blocked') {
    return 'bridge_blocked';
  }
  if (outcome === 'failure') {
    return 'bridge_failed';
  }

  return null;
}

function defaultLegacyCode(outcome) {
  if (outcome === 'success') {
    return 'PRESALE_CREATED';
  }
  if (outcome === 'blocked') {
    return 'BRIDGE_BLOCKED';
  }
  if (outcome === 'failure') {
    return 'BRIDGE_FAILED';
  }

  return 'BRIDGE_FAILED';
}

function defaultLegacyMessage(outcome) {
  if (outcome === 'success') {
    return 'Real presale bridge completed successfully';
  }
  if (outcome === 'blocked') {
    return 'Real presale bridge was blocked';
  }
  if (outcome === 'failure') {
    return 'Real presale bridge failed';
  }

  return 'Real presale bridge failed';
}

function buildFailureExecutionResult({
  bookingRequestReference,
  handoffSnapshotReference,
  executionTimestampIso,
  code,
  message,
} = {}) {
  return buildTelegramRealPresaleBridgeExecutionResult({
    bookingRequestReference,
    handoffSnapshotReference,
    bridgeExecutionStatus: 'bridge_failed',
    bridgeExecutionCode: code,
    bridgeExecutionMessage: message,
    failureReason: buildTelegramBridgeReason({
      code,
      message,
    }),
    executionTimestampIso,
  });
}

function normalizeLegacyAdapterResult(rawResult) {
  if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
    return null;
  }

  const outcome = rawResult.outcome ?? rawResult.result_outcome ?? null;
  if (!outcome) {
    return null;
  }

  return freezeTelegramHandoffValue({
    adapter_name: rawResult.adapter_name ?? rawResult.adapterName ?? null,
    adapter_version: rawResult.adapter_version ?? rawResult.adapterVersion ?? null,
    outcome,
    outcome_code: rawResult.outcome_code ?? rawResult.outcomeCode ?? null,
    message: rawResult.message ?? null,
    adapter_reference:
      rawResult.adapter_reference ??
      rawResult.adapterReference ??
      rawResult.external_handoff_ref ??
      null,
    confirmed_presale_id:
      rawResult.confirmed_presale_id ?? rawResult.confirmedPresaleId ?? null,
    payload: rawResult.payload ?? rawResult.details ?? null,
    no_op: rawResult.no_op ?? null,
  });
}

function normalizeBridgeExecutionResult(rawResult, context = {}) {
  if (
    rawResult?.bridge_execution_status &&
    TELEGRAM_REAL_PRESALE_BRIDGE_EXECUTION_STATUSES.includes(
      rawResult.bridge_execution_status
    )
  ) {
    return rawResult;
  }

  if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
    return buildFailureExecutionResult({
      bookingRequestReference: context.bookingRequestReference,
      handoffSnapshotReference: context.handoffSnapshotReference,
      executionTimestampIso: context.executionTimestampIso,
      code: 'INVALID_BRIDGE_EXECUTION_RESULT',
      message: 'Real presale bridge executor returned an invalid result envelope',
    });
  }

  const outcome = rawResult.outcome ?? rawResult.result_outcome ?? null;
  const bridgeExecutionStatus = legacyBridgeStatusFromOutcome(outcome);
  if (!bridgeExecutionStatus) {
    return buildFailureExecutionResult({
      bookingRequestReference: context.bookingRequestReference,
      handoffSnapshotReference: context.handoffSnapshotReference,
      executionTimestampIso: context.executionTimestampIso,
      code: 'INVALID_BRIDGE_EXECUTION_OUTCOME',
      message: 'Real presale bridge executor returned an unsupported outcome',
    });
  }

  const bridgeExecutionCode =
    rawResult.bridge_execution_code ??
    rawResult.outcome_code ??
    rawResult.outcomeCode ??
    defaultLegacyCode(outcome);
  const bridgeExecutionMessage =
    rawResult.bridge_execution_message ??
    rawResult.message ??
    defaultLegacyMessage(outcome);
  const adapterResult =
    rawResult.adapter_result ?? normalizeLegacyAdapterResult(rawResult);
  const createdPresaleReference = buildTelegramCanonicalPresaleReference(
    rawResult.created_presale_reference?.presale_id ??
      rawResult.confirmed_presale_id ??
      rawResult.confirmedPresaleId ??
      null
  );

  return buildTelegramRealPresaleBridgeExecutionResult({
    bookingRequestReference: context.bookingRequestReference,
    handoffSnapshotReference: context.handoffSnapshotReference,
    bridgeExecutionStatus,
    bridgeExecutionCode,
    bridgeExecutionMessage,
    createdPresaleReference,
    blockedReason:
      bridgeExecutionStatus === 'bridge_blocked'
        ? buildTelegramBridgeReason({
            code: bridgeExecutionCode,
            message: bridgeExecutionMessage,
            details: adapterResult?.payload || null,
          })
        : null,
    failureReason:
      bridgeExecutionStatus === 'bridge_failed'
        ? buildTelegramBridgeReason({
            code: bridgeExecutionCode,
            message: bridgeExecutionMessage,
            details: adapterResult?.payload || null,
          })
        : null,
    executionTimestampIso: context.executionTimestampIso,
    guardDecision: rawResult.guard_decision ?? null,
    bridgeInput: rawResult.bridge_input ?? null,
    adapterResult,
  });
}

function blockMetadataFromResult(result) {
  return freezeTelegramHandoffValue({
    orchestration_status: result?.bridge_execution_status || null,
    bridge_execution_code: result?.bridge_execution_code || null,
    created_presale_reference: result?.created_presale_reference || null,
  });
}

export class TelegramRealPresaleHandoffOrchestratorService {
  constructor({
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    handoffReadinessQueryService,
    handoffExecutionService,
    handoffExecutionQueryService,
    handoffEligibilityProjectionService,
    bridgeAdapterDryRunContractService,
    realPresaleHandoffOrchestrationQueryService,
    executeRealPresaleHandoff = null,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.handoffReadinessQueryService = handoffReadinessQueryService;
    this.handoffExecutionService = handoffExecutionService;
    this.handoffExecutionQueryService = handoffExecutionQueryService;
    this.handoffEligibilityProjectionService = handoffEligibilityProjectionService;
    this.bridgeAdapterDryRunContractService = bridgeAdapterDryRunContractService;
    this.realPresaleHandoffOrchestrationQueryService =
      realPresaleHandoffOrchestrationQueryService;
    this.executeRealPresaleHandoff = executeRealPresaleHandoff;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'real-presale-handoff-orchestrator-service',
      status: 'lifecycle_ready',
      dependencyKeys: [
        'bookingRequests',
        'bookingHolds',
        'bookingRequestEvents',
        'handoffReadinessQueryService',
        'handoffExecutionService',
        'handoffExecutionQueryService',
        'handoffEligibilityProjectionService',
        'bridgeAdapterDryRunContractService',
        'realPresaleHandoffOrchestrationQueryService',
      ],
    });
  }

  nowIso() {
    return this.now().toISOString();
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      throw new Error(
        `[TELEGRAM_REAL_PRESALE_HANDOFF] Booking request not found: ${bookingRequestId}`
      );
    }

    return bookingRequest;
  }

  appendEvent({
    bookingRequest,
    eventType,
    actorType,
    actorId,
    eventPayload,
  }) {
    const bookingHold = this.bookingHolds.findOneBy({
      booking_request_id: bookingRequest.booking_request_id,
    });

    return this.bookingRequestEvents.create({
      booking_request_id: bookingRequest.booking_request_id,
      booking_hold_id: bookingHold?.booking_hold_id || null,
      seller_attribution_session_id: bookingRequest.seller_attribution_session_id,
      event_type: eventType,
      event_at: this.nowIso(),
      actor_type: actorType,
      actor_id: actorId,
      event_payload: freezeTelegramHandoffValue(eventPayload),
    });
  }

  readExecutionState(bookingRequestId) {
    return this.handoffExecutionQueryService.readExecutionState({
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: bookingRequestId,
      },
    });
  }

  getLatestRun(readback) {
    return readback?.orchestration_history?.length > 0
      ? readback.orchestration_history[readback.orchestration_history.length - 1]
      : null;
  }

  resolveExistingRun(bookingRequestId, idempotencyKey, currentReadback) {
    const latestRun = this.getLatestRun(currentReadback);
    if (!latestRun) {
      return {
        completedReadback: null,
        attemptEventId: null,
        latestRun: null,
      };
    }

    if (latestRun.idempotency_key !== idempotencyKey) {
      throw new Error(
        `[TELEGRAM_REAL_PRESALE_HANDOFF] Idempotency conflict for booking request: ${bookingRequestId}`
      );
    }

    return {
      completedReadback: latestRun.result_event_id ? currentReadback : null,
      attemptEventId: latestRun.attempt_event_id || null,
      latestRun,
    };
  }

  ensureQueued({
    bookingRequestReference,
    actorType,
    actorId,
    idempotencyKey,
  }) {
    const bookingRequestId = bookingRequestReference.booking_request_id;
    const currentExecutionState = this.readExecutionState(bookingRequestId);
    if (currentExecutionState.current_execution_state !== 'handoff_prepared') {
      return currentExecutionState;
    }

    this.handoffExecutionService.markQueued({
      booking_request_reference: bookingRequestReference,
      actor_type: actorType,
      actor_id: actorId,
      queue_reason: 'real_presale_bridge_orchestration',
      queue_metadata: {
        orchestration_idempotency_key: idempotencyKey,
      },
      idempotency_key: `${idempotencyKey}:queued`,
    });

    return this.readExecutionState(bookingRequestId);
  }

  ensureStarted({
    bookingRequestReference,
    actorType,
    actorId,
    idempotencyKey,
  }) {
    const bookingRequestId = bookingRequestReference.booking_request_id;
    const currentExecutionState = this.readExecutionState(bookingRequestId);
    if (currentExecutionState.current_execution_state !== 'queued_for_handoff') {
      return currentExecutionState;
    }

    this.handoffExecutionService.markStarted({
      booking_request_reference: bookingRequestReference,
      actor_type: actorType,
      actor_id: actorId,
      start_reason: 'real_presale_bridge_execution',
      start_metadata: {
        orchestration_idempotency_key: idempotencyKey,
      },
      idempotency_key: `${idempotencyKey}:started`,
    });

    return this.readExecutionState(bookingRequestId);
  }

  markBlockedIfPossible({
    bookingRequestReference,
    actorType,
    actorId,
    idempotencyKey,
    result,
  }) {
    const bookingRequestId = bookingRequestReference.booking_request_id;
    const currentExecutionState = this.readExecutionState(bookingRequestId);
    if (
      currentExecutionState.current_execution_state !== 'queued_for_handoff' &&
      currentExecutionState.current_execution_state !== 'handoff_started'
    ) {
      return currentExecutionState;
    }

    this.handoffExecutionService.markBlocked({
      booking_request_reference: bookingRequestReference,
      actor_type: actorType,
      actor_id: actorId,
      blocked_reason:
        result?.blocked_reason?.code ||
        result?.failure_reason?.code ||
        result?.bridge_execution_code ||
        'bridge_blocked',
      retryable: false,
      block_metadata: blockMetadataFromResult(result),
      idempotency_key: `${idempotencyKey}:blocked`,
    });

    return this.readExecutionState(bookingRequestId);
  }

  markConsumedIfPossible({
    bookingRequestReference,
    actorType,
    actorId,
    idempotencyKey,
    result,
  }) {
    const bookingRequestId = bookingRequestReference.booking_request_id;
    const currentExecutionState = this.readExecutionState(bookingRequestId);
    if (currentExecutionState.current_execution_state !== 'handoff_started') {
      return currentExecutionState;
    }

    this.handoffExecutionService.markConsumed({
      booking_request_reference: bookingRequestReference,
      actor_type: actorType,
      actor_id: actorId,
      consume_reason: 'real_presale_bridge_consumed',
      consume_metadata: {
        orchestration_idempotency_key: idempotencyKey,
        created_presale_reference: result?.created_presale_reference || null,
      },
      idempotency_key: `${idempotencyKey}:consumed`,
    });

    return this.readExecutionState(bookingRequestId);
  }

  buildAttemptPayload({
    executionSnapshot,
    requestInput,
    eligibilityRecord,
    dryRunContractResult,
    idempotencyKey,
  }) {
    return freezeTelegramHandoffValue({
      orchestrator_name: TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATOR_NAME,
      orchestrator_version: TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATOR_VERSION,
      idempotency_key: idempotencyKey,
      booking_request_reference: executionSnapshot.booking_request_reference,
      handoff_snapshot_reference: executionSnapshot.handoff_snapshot_reference,
      handoff_prepared_event_id: executionSnapshot.handoff_prepared_event_id,
      current_execution_state: executionSnapshot.current_execution_state,
      request_input: requestInput,
      eligibility_record: eligibilityRecord,
      dry_run_contract_result: dryRunContractResult,
      adapter_execution_mode: DEFAULT_ADAPTER_EXECUTION_MODE,
      adapter_executor_configured: typeof this.executeRealPresaleHandoff === 'function',
    });
  }

  buildResultPayload({
    attemptEventId,
    executionSnapshot,
    result,
    adapterInvoked,
  }) {
    return freezeTelegramHandoffValue({
      orchestrator_name: TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATOR_NAME,
      orchestrator_version: TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATOR_VERSION,
      booking_request_reference: executionSnapshot.booking_request_reference,
      handoff_snapshot_reference: executionSnapshot.handoff_snapshot_reference,
      attempt_event_id: attemptEventId,
      idempotency_key:
        result?.adapter_result?.idempotency_key ??
        result?.guard_decision?.idempotency_key ??
        null,
      handoff_prepared_event_id: executionSnapshot.handoff_prepared_event_id,
      current_execution_state: executionSnapshot.current_execution_state,
      result_outcome: resultOutcomeForStatus(result.bridge_execution_status),
      outcome_code: result.bridge_execution_code,
      message: result.bridge_execution_message,
      adapter_invoked: adapterInvoked,
      guard_decision: result.guard_decision || null,
      bridge_input: result.bridge_input || null,
      adapter_result: result.adapter_result || null,
      bridge_execution_result: result,
    });
  }

  executeBridge({
    bookingRequestId,
    requestInput,
    executionSnapshot,
    eligibilityRecord,
    dryRunContractResult,
  }) {
    if (typeof this.executeRealPresaleHandoff !== 'function') {
      return buildFailureExecutionResult({
        bookingRequestReference: executionSnapshot.booking_request_reference,
        handoffSnapshotReference: executionSnapshot.handoff_snapshot_reference,
        executionTimestampIso: this.nowIso(),
        code: 'BRIDGE_EXECUTOR_NOT_CONFIGURED',
        message:
          'No real presale bridge execution service is configured for orchestration',
      });
    }

    try {
      const rawResult = this.executeRealPresaleHandoff({
        bookingRequestId,
        bookingRequestReference: executionSnapshot.booking_request_reference,
        handoffSnapshotReference: executionSnapshot.handoff_snapshot_reference,
        executionSnapshot,
        eligibilityRecord,
        dryRunContractResult,
        requestInput,
      });

      if (rawResult && typeof rawResult.then === 'function') {
        return buildFailureExecutionResult({
          bookingRequestReference: executionSnapshot.booking_request_reference,
          handoffSnapshotReference: executionSnapshot.handoff_snapshot_reference,
          executionTimestampIso: this.nowIso(),
          code: 'ASYNC_BRIDGE_EXECUTION_UNSUPPORTED',
          message:
            'Real presale bridge executor must return a synchronous result envelope',
        });
      }

      return normalizeBridgeExecutionResult(rawResult, {
        bookingRequestReference: executionSnapshot.booking_request_reference,
        handoffSnapshotReference: executionSnapshot.handoff_snapshot_reference,
        executionTimestampIso: this.nowIso(),
      });
    } catch (error) {
      return buildFailureExecutionResult({
        bookingRequestReference: executionSnapshot.booking_request_reference,
        handoffSnapshotReference: executionSnapshot.handoff_snapshot_reference,
        executionTimestampIso: this.nowIso(),
        code: error?.code || 'BRIDGE_EXECUTION_THROWN',
        message:
          error?.message ||
          'Real presale bridge executor threw during orchestration',
      });
    }
  }

  buildBlockedEligibilityResult(executionSnapshot, eligibilityRecord) {
    return buildTelegramRealPresaleBridgeExecutionResult({
      bookingRequestReference: executionSnapshot.booking_request_reference,
      handoffSnapshotReference: executionSnapshot.handoff_snapshot_reference,
      bridgeExecutionStatus: 'bridge_blocked',
      bridgeExecutionCode: eligibilityRecord?.eligibility_state || 'bridge_blocked',
      bridgeExecutionMessage:
        eligibilityRecord?.eligibility_reason ||
        'Booking request is no longer eligible_for_bridge at orchestration time',
      blockedReason: buildTelegramBridgeReason({
        code: eligibilityRecord?.eligibility_state || 'bridge_blocked',
        message:
          eligibilityRecord?.eligibility_reason ||
          'Booking request is no longer eligible_for_bridge at orchestration time',
      }),
      executionTimestampIso: this.nowIso(),
    });
  }

  orchestrate(
    bookingRequestId,
    {
      actorType = 'system',
      actorId = null,
      slotUid = null,
      paymentMethod = null,
      cashAmount = null,
      cardAmount = null,
    } = {}
  ) {
    const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
    const preparedReadiness = this.handoffReadinessQueryService.readPreparedRequest({
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: bookingRequestId,
      },
    });
    const requestInput = normalizeRequestInput({
      slotUid,
      paymentMethod,
      cashAmount,
      cardAmount,
    });
    const idempotencyKey = buildIdempotencyKey({
      orchestrator_name: TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATOR_NAME,
      orchestrator_version: TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATOR_VERSION,
      booking_request_id: preparedReadiness.booking_request_reference.booking_request_id,
      handoff_prepared_event_id:
        preparedReadiness.handoff_snapshot_reference?.handoff_prepared_event_id || null,
      request_input: requestInput,
    });
    const currentReadback =
      this.realPresaleHandoffOrchestrationQueryService.readOrchestrationState(
        bookingRequestId
      );
    const existingRun = this.resolveExistingRun(
      bookingRequestId,
      idempotencyKey,
      currentReadback
    );

    if (existingRun.completedReadback) {
      return existingRun.completedReadback;
    }

    let executionSnapshot = this.ensureQueued({
      bookingRequestReference: preparedReadiness.booking_request_reference,
      actorType,
      actorId,
      idempotencyKey,
    });
    const eligibilityRecord =
      existingRun.latestRun?.eligibility_record ||
      this.handoffEligibilityProjectionService.readHandoffEligibilityByBookingRequestReference(
        bookingRequestId
      );
    const dryRunContractResult =
      existingRun.latestRun?.dry_run_contract_result ||
      this.bridgeAdapterDryRunContractService.readDryRunContract(
        executionSnapshot.snapshot_payload
      );

    const attemptEventId =
      existingRun.attemptEventId ||
      this.appendEvent({
        bookingRequest,
        eventType: TELEGRAM_REAL_PRESALE_HANDOFF_ATTEMPT_EVENT_TYPE,
        actorType,
        actorId,
        eventPayload: this.buildAttemptPayload({
          executionSnapshot,
          requestInput,
          eligibilityRecord,
          dryRunContractResult,
          idempotencyKey,
        }),
      }).booking_request_event_id;

    let bridgeExecutionResult = null;
    let adapterInvoked = false;

    if (
      eligibilityRecord.eligibility_state === 'blocked_for_bridge' ||
      eligibilityRecord.eligibility_state === 'already_consumed' ||
      eligibilityRecord.eligibility_state === 'not_ready'
    ) {
      bridgeExecutionResult = this.buildBlockedEligibilityResult(
        executionSnapshot,
        eligibilityRecord
      );
      executionSnapshot = this.markBlockedIfPossible({
        bookingRequestReference: preparedReadiness.booking_request_reference,
        actorType,
        actorId,
        idempotencyKey,
        result: bridgeExecutionResult,
      });
    } else {
      executionSnapshot = this.ensureStarted({
        bookingRequestReference: preparedReadiness.booking_request_reference,
        actorType,
        actorId,
        idempotencyKey,
      });
      adapterInvoked = true;
      bridgeExecutionResult = this.executeBridge({
        bookingRequestId,
        requestInput,
        executionSnapshot,
        eligibilityRecord,
        dryRunContractResult,
      });

      if (bridgeExecutionResult.bridge_execution_status === 'presale_created') {
        executionSnapshot = this.markConsumedIfPossible({
          bookingRequestReference: preparedReadiness.booking_request_reference,
          actorType,
          actorId,
          idempotencyKey,
          result: bridgeExecutionResult,
        });
      } else {
        executionSnapshot = this.markBlockedIfPossible({
          bookingRequestReference: preparedReadiness.booking_request_reference,
          actorType,
          actorId,
          idempotencyKey,
          result: bridgeExecutionResult,
        });
      }
    }

    const resultEventType = resultEventTypeForStatus(
      bridgeExecutionResult.bridge_execution_status
    );
    this.appendEvent({
      bookingRequest,
      eventType: resultEventType,
      actorType,
      actorId,
      eventPayload: {
        ...this.buildResultPayload({
          attemptEventId,
          executionSnapshot,
          result: bridgeExecutionResult,
          adapterInvoked,
        }),
        idempotency_key: idempotencyKey,
      },
    });

    return this.realPresaleHandoffOrchestrationQueryService.readOrchestrationState(
      bookingRequestId
    );
  }
}
