/**
 * src/views/OwnerMotivationView.jsx
 * OWNER — Мотивация (backend wired)
 *
 * API:
 *  - GET /api/owner/motivation/day?day=YYYY-MM-DD
 * Polling: 30s (only for today)
 */

import { useEffect, useMemo, useState } from "react";
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
    mode: "unknown",
    payouts: [],
  });
  const [warnings, setWarnings] = useState([]);

  const isToday = useMemo(() => day === ymdTodayLocal(), [day]);

  useEffect(() => {
    let alive = true;

    async function load() {
      const q = encodeURIComponent(day);
      const r = await apiClient.request(`/owner/motivation/day?day=${q}`, { method: 'GET' });

      if (!alive) return;
      setLoading(false);
      setWarnings(r?.meta?.warnings || []);

      if (r.ok && r.data) {
        const revenueTotal =
          r.data.revenue_total ?? r.data.revenueTotal ?? r.data.revenue ?? 0;
        setPayload({
          business_day: r.data.business_day || day,
          revenue: Number(revenueTotal || 0),
          fundPercent: Number(r.data.fundPercent || 15),
          fundTotal: Number(r.data.fundTotal || 0),
          participants: Number(r.data.participants || 15),
          basePerPerson: Number(r.data.basePerPerson || 0),
          mode: r.data.mode || "unknown",
          payouts: Array.isArray(r.data.payouts) ? r.data.payouts : [],
        });
      } else {
        setPayload((p) => ({ ...p, business_day: day, revenue: 0, fundTotal: 0, basePerPerson: 0, payouts: [] }));
      }
    }

    load();

    const t = isToday ? setInterval(load, 30000) : null;

    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [day, isToday]);

  const modeLabel = {
    personal: "Личная",
    team: "Командная",
    adaptive: "Адаптивная",
  }[payload.mode] || payload.mode;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24 space-y-3">
      <div className="text-xl font-extrabold tracking-tight">Мотивация</div>

      {/* Фильтр по дате */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <div className="text-[11px] text-neutral-500 mb-1">День (business_day)</div>
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="w-full rounded-lg bg-neutral-900/60 border border-white/10 px-3 py-2 text-sm"
            />
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] text-neutral-500">Режим</div>
            <div className="text-sm font-semibold text-neutral-300">{modeLabel}</div>
          </div>
        </div>
        {isToday && (
          <div className="mt-2 text-[10px] text-neutral-500">Автообновление каждые 30 сек</div>
        )}
      </div>

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

      {/* Итоговая статистика */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard title="Выручка дня" value={formatRUB(payload.revenue)} accent="emerald" loading={loading} />
        <StatCard title="Фонд (%)" value={`${payload.fundPercent}%`} loading={loading} />
        <StatCard title="Фонд (сумма)" value={formatRUB(payload.fundTotal)} loading={loading} />
        <StatCard title="Участников" value={String(payload.participants)} loading={loading} />
        <StatCard title="База на человека" value={formatRUB(payload.basePerPerson)} className="col-span-2" loading={loading} />
      </div>

      {/* Распределение выплат */}
      {payload.payouts.length > 0 && (
        <div className="mt-4">
          <div className="text-sm font-semibold px-1 mb-3">Распределение</div>
          <div className="space-y-2">
            {payload.payouts.map((p, idx) => (
              <PayoutCard key={p.user_id || idx} payout={p} rank={idx + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, accent, loading, className = "" }) {
  const vCls =
    accent === "amber"
      ? "text-amber-300"
      : accent === "emerald"
      ? "text-emerald-300"
      : "text-neutral-100";

  return (
    <div className={`rounded-xl border border-white/10 bg-white/5 p-3 ${className}`}>
      <div className="text-[11px] text-neutral-500">{title}</div>
      <div className={["mt-1 text-lg font-extrabold tracking-tight", vCls].join(" ")}>
        {loading ? "..." : value}
      </div>
    </div>
  );
}

function PayoutCard({ payout, rank }) {
  const roleLabel = {
    seller: "Продавец",
    dispatcher: "Диспетчер",
  }[payout.role] || payout.role;

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-bold text-neutral-400 shrink-0">
            {rank}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">
              {payout.name || `User ${payout.user_id}`}
            </div>
            <div className="text-[10px] text-neutral-500">{roleLabel}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-neutral-500">Выплата</div>
          <div className="text-base font-extrabold tracking-tight text-emerald-300">
            {formatRUB(payout.total)}
          </div>
        </div>
      </div>
      {payout.revenue !== undefined && payout.revenue !== null && (
        <div className="mt-1 text-xs text-neutral-500">
          Выручка: <span className="text-neutral-300">{formatRUB(payout.revenue)}</span>
        </div>
      )}
    </div>
  );
}
