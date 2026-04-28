import express from 'express';
import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramHandoffValue,
  resolveTelegramMiniAppEntrypointContent,
} from '../../shared/telegram/index.js';
import {
  buildTelegramMiniAppLaunchReadinessSummary,
  resolveTelegramRuntimeConfig,
} from './runtime-config.mjs';
import {
  buildBuyerTicketReferenceSummary,
  buildDispatcherBoardingQrSummary,
} from '../ticketing/buyer-ticket-reference.mjs';

export const TELEGRAM_MINI_APP_HTTP_ROUTE_RESULT_VERSION =
  'telegram_mini_app_http_route_result.v1';
export const TELEGRAM_MINI_APP_HTTP_ROUTE_NAME = 'telegram_mini_app_http_route';
export const TELEGRAM_MINI_APP_TICKET_LIST_RESULT_VERSION =
  'telegram_mini_app_guest_ticket_list.v1';
export const TELEGRAM_MINI_APP_MY_REQUESTS_RESULT_VERSION =
  'telegram_mini_app_guest_my_requests.v1';
export const TELEGRAM_MINI_APP_NEUTRAL_TICKET_NOT_FOUND_MESSAGE =
  'Билет не найден. Проверьте номер или откройте билет по ссылке из Telegram.';

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const normalized = normalizeString(candidate);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }
  return normalizeString(value);
}

function readHeaderValue(headers, key) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }
  return normalizeHeaderValue(headers[key] ?? headers[key.toLowerCase()] ?? null);
}

function isMiniAppDebugEnabled(req) {
  const rawFlag =
    normalizeString(req?.query?.mini_app_debug ?? req?.query?.miniAppDebug) ||
    readHeaderValue(req?.headers, 'x-telegram-mini-app-debug');
  if (!rawFlag) {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(rawFlag.toLowerCase());
}

function buildMiniAppDebugRequestSummary(req) {
  const initDataHeader =
    readHeaderValue(req?.headers, 'x-telegram-webapp-init-data') ||
    readHeaderValue(req?.headers, 'x-telegram-web-app-init-data') ||
    readHeaderValue(req?.headers, 'x-telegram-webapp-initdata');
  return {
    method: normalizeString(req?.method),
    original_url: normalizeString(req?.originalUrl),
    telegram_user_id: normalizeString(
      req?.query?.telegram_user_id ?? req?.query?.telegramUserId
    ),
    user_agent: readHeaderValue(req?.headers, 'user-agent'),
    accept: readHeaderValue(req?.headers, 'accept'),
    content_type: readHeaderValue(req?.headers, 'content-type'),
    has_init_data_header: Boolean(initDataHeader),
    init_data_header_length: initDataHeader ? String(initDataHeader.length) : '0',
  };
}

function logMiniAppDebug(routeLabel, req, detail = {}) {
  if (!isMiniAppDebugEnabled(req)) {
    return;
  }
  const payload = {
    route_label: routeLabel,
    ...buildMiniAppDebugRequestSummary(req),
    ...detail,
  };
  console.info(`[TELEGRAM_MINI_APP_DEBUG] ${JSON.stringify(payload)}`);
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function resolveNestedInitDataFromRawValue(rawValue) {
  try {
    const params = new URLSearchParams(rawValue);
    return normalizeString(
      params.get('tgWebAppData') ||
        params.get('tg_web_app_data') ||
        params.get('tg_webapp_data') ||
        params.get('telegram_init_data') ||
        params.get('telegramInitData')
    );
  } catch {
    return null;
  }
}

function collectInitDataCandidates(rawInitData) {
  const queue = [normalizeString(rawInitData)];
  const seen = new Set();
  const candidates = [];

  while (queue.length > 0) {
    const current = normalizeString(queue.shift());
    if (!current || seen.has(current)) {
      continue;
    }

    seen.add(current);
    candidates.push(current);

    const nestedInitData = resolveNestedInitDataFromRawValue(current);
    if (nestedInitData && !seen.has(nestedInitData)) {
      queue.push(nestedInitData);
    }

    const decoded = decodeURIComponentSafe(current);
    if (decoded && !seen.has(decoded)) {
      queue.push(decoded);
    }
  }

  return candidates;
}

function resolveTelegramUserSummaryFromInitDataCandidate(rawInitDataCandidate) {
  try {
    const params = new URLSearchParams(rawInitDataCandidate);
    const rawUser = normalizeString(params.get('user'));
    if (!rawUser) {
      return null;
    }
    const parsedUser = JSON.parse(rawUser);
    const telegramUserId = normalizeString(parsedUser?.id);
    if (!telegramUserId) {
      return null;
    }

    return {
      telegram_user_id: telegramUserId,
      is_bot: Boolean(parsedUser?.is_bot),
      first_name: normalizeString(parsedUser?.first_name),
      last_name: normalizeString(parsedUser?.last_name),
      username: normalizeString(parsedUser?.username),
      language_code: normalizeString(parsedUser?.language_code),
      display_name:
        normalizeString(parsedUser?.first_name) ||
        normalizeString(parsedUser?.username) ||
        telegramUserId,
    };
  } catch {
    return null;
  }
}

function resolveTelegramUserSummaryFromInitDataRaw(rawInitData) {
  const candidates = collectInitDataCandidates(rawInitData);
  for (const candidate of candidates) {
    const summary = resolveTelegramUserSummaryFromInitDataCandidate(candidate);
    if (summary) {
      return summary;
    }
  }
  return null;
}

function parseInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = Number(value);
  return Number.isInteger(normalized) ? normalized : null;
}

function parsePositiveInteger(value, label) {
  const normalized = parseInteger(value);
  if (!normalized || normalized <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return normalized;
}

function parseLimitInput(value, { fallback = 20, max = 100 } = {}) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(normalized, max);
}

function parseBooleanInput(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }
  const lowered = normalized.toLowerCase();
  if (['1', 'true', 'yes'].includes(lowered)) {
    return true;
  }
  if (['0', 'false', 'no'].includes(lowered)) {
    return false;
  }
  throw new Error('only_active_bookable must be boolean');
}

const FALLBACK_TICKET_READY_STATUSES = new Set([
  'ACTIVE',
  'READY',
  'TICKET_READY',
  'BOARDING_READY',
  'REMINDER_SENT',
  'PAID',
  'UNPAID',
  'RESERVED',
  'PARTIALLY_PAID',
  'CONFIRMED',
]);
const FALLBACK_TICKET_COMPLETED_STATUSES = new Set(['USED', 'COMPLETED', 'BOARDED']);
const FALLBACK_TICKET_UNAVAILABLE_STATUSES = new Set([
  'CANCELLED',
  'VOID',
  'REFUNDED',
  'DELETED',
  'EXPIRED',
]);
const FALLBACK_CANCELLED_PRESALE_STATUSES = new Set([
  'CANCELLED',
  'EXPIRED',
  'VOID',
  'DELETED',
]);

function resolveCanonicalPresaleFallbackTicketState({
  canonicalPresaleStatus = null,
  ticketStatuses = [],
} = {}) {
  const normalizedPresaleStatus = normalizeString(canonicalPresaleStatus)?.toUpperCase();
  if (
    normalizedPresaleStatus &&
    FALLBACK_CANCELLED_PRESALE_STATUSES.has(normalizedPresaleStatus)
  ) {
    return 'linked_ticket_cancelled_or_unavailable';
  }

  const normalizedTicketStatuses = Array.isArray(ticketStatuses)
    ? ticketStatuses
        .map((status) => normalizeString(status)?.toUpperCase())
        .filter(Boolean)
    : [];
  if (normalizedTicketStatuses.some((status) => FALLBACK_TICKET_READY_STATUSES.has(status))) {
    return 'linked_ticket_ready';
  }
  if (normalizedTicketStatuses.some((status) => FALLBACK_TICKET_COMPLETED_STATUSES.has(status))) {
    return 'linked_ticket_completed';
  }
  if (
    normalizedTicketStatuses.length > 0 &&
    normalizedTicketStatuses.every((status) => FALLBACK_TICKET_UNAVAILABLE_STATUSES.has(status))
  ) {
    return 'linked_ticket_cancelled_or_unavailable';
  }

  return 'no_ticket_yet';
}

function resolveCanonicalPresaleFallbackAvailabilityState(ticketState) {
  if (ticketState === 'linked_ticket_ready') {
    return 'available';
  }
  if (ticketState === 'linked_ticket_completed') {
    return 'completed';
  }
  if (ticketState === 'linked_ticket_cancelled_or_unavailable') {
    return 'unavailable';
  }
  return 'not_available_yet';
}

function safeReadCanonicalPresaleRow(db, canonicalPresaleId) {
  if (!db?.prepare) {
    return null;
  }
  try {
    return db
      .prepare('SELECT * FROM presales WHERE id = ?')
      .get(canonicalPresaleId);
  } catch {
    return null;
  }
}

