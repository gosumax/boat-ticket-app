import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../utils/apiClient';
import { formatRUB } from '../utils/currency';
import { buildSellerDashboardModel, filterSellerSalesByPreset } from '../utils/sellerDashboard';
import {
  SellerHeroPanel,
  SellerScreen,
  SellerTopbar,
  sellerChipClass,
  sellerContentClass,
} from '../components/seller/sellerUi';
import DateFieldPicker from '../components/ui/DateFieldPicker';

const DAY_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
});

const MOTIVATION_NUMBER_FORMATTER = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
});

function formatDayLabel(value) {
  if (!value) return 'сегодня';

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return DAY_FORMATTER.format(parsed);
}

function formatTripDateTime(sale) {
  if (!sale?.tripDay) return 'Дата рейса не указана';
  if (!sale?.tripTimeLabel || sale.tripTimeLabel === 'Нет времени') {
    return formatDayLabel(sale.tripDay);
  }
  return `${formatDayLabel(sale.tripDay)}, ${sale.tripTimeLabel}`;
}

function getSaleTripHeadline(sale, { hideDate = false } = {}) {
  const hasTime = Boolean(sale?.tripTimeLabel && sale.tripTimeLabel !== 'Нет времени');
  const dayLabel = sale?.tripDay ? formatDayLabel(sale.tripDay) : null;

  if (hasTime) {
    return {
      primary: sale.tripTimeLabel,
      secondary: hideDate ? null : dayLabel,
    };
  }

  if (dayLabel) {
    return {
      primary: dayLabel,
      secondary: null,
    };
  }

  return {
    primary: 'Время не указано',
    secondary: null,
  };
}

function formatSeatsLabel(value) {
  const count = Number(value) || 0;
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return `${count} место`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} места`;
  return `${count} мест`;
}

function getPaymentBadgeClasses(kind) {
  switch (kind) {
    case 'fully_paid':
      return 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-500/20';
    case 'prepayment':
      return 'bg-amber-100 text-amber-900 ring-1 ring-amber-200';
    case 'refunded':
    case 'cancelled':
    case 'cancelled_trip_pending':
      return 'bg-rose-100 text-rose-700 ring-1 ring-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
  }
}

function getCategoryAccentClasses(key) {
  switch (key) {
    case 'attention':
      return {
        badge: 'bg-rose-100 text-rose-700',
        dot: 'bg-rose-500',
      };
    case 'today':
      return {
        badge: 'bg-sky-100 text-sky-700',
        dot: 'bg-sky-500',
      };
    case 'futureTrips':
      return {
        badge: 'bg-emerald-100 text-emerald-700',
        dot: 'bg-emerald-500',
      };
    default:
      return {
        badge: 'bg-slate-100 text-slate-700',
        dot: 'bg-slate-400',
      };
  }
}

function CompactState({ title, text, badge }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        {badge ? (
          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
            {badge}
          </span>
        ) : null}

      </div>
      <p className="mt-1.5 text-sm leading-5 text-slate-600">{text}</p>
    </div>
  );
}

function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null;

  return (
    <div className="grid grid-cols-[minmax(0,104px)_1fr] items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <span className="text-right text-sm font-medium leading-5 text-slate-900 break-words">{value}</span>
    </div>
  );
}

function SummaryTile({ label, value, secondary = null, align = 'left', divider = false }) {
  const alignmentClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  return (
    <div className={`min-w-0 ${divider ? 'border-l border-slate-200 pl-3' : ''} ${alignmentClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 sm:text-[11px]">{label}</div>
      <div className="mt-1 text-sm font-semibold leading-5 text-slate-900 break-words">{value}</div>
      {secondary ? <div className="mt-0.5 text-xs leading-4 text-slate-500 break-words sm:leading-5">{secondary}</div> : null}
    </div>
  );
}

function CustomerCompactLine({ sale }) {
  const hasName = Boolean(sale?.customerName);
  const hasPhone = Boolean(sale?.customerPhone);

  if (!hasName && !hasPhone) {
    return <div className="mt-2 text-xs text-slate-400">Клиент не указан</div>;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
      <span className={hasName ? 'text-slate-600' : 'text-slate-400'}>{sale.customerName || 'Без имени'}</span>
      <span className="h-1 w-1 rounded-full bg-slate-300" />
      <span className={hasPhone ? 'text-slate-600' : 'text-slate-400'}>{sale.customerPhone || 'Без телефона'}</span>
    </div>
  );
}

function HeroMetric({ dashboard, loading }) {
  const earnings = dashboard.earnings;
  const hasSalesFallback = Number(earnings.fallbackSalesCount) > 0;
  const value = loading
    ? '...'
    : earnings.available && earnings.value !== null
      ? formatRUB(earnings.value)
      : '—';

  return (
    <section className="rounded-[28px] bg-slate-950 px-4 py-5 text-white shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200">
            Заработано сегодня
          </div>
          <div className="mt-3 text-[40px] font-semibold leading-none tracking-[-0.04em]">{value}</div>
        </div>

        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
          На текущий момент
        </span>
      </div>

      <p className="mt-3 max-w-sm text-sm leading-5 text-slate-300">
        {loading ? 'Загружаем текущие продажи.' : earnings.statusLabel}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {hasSalesFallback ? (
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
            Продаж сегодня: {formatRUB(earnings.fallbackSalesAmount)}
          </span>
        ) : (
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
            Сегодня пока нет оформленных продаж
          </span>
        )}

        {dashboard.summary.pointsToday !== null ? (
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
            Очки сегодня: {dashboard.summary.pointsToday}
          </span>
        ) : null}

      </div>
    </section>
  );
}

