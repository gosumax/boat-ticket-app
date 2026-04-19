import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_REAL_HANDOFF_PRE_EXECUTION_GUARD_NAME =
  'telegram-real-handoff-pre-execution-guard';
export const TELEGRAM_REAL_HANDOFF_PRE_EXECUTION_GUARD_VERSION =
  'telegram_real_handoff_pre_execution_guard_v1';
export const TELEGRAM_REAL_HANDOFF_PRE_EXECUTION_DECISIONS = Object.freeze([
  'eligible',
  'manual_escalation_required',
  'blocked',
]);

export function isTelegramFutureRealBridgeEligibleDecision(decision) {
  return decision === 'eligible';
}

export function buildTelegramRealHandoffPreExecutionDecision({
  decision,
  decisionCode,
  message,
  executionSnapshot = null,
  adapterResult = null,
  hardBlockers = [],
  manualEscalations = [],
  softWarnings = [],
} = {}) {
  return freezeTelegramHandoffValue({
    guard_name: TELEGRAM_REAL_HANDOFF_PRE_EXECUTION_GUARD_NAME,
    guard_version: TELEGRAM_REAL_HANDOFF_PRE_EXECUTION_GUARD_VERSION,
    dry_run: true,
    decision,
    decision_code: decisionCode,
    message,
    booking_request_id:
      executionSnapshot?.booking_request_id ??
      adapterResult?.booking_request_id ??
      adapterResult?.bridge_input?.telegram_handoff_context?.booking_request_id ??
      null,
    handoff_prepared_event_id:
      executionSnapshot?.handoff_prepared_event_id ??
      adapterResult?.bridge_input?.telegram_handoff_context?.handoff_prepared_event_id ??
      null,
    current_execution_state:
      executionSnapshot?.current_execution_state ??
      adapterResult?.current_execution_state ??
      adapterResult?.bridge_input?.telegram_handoff_context?.current_execution_state ??
      null,
    future_real_bridge_eligible: isTelegramFutureRealBridgeEligibleDecision(decision),
    manual_escalation_required: decision === 'manual_escalation_required',
    execution_snapshot: executionSnapshot,
    adapter_result: adapterResult,
    bridge_input: adapterResult?.bridge_input ?? null,
    classification: {
      hard_blockers: hardBlockers,
      manual_escalations: manualEscalations,
      soft_warnings: softWarnings,
    },
    no_op: {
      production_presale_created: false,
      production_seats_reserved: false,
      money_ledger_written: false,
      production_routes_invoked: false,
      production_bot_handlers_invoked: false,
    },
  });
}
