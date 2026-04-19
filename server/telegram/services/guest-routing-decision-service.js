import { freezeTelegramHandoffValue } from '../../../shared/telegram/index.js';
import {
  TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE,
  TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION,
} from './guest-entry-projection-service.js';
import {
  TELEGRAM_SELLER_ATTRIBUTION_PROJECTION_STATUSES,
  TELEGRAM_SELLER_ATTRIBUTION_PROJECTION_VERSION,
} from './seller-attribution-projection-service.js';
import {
  TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
  TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION,
  TELEGRAM_SOURCE_BINDING_STATUSES,
} from './source-binding-persistence-service.js';

export const TELEGRAM_GUEST_ROUTING_DECISION_VERSION =
  'telegram_guest_routing_decision.v1';
export const TELEGRAM_GUEST_ROUTING_STATUSES = Object.freeze([
  'seller_attributed',
  'owner_manual',
  'generic_unassigned',
  'unresolved_source_manual',
  'no_source_manual',
  'attribution_expired_manual',
]);

const ERROR_PREFIX = '[TELEGRAM_GUEST_ROUTING_DECISION]';
const SERVICE_NAME = 'telegram_guest_routing_decision_service';

const ROUTING_BY_SOURCE_BINDING_STATUS = Object.freeze({
  resolved_seller_source: Object.freeze({
    routingStatus: 'unresolved_source_manual',
    routeTargetType: 'manual_review',
    routeReason: 'resolved_seller_source_without_active_attribution',
  }),
  resolved_owner_source: Object.freeze({
    routingStatus: 'owner_manual',
    routeTargetType: 'owner_manual',
    routeReason: 'resolved_owner_source',
  }),
  resolved_generic_source: Object.freeze({
    routingStatus: 'generic_unassigned',
    routeTargetType: 'generic_unassigned',
    routeReason: 'resolved_generic_source',
  }),
  unresolved_source_token: Object.freeze({
    routingStatus: 'unresolved_source_manual',
    routeTargetType: 'manual_review',
    routeReason: 'unresolved_source_token',
  }),
  no_source_token: Object.freeze({
    routingStatus: 'no_source_manual',
    routeTargetType: 'manual_review',
    routeReason: 'no_source_token',
  }),
});

const ROUTING_BY_NO_ATTRIBUTION_REASON = Object.freeze({
  resolved_owner_source_has_no_seller_attribution:
    ROUTING_BY_SOURCE_BINDING_STATUS.resolved_owner_source,
  resolved_generic_source_has_no_seller_attribution:
    ROUTING_BY_SOURCE_BINDING_STATUS.resolved_generic_source,
  unresolved_source_token_has_no_seller_attribution:
    ROUTING_BY_SOURCE_BINDING_STATUS.unresolved_source_token,
  no_source_token_has_no_seller_attribution:
    ROUTING_BY_SOURCE_BINDING_STATUS.no_source_token,
  seller_attribution_session_start_not_found: Object.freeze({
    routingStatus: 'unresolved_source_manual',
    routeTargetType: 'manual_review',
    routeReason: 'seller_attribution_session_start_not_found',
  }),
});

function rejectRoutingDecision(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectRoutingDecision(`${label} must be a positive integer`);
  }

  return normalized;
}

function sortRoutingValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortRoutingValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortRoutingValue(value[key])])
  );
}

function freezeSortedRoutingValue(value) {
  return freezeTelegramHandoffValue(sortRoutingValue(value));
}

function compareStableValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildNoOpGuards() {
  return freezeSortedRoutingValue({
    source_binding_created: false,
    seller_attribution_created: false,
    booking_created: false,
    queue_created: false,
    production_webhook_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  });
}

