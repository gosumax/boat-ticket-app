import { createHash } from 'node:crypto';

import {
  buildTelegramContactPhoneSummary,
  buildTelegramLatestTimestampSummary,
  freezeTelegramHandoffValue,
} from '../../../shared/telegram/index.js';
import { TELEGRAM_GUEST_ROUTING_DECISION_VERSION } from './guest-routing-decision-service.js';
import {
  freezeMiniAppValue,
  normalizeMiniAppTripSlotReference,
  normalizeString,
} from './mini-app-trip-query-shared.js';
import { resolveTelegramBuyerSellerContactSummary } from './buyer-seller-contact-shared.js';

export const TELEGRAM_MINI_APP_BOOKING_SUBMIT_RESULT_VERSION =
  'telegram_mini_app_booking_submit_result.v1';
export const TELEGRAM_MINI_APP_BOOKING_SUBMIT_STATUSES = Object.freeze([
  'submitted_with_hold',
  'submit_blocked',
  'submit_failed_validation',
]);

const ERROR_PREFIX = '[TELEGRAM_MINI_APP_BOOKING_SUBMIT]';
const SERVICE_NAME = 'telegram_mini_app_booking_submit_orchestration_service';
const REQUESTED_TICKET_MIX_KEYS = Object.freeze(['adult', 'teen', 'child']);

function rejectSubmit(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectSubmit(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeNonNegativeInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    rejectSubmit(`${label} must be a non-negative integer`);
  }

  return normalized;
}

function normalizeContactPhone(value) {
  const phone = normalizeString(value);
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    rejectSubmit('contact_phone must be a valid E.164 phone number');
  }

  return phone;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickTelegramGuestInput(input = {}) {
  const candidate =
    input.telegram_guest ??
    input.telegramGuest ??
    input.telegram_guest_identity ??
    input.telegramGuestIdentity ??
    input.telegram_user_summary ??
    input.telegramUserSummary ??
    null;
  if (candidate) {
    return candidate;
  }

  const telegramUserId = normalizeString(
    input.telegram_user_id ?? input.telegramUserId ?? null
  );
  if (!telegramUserId) {
    return null;
  }

  return { telegram_user_id: telegramUserId };
}

function normalizeTelegramGuestSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    rejectSubmit('telegram guest identity is required');
  }

  const telegramUserId = normalizeString(
    value.telegram_user_id ?? value.telegramUserId ?? value.id
  );
  if (!telegramUserId) {
    rejectSubmit('telegram_user_id is required');
  }

  return freezeMiniAppValue({
    telegram_user_id: telegramUserId,
    is_bot: Boolean(value.is_bot ?? value.isBot),
    first_name: normalizeString(value.first_name ?? value.firstName),
    last_name: normalizeString(value.last_name ?? value.lastName),
    username: normalizeString(value.username),
    language_code: normalizeString(value.language_code ?? value.languageCode),
    display_name: normalizeString(value.display_name ?? value.displayName) || telegramUserId,
  });
}

function pickTripSlotReference(input = {}) {
  return (
    input.selected_trip_slot_reference ??
    input.selectedTripSlotReference ??
    input.requested_trip_slot_reference ??
    input.requestedTripSlotReference ??
    input.trip_slot_reference ??
    input.tripSlotReference ??
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

function pickCustomerName(input = {}) {
  return (
    input.customer_name ??
    input.customerName ??
    input.buyer_name ??
    input.buyerName ??
    null
  );
}

function normalizeIdempotencyKey(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function sumRequestedTicketMix(ticketMix = {}) {
  return Object.values(ticketMix).reduce((sum, count) => sum + Number(count || 0), 0);
}

function normalizeRequestedTicketMix(value, expectedRequestedSeatsCount = null) {
  if (value === null || value === undefined) {
    return freezeMiniAppValue({});
  }
  if (!isPlainObject(value)) {
    throwSubmitValidation('invalid_ticket_mix', 'requested_ticket_mix must be an object');
  }

  const normalizedMix = {};
  let totalSeats = 0;
  const entries = Object.entries(value);

  for (const [rawKey, rawCount] of entries) {
    const normalizedKey = normalizeString(rawKey);
    if (!REQUESTED_TICKET_MIX_KEYS.includes(normalizedKey)) {
      throwSubmitValidation(
        'invalid_ticket_mix',
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
    return freezeMiniAppValue({});
  }

  if (expectedRequestedSeatsCount !== null && totalSeats !== expectedRequestedSeatsCount) {
    throwSubmitValidation(
      'invalid_ticket_mix',
      'requested_ticket_mix total must match requested_seats'
    );
  }
  if (expectedRequestedSeatsCount === null && entries.length > 0 && totalSeats <= 0) {
    throwSubmitValidation(
      'invalid_ticket_mix',
      'requested_ticket_mix must contain at least one selected seat'
    );
  }

  return freezeMiniAppValue(normalizedMix);
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])])
  );
}

