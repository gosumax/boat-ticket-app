import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_TEMPLATE_EXECUTION_RESULT_VERSION =
  'telegram_template_execution_result.v1';
export const TELEGRAM_TEMPLATE_EXECUTION_BATCH_RESULT_VERSION =
  'telegram_template_execution_batch_result.v1';

export const TELEGRAM_TEMPLATE_EXECUTION_STATUSES = Object.freeze([
  'executed_with_managed_template',
  'executed_with_default_fallback',
  'execution_blocked',
  'execution_not_possible',
]);

export function freezeTelegramTemplateExecutionValue(value) {
  return freezeTelegramHandoffValue(value);
}