function normalizeTelegramUserSummary(value) {
  if (!isPlainObject(value)) {
    rejectRoutingDecision('telegram_user_summary is required');
  }

  const telegramUserId = normalizeString(value.telegram_user_id);
  if (!telegramUserId) {
    rejectRoutingDecision('telegram_user_summary.telegram_user_id is required');
  }

  return freezeSortedRoutingValue({
    telegram_user_id: telegramUserId,
    is_bot: Boolean(value.is_bot),
    first_name: normalizeString(value.first_name),
    last_name: normalizeString(value.last_name),
    username: normalizeString(value.username),
    language_code: normalizeString(value.language_code),
    display_name: normalizeString(value.display_name) || telegramUserId,
  });
}

function normalizeGuestEntryReference(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  if (value.reference_type !== 'telegram_guest_entry_event') {
    rejectRoutingDecision(
      `Unsupported guest-entry reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedRoutingValue({
    reference_type: 'telegram_guest_entry_event',
    guest_entry_event_id: normalizePositiveInteger(
      value.guest_entry_event_id,
      'guest_entry_reference.guest_entry_event_id'
    ),
    idempotency_key: normalizeString(value.idempotency_key),
  });
}

function normalizeSourceBindingReference(value) {
  if (!isPlainObject(value)) {
    rejectRoutingDecision('source_binding_reference is required');
  }
  if (value.reference_type !== 'telegram_guest_entry_source_binding_event') {
    rejectRoutingDecision(
      `Unsupported source-binding reference type: ${value.reference_type || 'unknown'}`
    );
  }
  if (value.event_type && value.event_type !== TELEGRAM_SOURCE_BINDING_EVENT_TYPE) {
    rejectRoutingDecision(
      `Unsupported source-binding event type: ${value.event_type}`
    );
  }

  return freezeSortedRoutingValue({
    reference_type: 'telegram_guest_entry_source_binding_event',
    source_binding_event_id: normalizePositiveInteger(
      value.source_binding_event_id,
      'source_binding_reference.source_binding_event_id'
    ),
    guest_entry_event_id: normalizePositiveInteger(
      value.guest_entry_event_id,
      'source_binding_reference.guest_entry_event_id'
    ),
    event_type: TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
    idempotency_key: normalizeString(value.idempotency_key),
  });
}

function normalizeAttributionSessionReference(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  if (value.reference_type !== 'telegram_seller_attribution_session') {
    rejectRoutingDecision(
      `Unsupported attribution-session reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedRoutingValue({
    reference_type: 'telegram_seller_attribution_session',
    seller_attribution_session_id: normalizePositiveInteger(
      value.seller_attribution_session_id,
      'attribution_session_reference.seller_attribution_session_id'
    ),
    guest_profile_id: normalizePositiveInteger(
      value.guest_profile_id,
      'attribution_session_reference.guest_profile_id'
    ),
    traffic_source_id: normalizePositiveInteger(
      value.traffic_source_id,
      'attribution_session_reference.traffic_source_id'
    ),
    source_qr_code_id: normalizePositiveInteger(
      value.source_qr_code_id,
      'attribution_session_reference.source_qr_code_id'
    ),
    seller_id:
      value.seller_id === null || value.seller_id === undefined
        ? null
        : normalizePositiveInteger(
            value.seller_id,
            'attribution_session_reference.seller_id'
          ),
    attribution_status: normalizeString(value.attribution_status),
  });
}

function buildSourceBindingReference(row) {
  return freezeSortedRoutingValue({
    reference_type: 'telegram_guest_entry_source_binding_event',
    source_binding_event_id: row.source_binding_event_id,
    guest_entry_event_id: row.guest_entry_event_id,
    event_type: row.event_type,
    idempotency_key: row.idempotency_key,
  });
}

function buildSourceBindingSnapshotFromRow(row) {
  if (!row) {
    rejectRoutingDecision('Source-binding event not found');
  }
  if (row.event_type !== TELEGRAM_SOURCE_BINDING_EVENT_TYPE) {
    rejectRoutingDecision(
      `Unsupported source-binding event type: ${row.event_type || 'unknown'}`
    );
  }
  if (
    row.binding_payload?.response_version !==
    TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION
  ) {
    rejectRoutingDecision(
      `Source-binding event is not routable: ${row.source_binding_event_id}`
    );
  }

  return freezeTelegramHandoffValue({
    response_version:
      row.binding_payload?.response_version ||
      TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION,
    binding_status: row.binding_status,
    telegram_user_summary: row.telegram_user_summary || null,
    guest_entry_reference: row.guest_entry_reference || null,
    source_binding_reference: buildSourceBindingReference(row),
    raw_source_token: row.raw_source_token || null,
    normalized_source_token: row.normalized_source_token || null,
    resolved_source_family: row.resolved_source_family || null,
    source_resolution_outcome: row.source_resolution_outcome,
    source_resolution_summary: row.source_resolution_summary || null,
    event_timestamp_summary: row.event_timestamp_summary || null,
    dedupe_key: row.dedupe_key,
    idempotency_key: row.idempotency_key,
  });
}

function normalizeSourceBindingResult(value, { allowNull = false } = {}) {
  if (!value && allowNull) {
    return null;
  }
  if (!isPlainObject(value)) {
    rejectRoutingDecision('source-binding result is required');
  }
  if (value.response_version !== TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION) {
    rejectRoutingDecision(
      `Unsupported source-binding result version: ${value.response_version || 'unknown'}`
    );
  }

  const bindingStatus = normalizeString(value.binding_status);
  if (!TELEGRAM_SOURCE_BINDING_STATUSES.includes(bindingStatus)) {
    rejectRoutingDecision(
      `Unsupported source-binding status: ${bindingStatus || 'unknown'}`
    );
  }
  const sourceResolutionOutcome = normalizeString(value.source_resolution_outcome);
  if (sourceResolutionOutcome && sourceResolutionOutcome !== bindingStatus) {
    rejectRoutingDecision('source-binding outcome mismatch');
  }

  return freezeTelegramHandoffValue({
    response_version: value.response_version,
    binding_status: bindingStatus,
    telegram_user_summary: normalizeTelegramUserSummary(value.telegram_user_summary),
    guest_entry_reference: normalizeGuestEntryReference(
      value.guest_entry_reference
    ),
    source_binding_reference: normalizeSourceBindingReference(
      value.source_binding_reference
    ),
    raw_source_token: normalizeString(value.raw_source_token),
    normalized_source_token: normalizeString(value.normalized_source_token),
    resolved_source_family: normalizeString(value.resolved_source_family),
    source_resolution_outcome: sourceResolutionOutcome || bindingStatus,
    source_resolution_summary: freezeSortedRoutingValue(
      value.source_resolution_summary || null
    ),
    event_timestamp_summary: freezeSortedRoutingValue(
      value.event_timestamp_summary || null
    ),
    dedupe_key: normalizeString(value.dedupe_key),
    idempotency_key: normalizeString(value.idempotency_key),
  });
}

function normalizeGuestEntryProjectionItem(value, { allowNull = false } = {}) {
  if (!value && allowNull) {
    return null;
  }
  if (!isPlainObject(value)) {
    rejectRoutingDecision('guest-entry projection item is required');
  }
  if (value.response_version !== TELEGRAM_GUEST_ENTRY_PROJECTION_VERSION) {
    rejectRoutingDecision(
      `Unsupported guest-entry projection version: ${value.response_version || 'unknown'}`
    );
  }
  if (value.projection_item_type !== TELEGRAM_GUEST_ENTRY_PROJECTION_ITEM_TYPE) {
    rejectRoutingDecision('guest-entry projection item is required');
  }

  return freezeTelegramHandoffValue({
    response_version: value.response_version,
    projection_item_type: value.projection_item_type,
    telegram_user_summary: normalizeTelegramUserSummary(value.telegram_user_summary),
    guest_entry_reference: normalizeGuestEntryReference(
      value.persisted_entry_reference
    ),
    source_token: normalizeString(value.source_token),
    event_timestamp_summary: freezeSortedRoutingValue(
      value.event_timestamp_summary || null
    ),
  });
}

function normalizeAttributionProjection(value) {
  if (!isPlainObject(value)) {
    rejectRoutingDecision('attribution projection is required');
  }
  if (value.response_version !== TELEGRAM_SELLER_ATTRIBUTION_PROJECTION_VERSION) {
    rejectRoutingDecision(
      `Unsupported attribution projection version: ${value.response_version || 'unknown'}`
    );
  }
  if (value.read_only !== true || value.projection_only !== true) {
    rejectRoutingDecision('attribution projection must be read-only projection data');
  }

  const attributionStatus = normalizeString(value.attribution_status);
  if (!TELEGRAM_SELLER_ATTRIBUTION_PROJECTION_STATUSES.includes(attributionStatus)) {
    rejectRoutingDecision(
      `Unsupported attribution projection status: ${attributionStatus || 'unknown'}`
    );
  }

  const sourceBindingReference = value.source_binding_reference
    ? normalizeSourceBindingReference(value.source_binding_reference)
    : null;
  const attributionSessionReference = value.attribution_session_reference
    ? normalizeAttributionSessionReference(value.attribution_session_reference)
    : null;
  const sellerAttributionActive = Boolean(value.seller_attribution_active);

  if (sellerAttributionActive) {
    if (attributionStatus !== 'ACTIVE') {
      rejectRoutingDecision('active seller attribution requires ACTIVE status');
    }
    if (!sourceBindingReference || !attributionSessionReference) {
      rejectRoutingDecision(
        'active seller attribution requires source-binding and attribution-session references'
      );
    }
  }

  return freezeTelegramHandoffValue({
    response_version: value.response_version,
    attribution_status: attributionStatus,
    telegram_user_summary: normalizeTelegramUserSummary(value.telegram_user_summary),
    source_binding_reference: sourceBindingReference,
    attribution_session_reference: attributionSessionReference,
    seller_attribution_active: sellerAttributionActive,
    attribution_started_at_summary: freezeSortedRoutingValue(
      value.attribution_started_at_summary || null
    ),
    attribution_expires_at_summary: freezeSortedRoutingValue(
      value.attribution_expires_at_summary || null
    ),
    no_attribution_reason: normalizeString(value.no_attribution_reason),
    projection_timestamp_summary: freezeSortedRoutingValue(
      value.projection_timestamp_summary || null
    ),
  });
}

function pickTelegramUserId(input = {}) {
  const telegramUserId = normalizeString(
    input.telegram_user_id ??
      input.telegramUserId ??
      input.telegram_guest_id ??
      input.telegramGuestId ??
      input.telegram_user_summary?.telegram_user_id ??
      input.telegramUserSummary?.telegram_user_id ??
      input.telegramUserSummary?.telegramUserId
  );

  if (!telegramUserId) {
    rejectRoutingDecision('telegram_user_id is required');
  }

  return telegramUserId;
}

function pickSourceBindingReferenceInput(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return { source_binding_event_id: Number(input) };
  }

  const reference =
    input.source_binding_reference ??
    input.sourceBindingReference ??
    input.source_binding_result?.source_binding_reference ??
    input.sourceBindingResult?.source_binding_reference ??
    input.sourceBindingResult?.sourceBindingReference;

  if (reference) {
    return reference;
  }

  const sourceBindingEventId =
    input.source_binding_event_id ??
    input.sourceBindingEventId ??
    input.event_id ??
    input.eventId;
  if (sourceBindingEventId !== undefined && sourceBindingEventId !== null) {
    return { source_binding_event_id: sourceBindingEventId };
  }

  rejectRoutingDecision('source_binding_reference is required');
}

function pickAttributionProjectionInput(input = {}) {
  if (input?.response_version) {
    return input;
  }

  const attributionProjection =
    input.attribution_projection ??
    input.attributionProjection ??
    input.current_attribution_projection ??
    input.currentAttributionProjection ??
    input.current_attribution_data ??
    input.currentAttributionData;

  if (!attributionProjection) {
    rejectRoutingDecision('attribution projection is required');
  }

  return attributionProjection;
}

function pickSourceBindingResultInput(input = {}) {
  if (input?.response_version === TELEGRAM_SOURCE_BINDING_PERSISTENCE_RESULT_VERSION) {
    return input;
  }

  return (
    input.source_binding_result ??
    input.sourceBindingResult ??
    input.source_binding ??
    input.sourceBinding ??
    null
  );
}

function pickGuestEntryProjectionItemInput(input = {}) {
  return (
    input.guest_entry_projection_item ??
    input.guestEntryProjectionItem ??
    input.guest_entry_result ??
    input.guestEntryResult ??
    input.guest_entry ??
    input.guestEntry ??
    null
  );
}

function assertCompatibleReferences({
  attributionProjection,
  sourceBindingResult,
  guestEntryProjectionItem,
}) {
  if (
    attributionProjection?.source_binding_reference &&
    sourceBindingResult?.source_binding_reference &&
    !compareStableValues(
      attributionProjection.source_binding_reference,
      sourceBindingResult.source_binding_reference
    )
  ) {
    rejectRoutingDecision('attribution projection/source-binding reference mismatch');
  }

  if (
    sourceBindingResult?.guest_entry_reference &&
    guestEntryProjectionItem?.guest_entry_reference &&
    !compareStableValues(
      sourceBindingResult.guest_entry_reference,
      guestEntryProjectionItem.guest_entry_reference
    )
  ) {
    rejectRoutingDecision('source-binding/guest-entry reference mismatch');
  }

  const summaries = [
    attributionProjection?.telegram_user_summary,
    sourceBindingResult?.telegram_user_summary,
    guestEntryProjectionItem?.telegram_user_summary,
  ].filter(Boolean);
  const [firstSummary] = summaries;
  for (const summary of summaries.slice(1)) {
    if (summary.telegram_user_id !== firstSummary.telegram_user_id) {
      rejectRoutingDecision('telegram user mismatch across routing inputs');
    }
  }
}

function resolveManualRouting({
  attributionProjection = null,
  sourceBindingResult = null,
  guestEntryProjectionItem = null,
}) {
  if (attributionProjection?.attribution_status === 'SELLER_ATTRIBUTION_EXPIRED') {
    return {
      routingStatus: 'attribution_expired_manual',
      routeTargetType: 'manual_review',
      routeReason: 'seller_attribution_expired',
    };
  }

  if (sourceBindingResult) {
    return ROUTING_BY_SOURCE_BINDING_STATUS[sourceBindingResult.binding_status];
  }

  const routeByReason =
    ROUTING_BY_NO_ATTRIBUTION_REASON[attributionProjection?.no_attribution_reason];
  if (routeByReason) {
    return routeByReason;
  }

  if (guestEntryProjectionItem) {
    if (guestEntryProjectionItem.source_token) {
      return {
        routingStatus: 'unresolved_source_manual',
        routeTargetType: 'manual_review',
        routeReason: 'source_binding_not_found',
      };
    }

    return {
      routingStatus: 'no_source_manual',
      routeTargetType: 'manual_review',
      routeReason: 'source_binding_not_found_for_no_source_guest_entry',
    };
  }

  if (attributionProjection?.attribution_status === 'SELLER_ATTRIBUTION_UNAVAILABLE') {
    return {
      routingStatus: 'no_source_manual',
      routeTargetType: 'manual_review',
      routeReason: attributionProjection.no_attribution_reason || 'no_source_context',
    };
  }

  rejectRoutingDecision(
    `Unsupported inactive attribution routing state: ${attributionProjection?.attribution_status || 'unknown'}`
  );
}

function buildRouteTarget({ routingStatus, routeTargetType, attributionProjection }) {
  const attributionSessionReference =
    attributionProjection?.attribution_session_reference || null;

  if (routingStatus === 'seller_attributed') {
    return freezeSortedRoutingValue({
      route_target_type: 'seller',
      seller_id: attributionSessionReference.seller_id,
      seller_attribution_session_id:
        attributionSessionReference.seller_attribution_session_id,
    });
  }

  return freezeSortedRoutingValue({
    route_target_type: routeTargetType,
    seller_id: null,
    seller_attribution_session_id: null,
  });
}

function buildDecision({
  attributionProjection,
  sourceBindingResult = null,
  guestEntryProjectionItem = null,
}) {
  assertCompatibleReferences({
    attributionProjection,
    sourceBindingResult,
    guestEntryProjectionItem,
  });

  const activeSellerAttribution = Boolean(
    attributionProjection?.seller_attribution_active
  );
  const manualRoute = activeSellerAttribution
    ? null
    : resolveManualRouting({
        attributionProjection,
        sourceBindingResult,
        guestEntryProjectionItem,
      });
  const routingStatus = activeSellerAttribution
    ? 'seller_attributed'
    : manualRoute.routingStatus;
  const routeReason = activeSellerAttribution
    ? 'active_seller_attribution'
    : manualRoute.routeReason;
  const routeTargetType = activeSellerAttribution
    ? 'seller'
    : manualRoute.routeTargetType;

  const telegramUserSummary =
    attributionProjection?.telegram_user_summary ||
    sourceBindingResult?.telegram_user_summary ||
    guestEntryProjectionItem?.telegram_user_summary;

  if (!telegramUserSummary) {
    rejectRoutingDecision('telegram_user_summary is required');
  }

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_GUEST_ROUTING_DECISION_VERSION,
    read_only: true,
    decision_only: true,
    decided_by: SERVICE_NAME,
    routing_status: routingStatus,
    telegram_user_summary: telegramUserSummary,
    guest_entry_reference:
      sourceBindingResult?.guest_entry_reference ||
      guestEntryProjectionItem?.guest_entry_reference ||
      null,
    source_binding_reference:
      sourceBindingResult?.source_binding_reference ||
      attributionProjection?.source_binding_reference ||
      null,
    attribution_session_reference:
      attributionProjection?.attribution_session_reference || null,
    current_route_target: buildRouteTarget({
      routingStatus,
      routeTargetType,
      attributionProjection,
    }),
    current_route_reason: routeReason,
    seller_attribution_active: activeSellerAttribution,
    attribution_status: attributionProjection?.attribution_status || null,
    source_binding_status: sourceBindingResult?.binding_status || null,
    no_op_guards: buildNoOpGuards(),
  });
}

