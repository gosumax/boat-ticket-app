import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_OFFLINE_TICKET_SNAPSHOT_VERSION =
  'telegram_offline_ticket_snapshot_item.v1';
export const TELEGRAM_OFFLINE_TICKET_SNAPSHOT_LIST_VERSION =
  'telegram_offline_ticket_snapshot_list.v1';

export const TELEGRAM_OFFLINE_TICKET_SNAPSHOT_STATUSES = Object.freeze([
  'offline_unavailable',
  'offline_snapshot_ready',
]);

export function freezeTelegramOfflineTicketSnapshotValue(value) {
  return freezeTelegramHandoffValue(value);
}