function safeResolveCanonicalTripDateTimeSummary(db, canonicalPresaleSummary = null) {
  const presale = canonicalPresaleSummary?.presale || null;
  const fallbackDate = normalizeString(presale?.business_day);
  const fallbackTime = null;
  if (!db?.prepare || !presale) {
    return freezeSortedResultValue({
      requested_trip_date: fallbackDate,
      requested_time_slot: fallbackTime,
      canonical_business_day: fallbackDate,
      trip_starts_at_summary: buildTelegramLatestTimestampSummary(null),
    });
  }

  let tripDate = null;
  let tripTime = null;
  const slotUid = normalizeString(presale.slot_uid);
  if (slotUid?.startsWith('generated:')) {
    const generatedSlotId = Number(slotUid.slice('generated:'.length));
    if (Number.isInteger(generatedSlotId) && generatedSlotId > 0) {
      try {
        const generatedRow = db
          .prepare('SELECT trip_date, time FROM generated_slots WHERE id = ?')
          .get(generatedSlotId);
        tripDate = normalizeString(generatedRow?.trip_date);
        tripTime = normalizeString(generatedRow?.time);
      } catch {
        // ignore generated slot lookup failures
      }
    }
  }

  if (!tripDate || !tripTime) {
    const boatSlotId = Number(presale.boat_slot_id);
    if (Number.isInteger(boatSlotId) && boatSlotId > 0) {
      try {
        const slotRow = db
          .prepare('SELECT trip_date, time FROM boat_slots WHERE id = ?')
          .get(boatSlotId);
        tripDate = tripDate || normalizeString(slotRow?.trip_date);
        tripTime = tripTime || normalizeString(slotRow?.time);
      } catch {
        // ignore legacy slot lookup failures
      }
    }
  }

  const requestedTripDate = tripDate || fallbackDate;
  const requestedTimeSlot = tripTime || fallbackTime;
  let tripStartsAtIso = null;
  if (requestedTripDate && requestedTimeSlot) {
    const parsed = Date.parse(`${requestedTripDate}T${requestedTimeSlot}:00.000Z`);
    tripStartsAtIso = Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  return freezeSortedResultValue({
    requested_trip_date: requestedTripDate,
    requested_time_slot: requestedTimeSlot,
    canonical_business_day: fallbackDate,
    trip_starts_at_summary: buildTelegramLatestTimestampSummary(tripStartsAtIso),
  });
}

function safeResolveCanonicalSellerContactSummary(db, canonicalPresaleRow = null) {
  if (!db?.prepare || !canonicalPresaleRow || typeof canonicalPresaleRow !== 'object') {
    return null;
  }

  const sellerIdCandidates = [
    canonicalPresaleRow.sold_by_user_id,
    canonicalPresaleRow.seller_id,
    canonicalPresaleRow.created_by_user_id,
    canonicalPresaleRow.user_id,
  ];
  const sellerId = sellerIdCandidates
    .map((value) => Number(value))
    .find((value) => Number.isInteger(value) && value > 0);
  if (!sellerId) {
    return null;
  }

  try {
    const sellerRow = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(sellerId);
    if (!sellerRow) {
      return null;
    }
    const sellerDisplayName =
      normalizeString(sellerRow.public_display_name) ||
      normalizeString(sellerRow.display_name) ||
      normalizeString(sellerRow.username) ||
      `Продавец #${sellerId}`;
    const sellerPhone =
      normalizeString(sellerRow.public_phone_e164) ||
      normalizeString(sellerRow.phone_e164) ||
      normalizeString(sellerRow.phone) ||
      null;

    return freezeSortedResultValue({
      seller_user_id: sellerId,
      seller_display_name: sellerDisplayName,
      seller_phone_e164: sellerPhone,
      seller_contact_available: Boolean(sellerPhone),
    });
  } catch {
    return null;
  }
}

function buildCanonicalPresaleOnlyTicketViewProjection({
  repositories,
  services,
  telegramUserId,
  canonicalPresaleId,
  nowIso,
}) {
  const ticketProjectionService = services?.guestTicketViewProjectionService;
  if (!ticketProjectionService) {
    throw new Error('[TELEGRAM_MINI_APP_ROUTE] guestTicketViewProjectionService is required');
  }

  const canonicalPresaleSummary = ticketProjectionService.readCanonicalPresaleSummary(
    canonicalPresaleId
  );
  if (!canonicalPresaleSummary?.presale) {
    throw new Error(`Canonical presale not found: ${canonicalPresaleId}`);
  }
  const canonicalTicketSummary = ticketProjectionService.readCanonicalTicketSummary(
    canonicalPresaleId
  );
  const ticketIds = Array.isArray(canonicalTicketSummary?.tickets)
    ? canonicalTicketSummary.tickets
        .map((ticket) => Number(ticket?.id))
        .filter((ticketId) => Number.isInteger(ticketId) && ticketId > 0)
    : [];
  const ticketStatuses = Array.isArray(canonicalTicketSummary?.tickets)
    ? canonicalTicketSummary.tickets.map((ticket) => ticket?.status)
    : [];
  const ticketState = resolveCanonicalPresaleFallbackTicketState({
    canonicalPresaleStatus: canonicalPresaleSummary?.presale?.status,
    ticketStatuses,
  });
  const ticketAvailabilityState = resolveCanonicalPresaleFallbackAvailabilityState(ticketState);
  const buyerTicketReferenceSummary = buildBuyerTicketReferenceSummary({
    canonicalPresaleId,
    canonicalTicketIds: ticketIds,
  });
  const boardingQrPayloadSummary =
    ticketState === 'linked_ticket_ready'
      ? buildDispatcherBoardingQrSummary({
          canonicalPresaleId,
          canonicalTicketIds: ticketIds,
          buyerTicketCode: buyerTicketReferenceSummary?.buyer_ticket_code || null,
        })
      : null;

  const db =
    repositories?.bookingRequests?.db ||
    repositories?.guestProfiles?.db ||
    services?.guestTicketViewProjectionService?.db ||
    null;
  const canonicalPresaleRow = safeReadCanonicalPresaleRow(db, canonicalPresaleId);
  const dateTimeSummary = safeResolveCanonicalTripDateTimeSummary(
    db,
    canonicalPresaleSummary
  );
  const sellerContactSummary = safeResolveCanonicalSellerContactSummary(
    db,
    canonicalPresaleRow
  );
  const preferredContactPhone = normalizeString(
    canonicalPresaleSummary?.presale?.customer_phone
  );
  const statusCountsMap = new Map();
  for (const status of ticketStatuses) {
    const normalized = normalizeString(status)?.toUpperCase();
    if (!normalized) {
      continue;
    }
    statusCountsMap.set(normalized, (statusCountsMap.get(normalized) || 0) + 1);
  }
  const statusCounts = Array.from(statusCountsMap.entries()).map(([status, count]) =>
    freezeSortedResultValue({ status, count })
  );

  return freezeSortedResultValue({
    response_version: 'telegram_guest_ticket_view_projection.v1',
    projection_item_type: 'telegram_guest_ticket_view_projection_item',
    read_only: true,
    projection_only: true,
    projected_by: TELEGRAM_MINI_APP_HTTP_ROUTE_NAME,
    telegram_user_summary: {
      reference_type: 'telegram_user',
      telegram_user_id: normalizeString(telegramUserId),
    },
    booking_request_reference: null,
    linked_canonical_presale_reference: {
      reference_type: 'canonical_presale',
      presale_id: canonicalPresaleId,
    },
    ticket_status_summary: {
      deterministic_ticket_state: ticketState,
      booking_request_status: null,
      latest_timeline_ticket_status: null,
      canonical_linkage_status: 'canonical_presale_only',
      canonical_presale_status: normalizeString(canonicalPresaleSummary?.presale?.status),
      canonical_ticket_read_status: normalizeString(canonicalTicketSummary?.read_status),
      canonical_ticket_status_summary: {
        read_status: normalizeString(canonicalTicketSummary?.read_status) || 'readable',
        total_count: ticketIds.length,
        status_counts: statusCounts,
      },
    },
    trip_slot_summary: {
      requested_trip_slot_reference: {
        reference_type: 'telegram_requested_trip_slot_reference',
        requested_trip_date: dateTimeSummary?.requested_trip_date || null,
        requested_time_slot: dateTimeSummary?.requested_time_slot || null,
        slot_uid: normalizeString(canonicalPresaleSummary?.presale?.slot_uid),
        boat_slot_id: Number(canonicalPresaleSummary?.presale?.boat_slot_id) || null,
      },
      canonical_trip_linkage_summary: null,
    },
    date_time_summary: dateTimeSummary,
    seats_count_summary: {
      requested_seats: Number(canonicalPresaleSummary?.presale?.number_of_seats) || null,
      canonical_presale_seats: Number(canonicalPresaleSummary?.presale?.number_of_seats) || null,
      linked_ticket_count: ticketIds.length,
    },
    payment_summary: {
      read_status: 'readable',
      currency: 'RUB',
      total_price: Number(canonicalPresaleSummary?.presale?.total_price) || 0,
      prepayment_amount: Number(canonicalPresaleSummary?.presale?.prepayment_amount) || 0,
      remaining_payment_amount: Math.max(
        Math.max(Number(canonicalPresaleSummary?.presale?.total_price) || 0, 0) -
          Math.max(Number(canonicalPresaleSummary?.presale?.prepayment_amount) || 0, 0),
        0
      ),
    },
    hold_status_summary: null,
    contact_summary: preferredContactPhone
      ? {
          booking_contact_phone_e164: null,
          guest_profile_phone_e164: null,
          canonical_customer_phone_e164: preferredContactPhone,
          preferred_contact_phone_e164: preferredContactPhone,
        }
      : null,
    seller_contact_summary: sellerContactSummary,
    buyer_ticket_reference_summary: buyerTicketReferenceSummary,
    boarding_qr_payload_summary: boardingQrPayloadSummary,
    ticket_availability_state: ticketAvailabilityState,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      canonicalPresaleSummary?.presale?.updated_at,
      canonicalPresaleSummary?.presale?.created_at
    ),
  });
}

function readTicketViewByCanonicalPresaleReferenceOrFallback({
  repositories,
  services,
  telegramUserId,
  canonicalPresaleId,
  nowIso,
}) {
  try {
    return services.guestTicketViewProjectionService.readGuestTicketViewByCanonicalPresaleReference(
      canonicalPresaleId
    );
  } catch (error) {
    const message = normalizeString(error?.message) || '';
    if (!message.includes('not linked to Telegram booking request')) {
      throw error;
    }
    return buildCanonicalPresaleOnlyTicketViewProjection({
      repositories,
      services,
      telegramUserId,
      canonicalPresaleId,
      nowIso,
    });
  }
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
  return freezeTelegramHandoffValue(sortResultValue(value));
}

function resolveNowIso(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (Number.isNaN(Date.parse(iso))) {
    throw new Error('[TELEGRAM_MINI_APP_ROUTE] invalid clock timestamp');
  }
  return iso;
}

