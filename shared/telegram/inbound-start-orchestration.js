import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_INBOUND_START_ORCHESTRATION_RESULT_VERSION =
  'telegram_inbound_start_orchestration_result.v1';

export const TELEGRAM_INBOUND_START_ORCHESTRATION_STATUSES = Object.freeze([
  'start_processed',
  'start_processed_without_source',
  'start_processed_with_seller_attribution',
  'start_rejected_invalid_update',
]);

export function freezeTelegramInboundStartOrchestrationValue(value) {
  return freezeTelegramHandoffValue(value);
}
