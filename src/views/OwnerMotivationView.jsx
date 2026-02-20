/**
 * src/views/OwnerMotivationView.jsx
 * OWNER — Мотивация (backend wired)
 *
 * API:
 *  - GET /api/owner/motivation/day?day=YYYY-MM-DD
 *  - GET /api/owner/motivation/weekly?week=YYYY-Www
 *  - GET /api/owner/motivation/season?season_id=YYYY
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

function formatInt(v) {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

function ymdTodayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getCurrentISOWeek() {
  const now = new Date();
  const year = now.getFullYear();
  const oneJan = new Date(year, 0, 1);
  const days = Math.floor((now - oneJan) / 86400000);
  const weekNum = Math.ceil((days + oneJan.getDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}

function getCurrentSeason() {
  return String(new Date().getFullYear());
}

export default function OwnerMotivationView() {
  const [subTab, setSubTab] = useState("day"); // day | week | season

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24 space-y-3">
      <div className="text-xl font-extrabold tracking-tight">Мотивация</div>

      {/* Sub-tabs */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-1 flex gap-1">
        <SubTabBtn active={subTab === "day"} onClick={() => setSubTab("day")} label="День" />
        <SubTabBtn active={subTab === "week"} onClick={() => setSubTab("week")} label="Неделя" />
        <SubTabBtn active={subTab === "season"} onClick={() => setSubTab("season")} label="Сезон" />
      </div>

      {subTab === "day" && <DayView />}
      {subTab === "week" && <WeekView />}
      {subTab === "season" && <SeasonView />}
    </div>
  );
}

