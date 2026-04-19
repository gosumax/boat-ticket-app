export const TELEGRAM_SELLER_WORK_QUEUE_ACTIONS = Object.freeze({
  call_started: 'call_started',
  not_reached: 'not_reached',
  hold_extend: 'hold_extend',
  prepayment_confirmed: 'prepayment_confirmed',
});

export const TELEGRAM_SELLER_WORK_QUEUE_ACTION_NAMES = Object.freeze(
  Object.values(TELEGRAM_SELLER_WORK_QUEUE_ACTIONS)
);

export const TELEGRAM_SELLER_WORK_QUEUE_ACTIVE_REQUEST_STATUSES = Object.freeze([
  'NEW',
  'ATTRIBUTED',
  'CONTACT_IN_PROGRESS',
  'HOLD_ACTIVE',
  'WAITING_PREPAYMENT',
  'PREPAYMENT_CONFIRMED',
  'CONFIRMED_TO_PRESALE',
]);

export const TELEGRAM_SELLER_WORK_QUEUE_EVENT_TYPES = Object.freeze({
  call_started: 'SELLER_CALL_STARTED',
});
