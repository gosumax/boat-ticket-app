import { createHash } from 'node:crypto';

import { freezeTelegramHandoffValue } from '../../../shared/telegram/index.js';
import { TELEGRAM_GUEST_ROUTING_DECISION_VERSION } from './guest-routing-decision-service.js';

export const TELEGRAM_BOOKING_REQUEST_CREATION_RESULT_VERSION =
  'telegram_booking_request_creation_result.v1';

const ERROR_PREFIX = '[TELEGRAM_BOOKING_REQUEST_CREATION]';
const SERVICE_NAME = 'telegram_booking_request_creation_service';
const REQUEST_CREATED_EVENT_TYPE = 'REQUEST_CREATED';
const BOOKING_REQUEST_STATUS = 'NEW';
const REQUESTED_TRIP_SLOT_REFERENCE_TYPE =
  'telegram_requested_trip_slot_reference';
const FALLBACK_CREATION_EVENT_SCAN_LIMIT = 10000;
const REQUESTED_TICKET_MIX_KEYS = Object.freeze(['adult', 'teen', 'child']);

const ACTIVE_BOOKING_REQUEST_STATUSES = new Set([
  'NEW',
  'ATTRIBUTED',
  'CONTACT_IN_PROGRESS',
  'HOLD_ACTIVE',
  'WAITING_PREPAYMENT',
  'PREPAYMENT_CONFIRMED',
]);

function rejectCreation(message) {
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
    rejectCreation(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeNonNegativeInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    rejectCreation(`${label} must be a non-negative integer`);
  }

  return normalized;
}

function sortCreationValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortCreationValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortCreationValue(value[key])])
  );
}

function freezeSortedCreationValue(value) {
  return freezeTelegramHandoffValue(sortCreationValue(value));
}

function compareStableValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildStableHash(value) {
  return createHash('sha256')
    .update(JSON.stringify(sortCreationValue(value)))
    .digest('hex')
    .slice(0, 32);
}

function normalizeTimestampSummary(iso) {
  return freezeSortedCreationValue({
    iso,
    unix_seconds: Math.floor(Date.parse(iso) / 1000),
  });
}

function normalizeDateOnly(value, label) {
  const normalized = normalizeString(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    rejectCreation(`${label} must be YYYY-MM-DD`);
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    rejectCreation(`${label} must be a valid calendar date`);
  }

  return normalized;
}

function assertTimeSlotPart(value, label) {
  const [hourPart, minutePart] = value.split(':');
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    rejectCreation(`${label} must be a valid HH:mm time`);
  }
}

function normalizeTimeSlot(value, label) {
  const normalized = normalizeString(value);
  if (!normalized || !/^\d{2}:\d{2}(-\d{2}:\d{2})?$/.test(normalized)) {
    rejectCreation(`${label} must be HH:mm or HH:mm-HH:mm`);
  }

  for (const slotPart of normalized.split('-')) {
    assertTimeSlotPart(slotPart, label);
  }

  return normalized;
}

function normalizeOptionalPositiveInteger(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return normalizePositiveInteger(value, label);
}

function normalizeContactPhone(value) {
  const phone = normalizeString(value);
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    rejectCreation('contact_phone must be a valid E.164 phone number');
  }

  return phone;
}

function buildContactPhoneSummary(phoneE164) {
  return freezeSortedCreationValue({
    phone_e164: phoneE164,
    phone_last4: phoneE164.slice(-4),
  });
}

function pickTelegramGuestInput(input = {}) {
  return (
    input.telegram_guest ??
    input.telegramGuest ??
    input.telegram_guest_identity ??
    input.telegramGuestIdentity ??
    input.telegram_user_summary ??
    input.telegramUserSummary ??
    null
  );
}

function pickRoutingDecision(input = {}) {
  return (
    input.current_telegram_routing_decision ??
    input.currentTelegramRoutingDecision ??
    input.current_routing_decision ??
    input.currentRoutingDecision ??
    input.routing_decision ??
    input.routingDecision ??
    null
  );
}

function pickTripSlotReference(input = {}) {
  return (
    input.requested_trip_slot_reference ??
    input.requestedTripSlotReference ??
    input.requested_trip_reference ??
    input.requestedTripReference ??
    input.trip_slot_reference ??
    input.tripSlotReference ??
    input.requested_slot_reference ??
    input.requestedSlotReference ??
    null
  );
}

