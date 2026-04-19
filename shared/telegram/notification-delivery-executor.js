export const TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR_VERSION =
  'telegram_notification_delivery_executor_v1';

export const TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION =
  'telegram_notification_delivery_adapter_v1';

export const TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES = Object.freeze({
  sent: 'sent',
  blocked: 'blocked',
  failed: 'failed',
});

export const TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUS_NAMES = Object.freeze(
  Object.values(TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES)
);
