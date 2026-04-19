import {
  buildTelegramHandoffTimestampSummary,
  freezeTelegramHandoffValue,
} from './handoff-readiness.js';

export const TELEGRAM_PRE_HANDOFF_VALIDATION_RESULT_VERSION =
  'telegram_pre_handoff_validation_result.v1';
export const TELEGRAM_PRE_HANDOFF_VALIDATION_STATUSES = Object.freeze([
  'valid_for_handoff',
  'blocked_for_handoff',
  'manual_review_required',
]);

export function buildTelegramPreHandoffValidationResult({
  bookingRequestReference,
  handoffSnapshotReference,
  validationStatus,
  validationReason,
  handoffAllowed,
  blockingIssues = [],
  warningIssues = [],
  validationTimestampIso = null,
} = {}) {
  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_PRE_HANDOFF_VALIDATION_RESULT_VERSION,
    validation_type: 'telegram_pre_handoff_validation',
    read_only: true,
    booking_request_reference: bookingRequestReference || null,
    handoff_snapshot_reference: handoffSnapshotReference || null,
    validation_status: validationStatus,
    validation_reason: validationReason,
    handoff_allowed: Boolean(handoffAllowed),
    blocking_issues: blockingIssues,
    warning_issues: warningIssues,
    validation_timestamp_summary: buildTelegramHandoffTimestampSummary(
      validationTimestampIso
    ),
  });
}
