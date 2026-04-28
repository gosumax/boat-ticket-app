import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramGuestCommandActionValue,
  TELEGRAM_GUEST_COMMAND_ACTION_RESULT_VERSION,
  TELEGRAM_GUEST_COMMAND_ACTION_TYPES,
} from '../../../shared/telegram/index.js';

const SERVICE_NAME = 'telegram_guest_command_action_orchestration_service';
const ERROR_PREFIX = '[TELEGRAM_GUEST_COMMAND_ACTION]';
const SUPPORTED_ACTION_TYPES = new Set(TELEGRAM_GUEST_COMMAND_ACTION_TYPES);

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

function sortResultValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortResultValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortResultValue(value[key])])
  );
}

function freezeSortedResultValue(value) {
  return freezeTelegramGuestCommandActionValue(sortResultValue(value));
}

function normalizeActionType(input = {}) {
  const actionType = normalizeString(
    input.action_type ?? input.actionType ?? input.action ?? input.type
  );
  if (!actionType || !SUPPORTED_ACTION_TYPES.has(actionType)) {
    reject(`Unsupported action type: ${actionType || 'unknown'}`);
  }

  return actionType;
}

function normalizeTelegramUserReference(input = {}) {
  const reference =
    input.telegram_user_reference ??
    input.telegramUserReference ??
    input.telegram_user ??
    input.telegramUser ??
    input.reference ??
    null;
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    reject('telegram_user_reference is required');
  }

  const referenceType = normalizeString(reference.reference_type || 'telegram_user');
  if (referenceType !== 'telegram_user') {
    reject(`Unsupported telegram-user reference type: ${referenceType || 'unknown'}`);
  }

  const telegramUserId = normalizeString(
    reference.telegram_user_id ?? reference.telegramUserId
  );
  if (!telegramUserId) {
    reject('telegram_user_reference.telegram_user_id is required');
  }

  return freezeSortedResultValue({
    reference_type: 'telegram_user',
    telegram_user_id: telegramUserId,
  });
}

function normalizeBookingRequestReference(input = {}) {
  const reference =
    input.booking_request_reference ??
    input.bookingRequestReference ??
    input.booking_request ??
    input.bookingRequest ??
    input.reference ??
    null;
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    reject('booking_request_reference is required');
  }

  const referenceType = normalizeString(reference.reference_type || 'telegram_booking_request');
  if (referenceType !== 'telegram_booking_request') {
    reject(`Unsupported booking-request reference type: ${referenceType || 'unknown'}`);
  }

  return freezeSortedResultValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: normalizePositiveInteger(
      reference.booking_request_id ?? reference.bookingRequestId,
      'booking_request_reference.booking_request_id'
    ),
  });
}

function buildTelegramUserReferenceFromSummary(telegramUserSummary = null) {
  const telegramUserId = normalizeString(telegramUserSummary?.telegram_user_id);
  if (!telegramUserId) {
    return null;
  }

  return freezeSortedResultValue({
    reference_type: 'telegram_user',
    telegram_user_id: telegramUserId,
  });
}

