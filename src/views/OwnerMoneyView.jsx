/**
 * OwnerMoneyView.jsx — экран "Деньги" (OWNER)
 * Было: UI-only демо.
 * Стало: реальные данные из Owner API:
 *  - GET /api/owner/money/summary?preset=
 *  - GET /api/owner/money/compare-days?preset=
 *  - GET /api/owner/boats?preset=
 *  + Pending (ожидает оплаты по дате рейса):
 *    GET /api/owner/money/pending-by-day?day=today|tomorrow|day2
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "../utils/apiClient.js";
import { useOwnerData } from "../contexts/OwnerDataContext.jsx";
import {
  OWNER_MONEY_FUNDS_CASH_ONLY_HINT_TEXT,
  shouldShowFundsCashOnlyHint,
} from "../utils/ownerMoneyFundsHint.js";
import {
  OWNER_MONEY_MAIN_KPI_FORMULA,
  OWNER_MONEY_MAIN_KPI_TITLE,
} from "../utils/ownerMoneyKpi.js";

const OWNER_MONEY_TOP_LABEL_OVERRIDES = {
  "owner-money-funds-weekly": "Отложить сегодня в Weekly фонд",
  "owner-money-funds-season": "Отложить сегодня в Season фонд",
  "owner-money-obligations-tomorrow-cash": "Обязательства на завтра наличными",
  "owner-money-obligations-tomorrow-card": "Обязательства на завтра картой",
  "owner-money-obligations-tomorrow-total": "Обязательства на завтра итого",
};

function formatRUB(v) {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)} ₽`;
  }
}

function formatInt(v) {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

async function ownerGet(url) {
  const res = await apiClient.request(url, { method: "GET" });
  const one = res?.data && (res.data.data || res.data.meta) ? res.data : res;
  const two = one?.data && (one.data.data || one.data.meta) ? one.data : one;
  return two || { data: {}, meta: {} };
}

export default function OwnerMoneyView() {
  const { refreshAllMoneyData, registerRefreshCallback } = useOwnerData();
  
  const [preset, setPreset] = useState("today");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [money, setMoney] = useState({
    preset: "today",
    range: null,
    totals: { revenue: 0, cash: 0, card: 0 },
    paidByTripDay: { revenue: 0, cash: 0, card: 0 },
    ownerDecisionMetrics: null,
    shiftCloseBreakdown: null,
    warnings: [],
  });

  const reload = useCallback(async ({ silent } = {}) => {
    if (!silent) setBusy(true);
    setErr("");
    try {
      const m = await ownerGet(`/owner/money/summary?preset=${encodeURIComponent(preset)}`);

      setMoney({
        preset: m?.data?.preset ?? preset,
        range: m?.data?.range ?? null,
        totals: m?.data?.totals ?? { collected_total: 0, collected_cash: 0, collected_card: 0, tickets: 0, trips: 0, fillPercent: 0 },
        paidByTripDay: m?.data?.paid_by_trip_day ?? { revenue: 0, cash: 0, card: 0 },
        ownerDecisionMetrics: m?.data?.owner_decision_metrics ?? null,
        shiftCloseBreakdown: m?.data?.shift_close_breakdown ?? null,
        warnings: m?.meta?.warnings || [],
      });
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Ошибка загрузки");
    } finally {
      if (!silent) setBusy(false);
    }
  }, [preset]);

  // Manual refresh handler (force refresh all money data)
  const onManualRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setBusy(true);
    try {
      await reload({ silent: true });
      await refreshAllMoneyData({ silent: false, reason: 'manual-click' });
    } finally {
      setIsRefreshing(false);
      setBusy(false);
    }
  }, [isRefreshing, reload, refreshAllMoneyData]);

  // Initial load
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // Auto-polling for today only (20s), skip during manual refresh
  useEffect(() => {
    if (preset !== "today") return;
    if (isRefreshing) return;

    const poll = async () => {
      if (isRefreshing) return;
      await reload({ silent: true });
    };

    const t = setInterval(poll, 20000);
    return () => clearInterval(t);
  }, [preset, isRefreshing, reload]);

  // Auto refresh on focus/visibility (no polling spam)
  useEffect(() => {
    if (preset !== "today") return;

    const onFocus = () => reload({ silent: true });
    const onVisibility = () => {
      if (document.visibilityState === "visible") reload({ silent: true });
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [preset, reload]);

  // Register reload callback with context for external triggers
  useEffect(() => {
    if (registerRefreshCallback) {
      registerRefreshCallback(async ({ silent } = {}) => {
        await reload({ silent: silent ?? false });
      });
    }
  }, [registerRefreshCallback, reload]);

  const manualOn = useMemo(() => {
    const all = [...(money.warnings || [])].join("\n");
    return all.toLowerCase().includes("manual override");
  }, [money.warnings]);

  const revenue = Number(money.totals?.collected_total || money.totals?.revenue || 0);
  const cash = Number(money.totals?.collected_cash || money.totals?.cash || 0);
  const card = Number(money.totals?.collected_card || money.totals?.card || 0);
  const ownerDecisionMetrics = money.ownerDecisionMetrics || null;
  const shiftCloseBreakdown = money.shiftCloseBreakdown || null;
  const shiftCloseTotals = shiftCloseBreakdown?.totals || null;
  const hasSingleBusinessDayRange = Boolean(
    money.range?.from &&
    money.range?.to &&
    money.range.from === money.range.to
  );
  const decisionMetricsAvailable = Boolean(ownerDecisionMetrics && hasSingleBusinessDayRange);

  // Новые поля: pending_amount и paid_by_trip_day
  const pendingAmount = Number(money.totals?.pending_amount || 0);
  const paidByTripDay = money.paidByTripDay || { revenue: 0, cash: 0, card: 0 };

  // Refund and net metrics
  const refundTotal = Number(money.totals?.refund_total || 0);
  const refundCash = Number(money.totals?.refund_cash || 0);
  const refundCard = Number(money.totals?.refund_card || 0);
  const netTotal = Number(money.totals?.net_total || revenue);
  const netCash = Number(money.totals?.net_cash || cash);
  const netCard = Number(money.totals?.net_card || card);
  const fundsWithholdWeeklyToday = Number(money.totals?.funds_withhold_weekly_today || 0);
  const fundsWithholdSeasonToday = Number(money.totals?.funds_withhold_season_today || 0);
  const fundsWithholdDispatcherBonusToday = Number(money.totals?.funds_withhold_dispatcher_bonus_today || 0);
  const fundsWithholdRoundingToSeasonToday = Number(money.totals?.funds_withhold_rounding_to_season_today || 0);
  const fundsWithholdTotalToday = Number(
    money.totals?.funds_withhold_total_today ||
    (fundsWithholdWeeklyToday + fundsWithholdSeasonToday + fundsWithholdDispatcherBonusToday)
  );
  const fundsWithholdCashToday = Number(money.totals?.funds_withhold_cash_today || fundsWithholdTotalToday);
  const fundsWithholdCardToday = Number(money.totals?.funds_withhold_card_today || 0);
  const showFundsCashOnlyHint = shouldShowFundsCashOnlyHint({
    fundsWithholdCardToday,
    fundsWithholdTotalToday,
  });
  const takeawayToday = Number(
    ownerDecisionMetrics?.can_take_cash_today ??
    money.totals?.owner_cash_today ??
    money.totals?.cash_takeaway_after_reserve_and_funds ??
    0
  );
  const topCollectedCash = Number(ownerDecisionMetrics?.received_cash_today ?? cash);
  const topCollectedCard = Number(ownerDecisionMetrics?.received_card_today ?? card);
  const topCollectedTotal = Number(ownerDecisionMetrics?.received_total_today ?? revenue);
  const topWeeklyWithhold = Number(
    ownerDecisionMetrics?.withhold_weekly_today ??
    money.totals?.weekly_fund ??
    fundsWithholdWeeklyToday
  );
  const topSeasonWithhold = Number(
    ownerDecisionMetrics?.withhold_season_today ??
    money.totals?.season_fund_total ??
    fundsWithholdSeasonToday
  );
  const topTomorrowObligationsCash = Number(
    ownerDecisionMetrics?.obligations_tomorrow_cash ??
    money.totals?.obligations_tomorrow_cash ??
    0
  );
  const topTomorrowObligationsCard = Number(
    ownerDecisionMetrics?.obligations_tomorrow_card ??
    money.totals?.obligations_tomorrow_card ??
    0
  );
  const topTomorrowObligationsTotal = Number(
    ownerDecisionMetrics?.obligations_tomorrow_total ??
    money.totals?.obligations_tomorrow_total ??
    (topTomorrowObligationsCash + topTomorrowObligationsCard)
  );
  const ownerAvailableCashBeforeReserve = Number(
    shiftCloseTotals?.owner_cash_before_reserve ??
    money.totals?.owner_cash_available_without_future_reserve ??
    money.totals?.owner_available_cash_before_future_reserve ??
    netCash
  );
  const ownerAvailableCashAfterReserve = Number(
    shiftCloseTotals?.owner_cash_after_reserve ??
    money.totals?.owner_cash_available_after_future_reserve_cash ??
    money.totals?.owner_available_cash_after_future_reserve ??
    0
  );
  const sellersCollectTotal = Number(
    shiftCloseTotals?.collect_from_sellers ??
    money.totals?.sellers_collect_total ??
    0
  );
  const salaryToPay = Number(
    shiftCloseTotals?.final_salary_total ??
    money.totals?.salary_to_pay ??
    0
  );

  const tickets = Number(money.totals?.tickets || 0);
  const trips = Number(money.totals?.trips || 0);
  const fillPercent = Number(money.totals?.fillPercent || 0);
  const debugChecks = Object.entries(shiftCloseBreakdown?.checks || {}).filter(([, value]) => Number(value || 0) !== 0);
  const pendingDay = "tomorrow";
  const setPendingDay = () => {};
  const pendingLoading = false;
  const pendingData = null;
  const collectedToday = {
    by_trip_day: {
      tomorrow: { revenue: 0, cash: 0, card: 0 },
      day2: { revenue: 0, cash: 0, card: 0 },
    },
  };
  const days = { preset: "7d" };
  const bars = [];
  const hasAnyRevenue = false;
  const topMetrics = useMemo(() => ([
    {
      label: OWNER_MONEY_MAIN_KPI_TITLE,
      value: takeawayToday,
      testId: "owner-money-main-kpi",
      featured: true,
      tone: takeawayToday < 0 ? "neg" : "accent",
    },
    {
      label: "Наличными получено сегодня",
      value: topCollectedCash,
      testId: "owner-money-collected-cash",
    },
    {
      label: "Картой получено сегодня",
      value: topCollectedCard,
      testId: "owner-money-collected-card",
    },
    {
      label: "Итого получено сегодня",
      value: topCollectedTotal,
      testId: "owner-money-collected-total",
    },
    {
      label: "Отложить в Weekly сегодня",
      value: topWeeklyWithhold,
      testId: "owner-money-funds-weekly",
    },
    {
      label: "Отложить в Season сегодня",
      value: topSeasonWithhold,
      testId: "owner-money-funds-season",
    },
    {
      label: "Резерв будущих рейсов наличными",
      value: topTomorrowObligationsCash,
      testId: "owner-money-obligations-tomorrow-cash",
    },
    {
      label: "Резерв будущих рейсов картой",
      value: topTomorrowObligationsCard,
      testId: "owner-money-obligations-tomorrow-card",
    },
    {
      label: "Резерв будущих рейсов итого",
      value: topTomorrowObligationsTotal,
      testId: "owner-money-obligations-tomorrow-total",
    },
  ]), [
    takeawayToday,
    topCollectedCash,
    topCollectedCard,
    topCollectedTotal,
    topWeeklyWithhold,
    topSeasonWithhold,
    topTomorrowObligationsCash,
    topTomorrowObligationsCard,
    topTomorrowObligationsTotal,
  ]);
  const secondaryDetailRows = useMemo(() => ([
    {
      label: "Ожидает оплаты",
      value: formatRUB(pendingAmount),
      testId: "owner-money-pending-total",
    },
    {
      label: "Возвраты",
      value: formatRUB(refundTotal),
      testId: "owner-money-refund-total",
    },
    {
      label: "Заработано по дню рейса",
      value: formatRUB(paidByTripDay.revenue || 0),
      testId: "owner-money-earned-trip-day",
    },
    {
      label: "Билеты",
      value: formatInt(tickets),
      testId: "owner-money-tickets-total",
    },
    {
      label: "Рейсы",
      value: formatInt(trips),
      testId: "owner-money-trips-total",
    },
    {
      label: "Загрузка",
      value: fillPercent ? `${formatInt(fillPercent)}%` : "—",
      testId: "owner-money-fill-percent",
    },
  ]), [
    pendingAmount,
    refundTotal,
    paidByTripDay,
    tickets,
    trips,
    fillPercent,
  ]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-xl font-extrabold tracking-tight">Деньги</div>
        <div className="flex items-center gap-2">
          {manualOn && (
            <div className="text-[11px] px-2 py-1 rounded-full border border-amber-500/50 text-amber-300 bg-amber-900/20">
              manual
            </div>
          )}
          <button
            type="button"
            onClick={onManualRefresh}
            className="rounded-2xl border border-neutral-800 bg-neutral-950/40 hover:bg-neutral-900/40 px-3 py-2 text-xs"
            disabled={isRefreshing || busy}
            title="Обновить"
          >
            {isRefreshing ? "Обновление..." : busy ? "..." : "Обновить"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-2 mb-2">
        <div className="flex gap-2 overflow-x-auto">
          <Chip active={preset === "today"} onClick={() => setPreset("today")} label="Сегодня" />
          <Chip active={preset === "yesterday"} onClick={() => setPreset("yesterday")} label="Вчера" />
          <Chip active={preset === "7d"} onClick={() => setPreset("7d")} label="7 дней" />
          <Chip active={preset === "30d"} onClick={() => setPreset("30d")} label="30 дней" />
          <Chip active={preset === "90d"} onClick={() => setPreset("90d")} label="90 дней" />
        </div>
      </div>

      {err && (
        <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200 mb-2">
          {err}
        </div>
      )}

      {decisionMetricsAvailable ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {topMetrics.map((metric) => (
            <MetricCard
              key={metric.testId}
              testId={metric.testId}
              label={OWNER_MONEY_TOP_LABEL_OVERRIDES[metric.testId] || metric.label}
              value={formatRUB(metric.value)}
              featured={metric.featured}
              tone={metric.tone}
            />
          ))}
        </div>
      ) : (
        <Card>
          <div className="text-sm font-semibold">Оперативные метрики денег дня доступны только для одного бизнес-дня</div>
          <div className="mt-1 text-xs text-neutral-500">
            Выбери `Сегодня` или `Вчера`, чтобы увидеть канонические 9 метрик из Shift Close без промежуточной фронтовой математики.
          </div>
        </Card>
      )}

      <div className="mt-2">
        <CollapsibleCard
          testId="owner-money-secondary-details"
          summaryTestId="owner-money-secondary-summary"
          title="Дополнительные метрики"
          subtitle="Ожидает оплаты, возвраты, заработано по дню рейса, билеты, рейсы, загрузка"
        >
          <div className="space-y-2">
            {secondaryDetailRows.map((row) => (
              <Row
                key={row.testId}
                testId={row.testId}
                label={row.label}
                value={row.value}
              />
            ))}
          </div>
        </CollapsibleCard>
      </div>

      {preset === "__legacy_owner_money__" && (
      <div className="mt-2 space-y-2">
        <CollapsibleCard
          title="Ожидает оплаты"
          subtitle='Pending по дате рейса и сколько уже собрано сегодня на будущие рейсы'
          defaultOpen={preset === "today"}
        >
          <div data-testid="owner-money-pending-total" className="text-2xl font-extrabold tracking-tight text-amber-300">
            {formatRUB(pendingAmount)}
          </div>
          <div className="mt-1 text-[10px] text-neutral-500">За рейсы в выбранном диапазоне</div>

          {preset === "today" && (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-neutral-500">По дням будущих рейсов</div>
                <div className="flex gap-1">
                  {[
                    { key: "tomorrow", label: "Завтра" },
                    { key: "day2", label: "Послезавтра" },
                  ].map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => setPendingDay(d.key)}
                      className={[
                        "px-2 py-1 rounded-xl border text-xs",
                        pendingDay === d.key
                          ? "border-amber-500 text-amber-300 bg-amber-900/10"
                          : "border-neutral-800 text-neutral-300 bg-neutral-950/30 hover:bg-neutral-900/40",
                      ].join(" ")}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {pendingLoading ? (
                <div className="mt-3 text-sm text-neutral-500">Загрузка…</div>
              ) : pendingData ? (
                <>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <MiniCard
                      label="Ожидает оплаты"
                      value={formatRUB(pendingData.sum ?? pendingData.sum_pending ?? pendingData.amount ?? pendingData.total ?? 0)}
                    />
                    <MiniCard label="Билетов" value={formatInt(pendingData.tickets ?? pendingData.tickets_count ?? 0)} />
                    <MiniCard label="Рейсов" value={formatInt(pendingData.trips ?? pendingData.trips_count ?? 0)} />
                  </div>

                  <div className="mt-3 rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-3">
                    <div className="text-[11px] text-neutral-500 mb-2">Заработано по дню рейса</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <MiniCard label="Итого" value={formatRUB(paidByTripDay.revenue || 0)} />
                      <MiniCard label="Наличными" value={formatRUB(paidByTripDay.cash || 0)} />
                      <MiniCard label="Картой" value={formatRUB(paidByTripDay.card || 0)} />
                    </div>
                  </div>

                  {pendingDay === "tomorrow" && (
                    <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3">
                      <div className="text-[11px] text-neutral-500 mb-2">Собрано сегодня на завтра</div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <MiniCard label="Итого" value={formatRUB(collectedToday.by_trip_day.tomorrow.revenue)} />
                        <MiniCard label="Наличными" value={formatRUB(collectedToday.by_trip_day.tomorrow.cash)} />
                        <MiniCard label="Картой" value={formatRUB(collectedToday.by_trip_day.tomorrow.card)} />
                      </div>
                    </div>
                  )}

                  {pendingDay === "day2" && (
                    <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3">
                      <div className="text-[11px] text-neutral-500 mb-2">Собрано сегодня на послезавтра</div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <MiniCard label="Итого" value={formatRUB(collectedToday.by_trip_day.day2.revenue)} />
                        <MiniCard label="Наличными" value={formatRUB(collectedToday.by_trip_day.day2.cash)} />
                        <MiniCard label="Картой" value={formatRUB(collectedToday.by_trip_day.day2.card)} />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-3 text-sm text-red-200">Ошибка загрузки pending</div>
              )}
            </div>
          )}
        </CollapsibleCard>

        <CollapsibleCard
          title="Возвраты И Выручка По Дню Рейса"
          subtitle="Вторичные cashflow и earned-метрики вне первого экрана"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Card>
              <div className="text-[11px] text-neutral-500">Возвраты за период</div>
              <div data-testid="owner-money-refund-total" className="mt-1 text-2xl font-extrabold tracking-tight text-red-400">
                {formatRUB(refundTotal)}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniCard label="Наличными" value={formatRUB(refundCash)} />
                <MiniCard label="Картой" value={formatRUB(refundCard)} />
              </div>
            </Card>

            <Card>
              <div className="text-[11px] text-neutral-500">Заработано по дню рейса</div>
              <div className="mt-1 text-2xl font-extrabold tracking-tight text-emerald-300">
                {formatRUB(paidByTripDay.revenue || 0)}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniCard label="Наличными" value={formatRUB(paidByTripDay.cash || 0)} />
                <MiniCard label="Картой" value={formatRUB(paidByTripDay.card || 0)} />
              </div>
            </Card>
          </div>
        </CollapsibleCard>

        <CollapsibleCard
          title="Билеты, Рейсы И Загрузка"
          subtitle="Операционные показатели вынесены из верхнего money-day блока"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <MiniCard testId="owner-money-tickets-total" label="Билеты" value={formatInt(tickets)} />
            <Pill testId="owner-money-trips-total" label="Рейсы" value={formatInt(trips)} />
            <Pill
              testId="owner-money-fill-percent"
              label="Загрузка"
              value={fillPercent ? `${formatInt(fillPercent)}%` : "—"}
              accent="amber"
            />
          </div>
        </CollapsibleCard>

        <CollapsibleCard title="Тренд По Дням" subtitle={`Собрано по дням: ${days.preset}`}>
          {bars.length === 0 || !hasAnyRevenue ? (
            <div className="text-sm text-neutral-500">Данные отсутствуют</div>
          ) : (
            <div className="flex items-end justify-center gap-2 h-[110px]">
              {bars.map((b) => (
                <div
                  key={b.day}
                  className={
                    bars.length === 1
                      ? "w-[56px] flex flex-col items-center gap-2"
                      : "flex-1 flex flex-col items-center gap-2"
                  }
                >
                  <div
                    className={[
                      "w-full rounded-md",
                      b.v < 35 ? "bg-red-900/70" : b.v < 60 ? "bg-amber-900/70" : "bg-emerald-900/70",
                    ].join(" ")}
                    style={{ height: `${Math.max(12, Math.round((b.v / 100) * 110))}px` }}
                    title={`${b.day}: ${formatRUB(b.revenue)}`}
                  />
                  <div className="text-[10px] text-neutral-500">{b.label}</div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleCard>

        <CollapsibleCard title="Внутренние Расчёты" subtitle="Канонический breakdown Shift Close и второстепенные money KPI">
          <div data-testid="owner-money-main-kpi-title" className="text-[13px] font-semibold text-neutral-100">
            {OWNER_MONEY_MAIN_KPI_TITLE}
          </div>
          <div data-testid="owner-money-main-kpi-formula" className="mt-1 text-[11px] text-neutral-300/90">
            {OWNER_MONEY_MAIN_KPI_FORMULA}
          </div>
          <div data-testid="owner-money-dispatcher-kpi-link" className="mt-1 text-[10px] text-neutral-400">
            Это = "сдать owner" у диспетчера.
          </div>

          <div className="mt-3 space-y-2">
            <Row label="Источник" value={ownerDecisionMetrics?.source || (manualOn ? "manual > online" : "online")} tone={manualOn ? "warn" : "neutral"} />
            <Row label="Диапазон" value={money.range?.from && money.range?.to ? `${money.range.from} → ${money.range.to}` : "—"} />
            <Row label="Чистый результат" value={formatRUB(netTotal)} tone={netTotal < 0 ? "neg" : "pos"} />
            <Row label="Чистыми наличными" value={formatRUB(netCash)} tone={netCash < 0 ? "neg" : "neutral"} />
            <Row label="Чистыми картой" value={formatRUB(netCard)} tone={netCard < 0 ? "neg" : "neutral"} />
            <Row label="Нал до резерва" value={formatRUB(ownerAvailableCashBeforeReserve)} />
            <Row label="Нал после резерва" value={formatRUB(ownerAvailableCashAfterReserve)} />
            <Row label="К выдаче зарплат" value={formatRUB(salaryToPay)} />
            <Row label="Забрать с продавцов" value={formatRUB(sellersCollectTotal)} />
            <Row label="Бонусы диспетчерам" value={formatRUB(fundsWithholdDispatcherBonusToday)} />
            <Row label="Округления в Season" value={formatRUB(fundsWithholdRoundingToSeasonToday)} />
            <Row label="Итого удержаний фондов" value={formatRUB(fundsWithholdTotalToday)} />
            <Row
              label="Комментарий"
              value={manualOn ? "Есть дни с ручным вводом" : ""}
              tone={manualOn ? "warn" : "neutral"}
              hideIfEmpty
            />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MiniCard testId="owner-money-available-before-reserve" label="Канонически до резерва" value={formatRUB(ownerAvailableCashBeforeReserve)} />
            <MiniCard testId="owner-money-available-after-reserve" label="Канонически после резерва" value={formatRUB(ownerAvailableCashAfterReserve)} />
            <MiniCard testId="owner-money-funds-dispatcher-bonus" label="Бонусы диспетчерам" value={formatRUB(fundsWithholdDispatcherBonusToday)} />
            <MiniCard testId="owner-money-funds-rounding" label="Округления в Season" value={formatRUB(fundsWithholdRoundingToSeasonToday)} />
            <MiniCard testId="owner-money-funds-total" label="Итого удержаний фондов" value={formatRUB(fundsWithholdTotalToday)} />
            <MiniCard testId="owner-money-funds-cash" label="Cash-часть удержаний" value={formatRUB(fundsWithholdCashToday)} />
          </div>

          <div className="mt-3">
            <MiniCard testId="owner-money-funds-card" label="Card-часть удержаний" value={formatRUB(fundsWithholdCardToday)} />
          </div>

          {showFundsCashOnlyHint && (
            <div data-testid="owner-money-funds-cash-only-hint" className="mt-2 text-[10px] text-neutral-400">
              {OWNER_MONEY_FUNDS_CASH_ONLY_HINT_TEXT}
            </div>
          )}

          {debugChecks.length > 0 && (
            <div className="mt-3 space-y-2">
              {debugChecks.map(([key, value]) => (
                <Row key={key} label={`check: ${key}`} value={formatRUB(value)} tone={Number(value) === 0 ? "neutral" : "warn"} />
              ))}
            </div>
          )}
        </CollapsibleCard>
      </div>
      )}
    </div>
  );
}

/* ---------- UI atoms ---------- */

