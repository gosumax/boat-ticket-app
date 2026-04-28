import { useAuth } from "../contexts/AuthContext";
import { lazy, Suspense, useEffect, useState } from "react";
import apiClient from "../utils/apiClient.js";
import DateFieldPicker from "../components/ui/DateFieldPicker.jsx";

const OwnerMoneyView = lazy(() => import("./OwnerMoneyView"));
const OwnerBoatsView = lazy(() => import("./OwnerBoatsView"));
const OwnerSellersView = lazy(() => import("./OwnerSellersView"));
const OwnerMotivationView = lazy(() => import("./OwnerMotivationView"));
const OwnerSettingsView = lazy(() => import("./OwnerSettingsView"));
const OwnerLoadView = lazy(() => import("../components/owner/OwnerLoadView.jsx"));
const OwnerExportView = lazy(() => import("./OwnerExportView"));

/**
 * OwnerView.jsx
 * OWNER SHELL (UI ONLY)
 * - Bottom navigation stays fixed.
 * - Default main tab: Money.
 * - No actions here should affect sales, trips, or tickets.
 */

/**
 * SCREEN 0 - Owner comparison view
 * Unified LineChart for: Revenue / Boats / Sellers
 */function OwnerComparePeriodsView() {
  const [compareMode, setCompareMode] = useState("revenue");
  const [chartMode, setChartMode] = useState("daily");

  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
  const [fromA, setFromA] = useState(twoWeeksAgo);
  const [toA, setToA] = useState(weekAgo);
  const [fromB, setFromB] = useState(weekAgo);
  const [toB, setToB] = useState(today);
  const [entityFrom, setEntityFrom] = useState(weekAgo);
  const [entityTo, setEntityTo] = useState(today);

  const [selectedBoatId, setSelectedBoatId] = useState(null);
  const [selectedBoatId2, setSelectedBoatId2] = useState(null);
  const [selectedSellerId, setSelectedSellerId] = useState(null);
  const [selectedSellerId2, setSelectedSellerId2] = useState(null);
  const [boats, setBoats] = useState([]);
  const [sellers, setSellers] = useState([]);

  const [periodSummary, setPeriodSummary] = useState(null);
  const [periodSummaryBusy, setPeriodSummaryBusy] = useState(false);

  useEffect(() => {
    const loadBoats = async () => {
      try {
        const json = await apiClient.request('/owner/boats?preset=all', { method: 'GET' });
        const items = json?.data?.boats || [];
        setBoats(items);
        if (items.length > 0 && !selectedBoatId) {
          setSelectedBoatId(items[0].boat_id);
        }
      } catch {}
    };
    if (compareMode === 'boats') loadBoats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode]);

  useEffect(() => {
    const loadSellers = async () => {
      try {
        const json = await apiClient.request('/owner/sellers?preset=all', { method: 'GET' });
        const items = json?.data?.items || [];
        setSellers(items);
        if (items.length > 0 && !selectedSellerId) {
          setSelectedSellerId(items[0].seller_id);
        }
      } catch {}
    };
    if (compareMode === 'sellers') loadSellers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode]);

  useEffect(() => {
    const loadPeriodSummary = async () => {
      if (compareMode !== 'revenue') return;
      if (!fromA || !toA || !fromB || !toB) return;
      setPeriodSummaryBusy(true);
      try {
        const url = "/owner/money/compare-periods?fromA=" + encodeURIComponent(fromA) + "&toA=" + encodeURIComponent(toA) + "&fromB=" + encodeURIComponent(fromB) + "&toB=" + encodeURIComponent(toB);
        const json = await apiClient.request(url, { method: 'GET' });
        setPeriodSummary(json?.data || null);
      } catch {
        setPeriodSummary(null);
      } finally {
        setPeriodSummaryBusy(false);
      }
    };
    loadPeriodSummary();
  }, [compareMode, fromA, toA, fromB, toB]);

  return (
    <div className="p-4 pb-24 space-y-4">
      <div className="text-xl font-semibold">Сравнение</div>

      <div className="rounded-2xl border border-neutral-800 p-3 text-xs text-neutral-500">
        Сравнение использует дату оплаты (`business_day`).
      </div>

      <div className="rounded-2xl border border-neutral-800 p-1 flex gap-1">
        <ModeChip active={compareMode === "revenue"} onClick={() => setCompareMode("revenue")} label="Выручка" />
        <ModeChip active={compareMode === "boats"} onClick={() => setCompareMode("boats")} label="Лодки" />
        <ModeChip active={compareMode === "sellers"} onClick={() => setCompareMode("sellers")} label="Продавцы" />
      </div>

      {compareMode === 'revenue' ? (
        <div className="rounded-2xl border border-neutral-800 p-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DateFieldPicker
              label="Период A: с"
              value={fromA}
              onChange={setFromA}
              tone="dark"
              sheetTitle="Период A: начало"
              sheetDescription="Выберите начало первого периода."
            />
            <DateFieldPicker
              label="Период A: по"
              value={toA}
              onChange={setToA}
              tone="dark"
              min={fromA}
              sheetTitle="Период A: конец"
              sheetDescription="Выберите конец первого периода."
            />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DateFieldPicker
              label="Период B: с"
              value={fromB}
              onChange={setFromB}
              tone="dark"
              sheetTitle="Период B: начало"
              sheetDescription="Выберите начало второго периода."
            />
            <DateFieldPicker
              label="Период B: по"
              value={toB}
              onChange={setToB}
              tone="dark"
              min={fromB}
              sheetTitle="Период B: конец"
              sheetDescription="Выберите конец второго периода."
            />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-neutral-800 p-3 space-y-3">
          <div className="text-xs text-neutral-500">Один общий период для сравнения двух сущностей</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DateFieldPicker
              label="Период: с"
              value={entityFrom}
              onChange={setEntityFrom}
              tone="dark"
              sheetTitle="Начало общего периода"
              sheetDescription="Выберите дату начала общего периода."
            />
            <DateFieldPicker
              label="Период: по"
              value={entityTo}
              onChange={setEntityTo}
              tone="dark"
              min={entityFrom}
              sheetTitle="Конец общего периода"
              sheetDescription="Выберите дату окончания общего периода."
            />
          </div>
        </div>
      )}

      {compareMode === 'boats' && boats.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <EntitySelect label="Лодка 1" value={selectedBoatId} onChange={setSelectedBoatId} options={boats.map((b) => ({ id: b.boat_id, name: b.boat_name }))} testId="owner-compare-boat-a" />
          <EntitySelect label="Лодка 2" value={selectedBoatId2} onChange={setSelectedBoatId2} options={boats.map((b) => ({ id: b.boat_id, name: b.boat_name }))} allowEmpty emptyLabel="Без второй лодки" testId="owner-compare-boat-b" />
        </div>
      )}

      {compareMode === 'sellers' && sellers.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <EntitySelect label="Продавец 1" value={selectedSellerId} onChange={setSelectedSellerId} options={sellers.map((s) => ({ id: s.seller_id, name: s.seller_name }))} testId="owner-compare-seller-a" />
          <EntitySelect label="Продавец 2" value={selectedSellerId2} onChange={setSelectedSellerId2} options={sellers.map((s) => ({ id: s.seller_id, name: s.seller_name }))} allowEmpty emptyLabel="Без второго продавца" testId="owner-compare-seller-b" />
        </div>
      )}

      <UnifiedLineChart
        compareMode={compareMode}
        chartMode={chartMode}
        setChartMode={setChartMode}
        fromA={fromA}
        toA={toA}
        fromB={fromB}
        toB={toB}
        entityFrom={entityFrom}
        entityTo={entityTo}
        boatId={selectedBoatId}
        boatId2={selectedBoatId2}
        sellerId={selectedSellerId}
        sellerId2={selectedSellerId2}
      />

      {compareMode === 'revenue' && (
        <PeriodSummaryCards data={periodSummary} busy={periodSummaryBusy} />
      )}
    </div>
  );
}
function ModeChip({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex-1 px-3 py-2 rounded-xl text-sm font-medium transition-colors",
        active
          ? "bg-amber-900/40 text-amber-300 border border-amber-500/50"
          : "text-neutral-400 hover:bg-neutral-800/50",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

/**
 * Unified LineChart Component
 */
function EntitySelect({ label, value, onChange, options, allowEmpty = false, emptyLabel = '-', testId }) {
  return (
    <div className="rounded-2xl border border-neutral-800 p-3 space-y-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <select
        value={value || ''}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200"
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.name}</option>
        ))}
      </select>
    </div>
  );
}

