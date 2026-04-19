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

export const TELEGRAM_MINI_APP_HTTP_ROUTE_RESULT_VERSION =
  'telegram_mini_app_http_route_result.v1';
export const TELEGRAM_MINI_APP_HTTP_ROUTE_NAME = 'telegram_mini_app_http_route';
export const TELEGRAM_MINI_APP_TICKET_LIST_RESULT_VERSION =
  'telegram_mini_app_guest_ticket_list.v1';
export const TELEGRAM_MINI_APP_MY_REQUESTS_RESULT_VERSION =
  'telegram_mini_app_guest_my_requests.v1';

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

function resolveGuestProfileByTelegramUserIdOrThrow({ repositories, telegramUserId }) {
  const guestProfiles = repositories?.guestProfiles;
  if (!guestProfiles?.findOneBy) {
    throw new Error('[TELEGRAM_MINI_APP_ROUTE] guestProfiles repository is required');
  }

  const guestProfile = guestProfiles.findOneBy(
    { telegram_user_id: telegramUserId },
    { orderBy: 'guest_profile_id ASC' }
  );
  if (!guestProfile) {
    throw new Error(`No valid Telegram guest identity for telegram_user_id: ${telegramUserId}`);
  }
  return guestProfile;
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
    message.includes('Guest profile not found')
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

function buildMiniAppMyRequestsReadModel({
  services,
  telegramUserId,
  limit = 20,
  nowIso,
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
  const profileView = services.guestProfileService.readGuestProfileView({
    telegram_user_id: telegramUserId,
  });
  const stateBuckets = normalizeMiniAppStateBuckets(
    profileView?.timeline_projection?.state_buckets || {}
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
    profileView?.timeline_projection?.trip_timeline_status_history
  )
    ? profileView.timeline_projection.trip_timeline_status_history
    : [];
  const guestTimelineItems = Array.isArray(
    profileView?.timeline_projection?.guest_ticket_timeline
  )
    ? profileView.timeline_projection.guest_ticket_timeline
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
      profileView?.guest_identity?.last_seen_at
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
      expireMiniAppStaleActiveRequestsForGuest({
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
      expireMiniAppStaleActiveRequestsForGuest({
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
      expireMiniAppStaleActiveRequestsForGuest({
        repositories,
        services,
        telegramUserId,
        nowIso,
      });
      const guestProfile = resolveGuestProfileByTelegramUserIdOrThrow({
        repositories,
        telegramUserId,
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
              row.booking_request_id
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
        item_count: items.length,
        items,
        my_requests_read_model: buildMiniAppMyRequestsReadModel({
          services,
          telegramUserId,
          limit: scanLimit,
          nowIso,
        }),
        latest_timestamp_summary: buildTelegramLatestTimestampSummary(
          nowIso,
          ...items.map((item) => item.latest_timestamp_summary?.iso)
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
          body: fallbackContentUsed
            ? entrypointContent.body
            : `Questions available: ${faqReadModel.item_count}.`,
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
