export const TELEGRAM_SERVICE_MESSAGE_RESOLUTION_VERSION =
  'telegram_service_message_resolution_v1';

export const TELEGRAM_SERVICE_MESSAGE_TYPES = Object.freeze({
  booking_created: 'booking_created',
  hold_extended: 'hold_extended',
  hold_expired: 'hold_expired',
  booking_confirmed: 'booking_confirmed',
  '1_hour_before_trip': '1_hour_before_trip',
  '30_minutes_before_trip': '30_minutes_before_trip',
  post_trip_thank_you: 'post_trip_thank_you',
  post_trip_review_request: 'post_trip_review_request',
});

export const TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES = Object.freeze(
  Object.values(TELEGRAM_SERVICE_MESSAGE_TYPES)
);

export const TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS = Object.freeze({
  booking_created: 'telegram.service_message.booking_created',
  hold_extended: 'telegram.service_message.hold_extended',
  hold_expired: 'telegram.service_message.hold_expired',
  booking_confirmed: 'telegram.service_message.booking_confirmed',
  '1_hour_before_trip': 'telegram.service_message.1_hour_before_trip',
  '30_minutes_before_trip': 'telegram.service_message.30_minutes_before_trip',
  post_trip_thank_you: 'telegram.service_message.post_trip_thank_you',
  post_trip_review_request: 'telegram.service_message.post_trip_review_request',
});