function UnifiedLineChart({ compareMode, chartMode, setChartMode, fromA, toA, fromB, toB, entityFrom, entityTo, boatId, boatId2, sellerId, sellerId2 }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [chartComponents, setChartComponents] = useState(null);

  const parseDate = (s) => new Date(s + 'T00:00:00');
  const activeFrom = compareMode === 'revenue' ? fromA : entityFrom;
  const activeTo = compareMode === 'revenue' ? toA : entityTo;
  const activeDays = activeFrom && activeTo ? Math.ceil((parseDate(activeTo) - parseDate(activeFrom)) / 86400000) + 1 : 0;
  const isEntityMode = compareMode === 'boats' || compareMode === 'sellers';
  const hasSecondEntity = compareMode === 'boats' ? Boolean(boatId2) : compareMode === 'sellers' ? Boolean(sellerId2) : true;

  const load = async () => {
    if (compareMode === 'revenue') {
      if (!fromA || !toA || !fromB || !toB) return;
    } else {
      if (!entityFrom || !entityTo) return;
      if (compareMode === 'boats' && !boatId) return;
      if (compareMode === 'sellers' && !sellerId) return;
    }

    setErr("");
    setBusy(true);
    try {
      let url = '';
      if (compareMode === 'revenue') {
        url = "/owner/money/compare-periods-daily?fromA=" + encodeURIComponent(fromA) + "&toA=" + encodeURIComponent(toA) + "&fromB=" + encodeURIComponent(fromB) + "&toB=" + encodeURIComponent(toB) + "&mode=" + chartMode;
      } else if (compareMode === 'boats') {
        url = "/owner/money/compare-boat-daily?boatIdA=" + encodeURIComponent(boatId) + "&from=" + encodeURIComponent(entityFrom) + "&to=" + encodeURIComponent(entityTo) + (boatId2 ? "&boatIdB=" + encodeURIComponent(boatId2) : '') + "&mode=" + chartMode;
      } else if (compareMode === 'sellers') {
        url = "/owner/money/compare-seller-daily?sellerIdA=" + encodeURIComponent(sellerId) + "&from=" + encodeURIComponent(entityFrom) + "&to=" + encodeURIComponent(entityTo) + (sellerId2 ? "&sellerIdB=" + encodeURIComponent(sellerId2) : '') + "&mode=" + chartMode;
      }

      const json = await apiClient.request(url, { method: "GET" });
      setData(json?.data || null);
      setWarnings(json?.meta?.warnings || []);
    } catch (e) {
      setErr(e?.message || "Failed to load chart data.");
      setData(null);
      setWarnings([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode, chartMode, fromA, toA, fromB, toB, entityFrom, entityTo, boatId, boatId2, sellerId, sellerId2]);

  const points = data?.points || [];
  const periodA = data?.periodA || {};
  const periodB = data?.periodB || {};
  const sharedPeriod = data?.period || {};
  const seriesALabel = compareMode === 'revenue' ? ('A: ' + (periodA.from || '-') + ' -> ' + (periodA.to || '-')) : (data?.entityAName || 'Сущность 1');
  const seriesBLabel = compareMode === 'revenue' ? ('B: ' + (periodB.from || '-') + ' -> ' + (periodB.to || '-')) : (data?.entityBName || 'Сущность 2');

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;
    const a = payload.find(p => p.dataKey === 'A')?.value || 0;
    const b = payload.find(p => p.dataKey === 'B')?.value || 0;
    const deltaAbs = a - b;
    const deltaPct = b > 0 ? ((a - b) / b) * 100 : null;
    const isPositive = deltaAbs >= 0;

    return (
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-3 text-xs">
        <div className="text-neutral-400 mb-2">День {label}</div>
        <div className="flex justify-between gap-4">
          <span className="text-blue-400">{seriesALabel}:</span>
          <span className="text-neutral-200">{formatRUB(a)}</span>
        </div>
        {(compareMode === 'revenue' || hasSecondEntity) && (
          <div className="flex justify-between gap-4">
            <span className="text-amber-400">{seriesBLabel}:</span>
            <span className="text-neutral-200">{formatRUB(b)}</span>
          </div>
        )}
        {(compareMode === 'revenue' || hasSecondEntity) && (
          <div className="border-t border-neutral-700 mt-2 pt-2">
            <div className="flex justify-between gap-4">
              <span className="text-neutral-400">Разница:</span>
              <span className={isPositive ? "text-green-400" : "text-red-400"}>
                {isPositive ? '+' : ''}{formatRUBShort(deltaAbs)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-neutral-400">Разница %:</span>
              <span className={isPositive ? "text-green-400" : "text-red-400"}>
                {deltaPct !== null ? (deltaPct >= 0 ? '+' : '') + deltaPct.toFixed(1) + '%' : '-'}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const hasData = points.some(p => p.A > 0 || p.B > 0);

  useEffect(() => {
    if (!hasData || chartComponents) return;
    let cancelled = false;
    import("./ownerRecharts.js").then((module) => {
      if (!cancelled) setChartComponents(module);
    });
    return () => {
      cancelled = true;
    };
  }, [hasData, chartComponents]);

  const {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
  } = chartComponents || {};

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="flex rounded-lg border border-neutral-700 overflow-hidden">
          <button type="button" onClick={() => setChartMode('daily')} className={`px-3 py-1 text-xs ${chartMode === 'daily' ? 'bg-neutral-700 text-white' : 'text-neutral-400'}`}>
            По дням
          </button>
          <button type="button" onClick={() => setChartMode('cumulative')} className={`px-3 py-1 text-xs ${chartMode === 'cumulative' ? 'bg-neutral-700 text-white' : 'text-neutral-400'}`}>
            Накопительно
          </button>
        </div>
      </div>

      {err && <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">{err}</div>}

      {warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-900/60 bg-amber-950/30 p-3">
          <div className="text-xs text-amber-300 font-medium mb-1">Предупреждения</div>
          {warnings.map((w, i) => (<div key={i} className="text-xs text-amber-200/70">{w}</div>))}
        </div>
      )}

      {busy && <div className="rounded-2xl border border-neutral-800 p-4 text-sm text-neutral-500">Загрузка...</div>}

      {!busy && !hasData && !err && (
        <div className="rounded-2xl border border-neutral-800 p-4 text-sm text-neutral-500">Нет данных за выбранный период</div>
      )}

      {!busy && hasData && !chartComponents && (
        <div className="rounded-2xl border border-neutral-800 p-4 text-sm text-neutral-500">Загрузка...</div>
      )}

      {!busy && hasData && chartComponents && (
        <div className="rounded-2xl border border-neutral-800 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-neutral-500">
              {compareMode === 'revenue'
                ? 'Выручка (чистая)'
                : compareMode === 'boats'
                  ? ('Лодки: ' + (data?.entityAName || '-') + (hasSecondEntity ? ' / ' + (data?.entityBName || '-') : ''))
                  : ('Продавцы: ' + (data?.entityAName || '-') + (hasSecondEntity ? ' / ' + (data?.entityBName || '-') : ''))}
              <span className="ml-2 text-neutral-600">({chartMode === 'cumulative' ? 'Накопительно' : 'По дням'})</span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal vertical={false} />
                <XAxis dataKey="day" tick={{ fill: '#888', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#333' }} tickFormatter={(v, i) => (i % 5 === 0 || i === 0) ? v : ''} />
                <YAxis tick={{ fill: '#888', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#333' }} tickFormatter={v => formatRUBShort(v)} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="A" stroke="#3b82f6" strokeWidth={3} dot={false} activeDot={{ r: 5, fill: '#3b82f6' }} name={seriesALabel} />
                {(compareMode === 'revenue' || hasSecondEntity) && <Line type="monotone" dataKey="B" stroke="#f59e0b" strokeWidth={2} strokeOpacity={0.8} dot={false} activeDot={{ r: 5, fill: '#f59e0b' }} name={seriesBLabel} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-6 mt-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-blue-500"></div>
              <span className="text-xs text-neutral-400">{seriesALabel}</span>
            </div>
            {(compareMode === 'revenue' || hasSecondEntity) && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-amber-500 opacity-80"></div>
                <span className="text-xs text-neutral-400">{seriesBLabel}</span>
              </div>
            )}
            {isEntityMode && <div className="text-xs text-neutral-500">{sharedPeriod.from || '-'} {'->'} {sharedPeriod.to || '-'}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
function formatRUBShort(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(1)} млн ₽`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(0)} тыс ₽`;
  return `${n} ₽`;
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
    return `${Math.round(n)} RUB`;
  }
}

/**
 * Period Summary Cards - shows cash/card breakdown for each period
 */
function PeriodSummaryCards({ data, busy }) {
  if (busy) {
    return (
      <div className="rounded-2xl border border-neutral-800 p-4 text-sm text-neutral-500">
        Загрузка сводки...
      </div>
    );
  }

  if (!data) return null;

  const periodA = data.periodA || {};
  const periodB = data.periodB || {};
  const delta = data.delta || {};

  // Delta display helper
  const renderDelta = (abs, percent) => {
    const isPositive = abs >= 0;
    const cls = isPositive ? "text-emerald-400" : "text-red-400";
    const pctStr = percent !== null ? `${isPositive ? '+' : ''}${percent.toFixed(1)}%` : '0%';
    return (
      <span className={cls}>
        {isPositive ? '+' : ''}{formatRUB(abs)} ({pctStr})
      </span>
    );
  };

  return (
    <div className="space-y-3 mt-4">
      <div className="text-sm font-semibold text-neutral-300">Сводка по периодам</div>

      {/* Period Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Period A */}
        <PeriodCard
          title="Период A"
          from={periodA.from}
          to={periodA.to}
          collected_total={periodA.collected_total}
          collected_cash={periodA.collected_cash}
          collected_card={periodA.collected_card}
          refund_total={periodA.refund_total}
          refund_cash={periodA.refund_cash}
          refund_card={periodA.refund_card}
          net_total={periodA.net_total}
          net_cash={periodA.net_cash}
          net_card={periodA.net_card}
          accent="blue"
        />

        {/* Period B */}
        <PeriodCard
          title="Период B"
          from={periodB.from}
          to={periodB.to}
          collected_total={periodB.collected_total}
          collected_cash={periodB.collected_cash}
          collected_card={periodB.collected_card}
          refund_total={periodB.refund_total}
          refund_cash={periodB.refund_cash}
          refund_card={periodB.refund_card}
          net_total={periodB.net_total}
          net_cash={periodB.net_cash}
          net_card={periodB.net_card}
          accent="amber"
        />
      </div>

      {/* Delta Block */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="text-xs text-neutral-500 mb-3">Изменение (A - B)</div>
        <div className="space-y-2">
          <DeltaRow label="Разница по выручке" abs={delta.revenue_gross_abs} percent={delta.revenue_gross_percent} />
          <DeltaRow label="Разница по возвратам" abs={delta.refund_abs} percent={delta.refund_percent} invertColors />
          <DeltaRow label="Разница по чистым деньгам" abs={delta.net_total_abs} percent={delta.net_total_percent} />
        </div>
      </div>
    </div>
  );
}

/**
 * Single Period Card
 */
function PeriodCard({
  title, from, to,
  collected_total, collected_cash, collected_card,
  refund_total, refund_cash, refund_card,
  net_total, net_cash, net_card,
  accent
}) {
  const borderCls = accent === 'blue' ? 'border-blue-900/50' : 'border-amber-900/50';
  const titleCls = accent === 'blue' ? 'text-blue-300' : 'text-amber-300';
  const hasRefunds = refund_total > 0;

  return (
    <div className={`rounded-2xl border ${borderCls} bg-neutral-950/40 p-3 space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${titleCls}`}>{title}</span>
        <span className="text-xs text-neutral-500">{from} {'->'} {to}</span>
      </div>

      {/* Collected */}
      <div>
        <div className="text-[11px] text-neutral-500">Собранная выручка</div>
        <div className="text-lg font-bold">{formatRUB(collected_total)}</div>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <MoneySubRow label="Наличные" value={formatRUB(collected_cash)} />
          <MoneySubRow label="Карта" value={formatRUB(collected_card)} />
        </div>
      </div>

      {/* Refunds */}
      {hasRefunds && (
        <div>
          <div className="text-[11px] text-neutral-500">Возвраты</div>
          <div className="text-lg font-bold text-red-400">{formatRUB(refund_total)}</div>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <MoneySubRow label="Наличные" value={formatRUB(refund_cash)} />
            <MoneySubRow label="Карта" value={formatRUB(refund_card)} />
          </div>
        </div>
      )}

      {/* Net */}
      <div className={`rounded-xl p-2 ${hasRefunds ? 'bg-emerald-950/30 border border-emerald-900/40' : ''}`}>
        <div className="text-[11px] text-neutral-500">Чистые деньги {hasRefunds ? '(сборы - возвраты)' : ''}</div>
        <div className="text-lg font-bold text-emerald-400">{formatRUB(net_total)}</div>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <MoneySubRow label="Наличные" value={formatRUB(net_cash)} />
          <MoneySubRow label="Карта" value={formatRUB(net_card)} />
        </div>
      </div>
    </div>
  );
}

/**
 * Money sub-row for cash/card breakdown
 */
function MoneySubRow({ label, value }) {
  return (
    <div className="text-xs">
      <span className="text-neutral-500">{label}: </span>
      <span className="text-neutral-300">{value}</span>
    </div>
  );
}

/**
 * Delta row for comparison
 */
function DeltaRow({ label, abs, percent, invertColors }) {
  const isPositive = abs >= 0;
  // For refunds: positive delta means more refunds in A, which is BAD
  const displayPositive = invertColors ? !isPositive : isPositive;
  const cls = displayPositive ? "text-emerald-400" : "text-red-400";
  const pctStr = percent !== null && percent !== undefined ? `${isPositive ? '+' : ''}${percent.toFixed(1)}%` : '0%';

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-neutral-400">{label}</span>
      <span className={cls}>
        {isPositive ? '+' : ''}{formatRUB(abs)} ({pctStr})
      </span>
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
  const [settingsRefreshKey, setSettingsRefreshKey] = useState(0);

  const handleSettingsSaved = () => {
    setSettingsRefreshKey(k => k + 1);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      
      {/* Logout button */}
      <button
        type="button"
        onClick={logout}
        className="fixed top-3 right-3 z-50 rounded-2xl border border-neutral-800 bg-neutral-950/40 backdrop-blur px-3 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-900/40 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
        title="Выйти"
      >
        Выйти
      </button>
      <main className="pt-14 pb-24">
        <Suspense fallback={null}>
          {tab === "money" && <div data-testid="owner-screen-money"><OwnerMoneyView /></div>}
          {tab === "compare" && <div data-testid="owner-screen-compare"><OwnerComparePeriodsView /></div>}
          {tab === "boats" && <div data-testid="owner-screen-boats"><OwnerBoatsView /></div>}
          {tab === "sellers" && <div data-testid="owner-screen-sellers"><OwnerSellersView /></div>}
          {tab === "motivation" && <div data-testid="owner-screen-motivation"><OwnerMotivationView onOpenSettings={() => setTab("settings")} settingsRefreshKey={settingsRefreshKey} /></div>}
          {tab === "settings" && <div data-testid="owner-screen-settings"><OwnerSettingsView onSettingsSaved={handleSettingsSaved} /></div>}
          {tab === "load" && <div data-testid="owner-screen-load"><OwnerLoadView /></div>}
          {tab === "export" && <div data-testid="owner-screen-export"><OwnerExportView /></div>}
        </Suspense>
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
        {/* MOBILE: 4 primary tabs + More */}
        <div className="grid grid-cols-5 gap-1 md:hidden rounded-2xl">
          <TabButton
            label="Деньги"
            icon="$"
            active={tab === "money"}
            onClick={() => go("money")}
            dataTestId="owner-tab-money"
            alwaysLabel
          />
          <TabButton
            label="Сравнение"
            icon="*"
            active={tab === "compare"}
            onClick={() => go("compare")}
            dataTestId="owner-tab-compare"
            alwaysLabel
          />
          <TabButton
            label="Лодки"
            icon="B"
            active={tab === "boats"}
            onClick={() => go("boats")}
            dataTestId="owner-tab-boats"
            alwaysLabel
          />
          <TabButton
            label="Продавцы"
            icon=""
            active={tab === "sellers"}
            onClick={() => go("sellers")}
            dataTestId="owner-tab-sellers"
            alwaysLabel
          />
          <TabButton
            label="Ещё"
            icon="+"
            active={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            alwaysLabel
          />
        </div>

        {/* DESKTOP/TABLET: all tabs */}
        <div className="hidden md:grid md:auto-cols-max md:grid-flow-col gap-1">
          <TabButton
            label="Деньги"
            icon="$"
            active={tab === "money"}
            onClick={() => go("money")}
            dataTestId="owner-tab-money"
          />
          <TabButton
            label="Сравнение"
            icon="*"
            active={tab === "compare"}
            onClick={() => go("compare")}
            dataTestId="owner-tab-compare"
          />
          <TabButton
            label="Лодки"
            icon="B"
            active={tab === "boats"}
            onClick={() => go("boats")}
            dataTestId="owner-tab-boats"
          />
          <TabButton
            label="Продавцы"
            icon=""
            active={tab === "sellers"}
            onClick={() => go("sellers")}
            dataTestId="owner-tab-sellers"
          />
          <TabButton
            label="Мотивация"
            icon="M"
            active={tab === "motivation"}
            onClick={() => go("motivation")}
            dataTestId="owner-tab-motivation"
          />
          <TabButton
            label="Настройки"
            icon="S"
            active={tab === "settings"}
            onClick={() => go("settings")}
            dataTestId="owner-tab-settings"
          />
          <TabButton
            label="Загрузка"
            icon="L"
            active={tab === "load"}
            onClick={() => go("load")}
            dataTestId="owner-tab-load"
          />
          <TabButton
            label="Экспорт"
            icon="E"
            active={tab === "export"}
            onClick={() => go("export")}
            dataTestId="owner-tab-export"
          />
        </div>
      </div>

      {/* MOBILE "MORE" MENU */}
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
                  icon="M"
                  active={tab === "motivation"}
                  onClick={() => go("motivation")}
            dataTestId="owner-tab-motivation"
                />
                <MoreItem
                  label="Настройки"
                  icon="S"
                  active={tab === "settings"}
                  onClick={() => go("settings")}
            dataTestId="owner-tab-settings"
                />
                <MoreItem
                  label="Загрузка"
                  icon="L"
                  active={tab === "load"}
                  onClick={() => go("load")}
            dataTestId="owner-tab-load"
                />
                <MoreItem
                  label="Экспорт"
                  icon="E"
                  active={tab === "export"}
                  onClick={() => go("export")}
            dataTestId="owner-tab-export"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ label, icon, active, onClick, alwaysLabel = false, dataTestId = undefined }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
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
      <span className="text-neutral-500">{'>'}</span>
    </button>
  );
}

