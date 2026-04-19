import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramOfflineTicketSnapshotValue,
  TELEGRAM_OFFLINE_TICKET_SNAPSHOT_STATUSES,
  TELEGRAM_OFFLINE_TICKET_SNAPSHOT_VERSION,
} from '../../../shared/telegram/index.js';

const ERROR_PREFIX = '[TELEGRAM_OFFLINE_TICKET_SNAPSHOT]';
const SERVICE_NAME = 'telegram_offline_ticket_snapshot_service';

function rejectOfflineSnapshot(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectOfflineSnapshot(`${label} must be a positive integer`);
  }

  return normalized;
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
    rejectOfflineSnapshot('booking request reference is required');
  }

  const referenceType = normalizeString(
    rawReference.reference_type || 'telegram_booking_request'
  );
  if (referenceType !== 'telegram_booking_request') {
    rejectOfflineSnapshot(
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
    rejectOfflineSnapshot('telegram_user_reference is required');
  }

  const referenceType = normalizeString(rawReference.reference_type || 'telegram_user');
  if (referenceType !== 'telegram_user') {
    rejectOfflineSnapshot(
      `Unsupported telegram-user reference type: ${referenceType || 'unknown'}`
    );
  }

  const telegramUserId = normalizeString(
    rawReference.telegram_user_id ?? rawReference.telegramUserId
  );
  if (!telegramUserId) {
    rejectOfflineSnapshot('telegram_user_reference.telegram_user_id is required');
  }

  return telegramUserId;
}

function normalizeOfflineSnapshotStatus(value) {
  if (!TELEGRAM_OFFLINE_TICKET_SNAPSHOT_STATUSES.includes(value)) {
    rejectOfflineSnapshot(`Unsupported offline snapshot status: ${String(value || 'unknown')}`);
  }

  return value;
}

function buildOfflineCode({
  bookingRequestId,
  canonicalPresaleId = null,
  requestedTripDate = null,
  requestedTimeSlot = null,
}) {
  const datePart = normalizeString(requestedTripDate)?.replaceAll('-', '') || '00000000';
  const timePart = normalizeString(requestedTimeSlot)?.replace(':', '') || '0000';
  const presalePart = Number.isInteger(Number(canonicalPresaleId))
    ? String(Number(canonicalPresaleId))
    : '0';

  return `TG-${bookingRequestId}-${presalePart}-${datePart}-${timePart}`;
}

function isStrongInputError(error) {
  const message = String(error?.message || '');
  return (
    message.includes('Invalid booking request reference') ||
    message.includes('booking request reference is required') ||
    message.includes('booking_request_reference.booking_request_id must be a positive integer') ||
    message.includes('telegram_user_reference is required') ||
    message.includes('telegram_user_reference.telegram_user_id is required') ||
    message.includes('Guest profile not found')
  );
}

export class TelegramOfflineTicketSnapshotService {
  constructor({
    guestTicketViewProjectionService,
    now = () => new Date(),
  }) {
    this.guestTicketViewProjectionService = guestTicketViewProjectionService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'offline-ticket-snapshot-service',
      status: 'read_only_offline_ticket_snapshot_ready',
      dependencyKeys: ['guestTicketViewProjectionService'],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectOfflineSnapshot('offline snapshot clock returned an unusable timestamp');
    }

