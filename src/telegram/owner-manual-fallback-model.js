const ACTIONABLE_QUEUE_STATES = new Set([
  'waiting_for_manual_contact',
  'hold_extended_waiting_manual',
  'manual_contact_in_progress',
]);

const ACTIONS_FOR_ACTIONABLE = Object.freeze([
  'call_started',
  'not_reached',
  'assign_to_seller',
  'manual_prepayment_confirmed',
]);

const QUEUE_STATE_LABELS = Object.freeze({
  waiting_for_manual_contact: 'Waiting for manual contact',
  hold_extended_waiting_manual: 'Hold extended, waiting manual',
  manual_contact_in_progress: 'Manual contact in progress',
  manual_not_reached: 'Manual not reached',
  prepayment_confirmed_waiting_handoff: 'Prepayment confirmed, waiting handoff',
  no_longer_actionable: 'No longer actionable',
});

const HANDLING_STATE_LABELS = Object.freeze({
  new_for_manual: 'New for manual',
  manual_contact_in_progress: 'Manual contact in progress',
  manual_not_reached: 'Manual not reached',
  reassigned_to_seller: 'Reassigned to seller',
  prepayment_confirmed: 'Prepayment confirmed',
  handed_off: 'Handed off',
  no_longer_actionable: 'No longer actionable',
});

const ROUTE_REASON_LABELS = Object.freeze({
  resolved_owner_source: 'Resolved owner source',
  resolved_generic_source: 'Resolved generic source',
  resolved_seller_source_without_active_attribution:
    'Seller source without active attribution',
  unresolved_source_token: 'Unresolved source token',
  no_source_token: 'No source token',
  seller_attribution_expired: 'Seller attribution expired',
  manual_assign_to_seller: 'Manually assigned to seller',
  manual_history_without_active_manual_path: 'Manual history without active path',
});

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseIsoMs(value) {
  const parsed = Date.parse(value || '');
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function resolveQueueSummaryPayload(response) {
  const summary = response?.operation_result_summary ?? response;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return { items: [] };
  }

  return {
    ...summary,
    items: normalizeArray(summary.items),
  };
}

function resolveStateListPayload(response) {
  const summary = response?.operation_result_summary ?? response;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return { items: [] };
  }

  return {
    ...summary,
    items: normalizeArray(summary.items),
  };
}

function fallbackHandlingStateFromQueue(queueState) {
  if (
    queueState === 'waiting_for_manual_contact' ||
    queueState === 'hold_extended_waiting_manual'
  ) {
    return 'new_for_manual';
  }
  if (queueState === 'manual_contact_in_progress') {
    return 'manual_contact_in_progress';
  }
  if (queueState === 'manual_not_reached') {
    return 'manual_not_reached';
  }
  if (queueState === 'prepayment_confirmed_waiting_handoff') {
    return 'prepayment_confirmed';
  }
  return 'no_longer_actionable';
}

function resolveSourceLabel(queueItem) {
  const sourceSummary = queueItem?.attribution_summary?.traffic_source_summary;
  const sourceName = normalizeString(sourceSummary?.source_name);
  const sourceCode = normalizeString(sourceSummary?.source_code);
  if (sourceName && sourceCode) {
    return `${sourceName} (${sourceCode})`;
  }
  if (sourceName) {
    return sourceName;
  }
  if (sourceCode) {
    return sourceCode;
  }

  const sourceFamily = normalizeString(queueItem?.attribution_summary?.source_family);
  if (sourceFamily) {
    return sourceFamily;
  }

  const bindingStatus = normalizeString(queueItem?.source_binding_summary?.binding_status);
  return bindingStatus || 'unknown_source';
}

function resolveRouteTargetLabel(routeTarget = {}) {
  const routeTargetType = normalizeString(routeTarget.route_target_type) || 'manual_review';
  if (routeTargetType === 'seller') {
    const sellerId = routeTarget?.seller_reference?.seller_id;
    return sellerId ? `seller:${sellerId}` : 'seller';
  }
  return routeTargetType;
}

