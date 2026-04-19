import {
  freezeTelegramHandoffValue,
  TELEGRAM_BOT_START_MODES,
  TELEGRAM_GUEST_ACTION_STATES,
  TELEGRAM_GUEST_ACTION_STATE_PROJECTION_VERSION,
} from '../../../shared/telegram/index.js';

const ERROR_PREFIX = '[TELEGRAM_GUEST_ACTION_STATE]';

const CANCELLABLE_ACTIVE_REQUEST_STATUSES = new Set([
  'NEW',
  'ATTRIBUTED',
  'CONTACT_IN_PROGRESS',
  'HOLD_ACTIVE',
  'WAITING_PREPAYMENT',
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

function resolveGuestActionState(startMode) {
  if (startMode === TELEGRAM_BOT_START_MODES.linked_ticket) {
    return TELEGRAM_GUEST_ACTION_STATES.confirmed_with_ticket;
  }
  if (startMode === TELEGRAM_BOT_START_MODES.active_request) {
    return TELEGRAM_GUEST_ACTION_STATES.waiting_for_prepayment;
  }
  if (startMode === TELEGRAM_BOT_START_MODES.completed_guest_without_active_request) {
    return TELEGRAM_GUEST_ACTION_STATES.completed_or_idle;
  }
  if (startMode === TELEGRAM_BOT_START_MODES.new_guest) {
    return TELEGRAM_GUEST_ACTION_STATES.browsing_only;
  }

  reject(`Unsupported bot start mode for projection: ${startMode || 'unknown'}`);
}

function buildProjectionFromStartState(startState) {
  const activeRequestSummary = startState.active_booking_request_summary || null;
  const linkedTicketSummary = startState.latest_ticket_presale_linkage_summary || null;
  const currentGuestActionState = resolveGuestActionState(startState.start_mode);
  const visibilityFlags = startState.visibility_flags || {};
  const activeRequestStatus = activeRequestSummary?.request_status || null;

  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_GUEST_ACTION_STATE_PROJECTION_VERSION,
    read_only: true,
    projection_only: true,
    telegram_user_summary: startState.telegram_user_summary || null,
    current_guest_action_state: currentGuestActionState,
    active_request_flag: Boolean(activeRequestSummary),
    linked_ticket_flag: Boolean(linkedTicketSummary),
    can_view_trips: true,
    can_view_ticket: Boolean(linkedTicketSummary),
    can_contact: Boolean(visibilityFlags.contact_visible ?? true),
    can_cancel_before_prepayment:
      Boolean(activeRequestSummary) &&
      CANCELLABLE_ACTIVE_REQUEST_STATUSES.has(activeRequestStatus),
    can_open_useful_content: Boolean(visibilityFlags.useful_content_visible ?? true),
    can_open_faq: Boolean(visibilityFlags.faq_visible ?? true),
    latest_timestamp_summary: startState.latest_timestamp_summary || null,
    source_start_mode: startState.start_mode || null,
    requested_booking_request_id: startState.requested_booking_request_id || null,
  });
}

export class TelegramGuestActionStateProjectionService {
  constructor({ botStartStateService }) {
    this.botStartStateService = botStartStateService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'guest-action-state-projection-service',
      status: 'read_only_projection_ready',
      dependencyKeys: ['botStartStateService'],
    });
  }

  readGuestActionStateByTelegramUserReference(input = {}) {
    const telegramUserReference = normalizeTelegramUserReference(input);
    const startState = this.botStartStateService.readBotStartStateByTelegramUserReference({
      telegram_user_reference: telegramUserReference,
    });

    return buildProjectionFromStartState(startState);
  }

  readGuestActionStateByBookingRequestReference(input = {}) {
    const bookingRequestReference = normalizeBookingRequestReference(input);
    const startState = this.botStartStateService.readBotStartStateByBookingRequestReference({
      booking_request_reference: bookingRequestReference,
    });

    return buildProjectionFromStartState(startState);
  }
}
