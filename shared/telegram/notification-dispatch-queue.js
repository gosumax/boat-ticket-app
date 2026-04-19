export const TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION =
  'telegram_notification_dispatch_queue_projection_v1';

export const TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE =
  'telegram_notification_dispatch_queue_item';

export const TELEGRAM_NOTIFICATION_DISPATCH_STATUSES = Object.freeze({
  pending: 'pending',
  blocked: 'blocked',
  suppressed: 'suppressed',
});

export const TELEGRAM_NOTIFICATION_DISPATCH_STATUS_NAMES = Object.freeze(
  Object.values(TELEGRAM_NOTIFICATION_DISPATCH_STATUSES)
);
