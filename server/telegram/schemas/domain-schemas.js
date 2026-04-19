import {
  BOOKING_HOLD_STATUSES,
  BOOKING_REQUEST_STATUSES,
  TELEGRAM_DOMAIN_ENTITIES,
  TELEGRAM_EVENT_TYPES,
  TELEGRAM_NOTIFICATION_TYPES,
  TELEGRAM_TICKET_STATUSES,
} from '../../../shared/telegram/index.js';

function asEntitySchema(entity) {
  return Object.freeze({
    entityName: entity.name,
    requiredFields: Object.freeze([...entity.requiredFields]),
  });
}

export const telegramEntitySchemas = Object.freeze(
  Object.fromEntries(TELEGRAM_DOMAIN_ENTITIES.map((entity) => [entity.name, asEntitySchema(entity)]))
);

export const telegramEnumSchemas = Object.freeze({
  bookingRequestStatus: Object.freeze([...BOOKING_REQUEST_STATUSES]),
  bookingHoldStatus: Object.freeze([...BOOKING_HOLD_STATUSES]),
  ticketStatus: Object.freeze([...TELEGRAM_TICKET_STATUSES]),
  notificationType: Object.freeze([...TELEGRAM_NOTIFICATION_TYPES]),
  eventType: Object.freeze([...TELEGRAM_EVENT_TYPES]),
});

export function getTelegramEntitySchema(entityName) {
  return telegramEntitySchemas[entityName] || null;
}
