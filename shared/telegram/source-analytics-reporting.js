import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_SOURCE_ANALYTICS_REPORT_ITEM_VERSION =
  'telegram_source_analytics_report_item.v1';
export const TELEGRAM_SOURCE_ANALYTICS_REPORT_LIST_VERSION =
  'telegram_source_analytics_report_list.v1';
export const TELEGRAM_SOURCE_ANALYTICS_FUNNEL_SUMMARY_VERSION =
  'telegram_source_analytics_funnel_summary.v1';

export function freezeTelegramSourceAnalyticsReportingValue(value) {
  return freezeTelegramHandoffValue(value);
}
