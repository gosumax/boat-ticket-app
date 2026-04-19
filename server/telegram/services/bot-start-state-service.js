import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramHandoffValue,
  TELEGRAM_BOT_START_ACTIONS,
  TELEGRAM_BOT_START_MODES,
  TELEGRAM_BOT_START_RESPONSE_VERSION,
  TELEGRAM_BOT_START_VISIBILITY_FLAGS,
} from '../../../shared/telegram/index.js';

const ERROR_PREFIX = '[TELEGRAM_BOT_START_STATE]';

function reject(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    reject(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeTelegramUserReference(input) {
  const reference = input?.telegram_user_reference ?? input?.telegramUserReference ?? input;
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    reject('telegram_user_reference is required');
  }

  const referenceType = normalizeString(reference.reference_type) || 'telegram_user';
  if (referenceType !== 'telegram_user') {
    reject(`Unsupported telegram-user reference type: ${referenceType}`);
  }

  const telegramUserId = normalizeString(
    reference.telegram_user_id ?? reference.telegramUserId
  );
  if (!telegramUserId) {
    reject('telegram_user_reference.telegram_user_id is required');
  }

  return freezeTelegramHandoffValue({
    reference_type: 'telegram_user',
    telegram_user_id: telegramUserId,
  });
}

function normalizeBookingRequestReference(input) {
  const reference =
    input?.booking_request_reference ?? input?.bookingRequestReference ?? input;
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    reject('booking_request_reference is required');
  }

  const referenceType = normalizeString(reference.reference_type);
  if (referenceType && referenceType !== 'telegram_booking_request') {
    reject(`Unsupported booking-request reference type: ${referenceType}`);
  }

  return freezeTelegramHandoffValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: normalizePositiveInteger(
      reference.booking_request_id ?? reference.bookingRequestId,
      'booking_request_reference.booking_request_id'
    ),
  });
}

function compareByNewestRequest(left, right) {
  const leftBookingRequest = left.booking_request;
  const rightBookingRequest = right.booking_request;
  const leftTime = leftBookingRequest.last_status_at || leftBookingRequest.created_at || '';
  const rightTime = rightBookingRequest.last_status_at || rightBookingRequest.created_at || '';

  if (leftTime !== rightTime) {
    return leftTime < rightTime ? 1 : -1;
  }

  return rightBookingRequest.booking_request_id - leftBookingRequest.booking_request_id;
}

function findCurrentLinkedTicketRequest(profileView) {
  const history = profileView?.booking_request_history || [];
  const linkedRequests = history
    .filter((item) =>
      Boolean(
        item?.presale_linkage_state?.linked_to_presale ||
          item?.booking_request?.confirmed_presale_id
      )
    )
    .sort(compareByNewestRequest);

  return linkedRequests[0] || null;
}

function buildTelegramUserSummary(guestIdentity = {}) {
  return {
    guest_profile_id: guestIdentity.guest_profile_id || null,
    telegram_user_id: guestIdentity.telegram_user_id || null,
    display_name: guestIdentity.display_name || null,
    username: guestIdentity.username || null,
    language_code: guestIdentity.language_code || null,
    phone_e164: guestIdentity.phone_e164 || null,
    consent_status: guestIdentity.consent_status || null,
    profile_status: guestIdentity.profile_status || null,
  };
}

function buildBookingRequestReference(bookingRequest) {
  if (!bookingRequest) {
    return null;
  }

  return {
    reference_type: 'telegram_booking_request',
    booking_request_id: bookingRequest.booking_request_id,
    guest_profile_id: bookingRequest.guest_profile_id,
    seller_attribution_session_id: bookingRequest.seller_attribution_session_id,
  };
}

