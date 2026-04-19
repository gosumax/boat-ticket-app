import {
  buildTelegramBookingRequestEventReference,
  freezeTelegramHandoffValue,
} from './handoff-readiness.js';

export const TELEGRAM_MANUAL_FALLBACK_QUEUE_QUERY_ITEM_VERSION =
  'telegram_manual_fallback_queue_query_item.v1';
export const TELEGRAM_MANUAL_FALLBACK_QUEUE_QUERY_LIST_VERSION =
  'telegram_manual_fallback_queue_query_list.v1';
export const TELEGRAM_MANUAL_FALLBACK_ACTION_RESULT_VERSION =
  'telegram_manual_fallback_action_result.v1';
export const TELEGRAM_MANUAL_FALLBACK_REQUEST_STATE_PROJECTION_VERSION =
  'telegram_manual_fallback_request_state_projection_item.v1';
export const TELEGRAM_MANUAL_FALLBACK_REQUEST_STATE_LIST_VERSION =
  'telegram_manual_fallback_request_state_projection_list.v1';

export const TELEGRAM_MANUAL_FALLBACK_QUEUE_STATES = Object.freeze([
  'waiting_for_manual_contact',
  'hold_extended_waiting_manual',
  'manual_contact_in_progress',
  'manual_not_reached',
  'prepayment_confirmed_waiting_handoff',
  'no_longer_actionable',
]);

export const TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES = Object.freeze({
  call_started: 'call_started',
  not_reached: 'not_reached',
  assign_to_seller: 'assign_to_seller',
});

export const TELEGRAM_MANUAL_FALLBACK_ACTION_TYPE_NAMES = Object.freeze(
  Object.values(TELEGRAM_MANUAL_FALLBACK_ACTION_TYPES)
);

export const TELEGRAM_MANUAL_FALLBACK_ACTION_STATUSES = Object.freeze([
  'applied',
  'idempotent_replay',
]);

export const TELEGRAM_MANUAL_FALLBACK_HANDLING_STATES = Object.freeze([
  'new_for_manual',
  'manual_contact_in_progress',
  'manual_not_reached',
  'reassigned_to_seller',
  'prepayment_confirmed',
  'handed_off',
  'no_longer_actionable',
]);

export function freezeTelegramManualFallbackValue(value) {
  return freezeTelegramHandoffValue(value);
}

export function buildTelegramManualFallbackActionEventReference(event) {
  return buildTelegramBookingRequestEventReference(event);
}