export class TelegramGuestRoutingDecisionService {
  constructor({
    guestEntryProjectionService,
    sellerAttributionProjectionService,
    guestEntrySourceBindingEvents,
  }) {
    this.guestEntryProjectionService = guestEntryProjectionService;
    this.sellerAttributionProjectionService = sellerAttributionProjectionService;
    this.guestEntrySourceBindingEvents = guestEntrySourceBindingEvents;
  }

  describe() {
    return Object.freeze({
      serviceName: 'guest-routing-decision-service',
      status: 'read_only_guest_routing_decision_ready',
      dependencyKeys: [
        'guestEntryProjectionService',
        'sellerAttributionProjectionService',
        'guestEntrySourceBindingEvents',
      ],
    });
  }

  readSourceBindingByReference(input = {}) {
    const referenceInput = pickSourceBindingReferenceInput(input);
    if (
      referenceInput.reference_type &&
      referenceInput.reference_type !== 'telegram_guest_entry_source_binding_event'
    ) {
      rejectRoutingDecision(
        `Unsupported source-binding reference type: ${referenceInput.reference_type}`
      );
    }

    const sourceBindingEventId = normalizePositiveInteger(
      referenceInput.source_binding_event_id,
      'source_binding_reference.source_binding_event_id'
    );
    const expectedReference = referenceInput.reference_type
      ? normalizeSourceBindingReference(referenceInput)
      : null;
    const sourceBindingResult = normalizeSourceBindingResult(
      buildSourceBindingSnapshotFromRow(
        this.guestEntrySourceBindingEvents.getById(sourceBindingEventId)
      )
    );

    if (
      expectedReference &&
      !compareStableValues(sourceBindingResult.source_binding_reference, expectedReference)
    ) {
      rejectRoutingDecision(
        `Source-binding reference mismatch: ${sourceBindingEventId}`
      );
    }

    return sourceBindingResult;
  }