function pickRequestedSeats(input = {}) {
  return input.requested_seats ?? input.requestedSeats ?? input.seats ?? null;
}

function pickRequestedTicketMix(input = {}) {
  return (
    input.requested_ticket_mix ??
    input.requestedTicketMix ??
    input.ticket_mix ??
    input.ticketMix ??
    null
  );
}

function pickRequestedPrepaymentAmount(input = {}) {
  return (
    input.requested_prepayment_amount ??
    input.requestedPrepaymentAmount ??
    input.prepayment_amount ??
    input.prepaymentAmount ??
    0
  );
}

function pickContactPhone(input = {}) {
  return (
    input.contact_phone ??
    input.contactPhone ??
    input.contact_phone_e164 ??
    input.contactPhoneE164 ??
    null
  );
}

function sumRequestedTicketMix(ticketMix = {}) {
  return Object.values(ticketMix).reduce((sum, count) => sum + Number(count || 0), 0);
}

function normalizeRequestedTicketMix(value, expectedRequestedSeats = null) {
  if (value === null || value === undefined) {
    return freezeSortedCreationValue({});
  }
  if (!isPlainObject(value)) {
    rejectCreation('requested_ticket_mix must be an object');
  }

  const normalizedMix = {};
  let totalSeats = 0;
  const entries = Object.entries(value);

  for (const [rawKey, rawCount] of entries) {
    const normalizedKey = normalizeString(rawKey);
    if (!REQUESTED_TICKET_MIX_KEYS.includes(normalizedKey)) {
      rejectCreation(
        `requested_ticket_mix contains unsupported key: ${normalizedKey || rawKey}`
      );
    }
    const count = normalizeNonNegativeInteger(
      rawCount,
      `requested_ticket_mix.${normalizedKey}`
    );
    if (count > 0) {
      normalizedMix[normalizedKey] = count;
      totalSeats += count;
    }
  }

  if (entries.length === 0) {
    return freezeSortedCreationValue({});
  }

  if (expectedRequestedSeats !== null && totalSeats !== expectedRequestedSeats) {
    rejectCreation('requested_ticket_mix total must match requested_seats');
  }
  if (expectedRequestedSeats === null && entries.length > 0 && totalSeats <= 0) {
    rejectCreation('requested_ticket_mix must contain at least one selected seat');
  }

  return freezeSortedCreationValue(normalizedMix);
}

function normalizeTelegramUserSummary(value) {
  if (!isPlainObject(value)) {
    rejectCreation('telegram guest identity is required');
  }

  const telegramUserId = normalizeString(
    value.telegram_user_id ?? value.telegramUserId ?? value.id
  );
  if (!telegramUserId) {
    rejectCreation('telegram_user_id is required');
  }

  return freezeSortedCreationValue({
    telegram_user_id: telegramUserId,
    is_bot: Boolean(value.is_bot ?? value.isBot),
    first_name: normalizeString(value.first_name ?? value.firstName),
    last_name: normalizeString(value.last_name ?? value.lastName),
    username: normalizeString(value.username),
    language_code: normalizeString(value.language_code ?? value.languageCode),
    display_name: normalizeString(value.display_name ?? value.displayName) || telegramUserId,
  });
}

function normalizeTelegramUserSummaryFromGuestAndRouting(telegramGuest, routingDecision) {
  const routingSummary = normalizeTelegramUserSummary(
    routingDecision.telegram_user_summary
  );
  if (!telegramGuest) {
    return routingSummary;
  }

  const guestSummary = normalizeTelegramUserSummary(telegramGuest);
  if (guestSummary.telegram_user_id !== routingSummary.telegram_user_id) {
    rejectCreation('telegram guest identity does not match routing decision');
  }

  return freezeSortedCreationValue({
    ...routingSummary,
    display_name: guestSummary.display_name || routingSummary.display_name,
    first_name: guestSummary.first_name || routingSummary.first_name,
    is_bot: guestSummary.is_bot,
    language_code: guestSummary.language_code || routingSummary.language_code,
    last_name: guestSummary.last_name || routingSummary.last_name,
    username: guestSummary.username || routingSummary.username,
  });
}

