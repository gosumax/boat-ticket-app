import {
  buildTelegramBookingRequestEventReference,
  buildTelegramHandoffTimestampSummary,
  freezeTelegramHandoffValue,
} from './handoff-readiness.js';

export const TELEGRAM_HANDOFF_EXECUTION_RESULT_VERSION =
  'telegram_handoff_execution_state_result.v1';
export const TELEGRAM_HANDOFF_EXECUTION_STATES = Object.freeze([
  'queued_for_handoff',
  'handoff_started',
  'handoff_blocked',
  'handoff_consumed',
]);

export const TELEGRAM_HANDOFF_EXECUTION_EVENT_TYPES = Object.freeze({
  queued_for_handoff: 'HANDOFF_QUEUED',
  handoff_started: 'HANDOFF_STARTED',
  handoff_blocked: 'HANDOFF_BLOCKED',
  handoff_consumed: 'HANDOFF_CONSUMED',
});

const TELEGRAM_HANDOFF_EXECUTION_EVENT_TYPE_TO_STATE = Object.freeze(
  Object.fromEntries(
    Object.entries(TELEGRAM_HANDOFF_EXECUTION_EVENT_TYPES).map(
      ([state, eventType]) => [eventType, state]
    )
  )
);

const TELEGRAM_HANDOFF_EXECUTION_TERMINAL_STATES = Object.freeze([
  'handoff_blocked',
  'handoff_consumed',
]);

export function getTelegramHandoffExecutionStateForEventType(eventType) {
  return TELEGRAM_HANDOFF_EXECUTION_EVENT_TYPE_TO_STATE[eventType] || null;
}

export function isTelegramHandoffExecutionTerminalState(executionState) {
  return TELEGRAM_HANDOFF_EXECUTION_TERMINAL_STATES.includes(executionState);
}

function resolveBlockedReason(event) {
  return (
    event?.event_payload?.blocked_reason ??
    event?.event_payload?.transition?.blocked_reason ??
    event?.event_payload?.transition?.block_reason ??
    null
  );
}

export function buildTelegramHandoffExecutionHistoryRecord(event) {
  const executionState =
    event?.event_payload?.execution_state ||
    getTelegramHandoffExecutionStateForEventType(event?.event_type);

  if (!executionState) {
    throw new Error(
      `[TELEGRAM_HANDOFF_EXECUTION] Unknown execution event type: ${
        event?.event_type || 'unknown'
      }`
    );
  }

  const executionEventReference = buildTelegramBookingRequestEventReference(event);

  return freezeTelegramHandoffValue({
    booking_request_reference: event?.event_payload?.booking_request_reference || null,
    handoff_snapshot_reference:
      event?.event_payload?.handoff_snapshot_reference || null,
    execution_state: executionState,
    execution_event_reference: executionEventReference,
    blocked_reason: resolveBlockedReason(event),
    latest_execution_timestamp_summary: buildTelegramHandoffTimestampSummary(
      event?.event_at || null
    ),
    dedupe_key: event?.event_payload?.dedupe_key ?? null,
    idempotency_key: event?.event_payload?.idempotency_key ?? null,
    booking_request_event_id: executionEventReference?.booking_request_event_id ?? null,
    booking_request_id: event?.booking_request_id ?? null,
    event_type: event?.event_type ?? null,
    transition_at: event?.event_at ?? null,
    actor_type: event?.actor_type ?? null,
    actor_id: event?.actor_id ?? null,
    prepared_event_id:
      event?.event_payload?.handoff_snapshot_reference?.handoff_prepared_event_id ??
      event?.event_payload?.prepared_event_id ??
      null,
    prior_execution_state: event?.event_payload?.prior_execution_state ?? null,
    transition: event?.event_payload?.transition || null,
  });
}

export function buildTelegramHandoffExecutionReadback({
  readinessRecord,
  executionHistory,
} = {}) {
  const frozenExecutionHistory = freezeTelegramHandoffValue(executionHistory || []);
  const latestTransition =
    frozenExecutionHistory.length > 0
      ? frozenExecutionHistory[frozenExecutionHistory.length - 1]
      : null;
  const executionState = latestTransition?.execution_state || 'handoff_prepared';
  const latestExecutionTimestampSummary =
    latestTransition?.latest_execution_timestamp_summary ||
    readinessRecord?.latest_readiness_timestamp_summary ||
    null;
  const latestExecutionIso = latestExecutionTimestampSummary?.iso || null;

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_HANDOFF_EXECUTION_RESULT_VERSION,
    booking_request_reference: readinessRecord?.booking_request_reference || null,
    handoff_snapshot_reference:
      readinessRecord?.handoff_snapshot_reference || null,
    execution_state: executionState,
    execution_event_reference: latestTransition?.execution_event_reference || null,
    blocked_reason: latestTransition?.blocked_reason || null,
    latest_execution_timestamp_summary: latestExecutionTimestampSummary,
    dedupe_key:
      latestTransition?.dedupe_key ??
      readinessRecord?.handoff_snapshot_reference?.dedupe_key ??
      null,
    idempotency_key:
      latestTransition?.idempotency_key ??
      readinessRecord?.handoff_snapshot_reference?.idempotency_key ??
      null,
    handoff_prepared: Boolean(readinessRecord?.handoff_prepared),
    handoff_readiness_state: readinessRecord?.handoff_readiness_state || null,
    handoff_snapshot: readinessRecord?.handoff_snapshot || null,
    execution_history: frozenExecutionHistory,
    booking_request_id:
      readinessRecord?.booking_request_reference?.booking_request_id ?? null,
    guest_profile_id:
      readinessRecord?.booking_request_reference?.guest_profile_id ?? null,
    seller_attribution_session_id:
      readinessRecord?.booking_request_reference?.seller_attribution_session_id ??
      null,
    request_status: readinessRecord?.request_status ?? null,
    handoff_ready_state: readinessRecord?.handoff_state ?? null,
    prepared_at: readinessRecord?.prepared_at ?? null,
    handoff_prepared_event_id:
      readinessRecord?.handoff_prepared_event_id ??
      readinessRecord?.handoff_snapshot_reference?.handoff_prepared_event_id ??
      null,
    current_execution_state: executionState,
    last_transition_at: latestExecutionIso,
    last_transition_event_id:
      latestTransition?.execution_event_reference?.booking_request_event_id ?? null,
    handoff_blocked: executionState === 'handoff_blocked',
    handoff_consumed: executionState === 'handoff_consumed',
    handoff_terminal: isTelegramHandoffExecutionTerminalState(executionState),
    snapshot_payload: readinessRecord?.handoff_snapshot || null,
    attribution_context: readinessRecord?.attribution_context || null,
  });
}
