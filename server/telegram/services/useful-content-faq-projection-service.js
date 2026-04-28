import {
  buildTelegramHandoffTimestampSummary,
  buildTelegramLatestTimestampSummary,
  freezeTelegramContentManagementValue,
  freezeTelegramUsefulContentValue,
  TELEGRAM_CONTENT_GROUP_TYPE_COMPATIBILITY,
  TELEGRAM_CONTENT_MANAGEMENT_ITEM_VERSION,
  TELEGRAM_CONTENT_MANAGEMENT_LIST_VERSION,
  TELEGRAM_CONTENT_MANAGEMENT_MUTATION_VERSION,
  TELEGRAM_FAQ_GROUPINGS,
  TELEGRAM_FAQ_ITEMS,
  TELEGRAM_MANAGED_CONTENT_GROUPS,
  TELEGRAM_MANAGED_CONTENT_TYPES,
  TELEGRAM_USEFUL_CONTENT_FAQ_ITEM_VERSION,
  TELEGRAM_USEFUL_CONTENT_FAQ_LIST_VERSION,
  TELEGRAM_WEATHER_DATA_STATES,
  TELEGRAM_WEATHER_USEFUL_CONTENT_READ_MODEL_VERSION,
  TELEGRAM_USEFUL_CONTENT_FEED_ITEMS,
  TELEGRAM_USEFUL_CONTENT_FEED_VERSION,
  TELEGRAM_USEFUL_RESORT_CARD_REFERENCES,
  TELEGRAM_USEFUL_CONTENT_GROUPINGS,
} from '../../../shared/telegram/index.js';
import {
  buildTelegramUserSummaryFromGuestProfileAndEvents,
} from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_CONTENT_MANAGEMENT]';
const LEGACY_ERROR_PREFIX = '[TELEGRAM_USEFUL_CONTENT]';
const CONTENT_SERVICE_NAME = 'telegram_content_management_service';
const LEGACY_SERVICE_NAME = 'useful-content-faq-projection-service';
const WEATHER_USEFUL_CONTENT_SERVICE_NAME =
  'telegram_weather_useful_content_projection_service';
const CONTENT_REFERENCE_RE = /^[A-Za-z0-9_-]+$/;
const DEFAULT_VISIBILITY_ACTION_SUMMARY = Object.freeze({
  visibility_state: 'visible',
  action_type: 'none',
  action_reference: null,
});

const SIMPLE_SERVICE_CONTENT_BASELINE_ITEMS = Object.freeze([
  Object.freeze({
    content_reference: 'tg_simple_service_content_001',
    content_group: 'simple_service_content',
    content_type: 'service_content_block',
    title_summary: 'Service Status Message',
    short_text_summary:
      'Template block for short service status updates in Telegram guest flow.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'none',
      action_reference: null,
    }),
    is_enabled: true,
    baseline_timestamp_iso: '2026-04-14T00:00:00.000Z',
  }),
  Object.freeze({
    content_reference: 'tg_simple_service_content_002',
    content_group: 'simple_service_content',
    content_type: 'service_content_block',
    title_summary: 'Quick Contact Block',
    short_text_summary:
      'Template block for support contact hints inside Telegram service messages.',
    visibility_action_summary: Object.freeze({
      visibility_state: 'visible',
      action_type: 'open_support_hint',
      action_reference: 'contact_support',
    }),
    is_enabled: true,
    baseline_timestamp_iso: '2026-04-14T00:00:00.000Z',
  }),
]);

const WEATHER_AWARE_ALLOWED_REMINDER_TYPES = Object.freeze([
  '1_hour_before_trip',
  '30_minutes_before_trip',
]);

const WEATHER_KEYWORDS_BY_CONDITION = Object.freeze({
  rain: Object.freeze(['rain', 'drizzle', 'shower', 'storm', 'thunder']),
  wind: Object.freeze(['wind', 'gust']),
  heat: Object.freeze(['hot', 'heat']),
  cool: Object.freeze(['cold', 'cool', 'snow', 'ice', 'frost']),
});

const WEATHER_SOURCE_TYPES = Object.freeze({
  resolver: 'resolver',
  inline: 'inline',
  unavailable: 'unavailable',
});

const RESORT_CARD_REFERENCE_SET = new Set(TELEGRAM_USEFUL_RESORT_CARD_REFERENCES);
const RESORT_CARD_REFERENCE_ORDER = new Map(
  TELEGRAM_USEFUL_RESORT_CARD_REFERENCES.map((reference, index) => [reference, index])
);

const WEATHER_RECOMMENDATION_TEXT = Object.freeze({
  rain: 'Возможен дождь. Возьмите лёгкую непромокаемую куртку.',
  wind: 'У берега может быть ветрено. Лучше взять лёгкую накидку.',
  heat: 'Жарко и солнечно. Пейте больше воды и используйте защиту от солнца.',
  cool: 'У моря прохладнее, чем в посёлке. Пригодится тонкий верхний слой.',
  steady: 'Погода спокойная и комфортная для прогулок.',
  fallback: 'Данные по погоде временно обновляются.',
});

const DEFAULT_USEFUL_ENTRYPOINT_TITLE = 'Полезное в Архипо-Осиповке';
const DEFAULT_USEFUL_ENTRYPOINT_BODY =
  'Актуальная погода и проверенные места рядом с побережьем Чёрного моря.';
