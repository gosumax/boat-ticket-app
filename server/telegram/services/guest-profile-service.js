import {
  freezeTelegramHandoffValue,
  TELEGRAM_HANDOFF_PREPARED_EVENT_TYPE,
} from '../../../shared/telegram/index.js';

const ACTIVE_BOOKING_REQUEST_STATUSES = new Set([
  'NEW',
  'ATTRIBUTED',
  'CONTACT_IN_PROGRESS',
  'HOLD_ACTIVE',
  'WAITING_PREPAYMENT',
  'PREPAYMENT_CONFIRMED',
]);

const TIMELINE_PROJECTION_VERSION = 'telegram_guest_profile_timeline_projection_v1';
const CANONICAL_LINKAGE_PROJECTION_VERSION =
  'telegram_guest_profile_canonical_linkage_projection_v1';

const CANONICAL_PRESALE_LINKAGE_COLUMNS = Object.freeze([
  'id',
  'status',
  'slot_uid',
  'boat_slot_id',
  'business_day',
]);

const CANONICAL_TICKET_LINKAGE_COLUMNS = Object.freeze([
  'id',
  'presale_id',
  'boat_slot_id',
  'status',
]);

const COMPLETED_CANCELLED_EXPIRED_REQUEST_STATUSES = new Set([
  'GUEST_CANCELLED',
  'HOLD_EXPIRED',
  'SELLER_NOT_REACHED',
  'CLOSED_UNCONVERTED',
]);

const TELEGRAM_REQUEST_OPEN_EVENT_TYPES = new Set([
  'REQUEST_CREATED',
  'HOLD_STARTED',
  'HOLD_EXTENDED',
]);

const TELEGRAM_CONFIRMED_EVENT_TYPES = new Set([
  'PREPAYMENT_CONFIRMED',
  'HANDOFF_PREPARED',
  'HANDOFF_QUEUED',
  'HANDOFF_STARTED',
  'REAL_PRESALE_HANDOFF_ATTEMPTED',
]);

const COMPLETED_CANCELLED_EXPIRED_EVENT_TYPES = new Set([
  'GUEST_CANCELLED',
  'HOLD_EXPIRED',
  'SELLER_NOT_REACHED',
  'HANDOFF_BLOCKED',
  'HANDOFF_CONSUMED',
  'REAL_PRESALE_HANDOFF_BLOCKED',
  'REAL_PRESALE_HANDOFF_FAILED',
  'POST_TRIP_SENT',
]);

const LINKED_TO_PRESALE_EVENT_TYPES = new Set([
  'REAL_PRESALE_HANDOFF_SUCCEEDED',
  'TICKET_SENT',
  'REMINDER_SENT',
  'BOARDING_SENT',
]);

const TICKET_TIMELINE_STATUSES_BY_EVENT_TYPE = Object.freeze({
  REQUEST_CREATED: 'REQUEST_RECEIVED',
  HOLD_STARTED: 'AWAITING_PREPAYMENT',
  HOLD_EXTENDED: 'AWAITING_PREPAYMENT',
  HOLD_EXPIRED: 'CANCELLED',
  GUEST_CANCELLED: 'CANCELLED',
  SELLER_NOT_REACHED: 'CANCELLED',
  PREPAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  HANDOFF_PREPARED: 'PAYMENT_CONFIRMED',
  HANDOFF_QUEUED: 'PAYMENT_CONFIRMED',
  HANDOFF_STARTED: 'PAYMENT_CONFIRMED',
  HANDOFF_BLOCKED: 'PAYMENT_CONFIRMED',
  HANDOFF_CONSUMED: 'PAYMENT_CONFIRMED',
  REAL_PRESALE_HANDOFF_SUCCEEDED: 'TICKET_READY',
  REAL_PRESALE_HANDOFF_BLOCKED: 'PAYMENT_CONFIRMED',
  REAL_PRESALE_HANDOFF_FAILED: 'PAYMENT_CONFIRMED',
  TICKET_SENT: 'TICKET_READY',
  REMINDER_SENT: 'REMINDER_SENT',
  BOARDING_SENT: 'BOARDING_READY',
});

const TRIP_TIMELINE_STATUSES_BY_EVENT_TYPE = Object.freeze({
  REQUEST_CREATED: 'request_created',
  HOLD_STARTED: 'hold_started',
  HOLD_EXTENDED: 'hold_extended',
  HOLD_EXPIRED: 'hold_expired',
  GUEST_CANCELLED: 'guest_cancelled',
  SELLER_NOT_REACHED: 'seller_not_reached',
  PREPAYMENT_CONFIRMED: 'prepayment_confirmed',
  HANDOFF_PREPARED: 'handoff_prepared',
  HANDOFF_QUEUED: 'handoff_queued',
  HANDOFF_STARTED: 'handoff_started',
  HANDOFF_BLOCKED: 'handoff_blocked',
  HANDOFF_CONSUMED: 'handoff_consumed',
  REAL_PRESALE_HANDOFF_ATTEMPTED: 'real_presale_handoff_attempted',
  REAL_PRESALE_HANDOFF_SUCCEEDED: 'real_presale_handoff_succeeded',
  REAL_PRESALE_HANDOFF_BLOCKED: 'real_presale_handoff_blocked',
  REAL_PRESALE_HANDOFF_FAILED: 'real_presale_handoff_failed',
  TICKET_SENT: 'ticket_sent',
  REMINDER_SENT: 'reminder_sent',
  BOARDING_SENT: 'boarding_sent',
  POST_TRIP_SENT: 'post_trip_sent',
});

