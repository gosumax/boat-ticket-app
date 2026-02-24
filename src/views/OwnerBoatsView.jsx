/**
 * src/views/OwnerBoatsView.jsx
 * OWNER — Лодки (backend wired)
 *
 * API:
 *  - GET /api/owner/boats?preset=
 * Polling: 20s
 */

import { Children, useEffect, useMemo, useState } from "react";
import apiClient from "../utils/apiClient.js";

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
    return new Intl.NumberFormat("ru-RU").format(Math.round(n));
  } catch {
    return String(Math.round(n));
  }
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

export default function OwnerBoatsView() {
  const [preset, setPreset] = useState("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState({
    totals: { revenue: 0, tickets: 0, trips: 0, fillPercent: null },
    boats: [],
    range: null,
  });
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    let alive = true;

    async function load() {
      const q = encodeURIComponent(preset);
      const r = await ownerGet(`/owner/boats?preset=${q}`);

      if (!alive) return;
      setLoading(false);

      if (!r.ok) {
        setError('Ошибка загрузки статистики лодок');
        console.error('[OwnerBoatsView] load error:', r?.meta?.warnings || r);
        setWarnings(r?.meta?.warnings || []);
        return;
      }

      setError(null);
      setWarnings(r?.meta?.warnings || []);

      if (r.data) {
        const totals = r.data.totals || { revenue: 0, tickets: 0, trips: 0 };
        // fillPercent может быть null если данных нет
        const fillPercent = totals.fillPercent !== undefined && totals.fillPercent !== null
          ? Math.max(0, Math.min(100, Number(totals.fillPercent) || 0))
          : null;

        setPayload({
          totals: { ...totals, fillPercent },
          boats: Array.isArray(r.data.boats) ? r.data.boats : [],
          range: r.data.range || null,
        });
      } else {
        setPayload({
          totals: { revenue: 0, tickets: 0, trips: 0, fillPercent: null },
          boats: [],
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

  const grouped = useMemo(() => {
    const byType = new Map();
    for (const b of payload.boats || []) {
      const t = (b.boat_type || "").trim() || "Без типа";
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(b);
    }
    return Array.from(byType.entries()).map(([type, boats]) => ({
      type,
      boats,
      totals: boats.reduce(
        (acc, x) => {
          acc.revenue += Number(x.revenue || 0);
          acc.tickets += Number(x.tickets || 0);
          acc.trips += Number(x.trips || 0);
          return acc;
        },
        { revenue: 0, tickets: 0, trips: 0 }
      ),
    }));
  }, [payload.boats]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xl font-extrabold tracking-tight">Лодки</div>
        <div className="text-[11px] text-neutral-500">owner</div>
      </div>

      <div className="mt-2">
        <SegmentedChips
          value={preset}
          onChange={setPreset}
          options={[
            { k: "today", t: "Сегодня" },
            { k: "yesterday", t: "Вчера" },
            { k: "d7", t: "7 дней" },
            { k: "month", t: "Месяц" },
            { k: "all", t: "Всё" },
          ]}
        />
      </div>

      {warnings.length > 0 && (
        <div className="mt-2 rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200">
          <div className="font-semibold">Предупреждения</div>
          <ul className="mt-2 list-disc pl-5 space-y-1 text-amber-100/90">
            {warnings.slice(0, 5).map((w, i) => (
              <li key={i}>{String(w)}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-2">
        <StatCard testId="owner-boats-total-revenue" title="Выручка" value={formatRUB(payload.totals.revenue)} />
        <StatCard testId="owner-boats-total-tickets" title="Билетов" value={formatInt(payload.totals.tickets)} />
        <StatCard testId="owner-boats-total-trips" title="Рейсов" value={formatInt(payload.totals.trips)} />
        <StatCard
          testId="owner-boats-total-fill"
          title="Загрузка"
          value={payload.totals.fillPercent !== null ? `${payload.totals.fillPercent}%` : '—'}
          accent="amber"
        />
      </div>

      <div className="mt-4">
        <div className="text-sm font-semibold px-1 mb-3">Детализация</div>

        {loading && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-neutral-400">
            Загрузка...
          </div>
        )}

        {!loading && !error && grouped.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-neutral-400">
            Нет данных за выбранный период
          </div>
        )}

        {grouped.map((g) => (
          <Group key={g.type} title={g.type} subtitle={`${formatRUB(g.totals.revenue)} · билетов ${formatInt(g.totals.tickets)} · рейсов ${formatInt(g.totals.trips)}`}>
            {g.boats.map((b) => (
              <DetailRow
                key={b.boat_id}
                testId={`owner-boats-row-${b.boat_id}`}
                name={b.boat_name || `boat#${b.boat_id}`}
                value={formatRUB(b.revenue)}
                sub={`Билетов: ${formatInt(b.tickets)} · Рейсов: ${formatInt(b.trips)} · ${b.source || "none"}`}
              />
            ))}
          </Group>
        ))}
      </div>
    </div>
  );
}

function StatCard({ title, value, accent, testId }) {
  const vCls =
    accent === "amber"
      ? "text-amber-300"
      : accent === "emerald"
      ? "text-emerald-300"
      : "text-neutral-100";

  return (
    <div data-testid={testId} className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-[11px] text-neutral-500">{title}</div>
      <div className={["mt-1 text-lg font-extrabold tracking-tight", vCls].join(" ")}>{value}</div>
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

function Group({ title, subtitle, children }) {
  const typeLabelMap = {
    speed: 'Скоростные',
    cruise: 'Прогулочные',
    banana: 'Банан',
  };
  const typeLabel = typeLabelMap[title?.toLowerCase()] || title || 'Без типа';
  const hasChildren = Children.count(children) > 0;

  return (
    <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-4 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="px-3 py-1 rounded-full text-xs font-semibold tracking-wide bg-white/10 border border-white/10">
          {typeLabel}
        </div>
        {subtitle && (
          <div className="px-3 py-1 rounded-lg bg-white/10 border border-white/10 text-sm font-semibold text-white/90">
            {subtitle}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="mt-3 mb-3 border-t border-white/10" />

      {/* Content */}
      {hasChildren ? (
        <div className="space-y-3">{children}</div>
      ) : (
        <div className="text-sm text-white/50 py-2">
          Нет лодок этого типа за выбранный период
        </div>
      )}
    </div>
  );
}

function DetailRow({ name, value, sub, testId }) {
  return (
    <div data-testid={testId} className="rounded-xl border border-white/10 bg-black/20 p-3 flex items-center justify-between gap-3 hover:bg-white/5 hover:border-white/20 transition-colors">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-neutral-200 truncate">{name}</div>
        {sub && <div className="text-sm text-white/70 mt-1 leading-tight">{sub}</div>}
      </div>
      <div className="text-sm font-extrabold tracking-tight whitespace-nowrap">{value}</div>
    </div>
  );
}
