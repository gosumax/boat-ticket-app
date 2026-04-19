import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramHandoffValue,
  TELEGRAM_BOT_START_ACTIONS,
  TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS,
  TELEGRAM_SERVICE_MESSAGE_RESOLUTION_VERSION,
  TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES,
  TELEGRAM_SERVICE_MESSAGE_TYPES,
} from '../../../shared/telegram/index.js';

const ERROR_PREFIX = '[TELEGRAM_SERVICE_MESSAGE]';

const BUTTON_LABELS = Object.freeze({
  [TELEGRAM_BOT_START_ACTIONS.view_trips]: 'View trips',
  [TELEGRAM_BOT_START_ACTIONS.create_booking_request]: 'Create booking request',
  [TELEGRAM_BOT_START_ACTIONS.view_current_request]: 'View request',
  [TELEGRAM_BOT_START_ACTIONS.view_ticket]: 'View ticket',
  [TELEGRAM_BOT_START_ACTIONS.contact]: 'Contact us',
  [TELEGRAM_BOT_START_ACTIONS.faq]: 'FAQ',
  [TELEGRAM_BOT_START_ACTIONS.useful_content]: 'Useful information',
});

const UNSUPPORTED_TERMINAL_STATUSES = new Set([
  'GUEST_CANCELLED',
  'SELLER_NOT_REACHED',
  'CLOSED_UNCONVERTED',
]);

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