function pickLatestTimestamp(...items) {
  const values = items
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .filter((item) => !Number.isNaN(Date.parse(item)));

  if (values.length === 0) {
    return null;
  }

  return values.sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function isInvalidInputError(error) {
  const message = String(error?.message || '');
  return (
    message.includes(ERROR_PREFIX) ||
    message.includes('Unsupported') ||
    message.includes('is required') ||
    message.includes('must be a positive integer')
  );
}

function isAvailabilityError(error) {
  const message = String(error?.message || '');
  return (
    message.includes('not found') ||
    message.includes('not projectable') ||
    message.includes('does not match') ||
    message.includes('not cancellable') ||
    message.includes('already cancelled') ||
    message.includes('already expired') ||
    message.includes('already prepayment-confirmed')
  );
}

function isActionAvailable(actionType, actionState) {
  if (actionType === 'open_ticket') {
    return Boolean(actionState?.can_view_ticket);
  }
  if (actionType === 'open_my_tickets') {
    return true;
  }
  if (actionType === 'open_trips') {
    return Boolean(actionState?.can_view_trips);
  }
  if (actionType === 'open_useful_content') {
    return Boolean(actionState?.can_open_useful_content);
  }
  if (actionType === 'open_faq') {
    return Boolean(actionState?.can_open_faq);
  }
  if (actionType === 'open_contact') {
    return Boolean(actionState?.can_contact);
  }
  if (actionType === 'cancel_before_prepayment') {
    return Boolean(actionState?.can_cancel_before_prepayment);
  }

  return false;
}

function buildVisibilitySummary(actionState, actionAvailable) {
  return freezeSortedResultValue({
    current_guest_action_state: actionState?.current_guest_action_state || null,
    active_request_flag: Boolean(actionState?.active_request_flag),
    linked_ticket_flag: Boolean(actionState?.linked_ticket_flag),
    can_view_trips: Boolean(actionState?.can_view_trips),
    can_view_ticket: Boolean(actionState?.can_view_ticket),
    can_contact: Boolean(actionState?.can_contact),
    can_cancel_before_prepayment: Boolean(actionState?.can_cancel_before_prepayment),
    can_open_useful_content: Boolean(actionState?.can_open_useful_content),
    can_open_faq: Boolean(actionState?.can_open_faq),
    action_available: Boolean(actionAvailable),
  });
}

function buildSupportContentSummary(usefulFeed = null) {
  if (!usefulFeed || typeof usefulFeed !== 'object') {
    return freezeSortedResultValue({
      response_version: null,
      list_scope: 'telegram_guest_useful_content_feed',
      content_grouping_summary: ['trip_help'],
      item_count: 0,
      items: [],
    });
  }

  const feedItems = Array.isArray(usefulFeed.items) ? usefulFeed.items : [];
  const items = feedItems
    .filter((item) => normalizeString(item?.content_reference))
    .slice(0, 3);

  return freezeSortedResultValue({
    response_version: normalizeString(usefulFeed.response_version),
    list_scope: normalizeString(usefulFeed.list_scope) || 'telegram_guest_useful_content_feed',
    content_grouping_summary: ['trip_help'],
    item_count: items.length,
    items,
  });
}

function buildContactSummary(profileView = {}, usefulFeed = null) {
  const guestIdentity = profileView.guest_identity || {};
  const activeRequest = profileView.current_active_request?.booking_request || null;
  const supportContentSummary = buildSupportContentSummary(usefulFeed);

  return freezeSortedResultValue({
    preferred_contact_phone_e164:
      normalizeString(activeRequest?.contact_phone_e164) ||
      normalizeString(guestIdentity.phone_e164) ||
      null,
    guest_phone_e164: normalizeString(guestIdentity.phone_e164),
    active_request_contact_phone_e164: normalizeString(activeRequest?.contact_phone_e164),
    support_action_reference: 'contact_support',
    support_content_feed_summary: supportContentSummary,
    contact_resolution_status:
      supportContentSummary.item_count > 0 ||
      normalizeString(activeRequest?.contact_phone_e164) ||
      normalizeString(guestIdentity.phone_e164)
        ? 'resolved'
        : 'default_fallback',
  });
}

function readBookingRequestsForGuestOrNull(
  bookingRequestLifecycleProjectionService,
  telegramUserReference
) {
  if (!telegramUserReference) {
    return null;
  }

  try {
    return bookingRequestLifecycleProjectionService.listBookingRequestsForGuest({
      telegram_user_reference: telegramUserReference,
    });
  } catch {
    return null;
  }
}

function readTicketViewForGuestOrNull(guestTicketViewProjectionService, telegramUserReference) {
  if (!telegramUserReference) {
    return null;
  }

  try {
    return guestTicketViewProjectionService.readGuestTicketViewByTelegramUserReference({
      telegram_user_reference: telegramUserReference,
    });
  } catch {
    return null;
  }
}

function mapStatusByAction(actionType) {
  if (actionType === 'open_trips' || actionType === 'open_contact') {
    return 'action_available';
  }

  return 'action_completed';
}

export class TelegramGuestCommandActionOrchestrationService {
  constructor({
    guestActionStateProjectionService,
    guestTicketViewProjectionService,
    guestProfileService,
    bookingRequestLifecycleProjectionService,
    usefulContentFaqProjectionService,
    bookingRequestGuestCancelBeforePrepaymentService,
    now = () => new Date(),
  }) {
    this.guestActionStateProjectionService = guestActionStateProjectionService;
    this.guestTicketViewProjectionService = guestTicketViewProjectionService;
    this.guestProfileService = guestProfileService;
    this.bookingRequestLifecycleProjectionService = bookingRequestLifecycleProjectionService;
    this.usefulContentFaqProjectionService = usefulContentFaqProjectionService;
    this.bookingRequestGuestCancelBeforePrepaymentService =
      bookingRequestGuestCancelBeforePrepaymentService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'telegram_guest_command_action_orchestration_ready',
      dependencyKeys: [
        'guestActionStateProjectionService',
        'guestTicketViewProjectionService',
        'guestProfileService',
        'bookingRequestLifecycleProjectionService',
        'usefulContentFaqProjectionService',
        'bookingRequestGuestCancelBeforePrepaymentService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      throw new Error('[TELEGRAM_GUEST_COMMAND_ACTION] invalid clock timestamp');
    }
    return iso;
  }

  buildResult({
    actionType = null,
    actionStatus,
    telegramUserSummary = null,
    bookingRequestReference = null,
    resolvedDataSummary = null,
    visibilitySummary = null,
    rejectionReason = null,
    nowIso,
    timestamps = [],
  }) {
    return freezeSortedResultValue({
      response_version: TELEGRAM_GUEST_COMMAND_ACTION_RESULT_VERSION,
      orchestrated_by: SERVICE_NAME,
      action_type: actionType,
      action_status: actionStatus,
      telegram_user_summary: telegramUserSummary || null,
      related_booking_request_reference: bookingRequestReference || null,
      resolved_data_summary: resolvedDataSummary || null,
      visibility_availability_summary: visibilitySummary || null,
      rejection_reason: rejectionReason || null,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        pickLatestTimestamp(...timestamps)
      ),
    });
  }

  resolveBookingReferenceForCancel({ bookingRequestReference, telegramUserReference }) {
    if (bookingRequestReference) {
      return bookingRequestReference;
    }
    if (!telegramUserReference) {
      return null;
    }

    const latest =
      this.bookingRequestLifecycleProjectionService.readLatestLifecycleStateForGuest({
        telegram_user_reference: telegramUserReference,
      });

    return latest?.booking_request_reference || null;
  }

  resolveActionByUser(actionType, telegramUserReference, actionState, input = {}) {
    if (actionType === 'open_ticket') {
      const ticketViewSummary =
        this.guestTicketViewProjectionService.readGuestTicketViewByTelegramUserReference({
          telegram_user_reference: telegramUserReference,
        });
      const bookingRequestsSummary = readBookingRequestsForGuestOrNull(
        this.bookingRequestLifecycleProjectionService,
        telegramUserReference
      );
      if (!bookingRequestsSummary) {
        return ticketViewSummary;
      }
      return freezeSortedResultValue({
        ...ticketViewSummary,
        booking_requests_summary: bookingRequestsSummary,
      });
    }
    if (actionType === 'open_my_tickets') {
      const bookingRequestsSummary =
        this.bookingRequestLifecycleProjectionService.listBookingRequestsForGuest({
          telegram_user_reference: telegramUserReference,
        });
      const ticketViewSummary = readTicketViewForGuestOrNull(
        this.guestTicketViewProjectionService,
        telegramUserReference
      );
      if (!ticketViewSummary) {
        return bookingRequestsSummary;
      }
      return freezeSortedResultValue({
        ...bookingRequestsSummary,
        ticket_view_summary: ticketViewSummary,
      });
    }
    if (actionType === 'open_trips') {
      const profileView = this.guestProfileService.readGuestProfileView({
        telegram_user_id: telegramUserReference.telegram_user_id,
      });
      return freezeSortedResultValue({
        requested_booking_request_id: profileView.requested_booking_request_id || null,
        current_active_request_reference:
          profileView.current_active_request?.booking_request
            ? {
                reference_type: 'telegram_booking_request',
                booking_request_id:
                  profileView.current_active_request.booking_request.booking_request_id,
              }
            : null,
        trip_timeline_size:
          profileView.timeline_projection?.trip_timeline_status_history?.length || 0,
        state_buckets: profileView.timeline_projection?.state_buckets || {},
      });
    }
    if (actionType === 'open_useful_content') {
      return this.usefulContentFaqProjectionService.readWeatherUsefulContentModelForTelegramGuest({
        telegram_user_reference: telegramUserReference,
      });
    }
    if (actionType === 'open_faq') {
      return this.usefulContentFaqProjectionService.readFaqListForTelegramGuest({
        telegram_user_reference: telegramUserReference,
      });
    }
    if (actionType === 'open_contact') {
      const profileView = this.guestProfileService.readGuestProfileView({
        telegram_user_id: telegramUserReference.telegram_user_id,
      });
      const usefulFeed =
        this.usefulContentFaqProjectionService.readUsefulContentFeedForTelegramGuest({
          telegram_user_reference: telegramUserReference,
          content_grouping: 'trip_help',
        });
      return buildContactSummary(profileView, usefulFeed);
    }
    if (actionType === 'cancel_before_prepayment') {
      const bookingRequestReference = this.resolveBookingReferenceForCancel({
        bookingRequestReference: null,
        telegramUserReference,
      });
      if (!bookingRequestReference) {
        throw new Error('Booking request is not available for cancellation');
      }
      const lifecycleState =
        this.bookingRequestLifecycleProjectionService
          .readCurrentLifecycleStateByBookingRequestReference({
            booking_request_reference: bookingRequestReference,
          });
      return this.bookingRequestGuestCancelBeforePrepaymentService.cancelBeforePrepayment({
        booking_request_reference: lifecycleState.booking_request_reference,
        telegram_user_summary: lifecycleState.telegram_user_summary,
        idempotency_key: input.idempotency_key ?? input.idempotencyKey ?? null,
      });
    }

    reject(`Unsupported action type: ${actionType || 'unknown'}`);
  }

  resolveActionByBooking(
    actionType,
    bookingRequestReference,
    telegramUserReference,
    actionState,
    input = {}
  ) {
    if (actionType === 'open_ticket') {
      const ticketViewSummary =
        this.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference({
          booking_request_reference: bookingRequestReference,
        });
      const resolvedTelegramUserReference =
        telegramUserReference ||
        buildTelegramUserReferenceFromSummary(ticketViewSummary.telegram_user_summary);
      const bookingRequestsSummary = readBookingRequestsForGuestOrNull(
        this.bookingRequestLifecycleProjectionService,
        resolvedTelegramUserReference
      );
      if (!bookingRequestsSummary) {
        return ticketViewSummary;
      }
      return freezeSortedResultValue({
        ...ticketViewSummary,
        booking_requests_summary: bookingRequestsSummary,
      });
    }
    if (actionType === 'open_my_tickets') {
      const bookingRequestsSummary =
        this.bookingRequestLifecycleProjectionService.listBookingRequestsForGuest({
          telegram_user_reference: telegramUserReference,
        });
      const ticketViewSummary =
        this.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference({
          booking_request_reference: bookingRequestReference,
        });
      if (!ticketViewSummary) {
        return bookingRequestsSummary;
      }
      return freezeSortedResultValue({
        ...bookingRequestsSummary,
        ticket_view_summary: ticketViewSummary,
      });
    }
    if (actionType === 'open_trips') {
      const profileView = this.guestProfileService.readGuestProfileView({
        booking_request_id: bookingRequestReference.booking_request_id,
      });
      return freezeSortedResultValue({
        requested_booking_request_id: profileView.requested_booking_request_id || null,
        current_active_request_reference:
          profileView.current_active_request?.booking_request
            ? {
                reference_type: 'telegram_booking_request',
                booking_request_id:
                  profileView.current_active_request.booking_request.booking_request_id,
              }
            : null,
        trip_timeline_size:
          profileView.timeline_projection?.trip_timeline_status_history?.length || 0,
        state_buckets: profileView.timeline_projection?.state_buckets || {},
      });
    }
    if (actionType === 'open_useful_content') {
      return this.usefulContentFaqProjectionService.readWeatherUsefulContentModelForTelegramGuest({
        telegram_user_reference: telegramUserReference,
        booking_request_reference: bookingRequestReference,
      });
    }
    if (actionType === 'open_faq') {
      return this.usefulContentFaqProjectionService.readFaqListForTelegramGuest({
        telegram_user_reference: telegramUserReference,
      });
    }
    if (actionType === 'open_contact') {
      const profileView = this.guestProfileService.readGuestProfileView({
        booking_request_id: bookingRequestReference.booking_request_id,
      });
      const usefulFeed =
        this.usefulContentFaqProjectionService.readUsefulContentFeedForTelegramGuest({
          telegram_user_reference: telegramUserReference,
          content_grouping: 'trip_help',
        });
      return buildContactSummary(profileView, usefulFeed);
    }
    if (actionType === 'cancel_before_prepayment') {
      const lifecycleState =
        this.bookingRequestLifecycleProjectionService
          .readCurrentLifecycleStateByBookingRequestReference({
            booking_request_reference: bookingRequestReference,
          });
      return this.bookingRequestGuestCancelBeforePrepaymentService.cancelBeforePrepayment({
        booking_request_reference: lifecycleState.booking_request_reference,
        telegram_user_summary: lifecycleState.telegram_user_summary,
        idempotency_key: input.idempotency_key ?? input.idempotencyKey ?? null,
      });
    }

    reject(`Unsupported action type: ${actionType || 'unknown'}`);
  }

  executeGuestActionByTelegramUserReference(input = {}) {
    const nowIso = this.nowIso();
    let actionType = null;
    let telegramUserReference = null;

    try {
      actionType = normalizeActionType(input);
      telegramUserReference = normalizeTelegramUserReference(input);
      const actionState =
        this.guestActionStateProjectionService.readGuestActionStateByTelegramUserReference({
          telegram_user_reference: telegramUserReference,
        });
      const actionAvailable = isActionAvailable(actionType, actionState);
      const visibilitySummary = buildVisibilitySummary(actionState, actionAvailable);
      if (!actionAvailable) {
        return this.buildResult({
          actionType,
          actionStatus: 'action_not_available',
          telegramUserSummary: actionState.telegram_user_summary || null,
          visibilitySummary,
          nowIso,
          timestamps: [actionState.latest_timestamp_summary?.iso],
        });
      }

      const resolvedDataSummary = this.resolveActionByUser(
        actionType,
        telegramUserReference,
        actionState,
        input
      );

      return this.buildResult({
        actionType,
        actionStatus: mapStatusByAction(actionType),
        telegramUserSummary: actionState.telegram_user_summary || null,
        bookingRequestReference: resolvedDataSummary.booking_request_reference || null,
        resolvedDataSummary,
        visibilitySummary,
        nowIso,
        timestamps: [
          actionState.latest_timestamp_summary?.iso,
          resolvedDataSummary.latest_timestamp_summary?.iso,
        ],
      });
    } catch (error) {
      if (!actionType || isInvalidInputError(error)) {
        return this.buildResult({
          actionType,
          actionStatus: 'action_rejected_invalid_input',
          rejectionReason: normalizeString(error?.message) || 'invalid_input',
          nowIso,
        });
      }
      if (isAvailabilityError(error)) {
        return this.buildResult({
          actionType,
          actionStatus: 'action_not_available',
          rejectionReason: normalizeString(error?.message) || 'action_not_available',
          nowIso,
        });
      }

      throw error;
    }
  }

  executeGuestActionByBookingRequestReference(input = {}) {
    const nowIso = this.nowIso();
    let actionType = null;
    let bookingRequestReference = null;

    try {
      actionType = normalizeActionType(input);
      bookingRequestReference = normalizeBookingRequestReference(input);
      const actionState =
        this.guestActionStateProjectionService.readGuestActionStateByBookingRequestReference({
          booking_request_reference: bookingRequestReference,
        });
      const actionAvailable = isActionAvailable(actionType, actionState);
      const visibilitySummary = buildVisibilitySummary(actionState, actionAvailable);
      if (!actionAvailable) {
        return this.buildResult({
          actionType,
          actionStatus: 'action_not_available',
          telegramUserSummary: actionState.telegram_user_summary || null,
          bookingRequestReference,
          visibilitySummary,
          nowIso,
          timestamps: [actionState.latest_timestamp_summary?.iso],
        });
      }

      const telegramUserReference = buildTelegramUserReferenceFromSummary(
        actionState.telegram_user_summary
      );
      const resolvedDataSummary = this.resolveActionByBooking(
        actionType,
        bookingRequestReference,
        telegramUserReference,
        actionState,
        input
      );

      return this.buildResult({
        actionType,
        actionStatus: mapStatusByAction(actionType),
        telegramUserSummary: actionState.telegram_user_summary || null,
        bookingRequestReference,
        resolvedDataSummary,
        visibilitySummary,
        nowIso,
        timestamps: [
          actionState.latest_timestamp_summary?.iso,
          resolvedDataSummary.latest_timestamp_summary?.iso,
        ],
      });
    } catch (error) {
      if (!actionType || isInvalidInputError(error)) {
        return this.buildResult({
          actionType,
          actionStatus: 'action_rejected_invalid_input',
          bookingRequestReference,
          rejectionReason: normalizeString(error?.message) || 'invalid_input',
          nowIso,
        });
      }
      if (isAvailabilityError(error)) {
        return this.buildResult({
          actionType,
          actionStatus: 'action_not_available',
          bookingRequestReference,
          rejectionReason: normalizeString(error?.message) || 'action_not_available',
          nowIso,
        });
      }

      throw error;
    }
  }
}
