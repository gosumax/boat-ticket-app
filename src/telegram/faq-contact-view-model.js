function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeFaqItems(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      faqReference: normalizeString(item?.faq_reference),
      title: normalizeString(item?.title_short_text_summary?.title) || 'Вопрос',
      shortText: normalizeString(item?.title_short_text_summary?.short_text) || '',
      contentGrouping:
        normalizeString(item?.content_type_summary?.content_grouping) || 'faq_general',
    }))
    .filter((item) => item.faqReference);
}

function normalizeSupportItems(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      contentReference: normalizeString(item?.content_reference),
      title: normalizeString(item?.title_short_text_summary?.title) || 'Подсказка поддержки',
      shortText: normalizeString(item?.title_short_text_summary?.short_text) || '',
      contentGrouping:
        normalizeString(item?.content_type_summary?.content_grouping) || 'trip_help',
    }))
    .filter((item) => item.contentReference);
}

export const MINI_APP_FAQ_RENDER_STATES = Object.freeze([
  'idle',
  'loading',
  'error',
  'ready',
]);

export const MINI_APP_CONTACT_RENDER_STATES = Object.freeze([
  'idle',
  'loading',
  'error',
  'ready',
]);

export function resolveMiniAppFaqRenderState({
  loading = false,
  error = null,
  faqScreenContent = null,
} = {}) {
  if (loading) {
    return 'loading';
  }
  if (normalizeString(error)) {
    return 'error';
  }
  if (faqScreenContent) {
    return 'ready';
  }
  return 'idle';
}

export function resolveMiniAppContactRenderState({
  loading = false,
  error = null,
  contactScreenContent = null,
} = {}) {
  if (loading) {
    return 'loading';
  }
  if (normalizeString(error)) {
    return 'error';
  }
  if (contactScreenContent) {
    return 'ready';
  }
  return 'idle';
}

export function buildMiniAppFaqViewModel({
  loading = false,
  error = null,
  faqScreenContent = null,
  fallbackContent = null,
} = {}) {
  const renderState = resolveMiniAppFaqRenderState({
    loading,
    error,
    faqScreenContent,
  });
  const resolvedScreen = faqScreenContent || fallbackContent || null;
  const faqReadModel = resolvedScreen?.faq_read_model || null;
  const faqItems = normalizeFaqItems(faqReadModel?.items);

  return Object.freeze({
    renderState,
    entrypointKey: normalizeString(resolvedScreen?.entrypoint_key) || 'faq',
    title: normalizeString(resolvedScreen?.title) || 'Вопросы и ответы',
    body:
      normalizeString(resolvedScreen?.body) ||
      'Частые вопросы и правила поездки.',
    errorMessage: normalizeString(error),
    fallbackUsed: Boolean(
      resolvedScreen?.fallback_used || resolvedScreen?.fallback_content_used
    ),
    questionCount: Number(faqReadModel?.item_count || faqItems.length || 0),
    faqItems,
    hasFaqItems: faqItems.length > 0,
  });
}

export function buildMiniAppContactViewModel({
  loading = false,
  error = null,
  contactScreenContent = null,
  fallbackContent = null,
} = {}) {
  const renderState = resolveMiniAppContactRenderState({
    loading,
    error,
    contactScreenContent,
  });
  const resolvedScreen = contactScreenContent || fallbackContent || null;
  const contactReadModel = resolvedScreen?.contact_read_model || null;
  const supportItems = normalizeSupportItems(
    contactReadModel?.trip_help_feed_summary?.items
  );
  const contactPhone = normalizeString(contactReadModel?.preferred_contact_phone_e164);

  return Object.freeze({
    renderState,
    entrypointKey: normalizeString(resolvedScreen?.entrypoint_key) || 'contact',
    title: normalizeString(resolvedScreen?.title) || 'Связь',
    body:
      normalizeString(resolvedScreen?.body) ||
      'Здесь собраны контакты и подсказки по поездке.',
    errorMessage: normalizeString(error),
    fallbackUsed: Boolean(
      resolvedScreen?.fallback_used || resolvedScreen?.fallback_content_used
    ),
    applicabilityState:
      normalizeString(contactReadModel?.applicability_state) || 'not_applicable',
    contactPhone,
    contactCallHref: contactPhone ? `tel:${contactPhone}` : null,
    supportActionReference:
      normalizeString(contactReadModel?.support_action_reference) || 'contact_support',
    supportItemCount: Number(
      contactReadModel?.trip_help_feed_summary?.item_count || supportItems.length || 0
    ),
    supportItems,
    hasSupportItems: supportItems.length > 0,
  });
}