function validateTelegramContext(telegramContext) {
  if (!telegramContext || typeof telegramContext !== 'object' || Array.isArray(telegramContext)) {
    throw new Error('[TELEGRAM_MINI_APP_ROUTE] telegramContext is required');
  }
  if (!telegramContext.services) {
    throw new Error('[TELEGRAM_MINI_APP_ROUTE] telegramContext.services is required');
  }
}

function resolveTelegramUserIdOrThrow(input = {}, options = {}) {
  const guestSummary = resolveTelegramGuestSummary(input, options);
  const telegramUserId = normalizeString(
    guestSummary?.telegram_user_id ?? guestSummary?.telegramUserId
  );
  if (!telegramUserId) {
    throw new Error('No valid Telegram guest identity');
  }
  return telegramUserId;
}

function resolveGuestProfileByTelegramUserId({ repositories, telegramUserId }) {
  const guestProfiles = repositories?.guestProfiles;
  if (!guestProfiles?.findOneBy) {
    return null;
  }
  return (
    guestProfiles.findOneBy(
      { telegram_user_id: telegramUserId },
      { orderBy: 'guest_profile_id ASC' }
    ) || null
  );
}

function resolveGuestProfileByTelegramUserIdOrThrow({ repositories, telegramUserId }) {
  const guestProfile = resolveGuestProfileByTelegramUserId({
    repositories,
    telegramUserId,
  });
  if (!repositories?.guestProfiles?.findOneBy) {
    throw new Error('[TELEGRAM_MINI_APP_ROUTE] guestProfiles repository is required');
  }
  if (!guestProfile) {
    throw new Error(`No valid Telegram guest identity for telegram_user_id: ${telegramUserId}`);
  }
  return guestProfile;
}

function resolveMiniAppPersistenceDb(repositories) {
  return repositories?.bookingRequests?.db || repositories?.guestProfiles?.db || null;
}

