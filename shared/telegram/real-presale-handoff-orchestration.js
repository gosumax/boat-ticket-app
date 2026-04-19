import {
  buildTelegramHandoffTimestampSummary,
  freezeTelegramHandoffValue,
} from './handoff-readiness.js';
import {
  buildTelegramCanonicalPresaleReference,
  buildTelegramBridgeReason,
  buildTelegramRealPresaleBridgeExecutionResult,
} from './real-presale-bridge-execution.js';

export const TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATOR_NAME =
  'telegram-real-presale-handoff-orchestrator';
export const TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATOR_VERSION =
  'telegram_real_presale_handoff_orchestrator_v1';
export const TELEGRAM_REAL_PRESALE_HANDOFF_READBACK_VERSION =
  'telegram_real_presale_handoff_orchestration_readback.v2';
export const TELEGRAM_REAL_PRESALE_HANDOFF_ATTEMPT_EVENT_TYPE =
  'REAL_PRESALE_HANDOFF_ATTEMPTED';
export const TELEGRAM_REAL_PRESALE_HANDOFF_RESULT_OUTCOMES = Object.freeze([
  'success',
  'blocked',
  'failure',
]);
export const TELEGRAM_REAL_PRESALE_HANDOFF_RESULT_EVENT_TYPES = Object.freeze({
  success: 'REAL_PRESALE_HANDOFF_SUCCEEDED',
  blocked: 'REAL_PRESALE_HANDOFF_BLOCKED',
  failure: 'REAL_PRESALE_HANDOFF_FAILED',
});
export const TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATION_EVENT_TYPES = Object.freeze([
  TELEGRAM_REAL_PRESALE_HANDOFF_ATTEMPT_EVENT_TYPE,
  ...Object.values(TELEGRAM_REAL_PRESALE_HANDOFF_RESULT_EVENT_TYPES),
]);

const TELEGRAM_REAL_PRESALE_HANDOFF_RESULT_EVENT_TYPE_TO_OUTCOME = Object.freeze(
  Object.fromEntries(
    Object.entries(TELEGRAM_REAL_PRESALE_HANDOFF_RESULT_EVENT_TYPES).map(
      ([outcome, eventType]) => [eventType, outcome]
    )
  )
);

function latestTimestampIso(...values) {
  const timestamps = values
    .map((value) => value?.iso ?? value ?? null)
    .filter(Boolean)
    .map((iso) => ({ iso, parsed: Date.parse(iso) }))
    .filter((candidate) => !Number.isNaN(candidate.parsed))
    .sort((left, right) => right.parsed - left.parsed);

  return timestamps[0]?.iso || null;
}

function getClassification(classification = null) {
  return freezeTelegramHandoffValue({
    hard_blockers: classification?.hard_blockers || [],
    manual_escalations: classification?.manual_escalations || [],
    soft_warnings: classification?.soft_warnings || [],
  });
}

