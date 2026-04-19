import {
  buildTelegramHandoffTimestampSummary,
  freezeTelegramHandoffValue,
} from './handoff-readiness.js';

export const TELEGRAM_BRIDGE_LINKAGE_PROJECTION_VERSION =
  'telegram_bridge_linkage_projection_item.v1';
export const TELEGRAM_BRIDGE_LINKAGE_LIST_VERSION =
  'telegram_bridge_linkage_projection_list.v1';
export const TELEGRAM_BRIDGE_LINKAGE_STATES = Object.freeze([
  'not_bridged',
  'bridged_to_presale',
  'bridge_blocked',
  'bridge_failed',
  'already_consumed',
]);

export function buildTelegramBridgeLinkageProjection({
  bookingRequestReference = null,
  lifecycleState = null,
  handoffReadinessState = null,
  executionState = null,
  bridgeLinkageState = null,
  createdPresaleReference = null,
  latestBridgeTimestampIso = null,
} = {}) {
  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_BRIDGE_LINKAGE_PROJECTION_VERSION,
    projection_item_type: 'telegram_bridge_linkage_projection_item',
    read_only: true,
    projection_only: true,
    booking_request_reference: bookingRequestReference || null,
    lifecycle_state: lifecycleState || null,
    handoff_readiness_state: handoffReadinessState || null,
    execution_state: executionState || null,
    bridge_linkage_state: bridgeLinkageState || null,
    created_presale_reference: createdPresaleReference || null,
    latest_bridge_timestamp_summary: buildTelegramHandoffTimestampSummary(
      latestBridgeTimestampIso || null
    ),
  });
}

export function buildTelegramBridgeLinkageList({
  listScope,
  items = [],
} = {}) {
  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_BRIDGE_LINKAGE_LIST_VERSION,
    read_only: true,
    projection_only: true,
    list_scope: listScope || null,
    item_count: items.length,
    items,
  });
}
