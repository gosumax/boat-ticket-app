import { useEffect, useMemo, useState } from "react";
import apiClient from "../utils/apiClient.js";

/**
 * OwnerLoadView.jsx — OWNER / Ручной ввод (manual)
 * API:
 *  - GET  /api/owner/manual/day?date=YYYY-MM-DD
 *  - PUT  /api/owner/manual/day (save draft)
 *  - POST /api/owner/manual/lock (locked)
 * Правило: после lock — запрет редактирования в UI.
 */

function todayYMD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

async function ownerFetch(url, { method = "GET", body } = {}) {
  // url must be WITHOUT the leading "/api" because apiClient prefixes it automatically.
  return apiClient.request(url, { method, body });
}

export default function OwnerLoadView() {
  const [date, setDate] = useState(todayYMD());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [locked, setLocked] = useState(false);
  const [boats, setBoats] = useState([]);
  const [sellers, setSellers] = useState([]);

  const load = async () => {
    setErr("");
    setOkMsg("");
    setBusy(true);
    try {
      const r = await ownerFetch(`/owner/manual/day?date=${encodeURIComponent(date)}`);
      const d = r?.data || {};
      setLocked(!!d.locked);
      setBoats(Array.isArray(d.boats) ? d.boats.map((x) => ({
        boat_id: x.boat_id ?? "",
        revenue: n(x.revenue),
        trips_completed: n(x.trips_completed),
        seats_sold: n(x.seats_sold),
      })) : []);
      setSellers(Array.isArray(d.sellers) ? d.sellers.map((x) => ({
        seller_id: x.seller_id ?? "",
        revenue: n(x.revenue),
        seats_sold: n(x.seats_sold),
      })) : []);
    } catch (e) {
      setErr(e?.json?.meta?.warnings?.[0] || e?.message || "Ошибка загрузки");
      setLocked(false);
      setBoats([]);
      setSellers([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const saveDraft = async () => {
    setErr("");
    setOkMsg("");
    setBusy(true);
    try {
      await ownerFetch(`/owner/manual/day`, {
        method: "PUT",
        body: {
          day: date,
          date,
          boats: (boats || []).map((b) => ({
            boat_id: b.boat_id === "" ? null : Number(b.boat_id),
            revenue: n(b.revenue),
            trips_completed: n(b.trips_completed),
            seats_sold: n(b.seats_sold),
          })),
          sellers: (sellers || []).map((s) => ({
            seller_id: s.seller_id === "" ? null : Number(s.seller_id),
            revenue: n(s.revenue),
            seats_sold: n(s.seats_sold),
          })),
        },
      });
      setOkMsg("Сохранено");
      setTimeout(() => setOkMsg(""), 1500);
      await load();
    } catch (e) {
      setErr(e?.json?.meta?.warnings?.[0] || e?.message || "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  };

  const doLock = async () => {
    setErr("");
    setOkMsg("");
    setBusy(true);
    try {
      await ownerFetch(`/owner/manual/lock`, { method: "POST", body: { day: date, date } });
      setLocked(true);
      setOkMsg("Залочено");
      setTimeout(() => setOkMsg(""), 1500);
      await load();
    } catch (e) {
      setErr(e?.json?.meta?.warnings?.[0] || e?.message || "Ошибка lock");
    } finally {
      setBusy(false);
    }
  };

  const totals = useMemo(() => {
    const boatRev = (boats || []).reduce((a, x) => a + n(x.revenue), 0);
    const boatSeats = (boats || []).reduce((a, x) => a + n(x.seats_sold), 0);
    const sellerRev = (sellers || []).reduce((a, x) => a + n(x.revenue), 0);
    const sellerSeats = (sellers || []).reduce((a, x) => a + n(x.seats_sold), 0);
    return { boatRev, boatSeats, sellerRev, sellerSeats };
  }, [boats, sellers]);

  return (
    <div className="p-4 pb-24 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xl font-semibold">Загрузка</div>
        {locked && (
          <div className="text-[11px] px-2 py-1 rounded-full border border-amber-500/50 text-amber-300 bg-amber-900/20">
            locked
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-neutral-800 p-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-xs text-neutral-500">Дата</div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={saveDraft}
            disabled={busy || locked}
            className="rounded-xl border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900/40 disabled:opacity-50"
          >
            Сохранить черновик
          </button>
          <button
            type="button"
            onClick={doLock}
            disabled={busy || locked}
            className="rounded-xl border border-amber-600/60 bg-amber-900/20 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-900/30 disabled:opacity-50"
          >
            Lock
          </button>
        </div>
      </div>

      {(err || okMsg) && (
        <div className={[
          "rounded-2xl border p-3 text-sm",
          err ? "border-red-900/60 bg-red-950/30 text-red-200" : "border-emerald-900/40 bg-emerald-950/20 text-emerald-200",
        ].join(" ")}>
          {err || okMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card title="Итоги (лодки)">
          <div className="text-sm text-neutral-200">Выручка: {formatRUB(totals.boatRev)}</div>
          <div className="text-sm text-neutral-400 mt-1">Мест: {formatInt(totals.boatSeats)}</div>
        </Card>
        <Card title="Итоги (продавцы)">
          <div className="text-sm text-neutral-200">Выручка: {formatRUB(totals.sellerRev)}</div>
          <div className="text-sm text-neutral-400 mt-1">Мест: {formatInt(totals.sellerSeats)}</div>
        </Card>
      </div>

      <Section
        title="По лодкам"
        right={
          <button
            type="button"
            onClick={() => setBoats((a) => [...(a || []), { boat_id: "", revenue: 0, trips_completed: 0, seats_sold: 0 }])}
            className="rounded-xl border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900/40 disabled:opacity-50"
            disabled={locked}
          >
            + строка
          </button>
        }
      >
        <Table
          columns={[
            { k: "boat_id", t: "boat_id" },
            { k: "revenue", t: "revenue" },
            { k: "trips_completed", t: "trips" },
            { k: "seats_sold", t: "seats" },
          ]}
          rows={boats}
          locked={locked}
          onChange={setBoats}
        />
      </Section>

      <Section
        title="По продавцам"
        right={
          <button
            type="button"
            onClick={() => setSellers((a) => [...(a || []), { seller_id: "", revenue: 0, seats_sold: 0 }])}
            className="rounded-xl border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900/40 disabled:opacity-50"
            disabled={locked}
          >
            + строка
          </button>
        }
      >
        <Table
          columns={[
            { k: "seller_id", t: "seller_id" },
            { k: "revenue", t: "revenue" },
            { k: "seats_sold", t: "seats" },
          ]}
          rows={sellers}
          locked={locked}
          onChange={setSellers}
        />
      </Section>

      <div className="rounded-2xl border border-neutral-800 p-4 text-xs text-neutral-500">
        После Lock день становится источником истины для аналитики (manual &gt; online).
      </div>
    </div>
  );
}

function Section({ title, right, children }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-neutral-200">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <div className="text-[11px] text-neutral-500">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Table({ columns, rows, onChange, locked }) {
  const setCell = (idx, key, value) => {
    onChange((prev) => {
      const next = [...(prev || [])];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  };

  const delRow = (idx) => {
    onChange((prev) => {
      const next = [...(prev || [])];
      next.splice(idx, 1);
      return next;
    });
  };

  return (
    <div className="rounded-2xl border border-neutral-800 overflow-hidden">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr)) 48px` }}>
        {columns.map((c) => (
          <div key={c.k} className="px-3 py-2 text-[11px] text-neutral-500 border-b border-neutral-800 bg-neutral-950/60">
            {c.t}
          </div>
        ))}
        <div className="px-3 py-2 text-[11px] text-neutral-500 border-b border-neutral-800 bg-neutral-950/60"> </div>

        {(rows || []).map((r, idx) => (
          <Row key={idx}>
            {columns.map((c) => (
              <Cell key={c.k}>
                <input
                  value={r?.[c.k] ?? ""}
                  onChange={(e) => setCell(idx, c.k, e.target.value)}
                  disabled={locked}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950/40 px-2 py-2 text-sm disabled:opacity-60"
                />
              </Cell>
            ))}
            <Cell>
              <button
                type="button"
                onClick={() => delRow(idx)}
                disabled={locked}
                className="w-full rounded-xl border border-neutral-800 px-2 py-2 text-xs text-neutral-300 hover:bg-neutral-900/40 disabled:opacity-50"
                title="Удалить"
              >
                ✕
              </button>
            </Cell>
          </Row>
        ))}
      </div>

      {(rows || []).length === 0 && (
        <div className="p-4 text-sm text-neutral-500">Нет строк</div>
      )}
    </div>
  );
}

function Row({ children }) {
  return <>{children}</>;
}

function Cell({ children }) {
  return <div className="px-3 py-2 border-b border-neutral-900">{children}</div>;
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

function formatInt(v) {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}