function normalizeAttributionSessionReference(value) {
  if (!isPlainObject(value)) {
    rejectCreation('routing decision attribution_session_reference is required');
  }
  if (value.reference_type !== 'telegram_seller_attribution_session') {
    rejectCreation(
      `Unsupported attribution-session reference type: ${value.reference_type || 'unknown'}`
    );
  }

  return freezeSortedCreationValue({
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
    seller_id: normalizePositiveInteger(
      value.seller_id,
      'attribution_session_reference.seller_id'
    ),
    attribution_status: normalizeString(value.attribution_status),
  });
}

function normalizeCurrentRouteTarget(value) {
  if (!isPlainObject(value)) {
    rejectCreation('routing decision current_route_target is required');
  }

  return freezeSortedCreationValue({
    route_target_type: normalizeString(value.route_target_type),
    seller_id: normalizePositiveInteger(value.seller_id, 'current_route_target.seller_id'),
    seller_attribution_session_id: normalizePositiveInteger(
      value.seller_attribution_session_id,
      'current_route_target.seller_attribution_session_id'
    ),
  });
}

function normalizeRoutingDecision(value) {
  if (!isPlainObject(value)) {
    rejectCreation('routing decision is required');
  }
  if (value.response_version !== TELEGRAM_GUEST_ROUTING_DECISION_VERSION) {
    rejectCreation(
      `Unsupported routing decision version: ${value.response_version || 'unknown'}`
    );
  }
  if (value.read_only !== true || value.decision_only !== true) {
    rejectCreation('routing decision must be read-only decision data');
  }
  if (
    value.routing_status !== 'seller_attributed' ||
    value.seller_attribution_active !== true
  ) {
    rejectCreation(
      `Unsupported routing decision for create-request flow: ${value.routing_status || 'unknown'}`
    );
  }

  const currentRouteTarget = normalizeCurrentRouteTarget(value.current_route_target);
  if (currentRouteTarget.route_target_type !== 'seller') {
    rejectCreation(
      `Unsupported current route target: ${currentRouteTarget.route_target_type || 'unknown'}`
    );
  }

  const attributionSessionReference = normalizeAttributionSessionReference(
    value.attribution_session_reference
  );
  if (
    currentRouteTarget.seller_attribution_session_id !==
    attributionSessionReference.seller_attribution_session_id
  ) {
    rejectCreation('routing decision route target does not match attribution session');
  }
  if (currentRouteTarget.seller_id !== attributionSessionReference.seller_id) {
    rejectCreation('routing decision seller does not match attribution session');
  }

  return freezeSortedCreationValue({
    response_version: value.response_version,
    read_only: true,
    decision_only: true,
    decided_by: normalizeString(value.decided_by),
    routing_status: value.routing_status,
    telegram_user_summary: normalizeTelegramUserSummary(value.telegram_user_summary),
    guest_entry_reference: freezeSortedCreationValue(value.guest_entry_reference || null),
    source_binding_reference: freezeSortedCreationValue(
      value.source_binding_reference || null
    ),
    attribution_session_reference: attributionSessionReference,
    current_route_target: currentRouteTarget,
    current_route_reason: normalizeString(value.current_route_reason),
    seller_attribution_active: true,
    attribution_status: normalizeString(value.attribution_status),
    source_binding_status: normalizeString(value.source_binding_status),
    no_op_guards: freezeSortedCreationValue(value.no_op_guards || null),
  });
}

function normalizeTripSlotReference(input = {}) {
  const reference = pickTripSlotReference(input);
  const tripSlotInput = isPlainObject(reference)
    ? reference
    : {
        requested_trip_date: input.requested_trip_date ?? input.requestedTripDate,
        requested_time_slot: input.requested_time_slot ?? input.requestedTimeSlot,
        slot_uid: input.slot_uid ?? input.slotUid,
        boat_slot_id: input.boat_slot_id ?? input.boatSlotId,
      };

  if (!isPlainObject(tripSlotInput)) {
    rejectCreation('requested trip/slot reference is required');
  }

  const referenceType = normalizeString(tripSlotInput.reference_type);
  if (referenceType && referenceType !== REQUESTED_TRIP_SLOT_REFERENCE_TYPE) {
    rejectCreation(
      `Unsupported trip/slot reference type: ${referenceType || 'unknown'}`
    );
  }

  const requestedTripDate = normalizeDateOnly(
    tripSlotInput.requested_trip_date ??
      tripSlotInput.requestedTripDate ??
      tripSlotInput.trip_date ??
      tripSlotInput.tripDate ??
      tripSlotInput.business_day ??
      tripSlotInput.businessDay,
    'requested_trip_date'
  );
  const requestedTimeSlot = normalizeTimeSlot(
    tripSlotInput.requested_time_slot ??
      tripSlotInput.requestedTimeSlot ??
      tripSlotInput.time_slot ??
      tripSlotInput.timeSlot,
    'requested_time_slot'
  );

  return freezeSortedCreationValue({
    reference_type: REQUESTED_TRIP_SLOT_REFERENCE_TYPE,
    requested_trip_date: requestedTripDate,
    requested_time_slot: requestedTimeSlot,
    slot_uid: normalizeString(tripSlotInput.slot_uid ?? tripSlotInput.slotUid),
    boat_slot_id: normalizeOptionalPositiveInteger(
      tripSlotInput.boat_slot_id ?? tripSlotInput.boatSlotId,
      'boat_slot_id'
    ),
  });
}