  readSourceBindingForGuestEntry(guestEntryProjectionItem) {
    if (!guestEntryProjectionItem) {
      return null;
    }

    const guestEntryEventId =
      guestEntryProjectionItem.guest_entry_reference.guest_entry_event_id;
    const row = this.guestEntrySourceBindingEvents.findOneBy(
      { guest_entry_event_id: guestEntryEventId },
      { orderBy: 'source_binding_event_id ASC' }
    );

    return row
      ? normalizeSourceBindingResult(buildSourceBindingSnapshotFromRow(row))
      : null;
  }

  decideCurrentRoutingForTelegramGuest(input = {}) {
    const telegramUserId = pickTelegramUserId(input);
    const latestGuestEntry = normalizeGuestEntryProjectionItem(
      this.guestEntryProjectionService.readLatestGuestEntryForTelegramGuest({
        ...input,
        telegram_user_id: telegramUserId,
      }),
      { allowNull: true }
    );
    const attributionProjection = normalizeAttributionProjection(
      this.sellerAttributionProjectionService
        .readCurrentAttributionStateForTelegramGuest({
          ...input,
          telegram_user_id: telegramUserId,
        })
    );

    let sourceBindingResult = null;
    if (attributionProjection.seller_attribution_active) {
      sourceBindingResult = this.readSourceBindingByReference({
        source_binding_reference: attributionProjection.source_binding_reference,
      });
    } else {
      sourceBindingResult =
        this.readSourceBindingForGuestEntry(latestGuestEntry) ||
        (attributionProjection.source_binding_reference
          ? this.readSourceBindingByReference({
              source_binding_reference: attributionProjection.source_binding_reference,
            })
          : null);
    }

    return buildDecision({
      attributionProjection,
      sourceBindingResult,
      guestEntryProjectionItem: attributionProjection.seller_attribution_active
        ? null
        : latestGuestEntry,
    });
  }

