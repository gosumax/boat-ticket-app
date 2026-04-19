import {
  buildTelegramHandoffTimestampSummary,
  freezeTelegramHandoffValue,
} from './handoff-readiness.js';

export const TELEGRAM_HANDOFF_ELIGIBILITY_PROJECTION_VERSION =
  'telegram_handoff_eligibility_projection_item.v1';
export const TELEGRAM_HANDOFF_ELIGIBILITY_LIST_VERSION =
  'telegram_handoff_eligibility_projection_list.v1';
export const TELEGRAM_HANDOFF_ELIGIBILITY_STATES = Object.freeze([
  'eligible_for_bridge',
  'blocked_for_bridge',
  'manual_review_required',
  'already_consumed',
  'not_ready',
]);

export function buildTelegramHandoffEligibilityRecord({
  bookingRequestReference,
  lifecycleState,
  handoffReadinessState,
  executionState,
  validationStatus,
  eligibilityState,
  eligibilityReason,
  latestTimestampIso = null,
} = {}) {
  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_HANDOFF_ELIGIBILITY_PROJECTION_VERSION,
    projection_item_type: 'telegram_handoff_eligibility_item',
    read_only: true,
    projection_only: true,
    booking_request_reference: bookingRequestReference || null,
    lifecycle_state: lifecycleState || null,
    handoff_readiness_state: handoffReadinessState || null,
    execution_state: executionState || null,
    validation_status: validationStatus || null,
    eligibility_state: eligibilityState,
    eligibility_reason: eligibilityReason,
    latest_timestamp_summary: buildTelegramHandoffTimestampSummary(
      latestTimestampIso
    ),
  });
}

export function buildTelegramHandoffEligibilityList({
  listScope,
  items = [],
} = {}) {
  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_HANDOFF_ELIGIBILITY_LIST_VERSION,
    read_only: true,
    projection_only: true,
    list_scope: listScope,
    item_count: items.length,
    items,
  });
}
