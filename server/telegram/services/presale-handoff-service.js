import {
  buildTelegramHandoffSnapshotReference,
  TELEGRAM_HANDOFF_PREPARED_EVENT_TYPE,
  TELEGRAM_HANDOFF_PREPARATION_RESULT_VERSION,
  TELEGRAM_HANDOFF_READY_STATE,
  TELEGRAM_HANDOFF_SNAPSHOT_VERSION,
} from '../../../shared/telegram/index.js';
import {
  buildBookingRequestReference,
  buildRequestedTripSlotReference,
  buildTelegramUserSummaryFromGuestProfileAndEvents,
  compareStableLifecycleValues,
  extractRequestedPrepaymentAmount,
  freezeSortedLifecycleValue,
  normalizeBookingRequestReference,
  normalizePositiveInteger,
  normalizeString,
  normalizeTimestampSummary,
} from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_HANDOFF_PREPARATION]';
const SERVICE_NAME = 'telegram_presale_handoff_preparation_service';
const FALLBACK_EVENT_SCAN_LIMIT = 10000;

function rejectPreparation(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeOptionalPositiveInteger(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return normalizePositiveInteger(value, label, rejectPreparation);
}

function buildContactPhoneSummary(phoneE164) {
  const normalizedPhone = normalizeString(phoneE164);
  if (!normalizedPhone) {
    return null;
  }

  return freezeSortedLifecycleValue({
    phone_e164: normalizedPhone,
    phone_last4: normalizedPhone.slice(-4),
  });
}

function buildAttributionSessionReference(session) {
  if (!session) {
    return null;
  }

  return freezeSortedLifecycleValue({
    reference_type: 'telegram_seller_attribution_session',
    seller_attribution_session_id: session.seller_attribution_session_id,
    guest_profile_id: session.guest_profile_id,
    traffic_source_id: session.traffic_source_id,
    source_qr_code_id: session.source_qr_code_id,
    seller_id: session.seller_id ?? null,
    attribution_status: session.attribution_status,
  });
}

function buildCurrentRouteTarget(session) {
  return freezeSortedLifecycleValue({
    route_target_type: session?.seller_id ? 'seller' : 'manual_review',
    seller_id: session?.seller_id ?? null,
    seller_attribution_session_id:
      session?.seller_attribution_session_id ?? null,
  });
}

function buildPreparationNoOpGuards() {
  return freezeSortedLifecycleValue({
    handoff_snapshot_created: true,
    handoff_prepared: true,
    queued_for_handoff: false,
    handoff_started: false,
    handoff_blocked: false,
    handoff_consumed: false,
    production_presale_created: false,
    production_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  });
}

function isMergeableRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergePreparedSnapshotValues(baseValue, overlayValue) {
  if (overlayValue === undefined) {
    return baseValue;
  }
  if (!isMergeableRecord(baseValue) || !isMergeableRecord(overlayValue)) {
    return overlayValue;
  }

  const mergedValue = { ...baseValue };
  for (const [key, nestedOverlayValue] of Object.entries(overlayValue)) {
    mergedValue[key] = mergePreparedSnapshotValues(baseValue[key], nestedOverlayValue);
  }

  return mergedValue;
}

function resolvePreparedSnapshotPayload(event) {
  const canonicalSnapshot = event?.event_payload?.handoff_snapshot ?? null;
  const legacySnapshot = event?.event_payload?.payload ?? null;
  if (canonicalSnapshot && legacySnapshot) {
    return freezeSortedLifecycleValue(
      mergePreparedSnapshotValues(canonicalSnapshot, legacySnapshot)
    );
  }

  return freezeSortedLifecycleValue(canonicalSnapshot ?? legacySnapshot ?? null);
}

function pickBookingRequestReference(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return {
      reference_type: 'telegram_booking_request',
      booking_request_id: Number(input),
      guest_profile_id: null,
      seller_attribution_session_id: null,
    };
  }

  return (
    input.booking_request_reference ??
    input.bookingRequestReference ??
    input.reference ??
    input.booking_request ??
    input.bookingRequest ??
    input ??
    null
  );
}