function normalizeCreateInput(input = {}) {
  const routingDecision = normalizeRoutingDecision(pickRoutingDecision(input));
  const telegramUserSummary = normalizeTelegramUserSummaryFromGuestAndRouting(
    pickTelegramGuestInput(input),
    routingDecision
  );
  const requestedTripSlotReference = normalizeTripSlotReference(input);
  const rawRequestedSeats = pickRequestedSeats(input);
  const requestedSeats =
    rawRequestedSeats === null || rawRequestedSeats === undefined || rawRequestedSeats === ''
      ? null
      : normalizePositiveInteger(rawRequestedSeats, 'requested_seats');
  const requestedTicketMix = normalizeRequestedTicketMix(
    pickRequestedTicketMix(input),
    requestedSeats
  );
  const resolvedRequestedSeats =
    requestedSeats ??
    normalizePositiveInteger(sumRequestedTicketMix(requestedTicketMix), 'requested_seats');
  const requestedPrepaymentAmount = normalizeNonNegativeInteger(
    pickRequestedPrepaymentAmount(input),
    'requested_prepayment_amount'
  );
  const contactPhoneE164 = normalizeContactPhone(pickContactPhone(input));

  const signatureBase = freezeSortedCreationValue({
    response_version: TELEGRAM_BOOKING_REQUEST_CREATION_RESULT_VERSION,
    telegram_user_summary: telegramUserSummary,
    current_route_target: routingDecision.current_route_target,
    routing_decision_reference: {
      routing_status: routingDecision.routing_status,
      current_route_reason: routingDecision.current_route_reason,
      guest_entry_reference: routingDecision.guest_entry_reference,
      source_binding_reference: routingDecision.source_binding_reference,
      attribution_session_reference: routingDecision.attribution_session_reference,
    },
    requested_trip_slot_reference: requestedTripSlotReference,
    requested_seats: resolvedRequestedSeats,
    requested_ticket_mix: requestedTicketMix,
    requested_prepayment_amount: requestedPrepaymentAmount,
    contact_phone_summary: buildContactPhoneSummary(contactPhoneE164),
  });
  const idempotencyKey =
    normalizeString(input.idempotency_key ?? input.idempotencyKey) ||
    `telegram_booking_request_create:${buildStableHash(signatureBase)}`;

  return freezeSortedCreationValue({
    routing_decision: routingDecision,
    telegram_user_summary: telegramUserSummary,
    requested_trip_slot_reference: requestedTripSlotReference,
    requested_seats: resolvedRequestedSeats,
    requested_ticket_mix: requestedTicketMix,
    requested_prepayment_amount: requestedPrepaymentAmount,
    contact_phone_e164: contactPhoneE164,
    contact_phone_summary: buildContactPhoneSummary(contactPhoneE164),
    dedupe_key: idempotencyKey,
    idempotency_key: idempotencyKey,
    creation_signature: {
      ...signatureBase,
      dedupe_key: idempotencyKey,
      idempotency_key: idempotencyKey,
    },
  });
}

function buildBookingRequestReference(bookingRequest) {
  return freezeSortedCreationValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: bookingRequest.booking_request_id,
    guest_profile_id: bookingRequest.guest_profile_id,
    seller_attribution_session_id:
      bookingRequest.seller_attribution_session_id,
  });
}

