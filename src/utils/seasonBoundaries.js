const MMDD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeMmdd(value) {
  return String(value ?? '').trim();
}

export function isValidMmdd(value) {
  return MMDD_RE.test(normalizeMmdd(value));
}

export function validateSeasonBoundaryPair(startRaw, endRaw) {
  const start = normalizeMmdd(startRaw);
  const end = normalizeMmdd(endRaw);
  const hasInput = !!start || !!end;

  if (hasInput && (!start || !end)) {
    return {
      ok: false,
      error: 'Укажите обе границы сезона в формате MM-DD или оставьте обе пустыми',
      start,
      end,
      hasInput,
    };
  }
  if (start && !isValidMmdd(start)) {
    return {
      ok: false,
      error: 'Неверный формат начала сезона. Используйте MM-DD, например 05-01',
      start,
      end,
      hasInput,
    };
  }
  if (end && !isValidMmdd(end)) {
    return {
      ok: false,
      error: 'Неверный формат конца сезона. Используйте MM-DD, например 10-01',
      start,
      end,
      hasInput,
    };
  }
  if (start && end && start > end) {
    return {
      ok: false,
      error: 'Диапазон сезона должен быть внутри одного года: начало не может быть позже конца (например, 11-01 ... 03-31 недопустимо)',
      start,
      end,
      hasInput,
    };
  }

  return { ok: true, error: '', start, end, hasInput };
}

export function resolveSeasonBoundaries(settings) {
  const start = normalizeMmdd(settings?.season_start_mmdd);
  const end = normalizeMmdd(settings?.season_end_mmdd);
  if (MMDD_RE.test(start) && MMDD_RE.test(end) && start <= end) {
    return { start, end };
  }
  return { start: '01-01', end: '12-31' };
}

export function getSeasonConfigUiState(settings) {
  const boundaries = resolveSeasonBoundaries(settings);
  const isCustom = !(boundaries.start === '01-01' && boundaries.end === '12-31');
  return {
    ...boundaries,
    isCustom,
    statusLabel: isCustom ? 'Используется кастомный сезон' : 'Сезон: весь год',
    badgeLabel: isCustom ? 'Кастомный диапазон' : '',
  };
}

export function getInclusiveYmdDays(dateFrom, dateTo) {
  if (!YMD_RE.test(String(dateFrom || '')) || !YMD_RE.test(String(dateTo || ''))) return null;
  const fromTs = Date.parse(`${dateFrom}T00:00:00Z`);
  const toTs = Date.parse(`${dateTo}T00:00:00Z`);
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) return null;
  if (toTs < fromTs) return null;
  return Math.floor((toTs - fromTs) / 86400000) + 1;
}

export function getSeasonDisplayWarnings({
  seasonFrom,
  seasonTo,
  seasonPoolTotalLedger,
  seasonPoolTotalDailySum,
  totalPoints,
}) {
  const warnings = [];
  const days = getInclusiveYmdDays(seasonFrom, seasonTo);
  if (Number.isFinite(days) && days > 0 && days < 7) {
    warnings.push(`Короткий диапазон сезона: ${days} дн. Проверьте границы MM-DD.`);
  }

  const poolLedger = Number(seasonPoolTotalLedger || 0);
  const poolDaily = Number(seasonPoolTotalDailySum || 0);
  const points = Number(totalPoints || 0);
  if (poolLedger <= 0 && poolDaily <= 0 && points <= 0) {
    warnings.push('В выбранном диапазоне пока нет данных фонда и очков.');
  }

  return warnings;
}
