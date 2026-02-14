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

function maxOf(arr, pick) {
  let m = 0;
  for (const x of arr || []) {
    const v = Number(pick(x) || 0);
    if (v > m) m = v;
  }
  return m;
}

export default function OwnerMoneyView() {
  // Get pending data from global context (TanStack Query pattern)
  const { pendingByDay, pendingLoading, refreshPendingByDays, refreshAllMoneyData, registerRefreshCallback } = useOwnerData();
  
  const [preset, setPreset] = useState("today");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pendingDay, setPendingDay] = useState("tomorrow");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [money, setMoney] = useState({
    preset: "today",
    range: null,
    totals: { revenue: 0, cash: 0, card: 0 },
    warnings: [],
  });
  const [boats, setBoats] = useState({
    preset: "today",
    range: null,
    totals: { revenue: 0, tickets: 0, trips: 0, fillPercent: 0 },
    warnings: [],
  });
  const [days, setDays] = useState({
    preset: "7d",
    range: null,
    rows: [],
    warnings: [],
  });
  const [collectedToday, setCollectedToday] = useState({
    collected_day: 'today',
    by_trip_day: {
      today: { revenue: 0, cash: 0, card: 0 },
      tomorrow: { revenue: 0, cash: 0, card: 0 },
      day2: { revenue: 0, cash: 0, card: 0 },
    },
  });

  const compareDaysPreset = useMemo(() => {
    if (preset === "30d") return "30d";
    if (preset === "90d") return "90d";
    return "7d";
  }, [preset]);

  const reload = useCallback(async ({ silent } = {}) => {
    if (!silent) setBusy(true);
    setErr("");
    try {
      const [m, d, c] = await Promise.all([
        ownerGet(`/owner/money/summary?preset=${encodeURIComponent(preset)}`),
        ownerGet(`/owner/money/compare-days?preset=${encodeURIComponent(compareDaysPreset)}`),
        ownerGet('/owner/money/collected-today-by-tripday'),
      ]);

      setMoney({
        preset: m?.data?.preset ?? preset,
        range: m?.data?.range ?? null,
        totals: m?.data?.totals ?? { collected_total: 0, collected_cash: 0, collected_card: 0, tickets: 0, trips: 0, fillPercent: 0 },
        warnings: m?.meta?.warnings || [],
      });
      setBoats({
        preset: preset,
        range: null,
        totals: {
          revenue: m?.data?.totals?.collected_total ?? 0,
          tickets: m?.data?.totals?.tickets ?? 0,
          trips: m?.data?.totals?.trips ?? 0,
          fillPercent: m?.data?.totals?.fillPercent ?? 0,
        },
        warnings: [],
      });
      setDays({
        preset: d?.data?.preset ?? compareDaysPreset,
        range: d?.data?.range ?? null,
        rows: d?.data?.rows ?? [],
        warnings: d?.meta?.warnings || [],
      });
      setCollectedToday({
        collected_day: c?.data?.collected_day ?? 'today',
        by_trip_day: c?.data?.by_trip_day ?? {
          today: { revenue: 0, cash: 0, card: 0 },
          tomorrow: { revenue: 0, cash: 0, card: 0 },
          day2: { revenue: 0, cash: 0, card: 0 },
        },
      });
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Ошибка загрузки");
    } finally {
      if (!silent) setBusy(false);
    }
  }, [preset, compareDaysPreset]);

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
      await refreshPendingByDays(['today', 'tomorrow', 'day2'], 'poll-20s');
    };

    const t = setInterval(poll, 20000);
    return () => clearInterval(t);
  }, [preset, isRefreshing, reload, refreshPendingByDays]);

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

  // Load pending for selected day on mount and day change
  useEffect(() => {
    refreshPendingByDays([pendingDay], 'pendingDay-change');
  }, [pendingDay, refreshPendingByDays]);

  // Fallback: listen for CustomEvent (for cases outside context)
  useEffect(() => {
    const handleRefreshPending = (event) => {
      const raw = event?.detail?.days ?? event?.detail?.affectedDays ?? event?.detail?.day;
      const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      const allowedDays = ['today', 'tomorrow', 'day2'];
      const valid = [...new Set(arr)].filter(d => allowedDays.includes(d));
      const daysToLoad = valid.length > 0 ? valid : ['today', 'tomorrow'];
      refreshPendingByDays(daysToLoad, 'CustomEvent:fallback');
    };
    window.addEventListener('owner:refresh-pending', handleRefreshPending);
    return () => window.removeEventListener('owner:refresh-pending', handleRefreshPending);
  }, [refreshPendingByDays]);

  // Get current pending data from context
  const pendingData = pendingByDay[pendingDay];

  const manualOn = useMemo(() => {
    const all = [
      ...(money.warnings || []),
      ...(boats.warnings || []),
      ...(days.warnings || []),
    ].join("\n");
    return all.toLowerCase().includes("manual override");
  }, [money.warnings, boats.warnings, days.warnings]);

  const revenue = Number(money.totals?.collected_total || money.totals?.revenue || 0);
  const cash = Number(money.totals?.collected_cash || money.totals?.cash || 0);
  const card = Number(money.totals?.collected_card || money.totals?.card || 0);

  const tickets = Number(money.totals?.tickets || boats.totals?.tickets || 0);
  const trips = Number(money.totals?.trips || boats.totals?.trips || 0);
  const fillPercent = Number(money.totals?.fillPercent || boats.totals?.fillPercent || 0);
  const avgCheck = tickets > 0 ? Math.round(revenue / tickets) : 0;

  const bars = useMemo(() => {
    const rows = (days.rows || []).slice(-7);
    const maxRev = maxOf(rows, (r) => r.revenue);
    return rows.map((r) => {
      const rev = Number(r.revenue || 0);
      const v = maxRev > 0 ? Math.round((rev / maxRev) * 100) : 0;
      const label = String(r.day || "").slice(5); // MM-DD
      return { day: r.day, v, label, revenue: rev };
    });
  }, [days.rows]);

  const hasAnyRevenue = useMemo(() => {
    return (days.rows || []).some((r) => Number(r?.revenue || 0) >= 1);
  }, [days.rows]);

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

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-2">
        <Card className="col-span-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] text-neutral-500">Собрано денег</div>
              <div className="mt-1 text-3xl font-extrabold tracking-tight">{formatRUB(revenue)}</div>
              <div className="mt-1 text-sm text-neutral-400">Средний чек: {formatRUB(avgCheck)}</div>
            </div>
            <div className="text-[11px] text-neutral-500 text-right">
              {money.range?.from && money.range?.to ? (
                <>
                  <div>{money.range.from}</div>
                  <div>→ {money.range.to}</div>
                </>
              ) : (
                <div>диапазон</div>
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Pill label="Билетов" value={formatInt(tickets)} />
            <Pill label="Рейсов" value={formatInt(trips)} />
            <Pill label="Загрузка" value={fillPercent ? `${formatInt(fillPercent)}%` : "—"} accent="amber" />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniCard label="Наличные" value={formatRUB(cash)} />
            <MiniCard label="Карта" value={formatRUB(card)} />
          </div>
        </Card>
      </div>

      {/* Pending (today / tomorrow / day2) — показываем только для "Сегодня" */}
      {preset === "today" && (
      <Card className="mt-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Ожидает оплаты (по дате рейса)</div>
            <div className="text-[10px] text-neutral-500">По дате рейса (business_day), не по дате оплаты</div>
          </div>
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
            <div className="mt-3 grid grid-cols-3 gap-2">
              <MiniCard
                label="Сумма"
                value={formatRUB(pendingData.sum ?? pendingData.sum_pending ?? pendingData.amount ?? pendingData.total ?? 0)}
              />
              <MiniCard label="Билетов" value={formatInt(pendingData.tickets ?? pendingData.tickets_count ?? 0)} />
              <MiniCard label="Рейсов" value={formatInt(pendingData.trips ?? pendingData.trips_count ?? 0)} />
            </div>
            {/* Оплачено на завтра (собрано сегодня) */}
            {pendingDay === 'tomorrow' && (
              <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="text-[11px] text-neutral-500 mb-2">Оплачено на завтра (собрано сегодня)</div>
                <div className="grid grid-cols-3 gap-2">
                  <MiniCard label="Итого" value={formatRUB(collectedToday.by_trip_day.tomorrow.revenue)} />
                  <MiniCard label="Наличные" value={formatRUB(collectedToday.by_trip_day.tomorrow.cash)} />
                  <MiniCard label="Карта" value={formatRUB(collectedToday.by_trip_day.tomorrow.card)} />
                </div>
              </div>
            )}
            {/* Оплачено на послезавтра (собрано сегодня) */}
            {pendingDay === 'day2' && (
              <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="text-[11px] text-neutral-500 mb-2">Оплачено на послезавтра (собрано сегодня)</div>
                <div className="grid grid-cols-3 gap-2">
                  <MiniCard label="Итого" value={formatRUB(collectedToday.by_trip_day.day2.revenue)} />
                  <MiniCard label="Наличные" value={formatRUB(collectedToday.by_trip_day.day2.cash)} />
                  <MiniCard label="Карта" value={formatRUB(collectedToday.by_trip_day.day2.card)} />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="mt-3 text-sm text-red-200">Ошибка загрузки pending</div>
        )}
      </Card>
      )}

      {/* Week bars */}
      <Card className="mt-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Собрано по дням</div>
          <div className="text-[11px] text-neutral-500">{days.preset}</div>
        </div>

        {bars.length === 0 || !hasAnyRevenue ? (
          <div className="mt-3 text-sm text-neutral-500">Данные отсутствуют</div>
        ) : (
          <div className="mt-3 flex items-end justify-center gap-2 h-[110px]">
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
      </Card>

      {/* Notes */}
      <div className="mt-2 space-y-2">
        <Row label="Источник" value={manualOn ? "manual > online" : "online"} tone={manualOn ? "warn" : "neutral"} />
        <Row
          label="Комментарий"
          value={manualOn ? "Есть дни с ручным вводом" : ""}
          tone={manualOn ? "warn" : "neutral"}
          hideIfEmpty
        />
      </div>
    </div>
  );
}

/* ---------- UI atoms ---------- */

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

function MiniCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-extrabold tracking-tight">{value}</div>
    </div>
  );
}

function Pill({ label, value, accent }) {
  const vCls =
    accent === "amber" ? "text-amber-300" : accent === "emerald" ? "text-emerald-300" : "text-neutral-100";
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-2 py-2">
      <div className="text-[10px] text-neutral-500">{label}</div>
      <div className={["mt-1 text-sm font-semibold", vCls].join(" ")}>{value}</div>
    </div>
  );
}

function Row({ label, value, tone, hideIfEmpty }) {
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
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)] flex items-center justify-between gap-3">
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
