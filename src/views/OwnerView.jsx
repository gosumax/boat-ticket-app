import { useAuth } from "../contexts/AuthContext";
import { useEffect, useMemo, useState, useCallback } from "react";
import apiClient from "../utils/apiClient.js";
import { OwnerDataContext } from "../contexts/OwnerDataContext.jsx";
import OwnerMoneyView from "./OwnerMoneyView";
import OwnerBoatsView from "./OwnerBoatsView";
import OwnerSellersView from "./OwnerSellersView";
import OwnerMotivationView from "./OwnerMotivationView";
import OwnerSettingsView from "./OwnerSettingsView";
import OwnerLoadView from "../components/owner/OwnerLoadView.jsx";
import OwnerExportView from "./OwnerExportView";

/**
 * OwnerView.jsx
 * OWNER SHELL (UI ONLY)
 * - Нижняя навигация всегда закреплена (fixed)
 * - Главный таб по умолчанию: Деньги
 * - Никаких действий, влияющих на продажи/рейсы/билеты
 */

/**
 * SCREEN 0 — Сравнение периодов (Owner)
 * UI-only implementation per TZ:
 * - Choose Period A and Period B (presets)
 * - Show metrics with A, B, delta
 */
function OwnerComparePeriodsView() {
  const [preset, setPreset] = useState("7d");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);
  const [range, setRange] = useState(null);
  const [warnings, setWarnings] = useState([]);

  const load = async () => {
    setErr("");
    setBusy(true);
    try {
      const json = await apiClient.request(
        `/owner/money/compare-days?preset=${encodeURIComponent(preset)}`,
        { method: "GET" }
      );
      setRows(json?.data?.rows || []);
      setRange(json?.data?.range || null);
      setWarnings(json?.meta?.warnings || []);
    } catch (e) {
      setErr(e?.message || "Ошибка загрузки");
      setRows([]);
      setRange(null);
      setWarnings([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const manualOn = useMemo(() => (warnings || []).join("\n").toLowerCase().includes("manual override"), [warnings]);

  const maxRev = useMemo(() => {
    let m = 0;
    for (const r of rows || []) m = Math.max(m, Number(r.revenue || 0));
    return m;
  }, [rows]);

  return (
    <div className="p-4 pb-24 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xl font-semibold">Сравнение</div>
        {manualOn && (
          <div className="text-[11px] px-2 py-1 rounded-full border border-amber-500/50 text-amber-300 bg-amber-900/20">
            manual
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-neutral-800 p-2 flex items-center justify-between gap-2">
        <div className="flex gap-2 overflow-x-auto">
          <PresetChip active={preset === "7d"} onClick={() => setPreset("7d")} label="7 дней" />
          <PresetChip active={preset === "30d"} onClick={() => setPreset("30d")} label="30 дней" />
          <PresetChip active={preset === "90d"} onClick={() => setPreset("90d")} label="90 дней" />
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-xl border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900/40"
          disabled={busy}
        >
          {busy ? "..." : "Обновить"}
        </button>
      </div>

      {err && (
        <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
          {err}
        </div>
      )}

      <div className="rounded-2xl border border-neutral-800 p-3 text-xs text-neutral-500">
        Диапазон: {range?.from && range?.to ? `${range.from} → ${range.to}` : "—"}
      </div>

      <div className="space-y-2">
        {(rows || []).slice().reverse().map((r) => {
          const revenue = Number(r.revenue || 0);
          const pct = maxRev > 0 ? Math.round((revenue / maxRev) * 100) : 0;
          return (
            <div key={r.day} className="rounded-2xl border border-neutral-800 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">{r.day}</div>
                <div className="text-sm text-neutral-200">{formatRUB(revenue)}</div>
              </div>
              <div className="mt-2 h-2 rounded-full bg-neutral-900 overflow-hidden">
                <div className="h-full bg-amber-900/70" style={{ width: `${Math.max(2, pct)}%` }} />
              </div>
              <div className="mt-2 text-xs text-neutral-500 flex gap-3">
                <div>cash: {formatRUB(r.cash || 0)}</div>
                <div>card: {formatRUB(r.card || 0)}</div>
              </div>
            </div>
          );
        })}
        {(rows || []).length === 0 && !err && (
          <div className="rounded-2xl border border-neutral-800 p-4 text-sm text-neutral-500">Нет данных</div>
        )}
      </div>
    </div>
  );
}

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

function PresetChip({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "whitespace-nowrap px-3 py-1 rounded-full border text-sm",
        active
          ? "border-amber-500 text-amber-400"
          : "border-neutral-800 text-neutral-400",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export default function OwnerView() {
  const { logout } = useAuth();
  const [tab, setTab] = useState("money"); // money | compare | boats | sellers | motivation | settings | load | export

  // Ref for triggering refresh in OwnerMoneyView
  const refreshMoneyRef = useCallback((fn) => {
    if (fn && typeof fn === 'function') {
      refreshMoneyRef.current = fn;
    }
  }, []);

  // Ref for triggering pending refresh in OwnerMoneyView
  const refreshPendingRef = useCallback((fn) => {
    if (fn && typeof fn === 'function') {
      refreshPendingRef.current = fn;
    }
  }, []);

  // Function to refresh owner data - called from context
  const refreshOwnerData = useCallback(() => {
    if (refreshMoneyRef.current && typeof refreshMoneyRef.current === 'function') {
      refreshMoneyRef.current();
    }
  }, []);

  // Function to refresh pending by day - called from context with affected days
  const refreshPendingByDay = useCallback((days) => {
    if (refreshPendingRef.current && typeof refreshPendingRef.current === 'function') {
      refreshPendingRef.current(days);
    }
  }, []);

  const contextValue = useMemo(() => ({
    refreshOwnerData,
    refreshPendingByDay,
  }), [refreshOwnerData, refreshPendingByDay]);

  return (
    <OwnerDataContext.Provider value={contextValue}>
      <div className="min-h-screen bg-neutral-950 text-neutral-100">
        
        {/* Logout button (fixed, next to debug) */}
        <button
          type="button"
          onClick={logout}
          className="fixed top-3 right-3 z-50 rounded-2xl border border-neutral-800 bg-neutral-950/40 backdrop-blur px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-900/40 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
          title="Выйти"
        >
          Выйти
        </button>
<main className="pb-24 pb-24">
          {tab === "money" && <OwnerMoneyView onRegisterRefresh={refreshMoneyRef} onRegisterPendingRefresh={refreshPendingRef} />}
          {tab === "compare" && <OwnerComparePeriodsView />}
          {tab === "boats" && <OwnerBoatsView />}
          {tab === "sellers" && <OwnerSellersView />}
          {tab === "motivation" && <OwnerMotivationView />}
          {tab === "settings" && <OwnerSettingsView />}
          {tab === "load" && <OwnerLoadView />}
          {tab === "export" && <OwnerExportView />}
        </main>

        <OwnerBottomTabs tab={tab} setTab={setTab} />
      </div>
    </OwnerDataContext.Provider>
  );
}

function OwnerBottomTabs({ tab, setTab }) {
  const [moreOpen, setMoreOpen] = useState(false);

  const go = (next) => {
    setTab(next);
    setMoreOpen(false);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 px-2 pb-2 pointer-events-auto">
      <div className="mx-auto w-fit px-2 py-2 md:rounded-full md:border md:border-neutral-800 md:bg-neutral-950/60 md:backdrop-blur">
        {/* MOBILE: 4 основных + Еще */}
        <div className="grid grid-cols-5 gap-1 md:hidden rounded-2xl">
          <TabButton
            label="Деньги"
            icon="₽"
            active={tab === "money"}
            onClick={() => go("money")}
            alwaysLabel
          />
          <TabButton
            label="Сравнение"
            icon="◆"
            active={tab === "compare"}
            onClick={() => go("compare")}
            alwaysLabel
          />
          <TabButton
            label="Лодки"
            icon="⛴"
            active={tab === "boats"}
            onClick={() => go("boats")}
            alwaysLabel
          />
          <TabButton
            label="Продавцы"
            icon="👤"
            active={tab === "sellers"}
            onClick={() => go("sellers")}
            alwaysLabel
          />
          <TabButton
            label="Еще"
            icon="⋯"
            active={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            alwaysLabel
          />
        </div>

        {/* DESKTOP/TABLET: все вкладки */}
        <div className="hidden md:grid md:auto-cols-max md:grid-flow-col gap-1">
          <TabButton
            label="Деньги"
            icon="₽"
            active={tab === "money"}
            onClick={() => go("money")}
          />
          <TabButton
            label="Сравнение"
            icon="◆"
            active={tab === "compare"}
            onClick={() => go("compare")}
          />
          <TabButton
            label="Лодки"
            icon="⛴"
            active={tab === "boats"}
            onClick={() => go("boats")}
          />
          <TabButton
            label="Продавцы"
            icon="👤"
            active={tab === "sellers"}
            onClick={() => go("sellers")}
          />
          <TabButton
            label="Мотивация"
            icon="🏆"
            active={tab === "motivation"}
            onClick={() => go("motivation")}
          />
          <TabButton
            label="Настройки"
            icon="⚙"
            active={tab === "settings"}
            onClick={() => go("settings")}
          />
          <TabButton
            label="Загрузка"
            icon="⬆"
            active={tab === "load"}
            onClick={() => go("load")}
          />
          <TabButton
            label="Экспорт"
            icon="⇩"
            active={tab === "export"}
            onClick={() => go("export")}
          />
        </div>
      </div>

      {/* MOBILE “ЕЩЕ” МЕНЮ */}
      {moreOpen && (
        <div className="md:hidden">
          <button
            type="button"
            aria-label="Закрыть меню"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40 bg-black/50"
          />
          <div className="fixed left-0 right-0 bottom-[64px] z-50 px-2">
            <div className="mx-auto max-w-[1100px] rounded-2xl border border-neutral-800 bg-neutral-950/60 backdrop-blur shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
              <div className="p-2 grid grid-cols-2 gap-2">
                <MoreItem
                  label="Мотивация"
                  icon="🏆"
                  active={tab === "motivation"}
                  onClick={() => go("motivation")}
                />
                <MoreItem
                  label="Настройки"
                  icon="⚙"
                  active={tab === "settings"}
                  onClick={() => go("settings")}
                />
                <MoreItem
                  label="Загрузка"
                  icon="⬆"
                  active={tab === "load"}
                  onClick={() => go("load")}
                />
                <MoreItem
                  label="Экспорт"
                  icon="⇩"
                  active={tab === "export"}
                  onClick={() => go("export")}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ label, icon, active, onClick, alwaysLabel = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center justify-center gap-2 rounded-2xl border px-2 py-2 text-sm",
        active
          ? "border-neutral-700 bg-neutral-900/70"
          : "border-neutral-800 bg-neutral-950/30 hover:bg-neutral-900/40",
      ].join(" ")}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className={alwaysLabel ? "inline" : "hidden md:inline"}>
        {label}
      </span>
    </button>
  );
}

function MoreItem({ label, icon, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center justify-between rounded-2xl border bg-neutral-950/30 px-3 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]",
        active
          ? "border-neutral-700 bg-neutral-900/70"
          : "border-neutral-800 bg-neutral-950/30 hover:bg-neutral-900/40",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span className="text-base leading-none">{icon}</span>
        <span className="text-sm">{label}</span>
      </div>
      <span className="text-neutral-500">›</span>
    </button>
  );
}
