import { freezeTelegramHandoffValue } from '../../../shared/telegram/index.js';
import { TELEGRAM_SOURCE_BINDING_EVENT_TYPE } from './source-binding-persistence-service.js';
import {
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_SKIPPED_EVENT_TYPE,
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_STARTED_EVENT_TYPE,
} from './seller-attribution-session-start-service.js';

export const TELEGRAM_GUEST_PROFILE_AGGREGATE_VERSION =
  'telegram_guest_profile_aggregate.v1';
export const TELEGRAM_GUEST_TIMELINE_PROJECTION_VERSION =
  'telegram_guest_timeline_projection.v1';
export const TELEGRAM_GUEST_PROFILE_CANONICAL_ENRICH_VERSION =
  'telegram_guest_profile_canonical_enrich.v1';

const ERROR_PREFIX = '[TELEGRAM_GUEST_PROFILE_AGGREGATE]';
const SERVICE_NAME = 'telegram_guest_profile_aggregate_service';
const MAX_SCAN_LIMIT = 5000;

const BOOKING_REQUEST_TIMELINE_EVENT_MAP = Object.freeze({
  REQUEST_CREATED: 'BOOKING_REQUEST_CREATED',
  HOLD_STARTED: 'HOLD_STARTED',
  HOLD_EXTENDED: 'HOLD_EXTENDED',
  HOLD_EXPIRED: 'HOLD_EXPIRED',
  GUEST_CANCELLED: 'GUEST_CANCEL_BEFORE_PREPAYMENT',
  PREPAYMENT_CONFIRMED: 'PREPAYMENT_CONFIRMED',
  HANDOFF_PREPARED: 'HANDOFF_PREPARED',
  HANDOFF_STARTED: 'HANDOFF_STARTED',
  HANDOFF_BLOCKED: 'HANDOFF_BLOCKED',
  HANDOFF_CONSUMED: 'HANDOFF_CONSUMED',
  REAL_PRESALE_HANDOFF_SUCCEEDED: 'BRIDGE_OUTCOME',
  REAL_PRESALE_HANDOFF_BLOCKED: 'BRIDGE_OUTCOME',
  REAL_PRESALE_HANDOFF_FAILED: 'BRIDGE_OUTCOME',
});

const BRIDGE_OUTCOME_BY_EVENT_TYPE = Object.freeze({
  REAL_PRESALE_HANDOFF_SUCCEEDED: 'success',
  REAL_PRESALE_HANDOFF_BLOCKED: 'blocked',
  REAL_PRESALE_HANDOFF_FAILED: 'failure',
});

const TIMELINE_EVENT_PRIORITY = Object.freeze({
  BOT_ENTRY: 10,
  SOURCE_BINDING: 20,
  ATTRIBUTION_STARTED: 30,
  NO_ATTRIBUTION_OUTCOME: 31,
  BOOKING_REQUEST_CREATED: 40,
  HOLD_STARTED: 50,
  HOLD_EXTENDED: 51,
  HOLD_EXPIRED: 52,
  GUEST_CANCEL_BEFORE_PREPAYMENT: 60,
  PREPAYMENT_CONFIRMED: 70,
  HANDOFF_PREPARED: 80,
  HANDOFF_STARTED: 81,
  HANDOFF_BLOCKED: 82,
  HANDOFF_CONSUMED: 83,
  BRIDGE_OUTCOME: 90,
});

const ATTRIBUTION_START_EVENT_TYPES = new Set([
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_STARTED_EVENT_TYPE,
  TELEGRAM_SELLER_ATTRIBUTION_SESSION_SKIPPED_EVENT_TYPE,
]);

