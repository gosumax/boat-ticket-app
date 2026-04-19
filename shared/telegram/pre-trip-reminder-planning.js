import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_PRE_TRIP_REMINDER_PLAN_VERSION =
  'telegram_pre_trip_reminder_plan_item.v1';
export const TELEGRAM_PRE_TRIP_REMINDER_PLAN_LIST_VERSION =
  'telegram_pre_trip_reminder_plan_list.v1';

export const TELEGRAM_PRE_TRIP_REMINDER_TYPES = Object.freeze([
  '1_hour_before_trip',
  '30_minutes_before_trip',
]);

export const TELEGRAM_PRE_TRIP_REMINDER_OFFSETS_MINUTES = Object.freeze({
  '1_hour_before_trip': 60,
  '30_minutes_before_trip': 30,
});

export const TELEGRAM_PRE_TRIP_REMINDER_PLANNING_STATES = Object.freeze([
  'reminder_planned',
  'reminder_not_needed',
  'reminder_not_possible',
]);

export function freezeTelegramPreTripReminderPlanValue(value) {
  return freezeTelegramHandoffValue(value);
}
