import { TELEGRAM_TICKET_STATUSES } from '../../../shared/telegram/index.js';

export function createTelegramTicketViewSkeleton(overrides = {}) {
  return {
    telegram_ticket_view_id: null,
    guest_profile_id: null,
    booking_request_id: null,
    presale_id: null,
    ticket_status: TELEGRAM_TICKET_STATUSES[0],
    trip_summary: null,
    passenger_summary: null,
    boarding_instructions: null,
    delivery_version: 'v1',
    generated_at: null,
    ...overrides,
  };
}
