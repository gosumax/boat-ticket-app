import {
  TELEGRAM_FAQ_ITEMS,
  TELEGRAM_SERVICE_MESSAGE_TEMPLATE_BASELINES,
  TELEGRAM_USEFUL_CONTENT_FEED_ITEMS,
} from '../../shared/telegram/index.js';

export const TELEGRAM_EDITOR_VIEW_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  SAVING: 'saving',
  SAVED: 'saved',
  CONFLICT: 'conflict',
  ERROR: 'error',
});

const TEMPLATE_BASELINE_BY_TYPE = new Map(
  TELEGRAM_SERVICE_MESSAGE_TEMPLATE_BASELINES.map((item) => [item.template_type, item])
);
const CONTENT_BASELINE_BY_REFERENCE = new Map([
  ...TELEGRAM_USEFUL_CONTENT_FEED_ITEMS.map((item) => [
    item.content_reference,
    { title: item.title, short_text: item.short_text },
  ]),
  ...TELEGRAM_FAQ_ITEMS.map((item) => [
    item.faq_reference,
    { title: item.title, short_text: item.short_text },
  ]),
]);

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return Boolean(fallback);
}

function pickTemplateTitle(templateItem) {
  return (
    normalizeString(templateItem?.title_name_summary?.title_name) ||
    normalizeString(templateItem?.title_summary) ||
    null
  );
}

function pickTemplateBody(templateItem) {
  return (
    normalizeString(templateItem?.text_body_summary?.text_body) ||
    normalizeString(templateItem?.short_text_summary?.short_text) ||
    null
  );
}

function pickContentTitle(contentItem) {
  return (
    normalizeString(contentItem?.title_summary?.title) ||
    normalizeString(contentItem?.title_short_text_summary?.title) ||
    null
  );
}

function pickContentBody(contentItem) {
  return (
    normalizeString(contentItem?.short_text_summary?.short_text) ||
    normalizeString(contentItem?.title_short_text_summary?.short_text) ||
    null
  );
}

export function createTelegramTemplateDraft(templateItem = null) {
  return Object.freeze({
    title: pickTemplateTitle(templateItem) || '',
    body: pickTemplateBody(templateItem) || '',
    enabled: parseBoolean(templateItem?.enabled_state_summary?.enabled, true),
  });
}

export function createTelegramManagedContentDraft(contentItem = null) {
  return Object.freeze({
    title: pickContentTitle(contentItem) || '',
    shortText: pickContentBody(contentItem) || '',
    enabled: parseBoolean(contentItem?.visibility_enabled_summary?.enabled, true),
  });
}

function classifyTemplateCategory(templateType) {
  if (templateType === '1_hour_before_trip' || templateType === '30_minutes_before_trip') {
    return 'reminder';
  }
  if (templateType === 'post_trip_thank_you' || templateType === 'post_trip_review_request') {
    return 'post_trip';
  }
  return 'service';
}

function classifyManagedContentCategory(contentGroup) {
  if (contentGroup === 'faq_general' || contentGroup === 'faq_trip_rules') {
    return 'faq';
  }
  return 'useful';
}

export function resolveTemplatePreview(templateItem = null, draft = null) {
  const templateType = normalizeString(templateItem?.template_type);
  const baseline = templateType ? TEMPLATE_BASELINE_BY_TYPE.get(templateType) : null;

  const rawHeadline = normalizeString(draft?.title) || pickTemplateTitle(templateItem);
  const rawBody = normalizeString(draft?.body) || pickTemplateBody(templateItem);
  const headline =
    rawHeadline ||
    normalizeString(baseline?.title_name_summary) ||
    'Template headline preview';
  const body =
    rawBody ||
    normalizeString(baseline?.text_body_summary) ||
    'Template body preview';

  return Object.freeze({
    headline,
    body,
    enabled: parseBoolean(
      draft?.enabled,
      parseBoolean(templateItem?.enabled_state_summary?.enabled, true)
    ),
    fallbackUsed: !rawHeadline || !rawBody,
  });
}

export function resolveManagedContentPreview(contentItem = null, draft = null) {
  const contentReference = normalizeString(contentItem?.content_reference);
  const baseline = contentReference ? CONTENT_BASELINE_BY_REFERENCE.get(contentReference) : null;

  const rawTitle = normalizeString(draft?.title) || pickContentTitle(contentItem);
  const rawBody = normalizeString(draft?.shortText) || pickContentBody(contentItem);
  const title = rawTitle || normalizeString(baseline?.title) || 'Content title preview';
  const shortText = rawBody || normalizeString(baseline?.short_text) || 'Content body preview';

  return Object.freeze({
    title,
    shortText,
    enabled: parseBoolean(
      draft?.enabled,
      parseBoolean(contentItem?.visibility_enabled_summary?.enabled, true)
    ),
    fallbackUsed: !rawTitle || !rawBody,
  });
}

