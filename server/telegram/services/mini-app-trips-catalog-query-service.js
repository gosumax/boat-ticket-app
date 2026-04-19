import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramHandoffValue,
} from '../../../shared/telegram/index.js';
import {
  freezeMiniAppValue,
  listMiniAppTripRows,
  normalizeMiniAppDateFilter,
  normalizeMiniAppOnlyBookableFilter,
  normalizeMiniAppTripTypeFilter,
  normalizeString,
  projectMiniAppTripItem,
} from './mini-app-trip-query-shared.js';

export const TELEGRAM_MINI_APP_TRIPS_CATALOG_ITEM_VERSION =
  'telegram_mini_app_trips_catalog_item.v1';
export const TELEGRAM_MINI_APP_TRIPS_CATALOG_LIST_VERSION =
  'telegram_mini_app_trips_catalog_list.v1';

const ERROR_PREFIX = '[TELEGRAM_MINI_APP_TRIPS_CATALOG]';
const SERVICE_NAME = 'telegram_mini_app_trips_catalog_query_service';

function rejectCatalog(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeTelegramGuestSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    rejectCatalog('telegram guest identity is required');
  }

  const telegramUserId = normalizeString(
    value.telegram_user_id ?? value.telegramUserId ?? value.id
  );
  if (!telegramUserId) {
    rejectCatalog('telegram_user_id is required');
  }

  return freezeMiniAppValue({
    telegram_user_id: telegramUserId,
    is_bot: Boolean(value.is_bot ?? value.isBot),
    first_name: normalizeString(value.first_name ?? value.firstName),
    last_name: normalizeString(value.last_name ?? value.lastName),
    username: normalizeString(value.username),
    language_code: normalizeString(value.language_code ?? value.languageCode),
    display_name: normalizeString(value.display_name ?? value.displayName) || telegramUserId,
  });
}

function pickGuestIdentityInput(input = {}) {
  return (
    input.telegram_guest ??
    input.telegramGuest ??
    input.telegram_guest_identity ??
    input.telegramGuestIdentity ??
    input.telegram_user_summary ??
    input.telegramUserSummary ??
    null
  );
}

function buildCatalogFilters(input = {}, { requireDate = false } = {}) {
  const requestedTripDate = normalizeMiniAppDateFilter(
    input.date ?? input.requested_trip_date ?? input.requestedTripDate,
    rejectCatalog,
    { required: requireDate }
  );
  const tripTypeFilter = normalizeMiniAppTripTypeFilter(
    input.trip_type ?? input.tripType,
    rejectCatalog
  );
  const onlyActiveBookable = normalizeMiniAppOnlyBookableFilter(
    input.only_active_bookable ?? input.onlyActiveBookable,
    rejectCatalog
  );

  return freezeMiniAppValue({
    requested_trip_date: requestedTripDate,
    trip_type_filter: tripTypeFilter,
    only_active_bookable: onlyActiveBookable,
  });
}

function sortCatalogItemsByDateAscending(left, right) {
  const leftDate = left.date_time_summary?.requested_trip_date || '';
  const rightDate = right.date_time_summary?.requested_trip_date || '';
  if (leftDate !== rightDate) {
    return leftDate < rightDate ? -1 : 1;
  }
  const leftTime = left.date_time_summary?.requested_time_slot || '';
  const rightTime = right.date_time_summary?.requested_time_slot || '';
  if (leftTime !== rightTime) {
    return leftTime < rightTime ? -1 : 1;
  }
  const leftUid = left.trip_slot_reference?.slot_uid || '';
  const rightUid = right.trip_slot_reference?.slot_uid || '';
  if (leftUid !== rightUid) {
    return leftUid < rightUid ? -1 : 1;
  }

  return 0;
}

function withCatalogItemEnvelope(item) {
  return freezeTelegramHandoffValue({
    response_version: TELEGRAM_MINI_APP_TRIPS_CATALOG_ITEM_VERSION,
    projection_item_type: 'telegram_mini_app_trips_catalog_item',
    ...item,
  });
}

export class TelegramMiniAppTripsCatalogQueryService {
  constructor({
    guestProfiles,
    bookingRequests,
    now = () => new Date(),
  }) {
    this.guestProfiles = guestProfiles;
    this.bookingRequests = bookingRequests;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'mini-app-trips-catalog-query-service',
      status: 'read_only_mini_app_trips_catalog_ready',
      dependencyKeys: ['guestProfiles', 'bookingRequests'],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectCatalog('catalog query clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  resolveGuestSummaryOrThrow(input = {}) {
    const guestSummaryInput = normalizeTelegramGuestSummary(
      pickGuestIdentityInput(input)
    );
    const guestProfile = this.guestProfiles.findOneBy(
      { telegram_user_id: guestSummaryInput.telegram_user_id },
      { orderBy: 'guest_profile_id ASC' }
    );
    if (!guestProfile) {
      rejectCatalog(
        `No valid Telegram guest identity: ${guestSummaryInput.telegram_user_id}`
      );
    }

    return freezeMiniAppValue({
      ...guestSummaryInput,
      username: guestSummaryInput.username || normalizeString(guestProfile.username),
      language_code:
        guestSummaryInput.language_code || normalizeString(guestProfile.language_code),
      display_name:
        guestSummaryInput.display_name ||
        normalizeString(guestProfile.display_name) ||
        guestSummaryInput.telegram_user_id,
    });
  }

  buildListResult({
    listScope,
    filters,
    telegramUserSummary = null,
    items,
    nowIso,
  }) {
    return freezeMiniAppValue({
      response_version: TELEGRAM_MINI_APP_TRIPS_CATALOG_LIST_VERSION,
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      list_scope: listScope,
      telegram_user_summary: telegramUserSummary,
      filter_summary: filters,
      item_count: items.length,
      items,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        ...items
          .map((item) => item.latest_timestamp_summary?.iso || null)
          .filter(Boolean),
        nowIso
      ),
    });
  }

  listProjectedItems(filters, nowIso) {
    if (!this.db?.prepare) {
      rejectCatalog('Mini App trip catalog requires a SQLite persistence context');
    }

    const projectedItems = listMiniAppTripRows(this.db, filters, rejectCatalog)
      .map((row) => withCatalogItemEnvelope(projectMiniAppTripItem(row, nowIso)))
      .filter((item) =>
        filters.only_active_bookable
          ? item.booking_availability_state !== 'unavailable'
          : true
      )
      .sort(sortCatalogItemsByDateAscending);

    return freezeMiniAppValue(projectedItems);
  }

  listMiniAppTripsForGuest(input = {}) {
    const nowIso = this.nowIso();
    const guestSummary = this.resolveGuestSummaryOrThrow(input);
    const filters = buildCatalogFilters(input, { requireDate: false });
    const items = this.listProjectedItems(filters, nowIso);

    return this.buildListResult({
      listScope: 'mini_app_guest_trips_catalog',
      filters,
      telegramUserSummary: guestSummary,
      items,
      nowIso,
    });
  }

  listMiniAppTripsByDate(input = {}) {
    const nowIso = this.nowIso();
    const filters = buildCatalogFilters(input, { requireDate: true });
    const items = this.listProjectedItems(filters, nowIso);

    return this.buildListResult({
      listScope: 'mini_app_trips_catalog_by_date',
      filters,
      telegramUserSummary: null,
      items,
      nowIso,
    });
  }

  listForGuest(input = {}) {
    return this.listMiniAppTripsForGuest(input);
  }

  listByDate(input = {}) {
    return this.listMiniAppTripsByDate(input);
  }
}

