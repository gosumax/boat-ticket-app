export const TELEGRAM_BOT_START_RESPONSE_VERSION = 'telegram_bot_start_state_v1';

export const TELEGRAM_BOT_START_MODES = Object.freeze({
  new_guest: 'new_guest',
  active_request: 'active_request',
  linked_ticket: 'linked_ticket',
  completed_guest_without_active_request: 'completed_guest_without_active_request',
  // Legacy aliases kept for additive compatibility.
  new_booking: 'new_guest',
  request_in_progress: 'active_request',
});

export const TELEGRAM_BOT_START_ACTIONS = Object.freeze({
  view_trips: 'view_trips',
  create_booking_request: 'create_booking_request',
  view_current_request: 'view_current_request',
  view_ticket: 'view_ticket',
  contact: 'contact',
  faq: 'faq',
  useful_content: 'useful_content',
});

export const TELEGRAM_BOT_START_VISIBILITY_FLAGS = Object.freeze({
  contact_visible: true,
  faq_visible: true,
  useful_content_visible: true,
});
