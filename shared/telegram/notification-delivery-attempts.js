export const TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_PERSISTENCE_VERSION =
  'telegram_notification_delivery_attempt_persistence_v1';

export const TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES = Object.freeze({
  delivery_started: 'delivery_started',
  delivery_blocked: 'delivery_blocked',
  delivery_failed: 'delivery_failed',
  delivery_sent: 'delivery_sent',
});

export const TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUS_NAMES = Object.freeze(
  Object.values(TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES)
);

export const TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES = Object.freeze({
  delivery_started: 'NOTIFICATION_DELIVERY_STARTED',
  delivery_blocked: 'NOTIFICATION_DELIVERY_BLOCKED',
  delivery_failed: 'NOTIFICATION_DELIVERY_FAILED',
  delivery_sent: 'NOTIFICATION_DELIVERY_SENT',
});

export const TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPE_NAMES =
  Object.freeze(Object.values(TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_EVENT_TYPES));