function rejectContentManagement(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function rejectUsefulContent(message) {
  throw new Error(`${LEGACY_ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return Boolean(fallback);
  }

  if (value === true || value === false) {
    return value;
  }

  if (value === 1 || value === 0) {
    return value === 1;
  }

  rejectContentManagement('enabled state must be boolean-compatible');
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectContentManagement(`${label} must be a positive integer`);
  }
  return normalized;
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeOptionalPercentage(value) {
  const normalized = normalizeOptionalNumber(value);
  if (normalized === null) {
    return null;
  }
  if (normalized < 0 || normalized > 100) {
    return null;
  }
  return normalized;
}

function includesWeatherKeyword(condition, keywordList) {
  if (!condition) {
    return false;
  }
  return keywordList.some((keyword) => condition.includes(keyword));
}

function normalizeReminderTypeInput(input = {}) {
  const reminderType = normalizeString(
    input.reminder_type ?? input.reminderType ?? input.message_type ?? input.messageType
  );
  if (!reminderType) {
    return null;
  }
  if (!WEATHER_AWARE_ALLOWED_REMINDER_TYPES.includes(reminderType)) {
    return null;
  }
  return reminderType;
}

function buildDefaultReminderStatusLine(reminderType = null) {
  if (reminderType === '30_minutes_before_trip') {
    return 'До посадки осталось совсем немного. Держите телефон и документы под рукой.';
  }
  if (reminderType === '1_hour_before_trip') {
    return 'Поездка скоро начнётся. Проверьте время отправления и подготовьтесь к посадке.';
  }
  return WEATHER_RECOMMENDATION_TEXT.fallback;
}
function normalizeBookingRequestReferenceInput(input = {}) {
  const rawReference =
    input.booking_request_reference ??
    input.bookingRequestReference ??
    input.booking_request ??
    input.bookingRequest ??
    null;
  if (!rawReference) {
    return null;
  }
  if (typeof rawReference !== 'object' || Array.isArray(rawReference)) {
    rejectUsefulContent('booking_request_reference must be an object when provided');
  }

  const referenceType = normalizeString(
    rawReference.reference_type || 'telegram_booking_request'
  );
  if (referenceType !== 'telegram_booking_request') {
    rejectUsefulContent(
      `Unsupported booking-request reference type: ${referenceType || 'unknown'}`
    );
  }

  return freezeTelegramUsefulContentValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: normalizePositiveInteger(
      rawReference.booking_request_id ?? rawReference.bookingRequestId,
      'booking_request_reference.booking_request_id'
    ),
  });
}

function toBookingRequestReference(bookingRequest = {}) {
  const bookingRequestId = normalizeOptionalNumber(bookingRequest.booking_request_id);
  if (!Number.isInteger(bookingRequestId) || bookingRequestId <= 0) {
    return null;
  }

  return freezeTelegramUsefulContentValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: bookingRequestId,
  });
}

function parseTripStartIsoFromBookingRequest(bookingRequest) {
  const tripDate = normalizeString(bookingRequest?.requested_trip_date);
  const tripTime = normalizeString(bookingRequest?.requested_time_slot);
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

function pickWeatherSnapshotInput(input = {}) {
  return (
    input.weather_snapshot ??
    input.weatherSnapshot ??
    input.weather_summary ??
    input.weatherSummary ??
    null
  );
}

function normalizeWeatherSnapshot(rawSnapshot = null, sourceType = WEATHER_SOURCE_TYPES.unavailable) {
  if (!rawSnapshot || typeof rawSnapshot !== 'object' || Array.isArray(rawSnapshot)) {
    return freezeTelegramUsefulContentValue({
      weather_data_state: 'unavailable',
      source_type: WEATHER_SOURCE_TYPES.unavailable,
      observed_at: null,
      condition_code: null,
      condition_label: null,
      temperature_c: null,
      water_temperature_c: null,
      sunset_time_iso: null,
      sunset_time_local: null,
      wind_speed_mps: null,
      precipitation_probability: null,
      location_country: null,
      location_region: null,
      location_locality: null,
      location_water_body: null,
      data_provider: null,
    });
  }

  const conditionCode = normalizeString(
    rawSnapshot.condition_code ??
      rawSnapshot.conditionCode ??
      rawSnapshot.condition ??
      rawSnapshot.weather_code ??
      rawSnapshot.weatherCode
  );
  const conditionLabel = normalizeString(
    rawSnapshot.condition_label ??
      rawSnapshot.conditionLabel ??
      rawSnapshot.description ??
      rawSnapshot.summary
  );
  const temperature = normalizeOptionalNumber(
    rawSnapshot.temperature_c ??
      rawSnapshot.temperatureC ??
      rawSnapshot.temperature
  );
  const waterTemperature = normalizeOptionalNumber(
    rawSnapshot.water_temperature_c ??
      rawSnapshot.waterTemperatureC ??
      rawSnapshot.sea_surface_temperature ??
      rawSnapshot.seaSurfaceTemperature
  );
  const sunsetTimeIso = normalizeString(
    rawSnapshot.sunset_time_iso ?? rawSnapshot.sunsetTimeIso ?? rawSnapshot.sunset_iso
  );
  const sunsetTimeLocal = normalizeString(
    rawSnapshot.sunset_time_local ?? rawSnapshot.sunsetTimeLocal ?? rawSnapshot.sunset
  );
  const windSpeed = normalizeOptionalNumber(
    rawSnapshot.wind_speed_mps ??
      rawSnapshot.windSpeedMps ??
      rawSnapshot.wind_speed ??
      rawSnapshot.windSpeed
  );
  const precipitationProbability = normalizeOptionalPercentage(
    rawSnapshot.precipitation_probability ??
      rawSnapshot.precipitationProbability ??
      rawSnapshot.precip_probability ??
      rawSnapshot.precipProbability
  );
  const observedAt = normalizeString(
    rawSnapshot.observed_at ?? rawSnapshot.observedAt ?? rawSnapshot.timestamp
  );
  const hasAny =
    Boolean(conditionCode) ||
    Boolean(conditionLabel) ||
    temperature !== null ||
    waterTemperature !== null ||
    Boolean(sunsetTimeIso || sunsetTimeLocal) ||
    windSpeed !== null ||
    precipitationProbability !== null;
  const hasFullCore =
    Boolean(conditionCode || conditionLabel) &&
    temperature !== null &&
    waterTemperature !== null &&
    Boolean(sunsetTimeIso || sunsetTimeLocal);
  const weatherDataState = hasFullCore ? 'available' : hasAny ? 'partial' : 'unavailable';
  const normalizedWeatherDataState = TELEGRAM_WEATHER_DATA_STATES.includes(weatherDataState)
    ? weatherDataState
    : 'unavailable';

  return freezeTelegramUsefulContentValue({
    weather_data_state: normalizedWeatherDataState,
    source_type: hasAny ? sourceType : WEATHER_SOURCE_TYPES.unavailable,
    observed_at: observedAt,
    condition_code: conditionCode,
    condition_label: conditionLabel,
    temperature_c: temperature,
    water_temperature_c: waterTemperature,
    sunset_time_iso: sunsetTimeIso,
    sunset_time_local: sunsetTimeLocal,
    wind_speed_mps: windSpeed,
    precipitation_probability: precipitationProbability,
    location_country: normalizeString(rawSnapshot.location_country ?? rawSnapshot.country),
    location_region: normalizeString(rawSnapshot.location_region ?? rawSnapshot.region),
    location_locality: normalizeString(rawSnapshot.location_locality ?? rawSnapshot.locality),
    location_water_body: normalizeString(
      rawSnapshot.location_water_body ?? rawSnapshot.water_body ?? rawSnapshot.waterBody
    ),
    data_provider: normalizeString(rawSnapshot.data_provider ?? rawSnapshot.provider),
  });
}
function buildWeatherRecommendations(weatherSnapshot) {
  if (!weatherSnapshot || weatherSnapshot.weather_data_state === 'unavailable') {
    return freezeTelegramUsefulContentValue([WEATHER_RECOMMENDATION_TEXT.fallback]);
  }

  const normalizedCondition = normalizeString(
    weatherSnapshot.condition_code || weatherSnapshot.condition_label
  )?.toLowerCase();
  const recommendations = [];

  if (
    (weatherSnapshot.precipitation_probability ?? 0) >= 40 ||
    includesWeatherKeyword(normalizedCondition, WEATHER_KEYWORDS_BY_CONDITION.rain)
  ) {
    recommendations.push(WEATHER_RECOMMENDATION_TEXT.rain);
  }

  if (
    (weatherSnapshot.wind_speed_mps ?? 0) >= 8 ||
    includesWeatherKeyword(normalizedCondition, WEATHER_KEYWORDS_BY_CONDITION.wind)
  ) {
    recommendations.push(WEATHER_RECOMMENDATION_TEXT.wind);
  }

  if (
    (weatherSnapshot.temperature_c ?? Number.NEGATIVE_INFINITY) >= 28 ||
    includesWeatherKeyword(normalizedCondition, WEATHER_KEYWORDS_BY_CONDITION.heat)
  ) {
    recommendations.push(WEATHER_RECOMMENDATION_TEXT.heat);
  } else if (
    (weatherSnapshot.temperature_c ?? Number.POSITIVE_INFINITY) <= 10 ||
    includesWeatherKeyword(normalizedCondition, WEATHER_KEYWORDS_BY_CONDITION.cool)
  ) {
    recommendations.push(WEATHER_RECOMMENDATION_TEXT.cool);
  }

  if (recommendations.length === 0) {
    recommendations.push(WEATHER_RECOMMENDATION_TEXT.steady);
  }

  return freezeTelegramUsefulContentValue(recommendations);
}

function sortByReference(left, right) {
  const leftReference = normalizeString(left.content_reference || left.faq_reference) || '';
  const rightReference = normalizeString(right.content_reference || right.faq_reference) || '';
  return leftReference < rightReference ? -1 : leftReference > rightReference ? 1 : 0;
}

function normalizeVisibilityActionSummary(value) {
  if (value === null || value === undefined || value === '') {
    return freezeTelegramContentManagementValue(DEFAULT_VISIBILITY_ACTION_SUMMARY);
  }
  if (!isPlainObject(value)) {
    rejectContentManagement('visibility_action_summary must be an object when provided');
  }

  return freezeTelegramContentManagementValue(value);
}

function normalizeManagedContentGroup(value) {
  const normalized = normalizeString(value);
  if (!normalized || !TELEGRAM_MANAGED_CONTENT_GROUPS.includes(normalized)) {
    rejectContentManagement(`Unsupported content group: ${normalized || 'unknown'}`);
  }
  return normalized;
}

function normalizeManagedContentType(value) {
  const normalized = normalizeString(value);
  if (!normalized || !TELEGRAM_MANAGED_CONTENT_TYPES.includes(normalized)) {
    rejectContentManagement(`Unsupported content type: ${normalized || 'unknown'}`);
  }
  return normalized;
}

function assertGroupTypeCompatibility(contentGroup, contentType) {
  const allowedTypes = TELEGRAM_CONTENT_GROUP_TYPE_COMPATIBILITY[contentGroup];
  if (!Array.isArray(allowedTypes) || !allowedTypes.includes(contentType)) {
    rejectContentManagement(
      `Incompatible content payload for group/type: ${contentGroup}/${contentType}`
    );
  }
}

function normalizeLegacyGroupings(rawGrouping, allowedValues, label) {
  if (rawGrouping === null || rawGrouping === undefined || rawGrouping === '') {
    return allowedValues;
  }
  const values = Array.isArray(rawGrouping) ? rawGrouping : [rawGrouping];
  const normalized = [...new Set(values.map((value) => normalizeString(value)).filter(Boolean))];
  if (normalized.length === 0) {
    return allowedValues;
  }
  for (const grouping of normalized) {
    if (!allowedValues.includes(grouping)) {
      rejectUsefulContent(`Unsupported ${label} grouping: ${grouping}`);
    }
  }
  return Object.freeze(normalized);
}

function normalizeContentGroupsInput(input = {}) {
  const rawGrouping =
    input.content_group ??
    input.contentGroup ??
    input.content_grouping ??
    input.contentGrouping ??
    input.group ??
    input.grouping ??
    input.groups ??
    input.groupings;
  if (rawGrouping === null || rawGrouping === undefined || rawGrouping === '') {
    return TELEGRAM_MANAGED_CONTENT_GROUPS;
  }
  const values = Array.isArray(rawGrouping) ? rawGrouping : [rawGrouping];
  const groups = [...new Set(values.map((value) => normalizeManagedContentGroup(value)))];
  if (groups.length === 0) {
    return TELEGRAM_MANAGED_CONTENT_GROUPS;
  }
  return Object.freeze(groups);
}

function normalizeContentReferenceInput(input = {}) {
  if (typeof input === 'string') {
    return normalizeContentReference(input);
  }
  const rawReference =
    input.content_reference ??
    input.contentReference ??
    input.faq_reference ??
    input.faqReference ??
    input.reference;
  return normalizeContentReference(rawReference);
}

function normalizeContentReference(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    rejectContentManagement('content reference is required');
  }
  if (!CONTENT_REFERENCE_RE.test(normalized)) {
    rejectContentManagement(
      'content reference must contain only letters, numbers, underscores, or hyphens'
    );
  }
  return normalized;
}

function normalizeTitleSummary(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    rejectContentManagement('title summary is required');
  }
  return normalized;
}

function normalizeShortTextSummary(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    rejectContentManagement('short-text summary is required');
  }
  return normalized;
}

function normalizeContentCreateInput(input = {}) {
  if (!isPlainObject(input)) {
    rejectContentManagement('content create payload must be an object');
  }

  const contentReference = normalizeContentReferenceInput(input);
  const contentGroup = normalizeManagedContentGroup(
    input.content_group ?? input.contentGroup
  );
  const contentType = normalizeManagedContentType(
    input.content_type ?? input.contentType
  );
  assertGroupTypeCompatibility(contentGroup, contentType);

  return freezeTelegramContentManagementValue({
    content_reference: contentReference,
    content_group: contentGroup,
    content_type: contentType,
    title_summary: normalizeTitleSummary(input.title_summary ?? input.title),
    short_text_summary: normalizeShortTextSummary(
      input.short_text_summary ?? input.short_text ?? input.shortText
    ),
    visibility_action_summary: normalizeVisibilityActionSummary(
      input.visibility_action_summary ?? input.visibilityActionSummary ?? null
    ),
    is_enabled: normalizeBoolean(
      input.is_enabled ?? input.isEnabled ?? input.enabled,
      true
    ),
  });
}

function normalizeContentUpdateInput(input = {}) {
  if (!isPlainObject(input)) {
    rejectContentManagement('content update payload must be an object');
  }

  const contentReference = normalizeContentReferenceInput(input);
  const expectedVersionRaw = input.expected_version ?? input.expectedVersion;
  const expectedVersion =
    expectedVersionRaw === undefined || expectedVersionRaw === null || expectedVersionRaw === ''
      ? null
      : normalizePositiveInteger(expectedVersionRaw, 'expected_version');
  const patch = {};

  const hasContentGroup = input.content_group !== undefined || input.contentGroup !== undefined;
  const hasContentType = input.content_type !== undefined || input.contentType !== undefined;
  const hasTitle =
    input.title_summary !== undefined ||
    input.title !== undefined;
  const hasShortText =
    input.short_text_summary !== undefined ||
    input.short_text !== undefined ||
    input.shortText !== undefined;
  const hasVisibility =
    input.visibility_action_summary !== undefined ||
    input.visibilityActionSummary !== undefined;
  const hasEnabled =
    input.is_enabled !== undefined ||
    input.isEnabled !== undefined ||
    input.enabled !== undefined;

  if (hasContentGroup) {
    patch.content_group = normalizeManagedContentGroup(
      input.content_group ?? input.contentGroup
    );
  }
  if (hasContentType) {
    patch.content_type = normalizeManagedContentType(
      input.content_type ?? input.contentType
    );
  }
  if (hasTitle) {
    patch.title_summary = normalizeTitleSummary(input.title_summary ?? input.title);
  }
  if (hasShortText) {
    patch.short_text_summary = normalizeShortTextSummary(
      input.short_text_summary ?? input.short_text ?? input.shortText
    );
  }
  if (hasVisibility) {
    patch.visibility_action_summary = normalizeVisibilityActionSummary(
      input.visibility_action_summary ?? input.visibilityActionSummary
    );
  }
  if (hasEnabled) {
    patch.is_enabled = normalizeBoolean(
      input.is_enabled ?? input.isEnabled ?? input.enabled
    );
  }
  if (Object.keys(patch).length === 0) {
    rejectContentManagement('content update patch is empty');
  }

  return freezeTelegramContentManagementValue({
    content_reference: contentReference,
    expected_version: expectedVersion,
    patch,
  });
}

function normalizeEnableDisableInput(input = {}, enabledValue = undefined) {
  if (enabledValue !== undefined) {
    return freezeTelegramContentManagementValue({
      content_reference: normalizeContentReferenceInput(input),
      enabled: normalizeBoolean(enabledValue),
      expected_version:
        input.expected_version === undefined && input.expectedVersion === undefined
          ? null
          : normalizePositiveInteger(
              input.expected_version ?? input.expectedVersion,
              'expected_version'
            ),
    });
  }

  if (!isPlainObject(input)) {
    rejectContentManagement('enable/disable payload must be an object');
  }
  return freezeTelegramContentManagementValue({
    content_reference: normalizeContentReferenceInput(input),
    enabled: normalizeBoolean(input.enabled ?? input.is_enabled ?? input.isEnabled),
    expected_version:
      input.expected_version === undefined && input.expectedVersion === undefined
        ? null
        : normalizePositiveInteger(
            input.expected_version ?? input.expectedVersion,
            'expected_version'
          ),
  });
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
    null
  );
}

function normalizeTelegramUserId(reference) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    rejectUsefulContent('telegram_user_reference is required');
  }
  const referenceType = normalizeString(reference.reference_type || 'telegram_user');
  if (referenceType !== 'telegram_user') {
    rejectUsefulContent(
      `Unsupported telegram-user reference type: ${referenceType || 'unknown'}`
    );
  }

  const telegramUserId = normalizeString(
    reference.telegram_user_id ?? reference.telegramUserId
  );
  if (!telegramUserId) {
    rejectUsefulContent('telegram_user_reference.telegram_user_id is required');
  }
  return telegramUserId;
}

function normalizeFaqItemReference(input = {}) {
  const rawReference =
    input.faq_reference ??
    input.faqReference ??
    input.reference ??
    input;
  const normalizedReference =
    typeof rawReference === 'object'
      ? rawReference.faq_reference ?? rawReference.faqReference
      : rawReference;
  const faqReference = normalizeString(normalizedReference);
  if (!faqReference) {
    rejectUsefulContent('faq reference is required');
  }
  return faqReference;
}

function toLegacyUsefulContentType(item) {
  if (item.content_group === 'what_to_take') {
    return 'checklist_item';
  }
  return 'info_card';
}

function buildManagedItemProjection(item) {
  return freezeTelegramContentManagementValue({
    content_reference: item.content_reference,
    content_type_group_summary: freezeTelegramContentManagementValue({
      content_group: item.content_group,
      content_type: item.content_type,
    }),
    title_summary: freezeTelegramContentManagementValue({
      title: item.title_summary,
    }),
    short_text_summary: freezeTelegramContentManagementValue({
      short_text: item.short_text_summary,
    }),
    visibility_enabled_summary: freezeTelegramContentManagementValue({
      visibility_state: item.is_enabled ? 'enabled' : 'disabled',
      enabled: Boolean(item.is_enabled),
      visibility_action_summary: item.visibility_action_summary || null,
    }),
    version_summary: freezeTelegramContentManagementValue({
      content_version: item.content_version,
      is_latest_version: Boolean(item.is_latest_version),
    }),
    latest_timestamp_summary: buildTelegramHandoffTimestampSummary(
      item.updated_at || item.created_at
    ),
  });
}

function buildLegacyProjectedItem(item, referenceKey) {
  const referenceValue = item[referenceKey];
  const contentType =
    referenceKey === 'faq_reference' ? 'faq_item' : toLegacyUsefulContentType(item);

  return freezeTelegramUsefulContentValue({
    [referenceKey]: referenceValue,
    content_type_summary: {
      content_grouping: item.content_group,
      content_type: contentType,
    },
    title_short_text_summary: {
      title: item.title_summary,
      short_text: item.short_text_summary,
    },
    visibility_action_summary: item.visibility_action_summary || null,
    latest_timestamp_summary: buildTelegramHandoffTimestampSummary(
      item.updated_at || item.created_at
    ),
  });
}

function mapStaticUsefulItemToManaged(item) {
  return Object.freeze({
    content_reference: item.content_reference,
    content_group: item.content_grouping,
    content_type: 'useful_content_item',
    title_summary: item.title,
    short_text_summary: item.short_text,
    visibility_action_summary: item.visibility_action_summary || null,
    is_enabled: (item.visibility_action_summary?.visibility_state || 'visible') !== 'hidden',
    baseline_timestamp_iso: item.latest_content_at,
  });
}

function mapStaticFaqItemToManaged(item) {
  return Object.freeze({
    content_reference: item.faq_reference,
    content_group: item.content_grouping,
    content_type: 'faq_item',
    title_summary: item.title,
    short_text_summary: item.short_text,
    visibility_action_summary: item.visibility_action_summary || null,
    is_enabled: (item.visibility_action_summary?.visibility_state || 'visible') !== 'hidden',
    baseline_timestamp_iso: item.latest_content_at,
  });
}

function areManagedItemsEquivalent(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildCreateSignature(input) {
  return freezeTelegramContentManagementValue({
    content_reference: input.content_reference,
    content_group: input.content_group,
    content_type: input.content_type,
    title_summary: input.title_summary,
    short_text_summary: input.short_text_summary,
    visibility_action_summary: input.visibility_action_summary || null,
    is_enabled: Boolean(input.is_enabled),
  });
}

function buildManagedItemComparableSignature(item) {
  return buildCreateSignature({
    content_reference: item.content_reference,
    content_group: item.content_group,
    content_type: item.content_type,
    title_summary: item.title_summary,
    short_text_summary: item.short_text_summary,
    visibility_action_summary: item.visibility_action_summary || null,
    is_enabled: Boolean(item.is_enabled),
  });
}

function shouldApplyFaqBaselineUpgrade(existing, baselineItem) {
  if (!existing || baselineItem.content_type !== 'faq_item') {
    return false;
  }

  const existingVersion = Number(existing.content_version);
  if (!Number.isInteger(existingVersion) || existingVersion !== 1) {
    return false;
  }

  const existingSignature = buildManagedItemComparableSignature(existing);
  const baselineSignature = buildCreateSignature({
    content_reference: baselineItem.content_reference,
    content_group: baselineItem.content_group,
    content_type: baselineItem.content_type,
    title_summary: baselineItem.title_summary,
    short_text_summary: baselineItem.short_text_summary,
    visibility_action_summary: baselineItem.visibility_action_summary || null,
    is_enabled: Boolean(baselineItem.is_enabled),
  });
  return !areManagedItemsEquivalent(existingSignature, baselineSignature);
}

export class TelegramUsefulContentFaqProjectionService {
  constructor({
    guestProfiles,
    bookingRequests = null,
    managedContentItems,
    resolveWeatherSnapshot = null,
    now = () => new Date(),
  }) {
    this.guestProfiles = guestProfiles;
    this.bookingRequests = bookingRequests;
    this.managedContentItems = managedContentItems;
    this.resolveWeatherSnapshot = resolveWeatherSnapshot;
    this.now = now;
    this._baselineSeeded = false;
  }

  describe() {
    return Object.freeze({
      serviceName: LEGACY_SERVICE_NAME,
      status: 'managed_content_projection_ready',
      dependencyKeys: ['guestProfiles', 'bookingRequests', 'managedContentItems'],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectContentManagement('content-management clock returned an unusable timestamp');
    }
    return iso;
  }

  get db() {
    return this.managedContentItems?.db || null;
  }

  ensureBaselineContentSeeded() {
    if (this._baselineSeeded || !this.managedContentItems?.db) {
      return;
    }

    const baselineItems = [
      ...TELEGRAM_USEFUL_CONTENT_FEED_ITEMS.map(mapStaticUsefulItemToManaged),
      ...TELEGRAM_FAQ_ITEMS.map(mapStaticFaqItemToManaged),
      ...SIMPLE_SERVICE_CONTENT_BASELINE_ITEMS,
    ];
    const runSeed = () => {
      for (const item of baselineItems) {
        const existing = this.managedContentItems.findOneBy(
          { content_reference: item.content_reference },
          { orderBy: 'content_version DESC' }
        );
        if (existing) {
          if (!shouldApplyFaqBaselineUpgrade(existing, item)) {
            continue;
          }

          const nowIso = this.nowIso();
          this.managedContentItems.updateById(existing.telegram_managed_content_item_id, {
            is_latest_version: 0,
            updated_at: nowIso,
          });
          this.managedContentItems.create({
            content_reference: item.content_reference,
            content_group: item.content_group,
            content_type: item.content_type,
            title_summary: item.title_summary,
            short_text_summary: item.short_text_summary,
            visibility_action_summary: item.visibility_action_summary,
            is_enabled: item.is_enabled ? 1 : 0,
            content_version: Number(existing.content_version) + 1,
            is_latest_version: 1,
            versioned_from_item_id: existing.telegram_managed_content_item_id,
            created_at: nowIso,
            updated_at: nowIso,
          });
          continue;
        }
        const baselineIso = item.baseline_timestamp_iso || this.nowIso();
        this.managedContentItems.create({
          content_reference: item.content_reference,
          content_group: item.content_group,
          content_type: item.content_type,
          title_summary: item.title_summary,
          short_text_summary: item.short_text_summary,
          visibility_action_summary: item.visibility_action_summary,
          is_enabled: item.is_enabled ? 1 : 0,
          content_version: 1,
          is_latest_version: 1,
          versioned_from_item_id: null,
          created_at: baselineIso,
          updated_at: baselineIso,
        });
      }
    };

    if (typeof this.db?.transaction === 'function') {
      this.db.transaction(runSeed)();
    } else {
      runSeed();
    }
    this._baselineSeeded = true;
  }

  resolveOptionalTelegramUserSummary(input = {}) {
    const rawReference = pickTelegramUserReference(input);
    if (!rawReference) {
      return null;
    }
    const telegramUserId = normalizeTelegramUserId(rawReference);
    const guestProfile = this.guestProfiles.findOneBy(
      { telegram_user_id: telegramUserId },
      { orderBy: 'guest_profile_id ASC' }
    );
    if (!guestProfile) {
      rejectUsefulContent(`Guest profile not found for telegram_user_id: ${telegramUserId}`);
    }

    return buildTelegramUserSummaryFromGuestProfileAndEvents({
      guestProfile,
      events: [],
    });
  }

  resolveGuestProfileByTelegramUserSummary(telegramUserSummary) {
    const telegramUserId = normalizeString(telegramUserSummary?.telegram_user_id);
    if (!telegramUserId) {
      return null;
    }

    return (
      this.guestProfiles.findOneBy(
        { telegram_user_id: telegramUserId },
        { orderBy: 'guest_profile_id ASC' }
      ) || null
    );
  }

  resolveBookingRequestForWeatherContext({
    nowIso,
    telegramUserSummary,
    bookingRequestReference,
  }) {
    if (!this.bookingRequests?.listBy) {
      return freezeTelegramUsefulContentValue({
        booking_request_reference: null,
        requested_trip_date: null,
        requested_time_slot: null,
        trip_start_iso: null,
        applicability_state: 'trip_context_unavailable',
      });
    }

    if (bookingRequestReference) {
      if (!this.bookingRequests?.getById) {
        rejectUsefulContent('booking request lookup is unavailable');
      }
      const bookingRequest = this.bookingRequests.getById(
        bookingRequestReference.booking_request_id
      );
      if (!bookingRequest) {
        rejectUsefulContent(
          `Invalid booking request reference: ${bookingRequestReference.booking_request_id}`
        );
      }

      if (telegramUserSummary?.guest_profile_id) {
        if (bookingRequest.guest_profile_id !== telegramUserSummary.guest_profile_id) {
          rejectUsefulContent(
            `Booking request does not belong to telegram guest: ${bookingRequestReference.booking_request_id}`
          );
        }
      }

      return freezeTelegramUsefulContentValue({
        booking_request_reference: toBookingRequestReference(bookingRequest),
        requested_trip_date: normalizeString(bookingRequest.requested_trip_date),
        requested_time_slot: normalizeString(bookingRequest.requested_time_slot),
        trip_start_iso: parseTripStartIsoFromBookingRequest(bookingRequest),
        applicability_state: 'booking_request_selected',
      });
    }

    if (!telegramUserSummary?.guest_profile_id) {
      return freezeTelegramUsefulContentValue({
        booking_request_reference: null,
        requested_trip_date: null,
        requested_time_slot: null,
        trip_start_iso: null,
        applicability_state: 'not_applicable',
      });
    }

    const rows = this.bookingRequests.listBy(
      { guest_profile_id: telegramUserSummary.guest_profile_id },
      {
        orderBy: 'requested_trip_date ASC, requested_time_slot ASC, booking_request_id ASC',
        limit: 200,
      }
    );
    const nowMillis = Date.parse(nowIso);
    const sortedByUpcoming = rows
      .map((item) => ({
        row: item,
        trip_start_iso: parseTripStartIsoFromBookingRequest(item),
      }))
      .filter((item) => Boolean(item.trip_start_iso))
      .sort((left, right) => Date.parse(left.trip_start_iso) - Date.parse(right.trip_start_iso));

    const upcoming =
      sortedByUpcoming.find((item) => Date.parse(item.trip_start_iso) >= nowMillis) ||
      null;

    if (!upcoming) {
      return freezeTelegramUsefulContentValue({
        booking_request_reference: null,
        requested_trip_date: null,
        requested_time_slot: null,
        trip_start_iso: null,
        applicability_state: 'not_applicable',
      });
    }

    return freezeTelegramUsefulContentValue({
      booking_request_reference: toBookingRequestReference(upcoming.row),
      requested_trip_date: normalizeString(upcoming.row.requested_trip_date),
      requested_time_slot: normalizeString(upcoming.row.requested_time_slot),
      trip_start_iso: upcoming.trip_start_iso,
      applicability_state: 'upcoming_trip_selected',
    });
  }

  resolveWeatherSnapshotForContext(input = {}, weatherContext = {}) {
    const inlineWeather = pickWeatherSnapshotInput(input);
    if (inlineWeather) {
      return normalizeWeatherSnapshot(inlineWeather, WEATHER_SOURCE_TYPES.inline);
    }
    if (typeof this.resolveWeatherSnapshot !== 'function') {
      return normalizeWeatherSnapshot(null);
    }

    try {
      const resolved = this.resolveWeatherSnapshot(
        freezeTelegramUsefulContentValue({
          booking_request_reference: weatherContext.booking_request_reference || null,
          trip_context_summary: freezeTelegramUsefulContentValue({
            requested_trip_date: weatherContext.requested_trip_date || null,
            requested_time_slot: weatherContext.requested_time_slot || null,
            trip_start_iso: weatherContext.trip_start_iso || null,
            applicability_state: weatherContext.applicability_state || 'not_applicable',
          }),
          telegram_user_summary: weatherContext.telegram_user_summary || null,
        })
      );
      return normalizeWeatherSnapshot(resolved, WEATHER_SOURCE_TYPES.resolver);
    } catch {
      return normalizeWeatherSnapshot(null);
    }
  }

  buildWeatherCaringContentSummary({
    weatherSnapshot,
    reminderType = null,
    fallbackTitle,
    fallbackBody,
  }) {
    const recommendationLines = buildWeatherRecommendations(weatherSnapshot);
    const reminderStatusLine =
      weatherSnapshot.weather_data_state === 'unavailable'
        ? buildDefaultReminderStatusLine(reminderType)
        : recommendationLines[0] || buildDefaultReminderStatusLine(reminderType);

    const usefulHeadline = fallbackTitle || DEFAULT_USEFUL_ENTRYPOINT_TITLE;
    const usefulBody =
      weatherSnapshot.weather_data_state === 'unavailable'
        ? fallbackBody
        : 'Смотрите актуальную погоду и подборку мест для отдыха рядом с морем.';

    return freezeTelegramUsefulContentValue({
      reminder_status_line: reminderStatusLine,
      useful_headline: usefulHeadline,
      useful_body: usefulBody,
      recommendation_lines: recommendationLines,
    });
  }

  listLatestManagedItemsByGroups(contentGroups) {
    const rows = [];
    for (const contentGroup of contentGroups) {
      rows.push(
        ...this.managedContentItems.listBy(
          { content_group: contentGroup, is_latest_version: 1 },
          { orderBy: 'content_reference ASC', limit: 500 }
        )
      );
    }
    return rows.sort((left, right) =>
      String(left.content_reference).localeCompare(String(right.content_reference))
    );
  }

  resolveLatestManagedItemByReference(contentReference) {
    const item = this.managedContentItems.findOneBy(
      { content_reference: contentReference, is_latest_version: 1 },
      { orderBy: 'content_version DESC' }
    );
    if (!item) {
      rejectContentManagement(`Invalid content reference: ${contentReference}`);
    }
    return item;
  }

  assertExpectedVersionOrThrow(item, expectedVersion) {
    if (expectedVersion === null || expectedVersion === undefined) {
      return;
    }
    if (Number(item.content_version) !== Number(expectedVersion)) {
      rejectContentManagement(
        `version conflict for content reference ${item.content_reference}: expected ${expectedVersion}, got ${item.content_version}`
      );
    }
  }

  buildContentItemResult(item) {
    return freezeTelegramContentManagementValue({
      response_version: TELEGRAM_CONTENT_MANAGEMENT_ITEM_VERSION,
      read_only: true,
      projected_by: CONTENT_SERVICE_NAME,
      content_item: buildManagedItemProjection(item),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        item.updated_at,
        item.created_at
      ),
    });
  }

  buildMutationResult(item, operation) {
    return freezeTelegramContentManagementValue({
      response_version: TELEGRAM_CONTENT_MANAGEMENT_MUTATION_VERSION,
      persistence_applied: true,
      operation,
      processed_by: CONTENT_SERVICE_NAME,
      content_item: buildManagedItemProjection(item),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        this.nowIso(),
        item.updated_at,
        item.created_at
      ),
    });
  }

  listContentItemsByGroup(input = {}) {
    this.ensureBaselineContentSeeded();
    const nowIso = this.nowIso();
    const groups = normalizeContentGroupsInput(input);
    const items = this.listLatestManagedItemsByGroups(groups).map((item) =>
      buildManagedItemProjection(item)
    );

    return freezeTelegramContentManagementValue({
      response_version: TELEGRAM_CONTENT_MANAGEMENT_LIST_VERSION,
      read_only: true,
      projected_by: CONTENT_SERVICE_NAME,
      content_group_summary: groups,
      item_count: items.length,
      items,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        ...items.map((item) => item.latest_timestamp_summary?.iso)
      ),
    });
  }

  readContentItemByReference(input = {}) {
    this.ensureBaselineContentSeeded();
    const contentReference = normalizeContentReferenceInput(input);
    const item = this.resolveLatestManagedItemByReference(contentReference);
    return this.buildContentItemResult(item);
  }

  createContentItem(input = {}) {
    this.ensureBaselineContentSeeded();
    const normalizedInput = normalizeContentCreateInput(input);
    const existing = this.managedContentItems.findOneBy(
      { content_reference: normalizedInput.content_reference, is_latest_version: 1 },
      { orderBy: 'content_version DESC' }
    );
    if (existing) {
      const existingSignature = buildCreateSignature({
        content_reference: existing.content_reference,
        content_group: existing.content_group,
        content_type: existing.content_type,
        title_summary: existing.title_summary,
        short_text_summary: existing.short_text_summary,
        visibility_action_summary: existing.visibility_action_summary || null,
        is_enabled: Boolean(existing.is_enabled),
      });
      const inputSignature = buildCreateSignature(normalizedInput);
      if (areManagedItemsEquivalent(existingSignature, inputSignature)) {
        return this.buildMutationResult(existing, 'idempotent_create');
      }
      rejectContentManagement(
        `duplicate incompatible content payload for reference: ${normalizedInput.content_reference}`
      );
    }

    const createdAt = this.nowIso();
    const created = this.managedContentItems.create({
      ...normalizedInput,
      is_enabled: normalizedInput.is_enabled ? 1 : 0,
      content_version: 1,
      is_latest_version: 1,
      versioned_from_item_id: null,
      created_at: createdAt,
      updated_at: createdAt,
    });

    return this.buildMutationResult(created, 'created');
  }

  updateContentItemVersionSafe(input = {}) {
    this.ensureBaselineContentSeeded();
    const normalizedInput = normalizeContentUpdateInput(input);
    const runUpdate = () => {
      const current = this.resolveLatestManagedItemByReference(
        normalizedInput.content_reference
      );
      this.assertExpectedVersionOrThrow(current, normalizedInput.expected_version);

      const nextGroup = normalizedInput.patch.content_group || current.content_group;
      const nextType = normalizedInput.patch.content_type || current.content_type;
      assertGroupTypeCompatibility(nextGroup, nextType);

      const nextPayload = {
        content_reference: current.content_reference,
        content_group: nextGroup,
        content_type: nextType,
        title_summary:
          normalizedInput.patch.title_summary !== undefined
            ? normalizedInput.patch.title_summary
            : current.title_summary,
        short_text_summary:
          normalizedInput.patch.short_text_summary !== undefined
            ? normalizedInput.patch.short_text_summary
            : current.short_text_summary,
        visibility_action_summary:
          normalizedInput.patch.visibility_action_summary !== undefined
            ? normalizedInput.patch.visibility_action_summary
            : current.visibility_action_summary,
        is_enabled:
          normalizedInput.patch.is_enabled !== undefined
            ? Boolean(normalizedInput.patch.is_enabled)
            : Boolean(current.is_enabled),
      };
      const currentComparable = buildCreateSignature({
        content_reference: current.content_reference,
        content_group: current.content_group,
        content_type: current.content_type,
        title_summary: current.title_summary,
        short_text_summary: current.short_text_summary,
        visibility_action_summary: current.visibility_action_summary || null,
        is_enabled: Boolean(current.is_enabled),
      });
      const nextComparable = buildCreateSignature(nextPayload);
      if (areManagedItemsEquivalent(currentComparable, nextComparable)) {
        return current;
      }

      this.managedContentItems.updateById(current.telegram_managed_content_item_id, {
        is_latest_version: 0,
        updated_at: this.nowIso(),
      });
      const nowIso = this.nowIso();
      return this.managedContentItems.create({
        ...nextPayload,
        is_enabled: nextPayload.is_enabled ? 1 : 0,
        content_version: Number(current.content_version) + 1,
        is_latest_version: 1,
        versioned_from_item_id: current.telegram_managed_content_item_id,
        created_at: nowIso,
        updated_at: nowIso,
      });
    };

    const updated =
      typeof this.db?.transaction === 'function'
        ? this.db.transaction(runUpdate)()
        : runUpdate();
    return this.buildMutationResult(updated, 'updated_version_safe');
  }

  setContentItemEnabledState(input = {}, enabledValue = undefined) {
    const normalized = normalizeEnableDisableInput(input, enabledValue);
    return this.updateContentItemVersionSafe({
      content_reference: normalized.content_reference,
      expected_version: normalized.expected_version,
      is_enabled: normalized.enabled,
    });
  }

  enableContentItem(input = {}) {
    return this.setContentItemEnabledState(input, true);
  }

  disableContentItem(input = {}) {
    return this.setContentItemEnabledState(input, false);
  }

  readUsefulContentFeedForTelegramGuest(input = {}) {
    this.ensureBaselineContentSeeded();
    const nowIso = this.nowIso();
    const telegramUserSummary = this.resolveOptionalTelegramUserSummary(input);
    const groupings = normalizeLegacyGroupings(
      input.content_grouping ??
        input.contentGrouping ??
        input.grouping ??
        input.groupings ??
        null,
      TELEGRAM_USEFUL_CONTENT_GROUPINGS,
      'useful content'
    );
    const rows = this.listLatestManagedItemsByGroups(groupings).filter(
      (item) =>
        item.content_type === 'useful_content_item' &&
        Number(item.is_enabled) === 1
    );
    const items = rows
      .map((item) => buildLegacyProjectedItem(item, 'content_reference'))
      .sort(sortByReference);

    return freezeTelegramUsefulContentValue({
      response_version: TELEGRAM_USEFUL_CONTENT_FEED_VERSION,
      read_only: true,
      projection_only: true,
      projected_by: LEGACY_SERVICE_NAME,
      list_scope: 'telegram_guest_useful_content_feed',
      telegram_user_summary: telegramUserSummary,
      content_grouping_summary: groupings,
      item_count: items.length,
      items,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        ...items.map((item) => item.latest_timestamp_summary?.iso)
      ),
    });
  }

  readFaqListForTelegramGuest(input = {}) {
    this.ensureBaselineContentSeeded();
    const nowIso = this.nowIso();
    const telegramUserSummary = this.resolveOptionalTelegramUserSummary(input);
    const groupings = normalizeLegacyGroupings(
      input.content_grouping ??
        input.contentGrouping ??
        input.grouping ??
        input.groupings ??
        null,
      TELEGRAM_FAQ_GROUPINGS,
      'faq'
    );
    const rows = this.listLatestManagedItemsByGroups(groupings).filter(
      (item) => item.content_type === 'faq_item' && Number(item.is_enabled) === 1
    );
    const items = rows
      .map((item) =>
        buildLegacyProjectedItem(
          { ...item, faq_reference: item.content_reference },
          'faq_reference'
        )
      )
      .sort(sortByReference);

    return freezeTelegramUsefulContentValue({
      response_version: TELEGRAM_USEFUL_CONTENT_FAQ_LIST_VERSION,
      read_only: true,
      projection_only: true,
      projected_by: LEGACY_SERVICE_NAME,
      list_scope: 'telegram_guest_faq_list',
      telegram_user_summary: telegramUserSummary,
      content_grouping_summary: groupings,
      item_count: items.length,
      items,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        ...items.map((item) => item.latest_timestamp_summary?.iso)
      ),
    });
  }

  readFaqItemByReference(input = {}) {
    this.ensureBaselineContentSeeded();
    const nowIso = this.nowIso();
    const faqReference = normalizeFaqItemReference(input);
    const telegramUserSummary = this.resolveOptionalTelegramUserSummary(input);
    let item = null;
    try {
      item = this.resolveLatestManagedItemByReference(faqReference);
    } catch {
      rejectUsefulContent(`Invalid faq reference: ${faqReference}`);
    }
    if (item.content_type !== 'faq_item') {
      rejectUsefulContent(`Invalid faq reference: ${faqReference}`);
    }

    const projectedItem = buildLegacyProjectedItem(
      { ...item, faq_reference: item.content_reference },
      'faq_reference'
    );

    return freezeTelegramUsefulContentValue({
      response_version: TELEGRAM_USEFUL_CONTENT_FAQ_ITEM_VERSION,
      read_only: true,
      projection_only: true,
      projected_by: LEGACY_SERVICE_NAME,
      telegram_user_summary: telegramUserSummary,
      faq_item: projectedItem,
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        projectedItem.latest_timestamp_summary?.iso
      ),
    });
  }

  readWeatherUsefulContentModelForTelegramGuest(input = {}) {
    this.ensureBaselineContentSeeded();
    const nowIso = this.nowIso();
    const reminderType = normalizeReminderTypeInput(input);
    const telegramUserSummary = this.resolveOptionalTelegramUserSummary(input);
    const bookingRequestReference = normalizeBookingRequestReferenceInput(input);
    const weatherContext = this.resolveBookingRequestForWeatherContext({
      nowIso,
      telegramUserSummary,
      bookingRequestReference,
    });
    const weatherSnapshot = this.resolveWeatherSnapshotForContext(input, {
      ...weatherContext,
      telegram_user_summary: telegramUserSummary,
    });
    const usefulFeed = this.readUsefulContentFeedForTelegramGuest(input);
    const usefulItems = freezeTelegramUsefulContentValue(
      [...(usefulFeed.items || [])]
        .filter((item) =>
          RESORT_CARD_REFERENCE_SET.has(normalizeString(item?.content_reference))
        )
        .sort((left, right) => {
          const leftReference = normalizeString(left?.content_reference);
          const rightReference = normalizeString(right?.content_reference);
          const leftOrder = RESORT_CARD_REFERENCE_ORDER.get(leftReference);
          const rightOrder = RESORT_CARD_REFERENCE_ORDER.get(rightReference);
          if (Number.isInteger(leftOrder) && Number.isInteger(rightOrder)) {
            return leftOrder - rightOrder;
          }
          if (Number.isInteger(leftOrder)) {
            return -1;
          }
          if (Number.isInteger(rightOrder)) {
            return 1;
          }
          return sortByReference(left, right);
        })
        .slice(0, TELEGRAM_USEFUL_RESORT_CARD_REFERENCES.length)
    );
    const caringSummary = this.buildWeatherCaringContentSummary({
      weatherSnapshot,
      reminderType,
      fallbackTitle: DEFAULT_USEFUL_ENTRYPOINT_TITLE,
      fallbackBody: DEFAULT_USEFUL_ENTRYPOINT_BODY,
    });

    return freezeTelegramUsefulContentValue({
      response_version: TELEGRAM_WEATHER_USEFUL_CONTENT_READ_MODEL_VERSION,
      read_only: true,
      projection_only: true,
      projected_by: WEATHER_USEFUL_CONTENT_SERVICE_NAME,
      telegram_user_summary: telegramUserSummary,
      reminder_type: reminderType,
      trip_context_summary: weatherContext,
      weather_summary: weatherSnapshot,
      weather_caring_content_summary: caringSummary,
      useful_content_feed_summary: freezeTelegramUsefulContentValue({
        response_version: usefulFeed.response_version,
        list_scope: usefulFeed.list_scope,
        content_grouping_summary: usefulFeed.content_grouping_summary,
        item_count: usefulItems.length,
        items: usefulItems,
      }),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        usefulFeed.latest_timestamp_summary?.iso,
        weatherContext.trip_start_iso,
        weatherSnapshot.observed_at
      ),
    });
  }

  readFeedForTelegramGuest(input = {}) {
    return this.readUsefulContentFeedForTelegramGuest(input);
  }

  readFaqForTelegramGuest(input = {}) {
    return this.readFaqListForTelegramGuest(input);
  }

  readFaqByReference(input = {}) {
    return this.readFaqItemByReference(input);
  }

  readWeatherUsefulContentModel(input = {}) {
    return this.readWeatherUsefulContentModelForTelegramGuest(input);
  }
}



