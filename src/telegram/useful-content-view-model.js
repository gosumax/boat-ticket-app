function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeFeedItems(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      contentReference: normalizeString(item?.content_reference),
      title: normalizeString(item?.title_short_text_summary?.title) || 'Полезная подсказка',
      shortText: normalizeString(item?.title_short_text_summary?.short_text) || '',
      contentGrouping:
        normalizeString(item?.content_type_summary?.content_grouping) || 'useful_content',
    }))
    .filter((item) => item.contentReference);
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
  const title = normalizeString(resolvedScreen?.title) || 'Полезная информация';
  const body =
    normalizeString(resolvedScreen?.body) ||
    'Подготовка к поездке и подсказки с учётом погоды.';

  return Object.freeze({
    renderState,
    entrypointKey: normalizeString(resolvedScreen?.entrypoint_key) || 'useful_content',
    title,
    body,
    errorMessage: normalizeString(error),
    fallbackUsed: Boolean(resolvedScreen?.fallback_used),
    weatherDataState: normalizeString(weatherSummary?.weather_data_state) || 'unavailable',
    reminderStatusLine: normalizeString(caringSummary?.reminder_status_line),
    tripApplicabilityState:
      normalizeString(readModel?.trip_context_summary?.applicability_state) || 'not_applicable',
    recommendationLines: Array.isArray(caringSummary?.recommendation_lines)
      ? caringSummary.recommendation_lines.filter((line) => normalizeString(line))
      : [],
    feedItems,
    hasUsefulItems: feedItems.length > 0,
  });
}