function MotivationBlock({ dashboard }) {
  const weekRow = dashboard.rating.currentSellerWeek;
  const seasonRow = dashboard.rating.currentSellerSeason;
  const streak = dashboard.streak;

  const items = [
    {
      key: 'week',
      label: 'Неделя',
      value: weekRow
        ? [weekRow.place ? `${weekRow.place} место` : null, weekRow.points !== null ? `${weekRow.points} очков` : null]
            .filter(Boolean)
            .join(' • ')
        : 'Нет данных',
      hint: weekRow ? null : 'Рейтинг недели пока недоступен',
    },
    {
      key: 'season',
      label: 'Сезон',
      value: seasonRow
        ? [seasonRow.place ? `${seasonRow.place} место` : null, seasonRow.points !== null ? `${seasonRow.points} очков` : null]
            .filter(Boolean)
            .join(' • ')
        : 'Нет данных',
      hint: seasonRow ? null : 'Сезонный рейтинг пока недоступен',
    },
    {
      key: 'streak',
      label: 'Серия',
      value: streak.available ? `${streak.currentSeries ?? 0} дней` : 'Нет данных',
      hint: streak.available
        ? [
            streak.todayCompleted ? 'Условие на сегодня выполнено' : 'Условие на сегодня не выполнено',
            streak.remainingToCompleteToday !== null ? `Осталось: ${streak.remainingToCompleteToday}` : null,
            streak.rewardLabel ? `Бонус: ${streak.rewardLabel}` : null,
          ]
            .filter(Boolean)
            .join(' • ')
        : 'Стрик пока недоступен',
    },
  ];

  const hasAnyData = weekRow || seasonRow || streak.available;

  return (
    <section className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Мотивация</h2>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div key={item.key} className="rounded-2xl bg-slate-50 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-600">{item.label}</span>
              <span className="text-sm font-semibold text-slate-900 text-right">{item.value}</span>
            </div>
            {item.hint ? <div className="mt-1 text-xs leading-5 text-slate-500">{item.hint}</div> : null}
          </div>
        ))}
      </div>

      {!hasAnyData ? <p className="mt-3 text-xs leading-5 text-slate-500">Как только появятся данные, они отобразятся здесь.</p> : null}
    </section>
  );
}

function SaleCard({
  sale,
  expanded,
  onToggle,
  hideTripDate = false,
}) {
  const tripHeadline = getSaleTripHeadline(sale, { hideDate: hideTripDate });

  return (
    <article
      className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm"
      data-testid={`seller-sale-row-${sale.id}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3.5 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold leading-6 text-slate-950">{sale.productLabel}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-2xl bg-sky-50 px-3 py-1.5 text-lg font-semibold leading-none text-sky-950 ring-1 ring-sky-200">
                {tripHeadline.primary}
              </span>
              {tripHeadline.secondary ? (
                <span className="text-sm text-slate-500">{tripHeadline.secondary}</span>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 min-w-[120px] text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Сумма</div>
            <div className="mt-1 text-2xl font-semibold leading-none tracking-[-0.03em] text-slate-950">{formatRUB(sale.amount)}</div>
            <span className={`mt-3 inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${getPaymentBadgeClasses(sale.paymentStatus.kind)}`}>
              {sale.paymentStatus.label}
            </span>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_72px_96px] items-start gap-3 sm:grid-cols-[minmax(0,1fr)_120px_136px]">
            <SummaryTile
              label="Клиент"
              value={sale.customerName || 'Не указано'}
              secondary={sale.customerPhone || 'Телефон не указан'}
            />
            <SummaryTile
              label="Места"
              value={formatSeatsLabel(sale.seats)}
              align="center"
              divider
            />
            <SummaryTile
              label="Оформлено"
              value={sale.createdTimeLabel && sale.createdTimeLabel !== 'Нет времени' ? sale.createdTimeLabel : 'Не указано'}
              secondary={sale.createdDay ? formatDayLabel(sale.createdDay) : null}
              align="right"
              divider
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-end text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          {expanded ? 'Скрыть детали' : 'Показать детали'}
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3.5">
          <div className="rounded-[20px] border border-slate-200 bg-white p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <DetailRow label="Оформлено" value={sale.createdAtLabel} />
              <DetailRow label="Рейс" value={formatTripDateTime(sale)} />
              <DetailRow label="Статус оплаты" value={sale.paymentStatus.label} />
              <DetailRow label="Сумма" value={formatRUB(sale.amount)} />
              <DetailRow label="Оплачено" value={formatRUB(sale.paidAmount)} />
              <DetailRow label="Осталось" value={formatRUB(sale.remainingAmount)} />
              <DetailRow label="Мест" value={formatSeatsLabel(sale.seats)} />
              <DetailRow label="Билеты" value={sale.ticketBreakdownLabel} />
              <DetailRow label="Клиент" value={sale.customerName || 'Не указано'} />
              <DetailRow label="Телефон" value={sale.customerPhone || 'Не указан'} />
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function SalesCategorySection({
  group,
  expandedSales,
  onToggleSale,
  saleTickets,
  ticketsLoading,
  ticketsErrors,
}) {
  const accent = getCategoryAccentClasses(group.key);

  return (
    <section className="space-y-2.5" data-testid={`seller-sales-category-${group.key}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${accent.dot}`} />
            <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">{group.caption}</p>
        </div>

        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${accent.badge}`}>
          {group.rows.length}
        </span>
      </div>

      <div className="space-y-2.5">
        {group.rows.map((sale) => (
          <SaleCard
            key={sale.id}
            sale={sale}
            expanded={Boolean(expandedSales[sale.id])}
            onToggle={() => onToggleSale(sale.id)}
            tickets={saleTickets[sale.id] || []}
            ticketsLoading={Boolean(ticketsLoading[sale.id])}
            ticketsError={ticketsErrors[sale.id] || ''}
          />
        ))}
      </div>
    </section>
  );
}

function SalesBlock({
  loading,
  groups,
  expandedSales,
  onToggleSale,
  saleTickets,
  ticketsLoading,
  ticketsErrors,
}) {
  const visibleGroups = groups.filter((group) => group.rows.length > 0);

  return (
    <section className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Продажи</h2>
          <p className="mt-1 text-sm text-slate-500">Категории по состоянию продажи и дате рейса.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
          {groups.reduce((total, group) => total + group.rows.length, 0)}
        </span>
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-[22px] bg-slate-100" />
            ))}
          </div>
        ) : visibleGroups.length > 0 ? (
          <div className="space-y-4">
            {visibleGroups.map((group) => (
              <SalesCategorySection
                key={group.key}
                group={group}
                expandedSales={expandedSales}
                onToggleSale={onToggleSale}
                saleTickets={saleTickets}
                ticketsLoading={ticketsLoading}
                ticketsErrors={ticketsErrors}
              />
            ))}
          </div>
        ) : (
          <CompactState
            title="Продаж пока нет"
            badge="Пусто"
            text="Как только появятся продажи, они автоматически разложатся по категориям."
          />
        )}
      </div>
    </section>
  );
}

