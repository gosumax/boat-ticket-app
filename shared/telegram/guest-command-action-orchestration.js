import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_GUEST_COMMAND_ACTION_RESULT_VERSION =
  'telegram_guest_command_action_orchestration_result.v1';

export const TELEGRAM_GUEST_COMMAND_ACTION_TYPES = Object.freeze([
  'open_ticket',
  'open_my_tickets',
  'open_trips',
  'open_useful_content',
  'open_faq',
  'open_contact',
  'cancel_before_prepayment',
]);

export const TELEGRAM_GUEST_COMMAND_ACTION_STATUSES = Object.freeze([
  'action_available',
  'action_completed',
  'action_not_available',
  'action_rejected_invalid_input',
]);

export function freezeTelegramGuestCommandActionValue(value) {
  return freezeTelegramHandoffValue(value);
}
