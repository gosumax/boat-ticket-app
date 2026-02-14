import { useMemo, useState } from "react";

function toCSV(rows) {
  if (!rows || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = String(v ?? "");
    if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.map(escape).join(";"), ...rows.map((r) => headers.map((h) => escape(r[h])).join(";"))];
  return lines.join("\n");
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toExcelHtml(rows, sheetName) {
  const name = sheetName || "Sheet1";
  const headers = Object.keys(rows?.[0] || {});
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const thead = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  const tbody = (rows || [])
    .map((r) => `<tr>${headers.map((h) => `<td>${esc(r[h])}</td>`).join("")}</tr>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8" />
    <title>${esc(name)}</title>
    </head><body>
    <table border="1">${thead}${tbody}</table>
    </body></html>`;
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

function buildShareText({ dataset, preset, rows }) {
  const periodLabel = periodLabelFromPreset(preset);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  
  const lines = [];
  lines.push(`${dataset === "money" ? "ДЕНЬГИ" : "ФЛОТ"}`);
  lines.push(`Период: ${periodLabel}`);
  lines.push(`Дата: ${dateStr}`);
  lines.push("");
  
  if (dataset === "money" && rows.length > 0) {
    const r = rows[0];
    if (r["Выручка"]) lines.push(`Выручка: ${r["Выручка"]}`);
    if (r["Наличные"]) lines.push(`Наличные: ${r["Наличные"]}`);
    if (r["Карта"]) lines.push(`Карта: ${r["Карта"]}`);
    if (r["Билетов"]) lines.push(`Билетов: ${r["Билетов"]}`);
    if (r["Рейсов"]) lines.push(`Рейсов: ${r["Рейсов"]}`);
    if (r["Загрузка %"]) lines.push(`Загрузка: ${r["Загрузка %"]}%`);
  } else if (dataset === "fleet" && rows.length > 0) {
    const totalRev = rows.reduce((a, x) => {
      const s = String(x["Выручка"] || "").replace(/[^\d]/g, "");
      return a + Number(s || 0);
    }, 0);
    const totalTickets = rows.reduce((a, x) => a + Number(x["Продано билетов"] || 0), 0);
    const totalTrips = rows.reduce((a, x) => a + Number(x["Рейсы"] || 0), 0);
    const totalFill = rows.length > 0 ? Math.round(rows.reduce((a, x) => a + Number(x["Загрузка %"] || 0), 0) / rows.length) : 0;
    
    lines.push("Итого:");
    lines.push(`Выручка: ${formatRUB(totalRev)}`);
    lines.push(`Билетов: ${totalTickets}`);
    lines.push(`Рейсов: ${totalTrips}`);
    lines.push(`Загрузка: ${totalFill}%`);
    lines.push("");
    lines.push("Лодки:");
    
    const maxBoats = 10;
    const boatsToShow = rows.slice(0, maxBoats);
    boatsToShow.forEach((boat, idx) => {
      const name = boat["Лодка"] || "?";
      const type = boat["Тип"] || "?";
      const rev = boat["Выручка"] || "0 ₽";
      const tickets = boat["Продано билетов"] || 0;
      const trips = boat["Рейсы"] || 0;
      const share = boat["Доля %"] || 0;
      lines.push(`${idx + 1}) ${name} (${type}) — ${rev}, бил. ${tickets}, рейс. ${trips}, доля ${share}%`);
    });
    
    if (rows.length > maxBoats) {
      lines.push(`...ещё ${rows.length - maxBoats} лодок`);
    }
  }
  
  return lines.join("\n");
}

async function ownerGet(path) {
  const token = typeof localStorage !== 'undefined' ? (localStorage.getItem('token') || localStorage.getItem('authToken') || localStorage.getItem('jwt')) : null;
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method: 'GET',
    credentials: 'include',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error('OWNER_GET_FAILED'), { status: res.status, data });
  return data;
}

function periodLabelFromPreset(preset) {
  switch (preset) {
    case "today":
      return "Сегодня";
    case "yesterday":
      return "Вчера";
    case "7d":
      return "Последние 7 дней";
    case "month":
      return "Месяц";
    case "30d":
      return "30 дней";
    case "90d":
      return "90 дней";
    default:
      return "Период";
  }
}

export default function OwnerExportView() {
  const [preset, setPreset] = useState("today");
  const [dataset, setDataset] = useState("money"); // money | fleet
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);
  const [sendToast, setSendToast] = useState("");

  const label = useMemo(() => periodLabelFromPreset(preset), [preset]);

  const load = async () => {
    setBusy(true);
    setErr("");
    try {
      // Map presets to backend presets
      const moneyPreset = preset === "month" ? "30d" : preset;
      const boatsPreset = preset === "30d" ? "month" : preset === "90d" ? "d30" : preset;

      const [m, b] = await Promise.all([
        ownerGet(`/api/owner/money/summary?preset=${encodeURIComponent(moneyPreset)}`),
        ownerGet(`/api/owner/boats?preset=${encodeURIComponent(boatsPreset)}`),
      ]);

      const manualOn = String([...(m?.meta?.warnings || []), ...(b?.meta?.warnings || [])].join("\n")).toLowerCase().includes("manual override");

      if (dataset === "money") {
        const revenue = Number(m?.data?.totals?.revenue || 0);
        const cash = Number(m?.data?.totals?.cash || 0);
        const card = Number(m?.data?.totals?.card || 0);
        const tickets = Number(b?.data?.totals?.tickets || 0);
        const trips = Number(b?.data?.totals?.trips || 0);
        const fill = Number(b?.data?.totals?.fillPercent || 0);
        const avgCheck = tickets > 0 ? Math.round(revenue / tickets) : 0;

        setRows([
          {
            Период: label,
            "Выручка": formatRUB(revenue),
            "Наличные": formatRUB(cash),
            "Карта": formatRUB(card),
            "Средний чек": formatRUB(avgCheck),
            "Билетов": tickets,
            "Рейсов": trips,
            "Загрузка %": fill || "",
            "Ручные данные": manualOn ? "да" : "нет",
          },
        ]);
      } else {
        const boats = Array.isArray(b?.data?.boats) ? b.data.boats : [];
        const totalRev = boats.reduce((a, x) => a + Number(x.revenue || 0), 0);
        setRows(
          boats.map((x) => {
            const rev = Number(x.revenue || 0);
            const share = totalRev > 0 ? Math.round((rev / totalRev) * 1000) / 10 : 0;
            return {
              Период: label,
              Тип: x.boat_type || "",
              Лодка: x.boat_name || "",
              Рейсы: Number(x.trips || 0),
              "Продано билетов": Number(x.tickets || 0),
              "Загрузка %": Number(x.fillPercent || 0),
              "Выручка": formatRUB(rev),
              "Доля %": share,
              Источник: x.source || "",
            };
          })
        );
      }
    } catch (e) {
      setErr(e?.data?.error || e?.message || "Ошибка загрузки");
      setRows([]);
    } finally {
      setBusy(false);
    }
  };

  const canExport = rows.length > 0;

  const exportCSV = () => {
    const csv = toCSV(rows);
    downloadText(`owner_${dataset}_${preset}.csv`, csv, "text/csv;charset=utf-8");
  };

  const exportXLS = () => {
    const html = toExcelHtml(rows, `owner_${dataset}_${preset}`);
    downloadText(`owner_${dataset}_${preset}.xls`, html, "application/vnd.ms-excel;charset=utf-8");
  };

  const openAppOrWeb = (appUrl, webUrl) => {
    let opened = false;
    let fallbackTimer = null;
    
    const cleanup = () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
    
    const onBlur = () => {
      opened = true;
      cleanup();
    };
    
    const onVisibility = () => {
      if (document.hidden) {
        opened = true;
        cleanup();
      }
    };
    
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    
    window.location.href = appUrl;
    
    fallbackTimer = setTimeout(() => {
      cleanup();
      if (!opened) {
        window.open(webUrl, '_blank', 'noopener,noreferrer');
      }
    }, 700);
  };

  const shareNow = async (target) => {
    if (!canExport) return;
    const shareText = buildShareText({ dataset, preset, rows });
    const encodedText = encodeURIComponent(shareText);

    // Telegram: use msg_url with non-empty url for reliable text delivery
    if (target === "telegram") {
      // Always copy to clipboard first
      try {
        await navigator.clipboard.writeText(shareText);
        setSendToast("Текст скопирован");
        setTimeout(() => setSendToast(""), 2000);
      } catch {}
      
      const shareUrl = "https://t.me";
      const encodedUrl = encodeURIComponent(shareUrl);
      
      openAppOrWeb(
        `tg://msg_url?url=${encodedUrl}&text=${encodedText}`,
        `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
      );
      return;
    }

    // WhatsApp: app first, fallback to web
    if (target === "whatsapp") {
      openAppOrWeb(
        `whatsapp://send?text=${encodedText}`,
        `https://wa.me/?text=${encodedText}`
      );
      return;
    }

    // Max: clipboard fallback (no known app scheme)
    if (target === "max") {
      try {
        await navigator.clipboard.writeText(shareText);
        setSendToast("Max: скопировано в буфер");
        setTimeout(() => setSendToast(""), 3000);
      } catch {
        setSendToast("Не удалось скопировать");
        setTimeout(() => setSendToast(""), 3000);
      }
      return;
    }
  };

  return (
    <div className="p-4 pb-24 space-y-4">
      <div>
        <div className="text-xl font-semibold">Экспорт</div>
        <div className="text-sm text-neutral-500">Данные берутся из API (manual &gt; online)</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Card>
          <div className="text-sm text-neutral-400 mb-2">Набор</div>
          <div className="grid grid-cols-2 gap-2">
            <Chip active={dataset === "money"} onClick={() => setDataset("money")} label="Деньги" />
            <Chip active={dataset === "fleet"} onClick={() => setDataset("fleet")} label="Флот" />
          </div>
        </Card>
        <Card>
          <div className="text-sm text-neutral-400 mb-2">Период</div>
          <div className="grid grid-cols-2 gap-2">
            <Chip active={preset === "today"} onClick={() => setPreset("today")} label="Сегодня" />
            <Chip active={preset === "yesterday"} onClick={() => setPreset("yesterday")} label="Вчера" />
            <Chip active={preset === "7d"} onClick={() => setPreset("7d")} label="7 дней" />
            <Chip active={preset === "30d"} onClick={() => setPreset("30d")} label="30 дней" />
          </div>
        </Card>
      </div>

      {err && (
        <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">{err}</div>
      )}

      {/* Load button - primary action */}
      <button
        type="button"
        onClick={load}
        className="rounded-2xl bg-amber-600 px-4 py-2 text-sm font-medium text-black hover:bg-amber-500 disabled:opacity-50"
        disabled={busy}
      >
        {busy ? "Загрузка..." : "Загрузить данные"}
      </button>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={exportCSV}
          disabled={!canExport}
          className="rounded-2xl border border-neutral-800 bg-neutral-950/40 px-3 py-3 text-sm hover:bg-neutral-900/40 disabled:opacity-50"
        >
          Скачать CSV
        </button>
        <button
          type="button"
          onClick={exportXLS}
          disabled={!canExport}
          className="rounded-2xl border border-neutral-800 bg-neutral-950/40 px-3 py-3 text-sm hover:bg-neutral-900/40 disabled:opacity-50"
        >
          Скачать XLS
        </button>
      </div>

      {/* Share buttons: Telegram / WhatsApp / Max */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => shareNow("telegram")}
          disabled={!canExport}
          className="rounded-2xl border border-blue-600/60 bg-blue-900/30 px-4 py-2 text-sm font-medium text-blue-200 hover:bg-blue-800/50 disabled:opacity-50"
        >
          Telegram
        </button>
        <button
          type="button"
          onClick={() => shareNow("whatsapp")}
          disabled={!canExport}
          className="rounded-2xl border border-green-600/60 bg-green-900/30 px-4 py-2 text-sm font-medium text-green-200 hover:bg-green-800/50 disabled:opacity-50"
        >
          WhatsApp
        </button>
        <button
          type="button"
          onClick={() => shareNow("max")}
          disabled={!canExport}
          className="rounded-2xl border border-purple-600/60 bg-purple-900/30 px-4 py-2 text-sm font-medium text-purple-200 hover:bg-purple-800/50 disabled:opacity-50"
        >
          Max
        </button>
        {sendToast && (
          <div className="text-xs text-amber-300 bg-amber-900/30 rounded-lg px-3 py-1">
            {sendToast}
          </div>
        )}
      </div>

      <Card>
        <div className="text-sm text-neutral-400 mb-2">Предпросмотр</div>
        {rows.length === 0 ? (
          <div className="text-sm text-neutral-500">Нажми "Загрузить"</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-neutral-500">
                  {Object.keys(rows[0]).map((h) => (
                    <th key={h} className="text-left font-semibold py-2 pr-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={idx} className="border-t border-neutral-800">
                    {Object.keys(rows[0]).map((h) => (
                      <td key={h} className="py-2 pr-3 whitespace-nowrap text-neutral-200">
                        {String(r[h] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({ children }) {
  return <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-4">{children}</div>;
}

function Chip({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-3 py-2 rounded-2xl border text-sm",
        active ? "border-amber-500 text-amber-400" : "border-neutral-800 text-neutral-300",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
