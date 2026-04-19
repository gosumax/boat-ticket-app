import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_POST_TRIP_MESSAGE_PLAN_ITEM_VERSION =
  'telegram_post_trip_message_plan_item.v1';
export const TELEGRAM_POST_TRIP_MESSAGE_PLAN_LIST_VERSION =
  'telegram_post_trip_message_plan_list.v1';

export const TELEGRAM_POST_TRIP_MESSAGE_TYPES = Object.freeze([
  'post_trip_thank_you',
  'post_trip_review_request',
]);

export const TELEGRAM_POST_TRIP_PLANNING_STATES = Object.freeze([
  'post_trip_planned',
  'post_trip_not_needed',
  'post_trip_not_possible',
]);

export const TELEGRAM_POST_TRIP_TRIGGER_OFFSETS_MINUTES = Object.freeze({
  post_trip_thank_you: 10,
  post_trip_review_request: 120,
});

export function freezeTelegramPostTripPlanningValue(value) {
  return freezeTelegramHandoffValue(value);
}
