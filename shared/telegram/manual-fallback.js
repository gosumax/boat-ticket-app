export const TELEGRAM_MANUAL_FALLBACK_ACTIONS = Object.freeze({
  call_started: 'call_started',
  not_reached: 'not_reached',
  assign_to_seller: 'assign_to_seller',
  manual_prepayment_confirmed: 'manual_prepayment_confirmed',
});

export const TELEGRAM_MANUAL_FALLBACK_ACTION_NAMES = Object.freeze(
  Object.values(TELEGRAM_MANUAL_FALLBACK_ACTIONS)
);

export const TELEGRAM_MANUAL_FALLBACK_EVENT_TYPES = Object.freeze({
  call_started: 'MANUAL_FALLBACK_CALL_STARTED',
  assigned_to_seller: 'MANUAL_FALLBACK_ASSIGNED_TO_SELLER',
});
