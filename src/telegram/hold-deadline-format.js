export const MINI_APP_BUSINESS_TIME_ZONE = 'Europe/Moscow';
const EXPLICIT_TIME_ZONE_SUFFIX_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const TIMEZONELESS_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

const RUSSIAN_DEADLINE_DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: MINI_APP_BUSINESS_TIME_ZONE,
});
const RUSSIAN_DEADLINE_TIME_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: MINI_APP_BUSINESS_TIME_ZONE,
});

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function normalizeMiniAppHoldExpiresAtIso(isoValue) {
  const normalizedIso = normalizeString(isoValue);
  if (!normalizedIso) {
    return null;
  }

  const parseCandidate =
    TIMEZONELESS_TIMESTAMP_PATTERN.test(normalizedIso) &&
    !EXPLICIT_TIME_ZONE_SUFFIX_PATTERN.test(normalizedIso)
      ? `${normalizedIso.replace(' ', 'T')}Z`
      : normalizedIso;
  const parsedMs = Date.parse(parseCandidate);
  if (Number.isNaN(parsedMs)) {
    return normalizedIso;
  }

  return new Date(parsedMs).toISOString();
}

export function formatMiniAppBusinessHoldDeadlineLabel(isoValue) {
  const normalizedIso = normalizeMiniAppHoldExpiresAtIso(isoValue);
  if (!normalizedIso) {
    return null;
  }

  const parsedDate = new Date(normalizedIso);
  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedIso;
  }

  const dateLabel = RUSSIAN_DEADLINE_DATE_FORMATTER.format(parsedDate);
  const timeLabel = RUSSIAN_DEADLINE_TIME_FORMATTER.format(parsedDate);
  return `${dateLabel}, ${timeLabel}`;
}
