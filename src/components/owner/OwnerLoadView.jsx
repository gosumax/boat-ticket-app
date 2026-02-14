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
  const [cash, setCash] = useState(0);
  const [card, setCard] = useState(0);
  const [pending, setPending] = useState(0);

  // 5.3 Продажи по лодкам
  const [boats, setBoats] = useState([]);

  // 5.4 Продавцы
  const [sellers, setSellers] = useState([]);

  // Drafts info for parallel input
  const [drafts, setDrafts] = useState([]);

  const paid = useMemo(() => toNumber(cash) + toNumber(card), [cash, card]);
  const forecast = useMemo(() => paid + toNumber(pending), [paid, pending]);
  const boatsRevenueSum = useMemo(() => boats.reduce((s, b) => s + toNumber(b.revenue), 0), [boats]);
  const sellersRevenuePaid = useMemo(() => sellers.reduce((s, r) => s + toNumber(r.revenue_paid), 0), [sellers]);
  const sellersRevenuePending = useMemo(() => sellers.reduce((s, r) => s + toNumber(r.revenue_pending), 0), [sellers]);
  const sellersRevenueForecast = useMemo(() => sellersRevenuePaid + sellersRevenuePending, [sellersRevenuePaid, sellersRevenuePending]);

  const warnings = useMemo(() => {
    const w = [];
    if (!dateFrom || !dateTo) w.push("Укажи период загрузки (дата с / дата по).");
    if (boats.length === 0) w.push("Лодки: добавь хотя бы одну лодку.");
    if (forecast > 0 && Math.abs(forecast - boatsRevenueSum) > 0) {
      w.push("Лодки: сумма выручки по лодкам не совпадает с прогнозом.");
    }
    if (sellers.length === 0) w.push("Продавцы: добавь продавцов для корректной мотивации.");
    if (forecast > 0 && Math.abs(forecast - sellersRevenueForecast) > 0) {
      w.push("Продавцы: сумма прогноза по продавцам не совпадает с общим прогнозом.");
    }
    return w;
  }, [dateFrom, dateTo, forecast, boats, boatsRevenueSum, sellers, sellersRevenueForecast]);

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
      const totals = data?.totals;
      
      setDrafts(data?.drafts || []);
      
      if (payload) {
        setDateFrom(data?.period || d);
        setDateTo(data?.period || d);
        setComment(payload?.comment || "");

        const m = payload?.money || {};
        setCash(Number(m.cash || 0));
        setCard(Number(m.card || 0));
        setPending(Number(m.pending || 0));

        const boatsIn = Array.isArray(payload?.boats) ? payload.boats : [];
        const sellersIn = Array.isArray(payload?.sellers) ? payload.sellers : [];

        setBoats(boatsIn.map((b) => ({
          id: b.id || b.boat_id || uid(),
          boat_id: b.boat_id || null,
          type: b.type || "прогулочная",
          name: b.name || "",
          trips: toNumber(b.trips ?? 0),
          seats: toNumber(b.seats ?? 0),
          revenue: toNumber(b.revenue ?? 0),
        })));

        setSellers(sellersIn.map((s) => ({
          id: s.id || s.seller_id || uid(),
          seller_id: s.seller_id || null,
          name: s.name || "",
          revenue_paid: toNumber(s.revenue_paid ?? s.revenue ?? 0),
          revenue_pending: toNumber(s.revenue_pending ?? 0),
          revenue_forecast: toNumber(s.revenue_forecast ?? (s.revenue_paid || 0) + (s.revenue_pending || 0)),
          seats: toNumber(s.seats ?? 0),
          contacts: s.contacts || "",
        })));

        setSavedAt(data?.lockedAt ? new Date(data.lockedAt) : null);
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
        dateFrom,
        dateTo,
        comment,
        money: {
          cash: toNumber(cash),
          card: toNumber(card),
          pending: toNumber(pending),
        },
        boats: boats.map((b) => ({
          boat_id: b.boat_id || null,
          type: b.type,
          name: b.name,
          trips: toNumber(b.trips),
          seats: toNumber(b.seats),
          revenue: toNumber(b.revenue),
        })),
        sellers: sellers.map((s) => ({
          seller_id: s.seller_id || null,
          name: s.name,
          revenue_paid: toNumber(s.revenue_paid),
          revenue_pending: toNumber(s.revenue_pending),
          seats: toNumber(s.seats),
          contacts: s.contacts || null,
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

      await apiClient.request('/owner/manual/lock', { method: 'POST', body: { date: dateFrom } });
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
    setBoats((prev) => [...prev, { id: uid(), boat_id: null, type: "прогулочная", name: "", trips: 0, seats: 0, revenue: 0 }]);
  }
  function removeBoat(id) {
    setBoats((prev) => prev.filter((b) => b.id !== id));
  }
  function updateBoat(id, patch) {
    setBoats((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function addSeller() {
    setSellers((prev) => [...prev, { id: uid(), seller_id: null, name: "", revenue_paid: 0, revenue_pending: 0, revenue_forecast: 0, seats: 0, contacts: "" }]);
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
            <Field label="Наличные">
              <MoneyInput value={cash} onChange={setCash} disabled={locked} />
            </Field>
            <Field label="Карта">
              <MoneyInput value={card} onChange={setCard} disabled={locked} />
            </Field>
            <Field label="Pending (должен)">
              <MoneyInput value={pending} onChange={setPending} disabled={locked} />
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-neutral-800 p-3 text-center">
              <div className="text-[10px] text-neutral-500">Оплачено</div>
              <div className="text-base font-semibold text-emerald-300">{formatMoney(paid)} ₽</div>
            </div>
            <div className="rounded-2xl border border-neutral-800 p-3 text-center">
              <div className="text-[10px] text-neutral-500">Pending</div>
              <div className="text-base font-semibold text-amber-300">{formatMoney(pending)} ₽</div>
            </div>
            <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-3 text-center">
              <div className="text-[10px] text-neutral-500">Прогноз</div>
              <div className="text-base font-bold text-amber-200">{formatMoney(forecast)} ₽</div>
            </div>
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
                  <div className="md:col-span-4">
                    <div className="text-xs text-neutral-500 mb-1">Имя продавца</div>
                    <TextInput
                      value={s.name}
                      onChange={(v) => updateSeller(s.id, { name: v })}
                      disabled={locked}
                      placeholder="Например: Андрей"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <div className="text-xs text-neutral-500 mb-1">Оплачено</div>
                    <MoneyInput value={s.revenue_paid} onChange={(v) => updateSeller(s.id, { revenue_paid: v })} disabled={locked} />
                  </div>

                  <div className="md:col-span-2">
                    <div className="text-xs text-neutral-500 mb-1">Pending</div>
                    <MoneyInput value={s.revenue_pending} onChange={(v) => updateSeller(s.id, { revenue_pending: v })} disabled={locked} />
                  </div>

                  <div className="md:col-span-2">
                    <div className="text-xs text-neutral-500 mb-1">Прогноз</div>
                    <div className={inputCls(true)}>{formatMoney(Number(s.revenue_paid || 0) + Number(s.revenue_pending || 0))} ₽</div>
                  </div>

                  <div className="md:col-span-2">
                    <div className="text-xs text-neutral-500 mb-1">Мест</div>
                    <SmallNumberInput value={s.seats} onChange={(v) => updateSeller(s.id, { seats: v })} disabled={locked} />
                  </div>

                  <div className="md:col-span-12">
                    <div className="text-xs text-neutral-500 mb-1">Контакты (необязательно)</div>
                    <TextInput
                      value={s.contacts || ""}
                      onChange={(v) => updateSeller(s.id, { contacts: v })}
                      disabled={locked}
                      placeholder="Имя/телефон, если есть"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-neutral-800 p-3 text-center">
              <div className="text-[10px] text-neutral-500">Оплачено</div>
              <div className="text-base font-semibold">{formatMoney(sellersRevenuePaid)} ₽</div>
            </div>
            <div className="rounded-2xl border border-neutral-800 p-3 text-center">
              <div className="text-[10px] text-neutral-500">Pending</div>
              <div className="text-base font-semibold">{formatMoney(sellersRevenuePending)} ₽</div>
            </div>
            <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-3 text-center">
              <div className="text-[10px] text-neutral-500">Прогноз</div>
              <div className="text-base font-bold text-amber-200">{formatMoney(sellersRevenueForecast)} ₽</div>
            </div>
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
