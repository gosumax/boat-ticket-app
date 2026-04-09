import { getTodayDate, getTomorrowDate, normalizeDate } from './dateUtils';

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatLocalYmd(date, timeZone = null) {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));

    if (byType.year && byType.month && byType.day) {
      return `${byType.year}-${byType.month}-${byType.day}`;
    }
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = String(value).trim();
  if (!text) return null;

  const localDateTimeMatch = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (localDateTimeMatch) {
    const [
      ,
      yearText,
      monthText,
      dayText,
      hourText = '00',
      minuteText = '00',
      secondText = '00',
    ] = localDateTimeMatch;
    const hasTime = localDateTimeMatch[4] !== undefined;

    if (hasTime) {
      // SQLite CURRENT_TIMESTAMP stores UTC without an explicit offset.
      // Seller UI must normalize those bare SQL timestamps to local time before display.
      const parsedUtc = new Date(
        Date.UTC(
          Number(yearText),
          Number(monthText) - 1,
          Number(dayText),
          Number(hourText),
          Number(minuteText),
          Number(secondText),
        ),
      );

      if (
        parsedUtc.getUTCFullYear() === Number(yearText) &&
        parsedUtc.getUTCMonth() === Number(monthText) - 1 &&
        parsedUtc.getUTCDate() === Number(dayText) &&
        parsedUtc.getUTCHours() === Number(hourText) &&
        parsedUtc.getUTCMinutes() === Number(minuteText) &&
        parsedUtc.getUTCSeconds() === Number(secondText)
      ) {
        return parsedUtc;
      }

      return null;
    }

    const parsedLocalDate = new Date(
      Number(yearText),
      Number(monthText) - 1,
      Number(dayText),
      0,
      0,
      0,
    );

    if (
      parsedLocalDate.getFullYear() === Number(yearText) &&
      parsedLocalDate.getMonth() === Number(monthText) - 1 &&
      parsedLocalDate.getDate() === Number(dayText)
    ) {
      return parsedLocalDate;
    }

    return null;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function withOptionalTimeZone(baseOptions, timeZone = null) {
  return timeZone ? { ...baseOptions, timeZone } : baseOptions;
}

export function formatSaleCreatedTime(dateValue, { timeZone = null } = {}) {
  const parsed = parseDateTime(dateValue);
  if (!parsed) return 'Нет времени';
  return parsed.toLocaleTimeString('ru-RU', withOptionalTimeZone({
    hour: '2-digit',
    minute: '2-digit',
  }, timeZone));
}

export function formatSaleCreatedAt(dateValue, { timeZone = null } = {}) {
  const parsed = parseDateTime(dateValue);
  if (!parsed) return 'Время оформления не указано';
  return parsed.toLocaleString('ru-RU', withOptionalTimeZone({
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }, timeZone));
}

function parseTicketsJson(ticketsJson) {
  if (!ticketsJson) return {};

  try {
    const parsed = JSON.parse(ticketsJson);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function getTicketBreakdown(sale) {
  const breakdown = parseTicketsJson(sale?.tickets_json ?? sale?.ticketsJson);
  return {
    adult: Math.max(0, toNumber(breakdown.adult)),
    teen: Math.max(0, toNumber(breakdown.teen)),
    child: Math.max(0, toNumber(breakdown.child)),
  };
}

function formatTicketBreakdownLabel(breakdown) {
  if (!breakdown) return null;

  const parts = [];
  if (breakdown.adult > 0) parts.push(`${breakdown.adult} взр.`);
  if (breakdown.teen > 0) parts.push(`${breakdown.teen} подр.`);
  if (breakdown.child > 0) parts.push(`${breakdown.child} дет.`);

  return parts.length > 0 ? parts.join(' • ') : null;
}

export function getSeatCountFromSale(sale) {
  const directCount = toNumber(sale?.number_of_seats ?? sale?.numberOfSeats ?? sale?.seats);
  if (directCount > 0) return directCount;

  const breakdown = getTicketBreakdown(sale);
  const breakdownCount =
    toNumber(breakdown.adult) +
    toNumber(breakdown.teen) +
    toNumber(breakdown.child);

  return breakdownCount > 0 ? breakdownCount : 0;
}

export function getPaymentStatusViewModel(sale) {
  const status = String(sale?.status || '').trim().toUpperCase();
  const total = Math.max(0, toNumber(sale?.total_price ?? sale?.totalPrice));
  const paid = Math.max(0, toNumber(sale?.prepayment_amount ?? sale?.prepaymentAmount));

  if (status === 'REFUNDED') {
    return { kind: 'refunded', label: 'Возврат' };
  }
  if (status === 'CANCELLED_TRIP_PENDING') {
    return { kind: 'cancelled_trip_pending', label: 'Рейс отменён' };
  }
  if (status === 'CANCELLED') {
    return { kind: 'cancelled', label: 'Отменена' };
  }
  if (total > 0 && paid >= total) {
    return { kind: 'fully_paid', label: 'Оплачено полностью' };
  }
  if (paid > 0) {
    return { kind: 'prepayment', label: 'Предоплата' };
  }
  if (status === 'PARTIALLY_PAID') {
    return { kind: 'prepayment', label: 'Предоплата' };
  }
  return { kind: 'unpaid', label: 'Без оплаты' };
}

function getProductLabel(sale) {
  const type = String(sale?.boat_type || '').trim().toLowerCase();
  const boatName = String(sale?.boat_name || '').trim();

  if (type === 'banana') return boatName ? `Банан • ${boatName}` : 'Банан';
  if (type === 'fishing') return boatName ? `Рыбалка • ${boatName}` : 'Рыбалка';
  if (type === 'cruise') return boatName ? `Прогулка • ${boatName}` : 'Прогулка';
  if (type === 'speed') return boatName ? `Скоростной катер • ${boatName}` : 'Скоростной катер';
  return boatName || 'Продажа';
}

function getBoatTypeLabel(sale) {
  const type = String(sale?.boat_type || '').trim().toLowerCase();

  if (type === 'banana') return 'Банан';
  if (type === 'fishing') return 'Рыбалка';
  if (type === 'cruise') return 'Прогулка';
  if (type === 'speed') return 'Скоростной катер';
  return 'Продажа';
}

function isAttentionSale(row) {
  return (
    row.paymentStatus.kind === 'cancelled' ||
    row.paymentStatus.kind === 'cancelled_trip_pending' ||
    row.paymentStatus.kind === 'refunded' ||
    row.remainingAmount > 0
  );
}

function getSalesCategoryKey(row, today) {
  if (isAttentionSale(row)) return 'attention';
  if (row.tripDay === today) return 'today';
  if (row.tripDay && row.tripDay > today) return 'futureTrips';
  return 'other';
}

function buildSaleRow(sale, { timeZone = null } = {}) {
  const createdAt = sale?.created_at ?? sale?.createdAt ?? sale?.timestamp ?? null;
  const parsedCreatedAt = parseDateTime(createdAt);
  const tripDay = normalizeDate(sale?.slot_trip_date ?? sale?.slotTripDate ?? sale?.business_day ?? sale?.businessDay);
  const createdDay = parsedCreatedAt ? formatLocalYmd(parsedCreatedAt, timeZone) : normalizeDate(createdAt);
  const paymentStatus = getPaymentStatusViewModel(sale);
  const ticketBreakdown = getTicketBreakdown(sale);
  const amount = Math.max(0, toNumber(sale?.total_price ?? sale?.totalPrice));
  const paidAmount = Math.max(0, toNumber(sale?.prepayment_amount ?? sale?.prepaymentAmount));

  return {
    id: sale?.id ?? sale?.presale_id ?? sale?.presaleId ?? `${createdAt || 'sale'}-${sale?.slot_uid || sale?.boat_slot_id || 'slot'}`,
    createdAt,
    createdDay,
    createdTimeLabel: formatSaleCreatedTime(parsedCreatedAt, { timeZone }),
    createdAtLabel: formatSaleCreatedAt(parsedCreatedAt, { timeZone }),
    tripDay,
    tripTimeLabel: String(sale?.slot_time || sale?.slotTime || '').trim() || 'Нет времени',
    tripDateTimeLabel: tripDay
      ? `${tripDay}${String(sale?.slot_time || sale?.slotTime || '').trim() ? `, ${String(sale?.slot_time || sale?.slotTime).trim()}` : ''}`
      : 'Дата рейса не указана',
    amount,
    paidAmount,
    remainingAmount: Math.max(0, amount - paidAmount),
    seats: getSeatCountFromSale(sale),
    productLabel: getProductLabel(sale),
    productTypeLabel: getBoatTypeLabel(sale),
    boatName: String(sale?.boat_name || '').trim(),
    customerName: String(sale?.customer_name ?? sale?.customerName ?? '').trim(),
    customerPhone: String(sale?.customer_phone ?? sale?.customerPhone ?? '').trim(),
    ticketBreakdown,
    ticketBreakdownLabel: formatTicketBreakdownLabel(ticketBreakdown),
    hasTicketBreakdown: Boolean(ticketBreakdown.adult || ticketBreakdown.teen || ticketBreakdown.child),
    status: String(sale?.status || '').trim(),
    paymentStatus,
    raw: sale,
  };
}

function sumBy(rows, selector) {
  return (rows || []).reduce((sum, row) => sum + toNumber(selector(row)), 0);
}

function toNullableNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildBackendSellerMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') {
    return null;
  }

  const weekMetric = metrics?.week?.available
    ? {
        place: toNullableNumber(metrics.week.place),
        points: toNullableNumber(metrics.week.points),
        revenue: toNullableNumber(metrics.week.revenue),
        totalSellers: toNumber(metrics.week.total_sellers),
        label: String(metrics.week.week_id || '').trim() || null,
        dateFrom: normalizeDate(metrics.week.date_from),
        dateTo: normalizeDate(metrics.week.date_to),
        currentPayout: toNumber(metrics.week.current_payout),
        prizePlace: toNullableNumber(metrics.week.prize_place),
        participating: Boolean(metrics.week.participating),
        prizes: Array.isArray(metrics.week.prizes)
          ? metrics.week.prizes.map((prize) => ({
              place: toNumber(prize?.place),
              amount: toNumber(prize?.amount),
            }))
          : [],
        source: metrics.week.source || null,
      }
    : null;

  const seasonMetric = metrics?.season?.available
    ? {
        place: toNullableNumber(metrics.season.place),
        points: toNullableNumber(metrics.season.points),
        revenue: toNullableNumber(metrics.season.revenue),
        totalSellers: toNumber(metrics.season.total_sellers),
        label: String(metrics.season.season_id || '').trim() || null,
        dateFrom: normalizeDate(metrics.season.season_from),
        dateTo: normalizeDate(metrics.season.season_to),
        currentPayout: toNumber(metrics.season.current_payout),
        seasonShare: toNullableNumber(metrics.season.season_share),
        payoutRecipient: Boolean(metrics.season.season_payout_recipient),
        payoutScheme: String(metrics.season.payout_scheme || '').trim() || null,
        payoutMode: String(metrics.season.payout_mode || '').trim() || null,
        fundTotal: toNumber(metrics.season.fund_total),
        eligibleCount: toNumber(metrics.season.eligible_count),
        recipientCount: toNumber(metrics.season.recipient_count),
        participating: Boolean(metrics.season.participating),
        isEligible: Boolean(metrics.season.is_eligible),
        workedDaysSeason: toNumber(metrics.season.worked_days_season),
        workedDaysRequired: toNumber(metrics.season.worked_days_required),
        remainingDaysSeason: toNumber(metrics.season.remaining_days_season),
        workedDaysSep: toNumber(metrics.season.worked_days_sep),
        workedDaysSepRequired: toNumber(metrics.season.worked_days_sep_required),
        remainingDaysSep: toNumber(metrics.season.remaining_days_sep),
        workedDaysEndSep: toNumber(metrics.season.worked_days_end_sep),
        workedDaysEndSepRequired: toNumber(metrics.season.worked_days_end_sep_required),
        remainingDaysEndSep: toNumber(metrics.season.remaining_days_end_sep),
        source: metrics.season.source || null,
      }
    : null;

  const streakMetric = metrics?.streak
    ? {
        available: Boolean(metrics.streak.available),
        calibrated: Boolean(metrics.streak.calibrated),
        calibrationWorkedDays: toNumber(metrics.streak.calibration_worked_days),
        currentSeries: toNumber(metrics.streak.current_series),
        currentLevel: String(metrics.streak.current_level || '').trim() || null,
        multiplier: toNullableNumber(metrics.streak.multiplier),
        threshold: toNullableNumber(metrics.streak.threshold),
        todayRevenue: toNumber(metrics.streak.today_revenue),
        todayCompleted:
          typeof metrics.streak.today_completed === 'boolean'
            ? metrics.streak.today_completed
            : null,
        rewardLabel: Number.isFinite(Number(metrics.streak.multiplier))
          ? `x${Number(metrics.streak.multiplier).toFixed(2)}`
          : null,
        source: metrics.streak.source || null,
      }
    : null;

  const earningsAvailable = Boolean(metrics?.earnings?.available);
  const prepaymentsTodayAvailable = Boolean(metrics?.prepayments_today?.available);
  const prepaymentsTodayCash = prepaymentsTodayAvailable ? toNumber(metrics?.prepayments_today?.cash) : 0;
  const prepaymentsTodayCard = prepaymentsTodayAvailable ? toNumber(metrics?.prepayments_today?.card) : 0;

  return {
    today: normalizeDate(metrics?.dates?.today) || null,
    tomorrow: normalizeDate(metrics?.dates?.tomorrow) || null,
    earnings: {
      available: earningsAvailable,
      value: earningsAvailable ? toNumber(metrics?.earnings?.value) : null,
      statusLabel: earningsAvailable
        ? 'Начисление за сегодня обновлено.'
        : 'Начисление появится после обновления данных.',
      source: metrics?.earnings?.source || null,
    },
    prepaymentsToday: {
      available: prepaymentsTodayAvailable,
      cash: prepaymentsTodayCash,
      card: prepaymentsTodayCard,
      total: prepaymentsTodayAvailable
        ? toNumber(metrics?.prepayments_today?.total ?? (prepaymentsTodayCash + prepaymentsTodayCard))
        : 0,
      source: metrics?.prepayments_today?.source || null,
    },
    pointsToday: toNullableNumber(metrics?.points?.today),
    streak: streakMetric,
    rating: {
      available: Boolean(weekMetric || seasonMetric),
      currentSellerWeek: weekMetric,
      currentSellerSeason: seasonMetric,
    },
  };
}

export function buildSellerDashboardModel(sales, today = getTodayDate(), metrics = null, options = {}) {
  const backendMetrics = buildBackendSellerMetrics(metrics);
  const resolvedToday = backendMetrics?.today || today || getTodayDate();
  const resolvedTomorrow = backendMetrics?.tomorrow || getTomorrowDate();
  const base = buildSellerDashboardLegacy(sales, resolvedToday, options);
  const todayTripSales = base.sales.filter((row) => row.tripDay === resolvedToday);
  const tomorrowTripSales = base.sales.filter((row) => row.tripDay === resolvedTomorrow);

  return {
    ...base,
    today: resolvedToday,
    tomorrow: resolvedTomorrow,
    earnings: backendMetrics?.earnings || {
      ...base.earnings,
      fallbackSalesAmount: sumBy(todayTripSales, (row) => row.amount),
      fallbackSalesCount: todayTripSales.length,
    },
    summary: {
      ...base.summary,
      todayTripAmount: sumBy(todayTripSales, (row) => row.amount),
      tomorrowTripAmount: sumBy(tomorrowTripSales, (row) => row.amount),
      pointsToday: backendMetrics?.pointsToday ?? null,
      prepaymentsToday: backendMetrics?.prepaymentsToday || {
        available: false,
        cash: 0,
        card: 0,
        total: 0,
        source: null,
      },
      todayTripSalesCountToday: todayTripSales.length,
      tomorrowTripSalesCount: tomorrowTripSales.length,
    },
    tabs: {
      ...base.tabs,
      futureTrips: base.sales.filter((row) => row.tripDay && row.tripDay > resolvedToday),
    },
    streak: backendMetrics?.streak || {
      ...base.streak,
      calibrated: false,
      calibrationWorkedDays: 0,
      currentLevel: null,
      multiplier: null,
      threshold: null,
      todayRevenue: null,
      source: null,
      message: 'Данные о серии пока недоступны.',
    },
    rating: backendMetrics?.rating?.available
      ? {
          ...base.rating,
          available: true,
          currentSellerWeek: backendMetrics.rating.currentSellerWeek,
          currentSellerSeason: backendMetrics.rating.currentSellerSeason,
          message: null,
        }
      : {
          ...base.rating,
          message: 'Данные о рейтинге пока недоступны.',
        },
  };
}

export function filterSellerSalesByPreset(
  sales,
  {
    preset = 'today',
    selectedDate = null,
    today = getTodayDate(),
    tomorrow = getTomorrowDate(),
  } = {},
) {
  const rows = Array.isArray(sales) ? sales : [];

  if (preset === 'all') {
    return rows;
  }

  const targetDate = preset === 'tomorrow'
    ? tomorrow
    : preset === 'date'
      ? normalizeDate(selectedDate)
      : today;

  if (!targetDate) {
    return [];
  }

  return rows.filter((row) => row.tripDay === targetDate);
}

function buildSellerDashboardLegacy(sales, today = getTodayDate(), options = {}) {
  const rows = (Array.isArray(sales) ? sales : [])
    .map((sale) => buildSaleRow(sale, options))
    .sort((left, right) => {
      const leftDate = parseDateTime(left.createdAt)?.getTime() ?? 0;
      const rightDate = parseDateTime(right.createdAt)?.getTime() ?? 0;
      return rightDate - leftDate;
    })
    .map((row) => ({
      ...row,
      categoryKey: getSalesCategoryKey(row, today),
    }));

  const todaySales = rows.filter((row) => row.createdDay === today);
  const attentionSales = rows.filter((row) => row.categoryKey === 'attention');
  const todayTripSales = rows.filter((row) => row.categoryKey === 'today');
  const futureTripSales = rows.filter((row) => row.categoryKey === 'futureTrips');
  const otherSales = rows.filter((row) => row.categoryKey === 'other');
  const salesAmountToday = sumBy(todaySales, (row) => row.amount);
  const salesGroups = [
    {
      key: 'attention',
      title: 'Требуют внимания',
      caption: 'Доплата, отмена, возврат или нестандартный статус',
      rows: attentionSales,
    },
    {
      key: 'today',
      title: 'Рейсы сегодня',
      caption: 'Активные продажи с отправлением сегодня',
      rows: todayTripSales,
    },
    {
      key: 'futureTrips',
      title: 'Будущие рейсы',
      caption: 'Активные продажи на следующие даты',
      rows: futureTripSales,
    },
    {
      key: 'other',
      title: 'Остальное',
      caption: 'Продажи без даты рейса или с прошедшей датой',
      rows: otherSales,
    },
  ];

  return {
    today,
    sales: rows,
    salesGroups,
    earnings: {
      available: false,
      value: null,
      statusLabel: 'Начисление появится после обновления данных.',
      fallbackSalesAmount: salesAmountToday,
      fallbackSalesCount: todaySales.length,
    },
    summary: {
      amountToday: salesAmountToday,
      pointsToday: null,
      salesCountToday: todaySales.length,
      seatsCountToday: sumBy(todaySales, (row) => row.seats),
      fullyPaidCountToday: todaySales.filter((row) => row.paymentStatus.kind === 'fully_paid').length,
      prepaymentCountToday: todaySales.filter((row) => row.paymentStatus.kind === 'prepayment').length,
      todayTripSalesCountToday: todaySales.filter((row) => row.tripDay === today).length,
      futureTripSalesCountToday: todaySales.filter((row) => row.tripDay && row.tripDay > today).length,
      totalSalesCount: rows.length,
    },
    tabs: {
      all: rows,
      attention: attentionSales,
      today: todaySales,
      futureTrips: futureTripSales,
    },
    streak: {
      available: false,
      currentSeries: null,
      todayCompleted: null,
      remainingToCompleteToday: null,
      rewardLabel: null,
      message: 'Данные о серии пока недоступны.',
    },
    rating: {
      available: false,
      tabs: {
        week: [],
        season: [],
      },
      currentSellerWeek: null,
      currentSellerSeason: null,
      message: 'Данные о рейтинге пока недоступны.',
    },
  };
}
