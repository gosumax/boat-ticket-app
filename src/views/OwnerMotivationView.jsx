/**
 * src/views/OwnerMotivationView.jsx
 * OWNER - Мотивация (backend wired)
 *
 * API:
 *  - GET /api/owner/motivation/day?day=YYYY-MM-DD
 *  - GET /api/owner/money/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *  - GET /api/owner/motivation/weekly?week=YYYY-Www
 *  - GET /api/owner/motivation/season?season_id=YYYY
 */

import { useEffect, useMemo, useState } from "react";
import apiClient from "../utils/apiClient.js";
import { buildOwnerMotivationDayViewModel } from "../utils/ownerMotivationDayViewModel.js";
import { formatMotivationPoints } from "../utils/ownerMotivationPoints.js";
import { getSeasonConfigUiState } from "../utils/seasonBoundaries.js";
import DateFieldPicker from "../components/ui/DateFieldPicker.jsx";

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

function formatRUBPrecise(v) {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ₽`;
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

function getSeasonPayoutSchemeLabel(value) {
  if (value === "top3") return "Топ-3";
  if (value === "top5") return "Топ-5";
  return "Все";
}

function ymdTodayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getISOWeek1Monday(year) {
  const jan4 = new Date(year, 0, 4);
  const jan4Dow = jan4.getDay() === 0 ? 7 : jan4.getDay();
  const monday = new Date(jan4);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(jan4.getDate() - (jan4Dow - 1));
  return monday;
}

function getISOWeekParts(dateInput) {
  const date = new Date(dateInput);
  date.setHours(0, 0, 0, 0);
  const dow = date.getDay() === 0 ? 7 : date.getDay();
  const thursday = new Date(date);
  thursday.setDate(date.getDate() + (4 - dow));
  const isoYear = thursday.getFullYear();
  const week1Monday = getISOWeek1Monday(isoYear);
  const diffMs = thursday.getTime() - week1Monday.getTime();
  const week = 1 + Math.floor(diffMs / (7 * 86400000));
  return { year: isoYear, week };
}

function getISOWeeksInYear(year) {
  const dec28 = new Date(year, 11, 28);
  return getISOWeekParts(dec28).week;
}

function getCurrentISOWeek() {
  const { year, week } = getISOWeekParts(new Date());
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function shiftISOWeek(weekId, delta) {
  const match = String(weekId || "").match(/^(\d{4})-W(\d{2})$/);
  if (!match) return weekId;
  let year = Number(match[1]);
  let week = Number(match[2]) + Number(delta || 0);

  while (week < 1) {
    year -= 1;
    week += getISOWeeksInYear(year);
  }
  while (week > getISOWeeksInYear(year)) {
    week -= getISOWeeksInYear(year);
    year += 1;
  }

  return `${year}-W${String(week).padStart(2, "0")}`;
}

function getCurrentSeason() {
  return String(new Date().getFullYear());
}

export function DayParticipantsTable({ rows }) {
  return (
    <div className="overflow-x-auto" data-testid="owner-motivation-day-participants-table">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-neutral-500 border-b border-neutral-800">
            <th className="py-2 pr-2">Имя</th>
            <th className="py-2 px-2">Роль</th>
            <th className="py-2 px-2">Зона</th>
            <th className="py-2 px-2 text-right">Очки</th>
            <th className="py-2 px-2 text-right">k(очков)</th>
            <th className="py-2 px-2 text-right">Итого очков</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={row.user_id || idx}
              className="border-b border-neutral-800/50"
              data-testid={`owner-motivation-day-row-${row.user_id || idx}`}
            >
              <td className="py-2 pr-2 font-medium truncate max-w-[100px]">{row.name || `User ${row.user_id}`}</td>
              <td className="py-2 px-2 text-neutral-400">Прод.</td>
              <td className="py-2 px-2 text-neutral-400">{row.zone || "—"}</td>
              <td className="py-2 px-2 text-right text-neutral-300">{formatMotivationPoints(row.points_base || 0)}</td>
              <td className="py-2 px-2 text-right text-neutral-400">{Number(row.k_streak ?? 1).toFixed(2)}</td>
              <td className="py-2 px-2 text-right text-emerald-300 font-semibold">{formatMotivationPoints(row.points_total || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WeeklySellerTable({ sellers }) {
  return (
    <div className="overflow-x-auto" data-testid="owner-motivation-week-table">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-neutral-500 border-b border-neutral-800">
            <th className="py-2 px-2">Имя</th>
            <th className="py-2 px-2 text-right">Очки</th>
            <th className="py-2 px-2 text-right">k(очков)</th>
            <th className="py-2 px-2 text-right">Итого</th>
          </tr>
        </thead>
        <tbody>
          {sellers.map((seller, idx) => (
            <tr
              key={seller.user_id || idx}
              className={[
                "border-b border-neutral-800/50",
                idx < 3 ? "bg-amber-900/10" : "",
              ].join(" ")}
            >
              <td className="py-2 px-2 font-medium truncate max-w-[100px]">{seller.name || `User ${seller.user_id}`}</td>
              <td className="py-2 px-2 text-right text-neutral-300">{formatMotivationPoints((seller.points_week_base ?? seller.points_base) || 0)}</td>
              <td className="py-2 px-2 text-right text-neutral-400">{Number(seller.k_streak ?? 1).toFixed(2)}</td>
              <td className="py-2 px-2 text-right text-emerald-300 font-semibold">{formatMotivationPoints((seller.points_week_total ?? seller.points_total) || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SeasonSellerTable({ sellers, minWorkedDaysSeason, minWorkedDaysSep }) {
  return (
    <div className="mt-4 overflow-x-auto" data-testid="owner-motivation-season-table">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-neutral-500 border-b border-neutral-800">
            <th className="py-2 pr-2">#</th>
            <th className="py-2 px-2">Имя</th>
            <th className="py-2 px-2 text-right">Очки</th>
            <th className="py-2 px-2">Условие</th>
            <th className="py-2 px-2 text-right">Выплата</th>
          </tr>
        </thead>
        <tbody>
          {sellers.map((seller, idx) => (
            <tr
              key={seller.user_id || idx}
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
              <td className="py-2 px-2 font-medium truncate max-w-[100px]">{seller.name || `User ${seller.user_id}`}</td>
              <td className="py-2 px-2 text-right text-emerald-300 font-semibold">{formatMotivationPoints(seller.points_total || 0)}</td>
              <td className="py-2 px-2">
                <div
                  className={[
                    "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    Number(seller.is_eligible || 0) === 1
                      ? "border-emerald-500/40 bg-emerald-900/20 text-emerald-300"
                      : "border-neutral-700 bg-neutral-900/40 text-neutral-300",
                  ].join(" ")}
                >
                  {Number(seller.is_eligible || 0) === 1 ? "Условие выполнено" : "Условие не выполнено"}
                </div>
                <div className="mt-1 text-[10px] text-neutral-500">
                  {formatInt(seller.worked_days_season || 0)}/{formatInt(minWorkedDaysSeason)} д. сезона ·{" "}
                  {formatInt(seller.worked_days_sep || 0)}/{formatInt(minWorkedDaysSep)} д. сентября
                </div>
              </td>
              <td className="py-2 px-2 text-right">
                <div className="font-semibold text-sky-300">
                  {formatRUBPrecise(seller.season_payout || 0)}
                </div>
                {Number(seller.season_payout_recipient || 0) === 1 && Number(seller.is_eligible || 0) !== 1 && (
                  <div className="mt-1 text-[10px] text-neutral-500">Получит при выполнении условия</div>
                )}
                {Number(seller.season_payout_recipient || 0) !== 1 && (
                  <div className="mt-1 text-[10px] text-neutral-500">Вне текущего прогноза схемы</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function OwnerMotivationView({ settingsRefreshKey }) {
  const [subTab, setSubTab] = useState("day"); // day | week | season
  
  const [settings, setSettings] = useState(null);

  const loadSettings = async () => {
    try {
      const json = await apiClient.request(`/owner/settings/full`, { method: "GET" });
      setSettings(json?.data || null);
    } catch {
      setSettings(null);
    }
  };

  useEffect(() => {
    loadSettings();
  }, [settingsRefreshKey]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24 space-y-3">
      <div className="text-xl font-extrabold tracking-tight">Мотивация</div>

      {/* Sub-tabs */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-1 flex gap-1">
        <SubTabBtn dataTestId="owner-motivation-tab-day" active={subTab === "day"} onClick={() => setSubTab("day")} label="День" />
        <SubTabBtn dataTestId="owner-motivation-tab-week" active={subTab === "week"} onClick={() => setSubTab("week")} label="Неделя" />
        <SubTabBtn dataTestId="owner-motivation-tab-season" active={subTab === "season"} onClick={() => setSubTab("season")} label="Сезон" />
      </div>

      {subTab === "day" && <DayView />}
      {subTab === "week" && <WeekView />}
      {subTab === "season" && <SeasonView settings={settings} />}
    </div>
  );
}

function SubTabBtn({ active, onClick, label, dataTestId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
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
  const [payload, setPayload] = useState(() =>
    buildOwnerMotivationDayViewModel({ business_day: ymdTodayLocal() }, ymdTodayLocal())
  );
  const [warnings, setWarnings] = useState([]);

  const isToday = useMemo(() => day === ymdTodayLocal(), [day]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr("");
      try {
        const q = encodeURIComponent(day);
        const [motivationResponse, moneySummaryResponse] = await Promise.all([
          apiClient.request(`/owner/motivation/day?day=${q}`, { method: 'GET' }),
          apiClient
            .request(`/owner/money/summary?from=${q}&to=${q}`, { method: 'GET' })
            .catch(() => null),
        ]);

        if (!alive) return;
        setLoading(false);
        setWarnings([
          ...(Array.isArray(motivationResponse?.meta?.warnings) ? motivationResponse.meta.warnings : []),
          ...(Array.isArray(moneySummaryResponse?.meta?.warnings) ? moneySummaryResponse.meta.warnings : []),
        ]);

        if (motivationResponse.ok && motivationResponse.data) {
          setPayload(
            buildOwnerMotivationDayViewModel(
              motivationResponse.data,
              day,
              moneySummaryResponse?.ok ? moneySummaryResponse.data : null
            )
          );
        } else {
          setErr(motivationResponse?.error || "Ошибка загрузки");
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
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <DateFieldPicker
              label="День"
              value={day}
              onChange={setDay}
              tone="dark"
              sheetTitle="День мотивации"
              sheetDescription="Выберите business day для просмотра мотивации."
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
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard
          title="Участников"
          value={String(payload.participants)}
          loading={loading}
          testId="owner-motivation-day-participants"
        />
        <StatCard
          title="Всего в фонды за день"
          value={formatRUB(payload.total_funds_day)}
          accent="emerald"
          loading={loading}
          testId="owner-motivation-day-total-funds"
        />
        <StatCard
          title="Weekly начислено в фонд за день"
          value={formatRUB(payload.weekly_amount_day)}
          loading={loading}
          testId="owner-motivation-day-weekly-funds"
        />
        <StatCard
          title="Season начислено в фонд за день"
          value={formatRUB(payload.season_amount_day)}
          loading={loading}
          testId="owner-motivation-day-season-funds"
        />
      </div>

      {/* Payouts table */}
      {payload.seller_rows.length > 0 && (
        <div className="mt-2">
          <div className="text-sm font-semibold px-1 mb-3">Участники</div>
          <DayParticipantsTable rows={payload.seller_rows} />
        </div>
      )}

      {!loading && payload.seller_rows.length === 0 && !err && (
        <div className="text-sm text-neutral-500">Нет данных за день</div>
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
    weekly_pool_total_ledger: 0,
    weekly_pool_total_daily_sum: 0,
    weekly_pool_diff: 0,
    weekly_pool_is_consistent: true,
    weekly_pool_total_current: 0,
    weekly_distribution_current: { first: 0.5, second: 0.3, third: 0.2 },
    top3_current: [],
    consistency_warnings: [],
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
            weekly_pool_total_ledger: Number(r.data.weekly_pool_total_ledger || 0),
            weekly_pool_total_daily_sum: Number(r.data.weekly_pool_total_daily_sum || 0),
            weekly_pool_diff: Number(r.data.weekly_pool_diff || 0),
            weekly_pool_is_consistent: r.data.weekly_pool_is_consistent !== false,
            weekly_pool_total_current: Number(r.data.weekly_pool_total_current ?? r.data.weekly_pool_total ?? r.data.weekly_pool_total_ledger ?? 0),
            weekly_distribution_current: r.data.weekly_distribution_current || { first: 0.5, second: 0.3, third: 0.2 },
            top3_current: Array.isArray(r.data.top3_current) ? r.data.top3_current : [],
            consistency_warnings: Array.isArray(r.meta?.consistency_diagnostics?.warnings)
              ? r.meta.consistency_diagnostics.warnings
              : [],
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
    setWeek((prev) => shiftISOWeek(prev, delta));
  };

  const distributionCurrent = payload.weekly_distribution_current || { first: 0.5, second: 0.3, third: 0.2 };
  const top3CurrentAmounts = useMemo(() => {
    const weeklyFundCurrent = Number(payload.weekly_pool_total_current || 0);
    return {
      first: Math.round(weeklyFundCurrent * Number(distributionCurrent.first || 0)),
      second: Math.round(weeklyFundCurrent * Number(distributionCurrent.second || 0)),
      third: Math.round(weeklyFundCurrent * Number(distributionCurrent.third || 0)),
    };
  }, [distributionCurrent.first, distributionCurrent.second, distributionCurrent.third, payload.weekly_pool_total_current]);

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

      {!loading && !err && (
        <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] text-neutral-500">Сейчас начислено в недельный фонд</div>
              <div data-testid="owner-weekly-current-fund" className="mt-1 text-xl font-extrabold text-emerald-300 tracking-tight">
                {formatRUB(payload.weekly_pool_total_current)}
              </div>
              <div className="mt-2 text-xs text-neutral-500">
                Прогноз распределения: {Math.round(Number(distributionCurrent.first || 0.5) * 100)}% / {Math.round(Number(distributionCurrent.second || 0.3) * 100)}% / {Math.round(Number(distributionCurrent.third || 0.2) * 100)}%
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">1 место</span>
                <span data-testid="owner-weekly-top3-split-first" className="font-semibold text-amber-300">{formatRUB(top3CurrentAmounts.first)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">2 место</span>
                <span data-testid="owner-weekly-top3-split-second" className="font-semibold text-amber-300">{formatRUB(top3CurrentAmounts.second)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">3 место</span>
                <span data-testid="owner-weekly-top3-split-third" className="font-semibold text-amber-300">{formatRUB(top3CurrentAmounts.third)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sellers table */}
      {payload.sellers.length > 0 && (
        <div className="mt-2">
          <div className="text-sm font-semibold px-1 mb-3">Рейтинг недели</div>
          <WeeklySellerTable sellers={payload.sellers} />
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

function SeasonView({ settings }) {
  const currentYear = getCurrentSeason();
  const [seasonId, setSeasonId] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [payload, setPayload] = useState({
    season_id: "",
    season_from: "",
    season_to: "",
    sellers: [],
    season_pool_total_ledger: 0,
    season_pool_total_daily_sum: 0,
    season_pool_diff: 0,
    season_pool_is_consistent: true,
    season_pool_total_current: 0,
    season_pool_from_revenue_total: 0,
    season_pool_rounding_total: 0,
    season_pool_dispatcher_decision_total: 0,
    season_payout_fund_total: 0,
    season_payout_scheme: "all",
    season_payout_recipient_count: 0,
    min_worked_days_season: 75,
    min_worked_days_sep: 20,
    consistency_warnings: [],
  });
  const seasonConfigUi = useMemo(() => getSeasonConfigUiState(settings), [settings]);

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
            season_from: r.data.season_from || "",
            season_to: r.data.season_to || "",
            sellers: Array.isArray(r.data.sellers) ? r.data.sellers : [],
            season_pool_total_ledger: Number(r.data.season_pool_total_ledger || 0),
            season_pool_total_daily_sum: Number(r.data.season_pool_total_daily_sum || 0),
            season_pool_diff: Number(r.data.season_pool_diff || 0),
            season_pool_is_consistent: r.data.season_pool_is_consistent !== false,
            season_pool_total_current: Number(r.data.season_pool_total_current ?? r.data.season_pool_total_ledger ?? 0),
            season_pool_from_revenue_total: Number(r.data.season_pool_from_revenue_total ?? r.data.season_pool_total_current ?? 0),
            season_pool_rounding_total: Number(r.data.season_pool_rounding_total || 0),
            season_pool_dispatcher_decision_total: Number(
              r.data.season_pool_dispatcher_decision_total ??
              r.data.season_pool_manual_transfer_total ??
              0
            ),
            season_payout_fund_total: Number(
              r.data.season_payout_fund_total ??
              r.data.season_pool_total_ledger ??
              0
            ),
            season_payout_scheme: String(
              r.data.season_payout_scheme ??
              r.meta?.season_payout_scheme ??
              "all"
            ),
            season_payout_recipient_count: Number(r.data.season_payout_recipient_count || 0),
            min_worked_days_season: Number(r.meta?.eligibility_rules?.min_worked_days_season || 75),
            min_worked_days_sep: Number(r.meta?.eligibility_rules?.min_worked_days_sep || 20),
            consistency_warnings: Array.isArray(r.meta?.consistency_diagnostics?.warnings)
              ? r.meta.consistency_diagnostics.warnings
              : [],
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
  const seasonFundTotal =
    Number(payload.season_pool_from_revenue_total || 0) +
    Number(payload.season_pool_rounding_total || 0) +
    Number(payload.season_pool_dispatcher_decision_total || 0);

  return (
    <>
      {/* Season selector */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="text-[11px] text-neutral-500 mb-2">Сезон</div>
        <div className="relative">
          <select
            value={seasonId}
            onChange={(e) => setSeasonId(e.target.value)}
            className="w-full appearance-none rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 pr-10 text-sm font-semibold text-neutral-100 shadow-inner shadow-black/20 outline-none transition focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/20"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-neutral-400">
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        {(payload.season_from && payload.season_to) && (
          <div className="mt-2 text-[10px] text-neutral-500">
            Правило сезона: {payload.season_from} → {payload.season_to}
          </div>
        )}
        {settings && (
          <div data-testid="owner-season-boundaries" className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
            <span>
              owner_settings: {String(settings?.seasonStart || `${seasonId}-${seasonConfigUi.start}`)} → {String(settings?.seasonEnd || `${seasonId}-${seasonConfigUi.end}`)}
            </span>
            {seasonConfigUi.isCustom && (
              <span data-testid="owner-season-custom-badge" className="rounded border border-amber-500/40 bg-amber-900/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                {seasonConfigUi.badgeLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {err && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">{err}</div>
      )}

      {!loading && !err && (
        <div className="rounded-2xl border border-amber-400/30 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.22),_transparent_45%),linear-gradient(135deg,rgba(120,53,15,0.5),rgba(23,23,23,0.95))] p-4 shadow-lg shadow-amber-950/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-200/70">Сезонный фонд</div>
              <div className="mt-2 text-sm text-neutral-300">Общий текущий фонд сезона по всем источникам</div>
              <div data-testid="owner-season-current-fund" className="mt-3 text-3xl font-black tracking-tight text-amber-100 md:text-4xl">
                {formatRUBPrecise(seasonFundTotal)}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3 lg:min-w-[560px]">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-[11px] text-neutral-400">Сейчас начислено в сезонный фонд</div>
                <div data-testid="owner-season-fund-from-revenue-total" className="mt-1 text-base font-semibold text-amber-200 tracking-tight">
                  {formatRUBPrecise(payload.season_pool_from_revenue_total)}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-[11px] text-neutral-400">Из округлений в сезонный фонд</div>
                <div data-testid="owner-season-rounding-total" className="mt-1 text-base font-semibold text-emerald-200 tracking-tight">
                  {formatRUBPrecise(payload.season_pool_rounding_total)}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-[11px] text-neutral-400">Отправлено в сезонный фонд решениями диспетчера</div>
                <div data-testid="owner-season-dispatcher-decision-total" className="mt-1 text-base font-semibold text-sky-200 tracking-tight">
                  {formatRUBPrecise(payload.season_pool_dispatcher_decision_total)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

            {/* Consistency check block */}
      {!loading && !err && (payload.season_pool_total_ledger > 0 || payload.season_pool_total_daily_sum > 0) && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-400">Проверка консистентности сезонного фонда</span>
            <span
              data-testid="owner-season-consistency-badge"
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                payload.season_pool_is_consistent
                  ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-500/30'
                  : 'bg-red-900/40 text-red-300 border border-red-500/30'
              }`}
            >
              {payload.season_pool_is_consistent ? '✓ Согласовано' : '⚠ Расхождение'}
            </span>
          </div>
          {!payload.season_pool_is_consistent && (
            <div className="mt-2 pt-2 border-t border-white/5 text-xs">
              <span className="text-neutral-500">Ledger:</span>{' '}
              <span className="text-neutral-300">{formatRUBPrecise(payload.season_pool_total_ledger)}</span>
              <span className="text-neutral-500 ml-3">Expected:</span>{' '}
              <span className="text-neutral-300">{formatRUBPrecise(payload.season_pool_total_daily_sum)}</span>
              <br />
              <span className="text-neutral-500">Разница: </span>
              <span data-testid="owner-season-consistency-diff" className="text-red-300 font-medium">
                {formatRUBPrecise(payload.season_pool_diff)}
              </span>
            </div>
          )}
          {Array.isArray(payload.consistency_warnings) && payload.consistency_warnings.length > 0 && (
            <div className="mt-2 pt-2 border-t border-white/5 text-[11px] text-amber-200/90">
              {payload.consistency_warnings.slice(0, 3).map((w, i) => (
                <div key={i}>• {String(w)}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sellers table */}
      {payload.sellers.length > 0 && (
        <div className="mt-2">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Рейтинг сезона</div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  {payload.sellers.length} seller-участника в каноническом сезоне
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-neutral-500">Активная схема owner</div>
                <div data-testid="owner-season-active-scheme" className="mt-1 text-sm font-semibold text-neutral-100">
                  {getSeasonPayoutSchemeLabel(payload.season_payout_scheme)}
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  Получателей: {formatInt(payload.season_payout_recipient_count)}
                </div>
              </div>
            </div>
            <SeasonSellerTable
              sellers={payload.sellers}
              minWorkedDaysSeason={payload.min_worked_days_season}
              minWorkedDaysSep={payload.min_worked_days_sep}
            />
          </div>
        </div>
      )}

      {!loading && payload.sellers.length === 0 && !err && (
        <div className="text-sm text-neutral-500">Нет seller-участников за сезон</div>
      )}

      {loading && <div className="text-sm text-neutral-500">Загрузка...</div>}
    </>
  );
}

/* ==================== SHARED COMPONENTS ==================== */

function StatCard({ title, value, accent, loading, className = "", testId }) {
  const vCls =
    accent === "amber"
      ? "text-amber-300"
      : accent === "emerald"
      ? "text-emerald-300"
      : "text-neutral-100";

  return (
    <div data-testid={testId} className={`rounded-xl border border-white/10 bg-white/5 p-3 ${className}`}>
      <div className="text-[11px] text-neutral-500">{title}</div>
      <div className={["mt-1 text-lg font-extrabold tracking-tight", vCls].join(" ")}>
        {loading ? "..." : value}
      </div>
    </div>
  );
}
