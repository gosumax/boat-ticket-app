/**
 * OwnerMoneyView.jsx — экран "Деньги"
 * Стилизация под референс: iOS‑карточки, мягкие тени, компактные строки, нейтральные поверхности.
 * Логика/данные не трогаем — только UI.
 */

import { useMemo, useState } from "react";

export default function OwnerMoneyView() {
  // demo values (подменишь на реальные селекторы/props позже)
  const [comparePreset, setComparePreset] = useState("t_y");

  const dayBars = useMemo(
    () => [
      { v: 25, label: "Пн" },
      { v: 45, label: "Вт" },
      { v: 35, label: "Ср" },
      { v: 65, label: "Чт" },
      { v: 55, label: "Пт" },
      { v: 80, label: "Сб" },
      { v: 60, label: "Вс" },
    ],
    []
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-xl font-extrabold tracking-tight">Деньги</div>
        <div className="text-[11px] text-neutral-500">owner</div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-2">
        <Card className="col-span-2">
          <div className="text-[11px] text-neutral-500">Общая выручка</div>
          <div className="mt-1 text-3xl font-extrabold tracking-tight">1 240 000 ₽</div>
          <div className="mt-1 text-sm text-neutral-400">Средний чек: 3 450 ₽</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Pill label="Билетов" value="324" />
            <Pill label="Рейсов" value="18" />
            <Pill label="Загрузка" value="78%" accent="amber" />
          </div>
        </Card>

        <MiniCard label="Наличные" value="420 000 ₽" />
        <MiniCard label="Карта" value="820 000 ₽" />

        <MiniCard label="Диспетчер должен отдать" value="180 000 ₽" accent="amber" />
        <MiniCard label="ЗП продавцам выдано" value="186 000 ₽" />
      </div>

      {/* Week bars */}
      <Card className="mt-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Выручка по дням</div>
          <div className="text-[11px] text-neutral-500">неделя</div>
        </div>

        <div className="mt-3 flex items-end gap-2 h-[110px]">
          {dayBars.map((b) => (
            <div key={b.label} className="flex-1 flex flex-col items-center gap-2">
              <div
                className={[
                  "w-full rounded-md",
                  b.v < 35
                    ? "bg-red-900/70"
                    : b.v < 60
                    ? "bg-amber-900/70"
                    : "bg-emerald-900/70",
                ].join(" ")}
                style={{ height: `${b.v}%` }}
              />
              <div className="text-[10px] text-neutral-500">{b.label}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Compare */}
      <Card className="mt-2">
        <div className="flex items-end justify-between gap-2">
          <div className="text-sm font-semibold">Сравнение</div>
          <div className="text-[11px] text-neutral-500">периоды A/B</div>
        </div>

        <div className="mt-3">
          <Segmented
            options={[
              { k: "t_y", t: "Сегодня / Вчера" },
              { k: "y_yy", t: "Вчера / Позавчера" },
              { k: "t_wd", t: "Сегодня / день недели" },
              { k: "t_avg7", t: "Сегодня / среднее 7 дней" },
            ]}
            value={comparePreset}
            onChange={setComparePreset}
          />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <Picker title="Период A" value="Сегодня" />
          <Picker title="Период B" value="Вчера" />
        </div>

        <div className="mt-3 h-[200px] rounded-2xl border border-neutral-800 bg-neutral-900/30 flex items-center justify-center text-neutral-500">
          График (A / B)
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <DeltaRow label="Выручка" a="1 250 000 ₽" b="1 080 000 ₽" delta="+15.7%" />
          <DeltaRow label="Средний чек" a="5 200 ₽" b="4 850 ₽" delta="+7.2%" />
          <DeltaRow label="Загрузка лодок" a="78%" b="72%" delta="+6%" />
          <DeltaRow label="Активных продавцов" a="18" b="16" delta="+2" />
        </div>
      </Card>

      {/* Small summary rows */}
      <div className="mt-2 space-y-2">
        <Row label="% между A и B" value="+12.4%" tone="pos" />
        <Row label="% к среднему за неделю" value="+8.1%" tone="pos" />
        <Row label="% к тому же дню недели" value="−3.2%" tone="neg" />
      </div>
    </div>
  );
}

/* ---------- UI atoms ---------- */

function Card({ children, className = "" }) {
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

function MiniCard({ label, value, accent }) {
  const valueCls =
    accent === "amber"
      ? "text-amber-300"
      : accent === "emerald"
      ? "text-emerald-300"
      : "text-neutral-100";

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className={["mt-1 text-lg font-extrabold tracking-tight", valueCls].join(" ")}>
        {value}
      </div>
    </div>
  );
}

function Pill({ label, value, accent }) {
  const vCls =
    accent === "amber"
      ? "text-amber-300"
      : accent === "emerald"
      ? "text-emerald-300"
      : "text-neutral-100";
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-2 py-2">
      <div className="text-[10px] text-neutral-500">{label}</div>
      <div className={["mt-1 text-sm font-semibold", vCls].join(" ")}>{value}</div>
    </div>
  );
}

function Row({ label, value, tone }) {
  const vCls =
    tone === "pos" ? "text-emerald-300" : tone === "neg" ? "text-red-300" : "text-neutral-200";
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)] flex items-center justify-between gap-3">
      <div className="text-sm text-neutral-400">{label}</div>
      <div className={["text-sm font-semibold whitespace-nowrap", vCls].join(" ")}>{value}</div>
    </div>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-1">
      <div className="grid grid-cols-2 gap-1">
        {options.map((o) => (
          <button
            key={o.k}
            type="button"
            onClick={() => onChange(o.k)}
            className={[
              "rounded-xl px-2 py-2 text-xs font-semibold text-left",
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

function DeltaRow({ label, a, b, delta }) {
  const isNeg = String(delta).trim().startsWith("−") || String(delta).trim().startsWith("-");
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-neutral-400">{label}</div>
        <div
          className={[
            "text-xs font-semibold",
            isNeg ? "text-red-300" : "text-emerald-300",
          ].join(" ")}
        >
          {delta}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 px-2 py-2">
          <div className="text-[10px] text-neutral-500">A</div>
          <div className="text-sm font-semibold">{a}</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 px-2 py-2">
          <div className="text-[10px] text-neutral-500">B</div>
          <div className="text-sm font-semibold">{b}</div>
        </div>
      </div>
    </div>
  );
}
