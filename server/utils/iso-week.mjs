const BUSINESS_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_WEEK_ID_RE = /^(\d{4})-W(\d{2})$/;

export function formatYmdLocal(dateInput) {
  const date = dateInput instanceof Date ? new Date(dateInput.getTime()) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('formatYmdLocal expects a valid Date instance');
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseBusinessDayLocal(value) {
  const raw = String(value || '').trim();
  const match = raw.match(BUSINESS_DAY_RE);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function getIsoWeek1MondayLocal(isoYear) {
  const jan4 = new Date(Number(isoYear), 0, 4);
  jan4.setHours(0, 0, 0, 0);
  const jan4Dow = jan4.getDay() === 0 ? 7 : jan4.getDay();
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - (jan4Dow - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function getIsoWeekPartsLocal(dateInput) {
  const date = dateInput instanceof Date
    ? new Date(dateInput.getTime())
    : parseBusinessDayLocal(dateInput);

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  const dow = date.getDay() === 0 ? 7 : date.getDay();
  const thursday = new Date(date);
  thursday.setDate(date.getDate() + (4 - dow));
  thursday.setHours(0, 0, 0, 0);

  const isoYear = thursday.getFullYear();
  const week1Monday = getIsoWeek1MondayLocal(isoYear);
  const diffMs = thursday.getTime() - week1Monday.getTime();
  const week = 1 + Math.floor(diffMs / (7 * 86400000));
  return { year: isoYear, week };
}

export function getIsoWeeksInYearLocal(isoYear) {
  const dec28 = new Date(Number(isoYear), 11, 28);
  dec28.setHours(0, 0, 0, 0);
  return getIsoWeekPartsLocal(dec28)?.week || 52;
}

export function getIsoWeekIdForBusinessDay(businessDay) {
  const parts = getIsoWeekPartsLocal(businessDay);
  if (!parts) return null;
  return `${parts.year}-W${String(parts.week).padStart(2, '0')}`;
}

export function parseIsoWeekId(weekIdRaw) {
  const weekId = String(weekIdRaw || '').trim();
  const match = weekId.match(ISO_WEEK_ID_RE);
  if (!match) return null;

  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week)) return null;
  if (week < 1 || week > 53) return null;

  const maxWeeks = getIsoWeeksInYearLocal(year);
  if (week > maxWeeks) return null;

  return {
    year,
    week,
    week_id: `${year}-W${String(week).padStart(2, '0')}`,
  };
}

export function getIsoWeekRangeLocal(weekIdRaw) {
  const parsed = parseIsoWeekId(weekIdRaw);
  if (!parsed) return null;

  const week1Monday = getIsoWeek1MondayLocal(parsed.year);
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (parsed.week - 1) * 7);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(0, 0, 0, 0);

  return {
    week_id: parsed.week_id,
    dateFrom: formatYmdLocal(monday),
    dateTo: formatYmdLocal(sunday),
  };
}

export function getNextIsoWeekId(weekIdRaw) {
  const range = getIsoWeekRangeLocal(weekIdRaw);
  if (!range) return null;

  const monday = parseBusinessDayLocal(range.dateFrom);
  if (!monday) return null;

  monday.setDate(monday.getDate() + 7);
  monday.setHours(0, 0, 0, 0);
  return getIsoWeekIdForBusinessDay(formatYmdLocal(monday));
}

export default {
  formatYmdLocal,
  getIsoWeek1MondayLocal,
  getIsoWeekIdForBusinessDay,
  getIsoWeekPartsLocal,
  getIsoWeekRangeLocal,
  getIsoWeeksInYearLocal,
  getNextIsoWeekId,
  parseBusinessDayLocal,
  parseIsoWeekId,
};
