export const TELEGRAM_GUEST_ACTION_STATE_PROJECTION_VERSION =
  'telegram_guest_action_state_projection.v1';

export const TELEGRAM_GUEST_ACTION_STATES = Object.freeze({
  browsing_only: 'browsing_only',
  waiting_for_prepayment: 'waiting_for_prepayment',
  confirmed_with_ticket: 'confirmed_with_ticket',
  completed_or_idle: 'completed_or_idle',
});

export const TELEGRAM_GUEST_ACTION_STATE_NAMES = Object.freeze(
  Object.values(TELEGRAM_GUEST_ACTION_STATES)
);
