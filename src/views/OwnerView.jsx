import { useAuth } from "../contexts/AuthContext";
import { useMemo, useState } from "react";
import OwnerMoneyView from "./OwnerMoneyView";
import OwnerBoatsView from "./OwnerBoatsView";
import OwnerSellersView from "./OwnerSellersView";
import OwnerMotivationView from "./OwnerMotivationView";
import OwnerSettingsView from "./OwnerSettingsView";
import OwnerLoadView from "./OwnerLoadView";
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
  const [preset, setPreset] = useState("week"); // week | month | season | custom

  const periodLabels = useMemo(() => {
    switch (preset) {
      case "week":
        return { a: "Эта неделя", b: "Прошлая неделя" };
      case "month":
        return { a: "Этот месяц", b: "Прошлый месяц" };
      case "season":
        return { a: "Текущий сезон", b: "Прошлый сезон" };
      default:
        return { a: "Период A", b: "Период B" };
    }
  }, [preset]);

  const metrics = [
    { title: "Выручка", a: "2 480 000 ₽", b: "2 120 000 ₽", delta: "+17%" },
    { title: "Средний чек", a: "3 950 ₽", b: "3 700 ₽", delta: "+6.8%" },
    { title: "Загрузка лодок", a: "76%", b: "71%", delta: "+5%" },
    { title: "Активные продавцы", a: "12", b: "11", delta: "+1" },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="text-xl font-semibold">Owner · Сравнение периодов</div>

      {/* Presets */}
      <div className="flex flex-wrap gap-2 pb-1 overflow-x-hidden">
        <PresetChip
          active={preset === "week"}
          onClick={() => setPreset("week")}
          label="Эта неделя ↔ прошлая"
        />
        <PresetChip
          active={preset === "month"}
          onClick={() => setPreset("month")}
          label="Этот месяц ↔ прошлый"
        />
        <PresetChip
          active={preset === "season"}
          onClick={() => setPreset("season")}
          label="Сезон ↔ прошлый"
        />
        <PresetChip
          active={preset === "custom"}
          onClick={() => setPreset("custom")}
          label="Произвольный ↔ произвольный"
        />
      </div>

      {/* Period A / B pickers (UI buttons) */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="rounded-2xl border border-neutral-800 p-3 text-left"
        >
          <div className="text-xs text-neutral-500">Период A</div>
          <div className="font-semibold mt-1">{periodLabels.a}</div>
          <div className="text-xs text-neutral-600 mt-1">выбор позже</div>
        </button>
        <button
          type="button"
          className="rounded-2xl border border-neutral-800 p-3 text-left"
        >
          <div className="text-xs text-neutral-500">Период B</div>
          <div className="font-semibold mt-1">{periodLabels.b}</div>
          <div className="text-xs text-neutral-600 mt-1">выбор позже</div>
        </button>
      </div>

      {/* Metrics comparison */}
      <div className="space-y-3">
        {metrics.map((m) => (
          <div
            key={m.title}
            className="rounded-2xl border border-neutral-800 p-4"
          >
            <div className="text-sm text-neutral-400 mb-2">{m.title}</div>
            <div className="grid grid-cols-3 gap-3 items-end">
              <div className="min-w-0">
                <div className="text-xs text-neutral-500">A</div>
                <div className="font-semibold truncate">{m.a}</div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-neutral-500">B</div>
                <div className="font-semibold truncate">{m.b}</div>
              </div>
              <div className="font-semibold text-amber-400 whitespace-nowrap text-right">
                {m.delta}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
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

  return (
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
        {tab === "money" && <OwnerMoneyView />}
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
