/**
 * src/views/OwnerSellersView.jsx
 * OWNER — Продавцы / Эффективность — UI ONLY
 * Per TZ:
 *  - 3.8 Верхний блок — Общая картина:
 *      • Выручка всеми продавцами
 *      • Средняя выручка на продавца
 *      • Активных продавцов сегодня
 *  - 3.9 Карточка продавца:
 *      • Имя, выручка, средний чек, продано мест, рейсов с продажами,
 *        средняя загрузка рейса %, доля от общей выручки %
 *      • Продано по типам (кол-во мест): прогулочные/скоростные/банан/рыбалка
 *
 * NOTE: This file is UI mock only (no backend wiring).
 */

export default function OwnerSellersView() {
  const totals = {
    revenueAll: "1 640 000 ₽",
    avgPerSeller: "117 000 ₽",
    activeSellers: "12",
  };

  // Mock sellers list (UI only)
  const sellers = [
    {
      name: "Андрей",
      revenue: "182 000 ₽",
      avgCheck: "3 820 ₽",
      seatsSold: 48,
      tripsWithSales: 9,
      avgFill: "71%",
      share: "11.1%",
      byType: { walk: 18, fast: 22, banana: 8, fishing: 0 },
    },
    {
      name: "Илья",
      revenue: "164 000 ₽",
      avgCheck: "3 410 ₽",
      seatsSold: 52,
      tripsWithSales: 10,
      avgFill: "69%",
      share: "10.0%",
      byType: { walk: 26, fast: 18, banana: 6, fishing: 2 },
    },
    {
      name: "Сергей",
      revenue: "146 000 ₽",
      avgCheck: "3 650 ₽",
      seatsSold: 41,
      tripsWithSales: 8,
      avgFill: "74%",
      share: "8.9%",
      byType: { walk: 14, fast: 21, banana: 6, fishing: 0 },
    },
    {
      name: "Денис",
      revenue: "128 000 ₽",
      avgCheck: "3 210 ₽",
      seatsSold: 39,
      tripsWithSales: 7,
      avgFill: "66%",
      share: "7.8%",
      byType: { walk: 20, fast: 12, banana: 7, fishing: 0 },
    },
    {
      name: "Никита",
      revenue: "112 000 ₽",
      avgCheck: "3 520 ₽",
      seatsSold: 33,
      tripsWithSales: 6,
      avgFill: "63%",
      share: "6.8%",
      byType: { walk: 12, fast: 15, banana: 6, fishing: 0 },
    },
  ];

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24 space-y-3">
      <div className="text-xl font-extrabold tracking-tight">Продавцы</div>

      {/* 3.8 Верхний блок — Общая картина */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="col-span-2" title="Выручка всеми продавцами" value={totals.revenueAll} />
        <Card title="Средняя выручка на продавца" value={totals.avgPerSeller} />
        <Card title="Активных продавцов сегодня" value={totals.activeSellers} />
      </div>

      {/* 3.9 Карточки продавцов */}
      <div className="space-y-3">
        <div className="text-sm font-semibold text-neutral-100 px-1">Эффективность</div>

        {sellers.map((s) => (
          <details
            key={s.name}
            className="group rounded-2xl border border-neutral-800 bg-neutral-950/40 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
          >
            <summary className="cursor-pointer select-none list-none px-3 py-3 [&::-webkit-details-marker]:hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-extrabold tracking-tight truncate">{s.name}</div>
                  <div className="text-xs text-neutral-500 mt-1">Доля от общей выручки: {s.share}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-neutral-500">Выручка</div>
                  <div className="text-lg font-extrabold tracking-tight">{s.revenue}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end">
                <div className="text-xs text-neutral-500 group-open:hidden">Нажмите, чтобы раскрыть</div>
                <div className="text-xs text-neutral-500 hidden group-open:block">Свернуть</div>
              </div>
            </summary>

            <div className="px-4 pb-4 pt-0 border-t border-neutral-800">
              <div className="grid grid-cols-2 gap-3 mt-4">
                <Card title="Средний чек" value={s.avgCheck} />
                <Card title="Продано мест" value={s.seatsSold} />
                <Card title="Рейсов с продажами" value={s.tripsWithSales} />
                <Card title="Средняя загрузка рейса" value={s.avgFill} />
              </div>

              <div className="mt-4">
                <div className="text-xs text-neutral-500 mb-2">Продано по типам (мест)</div>
                <div className="grid grid-cols-2 gap-2">
                  <TypePill label="Прогулочные" value={s.byType.walk} />
                  <TypePill label="Скоростные" value={s.byType.fast} />
                  <TypePill label="Банан" value={s.byType.banana} />
                  <TypePill label="Рыбалка" value={s.byType.fishing} />
                </div>
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
    <div className={`rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)] ${className}`}>
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

function TypePill({ label, value }) {
  const isZero = Number(value) === 0;
  return (
    <div className={`flex items-center justify-between rounded-xl border bg-neutral-950/30 px-3 py-2 ${
      isZero ? "border-neutral-800 text-neutral-500" : "border-neutral-700 text-neutral-200"
    }`}>
      <div className="text-xs text-neutral-300">{label}</div>
      <div className={`text-xs font-semibold ${isZero ? "text-neutral-600" : "text-neutral-100"}`}>
        {value}
      </div>
    </div>
  );
}