    return iso;
  }

  buildSnapshotFromTicketView(ticketView, { degradedReason = null } = {}) {
    const bookingRequestReference = ticketView?.booking_request_reference || null;
    const bookingRequestId = bookingRequestReference?.booking_request_id || null;
    const deterministicTicketState =
      ticketView?.ticket_status_summary?.deterministic_ticket_state || 'no_ticket_yet';
    const requestedTripDate = ticketView?.date_time_summary?.requested_trip_date || null;
    const requestedTimeSlot = ticketView?.date_time_summary?.requested_time_slot || null;
    const hasTripDateTime = Boolean(requestedTripDate && requestedTimeSlot);
    const canonicalPresaleReference = ticketView?.linked_canonical_presale_reference || null;

    const snapshotStatus = normalizeOfflineSnapshotStatus(
      deterministicTicketState === 'linked_ticket_ready' && hasTripDateTime
        ? 'offline_snapshot_ready'
        : 'offline_unavailable'
    );

    return freezeTelegramOfflineTicketSnapshotValue({
      response_version: TELEGRAM_OFFLINE_TICKET_SNAPSHOT_VERSION,
      snapshot_item_type: 'telegram_offline_ticket_snapshot_item',
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      offline_snapshot_status: snapshotStatus,
      degradation_reason:
        degradedReason ||
        (snapshotStatus === 'offline_unavailable'
          ? `offline_unavailable_for_ticket_state:${deterministicTicketState}`
          : null),
      booking_request_reference: bookingRequestReference,
      linked_canonical_presale_reference: canonicalPresaleReference,
      minimal_ticket_identity_summary: {
        deterministic_ticket_state: deterministicTicketState,
        ticket_availability_state: ticketView?.ticket_availability_state || null,
        canonical_ticket_read_status:
          ticketView?.ticket_status_summary?.canonical_ticket_read_status || null,
      },
      trip_date_time_summary: {
        requested_trip_date: requestedTripDate,
        requested_time_slot: requestedTimeSlot,
        canonical_business_day: ticketView?.date_time_summary?.canonical_business_day || null,
      },
      seats_count_summary: {
        requested_seats: ticketView?.seats_count_summary?.requested_seats ?? null,
        linked_ticket_count: ticketView?.seats_count_summary?.linked_ticket_count ?? null,
      },
      contact_summary: ticketView?.contact_summary || null,
      buyer_ticket_reference_summary: ticketView?.buyer_ticket_reference_summary || null,
      boarding_qr_payload_summary: ticketView?.boarding_qr_payload_summary || null,
      offline_safe_code_reference_summary: bookingRequestId
        ? {
            offline_reference_code: buildOfflineCode({
              bookingRequestId,
              canonicalPresaleId: canonicalPresaleReference?.presale_id ?? null,
              requestedTripDate,
              requestedTimeSlot,
            }),
            booking_request_short_reference: `BR-${bookingRequestId}`,
            canonical_presale_short_reference: canonicalPresaleReference?.presale_id
              ? `PS-${canonicalPresaleReference.presale_id}`
              : null,
          }
        : null,
      snapshot_freshness_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        ticketView?.latest_timestamp_summary?.iso
      ),
    });
  }

  buildFallbackUnavailableSnapshot(bookingRequestId, reason) {
    return freezeTelegramOfflineTicketSnapshotValue({
      response_version: TELEGRAM_OFFLINE_TICKET_SNAPSHOT_VERSION,
      snapshot_item_type: 'telegram_offline_ticket_snapshot_item',
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      offline_snapshot_status: 'offline_unavailable',
      degradation_reason: reason || 'ticket_view_projection_unavailable',
      booking_request_reference: {
        reference_type: 'telegram_booking_request',
        booking_request_id: bookingRequestId,
      },
      linked_canonical_presale_reference: null,
      minimal_ticket_identity_summary: {
        deterministic_ticket_state: 'no_ticket_yet',
        ticket_availability_state: 'not_available_yet',
        canonical_ticket_read_status: null,
      },
      trip_date_time_summary: {
        requested_trip_date: null,
        requested_time_slot: null,
        canonical_business_day: null,
      },
      seats_count_summary: {
        requested_seats: null,
        linked_ticket_count: null,
      },
      contact_summary: null,
      buyer_ticket_reference_summary: null,
      boarding_qr_payload_summary: null,
      offline_safe_code_reference_summary: {
        offline_reference_code: buildOfflineCode({
          bookingRequestId,
        }),
        booking_request_short_reference: `BR-${bookingRequestId}`,
        canonical_presale_short_reference: null,
      },
      snapshot_freshness_timestamp_summary: buildTelegramLatestTimestampSummary(this.nowIso()),
    });
  }

  buildOfflineTicketSnapshotByBookingRequestReference(input = {}) {
    const bookingRequestId = normalizeBookingRequestId(input);
    try {
      const ticketView =
        this.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
          bookingRequestId
        );
      return this.buildSnapshotFromTicketView(ticketView);
    } catch (error) {
      if (isStrongInputError(error)) {
        throw error;
      }

      return this.buildFallbackUnavailableSnapshot(
        bookingRequestId,
        normalizeString(error?.message) || 'ticket_view_projection_unavailable'
      );
    }
  }

  buildOfflineTicketSnapshotByTelegramUserReference(input = {}) {
    const telegramUserId = normalizeTelegramUserId(input);
    try {
      const ticketView =
        this.guestTicketViewProjectionService.readGuestTicketViewByTelegramUserReference({
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: telegramUserId,
          },
        });
      return this.buildSnapshotFromTicketView(ticketView);
    } catch (error) {
      if (isStrongInputError(error)) {
        throw error;
      }

      return freezeTelegramOfflineTicketSnapshotValue({
        response_version: TELEGRAM_OFFLINE_TICKET_SNAPSHOT_VERSION,
        snapshot_item_type: 'telegram_offline_ticket_snapshot_item',
        read_only: true,
        projection_only: true,
        projected_by: SERVICE_NAME,
        offline_snapshot_status: 'offline_unavailable',
        degradation_reason:
          normalizeString(error?.message) || 'ticket_view_projection_unavailable',
        booking_request_reference: null,
        linked_canonical_presale_reference: null,
        minimal_ticket_identity_summary: {
          deterministic_ticket_state: 'no_ticket_yet',
          ticket_availability_state: 'not_available_yet',
          canonical_ticket_read_status: null,
        },
        trip_date_time_summary: {
          requested_trip_date: null,
          requested_time_slot: null,
          canonical_business_day: null,
        },
        seats_count_summary: {
          requested_seats: null,
          linked_ticket_count: null,
        },
        contact_summary: null,
        buyer_ticket_reference_summary: null,
        boarding_qr_payload_summary: null,
        offline_safe_code_reference_summary: null,
        snapshot_freshness_timestamp_summary: buildTelegramLatestTimestampSummary(this.nowIso()),
      });
    }
  }

  buildByBookingRequestReference(input = {}) {
    return this.buildOfflineTicketSnapshotByBookingRequestReference(input);
  }

  buildByTelegramUserReference(input = {}) {
    return this.buildOfflineTicketSnapshotByTelegramUserReference(input);
  }
}
