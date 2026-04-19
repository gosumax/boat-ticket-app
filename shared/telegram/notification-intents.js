export const TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION =
  'telegram_notification_intent_persistence_v1';

export const TELEGRAM_NOTIFICATION_INTENT_STATUSES = Object.freeze({
  created: 'intent_created',
  suppressed: 'intent_suppressed',
});

export const TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES = Object.freeze({
  created: 'NOTIFICATION_INTENT_CREATED',
  suppressed: 'NOTIFICATION_INTENT_SUPPRESSED',
});

export const TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPE_NAMES = Object.freeze(
  Object.values(TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES)
);
