export const TELEGRAM_NOTIFICATION_DELIVERY_RUN_VERSION =
  'telegram_notification_delivery_run_v1';

export const TELEGRAM_NOTIFICATION_DELIVERY_RUN_RESULT_TYPE =
  'telegram_notification_delivery_run_result';

export const TELEGRAM_NOTIFICATION_DELIVERY_RUN_BATCH_RESULT_TYPE =
  'telegram_notification_delivery_run_batch_result';

export const TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES = Object.freeze({
  sent: 'sent',
  blocked: 'blocked',
  failed: 'failed',
  skipped: 'skipped',
});

export const TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUS_NAMES = Object.freeze(
  Object.values(TELEGRAM_NOTIFICATION_DELIVERY_RUN_STATUSES)
);

export const TELEGRAM_NOTIFICATION_DELIVERY_RUN_SKIP_REASONS = Object.freeze({
  blocked: 'blocked',
  suppressed: 'suppressed',
  invalid: 'invalid',
  unsupported_notification_type: 'unsupported_notification_type',
  non_executable: 'non_executable',
  delivery_already_started: 'delivery_already_started',
  already_fully_resolved: 'already_fully_resolved',
});
