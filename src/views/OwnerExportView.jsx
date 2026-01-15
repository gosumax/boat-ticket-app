import { useMemo, useState } from "react";

function toCSV(rows) {
  if (!rows || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = String(v ?? "");
    if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [
    headers.map(escape).join(";"),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(";")),
  ];
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
  const esc = (s) => String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");

  const thead = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  const tbody = (rows || [])
    .map((r) => `<tr>${headers.map((h) => `<td>${esc(r[h])}</td>`).join("")}</tr>`)
    .join("");

  // Old but reliable: HTML table served as .xls opens in Excel.
  return `<!doctype html><html><head><meta charset="utf-8" />
    <title>${esc(name)}</title>
    </head><body>
    <table border="1">${thead}${tbody}</table>
    </body></html>`;
}

function buildMoneyRows(periodLabel) {
  // UI-only demo dataset. Replace with real aggregations later.
  return [
    {
      Период: periodLabel,
      "Выручка, ₽": "2 480 000",
      "Наличные, ₽": "1 340 000",
      "Карта, ₽": "1 140 000",
      "Средний чек, ₽": "3 950",
      "Билетов, шт": "628",
      "Мест, шт": "812",
      "Загрузка, %": "76",
      "Ручные данные": "нет",
    },
  ];
}

function buildFleetRows(periodLabel) {
  return [
    {
      Период: periodLabel,
      Тип: "Скоростная",
      Лодка: "Альфа",
      Рейсы: "14",
      "Продано мест": "168",
      "Загрузка, %": "80",
      "Выручка, ₽": "780 000",
      "Доля, %": "31.5",
    },
    {
      Период: periodLabel,
      Тип: "Прогулочная",
      Лодка: "Бриз",
      Рейсы: "10",
      "Продано мест": "120",
      "Загрузка, %": "70",
      "Выручка, ₽": "520 000",
      "Доля, %": "21.0",
    },
    {
      Период: periodLabel,
      Тип: "Банан",
      Лодка: "Banana-1",
      Рейсы: "18",
      "Продано мест": "216",
      "Загрузка, %": "90",
      "Выручка, ₽": "410 000",
      "Доля, %": "16.5",
    },
  ];
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
    default:
      return "Произвольный период";
  }
}

function ShareButtons({ text }) {
  const tgHref = useMemo(() => {
    const t = encodeURIComponent(text || "");
    return `https://t.me/share/url?text=${t}`;
  }, [text]);

  const waHref = useMemo(() => {
    const t = encodeURIComponent(text || "");
    return `https://wa.me/?text=${t}`;
  }, [text]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text || "");
    } catch (_) {}
  };

  return (
    <div className="flex gap-2">
      <a
        href={tgHref}
        target="_blank"
        rel="noreferrer"
        className="flex-1 rounded-2xl border border-neutral-800 bg-neutral-950/30 hover:bg-neutral-900/40 px-3 py-2 text-sm text-center"
      >
        Поделиться в TG
      </a>
      <a
        href={waHref}
        target="_blank"
        rel="noreferrer"
        className="flex-1 rounded-2xl border border-neutral-800 bg-neutral-950/30 hover:bg-neutral-900/40 px-3 py-2 text-sm text-center"
      >
        Поделиться в WhatsApp
      </a>
      <button
        type="button"
        onClick={copy}
        className="rounded-2xl border border-neutral-800 bg-neutral-950/30 hover:bg-neutral-900/40 px-3 py-2 text-sm"
        title="Скопировать текст"
      >
        Копировать
      </button>
    </div>
  );
}

