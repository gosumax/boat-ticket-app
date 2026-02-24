import { useEffect, useMemo, useState } from "react";
import apiClient from "../utils/apiClient.js";
import { getSeasonConfigUiState, validateSeasonBoundaryPair } from "../utils/seasonBoundaries.js";

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

export default function OwnerSettingsView({ onSettingsSaved }) {
  const [busy, setBusy] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [err, setErr] = useState("");

  const [businessName, setBusinessName] = useState("Морские прогулки");
  const [timezone, setTimezone] = useState("Europe/Moscow (UTC+3)");
  const [currency, setCurrency] = useState("RUB");

  const [seasonStart, setSeasonStart] = useState("2026-05-01");
  const [seasonEnd, setSeasonEnd] = useState("2026-10-01");
  const [seasonStartMmdd, setSeasonStartMmdd] = useState("");
  const [seasonEndMmdd, setSeasonEndMmdd] = useState("");

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

  // Новые поля финальной мотивации
  const [individualShare, setIndividualShare] = useState(60);  // проценты в UI
  const [teamShare, setTeamShare] = useState(40);             // проценты в UI
  const [dailyActivationThreshold, setDailyActivationThreshold] = useState(200000);
  const [sellerSeriesThreshold, setSellerSeriesThreshold] = useState(40000);
  const [dispatchersSeriesThreshold, setDispatchersSeriesThreshold] = useState(55000);
  const [seasonMinDays, setSeasonMinDays] = useState(1);

  // Коэффициенты (Owner настраивает)
  const [coefSpeed, setCoefSpeed] = useState(1.2);
  const [coefWalk, setCoefWalk] = useState(3);
  const [coefFishing, setCoefFishing] = useState(5);

  // Коэффициенты банана по зонам
  const [kBananaHedgehog, setKBananaHedgehog] = useState(2.7);
  const [kBananaCenter, setKBananaCenter] = useState(2.2);
  const [kBananaSanatorium, setKBananaSanatorium] = useState(1.2);
  const [kBananaStationary, setKBananaStationary] = useState(1.0);

  // Коэффициенты зон для speed/cruise
  const [kZoneHedgehog, setKZoneHedgehog] = useState(1.3);
  const [kZoneCenter, setKZoneCenter] = useState(1.0);
  const [kZoneSanatorium, setKZoneSanatorium] = useState(0.8);
  const [kZoneStationary, setKZoneStationary] = useState(0.7);

  // Вес диспетчера (adaptive)
  const [kDispatchers, setKDispatchers] = useState(1.0);
  
  // Dispatcher withhold percent (shown as percent in UI, stored as fraction)
  const [dispatcherWithholdPercentTotal, setDispatcherWithholdPercentTotal] = useState(0.2);
  
  // Weekly/Season withhold percent (shown as percent in UI, stored as fraction)
  const [weeklyWithholdPercentTotal, setWeeklyWithholdPercentTotal] = useState(0.8);
  const [seasonWithholdPercentTotal, setSeasonWithholdPercentTotal] = useState(0.5);

  // Sellers list for zone assignment
  const [sellersList, setSellersList] = useState([]);
  const [sellersLoading, setSellersLoading] = useState(false);
  const [sellersError, setSellersError] = useState(null);

  const [lowLoad, setLowLoad] = useState(45);
  const [highLoad, setHighLoad] = useState(85);
  const [minSellerRevenue, setMinSellerRevenue] = useState(30000);

  const [notifyBadRevenue, setNotifyBadRevenue] = useState(true);
  const [notifyLowLoad, setNotifyLowLoad] = useState(true);
  const [notifyLowSeller, setNotifyLowSeller] = useState(false);
  const [notifyChannel, setNotifyChannel] = useState("inapp"); // inapp | telegramFuture

  const seasonConfigUi = useMemo(() => {
    return getSeasonConfigUiState({
      season_start_mmdd: seasonStartMmdd,
      season_end_mmdd: seasonEndMmdd,
    });
  }, [seasonStartMmdd, seasonEndMmdd]);

  const load = async () => {
    setErr("");
    setSaveOk(false);
    setBusy(true);
    try {
      const json = await apiClient.request(`/owner/settings/full`, { method: "GET" });
      const s = json?.data || {};

      if (typeof s.businessName === "string") setBusinessName(s.businessName);
      if (typeof s.timezone === "string") setTimezone(s.timezone);
      if (typeof s.currency === "string") setCurrency(s.currency);

      if (typeof s.seasonStart === "string") setSeasonStart(s.seasonStart);
      if (typeof s.seasonEnd === "string") setSeasonEnd(s.seasonEnd);
      if (typeof s.season_start_mmdd === "string") setSeasonStartMmdd(s.season_start_mmdd);
      else setSeasonStartMmdd("");
      if (typeof s.season_end_mmdd === "string") setSeasonEndMmdd(s.season_end_mmdd);
      else setSeasonEndMmdd("");

      if (typeof s.badDay === "number") setBadDay(s.badDay);
      if (typeof s.normalDay === "number") setNormalDay(s.normalDay);
      if (typeof s.goodDay === "number") setGoodDay(s.goodDay);
      if (typeof s.baseCompareDays === "number") setBaseCompareDays(s.baseCompareDays);

      if (typeof s.motivationType === "string") setMotivationType(s.motivationType);
      if (typeof s.motivationPercentLegacy === "number") setMotivationPercent(s.motivationPercentLegacy);
      if (typeof s.teamIncludeSellers === "boolean") setTeamIncludeSellers(s.teamIncludeSellers);
      if (typeof s.teamIncludeDispatchers === "boolean") setTeamIncludeDispatchers(s.teamIncludeDispatchers);
      if (typeof s.toWeeklyFundLegacy === "number") setToWeeklyFund(s.toWeeklyFundLegacy);
      if (typeof s.toSeasonFundLegacy === "number") setToSeasonFund(s.toSeasonFundLegacy);

      // Новые поля финальной мотивации
      if (typeof s.individual_share === "number") setIndividualShare(Math.round(s.individual_share * 100));
      if (typeof s.team_share === "number") setTeamShare(Math.round(s.team_share * 100));
      if (typeof s.daily_activation_threshold === "number") setDailyActivationThreshold(s.daily_activation_threshold);
      if (typeof s.seller_series_threshold === "number") setSellerSeriesThreshold(s.seller_series_threshold);
      if (typeof s.dispatchers_series_threshold === "number") setDispatchersSeriesThreshold(s.dispatchers_series_threshold);
      if (typeof s.season_min_days_N === "number") setSeasonMinDays(s.season_min_days_N);

      // Banana zone coefficients (k_banana_*)
      if (typeof s.k_banana_hedgehog === "number") setKBananaHedgehog(s.k_banana_hedgehog);
      if (typeof s.k_banana_center === "number") setKBananaCenter(s.k_banana_center);
      if (typeof s.k_banana_sanatorium === "number") setKBananaSanatorium(s.k_banana_sanatorium);
      if (typeof s.k_banana_stationary === "number") setKBananaStationary(s.k_banana_stationary);

      // Zone coefficients for speed/cruise (k_zone_*)
      if (typeof s.k_zone_hedgehog === "number") setKZoneHedgehog(s.k_zone_hedgehog);
      if (typeof s.k_zone_center === "number") setKZoneCenter(s.k_zone_center);
      if (typeof s.k_zone_sanatorium === "number") setKZoneSanatorium(s.k_zone_sanatorium);
      if (typeof s.k_zone_stationary === "number") setKZoneStationary(s.k_zone_stationary);

      // Dispatcher weight (adaptive)
      if (typeof s.k_dispatchers === "number") setKDispatchers(s.k_dispatchers);

      if (typeof s.coefSpeed === "number") setCoefSpeed(s.coefSpeed);
      if (typeof s.coefWalk === "number") setCoefWalk(s.coefWalk);
      if (typeof s.coefFishing === "number") setCoefFishing(s.coefFishing);
      
      // Dispatcher withhold percent (comes as percent from legacy field)
      if (typeof s.dispatcherWithholdPercentTotalLegacy === "number") setDispatcherWithholdPercentTotal(s.dispatcherWithholdPercentTotalLegacy);
      
      // Weekly/Season withhold percent (comes as percent from legacy field)
      if (typeof s.weeklyWithholdPercentTotalLegacy === "number") setWeeklyWithholdPercentTotal(s.weeklyWithholdPercentTotalLegacy);
      if (typeof s.seasonWithholdPercentTotalLegacy === "number") setSeasonWithholdPercentTotal(s.seasonWithholdPercentTotalLegacy);

      if (typeof s.lowLoad === "number") setLowLoad(s.lowLoad);
      if (typeof s.highLoad === "number") setHighLoad(s.highLoad);
      if (typeof s.minSellerRevenue === "number") setMinSellerRevenue(s.minSellerRevenue);

      if (typeof s.notifyBadRevenue === "boolean") setNotifyBadRevenue(s.notifyBadRevenue);
      if (typeof s.notifyLowLoad === "boolean") setNotifyLowLoad(s.notifyLowLoad);
      if (typeof s.notifyLowSeller === "boolean") setNotifyLowSeller(s.notifyLowSeller);
      if (typeof s.notifyChannel === "string") setNotifyChannel(s.notifyChannel);
    } catch (e) {
      setErr(e?.message || "Ошибка загрузки настроек");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setErr("");
    setSaveOk(false);

    const seasonBoundaryValidation = validateSeasonBoundaryPair(seasonStartMmdd, seasonEndMmdd);

    if (!seasonBoundaryValidation.ok) {
      setErr(seasonBoundaryValidation.error);
      return;
    }
    
    // Validation: individual_share + team_share = 100% (only for adaptive)
    if (motivationType === 'adaptive' && individualShare + teamShare !== 100) {
      setErr("Сумма индивидуального и командного распределения должна быть 100%");
      return;
    }
    
    // Validation: coefficients must be > 0 (only for adaptive)
    if (motivationType === 'adaptive') {
      const allCoefs = [
        coefSpeed, coefWalk, coefFishing,
        kBananaHedgehog, kBananaCenter, kBananaSanatorium, kBananaStationary,
        kZoneHedgehog, kZoneCenter, kZoneSanatorium, kZoneStationary,
        kDispatchers
      ];
      if (allCoefs.some(c => c <= 0)) {
        setErr("Все коэффициенты должны быть больше 0");
        return;
      }
    }
    
    setBusy(true);
    try {
      const payload = {
        businessName,
        timezone,
        currency,
        seasonStart,
        seasonEnd,
        badDay,
        normalDay,
        goodDay,
        baseCompareDays,
        motivationType,
        motivationPercent,
        teamIncludeSellers,
        teamIncludeDispatchers,
        toWeeklyFund,
        toSeasonFund,
        // Новые поля финальной мотивации
        individual_share: individualShare / 100,
        team_share: teamShare / 100,
        daily_activation_threshold: dailyActivationThreshold,
        seller_series_threshold: sellerSeriesThreshold,
        dispatchers_series_threshold: dispatchersSeriesThreshold,
        season_min_days_N: seasonMinDays,
        coefSpeed,
        coefWalk,
        coefFishing,
        k_banana_hedgehog: kBananaHedgehog,
        k_banana_center: kBananaCenter,
        k_banana_sanatorium: kBananaSanatorium,
        k_banana_stationary: kBananaStationary,
        k_zone_hedgehog: kZoneHedgehog,
        k_zone_center: kZoneCenter,
        k_zone_sanatorium: kZoneSanatorium,
        k_zone_stationary: kZoneStationary,
        k_dispatchers: kDispatchers,
        dispatcherWithholdPercentTotal: dispatcherWithholdPercentTotal,
        weeklyWithholdPercentTotal: weeklyWithholdPercentTotal,
        seasonWithholdPercentTotal: seasonWithholdPercentTotal,
        lowLoad,
        highLoad,
        minSellerRevenue,
        notifyBadRevenue,
        notifyLowLoad,
        notifyLowSeller,
        notifyChannel,
        ...(seasonBoundaryValidation.start && seasonBoundaryValidation.end
          ? {
              season_start_mmdd: seasonBoundaryValidation.start,
              season_end_mmdd: seasonBoundaryValidation.end,
            }
          : {}),
      };
      await apiClient.request(`/owner/settings/full`, { method: "PUT", body: payload });
      setSaveOk(true);
      if (onSettingsSaved) onSettingsSaved();
    } catch (e) {
      setErr(e?.message || "Ошибка сохранения");
    } finally {
      setBusy(false);
      setTimeout(() => setSaveOk(false), 1500);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load sellers list for zone assignment
  useEffect(() => {
    let alive = true;
    async function loadSellers() {
      setSellersLoading(true);
      try {
        const json = await apiClient.request('/owner/sellers/list', { method: 'GET' });
        if (!alive) return;
        if (json?.ok && Array.isArray(json?.data?.items)) {
          setSellersList(json.data.items);
          setSellersError(null);
        } else {
          setSellersError('Ошибка загрузки списка продавцов');
        }
      } catch (e) {
        if (!alive) return;
        setSellersError(e?.message || 'Ошибка загрузки');
      } finally {
        if (alive) setSellersLoading(false);
      }
    }
    loadSellers();
    return () => { alive = false; };
  }, []);

  // Handle zone change for a seller
  const handleZoneChange = async (sellerId, newZone) => {
    try {
      await apiClient.request(`/owner/sellers/${sellerId}/zone`, {
        method: 'PUT',
        body: { zone: newZone === '' ? null : newZone }
      });
      // Update local state
      setSellersList(prev => 
        prev.map(s => s.id === sellerId ? { ...s, zone: newZone === '' ? null : newZone } : s)
      );
    } catch (e) {
      console.error('[OwnerSettingsView] Zone update error:', e);
    }
  };

  // Derived: mode flags
  const isTeam = motivationType === 'team';
  const isPersonal = motivationType === 'personal';
  const isAdaptive = motivationType === 'adaptive';
  const showTeamBlocks = isTeam || isAdaptive;
  const showAdaptiveBlocks = isAdaptive;

  // Auto-fix shares: when one changes, auto-set the other to sum to 100
  const handleIndividualShareChange = (val) => {
    const clamped = Math.max(0, Math.min(100, val));
    setIndividualShare(clamped);
    setTeamShare(100 - clamped);
  };
  const handleTeamShareChange = (val) => {
    const clamped = Math.max(0, Math.min(100, val));
    setTeamShare(clamped);
    setIndividualShare(100 - clamped);
  };

  // Validation: can save?
  const motivationPercentValid = typeof motivationPercent === 'number' && !isNaN(motivationPercent) && motivationPercent >= 0 && motivationPercent <= 100;
  const sharesValid = !isAdaptive || (individualShare + teamShare === 100);
  const coefficientsValid = !isAdaptive || [
    coefSpeed, coefWalk, coefFishing,
    kBananaHedgehog, kBananaCenter, kBananaSanatorium, kBananaStationary,
    kZoneHedgehog, kZoneCenter, kZoneSanatorium, kZoneStationary,
    kDispatchers
  ].every(c => typeof c === 'number' && !isNaN(c) && c > 0);
  const canSave = motivationPercentValid && sharesValid && coefficientsValid;

  return (
    <div className="p-4 pb-24 space-y-4">
      <Header title="Настройки мотивации" subtitle="Параметры расчёта мотивации (не влияет на текущие продажи)" />

      <div className="rounded-2xl border border-neutral-800 p-3 flex items-center justify-between gap-2">
        <div className="text-xs text-neutral-500">
          {err ? <span className="text-red-300">{err}</span> : saveOk ? <span className="text-emerald-300">Сохранено</span> : busy ? "..." : ""}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="rounded-xl border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900/40"
            disabled={busy}
          >
            Обновить
          </button>
          <button
            type="button"
            onClick={save}
            data-testid="owner-settings-save"
            className="rounded-xl border border-amber-600/60 bg-amber-900/20 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={busy || !canSave}
          >
            Сохранить
          </button>
        </div>
      </div>

      <Section title="Границы сезона (MM-DD)">
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-neutral-500 mb-2">Начало сезона (MM-DD)</div>
              <TextInput
                value={seasonStartMmdd}
                onChange={setSeasonStartMmdd}
                placeholder="05-01"
                dataTestId="owner-settings-season-start-mmdd"
              />
            </div>
            <div>
              <div className="text-xs text-neutral-500 mb-2">Конец сезона (MM-DD)</div>
              <TextInput
                value={seasonEndMmdd}
                onChange={setSeasonEndMmdd}
                placeholder="10-01"
                dataTestId="owner-settings-season-end-mmdd"
              />
            </div>
          </div>
          <div className="mt-2 text-xs text-neutral-500">
            Границы сезона для отображения: {seasonConfigUi.start} ... {seasonConfigUi.end}
          </div>
          <div data-testid="owner-settings-season-config-status" className="mt-1 text-xs text-neutral-400">
            {seasonConfigUi.statusLabel}
          </div>
          <div className="mt-1 text-[11px] text-neutral-600">
            Если поля пустые, в интерфейсе используется fallback 01-01 ... 12-31.
          </div>
        </Card>
      </Section>

      {/* A) Тип мотивации */}
      <Section title="Тип мотивации">
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
            <div className="mt-3 text-xs text-neutral-500">
              {isTeam && "Равное распределение фонда между участниками команды. Настраивается только процент мотивации."}
              {isPersonal && "Индивидуальный процент от личной выручки. Настраивается только процент мотивации."}
              {isAdaptive && "Комбинация командного и индивидуального распределения с коэффициентами"}
            </div>
          </Card>

          {/* B) Базовые проценты */}
          <Card>
            <div className="text-sm text-neutral-400 mb-3">Процент мотивации</div>
            <DecimalRow label="От выручки" value={motivationPercent} onChange={setMotivationPercent} suffix="%" min={0} max={100} />
            <div className="mt-2 text-xs text-neutral-500">Доля от выручки, направляемая в фонд мотивации</div>
          </Card>
        </div>
      </Section>

      {/* B2) Удержания (только adaptive) */}
      {showAdaptiveBlocks && (
        <Section title="Удержания из фонда мотивации">
          <div className="text-xs text-neutral-500 mb-2">
            Удерживается из фонда мотивации (fundTotal) до распределения
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card>
              <div className="text-sm text-neutral-400 mb-3">Weekly удержание</div>
              <DecimalRow label="" value={weeklyWithholdPercentTotal} onChange={setWeeklyWithholdPercentTotal} suffix="%" min={0} max={30} />
              <div className="mt-2 text-xs text-neutral-500">Удерживается еженедельно, округляется вниз до 50₽</div>
            </Card>

            <Card>
              <div className="text-sm text-neutral-400 mb-3">Season удержание</div>
              <DecimalRow label="" value={seasonWithholdPercentTotal} onChange={setSeasonWithholdPercentTotal} suffix="%" min={0} max={30} />
              <div className="mt-2 text-xs text-neutral-500">Удерживается в сезонный фонд, округляется вниз до 50₽</div>
            </Card>

            <Card>
              <div className="text-sm text-neutral-400 mb-3">Удержание на диспетчеров</div>
              <DecimalRow label="TOTAL cap" value={dispatcherWithholdPercentTotal} onChange={setDispatcherWithholdPercentTotal} suffix="%" min={0} max={30} />
              <div className="mt-2 text-xs text-neutral-500">
                На одного = половина; выплата активным по продажам сегодня; макс. 2 диспетчера
              </div>
            </Card>
          </div>
        </Section>
      )}

      {/* C) Участники команды (только adaptive) */}
      {showAdaptiveBlocks && (
        <Section title="Участие в командной мотивации">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <ToggleRow label="Продавцы участвуют" value={teamIncludeSellers} onChange={setTeamIncludeSellers} />
            </Card>
            <Card>
              <ToggleRow label="Диспетчеры участвуют" value={teamIncludeDispatchers} onChange={setTeamIncludeDispatchers} />
            </Card>
          </div>
        </Section>
      )}

      {/* D) Распределение adaptive (только adaptive) */}
      {showAdaptiveBlocks && (
        <Section title="Распределение фонда (adaptive)">
          <div className="text-xs text-neutral-500 mb-2">
            Сумма индивидуальной и командной доли всегда равна 100%
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <div className="text-sm text-neutral-400 mb-3">Индивидуальная доля</div>
              <NumberRow label="" value={individualShare} onChange={handleIndividualShareChange} suffix="%" min={0} max={100} />
            </Card>
            <Card>
              <div className="text-sm text-neutral-400 mb-3">Командная доля</div>
              <NumberRow label="" value={teamShare} onChange={handleTeamShareChange} suffix="%" min={0} max={100} />
            </Card>
          </div>
        </Section>
      )}

      {/* F) Коэффициенты adaptive (только adaptive) */}
      {showAdaptiveBlocks && (
        <Section title="Коэффициенты (adaptive)">
          <div className="text-xs text-neutral-500 mb-2">
            Множители для расчёта баллов. Все значения от 0.1 до 10.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* A) По типам лодок */}
            <Card>
              <div className="text-sm text-neutral-400 mb-3">По типам лодок</div>
              <div className="space-y-3">
                <DecimalRow label="Скоростные" value={coefSpeed} onChange={setCoefSpeed} min={0.1} max={10} />
                <DecimalRow label="Прогулочные" value={coefWalk} onChange={setCoefWalk} min={0.1} max={10} />
                <DecimalRow label="Рыбалка" value={coefFishing} onChange={setCoefFishing} min={0.1} max={10} />
              </div>
            </Card>

            {/* B) Коэффициенты зон для speed/cruise */}
            <Card>
              <div className="text-sm text-neutral-400 mb-3">Зоны для speed/cruise</div>
              <div className="space-y-3">
                <DecimalRow label="Ёжик" value={kZoneHedgehog} onChange={setKZoneHedgehog} min={0.1} max={10} />
                <DecimalRow label="Центр" value={kZoneCenter} onChange={setKZoneCenter} min={0.1} max={10} />
                <DecimalRow label="Санаторий" value={kZoneSanatorium} onChange={setKZoneSanatorium} min={0.1} max={10} />
                <DecimalRow label="Стационарные" value={kZoneStationary} onChange={setKZoneStationary} min={0.1} max={10} />
              </div>
            </Card>

            {/* C) Коэффициенты банана по зонам */}
            <Card>
              <div className="text-sm text-neutral-400 mb-3">Зоны для банана</div>
              <div className="space-y-3">
                <DecimalRow label="Ёжик" value={kBananaHedgehog} onChange={setKBananaHedgehog} min={0.1} max={10} />
                <DecimalRow label="Центр" value={kBananaCenter} onChange={setKBananaCenter} min={0.1} max={10} />
                <DecimalRow label="Санаторий" value={kBananaSanatorium} onChange={setKBananaSanatorium} min={0.1} max={10} />
                <DecimalRow label="Стационарные" value={kBananaStationary} onChange={setKBananaStationary} min={0.1} max={10} />
              </div>
            </Card>

            {/* D) Вес диспетчера */}
            <Card>
              <div className="text-sm text-neutral-400 mb-3">Вес диспетчера</div>
              <DecimalRow label="Множитель" value={kDispatchers} onChange={setKDispatchers} min={0.1} max={10} />
              <div className="mt-2 text-xs text-neutral-500">
                Используется для взвешенной выручки диспетчера в adaptive-режиме.
              </div>
            </Card>
          </div>
        </Section>
      )}

      {/* Зоны продавцов (только adaptive) */}
      {showAdaptiveBlocks && (
        <Section title="Зоны продавцов (для банана)">
          <div className="text-sm text-neutral-500 mb-3">
            Назначьте зону каждому продавцу для применения коэффициента банана.
          </div>
          
          {sellersLoading && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 text-sm text-neutral-400">
              Загрузка списка продавцов...
            </div>
          )}
          
          {sellersError && (
            <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
              {sellersError}
            </div>
          )}
          
          {!sellersLoading && !sellersError && sellersList.length === 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 text-sm text-neutral-400">
              Нет продавцов
            </div>
          )}
          
          {!sellersLoading && !sellersError && sellersList.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 relative z-10">
              {sellersList.map(seller => (
                <div
                  key={seller.id}
                  className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 relative"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={[
                        "w-2 h-2 rounded-full shrink-0",
                        seller.is_active ? "bg-emerald-500" : "bg-neutral-600"
                      ].join(" ")} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{seller.username}</div>
                        <div className="text-xs text-neutral-500">
                          ID: {seller.id}{!seller.is_active && " • неактивен"}
                        </div>
                      </div>
                    </div>
                    
                    <select
                      value={seller.zone ?? ''}
                      onChange={(e) => handleZoneChange(seller.id, e.target.value)}
                      className="relative z-20 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-500 shrink-0 cursor-pointer"
                      style={{ minWidth: '120px' }}
                    >
                      <option value="">Не назначена</option>
                      <option value="hedgehog">Ёжик</option>
                      <option value="center">Центр</option>
                      <option value="sanatorium">Санаторий</option>
                      <option value="stationary">Стационарные</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Safety footer */}
      <div className="rounded-2xl border border-neutral-800 p-4 text-xs text-neutral-500">
        Настройки влияют на расчёт мотивации. При смене типа мотивации некоторые параметры могут не использоваться.
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

function TextInput({ value, onChange, placeholder, dataTestId }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={dataTestId}
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

/* ---------- Safe number input helpers ---------- */

// Normalizes input: replaces comma with dot, allows intermediate values
function normalizeNumInput(str) {
  return str.replace(',', '.');
}

// Converts string to number or returns null for invalid/empty
function toNumberOrNull(str) {
  if (!str || str === '.' || str === '-' || str === '-.') return null;
  const normalized = str.replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? null : num;
}

// Formats number for display (never shows NaN)
function formatNumForDisplay(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return isNaN(num) ? fallback : String(num);
}

function NumberRow({ label, value, onChange, suffix, min, max }) {
  // Use local state for input string to allow intermediate values
  const [inputStr, setInputStr] = useState(formatNumForDisplay(value, ''));
  const [isFocused, setIsFocused] = useState(false);
  
  // Sync with parent value when it changes externally
  useEffect(() => {
    if (!isFocused) {
      setInputStr(formatNumForDisplay(value, ''));
    }
  }, [value, isFocused]);

  const handleChange = (e) => {
    let raw = e.target.value;
    // Allow only digits, dot, comma, minus
    raw = raw.replace(/[^0-9.,-]/g, '');
    // Keep only first separator
    const parts = raw.split(/[.,]/);
    if (parts.length > 2) {
      raw = parts[0] + '.' + parts.slice(1).join('');
    }
    setInputStr(raw);
  };

  const handleBlur = () => {
    setIsFocused(false);
    const num = toNumberOrNull(inputStr);
    if (num !== null) {
      // Clamp to min/max
      let clamped = num;
      if (typeof min === 'number') clamped = Math.max(min, clamped);
      if (typeof max === 'number') clamped = Math.min(max, clamped);
      onChange(Math.round(clamped));
      setInputStr(String(Math.round(clamped)));
    } else {
      // Invalid - revert to previous value
      setInputStr(formatNumForDisplay(value, ''));
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-neutral-200">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={inputStr}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          inputMode="decimal"
          pattern="^-?[0-9]*[.,]?[0-9]*$"
          placeholder={typeof min === 'number' && typeof max === 'number' ? `${min}..${max}` : undefined}
          className="w-28 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-right outline-none focus:border-neutral-700"
        />
        <div className="text-sm text-neutral-500">{suffix}</div>
      </div>
    </div>
  );
}

function DecimalRow({ label, value, onChange, suffix, min, max }) {
  // Use local state for input string to allow intermediate values like "1."
  const [inputStr, setInputStr] = useState(formatNumForDisplay(value, ''));
  const [isFocused, setIsFocused] = useState(false);
  
  // Sync with parent value when it changes externally (e.g., on load)
  useEffect(() => {
    if (!isFocused) {
      setInputStr(formatNumForDisplay(value, ''));
    }
  }, [value, isFocused]);

  const handleChange = (e) => {
    let raw = e.target.value;
    // Allow only digits, dot, comma
    raw = raw.replace(/[^0-9.,]/g, '');
    // Keep only first separator (dot or comma)
    const parts = raw.split(/[.,]/);
    if (parts.length > 2) {
      raw = parts[0] + '.' + parts.slice(1).join('');
    }
    setInputStr(raw);
  };

  const handleBlur = () => {
    setIsFocused(false);
    // Convert to number on blur
    const num = toNumberOrNull(inputStr);
    if (num !== null) {
      // Clamp to min/max
      let clamped = num;
      if (typeof min === 'number') clamped = Math.max(min, clamped);
      if (typeof max === 'number') clamped = Math.min(max, clamped);
      onChange(clamped);
      setInputStr(String(clamped));
    } else {
      // Invalid - revert to previous value
      setInputStr(formatNumForDisplay(value, ''));
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  return (
    <div className="flex items-center justify-between gap-3">
      {label && <div className="text-sm text-neutral-200">{label}</div>}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={inputStr}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          inputMode="decimal"
          pattern="^[0-9]*[.,]?[0-9]*$"
          placeholder={typeof min === 'number' && typeof max === 'number' ? `${min}..${max}` : undefined}
          className="w-28 rounded-xl border border-neutral-800 bg-neutral-950/30 px-3 py-2 text-sm text-right outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-700/40"
        />
        <div className="text-sm text-neutral-500">{suffix || 'x'}</div>
      </div>
    </div>
  );
}