function mapOutcomeToOrchestrationStatus(outcome) {
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

function mapGuardDecisionToEligibilityState(guardDecision = null) {
  if (guardDecision?.decision === 'eligible') {
    return 'eligible_for_bridge';
  }
  if (guardDecision?.decision === 'blocked') {
    return 'blocked_for_bridge';
  }
  if (guardDecision?.decision === 'manual_escalation_required') {
    return 'manual_review_required';
  }

  return null;
}

function normalizeLegacyBridgeExecutionResult({
  bookingRequestReference = null,
  handoffSnapshotReference = null,
  resultOutcome = null,
  outcomeCode = null,
  message = null,
  adapterResult = null,
  resultAt = null,
} = {}) {
  if (!resultOutcome && !adapterResult) {
    return null;
  }

  if (
    adapterResult?.bridge_execution_status === 'presale_created' ||
    adapterResult?.bridge_execution_status === 'bridge_blocked' ||
    adapterResult?.bridge_execution_status === 'bridge_failed'
  ) {
    return adapterResult;
  }

  const createdPresaleReference = buildTelegramCanonicalPresaleReference(
    adapterResult?.confirmed_presale_id ?? null
  );
  const blockedReason =
    resultOutcome === 'blocked'
      ? buildTelegramBridgeReason({
          code: outcomeCode || adapterResult?.outcome_code || null,
          message: message || adapterResult?.message || null,
        })
      : null;
  const failureReason =
    resultOutcome === 'failure'
      ? buildTelegramBridgeReason({
          code: outcomeCode || adapterResult?.outcome_code || null,
          message: message || adapterResult?.message || null,
        })
      : null;

  return buildTelegramRealPresaleBridgeExecutionResult({
    bookingRequestReference,
    handoffSnapshotReference,
    bridgeExecutionStatus: mapOutcomeToOrchestrationStatus(
      resultOutcome ?? adapterResult?.outcome ?? null
    ),
    bridgeExecutionCode:
      outcomeCode || adapterResult?.outcome_code || adapterResult?.outcomeCode || null,
    bridgeExecutionMessage: message || adapterResult?.message || null,
    createdPresaleReference,
    blockedReason,
    failureReason,
    executionTimestampIso: resultAt,
    guardDecision: adapterResult?.guard_decision || null,
    bridgeInput: adapterResult?.bridge_input || null,
    adapterResult,
  });
}

export function getTelegramRealPresaleHandoffOutcomeForEventType(eventType) {
  return TELEGRAM_REAL_PRESALE_HANDOFF_RESULT_EVENT_TYPE_TO_OUTCOME[eventType] || null;
}

export function summarizeTelegramRealPresaleHandoffGuardDecision(guardDecision = null) {
  return freezeTelegramHandoffValue({
    decision: guardDecision?.decision ?? null,
    decision_code: guardDecision?.decision_code ?? null,
    message: guardDecision?.message ?? null,
    future_real_bridge_eligible: Boolean(guardDecision?.future_real_bridge_eligible),
    booking_request_id:
      guardDecision?.booking_request_id ??
      guardDecision?.execution_snapshot?.booking_request_id ??
      null,
    handoff_prepared_event_id:
      guardDecision?.handoff_prepared_event_id ??
      guardDecision?.execution_snapshot?.handoff_prepared_event_id ??
      null,
    current_execution_state:
      guardDecision?.current_execution_state ??
      guardDecision?.execution_snapshot?.current_execution_state ??
      null,
    classification: getClassification(guardDecision?.classification),
  });
}

export function buildTelegramRealPresaleHandoffAttemptRecord(event) {
  const eventPayload = event?.event_payload || {};

  return freezeTelegramHandoffValue({
    booking_request_event_id: event.booking_request_event_id,
    booking_request_id: event.booking_request_id,
    event_type: event.event_type,
    attempt_at: event.event_at,
    actor_type: event.actor_type,
    actor_id: event.actor_id,
    idempotency_key: eventPayload.idempotency_key ?? null,
    handoff_prepared_event_id: eventPayload.handoff_prepared_event_id ?? null,
    current_execution_state: eventPayload.current_execution_state ?? null,
    request_input: eventPayload.request_input ?? null,
    eligibility_record: eventPayload.eligibility_record ?? null,
    dry_run_contract_result: eventPayload.dry_run_contract_result ?? null,
    guard_decision: eventPayload.guard_decision ?? null,
    bridge_input: eventPayload.bridge_input ?? null,
    adapter_execution_mode: eventPayload.adapter_execution_mode ?? null,
    adapter_executor_configured: Boolean(eventPayload.adapter_executor_configured),
  });
}

export function buildTelegramRealPresaleHandoffResultRecord(event) {
  const eventPayload = event?.event_payload || {};
  const outcome =
    eventPayload.result_outcome ||
    getTelegramRealPresaleHandoffOutcomeForEventType(event?.event_type);

  if (!outcome) {
    throw new Error(
      `[TELEGRAM_REAL_PRESALE_HANDOFF] Unknown orchestration result event type: ${
        event?.event_type || 'unknown'
      }`
    );
  }

  const bookingRequestReference =
    eventPayload.booking_request_reference ||
    eventPayload.bridge_execution_result?.booking_request_reference ||
    null;
  const handoffSnapshotReference =
    eventPayload.handoff_snapshot_reference ||
    eventPayload.bridge_execution_result?.handoff_snapshot_reference ||
    null;
  const bridgeExecutionResult =
    eventPayload.bridge_execution_result ||
    normalizeLegacyBridgeExecutionResult({
      bookingRequestReference,
      handoffSnapshotReference,
      resultOutcome: outcome,
      outcomeCode: eventPayload.outcome_code ?? null,
      message: eventPayload.message ?? null,
      adapterResult: eventPayload.adapter_result ?? null,
      resultAt: event.event_at,
    });

  return freezeTelegramHandoffValue({
    booking_request_event_id: event.booking_request_event_id,
    booking_request_id: event.booking_request_id,
    event_type: event.event_type,
    result_at: event.event_at,
    actor_type: event.actor_type,
    actor_id: event.actor_id,
    attempt_event_id: eventPayload.attempt_event_id ?? null,
    idempotency_key: eventPayload.idempotency_key ?? null,
    handoff_prepared_event_id: eventPayload.handoff_prepared_event_id ?? null,
    current_execution_state: eventPayload.current_execution_state ?? null,
    result_outcome: outcome,
    outcome_code: eventPayload.outcome_code ?? null,
    message: eventPayload.message ?? null,
    adapter_invoked: Boolean(eventPayload.adapter_invoked),
    booking_request_reference: bookingRequestReference,
    handoff_snapshot_reference: handoffSnapshotReference,
    bridge_execution_result: bridgeExecutionResult,
    guard_decision:
      eventPayload.guard_decision ??
      bridgeExecutionResult?.guard_decision ??
      null,
    bridge_input:
      eventPayload.bridge_input ??
      bridgeExecutionResult?.bridge_input ??
      null,
    adapter_result:
      eventPayload.adapter_result ??
      bridgeExecutionResult?.adapter_result ??
      null,
  });
}

export function buildTelegramRealPresaleHandoffRunRecord({
  attemptRecord,
  resultRecord = null,
} = {}) {
  if (!attemptRecord) {
    throw new Error(
      '[TELEGRAM_REAL_PRESALE_HANDOFF] Attempt record is required to build an orchestration run'
    );
  }

  const bridgeExecutionResult = resultRecord?.bridge_execution_result || null;
  const effectiveEligibilityState =
    mapGuardDecisionToEligibilityState(bridgeExecutionResult?.guard_decision) ??
    attemptRecord.eligibility_record?.eligibility_state ??
    null;
  const latestTimestampSummary = buildTelegramHandoffTimestampSummary(
    latestTimestampIso(resultRecord?.result_at, attemptRecord.attempt_at)
  );

  return freezeTelegramHandoffValue({
    attempt_event_id: attemptRecord.booking_request_event_id,
    result_event_id: resultRecord?.booking_request_event_id ?? null,
    booking_request_id: attemptRecord.booking_request_id,
    idempotency_key: attemptRecord.idempotency_key,
    handoff_prepared_event_id: attemptRecord.handoff_prepared_event_id,
    current_execution_state:
      resultRecord?.current_execution_state ?? attemptRecord.current_execution_state,
    attempt_at: attemptRecord.attempt_at,
    result_at: resultRecord?.result_at ?? null,
    actor_type: attemptRecord.actor_type,
    actor_id: attemptRecord.actor_id,
    request_input: attemptRecord.request_input,
    eligibility_state: effectiveEligibilityState,
    eligibility_record: attemptRecord.eligibility_record,
    dry_run_contract_result: attemptRecord.dry_run_contract_result,
    orchestration_status:
      bridgeExecutionResult?.bridge_execution_status ??
      mapOutcomeToOrchestrationStatus(resultRecord?.result_outcome),
    bridge_execution_result: bridgeExecutionResult,
    created_presale_reference:
      bridgeExecutionResult?.created_presale_reference ?? null,
    blocked_reason: bridgeExecutionResult?.blocked_reason ?? null,
    failure_reason: bridgeExecutionResult?.failure_reason ?? null,
    latest_timestamp_summary: latestTimestampSummary,
    guard_decision:
      resultRecord?.guard_decision ?? attemptRecord.guard_decision ?? null,
    bridge_input: resultRecord?.bridge_input ?? attemptRecord.bridge_input ?? null,
    adapter_execution_mode: attemptRecord.adapter_execution_mode,
    adapter_executor_configured: attemptRecord.adapter_executor_configured,
    result_outcome: resultRecord?.result_outcome ?? null,
    outcome_code: resultRecord?.outcome_code ?? null,
    message: resultRecord?.message ?? null,
    adapter_invoked: resultRecord?.adapter_invoked ?? false,
    adapter_result: resultRecord?.adapter_result ?? null,
  });
}

export function buildTelegramRealPresaleHandoffReadback({
  executionSnapshot,
  orchestrationHistory = [],
} = {}) {
  const frozenHistory = freezeTelegramHandoffValue(orchestrationHistory || []);
  const latestRun =
    frozenHistory.length > 0 ? frozenHistory[frozenHistory.length - 1] : null;
  const latestTimestampSummary = buildTelegramHandoffTimestampSummary(
    latestTimestampIso(
      latestRun?.latest_timestamp_summary,
      executionSnapshot?.latest_execution_timestamp_summary,
      latestRun?.result_at,
      latestRun?.attempt_at,
      executionSnapshot?.last_transition_at
    )
  );

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_REAL_PRESALE_HANDOFF_READBACK_VERSION,
    booking_request_reference: executionSnapshot?.booking_request_reference || null,
    handoff_snapshot_reference: executionSnapshot?.handoff_snapshot_reference || null,
    orchestration_status: latestRun?.orchestration_status ?? null,
    eligibility_state: latestRun?.eligibility_state ?? null,
    execution_state: executionSnapshot?.current_execution_state ?? null,
    created_presale_reference: latestRun?.created_presale_reference ?? null,
    blocked_reason: latestRun?.blocked_reason ?? null,
    failure_reason: latestRun?.failure_reason ?? null,
    latest_timestamp_summary: latestTimestampSummary,
    booking_request_id: executionSnapshot.booking_request_id,
    guest_profile_id: executionSnapshot.guest_profile_id,
    seller_attribution_session_id: executionSnapshot.seller_attribution_session_id,
    request_status: executionSnapshot.request_status,
    handoff_prepared_event_id: executionSnapshot.handoff_prepared_event_id,
    current_execution_state: executionSnapshot.current_execution_state,
    last_transition_at: executionSnapshot.last_transition_at,
    last_transition_event_id: executionSnapshot.last_transition_event_id,
    orchestration_attempt_count: frozenHistory.length,
    current_orchestration_outcome: latestRun?.result_outcome ?? null,
    last_attempt_at: latestRun?.attempt_at ?? null,
    last_result_at: latestRun?.result_at ?? null,
    last_attempt_event_id: latestRun?.attempt_event_id ?? null,
    last_result_event_id: latestRun?.result_event_id ?? null,
    latest_run: latestRun,
    orchestration_history: frozenHistory,
  });
}