function buildStableHash(value) {
  return createHash('sha256')
    .update(JSON.stringify(sortValue(value)))
    .digest('hex')
    .slice(0, 32);
}

function createSubmitOutcomeError({
  submitStatus,
  reasonCode,
  message,
}) {
  const error = new Error(message);
  error.submit_status = submitStatus;
  error.submit_reason_code = reasonCode;
  return error;
}

function throwSubmitValidation(reasonCode, message) {
  throw createSubmitOutcomeError({
    submitStatus: 'submit_failed_validation',
    reasonCode,
    message,
  });
}

function throwSubmitBlocked(reasonCode, message) {
  throw createSubmitOutcomeError({
    submitStatus: 'submit_blocked',
    reasonCode,
    message,
  });
}

function mapServiceErrorToSubmitOutcome(error) {
  const message = normalizeString(error?.message) || 'submit failed';

  if (message.includes('Idempotency conflict')) {
    return {
      submit_status: 'submit_blocked',
      submit_reason_code: 'idempotency_conflict',
      message,
    };
  }
  if (message.includes('Guest already has an active booking request')) {
    return {
      submit_status: 'submit_blocked',
      submit_reason_code: 'duplicate_active_request',
      message,
    };
  }
  if (
    message.includes('Duplicate active hold') ||
    message.includes('already has a hold')
  ) {
    return {
      submit_status: 'submit_blocked',
      submit_reason_code: 'duplicate_active_request',
      message,
    };
  }
  if (
    message.includes('routing decision') ||
    message.includes('No active seller path') ||
    message.includes('seller_attributed')
  ) {
    return {
      submit_status: 'submit_blocked',
      submit_reason_code: 'no_valid_routing_state',
      message,
    };
  }
  if (message.includes('trip/slot reference') || message.includes('slot_uid')) {
    return {
      submit_status: 'submit_failed_validation',
      submit_reason_code: 'invalid_trip_slot_reference',
      message,
    };
  }
  if (message.includes('requested_ticket_mix')) {
    return {
      submit_status: 'submit_failed_validation',
      submit_reason_code: 'invalid_ticket_mix',
      message,
    };
  }
  if (message.includes('requested_seats')) {
    return {
      submit_status: 'submit_failed_validation',
      submit_reason_code: 'invalid_seats_count',
      message,
    };
  }
  if (message.includes('requested_prepayment_amount')) {
    return {
      submit_status: 'submit_failed_validation',
      submit_reason_code: 'invalid_requested_prepayment_amount',
      message,
    };
  }
  if (
    message.includes('available seats') ||
    message.includes('Недостаточно мест') ||
    message.includes('not enough seats')
  ) {
    return {
      submit_status: 'submit_blocked',
      submit_reason_code: 'not_enough_seats',
      message,
    };
  }
  if (message.includes('contact_phone')) {
    return {
      submit_status: 'submit_failed_validation',
      submit_reason_code: 'invalid_contact_phone',
      message,
    };
  }
  if (message.includes('customer_name')) {
    return {
      submit_status: 'submit_failed_validation',
      submit_reason_code: 'invalid_customer_name',
      message,
    };
  }
  if (
    message.includes('telegram guest identity') ||
    message.includes('telegram_user_id is required')
  ) {
    return {
      submit_status: 'submit_failed_validation',
      submit_reason_code: 'no_valid_telegram_guest_identity',
      message,
    };
  }

  return null;
}