function buildNoOpGuards() {
  return freezeSortedCreationValue({
    booking_request_created: true,
    booking_hold_created: false,
    seat_hold_created: false,
    prepayment_confirmed: false,
    presale_created: false,
    production_webhook_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  });
}

function buildCreationResult({ bookingRequest, normalizedInput, eventAt }) {
  return freezeSortedCreationValue({
    response_version: TELEGRAM_BOOKING_REQUEST_CREATION_RESULT_VERSION,
    booking_request_status: bookingRequest.request_status,
    telegram_user_summary: normalizedInput.telegram_user_summary,
    current_route_target: normalizedInput.routing_decision.current_route_target,
    booking_request_reference: buildBookingRequestReference(bookingRequest),
    requested_trip_slot_reference: normalizedInput.requested_trip_slot_reference,
    requested_seats: normalizedInput.requested_seats,
    requested_prepayment_amount: normalizedInput.requested_prepayment_amount,
    contact_phone_summary: normalizedInput.contact_phone_summary,
    dedupe_key: normalizedInput.dedupe_key,
    idempotency_key: normalizedInput.idempotency_key,
    event_timestamp_summary: normalizeTimestampSummary(eventAt),
  });
}

function buildEventPayload({ normalizedInput, result }) {
  return freezeSortedCreationValue({
    response_version: TELEGRAM_BOOKING_REQUEST_CREATION_RESULT_VERSION,
    booking_request_creation_source: SERVICE_NAME,
    booking_request_status: result.booking_request_status,
    telegram_user_summary: result.telegram_user_summary,
    current_route_target: result.current_route_target,
    routing_decision: normalizedInput.routing_decision,
    booking_request_reference: result.booking_request_reference,
    requested_trip_slot_reference: result.requested_trip_slot_reference,
    requested_seats: result.requested_seats,
    requested_prepayment_amount: result.requested_prepayment_amount,
    contact_phone_summary: result.contact_phone_summary,
    dedupe_key: result.dedupe_key,
    idempotency_key: result.idempotency_key,
    event_timestamp_summary: result.event_timestamp_summary,
    creation_signature: normalizedInput.creation_signature,
    no_op_guards: buildNoOpGuards(),
    creation_result: result,
  });
}

function buildResultFromEvent(event) {
  const result = event?.event_payload?.creation_result;
  if (!result) {
    rejectCreation(
      `Creation event result is missing: ${event?.booking_request_event_id || 'unknown'}`
    );
  }

  return freezeSortedCreationValue(result);
}

