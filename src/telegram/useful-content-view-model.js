function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeNumber(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return null;
  }
  return Math.round(normalized * 10) / 10;
}

const MINI_APP_GENERIC_LOAD_ERROR_MESSAGE =
  '?? ??????? ????????? ??????. ?????????? ????????.';
const MINI_APP_WEATHER_UNAVAILABLE_MESSAGE = '?????? ???????? ??????????.';

const RESORT_CARD_LAYOUT = Object.freeze([
  Object.freeze({
    contentReference: 'tg_useful_places_003',
    fallbackTitle: '?????? ????? ??? ????',
    fallbackText:
      '??? ???? ?? ?????? ???????? ?????????? ? ????? ? ????? ???? ?????.',
  }),
  Object.freeze({
    contentReference: 'tg_useful_places_004',
    fallbackTitle: '???? ??????? ? ??????',
    fallbackText:
      '? ?????? ?????? ???????? ????????, ??????????? ? ??????????? ???? ? ????.',
  }),
  Object.freeze({
    contentReference: 'tg_useful_places_005',
    fallbackTitle: '???? ??????? ???????',
    fallbackText:
      '??????? ????????? ???????? ?? ?????????? ? ??????? ????? ?? ????????? ??????? ????.',
  }),
]);

function normalizeFeedItems(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      contentReference: normalizeString(item?.content_reference),
      title: normalizeString(item?.title_short_text_summary?.title) || null,
      shortText: normalizeString(item?.title_short_text_summary?.short_text) || null,
    }))
    .filter((item) => item.contentReference);
}

function buildResortCards(feedItems = []) {
  const itemByReference = new Map();
  for (const item of feedItems) {
    if (!itemByReference.has(item.contentReference)) {
      itemByReference.set(item.contentReference, item);
    }
  }

  return RESORT_CARD_LAYOUT.map((cardLayout) => {
    const feedItem = itemByReference.get(cardLayout.contentReference) || null;
    return Object.freeze({
      contentReference: cardLayout.contentReference,
      title: normalizeString(feedItem?.title) || cardLayout.fallbackTitle,
      shortText: normalizeString(feedItem?.shortText) || cardLayout.fallbackText,
    });
  });
}

export const MINI_APP_USEFUL_CONTENT_RENDER_STATES = Object.freeze([
  'idle',
  'loading',
  'error',
  'ready',
]);

export function resolveMiniAppUsefulContentRenderState({
  loading = false,
  error = null,
  usefulScreenContent = null,
} = {}) {
  if (loading) {
    return 'loading';
  }
  if (normalizeString(error)) {
    return 'error';
  }
  if (usefulScreenContent) {
    return 'ready';
  }
  return 'idle';
}

export function buildMiniAppUsefulContentViewModel({
  loading = false,
  error = null,
  usefulScreenContent = null,
  fallbackContent = null,
} = {}) {
  const renderState = resolveMiniAppUsefulContentRenderState({
    loading,
    error,
    usefulScreenContent,
  });
  const resolvedScreen = usefulScreenContent || fallbackContent || null;
  const readModel = resolvedScreen?.useful_content_read_model || null;
  const weatherSummary = readModel?.weather_summary || null;
  const caringSummary = readModel?.weather_caring_content_summary || null;
  const feedItems = normalizeFeedItems(readModel?.useful_content_feed_summary?.items);
  const resortCards = buildResortCards(feedItems);
  const normalizedError = normalizeString(error);
  const title = normalizeString(resolvedScreen?.title) || '???????? ? ??????-????????';
  const body =
    normalizeString(resolvedScreen?.body) ||
    '?????? ? ???????? ???? ??? ?????? ????? ? ?????????? ??????? ????.';

  return Object.freeze({
    renderState,
    entrypointKey: normalizeString(resolvedScreen?.entrypoint_key) || 'useful_content',
    title,
    body,
    errorMessage: normalizedError ? MINI_APP_GENERIC_LOAD_ERROR_MESSAGE : null,
    fallbackUsed: Boolean(resolvedScreen?.fallback_used),
    weatherDataState: normalizeString(weatherSummary?.weather_data_state) || 'unavailable',
    weatherConditionLabel:
      normalizeString(weatherSummary?.condition_label) ||
      (normalizeString(weatherSummary?.weather_data_state) === 'unavailable'
        ? MINI_APP_WEATHER_UNAVAILABLE_MESSAGE
        : null),
    airTemperatureC: normalizeNumber(weatherSummary?.temperature_c),
    waterTemperatureC: normalizeNumber(weatherSummary?.water_temperature_c),
    sunsetTimeIso: normalizeString(weatherSummary?.sunset_time_iso),
    sunsetTimeLocal: normalizeString(weatherSummary?.sunset_time_local),
    weatherObservedAt: normalizeString(weatherSummary?.observed_at),
    reminderStatusLine: normalizeString(caringSummary?.reminder_status_line),
    recommendationLines: Array.isArray(caringSummary?.recommendation_lines)
      ? caringSummary.recommendation_lines.filter((line) => normalizeString(line))
      : [],
    tripApplicabilityState:
      normalizeString(readModel?.trip_context_summary?.applicability_state) || 'not_applicable',
    locationSummary: Object.freeze({
      country: normalizeString(weatherSummary?.location_country) || '?????????? ?????????',
      region: normalizeString(weatherSummary?.location_region) || '????????????? ????',
      locality: normalizeString(weatherSummary?.location_locality) || '??????-????????',
      waterBody: normalizeString(weatherSummary?.location_water_body) || '?????? ????',
    }),
    feedItems: resortCards,
    hasUsefulItems: resortCards.length > 0,
    resortCards,
    hasResortCards: resortCards.length > 0,
  });
}
