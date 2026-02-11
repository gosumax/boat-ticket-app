/**
 * src/views/OwnerSellersView.jsx
 * OWNER — Продавцы (backend wired)
 *
 * API:
 *  - GET /api/owner/sellers?preset=
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

export default function OwnerSellersView() {
  const [preset, setPreset] = useState("today");
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState({ totals: { revenue: 0, tickets: 0 }, sellers: [], range: null });
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    let alive = true;

    async function load() {
      const q = encodeURIComponent(preset);
      const r = await ownerGet(`/api/owner/sellers?preset=${q}`);

      if (!alive) return;
      setLoading(false);
      setWarnings(r?.meta?.warnings || []);

      if (r.ok && r.data) {
        setPayload({
          totals: r.data.totals || { revenue: 0, tickets: 0 },
          sellers: Array.isArray(r.data.sellers) ? r.data.sellers : [],
          range: r.data.range || null,
        });
      } else {
        setPayload({ totals: { revenue: 0, tickets: 0 }, sellers: [], range: null });
      }
    }

    load();
    const t = setInterval(load, 20000);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [preset]);

  const activeSellers = payload.sellers.length;
  const avgPerSeller = useMemo(() => {
    const rev = Number(payload.totals.revenue || 0);
    if (!activeSellers) return 0;
    return Math.round(rev / activeSellers);
  }, [payload.totals.revenue, activeSellers]);

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
          { k: "d7", t: "7 дней" },
          { k: "month", t: "Месяц" },
        ]}
      />

      {warnings.length > 0 && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 text-xs text-amber-200">
          <div className="font-semibold">Предупреждения</div>
          <ul className="mt-2 list-disc pl-5 space-y-1 text-amber-100/90">
            {warnings.slice(0, 5).map((w, i) => (
              <li key={i}>{String(w)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Card className="col-span-2" title="Выручка всеми продавцами" value={formatRUB(payload.totals.revenue)} />
        <Card title="Средняя выручка на продавца" value={formatRUB(avgPerSeller)} />
        <Card title="Активных продавцов" value={formatInt(activeSellers)} />
      </div>

      <div className="space-y-3">
        <div className="text-sm font-semibold text-neutral-100 px-1">Эффективность</div>

        {loading && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 text-sm text-neutral-400">
            Загрузка...
          </div>
        )}

        {!loading && payload.sellers.length === 0 && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 text-sm text-neutral-400">
            Нет данных
          </div>
        )}

        {payload.sellers.map((s) => (
          <details
            key={s.seller_id}
            className="group rounded-2xl border border-neutral-800 bg-neutral-950/40 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
          >
            <summary className="cursor-pointer select-none list-none px-3 py-3 [&::-webkit-details-marker]:hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-extrabold tracking-tight truncate">
                    {s.seller_name || `seller#${s.seller_id}`}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">Источник: {s.source || "none"}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-neutral-500">Выручка</div>
                  <div className="text-lg font-extrabold tracking-tight">{formatRUB(s.revenue)}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end">
                <div className="text-xs text-neutral-500 group-open:hidden">Нажмите, чтобы раскрыть</div>
                <div className="text-xs text-neutral-500 hidden group-open:block">Свернуть</div>
              </div>
            </summary>

            <div className="px-4 pb-4 pt-0 border-t border-neutral-800">
              <div className="grid grid-cols-2 gap-3 mt-4">
                <MiniStat label="Продано билетов" value={formatInt(s.tickets)} />
                <MiniStat label="ID продавца" value={formatInt(s.seller_id)} />
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function Card({ title, value, className = "" }) {
  return (
    <div
      className={`rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)] ${className}`}
    >
      <div className="text-[11px] text-neutral-500">{title}</div>
      <div className="mt-1 text-lg font-extrabold tracking-tight">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/30 p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="font-semibold mt-1">{value}</div>
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