function normalizeMessageType(messageType) {
  const normalized = normalizeString(messageType);
  if (!normalized) {
    return null;
  }
  if (!TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES.includes(normalized)) {
    reject(`Unsupported message_type: ${normalized}`);
  }

  return normalized;
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

function buildBookingRequestReference(bookingRequest) {
  return {
    reference_type: 'telegram_booking_request',
    booking_request_id: bookingRequest.booking_request_id,
    guest_profile_id: bookingRequest.guest_profile_id,
    seller_attribution_session_id: bookingRequest.seller_attribution_session_id,
  };
}

function findHistoryItem(profileView, bookingRequestId) {
  return (
    profileView.booking_request_history.find(
      (item) => item.booking_request.booking_request_id === bookingRequestId
    ) || null
  );
}

function findProgression(profileView, bookingRequestId) {
  return (
    profileView.timeline_projection.request_to_handoff_to_presale_progression.find(
      (item) => item.booking_request_id === bookingRequestId
    ) || null
  );
}

function findLatestTicketTimelineItem(profileView, bookingRequestId) {
  const matches = profileView.timeline_projection.guest_ticket_timeline.filter(
    (item) => item.booking_request_id === bookingRequestId
  );

  return matches[matches.length - 1] || null;
}

function hasRequestEvent(historyItem, eventType) {
  return historyItem.booking_request_events.some((event) => event.event_type === eventType);
}

function resolveMessageTypeByState(historyItem) {
  const bookingRequest = historyItem.booking_request;
  const bookingHold = historyItem.booking_hold || null;

  if (UNSUPPORTED_TERMINAL_STATUSES.has(bookingRequest.request_status)) {
    return null;
  }

  if (
    bookingRequest.request_status === 'HOLD_EXPIRED' ||
    bookingHold.hold_status === 'EXPIRED' ||
    hasRequestEvent(historyItem, 'HOLD_EXPIRED')
  ) {
    return TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired;
  }

  if (
    bookingRequest.request_status === 'PREPAYMENT_CONFIRMED' ||
    bookingRequest.request_status === 'CONFIRMED_TO_PRESALE' ||
    Boolean(bookingRequest.confirmed_presale_id) ||
    hasRequestEvent(historyItem, 'PREPAYMENT_CONFIRMED')
  ) {
    return TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed;
  }

  if (bookingHold.hold_status === 'EXTENDED' || hasRequestEvent(historyItem, 'HOLD_EXTENDED')) {
    return TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended;
  }

  if (hasRequestEvent(historyItem, 'REQUEST_CREATED')) {
    return TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created;
  }

  return null;
}

function buildActionButton(action, buttonRole, visibilityFlag = null) {
  return {
    button_id: action,
    action,
    label: BUTTON_LABELS[action] || action,
    button_role: buttonRole,
    visibility_flag: visibilityFlag,
  };
}

function resolvePrimaryAction(messageType, historyItem) {
  if (messageType === TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired) {
    return TELEGRAM_BOT_START_ACTIONS.create_booking_request;
  }

  if (
    messageType === TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed &&
    historyItem.presale_linkage_state?.linked_to_presale
  ) {
    return TELEGRAM_BOT_START_ACTIONS.view_ticket;
  }

  return TELEGRAM_BOT_START_ACTIONS.view_current_request;
}

function buildActionButtons(messageType, historyItem, visibilityFlags) {
  const buttons = [buildActionButton(resolvePrimaryAction(messageType, historyItem), 'primary')];

  if (visibilityFlags.contact_visible) {
    buttons.push(
      buildActionButton(TELEGRAM_BOT_START_ACTIONS.contact, 'secondary', 'contact_visible')
    );
  }

  if (visibilityFlags.useful_content_visible) {
    buttons.push(
      buildActionButton(
        TELEGRAM_BOT_START_ACTIONS.useful_content,
        'secondary',
        'useful_content_visible'
      )
    );
  }

  return buttons;
}

function buildTextFields(messageType, variables) {
  if (messageType === TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created) {
    return {
      headline: 'Booking request received',
      body: `We received your request for ${variables.requested_seats} seat(s) on ${variables.requested_trip_date} at ${variables.requested_time_slot}.`,
      status_line: `Temporary hold expires at ${variables.hold_expires_at}.`,
    };
  }

  if (messageType === TELEGRAM_SERVICE_MESSAGE_TYPES.hold_extended) {
    return {
      headline: 'Hold extended',
      body: `Your temporary hold was extended until ${variables.hold_expires_at}.`,
      status_line: 'Prepayment is still pending.',
    };
  }

  if (messageType === TELEGRAM_SERVICE_MESSAGE_TYPES.hold_expired) {
    return {
      headline: 'Hold expired',
      body: `The temporary hold for ${variables.requested_trip_date} at ${variables.requested_time_slot} has expired.`,
      status_line: 'You can create a new booking request.',
    };
  }

  if (variables.confirmed_presale_id) {
    return {
      headline: 'Booking confirmed',
      body: 'Your booking is confirmed and your ticket is ready.',
      status_line: `Ticket status: ${variables.ticket_status || 'TICKET_READY'}.`,
    };
  }

  return {
    headline: 'Booking confirmed',
    body: 'Your prepayment is confirmed. We are preparing your ticket.',
    status_line: 'Ticket handoff is pending.',
  };
}

function buildTelegramUserSummary(profileView) {
  const guest = profileView.guest_identity || {};
  return {
    guest_profile_id: guest.guest_profile_id || null,
    telegram_user_id: guest.telegram_user_id || null,
    display_name: guest.display_name || null,
    username: guest.username || null,
    language_code: guest.language_code || null,
    phone_e164: guest.phone_e164 || null,
    consent_status: guest.consent_status || null,
    profile_status: guest.profile_status || null,
  };
}

function buildVariables({
  profileView,
  historyItem,
  ticketTimelineItem,
  botStartState,
  messageType,
}) {
  const bookingRequest = historyItem.booking_request;
  const bookingHold = historyItem.booking_hold;
  const linkageState = historyItem.presale_linkage_state || {};
  const canonicalLinkageState = historyItem.canonical_linkage_state || {};
  const telegramUserSummary = buildTelegramUserSummary(profileView);

  return {
    message_type: messageType,
    guest_profile_id: telegramUserSummary.guest_profile_id,
    telegram_user_id: telegramUserSummary.telegram_user_id,
    guest_display_name: telegramUserSummary.display_name,
    guest_username: telegramUserSummary.username,
    guest_language_code: telegramUserSummary.language_code,
    guest_consent_status: telegramUserSummary.consent_status,
    guest_profile_status: telegramUserSummary.profile_status,
    booking_request_id: bookingRequest.booking_request_id,
    requested_trip_date: bookingRequest.requested_trip_date,
    requested_time_slot: bookingRequest.requested_time_slot,
    requested_seats: Number(bookingRequest.requested_seats || 0),
    requested_ticket_mix: bookingRequest.requested_ticket_mix || {},
    contact_phone_e164: bookingRequest.contact_phone_e164,
    request_status: bookingRequest.request_status,
    hold_status: bookingHold?.hold_status || null,
    hold_expires_at: bookingHold?.hold_expires_at || null,
    hold_requested_amount: bookingHold?.requested_amount ?? null,
    hold_currency: bookingHold?.currency || null,
    confirmed_presale_id: linkageState.confirmed_presale_id || null,
    linked_to_presale: Boolean(linkageState.linked_to_presale),
    canonical_linkage_status: canonicalLinkageState.linkage_status || null,
    canonical_presale_status: canonicalLinkageState.canonical_presale?.status || null,
    ticket_status: ticketTimelineItem?.ticket_status || null,
    ticket_state_group: ticketTimelineItem?.state_group || null,
    start_mode: botStartState.start_mode,
  };
}

function buildMessageState({
  historyItem,
  ticketTimelineItem,
  botStartState,
  progression,
  bookingRequestReference,
}) {
  const bookingRequest = historyItem.booking_request;
  const bookingHold = historyItem.booking_hold;
  const linkageState = historyItem.presale_linkage_state || {};
  const canonicalLinkageState = historyItem.canonical_linkage_state || {};

  return {
    booking_request_reference: bookingRequestReference,
    booking_request_id: bookingRequest.booking_request_id,
    guest_profile_id: bookingRequest.guest_profile_id,
    request_status: bookingRequest.request_status,
    hold_status: bookingHold?.hold_status || null,
    hold_expires_at: bookingHold?.hold_expires_at || null,
    start_mode: botStartState.start_mode,
    progression_phase: progression?.current_phase || null,
    ticket_status: ticketTimelineItem?.ticket_status || null,
    ticket_state_group: ticketTimelineItem?.state_group || null,
    presale_linkage: {
      linked_to_presale: Boolean(linkageState.linked_to_presale),
      confirmed_presale_id: linkageState.confirmed_presale_id || null,
      linkage_source: linkageState.linkage_source || null,
      canonical_linkage_status: canonicalLinkageState.linkage_status || null,
      canonical_presale: canonicalLinkageState.canonical_presale || null,
      linked_ticket_summary: canonicalLinkageState.linked_ticket_summary || null,
      trip_linkage_summary: canonicalLinkageState.trip_linkage_summary || null,
    },
  };
}

function buildLatestTimestampSummary({ historyItem, ticketTimelineItem, progression }) {
  const bookingRequest = historyItem.booking_request;
  const bookingHold = historyItem.booking_hold || {};
  const latestEvent =
    historyItem.booking_request_events[historyItem.booking_request_events.length - 1] || null;
  const latestProgressionStep =
    progression?.steps?.slice().sort((left, right) => {
      const leftTime = Date.parse(left.occurred_at || '') || 0;
      const rightTime = Date.parse(right.occurred_at || '') || 0;
      return rightTime - leftTime;
    })[0] || null;

  return buildTelegramLatestTimestampSummary(
    bookingRequest.created_at,
    bookingRequest.last_status_at,
    bookingHold.last_extended_at,
    bookingHold.hold_expires_at,
    latestEvent?.event_at,
    ticketTimelineItem?.occurred_at,
    latestProgressionStep?.occurred_at
  );
}

function buildActionButtonDescriptorsSummary(actionButtons) {
  return {
    total_count: actionButtons.length,
    primary_action:
      actionButtons.find((button) => button.button_role === 'primary')?.action || null,
    descriptors: actionButtons,
  };
}

export class TelegramServiceMessageResolutionService {
  constructor({ guestProfileService, botStartStateService }) {
    this.guestProfileService = guestProfileService;
    this.botStartStateService = botStartStateService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'service-message-resolution-service',
      status: 'read_only_resolution_ready',
      dependencyKeys: ['guestProfileService', 'botStartStateService'],
    });
  }

  resolveMessageInternal({ bookingRequestReference, expectedMessageType = null }) {
    const bookingRequestId = bookingRequestReference.booking_request_id;
    let profileView;
    try {
      profileView = this.guestProfileService.readGuestProfileView({
        booking_request_id: bookingRequestId,
      });
    } catch (error) {
      reject(error?.message || 'Unable to read guest profile view');
    }

    const historyItem = findHistoryItem(profileView, bookingRequestId);
    if (!historyItem) {
      reject(`Booking request not found in profile view: ${bookingRequestId}`);
    }

    const messageType = resolveMessageTypeByState(historyItem);
    if (!messageType) {
      reject(
        `Booking request state is not supported for service-message resolution: ${bookingRequestId}`
      );
    }

    if (expectedMessageType && expectedMessageType !== messageType) {
      reject(
        `Request state resolves to ${messageType}, expected ${expectedMessageType}`
      );
    }

    const progression = findProgression(profileView, bookingRequestId);
    const ticketTimelineItem = findLatestTicketTimelineItem(profileView, bookingRequestId);
    const botStartState = this.botStartStateService.readBotStartStateByBookingRequestReference({
      booking_request_reference: bookingRequestReference,
    });
    const visibilityFlags = {
      contact_visible: Boolean(botStartState.visibility_flags?.contact_visible),
      useful_content_visible: Boolean(botStartState.visibility_flags?.useful_content_visible),
    };
    const actionButtons = buildActionButtons(messageType, historyItem, visibilityFlags);
    const variables = buildVariables({
      profileView,
      historyItem,
      ticketTimelineItem,
      botStartState,
      messageType,
    });
    const fields = buildTextFields(messageType, variables);
    const bookingRequest = historyItem.booking_request;
    const normalizedBookingRequestReference = freezeTelegramHandoffValue(
      buildBookingRequestReference(bookingRequest)
    );
    const messageMode = progression?.current_phase || 'telegram_request_open';

    return freezeTelegramHandoffValue({
      response_version: TELEGRAM_SERVICE_MESSAGE_RESOLUTION_VERSION,
      read_only: true,
      message_type: messageType,
      message_mode: messageMode,
      related_booking_request_reference: normalizedBookingRequestReference,
      telegram_user_summary: buildTelegramUserSummary(profileView),
      resolved_text_payload_summary: {
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS[messageType],
        locale: variables.guest_language_code || 'und',
        fields,
        variables,
      },
      action_button_descriptors_summary: buildActionButtonDescriptorsSummary(actionButtons),
      visibility_flags: visibilityFlags,
      latest_timestamp_summary: buildLatestTimestampSummary({
        historyItem,
        ticketTimelineItem,
        progression,
      }),
      // Compatibility fields for existing internal Telegram consumers.
      message_state: buildMessageState({
        historyItem,
        ticketTimelineItem,
        botStartState,
        progression,
        bookingRequestReference: normalizedBookingRequestReference,
      }),
      text_payload: {
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS[messageType],
        locale: variables.guest_language_code || 'und',
        fields,
        variables,
      },
      action_buttons: actionButtons,
      resolution_source: {
        primary_projection: 'telegram_guest_profile_service',
        action_projection: 'telegram_bot_start_state_service',
        send_intent_created: false,
      },
      resolved_by: profileView.resolved_by,
      requested_booking_request_id: bookingRequestId,
    });
  }

  resolveServiceMessageByBookingRequestReference(input = {}) {
    const bookingRequestReference = normalizeBookingRequestReference(input);
    return this.resolveMessageInternal({
      bookingRequestReference,
      expectedMessageType: null,
    });
  }

  resolveServiceMessage(input = {}) {
    const expectedMessageType = normalizeMessageType(input.message_type || input.messageType);
    const bookingRequestReference = normalizeBookingRequestReference({
      booking_request_reference:
        input.booking_request_reference ||
        input.bookingRequestReference || {
          booking_request_id: input.booking_request_id ?? input.bookingRequestId,
        },
    });

    return this.resolveMessageInternal({
      bookingRequestReference,
      expectedMessageType,
    });
  }
}
