import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_GUEST_TICKET_VIEW_PROJECTION_VERSION =
  'telegram_guest_ticket_view_projection_item.v1';

export const TELEGRAM_GUEST_TICKET_STATES = Object.freeze([
  'no_ticket_yet',
  'linked_ticket_ready',
  'linked_ticket_completed',
  'linked_ticket_cancelled_or_unavailable',
]);

export const TELEGRAM_GUEST_TICKET_AVAILABILITY_STATES = Object.freeze([
  'not_available_yet',
  'available',
  'completed',
  'unavailable',
]);

export function freezeTelegramGuestTicketViewValue(value) {
  return freezeTelegramHandoffValue(value);
}