function buildRequestSummary(historyItem) {
  if (!historyItem?.booking_request) {
    return null;
  }

  const bookingRequest = historyItem.booking_request;
  const bookingHold = historyItem.booking_hold || null;

  return {
    booking_request_reference: buildBookingRequestReference(bookingRequest),
    booking_request_id: bookingRequest.booking_request_id,
    request_status: bookingRequest.request_status,
    requested_trip_date: bookingRequest.requested_trip_date,
    requested_time_slot: bookingRequest.requested_time_slot,
    requested_seats: Number(bookingRequest.requested_seats || 0),
    requested_ticket_mix: bookingRequest.requested_ticket_mix || {},
    contact_phone_e164: bookingRequest.contact_phone_e164,
    created_at: bookingRequest.created_at,
    last_status_at: bookingRequest.last_status_at,
    confirmed_presale_id: bookingRequest.confirmed_presale_id || null,
    hold_status: bookingHold?.hold_status || null,
    hold_expires_at: bookingHold?.hold_expires_at || null,
  };
}

function findLatestTicketTimelineItem(profileView, bookingRequestId) {
  const timeline = profileView?.timeline_projection?.guest_ticket_timeline || [];
  const matches = timeline.filter((item) => item.booking_request_id === bookingRequestId);

  return matches[matches.length - 1] || null;
}

function buildTicketPresaleLinkageSummary(historyItem, profileView) {
  if (!historyItem?.booking_request) {
    return null;
  }

  const bookingRequest = historyItem.booking_request;
  const presaleLinkageState = historyItem.presale_linkage_state || {};
  const canonicalLinkageState = historyItem.canonical_linkage_state || {};
  const latestTicketState = findLatestTicketTimelineItem(
    profileView,
    bookingRequest.booking_request_id
  );

  return {
    booking_request_reference: buildBookingRequestReference(bookingRequest),
    booking_request_id: bookingRequest.booking_request_id,
    request_status: bookingRequest.request_status,
    confirmed_presale_id:
      presaleLinkageState.confirmed_presale_id ||
      bookingRequest.confirmed_presale_id ||
      null,
    linkage_source: presaleLinkageState.linkage_source || null,
    ticket_status: latestTicketState?.ticket_status || null,
    ticket_state_group: latestTicketState?.state_group || null,
    canonical_linkage_status: canonicalLinkageState.linkage_status || null,
    canonical_presale: canonicalLinkageState.canonical_presale || null,
    linked_ticket_summary: canonicalLinkageState.linked_ticket_summary || null,
    trip_linkage_summary: canonicalLinkageState.trip_linkage_summary || null,
  };
}

function buildCurrentRouteSummary(profileView) {
  const attributionHistory = profileView?.attribution_history || [];
  const latestAttributionItem = attributionHistory[attributionHistory.length - 1] || null;
  if (!latestAttributionItem?.seller_attribution_session) {
    return null;
  }

  const session = latestAttributionItem.seller_attribution_session;
  const trafficSource = latestAttributionItem.traffic_source || {};
  const sourceQR = latestAttributionItem.source_qr_code || {};
  const sellerId = Number(session.seller_id);

  return {
    route_target_type: Number.isInteger(sellerId) && sellerId > 0 ? 'seller' : 'unassigned',
    seller_reference:
      Number.isInteger(sellerId) && sellerId > 0
        ? {
            reference_type: 'seller_user',
            seller_id: sellerId,
            seller_attribution_session_id: session.seller_attribution_session_id || null,
          }
        : null,
    seller_attribution_session_id: session.seller_attribution_session_id || null,
    attribution_status: session.attribution_status || null,
    binding_reason: session.binding_reason || null,
    attribution_starts_at: session.starts_at || null,
    attribution_expires_at: session.expires_at || null,
    source_summary: {
      traffic_source_id: trafficSource.traffic_source_id || null,
      source_code: trafficSource.source_code || null,
      source_type: trafficSource.source_type || null,
      source_name: trafficSource.source_name || null,
      source_qr_code_id: sourceQR.source_qr_code_id || null,
      qr_token: sourceQR.qr_token || null,
    },
  };
}

