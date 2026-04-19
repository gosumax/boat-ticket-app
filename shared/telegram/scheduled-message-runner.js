import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_SCHEDULED_MESSAGE_RUN_RESULT_VERSION =
  'telegram_scheduled_message_runner_result.v1';

export const TELEGRAM_SCHEDULED_MESSAGE_RUN_SCOPES = Object.freeze([
  'planned_reminders_by_booking_request',
  'planned_post_trip_messages_by_booking_request',
  'all_due_planned_messages',
]);

export const TELEGRAM_SCHEDULED_MESSAGE_RUN_STATUSES = Object.freeze([
  'run_executed',
  'run_partially_executed',
  'run_nothing_due',
  'run_blocked',
]);

export const TELEGRAM_SCHEDULED_MESSAGE_SUPPORTED_TYPES = Object.freeze([
  '1_hour_before_trip',
  '30_minutes_before_trip',
  'post_trip_thank_you',
  'post_trip_review_request',
]);

export const TELEGRAM_SCHEDULED_MESSAGE_SKIP_REASONS = Object.freeze([
  'not_due',
  'blocked',
  'invalid',
  'already_resolved',
  'not_planned',
]);

export function freezeTelegramScheduledMessageRunnerValue(value) {
  return freezeTelegramHandoffValue(value);
}