function SalesPresetChip({ active, label, onClick, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={sellerChipClass({ active, tone: active ? 'default' : 'accent' })}
    >
      {label}
    </button>
  );
}

function SellerHeroMetric({ dashboard, loading }) {
  const earnings = dashboard.earnings;
  const value = loading
    ? '...'
    : earnings.available && earnings.value !== null
      ? formatRUB(earnings.value)
      : '—';
  const hasTodayTripSales = Number(dashboard.summary.todayTripSalesCountToday) > 0;
  const prepaymentsToday = dashboard.summary.prepaymentsToday || { cash: 0, card: 0 };
  const prepaymentCash = loading ? '...' : formatRUB(prepaymentsToday.cash);
  const prepaymentCard = loading ? '...' : formatRUB(prepaymentsToday.card);

  return (
    <SellerHeroPanel className="overflow-hidden">
      <div className="rounded-[26px] border border-white/10 bg-white/[0.08] px-4 py-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_24px_46px_-34px_rgba(125,211,252,0.7)]">
        <div className="text-[11px] font-semibold uppercase text-sky-100">
          Заработано сегодня
        </div>
        <div className="mx-auto mt-3 max-w-full break-words bg-[linear-gradient(180deg,#ffe28a_0%,#f4bd32_44%,#b87908_100%)] bg-clip-text text-[48px] font-semibold leading-none text-transparent drop-shadow-[0_0_22px_rgba(244,189,50,0.38)]">
          {value}
        </div>
        <div
          className="mx-auto mt-3 h-px w-24 bg-[linear-gradient(90deg,transparent,rgba(186,230,253,0.74),transparent)]"
          aria-hidden="true"
        />
      </div>

      <div className="mt-4 flex flex-col items-stretch justify-center gap-2 text-center sm:flex-row sm:flex-wrap">
        <span className="flex min-h-[52px] w-full min-w-0 items-center justify-center rounded-[22px] bg-white/10 px-3 py-2 text-center text-xs font-medium leading-5 text-slate-100 sm:min-h-[64px] sm:flex-1 sm:basis-0">
          {hasTodayTripSales
            ? `На сегодня: ${formatRUB(dashboard.summary.todayTripAmount)}`
            : 'На сегодня пока нет продаж'}
        </span>

        {dashboard.summary.pointsToday !== null ? (
          <span className="flex min-h-[52px] w-full min-w-0 items-center justify-center rounded-[22px] bg-white/10 px-3 py-2 text-center text-xs font-medium leading-5 text-slate-100 sm:min-h-[64px] sm:flex-1 sm:basis-0">
            Очки сегодня: {dashboard.summary.pointsToday}
          </span>
        ) : null}

        <div
          className="flex min-h-[52px] w-full min-w-0 flex-col items-center justify-center rounded-[22px] bg-white/10 px-3 py-2 text-center text-xs font-medium leading-5 text-slate-100 sm:min-h-[64px] sm:flex-1 sm:basis-0"
          data-testid="seller-hero-prepayments-today"
        >
          <div className="text-[10px] font-semibold uppercase text-sky-100">
            Предоплаты сегодня
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1">
            <span>Нал: {prepaymentCash}</span>
            <span>Карта: {prepaymentCard}</span>
          </div>
        </div>
      </div>
    </SellerHeroPanel>
  );
}

function formatMotivationNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return MOTIVATION_NUMBER_FORMATTER.format(numeric);
}

function formatPointsLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Нет очков';
  return `${formatMotivationNumber(numeric)} очков`;
}

function formatPointsValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return formatMotivationNumber(numeric);
}

function formatPlaceStatement(place, emptyLabel = 'Вы пока вне рейтинга') {
  const numeric = Number(place);
  if (!Number.isFinite(numeric) || numeric <= 0) return emptyLabel;
  return `Вы сейчас на ${formatMotivationNumber(numeric)} месте`;
}

function formatPlaceValue(place) {
  const numeric = Number(place);
  if (!Number.isFinite(numeric) || numeric <= 0) return '—';
  return String(Math.trunc(numeric));
}

function getSeasonProgressSnapshot(row) {
  return {
    workedDaysSeason: Math.max(0, Number(row?.workedDaysSeason ?? row?.worked_days_season ?? 0)),
    workedDaysRequired: Math.max(0, Number(row?.workedDaysRequired ?? row?.worked_days_required ?? 0)),
    remainingDaysSeason: Math.max(0, Number(row?.remainingDaysSeason ?? row?.remaining_days_season ?? 0)),
    workedDaysSep: Math.max(0, Number(row?.workedDaysSep ?? row?.worked_days_sep ?? 0)),
    workedDaysSepRequired: Math.max(0, Number(row?.workedDaysSepRequired ?? row?.worked_days_sep_required ?? 0)),
    remainingDaysSep: Math.max(0, Number(row?.remainingDaysSep ?? row?.remaining_days_sep ?? 0)),
    workedDaysEndSep: Math.max(0, Number(row?.workedDaysEndSep ?? row?.worked_days_end_sep ?? 0)),
    workedDaysEndSepRequired: Math.max(0, Number(row?.workedDaysEndSepRequired ?? row?.worked_days_end_sep_required ?? 0)),
    remainingDaysEndSep: Math.max(0, Number(row?.remainingDaysEndSep ?? row?.remaining_days_end_sep ?? 0)),
    isEligible: Number(row?.isEligible ?? row?.is_eligible ?? 0) === 1,
  };
}