function resolveStartMode(profileView) {
  const linkedTicketRequest = findCurrentLinkedTicketRequest(profileView);
  const activeRequest = profileView.current_active_request || null;
  const hasHistory = (profileView.booking_request_history || []).length > 0;

  if (linkedTicketRequest) {
    return {
      start_mode: TELEGRAM_BOT_START_MODES.linked_ticket,
      linked_ticket_request: linkedTicketRequest,
      active_request: activeRequest,
    };
  }

  if (activeRequest) {
    return {
      start_mode: TELEGRAM_BOT_START_MODES.active_request,
      linked_ticket_request: null,
      active_request: activeRequest,
    };
  }

  if (hasHistory) {
    return {
      start_mode: TELEGRAM_BOT_START_MODES.completed_guest_without_active_request,
      linked_ticket_request: null,
      active_request: null,
    };
  }

  return {
    start_mode: TELEGRAM_BOT_START_MODES.new_guest,
    linked_ticket_request: null,
    active_request: null,
  };
}

function resolvePrimaryGuestState(startMode, activeRequest) {
  if (startMode === TELEGRAM_BOT_START_MODES.linked_ticket) {
    return 'guest_with_linked_ticket';
  }

  if (startMode === TELEGRAM_BOT_START_MODES.active_request) {
    const requestStatus = activeRequest?.booking_request?.request_status || null;
    return requestStatus === 'PREPAYMENT_CONFIRMED'
      ? 'active_request_confirmed_pending_ticket'
      : 'active_request_waiting_for_prepayment';
  }

  if (startMode === TELEGRAM_BOT_START_MODES.completed_guest_without_active_request) {
    return 'guest_completed_without_active_request';
  }

  return 'new_guest';
}

function resolveRecommendedActions(startMode) {
  if (startMode === TELEGRAM_BOT_START_MODES.linked_ticket) {
    return [
      TELEGRAM_BOT_START_ACTIONS.view_ticket,
      TELEGRAM_BOT_START_ACTIONS.view_trips,
      TELEGRAM_BOT_START_ACTIONS.contact,
      TELEGRAM_BOT_START_ACTIONS.faq,
      TELEGRAM_BOT_START_ACTIONS.useful_content,
    ];
  }

  if (startMode === TELEGRAM_BOT_START_MODES.active_request) {
    return [
      TELEGRAM_BOT_START_ACTIONS.view_current_request,
      TELEGRAM_BOT_START_ACTIONS.contact,
      TELEGRAM_BOT_START_ACTIONS.faq,
      TELEGRAM_BOT_START_ACTIONS.useful_content,
    ];
  }

  return [
    TELEGRAM_BOT_START_ACTIONS.view_trips,
    TELEGRAM_BOT_START_ACTIONS.create_booking_request,
    TELEGRAM_BOT_START_ACTIONS.contact,
    TELEGRAM_BOT_START_ACTIONS.faq,
    TELEGRAM_BOT_START_ACTIONS.useful_content,
  ];
}

function buildLatestTimestampSummary(profileView, activeRequest, linkedTicketRequest) {
  const latestLinkedTimelineState = linkedTicketRequest?.booking_request
    ? findLatestTicketTimelineItem(
        profileView,
        linkedTicketRequest.booking_request.booking_request_id
      )
    : null;
  const requestHistory = profileView?.booking_request_history || [];
  const latestHistoryItem = requestHistory
    .slice()
    .sort(compareByNewestRequest)[0];
  const latestHistoryEvent =
    latestHistoryItem?.booking_request_events?.[latestHistoryItem.booking_request_events.length - 1] ||
    null;

  return buildTelegramLatestTimestampSummary(
    profileView?.guest_identity?.last_seen_at,
    profileView?.guest_identity?.first_seen_at,
    activeRequest?.booking_request?.last_status_at,
    activeRequest?.booking_request?.created_at,
    activeRequest?.booking_hold?.hold_expires_at,
    linkedTicketRequest?.booking_request?.last_status_at,
    linkedTicketRequest?.booking_request?.created_at,
    latestLinkedTimelineState?.occurred_at,
    latestHistoryEvent?.event_at
  );
}

