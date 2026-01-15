/**
 * src/views/OwnerMotivationView.jsx
 * OWNER — Экран 4 — Мотивация (просмотр)
 *
 * По ТЗ:
 *  - 3.10 Текущая мотивация (текст)
 *  - 3.11 Переключатель типа мотивации (визуально, read-only)
 *  - 3.12 Фильтр периода (влияния на продажи нет — только фильтрация отображения)
 *  - 3.13 Выплаты по мотивации (командная/личная/адаптивная + накопительные фонды + детализация)
 *  - 3.14 Подвкладка — Рейтинг (недельный/сезонный)
 *
 * NOTE: UI mock only (no backend wiring).
 */

import { useMemo, useState } from "react";

function formatRUB(v) {
  const n = Number(v || 0);
  return n.toLocaleString("ru-RU") + " ₽";
}

export default function OwnerMotivationView() {
  // In real app: comes from settings
  const activeType = "adaptive"; // team | personal | adaptive

  const [period, setPeriod] = useState("today"); // today | yesterday | last7 | month | all
  const [subtab, setSubtab] = useState("payouts"); // payouts | rating
  const [ratingMode, setRatingMode] = useState("week"); // week | season

  // Mock dataset (stable, deterministic)
  const data = useMemo(() => {
    const sellers = [
      { id: 1, name: "Андрей" },
      { id: 2, name: "Максим" },
      { id: 3, name: "Илья" },
      { id: 4, name: "Кирилл" },
      { id: 5, name: "Сергей" },
      { id: 6, name: "Дмитрий" },
      { id: 7, name: "Аня" },
      { id: 8, name: "Оля" },
      { id: 9, name: "Миша" },
      { id: 10, name: "Рома" },
      { id: 11, name: "Игорь" },
      { id: 12, name: "Паша" },
      { id: 13, name: "Женя" },
      { id: 14, name: "Саша" },
      { id: 15, name: "Диспетчер" },
    ];

    // period multiplier only for UI perception
    const k =
      period === "today"
        ? 1
        : period === "yesterday"
        ? 0.92
        : period === "last7"
        ? 6.4
        : period === "month"
        ? 22
        : 68;

    const revenueTotal = Math.round(520000 * k);
    const percent = 15; // configurable in settings screen
    const fundTotal = Math.round(revenueTotal * (percent / 100));

    // Funds allocation for adaptive example
    const weeklyCut = 0.02; // 2% of motivation fund
    const seasonCut = 0.05; // 5% of motivation fund
    const toWeeklyFund = Math.round(fundTotal * weeklyCut);
    const toSeasonFund = Math.round(fundTotal * seasonCut);

    const fundNet = fundTotal - toWeeklyFund - toSeasonFund;

    const teamFund = Math.round(fundNet * 0.6);
    const personalFund = fundNet - teamFund;

    // Seller payouts (mock distribution)
    const base = teamFund / sellers.length;
    const personalWeights = sellers.map((s, idx) => (s.name === "Диспетчер" ? 0.7 : 1 + (idx % 5) * 0.12));
    const wSum = personalWeights.reduce((a, b) => a + b, 0);

    const items = sellers.map((s, idx) => {
      const team = Math.round(base);
      const personal = Math.round((personalFund * personalWeights[idx]) / wSum);
      return {
        ...s,
        team,
        personal,
        total: team + personal,
      };
    });

    const ratingWeek = items
      .filter((x) => x.name !== "Диспетчер")
      .map((x, idx) => ({
        place: idx + 1,
        name: x.name,
        points: 80 - idx * 4,
        payout: Math.round(12000 - idx * 650),
      }))
      .sort((a, b) => b.points - a.points);

    const ratingSeason = items
      .filter((x) => x.name !== "Диспетчер")
      .map((x, idx) => ({
        place: idx + 1,
        name: x.name,
        points: 1240 - idx * 55,
        payout: Math.round(180000 - idx * 8000),
      }))
      .sort((a, b) => b.points - a.points);

    return {
      revenueTotal,
      percent,
      fundTotal,
      toWeeklyFund,
      toSeasonFund,
      weeklyFundNow: Math.round(210000 + toWeeklyFund * 3),
      seasonFundNow: Math.round(1250000 + toSeasonFund * 9),
      fundNet,
      teamFund,
      personalFund,
      items,
      ratingWeek,
      ratingSeason,
    };
  }, [period]);

  const typeLabel =
    activeType === "team" ? "Командная" : activeType === "personal" ? "Личная" : "Адаптивная";

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24">
      {/* Header */}
      <div className="mb-3">
        <div className="text-xl font-extrabold tracking-tight">Мотивация</div>
        <div className="text-[11px] text-neutral-500 mt-1">
          Сейчас активна мотивация: <span className="text-neutral-100 font-semibold">{typeLabel}</span>
        </div>
      </div>

      {/* Type switch (read-only visual) */}
      <Card>
        <div className="text-[11px] text-neutral-500 mb-2">Тип мотивации (read-only)</div>
        <div className="grid grid-cols-3 gap-2">
          <Pill active={activeType === "team"}>Командная</Pill>
          <Pill active={activeType === "personal"}>Личная</Pill>
          <Pill active={activeType === "adaptive"}>Адаптивная</Pill>
        </div>
      </Card>

      {/* Period filter */}
      <div className="mt-3">
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { v: "today", t: "Сегодня" },
            { v: "yesterday", t: "Вчера" },
            { v: "last7", t: "7 дней" },
            { v: "month", t: "Месяц" },
            { v: "all", t: "Всё" },
          ]}
        />
      </div>

      {/* Subtabs */}
      <div className="mt-3">
        <Segmented
          value={subtab}
          onChange={setSubtab}
          options={[
            { v: "payouts", t: "Выплаты" },
            { v: "rating", t: "Рейтинг" },
          ]}
        />
      </div>

      {subtab === "payouts" ? (
        <>
          {/* Summary */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat title="Выручка (период)" value={formatRUB(data.revenueTotal)} />
            <Stat title="Процент мотивации" value={`${data.percent}%`} />
            <Stat title="Фонд мотивации" value={formatRUB(data.fundTotal)} />
            <Stat title="Итого к распределению" value={formatRUB(data.fundNet)} />
          </div>

          {/* Funds */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Card>
              <div className="text-sm text-neutral-400">Накопительные фонды</div>
              <div className="mt-2 space-y-2">
                <Row label="В недельный фонд отправлено" value={formatRUB(data.toWeeklyFund)} />
                <Row label="Текущая сумма недельного фонда" value={formatRUB(data.weeklyFundNow)} />
                <div className="h-px bg-neutral-800 my-2" />
                <Row label="В сезонный фонд отправлено" value={formatRUB(data.toSeasonFund)} />
                <Row label="Текущая сумма сезонного фонда" value={formatRUB(data.seasonFundNow)} />
              </div>
            </Card>

            <Card>
              <div className="text-sm text-neutral-400">Структура выплат</div>
              <div className="mt-2 space-y-2">
                {activeType === "team" && (
                  <>
                    <Row label="Фонд мотивации" value={formatRUB(data.fundNet)} />
                    <Row label="Выплата на 1 участника" value={formatRUB(Math.round(data.fundNet / data.items.length))} />
                  </>
                )}

                {activeType === "personal" && (
                  <>
                    <Row label="Фонд мотивации" value={formatRUB(data.fundNet)} />
                    <div className="text-xs text-neutral-500 mt-1">Выплаты — по личным продажам (список ниже)</div>
                  </>
                )}

                {activeType === "adaptive" && (
                  <>
                    <Row label="Общий фонд мотивации" value={formatRUB(data.fundNet)} />
                    <div className="h-px bg-neutral-800 my-2" />
                    <Row label="Командный фонд" value={formatRUB(data.teamFund)} />
                    <Row
                      label="Выплата на 1 участника"
                      value={formatRUB(Math.round(data.teamFund / data.items.length))}
                    />
                    <div className="h-px bg-neutral-800 my-2" />
                    <Row label="Личный фонд" value={formatRUB(data.personalFund)} />
                  </>
                )}
              </div>
            </Card>
          </div>

          {/* детализация по продавцам */}
          <div className="mt-3">
            <Card>
              <div className="flex items-center justify-between">
                <div className="text-base font-semibold">Детализация по участникам</div>
                <div className="text-xs text-neutral-500">read-only</div>
              </div>

              <div className="mt-3 space-y-2">
                <div className="hidden sm:grid grid-cols-4 text-xs text-neutral-500 px-2">
                  <div>Имя</div>
                  <div className="text-right">Командный</div>
                  <div className="text-right">Личный</div>
                  <div className="text-right">Итого</div>
                </div>

                {data.items.map((x) => (
                  <div
                    key={x.id}
                    className="grid grid-cols-2 sm:grid-cols-4 gap-1 items-center rounded-xl border border-neutral-800 bg-neutral-950 px-2 py-2"
                  >
                    <div className="font-medium">{x.name}</div>
                    <div className="text-right sm:text-right text-neutral-200">{formatRUB(x.team)}</div>
                    <div className="text-right sm:text-right text-neutral-200">{formatRUB(x.personal)}</div>
                    <div className="text-right font-semibold">{formatRUB(x.total)}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      ) : (
        <>
          {/* Rating */}
          <div className="mt-3">
            <Segmented
              value={ratingMode}
              onChange={setRatingMode}
              options={[
                { v: "week", t: "Недельный" },
                { v: "season", t: "Сезонный" },
              ]}
            />
          </div>

          <div className="mt-3">
            <Card>
              <div className="flex items-center justify-between">
                <div className="text-base font-semibold">Рейтинг</div>
                <div className="text-xs text-neutral-500">баллы → выплата</div>
              </div>

              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-4 text-xs text-neutral-500 px-2">
                  <div>Место</div>
                  <div>Имя</div>
                  <div className="text-right">Баллы</div>
                  <div className="text-right">Выплата</div>
                </div>

                {(ratingMode === "week" ? data.ratingWeek : data.ratingSeason).map((r) => (
                  <div
                    key={r.name}
                    className="grid grid-cols-4 gap-1 items-center rounded-xl border border-neutral-800 bg-neutral-950 px-2 py-2"
                  >
                    <div className="font-semibold">{r.place}</div>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-right">{r.points}</div>
                    <div className="text-right font-semibold">{formatRUB(r.payout)}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* UI helpers */

function Card({ children }) {
  return <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">{children}</div>;
}

function Stat({ title, value }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <div className="text-xs text-neutral-500">{title}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="text-sm text-neutral-300">{label}</div>
      <div className="text-sm font-semibold whitespace-nowrap">{value}</div>
    </div>
  );
}

function Pill({ active, children }) {
  return (
    <div
      className={[
        "rounded-xl border px-3 py-2 text-center text-xs font-semibold",
        active ? "border-neutral-700 bg-neutral-900 text-neutral-100" : "border-neutral-800 bg-transparent text-neutral-400",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <div className="grid grid-cols-5 gap-1">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={[
              "rounded-xl px-2 py-2 text-xs font-semibold",
              value === o.v ? "bg-neutral-900 text-neutral-100" : "bg-neutral-950 text-neutral-400 hover:text-neutral-200",
            ].join(" ")}
          >
            {o.t}
          </button>
        ))}
      </div>
    </div>
  );
}