function buildSeasonMetricCards(row) {
  if (!row) return [];

  const progress = getSeasonProgressSnapshot(row);
  const monthLabel = progress.workedDaysSepRequired > 0
    ? 'Сентябрь'
    : progress.workedDaysEndSepRequired > 0
      ? 'Финал сентября'
      : 'Условие';
  const monthValue = progress.workedDaysSepRequired > 0
    ? `${progress.workedDaysSep} из ${progress.workedDaysSepRequired}`
    : progress.workedDaysEndSepRequired > 0
      ? `${progress.workedDaysEndSep} из ${progress.workedDaysEndSepRequired}`
      : (progress.isEligible ? 'Выполнено' : 'Не выполнено');

  return [
    {
      key: 'season-complete',
      label: 'Выполнено дней',
      value: `${progress.workedDaysSeason} из ${progress.workedDaysRequired}`,
    },
    {
      key: 'season-remaining',
      label: 'Осталось',
      value: `Осталось ${progress.remainingDaysSeason}`,
    },
    {
      key: 'season-month',
      label: monthLabel,
      value: monthValue,
    },
  ];
}

function getSeasonConditionBadge(row) {
  if (!row) return null;
  return getSeasonProgressSnapshot(row).isEligible ? null : 'Условие не выполнено';
}

function getPrizeClasses(place) {
  if (place === 1) {
    return 'border-amber-300 bg-[linear-gradient(180deg,#fef3c7_0%,#fde68a_100%)] text-amber-950 shadow-[0_18px_32px_-24px_rgba(217,119,6,0.55)]';
  }
  if (place === 2) {
    return 'border-slate-300 bg-[linear-gradient(180deg,#f8fafc_0%,#e2e8f0_100%)] text-slate-900 shadow-[0_18px_32px_-24px_rgba(71,85,105,0.42)]';
  }
  if (place === 3) {
    return 'border-orange-300 bg-[linear-gradient(180deg,#ffedd5_0%,#fdba74_100%)] text-orange-950 shadow-[0_18px_32px_-24px_rgba(234,88,12,0.48)]';
  }
  return 'border-slate-200 bg-white text-slate-700';
}

function getWeeklyPrizeClasses(place) {
  if (place === 1) {
    return 'border-amber-300 bg-[linear-gradient(135deg,#78350f_0%,#d97706_34%,#facc15_70%,#fff7c2_100%)] text-amber-950 shadow-[0_20px_42px_-18px_rgba(217,119,6,0.75)]';
  }
  if (place === 2) {
    return 'border-slate-300 bg-[linear-gradient(135deg,#334155_0%,#94a3b8_34%,#f8fafc_68%,#64748b_100%)] text-slate-950 shadow-[0_20px_42px_-18px_rgba(71,85,105,0.65)]';
  }
  if (place === 3) {
    return 'border-orange-300 bg-[linear-gradient(135deg,#431407_0%,#9a3412_34%,#ea580c_68%,#fdba74_100%)] text-white shadow-[0_20px_42px_-18px_rgba(194,65,12,0.7)]';
  }
  return getPrizeClasses(place);
}

function getWeeklyLeaderboardCardClasses(place, isCurrentSeller) {
  if (place === 1) {
    return [
      'border-amber-300 bg-[linear-gradient(135deg,#fffbeb_0%,#fef3c7_38%,#fde68a_100%)]',
      'shadow-[0_20px_42px_-22px_rgba(217,119,6,0.42)]',
      isCurrentSeller ? 'ring-2 ring-amber-200' : '',
    ].join(' ');
  }
  if (place === 2) {
    return [
      'border-slate-300 bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_42%,#e2e8f0_100%)]',
      'shadow-[0_20px_42px_-22px_rgba(71,85,105,0.28)]',
      isCurrentSeller ? 'ring-2 ring-slate-200' : '',
    ].join(' ');
  }
  if (place === 3) {
    return [
      'border-orange-300 bg-[linear-gradient(135deg,#fff7ed_0%,#fed7aa_42%,#fdba74_100%)]',
      'shadow-[0_20px_42px_-22px_rgba(194,65,12,0.3)]',
      isCurrentSeller ? 'ring-2 ring-orange-200' : '',
    ].join(' ');
  }
  return isCurrentSeller
    ? 'border-sky-300 bg-sky-50/85 ring-2 ring-sky-100'
    : 'border-slate-200 bg-white';
}

function getWeeklyHeroTheme(place) {
  if (place === 1) {
    return {
      surface: 'bg-[linear-gradient(145deg,#451a03_0%,#b45309_34%,#f59e0b_68%,#fde68a_100%)]',
      badge: 'bg-white/18 text-white',
    };
  }
  if (place === 2) {
    return {
      surface: 'bg-[linear-gradient(145deg,#1e293b_0%,#64748b_38%,#e2e8f0_72%,#475569_100%)]',
      badge: 'bg-white/18 text-white',
    };
  }
  if (place === 3) {
    return {
      surface: 'bg-[linear-gradient(145deg,#431407_0%,#9a3412_42%,#ea580c_72%,#fed7aa_100%)]',
      badge: 'bg-white/18 text-white',
    };
  }
  return {
    surface: 'bg-[linear-gradient(145deg,#082f49_0%,#1d4ed8_52%,#38bdf8_100%)]',
    badge: 'bg-white/14 text-white',
  };
}