function pickInput(input, camelKey, snakeKey) {
  return input?.[camelKey] ?? input?.[snakeKey] ?? null;
}

function normalizePositiveInteger(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`[TELEGRAM_GUEST_PROFILE] ${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeNullableInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = Number(value);
  return Number.isInteger(normalized) ? normalized : null;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function getCanonicalTableReasonPrefix(tableName) {
  if (tableName === 'presales') return 'canonical_presale';
  if (tableName === 'tickets') return 'canonical_ticket';

  return `canonical_${tableName}`;
}

function buildUnavailableTicketSummary(read_status = 'not_applicable') {
  return {
    read_status,
    total_count: null,
    status_counts: [],
  };
}

function buildTicketStatusSummary(tickets) {
  const counts = new Map();
  for (const ticket of tickets) {
    const status = normalizeString(ticket.status) || 'UNKNOWN';
    counts.set(status, (counts.get(status) || 0) + 1);
  }

  return {
    read_status: 'readable',
    total_count: tickets.length,
    status_counts: [...counts.entries()]
      .sort(([leftStatus], [rightStatus]) => (leftStatus < rightStatus ? -1 : 1))
      .map(([status, count]) => ({ status, count })),
  };
}

function uniqueSortedIntegers(values) {
  return [...new Set(values.map(normalizeNullableInteger).filter((value) => value !== null))]
    .sort((left, right) => left - right);
}

function buildEmptyTripLinkageSummary(derivation_status = 'not_applicable') {
  return {
    derivation_status,
    derivable: false,
    derivation_source: null,
    slot_uid: null,
    boat_slot_id: null,
    business_day: null,
    inconsistency_reasons: [],
  };
}

function buildTripLinkageSummary(presale, tickets = []) {
  const presaleSlotUid = normalizeString(presale?.slot_uid);
  const presaleBoatSlotId = normalizeNullableInteger(presale?.boat_slot_id);
  const presaleBusinessDay = normalizeString(presale?.business_day);
  const ticketBoatSlotIds = uniqueSortedIntegers(tickets.map((ticket) => ticket.boat_slot_id));
  const inconsistencyReasons = [];

  if (ticketBoatSlotIds.length > 1) {
    inconsistencyReasons.push('multiple_ticket_boat_slot_ids');
  }

  if (
    presaleBoatSlotId !== null &&
    ticketBoatSlotIds.length === 1 &&
    presaleBoatSlotId !== ticketBoatSlotIds[0]
  ) {
    inconsistencyReasons.push('presale_ticket_boat_slot_id_mismatch');
  }

  if (inconsistencyReasons.length > 0) {
    return {
      derivation_status: 'degraded_inconsistent',
      derivable: false,
      derivation_source: null,
      slot_uid: null,
      boat_slot_id: null,
      business_day: null,
      inconsistency_reasons: inconsistencyReasons,
    };
  }

  const derivedBoatSlotId = presaleBoatSlotId ?? ticketBoatSlotIds[0] ?? null;
  const derivable = Boolean(presaleSlotUid || derivedBoatSlotId !== null || presaleBusinessDay);
  const hasPresaleTripSignal = Boolean(
    presaleSlotUid || presaleBoatSlotId !== null || presaleBusinessDay
  );
  const hasTicketTripSignal = ticketBoatSlotIds.length === 1;
  const derivationSource = hasPresaleTripSignal && hasTicketTripSignal
    ? 'canonical_presale_and_tickets'
    : hasTicketTripSignal
      ? 'canonical_tickets'
      : 'canonical_presale';

  return {
    derivation_status: derivable ? 'derived' : 'not_derivable',
    derivable,
    derivation_source: derivable ? derivationSource : null,
    slot_uid: derivable ? presaleSlotUid : null,
    boat_slot_id: derivable ? derivedBoatSlotId : null,
    business_day: derivable ? presaleBusinessDay : null,
    inconsistency_reasons: [],
  };
}

function compareByNewestRequest(left, right) {
  if (left.booking_request.created_at !== right.booking_request.created_at) {
    return left.booking_request.created_at < right.booking_request.created_at ? 1 : -1;
  }

  return right.booking_request.booking_request_id - left.booking_request.booking_request_id;
}

function compareNullableTimestamp(left, right) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  if (left !== right) {
    return left < right ? -1 : 1;
  }

  return 0;
}

function compareTimelineRecords(left, right) {
  const timestampComparison = compareNullableTimestamp(left.occurred_at, right.occurred_at);
  if (timestampComparison !== 0) return timestampComparison;

  if (left.booking_request_id !== right.booking_request_id) {
    return left.booking_request_id - right.booking_request_id;
  }

  const leftEventId = left.source_event_id || 0;
  const rightEventId = right.source_event_id || 0;
  if (leftEventId !== rightEventId) {
    return leftEventId - rightEventId;
  }

  const leftKey = String(left.timeline_status || left.step || '');
  const rightKey = String(right.timeline_status || right.step || '');
  if (leftKey !== rightKey) {
    return leftKey < rightKey ? -1 : 1;
  }

  return 0;
}

function findFirstEvent(events, eventType) {
  return events.find((event) => event.event_type === eventType) || null;
}

function findLatestEvent(events, eventTypes) {
  const eventTypeSet = Array.isArray(eventTypes) ? new Set(eventTypes) : eventTypes;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (eventTypeSet.has(events[index].event_type)) {
      return events[index];
    }
  }

  return null;
}

function buildRequestedTripSnapshot(bookingRequest) {
  return {
    requested_trip_date: bookingRequest.requested_trip_date,
    requested_time_slot: bookingRequest.requested_time_slot,
    requested_seats: Number(bookingRequest.requested_seats || 0),
    requested_ticket_mix: bookingRequest.requested_ticket_mix || {},
  };
}

function buildEventSource(event) {
  return {
    source_type: 'telegram_booking_request_event',
    source_event_id: event.booking_request_event_id,
    source_event_type: event.event_type,
  };
}

export class TelegramGuestProfileService {
  constructor({
    guestProfiles,
    guestEntries,
    trafficSources,
    sourceQRCodes,
    sellerAttributionSessions,
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    handoffReadinessQueryService = null,
    handoffExecutionQueryService = null,
    realPresaleHandoffOrchestrationQueryService = null,
  }) {
    this.guestProfiles = guestProfiles;
    this.guestEntries = guestEntries;
    this.trafficSources = trafficSources;
    this.sourceQRCodes = sourceQRCodes;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.handoffReadinessQueryService = handoffReadinessQueryService;
    this.handoffExecutionQueryService = handoffExecutionQueryService;
    this.realPresaleHandoffOrchestrationQueryService =
      realPresaleHandoffOrchestrationQueryService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'guest-profile-service',
      status: 'query_ready',
      dependencyKeys: [
        'guestProfiles',
        'guestEntries',
        'trafficSources',
        'sourceQRCodes',
        'sellerAttributionSessions',
        'bookingRequests',
        'bookingHolds',
        'bookingRequestEvents',
        'handoffReadinessQueryService',
        'handoffExecutionQueryService',
        'realPresaleHandoffOrchestrationQueryService',
      ],
    });
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  readCanonicalTableColumns(tableName) {
    const reasonPrefix = getCanonicalTableReasonPrefix(tableName);
    if (!this.db?.prepare) {
      return {
        ok: false,
        degradation_reason: 'canonical_db_unavailable',
        columns: new Set(),
      };
    }

    try {
      const table = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(tableName);
      if (!table) {
        return {
          ok: false,
          degradation_reason: `${reasonPrefix}_table_unavailable`,
          columns: new Set(),
        };
      }

      return {
        ok: true,
        degradation_reason: null,
        columns: new Set(
          this.db
            .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
            .all()
            .map((column) => column.name)
        ),
      };
    } catch {
      return {
        ok: false,
        degradation_reason: `${reasonPrefix}_metadata_unreadable`,
        columns: new Set(),
      };
    }
  }

  readCanonicalPresale(presaleId) {
    const columnRead = this.readCanonicalTableColumns('presales');
    if (!columnRead.ok) {
      return {
        ok: false,
        degradation_reason: columnRead.degradation_reason,
        presale: null,
        status_readable: false,
      };
    }

    if (!columnRead.columns.has('id')) {
      return {
        ok: false,
        degradation_reason: 'canonical_presale_id_column_unavailable',
        presale: null,
        status_readable: false,
      };
    }

    const selectedColumns = CANONICAL_PRESALE_LINKAGE_COLUMNS.filter((column) =>
      columnRead.columns.has(column)
    );

    try {
      const presale = this.db
        .prepare(
          `
            SELECT ${selectedColumns.map(quoteIdentifier).join(', ')}
            FROM presales
            WHERE id = ?
          `
        )
        .get(presaleId);

      return {
        ok: true,
        degradation_reason: null,
        presale: presale
          ? {
              id: normalizeNullableInteger(presale.id),
              status: normalizeString(presale.status),
              slot_uid: normalizeString(presale.slot_uid),
              boat_slot_id: normalizeNullableInteger(presale.boat_slot_id),
              business_day: normalizeString(presale.business_day),
            }
          : null,
        status_readable: columnRead.columns.has('status'),
      };
    } catch {
      return {
        ok: false,
        degradation_reason: 'canonical_presale_read_failed',
        presale: null,
        status_readable: false,
      };
    }
  }

  readCanonicalTicketsForPresale(presaleId) {
    const columnRead = this.readCanonicalTableColumns('tickets');
    if (!columnRead.ok) {
      return {
        ok: false,
        degradation_reason: columnRead.degradation_reason,
        tickets: [],
      };
    }

    if (!columnRead.columns.has('presale_id')) {
      return {
        ok: false,
        degradation_reason: 'canonical_ticket_presale_id_column_unavailable',
        tickets: [],
      };
    }

    if (!columnRead.columns.has('status')) {
      return {
        ok: false,
        degradation_reason: 'canonical_ticket_status_column_unavailable',
        tickets: [],
      };
    }

    const selectedColumns = CANONICAL_TICKET_LINKAGE_COLUMNS.filter((column) =>
      columnRead.columns.has(column)
    );
    const orderByColumn = columnRead.columns.has('id') ? 'id' : 'status';

    try {
      const tickets = this.db
        .prepare(
          `
            SELECT ${selectedColumns.map(quoteIdentifier).join(', ')}
            FROM tickets
            WHERE presale_id = ?
            ORDER BY ${quoteIdentifier(orderByColumn)} ASC
          `
        )
        .all(presaleId)
        .map((ticket) => ({
          id: normalizeNullableInteger(ticket.id),
          presale_id: normalizeNullableInteger(ticket.presale_id),
          boat_slot_id: normalizeNullableInteger(ticket.boat_slot_id),
          status: normalizeString(ticket.status),
        }));

      return {
        ok: true,
        degradation_reason: null,
        tickets,
      };
    } catch {
      return {
        ok: false,
        degradation_reason: 'canonical_ticket_read_failed',
        tickets: [],
      };
    }
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      throw new Error(`[TELEGRAM_GUEST_PROFILE] Booking request not found: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  getGuestProfileOrThrow(guestProfileId) {
    const guestProfile = this.guestProfiles.getById(guestProfileId);
    if (!guestProfile) {
      throw new Error(`[TELEGRAM_GUEST_PROFILE] Guest profile not found: ${guestProfileId}`);
    }

    return guestProfile;
  }

  findGuestByTelegramUserId(telegramUserId) {
    const normalized = normalizeString(telegramUserId);
    if (!normalized) {
      return null;
    }

    const guestProfile = this.guestProfiles.findOneBy(
      { telegram_user_id: normalized },
      { orderBy: 'guest_profile_id ASC' }
    );
    if (!guestProfile) {
      throw new Error(`[TELEGRAM_GUEST_PROFILE] Guest profile not found for telegram_user_id: ${normalized}`);
    }

    return guestProfile;
  }

  findGuestByPhone(phoneE164) {
    const normalized = normalizeString(phoneE164);
    if (!normalized) {
      return null;
    }

    const matches = this.guestProfiles.listBy(
      { phone_e164: normalized },
      { orderBy: 'guest_profile_id ASC', limit: 2 }
    );

    if (matches.length > 1) {
      throw new Error(`[TELEGRAM_GUEST_PROFILE] Ambiguous guest profile phone identity: ${normalized}`);
    }
    if (matches.length === 0) {
      throw new Error(`[TELEGRAM_GUEST_PROFILE] Guest profile not found for phone_e164: ${normalized}`);
    }

    return matches[0];
  }

  resolveIdentityGuest(input = {}) {
    const guestProfileId = normalizePositiveInteger(
      pickInput(input, 'guestProfileId', 'guest_profile_id'),
      'guestProfileId'
    );
    const telegramUserId = pickInput(input, 'telegramUserId', 'telegram_user_id');
    const phoneE164 = pickInput(input, 'phoneE164', 'phone_e164');
    const candidates = [];

    if (guestProfileId) {
      candidates.push({
        source: 'guest_profile_id',
        guestProfile: this.getGuestProfileOrThrow(guestProfileId),
      });
    }

    const telegramGuest = this.findGuestByTelegramUserId(telegramUserId);
    if (telegramGuest) {
      candidates.push({
        source: 'telegram_user_id',
        guestProfile: telegramGuest,
      });
    }

    const phoneGuest = this.findGuestByPhone(phoneE164);
    if (phoneGuest) {
      candidates.push({
        source: 'phone_e164',
        guestProfile: phoneGuest,
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    const firstGuestProfileId = candidates[0].guestProfile.guest_profile_id;
    const hasMismatch = candidates.some(
      (candidate) => candidate.guestProfile.guest_profile_id !== firstGuestProfileId
    );

    if (hasMismatch) {
      throw new Error('[TELEGRAM_GUEST_PROFILE] Guest identity inputs resolve to different profiles');
    }

    return {
      guestProfile: candidates[0].guestProfile,
      resolvedBy: candidates.map((candidate) => candidate.source),
    };
  }

  resolveProfile(input = {}) {
    const bookingRequestId = normalizePositiveInteger(
      pickInput(input, 'bookingRequestId', 'booking_request_id'),
      'bookingRequestId'
    );
    const bookingRequest = bookingRequestId
      ? this.getBookingRequestOrThrow(bookingRequestId)
      : null;
    const identityResolution = this.resolveIdentityGuest(input);
    const guestProfile = identityResolution?.guestProfile ||
      (bookingRequest ? this.getGuestProfileOrThrow(bookingRequest.guest_profile_id) : null);

    if (!guestProfile) {
      throw new Error('[TELEGRAM_GUEST_PROFILE] Booking request or guest identity is required');
    }

    if (bookingRequest && bookingRequest.guest_profile_id !== guestProfile.guest_profile_id) {
      throw new Error('[TELEGRAM_GUEST_PROFILE] Booking request does not match guest identity');
    }

    return {
      guestProfile,
      requestedBookingRequest: bookingRequest,
      resolvedBy: [
        ...(bookingRequest ? ['booking_request_id'] : []),
        ...(identityResolution?.resolvedBy || []),
      ],
    };
  }

  buildGuestIdentity(guestProfile) {
    return {
      guest_profile_id: guestProfile.guest_profile_id,
      telegram_user_id: guestProfile.telegram_user_id,
      display_name: guestProfile.display_name,
      username: guestProfile.username,
      language_code: guestProfile.language_code,
      phone_e164: guestProfile.phone_e164,
      consent_status: guestProfile.consent_status,
      first_seen_at: guestProfile.first_seen_at,
      last_seen_at: guestProfile.last_seen_at,
      profile_status: guestProfile.profile_status,
    };
  }

  getTrafficSource(trafficSourceId) {
    return trafficSourceId ? this.trafficSources.getById(trafficSourceId) : null;
  }

  getSourceQRCode(sourceQRCodeId) {
    return sourceQRCodeId ? this.sourceQRCodes.getById(sourceQRCodeId) : null;
  }

  listSourceEntryHistory(guestProfileId) {
    return this.guestEntries
      .listBy(
        { guest_profile_id: guestProfileId },
        { orderBy: 'entry_at ASC, guest_entry_id ASC', limit: 500 }
      )
      .map((guestEntry) => ({
        guest_entry: guestEntry,
        traffic_source: this.getTrafficSource(guestEntry.traffic_source_id),
        source_qr_code: this.getSourceQRCode(guestEntry.source_qr_code_id),
      }));
  }

  listAttributionHistory(guestProfileId) {
    return this.sellerAttributionSessions
      .listBy(
        { guest_profile_id: guestProfileId },
        {
          orderBy: 'starts_at ASC, seller_attribution_session_id ASC',
          limit: 500,
        }
      )
      .map((sellerAttributionSession) => ({
        seller_attribution_session: sellerAttributionSession,
        traffic_source: this.getTrafficSource(sellerAttributionSession.traffic_source_id),
        source_qr_code: this.getSourceQRCode(sellerAttributionSession.source_qr_code_id),
      }));
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'event_at ASC, booking_request_event_id ASC', limit: 1000 }
    );
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  getPreparedEvent(bookingRequestId) {
    if (this.handoffReadinessQueryService?.getPreparedEvent) {
      return this.handoffReadinessQueryService.getPreparedEvent(bookingRequestId);
    }

    return this.bookingRequestEvents.findOneBy(
      {
        booking_request_id: bookingRequestId,
        event_type: TELEGRAM_HANDOFF_PREPARED_EVENT_TYPE,
      },
      { orderBy: 'booking_request_event_id DESC' }
    );
  }

  buildHandoffState(bookingRequest) {
    const preparedEvent = this.getPreparedEvent(bookingRequest.booking_request_id);
    if (!preparedEvent) {
      return null;
    }

    const executionState = this.handoffExecutionQueryService?.readExecutionState
      ? this.handoffExecutionQueryService.readExecutionState(bookingRequest.booking_request_id)
      : null;
    const orchestrationState =
      this.realPresaleHandoffOrchestrationQueryService?.readOrchestrationState
        ? this.realPresaleHandoffOrchestrationQueryService.readOrchestrationState(
            bookingRequest.booking_request_id
          )
        : null;

    return {
      handoff_prepared_event_id: preparedEvent.booking_request_event_id,
      handoff_state:
        preparedEvent.event_payload?.handoff_state || executionState?.handoff_ready_state || null,
      prepared_at: preparedEvent.event_at,
      attribution_locked: Boolean(preparedEvent.event_payload?.attribution_locked),
      current_execution_state: executionState?.current_execution_state || null,
      last_transition_at: executionState?.last_transition_at || null,
      last_transition_event_id: executionState?.last_transition_event_id || null,
      handoff_terminal: Boolean(executionState?.handoff_terminal),
      current_orchestration_outcome:
        orchestrationState?.current_orchestration_outcome || null,
      orchestration_attempt_count: orchestrationState?.orchestration_attempt_count || 0,
      last_attempt_at: orchestrationState?.last_attempt_at || null,
      last_result_at: orchestrationState?.last_result_at || null,
    };
  }

  buildPresaleLinkageState(bookingRequest) {
    return {
      linked_to_presale: Boolean(bookingRequest.confirmed_presale_id),
      confirmed_presale_id: bookingRequest.confirmed_presale_id || null,
      linkage_source: bookingRequest.confirmed_presale_id
        ? 'telegram_booking_request.confirmed_presale_id'
        : null,
      request_status: bookingRequest.request_status,
    };
  }

  buildBaseCanonicalLinkageState(bookingRequest) {
    return {
      projection_version: CANONICAL_LINKAGE_PROJECTION_VERSION,
      read_only: true,
      canonical_source: 'canonical_presales_and_tickets_read_only',
      confirmed_presale_id: bookingRequest.confirmed_presale_id || null,
      linkage_status: 'not_linked',
      degradation_reason: null,
      degradation_reasons: [],
      canonical_presale: {
        exists: false,
        presale_id: null,
        status: null,
      },
      linked_ticket_summary: buildUnavailableTicketSummary(),
      trip_linkage_summary: buildEmptyTripLinkageSummary(),
    };
  }

  buildCanonicalLinkageState(bookingRequest) {
    const confirmedPresaleId = normalizeNullableInteger(bookingRequest.confirmed_presale_id);
    const base = this.buildBaseCanonicalLinkageState(bookingRequest);
    if (!confirmedPresaleId) {
      return base;
    }

    const presaleRead = this.readCanonicalPresale(confirmedPresaleId);
    if (!presaleRead.ok) {
      return {
        ...base,
        linkage_status: 'degraded',
        degradation_reason: presaleRead.degradation_reason,
        degradation_reasons: [presaleRead.degradation_reason],
      };
    }

    if (!presaleRead.presale) {
      return {
        ...base,
        linkage_status: 'degraded',
        degradation_reason: 'canonical_presale_missing',
        degradation_reasons: ['canonical_presale_missing'],
      };
    }

    const ticketRead = this.readCanonicalTicketsForPresale(confirmedPresaleId);
    const tripLinkageSummary = ticketRead.ok
      ? buildTripLinkageSummary(presaleRead.presale, ticketRead.tickets)
      : buildTripLinkageSummary(presaleRead.presale, []);
    const degradationReasons = [
      ...(!presaleRead.status_readable ? ['canonical_presale_status_column_unavailable'] : []),
      ...(!ticketRead.ok ? [ticketRead.degradation_reason] : []),
      ...tripLinkageSummary.inconsistency_reasons,
    ];

    return {
      ...base,
      linkage_status: degradationReasons.length > 0 ? 'degraded' : 'enriched',
      degradation_reason: degradationReasons[0] || null,
      degradation_reasons: degradationReasons,
      canonical_presale: {
        exists: true,
        presale_id: presaleRead.presale.id,
        status: presaleRead.presale.status,
      },
      linked_ticket_summary: ticketRead.ok
        ? buildTicketStatusSummary(ticketRead.tickets)
        : buildUnavailableTicketSummary('unreadable'),
      trip_linkage_summary: tripLinkageSummary,
    };
  }

  buildBookingRequestHistoryItem(bookingRequest) {
    return {
      booking_request: bookingRequest,
      booking_hold: this.getHoldForRequest(bookingRequest.booking_request_id),
      booking_request_events: this.listRequestEvents(bookingRequest.booking_request_id),
      handoff_state: this.buildHandoffState(bookingRequest),
      presale_linkage_state: this.buildPresaleLinkageState(bookingRequest),
      canonical_linkage_state: this.buildCanonicalLinkageState(bookingRequest),
    };
  }

  listBookingRequestHistory(guestProfileId) {
    return this.bookingRequests
      .listBy(
        { guest_profile_id: guestProfileId },
        { orderBy: 'created_at ASC, booking_request_id ASC', limit: 500 }
      )
      .map((bookingRequest) => this.buildBookingRequestHistoryItem(bookingRequest));
  }

  resolveCurrentActiveRequest(bookingRequestHistory) {
    const activeRequests = bookingRequestHistory
      .filter((item) =>
        ACTIVE_BOOKING_REQUEST_STATUSES.has(item.booking_request.request_status)
      )
      .sort(compareByNewestRequest);

    return activeRequests[0] || null;
  }

  resolveTimelineStateGroup(bookingRequest, eventType = null) {
    if (eventType === 'PRESALE_LINKED') {
      return 'linked_to_presale';
    }

    if (COMPLETED_CANCELLED_EXPIRED_EVENT_TYPES.has(eventType)) {
      return 'completed_cancelled_expired';
    }

    if (TELEGRAM_REQUEST_OPEN_EVENT_TYPES.has(eventType)) {
      return 'telegram_request_open';
    }

    if (TELEGRAM_CONFIRMED_EVENT_TYPES.has(eventType)) {
      return 'telegram_confirmed_not_yet_ticketed';
    }

    if (LINKED_TO_PRESALE_EVENT_TYPES.has(eventType)) {
      return bookingRequest.confirmed_presale_id
        ? 'linked_to_presale'
        : 'telegram_confirmed_not_yet_ticketed';
    }

    if (bookingRequest.confirmed_presale_id) {
      return 'linked_to_presale';
    }

    if (COMPLETED_CANCELLED_EXPIRED_REQUEST_STATUSES.has(bookingRequest.request_status)) {
      return 'completed_cancelled_expired';
    }

    if (
      bookingRequest.request_status === 'PREPAYMENT_CONFIRMED' ||
      bookingRequest.request_status === 'CONFIRMED_TO_PRESALE'
    ) {
      return 'telegram_confirmed_not_yet_ticketed';
    }

    return 'telegram_request_open';
  }

  buildGuestTicketTimelineForRequest(historyItem) {
    const { booking_request: bookingRequest, booking_request_events: events } = historyItem;
    const records = events
      .map((event) => {
        const ticketStatus = TICKET_TIMELINE_STATUSES_BY_EVENT_TYPE[event.event_type];
        if (!ticketStatus) {
          return null;
        }

        return {
          booking_request_id: bookingRequest.booking_request_id,
          occurred_at: event.event_at,
          timeline_status: event.event_type.toLowerCase(),
          ticket_status: ticketStatus,
          state_group: this.resolveTimelineStateGroup(bookingRequest, event.event_type),
          request_status: bookingRequest.request_status,
          confirmed_presale_id: bookingRequest.confirmed_presale_id || null,
          ...buildEventSource(event),
        };
      })
      .filter(Boolean);

    if (
      bookingRequest.request_status === 'PREPAYMENT_CONFIRMED' &&
      !findFirstEvent(events, 'PREPAYMENT_CONFIRMED')
    ) {
      records.push({
        booking_request_id: bookingRequest.booking_request_id,
        occurred_at: bookingRequest.last_status_at,
        timeline_status: 'prepayment_confirmed',
        ticket_status: 'PAYMENT_CONFIRMED',
        state_group: 'telegram_confirmed_not_yet_ticketed',
        request_status: bookingRequest.request_status,
        confirmed_presale_id: null,
        source_type: 'telegram_booking_request',
        source_event_id: null,
        source_event_type: 'PREPAYMENT_CONFIRMED',
      });
    }

    if (
      COMPLETED_CANCELLED_EXPIRED_REQUEST_STATUSES.has(bookingRequest.request_status) &&
      !findFirstEvent(events, bookingRequest.request_status)
    ) {
      records.push({
        booking_request_id: bookingRequest.booking_request_id,
        occurred_at: bookingRequest.last_status_at,
        timeline_status: bookingRequest.request_status.toLowerCase(),
        ticket_status: 'CANCELLED',
        state_group: 'completed_cancelled_expired',
        request_status: bookingRequest.request_status,
        confirmed_presale_id: null,
        source_type: 'telegram_booking_request',
        source_event_id: null,
        source_event_type: bookingRequest.request_status,
      });
    }

    if (bookingRequest.confirmed_presale_id) {
      records.push({
        booking_request_id: bookingRequest.booking_request_id,
        occurred_at: bookingRequest.last_status_at,
        timeline_status: 'presale_linked',
        ticket_status: 'TICKET_READY',
        state_group: 'linked_to_presale',
        request_status: bookingRequest.request_status,
        confirmed_presale_id: bookingRequest.confirmed_presale_id,
        linkage_source: 'telegram_booking_request.confirmed_presale_id',
        source_type: 'telegram_booking_request',
        source_event_id: null,
        source_event_type: 'PRESALE_LINKED',
      });
    }

    return records.sort(compareTimelineRecords);
  }

  buildTripTimelineForRequest(historyItem) {
    const { booking_request: bookingRequest, booking_request_events: events } = historyItem;
    const tripSnapshot = buildRequestedTripSnapshot(bookingRequest);
    const records = events
      .map((event) => {
        const timelineStatus = TRIP_TIMELINE_STATUSES_BY_EVENT_TYPE[event.event_type];
        if (!timelineStatus) {
          return null;
        }

        return {
          booking_request_id: bookingRequest.booking_request_id,
          occurred_at: event.event_at,
          timeline_status: timelineStatus,
          state_group: this.resolveTimelineStateGroup(bookingRequest, event.event_type),
          request_status: bookingRequest.request_status,
          confirmed_presale_id: bookingRequest.confirmed_presale_id || null,
          requested_trip: tripSnapshot,
          ...buildEventSource(event),
        };
      })
      .filter(Boolean);

    if (bookingRequest.confirmed_presale_id) {
      records.push({
        booking_request_id: bookingRequest.booking_request_id,
        occurred_at: bookingRequest.last_status_at,
        timeline_status: 'presale_linked',
        state_group: 'linked_to_presale',
        request_status: bookingRequest.request_status,
        confirmed_presale_id: bookingRequest.confirmed_presale_id,
        linkage_source: 'telegram_booking_request.confirmed_presale_id',
        requested_trip: tripSnapshot,
        source_type: 'telegram_booking_request',
        source_event_id: null,
        source_event_type: 'PRESALE_LINKED',
      });
    }

    return records.sort(compareTimelineRecords);
  }

  resolveProgressionPhase(historyItem) {
    const { booking_request: bookingRequest, handoff_state: handoffState } = historyItem;
    const terminalHandoffWithoutPresale =
      handoffState?.handoff_terminal && !bookingRequest.confirmed_presale_id;

    if (bookingRequest.confirmed_presale_id) {
      return 'linked_to_presale';
    }

    if (
      terminalHandoffWithoutPresale ||
      COMPLETED_CANCELLED_EXPIRED_REQUEST_STATUSES.has(bookingRequest.request_status)
    ) {
      return 'completed_cancelled_expired';
    }

    if (
      handoffState ||
      bookingRequest.request_status === 'PREPAYMENT_CONFIRMED' ||
      bookingRequest.request_status === 'CONFIRMED_TO_PRESALE'
    ) {
      return 'telegram_confirmed_not_yet_ticketed';
    }

    return 'telegram_request_open';
  }

  buildProgressionStep({
    bookingRequest,
    step,
    stepStatus,
    stateGroup,
    event = null,
    occurredAt = null,
    confirmedPresaleId = null,
    sourceType = null,
    sourceEventType = null,
  }) {
    return {
      booking_request_id: bookingRequest.booking_request_id,
      step,
      step_status: stepStatus,
      state_group: stateGroup,
      occurred_at: event?.event_at || occurredAt || null,
      confirmed_presale_id: confirmedPresaleId || null,
      source_type: event ? 'telegram_booking_request_event' : sourceType,
      source_event_id: event?.booking_request_event_id || null,
      source_event_type: event?.event_type || sourceEventType || null,
    };
  }

  buildRequestProgression(historyItem) {
    const { booking_request: bookingRequest, booking_request_events: events } = historyItem;
    const requestCreatedEvent = findFirstEvent(events, 'REQUEST_CREATED');
    const prepaymentEvent = findFirstEvent(events, 'PREPAYMENT_CONFIRMED');
    const preparedEvent = findFirstEvent(events, 'HANDOFF_PREPARED');
    const queuedEvent = findFirstEvent(events, 'HANDOFF_QUEUED');
    const startedEvent = findFirstEvent(events, 'HANDOFF_STARTED');
    const completedEvent = findLatestEvent(events, new Set(['HANDOFF_CONSUMED']));
    const blockedEvent = findLatestEvent(events, new Set([
      'HANDOFF_BLOCKED',
      'REAL_PRESALE_HANDOFF_BLOCKED',
      'REAL_PRESALE_HANDOFF_FAILED',
    ]));
    const terminalRequestEvent = findLatestEvent(
      events,
      COMPLETED_CANCELLED_EXPIRED_REQUEST_STATUSES
    );
    const hasTerminalRequestStatus = COMPLETED_CANCELLED_EXPIRED_REQUEST_STATUSES.has(
      bookingRequest.request_status
    );
    const prepaymentCompleted = Boolean(
      prepaymentEvent ||
        bookingRequest.request_status === 'PREPAYMENT_CONFIRMED' ||
        bookingRequest.request_status === 'CONFIRMED_TO_PRESALE' ||
        bookingRequest.confirmed_presale_id
    );
    const currentPhase = this.resolveProgressionPhase(historyItem);
    const handoffCompletedStatus = blockedEvent ? 'blocked' : completedEvent ? 'completed' : (
      startedEvent && !bookingRequest.confirmed_presale_id ? 'pending' : 'not_applicable'
    );

    return {
      booking_request_id: bookingRequest.booking_request_id,
      request_status: bookingRequest.request_status,
      current_phase: currentPhase,
      terminal_reason:
        terminalRequestEvent?.event_type ||
        (hasTerminalRequestStatus ? bookingRequest.request_status : null) ||
        blockedEvent?.event_type ||
        null,
      confirmed_presale_id: bookingRequest.confirmed_presale_id || null,
      steps: [
        this.buildProgressionStep({
          bookingRequest,
          step: 'request_received',
          stepStatus: requestCreatedEvent ? 'completed' : 'derived',
          stateGroup: 'telegram_request_open',
          event: requestCreatedEvent,
          occurredAt: bookingRequest.created_at,
          sourceType: 'telegram_booking_request',
          sourceEventType: 'REQUEST_CREATED',
        }),
        this.buildProgressionStep({
          bookingRequest,
          step: 'telegram_confirmed_not_yet_ticketed',
          stepStatus: prepaymentCompleted
            ? 'completed'
            : hasTerminalRequestStatus
              ? 'not_applicable'
              : 'pending',
          stateGroup: 'telegram_confirmed_not_yet_ticketed',
          event: prepaymentEvent,
          occurredAt: prepaymentCompleted ? bookingRequest.last_status_at : null,
          sourceType: prepaymentCompleted ? 'telegram_booking_request' : null,
          sourceEventType: prepaymentCompleted ? 'PREPAYMENT_CONFIRMED' : null,
        }),
        this.buildProgressionStep({
          bookingRequest,
          step: 'handoff_prepared',
          stepStatus: preparedEvent
            ? 'completed'
            : prepaymentCompleted && currentPhase === 'telegram_confirmed_not_yet_ticketed'
              ? 'pending'
              : 'not_applicable',
          stateGroup: 'telegram_confirmed_not_yet_ticketed',
          event: preparedEvent,
        }),
        this.buildProgressionStep({
          bookingRequest,
          step: 'handoff_queued',
          stepStatus: queuedEvent
            ? 'completed'
            : preparedEvent && currentPhase === 'telegram_confirmed_not_yet_ticketed'
              ? 'pending'
              : 'not_applicable',
          stateGroup: 'telegram_confirmed_not_yet_ticketed',
          event: queuedEvent,
        }),
        this.buildProgressionStep({
          bookingRequest,
          step: 'handoff_started',
          stepStatus: startedEvent
            ? 'completed'
            : queuedEvent && currentPhase === 'telegram_confirmed_not_yet_ticketed'
              ? 'pending'
              : 'not_applicable',
          stateGroup: 'telegram_confirmed_not_yet_ticketed',
          event: startedEvent,
        }),
        this.buildProgressionStep({
          bookingRequest,
          step: 'handoff_completed_or_blocked',
          stepStatus: handoffCompletedStatus,
          stateGroup:
            handoffCompletedStatus === 'completed' || handoffCompletedStatus === 'blocked'
              ? 'completed_cancelled_expired'
              : 'telegram_confirmed_not_yet_ticketed',
          event: blockedEvent || completedEvent,
        }),
        this.buildProgressionStep({
          bookingRequest,
          step: 'linked_to_presale',
          stepStatus: bookingRequest.confirmed_presale_id
            ? 'completed'
            : currentPhase === 'telegram_confirmed_not_yet_ticketed'
              ? 'pending'
              : 'not_applicable',
          stateGroup: 'linked_to_presale',
          occurredAt: bookingRequest.confirmed_presale_id ? bookingRequest.last_status_at : null,
          confirmedPresaleId: bookingRequest.confirmed_presale_id || null,
          sourceType: bookingRequest.confirmed_presale_id
            ? 'telegram_booking_request'
            : null,
          sourceEventType: bookingRequest.confirmed_presale_id ? 'PRESALE_LINKED' : null,
        }),
      ],
    };
  }

  buildProjectionStateBuckets(progressions) {
    const buckets = {
      telegram_confirmed_not_yet_ticketed: [],
      linked_to_presale: [],
      completed_cancelled_expired: [],
    };

    for (const progression of progressions) {
      if (!buckets[progression.current_phase]) {
        continue;
      }

      buckets[progression.current_phase].push({
        booking_request_id: progression.booking_request_id,
        request_status: progression.request_status,
        confirmed_presale_id: progression.confirmed_presale_id,
        terminal_reason: progression.terminal_reason,
      });
    }

    return buckets;
  }

  buildTimelineProjection(bookingRequestHistory) {
    const requestProgressions = bookingRequestHistory.map((historyItem) =>
      this.buildRequestProgression(historyItem)
    );

    return {
      projection_version: TIMELINE_PROJECTION_VERSION,
      read_only: true,
      projection_source: {
        primary_data: 'telegram_booking_requests_and_events',
        presale_identifier_usage: 'telegram_booking_request.confirmed_presale_id_only',
        presale_domain_lookup_used: false,
        canonical_ticket_lookup_used: false,
      },
      guest_ticket_timeline: bookingRequestHistory
        .flatMap((historyItem) => this.buildGuestTicketTimelineForRequest(historyItem))
        .sort(compareTimelineRecords),
      trip_timeline_status_history: bookingRequestHistory
        .flatMap((historyItem) => this.buildTripTimelineForRequest(historyItem))
        .sort(compareTimelineRecords),
      request_to_handoff_to_presale_progression: requestProgressions,
      state_buckets: this.buildProjectionStateBuckets(requestProgressions),
    };
  }

  readGuestProfileView(input = {}) {
    const { guestProfile, requestedBookingRequest, resolvedBy } = this.resolveProfile(input);
    const bookingRequestHistory = this.listBookingRequestHistory(
      guestProfile.guest_profile_id
    );

    return freezeTelegramHandoffValue({
      guest_identity: this.buildGuestIdentity(guestProfile),
      source_entry_history: this.listSourceEntryHistory(guestProfile.guest_profile_id),
      attribution_history: this.listAttributionHistory(guestProfile.guest_profile_id),
      booking_request_history: bookingRequestHistory,
      current_active_request: this.resolveCurrentActiveRequest(bookingRequestHistory),
      timeline_projection: this.buildTimelineProjection(bookingRequestHistory),
      requested_booking_request_id: requestedBookingRequest?.booking_request_id || null,
      resolved_by: resolvedBy,
    });
  }
}