export class TelegramBotStartStateService {
  constructor({ guestProfileService }) {
    this.guestProfileService = guestProfileService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'bot-start-state-service',
      status: 'read_only_start_state_ready',
      dependencyKeys: ['guestProfileService'],
    });
  }

  readStartStateFromProfileInput(input) {
    let profileView;
    try {
      profileView = this.guestProfileService.readGuestProfileView(input);
    } catch (error) {
      reject(error?.message || 'Unable to read guest profile view');
    }

    const startState = resolveStartMode(profileView);
    const recommendedNextActions = resolveRecommendedActions(startState.start_mode);
    const primaryAction = recommendedNextActions[0] || null;
    const secondaryActions = recommendedNextActions.filter(
      (action) => action !== primaryAction
    );
    const activeBookingRequestSummary = buildRequestSummary(startState.active_request);
    const latestTicketPresaleLinkageSummary = buildTicketPresaleLinkageSummary(
      startState.linked_ticket_request,
      profileView
    );
    const legacyCurrentRequestSummary =
      activeBookingRequestSummary ||
      buildRequestSummary(startState.linked_ticket_request);

    return freezeTelegramHandoffValue({
      response_version: TELEGRAM_BOT_START_RESPONSE_VERSION,
      read_only: true,
      telegram_user_summary: buildTelegramUserSummary(profileView.guest_identity),
      start_mode: startState.start_mode,
      primary_guest_state: resolvePrimaryGuestState(
        startState.start_mode,
        startState.active_request
      ),
      current_route_summary: buildCurrentRouteSummary(profileView),
      active_booking_request_summary: activeBookingRequestSummary,
      latest_ticket_presale_linkage_summary: latestTicketPresaleLinkageSummary,
      recommended_next_actions: recommendedNextActions,
      latest_timestamp_summary: buildLatestTimestampSummary(
        profileView,
        startState.active_request,
        startState.linked_ticket_request
      ),
      // Compatibility fields for existing internal Telegram consumers.
      visibility_flags: TELEGRAM_BOT_START_VISIBILITY_FLAGS,
      primary_actions: primaryAction ? [primaryAction] : [],
      secondary_actions: secondaryActions,
      guest_summary: buildTelegramUserSummary(profileView.guest_identity),
      current_request_summary: legacyCurrentRequestSummary,
      current_ticket_summary: latestTicketPresaleLinkageSummary,
      resolved_by: profileView.resolved_by,
      requested_booking_request_id: profileView.requested_booking_request_id,
    });
  }

  readBotStartStateByTelegramUserReference(input = {}) {
    const telegramUserReference = normalizeTelegramUserReference(input);

    return this.readStartStateFromProfileInput({
      telegram_user_id: telegramUserReference.telegram_user_id,
      telegram_user_reference: telegramUserReference,
    });
  }

  readBotStartStateByBookingRequestReference(input = {}) {
    const bookingRequestReference = normalizeBookingRequestReference(input);

    return this.readStartStateFromProfileInput({
      booking_request_id: bookingRequestReference.booking_request_id,
      booking_request_reference: bookingRequestReference,
    });
  }

  readStartState(input = {}) {
    const hasTelegramReferenceInput = Boolean(
      input.telegram_user_reference ||
        input.telegramUserReference ||
        input.telegram_user_id ||
        input.telegramUserId
    );
    if (hasTelegramReferenceInput) {
      return this.readBotStartStateByTelegramUserReference(input);
    }

    const hasBookingRequestReferenceInput = Boolean(
      input.booking_request_reference ||
        input.bookingRequestReference ||
        input.booking_request_id ||
        input.bookingRequestId
    );
    if (hasBookingRequestReferenceInput) {
      return this.readBotStartStateByBookingRequestReference(input);
    }

    return this.readStartStateFromProfileInput(input);
  }
}
