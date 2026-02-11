import { useEffect, useMemo, useState } from "react";
import apiClient from "../../utils/apiClient";

/**
 * OwnerLoadView.jsx
 * OWNER — Загрузка данных (ручной ввод)
 * UI ONLY (без API)
 *
 * По ТЗ:
 * - Ввод за дни без интернета
 * - Ввод агрегатов по каждой лодке + по продавцам
 * - После сохранения нельзя редактировать
 * - Данные помечаются как "введены вручную"
 */

const BOAT_TYPES = ["скоростная", "прогулочная", "банан", "рыбалка"];

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function todayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const cleaned = String(v ?? "").replace(/[^\d.,-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(v) {
  const n = toNumber(v);
  return n.toLocaleString("ru-RU");
}

export default function OwnerLoadView() {
  const [locked, setLocked] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [batchId, setBatchId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 5.1 Общие параметры
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [comment, setComment] = useState("");

  // 5.2 Деньги
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [cash, setCash] = useState(0);
  const [card, setCard] = useState(0);

  // 5.3 Продажи по лодкам
  const [boats, setBoats] = useState([
    { id: uid(), type: "прогулочная", name: "Ласточка", trips: 6, seats: 42, revenue: 168000 },
    { id: uid(), type: "скоростная", name: "Волна", trips: 4, seats: 18, revenue: 120000 },
  ]);

  // 5.4 Продавцы
  const [sellers, setSellers] = useState([
    { id: uid(), name: "Андрей", revenue: 182000, seats: 48 },
    { id: uid(), name: "Дмитрий", revenue: 106000, seats: 29 },
  ]);

  const acceptedTotal = useMemo(() => toNumber(cash) + toNumber(card), [cash, card]);
  const boatsRevenueSum = useMemo(() => boats.reduce((s, b) => s + toNumber(b.revenue), 0), [boats]);
  const sellersRevenueSum = useMemo(() => sellers.reduce((s, r) => s + toNumber(r.revenue), 0), [sellers]);

  const warnings = useMemo(() => {
    const w = [];
    if (!dateFrom || !dateTo) w.push("Укажи период загрузки (дата с / дата по).");
    if (toNumber(totalRevenue) !== acceptedTotal) w.push("Деньги: «Общая выручка» должна равняться «Наличные + Карта».");
    if (boats.length === 0) w.push("Лодки: добавь хотя бы одну лодку.");
    if (toNumber(totalRevenue) > 0 && Math.abs(toNumber(totalRevenue) - boatsRevenueSum) > 0) {
      w.push("Лодки: сумма выручки по лодкам не совпадает с общей выручкой.");
    }
    if (sellers.length === 0) w.push("Продавцы: добавь продавцов для корректной мотивации.");
    if (toNumber(totalRevenue) > 0 && Math.abs(toNumber(totalRevenue) - sellersRevenueSum) > 0) {
      w.push("Продавцы: сумма выручки по продавцам не совпадает с общей выручкой.");
    }
    return w;
  }, [dateFrom, dateTo, totalRevenue, acceptedTotal, boats, boatsRevenueSum, sellers, sellersRevenueSum]);

  async function loadForDate(dateIso) {
    const d = String(dateIso || "").trim();
    if (!d) return;
    setLoading(true);
    setError("");
    try {
      const resp = await apiClient.request(`/owner/manual/day?date=${encodeURIComponent(d)}`);
      const data = resp?.data ?? resp;
      const lockedServer = Boolean(data?.locked);
      setLocked(lockedServer);
      setBatchId(data?.id ?? null);

      const payload = data?.payload;
      if (payload) {
        setDateFrom(payload?.dateFrom || data?.dateFrom || d);
        setDateTo(payload?.dateTo || data?.dateTo || d);
        setComment(payload?.comment || "");

        const m = payload?.money || {};
        setTotalRevenue(Number(m.totalRevenue || 0));
        setCash(Number(m.cash || 0));
        setCard(Number(m.card || 0));

        const boatsIn = Array.isArray(payload?.boats) ? payload.boats : [];
        const sellersIn = Array.isArray(payload?.sellers) ? payload.sellers : [];

        setBoats(boatsIn.map((b) => ({
          id: b.id || uid(),
          type: b.type || b.boat_type || "прогулочная",
          name: b.name || b.boat_name || "",
          trips: toNumber(b.trips ?? b.trips_completed ?? 0),
          seats: toNumber(b.seats ?? b.seats_sold ?? 0),
          revenue: toNumber(b.revenue ?? 0),
        })));

        setSellers(sellersIn.map((s) => ({
          id: s.id || uid(),
          name: s.name || s.username || "",
          revenue: toNumber(s.revenue ?? 0),
          seats: toNumber(s.seats ?? s.seats_sold ?? 0),
        })));

        setSavedAt(data?.savedAt ? new Date(data.savedAt) : null);
      } else {
        // No saved payload for this date: keep user-selected dates, reset lock
        setLocked(false);
        setSavedAt(null);
        setBatchId(null);
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft() {
    if (warnings.length) return { ok: false };
    setLoading(true);
    setError("");
    try {
      const payload = {
        id: batchId,
        dateFrom,
        dateTo,
        comment,
        totalRevenue: toNumber(totalRevenue),
        cash: toNumber(cash),
        card: toNumber(card),
        boats: boats.map((b) => ({
          id: b.id,
          type: b.type,
          name: b.name,
          trips: toNumber(b.trips),
          seats: toNumber(b.seats),
          revenue: toNumber(b.revenue),
        })),
        sellers: sellers.map((s) => ({
          id: s.id,
          name: s.name,
          revenue: toNumber(s.revenue),
          seats: toNumber(s.seats),
        })),
      };

      const resp = await apiClient.request('/owner/manual/day', { method: 'PUT', body: payload });
      const data = resp?.data ?? resp;
      if (data?.id != null) setBatchId(data.id);
      setLocked(false);
      setSavedAt(new Date());
      return { ok: true, id: data?.id ?? null };
    } catch (e) {
      setError(String(e?.message || e));
      return { ok: false };
    } finally {
      setLoading(false);
    }
  }

  async function lockPeriod() {
    if (warnings.length) return;
    setLoading(true);
    setError("");
    try {
      let id = batchId;
      if (id == null) {
        const r = await saveDraft();
        if (!r.ok) return;
        id = r.id;
      }

      await apiClient.request('/owner/manual/lock', { method: 'POST', body: { id } });
      setLocked(true);
      setSavedAt(new Date());
      // Reload to confirm server state
      await loadForDate(dateFrom);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadForDate(dateFrom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addBoat() {
    setBoats((prev) => [...prev, { id: uid(), type: "прогулочная", name: "", trips: 0, seats: 0, revenue: 0 }]);
  }
  function removeBoat(id) {
    setBoats((prev) => prev.filter((b) => b.id !== id));
  }
  function updateBoat(id, patch) {
    setBoats((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function addSeller() {
    setSellers((prev) => [...prev, { id: uid(), name: "", revenue: 0, seats: 0 }]);
  }
  function removeSeller(id) {
    setSellers((prev) => prev.filter((s) => s.id !== id));
  }
  function updateSeller(id, patch) {
    setSellers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function onSaveDraft() {
    await saveDraft();
  }

  async function onLock() {
    await lockPeriod();
  }

  function onResetDraft() {
    setLocked(false);
    setSavedAt(null);
    setBatchId(null);
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-extrabold tracking-tight">Загрузка</div>
          <div className="text-[11px] text-neutral-500">Ручной ввод продаж за офлайн-дни (участвует в аналитике и мотивации)</div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={[
              "inline-flex items-center rounded-full border px-3 py-1 text-[11px]",
              locked ? "border-emerald-900/50 bg-emerald-900/10 text-emerald-200" : "border-neutral-800 bg-neutral-900/40 text-neutral-300",
            ].join(" ")}
          >
            {locked ? "Зафиксировано" : "Черновик"}
          </span>

          {locked && (
            <button
              type="button"
              onClick={onResetDraft}
              className="rounded-xl border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900/40"
            >
              Новый ввод
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-900/50 bg-rose-900/10 p-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-400">Загрузка...</div>
      )}

      {locked && savedAt && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-300">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-neutral-500">Метка:</span> введены вручную
            </div>
            <div className="text-neutral-500">
              {savedAt.toLocaleDateString("ru-RU")}{" "}
              {savedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <div className="mt-2 text-xs text-neutral-500">По ТЗ: после сохранения редактирование недоступно.</div>
        </div>
      )}

      {/* 5.1 Общие параметры */}
      <Section title="Общие параметры загрузки">
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Дата с">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                disabled={locked}
                className={inputCls(locked)}
              />
            </Field>
            <Field label="Дата по">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                disabled={locked}
                className={inputCls(locked)}
              />
            </Field>
          </div>

          <div className="mt-3">
            <Field label="Комментарий (необязательно)">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={locked}
                placeholder="Например: Не было интернета"
                rows={3}
                className={textareaCls(locked)}
              />
            </Field>
          </div>
        </Card>
      </Section>

      {/* 5.2 Денежные данные */}
      <Section title="Денежные данные">
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Общая выручка за период">
              <MoneyInput value={totalRevenue} onChange={setTotalRevenue} disabled={locked} />
            </Field>
            <Field label="Наличные">
              <MoneyInput value={cash} onChange={setCash} disabled={locked} />
            </Field>
            <Field label="Карта">
              <MoneyInput value={card} onChange={setCard} disabled={locked} />
            </Field>
          </div>

          <div className="mt-3 rounded-2xl border border-neutral-800 p-3 flex items-center justify-between">
            <div className="text-sm text-neutral-300">Итого принятых денег</div>
            <div className="text-lg font-semibold">{formatMoney(acceptedTotal)} ₽</div>
          </div>
        </Card>
      </Section>

      {/* 5.3 Продажи по лодкам */}
      <Section title="Продажи по лодкам (основное)">
        <Card>
          <div className="flex items-center justify-between mb-3 gap-3">
            <div className="text-sm text-neutral-400">Ввод по каждой лодке отдельно (без билетов и пассажиров)</div>
            <button
              type="button"
              onClick={addBoat}
              disabled={locked}
              className="rounded-xl border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900/40 disabled:opacity-40"
            >
              + Добавить лодку
            </button>
          </div>

          <div className="space-y-3">
            {boats.map((b) => (
              <div key={b.id} className="rounded-2xl border border-neutral-800 p-3">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="text-sm text-neutral-200">
                    <span className="text-neutral-500">Лодка:</span>{" "}
                    {b.name?.trim() ? (
                      <span className="font-semibold">{b.name}</span>
                    ) : (
                      <span className="text-neutral-500">без названия</span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeBoat(b.id)}
                    disabled={locked}
                    className="rounded-xl border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900/40 disabled:opacity-40"
                  >
                    Удалить
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-3">
                    <div className="text-xs text-neutral-500 mb-1">Тип лодки</div>
                    <select
                      value={b.type}
                      onChange={(e) => updateBoat(b.id, { type: e.target.value })}
                      disabled={locked}
                      className={inputCls(locked)}
                    >
                      {BOAT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-5">
                    <div className="text-xs text-neutral-500 mb-1">Название лодки</div>
                    <TextInput
                      value={b.name}
                      onChange={(v) => updateBoat(b.id, { name: v })}
                      disabled={locked}
                      placeholder="Например: Ласточка"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <div className="text-xs text-neutral-500 mb-1">Рейсов</div>
                    <SmallNumberInput value={b.trips} onChange={(v) => updateBoat(b.id, { trips: v })} disabled={locked} />
                  </div>

                  <div className="md:col-span-2">
                    <div className="text-xs text-neutral-500 mb-1">Продано мест</div>
                    <SmallNumberInput value={b.seats} onChange={(v) => updateBoat(b.id, { seats: v })} disabled={locked} />
                  </div>

                  <div className="md:col-span-12">
                    <div className="text-xs text-neutral-500 mb-1">Выручка по лодке</div>
                    <MoneyInput value={b.revenue} onChange={(v) => updateBoat(b.id, { revenue: v })} disabled={locked} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-2xl border border-neutral-800 p-3 flex items-center justify-between">
            <div className="text-sm text-neutral-300">Сумма выручки по лодкам</div>
            <div className="text-lg font-semibold">{formatMoney(boatsRevenueSum)} ₽</div>
          </div>
        </Card>
      </Section>

      {/* 5.4 Продавцы */}
      <Section title="Продавцы (для корректной мотивации)">
        <Card>
          <div className="flex items-center justify-between mb-3 gap-3">
            <div className="text-sm text-neutral-400">Заполни агрегаты по каждому продавцу (без билетов)</div>
            <button
              type="button"
              onClick={addSeller}
              disabled={locked}
              className="rounded-xl border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900/40 disabled:opacity-40"
            >
              + Добавить продавца
            </button>
          </div>

          <div className="space-y-3">
            {sellers.map((s) => (
              <div key={s.id} className="rounded-2xl border border-neutral-800 p-3">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="text-sm text-neutral-200">
                    <span className="text-neutral-500">Продавец:</span>{" "}
                    {s.name?.trim() ? (
                      <span className="font-semibold">{s.name}</span>
                    ) : (
                      <span className="text-neutral-500">без имени</span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeSeller(s.id)}
                    disabled={locked}
                    className="rounded-xl border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900/40 disabled:opacity-40"
                  >
                    Удалить
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-6">
                    <div className="text-xs text-neutral-500 mb-1">Имя продавца</div>
                    <TextInput
                      value={s.name}
                      onChange={(v) => updateSeller(s.id, { name: v })}
                      disabled={locked}
                      placeholder="Например: Андрей"
                    />
                  </div>

                  <div className="md:col-span-3">
                    <div className="text-xs text-neutral-500 mb-1">Выручка</div>
                    <MoneyInput value={s.revenue} onChange={(v) => updateSeller(s.id, { revenue: v })} disabled={locked} />
                  </div>

                  <div className="md:col-span-3">
                    <div className="text-xs text-neutral-500 mb-1">Продано мест</div>
                    <SmallNumberInput value={s.seats} onChange={(v) => updateSeller(s.id, { seats: v })} disabled={locked} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-2xl border border-neutral-800 p-3 flex items-center justify-between">
            <div className="text-sm text-neutral-300">Сумма выручки по продавцам</div>
            <div className="text-lg font-semibold">{formatMoney(sellersRevenueSum)} ₽</div>
          </div>
        </Card>
      </Section>

      {/* Контроль */}
      <Section title="Контроль">
        <Card>
          <div className="rounded-2xl border border-neutral-800 p-3">
            <div className="text-sm text-neutral-300">Проверки перед сохранением</div>
            {warnings.length === 0 ? (
              <div className="mt-2 text-sm text-emerald-200">Ошибок не найдено. Можно сохранять.</div>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-amber-200">
                {warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={locked || loading || warnings.length > 0}
              onClick={onSaveDraft}
              className="rounded-2xl border border-neutral-800 bg-neutral-900/60 text-neutral-100 px-4 py-2 text-sm font-semibold hover:bg-neutral-900 disabled:opacity-40 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
            >
              Сохранить черновик
            </button>
            <button
              type="button"
              disabled={locked || loading || warnings.length > 0}
              onClick={onLock}
              className="rounded-2xl border border-emerald-900/50 bg-emerald-900/10 text-emerald-200 px-4 py-2 text-sm font-semibold hover:bg-emerald-900/20 disabled:opacity-40"
            >
              Зафиксировать (LOCK)
            </button>
          </div>

          <div className="mt-2 text-xs text-neutral-500">
            Черновик сохраняется на сервер (PUT). После “LOCK” период становится неизменяемым и участвует в аналитике с приоритетом manual &gt; online.
          </div>
        </Card>
      </Section>
    </div>
  );
}

/* ---------------- UI atoms ---------------- */

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-neutral-100 tracking-tight">{title}</div>
      {children}
    </div>
  );
}

function Card({ children }) {
  return <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">{children}</div>;
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

function inputCls(disabled) {
  return [
    "w-full rounded-2xl border border-neutral-800 bg-neutral-950/30 px-3 py-3 text-sm text-neutral-100 outline-none",
    "focus:border-neutral-600 focus:ring-2 focus:ring-neutral-700/40",
    disabled ? "opacity-60 cursor-not-allowed" : "hover:bg-neutral-900/30",
  ].join(" ");
}

function textareaCls(disabled) {
  return [
    "w-full rounded-2xl border border-neutral-800 bg-neutral-950/30 px-3 py-3 text-sm text-neutral-100 outline-none",
    "focus:border-neutral-600 focus:ring-2 focus:ring-neutral-700/40",
    disabled ? "opacity-60 cursor-not-allowed" : "hover:bg-neutral-900/30",
  ].join(" ");
}

function TextInput({ value, onChange, disabled, placeholder }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      className={inputCls(disabled)}
    />
  );
}

function MoneyInput({ value, onChange, disabled }) {
  return (
    <div className="relative">
      <input
        value={String(value ?? "")}
        onChange={(e) => onChange(toNumber(e.target.value))}
        disabled={disabled}
        inputMode="numeric"
        className={inputCls(disabled) + " pr-10"}
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">₽</div>
    </div>
  );
}

function SmallNumberInput({ value, onChange, disabled }) {
  return (
    <input
      value={String(value ?? "")}
      onChange={(e) => onChange(toNumber(e.target.value))}
      disabled={disabled}
      inputMode="numeric"
      className={inputCls(disabled)}
    />
  );
}