function hasMiniAppGuestCanonicalTicketLinksTable(db) {
  if (!db?.prepare) {
    return false;
  }
  try {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'telegram_guest_canonical_ticket_links'"
      )
      .get();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function trackMiniAppGuestCanonicalTicketLink({
  repositories,
  guestProfileId,
  canonicalPresaleId,
  viewedAtIso,
}) {
  const normalizedGuestProfileId = Number(guestProfileId);
  const normalizedCanonicalPresaleId = Number(canonicalPresaleId);
  if (
    !Number.isInteger(normalizedGuestProfileId) ||
    normalizedGuestProfileId <= 0 ||
    !Number.isInteger(normalizedCanonicalPresaleId) ||
    normalizedCanonicalPresaleId <= 0
  ) {
    return false;
  }

  const db = resolveMiniAppPersistenceDb(repositories);
  if (!hasMiniAppGuestCanonicalTicketLinksTable(db)) {
    return false;
  }
  const normalizedViewedAtIso = normalizeString(viewedAtIso);
  const persistedViewedAtIso =
    normalizedViewedAtIso && !Number.isNaN(Date.parse(normalizedViewedAtIso))
      ? normalizedViewedAtIso
      : new Date().toISOString();

  try {
    db.prepare(
      `
        INSERT INTO telegram_guest_canonical_ticket_links (
          guest_profile_id,
          canonical_presale_id,
          first_viewed_at,
          last_viewed_at
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(guest_profile_id, canonical_presale_id)
        DO UPDATE SET
          last_viewed_at = excluded.last_viewed_at
      `
    ).run(
      normalizedGuestProfileId,
      normalizedCanonicalPresaleId,
      persistedViewedAtIso,
      persistedViewedAtIso
    );
    return true;
  } catch {
    return false;
  }
}

function readMiniAppCanonicalTicketOwnerLink({
  repositories,
  canonicalPresaleId,
}) {
  const normalizedCanonicalPresaleId = Number(canonicalPresaleId);
  if (!Number.isInteger(normalizedCanonicalPresaleId) || normalizedCanonicalPresaleId <= 0) {
    return null;
  }

  const db = resolveMiniAppPersistenceDb(repositories);
  if (!hasMiniAppGuestCanonicalTicketLinksTable(db)) {
    return null;
  }

  try {
    const row = db
      .prepare(
        `
          SELECT
            guest_profile_id,
            canonical_presale_id,
            first_viewed_at,
            last_viewed_at
          FROM telegram_guest_canonical_ticket_links
          WHERE canonical_presale_id = ?
          ORDER BY COALESCE(first_viewed_at, last_viewed_at) ASC,
                   guest_canonical_ticket_link_id ASC
          LIMIT 1
        `
      )
      .get(normalizedCanonicalPresaleId);
    if (!row) {
      return null;
    }

    const ownerGuestProfileId = Number(row.guest_profile_id);
    if (!Number.isInteger(ownerGuestProfileId) || ownerGuestProfileId <= 0) {
      return null;
    }

    return freezeSortedResultValue({
      guest_profile_id: ownerGuestProfileId,
      canonical_presale_id: normalizedCanonicalPresaleId,
      first_viewed_at: normalizeString(row.first_viewed_at),
      last_viewed_at: normalizeString(row.last_viewed_at),
    });
  } catch {
    return null;
  }
}

function listMiniAppGuestCanonicalTicketLinks({
  repositories,
  guestProfileId,
  limit = 20,
}) {
  const normalizedGuestProfileId = Number(guestProfileId);
  if (!Number.isInteger(normalizedGuestProfileId) || normalizedGuestProfileId <= 0) {
    return [];
  }
  const normalizedLimit = Number(limit);
  const resolvedLimit =
    Number.isInteger(normalizedLimit) && normalizedLimit > 0
      ? Math.min(normalizedLimit, 200)
      : 20;

  const db = resolveMiniAppPersistenceDb(repositories);
  if (!hasMiniAppGuestCanonicalTicketLinksTable(db)) {
    return [];
  }

  try {
    return db
      .prepare(
        `
          SELECT
            canonical_presale_id,
            first_viewed_at,
            last_viewed_at
          FROM telegram_guest_canonical_ticket_links
          WHERE guest_profile_id = ?
          ORDER BY COALESCE(last_viewed_at, first_viewed_at) DESC,
                   guest_canonical_ticket_link_id DESC
          LIMIT ?
        `
      )
      .all(normalizedGuestProfileId, resolvedLimit)
      .map((row) =>
        freezeSortedResultValue({
          canonical_presale_id:
            Number.isInteger(Number(row?.canonical_presale_id)) &&
            Number(row.canonical_presale_id) > 0
              ? Number(row.canonical_presale_id)
              : null,
          first_viewed_at: normalizeString(row?.first_viewed_at),
          last_viewed_at: normalizeString(row?.last_viewed_at),
        })
      )
      .filter((row) => Number.isInteger(row.canonical_presale_id) && row.canonical_presale_id > 0);
  } catch {
    return [];
  }
}

function resolveMiniAppTicketSourceToken(query = {}) {
  return normalizeString(query.source_token ?? query.sourceToken);
}

function isMiniAppSourceRegistryTokenTrusted({ repositories, sourceToken }) {
  const normalizedSourceToken = normalizeString(sourceToken);
  if (!normalizedSourceToken) {
    return false;
  }

  const sourceRegistryItems = repositories?.sourceRegistryItems;
  if (!sourceRegistryItems?.findOneBy) {
    return false;
  }

  const sourceRegistryItem = sourceRegistryItems.findOneBy(
    { source_token: normalizedSourceToken },
    { orderBy: 'source_registry_item_id ASC' }
  );
  if (!sourceRegistryItem) {
    return false;
  }

  if (sourceRegistryItem.is_enabled === null || sourceRegistryItem.is_enabled === undefined) {
    return true;
  }
  return Number(sourceRegistryItem.is_enabled) === 1;
}

function isMiniAppSourceQrTokenTrusted({ repositories, sourceToken }) {
  const normalizedSourceToken = normalizeString(sourceToken);
  if (!normalizedSourceToken) {
    return false;
  }

  const sourceQRCodes = repositories?.sourceQRCodes;
  if (!sourceQRCodes?.findOneBy) {
    return false;
  }

  const sourceQrCode = sourceQRCodes.findOneBy(
    { qr_token: normalizedSourceToken },
    { orderBy: 'source_qr_code_id ASC' }
  );
  if (!sourceQrCode) {
    return false;
  }

  if (sourceQrCode.is_active === null || sourceQrCode.is_active === undefined) {
    return true;
  }
  return Number(sourceQrCode.is_active) === 1;
}

function isMiniAppSourceTokenTrusted({ repositories, sourceToken }) {
  return (
    isMiniAppSourceRegistryTokenTrusted({ repositories, sourceToken }) ||
    isMiniAppSourceQrTokenTrusted({ repositories, sourceToken })
  );
}

function rejectMiniAppTicketNotFound() {
  throw new Error(TELEGRAM_MINI_APP_NEUTRAL_TICKET_NOT_FOUND_MESSAGE);
}

function assertMiniAppGuestOwnsCanonicalTicketOrBindWithTrustedSourceOrThrow({
  repositories,
  guestProfileId,
  canonicalPresaleId,
  sourceToken = null,
  nowIso,
}) {
  const normalizedGuestProfileId = Number(guestProfileId);
  const normalizedCanonicalPresaleId = Number(canonicalPresaleId);
  if (
    !Number.isInteger(normalizedGuestProfileId) ||
    normalizedGuestProfileId <= 0 ||
    !Number.isInteger(normalizedCanonicalPresaleId) ||
    normalizedCanonicalPresaleId <= 0
  ) {
    rejectMiniAppTicketNotFound();
  }

  const ownerLink = readMiniAppCanonicalTicketOwnerLink({
    repositories,
    canonicalPresaleId: normalizedCanonicalPresaleId,
  });
  if (ownerLink?.guest_profile_id) {
    if (Number(ownerLink.guest_profile_id) !== normalizedGuestProfileId) {
      rejectMiniAppTicketNotFound();
    }
    trackMiniAppGuestCanonicalTicketLink({
      repositories,
      guestProfileId: normalizedGuestProfileId,
      canonicalPresaleId: normalizedCanonicalPresaleId,
      viewedAtIso: nowIso,
    });
    return;
  }

  if (!isMiniAppSourceTokenTrusted({ repositories, sourceToken })) {
    rejectMiniAppTicketNotFound();
  }

  const tracked = trackMiniAppGuestCanonicalTicketLink({
    repositories,
    guestProfileId: normalizedGuestProfileId,
    canonicalPresaleId: normalizedCanonicalPresaleId,
    viewedAtIso: nowIso,
  });
  if (!tracked) {
    rejectMiniAppTicketNotFound();
  }

  const ownerLinkAfterBind = readMiniAppCanonicalTicketOwnerLink({
    repositories,
    canonicalPresaleId: normalizedCanonicalPresaleId,
  });
  if (Number(ownerLinkAfterBind?.guest_profile_id) !== normalizedGuestProfileId) {
    rejectMiniAppTicketNotFound();
  }
}

function compareMiniAppTicketItemsByRecency(left, right) {
  const leftLatestIso = normalizeString(left?.latest_timestamp_summary?.iso);
  const rightLatestIso = normalizeString(right?.latest_timestamp_summary?.iso);
  const leftTime = leftLatestIso && !Number.isNaN(Date.parse(leftLatestIso))
    ? Date.parse(leftLatestIso)
    : 0;
  const rightTime = rightLatestIso && !Number.isNaN(Date.parse(rightLatestIso))
    ? Date.parse(rightLatestIso)
    : 0;
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  const leftBookingRequestId = Number(left?.booking_request_reference?.booking_request_id);
  const rightBookingRequestId = Number(right?.booking_request_reference?.booking_request_id);
  if (
    Number.isInteger(leftBookingRequestId) &&
    leftBookingRequestId > 0 &&
    Number.isInteger(rightBookingRequestId) &&
    rightBookingRequestId > 0 &&
    leftBookingRequestId !== rightBookingRequestId
  ) {
    return rightBookingRequestId - leftBookingRequestId;
  }

  const leftCanonicalPresaleId = Number(left?.linked_canonical_presale_reference?.presale_id);
  const rightCanonicalPresaleId = Number(right?.linked_canonical_presale_reference?.presale_id);
  if (
    Number.isInteger(leftCanonicalPresaleId) &&
    leftCanonicalPresaleId > 0 &&
    Number.isInteger(rightCanonicalPresaleId) &&
    rightCanonicalPresaleId > 0 &&
    leftCanonicalPresaleId !== rightCanonicalPresaleId
  ) {
    return rightCanonicalPresaleId - leftCanonicalPresaleId;
  }

  return 0;
}

const MINI_APP_ACTIVE_HOLD_EVENT_TYPES = Object.freeze({
  HOLD_STARTED: 'hold_activation_result',
  HOLD_EXTENDED: 'hold_extension_result',
});

function isMiniAppStaleHold(bookingHold, nowIso) {
  const holdStatus = normalizeString(bookingHold?.hold_status);
  const holdExpiresAt = normalizeString(bookingHold?.hold_expires_at);
  if (
    !holdStatus ||
    !['ACTIVE', 'EXTENDED'].includes(holdStatus) ||
    !holdExpiresAt ||
    Number.isNaN(Date.parse(holdExpiresAt))
  ) {
    return false;
  }

  return new Date(holdExpiresAt).getTime() <= new Date(nowIso).getTime();
}

function resolveMiniAppActiveHoldStateFromEvents(events = []) {
  if (!Array.isArray(events) || events.length === 0) {
    return null;
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const resultPayloadKey =
      MINI_APP_ACTIVE_HOLD_EVENT_TYPES[event?.event_type] || null;
    if (!resultPayloadKey) {
      continue;
    }
    const payload = event?.event_payload?.[resultPayloadKey] || event?.event_payload || null;
    if (payload?.response_version) {
      return payload;
    }
  }

  return null;
}

function expireMiniAppStaleActiveRequestsForGuest({
  repositories,
  services,
  telegramUserId,
  nowIso,
}) {
  const bookingRequests = repositories?.bookingRequests;
  const bookingHolds = repositories?.bookingHolds;
  const bookingRequestEvents = repositories?.bookingRequestEvents;
  const holdExpiryService = services?.bookingRequestHoldExpiryService;
  if (
    !bookingRequests?.listBy ||
    !bookingHolds?.findOneBy ||
    !bookingRequestEvents?.listBy ||
    !holdExpiryService?.expireHold
  ) {
    throw new Error(
      '[TELEGRAM_MINI_APP_ROUTE] buyer stale-hold normalization dependencies are required'
    );
  }

  const guestProfile = resolveGuestProfileByTelegramUserIdOrThrow({
    repositories,
    telegramUserId,
  });
  const rows = bookingRequests.listBy(
    { guest_profile_id: guestProfile.guest_profile_id },
    { orderBy: 'booking_request_id DESC', limit: 100 }
  );

  const expiredBookingRequestIds = [];
  for (const row of rows) {
    if (row?.request_status !== 'HOLD_ACTIVE') {
      continue;
    }

    const bookingHold = bookingHolds.findOneBy({
      booking_request_id: row.booking_request_id,
    });
    if (!isMiniAppStaleHold(bookingHold, nowIso)) {
      continue;
    }

    const events = bookingRequestEvents.listBy(
      { booking_request_id: row.booking_request_id },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
    const activeHoldState = resolveMiniAppActiveHoldStateFromEvents(events);
    if (!activeHoldState) {
      throw new Error(
        `Mini App stale hold cannot be normalized without active hold event payload: ${row.booking_request_id}`
      );
    }

    holdExpiryService.expireHold({
      active_hold_state: activeHoldState,
    });
    expiredBookingRequestIds.push(row.booking_request_id);
  }

  return freezeSortedResultValue({
    normalized_count: expiredBookingRequestIds.length,
    expired_booking_request_ids: expiredBookingRequestIds,
  });
}

function repairMiniAppConfirmedPrepaymentRequestsForGuest({
  repositories,
  services,
  telegramUserId,
  nowIso,
}) {
  const repairService = services?.confirmedPrepaymentTicketRepairService;
  if (!repairService?.repairConfirmedPrepaymentRequestsForGuestProfile) {
    throw new Error(
      '[TELEGRAM_MINI_APP_ROUTE] confirmed prepayment repair service is required'
    );
  }

  const guestProfile = resolveGuestProfileByTelegramUserIdOrThrow({
    repositories,
    telegramUserId,
  });

  return repairService.repairConfirmedPrepaymentRequestsForGuestProfile(
    guestProfile.guest_profile_id,
    {
      actorType: 'system',
      actorId: TELEGRAM_MINI_APP_HTTP_ROUTE_NAME,
      nowIso,
    }
  );
}

function normalizeMiniAppGuestRequestsForGuest({
  repositories,
  services,
  telegramUserId,
  nowIso,
}) {
  const staleHoldNormalization = expireMiniAppStaleActiveRequestsForGuest({
    repositories,
    services,
    telegramUserId,
    nowIso,
  });
  const confirmedPrepaymentRepair =
    repairMiniAppConfirmedPrepaymentRequestsForGuest({
      repositories,
      services,
      telegramUserId,
      nowIso,
    });

  return freezeSortedResultValue({
    stale_hold_normalization: staleHoldNormalization,
    confirmed_prepayment_repair: confirmedPrepaymentRepair,
  });
}

function resolveBookingRequestByIdOrThrow({ repositories, bookingRequestId }) {
  const bookingRequests = repositories?.bookingRequests;
  if (!bookingRequests?.getById) {
    throw new Error('[TELEGRAM_MINI_APP_ROUTE] bookingRequests repository is required');
  }

  const bookingRequest = bookingRequests.getById(bookingRequestId);
  if (!bookingRequest) {
    throw new Error(`Invalid booking request reference: ${bookingRequestId}`);
  }
  return bookingRequest;
}

function assertGuestOwnsBookingRequestOrThrow({
  repositories,
  telegramUserId,
  bookingRequestId,
}) {
  const guestProfile = resolveGuestProfileByTelegramUserIdOrThrow({
    repositories,
    telegramUserId,
  });
  const bookingRequest = resolveBookingRequestByIdOrThrow({
    repositories,
    bookingRequestId,
  });
  if (bookingRequest.guest_profile_id !== guestProfile.guest_profile_id) {
    throw new Error(
      `No valid Telegram guest identity for booking request reference: ${bookingRequestId}`
    );
  }
  return Object.freeze({
    guestProfile,
    bookingRequest,
  });
}

function resolveTelegramGuestSummary(input = {}, options = {}) {
  const objectCandidate =
    input.telegram_guest ??
    input.telegramGuest ??
    input.telegram_guest_identity ??
    input.telegramGuestIdentity ??
    input.telegram_user_summary ??
    input.telegramUserSummary ??
    null;
  if (objectCandidate && typeof objectCandidate === 'object') {
    return objectCandidate;
  }
  const telegramUserId = normalizeString(
    input.telegram_user_id ?? input.telegramUserId ?? input.user_id ?? input.userId
  );
  if (telegramUserId) {
    return { telegram_user_id: telegramUserId };
  }

  const rawInitData =
    normalizeString(
      input.telegram_init_data ??
        input.telegramInitData ??
        input.tgWebAppData ??
        input.tg_web_app_data ??
        input.tg_webapp_data
    ) ||
    readHeaderValue(options.headers, 'x-telegram-webapp-init-data') ||
    readHeaderValue(options.headers, 'x-telegram-web-app-init-data') ||
    readHeaderValue(options.headers, 'x-telegram-webapp-initdata');
  return resolveTelegramUserSummaryFromInitDataRaw(rawInitData);
}

function resolveTelegramUserReferenceFromGuestSummary(guestSummary) {
  const telegramUserId = normalizeString(
    guestSummary?.telegram_user_id ?? guestSummary?.telegramUserId
  );
  if (!telegramUserId) {
    return null;
  }

  return {
    reference_type: 'telegram_user',
    telegram_user_id: telegramUserId,
  };
}

function resolveTripSlotReference(input = {}) {
  const nestedReference =
    input.selected_trip_slot_reference ??
    input.selectedTripSlotReference ??
    input.requested_trip_slot_reference ??
    input.requestedTripSlotReference ??
    input.trip_slot_reference ??
    input.tripSlotReference ??
    null;
  if (nestedReference && typeof nestedReference === 'object') {
    return nestedReference;
  }
  const slotUid = normalizeString(input.slot_uid ?? input.slotUid);
  if (!slotUid) {
    return null;
  }
  return {
    reference_type: 'telegram_requested_trip_slot_reference',
    slot_uid: slotUid,
    requested_trip_date: normalizeString(
      input.requested_trip_date ?? input.requestedTripDate
    ),
    requested_time_slot: normalizeString(
      input.requested_time_slot ?? input.requestedTimeSlot
    ),
    boat_slot_id: parseInteger(input.boat_slot_id ?? input.boatSlotId),
  };
}

function buildRouteResult({
  routeStatus,
  routeOperationType,
  operationResultSummary = null,
  rejectionReason = null,
  nowIso,
  httpStatus,
}) {
  return freezeSortedResultValue({
    response_version: TELEGRAM_MINI_APP_HTTP_ROUTE_RESULT_VERSION,
    routed_by: TELEGRAM_MINI_APP_HTTP_ROUTE_NAME,
    route_status: routeStatus,
    route_operation_type: routeOperationType,
    http_status: httpStatus,
    operation_result_summary: operationResultSummary,
    rejection_reason: rejectionReason,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      operationResultSummary?.latest_timestamp_summary?.iso
    ),
  });
}

function buildErrorRouteResponse(error, { routeOperationType, nowIso }) {
  const message = normalizeString(error?.message) || 'internal_error';

  if (message === TELEGRAM_MINI_APP_NEUTRAL_TICKET_NOT_FOUND_MESSAGE) {
    return {
      httpStatus: 404,
      routeStatus: 'rejected_not_found',
      routeOperationType,
      rejectionReason: message,
    };
  }
  if (message.includes('requires a SQLite persistence context')) {
    return {
      httpStatus: 500,
      routeStatus: 'internal_error',
      routeOperationType,
      rejectionReason: message,
    };
  }
  if (message.includes('No valid Telegram guest identity')) {
    return {
      httpStatus: 404,
      routeStatus: 'rejected_not_found',
      routeOperationType,
      rejectionReason: message,
    };
  }
  if (
    message.includes('Invalid booking request reference') ||
    message.includes('Telegram guest has no booking requests') ||
    message.includes('Guest profile not found') ||
    message.includes('Canonical presale not found') ||
    message.includes('canonical_presale_missing')
  ) {
    return {
      httpStatus: 404,
      routeStatus: 'rejected_not_found',
      routeOperationType,
      rejectionReason: message,
    };
  }
  if (message.includes('must be a positive integer')) {
    return {
      httpStatus: 422,
      routeStatus: 'rejected_invalid_input',
      routeOperationType,
      rejectionReason: message,
    };
  }

  return {
    httpStatus: 400,
    routeStatus: 'rejected_invalid_input',
    routeOperationType,
    rejectionReason: message,
    nowIso,
  };
}

function mapSubmitStatusToHttp(submitStatus) {
  if (submitStatus === 'submitted_with_hold') {
    return { httpStatus: 201, routeStatus: 'processed_created' };
  }
  if (submitStatus === 'submit_failed_validation') {
    return { httpStatus: 422, routeStatus: 'rejected_invalid_input' };
  }
  if (submitStatus === 'submit_blocked') {
    return { httpStatus: 409, routeStatus: 'blocked_not_possible' };
  }
  return { httpStatus: 200, routeStatus: 'processed' };
}

function resolveEntrypointBookingContextOrThrow({
  query = {},
  headers = {},
  repositories,
}) {
  const guestSummary = resolveTelegramGuestSummary(query, { headers });
  const telegramUserReference = resolveTelegramUserReferenceFromGuestSummary(guestSummary);
  const bookingRequestIdInput = normalizeString(
    query.booking_request_id ?? query.bookingRequestId
  );
  const bookingRequestId = bookingRequestIdInput
    ? parsePositiveInteger(bookingRequestIdInput, 'booking_request_id')
    : null;
  const bookingRequestReference = bookingRequestId
    ? {
        reference_type: 'telegram_booking_request',
        booking_request_id: bookingRequestId,
      }
    : null;

  if (bookingRequestReference && !telegramUserReference) {
    throw new Error('No valid Telegram guest identity');
  }
  if (bookingRequestReference && telegramUserReference) {
    assertGuestOwnsBookingRequestOrThrow({
      repositories,
      telegramUserId: telegramUserReference.telegram_user_id,
      bookingRequestId: bookingRequestReference.booking_request_id,
    });
  }

  return freezeSortedResultValue({
    telegram_user_reference: telegramUserReference,
    booking_request_reference: bookingRequestReference,
  });
}

function buildMiniAppContactReadModel({
  services,
  telegramUserReference = null,
  bookingRequestReference = null,
}) {
  const usefulFeed = services.usefulContentFaqProjectionService.readUsefulContentFeedForTelegramGuest(
    {
      telegram_user_reference: telegramUserReference,
      booking_request_reference: bookingRequestReference,
      content_grouping: 'trip_help',
    }
  );

  let profileView = null;
  if (bookingRequestReference?.booking_request_id) {
    profileView = services.guestProfileService.readGuestProfileView({
      booking_request_id: bookingRequestReference.booking_request_id,
    });
  } else if (telegramUserReference?.telegram_user_id) {
    profileView = services.guestProfileService.readGuestProfileView({
      telegram_user_id: telegramUserReference.telegram_user_id,
    });
  }

  const guestIdentity = profileView?.guest_identity || {};
  const activeRequest = profileView?.current_active_request?.booking_request || null;
  const preferredContactPhone =
    normalizeString(activeRequest?.contact_phone_e164) ||
    normalizeString(guestIdentity.phone_e164) ||
    null;
  const supportItems = Array.isArray(usefulFeed.items)
    ? usefulFeed.items.filter((item) => normalizeString(item?.content_reference)).slice(0, 5)
    : [];

  return freezeSortedResultValue({
    response_version: 'telegram_contact_support_read_model.v1',
    projected_by: TELEGRAM_MINI_APP_HTTP_ROUTE_NAME,
    read_only: true,
    projection_only: true,
    telegram_user_summary: usefulFeed.telegram_user_summary || null,
    booking_request_reference: bookingRequestReference || null,
    applicability_state: bookingRequestReference
      ? 'booking_request_context'
      : telegramUserReference
        ? 'guest_profile_context'
        : 'not_applicable',
    preferred_contact_phone_e164: preferredContactPhone,
    guest_phone_e164: normalizeString(guestIdentity.phone_e164),
    active_request_contact_phone_e164: normalizeString(activeRequest?.contact_phone_e164),
    support_action_reference: 'contact_support',
    trip_help_feed_summary: freezeSortedResultValue({
      response_version: usefulFeed.response_version,
      list_scope: usefulFeed.list_scope,
      content_grouping_summary: ['trip_help'],
      item_count: supportItems.length,
      items: supportItems,
    }),
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      usefulFeed.latest_timestamp_summary?.iso,
      profileView?.current_active_request?.booking_request?.last_status_at
    ),
  });
}

function normalizeStateBucketItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => {
      const bookingRequestId = Number(item?.booking_request_id);
      if (!Number.isInteger(bookingRequestId) || bookingRequestId <= 0) {
        return null;
      }
      return freezeSortedResultValue({
        booking_request_id: bookingRequestId,
        request_status: normalizeString(item?.request_status),
        confirmed_presale_id:
          Number.isInteger(Number(item?.confirmed_presale_id)) &&
          Number(item?.confirmed_presale_id) > 0
            ? Number(item?.confirmed_presale_id)
            : null,
        terminal_reason: normalizeString(item?.terminal_reason),
      });
    })
    .filter(Boolean);
}

function normalizeMiniAppStateBuckets(stateBuckets = {}) {
  return freezeSortedResultValue({
    telegram_confirmed_not_yet_ticketed: normalizeStateBucketItems(
      stateBuckets?.telegram_confirmed_not_yet_ticketed
    ),
    linked_to_presale: normalizeStateBucketItems(stateBuckets?.linked_to_presale),
    completed_cancelled_expired: normalizeStateBucketItems(
      stateBuckets?.completed_cancelled_expired
    ),
  });
}

function extractBookingRequestId(item) {
  const bookingRequestId = Number(item?.booking_request_reference?.booking_request_id);
  if (!Number.isInteger(bookingRequestId) || bookingRequestId <= 0) {
    return null;
  }
  return bookingRequestId;
}

function extractCanonicalPresaleId(item) {
  const presaleId = Number(item?.linked_canonical_presale_reference?.presale_id);
  return Number.isInteger(presaleId) && presaleId > 0 ? presaleId : null;
}

function normalizeSignaturePart(value) {
  const normalized = normalizeString(value);
  return normalized || '';
}