function buildSubmitResult({
  submitStatus,
  submitReasonCode = null,
  submitMessage = null,
  telegramUserSummary = null,
  bookingRequestReference = null,
  holdReference = null,
  currentRouteTarget = null,
  selectedTripSlotReference = null,
  requestedSeatsCount = null,
  requestedPrepaymentAmount = null,
  contactPhoneSummary = null,
  sellerContactSummary = null,
  holdStartedAtSummary = null,
  holdExpiresAtSummary = null,
  latestTimestampIso = null,
  idempotencyKey = null,
}) {
  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_MINI_APP_BOOKING_SUBMIT_RESULT_VERSION,
    submit_source: SERVICE_NAME,
    submit_status: submitStatus,
    submit_reason_code: submitReasonCode,
    submit_message: submitMessage,
    telegram_user_summary: telegramUserSummary,
    booking_request_reference: bookingRequestReference,
    hold_reference: holdReference,
    current_route_target: currentRouteTarget,
    selected_trip_slot_reference: selectedTripSlotReference,
    requested_seats_count: requestedSeatsCount,
    requested_prepayment_amount: requestedPrepaymentAmount,
    contact_phone_summary: contactPhoneSummary,
    seller_contact_summary: sellerContactSummary,
    hold_started_at_summary: holdStartedAtSummary,
    hold_expires_at_summary: holdExpiresAtSummary,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(latestTimestampIso),
    idempotency_key: idempotencyKey,
    dedupe_key: idempotencyKey,
  });
}