function MetricCard({ label, value, testId, featured = false, tone = "neutral" }) {
  const valueCls =
    tone === "neg"
      ? "text-red-200"
      : tone === "accent"
      ? "text-cyan-200"
      : "text-neutral-100";

  return (
    <div
      data-testid={testId}
      className={[
        "rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3",
        "shadow-[0_10px_30px_rgba(0,0,0,0.35)]",
        featured ? "sm:col-span-2 xl:col-span-3" : "",
      ].join(" ")}
    >
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className={["mt-1 font-extrabold tracking-tight", featured ? "text-4xl" : "text-2xl", valueCls].join(" ")}>
        {value}
      </div>
    </div>
  );
}

function CollapsibleCard({ title, subtitle, defaultOpen = false, children, testId, summaryTestId }) {
  return (
    <details
      data-testid={testId}
      open={defaultOpen}
      className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
    >
      <summary data-testid={summaryTestId} className="flex cursor-pointer list-none items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {subtitle ? <div className="text-[11px] text-neutral-500">{subtitle}</div> : null}
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">details</div>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function Card({ children, className = "" }) {
  return (
    <div
      className={[
        "rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3",
        "shadow-[0_10px_30px_rgba(0,0,0,0.35)]",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function MiniCard({ label, value, testId }) {
  return (
    <div data-testid={testId} className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-extrabold tracking-tight">{value}</div>
    </div>
  );
}

function Pill({ label, value, accent, testId }) {
  const vCls =
    accent === "amber" ? "text-amber-300" : accent === "emerald" ? "text-emerald-300" : "text-neutral-100";
  return (
    <div data-testid={testId} className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-2 py-2">
      <div className="text-[10px] text-neutral-500">{label}</div>
      <div className={["mt-1 text-sm font-semibold", vCls].join(" ")}>{value}</div>
    </div>
  );
}

function Row({ label, value, tone, hideIfEmpty, testId }) {
  if (hideIfEmpty && !String(value || "").trim()) return null;
  const vCls =
    tone === "warn"
      ? "text-amber-300"
      : tone === "pos"
      ? "text-emerald-300"
      : tone === "neg"
      ? "text-red-300"
      : "text-neutral-200";
  return (
    <div data-testid={testId} className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)] flex items-center justify-between gap-3">
      <div className="text-sm text-neutral-400">{label}</div>
      <div className={["text-sm font-semibold whitespace-nowrap", vCls].join(" ")}>{value}</div>
    </div>
  );
}

function Chip({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "whitespace-nowrap px-3 py-2 rounded-2xl border text-sm",
        active ? "border-amber-500 text-amber-400 bg-neutral-950" : "border-neutral-800 text-neutral-300 bg-neutral-950/30 hover:bg-neutral-900/40",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