function normalizeQueueItem(rawQueueItem, { requestStateById, nowMs }) {
  const bookingRequestId = Number(
    rawQueueItem?.booking_request_reference?.booking_request_id || 0
  );
  if (!Number.isInteger(bookingRequestId) || bookingRequestId <= 0) {
    return null;
  }

  const queueState = normalizeString(rawQueueItem?.queue_state) || 'no_longer_actionable';
  const requestState = requestStateById.get(bookingRequestId);
  const handlingState =
    normalizeString(requestState?.current_manual_handling_state) ||
    fallbackHandlingStateFromQueue(queueState);
  const holdExpiresAtIso =
    normalizeString(rawQueueItem?.hold_state_summary?.hold_expires_at_summary?.iso) || null;
  const holdExpiresAtMs = parseIsoMs(holdExpiresAtIso);
  const remainingMs = holdExpiresAtMs === null ? null : holdExpiresAtMs - nowMs;
  const queueTimestampMs = parseIsoMs(rawQueueItem?.latest_timestamp_summary?.iso) || 0;

  return Object.freeze({
    bookingRequestId,
    queueState,
    queueStateLabel: QUEUE_STATE_LABELS[queueState] || queueState,
    handlingState,
    handlingStateLabel: HANDLING_STATE_LABELS[handlingState] || handlingState,
    lifecycleState: normalizeString(rawQueueItem?.lifecycle_state) || 'UNKNOWN',
    guestName:
      normalizeString(rawQueueItem?.telegram_user_summary?.display_name) ||
      normalizeString(rawQueueItem?.telegram_user_summary?.username) ||
      `telegram_user_${
        normalizeString(rawQueueItem?.telegram_user_summary?.telegram_user_id) || 'unknown'
      }`,
    phone:
      normalizeString(rawQueueItem?.contact_phone_summary?.phone_e164) ||
      normalizeString(rawQueueItem?.contact_phone_summary?.value) ||
      null,
    requestedPrepaymentAmount: Number(rawQueueItem?.requested_prepayment_amount || 0),
    requestedSeats: Number(rawQueueItem?.requested_seats_count || 0),
    requestedTripDate:
      normalizeString(rawQueueItem?.requested_trip_slot_reference?.requested_trip_date) || null,
    requestedTimeSlot:
      normalizeString(rawQueueItem?.requested_trip_slot_reference?.requested_time_slot) || null,
    sourceLabel: resolveSourceLabel(rawQueueItem),
    fallbackReason:
      ROUTE_REASON_LABELS[rawQueueItem?.current_route_reason] ||
      normalizeString(rawQueueItem?.current_route_reason) ||
      'unknown_reason',
    routeTargetLabel: resolveRouteTargetLabel(rawQueueItem?.current_route_target),
    holdExpiresAtIso,
    remainingMs,
    isExpired: remainingMs !== null && remainingMs <= 0,
    queueTimestampMs,
    availableActions: ACTIONABLE_QUEUE_STATES.has(queueState)
      ? ACTIONS_FOR_ACTIONABLE
      : Object.freeze([]),
    rawQueueItem,
    requestState: requestState || null,
  });
}

function compareQueueItems(left, right) {
  const leftActionable = left.availableActions.length > 0;
  const rightActionable = right.availableActions.length > 0;
  if (leftActionable !== rightActionable) {
    return leftActionable ? -1 : 1;
  }

  const leftRemaining = left.remainingMs === null ? Number.POSITIVE_INFINITY : left.remainingMs;
  const rightRemaining =
    right.remainingMs === null ? Number.POSITIVE_INFINITY : right.remainingMs;
  if (leftRemaining !== rightRemaining) {
    return leftRemaining - rightRemaining;
  }

  if (left.queueTimestampMs !== right.queueTimestampMs) {
    return right.queueTimestampMs - left.queueTimestampMs;
  }

  return left.bookingRequestId - right.bookingRequestId;
}

export function formatOwnerTelegramTimer(remainingMs) {
  if (remainingMs === null || remainingMs === undefined) {
    return 'No timer';
  }
  if (remainingMs <= 0) {
    return 'Expired';
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const minutesInHour = minutes % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutesInHour).padStart(2, '0')}:${String(
      seconds
    ).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function buildOwnerTelegramManualQueueModel(
  queueResponse,
  requestStateListResponse,
  { nowMs = Date.now() } = {}
) {
  const queueSummary = resolveQueueSummaryPayload(queueResponse);
  const requestStateSummary = resolveStateListPayload(requestStateListResponse);

  const requestStateById = new Map();
  for (const item of requestStateSummary.items) {
    const bookingRequestId = Number(item?.booking_request_reference?.booking_request_id || 0);
    if (Number.isInteger(bookingRequestId) && bookingRequestId > 0) {
      requestStateById.set(bookingRequestId, item);
    }
  }

  const items = queueSummary.items
    .map((rawQueueItem) => normalizeQueueItem(rawQueueItem, { requestStateById, nowMs }))
    .filter(Boolean)
    .sort(compareQueueItems);

  return Object.freeze({
    itemCount: items.length,
    actionableCount: items.filter((item) => item.availableActions.length > 0).length,
    expiredCount: items.filter((item) => item.isExpired).length,
    items,
  });
}
