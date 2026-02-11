/**
 * src/views/OwnerBoatsView.jsx
 * OWNER — Лодки (backend wired)
 *
 * API:
 *  - GET /api/owner/boats?preset=
 * Polling: 20s
 */

import { useEffect, useMemo, useState } from "react";

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
    const res = await fetch(url, { credentials: "include" });
    const json = await res.json().catch(() => null);
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
  const [payload, setPayload] = useState({
    totals: { revenue: 0, tickets: 0, trips: 0, fillPercent: 0 },
    boats: [],
    range: null,
  });
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    let alive = true;

    async function load() {
      const q = encodeURIComponent(preset);
      const r = await ownerGet(`/api/owner/boats?preset=${q}`);

      if (!alive) return;
      setLoading(false);
      setWarnings(r?.meta?.warnings || []);

      if (r.ok && r.data) {
        setPayload({
          totals: r.data.totals || { revenue: 0, tickets: 0, trips: 0, fillPercent: 0 },
          boats: Array.isArray(r.data.boats) ? r.data.boats : [],
          range: r.data.range || null,
        });
      } else {
        setPayload({
          totals: { revenue: 0, tickets: 0, trips: 0, fillPercent: 0 },
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
        <div className="mt-2 rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 text-xs text-amber-200">
          <div className="font-semibold">Предупреждения</div>
          <ul className="mt-2 list-disc pl-5 space-y-1 text-amber-100/90">
            {warnings.slice(0, 5).map((w, i) => (
              <li key={i}>{String(w)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-2">
        <StatCard title="Выручка" value={formatRUB(payload.totals.revenue)} />
        <StatCard title="Билетов" value={formatInt(payload.totals.tickets)} />
        <StatCard title="Рейсов" value={formatInt(payload.totals.trips)} />
        <StatCard title="Загрузка" value={`${Number(payload.totals.fillPercent || 0)}%`} accent="amber" />
      </div>

      <div className="mt-3 space-y-2">
        <div className="text-sm font-semibold px-1">Детализация</div>

        {loading && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 text-sm text-neutral-400">
            Загрузка...
          </div>
        )}

        {!loading && grouped.length === 0 && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 text-sm text-neutral-400">
            Нет данных
          </div>
        )}

        {grouped.map((g) => (
          <Group key={g.type} title={g.type} subtitle={`${formatRUB(g.totals.revenue)} · билетов ${formatInt(g.totals.tickets)} · рейсов ${formatInt(g.totals.trips)}`}>
            {g.boats.map((b) => (
              <DetailRow
                key={b.boat_id}
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

function StatCard({ title, value, accent }) {
  const vCls =
    accent === "amber"
      ? "text-amber-300"
      : accent === "emerald"
      ? "text-emerald-300"
      : "text-neutral-100";

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
      <div className="text-[11px] text-neutral-500">{title}</div>
      <div className={["mt-1 text-lg font-extrabold tracking-tight", vCls].join(" ")}>{value}</div>
    </div>
  );
}

function SegmentedChips({ options, value, onChange }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-1">
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.k}
            type="button"
            onClick={() => onChange(o.k)}
            className={[
              "rounded-xl px-3 py-2 text-xs font-semibold",
              value === o.k
                ? "bg-neutral-900 text-neutral-100 border border-neutral-700"
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
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 shadow-[0_10px_30px_rgba(0,0,0,0.25)] overflow-hidden">
      <div className="px-3 py-3 border-b border-neutral-800">
        <div className="text-sm font-semibold text-neutral-200">{title}</div>
        {subtitle && <div className="text-[11px] text-neutral-500 mt-1">{subtitle}</div>}
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({ name, value, sub }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/30 p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-neutral-200 truncate">{name}</div>
        {sub && <div className="text-[11px] text-neutral-500 mt-1">{sub}</div>}
      </div>
      <div className="text-sm font-extrabold tracking-tight whitespace-nowrap">{value}</div>
    </div>
  );
}
