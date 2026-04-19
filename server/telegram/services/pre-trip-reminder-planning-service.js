import {
  buildTelegramHandoffTimestampSummary,
  buildTelegramLatestTimestampSummary,
  freezeTelegramPreTripReminderPlanValue,
  TELEGRAM_PRE_TRIP_REMINDER_OFFSETS_MINUTES,
  TELEGRAM_PRE_TRIP_REMINDER_PLAN_LIST_VERSION,
  TELEGRAM_PRE_TRIP_REMINDER_PLAN_VERSION,
  TELEGRAM_PRE_TRIP_REMINDER_PLANNING_STATES,
  TELEGRAM_PRE_TRIP_REMINDER_TYPES,
} from '../../../shared/telegram/index.js';
import { buildTelegramUserSummaryFromGuestProfileAndEvents } from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_PRE_TRIP_REMINDER_PLAN]';
const SERVICE_NAME = 'telegram_pre_trip_reminder_planning_service';

function rejectReminderPlanning(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectReminderPlanning(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeLimit(value, fallback = 200, max = 500) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function pickBookingRequestReference(input = {}) {
  if (
    (typeof input === 'number' || typeof input === 'string') &&
    String(input).trim() !== ''
  ) {
    return { booking_request_id: Number(input) };
  }

  return (
    input.booking_request_reference ??
    input.bookingRequestReference ??
    input.booking_request ??
    input.bookingRequest ??
    input.reference ??
    input ??
    null
  );
}

function pickTelegramUserReference(input = {}) {
  if (typeof input === 'string') {
    return { telegram_user_id: input };
  }

  return (
    input.telegram_user_reference ??
    input.telegramUserReference ??
    input.telegram_user ??
    input.telegramUser ??
    input.reference ??
    input ??
    null
  );
}

function normalizeBookingRequestId(input = {}) {
  const rawReference = pickBookingRequestReference(input);
  if (!rawReference) {
    rejectReminderPlanning('booking request reference is required');
  }

  const referenceType = normalizeString(
    rawReference.reference_type || 'telegram_booking_request'
  );
  if (referenceType !== 'telegram_booking_request') {
    rejectReminderPlanning(
      `Unsupported booking request reference type: ${referenceType || 'unknown'}`
    );
  }

  return normalizePositiveInteger(
    rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
    'booking_request_reference.booking_request_id'
  );
}

function normalizeTelegramUserId(input = {}) {
  const rawReference = pickTelegramUserReference(input);
  if (!rawReference || typeof rawReference !== 'object' || Array.isArray(rawReference)) {
    rejectReminderPlanning('telegram_user_reference is required');
  }

  const referenceType = normalizeString(rawReference.reference_type || 'telegram_user');
  if (referenceType !== 'telegram_user') {
    rejectReminderPlanning(
      `Unsupported telegram-user reference type: ${referenceType || 'unknown'}`
    );
  }

  const telegramUserId = normalizeString(
    rawReference.telegram_user_id ?? rawReference.telegramUserId
  );
  if (!telegramUserId) {
    rejectReminderPlanning('telegram_user_reference.telegram_user_id is required');
  }

  return telegramUserId;
}

function normalizeReminderPlanningState(value) {
  if (!TELEGRAM_PRE_TRIP_REMINDER_PLANNING_STATES.includes(value)) {
    rejectReminderPlanning(
      `Unsupported reminder planning status: ${String(value || 'unknown')}`
    );
  }

  return value;
}

function normalizeReminderTypes(input = {}) {
  const rawReminderType =
    input.reminder_type ?? input.reminderType ?? input.type ?? input.types ?? null;

  if (rawReminderType === null || rawReminderType === undefined || rawReminderType === '') {
    return TELEGRAM_PRE_TRIP_REMINDER_TYPES;
  }

  const rawValues = Array.isArray(rawReminderType) ? rawReminderType : [rawReminderType];
  const normalizedValues = [...new Set(rawValues.map((value) => normalizeString(value)).filter(Boolean))];
  if (normalizedValues.length === 0) {
    return TELEGRAM_PRE_TRIP_REMINDER_TYPES;
  }
  for (const reminderType of normalizedValues) {
    if (!TELEGRAM_PRE_TRIP_REMINDER_TYPES.includes(reminderType)) {
      rejectReminderPlanning(`Unsupported reminder type: ${reminderType}`);
    }
  }

  return Object.freeze(normalizedValues);
}

function parseTripStartIso(ticketView) {
  const tripDate = normalizeString(ticketView?.date_time_summary?.requested_trip_date);
  const tripTime = normalizeString(ticketView?.date_time_summary?.requested_time_slot);
  if (!tripDate || !tripTime) {
    return null;
  }

  const normalizedTime = tripTime.length === 5 ? `${tripTime}:00` : tripTime;
  const parsed = Date.parse(`${tripDate}T${normalizedTime}.000Z`);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function buildGuestSummaryFromTicketView(ticketView) {
  return {
    telegram_user_summary: ticketView?.telegram_user_summary || null,
    contact_summary: ticketView?.contact_summary || null,
  };
}

function comparePlannedReminderItems(left, right) {
  const leftTime = Date.parse(left.planned_trigger_time_summary?.iso || 0);
  const rightTime = Date.parse(right.planned_trigger_time_summary?.iso || 0);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  const leftRequestId = left.booking_request_reference?.booking_request_id || 0;
  const rightRequestId = right.booking_request_reference?.booking_request_id || 0;
  if (leftRequestId !== rightRequestId) {
    return leftRequestId - rightRequestId;
  }

  return left.reminder_type < right.reminder_type ? -1 : 1;
}

export class TelegramPreTripReminderPlanningService {
  constructor({
    guestProfiles,
    bookingRequests,
    guestTicketViewProjectionService,
    now = () => new Date(),
  }) {
    this.guestProfiles = guestProfiles;
    this.bookingRequests = bookingRequests;
    this.guestTicketViewProjectionService = guestTicketViewProjectionService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'pre-trip-reminder-planning-service',
      status: 'read_only_pre_trip_reminder_planning_ready',
      dependencyKeys: [
        'guestProfiles',
        'bookingRequests',
        'guestTicketViewProjectionService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectReminderPlanning('reminder planning clock returned an unusable timestamp');
    }

    return iso;
  }

  resolveGuestProfileByTelegramUserIdOrThrow(telegramUserId) {
    const guestProfile = this.guestProfiles.findOneBy(
      { telegram_user_id: telegramUserId },
      { orderBy: 'guest_profile_id ASC' }
    );
    if (!guestProfile) {
      rejectReminderPlanning(`Guest profile not found for telegram_user_id: ${telegramUserId}`);
    }

    return guestProfile;
  }

  buildPlanItem({
    ticketView,
    reminderType,
    nowIso,
  }) {
    const deterministicTicketState =
      ticketView?.ticket_status_summary?.deterministic_ticket_state || 'no_ticket_yet';
    const tripStartIso = parseTripStartIso(ticketView);
    const offsetMinutes = TELEGRAM_PRE_TRIP_REMINDER_OFFSETS_MINUTES[reminderType];
    const triggerIso = tripStartIso
      ? new Date(Date.parse(tripStartIso) - offsetMinutes * 60 * 1000).toISOString()
      : null;
    const triggerIsFuture =
      triggerIso !== null && Date.parse(triggerIso) > Date.parse(nowIso);

    let planningStatus = 'reminder_not_possible';
    let eligibilityState = 'ticket_not_linked';

    if (deterministicTicketState === 'linked_ticket_ready') {
      if (!tripStartIso) {
        planningStatus = 'reminder_not_possible';
        eligibilityState = 'trip_time_unavailable';
      } else if (!triggerIsFuture) {
        planningStatus = 'reminder_not_needed';
        eligibilityState = 'trigger_time_elapsed';
      } else {
        planningStatus = 'reminder_planned';
        eligibilityState = 'eligible';
      }
    } else if (deterministicTicketState === 'linked_ticket_completed') {
      planningStatus = 'reminder_not_needed';
      eligibilityState = 'ticket_completed';
    } else if (deterministicTicketState === 'linked_ticket_cancelled_or_unavailable') {
      planningStatus = 'reminder_not_needed';
      eligibilityState = 'ticket_unavailable';
    } else if (deterministicTicketState === 'no_ticket_yet') {
      planningStatus = 'reminder_not_possible';
      eligibilityState = 'ticket_not_linked';
    }

    planningStatus = normalizeReminderPlanningState(planningStatus);

    return freezeTelegramPreTripReminderPlanValue({
      response_version: TELEGRAM_PRE_TRIP_REMINDER_PLAN_VERSION,
      plan_item_type: 'telegram_pre_trip_reminder_plan_item',
      read_only: true,
      planning_only: true,
      planned_by: SERVICE_NAME,
      booking_request_reference: ticketView?.booking_request_reference || null,
      reminder_type: reminderType,
      reminder_planning_status: planningStatus,
      planned_trigger_time_summary: buildTelegramHandoffTimestampSummary(triggerIso),
      ticket_trip_summary: {
        deterministic_ticket_state: deterministicTicketState,
        ticket_availability_state: ticketView?.ticket_availability_state || null,
        requested_trip_date: ticketView?.date_time_summary?.requested_trip_date || null,
        requested_time_slot: ticketView?.date_time_summary?.requested_time_slot || null,
        linked_canonical_presale_reference:
          ticketView?.linked_canonical_presale_reference || null,
      },
      guest_contact_tg_summary: buildGuestSummaryFromTicketView(ticketView),
      reminder_eligibility_state: eligibilityState,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        triggerIso,
        ticketView?.latest_timestamp_summary?.iso
      ),
    });
  }

  planRemindersByBookingRequestReference(input = {}) {
    const bookingRequestId = normalizeBookingRequestId(input);
    const reminderTypes = normalizeReminderTypes(input);
    const ticketView =
      this.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
        bookingRequestId
      );
    const nowIso = this.nowIso();
    const items = reminderTypes.map((reminderType) =>
      this.buildPlanItem({
        ticketView,
        reminderType,
        nowIso,
      })
    );

    return freezeTelegramPreTripReminderPlanValue({
      response_version: TELEGRAM_PRE_TRIP_REMINDER_PLAN_LIST_VERSION,
      read_only: true,
      planning_only: true,
      planned_by: SERVICE_NAME,
      booking_request_reference: ticketView.booking_request_reference,
      item_count: items.length,
      items,
    });
  }

  listPlannedRemindersForTelegramGuest(input = {}) {
    const telegramUserId = normalizeTelegramUserId(input);
    const guestProfile = this.resolveGuestProfileByTelegramUserIdOrThrow(telegramUserId);
    const reminderTypes = normalizeReminderTypes(input);
    const bookingRequests = this.bookingRequests.listBy(
      { guest_profile_id: guestProfile.guest_profile_id },
      {
        orderBy: 'created_at DESC, booking_request_id DESC',
        limit: normalizeLimit(input.scan_limit ?? input.scanLimit),
      }
    );
    const nowIso = this.nowIso();

    const allItems = bookingRequests
      .flatMap((bookingRequest) => {
        const ticketView =
          this.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
            bookingRequest.booking_request_id
          );
        return reminderTypes.map((reminderType) =>
          this.buildPlanItem({
            ticketView,
            reminderType,
            nowIso,
          })
        );
      })
      .filter((item) => item.reminder_planning_status === 'reminder_planned')
      .sort(comparePlannedReminderItems);

    return freezeTelegramPreTripReminderPlanValue({
      response_version: TELEGRAM_PRE_TRIP_REMINDER_PLAN_LIST_VERSION,
      read_only: true,
      planning_only: true,
      planned_by: SERVICE_NAME,
      list_scope: 'telegram_guest_planned_reminders',
      telegram_user_summary: buildTelegramUserSummaryFromGuestProfileAndEvents({
        guestProfile,
        events: [],
      }),
      item_count: allItems.length,
      items: allItems,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        ...allItems.map((item) => item.latest_timestamp_summary?.iso)
      ),
    });
  }

  planByBookingRequestReference(input = {}) {
    return this.planRemindersByBookingRequestReference(input);
  }

  listForTelegramGuest(input = {}) {
    return this.listPlannedRemindersForTelegramGuest(input);
  }
}