export class TelegramBookingRequestCreationService {
  constructor({
    guestProfiles,
    sellerAttributionSessions,
    bookingRequests,
    bookingRequestEvents,
    now = () => new Date(),
  }) {
    this.guestProfiles = guestProfiles;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.bookingRequests = bookingRequests;
    this.bookingRequestEvents = bookingRequestEvents;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'booking-request-creation-service',
      status: 'create_request_persistence_ready',
      dependencyKeys: [
        'guestProfiles',
        'sellerAttributionSessions',
        'bookingRequests',
        'bookingRequestEvents',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectCreation('creation clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  listCreationEvents() {
    this.bookingRequestEvents.assertReady();
    if (this.bookingRequestEvents.db?.prepare) {
      return this.bookingRequestEvents.db
        .prepare(
          `
            SELECT *
            FROM telegram_booking_request_events
            WHERE event_type = ?
            ORDER BY booking_request_event_id ASC
          `
        )
        .all(REQUEST_CREATED_EVENT_TYPE)
        .map((row) => this.bookingRequestEvents.deserializeRow(row));
    }

    return this.bookingRequestEvents
      .listBy(
        { event_type: REQUEST_CREATED_EVENT_TYPE },
        {
          orderBy: 'booking_request_event_id ASC',
          limit: FALLBACK_CREATION_EVENT_SCAN_LIMIT,
        }
      )
      .filter(
        (event) =>
          event.event_payload?.booking_request_creation_source === SERVICE_NAME
      );
  }

  resolveIdempotentCreationEvent(normalizedInput) {
    const matchingEvents = this.listCreationEvents().filter(
      (event) =>
        event.event_payload?.booking_request_creation_source === SERVICE_NAME &&
        event.event_payload?.idempotency_key === normalizedInput.idempotency_key
    );
    if (matchingEvents.length === 0) {
      return null;
    }

    const matchingEvent = matchingEvents.find((event) =>
      compareStableValues(
        event.event_payload?.creation_signature,
        normalizedInput.creation_signature
      )
    );
    if (matchingEvent) {
      return matchingEvent;
    }

    rejectCreation(
      `Idempotency conflict for booking request creation: ${normalizedInput.idempotency_key}`
    );
  }

  getGuestProfileOrThrow(guestProfileId) {
    const guestProfile = this.guestProfiles.getById(guestProfileId);
    if (!guestProfile) {
      rejectCreation(`Guest profile not found: ${guestProfileId}`);
    }

    return guestProfile;
  }

  getSellerAttributionSessionOrThrow(sellerAttributionSessionId) {
    const session = this.sellerAttributionSessions.getById(
      sellerAttributionSessionId
    );
    if (!session) {
      rejectCreation(
        `Seller attribution session not found: ${sellerAttributionSessionId}`
      );
    }

    return session;
  }

  assertRoutingMatchesPersistedState(normalizedInput) {
    const attributionReference =
      normalizedInput.routing_decision.attribution_session_reference;
    const session = this.getSellerAttributionSessionOrThrow(
      attributionReference.seller_attribution_session_id
    );
    if (session.guest_profile_id !== attributionReference.guest_profile_id) {
      rejectCreation('routing decision attribution session guest mismatch');
    }
    if (session.seller_id !== attributionReference.seller_id) {
      rejectCreation('routing decision attribution session seller mismatch');
    }

    const guestProfile = this.getGuestProfileOrThrow(
      attributionReference.guest_profile_id
    );
    if (
      normalizeString(guestProfile.telegram_user_id) !==
      normalizedInput.telegram_user_summary.telegram_user_id
    ) {
      rejectCreation('routing decision guest profile does not match Telegram user');
    }

    return { guestProfile, session };
  }

  hasActiveRequestForGuest(guestProfileId) {
    return this.bookingRequests
      .listBy(
        { guest_profile_id: guestProfileId },
        { orderBy: 'booking_request_id DESC', limit: 100 }
      )
      .some((request) => ACTIVE_BOOKING_REQUEST_STATUSES.has(request.request_status));
  }

  assertNoActiveRequestForGuest(guestProfileId) {
    if (this.hasActiveRequestForGuest(guestProfileId)) {
      rejectCreation(`Guest already has an active booking request: ${guestProfileId}`);
    }
  }

  createBookingRequest(input = {}) {
    const runCreation = () => {
      const normalizedInput = normalizeCreateInput(input);
      const idempotentEvent = this.resolveIdempotentCreationEvent(normalizedInput);
      if (idempotentEvent) {
        return buildResultFromEvent(idempotentEvent);
      }

      const { guestProfile, session } =
        this.assertRoutingMatchesPersistedState(normalizedInput);
      this.assertNoActiveRequestForGuest(guestProfile.guest_profile_id);

      const createdAt = this.nowIso();
      const bookingRequest = this.bookingRequests.create({
        guest_profile_id: guestProfile.guest_profile_id,
        seller_attribution_session_id: session.seller_attribution_session_id,
        requested_trip_date:
          normalizedInput.requested_trip_slot_reference.requested_trip_date,
        requested_time_slot:
          normalizedInput.requested_trip_slot_reference.requested_time_slot,
        requested_seats: normalizedInput.requested_seats,
        requested_ticket_mix: normalizedInput.requested_ticket_mix,
        contact_phone_e164: normalizedInput.contact_phone_e164,
        request_status: BOOKING_REQUEST_STATUS,
        created_at: createdAt,
        last_status_at: createdAt,
      });
      const result = buildCreationResult({
        bookingRequest,
        normalizedInput,
        eventAt: createdAt,
      });

      this.bookingRequestEvents.create({
        booking_request_id: bookingRequest.booking_request_id,
        booking_hold_id: null,
        seller_attribution_session_id: session.seller_attribution_session_id,
        event_type: REQUEST_CREATED_EVENT_TYPE,
        event_at: createdAt,
        actor_type: 'telegram_guest',
        actor_id: normalizedInput.telegram_user_summary.telegram_user_id,
        event_payload: buildEventPayload({ normalizedInput, result }),
      });

      return result;
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runCreation)();
    }

    return runCreation();
  }

  create(input = {}) {
    return this.createBookingRequest(input);
  }
}
