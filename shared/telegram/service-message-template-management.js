import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_SERVICE_MESSAGE_TEMPLATE_ITEM_VERSION =
  'telegram_service_message_template_item.v1';
export const TELEGRAM_SERVICE_MESSAGE_TEMPLATE_LIST_VERSION =
  'telegram_service_message_template_list.v1';
export const TELEGRAM_SERVICE_MESSAGE_TEMPLATE_MUTATION_VERSION =
  'telegram_service_message_template_mutation.v1';

export const TELEGRAM_SERVICE_MESSAGE_TEMPLATE_TYPES = Object.freeze([
  'booking_created',
  'hold_extended',
  'hold_expired',
  'booking_confirmed',
  '1_hour_before_trip',
  '30_minutes_before_trip',
  'post_trip_thank_you',
  'post_trip_review_request',
]);

export const TELEGRAM_SERVICE_MESSAGE_TEMPLATE_BASELINES = Object.freeze([
  Object.freeze({
    template_type: 'booking_created',
    template_reference: 'tg_service_message_template_booking_created',
    title_name_summary: 'Booking Created',
    text_body_summary:
      'We received your booking request. Hold details are now available in your request card.',
  }),
  Object.freeze({
    template_type: 'hold_extended',
    template_reference: 'tg_service_message_template_hold_extended',
    title_name_summary: 'Hold Extended',
    text_body_summary:
      'Your booking hold has been extended. Please complete prepayment before the new deadline.',
  }),
  Object.freeze({
    template_type: 'hold_expired',
    template_reference: 'tg_service_message_template_hold_expired',
    title_name_summary: 'Hold Expired',
    text_body_summary:
      'Your hold has expired. You can create a new booking request from the start menu.',
  }),
  Object.freeze({
    template_type: 'booking_confirmed',
    template_reference: 'tg_service_message_template_booking_confirmed',
    title_name_summary: 'Booking Confirmed',
    text_body_summary:
      'Prepayment is confirmed. Your ticket status is available in Telegram.',
  }),
  Object.freeze({
    template_type: '1_hour_before_trip',
    template_reference: 'tg_service_message_template_1_hour_before_trip',
    title_name_summary: '1 Hour Reminder',
    text_body_summary:
      'Reminder: your trip starts in about 1 hour. Please arrive in advance at the boarding point.',
  }),
  Object.freeze({
    template_type: '30_minutes_before_trip',
    template_reference: 'tg_service_message_template_30_minutes_before_trip',
    title_name_summary: '30 Minute Reminder',
    text_body_summary:
      'Reminder: your trip starts in 30 minutes. Boarding preparation is now in progress.',
  }),
  Object.freeze({
    template_type: 'post_trip_thank_you',
    template_reference: 'tg_service_message_template_post_trip_thank_you',
    title_name_summary: 'Post-Trip Thank You',
    text_body_summary:
      'Thank you for the trip. We hope to see you again soon on another route.',
  }),
  Object.freeze({
    template_type: 'post_trip_review_request',
    template_reference: 'tg_service_message_template_post_trip_review_request',
    title_name_summary: 'Post-Trip Review Request',
    text_body_summary:
      'Please share a quick review about your trip experience. Your feedback helps improve service.',
  }),
]);

export function freezeTelegramServiceMessageTemplateValue(value) {
  return freezeTelegramHandoffValue(value);
}
