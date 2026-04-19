function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export const TELEGRAM_MINI_APP_ENTRYPOINT_KEYS = Object.freeze([
  'catalog',
  'my_tickets',
  'useful_content',
  'faq',
  'contact',
]);

const DEFAULT_ENTRYPOINT_KEY = 'catalog';

const ENTRYPOINT_CONTENT = Object.freeze({
  catalog: Object.freeze({
    title: 'Каталог рейсов',
    body: 'Просматривайте доступные рейсы и открывайте карточку рейса, чтобы продолжить.',
    placeholder: false,
  }),
  my_tickets: Object.freeze({
    title: 'Мои заявки',
    body: 'Откройте список заявок и просматривайте детали билетов.',
    placeholder: false,
  }),
  useful_content: Object.freeze({
    title: 'Полезная информация',
    body: 'Подготовка к поездке и подсказки с учётом погоды.',
    placeholder: false,
  }),
  faq: Object.freeze({
    title: 'Вопросы и ответы',
    body: 'Частые вопросы и актуальные правила поездки.',
    placeholder: false,
  }),
  contact: Object.freeze({
    title: 'Связь',
    body: 'В этом разделе доступны контакты поддержки и полезные подсказки.',
    placeholder: false,
  }),
});

function normalizeEntrypointKey(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  const canonical = normalized.toLowerCase().replace(/[\s-]+/g, '_');
  return TELEGRAM_MINI_APP_ENTRYPOINT_KEYS.includes(canonical) ? canonical : null;
}

export function resolveTelegramMiniAppEntrypointContent(entrypointKey) {
  const normalizedKey = normalizeEntrypointKey(entrypointKey);
  const resolvedKey = normalizedKey || DEFAULT_ENTRYPOINT_KEY;
  const content = ENTRYPOINT_CONTENT[resolvedKey] || ENTRYPOINT_CONTENT[DEFAULT_ENTRYPOINT_KEY];
  return Object.freeze({
    entrypoint_key: resolvedKey,
    fallback_used: !normalizedKey,
    ...content,
  });
}
