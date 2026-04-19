export const TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION_VERSION =
  'telegram_notification_delivery_attempt_projection_v1';

export const TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PROJECTION_ITEM_TYPE =
  'telegram_notification_delivery_attempt_projection_item';

export const TELEGRAM_NOTIFICATION_DELIVERY_STATES = Object.freeze({
  no_attempt_yet: 'no_attempt_yet',
  started: 'started',
  blocked: 'blocked',
  failed: 'failed',
  sent: 'sent',
});

export const TELEGRAM_NOTIFICATION_DELIVERY_STATE_NAMES = Object.freeze(
  Object.values(TELEGRAM_NOTIFICATION_DELIVERY_STATES)
);