function extractTicketItemPurchaseSignature(item) {
  const requestedTripDate = normalizeSignaturePart(
    item?.date_time_summary?.requested_trip_date ||
      item?.trip_slot_summary?.requested_trip_slot_reference?.requested_trip_date
  );
  const requestedTimeSlot = normalizeSignaturePart(
    item?.date_time_summary?.requested_time_slot ||
      item?.trip_slot_summary?.requested_trip_slot_reference?.requested_time_slot
  );
  const requestedSeats = Number(
    item?.seats_count_summary?.requested_seats ??
      item?.seats_count_summary?.canonical_presale_seats
  );
  const contactPhone = normalizeSignaturePart(
    item?.contact_summary?.preferred_contact_phone_e164 ||
      item?.contact_summary?.canonical_customer_phone_e164 ||
      item?.contact_summary?.booking_contact_phone_e164
  );

  if (!requestedTripDate || !requestedTimeSlot || !Number.isInteger(requestedSeats)) {
    return null;
  }

  return [
    requestedTripDate,
    requestedTimeSlot,
    requestedSeats,
    contactPhone,
  ].join('|');
}

function isReadyMiniAppTicketItem(item) {
  const deterministicState = normalizeString(
    item?.ticket_status_summary?.deterministic_ticket_state
  );
  const availabilityState = normalizeString(item?.ticket_availability_state);
  return (
    deterministicState === 'linked_ticket_ready' ||
    deterministicState === 'linked_ticket_completed' ||
    availabilityState === 'available' ||
    availabilityState === 'completed'
  );
}

function isStaleMiniAppRequestTicketItem(item) {
  if (extractCanonicalPresaleId(item)) {
    return false;
  }
  const deterministicState = normalizeString(
    item?.ticket_status_summary?.deterministic_ticket_state
  );
  const bookingRequestStatus = normalizeString(
    item?.ticket_status_summary?.booking_request_status
  );

  return (
    deterministicState === 'no_ticket_yet' ||
    deterministicState === 'request_created' ||
    bookingRequestStatus === 'NEW' ||
    bookingRequestStatus === 'ATTRIBUTED' ||
    bookingRequestStatus === 'CONTACT_IN_PROGRESS' ||
    bookingRequestStatus === 'HOLD_ACTIVE' ||
    bookingRequestStatus === 'WAITING_PREPAYMENT' ||
    bookingRequestStatus === 'PREPAYMENT_CONFIRMED'
  );
}

function groupItemsByPurchaseSignature(items, predicate) {
  const groups = new Map();
  items.forEach((item, index) => {
    if (!predicate(item)) {
      return;
    }
    const signature = extractTicketItemPurchaseSignature(item);
    if (!signature) {
      return;
    }
    const existing = groups.get(signature) || [];
    existing.push({ item, index });
    groups.set(signature, existing);
  });
  return groups;
}

function mergeMiniAppFulfilledTicketItems(items = []) {
  const safeItems = Array.isArray(items) ? items : [];
  const readyBySignature = groupItemsByPurchaseSignature(
    safeItems,
    isReadyMiniAppTicketItem
  );
  const staleBySignature = groupItemsByPurchaseSignature(
    safeItems,
    isStaleMiniAppRequestTicketItem
  );
  const staleIndexesToSuppress = new Set();

  for (const [signature, staleMatches] of staleBySignature.entries()) {
    const readyMatches = readyBySignature.get(signature) || [];
    if (readyMatches.length === 1 && staleMatches.length === 1) {
      staleIndexesToSuppress.add(staleMatches[0].index);
    }
  }

  if (staleIndexesToSuppress.size === 0) {
    return safeItems;
  }

  return safeItems.filter((_, index) => !staleIndexesToSuppress.has(index));
}