function SubTabBtn({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
        active
          ? "bg-amber-900/40 text-amber-300 border border-amber-500/50"
          : "text-neutral-400 hover:bg-neutral-800/50",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/* ==================== DAY VIEW ==================== */

function DayView() {
  const [day, setDay] = useState(ymdTodayLocal());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState({
    business_day: ymdTodayLocal(),
    revenue_total: 0,
    motivation_percent: 0,
    fundPercent: 0,
    fundTotal: 0,
    participants: 0,
    mode: "unknown",
    payouts: [],
    active_dispatchers_count: 0,
    dispatcher_daily_bonus_total: 0,
    dispatcher_daily_percent: 0,
  });
  const [warnings, setWarnings] = useState([]);

  const isToday = useMemo(() => day === ymdTodayLocal(), [day]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr("");
      try {
        const q = encodeURIComponent(day);
        const r = await apiClient.request(`/owner/motivation/day?day=${q}`, { method: 'GET' });

        if (!alive) return;
        setLoading(false);
        setWarnings(r?.meta?.warnings || []);

        if (r.ok && r.data) {
          setPayload({
            business_day: r.data.business_day || day,
            revenue_total: Number(r.data.revenue_total || 0),
            motivation_percent: Number(r.data.motivation_percent || 0),
            fundPercent: Number(r.data.fundPercent || 0),
            fundTotal: Number(r.data.fundTotal || 0),
            participants: Number(r.data.participants || 0),
            mode: r.data.mode || "unknown",
            payouts: Array.isArray(r.data.payouts) ? r.data.payouts : [],
            active_dispatchers_count: Number(r.data.active_dispatchers_count || 0),
            dispatcher_daily_bonus_total: Number(r.data.dispatcher_daily_bonus_total || 0),
            dispatcher_daily_percent: Number(r.data.dispatcher_daily_percent || 0),
          });
        } else {
          setErr(r?.error || "Ошибка загрузки");
        }
      } catch (e) {
        if (!alive) return;
        setLoading(false);
        setErr(e?.message || "Ошибка сети");
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
    <>
      {/* Date picker */}
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

      {err && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">{err}</div>
      )}

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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard title="Выручка дня" value={formatRUB(payload.revenue_total)} accent="emerald" loading={loading} />
        <StatCard title="Мотивация %" value={`${payload.motivation_percent}%`} loading={loading} />
        <StatCard title="Фонд (сумма)" value={formatRUB(payload.fundTotal)} loading={loading} />
        <StatCard title="Участников" value={String(payload.participants)} loading={loading} />
      </div>

      {/* Dispatcher bonus stats */}
      {payload.active_dispatchers_count > 0 && (
        <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-3">
          <div className="text-xs text-amber-300 font-semibold mb-2">Бонус диспетчеров</div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-neutral-500">Активных</div>
              <div className="text-neutral-200 font-semibold">{payload.active_dispatchers_count}</div>
            </div>
            <div>
              <div className="text-neutral-500">Процент</div>
              <div className="text-neutral-200 font-semibold">{(payload.dispatcher_daily_percent * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-neutral-500">Сумма</div>
              <div className="text-amber-300 font-semibold">{formatRUB(payload.dispatcher_daily_bonus_total)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Payouts table */}
      {payload.payouts.length > 0 && (
        <div className="mt-2">
          <div className="text-sm font-semibold px-1 mb-3">Участники</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-neutral-500 border-b border-neutral-800">
                  <th className="py-2 pr-2">Имя</th>
                  <th className="py-2 px-2">Роль</th>
                  <th className="py-2 px-2">Зона</th>
                  <th className="py-2 px-2 text-right">Выручка</th>
                  <th className="py-2 px-2 text-right">Очки</th>
                  <th className="py-2 px-2 text-right">k(streak)</th>
                  <th className="py-2 px-2 text-right">Итого очков</th>
                  <th className="py-2 px-2 text-right">Выплата</th>
                  <th className="py-2 pl-2 text-right">Бонус</th>
                </tr>
              </thead>
              <tbody>
                {payload.payouts.map((p, idx) => (
                  <tr key={p.user_id || idx} className="border-b border-neutral-800/50">
                    <td className="py-2 pr-2 font-medium truncate max-w-[100px]">{p.name || `User ${p.user_id}`}</td>
                    <td className="py-2 px-2 text-neutral-400">{p.role === 'seller' ? 'Прд' : 'Дсп'}</td>
                    <td className="py-2 px-2 text-neutral-400">{p.zone || '—'}</td>
                    <td className="py-2 px-2 text-right text-neutral-300">{formatRUB(p.personal_revenue_day || p.revenue || 0)}</td>
                    <td className="py-2 px-2 text-right text-neutral-300">{formatInt(p.points_total || 0)}</td>
                    <td className="py-2 px-2 text-right text-neutral-400">{p.streak_multiplier ? p.streak_multiplier.toFixed(2) : '1.00'}</td>
                    <td className="py-2 px-2 text-right text-emerald-300 font-semibold">{formatInt(p.points_total || 0)}</td>
                    <td className="py-2 px-2 text-right text-emerald-300 font-semibold">{formatRUB(p.total || 0)}</td>
                    <td className="py-2 pl-2 text-right text-amber-300">{p.dispatcher_daily_bonus ? formatRUB(p.dispatcher_daily_bonus) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && <div className="text-sm text-neutral-500">Загрузка...</div>}
    </>
  );
}

/* ==================== WEEK VIEW ==================== */

function WeekView() {
  const [week, setWeek] = useState(getCurrentISOWeek());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState({
    week_id: "",
    date_from: "",
    date_to: "",
    sellers: [],
  });

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr("");
      try {
        const q = encodeURIComponent(week);
        const r = await apiClient.request(`/owner/motivation/weekly?week=${q}`, { method: 'GET' });

        if (!alive) return;
        setLoading(false);

        if (r.ok && r.data) {
          setPayload({
            week_id: r.data.week_id || week,
            date_from: r.data.date_from || "",
            date_to: r.data.date_to || "",
            sellers: Array.isArray(r.data.sellers) ? r.data.sellers : [],
          });
        } else {
          setErr(r?.error || "Ошибка загрузки");
        }
      } catch (e) {
        if (!alive) return;
        setLoading(false);
        setErr(e?.message || "Ошибка сети");
      }
    }

    load();

    return () => { alive = false; };
  }, [week]);

  // Navigate weeks
  const changeWeek = (delta) => {
    const match = week.match(/^(\d{4})-W(\d{2})$/);
    if (!match) return;
    const year = parseInt(match[1], 10);
    let weekNum = parseInt(match[2], 10) + delta;
    let newYear = year;
    if (weekNum < 1) { newYear = year - 1; weekNum = 52; }
    else if (weekNum > 52) { newYear = year + 1; weekNum = 1; }
    setWeek(`${newYear}-W${String(weekNum).padStart(2, "0")}`);
  };

  return (
    <>
      {/* Week selector */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-[11px] text-neutral-500 mb-2">Неделя</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => changeWeek(-1)}
            className="px-3 py-2 rounded-lg border border-neutral-700 text-neutral-300 hover:bg-neutral-800/50"
          >‹</button>
          <input
            type="text"
            value={week}
            onChange={(e) => setWeek(e.target.value)}
            placeholder="YYYY-Www"
            className="flex-1 rounded-lg bg-neutral-900/60 border border-white/10 px-3 py-2 text-sm text-center"
          />
          <button
            type="button"
            onClick={() => changeWeek(1)}
            className="px-3 py-2 rounded-lg border border-neutral-700 text-neutral-300 hover:bg-neutral-800/50"
          >›</button>
        </div>
        {payload.date_from && payload.date_to && (
          <div className="mt-2 text-[10px] text-neutral-500 text-center">
            {payload.date_from} → {payload.date_to}
          </div>
        )}
      </div>

      {err && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">{err}</div>
      )}

      {/* Sellers table */}
      {payload.sellers.length > 0 && (
        <div className="mt-2">
          <div className="text-sm font-semibold px-1 mb-3">Рейтинг недели</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-neutral-500 border-b border-neutral-800">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 px-2">Имя</th>
                  <th className="py-2 px-2">Зона</th>
                  <th className="py-2 px-2 text-right">Выручка</th>
                  <th className="py-2 px-2 text-right">Очки</th>
                  <th className="py-2 px-2 text-right">Streak</th>
                  <th className="py-2 px-2 text-right">k(streak)</th>
                  <th className="py-2 px-2 text-right">Итого</th>
                </tr>
              </thead>
              <tbody>
                {payload.sellers.map((s, idx) => (
                  <tr
                    key={s.user_id || idx}
                    className={[
                      "border-b border-neutral-800/50",
                      idx < 3 ? "bg-amber-900/10" : "",
                    ].join(" ")}
                  >
                    <td className="py-2 pr-2">
                      {idx < 3 ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold">{idx + 1}</span>
                      ) : (
                        <span className="text-neutral-500">{idx + 1}</span>
                      )}
                    </td>
                    <td className="py-2 px-2 font-medium truncate max-w-[100px]">{s.name || `User ${s.user_id}`}</td>
                    <td className="py-2 px-2 text-neutral-400">{s.zone || '—'}</td>
                    <td className="py-2 px-2 text-right text-neutral-300">{formatRUB(s.revenue_week || 0)}</td>
                    <td className="py-2 px-2 text-right text-neutral-300">{formatInt(s.points_base || 0)}</td>
                    <td className="py-2 px-2 text-right text-neutral-400">{s.streak_days || 0}</td>
                    <td className="py-2 px-2 text-right text-neutral-400">{s.streak_multiplier ? s.streak_multiplier.toFixed(2) : '1.00'}</td>
                    <td className="py-2 px-2 text-right text-emerald-300 font-semibold">{formatInt(s.points_total || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && payload.sellers.length === 0 && !err && (
        <div className="text-sm text-neutral-500">Нет данных за неделю</div>
      )}

      {loading && <div className="text-sm text-neutral-500">Загрузка...</div>}
    </>
  );
}

/* ==================== SEASON VIEW ==================== */

function SeasonView() {
  const currentYear = getCurrentSeason();
  const [seasonId, setSeasonId] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState({
    season_id: "",
    sellers: [],
  });

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr("");
      try {
        const q = encodeURIComponent(seasonId);
        const r = await apiClient.request(`/owner/motivation/season?season_id=${q}`, { method: 'GET' });

        if (!alive) return;
        setLoading(false);

        if (r.ok && r.data) {
          setPayload({
            season_id: r.data.season_id || seasonId,
            sellers: Array.isArray(r.data.sellers) ? r.data.sellers : [],
          });
        } else {
          setErr(r?.error || "Ошибка загрузки");
        }
      } catch (e) {
        if (!alive) return;
        setLoading(false);
        setErr(e?.message || "Ошибка сети");
      }
    }

    load();

    return () => { alive = false; };
  }, [seasonId]);

  const years = [];
  for (let y = parseInt(currentYear); y >= parseInt(currentYear) - 2; y--) {
    years.push(String(y));
  }

  return (
    <>
      {/* Season selector */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-[11px] text-neutral-500 mb-2">Сезон</div>
        <select
          value={seasonId}
          onChange={(e) => setSeasonId(e.target.value)}
          className="w-full rounded-lg bg-neutral-900/60 border border-white/10 px-3 py-2 text-sm"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {err && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">{err}</div>
      )}

      {/* Sellers table */}
      {payload.sellers.length > 0 && (
        <div className="mt-2">
          <div className="text-sm font-semibold px-1 mb-3">Рейтинг сезона</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-neutral-500 border-b border-neutral-800">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 px-2">Имя</th>
                  <th className="py-2 px-2">Зона</th>
                  <th className="py-2 px-2 text-right">Выручка</th>
                  <th className="py-2 px-2 text-right">Очки</th>
                </tr>
              </thead>
              <tbody>
                {payload.sellers.map((s, idx) => (
                  <tr
                    key={s.user_id || idx}
                    className={[
                      "border-b border-neutral-800/50",
                      idx < 3 ? "bg-amber-900/10" : "",
                    ].join(" ")}
                  >
                    <td className="py-2 pr-2">
                      {idx < 3 ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold">{idx + 1}</span>
                      ) : (
                        <span className="text-neutral-500">{idx + 1}</span>
                      )}
                    </td>
                    <td className="py-2 px-2 font-medium truncate max-w-[100px]">{s.name || `User ${s.user_id}`}</td>
                    <td className="py-2 px-2 text-neutral-400">{s.zone || '—'}</td>
                    <td className="py-2 px-2 text-right text-neutral-300">{formatRUB(s.revenue_total || 0)}</td>
                    <td className="py-2 px-2 text-right text-emerald-300 font-semibold">{formatInt(s.points_total || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && payload.sellers.length === 0 && !err && (
        <div className="text-sm text-neutral-500">Нет данных за сезон</div>
      )}

      {loading && <div className="text-sm text-neutral-500">Загрузка...</div>}
    </>
  );
}

/* ==================== SHARED COMPONENTS ==================== */

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
