/**
 * src/views/OwnerSellersView.jsx
 * OWNER — Продавцы (backend wired)
 *
 * API:
 *  - GET /api/owner/sellers?preset=
 * Polling: 20s
 */

import { useEffect, useMemo, useState } from "react";
import apiClient from "../utils/apiClient.js";

function formatRUB(v) {
  if (v === null || v === undefined) return "—";
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
  if (v === null || v === undefined) return "—";
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("ru-RU").format(Math.round(n));
  } catch {
    return String(Math.round(n));
  }
}

function formatShare(v) {
  if (v === null || v === undefined) return "—";
  return `${Math.round(v * 100)}%`;
}

async function ownerGet(url) {
  try {
    const json = await apiClient.request(url, { method: "GET" });
    if (!json || typeof json !== "object") {
      return { ok: false, data: null, meta: { warnings: ["invalid json"] } };
    }
    const warnings = Array.isArray(json?.meta?.warnings) ? json.meta.warnings : [];
    return { ok: !!json.ok, data: json.data || null, meta: { ...(json.meta || {}), warnings } };
  } catch (e) {
    return { ok: false, data: null, meta: { warnings: [e?.message || String(e)] } };
  }
}

export default function OwnerSellersView() {
  const [preset, setPreset] = useState("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState({
    totals: { revenue_paid: 0, revenue_pending: 0, revenue_forecast: 0 },
    items: [],
    range: null,
  });
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    let alive = true;

    async function load() {
      const q = encodeURIComponent(preset);
      const r = await ownerGet(`/owner/sellers?preset=${q}`);

      if (!alive) return;
      setLoading(false);

      if (!r.ok) {
        setError("Ошибка загрузки продавцов");
        console.error("[OwnerSellersView] load error:", r?.meta?.warnings || r);
        setWarnings(r?.meta?.warnings || []);
        return;
      }

      setError(null);
      setWarnings(r?.meta?.warnings || []);

      if (r.data) {
        setPayload({
          totals: r.data.totals || { revenue_paid: 0, revenue_pending: 0, revenue_forecast: 0 },
          items: Array.isArray(r.data.items) ? r.data.items : [],
          range: r.data.range || null,
        });
      } else {
        setPayload({
          totals: { revenue_paid: 0, revenue_pending: 0, revenue_forecast: 0 },
          items: [],
          range: null,
        });
      }
    }

    load();
    const t = setInterval(load, 20000);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [preset]);

  const activeSellers = payload.items.length;
  const avgPerSeller = useMemo(() => {
    const rev = Number(payload.totals.revenue_forecast || 0);
    if (!activeSellers) return 0;
    return Math.round(rev / activeSellers);
  }, [payload.totals.revenue_forecast, activeSellers]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xl font-extrabold tracking-tight">Продавцы</div>
        <div className="text-[11px] text-neutral-500">owner</div>
      </div>

      <SegmentedChips
        value={preset}
        onChange={setPreset}
        options={[
          { k: "today", t: "Сегодня" },
          { k: "yesterday", t: "Вчера" },
          { k: "7d", t: "7 дней" },
          { k: "month", t: "Месяц" },
          { k: "all", t: "Всё" },
        ]}
      />

      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200">
          <div className="font-semibold">Предупреждения</div>
          <ul className="mt-2 list-disc pl-5 space-y-1 text-amber-100/90">
            {warnings.slice(0, 5).map((w, i) => (
              <li key={i}>{String(w)}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Итоговая статистика */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          title="Прогноз (все)"
          value={formatRUB(payload.totals.revenue_forecast)}
          accent="emerald"
        />
        <StatCard title="Оплачено" value={formatRUB(payload.totals.revenue_paid)} />
        <StatCard title="Ожидает оплаты" value={formatRUB(payload.totals.revenue_pending)} />
        <StatCard title="Активных продавцов" value={formatInt(activeSellers)} />
      </div>

      {/* Список продавцов */}
      <div className="mt-4">
        <div className="text-sm font-semibold px-1 mb-3">Рейтинг по прогнозу</div>

        {loading && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-neutral-400">
            Загрузка...
          </div>
        )}

        {!loading && !error && payload.items.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-neutral-400">
            Нет данных за выбранный период
          </div>
        )}

        {!loading && !error && payload.items.length > 0 && (
          <div className="space-y-2">
            {payload.items.map((s, idx) => (
              <SellerCard
                key={s.seller_id}
                rank={idx + 1}
                seller={s}
                isTop3={idx < 3}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, accent }) {
  const vCls =
    accent === "amber"
      ? "text-amber-300"
      : accent === "emerald"
      ? "text-emerald-300"
      : "text-neutral-100";

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-[11px] text-neutral-500">{title}</div>
      <div className={["mt-1 text-lg font-extrabold tracking-tight", vCls].join(" ")}>{value}</div>
    </div>
  );
}

function SellerCard({ rank, seller, isTop3 }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={[
        "rounded-xl border p-3 transition-colors cursor-pointer",
        isTop3
          ? "border-amber-500/30 bg-amber-950/20 hover:bg-amber-950/30"
          : "border-white/10 bg-black/20 hover:bg-white/5",
      ].join(" ")}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header: Rank + Name + Forecast */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Rank badge */}
          <div
            className={[
              "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
              rank === 1
                ? "bg-amber-500 text-black"
                : rank === 2
                ? "bg-neutral-400 text-black"
                : rank === 3
                ? "bg-amber-700 text-white"
                : "bg-neutral-800 text-neutral-400",
            ].join(" ")}
          >
            {rank}
          </div>
          <div className="min-w-0">
            <div className="text-base font-bold truncate">
              {seller.seller_name || `Seller ${seller.seller_id}`}
            </div>
            {isTop3 && (
              <div className="text-[10px] text-amber-400 font-semibold">ТОП</div>
            )}
          </div>
        </div>

        {/* Forecast - main metric */}
        <div className="text-right shrink-0">
          <div className="text-[10px] text-neutral-500">Прогноз</div>
          <div className="text-lg font-extrabold tracking-tight text-emerald-300">
            {formatRUB(seller.revenue_forecast)}
          </div>
        </div>
      </div>

      {/* Quick stats row */}
      <div className="mt-2 flex items-center gap-4 text-xs text-neutral-400">
        <span>Оплачено: <span className="text-neutral-200 font-semibold">{formatRUB(seller.revenue_paid)}</span></span>
        <span>Pending: <span className="text-neutral-200">{formatRUB(seller.revenue_pending)}</span></span>
      </div>

      {/* Secondary stats: per-shift and share */}
      <div className="mt-1 flex items-center gap-4 text-xs text-neutral-500">
        <span>На смену: <span className="text-neutral-300">{formatRUB(seller.revenue_per_shift)}</span></span>
        <span>Доля: <span className="text-neutral-300">{formatShare(seller.share_percent)}</span></span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Билетов всего" value={formatInt(seller.tickets_total)} />
            <MiniStat label="Билетов оплачено" value={formatInt(seller.tickets_paid)} />
            <MiniStat label="Билетов pending" value={formatInt(seller.tickets_pending)} />
            <MiniStat label="Смен" value={formatInt(seller.shifts_count)} />
            <MiniStat label="Средний чек" value={formatRUB(seller.avg_check_paid)} />
          </div>
        </div>
      )}

      {/* Expand hint */}
      <div className="mt-2 text-[10px] text-neutral-600 text-right">
        {expanded ? "Свернуть" : "Подробнее"}
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-2">
      <div className="text-[10px] text-neutral-500">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function SegmentedChips({ options, value, onChange }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-1">
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.k}
            type="button"
            onClick={() => onChange(o.k)}
            className={[
              "rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
              value === o.k
                ? "bg-white/10 text-neutral-100 border border-white/10"
                : "bg-transparent text-neutral-400 hover:text-neutral-200",
            ].join(" ")}
          >
            {o.t}
          </button>
        ))}
      </div>
    </div>
  );
}
