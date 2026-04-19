import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_RUNTIME_ANALYTICS_CAPTURE_SUMMARY_VERSION =
  'telegram_runtime_analytics_capture_summary.v1';
export const TELEGRAM_RUNTIME_ANALYTICS_OPERATION_RESULT_VERSION =
  'telegram_runtime_analytics_operation_result.v1';

export const TELEGRAM_RUNTIME_ANALYTICS_CAPTURE_STATUSES = Object.freeze([
  'success',
  'partial',
  'skipped',
]);

export function freezeTelegramRuntimeAnalyticsCaptureValue(value) {
  return freezeTelegramHandoffValue(value);
}