function normalizePreparationInput(input = {}) {
  const rawReference = pickBookingRequestReference(input);
  if (!rawReference) {
    rejectPreparation('booking request reference is required');
  }

  let bookingRequestReference = null;
  if (
    rawReference.reference_type === 'telegram_booking_request' &&
    rawReference.guest_profile_id &&
    rawReference.seller_attribution_session_id
  ) {
    bookingRequestReference = normalizeBookingRequestReference(
      rawReference,
      rejectPreparation
    );
  } else {
    if (
      rawReference.reference_type &&
      rawReference.reference_type !== 'telegram_booking_request'
    ) {
      rejectPreparation(
        `Unsupported booking-request reference type: ${
          rawReference.reference_type || 'unknown'
        }`
      );
    }

    bookingRequestReference = freezeSortedLifecycleValue({
      reference_type: 'telegram_booking_request',
      booking_request_id: normalizePositiveInteger(
        rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
        'booking_request_reference.booking_request_id',
        rejectPreparation
      ),
      guest_profile_id: normalizeOptionalPositiveInteger(
        rawReference.guest_profile_id,
        'booking_request_reference.guest_profile_id'
      ),
      seller_attribution_session_id: normalizeOptionalPositiveInteger(
        rawReference.seller_attribution_session_id,
        'booking_request_reference.seller_attribution_session_id'
      ),
    });
  }

  const idempotencyKey =
    normalizeString(input.idempotency_key ?? input.idempotencyKey) ||
    `telegram_handoff_prepare:${bookingRequestReference.booking_request_id}`;

  return freezeSortedLifecycleValue({
    booking_request_reference: bookingRequestReference,
    actor_type: normalizeString(input.actor_type ?? input.actorType) || 'system',
    actor_id: normalizeString(input.actor_id ?? input.actorId) || null,
    dedupe_key: idempotencyKey,
    idempotency_key: idempotencyKey,
    preparation_signature: {
      response_version: TELEGRAM_HANDOFF_PREPARATION_RESULT_VERSION,
      booking_request_reference: bookingRequestReference,
      dedupe_key: idempotencyKey,
      idempotency_key: idempotencyKey,
    },
  });
}