export class TelegramMiniAppBookingSubmitOrchestrationService {
  constructor({
    guestProfiles,
    sellerAttributionSessions,
    trafficSources,
    sourceQRCodes,
    sourceRegistryItems,
    guestRoutingDecisionService,
    bookingRequestCreationService,
    bookingRequestHoldActivationService,
    miniAppTripCardQueryService,
    now = () => new Date(),
  }) {
    this.guestProfiles = guestProfiles;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.trafficSources = trafficSources;
    this.sourceQRCodes = sourceQRCodes;
    this.sourceRegistryItems = sourceRegistryItems;
    this.guestRoutingDecisionService = guestRoutingDecisionService;
    this.bookingRequestCreationService = bookingRequestCreationService;
    this.bookingRequestHoldActivationService = bookingRequestHoldActivationService;
    this.miniAppTripCardQueryService = miniAppTripCardQueryService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'mini-app-booking-submit-orchestration-service',
      status: 'mini_app_booking_submit_orchestration_ready',
      dependencyKeys: [
        'guestProfiles',
        'sellerAttributionSessions',
        'trafficSources',
        'sourceQRCodes',
        'sourceRegistryItems',
        'guestRoutingDecisionService',
        'bookingRequestCreationService',
        'bookingRequestHoldActivationService',
        'miniAppTripCardQueryService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectSubmit('submit orchestration clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.guestProfiles?.db || null;
  }

  resolveSellerContactSummary(creationResult = null) {
    return resolveTelegramBuyerSellerContactSummary({
      db: this.db,
      sellerAttributionSessions: this.sellerAttributionSessions,
      trafficSources: this.trafficSources,
      sourceQRCodes: this.sourceQRCodes,
      sourceRegistryItems: this.sourceRegistryItems,
      sellerAttributionSessionId:
        creationResult?.booking_request_reference?.seller_attribution_session_id ??
        creationResult?.current_route_target?.seller_attribution_session_id ??
        null,
      sellerId: creationResult?.current_route_target?.seller_id ?? null,
    });
  }

  resolveGuestSummaryOrThrow(input = {}) {
    const guestInput = pickTelegramGuestInput(input);
    const telegramGuest = normalizeTelegramGuestSummary(guestInput);
    const customerName = normalizeString(pickCustomerName(input));
    if (!customerName) {
      throwSubmitValidation('invalid_customer_name', 'customer_name is required');
    }
    const guestProfile = this.guestProfiles.findOneBy(
      { telegram_user_id: telegramGuest.telegram_user_id },
      { orderBy: 'guest_profile_id ASC' }
    );
    if (!guestProfile) {
      throwSubmitValidation(
        'no_valid_telegram_guest_identity',
        `No valid Telegram guest identity: ${telegramGuest.telegram_user_id}`
      );
    }

    if (normalizeString(guestProfile.display_name) !== customerName) {
      this.guestProfiles.updateById(guestProfile.guest_profile_id, {
        display_name: customerName,
      });
    }

    return freezeMiniAppValue({
      ...telegramGuest,
      username: telegramGuest.username || normalizeString(guestProfile.username),
      language_code:
        telegramGuest.language_code || normalizeString(guestProfile.language_code),
      display_name: customerName,
    });
  }

  normalizeSubmitInput(input = {}) {
    const telegramUserSummary = this.resolveGuestSummaryOrThrow(input);
    const selectedTripSlotReference = normalizeMiniAppTripSlotReference(
      pickTripSlotReference(input),
      (message) => {
        throwSubmitValidation('invalid_trip_slot_reference', message);
      },
      { requireDateTime: true }
    );
    const rawRequestedSeats = pickRequestedSeats(input);
    const requestedSeatsCount =
      rawRequestedSeats === null || rawRequestedSeats === undefined || rawRequestedSeats === ''
        ? null
        : normalizePositiveInteger(rawRequestedSeats, 'requested_seats');
    const requestedTicketMix = normalizeRequestedTicketMix(
      pickRequestedTicketMix(input),
      requestedSeatsCount
    );
    const resolvedRequestedSeatsCount =
      requestedSeatsCount ??
      normalizePositiveInteger(sumRequestedTicketMix(requestedTicketMix), 'requested_seats');
    const requestedPrepaymentAmount = normalizeNonNegativeInteger(
      pickRequestedPrepaymentAmount(input),
      'requested_prepayment_amount'
    );
    const contactPhoneE164 = normalizeContactPhone(pickContactPhone(input));
    const contactPhoneSummary = buildTelegramContactPhoneSummary(contactPhoneE164);
    const explicitIdempotencyKey = normalizeIdempotencyKey(
      input.idempotency_key ?? input.idempotencyKey
    );

    return freezeMiniAppValue({
      telegram_user_summary: telegramUserSummary,
      selected_trip_slot_reference: selectedTripSlotReference,
      requested_seats_count: resolvedRequestedSeatsCount,
      requested_ticket_mix: requestedTicketMix,
      requested_prepayment_amount: requestedPrepaymentAmount,
      contact_phone_e164: contactPhoneE164,
      contact_phone_summary: contactPhoneSummary,
      explicit_idempotency_key: explicitIdempotencyKey,
    });
  }

  readCurrentRoutingDecisionOrThrow(telegramUserId) {
    let routingDecision = null;
    try {
      routingDecision = this.guestRoutingDecisionService.decideCurrentRouting({
        telegram_user_id: telegramUserId,
      });
    } catch (error) {
      throwSubmitBlocked(
        'no_valid_routing_state',
        `No valid routing decision: ${error?.message || 'routing decision unavailable'}`
      );
    }

    if (routingDecision?.response_version !== TELEGRAM_GUEST_ROUTING_DECISION_VERSION) {
      throwSubmitBlocked('no_valid_routing_state', 'Unsupported routing decision version');
    }
    if (
      routingDecision?.routing_status !== 'seller_attributed' ||
      routingDecision?.seller_attribution_active !== true ||
      routingDecision?.current_route_target?.route_target_type !== 'seller'
    ) {
      throwSubmitBlocked('no_valid_routing_state', 'No valid routing state for submit');
    }

    return routingDecision;
  }

  readTripCardOrThrow(selectedTripSlotReference) {
    let tripCard = null;
    try {
      tripCard = this.miniAppTripCardQueryService.readMiniAppTripCardByTripSlotReference({
        requested_trip_slot_reference: selectedTripSlotReference,
      });
    } catch (error) {
      throwSubmitValidation(
        'invalid_trip_slot_reference',
        `Invalid trip/slot reference: ${error?.message || 'trip-slot read failed'}`
      );
    }

    if (tripCard.booking_availability_state === 'unavailable') {
      throwSubmitBlocked(
        'invalid_trip_slot_reference',
        'Selected trip/slot is unavailable'
      );
    }

    return tripCard;
  }

  assertTripCapacityOrThrow(tripCard, requestedSeatsCount) {
    const seatsLeft = Number(tripCard?.seats_availability_summary?.seats_left);
    if (Number.isFinite(seatsLeft) && requestedSeatsCount > seatsLeft) {
      throwSubmitBlocked(
        'not_enough_seats',
        `Requested seats exceed available seats: ${requestedSeatsCount} > ${seatsLeft}`
      );
    }
  }

  assertTripTicketMixOrThrow(tripCard, requestedTicketMix) {
    const teenCount = Number(requestedTicketMix?.teen || 0);
    const tripType = normalizeString(tripCard?.trip_type_summary?.trip_type);
    if (tripType === 'banana' && teenCount > 0) {
      throwSubmitValidation(
        'invalid_ticket_mix',
        'requested_ticket_mix.teen is not available for banana trips'
      );
    }
  }

  resolveSubmitIdempotencyKey(normalizedInput, routingDecision) {
    if (normalizedInput.explicit_idempotency_key) {
      return normalizedInput.explicit_idempotency_key;
    }

    const signatureBase = freezeMiniAppValue({
      response_version: TELEGRAM_MINI_APP_BOOKING_SUBMIT_RESULT_VERSION,
      telegram_user_summary: normalizedInput.telegram_user_summary,
      current_route_target: routingDecision.current_route_target,
      selected_trip_slot_reference: normalizedInput.selected_trip_slot_reference,
      requested_seats_count: normalizedInput.requested_seats_count,
      requested_ticket_mix: normalizedInput.requested_ticket_mix,
      requested_prepayment_amount: normalizedInput.requested_prepayment_amount,
      contact_phone_summary: normalizedInput.contact_phone_summary,
    });

    return `telegram_mini_app_booking_submit:${buildStableHash(signatureBase)}`;
  }

  hasActiveBookingRequestForTelegramUser(telegramUserId) {
    if (!telegramUserId) {
      return false;
    }
    const guestProfile = this.guestProfiles.findOneBy(
      { telegram_user_id: telegramUserId },
      { orderBy: 'guest_profile_id ASC' }
    );
    if (!guestProfile) {
      return false;
    }

    if (typeof this.bookingRequestCreationService?.hasActiveRequestForGuest === 'function') {
      return this.bookingRequestCreationService.hasActiveRequestForGuest(
        guestProfile.guest_profile_id
      );
    }

    return false;
  }

  buildCreationInput(normalizedInput, routingDecision, submitIdempotencyKey) {
    return {
      telegram_guest: normalizedInput.telegram_user_summary,
      current_telegram_routing_decision: routingDecision,
      requested_trip_slot_reference: normalizedInput.selected_trip_slot_reference,
      requested_seats: normalizedInput.requested_seats_count,
      requested_ticket_mix: normalizedInput.requested_ticket_mix,
      requested_prepayment_amount: normalizedInput.requested_prepayment_amount,
      contact_phone: normalizedInput.contact_phone_e164,
      idempotency_key: submitIdempotencyKey,
    };
  }

  readCurrentTripSeatsLeft(selectedTripSlotReference) {
    try {
      const tripCard = this.miniAppTripCardQueryService.readMiniAppTripCardByTripSlotReference(
        {
          requested_trip_slot_reference: selectedTripSlotReference,
        }
      );
      const seatsLeft = Number(tripCard?.seats_availability_summary?.seats_left);
      return Number.isFinite(seatsLeft) ? seatsLeft : null;
    } catch {
      return null;
    }
  }

  submitMiniAppBookingRequest(input = {}) {
    const nowIso = this.nowIso();
    let normalizedInput = null;
    let routingDecision = null;
    let submitIdempotencyKey = null;

    try {
      normalizedInput = this.normalizeSubmitInput(input);
      routingDecision = this.readCurrentRoutingDecisionOrThrow(
        normalizedInput.telegram_user_summary.telegram_user_id
      );
      submitIdempotencyKey = this.resolveSubmitIdempotencyKey(
        normalizedInput,
        routingDecision
      );
      const hasActiveRequest = this.hasActiveBookingRequestForTelegramUser(
        normalizedInput.telegram_user_summary.telegram_user_id
      );
      const creationInput = this.buildCreationInput(
        normalizedInput,
        routingDecision,
        submitIdempotencyKey
      );
      let creationResult = null;

      if (hasActiveRequest) {
        try {
          creationResult =
            this.bookingRequestCreationService.createBookingRequest(creationInput);
        } catch (error) {
          const message = normalizeString(error?.message) || '';
          if (message.includes('Guest already has an active booking request')) {
            const seatsLeft = this.readCurrentTripSeatsLeft(
              normalizedInput.selected_trip_slot_reference
            );
            if (
              Number.isFinite(seatsLeft) &&
              seatsLeft > 0 &&
              normalizedInput.requested_seats_count > seatsLeft
            ) {
              throwSubmitBlocked(
                'not_enough_seats',
                `Requested seats exceed available seats: ${normalizedInput.requested_seats_count} > ${seatsLeft}`
              );
            }
          }
          throw error;
        }
      } else {
        const tripCard = this.readTripCardOrThrow(
          normalizedInput.selected_trip_slot_reference
        );
        this.assertTripTicketMixOrThrow(tripCard, normalizedInput.requested_ticket_mix);
        this.assertTripCapacityOrThrow(tripCard, normalizedInput.requested_seats_count);
        creationResult =
          this.bookingRequestCreationService.createBookingRequest(creationInput);
      }

      const holdActivationResult =
        this.bookingRequestHoldActivationService.activateHold({
          booking_request_creation_result: creationResult,
        });
      const sellerContactSummary = this.resolveSellerContactSummary(creationResult);

      return buildSubmitResult({
        submitStatus: 'submitted_with_hold',
        submitReasonCode: null,
        submitMessage: null,
        telegramUserSummary: creationResult.telegram_user_summary,
        bookingRequestReference: creationResult.booking_request_reference,
        holdReference: holdActivationResult.hold_reference,
        currentRouteTarget: creationResult.current_route_target,
        selectedTripSlotReference: creationResult.requested_trip_slot_reference,
        requestedSeatsCount: creationResult.requested_seats,
        requestedPrepaymentAmount: creationResult.requested_prepayment_amount,
        contactPhoneSummary: creationResult.contact_phone_summary,
        sellerContactSummary,
        holdStartedAtSummary: holdActivationResult.hold_started_at_summary,
        holdExpiresAtSummary: holdActivationResult.hold_expires_at_summary,
        latestTimestampIso: holdActivationResult.hold_started_at_summary?.iso || nowIso,
        idempotencyKey: submitIdempotencyKey,
      });
    } catch (error) {
      const mappedError =
        error?.submit_status && error?.submit_reason_code
          ? {
              submit_status: error.submit_status,
              submit_reason_code: error.submit_reason_code,
              message: error.message,
            }
          : mapServiceErrorToSubmitOutcome(error);
      if (!mappedError) {
        throw error;
      }

      return buildSubmitResult({
        submitStatus: mappedError.submit_status,
        submitReasonCode: mappedError.submit_reason_code,
        submitMessage: mappedError.message,
        telegramUserSummary: normalizedInput?.telegram_user_summary || null,
        bookingRequestReference: null,
        holdReference: null,
        currentRouteTarget: routingDecision?.current_route_target || null,
        selectedTripSlotReference: normalizedInput?.selected_trip_slot_reference || null,
        requestedSeatsCount: normalizedInput?.requested_seats_count ?? null,
        requestedPrepaymentAmount:
          normalizedInput?.requested_prepayment_amount ?? null,
        contactPhoneSummary: normalizedInput?.contact_phone_summary || null,
        holdStartedAtSummary: null,
        holdExpiresAtSummary: null,
        latestTimestampIso: nowIso,
        idempotencyKey: submitIdempotencyKey || normalizedInput?.explicit_idempotency_key || null,
      });
    }
  }

  submit(input = {}) {
    return this.submitMiniAppBookingRequest(input);
  }
}