export default function OwnerExportView() {
  const [kind, setKind] = useState("money"); // money | fleet
  const [preset, setPreset] = useState("today"); // today | yesterday | 7d | month | custom
  const [busy, setBusy] = useState(false);

  const periodLabel = useMemo(() => periodLabelFromPreset(preset), [preset]);

  const rows = useMemo(() => {
    if (kind === "fleet") return buildFleetRows(periodLabel);
    return buildMoneyRows(periodLabel);
  }, [kind, periodLabel]);

  const shareText = useMemo(() => {
    if (kind === "money") {
      const r = rows[0] || {};
      return `Отчет: Деньги\nПериод: ${r["Период"] || periodLabel}\nВыручка: ${r["Выручка, ₽"] || ""} ₽\nНаличные: ${r["Наличные, ₽"] || ""} ₽\nКарта: ${r["Карта, ₽"] || ""} ₽\nСредний чек: ${r["Средний чек, ₽"] || ""} ₽\nЗагрузка: ${r["Загрузка, %"] || ""}%`;
    }
    return `Отчет: Флот\nПериод: ${periodLabel}\nСтрок: ${rows.length}`;
  }, [kind, periodLabel, rows]);

  const onCSV = () => {
    const csv = toCSV(rows);
    const name = kind === "money" ? "export_money.csv" : "export_fleet.csv";
    downloadText(name, csv, "text/csv;charset=utf-8");
  };

  const onXLS = async () => {
    setBusy(true);
    try {
      const name = kind === "money" ? "export_money.xls" : "export_fleet.xls";
      const html = toExcelHtml(rows, kind === "money" ? "Money" : "Fleet");
      downloadText(name, html, "application/vnd.ms-excel;charset=utf-8");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-3 pt-3 pb-24 space-y-3">
      <div className="text-xl font-extrabold tracking-tight">Owner · Экспорт</div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
        <div className="text-sm text-neutral-300 mb-2">Что экспортируем</div>
        <div className="grid grid-cols-2 gap-2">
          <Chip active={kind === "money"} onClick={() => setKind("money")} label="Деньги" />
          <Chip active={kind === "fleet"} onClick={() => setKind("fleet")} label="Флот" />
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
        <div className="text-sm text-neutral-300 mb-2">Период</div>
        <div className="flex flex-wrap gap-2 pb-1 overflow-x-hidden">
          <Chip active={preset === "today"} onClick={() => setPreset("today")} label="Сегодня" />
          <Chip active={preset === "yesterday"} onClick={() => setPreset("yesterday")} label="Вчера" />
          <Chip active={preset === "7d"} onClick={() => setPreset("7d")} label="Последние 7 дней" />
          <Chip active={preset === "month"} onClick={() => setPreset("month")} label="Месяц" />
          <Chip active={preset === "custom"} onClick={() => setPreset("custom")} label="Произвольный" />
        </div>

        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/30 p-3 text-sm text-neutral-500">
              Дата с (позже)
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/30 p-3 text-sm text-neutral-500">
              Дата по (позже)
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3 space-y-2">
        <div className="text-sm text-neutral-300">Формат</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCSV}
            className="rounded-2xl border border-neutral-800 bg-neutral-950/30 hover:bg-neutral-900/40 px-3 py-3 text-sm"
          >
            Скачать CSV
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onXLS}
            className={[
              "rounded-2xl border px-3 py-3 text-sm",
              busy
                ? "border-neutral-800 bg-neutral-900 text-neutral-500"
                : "border-neutral-800 bg-neutral-950/30 hover:bg-neutral-900/40",
            ].join(" ")}
          >
            Скачать Excel (.xls)
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3 space-y-2">
        <div className="text-sm text-neutral-300">Отправить начальнику</div>
        <ShareButtons text={shareText} />
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
        <div className="text-sm text-neutral-300 mb-2">Предпросмотр</div>
        <div className="overflow-x-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500">
                {Object.keys(rows[0] || {}).map((h) => (
                  <th key={h} className="text-left font-medium py-2 pr-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-t border-neutral-800">
                  {Object.keys(rows[0] || {}).map((h) => (
                    <td key={h} className="py-2 pr-4 text-neutral-200 whitespace-nowrap">
                      {r[h]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-neutral-600 mt-2">
          Демо-данные. Подключение к реальной аналитике — следующим шагом.
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "whitespace-nowrap px-3 py-2 rounded-2xl border text-sm",
        active
          ? "border-amber-500 text-amber-400 bg-neutral-950"
          : "border-neutral-800 text-neutral-300 bg-neutral-950/30 hover:bg-neutral-900/40",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
