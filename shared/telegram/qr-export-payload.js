import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_QR_EXPORT_PAYLOAD_ITEM_VERSION =
  'telegram_qr_export_payload_item.v1';
export const TELEGRAM_QR_EXPORT_PAYLOAD_LIST_VERSION =
  'telegram_qr_export_payload_list.v1';

export function freezeTelegramQrExportPayloadValue(value) {
  return freezeTelegramHandoffValue(value);
}
