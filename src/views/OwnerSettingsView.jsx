import { useMemo, useState } from "react";

/**
 * OwnerSettingsView.jsx
 * OWNER — Настройки (допускается ввод Owner)
 * UI ONLY (без API)
 *
 * По ТЗ:
 * 4.1 Общие настройки бизнеса
 * 4.2 Настройки аналитики
 * 4.3 Настройки мотивации
 * 4.4 Пороги и триггеры
 * 4.5 Уведомления Owner
 */

export default function OwnerSettingsView() {
  const [businessName, setBusinessName] = useState("Морские прогулки");
  const [timezone, setTimezone] = useState("Europe/Moscow (UTC+3)");
  const [currency, setCurrency] = useState("RUB");

  const [seasonStart, setSeasonStart] = useState("2026-05-01");
  const [seasonEnd, setSeasonEnd] = useState("2026-10-01");

  const [badDay, setBadDay] = useState(350000);
  const [normalDay, setNormalDay] = useState(550000);
  const [goodDay, setGoodDay] = useState(800000);
  const [baseCompareDays, setBaseCompareDays] = useState(7);

  const [motivationType, setMotivationType] = useState("team"); // team | personal | adaptive
  const [motivationPercent, setMotivationPercent] = useState(15);
  const [teamIncludeSellers, setTeamIncludeSellers] = useState(true);
  const [teamIncludeDispatchers, setTeamIncludeDispatchers] = useState(true);
  const [toWeeklyFund, setToWeeklyFund] = useState(1);
  const [toSeasonFund, setToSeasonFund] = useState(2);

  // Коэффициенты (Owner настраивает)
  const [coefSpeed, setCoefSpeed] = useState(1.2);
  const [coefWalk, setCoefWalk] = useState(3);
  const [coefBanana, setCoefBanana] = useState(3);
  const [coefFishing, setCoefFishing] = useState(5);

  const [zoneSanatorka, setZoneSanatorka] = useState(1.2);
  const [zoneCenter, setZoneCenter] = useState(2.2);
  const [zoneYozhik, setZoneYozhik] = useState(2.7);

  const [lowLoad, setLowLoad] = useState(45);
  const [highLoad, setHighLoad] = useState(85);
  const [minSellerRevenue, setMinSellerRevenue] = useState(30000);

  const [notifyBadRevenue, setNotifyBadRevenue] = useState(true);
  const [notifyLowLoad, setNotifyLowLoad] = useState(true);
  const [notifyLowSeller, setNotifyLowSeller] = useState(false);
  const [notifyChannel, setNotifyChannel] = useState("inapp"); // inapp | telegramFuture

  const seasonLabel = useMemo(() => {
    return `${seasonStart} → ${seasonEnd}`;
  }, [seasonStart, seasonEnd]);

  return (
    <div className="p-4 pb-24 space-y-4">
      <Header title="Настройки" subtitle="Параметры аналитики и мотивации (не влияет на текущие продажи)" />

      {/* 4.1 Общие настройки бизнеса */}
      <Section title="Общие настройки бизнеса">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Название бизнеса">
            <TextInput value={businessName} onChange={setBusinessName} placeholder="Например: Морские прогулки" />
          </Field>

          <Field label="Часовой пояс">
            <Select
              value={timezone}
              onChange={setTimezone}
              options={[
                "Europe/Moscow (UTC+3)",
                "Asia/Almaty (UTC+5)",
                "Europe/Kaliningrad (UTC+2)",
                "UTC",
              ]}
            />
          </Field>

          <Field label="Валюта">
            <Select value={currency} onChange={setCurrency} options={["RUB", "KZT", "USD", "EUR"]} />
          </Field>

          <Field label="Сезон (начало / конец)">
            <div className="grid grid-cols-2 gap-2">
              <TextInput value={seasonStart} onChange={setSeasonStart} />
              <TextInput value={seasonEnd} onChange={setSeasonEnd} />
            </div>
            <div className="mt-2 text-xs text-neutral-500">Текущий сезон: {seasonLabel}</div>
          </Field>
        </div>
      </Section>

      {/* 4.2 Настройки аналитики */}
      <Section title="Настройки аналитики">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <div className="text-sm text-neutral-400 mb-3">Пороги дня по выручке</div>
            <div className="grid grid-cols-1 gap-2">
              <NumberRow label="Плохой день (≤)" value={badDay} onChange={setBadDay} suffix="₽" />
              <NumberRow label="Нормальный день (≈)" value={normalDay} onChange={setNormalDay} suffix="₽" />
              <NumberRow label="Хороший день (≥)" value={goodDay} onChange={setGoodDay} suffix="₽" />
            </div>
          </Card>

          <Card>
            <div className="text-sm text-neutral-400 mb-3">Базовый период сравнения</div>
            <div className="grid grid-cols-3 gap-2">
              <Chip active={baseCompareDays === 7} onClick={() => setBaseCompareDays(7)} label="7 дней" />
              <Chip active={baseCompareDays === 14} onClick={() => setBaseCompareDays(14)} label="14 дней" />
              <Chip active={baseCompareDays === 30} onClick={() => setBaseCompareDays(30)} label="30 дней" />
            </div>
            <div className="mt-3 text-xs text-neutral-500">
              Используется для «Сегодня ↔ среднее за N дней» и похожих сравнений.
            </div>
          </Card>
        </div>
      </Section>

      {/* 4.3 Настройки мотивации */}
      <Section title="Настройки мотивации">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <div className="text-sm text-neutral-400 mb-3">Активный тип мотивации</div>
            <div className="grid grid-cols-3 gap-2">
              <Chip active={motivationType === "team"} onClick={() => setMotivationType("team")} label="Командная" />
              <Chip
                active={motivationType === "personal"}
                onClick={() => setMotivationType("personal")}
                label="Личная"
              />
              <Chip
                active={motivationType === "adaptive"}
                onClick={() => setMotivationType("adaptive")}
                label="Адаптивная"
              />
            </div>

            <div className="mt-4">
              <div className="text-xs text-neutral-500 mb-2">Процент мотивации</div>
              <div className="flex items-center gap-2">
                <TextInput value={String(motivationPercent)} onChange={(v) => setMotivationPercent(Number(v || 0))} />
                <div className="text-sm text-neutral-300">%</div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="text-sm text-neutral-400 mb-3">Участие в командной мотивации</div>
            <ToggleRow label="Продавцы" value={teamIncludeSellers} onChange={setTeamIncludeSellers} />
            <div className="h-2" />
            <ToggleRow label="Диспетчеры" value={teamIncludeDispatchers} onChange={setTeamIncludeDispatchers} />

            <div className="mt-4 text-sm text-neutral-400 mb-3">Отчисления в фонды</div>
            <div className="grid grid-cols-2 gap-2">
              <NumberRow label="В недельный фонд" value={toWeeklyFund} onChange={setToWeeklyFund} suffix="%" />
              <NumberRow label="В сезонный фонд" value={toSeasonFund} onChange={setToSeasonFund} suffix="%" />
            </div>
          </Card>
          <Card>
            <div className="text-sm text-neutral-400 mb-3">Коэффициенты по типам лодок</div>
            <div className="space-y-3">
              <DecimalRow label="Скоростные" value={coefSpeed} onChange={setCoefSpeed} />
              <DecimalRow label="Прогулочные" value={coefWalk} onChange={setCoefWalk} />
              <DecimalRow label="Банан" value={coefBanana} onChange={setCoefBanana} />
              <DecimalRow label="Рыбалка" value={coefFishing} onChange={setCoefFishing} />
            </div>
          </Card>

          <Card>
            <div className="text-sm text-neutral-400 mb-3">Коэффициенты по зонам</div>
            <div className="space-y-3">
              <DecimalRow label="Санаторка" value={zoneSanatorka} onChange={setZoneSanatorka} />
              <DecimalRow label="Центр" value={zoneCenter} onChange={setZoneCenter} />
              <DecimalRow label="Ежик" value={zoneYozhik} onChange={setZoneYozhik} />
            </div>
          </Card>

        </div>
      </Section>

      {/* 4.4 Пороги и триггеры */}
      <Section title="Пороги и триггеры">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <div className="text-sm text-neutral-400 mb-3">Загрузка рейсов</div>
            <div className="grid grid-cols-2 gap-2">
              <NumberRow label="Низкая загрузка (≤)" value={lowLoad} onChange={setLowLoad} suffix="%" />
              <NumberRow label="Высокая загрузка (≥)" value={highLoad} onChange={setHighLoad} suffix="%" />
            </div>
            <div className="mt-3 text-xs text-neutral-500">Используется для подсветки и уведомлений.</div>
          </Card>

          <Card>
            <div className="text-sm text-neutral-400 mb-3">Минимум по продавцу</div>
            <NumberRow label="Мин. дневная выручка" value={minSellerRevenue} onChange={setMinSellerRevenue} suffix="₽" />
            <div className="mt-3 text-xs text-neutral-500">Используется для уведомлений Owner.</div>
          </Card>
        </div>
      </Section>

      {/* 4.5 Уведомления Owner */}
      <Section title="Уведомления Owner">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <div className="text-sm text-neutral-400 mb-3">Уведомлять при</div>
            <ToggleRow label="Выручка ниже нормы" value={notifyBadRevenue} onChange={setNotifyBadRevenue} />
            <div className="h-2" />
            <ToggleRow label="Загрузка ниже порога" value={notifyLowLoad} onChange={setNotifyLowLoad} />
            <div className="h-2" />
            <ToggleRow label="Продавец ниже минимума" value={notifyLowSeller} onChange={setNotifyLowSeller} />
          </Card>

          <Card>
            <div className="text-sm text-neutral-400 mb-3">Канал</div>
            <div className="grid grid-cols-2 gap-2">
              <Chip active={notifyChannel === "inapp"} onClick={() => setNotifyChannel("inapp")} label="В приложении" />
              <Chip
                active={notifyChannel === "telegramFuture"}
                onClick={() => setNotifyChannel("telegramFuture")}
                label="Telegram (позже)"
              />
            </div>
            <div className="mt-3 text-xs text-neutral-500">Telegram — заглушка, в будущем.</div>
          </Card>
        </div>
      </Section>

      {/* Safety footer */}
      <div className="rounded-2xl border border-neutral-800 p-4 text-xs text-neutral-500">
        Эти настройки влияют только на аналитику/расчёты в Owner-панели и не добавляют операционные действия.
      </div>
    </div>
  );
}

