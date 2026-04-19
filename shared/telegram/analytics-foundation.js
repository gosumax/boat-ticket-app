import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_ANALYTICS_CAPTURE_EVENT_VERSION =
  'telegram_analytics_capture_event.v1';
export const TELEGRAM_ANALYTICS_CAPTURE_LIST_VERSION =
  'telegram_analytics_capture_list.v1';
export const TELEGRAM_ANALYTICS_COUNTERS_SUMMARY_VERSION =
  'telegram_analytics_counters_summary.v1';

export const TELEGRAM_ANALYTICS_SAFE_EVENT_TYPES = Object.freeze([
  'guest_entry',
  'source_binding',
  'attribution_start',
  'booking_request_created',
  'hold_started',
  'hold_extended',
  'hold_expired',
  'guest_cancelled_before_prepayment',
  'prepayment_confirmed',
  'handoff_prepared',
  'bridge_outcome',
  'notification_execution_outcome',
  'review_submitted',
]);

export const TELEGRAM_ANALYTICS_EVENT_TYPE_ALIASES = Object.freeze({
  SOURCE_ENTRY: 'guest_entry',
  SOURCE_BOUND: 'source_binding',
  ATTRIBUTION_STARTED: 'attribution_start',
  REQUEST_CREATED: 'booking_request_created',
  HOLD_STARTED: 'hold_started',
  HOLD_EXTENDED: 'hold_extended',
  HOLD_EXPIRED: 'hold_expired',
  GUEST_CANCELLED_BEFORE_PREPAYMENT: 'guest_cancelled_before_prepayment',
  PREPAYMENT_CONFIRMED: 'prepayment_confirmed',
  HANDOFF_PREPARED: 'handoff_prepared',
  HANDOFF_BLOCKED: 'bridge_outcome',
  HANDOFF_CONSUMED: 'bridge_outcome',
  NOTIFICATION_DELIVERY_SENT: 'notification_execution_outcome',
  NOTIFICATION_DELIVERY_BLOCKED: 'notification_execution_outcome',
  NOTIFICATION_DELIVERY_FAILED: 'notification_execution_outcome',
  REMINDER_SENT: 'notification_execution_outcome',
  POST_TRIP_SENT: 'notification_execution_outcome',
  bridge_success: 'bridge_outcome',
  bridge_failed: 'bridge_outcome',
  REVIEW_SUBMITTED: 'review_submitted',
});

export function freezeTelegramAnalyticsFoundationValue(value) {
  return freezeTelegramHandoffValue(value);
}
