import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_RUNTIME_ENTRYPOINT_RESULT_VERSION =
  'telegram_runtime_entrypoint_orchestration_result.v1';

export const TELEGRAM_RUNTIME_ENTRYPOINT_OPERATION_TYPES = Object.freeze([
  'inbound_start_update',
  'guest_action_by_telegram_user',
  'guest_action_by_booking_request',
  'template_message_by_booking_request',
]);

export const TELEGRAM_RUNTIME_ENTRYPOINT_OPERATION_STATUSES = Object.freeze([
  'processed',
  'processed_with_fallback',
  'rejected_invalid_input',
  'blocked_not_possible',
]);

export function freezeTelegramRuntimeEntrypointValue(value) {
  return freezeTelegramHandoffValue(value);
}