function buildMiniAppMyRequestsReadModel({
  services,
  telegramUserId,
  limit = 20,
  nowIso,
  profileView = null,
}) {
  const lifecycleList =
    services.bookingRequestLifecycleProjectionService.listBookingRequestsForGuest({
      telegram_user_id: telegramUserId,
      telegram_user_reference: {
        reference_type: 'telegram_user',
        telegram_user_id: telegramUserId,
      },
      limit,
    });
  const lifecycleItems = Array.isArray(lifecycleList.items) ? lifecycleList.items : [];
  const resolvedProfileView =
    profileView ||
    services.guestProfileService.readGuestProfileView({
      telegram_user_id: telegramUserId,
    });
  const stateBuckets = normalizeMiniAppStateBuckets(
    resolvedProfileView?.timeline_projection?.state_buckets || {}
  );

  const completedBucketIds = new Set(
    stateBuckets.completed_cancelled_expired
      .map((bucketItem) => Number(bucketItem.booking_request_id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  const activeReservations = lifecycleItems.filter(
    (item) => item.request_active === true
  );
  const completedCancelledExpiredReservations = lifecycleItems.filter((item) => {
    const bookingRequestId = extractBookingRequestId(item);
    if (bookingRequestId !== null && completedBucketIds.has(bookingRequestId)) {
      return true;
    }
    return (
      item.lifecycle_state === 'hold_expired' ||
      item.lifecycle_state === 'cancelled_before_prepayment'
    );
  });
  const tripTimelineItems = Array.isArray(
    resolvedProfileView?.timeline_projection?.trip_timeline_status_history
  )
    ? resolvedProfileView.timeline_projection.trip_timeline_status_history
    : [];
  const guestTimelineItems = Array.isArray(
    resolvedProfileView?.timeline_projection?.guest_ticket_timeline
  )
    ? resolvedProfileView.timeline_projection.guest_ticket_timeline
    : [];

  return freezeSortedResultValue({
    response_version: TELEGRAM_MINI_APP_MY_REQUESTS_RESULT_VERSION,
    read_only: true,
    projection_only: true,
    projected_by: TELEGRAM_MINI_APP_HTTP_ROUTE_NAME,
    list_scope: 'mini_app_guest_my_requests',
    telegram_user_summary:
      lifecycleList.telegram_user_summary || {
        reference_type: 'telegram_user',
        telegram_user_id: telegramUserId,
      },
    lifecycle_item_count: lifecycleItems.length,
    lifecycle_items: lifecycleItems,
    active_reservation_count: activeReservations.length,
    active_reservations: activeReservations,
    completed_cancelled_expired_count: completedCancelledExpiredReservations.length,
    completed_cancelled_expired_reservations: completedCancelledExpiredReservations,
    state_buckets: stateBuckets,
    trip_timeline_item_count: tripTimelineItems.length,
    guest_ticket_timeline_item_count: guestTimelineItems.length,
    linked_presale_count: stateBuckets.linked_to_presale.length,
    telegram_confirmed_not_yet_ticketed_count:
      stateBuckets.telegram_confirmed_not_yet_ticketed.length,
    completed_cancelled_expired_bucket_count:
      stateBuckets.completed_cancelled_expired.length,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      lifecycleList.latest_timestamp_summary?.iso,
      resolvedProfileView?.guest_identity?.last_seen_at
    ),
  });
}

export function createTelegramMiniAppRouter({
  telegramContext,
  telegramRuntimeConfig = null,
  now = () => new Date(),
} = {}) {
  validateTelegramContext(telegramContext);
  const services = telegramContext.services;
  const repositories = telegramContext.repositories || {};
  const resolvedRuntimeConfig =
    telegramRuntimeConfig || resolveTelegramRuntimeConfig();
  const router = express.Router();

  router.get('/mini-app/health', (req, res) => {
    const nowIso = resolveNowIso(now);
    return res.status(200).json(
      buildRouteResult({
        routeStatus: 'processed',
        routeOperationType: 'mini_app_health_check',
        operationResultSummary: freezeSortedResultValue({
          catalog_service_ready: Boolean(services.miniAppTripsCatalogQueryService),
          trip_card_service_ready: Boolean(services.miniAppTripCardQueryService),
          booking_submit_service_ready: Boolean(
            services.miniAppBookingSubmitOrchestrationService
          ),
          guest_ticket_view_service_ready: Boolean(services.guestTicketViewProjectionService),
          offline_ticket_snapshot_service_ready: Boolean(
            services.offlineTicketSnapshotService
          ),
          mini_app_launch_summary: buildTelegramMiniAppLaunchReadinessSummary(
            resolvedRuntimeConfig
          ),
        }),
        rejectionReason: null,
        nowIso,
        httpStatus: 200,
      })
    );
  });

  router.get('/mini-app/catalog', (req, res) => {
    const nowIso = resolveNowIso(now);
    logMiniAppDebug('mini_app_catalog_request', req, {
      stage: 'request',
      date: normalizeString(req.query.date),
      trip_type: normalizeString(req.query.trip_type ?? req.query.tripType),
      only_active_bookable: normalizeString(
        req.query.only_active_bookable ?? req.query.onlyActiveBookable
      ),
    });
    try {
      const operationResultSummary =
        services.miniAppTripsCatalogQueryService.listMiniAppTripsForGuest({
          telegram_guest: resolveTelegramGuestSummary(req.query, {
            headers: req.headers,
          }),
          date: normalizeString(req.query.date),
          trip_type: normalizeString(req.query.trip_type ?? req.query.tripType),
          only_active_bookable: parseBooleanInput(
            req.query.only_active_bookable ?? req.query.onlyActiveBookable
          ),
        });
      const responsePayload = buildRouteResult({
        routeStatus: 'processed',
        routeOperationType: 'mini_app_catalog',
        operationResultSummary,
        rejectionReason: null,
        nowIso,
        httpStatus: 200,
      });
      logMiniAppDebug('mini_app_catalog_response', req, {
        stage: 'response',
        http_status: 200,
        route_status: responsePayload.route_status,
        item_count: Number(operationResultSummary?.item_count ?? 0),
        response_content_type: 'application/json; charset=utf-8',
        rejection_reason: null,
      });

      return res.status(200).json(responsePayload);
    } catch (error) {
      const routeError = buildErrorRouteResponse(error, {
        routeOperationType: 'mini_app_catalog',
        nowIso,
      });
      const responsePayload = buildRouteResult({
        routeStatus: routeError.routeStatus,
        routeOperationType: routeError.routeOperationType,
        operationResultSummary: null,
        rejectionReason: routeError.rejectionReason,
        nowIso,
        httpStatus: routeError.httpStatus,
      });
      logMiniAppDebug('mini_app_catalog_response', req, {
        stage: 'response',
        http_status: routeError.httpStatus,
        route_status: responsePayload.route_status,
        item_count: 0,
        response_content_type: 'application/json; charset=utf-8',
        rejection_reason: routeError.rejectionReason,
      });
      return res.status(routeError.httpStatus).json(responsePayload);
    }
  });

  router.get('/mini-app/trip-card', (req, res) => {
    const nowIso = resolveNowIso(now);
    try {
      const operationResultSummary =
        services.miniAppTripCardQueryService.readMiniAppTripCardByTripSlotReference({
          requested_trip_slot_reference: resolveTripSlotReference(req.query),
        });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'mini_app_trip_card',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = buildErrorRouteResponse(error, {
        routeOperationType: 'mini_app_trip_card',
        nowIso,
      });
      return res.status(routeError.httpStatus).json(
        buildRouteResult({
          routeStatus: routeError.routeStatus,
          routeOperationType: routeError.routeOperationType,
          operationResultSummary: null,
          rejectionReason: routeError.rejectionReason,
          nowIso,
          httpStatus: routeError.httpStatus,
        })
      );
    }
  });

  router.post('/mini-app/booking-submit', (req, res) => {
    const nowIso = resolveNowIso(now);
    try {
      const requestPayload = req.body || {};
      const telegramUserId = resolveTelegramUserIdOrThrow(requestPayload, {
        headers: req.headers,
      });
      normalizeMiniAppGuestRequestsForGuest({
        repositories,
        services,
        telegramUserId,
        nowIso,
      });
      const operationResultSummary =
        services.miniAppBookingSubmitOrchestrationService.submitMiniAppBookingRequest({
          ...requestPayload,
          telegram_guest:
            resolveTelegramGuestSummary(requestPayload, {
              headers: req.headers,
            }) ||
            requestPayload.telegram_guest ||
            null,
          selected_trip_slot_reference: resolveTripSlotReference(requestPayload),
        });
      const status = mapSubmitStatusToHttp(operationResultSummary.submit_status);

      return res.status(status.httpStatus).json(
        buildRouteResult({
          routeStatus: status.routeStatus,
          routeOperationType: 'mini_app_booking_submit',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: status.httpStatus,
        })
      );
    } catch (error) {
      const message = normalizeString(error?.message) || 'internal_error';
      return res.status(500).json(
        buildRouteResult({
          routeStatus: 'internal_error',
          routeOperationType: 'mini_app_booking_submit',
          operationResultSummary: null,
          rejectionReason: message,
          nowIso,
          httpStatus: 500,
        })
      );
    }
  });

  router.get('/mini-app/my-requests', (req, res) => {
    const nowIso = resolveNowIso(now);
    logMiniAppDebug('mini_app_my_requests_request', req, {
      stage: 'request',
      limit: normalizeString(req.query.limit),
    });
    try {
      const telegramUserId = resolveTelegramUserIdOrThrow(req.query, {
        headers: req.headers,
      });
      normalizeMiniAppGuestRequestsForGuest({
        repositories,
        services,
        telegramUserId,
        nowIso,
      });
      const readLimit = parseLimitInput(req.query.limit, {
        fallback: 50,
        max: 200,
      });
      const operationResultSummary = buildMiniAppMyRequestsReadModel({
        services,
        telegramUserId,
        limit: readLimit,
        nowIso,
      });
      const responsePayload = buildRouteResult({
        routeStatus: 'processed',
        routeOperationType: 'mini_app_my_requests_list',
        operationResultSummary,
        rejectionReason: null,
        nowIso,
        httpStatus: 200,
      });
      logMiniAppDebug('mini_app_my_requests_response', req, {
        stage: 'response',
        http_status: 200,
        route_status: responsePayload.route_status,
        item_count: Number(operationResultSummary?.lifecycle_item_count ?? 0),
        response_content_type: 'application/json; charset=utf-8',
        rejection_reason: null,
      });

      return res.status(200).json(responsePayload);
    } catch (error) {
      const routeError = buildErrorRouteResponse(error, {
        routeOperationType: 'mini_app_my_requests_list',
        nowIso,
      });
      const responsePayload = buildRouteResult({
        routeStatus: routeError.routeStatus,
        routeOperationType: routeError.routeOperationType,
        operationResultSummary: null,
        rejectionReason: routeError.rejectionReason,
        nowIso,
        httpStatus: routeError.httpStatus,
      });
      logMiniAppDebug('mini_app_my_requests_response', req, {
        stage: 'response',
        http_status: routeError.httpStatus,
        route_status: responsePayload.route_status,
        item_count: 0,
        response_content_type: 'application/json; charset=utf-8',
        rejection_reason: routeError.rejectionReason,
      });
      return res.status(routeError.httpStatus).json(responsePayload);
    }
  });

  router.get('/mini-app/my-tickets', (req, res) => {
    const nowIso = resolveNowIso(now);
    try {
      const telegramUserId = resolveTelegramUserIdOrThrow(req.query, {
        headers: req.headers,
      });
      normalizeMiniAppGuestRequestsForGuest({
        repositories,
        services,
        telegramUserId,
        nowIso,
      });
      const guestProfile = resolveGuestProfileByTelegramUserIdOrThrow({
        repositories,
        telegramUserId,
      });
      const sharedProfileView = services.guestProfileService.readGuestProfileView({
        telegram_user_id: telegramUserId,
      });
      const scanLimit = parseLimitInput(req.query.limit);
      const rows = repositories.bookingRequests.listBy(
        { guest_profile_id: guestProfile.guest_profile_id },
        {
          orderBy: 'created_at DESC, booking_request_id DESC',
          limit: scanLimit,
        }
      );

      const items = rows.map((row) => {
        try {
          const ticketView =
            services.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
              {
                booking_request_id: row.booking_request_id,
                profile_view: sharedProfileView,
              }
            );
          return freezeSortedResultValue({
            ...ticketView,
            projection_read_status: 'readable',
            projection_read_reason: null,
          });
        } catch (error) {
          return freezeSortedResultValue({
            response_version: 'telegram_mini_app_guest_ticket_list_item.v1',
            projection_item_type: 'telegram_mini_app_guest_ticket_list_item',
            read_only: true,
            projection_only: true,
            projected_by: TELEGRAM_MINI_APP_HTTP_ROUTE_NAME,
            booking_request_reference: {
              reference_type: 'telegram_booking_request',
              booking_request_id: row.booking_request_id,
            },
            linked_canonical_presale_reference: null,
            ticket_status_summary: {
              deterministic_ticket_state: 'linked_ticket_cancelled_or_unavailable',
            },
            ticket_availability_state: 'unavailable',
            date_time_summary: {
              requested_trip_date: normalizeString(row.requested_trip_date),
              requested_time_slot: normalizeString(row.requested_time_slot),
            },
            seats_count_summary: {
              requested_seats: Number.isInteger(Number(row.requested_seats))
                ? Number(row.requested_seats)
                : null,
              linked_ticket_count: null,
            },
            payment_summary: null,
            contact_summary: null,
            latest_timestamp_summary: buildTelegramLatestTimestampSummary(
              row.last_status_at,
              row.created_at
            ),
            projection_read_status: 'unavailable',
            projection_read_reason:
              normalizeString(error?.message) || 'ticket_view_projection_unavailable',
          });
        }
      });
      const linkedCanonicalTicketRows = listMiniAppGuestCanonicalTicketLinks({
        repositories,
        guestProfileId: guestProfile.guest_profile_id,
        limit: scanLimit,
      });
      const knownCanonicalPresaleIds = new Set(
        items
          .map((item) => Number(item?.linked_canonical_presale_reference?.presale_id))
          .filter((presaleId) => Number.isInteger(presaleId) && presaleId > 0)
      );
      const canonicalFallbackItems = linkedCanonicalTicketRows
        .map((row) => {
          const canonicalPresaleId = Number(row.canonical_presale_id);
          if (!Number.isInteger(canonicalPresaleId) || canonicalPresaleId <= 0) {
            return null;
          }
          if (knownCanonicalPresaleIds.has(canonicalPresaleId)) {
            return null;
          }
          try {
            return buildCanonicalPresaleOnlyTicketViewProjection({
              repositories,
              services,
              telegramUserId,
              canonicalPresaleId,
              nowIso: row.last_viewed_at || row.first_viewed_at || nowIso,
            });
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const mergedItems = mergeMiniAppFulfilledTicketItems([
        ...items,
        ...canonicalFallbackItems,
      ])
        .sort(compareMiniAppTicketItemsByRecency)
        .slice(0, scanLimit);

      const operationResultSummary = freezeSortedResultValue({
        response_version: TELEGRAM_MINI_APP_TICKET_LIST_RESULT_VERSION,
        list_scope: 'mini_app_guest_my_tickets',
        list_item_type: 'telegram_mini_app_guest_ticket_list_item',
        telegram_user_summary: {
          reference_type: 'telegram_user',
          telegram_user_id: telegramUserId,
          guest_profile_id: guestProfile.guest_profile_id,
          display_name: normalizeString(guestProfile.display_name),
          username: normalizeString(guestProfile.username),
          language_code: normalizeString(guestProfile.language_code),
        },
        item_count: mergedItems.length,
        items: mergedItems,
        my_requests_read_model: buildMiniAppMyRequestsReadModel({
          services,
          telegramUserId,
          limit: scanLimit,
          nowIso,
          profileView: sharedProfileView,
        }),
        latest_timestamp_summary: buildTelegramLatestTimestampSummary(
          nowIso,
          ...mergedItems.map((item) => item.latest_timestamp_summary?.iso)
        ),
      });

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'mini_app_my_tickets_list',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = buildErrorRouteResponse(error, {
        routeOperationType: 'mini_app_my_tickets_list',
        nowIso,
      });
      return res.status(routeError.httpStatus).json(
        buildRouteResult({
          routeStatus: routeError.routeStatus,
          routeOperationType: routeError.routeOperationType,
          operationResultSummary: null,
          rejectionReason: routeError.rejectionReason,
          nowIso,
          httpStatus: routeError.httpStatus,
        })
      );
    }
  });

  router.get('/mini-app/my-tickets/:bookingRequestId', (req, res) => {
    const nowIso = resolveNowIso(now);
    try {
      const telegramUserId = resolveTelegramUserIdOrThrow(req.query, {
        headers: req.headers,
      });
      const bookingRequestId = parsePositiveInteger(
        req.params.bookingRequestId,
        'bookingRequestId'
      );
      normalizeMiniAppGuestRequestsForGuest({
        repositories,
        services,
        telegramUserId,
        nowIso,
      });
      assertGuestOwnsBookingRequestOrThrow({
        repositories,
        telegramUserId,
        bookingRequestId,
      });

      const operationResultSummary =
        services.guestTicketViewProjectionService.readGuestTicketViewByBookingRequestReference(
          bookingRequestId
        );

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'mini_app_ticket_view',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = buildErrorRouteResponse(error, {
        routeOperationType: 'mini_app_ticket_view',
        nowIso,
      });
      return res.status(routeError.httpStatus).json(
        buildRouteResult({
          routeStatus: routeError.routeStatus,
          routeOperationType: routeError.routeOperationType,
          operationResultSummary: null,
          rejectionReason: routeError.rejectionReason,
          nowIso,
          httpStatus: routeError.httpStatus,
        })
      );
    }
  });

  router.get('/mini-app/ticket-view', (req, res) => {
    const nowIso = resolveNowIso(now);
    try {
      const telegramUserId = resolveTelegramUserIdOrThrow(req.query, {
        headers: req.headers,
      });
      const guestProfile = resolveGuestProfileByTelegramUserIdOrThrow({
        repositories,
        telegramUserId,
      });
      const canonicalPresaleId = parsePositiveInteger(
        req.query.canonical_presale_id ?? req.query.canonicalPresaleId,
        'canonical_presale_id'
      );
      const sourceToken = resolveMiniAppTicketSourceToken(req.query);
      const operationResultSummary =
        readTicketViewByCanonicalPresaleReferenceOrFallback({
          repositories,
          services,
          telegramUserId,
          canonicalPresaleId,
          nowIso,
        });
      const linkedBookingRequestId = Number(
        operationResultSummary?.booking_request_reference?.booking_request_id
      );
      if (Number.isInteger(linkedBookingRequestId) && linkedBookingRequestId > 0) {
        assertGuestOwnsBookingRequestOrThrow({
          repositories,
          telegramUserId,
          bookingRequestId: linkedBookingRequestId,
        });
      } else {
        assertMiniAppGuestOwnsCanonicalTicketOrBindWithTrustedSourceOrThrow({
          repositories,
          guestProfileId: guestProfile.guest_profile_id,
          canonicalPresaleId,
          sourceToken,
          nowIso,
        });
      }

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'mini_app_ticket_view',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = buildErrorRouteResponse(error, {
        routeOperationType: 'mini_app_ticket_view',
        nowIso,
      });
      const rejectionReason =
        routeError.httpStatus === 404
          ? TELEGRAM_MINI_APP_NEUTRAL_TICKET_NOT_FOUND_MESSAGE
          : routeError.rejectionReason;
      return res.status(routeError.httpStatus).json(
        buildRouteResult({
          routeStatus: routeError.routeStatus,
          routeOperationType: routeError.routeOperationType,
          operationResultSummary: null,
          rejectionReason,
          nowIso,
          httpStatus: routeError.httpStatus,
        })
      );
    }
  });

  router.get('/mini-app/my-tickets/:bookingRequestId/offline-snapshot', (req, res) => {
    const nowIso = resolveNowIso(now);
    try {
      const telegramUserId = resolveTelegramUserIdOrThrow(req.query, {
        headers: req.headers,
      });
      const bookingRequestId = parsePositiveInteger(
        req.params.bookingRequestId,
        'bookingRequestId'
      );
      normalizeMiniAppGuestRequestsForGuest({
        repositories,
        services,
        telegramUserId,
        nowIso,
      });
      assertGuestOwnsBookingRequestOrThrow({
        repositories,
        telegramUserId,
        bookingRequestId,
      });

      const operationResultSummary =
        services.offlineTicketSnapshotService.buildOfflineTicketSnapshotByBookingRequestReference(
          bookingRequestId
        );

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'mini_app_ticket_offline_snapshot',
          operationResultSummary,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const routeError = buildErrorRouteResponse(error, {
        routeOperationType: 'mini_app_ticket_offline_snapshot',
        nowIso,
      });
      return res.status(routeError.httpStatus).json(
        buildRouteResult({
          routeStatus: routeError.routeStatus,
          routeOperationType: routeError.routeOperationType,
          operationResultSummary: null,
          rejectionReason: routeError.rejectionReason,
          nowIso,
          httpStatus: routeError.httpStatus,
        })
      );
    }
  });

  router.get('/mini-app/entrypoint/:entrypointKey', (req, res) => {
    const nowIso = resolveNowIso(now);
    const entrypointContent = resolveTelegramMiniAppEntrypointContent(
      req.params.entrypointKey
    );

    try {
      if (entrypointContent.entrypoint_key === 'useful_content') {
        const contextSummary = resolveEntrypointBookingContextOrThrow({
          query: req.query,
          headers: req.headers,
          repositories,
        });
        const readModel =
          services.usefulContentFaqProjectionService.readWeatherUsefulContentModelForTelegramGuest(
            {
              telegram_user_reference: contextSummary.telegram_user_reference,
              booking_request_reference: contextSummary.booking_request_reference,
            }
          );
        const operationResultSummary = freezeSortedResultValue({
          ...entrypointContent,
          placeholder: false,
          title:
            readModel.weather_caring_content_summary?.useful_headline ||
            entrypointContent.title,
          body:
            readModel.weather_caring_content_summary?.useful_body || entrypointContent.body,
          useful_content_read_model: readModel,
        });

        return res.status(200).json(
          buildRouteResult({
            routeStatus: 'processed',
            routeOperationType: 'mini_app_entrypoint_useful_content',
            operationResultSummary,
            rejectionReason: null,
            nowIso,
            httpStatus: 200,
          })
        );
      }

      if (entrypointContent.entrypoint_key === 'faq') {
        const contextSummary = resolveEntrypointBookingContextOrThrow({
          query: req.query,
          headers: req.headers,
          repositories,
        });
        const faqReadModel =
          services.usefulContentFaqProjectionService.readFaqListForTelegramGuest({
            telegram_user_reference: contextSummary.telegram_user_reference,
          });
        const faqItems = Array.isArray(faqReadModel.items) ? faqReadModel.items : [];
        const fallbackContentUsed = faqItems.length === 0;
        const operationResultSummary = freezeSortedResultValue({
          ...entrypointContent,
          placeholder: false,
          body: entrypointContent.body,
          fallback_content_used: fallbackContentUsed,
          faq_read_model: faqReadModel,
        });

        return res.status(200).json(
          buildRouteResult({
            routeStatus: 'processed',
            routeOperationType: 'mini_app_entrypoint_faq',
            operationResultSummary,
            rejectionReason: null,
            nowIso,
            httpStatus: 200,
          })
        );
      }

      if (entrypointContent.entrypoint_key === 'contact') {
        const contextSummary = resolveEntrypointBookingContextOrThrow({
          query: req.query,
          headers: req.headers,
          repositories,
        });
        const contactReadModel = buildMiniAppContactReadModel({
          services,
          telegramUserReference: contextSummary.telegram_user_reference,
          bookingRequestReference: contextSummary.booking_request_reference,
        });
        const supportItems = contactReadModel.trip_help_feed_summary?.items || [];
        const fallbackHint = normalizeString(
          supportItems[0]?.title_short_text_summary?.short_text
        );
        const fallbackContentUsed =
          !contactReadModel.preferred_contact_phone_e164 &&
          supportItems.length === 0;
        const operationResultSummary = freezeSortedResultValue({
          ...entrypointContent,
          placeholder: false,
          body: contactReadModel.preferred_contact_phone_e164
            ? `Preferred contact: ${contactReadModel.preferred_contact_phone_e164}.`
            : fallbackHint || entrypointContent.body,
          fallback_content_used: fallbackContentUsed,
          contact_read_model: contactReadModel,
        });

        return res.status(200).json(
          buildRouteResult({
            routeStatus: 'processed',
            routeOperationType: 'mini_app_entrypoint_contact',
            operationResultSummary,
            rejectionReason: null,
            nowIso,
            httpStatus: 200,
          })
        );
      }

      return res.status(200).json(
        buildRouteResult({
          routeStatus: 'processed',
          routeOperationType: 'mini_app_entrypoint_placeholder',
          operationResultSummary: entrypointContent,
          rejectionReason: null,
          nowIso,
          httpStatus: 200,
        })
      );
    } catch (error) {
      const entrypointOperationType =
        entrypointContent.entrypoint_key === 'useful_content'
          ? 'mini_app_entrypoint_useful_content'
          : entrypointContent.entrypoint_key === 'faq'
            ? 'mini_app_entrypoint_faq'
            : entrypointContent.entrypoint_key === 'contact'
              ? 'mini_app_entrypoint_contact'
              : 'mini_app_entrypoint_placeholder';
      const routeError = buildErrorRouteResponse(error, {
        routeOperationType: entrypointOperationType,
        nowIso,
      });
      return res.status(routeError.httpStatus).json(
        buildRouteResult({
          routeStatus: routeError.routeStatus,
          routeOperationType: routeError.routeOperationType,
          operationResultSummary: null,
          rejectionReason: routeError.rejectionReason,
          nowIso,
          httpStatus: routeError.httpStatus,
        })
      );
    }
  });

  return router;
}