  decideRoutingFromSourceBindingReference(input = {}) {
    const sourceBindingResult = this.readSourceBindingByReference(input);
    const attributionProjection = normalizeAttributionProjection(
      this.sellerAttributionProjectionService.readAttributionBySourceBindingReference({
        source_binding_reference: sourceBindingResult.source_binding_reference,
      })
    );

    return buildDecision({
      attributionProjection,
      sourceBindingResult,
      guestEntryProjectionItem: null,
    });
  }

  decideRoutingFromCurrentAttributionData(input = {}) {
    const attributionProjection = normalizeAttributionProjection(
      pickAttributionProjectionInput(input)
    );
    const sourceBindingResult = normalizeSourceBindingResult(
      pickSourceBindingResultInput(input),
      { allowNull: true }
    );
    const guestEntryProjectionItem = normalizeGuestEntryProjectionItem(
      pickGuestEntryProjectionItemInput(input),
      { allowNull: true }
    );

    return buildDecision({
      attributionProjection,
      sourceBindingResult,
      guestEntryProjectionItem,
    });
  }

  decideCurrentRouting(input = {}) {
    return this.decideCurrentRoutingForTelegramGuest(input);
  }

  decideFromSourceBindingReference(input = {}) {
    return this.decideRoutingFromSourceBindingReference(input);
  }

  decideFromCurrentAttributionData(input = {}) {
    return this.decideRoutingFromCurrentAttributionData(input);
  }
}