function sortByReference(left, right, key) {
  return String(left?.[key] || '').localeCompare(String(right?.[key] || ''));
}

export function buildTelegramAdminContentModel({
  templateList = null,
  managedContentList = null,
  faqProjection = null,
  usefulProjection = null,
  selectedTemplateReference = null,
  selectedContentReference = null,
  templateDrafts = {},
  contentDrafts = {},
} = {}) {
  const templateItems = toArray(templateList?.items)
    .slice()
    .sort((left, right) => sortByReference(left, right, 'template_reference'))
    .map((item) =>
      Object.freeze({
        ...item,
        template_category: classifyTemplateCategory(item.template_type),
      })
    );
  const managedContentItems = toArray(managedContentList?.items)
    .slice()
    .sort((left, right) => sortByReference(left, right, 'content_reference'))
    .map((item) => {
      const contentGroup = item?.content_type_group_summary?.content_group;
      return Object.freeze({
        ...item,
        content_category: classifyManagedContentCategory(contentGroup),
      });
    });

  const selectedTemplate =
    templateItems.find((item) => item.template_reference === selectedTemplateReference) ||
    templateItems[0] ||
    null;
  const selectedContent =
    managedContentItems.find((item) => item.content_reference === selectedContentReference) ||
    managedContentItems[0] ||
    null;
  const templateDraft = selectedTemplate
    ? templateDrafts[selectedTemplate.template_reference] ||
      createTelegramTemplateDraft(selectedTemplate)
    : createTelegramTemplateDraft(null);
  const contentDraft = selectedContent
    ? contentDrafts[selectedContent.content_reference] ||
      createTelegramManagedContentDraft(selectedContent)
    : createTelegramManagedContentDraft(null);

  return Object.freeze({
    templates: Object.freeze(templateItems),
    managedContentItems: Object.freeze(managedContentItems),
    selectedTemplate,
    selectedContent,
    selectedTemplatePreview: resolveTemplatePreview(selectedTemplate, templateDraft),
    selectedContentPreview: resolveManagedContentPreview(selectedContent, contentDraft),
    projections: Object.freeze({
      faqItemCount: Number(faqProjection?.item_count || 0),
      usefulItemCount: Number(usefulProjection?.item_count || 0),
    }),
  });
}

export function resolveTelegramEditorErrorMessage(error, fallbackMessage) {
  const response = error?.response;
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    if (response.rejection_reason) {
      return String(response.rejection_reason);
    }
    if (response.error) {
      return String(response.error);
    }
    if (response.message) {
      return String(response.message);
    }
  }

  const message = normalizeString(error?.message);
  if (!message) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(message);
    if (parsed?.rejection_reason) {
      return String(parsed.rejection_reason);
    }
  } catch {
    // no-op
  }
  return message;
}

export function classifyTelegramEditorStateByError(errorMessage) {
  const message = normalizeString(errorMessage)?.toLowerCase() || '';
  if (message.includes('version conflict')) {
    return TELEGRAM_EDITOR_VIEW_STATES.CONFLICT;
  }
  return TELEGRAM_EDITOR_VIEW_STATES.ERROR;
}

export function reduceTelegramEditorState(currentState, event = {}) {
  const previous = currentState || TELEGRAM_EDITOR_VIEW_STATES.IDLE;
  switch (event.type) {
    case 'start_load':
      return TELEGRAM_EDITOR_VIEW_STATES.LOADING;
    case 'load_success':
      return TELEGRAM_EDITOR_VIEW_STATES.READY;
    case 'load_error':
      return TELEGRAM_EDITOR_VIEW_STATES.ERROR;
    case 'start_save':
      return TELEGRAM_EDITOR_VIEW_STATES.SAVING;
    case 'save_success':
      return TELEGRAM_EDITOR_VIEW_STATES.SAVED;
    case 'save_error':
      return classifyTelegramEditorStateByError(event.errorMessage);
    case 'reset_feedback':
      return TELEGRAM_EDITOR_VIEW_STATES.READY;
    default:
      return previous;
  }
}
