import {
  buildTelegramCanonicalPresaleReference,
  buildTelegramContactPhoneSummary,
  buildTelegramHandoffTimestampSummary,
  buildTelegramLatestTimestampSummary,
  freezeTelegramGuestTicketViewValue,
  TELEGRAM_GUEST_TICKET_AVAILABILITY_STATES,
  TELEGRAM_GUEST_TICKET_STATES,
  TELEGRAM_GUEST_TICKET_VIEW_PROJECTION_VERSION,
} from '../../../shared/telegram/index.js';
import {
  buildBuyerTicketReferenceSummary as buildCanonicalBuyerTicketReferenceSummary,
  buildDispatcherBoardingQrSummary,
} from '../../ticketing/buyer-ticket-reference.mjs';
import {
  buildBookingRequestReference,
  buildTelegramUserSummaryFromGuestProfileAndEvents,
} from './booking-request-lifecycle-shared.js';
import { resolveTelegramBuyerSellerContactSummary } from './buyer-seller-contact-shared.js';

const ERROR_PREFIX = '[TELEGRAM_GUEST_TICKET_VIEW]';
const SERVICE_NAME = 'telegram_guest_ticket_view_projection_service';

const CANCELLED_PRESALE_STATUSES = new Set(['CANCELLED', 'EXPIRED', 'VOID', 'DELETED']);
const READY_TICKET_STATUSES = new Set([
  'ACTIVE',
  'READY',
  'TICKET_READY',
  'BOARDING_READY',
  'REMINDER_SENT',
]);
const COMPLETED_TICKET_STATUSES = new Set(['USED', 'COMPLETED', 'BOARDED']);
const UNAVAILABLE_TICKET_STATUSES = new Set([
  'CANCELLED',
  'VOID',
  'REFUNDED',
  'DELETED',
]);

const CANONICAL_PRESALE_COLUMNS = Object.freeze([
  'id',
  'status',
  'slot_uid',
  'boat_slot_id',
  'business_day',
  'number_of_seats',
  'total_price',
  'prepayment_amount',
  'customer_phone',
  'created_at',
  'updated_at',
]);

const CANONICAL_TICKET_COLUMNS = Object.freeze([
  'id',
  'presale_id',
  'boat_slot_id',
  'status',
]);