function rejectAggregate(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectAggregate(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeNullablePositiveInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function parseIsoTimestamp(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function requireIsoTimestamp(value, label) {
  const iso = parseIsoTimestamp(value);
  if (!iso) {
    rejectAggregate(`${label} must be a usable ISO timestamp`);
  }
  return iso;
}

function buildTimestampSummary(value, label = 'timestamp') {
  const iso = requireIsoTimestamp(value, label);
  return {
    iso,
    unix_seconds: Math.floor(Date.parse(iso) / 1000),
  };
}

function pickLatestTimestampSummary(...values) {
  const normalized = values
    .flatMap((value) => {
      if (!value) return [];
      if (typeof value === 'string') return [value];
      if (typeof value === 'object') {
        return [value.iso, value.timestamp, value.latest_timestamp];
      }
      return [];
    })
    .map((value) => parseIsoTimestamp(value))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left));

  if (normalized.length === 0) {
    return null;
  }

  return buildTimestampSummary(normalized[0], 'latest_timestamp');
}

function compareTimelineRecords(left, right) {
  const leftUnix = Number(left.timestamp_summary?.unix_seconds || 0);
  const rightUnix = Number(right.timestamp_summary?.unix_seconds || 0);
  if (leftUnix !== rightUnix) {
    return leftUnix - rightUnix;
  }

  const leftPriority = Number(left._event_priority || 999);
  const rightPriority = Number(right._event_priority || 999);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  const leftRequestId = Number(left._booking_request_id || 0);
  const rightRequestId = Number(right._booking_request_id || 0);
  if (leftRequestId !== rightRequestId) {
    return leftRequestId - rightRequestId;
  }

  const leftSourceEventId = Number(left._source_event_id || 0);
  const rightSourceEventId = Number(right._source_event_id || 0);
  if (leftSourceEventId !== rightSourceEventId) {
    return leftSourceEventId - rightSourceEventId;
  }

  if (left.event_type !== right.event_type) {
    return left.event_type < right.event_type ? -1 : 1;
  }

  return 0;
}

function compareByNewestTimestamp(left, right) {
  const leftIso =
    left.latest_timestamp_summary?.iso || left.timestamp_summary?.iso || null;
  const rightIso =
    right.latest_timestamp_summary?.iso || right.timestamp_summary?.iso || null;
  const leftTime = leftIso ? Date.parse(leftIso) : 0;
  const rightTime = rightIso ? Date.parse(rightIso) : 0;
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  const leftRequestId = Number(
    left.booking_request_reference?.booking_request_id || 0
  );
  const rightRequestId = Number(
    right.booking_request_reference?.booking_request_id || 0
  );
  return rightRequestId - leftRequestId;
}

function sortByTimestampAsc(left, right) {
  const leftIso = left.timestamp_summary?.iso || null;
  const rightIso = right.timestamp_summary?.iso || null;
  const leftTime = leftIso ? Date.parse(leftIso) : 0;
  const rightTime = rightIso ? Date.parse(rightIso) : 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  const leftId =
    left.source_binding_reference?.source_binding_event_id ||
    left.attribution_start_reference?.attribution_start_event_id ||
    left.guest_entry_reference?.guest_entry_id ||
    left.seller_attribution_session_reference?.seller_attribution_session_id ||
    0;
  const rightId =
    right.source_binding_reference?.source_binding_event_id ||
    right.attribution_start_reference?.attribution_start_event_id ||
    right.guest_entry_reference?.guest_entry_id ||
    right.seller_attribution_session_reference?.seller_attribution_session_id ||
    0;
  return Number(leftId) - Number(rightId);
}

function buildTelegramUserReference(telegramUserId) {
  return {
    reference_type: 'telegram_user',
    telegram_user_id: telegramUserId,
  };
}

function buildBookingRequestReference(bookingRequest) {
  return {
    reference_type: 'telegram_booking_request',
    booking_request_id: bookingRequest.booking_request_id,
    guest_profile_id: bookingRequest.guest_profile_id,
    seller_attribution_session_id:
      bookingRequest.seller_attribution_session_id || null,
  };
}

function buildBookingRequestEventReference(event) {
  return {
    reference_type: 'telegram_booking_request_event',
    booking_request_event_id: event.booking_request_event_id,
    booking_request_id: event.booking_request_id,
    event_type: event.event_type,
  };
}

function normalizeTelegramUserReferenceInput(input = {}) {
  const referenceInput =
    input.telegram_user_reference ??
    input.telegramUserReference ??
    input.reference ??
    input.telegram_user_id ??
    input.telegramUserId ??
    input;

  if (typeof referenceInput === 'string' || typeof referenceInput === 'number') {
    const telegramUserId = normalizeString(referenceInput);
    if (!telegramUserId) {
      rejectAggregate('telegram_user_reference.telegram_user_id is required');
    }
    return buildTelegramUserReference(telegramUserId);
  }

  if (!referenceInput || typeof referenceInput !== 'object') {
    rejectAggregate('telegram_user_reference is required');
  }
  if (
    referenceInput.reference_type &&
    referenceInput.reference_type !== 'telegram_user'
  ) {
    rejectAggregate(
      `Unsupported telegram user reference type: ${referenceInput.reference_type}`
    );
  }

  const telegramUserId = normalizeString(
    referenceInput.telegram_user_id ??
      referenceInput.telegramUserId ??
      referenceInput.telegram_user
  );
  if (!telegramUserId) {
    rejectAggregate('telegram_user_reference.telegram_user_id is required');
  }

  return buildTelegramUserReference(telegramUserId);
}

function normalizeBookingRequestReferenceInput(input = {}) {
  const referenceInput =
    input.booking_request_reference ??
    input.bookingRequestReference ??
    input.reference ??
    input.booking_request_id ??
    input.bookingRequestId ??
    input;

  if (typeof referenceInput === 'number' || typeof referenceInput === 'string') {
    return {
      reference_type: 'telegram_booking_request',
      booking_request_id: normalizePositiveInteger(
        referenceInput,
        'booking_request_reference.booking_request_id'
      ),
    };
  }

  if (!referenceInput || typeof referenceInput !== 'object') {
    rejectAggregate('booking_request_reference is required');
  }
  if (
    referenceInput.reference_type &&
    referenceInput.reference_type !== 'telegram_booking_request'
  ) {
    rejectAggregate(
      `Unsupported booking-request reference type: ${referenceInput.reference_type}`
    );
  }

  return {
    reference_type: 'telegram_booking_request',
    booking_request_id: normalizePositiveInteger(
      referenceInput.booking_request_id ?? referenceInput.bookingRequestId,
      'booking_request_reference.booking_request_id'
    ),
  };
}

function normalizeContactPhoneReferenceInput(input = {}) {
  const referenceInput =
    input.contact_phone_reference ??
    input.contactPhoneReference ??
    input.reference ??
    input.phone_e164 ??
    input.phoneE164 ??
    input;

  if (typeof referenceInput === 'string' || typeof referenceInput === 'number') {
    const phone = normalizeString(referenceInput);
    if (!phone) {
      rejectAggregate('contact_phone_reference.phone_e164 is required');
    }
    return {
      reference_type: 'telegram_contact_phone',
      phone_e164: phone,
    };
  }

  if (!referenceInput || typeof referenceInput !== 'object') {
    rejectAggregate('contact_phone_reference is required');
  }
  if (
    referenceInput.reference_type &&
    referenceInput.reference_type !== 'telegram_contact_phone'
  ) {
    rejectAggregate(
      `Unsupported contact-phone reference type: ${referenceInput.reference_type}`
    );
  }

  const phone = normalizeString(
    referenceInput.phone_e164 ?? referenceInput.phoneE164
  );
  if (!phone) {
    rejectAggregate('contact_phone_reference.phone_e164 is required');
  }

  return {
    reference_type: 'telegram_contact_phone',
    phone_e164: phone,
  };
}

function bridgeOutcomeSummaryFromEvent(event) {
  if (!event || !BRIDGE_OUTCOME_BY_EVENT_TYPE[event.event_type]) {
    return null;
  }

  const payload = event.event_payload || {};
  const bridgeResult = payload.bridge_execution_result || {};
  return {
    status: BRIDGE_OUTCOME_BY_EVENT_TYPE[event.event_type],
    source_event_type: event.event_type,
    outcome_code:
      payload.outcome_code ||
      bridgeResult.bridge_execution_code ||
      bridgeResult.bridgeExecutionCode ||
      null,
    message:
      payload.message ||
      bridgeResult.bridge_execution_message ||
      bridgeResult.bridgeExecutionMessage ||
      null,
    timestamp_summary: buildTimestampSummary(
      event.event_at,
      `booking_request_event(${event.booking_request_event_id}).event_at`
    ),
  };
}

function buildContactPhoneSummary(phoneE164) {
  const normalized = normalizeString(phoneE164);
  if (!normalized) {
    return null;
  }

  return {
    phone_e164: normalized,
    has_phone: true,
  };
}

export class TelegramGuestProfileAggregateService {
  constructor({
    guestEntrySourceBindingEvents,
    sellerAttributionSessionStartEvents,
    guestProfileService,
    guestRoutingDecisionService,
  }) {
    this.guestEntrySourceBindingEvents = guestEntrySourceBindingEvents;
    this.sellerAttributionSessionStartEvents =
      sellerAttributionSessionStartEvents;
    this.guestProfileService = guestProfileService;
    this.guestRoutingDecisionService = guestRoutingDecisionService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'guest-profile-aggregate-service',
      status: 'read_only_guest_profile_aggregate_ready',
      dependencyKeys: [
        'guestEntrySourceBindingEvents',
        'sellerAttributionSessionStartEvents',
        'guestProfileService',
        'guestRoutingDecisionService',
      ],
    });
  }

  listSourceBindingRowsForTelegramUser(telegramUserId) {
    const rows = this.guestEntrySourceBindingEvents.listBy(
      {},
      {
        orderBy: 'source_binding_event_id ASC',
        limit: MAX_SCAN_LIMIT,
      }
    );

    return rows.filter(
      (row) =>
        normalizeString(row.telegram_user_summary?.telegram_user_id) ===
        telegramUserId
    );
  }

  resolveSourceBindingTimestamp(row) {
    const directIso = parseIsoTimestamp(row.event_at);
    if (directIso) {
      return directIso;
    }

    const nestedIso = parseIsoTimestamp(
      row.event_timestamp_summary?.source_binding_event_timestamp?.iso
    );
    if (nestedIso) {
      return nestedIso;
    }

    const flatIso = parseIsoTimestamp(row.event_timestamp_summary?.iso);
    if (flatIso) {
      return flatIso;
    }

    rejectAggregate(
      `Source-binding event is not projectable: ${row.source_binding_event_id}`
    );
  }

  buildSourceBindingHistoryItem(row) {
    if (!row || row.event_type !== TELEGRAM_SOURCE_BINDING_EVENT_TYPE) {
      rejectAggregate(
        `Source-binding event is not projectable: ${row?.source_binding_event_id || 'unknown'}`
      );
    }

    const sourceBindingEventId = normalizePositiveInteger(
      row.source_binding_event_id,
      'source_binding_event_id'
    );
    const guestEntryEventId = normalizePositiveInteger(
      row.guest_entry_event_id,
      'guest_entry_event_id'
    );
    const timestampIso = this.resolveSourceBindingTimestamp(row);

    return {
      source_binding_reference: {
        reference_type: 'telegram_guest_entry_source_binding_event',
        source_binding_event_id: sourceBindingEventId,
        guest_entry_event_id: guestEntryEventId,
        event_type: TELEGRAM_SOURCE_BINDING_EVENT_TYPE,
        idempotency_key: normalizeString(row.idempotency_key),
      },
      guest_entry_reference: row.guest_entry_reference || {
        reference_type: 'telegram_guest_entry_event',
        guest_entry_event_id: guestEntryEventId,
      },
      binding_status: normalizeString(row.binding_status),
      source_resolution_outcome: normalizeString(row.source_resolution_outcome),
      resolved_source_family: normalizeString(row.resolved_source_family),
      source_resolution_summary: row.source_resolution_summary || null,
      timestamp_summary: buildTimestampSummary(
        timestampIso,
        `source_binding_event(${sourceBindingEventId})`
      ),
      dedupe_key: normalizeString(row.dedupe_key),
      idempotency_key: normalizeString(row.idempotency_key),
    };
  }

  listSourceBindingHistory(telegramUserId) {
    return this.listSourceBindingRowsForTelegramUser(telegramUserId)
      .map((row) => this.buildSourceBindingHistoryItem(row))
      .sort(sortByTimestampAsc);
  }

  listAttributionStartRowsForTelegramUser(telegramUserId) {
    const rows = this.sellerAttributionSessionStartEvents.listBy(
      {},
      {
        orderBy: 'attribution_start_event_id ASC',
        limit: MAX_SCAN_LIMIT,
      }
    );

    return rows.filter(
      (row) =>
        normalizeString(row.telegram_user_summary?.telegram_user_id) ===
        telegramUserId
    );
  }

  resolveAttributionTimestamp(row) {
    if (
      row.event_type === TELEGRAM_SELLER_ATTRIBUTION_SESSION_STARTED_EVENT_TYPE
    ) {
      const startedAtIso = parseIsoTimestamp(
        row.attribution_started_at_summary?.iso
      );
      if (startedAtIso) {
        return startedAtIso;
      }
    }

    const createdAtIso = parseIsoTimestamp(row.created_at);
    if (createdAtIso) {
      return createdAtIso;
    }

    rejectAggregate(
      `Seller-attribution start event is not projectable: ${row.attribution_start_event_id}`
    );
  }

  buildAttributionStartHistoryItem(row) {
    if (!row || !ATTRIBUTION_START_EVENT_TYPES.has(row.event_type)) {
      rejectAggregate(
        `Seller-attribution start event is not projectable: ${
          row?.attribution_start_event_id || 'unknown'
        }`
      );
    }

    const attributionStartEventId = normalizePositiveInteger(
      row.attribution_start_event_id,
      'attribution_start_event_id'
    );
    const timestampIso = this.resolveAttributionTimestamp(row);

    return {
      attribution_start_reference: {
        reference_type: 'telegram_seller_attribution_session_start_event',
        attribution_start_event_id: attributionStartEventId,
        event_type: row.event_type,
        idempotency_key: normalizeString(row.idempotency_key),
      },
      attribution_status: normalizeString(row.attribution_status),
      no_attribution_reason: normalizeString(row.no_attribution_reason),
      seller_attribution_active:
        row.seller_attribution_active === true ||
        Number(row.seller_attribution_active) === 1,
      source_binding_reference: row.source_binding_reference || null,
      attribution_session_reference: row.attribution_session_reference || null,
      timestamp_summary: buildTimestampSummary(
        timestampIso,
        `attribution_start_event(${attributionStartEventId})`
      ),
      telegram_user_summary: row.telegram_user_summary || null,
    };
  }

  listAttributionStartHistory(telegramUserId) {
    return this.listAttributionStartRowsForTelegramUser(telegramUserId)
      .map((row) => this.buildAttributionStartHistoryItem(row))
      .sort(sortByTimestampAsc);
  }

  buildGuestEntryHistory(profileView) {
    return (profileView.source_entry_history || [])
      .map((item) => {
        const guestEntry = item.guest_entry || {};
        const guestEntryId = normalizePositiveInteger(
          guestEntry.guest_entry_id,
          'guest_entry_id'
        );
        const timestampSummary = buildTimestampSummary(
          guestEntry.entry_at,
          `guest_entry(${guestEntryId}).entry_at`
        );

        return {
          guest_entry_reference: {
            reference_type: 'telegram_guest_entry',
            guest_entry_id: guestEntryId,
          },
          entry_status: normalizeString(guestEntry.entry_status),
          entry_channel: normalizeString(guestEntry.entry_channel),
          traffic_source_summary: item.traffic_source
            ? {
                traffic_source_id: item.traffic_source.traffic_source_id,
                source_code: item.traffic_source.source_code,
                source_type: item.traffic_source.source_type,
                source_name: item.traffic_source.source_name,
              }
            : null,
          source_qr_code_summary: item.source_qr_code
            ? {
                source_qr_code_id: item.source_qr_code.source_qr_code_id,
                qr_token: item.source_qr_code.qr_token,
                seller_id: item.source_qr_code.seller_id ?? null,
              }
            : null,
          timestamp_summary: timestampSummary,
        };
      })
      .sort(sortByTimestampAsc);
  }

  buildAttributionSessionHistory(profileView) {
    return (profileView.attribution_history || [])
      .map((item) => {
        const session = item.seller_attribution_session || {};
        const sessionId = normalizePositiveInteger(
          session.seller_attribution_session_id,
          'seller_attribution_session_id'
        );
        const timestampSummary = buildTimestampSummary(
          session.starts_at,
          `seller_attribution_session(${sessionId}).starts_at`
        );
        return {
          seller_attribution_session_reference: {
            reference_type: 'telegram_seller_attribution_session',
            seller_attribution_session_id: sessionId,
            guest_profile_id: session.guest_profile_id,
            traffic_source_id: session.traffic_source_id,
            source_qr_code_id: session.source_qr_code_id,
            seller_id: session.seller_id ?? null,
          },
          attribution_status: normalizeString(session.attribution_status),
          binding_reason: normalizeString(session.binding_reason),
          starts_at_summary: timestampSummary,
          expires_at_summary: session.expires_at
            ? buildTimestampSummary(
                session.expires_at,
                `seller_attribution_session(${sessionId}).expires_at`
              )
            : null,
          traffic_source_summary: item.traffic_source
            ? {
                source_code: item.traffic_source.source_code,
                source_type: item.traffic_source.source_type,
                source_name: item.traffic_source.source_name,
              }
            : null,
        };
      })
      .sort(sortByTimestampAsc);
  }

  buildLatestRouteSummary(telegramUserId) {
    const decision =
      this.guestRoutingDecisionService.decideCurrentRoutingForTelegramGuest({
        telegram_user_id: telegramUserId,
      });

    return {
      routing_status: decision.routing_status || null,
      current_route_target: decision.current_route_target || null,
      current_route_reason: decision.current_route_reason || null,
      attribution_status: decision.attribution_status || null,
      source_binding_status: decision.source_binding_status || null,
    };
  }

  buildLatestSourceSummary({ sourceBindingHistory, guestEntryHistory }) {
    const latestSourceBinding = sourceBindingHistory.at(-1) || null;
    if (latestSourceBinding) {
      return {
        source_summary_type: 'source_binding',
        source_binding_reference: latestSourceBinding.source_binding_reference,
        binding_status: latestSourceBinding.binding_status,
        source_resolution_outcome: latestSourceBinding.source_resolution_outcome,
        resolved_source_family: latestSourceBinding.resolved_source_family,
        latest_timestamp_summary: latestSourceBinding.timestamp_summary,
      };
    }

    const latestGuestEntry = guestEntryHistory.at(-1) || null;
    if (latestGuestEntry) {
      return {
        source_summary_type: 'guest_entry',
        source_binding_reference: null,
        binding_status: null,
        source_resolution_outcome: null,
        resolved_source_family: null,
        latest_timestamp_summary: latestGuestEntry.timestamp_summary,
        traffic_source_summary: latestGuestEntry.traffic_source_summary || null,
      };
    }

    return {
      source_summary_type: 'unavailable',
      source_binding_reference: null,
      binding_status: null,
      source_resolution_outcome: null,
      resolved_source_family: null,
      latest_timestamp_summary: null,
    };
  }

  buildLatestAttributionSummary({
    attributionStartHistory,
    attributionSessionHistory,
  }) {
    const latestStartEvent = attributionStartHistory.at(-1) || null;
    if (latestStartEvent) {
      return {
        attribution_summary_type: 'attribution_start_event',
        attribution_start_reference: latestStartEvent.attribution_start_reference,
        attribution_status: latestStartEvent.attribution_status,
        seller_attribution_active: latestStartEvent.seller_attribution_active,
        no_attribution_reason: latestStartEvent.no_attribution_reason,
        attribution_session_reference:
          latestStartEvent.attribution_session_reference || null,
        source_binding_reference: latestStartEvent.source_binding_reference || null,
        latest_timestamp_summary: latestStartEvent.timestamp_summary,
      };
    }

    const latestSession = attributionSessionHistory.at(-1) || null;
    if (latestSession) {
      return {
        attribution_summary_type: 'attribution_session',
        attribution_start_reference: null,
        attribution_status: latestSession.attribution_status,
        seller_attribution_active:
          latestSession.attribution_status === 'ACTIVE',
        no_attribution_reason: null,
        attribution_session_reference:
          latestSession.seller_attribution_session_reference,
        source_binding_reference: null,
        latest_timestamp_summary: latestSession.starts_at_summary,
      };
    }

    return {
      attribution_summary_type: 'unavailable',
      attribution_start_reference: null,
      attribution_status: null,
      seller_attribution_active: false,
      no_attribution_reason: 'seller_attribution_session_start_not_found',
      attribution_session_reference: null,
      source_binding_reference: null,
      latest_timestamp_summary: null,
    };
  }

  buildBookingRequestSummary(historyItem) {
    if (!historyItem?.booking_request) {
      return null;
    }

    const bookingRequest = historyItem.booking_request;
    const bookingHold = historyItem.booking_hold || null;
    const latestTimestampSummary = pickLatestTimestampSummary(
      bookingRequest.last_status_at,
      bookingRequest.created_at
    );

    return {
      booking_request_reference: buildBookingRequestReference(bookingRequest),
      request_status: normalizeString(bookingRequest.request_status),
      requested_trip_summary: {
        requested_trip_date: normalizeString(bookingRequest.requested_trip_date),
        requested_time_slot: normalizeString(bookingRequest.requested_time_slot),
        requested_seats: Number(bookingRequest.requested_seats || 0),
        requested_ticket_mix: bookingRequest.requested_ticket_mix || {},
      },
      contact_phone_e164: normalizeString(bookingRequest.contact_phone_e164),
      hold_summary: bookingHold
        ? {
            hold_status: normalizeString(bookingHold.hold_status),
            hold_expires_at: normalizeString(bookingHold.hold_expires_at),
            requested_amount:
              bookingHold.requested_amount === null ||
              bookingHold.requested_amount === undefined
                ? null
                : Number(bookingHold.requested_amount),
            currency: normalizeString(bookingHold.currency),
          }
        : null,
      confirmed_presale_id: bookingRequest.confirmed_presale_id || null,
      latest_timestamp_summary: latestTimestampSummary,
    };
  }

  buildCanonicalEnrichSummary(historyItem) {
    const bookingRequest = historyItem?.booking_request || null;
    const confirmedPresaleId = normalizeNullablePositiveInteger(
      bookingRequest?.confirmed_presale_id
    );

    const base = {
      response_version: TELEGRAM_GUEST_PROFILE_CANONICAL_ENRICH_VERSION,
      read_only: true,
      optional_enrich: true,
      canonical_presale_reference: confirmedPresaleId
        ? {
            reference_type: 'canonical_presale',
            presale_id: confirmedPresaleId,
          }
        : null,
      canonical_presale_status_summary: {
        linkage_status: 'not_linked',
        presale_exists: false,
        presale_status: null,
      },
      ticket_count_summary: {
        read_status: 'not_applicable',
        total_count: null,
      },
      trip_summary: {
        read_status: 'not_applicable',
        derivable: false,
        slot_uid: null,
        boat_slot_id: null,
        business_day: null,
      },
      enrich_status: 'not_applicable',
      degradation_reason: null,
    };

    if (!confirmedPresaleId) {
      return base;
    }

    try {
      const linkage = historyItem?.canonical_linkage_state || null;
      if (!linkage || typeof linkage !== 'object') {
        return {
          ...base,
          enrich_status: 'degraded',
          degradation_reason: 'canonical_linkage_state_missing',
        };
      }

      const linkageStatus = normalizeString(linkage.linkage_status) || 'unknown';
      const canonicalPresale = linkage.canonical_presale || {};
      const ticketSummary = linkage.linked_ticket_summary || {};
      const tripSummary = linkage.trip_linkage_summary || {};
      const degraded =
        linkageStatus !== 'enriched' || normalizeString(linkage.degradation_reason);

      return {
        ...base,
        canonical_presale_reference:
          normalizeNullablePositiveInteger(canonicalPresale.presale_id) ||
          confirmedPresaleId
            ? {
                reference_type: 'canonical_presale',
                presale_id:
                  normalizeNullablePositiveInteger(canonicalPresale.presale_id) ||
                  confirmedPresaleId,
              }
            : null,
        canonical_presale_status_summary: {
          linkage_status: linkageStatus,
          presale_exists: Boolean(canonicalPresale.exists),
          presale_status: normalizeString(canonicalPresale.status),
        },
        ticket_count_summary: {
          read_status: normalizeString(ticketSummary.read_status) || 'unreadable',
          total_count:
            ticketSummary.total_count === null ||
            ticketSummary.total_count === undefined
              ? null
              : Number(ticketSummary.total_count),
        },
        trip_summary: {
          read_status:
            normalizeString(tripSummary.derivation_status) || 'unreadable',
          derivable: Boolean(tripSummary.derivable),
          slot_uid: normalizeString(tripSummary.slot_uid),
          boat_slot_id: normalizeNullablePositiveInteger(tripSummary.boat_slot_id),
          business_day: normalizeString(tripSummary.business_day),
        },
        enrich_status: degraded ? 'degraded' : 'enriched',
        degradation_reason:
          normalizeString(linkage.degradation_reason) ||
          (degraded ? 'canonical_summary_unavailable' : null),
      };
    } catch {
      return {
        ...base,
        enrich_status: 'degraded',
        degradation_reason: 'canonical_enrich_build_failed',
      };
    }
  }

  buildBridgeLinkageSummary(profileView) {
    const candidates = (profileView.booking_request_history || [])
      .map((historyItem) => {
        const bookingRequest = historyItem.booking_request || null;
        if (!bookingRequest) return null;

        const bookingRequestEvents = historyItem.booking_request_events || [];
        const latestBridgeOutcome = bookingRequestEvents
          .map((event) => bridgeOutcomeSummaryFromEvent(event))
          .filter(Boolean)
          .sort(compareByNewestTimestamp)[0] || null;

        const hasBridgeSignal = Boolean(
          historyItem.handoff_state ||
            historyItem.presale_linkage_state?.linked_to_presale ||
            latestBridgeOutcome
        );
        if (!hasBridgeSignal) {
          return null;
        }

        const handoffState = historyItem.handoff_state || null;
        const latestTimestampSummary = pickLatestTimestampSummary(
          latestBridgeOutcome?.timestamp_summary,
          handoffState?.last_result_at,
          handoffState?.last_attempt_at,
          handoffState?.last_transition_at,
          handoffState?.prepared_at,
          bookingRequest.last_status_at,
          bookingRequest.created_at
        );

        return {
          booking_request_reference: buildBookingRequestReference(bookingRequest),
          request_status: bookingRequest.request_status,
          handoff_summary: handoffState
            ? {
                handoff_prepared_event_id:
                  handoffState.handoff_prepared_event_id || null,
                current_execution_state:
                  normalizeString(handoffState.current_execution_state),
                handoff_terminal: Boolean(handoffState.handoff_terminal),
                current_orchestration_outcome: normalizeString(
                  handoffState.current_orchestration_outcome
                ),
                orchestration_attempt_count: Number(
                  handoffState.orchestration_attempt_count || 0
                ),
              }
            : null,
          presale_linkage_summary: historyItem.presale_linkage_state
            ? {
                linked_to_presale: Boolean(
                  historyItem.presale_linkage_state.linked_to_presale
                ),
                confirmed_presale_id:
                  historyItem.presale_linkage_state.confirmed_presale_id || null,
                linkage_source: normalizeString(
                  historyItem.presale_linkage_state.linkage_source
                ),
              }
            : null,
          bridge_outcome_summary: latestBridgeOutcome,
          canonical_enrich_summary: this.buildCanonicalEnrichSummary(historyItem),
          latest_timestamp_summary: latestTimestampSummary,
        };
      })
      .filter(Boolean)
      .sort(compareByNewestTimestamp);

    return candidates[0] || null;
  }

  buildGuestProfileStatusSummary({
    activeBookingRequestSummary,
    latestBridgeLinkageSummary,
    bookingRequestHistoryCount,
  }) {
    if (activeBookingRequestSummary) {
      return {
        status: 'active_booking_request',
        reason: 'active_telegram_booking_request_present',
      };
    }

    if (latestBridgeLinkageSummary?.presale_linkage_summary?.linked_to_presale) {
      return {
        status: 'bridged_to_presale',
        reason: 'confirmed_presale_linked',
      };
    }

    if (bookingRequestHistoryCount > 0) {
      return {
        status: 'inactive_with_history',
        reason: 'no_active_booking_request',
      };
    }

    return {
      status: 'new_guest_profile',
      reason: 'no_booking_request_history',
    };
  }

  buildTimelineRecord({
    eventType,
    eventStatusSummary,
    relatedReferences,
    timestampIso,
    bookingRequestId = null,
    sourceEventId = null,
  }) {
    return {
      event_type: eventType,
      event_status_summary: eventStatusSummary,
      related_references: relatedReferences,
      timestamp_summary: buildTimestampSummary(timestampIso, `${eventType}.timestamp`),
      _event_priority: TIMELINE_EVENT_PRIORITY[eventType] || 999,
      _booking_request_id: bookingRequestId || 0,
      _source_event_id: sourceEventId || 0,
    };
  }

  buildGuestTimelineRecords({
    telegramUserReference,
    guestEntryHistory,
    sourceBindingHistory,
    attributionStartHistory,
    bookingRequestHistory,
  }) {
    const records = [];

    for (const entry of guestEntryHistory) {
      records.push(
        this.buildTimelineRecord({
          eventType: 'BOT_ENTRY',
          eventStatusSummary: {
            status: entry.entry_status || 'recorded',
            entry_channel: entry.entry_channel,
          },
          relatedReferences: {
            telegram_user_reference: telegramUserReference,
            guest_entry_reference: entry.guest_entry_reference,
          },
          timestampIso: entry.timestamp_summary.iso,
          sourceEventId: entry.guest_entry_reference.guest_entry_id,
        })
      );
    }

    for (const sourceBinding of sourceBindingHistory) {
      records.push(
        this.buildTimelineRecord({
          eventType: 'SOURCE_BINDING',
          eventStatusSummary: {
            status: sourceBinding.binding_status,
            source_resolution_outcome: sourceBinding.source_resolution_outcome,
            resolved_source_family: sourceBinding.resolved_source_family,
          },
          relatedReferences: {
            telegram_user_reference: telegramUserReference,
            guest_entry_reference: sourceBinding.guest_entry_reference || null,
            source_binding_reference: sourceBinding.source_binding_reference,
          },
          timestampIso: sourceBinding.timestamp_summary.iso,
          sourceEventId:
            sourceBinding.source_binding_reference.source_binding_event_id,
        })
      );
    }

    for (const attribution of attributionStartHistory) {
      const eventType =
        attribution.attribution_start_reference.event_type ===
        TELEGRAM_SELLER_ATTRIBUTION_SESSION_STARTED_EVENT_TYPE
          ? 'ATTRIBUTION_STARTED'
          : 'NO_ATTRIBUTION_OUTCOME';
      records.push(
        this.buildTimelineRecord({
          eventType,
          eventStatusSummary: {
            status: attribution.attribution_status,
            seller_attribution_active: attribution.seller_attribution_active,
            no_attribution_reason: attribution.no_attribution_reason,
          },
          relatedReferences: {
            telegram_user_reference: telegramUserReference,
            source_binding_reference: attribution.source_binding_reference || null,
            attribution_start_reference:
              attribution.attribution_start_reference || null,
            attribution_session_reference:
              attribution.attribution_session_reference || null,
          },
          timestampIso: attribution.timestamp_summary.iso,
          sourceEventId:
            attribution.attribution_start_reference.attribution_start_event_id,
        })
      );
    }

    for (const historyItem of bookingRequestHistory || []) {
      const bookingRequest = historyItem.booking_request || null;
      if (!bookingRequest) {
        continue;
      }

      const bookingRequestReference = buildBookingRequestReference(bookingRequest);
      const events = (historyItem.booking_request_events || []).slice().sort((left, right) =>
        Number(left.booking_request_event_id) - Number(right.booking_request_event_id)
      );
      const requestCreatedEvent =
        events.find((event) => event.event_type === 'REQUEST_CREATED') || null;

      if (requestCreatedEvent) {
        records.push(
          this.buildTimelineRecord({
            eventType: 'BOOKING_REQUEST_CREATED',
            eventStatusSummary: {
              status: 'recorded',
              source_event_type: 'REQUEST_CREATED',
            },
            relatedReferences: {
              telegram_user_reference: telegramUserReference,
              booking_request_reference: bookingRequestReference,
              booking_request_event_reference:
                buildBookingRequestEventReference(requestCreatedEvent),
            },
            timestampIso: requestCreatedEvent.event_at,
            bookingRequestId: bookingRequest.booking_request_id,
            sourceEventId: requestCreatedEvent.booking_request_event_id,
          })
        );
      } else {
        records.push(
          this.buildTimelineRecord({
            eventType: 'BOOKING_REQUEST_CREATED',
            eventStatusSummary: {
              status: 'derived_from_booking_request_created_at',
              source_event_type: 'REQUEST_CREATED',
            },
            relatedReferences: {
              telegram_user_reference: telegramUserReference,
              booking_request_reference: bookingRequestReference,
              booking_request_event_reference: null,
            },
            timestampIso: bookingRequest.created_at,
            bookingRequestId: bookingRequest.booking_request_id,
            sourceEventId: 0,
          })
        );
      }

      for (const event of events) {
        const timelineEventType = BOOKING_REQUEST_TIMELINE_EVENT_MAP[event.event_type];
        if (!timelineEventType || timelineEventType === 'BOOKING_REQUEST_CREATED') {
          continue;
        }

        const eventStatusSummary =
          timelineEventType === 'BRIDGE_OUTCOME'
            ? {
                status: BRIDGE_OUTCOME_BY_EVENT_TYPE[event.event_type],
                source_event_type: event.event_type,
                outcome_code:
                  event.event_payload?.outcome_code ||
                  event.event_payload?.bridge_execution_result?.bridge_execution_code ||
                  null,
                message:
                  event.event_payload?.message ||
                  event.event_payload?.bridge_execution_result?.bridge_execution_message ||
                  null,
              }
            : {
                status: 'recorded',
                source_event_type: event.event_type,
                request_status: bookingRequest.request_status,
              };

        records.push(
          this.buildTimelineRecord({
            eventType: timelineEventType,
            eventStatusSummary,
            relatedReferences: {
              telegram_user_reference: telegramUserReference,
              booking_request_reference: bookingRequestReference,
              booking_request_event_reference: buildBookingRequestEventReference(
                event
              ),
            },
            timestampIso: event.event_at,
            bookingRequestId: bookingRequest.booking_request_id,
            sourceEventId: event.booking_request_event_id,
          })
        );
      }
    }

    return records.sort(compareTimelineRecords);
  }

  buildTimelineResponse({
    profileView,
    requestedReference,
    readMode,
    sourceBindingHistory,
    attributionStartHistory,
  }) {
    const guestIdentity = profileView.guest_identity || {};
    const telegramUserId = normalizeString(guestIdentity.telegram_user_id);
    if (!telegramUserId) {
      rejectAggregate('guest identity is missing telegram_user_id');
    }

    const guestEntryHistory = this.buildGuestEntryHistory(profileView);
    const timelineRecords = this.buildGuestTimelineRecords({
      telegramUserReference: buildTelegramUserReference(telegramUserId),
      guestEntryHistory,
      sourceBindingHistory,
      attributionStartHistory,
      bookingRequestHistory: profileView.booking_request_history || [],
    });

    const orderedItems = timelineRecords.map((record, index) => ({
      sequence: index + 1,
      event_type: record.event_type,
      event_status_summary: record.event_status_summary,
      related_references: record.related_references,
      timestamp_summary: record.timestamp_summary,
    }));
    const latestTimestampSummary = orderedItems.length
      ? orderedItems[orderedItems.length - 1].timestamp_summary
      : null;

    return freezeTelegramHandoffValue({
      response_version: TELEGRAM_GUEST_TIMELINE_PROJECTION_VERSION,
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      timeline_scope: 'telegram_guest_journey',
      read_mode: readMode,
      requested_reference: requestedReference,
      telegram_user_summary: {
        guest_profile_id: guestIdentity.guest_profile_id,
        telegram_user_id: telegramUserId,
        display_name: normalizeString(guestIdentity.display_name),
        username: normalizeString(guestIdentity.username),
        language_code: normalizeString(guestIdentity.language_code),
      },
      requested_booking_request_id: profileView.requested_booking_request_id || null,
      timeline_order:
        'timestamp_asc_event_priority_asc_booking_request_id_asc_source_event_id_asc',
      item_count: orderedItems.length,
      timeline_items: orderedItems,
      latest_timestamp_summary: latestTimestampSummary,
    });
  }

  buildAggregateResponse({
    profileView,
    requestedReference,
    readMode,
    sourceBindingHistory,
    attributionStartHistory,
  }) {
    const guestIdentity = profileView.guest_identity || {};
    const telegramUserId = normalizeString(guestIdentity.telegram_user_id);
    if (!telegramUserId) {
      rejectAggregate('guest identity is missing telegram_user_id');
    }

    const guestEntryHistory = this.buildGuestEntryHistory(profileView);
    const attributionSessionHistory =
      this.buildAttributionSessionHistory(profileView);
    const latestRouteSummary = this.buildLatestRouteSummary(telegramUserId);
    const latestSourceSummary = this.buildLatestSourceSummary({
      sourceBindingHistory,
      guestEntryHistory,
    });
    const latestAttributionSummary = this.buildLatestAttributionSummary({
      attributionStartHistory,
      attributionSessionHistory,
    });
    const activeBookingRequestSummary = this.buildBookingRequestSummary(
      profileView.current_active_request || null
    );
    const latestBridgeLinkageSummary = this.buildBridgeLinkageSummary(profileView);
    const guestProfileStatusSummary = this.buildGuestProfileStatusSummary({
      activeBookingRequestSummary,
      latestBridgeLinkageSummary,
      bookingRequestHistoryCount: (profileView.booking_request_history || []).length,
    });
    const latestTimestampSummary = pickLatestTimestampSummary(
      guestIdentity.last_seen_at,
      latestSourceSummary.latest_timestamp_summary,
      latestAttributionSummary.latest_timestamp_summary,
      activeBookingRequestSummary?.latest_timestamp_summary,
      latestBridgeLinkageSummary?.latest_timestamp_summary,
      (profileView.booking_request_history || []).at(-1)?.booking_request?.last_status_at,
      (profileView.booking_request_history || []).at(-1)?.booking_request?.created_at
    );

    return freezeTelegramHandoffValue({
      response_version: TELEGRAM_GUEST_PROFILE_AGGREGATE_VERSION,
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      read_mode: readMode,
      requested_reference: requestedReference,
      resolved_by: profileView.resolved_by || [],
      telegram_user_summary: {
        guest_profile_id: guestIdentity.guest_profile_id,
        telegram_user_id: telegramUserId,
        display_name: normalizeString(guestIdentity.display_name),
        username: normalizeString(guestIdentity.username),
        language_code: normalizeString(guestIdentity.language_code),
        profile_status: normalizeString(guestIdentity.profile_status),
      },
      contact_phone_summary: buildContactPhoneSummary(guestIdentity.phone_e164),
      latest_route_summary: latestRouteSummary,
      latest_attribution_summary: latestAttributionSummary,
      latest_source_summary: latestSourceSummary,
      active_booking_request_summary: activeBookingRequestSummary,
      latest_bridge_linkage_summary: latestBridgeLinkageSummary,
      guest_profile_status_summary: guestProfileStatusSummary,
      latest_timestamp_summary: latestTimestampSummary,
      requested_booking_request_id: profileView.requested_booking_request_id || null,
      history_overview: {
        guest_entry_count: guestEntryHistory.length,
        source_binding_count: sourceBindingHistory.length,
        attribution_start_count: attributionStartHistory.length,
        attribution_session_count: attributionSessionHistory.length,
        booking_request_count: (profileView.booking_request_history || []).length,
      },
    });
  }

  resolveProfileViewByTelegramUser(input = {}) {
    const telegramUserReference = normalizeTelegramUserReferenceInput(input);
    const profileView = this.guestProfileService.readGuestProfileView({
      telegram_user_id: telegramUserReference.telegram_user_id,
    });
    return { profileView, requestedReference: telegramUserReference };
  }

  resolveProfileViewByBookingRequest(input = {}) {
    const bookingRequestReference = normalizeBookingRequestReferenceInput(input);
    const profileView = this.guestProfileService.readGuestProfileView({
      booking_request_id: bookingRequestReference.booking_request_id,
    });
    return { profileView, requestedReference: bookingRequestReference };
  }

  resolveProfileViewByContactPhone(input = {}) {
    const contactPhoneReference = normalizeContactPhoneReferenceInput(input);
    const profileView = this.guestProfileService.readGuestProfileView({
      phone_e164: contactPhoneReference.phone_e164,
    });
    return { profileView, requestedReference: contactPhoneReference };
  }

  buildSourceAndAttributionHistory(profileView) {
    const telegramUserId = normalizeString(profileView?.guest_identity?.telegram_user_id);
    if (!telegramUserId) {
      rejectAggregate('guest identity is missing telegram_user_id');
    }

    return {
      sourceBindingHistory: this.listSourceBindingHistory(telegramUserId),
      attributionStartHistory: this.listAttributionStartHistory(telegramUserId),
    };
  }

  readGuestProfileByTelegramUserReference(input = {}) {
    const { profileView, requestedReference } =
      this.resolveProfileViewByTelegramUser(input);
    const { sourceBindingHistory, attributionStartHistory } =
      this.buildSourceAndAttributionHistory(profileView);

    return this.buildAggregateResponse({
      profileView,
      requestedReference,
      readMode: 'telegram_user_reference',
      sourceBindingHistory,
      attributionStartHistory,
    });
  }

  readGuestProfileByBookingRequestReference(input = {}) {
    const { profileView, requestedReference } =
      this.resolveProfileViewByBookingRequest(input);
    const { sourceBindingHistory, attributionStartHistory } =
      this.buildSourceAndAttributionHistory(profileView);

    return this.buildAggregateResponse({
      profileView,
      requestedReference,
      readMode: 'booking_request_reference',
      sourceBindingHistory,
      attributionStartHistory,
    });
  }

  readGuestProfileByContactPhoneReference(input = {}) {
    const { profileView, requestedReference } =
      this.resolveProfileViewByContactPhone(input);
    const { sourceBindingHistory, attributionStartHistory } =
      this.buildSourceAndAttributionHistory(profileView);

    return this.buildAggregateResponse({
      profileView,
      requestedReference,
      readMode: 'contact_phone_reference',
      sourceBindingHistory,
      attributionStartHistory,
    });
  }

  readGuestTimelineByTelegramUserReference(input = {}) {
    const { profileView, requestedReference } =
      this.resolveProfileViewByTelegramUser(input);
    const { sourceBindingHistory, attributionStartHistory } =
      this.buildSourceAndAttributionHistory(profileView);

    return this.buildTimelineResponse({
      profileView,
      requestedReference,
      readMode: 'telegram_user_reference',
      sourceBindingHistory,
      attributionStartHistory,
    });
  }

  readGuestTimelineByBookingRequestReference(input = {}) {
    const { profileView, requestedReference } =
      this.resolveProfileViewByBookingRequest(input);
    const { sourceBindingHistory, attributionStartHistory } =
      this.buildSourceAndAttributionHistory(profileView);

    return this.buildTimelineResponse({
      profileView,
      requestedReference,
      readMode: 'booking_request_reference',
      sourceBindingHistory,
      attributionStartHistory,
    });
  }

  readGuestProfileAggregate(input = {}) {
    if (input?.booking_request_reference || input?.booking_request_id) {
      return this.readGuestProfileByBookingRequestReference(input);
    }
    if (input?.phone_e164 || input?.contact_phone_reference) {
      return this.readGuestProfileByContactPhoneReference(input);
    }
    return this.readGuestProfileByTelegramUserReference(input);
  }

  readGuestTimelineProjection(input = {}) {
    if (input?.booking_request_reference || input?.booking_request_id) {
      return this.readGuestTimelineByBookingRequestReference(input);
    }
    return this.readGuestTimelineByTelegramUserReference(input);
  }
}
