/**
 * src/views/OwnerMotivationView.jsx
 * OWNER — Мотивация (backend wired)
 *
 * API:
 *  - GET /api/owner/motivation/day?day=YYYY-MM-DD
 * Polling: 30s (only for today)
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

function ymdTodayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function OwnerMotivationView() {
  const [day, setDay] = useState(ymdTodayLocal());
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState({
    business_day: ymdTodayLocal(),
    revenue: 0,
    fundPercent: 15,
    fundTotal: 0,
    participants: 15,
    basePerPerson: 0,
  });
  const [warnings, setWarnings] = useState([]);

  const isToday = useMemo(() => day === ymdTodayLocal(), [day]);

  useEffect(() => {
    let alive = true;

    async function load() {
      const q = encodeURIComponent(day);
      const r = await ownerGet(`/api/owner/motivation/day?day=${q}`);

      if (!alive) return;
      setLoading(false);
      setWarnings(r?.meta?.warnings || []);

      if (r.ok && r.data) {
        setPayload({
          business_day: r.data.business_day || day,
          revenue: Number(r.data.revenue || 0),
          fundPercent: Number(r.data.fundPercent || 15),
          fundTotal: Number(r.data.fundTotal || 0),
          participants: Number(r.data.participants || 15),
          basePerPerson: Number(r.data.basePerPerson || 0),
        });
      } else {
        setPayload((p) => ({ ...p, business_day: day, revenue: 0, fundTotal: 0, basePerPerson: 0 }));
      }
    }

    load();

    const t = isToday ? setInterval(load, 30000) : null;

    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [day, isToday]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xl font-extrabold tracking-tight">Мотивация</div>
        <div className="text-[11px] text-neutral-500">owner</div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
        <div className="text-[11px] text-neutral-500">День (business_day)</div>
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="mt-2 w-full rounded-xl bg-neutral-900/40 border border-neutral-800 px-3 py-2 text-sm"
        />
        <div className="mt-2 text-xs text-neutral-500">Сегодня автообновление каждые 30 сек</div>
      </div>

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
        <Card title="Выручка дня" value={formatRUB(payload.revenue)} loading={loading} />
        <Card title="Фонд (%)" value={`${payload.fundPercent}%`} loading={loading} />
        <Card title="Фонд (сумма)" value={formatRUB(payload.fundTotal)} loading={loading} />
        <Card title="Участников" value={String(payload.participants)} loading={loading} />
        <Card className="col-span-2" title="База на человека" value={formatRUB(payload.basePerPerson)} loading={loading} />
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 text-xs text-neutral-400">
        Формулы сейчас дефолтные. Версионирование параметров — через owner_settings_versions (следующий шаг по ТЗ).
      </div>
    </div>
  );
}

function Card({ title, value, loading, className = "" }) {
  return (
    <div
      className={`rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)] ${className}`}
    >
      <div className="text-[11px] text-neutral-500">{title}</div>
      <div className="mt-1 text-lg font-extrabold tracking-tight">{loading ? "..." : value}</div>
    </div>
  );
}