function rejectGuestTicketView(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectGuestTicketView(`${label} must be a positive integer`);
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

function normalizeTicketState(value) {
  if (!TELEGRAM_GUEST_TICKET_STATES.includes(value)) {
    rejectGuestTicketView(`Unsupported deterministic ticket state: ${String(value || 'unknown')}`);
  }

  return value;
}

function normalizeAvailabilityState(value) {
  if (!TELEGRAM_GUEST_TICKET_AVAILABILITY_STATES.includes(value)) {
    rejectGuestTicketView(`Unsupported ticket availability state: ${String(value || 'unknown')}`);
  }

  return value;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
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

function pickCanonicalPresaleReference(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return { reference_type: 'canonical_presale', presale_id: Number(input) };
  }

  return (
    input.canonical_presale_reference ??
    input.canonicalPresaleReference ??
    input.presale_reference ??
    input.presaleReference ??
    input.reference ??
    input ??
    null
  );
}

function compareBookingRequestsByRecency(left, right) {
  const leftTime = Date.parse(left.last_status_at || left.created_at || 0);
  const rightTime = Date.parse(right.last_status_at || right.created_at || 0);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return right.booking_request_id - left.booking_request_id;
}

function readStatusCounts(statusCounts = []) {
  return new Map(
    (Array.isArray(statusCounts) ? statusCounts : [])
      .map((item) => ({
        status: normalizeString(item?.status)?.toUpperCase() || null,
        count: Number(item?.count || 0),
      }))
      .filter((item) => item.status)
      .map((item) => [item.status, item.count])
  );
}

function hasAnyStatus(statusCounts, statusSet) {
  for (const status of statusCounts.keys()) {
    if (statusSet.has(status)) {
      return true;
    }
  }

  return false;
}

function parseTripStartIso(requestedTripDate, requestedTimeSlot) {
  const dateValue = normalizeString(requestedTripDate);
  const timeValue = normalizeString(requestedTimeSlot);
  if (!dateValue || !timeValue) {
    return null;
  }

  const compactTime = timeValue.length === 5 ? `${timeValue}:00` : timeValue;
  const parsed = Date.parse(`${dateValue}T${compactTime}.000Z`);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

export class TelegramGuestTicketViewProjectionService {
  constructor({
    guestProfiles,
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    sellerAttributionSessions,
    trafficSources,
    sourceQRCodes,
    sourceRegistryItems,
    guestProfileService,
  }) {
    this.guestProfiles = guestProfiles;
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.trafficSources = trafficSources;
    this.sourceQRCodes = sourceQRCodes;
    this.sourceRegistryItems = sourceRegistryItems;
    this.guestProfileService = guestProfileService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'guest-ticket-view-projection-service',
      status: 'read_only_guest_ticket_view_projection_ready',
      dependencyKeys: [
        'guestProfiles',
        'bookingRequests',
        'bookingHolds',
        'bookingRequestEvents',
        'sellerAttributionSessions',
        'trafficSources',
        'sourceQRCodes',
        'sourceRegistryItems',
        'guestProfileService',
      ],
    });
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectGuestTicketView(`Invalid booking request reference: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  getGuestProfileOrThrow(guestProfileId) {
    const guestProfile = this.guestProfiles.getById(guestProfileId);
    if (!guestProfile) {
      rejectGuestTicketView(`Guest profile not found: ${guestProfileId}`);
    }

    return guestProfile;
  }

  listRequestEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  normalizeBookingRequestId(input = {}) {
    const rawReference = pickBookingRequestReference(input);
    if (!rawReference) {
      rejectGuestTicketView('booking request reference is required');
    }

    const referenceType = normalizeString(
      rawReference.reference_type || 'telegram_booking_request'
    );
    if (referenceType !== 'telegram_booking_request') {
      rejectGuestTicketView(
        `Unsupported booking request reference type: ${referenceType || 'unknown'}`
      );
    }

    return normalizePositiveInteger(
      rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
      'booking_request_reference.booking_request_id'
    );
  }

  normalizeTelegramUserId(input = {}) {
    const rawReference = pickTelegramUserReference(input);
    if (!rawReference || typeof rawReference !== 'object' || Array.isArray(rawReference)) {
      rejectGuestTicketView('telegram_user_reference is required');
    }

    const referenceType = normalizeString(rawReference.reference_type || 'telegram_user');
    if (referenceType !== 'telegram_user') {
      rejectGuestTicketView(
        `Unsupported telegram-user reference type: ${referenceType || 'unknown'}`
      );
    }

    const telegramUserId = normalizeString(
      rawReference.telegram_user_id ?? rawReference.telegramUserId
    );
    if (!telegramUserId) {
      rejectGuestTicketView('telegram_user_reference.telegram_user_id is required');
    }

    return telegramUserId;
  }

  normalizeCanonicalPresaleId(input = {}) {
    const rawReference = pickCanonicalPresaleReference(input);
    if (!rawReference) {
      rejectGuestTicketView('canonical presale reference is required');
    }

    const referenceType = normalizeString(rawReference.reference_type || 'canonical_presale');
    if (referenceType !== 'canonical_presale') {
      rejectGuestTicketView(
        `Unsupported canonical presale reference type: ${referenceType || 'unknown'}`
      );
    }

    return normalizePositiveInteger(
      rawReference.presale_id ?? rawReference.presaleId ?? rawReference,
      'canonical_presale_reference.presale_id'
    );
  }

  resolveGuestProfileByTelegramUserIdOrThrow(telegramUserId) {
    const guestProfile = this.guestProfiles.findOneBy(
      { telegram_user_id: telegramUserId },
      { orderBy: 'guest_profile_id ASC' }
    );
    if (!guestProfile) {
      rejectGuestTicketView(`Guest profile not found for telegram_user_id: ${telegramUserId}`);
    }

    return guestProfile;
  }

  resolveHistoryForBookingRequestOrThrow(bookingRequestId) {
    try {
      const profileView = this.guestProfileService.readGuestProfileView({
        booking_request_id: bookingRequestId,
      });
      const historyItem = (profileView.booking_request_history || []).find(
        (item) => item?.booking_request?.booking_request_id === bookingRequestId
      );
      if (!historyItem) {
        rejectGuestTicketView(
          `Booking request is not projectable for guest ticket view: ${bookingRequestId}`
        );
      }

      return {
        profileView,
        historyItem,
      };
    } catch (error) {
      const message = String(error?.message || '');
      if (
        message.includes('Booking request not found') ||
        message.includes('booking request')
      ) {
        rejectGuestTicketView(`Invalid booking request reference: ${bookingRequestId}`);
      }
      if (
        message.includes('Guest profile not found') ||
        message.includes('resolve to different profiles') ||
        message.includes('does not match guest identity')
      ) {
        rejectGuestTicketView(
          `Booking request is not projectable for guest ticket view: ${bookingRequestId}`
        );
      }

      throw error;
    }
  }

  resolveBookingRequestIdForTelegramUserOrThrow(telegramUserId, input = {}) {
    const guestProfile = this.resolveGuestProfileByTelegramUserIdOrThrow(telegramUserId);
    const rows = this.bookingRequests.listBy(
      { guest_profile_id: guestProfile.guest_profile_id },
      {
        orderBy: 'created_at DESC, booking_request_id DESC',
        limit: normalizeLimit(input.scan_limit ?? input.scanLimit),
      }
    );
    if (rows.length === 0) {
      rejectGuestTicketView(
        `Telegram guest has no booking requests for projection: ${telegramUserId}`
      );
    }

    const ordered = rows.slice().sort(compareBookingRequestsByRecency);
    const linked = ordered.find((row) => Number(row.confirmed_presale_id) > 0) || null;

    return (linked || ordered[0]).booking_request_id;
  }

  resolveBookingRequestIdByCanonicalPresaleOrThrow(canonicalPresaleId) {
    const rows = this.bookingRequests.listBy(
      { confirmed_presale_id: canonicalPresaleId },
      {
        orderBy: 'created_at DESC, booking_request_id DESC',
        limit: 3,
      }
    );
    if (rows.length === 0) {
      rejectGuestTicketView(
        `Canonical presale reference is not linked to Telegram booking request: ${canonicalPresaleId}`
      );
    }
    if (rows.length > 1) {
      rejectGuestTicketView(
        `Canonical presale reference resolves ambiguously: ${canonicalPresaleId}`
      );
    }

    return rows[0].booking_request_id;
  }

  readCanonicalTableColumns(tableName) {
    const tablePrefix = tableName === 'presales' ? 'canonical_presale' : 'canonical_ticket';
    if (!this.db?.prepare) {
      return {
        ok: false,
        reason: `${tablePrefix}_db_unavailable`,
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
          reason: `${tablePrefix}_table_unavailable`,
          columns: new Set(),
        };
      }

      return {
        ok: true,
        reason: null,
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
        reason: `${tablePrefix}_metadata_unreadable`,
        columns: new Set(),
      };
    }
  }

  readCanonicalPresaleSummary(canonicalPresaleId) {
    if (!canonicalPresaleId) {
      return {
        read_status: 'not_linked',
        reason: null,
        presale: null,
      };
    }

    const columnRead = this.readCanonicalTableColumns('presales');
    if (!columnRead.ok) {
      return {
        read_status: 'unavailable',
        reason: columnRead.reason,
        presale: null,
      };
    }
    if (!columnRead.columns.has('id')) {
      return {
        read_status: 'unavailable',
        reason: 'canonical_presale_id_column_unavailable',
        presale: null,
      };
    }

    const selectedColumns = CANONICAL_PRESALE_COLUMNS.filter((column) =>
      columnRead.columns.has(column)
    );

    try {
      const row = this.db
        .prepare(
          `
            SELECT ${selectedColumns.map(quoteIdentifier).join(', ')}
            FROM presales
            WHERE id = ?
          `
        )
        .get(canonicalPresaleId);
      if (!row) {
        return {
          read_status: 'missing',
          reason: 'canonical_presale_missing',
          presale: null,
        };
      }

      return {
        read_status: 'readable',
        reason: null,
        presale: {
          id: Number(row.id),
          status: normalizeString(row.status),
          slot_uid: normalizeString(row.slot_uid),
          boat_slot_id: Number.isInteger(Number(row.boat_slot_id))
            ? Number(row.boat_slot_id)
            : null,
          business_day: normalizeString(row.business_day),
          number_of_seats: Number.isInteger(Number(row.number_of_seats))
            ? Number(row.number_of_seats)
            : null,
          total_price: Number.isInteger(Number(row.total_price)) ? Number(row.total_price) : null,
          prepayment_amount: Number.isInteger(Number(row.prepayment_amount))
            ? Number(row.prepayment_amount)
            : null,
          customer_phone: normalizeString(row.customer_phone),
          created_at: normalizeString(row.created_at),
          updated_at: normalizeString(row.updated_at),
        },
      };
    } catch {
      return {
        read_status: 'unavailable',
        reason: 'canonical_presale_read_failed',
        presale: null,
      };
    }
  }

  readCanonicalTicketSummary(canonicalPresaleId) {
    if (!canonicalPresaleId) {
      return {
        read_status: 'not_linked',
        reason: null,
        tickets: [],
      };
    }

    const columnRead = this.readCanonicalTableColumns('tickets');
    if (!columnRead.ok) {
      return {
        read_status: 'unavailable',
        reason: columnRead.reason,
        tickets: [],
      };
    }
    if (!columnRead.columns.has('presale_id')) {
      return {
        read_status: 'unavailable',
        reason: 'canonical_ticket_presale_id_column_unavailable',
        tickets: [],
      };
    }
    if (!columnRead.columns.has('status')) {
      return {
        read_status: 'unavailable',
        reason: 'canonical_ticket_status_column_unavailable',
        tickets: [],
      };
    }

    const selectedColumns = CANONICAL_TICKET_COLUMNS.filter((column) =>
      columnRead.columns.has(column)
    );
    const orderColumn = columnRead.columns.has('id') ? 'id' : 'status';

    try {
      const rows = this.db
        .prepare(
          `
            SELECT ${selectedColumns.map(quoteIdentifier).join(', ')}
            FROM tickets
            WHERE presale_id = ?
            ORDER BY ${quoteIdentifier(orderColumn)} ASC
          `
        )
        .all(canonicalPresaleId);

      return {
        read_status: 'readable',
        reason: null,
        tickets: rows.map((row) => ({
          id: Number.isInteger(Number(row.id)) ? Number(row.id) : null,
          presale_id: Number.isInteger(Number(row.presale_id)) ? Number(row.presale_id) : null,
          boat_slot_id: Number.isInteger(Number(row.boat_slot_id))
            ? Number(row.boat_slot_id)
            : null,
          status: normalizeString(row.status),
        })),
      };
    } catch {
      return {
        read_status: 'unavailable',
        reason: 'canonical_ticket_read_failed',
        tickets: [],
      };
    }
  }

  getLatestTicketTimelineItem(profileView, bookingRequestId) {
    const timeline = profileView?.timeline_projection?.guest_ticket_timeline || [];
    const matches = timeline.filter((item) => item.booking_request_id === bookingRequestId);
    return matches[matches.length - 1] || null;
  }

  resolveDeterministicTicketState({
    bookingRequest,
    canonicalLinkageState,
    canonicalPresaleSummary,
    canonicalTicketSummary,
    latestTimelineItem,
  }) {
    if (!Number(bookingRequest.confirmed_presale_id)) {
      return normalizeTicketState('no_ticket_yet');
    }

    const presaleStatus = normalizeString(canonicalPresaleSummary?.presale?.status)?.toUpperCase();
    if (presaleStatus && CANCELLED_PRESALE_STATUSES.has(presaleStatus)) {
      return normalizeTicketState('linked_ticket_cancelled_or_unavailable');
    }

    const linkageStatus = normalizeString(canonicalLinkageState?.linkage_status);
    const linkedTicketSummary = canonicalLinkageState?.linked_ticket_summary || {};
    const statusCounts = readStatusCounts(linkedTicketSummary.status_counts);
    const hasReady = hasAnyStatus(statusCounts, READY_TICKET_STATUSES);
    const hasCompleted = hasAnyStatus(statusCounts, COMPLETED_TICKET_STATUSES);
    const hasUnavailable = hasAnyStatus(statusCounts, UNAVAILABLE_TICKET_STATUSES);

    if (hasReady) {
      return normalizeTicketState('linked_ticket_ready');
    }
    if (hasCompleted && !hasReady) {
      return normalizeTicketState('linked_ticket_completed');
    }
    if (hasUnavailable && !hasReady) {
      return normalizeTicketState('linked_ticket_cancelled_or_unavailable');
    }

    if (
      canonicalTicketSummary.read_status === 'readable' &&
      Array.isArray(canonicalTicketSummary.tickets) &&
      canonicalTicketSummary.tickets.length === 0
    ) {
      return normalizeTicketState('linked_ticket_cancelled_or_unavailable');
    }

    const timelineTicketStatus = normalizeString(latestTimelineItem?.ticket_status)?.toUpperCase();
    if (timelineTicketStatus === 'TICKET_READY' || timelineTicketStatus === 'REMINDER_SENT') {
      return normalizeTicketState('linked_ticket_ready');
    }
    if (timelineTicketStatus === 'BOARDING_READY') {
      return normalizeTicketState('linked_ticket_ready');
    }
    if (timelineTicketStatus === 'USED') {
      return normalizeTicketState('linked_ticket_completed');
    }
    if (timelineTicketStatus === 'CANCELLED') {
      return normalizeTicketState('linked_ticket_cancelled_or_unavailable');
    }

    if (linkageStatus === 'enriched' && linkedTicketSummary.read_status === 'readable') {
      return normalizeTicketState('linked_ticket_ready');
    }

    return normalizeTicketState('linked_ticket_cancelled_or_unavailable');
  }

  resolveAvailabilityState(ticketState) {
    switch (ticketState) {
      case 'no_ticket_yet':
        return normalizeAvailabilityState('not_available_yet');
      case 'linked_ticket_ready':
        return normalizeAvailabilityState('available');
      case 'linked_ticket_completed':
        return normalizeAvailabilityState('completed');
      case 'linked_ticket_cancelled_or_unavailable':
        return normalizeAvailabilityState('unavailable');
      default:
        rejectGuestTicketView(`Unsupported deterministic ticket state: ${ticketState}`);
    }
  }

  buildContactSummary({ bookingRequest, guestProfile, canonicalPresaleSummary }) {
    const bookingPhone = normalizeString(bookingRequest.contact_phone_e164);
    const guestPhone = normalizeString(guestProfile.phone_e164);
    const canonicalPhone = normalizeString(canonicalPresaleSummary?.presale?.customer_phone);
    const preferredPhone = bookingPhone || guestPhone || canonicalPhone || null;
    if (!preferredPhone) {
      return null;
    }

    return freezeTelegramGuestTicketViewValue({
      booking_contact_phone_e164: bookingPhone,
      guest_profile_phone_e164: guestPhone,
      canonical_customer_phone_e164: canonicalPhone,
      preferred_contact_phone_e164: preferredPhone,
      phone_mask_summary: buildTelegramContactPhoneSummary(preferredPhone),
    });
  }

  buildSellerContactSummary(bookingRequest) {
    return resolveTelegramBuyerSellerContactSummary({
      db: this.db,
      sellerAttributionSessions: this.sellerAttributionSessions,
      trafficSources: this.trafficSources,
      sourceQRCodes: this.sourceQRCodes,
      sourceRegistryItems: this.sourceRegistryItems,
      sellerAttributionSessionId: bookingRequest?.seller_attribution_session_id,
    });
  }

  buildHoldStatusSummary(bookingHold) {
    if (!bookingHold) {
      return null;
    }

    return freezeTelegramGuestTicketViewValue({
      hold_status: normalizeString(bookingHold.hold_status),
      hold_active: ['ACTIVE', 'EXTENDED'].includes(
        normalizeString(bookingHold.hold_status)
      ),
      hold_scope: normalizeString(bookingHold.hold_scope),
      requested_amount: Number.isInteger(Number(bookingHold.requested_amount))
        ? Number(bookingHold.requested_amount)
        : null,
      currency: normalizeString(bookingHold.currency) || 'RUB',
      hold_started_at_summary: buildTelegramHandoffTimestampSummary(
        bookingHold.started_at
      ),
      hold_expires_at_summary: buildTelegramHandoffTimestampSummary(
        bookingHold.hold_expires_at
      ),
      hold_last_extended_at_summary: buildTelegramHandoffTimestampSummary(
        bookingHold.last_extended_at
      ),
    });
  }

  buildPaymentSummary({ bookingHold, canonicalPresaleSummary }) {
    if (canonicalPresaleSummary.read_status !== 'readable' || !canonicalPresaleSummary.presale) {
      return null;
    }

    const totalPrice = canonicalPresaleSummary.presale.total_price;
    const prepaymentAmount = canonicalPresaleSummary.presale.prepayment_amount;
    if (!Number.isInteger(totalPrice) || totalPrice < 0) {
      return null;
    }
    if (!Number.isInteger(prepaymentAmount) || prepaymentAmount < 0) {
      return null;
    }

    return freezeTelegramGuestTicketViewValue({
      read_status: 'readable',
      currency: normalizeString(bookingHold?.currency) || 'RUB',
      total_price: totalPrice,
      prepayment_amount: prepaymentAmount,
      remaining_payment_amount: Math.max(totalPrice - prepaymentAmount, 0),
    });
  }

  buildTripSlotSummary({ bookingRequest, canonicalLinkageState, canonicalPresaleSummary }) {
    return freezeTelegramGuestTicketViewValue({
      requested_trip_slot_reference: {
        reference_type: 'telegram_requested_trip_slot_reference',
        requested_trip_date: bookingRequest.requested_trip_date,
        requested_time_slot: bookingRequest.requested_time_slot,
        slot_uid: canonicalPresaleSummary?.presale?.slot_uid ?? null,
        boat_slot_id: canonicalPresaleSummary?.presale?.boat_slot_id ?? null,
      },
      canonical_trip_linkage_summary: canonicalLinkageState?.trip_linkage_summary || null,
    });
  }

  buildDateTimeSummary({ bookingRequest, canonicalPresaleSummary }) {
    const tripStartIso = parseTripStartIso(
      bookingRequest.requested_trip_date,
      bookingRequest.requested_time_slot
    );

    return freezeTelegramGuestTicketViewValue({
      requested_trip_date: normalizeString(bookingRequest.requested_trip_date),
      requested_time_slot: normalizeString(bookingRequest.requested_time_slot),
      canonical_business_day: normalizeString(canonicalPresaleSummary?.presale?.business_day),
      trip_starts_at_summary: buildTelegramHandoffTimestampSummary(tripStartIso),
    });
  }

  buildSeatsCountSummary({ bookingRequest, canonicalLinkageState, canonicalPresaleSummary }) {
    return freezeTelegramGuestTicketViewValue({
      requested_seats: Number(bookingRequest.requested_seats || 0),
      canonical_presale_seats:
        canonicalPresaleSummary?.presale?.number_of_seats ?? null,
      linked_ticket_count:
        canonicalLinkageState?.linked_ticket_summary?.total_count ?? null,
    });
  }

  buildBuyerTicketReferenceSummary({
    canonicalPresaleReference,
    canonicalTicketSummary,
  }) {
    return freezeTelegramGuestTicketViewValue(
      buildCanonicalBuyerTicketReferenceSummary({
        canonicalPresaleId: canonicalPresaleReference?.presale_id ?? null,
        canonicalTicketIds: (canonicalTicketSummary?.tickets || []).map((ticket) => ticket?.id),
      })
    );
  }

  buildBoardingQrPayloadSummary({
    deterministicTicketState,
    canonicalPresaleReference,
    canonicalTicketSummary,
    buyerTicketReferenceSummary,
  }) {
    if (deterministicTicketState !== 'linked_ticket_ready') {
      return null;
    }

    const summary = buildDispatcherBoardingQrSummary({
      canonicalPresaleId: canonicalPresaleReference?.presale_id ?? null,
      canonicalTicketIds: (canonicalTicketSummary?.tickets || []).map((ticket) => ticket?.id),
      buyerTicketCode: buyerTicketReferenceSummary?.buyer_ticket_code ?? null,
    });

    return summary ? freezeTelegramGuestTicketViewValue(summary) : null;
  }

  buildProjectionItem(bookingRequestId) {
    const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
    const bookingHold = this.getHoldForRequest(bookingRequestId);
    const events = this.listRequestEvents(bookingRequestId);
    const guestProfile = this.getGuestProfileOrThrow(bookingRequest.guest_profile_id);
    const { profileView, historyItem } = this.resolveHistoryForBookingRequestOrThrow(
      bookingRequestId
    );
    const canonicalLinkageState = historyItem.canonical_linkage_state || null;
    const canonicalPresaleReference = buildTelegramCanonicalPresaleReference(
      bookingRequest.confirmed_presale_id
    );
    const canonicalPresaleSummary = this.readCanonicalPresaleSummary(
      canonicalPresaleReference?.presale_id || null
    );
    const canonicalTicketSummary = this.readCanonicalTicketSummary(
      canonicalPresaleReference?.presale_id || null
    );
    const latestTimelineItem = this.getLatestTicketTimelineItem(profileView, bookingRequestId);
    const deterministicTicketState = this.resolveDeterministicTicketState({
      bookingRequest,
      canonicalLinkageState,
      canonicalPresaleSummary,
      canonicalTicketSummary,
      latestTimelineItem,
    });
    const availabilityState = this.resolveAvailabilityState(deterministicTicketState);
    const buyerTicketReferenceSummary = this.buildBuyerTicketReferenceSummary({
      canonicalPresaleReference,
      canonicalTicketSummary,
    });
    const boardingQrPayloadSummary = this.buildBoardingQrPayloadSummary({
      deterministicTicketState,
      canonicalPresaleReference,
      canonicalTicketSummary,
      buyerTicketReferenceSummary,
    });

    return freezeTelegramGuestTicketViewValue({
      response_version: TELEGRAM_GUEST_TICKET_VIEW_PROJECTION_VERSION,
      projection_item_type: 'telegram_guest_ticket_view_projection_item',
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      telegram_user_summary: buildTelegramUserSummaryFromGuestProfileAndEvents({
        guestProfile,
        events,
      }),
      booking_request_reference: buildBookingRequestReference(bookingRequest),
      linked_canonical_presale_reference: canonicalPresaleReference,
      ticket_status_summary: {
        deterministic_ticket_state: deterministicTicketState,
        booking_request_status: normalizeString(bookingRequest.request_status),
        latest_timeline_ticket_status: normalizeString(latestTimelineItem?.ticket_status),
        canonical_linkage_status: normalizeString(canonicalLinkageState?.linkage_status),
        canonical_presale_status: normalizeString(canonicalPresaleSummary?.presale?.status),
        canonical_ticket_read_status: normalizeString(
          canonicalLinkageState?.linked_ticket_summary?.read_status
        ),
        canonical_ticket_status_summary:
          canonicalLinkageState?.linked_ticket_summary || null,
      },
      trip_slot_summary: this.buildTripSlotSummary({
        bookingRequest,
        canonicalLinkageState,
        canonicalPresaleSummary,
      }),
      date_time_summary: this.buildDateTimeSummary({
        bookingRequest,
        canonicalPresaleSummary,
      }),
      seats_count_summary: this.buildSeatsCountSummary({
        bookingRequest,
        canonicalLinkageState,
        canonicalPresaleSummary,
      }),
      payment_summary: this.buildPaymentSummary({
        bookingHold,
        canonicalPresaleSummary,
      }),
      hold_status_summary: this.buildHoldStatusSummary(bookingHold),
      contact_summary: this.buildContactSummary({
        bookingRequest,
        guestProfile,
        canonicalPresaleSummary,
      }),
      seller_contact_summary: this.buildSellerContactSummary(bookingRequest),
      buyer_ticket_reference_summary: buyerTicketReferenceSummary,
      boarding_qr_payload_summary: boardingQrPayloadSummary,
      ticket_availability_state: availabilityState,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        bookingRequest.last_status_at,
        bookingRequest.created_at,
        bookingHold?.last_extended_at,
        bookingHold?.started_at,
        latestTimelineItem?.occurred_at,
        canonicalPresaleSummary?.presale?.updated_at,
        canonicalPresaleSummary?.presale?.created_at
      ),
    });
  }

  readGuestTicketViewByBookingRequestReference(input = {}) {
    const bookingRequestId = this.normalizeBookingRequestId(input);
    return this.buildProjectionItem(bookingRequestId);
  }

  readGuestTicketViewByTelegramUserReference(input = {}) {
    const telegramUserId = this.normalizeTelegramUserId(input);
    const bookingRequestId = this.resolveBookingRequestIdForTelegramUserOrThrow(
      telegramUserId,
      input
    );
    return this.buildProjectionItem(bookingRequestId);
  }

  readGuestTicketViewByCanonicalPresaleReference(input = {}) {
    const canonicalPresaleId = this.normalizeCanonicalPresaleId(input);
    const bookingRequestId = this.resolveBookingRequestIdByCanonicalPresaleOrThrow(
      canonicalPresaleId
    );
    return this.buildProjectionItem(bookingRequestId);
  }

  readByBookingRequestReference(input = {}) {
    return this.readGuestTicketViewByBookingRequestReference(input);
  }

  readByTelegramUserReference(input = {}) {
    return this.readGuestTicketViewByTelegramUserReference(input);
  }

  readByCanonicalPresaleReference(input = {}) {
    return this.readGuestTicketViewByCanonicalPresaleReference(input);
  }
}