function MotivationPrizeCard({ prize, premium = false }) {
  const place = Number(prize?.place || 0);
  return (
    <div className={`rounded-[22px] border px-3 py-3 text-center ${premium ? getWeeklyPrizeClasses(place) : getPrizeClasses(place)}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-75">
        {place} место
      </div>
      <div className="mt-2 text-lg font-semibold tracking-[-0.03em]">{formatRUB(Number(prize?.amount || 0))}</div>
    </div>
  );
}

function MotivationStatCard({ label, value, className = '' }) {
  return (
    <div className={`rounded-[22px] border px-3 py-3 text-center ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold leading-none tracking-[-0.04em] text-slate-950">{value}</div>
    </div>
  );
}

function MotivationMetricPill({ label, value, className = '' }) {
  return (
    <div className={`rounded-[20px] border px-3 py-3 text-center ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold leading-5 text-slate-900">{value}</div>
    </div>
  );
}

function MotivationSummaryButton({
  scope,
  title,
  placeStatement,
  placeValue,
  pointsValue,
  prizes = [],
  metricCards = [],
  statusBadge = null,
  onClick,
  testId,
}) {
  const theme = scope === 'season'
    ? {
        surface: 'border-amber-200 bg-[linear-gradient(180deg,#fffaf0_0%,#fff1db_100%)]',
        badge: 'bg-amber-600 text-white',
        open: 'bg-white/80 text-amber-700 ring-1 ring-amber-200',
        stat: 'border-amber-200 bg-white/85',
        metric: 'border-amber-200 bg-white/80',
      }
    : {
        surface: 'border-sky-200 bg-[linear-gradient(180deg,#f8fbff_0%,#eef6ff_100%)]',
        badge: 'bg-sky-950 text-white',
        open: 'bg-white/80 text-sky-700 ring-1 ring-sky-200',
        stat: 'border-sky-200 bg-white/85',
        metric: 'border-sky-200 bg-white/80',
      };

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`w-full rounded-[28px] border p-4 text-left shadow-sm transition-transform duration-200 hover:-translate-y-0.5 ${theme.surface}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${theme.badge}`}>
            {title}
          </span>
          <div className="mt-4 max-w-[16rem] text-2xl font-semibold leading-tight tracking-[-0.04em] text-slate-950">
            {placeStatement}
          </div>
        </div>

        <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${theme.open}`}>
          Открыть
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <MotivationStatCard label="Место" value={placeValue} className={theme.stat} />
        <MotivationStatCard label="Очки" value={pointsValue} className={theme.stat} />
      </div>

      {statusBadge ? (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <span className="inline-flex items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-center text-[11px] font-semibold text-amber-900">
            {statusBadge}
          </span>
        </div>
      ) : null}

      {prizes.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {prizes.map((prize) => (
            <MotivationPrizeCard key={prize.place} prize={prize} />
          ))}
        </div>
      ) : null}

      {metricCards.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {metricCards.map((metric) => (
            <MotivationMetricPill
              key={metric.key}
              label={metric.label}
              value={metric.value}
              className={theme.metric}
            />
          ))}
        </div>
      ) : null}
    </button>
  );
}

function MotivationHeroStat({ label, value, compact = false, centered = false }) {
  return (
    <div className={`rounded-[20px] bg-white/12 px-3 py-3 ${centered ? 'text-center' : 'text-left'} ring-1 ring-white/10 backdrop-blur-sm`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/65">{label}</div>
      <div className={`mt-2 font-semibold leading-tight text-white ${compact ? 'text-sm' : 'text-lg'}`}>{value}</div>
    </div>
  );
}

function MotivationDetailHero({
  scope,
  title,
  placeStatement,
  placeValue,
  place = null,
  pointsValue,
  payoutValue,
  statusBadge = null,
  metricCards = [],
}) {
  const theme = scope === 'season'
    ? {
        surface: 'bg-[linear-gradient(145deg,#7c2d12_0%,#d97706_48%,#f59e0b_100%)]',
        badge: 'bg-white/16 text-white',
      }
    : getWeeklyHeroTheme(Number(place || 0));

  return (
    <div className={`rounded-[30px] px-4 py-5 text-white shadow-[0_28px_60px_-30px_rgba(15,23,42,0.65)] ${theme.surface}`}>
      <div className="flex justify-center">
        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${theme.badge}`}>
          {title}
        </span>
      </div>

      <div className="mt-4 text-center text-2xl font-semibold leading-tight tracking-[-0.04em]">
        {placeStatement}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MotivationHeroStat label="Место" value={placeValue} centered />
        <MotivationHeroStat label="Очки" value={pointsValue} centered />
        <MotivationHeroStat label="Сумма" value={payoutValue} compact centered />
      </div>

      {statusBadge ? (
        <div className="mt-3 flex justify-center">
          <span className="rounded-full border border-white/20 bg-white/14 px-3 py-1 text-[11px] font-semibold text-white">
            {statusBadge}
          </span>
        </div>
      ) : null}

      {metricCards.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {metricCards.map((metric) => (
            <MotivationHeroStat
              key={metric.key}
              label={metric.label}
              value={metric.value}
              compact
              centered
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildWeeklyRowChips(row) {
  const chips = [];
  const payoutValue = Number(row?.current_payout || 0);
  const revenueValue = Number(row?.revenue || 0);

  if (row?.is_prize_place && row?.prize_place) {
    chips.push({
      key: `prize-${row.prize_place}`,
      label: 'Призовое',
      value: `#${row.prize_place}`,
      className: 'border-amber-200 bg-amber-50 text-amber-900',
    });
  }
  if (payoutValue > 0) {
    chips.push({
      key: 'payout',
      label: 'Выплата',
      value: formatRUB(payoutValue),
      className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    });
  }
  if (revenueValue > 0) {
    chips.push({
      key: 'revenue',
      label: 'Выручка',
      value: formatRUB(revenueValue),
      className: 'border-slate-200 bg-slate-50 text-slate-800',
    });
  }

  return chips;
}

function buildSeasonRowChips(row) {
  const progress = getSeasonProgressSnapshot(row);
  const monthLabel = progress.workedDaysSepRequired > 0
    ? 'Сентябрь'
    : progress.workedDaysEndSepRequired > 0
      ? 'Финал сентября'
      : 'Условие';
  const monthValue = progress.workedDaysSepRequired > 0
    ? `${progress.workedDaysSep}/${progress.workedDaysSepRequired}`
    : progress.workedDaysEndSepRequired > 0
      ? `${progress.workedDaysEndSep}/${progress.workedDaysEndSepRequired}`
      : (progress.isEligible ? 'Выполнено' : 'Не выполнено');
  const chips = [
    {
      key: 'season',
      label: 'Сезон',
      value: `${progress.workedDaysSeason}/${progress.workedDaysRequired} дней`,
      className: 'border-slate-200 bg-slate-50 text-slate-800',
    },
    {
      key: 'remaining',
      label: 'Осталось',
      value: `Осталось ${progress.remainingDaysSeason}`,
      className: 'border-slate-200 bg-slate-50 text-slate-800',
    },
    {
      key: 'month',
      label: monthLabel,
      value: monthValue,
      className: 'border-amber-200 bg-amber-50 text-amber-900',
    },
  ];

  return chips;
}

