/**
 * OwnerBoatsView.jsx — экран "Лодки"
 * Стилизация под референс: iOS‑карточки, мягкие тени, компактные строки, нейтральные поверхности.
 * Логика/данные не трогаем — только UI.
 */

import { useState } from "react";

export default function OwnerBoatsView() {
  const [preset, setPreset] = useState("today");

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-xl font-extrabold tracking-tight">Лодки</div>
        <div className="text-[11px] text-neutral-500">owner</div>
      </div>

      {/* Верхняя сводка */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard title="Выручка общая" value="2 480 000 ₽" />
        <StatCard title="Заполненность общая" value="76%" accent="amber" />
      </div>

      {/* Сравнение лодок */}
      <Surface className="mt-2">
        <div className="flex items-end justify-between gap-2">
          <div className="text-sm font-semibold">Сравнение лодок</div>
          <div className="text-[11px] text-neutral-500">период</div>
        </div>

        <div className="mt-3">
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

        <div className="mt-2 grid grid-cols-2 gap-2">
          <Picker title="Дата с" value="Сегодня" />
          <Picker title="Дата по" value="Сегодня" />
        </div>

        <div className="mt-3 h-[220px] rounded-2xl border border-neutral-800 bg-neutral-900/30 flex items-center justify-center text-neutral-500">
          LINE / SCATTER GRAPH (UI MOCK)
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniInfo label="X" value="Пассажиры" />
          <MiniInfo label="Y" value="Выручка" />
        </div>
      </Surface>

      {/* По типам лодок */}
      <div className="mt-2 space-y-2">
        <div className="text-sm font-semibold px-1">По типам лодок</div>

        <AggRow label="Скоростные" value="820 000 ₽" sub="72%" />
        <AggRow label="Прогулочные" value="1 120 000 ₽" sub="78%" />
        <AggRow label="Банан" value="420 000 ₽" sub="81%" />
        <AggRow label="Рыбалка" value="120 000 ₽" sub="65%" />
      </div>

      {/* Детализация по лодкам */}
      <div className="mt-2 space-y-2">
        <div className="text-sm font-semibold px-1">Детализация по лодкам</div>

        <Group title="Скоростные">
          <DetailRow name="Sea Fox" value="420 000 ₽" sub="70%" />
          <DetailRow name="Wave Rider" value="400 000 ₽" sub="74%" />
        </Group>

        <Group title="Прогулочные">
          <DetailRow name="Poseidon" value="520 000 ₽" sub="79%" />
          <DetailRow name="Lagoon" value="600 000 ₽" sub="77%" />
        </Group>

        <Group title="Банан">
          <DetailRow name="Banana #1" value="210 000 ₽" sub="82%" />
          <DetailRow name="Banana #2" value="210 000 ₽" sub="80%" />
        </Group>

        <Group title="Рыбалка">
          <DetailRow name="Fisher Pro" value="120 000 ₽" sub="65%" />
        </Group>
      </div>
    </div>
  );
}

/* ---------- UI atoms ---------- */

function Surface({ children, className = "" }) {
  return (
    <div
      className={[
        "rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3",
        "shadow-[0_10px_30px_rgba(0,0,0,0.35)]",
        className,
      ].join(" ")}
    >
      {children}
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
      <div className={["mt-1 text-lg font-extrabold tracking-tight", vCls].join(" ")}>
        {value}
      </div>
    </div>
  );
}

function Picker({ title, value }) {
  return (
    <button
      type="button"
      className="rounded-2xl border border-neutral-800 bg-neutral-950/30 px-3 py-3 text-left hover:bg-neutral-900/30"
    >
      <div className="text-[11px] text-neutral-500">{title}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </button>
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

function MiniInfo({ label, value }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/30 px-3 py-3">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function AggRow({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)] flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-semibold text-neutral-200">{label}</div>
        <div className="text-[11px] text-neutral-500">Загрузка: {sub}</div>
      </div>
      <div className="text-sm font-extrabold tracking-tight">{value}</div>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 shadow-[0_10px_30px_rgba(0,0,0,0.25)] overflow-hidden">
      <div className="px-3 py-3 border-b border-neutral-800 text-sm font-semibold text-neutral-200">
        {title}
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({ name, value, sub }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 px-3 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-neutral-200 truncate">{name}</div>
        <div className="text-[11px] text-neutral-500">Загрузка: {sub}</div>
      </div>
      <div className="text-sm font-extrabold tracking-tight whitespace-nowrap">{value}</div>
    </div>
  );
}
