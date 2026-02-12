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

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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
  // url must be WITHOUT the leading "/api" because apiClient prefixes it automatically.
  const res = await apiClient.request(url, { method: "GET" });

  // Normalization for different apiClient shapes:
  // 1) axios-like: { data: { data: {...}, meta: {...} } }
  // 2) fetch-like: { data: {...}, meta: {...} }
  // 3) (rare) double-wrapped: { data: { data: { data: {...}, meta: {...} } } }
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

export default function OwnerMoneyView({ onRegisterRefresh, onRegisterPendingRefresh }) {
  const { refreshOwnerData, refreshPendingByDay } = useOwnerData();
  const [preset, setPreset] = useState("today");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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

  // ===== Pending (future days) =====
  const [pendingDay, setPendingDay] = useState("tomorrow");

  // pendingData is now an object with keys: today, tomorrow, day2
  // Each key contains the data for that day
  const [pendingData, setPendingData] = useState({
    today: null,
    tomorrow: null,
    day2: null,
  });
  const [pendingLoading, setPendingLoading] = useState(false);
  
  // Ref for tracking refresh requests to prevent race conditions
  const refreshIdRef = useRef(0);

  const compareDaysPreset = useMemo(() => {
    if (preset === "30d") return "30d";
    if (preset === "90d") return "90d";
    return "7d";
  }, [preset]);

  const boatsPreset = useMemo(() => {
    // boats route supports today / yesterday / d7 / month / all (зависит от реализации backend)
    if (preset === "today") return "today";
    if (preset === "yesterday") return "yesterday";
    if (preset === "7d") return "d7";
    if (preset === "30d") return "month";
    if (preset === "90d") return "d30";
    if (preset === "last_nonzero_day") return "all";
    return "today";
  }, [preset]);

  const reload = async ({ silent } = {}) => {
    if (!silent) setBusy(true);
    setErr("");
    try {
      const [m, b, d] = await Promise.all([
        ownerGet(`/owner/money/summary?preset=${encodeURIComponent(preset)}`),
        ownerGet(`/owner/boats?preset=${encodeURIComponent(boatsPreset)}`),
        ownerGet(`/owner/money/compare-days?preset=${encodeURIComponent(compareDaysPreset)}`),
      ]);

      setMoney({
        preset: m?.data?.preset ?? preset,
        range: m?.data?.range ?? null,
        totals: m?.data?.totals ?? { revenue: 0, cash: 0, card: 0 },
        warnings: m?.meta?.warnings || [],
      });
      setBoats({
        preset: b?.data?.preset ?? boatsPreset,
        range: b?.data?.range ?? null,
        totals: b?.data?.totals ?? { revenue: 0, tickets: 0, trips: 0, fillPercent: 0 },
        warnings: b?.meta?.warnings || [],
      });
      setDays({
        preset: d?.data?.preset ?? compareDaysPreset,
        range: d?.data?.range ?? null,
        rows: d?.data?.rows ?? [],
        warnings: d?.meta?.warnings || [],
      });
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Ошибка загрузки");
    } finally {
      if (!silent) setBusy(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // Auto refresh when on today (light polling)
  useEffect(() => {
    if (preset !== "today") return;
    const t = setInterval(() => reload({ silent: true }), 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // Register reload function with parent for context-based refresh
  useEffect(() => {
    if (onRegisterRefresh) {
      onRegisterRefresh(() => reload({ silent: false }));
    }
  }, [onRegisterRefresh]);

  // Register pending reload function with parent for context-based refresh
  useEffect(() => {
    if (onRegisterPendingRefresh) {
      onRegisterPendingRefresh(async (affectedDays) => {
        console.log('[onRegisterPendingRefresh] called with:', affectedDays);
        refreshIdRef.current += 1;
        const batchRid = refreshIdRef.current;
        
        if (affectedDays && Array.isArray(affectedDays)) {
          const validDays = ['today', 'tomorrow', 'day2'];
          const days = Array.from(new Set(affectedDays.filter(d => validDays.includes(d))));
          console.log('[onRegisterPendingRefresh] rid=', batchRid, 'days=', days);
          await Promise.all(days.map(day => loadPendingForDay(day, batchRid)));
        } else {
          // Reload current day if no specific days provided
          await loadPendingForDay(pendingDay, batchRid);
        }
      });
    }
  }, [onRegisterPendingRefresh, pendingDay]);

  // Listen for owner:refresh-pending events from other components
  useEffect(() => {
    const handleRefreshPending = async (event) => {
      const affectedDays = event?.detail?.days;
      console.log('[handleRefreshPending] EVENT received raw:', affectedDays);
      
      if (affectedDays && Array.isArray(affectedDays)) {
        // affectedDays now contains normalized day keys: 'today', 'tomorrow', 'day2'
        // Filter to only valid days and deduplicate
        const validDays = ['today', 'tomorrow', 'day2'];
        const normalizedDays = Array.from(new Set(affectedDays.filter(d => validDays.includes(d))));
        
        console.log('[handleRefreshPending] normalized:', normalizedDays);
        
        // Increment batch RID once for this refresh operation
        refreshIdRef.current += 1;
        const batchRid = refreshIdRef.current;
        console.log('[handleRefreshPending] batch rid=', batchRid, 'days=', normalizedDays);
        
        // Load ALL affected days in parallel using Promise.all
        // This ensures both old and new day data are updated
        await Promise.all(normalizedDays.map(day => loadPendingForDay(day, batchRid)));
        
        console.log('[handleRefreshPending] COMPLETE rid=', batchRid);
        
        // Also reload current view if it's not in affected days (safety)
        if (!normalizedDays.includes(pendingDay)) {
          console.log('[handleRefreshPending] Also reloading current view:', pendingDay);
          await loadPendingForDay(pendingDay, batchRid);
        }
      } else {
        // No specific days provided, just reload current view
        console.log('[handleRefreshPending] No days provided, reloading current:', pendingDay);
        refreshIdRef.current += 1;
        await loadPendingForDay(pendingDay, refreshIdRef.current);
      }
    };
    
    // Also listen for general owner data refresh events
    const handleRefreshData = async () => {
      console.log('[handleRefreshData] EVENT received');
      refreshIdRef.current += 1;
      const batchRid = refreshIdRef.current;
      console.log('[handleRefreshData] batch rid=', batchRid);
      // Reload all days in parallel
      await Promise.all(['today', 'tomorrow', 'day2'].map(day => loadPendingForDay(day, batchRid)));
      console.log('[handleRefreshData] COMPLETE rid=', batchRid);
    };
    
    window.addEventListener('owner:refresh-pending', handleRefreshPending);
    window.addEventListener('owner:refresh-data', handleRefreshData);
    return () => {
      window.removeEventListener('owner:refresh-pending', handleRefreshPending);
      window.removeEventListener('owner:refresh-data', handleRefreshData);
    };
  }, [pendingDay]);

  // Helper function to load pending for a specific day
  // rid is passed from batch refresh to prevent race conditions
  const loadPendingForDay = async (day, rid) => {
    console.log('[loadPendingForDay] START day=', day, 'rid=', rid);
    setPendingLoading(true);
    
    try {
      const res = await ownerGet(
        `/owner/money/pending-by-day?day=${encodeURIComponent(day)}`
      );
      
      // Check if this request is still relevant (no newer batch started)
      if (rid !== refreshIdRef.current) {
        console.log('[loadPendingForDay] STALE rid=', rid, 'current=', refreshIdRef.current, 'ignoring');
        return;
      }
      
      const newData = res?.data ?? null;
      console.log('[loadPendingForDay] RECEIVED day=', day, 'rid=', rid, 'data=', newData);
      
      // Write to state using functional update to avoid race conditions
      setPendingData(prev => {
        const next = { ...prev, [day]: newData };
        console.log('[setPendingData] WRITE key=', day, 'rid=', rid, 'data=', newData);
        return next;
      });
    } catch (e) {
      console.error('[loadPendingForDay] ERROR day=', day, 'rid=', rid, 'error=', e);
      setPendingData(prev => ({ ...prev, [day]: { _error: e?.message, _timestamp: Date.now() } }));
    } finally {
      setPendingLoading(false);
      console.log('[loadPendingForDay] END day=', day, 'rid=', rid);
    }
  };

  // Load pending by business day (separate from revenue day)
  useEffect(() => {
    console.log('[OwnerMoneyView] Initial load for pendingDay:', pendingDay);
    refreshIdRef.current += 1;
    loadPendingForDay(pendingDay, refreshIdRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDay]);

  const manualOn = useMemo(() => {
    const all = [
      ...(money.warnings || []),
      ...(boats.warnings || []),
      ...(days.warnings || []),
    ].join("\n");
    return all.toLowerCase().includes("manual override");
  }, [money.warnings, boats.warnings, days.warnings]);

  const revenue = Number(money.totals?.revenue || 0);
  const cash = Number(money.totals?.cash || 0);
  const card = Number(money.totals?.card || 0);
  const pendingFromApi = money.totals?.pending;

  // "Ожидает оплаты" = продано, но оплата ещё не зафиксирована
  // Показываем ТОЛЬКО для "Сегодня", для остальных пресетов = 0
  const awaitingPaymentRaw =
    pendingFromApi !== undefined && pendingFromApi !== null
      ? Number(pendingFromApi || 0)
      : revenue - (cash + card);
  const isToday = preset === "today";
  const awaitingPayment = isToday ? Math.max(awaitingPaymentRaw, 0) : 0;

  const tickets = Number(boats.totals?.tickets || 0);
  const trips = Number(boats.totals?.trips || 0);
  const fillPercent = Number(boats.totals?.fillPercent || 0);
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
            onClick={() => reload()}
            className="rounded-2xl border border-neutral-800 bg-neutral-950/40 hover:bg-neutral-900/40 px-3 py-2 text-xs"
            disabled={busy}
            title="Обновить"
          >
            {busy ? "..." : "Обновить"}
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
          <Chip
            active={preset === "last_nonzero_day"}
            onClick={() => setPreset("last_nonzero_day")}
            label="Последний день с выручкой"
          />
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
              <div className="text-[11px] text-neutral-500">Выручка</div>
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

          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniCard label="Наличные" value={formatRUB(cash)} />
            <MiniCard label="Карта" value={formatRUB(card)} />
            <MiniCard label="Ожидает оплаты" value={formatRUB(awaitingPayment)} />
          </div>
        </Card>
      </div>

      {/* Pending (today / tomorrow / day2) — показываем только для "Сегодня" */}
      {preset === "today" && (
      <Card className="mt-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Ожидает оплаты (по дате рейса)</div>
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
        ) : pendingData[pendingDay] ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniCard
              label="Сумма"
              value={formatRUB(pendingData[pendingDay].sum ?? pendingData[pendingDay].sum_pending ?? pendingData[pendingDay].amount ?? pendingData[pendingDay].total ?? 0)}
            />
            <MiniCard label="Билетов" value={formatInt(pendingData[pendingDay].tickets ?? pendingData[pendingDay].tickets_count ?? 0)} />
            <MiniCard label="Рейсов" value={formatInt(pendingData[pendingDay].trips ?? pendingData[pendingDay].trips_count ?? 0)} />
          </div>
        ) : (
          <div className="mt-3 text-sm text-red-200">Ошибка загрузки pending</div>
        )}
      </Card>
      )}

      {/* Week bars */}
      <Card className="mt-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Выручка по дням</div>
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