/* ---------- UI atoms ---------- */

function Header({ title, subtitle }) {
  return (
    <div className="space-y-1">
      <div className="text-xl font-semibold">{title}</div>
      <div className="text-sm text-neutral-500">{subtitle}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-neutral-200">{title}</div>
      {children}
    </div>
  );
}

function Card({ children }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">{children}</div>
  );
}

function Field({ label, children }) {
  return (
    <Card>
      <div className="text-xs text-neutral-500 mb-2">{label}</div>
      {children}
    </Card>
  );
}

function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-700"
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-700"
    >
      {options.map((o) => (
        <option key={o} value={o} className="bg-neutral-950">
          {o}
        </option>
      ))}
    </select>
  );
}

function Chip({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-xl border px-3 py-2 text-sm text-left",
        active ? "border-neutral-600 bg-neutral-900" : "border-neutral-800 bg-neutral-950 hover:bg-neutral-900/40",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ToggleRow({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-neutral-200">{label}</div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={[
          "h-7 w-12 rounded-full border transition",
          value ? "border-emerald-700 bg-emerald-900/40" : "border-neutral-700 bg-neutral-900/40",
        ].join(" ")}
        aria-label={label}
      >
        <div
          className={[
            "h-6 w-6 rounded-full bg-neutral-200 transition",
            value ? "translate-x-5" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
    </div>
  );
}

function NumberRow({ label, value, onChange, suffix }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-neutral-200">{label}</div>
      <div className="flex items-center gap-2">
        <input
          value={String(value)}
          onChange={(e) => onChange(Number(e.target.value || 0))}
          inputMode="numeric"
          className="w-28 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-right outline-none focus:border-neutral-700"
        />
        <div className="text-sm text-neutral-500">{suffix}</div>
      </div>
    </div>
  );
}

function DecimalRow({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-neutral-200">{label}</div>
      <div className="flex items-center gap-2">
        <input
          value={String(value)}
          onChange={(e) => onChange(Number(e.target.value || 0))}
          inputMode="decimal"
          className="w-28 rounded-xl border border-neutral-800 bg-neutral-950/30 px-3 py-2 text-sm text-right outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-700/40"
        />
        <div className="text-sm text-neutral-500">x</div>
      </div>
    </div>
  );
}