export class TelegramPresaleHandoffService {
  constructor({
    guestProfiles,
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    sellerAttributionSessions,
    sellerAttributionSessionStartEvents,
    trafficSources,
    sourceQRCodes,
    attributionService,
    bookingRequestLifecycleProjectionService,
    now = () => new Date(),
  }) {
    this.guestProfiles = guestProfiles;
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.sellerAttributionSessionStartEvents = sellerAttributionSessionStartEvents;
    this.trafficSources = trafficSources;
    this.sourceQRCodes = sourceQRCodes;
    this.attributionService = attributionService;
    this.bookingRequestLifecycleProjectionService =
      bookingRequestLifecycleProjectionService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'presale-handoff-service',
      status: 'handoff_preparation_persistence_ready',
      dependencyKeys: [
        'guestProfiles',
        'bookingRequests',
        'bookingHolds',
        'bookingRequestEvents',
        'sellerAttributionSessions',
        'sellerAttributionSessionStartEvents',
        'trafficSources',
        'sourceQRCodes',
        'attributionService',
        'bookingRequestLifecycleProjectionService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectPreparation('handoff preparation clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectPreparation(`Invalid booking request reference: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  getGuestProfileOrThrow(guestProfileId) {
    const guestProfile = this.guestProfiles.getById(guestProfileId);
    if (!guestProfile) {
      rejectPreparation(`Guest profile not found: ${guestProfileId}`);
    }

    return guestProfile;
  }

  getSellerAttributionSessionOrThrow(sellerAttributionSessionId) {
    const session = this.sellerAttributionSessions.getById(
      sellerAttributionSessionId
    );
    if (!session) {
      rejectPreparation(
        `Booking request is not projectable for handoff: ${sellerAttributionSessionId}`
      );
    }

    return session;
  }

  getTrafficSourceOrThrow(trafficSourceId) {
    const trafficSource = this.trafficSources.getById(trafficSourceId);
    if (!trafficSource) {
      rejectPreparation(
        `Booking request is not projectable for handoff: missing traffic source ${trafficSourceId}`
      );
    }

    return trafficSource;
  }

  getSourceQRCodeOrThrow(sourceQrCodeId) {
    const sourceQRCode = this.sourceQRCodes.getById(sourceQrCodeId);
    if (!sourceQRCode) {
      rejectPreparation(
        `Booking request is not projectable for handoff: missing source QR ${sourceQrCodeId}`
      );
    }

    return sourceQRCode;
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
  }

  getLatestAttributionStartEvent(sellerAttributionSessionId) {
    if (!this.sellerAttributionSessionStartEvents) {
      return null;
    }

    return this.sellerAttributionSessionStartEvents.findOneBy(
      {
        seller_attribution_session_id: sellerAttributionSessionId,
      },
      {
        orderBy: 'attribution_start_event_id DESC',
      }
    );
  }

  listPreparedEvents() {
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
        .all(TELEGRAM_HANDOFF_PREPARED_EVENT_TYPE)
        .map((row) => this.bookingRequestEvents.deserializeRow(row));
    }

    return this.bookingRequestEvents.listBy(
      { event_type: TELEGRAM_HANDOFF_PREPARED_EVENT_TYPE },
      {
        orderBy: 'booking_request_event_id ASC',
        limit: FALLBACK_EVENT_SCAN_LIMIT,
      }
    );
  }

  getPreparedEvent(bookingRequestId) {
    return this.bookingRequestEvents.findOneBy(
      {
        booking_request_id: bookingRequestId,
        event_type: TELEGRAM_HANDOFF_PREPARED_EVENT_TYPE,
      },
      {
        orderBy: 'booking_request_event_id DESC',
      }
    );
  }

  buildPreparedResultFromEvent(event, bookingRequest = null) {
    const handoffSnapshot = resolvePreparedSnapshotPayload(event);
    if (!handoffSnapshot) {
      rejectPreparation(
        `HANDOFF_PREPARED snapshot payload is missing: ${
          event?.booking_request_event_id || 'unknown'
        }`
      );
    }

    const persistedBookingRequest =
      bookingRequest || this.bookingRequests.getById(event.booking_request_id) || null;
    const bookingRequestReference =
      handoffSnapshot.booking_request_reference ||
      buildBookingRequestReference(persistedBookingRequest);

    return freezeSortedLifecycleValue({
      response_version: TELEGRAM_HANDOFF_PREPARATION_RESULT_VERSION,
      handoff_status: event?.event_payload?.handoff_status || 'handoff_prepared',
      booking_request_reference: bookingRequestReference,
      handoff_snapshot_reference: buildTelegramHandoffSnapshotReference({
        bookingRequest: persistedBookingRequest,
        bookingRequestReference,
        preparedEvent: event,
      }),
      handoff_prepared: true,
      dedupe_key: event?.event_payload?.dedupe_key ?? null,
      idempotency_key: event?.event_payload?.idempotency_key ?? null,
      prepared_timestamp_summary: normalizeTimestampSummary(event.event_at),
      handoff_snapshot: handoffSnapshot,
      payload: handoffSnapshot,
      handoffState:
        event?.event_payload?.handoff_state || TELEGRAM_HANDOFF_READY_STATE,
      preparedAt: event.event_at,
      attributionLocked: Boolean(event?.event_payload?.attribution_locked),
    });
  }

  resolveIdempotentPreparedEvent(normalizedInput) {
    const matchingEvents = this.listPreparedEvents().filter(
      (event) => event.event_payload?.idempotency_key === normalizedInput.idempotency_key
    );
    if (matchingEvents.length === 0) {
      return null;
    }

    const matchingEvent = matchingEvents.find((event) =>
      compareStableLifecycleValues(
        event.event_payload?.preparation_signature,
        normalizedInput.preparation_signature
      )
    );
    if (matchingEvent) {
      return matchingEvent;
    }

    rejectPreparation(
      `Idempotency conflict for handoff preparation: ${normalizedInput.idempotency_key}`
    );
  }

  assertBookingRequestReferenceMatches(bookingRequest, bookingRequestReference) {
    if (
      bookingRequestReference.guest_profile_id !== null &&
      bookingRequestReference.guest_profile_id !== bookingRequest.guest_profile_id
    ) {
      rejectPreparation(
        `Invalid booking request reference: ${bookingRequest.booking_request_id}`
      );
    }
    if (
      bookingRequestReference.seller_attribution_session_id !== null &&
      bookingRequestReference.seller_attribution_session_id !==
        bookingRequest.seller_attribution_session_id
    ) {
      rejectPreparation(
        `Invalid booking request reference: ${bookingRequest.booking_request_id}`
      );
    }
  }

  resolveExistingPreparedEvent(normalizedInput) {
    const byIdempotency = this.resolveIdempotentPreparedEvent(normalizedInput);
    if (byIdempotency) {
      return byIdempotency;
    }

    const existingPreparedEvent = this.getPreparedEvent(
      normalizedInput.booking_request_reference.booking_request_id
    );
    if (!existingPreparedEvent) {
      return null;
    }

    const bookingRequest = this.getBookingRequestOrThrow(
      normalizedInput.booking_request_reference.booking_request_id
    );
    this.assertBookingRequestReferenceMatches(
      bookingRequest,
      normalizedInput.booking_request_reference
    );

    return existingPreparedEvent;
  }

  readLifecycleProjectionOrThrow(bookingRequestReference) {
    try {
      return this.bookingRequestLifecycleProjectionService.readCurrentLifecycleStateByBookingRequestReference(
        {
          booking_request_reference: bookingRequestReference,
        }
      );
    } catch (error) {
      const message = String(error?.message || '');
      const bookingRequestId = bookingRequestReference.booking_request_id;
      if (
        message.includes('Booking request not found') ||
        message.includes('booking request reference') ||
        message.includes('Unsupported booking-request reference type')
      ) {
        rejectPreparation(`Invalid booking request reference: ${bookingRequestId}`);
      }
      if (
        message.includes('not projectable inside Telegram lifecycle boundary') ||
        message.includes('lifecycle event is missing for projection')
      ) {
        rejectPreparation(
          `Booking request is not projectable for handoff: ${bookingRequestId}`
        );
      }

      throw error;
    }
  }

  assertPreparableLifecycleState(projectionItem) {
    const bookingRequestId = projectionItem.booking_request_reference.booking_request_id;
    if (projectionItem.lifecycle_state === 'prepayment_confirmed') {
      return;
    }
    if (
      projectionItem.lifecycle_state === 'cancelled_before_prepayment' ||
      projectionItem.lifecycle_state === 'hold_expired'
    ) {
      rejectPreparation(
        `Cancelled or expired booking request cannot be prepared for handoff: ${bookingRequestId}`
      );
    }

    rejectPreparation(
      `Booking request is not prepayment-confirmed: ${bookingRequestId}`
    );
  }

  resolveHandoffSourceFamily({ sellerAttributionSession, trafficSource }) {
    const bindingReason = normalizeString(sellerAttributionSession?.binding_reason);
    if (bindingReason) {
      return bindingReason;
    }

    if (this.attributionService?.classifySourceFamily) {
      return this.attributionService.classifySourceFamily({
        sourceType: trafficSource.source_type,
        entryChannel: 'handoff_preparation',
      });
    }

    return normalizeString(trafficSource?.source_type);
  }

  buildHandoffSnapshot({ bookingRequest, projectionItem }) {
    const guestProfile = this.getGuestProfileOrThrow(bookingRequest.guest_profile_id);
    const bookingHold = this.getHoldForRequest(bookingRequest.booking_request_id);
    const events = this.listRequestEvents(bookingRequest.booking_request_id);
    const sellerAttributionSession = this.getSellerAttributionSessionOrThrow(
      bookingRequest.seller_attribution_session_id
    );
    const trafficSource = this.getTrafficSourceOrThrow(
      sellerAttributionSession.traffic_source_id
    );
    const sourceQRCode = this.getSourceQRCodeOrThrow(
      sellerAttributionSession.source_qr_code_id
    );
    const attributionStartEvent = this.getLatestAttributionStartEvent(
      sellerAttributionSession.seller_attribution_session_id
    );
    const contactPhoneSummary = buildContactPhoneSummary(
      bookingRequest.contact_phone_e164 || guestProfile.phone_e164
    );
    if (!contactPhoneSummary) {
      rejectPreparation(
        `Booking request is not projectable for handoff: missing contact phone ${bookingRequest.booking_request_id}`
      );
    }

    const sourceFamily = this.resolveHandoffSourceFamily({
      sellerAttributionSession,
      trafficSource,
    });
    const sourceOwnership = sellerAttributionSession.seller_id ? 'seller' : 'owner_manual';
    const pathType = sellerAttributionSession.seller_id
      ? 'seller_attributed'
      : 'owner_manual';

    return freezeSortedLifecycleValue({
      response_version: TELEGRAM_HANDOFF_SNAPSHOT_VERSION,
      snapshot_type: 'telegram_presale_handoff_snapshot',
      frozen_for: 'future_presale_creation',
      telegram_user_summary: buildTelegramUserSummaryFromGuestProfileAndEvents({
        guestProfile,
        events,
      }),
      booking_request_reference: buildBookingRequestReference(bookingRequest),
      telegram_request: {
        booking_request_id: bookingRequest.booking_request_id,
        guest_profile_id: bookingRequest.guest_profile_id,
        seller_attribution_session_id:
          bookingRequest.seller_attribution_session_id,
        handoff_state: TELEGRAM_HANDOFF_READY_STATE,
      },
      requested_trip_slot_reference: buildRequestedTripSlotReference({
        bookingRequest,
        events,
      }),
      requested_seats: Number(bookingRequest.requested_seats),
      requested_prepayment_amount: extractRequestedPrepaymentAmount({
        bookingHold,
        events,
      }),
      contact_phone_summary: contactPhoneSummary,
      current_route_target: buildCurrentRouteTarget(sellerAttributionSession),
      source_binding_reference:
        attributionStartEvent?.source_binding_reference || null,
      attribution_session_reference:
        attributionStartEvent?.attribution_session_reference ||
        buildAttributionSessionReference(sellerAttributionSession),
      guest: {
        display_name:
          normalizeString(guestProfile.display_name) ||
          projectionItem.telegram_user_summary.display_name,
        username:
          normalizeString(guestProfile.username) ||
          projectionItem.telegram_user_summary.username,
        language_code:
          normalizeString(guestProfile.language_code) ||
          projectionItem.telegram_user_summary.language_code,
        phone_e164: contactPhoneSummary.phone_e164,
      },
      source: {
        traffic_source_id: trafficSource.traffic_source_id,
        source_code: trafficSource.source_code,
        source_type: trafficSource.source_type,
        source_name: trafficSource.source_name,
        source_family: sourceFamily,
        source_qr_code_id: sourceQRCode.source_qr_code_id,
        seller_id: sellerAttributionSession.seller_id ?? null,
        source_ownership: sourceOwnership,
        path_type: pathType,
        attribution_status: sellerAttributionSession.attribution_status,
        attribution_expires_at: sellerAttributionSession.expires_at,
        binding_reason: sellerAttributionSession.binding_reason,
      },
      trip: {
        requested_trip_date:
          projectionItem.requested_trip_slot_reference.requested_trip_date,
        requested_time_slot:
          projectionItem.requested_trip_slot_reference.requested_time_slot,
        requested_seats: projectionItem.requested_seats,
        requested_ticket_mix: bookingRequest.requested_ticket_mix || {},
        slot_uid: projectionItem.requested_trip_slot_reference.slot_uid,
        boat_slot_id: projectionItem.requested_trip_slot_reference.boat_slot_id,
        slot_resolution_required:
          projectionItem.requested_trip_slot_reference.slot_uid === null,
      },
      payment: {
        requested_prepayment_amount: projectionItem.requested_prepayment_amount,
        currency: bookingHold?.currency || 'RUB',
        prepayment_confirmed: true,
      },
      metadata: {
        production_presale_not_created: true,
        seat_reservation_not_applied: true,
        money_ledger_not_written: true,
        attribution_locked: true,
        conversion_mode: 'telegram_presale_handoff_preparation',
      },
    });
  }

  buildPreparedEventPayload({ normalizedInput, projectionItem, handoffSnapshot }) {
    return freezeSortedLifecycleValue({
      response_version: TELEGRAM_HANDOFF_PREPARATION_RESULT_VERSION,
      handoff_preparation_source: SERVICE_NAME,
      booking_request_lifecycle_state: projectionItem,
      handoff_status: 'handoff_prepared',
      handoff_prepared: true,
      handoff_snapshot: handoffSnapshot,
      dedupe_key: normalizedInput.dedupe_key,
      idempotency_key: normalizedInput.idempotency_key,
      preparation_signature: normalizedInput.preparation_signature,
      no_op_guards: buildPreparationNoOpGuards(),
      handoff_state: TELEGRAM_HANDOFF_READY_STATE,
      attribution_locked: true,
      payload: handoffSnapshot,
    });
  }

  buildNormalizedHandoffPayload(input = {}) {
    const normalizedInput = normalizePreparationInput(
      typeof input === 'object' && input !== null && !Array.isArray(input)
        ? input
        : { booking_request_reference: input }
    );
    const existingPreparedEvent = this.resolveExistingPreparedEvent(normalizedInput);
    if (existingPreparedEvent) {
      return this.buildPreparedResultFromEvent(existingPreparedEvent).handoff_snapshot;
    }

    const projectionItem = this.readLifecycleProjectionOrThrow(
      normalizedInput.booking_request_reference
    );
    this.assertPreparableLifecycleState(projectionItem);
    const bookingRequest = this.getBookingRequestOrThrow(
      projectionItem.booking_request_reference.booking_request_id
    );

    return this.buildHandoffSnapshot({
      bookingRequest,
      projectionItem,
    });
  }

  getHandoffState(bookingRequestId) {
    const preparedEvent = this.getPreparedEvent(bookingRequestId);
    if (!preparedEvent) {
      return null;
    }

    return this.buildPreparedResultFromEvent(preparedEvent);
  }

  prepareHandoff(input = {}, options = {}) {
    const runPreparation = () => {
      const mergedInput =
        typeof input === 'object' && input !== null && !Array.isArray(input)
          ? { ...input, ...options }
          : { ...options, booking_request_reference: input };
      const normalizedInput = normalizePreparationInput(mergedInput);
      const existingPreparedEvent = this.resolveExistingPreparedEvent(normalizedInput);
      if (existingPreparedEvent) {
        return this.buildPreparedResultFromEvent(existingPreparedEvent);
      }

      const projectionItem = this.readLifecycleProjectionOrThrow(
        normalizedInput.booking_request_reference
      );
      this.assertPreparableLifecycleState(projectionItem);

      const bookingRequest = this.getBookingRequestOrThrow(
        projectionItem.booking_request_reference.booking_request_id
      );
      const handoffSnapshot = this.buildHandoffSnapshot({
        bookingRequest,
        projectionItem,
      });
      const preparedAt = this.nowIso();
      const event = this.bookingRequestEvents.create({
        booking_request_id: bookingRequest.booking_request_id,
        booking_hold_id: this.getHoldForRequest(bookingRequest.booking_request_id)?.booking_hold_id || null,
        seller_attribution_session_id:
          bookingRequest.seller_attribution_session_id,
        event_type: TELEGRAM_HANDOFF_PREPARED_EVENT_TYPE,
        event_at: preparedAt,
        actor_type: normalizedInput.actor_type,
        actor_id: normalizedInput.actor_id,
        event_payload: this.buildPreparedEventPayload({
          normalizedInput,
          projectionItem,
          handoffSnapshot,
        }),
      });

      return this.buildPreparedResultFromEvent(event, bookingRequest);
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runPreparation)();
    }

    return runPreparation();
  }
}
