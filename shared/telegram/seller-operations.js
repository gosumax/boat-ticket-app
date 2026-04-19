import {
  buildTelegramBookingRequestEventReference,
  buildTelegramHandoffTimestampSummary,
  freezeTelegramHandoffValue,
} from './handoff-readiness.js';
import { buildTelegramCanonicalPresaleReference } from './real-presale-bridge-execution.js';

export const TELEGRAM_SELLER_WORK_QUEUE_QUERY_ITEM_VERSION =
  'telegram_seller_work_queue_query_item.v1';
export const TELEGRAM_SELLER_WORK_QUEUE_QUERY_LIST_VERSION =
  'telegram_seller_work_queue_query_list.v1';
export const TELEGRAM_SELLER_ACTION_RESULT_VERSION =
  'telegram_seller_action_result.v1';
export const TELEGRAM_SELLER_REQUEST_STATE_PROJECTION_VERSION =
  'telegram_seller_request_state_projection_item.v1';
export const TELEGRAM_SELLER_REQUEST_STATE_LIST_VERSION =
  'telegram_seller_request_state_projection_list.v1';

export const TELEGRAM_SELLER_QUEUE_STATES = Object.freeze([
  'waiting_for_seller_contact',
  'hold_extended_waiting',
  'prepayment_confirmed_waiting_handoff',
  'no_longer_actionable',
]);

export const TELEGRAM_SELLER_ACTION_TYPES = Object.freeze({
  call_started: 'call_started',
  not_reached: 'not_reached',
});

export const TELEGRAM_SELLER_ACTION_TYPE_NAMES = Object.freeze(
  Object.values(TELEGRAM_SELLER_ACTION_TYPES)
);

export const TELEGRAM_SELLER_ACTION_STATUSES = Object.freeze([
  'applied',
  'idempotent_replay',
]);

export const TELEGRAM_SELLER_HANDLING_STATES = Object.freeze([
  'new_for_seller',
  'contact_in_progress',
  'seller_not_reached',
  'prepayment_confirmed',
  'handed_off',
  'no_longer_actionable',
]);

export function freezeTelegramSellerOperationValue(value) {
  return freezeTelegramHandoffValue(value);
}

export function buildTelegramSellerReference({
  sellerId,
  sellerAttributionSessionId = null,
} = {}) {
  const normalizedSellerId = Number(sellerId);
  if (!Number.isInteger(normalizedSellerId) || normalizedSellerId <= 0) {
    return null;
  }

  return freezeTelegramSellerOperationValue({
    reference_type: 'seller_user',
    seller_id: normalizedSellerId,
    seller_attribution_session_id:
      sellerAttributionSessionId === null || sellerAttributionSessionId === undefined
        ? null
        : Number(sellerAttributionSessionId),
  });
}

export function buildTelegramCurrentRouteTarget({
  sellerReference = null,
} = {}) {
  if (!sellerReference) {
    return null;
  }

  return freezeTelegramSellerOperationValue({
    route_target_type: 'seller',
    seller_reference: sellerReference,
  });
}

export function buildTelegramContactPhoneSummary(phoneE164) {
  const normalized = String(phoneE164 || '').trim();
  if (!normalized) {
    return freezeTelegramSellerOperationValue({
      phone_e164: null,
      masked_phone_e164: null,
    });
  }

  const visibleTail = normalized.slice(-4);
  const visibleHead = normalized.startsWith('+') ? '+' : '';
  const maskedCoreLength = Math.max(0, normalized.length - visibleTail.length - visibleHead.length);
  const maskedCore = '*'.repeat(maskedCoreLength);

  return freezeTelegramSellerOperationValue({
    phone_e164: normalized,
    masked_phone_e164: `${visibleHead}${maskedCore}${visibleTail}`,
  });
}

export function buildTelegramRequestedTripSlotReference(bookingRequest = {}) {
  return freezeTelegramSellerOperationValue({
    reference_type: 'telegram_requested_trip_slot_reference',
    requested_trip_date: bookingRequest.requested_trip_date || null,
    requested_time_slot: bookingRequest.requested_time_slot || null,
    slot_uid: null,
    boat_slot_id: null,
  });
}

export function buildTelegramLatestTimestampSummary(...isoCandidates) {
  const latest = isoCandidates
    .filter(Boolean)
    .map((iso) => {
      const parsed = Date.parse(iso);
      return Number.isNaN(parsed) ? null : { iso: new Date(parsed).toISOString(), parsed };
    })
    .filter(Boolean)
    .sort((left, right) => right.parsed - left.parsed)[0];

  return buildTelegramHandoffTimestampSummary(latest?.iso || null);
}

export function buildTelegramSellerActionEventReference(event) {
  return buildTelegramBookingRequestEventReference(event);
}

export function buildTelegramSellerHandoffLinkageSummary({
  bridgeLinkageProjection = null,
  confirmedPresaleId = null,
} = {}) {
  if (bridgeLinkageProjection) {
    return freezeTelegramSellerOperationValue({
      bridge_linkage_state: bridgeLinkageProjection.bridge_linkage_state || null,
      handoff_readiness_state: bridgeLinkageProjection.handoff_readiness_state || null,
      execution_state: bridgeLinkageProjection.execution_state || null,
      created_presale_reference:
        bridgeLinkageProjection.created_presale_reference ||
        buildTelegramCanonicalPresaleReference(confirmedPresaleId),
      latest_timestamp_summary:
        bridgeLinkageProjection.latest_bridge_timestamp_summary || null,
    });
  }

  const fallbackPresaleReference = buildTelegramCanonicalPresaleReference(
    confirmedPresaleId
  );
  if (!fallbackPresaleReference) {
    return null;
  }

  return freezeTelegramSellerOperationValue({
    bridge_linkage_state: 'bridged_to_presale',
    handoff_readiness_state: null,
    execution_state: null,
    created_presale_reference: fallbackPresaleReference,
    latest_timestamp_summary: null,
  });
}