function MotivationLeaderboardRow({ row, scope }) {
  const place = Number(row?.place || 0);
  const isCurrentSeller = Boolean(row?.is_current_seller);
  const chips = scope === 'season' ? buildSeasonRowChips(row) : buildWeeklyRowChips(row);
  const revenueValue = Number(row?.revenue ?? row?.revenue_total ?? 0);

  if (scope === 'week') {
    return (
      <div
        className={[
          'rounded-[20px] border px-3 py-2 shadow-sm',
          getWeeklyLeaderboardCardClasses(place, isCurrentSeller),
        ].join(' ')}
      >
        <div className="flex items-center gap-3">
          <div
            className={[
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border text-sm font-semibold',
              getWeeklyPrizeClasses(place),
            ].join(' ')}
          >
            {place || '—'}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <div className="truncate text-sm font-semibold text-slate-950">{row?.name || 'Продавец'}</div>
              {isCurrentSeller ? (
                <span className="rounded-full bg-sky-900 px-2 py-0.5 text-[10px] font-semibold text-white">Это вы</span>
              ) : null}
            </div>
            <div className="mt-0.5 text-xs leading-4 text-slate-500">
              Выручка: {formatRUB(revenueValue)}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Очки</div>
            <div className="mt-0.5 text-base font-semibold leading-none tracking-[-0.03em] text-slate-950">
              {formatPointsValue(row?.points)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        'rounded-[22px] border px-3 py-2.5 shadow-sm',
        isCurrentSeller
          ? 'border-sky-300 bg-sky-50/85 ring-2 ring-sky-100'
          : 'border-slate-200 bg-white',
      ].join(' ')}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={[
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] border text-sm font-semibold',
            getPrizeClasses(place),
          ].join(' ')}
        >
          {place || '—'}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="truncate text-sm font-semibold text-slate-950">{row?.name || 'Продавец'}</div>
                {isCurrentSeller ? (
                  <span className="rounded-full bg-sky-900 px-2 py-0.5 text-[10px] font-semibold text-white">Это вы</span>
                ) : null}
              </div>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Очки</div>
              <div className="mt-0.5 text-base font-semibold leading-none tracking-[-0.03em] text-slate-950">
                {formatPointsValue(row?.points)}
              </div>
            </div>
          </div>

          {chips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <div
                  key={chip.key}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${chip.className}`}
                >
                  {chip.label}: {chip.value}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MotivationDetailSheet({
  open,
  title,
  subtitle,
  hideHeaderText = false,
  loading,
  error,
  onClose,
  children,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        className="fixed inset-0 bg-slate-950/50"
      />

      <div className="relative flex min-h-full items-end justify-center px-3 pt-8 sm:items-center sm:py-8">
        <div className="w-full max-w-[560px] overflow-x-hidden rounded-t-[32px] bg-white px-4 pb-6 pt-4 shadow-[0_-24px_60px_-28px_rgba(15,23,42,0.45)] sm:rounded-[32px] sm:shadow-[0_28px_70px_-32px_rgba(15,23,42,0.55)]">
          <div className={`mb-4 flex items-start justify-between gap-3 ${hideHeaderText ? 'justify-end' : ''}`}>
            {hideHeaderText ? null : (
              <div>
                <div className="text-lg font-semibold text-slate-950">{title}</div>
                {subtitle ? <div className="mt-1 text-sm leading-5 text-slate-500">{subtitle}</div> : null}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
            >
              Закрыть
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              <div className="h-28 animate-pulse rounded-[24px] bg-slate-100" />
              <div className="h-24 animate-pulse rounded-[24px] bg-slate-100" />
              <div className="h-24 animate-pulse rounded-[24px] bg-slate-100" />
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : children}
        </div>
      </div>
    </div>
  );
}

function SellerMotivationBlock({ dashboard }) {
  const weekRow = dashboard.rating.currentSellerWeek;
  const seasonRow = dashboard.rating.currentSellerSeason;
  const streak = dashboard.streak;
  const [activeDetail, setActiveDetail] = useState(null);
  const [detailCache, setDetailCache] = useState({ week: null, season: null });
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    setActiveDetail(null);
    setDetailCache({ week: null, season: null });
    setDetailLoading(false);
    setDetailError('');
  }, [dashboard.today, weekRow?.label, seasonRow?.label]);

  const openDetail = async (scope) => {
    setActiveDetail(scope);
    setDetailError('');

    if (detailCache[scope]) {
      return;
    }

    try {
      setDetailLoading(true);
      const response = scope === 'week'
        ? await apiClient.getSellerDashboardWeekly()
        : await apiClient.getSellerDashboardSeason();
      setDetailCache((prev) => ({
        ...prev,
        [scope]: response?.data || null,
      }));
    } catch (loadError) {
      console.error(`Error loading seller motivation ${scope}:`, loadError);
      setDetailError(loadError?.message || 'Не удалось загрузить детали мотивации');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setActiveDetail(null);
    setDetailError('');
  };

  const detailData = activeDetail ? detailCache[activeDetail] : null;
  const weekPrizes = Array.isArray(weekRow?.prizes) ? weekRow.prizes : [];
  const seasonMetricCards = buildSeasonMetricCards(seasonRow);

  return (
    <section className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Мотивация</h2>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <MotivationSummaryButton
          scope="week"
          title="Недельная лига"
          placeStatement={formatPlaceStatement(weekRow?.place, 'Вы пока вне недельного рейтинга')}
          placeValue={formatPlaceValue(weekRow?.place)}
          pointsValue={formatPointsValue(weekRow?.points)}
          prizes={weekPrizes}
          onClick={() => openDetail('week')}
          testId="seller-motivation-week-card"
        />

        <MotivationSummaryButton
          scope="season"
          title="Сезонный зачет"
          placeStatement={formatPlaceStatement(seasonRow?.place, 'Вы пока вне сезонного рейтинга')}
          placeValue={formatPlaceValue(seasonRow?.place)}
          pointsValue={formatPointsValue(seasonRow?.points)}
          metricCards={seasonMetricCards}
          statusBadge={getSeasonConditionBadge(seasonRow)}
          onClick={() => openDetail('season')}
          testId="seller-motivation-season-card"
        />

        <div className="rounded-[26px] border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Серия</div>
              <div className="mt-1 text-sm leading-5 text-slate-500">
                {streak.available
                  ? `Сейчас серия ${streak.currentSeries ?? 0} дней${streak.rewardLabel ? ` • бонус ${streak.rewardLabel}` : ''}`
                  : 'Данные по серии пока не появились.'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold text-slate-950">
                {streak.available ? `${streak.currentSeries ?? 0}` : '—'}
              </div>
              <div className="text-xs uppercase tracking-[0.14em] text-slate-400">дней</div>
            </div>
          </div>
        </div>
      </div>

      <MotivationDetailSheet
        open={Boolean(activeDetail)}
        title={activeDetail === 'season' ? 'Сезонная мотивация' : 'Недельная мотивация'}
        hideHeaderText={activeDetail === 'week' || activeDetail === 'season'}
        subtitle={activeDetail === 'season'
          ? detailData
            ? `${detailData.season_from} — ${detailData.season_to}`
            : 'Полный рейтинг продавцов и выполнение сезонных условий'
          : detailData
            ? `${detailData.date_from} — ${detailData.date_to}`
            : 'Полный рейтинг продавцов за текущую неделю'}
        loading={detailLoading}
        error={detailError}
        onClose={closeDetail}
      >
        {activeDetail === 'week' && detailData ? (
          <div className="space-y-3" data-testid="seller-motivation-week-detail">
            <MotivationDetailHero
              scope="week"
              title="Недельная лига"
              placeStatement={formatPlaceStatement(detailData.current_seller?.place, 'Вы пока вне недельного рейтинга')}
              placeValue={formatPlaceValue(detailData.current_seller?.place)}
              place={detailData.current_seller?.place}
              pointsValue={formatPointsValue(detailData.current_seller?.points)}
              payoutValue={Number(detailData.current_seller?.current_payout || 0) > 0
                ? formatRUB(detailData.current_seller.current_payout)
                : 'Пока без выплаты'}
            />

            <div className="grid grid-cols-3 gap-2">
              {(detailData.prizes || []).map((prize) => (
                <MotivationPrizeCard key={prize.place} prize={prize} premium />
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">Все участники недели</div>
              <div className="text-sm text-slate-500">{detailData.total_sellers || 0} в рейтинге</div>
            </div>

            <div className="space-y-1.5">
              {(detailData.sellers || []).map((row) => (
                <MotivationLeaderboardRow
                  key={`week-${row.user_id}-${row.place ?? 'self'}`}
                  row={row}
                  scope="week"
                />
              ))}
            </div>
          </div>
        ) : null}

        {activeDetail === 'season' && detailData ? (
          <div className="space-y-4 overflow-x-hidden" data-testid="seller-motivation-season-detail">
            <MotivationDetailHero
              scope="season"
              title="Сезонный зачет"
              placeStatement={formatPlaceStatement(detailData.current_seller?.place, 'Вы пока вне сезонного рейтинга')}
              placeValue={formatPlaceValue(detailData.current_seller?.place)}
              pointsValue={formatPointsValue(detailData.current_seller?.points)}
              payoutValue={Number(detailData.current_seller?.current_payout || 0) > 0
                ? formatRUB(detailData.current_seller.current_payout)
                : 'Пока без выплаты'}
              statusBadge={getSeasonConditionBadge(detailData.current_seller)}
              metricCards={buildSeasonMetricCards(detailData.current_seller)}
            />

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-center">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Фонд сезона</div>
                <div className="mt-2 text-base font-semibold text-slate-950">{formatRUB(Number(detailData.fund_total || 0))}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-center">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Схема</div>
                <div className="mt-2 text-base font-semibold text-slate-950">
                  {detailData.payout_scheme === 'top3'
                    ? 'Топ-3'
                    : detailData.payout_scheme === 'top5'
                      ? 'Топ-5'
                      : 'Все по местам'}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">Сезонный рейтинг</div>
              <div className="text-sm text-slate-500">{detailData.total_sellers || 0} в списке</div>
            </div>

            <div className="space-y-2">
              {(detailData.sellers || []).map((row) => (
                <MotivationLeaderboardRow
                  key={`season-${row.user_id}-${row.place ?? 'self'}`}
                  row={row}
                  scope="season"
                />
              ))}
            </div>
          </div>
        ) : null}
      </MotivationDetailSheet>
    </section>
  );
}

function SellerSalesBlock({
  loading,
  sales,
  preset,
  selectedDate,
  today,
  onPresetChange,
  onSelectedDateChange,
  expandedSales,
  onToggleSale,
  saleTickets,
  ticketsLoading,
  ticketsErrors,
}) {
  const targetDate = preset === 'date' ? (selectedDate || today) : (preset === 'today' ? today : null);
  const hideTripDateOnCards = preset !== 'all';
  const emptyTitle = preset === 'all'
    ? 'Продаж пока нет'
    : preset === 'tomorrow'
      ? 'На завтра продаж нет'
      : preset === 'date'
        ? `На ${formatDayLabel(targetDate)} продаж нет`
        : 'На сегодня продаж нет';
  const emptyText = preset === 'all'
    ? 'Как только появятся продажи, они появятся в этом списке.'
    : 'Когда появятся продажи на выбранную дату, они отобразятся здесь.';

  return (
    <section className="rounded-[28px] bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Продажи</h2>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
          {sales.length}
        </span>
      </div>

      <div className="mt-3 overflow-x-auto pb-1">
        <div className="flex min-w-max gap-2">
          <SalesPresetChip
            active={preset === 'today'}
            label="Сегодня"
            onClick={() => onPresetChange('today')}
            testId="seller-sales-preset-today"
          />
          <SalesPresetChip
            active={preset === 'all'}
            label="Все продажи"
            onClick={() => onPresetChange('all')}
            testId="seller-sales-preset-all"
          />
          <SalesPresetChip
            active={preset === 'tomorrow'}
            label="Завтра"
            onClick={() => onPresetChange('tomorrow')}
            testId="seller-sales-preset-tomorrow"
          />
          <SalesPresetChip
            active={preset === 'date'}
            label="Выбор даты"
            onClick={() => onPresetChange('date')}
            testId="seller-sales-preset-date"
          />
        </div>
      </div>

      {preset === 'date' ? (
        <div className="mt-3">
          <DateFieldPicker
            value={selectedDate || today || ''}
            onChange={onSelectedDateChange}
            caption="Дата продаж"
            sheetTitle="Дата продаж"
            sheetDescription="Выберите день, за который хотите посмотреть продажи."
            inputTestId="seller-sales-date-input"
          />
        </div>
      ) : null}

      <div className="mt-3">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-[22px] bg-slate-100" />
            ))}
          </div>
        ) : sales.length > 0 ? (
          <div className="space-y-2.5">
            {sales.map((sale) => (
              <SaleCard
                key={sale.id}
                sale={sale}
                expanded={Boolean(expandedSales[sale.id])}
                onToggle={() => onToggleSale(sale.id)}
                tickets={saleTickets[sale.id] || []}
                ticketsLoading={Boolean(ticketsLoading[sale.id])}
                ticketsError={ticketsErrors[sale.id] || ''}
                hideTripDate={hideTripDateOnCards}
              />
            ))}
          </div>
        ) : (
          <CompactState title={emptyTitle} text={emptyText} />
        )}
      </div>
    </section>
  );
}

const SellerEarnings = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [sales, setSales] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preset, setPreset] = useState('today');
  const [selectedDate, setSelectedDate] = useState('');
  const [expandedSales, setExpandedSales] = useState({});
  const [saleTickets, setSaleTickets] = useState({});
  const [ticketsLoading, setTicketsLoading] = useState({});
  const [ticketsErrors, setTicketsErrors] = useState({});

  useEffect(() => {
    let alive = true;

    const loadScreen = async () => {
      try {
        setLoading(true);
        setError('');
        const [salesResult, metricsResult] = await Promise.allSettled([
          apiClient.getPresales(),
          apiClient.getSellerDashboard(),
        ]);

        if (!alive) return;

        if (salesResult.status === 'fulfilled') {
          const response = salesResult.value;
          const items = Array.isArray(response) ? response : response?.presales || [];
          setSales(Array.isArray(items) ? items : []);
        } else {
          console.error('Error loading seller sales:', salesResult.reason);
          setSales([]);
          setError(salesResult.reason?.message || 'Не удалось загрузить продажи');
        }

        if (metricsResult.status === 'fulfilled') {
          setMetrics(metricsResult.value?.data || null);
        } else {
          console.error('Error loading seller dashboard metrics:', metricsResult.reason);
          setMetrics(null);
        }
      } catch (loadError) {
        if (!alive) return;
        console.error('Error loading seller sales:', loadError);
        setSales([]);
        setMetrics(null);
        setError(loadError?.message || 'Не удалось загрузить продажи');
      } finally {
        if (alive) setLoading(false);
      }
    };

    loadScreen();

    return () => {
      alive = false;
    };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const handlePresetChange = (nextPreset) => {
    setPreset(nextPreset);
    if (nextPreset === 'date' && !selectedDate) {
      setSelectedDate(metrics?.dates?.today || '');
    }
  };

  const handleToggleSale = async (saleId) => {
    const nextExpanded = !expandedSales[saleId];
    setExpandedSales((prev) => ({ ...prev, [saleId]: nextExpanded }));

    if (!nextExpanded || saleTickets[saleId] || ticketsLoading[saleId]) {
      return;
    }

    try {
      setTicketsErrors((prev) => ({ ...prev, [saleId]: '' }));
      setTicketsLoading((prev) => ({ ...prev, [saleId]: true }));
      const response = await apiClient.getPresaleTickets(saleId);
      const items = Array.isArray(response) ? response : response?.tickets || [];
      setSaleTickets((prev) => ({ ...prev, [saleId]: Array.isArray(items) ? items : [] }));
    } catch (loadError) {
      console.error('Error loading presale tickets:', loadError);
      setSaleTickets((prev) => ({ ...prev, [saleId]: [] }));
      setTicketsErrors((prev) => ({
        ...prev,
        [saleId]: loadError?.message || 'Не удалось загрузить билеты',
      }));
    } finally {
      setTicketsLoading((prev) => ({ ...prev, [saleId]: false }));
    }
  };

  const dashboard = buildSellerDashboardModel(sales, undefined, metrics);
  const filteredSales = filterSellerSalesByPreset(dashboard.sales, {
    preset,
    selectedDate: selectedDate || dashboard.today,
    today: dashboard.today,
    tomorrow: dashboard.tomorrow,
  });

  return (
    <SellerScreen data-testid="seller-earnings-screen">
      <SellerTopbar
        title="Мои продажи"
        onBack={() => navigate('/seller/home')}
        onLogout={handleLogout}
        backProps={{ 'data-testid': 'seller-earnings-back' }}
        titleProps={{ 'data-testid': 'seller-earnings-title' }}
        rightSlot={
          <button
            type="button"
            onClick={handleLogout}
            data-testid="seller-earnings-logout"
            className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Выйти
          </button>
        }
      />

      <div className={`${sellerContentClass} space-y-3`}>
        <SellerHeroMetric dashboard={dashboard} loading={loading} />

        <SellerMotivationBlock dashboard={dashboard} />

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <SellerSalesBlock
          loading={loading}
          sales={filteredSales}
          preset={preset}
          selectedDate={selectedDate}
          today={dashboard.today}
          onPresetChange={handlePresetChange}
          onSelectedDateChange={setSelectedDate}
          expandedSales={expandedSales}
          onToggleSale={handleToggleSale}
          saleTickets={saleTickets}
          ticketsLoading={ticketsLoading}
          ticketsErrors={ticketsErrors}
        />
      </div>
    </SellerScreen>
  );
};

export default SellerEarnings;
