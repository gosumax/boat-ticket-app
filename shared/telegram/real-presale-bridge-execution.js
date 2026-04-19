import {
  buildTelegramHandoffTimestampSummary,
  freezeTelegramHandoffValue,
} from './handoff-readiness.js';

export const TELEGRAM_REAL_PRESALE_BRIDGE_EXECUTION_RESULT_VERSION =
  'telegram_real_presale_bridge_execution_result.v1';
export const TELEGRAM_REAL_PRESALE_BRIDGE_EXECUTION_STATUSES = Object.freeze([
  'presale_created',
  'bridge_blocked',
  'bridge_failed',
]);

export function buildTelegramCanonicalPresaleReference(presaleId) {
  const normalizedPresaleId = Number(presaleId);
  if (!Number.isInteger(normalizedPresaleId) || normalizedPresaleId <= 0) {
    return null;
  }

  return freezeTelegramHandoffValue({
    reference_type: 'canonical_presale',
    presale_id: normalizedPresaleId,
  });
}

export function buildTelegramBridgeReason({
  code = null,
  message = null,
  details = null,
} = {}) {
  const normalizedCode = String(code || '').trim();
  const normalizedMessage = String(message || '').trim();
  if (!normalizedCode && !normalizedMessage && details === null) {
    return null;
  }

  return freezeTelegramHandoffValue({
    code: normalizedCode || null,
    message: normalizedMessage || null,
    details: details ?? null,
  });
}

export function buildTelegramRealPresaleBridgeExecutionResult({
  bookingRequestReference = null,
  handoffSnapshotReference = null,
  bridgeExecutionStatus,
  bridgeExecutionCode = null,
  bridgeExecutionMessage = null,
  createdPresaleReference = null,
  blockedReason = null,
  failureReason = null,
  executionTimestampIso = null,
  guardDecision = null,
  bridgeInput = null,
  adapterResult = null,
} = {}) {
  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_REAL_PRESALE_BRIDGE_EXECUTION_RESULT_VERSION,
    booking_request_reference: bookingRequestReference || null,
    handoff_snapshot_reference: handoffSnapshotReference || null,
    bridge_execution_status: bridgeExecutionStatus || null,
    bridge_execution_code: bridgeExecutionCode || null,
    bridge_execution_message: bridgeExecutionMessage || null,
    created_presale_reference: createdPresaleReference || null,
    blocked_reason: blockedReason || null,
    failure_reason: failureReason || null,
    execution_timestamp_summary: buildTelegramHandoffTimestampSummary(
      executionTimestampIso || null
    ),
    guard_decision: guardDecision || null,
    bridge_input: bridgeInput || null,
    adapter_result: adapterResult || null,
  });
}
