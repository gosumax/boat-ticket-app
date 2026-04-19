export const TELEGRAM_HANDOFF_PREPARED_EVENT_TYPE = 'HANDOFF_PREPARED';
export const TELEGRAM_HANDOFF_READY_STATE = 'READY_FOR_PRESALE_HANDOFF';
export const TELEGRAM_HANDOFF_PREPARATION_RESULT_VERSION =
  'telegram_handoff_preparation_result.v1';
export const TELEGRAM_HANDOFF_SNAPSHOT_VERSION =
  'telegram_handoff_snapshot.v1';
export const TELEGRAM_HANDOFF_READINESS_PROJECTION_VERSION =
  'telegram_handoff_readiness_projection_item.v1';
export const TELEGRAM_HANDOFF_READINESS_LIST_VERSION =
  'telegram_handoff_readiness_projection_list.v1';
export const TELEGRAM_HANDOFF_READINESS_STATES = Object.freeze([
  'not_ready',
  'ready_for_handoff',
  'invalid_for_handoff',
]);

function cloneJson(value) {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return value;
}

function buildBookingRequestReference(bookingRequest, handoffSnapshot = null) {
  const snapshotReference = handoffSnapshot?.booking_request_reference || null;
  if (snapshotReference) {
    return freezeTelegramHandoffValue(snapshotReference);
  }

  if (!bookingRequest) {
    return null;
  }

  return freezeTelegramHandoffValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: bookingRequest.booking_request_id,
    guest_profile_id: bookingRequest.guest_profile_id,
    seller_attribution_session_id:
      bookingRequest.seller_attribution_session_id,
  });
}

export function freezeTelegramHandoffValue(value) {
  return deepFreeze(cloneJson(value));
}

export function buildTelegramHandoffTimestampSummary(iso) {
  if (!iso) {
    return null;
  }

  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `[TELEGRAM_HANDOFF] Invalid timestamp for summary: ${String(iso)}`
    );
  }

  return freezeTelegramHandoffValue({
    iso: new Date(parsed).toISOString(),
    unix_seconds: Math.floor(parsed / 1000),
  });
}

export function buildTelegramBookingRequestEventReference(event) {
  if (!event) {
    return null;
  }

  return freezeTelegramHandoffValue({
    reference_type: 'telegram_booking_request_event',
    booking_request_event_id: event.booking_request_event_id,
    booking_request_id: event.booking_request_id,
    event_type: event.event_type,
    idempotency_key: event.event_payload?.idempotency_key ?? null,
    dedupe_key: event.event_payload?.dedupe_key ?? null,
  });
}

export function buildTelegramHandoffSnapshotReference({
  bookingRequest = null,
  bookingRequestReference = null,
  preparedEvent = null,
} = {}) {
  if (!preparedEvent) {
    return null;
  }

  const requestReference =
    bookingRequestReference || buildBookingRequestReference(bookingRequest);

  return freezeTelegramHandoffValue({
    reference_type: 'telegram_handoff_snapshot',
    booking_request_id:
      requestReference?.booking_request_id ?? preparedEvent.booking_request_id,
    handoff_prepared_event_id: preparedEvent.booking_request_event_id,
    handoff_event_type: TELEGRAM_HANDOFF_PREPARED_EVENT_TYPE,
    idempotency_key: preparedEvent.event_payload?.idempotency_key ?? null,
    dedupe_key: preparedEvent.event_payload?.dedupe_key ?? null,
  });
}

export function buildTelegramHandoffAttributionContext({
  bookingRequest = null,
  handoffSnapshot = null,
  attributionLocked = false,
} = {}) {
  const source = handoffSnapshot?.source || {};
  const currentRouteTarget = handoffSnapshot?.current_route_target || null;
  const sourceBindingReference =
    handoffSnapshot?.source_binding_reference || null;
  const attributionSessionReference =
    handoffSnapshot?.attribution_session_reference || null;

  return freezeTelegramHandoffValue({
    seller_attribution_session_id:
      bookingRequest?.seller_attribution_session_id ??
      attributionSessionReference?.seller_attribution_session_id ??
      handoffSnapshot?.booking_request_reference?.seller_attribution_session_id ??
      null,
    traffic_source_id: source.traffic_source_id ?? null,
    source_qr_code_id: source.source_qr_code_id ?? null,
    seller_id:
      currentRouteTarget?.seller_id ??
      attributionSessionReference?.seller_id ??
      source.seller_id ??
      null,
    source_code: source.source_code ?? null,
    source_type: source.source_type ?? null,
    source_name: source.source_name ?? null,
    source_family: source.source_family ?? null,
    source_ownership: source.source_ownership ?? null,
    path_type: source.path_type ?? null,
    attribution_status:
      attributionSessionReference?.attribution_status ??
      source.attribution_status ??
      null,
    attribution_expires_at: source.attribution_expires_at ?? null,
    binding_reason: source.binding_reason ?? null,
    current_route_target: currentRouteTarget,
    source_binding_reference: sourceBindingReference,
    attribution_session_reference: attributionSessionReference,
    attribution_locked: Boolean(attributionLocked),
  });
}

export function buildTelegramHandoffReadinessRecord({
  bookingRequest = null,
  lifecycleState = null,
  preparedEvent = null,
  handoffSnapshot = null,
  readinessState = null,
  latestReadinessIso = null,
} = {}) {
  const bookingRequestReference = buildBookingRequestReference(
    bookingRequest,
    handoffSnapshot
  );
  const frozenSnapshot = handoffSnapshot
    ? freezeTelegramHandoffValue(handoffSnapshot)
    : null;
  const handoffPrepared = Boolean(preparedEvent);
  const preparedAt = preparedEvent?.event_at ?? null;
  const snapshotReference = handoffPrepared
    ? buildTelegramHandoffSnapshotReference({
        bookingRequest,
        bookingRequestReference,
        preparedEvent,
      })
    : null;
  const attributionLocked = Boolean(preparedEvent?.event_payload?.attribution_locked);

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_HANDOFF_READINESS_PROJECTION_VERSION,
    projection_item_type: 'telegram_handoff_readiness_item',
    read_only: true,
    projection_only: true,
    booking_request_reference: bookingRequestReference,
    lifecycle_state: lifecycleState,
    handoff_prepared: handoffPrepared,
    handoff_readiness_state: readinessState,
    handoff_snapshot_reference: snapshotReference,
    latest_readiness_timestamp_summary: buildTelegramHandoffTimestampSummary(
      latestReadinessIso
    ),
    handoff_snapshot: frozenSnapshot,
    booking_request_id: bookingRequestReference?.booking_request_id ?? null,
    guest_profile_id: bookingRequestReference?.guest_profile_id ?? null,
    seller_attribution_session_id:
      bookingRequestReference?.seller_attribution_session_id ?? null,
    request_status: bookingRequest?.request_status ?? null,
    handoff_state: handoffPrepared
      ? preparedEvent?.event_payload?.handoff_state || TELEGRAM_HANDOFF_READY_STATE
      : null,
    prepared_at: preparedAt,
    handoff_prepared_event_id: preparedEvent?.booking_request_event_id ?? null,
    attribution_locked: attributionLocked,
    snapshot_payload: frozenSnapshot,
    attribution_context: buildTelegramHandoffAttributionContext({
      bookingRequest,
      handoffSnapshot: frozenSnapshot,
      attributionLocked,
    }),
  });
}
