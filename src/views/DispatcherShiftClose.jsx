import { useState, useEffect, useMemo, Fragment } from 'react';
import apiClient from '../utils/apiClient';
import { formatRUB } from '../utils/currency';
import normalizeSummary from '../utils/normalizeSummary';
import { useAuth } from '../contexts/AuthContext';

const COMMISSION_PERCENT = 13; // Temporary commission rate

function formatRUBExact(amount) {
  if (amount === undefined || amount === null) return '0 ₽';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// Shift-close UI uses the real backend endpoint.
// If endpoint is unavailable, UI still works in local fallback mode.
function toLocalBusinessDay(d = new Date()) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DispatcherShiftClose = ({ setShiftClosed: setGlobalShiftClosed }) => {
  const { currentUser } = useAuth();
  // Shift data
  const [dailySummary, setDailySummary] = useState(null);
  const [sellersData, setSellersData] = useState([]);
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState('');
  const [reloading, setReloading] = useState(false);

  // Local drafts for seller deposits until they are posted to the backend.
  // drafts[sellerId] = { cash: string|number, terminal: string|number }
  const [depositDrafts, setDepositDrafts] = useState({});

  // Expanded seller row state (accordion)
  const [expandedSellerId, setExpandedSellerId] = useState(null);

  // Salary values from backend
  const [salaryDue, setSalaryDue] = useState(0);
  const [salaryPaidTotal, setSalaryPaidTotal] = useState(0);
  // Per-seller salary payout drafts
  const [salaryDraftBySellerId, setSalaryDraftBySellerId] = useState({});
  
  // State for confirmation checkboxes
  const [confirmationChecks, setConfirmationChecks] = useState({
    cashHandedOver: false,
    salaryCalculated: false,
    noComplaints: false
  });
  
  // State to track if shift is closed
  const [shiftClosed, setShiftClosed] = useState(false);
  
  // Normalized summary from backend (single source of truth)
  const [normalizedSummary, setNormalizedSummary] = useState(null);
  
  // New fields from contract (Step 4)
  const [shiftSource, setShiftSource] = useState('live');
  const [closedAt, setClosedAt] = useState(null);
  const [closedBy, setClosedBy] = useState(null);

  // State for trip completion status (gate for operations)
  const [allTripsFinished, setAllTripsFinished] = useState(true);
  const [openTripsCount, setOpenTripsCount] = useState(0);

  // Explain section (human-readable breakdown)
  const [explainData, setExplainData] = useState(null);

  const loadSummaryFromBackend = async (businessDay) => {
    const day = businessDay || toLocalBusinessDay();
    const data = await apiClient.request(`/dispatcher/shift-ledger/summary?business_day=${encodeURIComponent(day)}`);

    // Normalize the response (handles both snake_case and camelCase)
    const normalized = normalizeSummary(data, { currentUser });
    if (!normalized) {
      throw new Error('Failed to normalize summary data');
    }
    
    // Store normalized summary as single source of truth
    setNormalizedSummary(normalized);

    // Build legacy-compatible dailySummary object
    const summary = {
      totalRevenue: normalized.total_revenue,
      cashRevenue: normalized.collected_cash,
      cardRevenue: normalized.collected_card,
      collectedTotal: normalized.collected_total,
      liveSource: normalized.live_source ?? normalized.source,
      commissionPaid: Math.round((normalized.total_revenue * COMMISSION_PERCENT) / 100),
      businessDay: normalized.business_day,
      // Refund and net metrics
      refundTotal: normalized.refund_total,
      refundCash: normalized.refund_cash,
      refundCard: normalized.refund_card,
      netTotal: normalized.net_total,
      netCash: normalized.net_cash,
      netCard: normalized.net_card,
      // Deposits (for cashbox calculation)
      depositCash: normalized.deposit_cash,
      depositCard: normalized.deposit_card,
    };

    // Build sellers array for legacy code
    const sellers = normalized.sellers.map((s) => ({
      id: s.seller_id,
      name: s.seller_name,
      // informational fields
      totalSales: s.collected_total,
      cashSales: s.collected_cash,
      cardSales: s.collected_card,
      // already handed to owner/dispatcher
      cashHanded: s.deposit_cash,
      terminalHanded: s.deposit_card,
      // critical fields for the main table
      cashRemaining: s.cash_due_to_owner,
      terminalDebt: s.terminal_due_to_owner ?? s.terminal_debt,
      totalDue: s.net_total ?? s.balance ?? ((s.cash_due_to_owner ?? 0) + (s.terminal_due_to_owner ?? s.terminal_debt ?? 0)),
      // debug
      depositedTotal: s._raw?.deposited ?? 0,
    }));

    // Set shift closed state
    const closed = normalized.is_closed;
    setShiftClosed(closed);
    if (typeof setGlobalShiftClosed === 'function') setGlobalShiftClosed(closed);
    try {
      if (closed) localStorage.setItem('dispatcher_shiftClosed', 'true');
      else localStorage.removeItem('dispatcher_shiftClosed');
    } catch {}
    
    // Set contract fields
    setShiftSource(normalized.source);
    setClosedAt(normalized.closed_at);
    setClosedBy(normalized.closed_by);
    // Trip status
    setAllTripsFinished(closed ? true : normalized.all_trips_finished);
    setOpenTripsCount(closed ? 0 : normalized.open_trips_count);

    // Explain section (human-readable breakdown)
    setExplainData(normalized.explain || null);

    // Salary values
    setSalaryDue(normalized.salary_due_total);
    setSalaryPaidTotal(normalized.salary_paid_total);

    // Init drafts
    const draftsInit = {};
    for (const s of sellers) {
      draftsInit[s.id] = { cash: '', terminal: '' };
    }

    setDailySummary(summary);
    setSellersData(sellers);
    setDepositDrafts(draftsInit);
    setLoadError('');
    setLoading(false);
  };

  const refreshSummary = async (businessDay) => {
    const day = businessDay || normalizedSummary?.business_day || dailySummary?.businessDay || toLocalBusinessDay();
    setReloading(true);
    setLoadError('');
    try {
      await loadSummaryFromBackend(day);
    } catch (e) {
      const msg = e?.response?.error || e?.response?.message || e?.message || 'Не удалось загрузить данные смены';
      setLoadError(msg);
      setLoading(false);
    } finally {
      setReloading(false);
    }
  };
  
  // Helper: handle API error, check for SHIFT_CLOSED, reload summary
  const handleApiError = async (error, operation) => {
    const errData = error?.response || error?.body || error?.data || {};
    if (errData?.code === 'SHIFT_CLOSED' || error?.status === 409) {
      // Shift was closed - reload summary to update UI
      const businessDay = normalizedSummary?.business_day || dailySummary?.businessDay || toLocalBusinessDay();
      await refreshSummary(businessDay);
      return { handled: true, shiftClosed: true };
    }
    console.error(`[${operation}] Error:`, error);
    return { handled: false };
  };

  useEffect(() => {
    refreshSummary(toLocalBusinessDay());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const debtSummary = useMemo(() => {
    const sellers = normalizedSummary?.sellers ?? sellersData ?? [];
    const debtSellers = sellers.filter((s) => {
      const role = String(s?.role || '').toLowerCase();
      if (role === 'dispatcher') return false;
      const totalDue = Number(
        s.net_total ??
        s.balance ??
        (
          Number(s.cash_due_to_owner ?? (s.cashRemaining || 0)) +
          Number(s.terminal_due_to_owner ?? s.terminal_debt ?? (s.terminalDebt || 0))
        )
      );
      return totalDue > 0;
    });
    const totalDebt = debtSellers.reduce(
      (acc, s) => acc + Math.max(0, Number(
        s.net_total ??
        s.balance ??
        (
          Number(s.cash_due_to_owner ?? (s.cashRemaining || 0)) +
          Number(s.terminal_due_to_owner ?? s.terminal_debt ?? (s.terminalDebt || 0))
        )
      )),
      0
    );
    return { count: debtSellers.length, total: totalDebt };
  }, [normalizedSummary, sellersData]);

  const shiftCloseBreakdown = normalizedSummary?.shift_close_breakdown ?? null;
  const shiftCloseTotals = shiftCloseBreakdown?.totals ?? null;

  const sellersCollectTotal = useMemo(() => {
    if (shiftCloseTotals?.collect_from_sellers !== null && shiftCloseTotals?.collect_from_sellers !== undefined) {
      return Number(shiftCloseTotals.collect_from_sellers);
    }
    if (normalizedSummary?.sellers_collect_total !== null && normalizedSummary?.sellers_collect_total !== undefined) {
      return Number(normalizedSummary.sellers_collect_total);
    }
    return Number(debtSummary?.total ?? 0);
  }, [shiftCloseTotals, normalizedSummary, debtSummary]);

  const getSellerStatus = (s) => {
    const cashRem = Number(s.cashRemaining || 0);
    const termRem = Number(s.terminalDebt || 0);
    const totalDue = Number(s.totalDue ?? (cashRem + termRem));
    if (totalDue <= 0) return 'CLOSED';
    // Partial: seller already handed over part of the money or one side is already closed.
    const handedAny = Number(s.cashHanded || 0) > 0 || Number(s.terminalHanded || 0) > 0;
    const oneSideClosed = cashRem === 0 || termRem === 0;
    if (handedAny || oneSideClosed) return 'PARTIAL';
    return 'DEBT';
  };

  const setDraftValue = (sellerId, key, value) => {
    setDepositDrafts((prev) => ({
      ...prev,
      [sellerId]: { ...(prev?.[sellerId] || { cash: '', terminal: '' }), [key]: value },
    }));
  };

  const fillAllDrafts = () => {
    const sellers = normalizedSummary?.sellers ?? sellersData ?? [];
    const next = { ...depositDrafts };
    for (const s of sellers) {
      const role = String(s?.role || '').toLowerCase();
      if (role === 'dispatcher') continue;
      const cashDue = Math.max(0, Math.floor(Number(s.cash_due_to_owner ?? (s.cashRemaining || 0))));
      const termDue = Math.max(0, Math.floor(Number(s.terminal_due_to_owner ?? s.terminal_debt ?? (s.terminalDebt || 0))));
      const sellerId = s.seller_id ?? s.id;
      const prev = next[sellerId] || { cash: '', terminal: '' };
      next[sellerId] = {
        // Fill only when there is something due and the input is still empty.
        cash: cashDue > 0 && (prev.cash === '' || prev.cash === undefined) ? String(cashDue) : (prev.cash || ''),
        terminal: termDue > 0 && (prev.terminal === '' || prev.terminal === undefined) ? String(termDue) : (prev.terminal || ''),
      };
    }
    setDepositDrafts(next);
  };

  const salarySummary = useMemo(() => {
    const due = salaryDue;
    const paid = salaryPaidTotal;
    const remaining = Math.max(0, due - paid);
    return { due, paid, remaining };
  }, [salaryDue, salaryPaidTotal]);

  const ownerCashAvailable = useMemo(() => {
    return Number(
      shiftCloseTotals?.owner_cash_before_reserve ??
      normalizedSummary?.owner_cash_available_without_future_reserve ??
      dailySummary?.netCash ??
      0
    );
  }, [shiftCloseTotals, normalizedSummary, dailySummary]);

  const futureTripsReserveCash = useMemo(() => {
    return Number(
      shiftCloseTotals?.reserve_cash ??
      normalizedSummary?.future_trips_reserve_cash ??
      explainData?.liabilities?.future_trips_reserve_cash ??
      explainData?.liabilities?.prepayment_future_cash ??
      0
    );
  }, [shiftCloseTotals, normalizedSummary, explainData]);

  const futureTripsReserveCard = useMemo(() => {
    return Number(
      shiftCloseTotals?.reserve_card ??
      normalizedSummary?.future_trips_reserve_card ??
      explainData?.liabilities?.future_trips_reserve_terminal ??
      explainData?.liabilities?.prepayment_future_terminal ??
      0
    );
  }, [shiftCloseTotals, normalizedSummary, explainData]);

  const futureTripsReserveTotal = useMemo(
    () => Number(shiftCloseTotals?.reserve_total ?? (futureTripsReserveCash + futureTripsReserveCard)),
    [shiftCloseTotals, futureTripsReserveCash, futureTripsReserveCard]
  );

  const ownerCashAvailableAfterReserve = useMemo(() => {
    return Number(
      shiftCloseTotals?.owner_cash_after_reserve ??
      normalizedSummary?.owner_cash_available_after_future_reserve_cash ??
      (ownerCashAvailable - futureTripsReserveCash)
    );
  }, [shiftCloseTotals, normalizedSummary, ownerCashAvailable, futureTripsReserveCash]);

  const fundsWithholdCashToday = useMemo(() => {
    const fromBreakdown = shiftCloseTotals?.funds_withhold_cash_today;
    if (fromBreakdown !== null && fromBreakdown !== undefined) {
      return Number(fromBreakdown);
    }
    const fromServer = normalizedSummary?.funds_withhold_cash_today;
    if (fromServer !== null && fromServer !== undefined) {
      return Number(fromServer);
    }
    const withhold = normalizedSummary?.motivation_withhold;
    if (!withhold) return 0;
    const seasonFromRevenue = Number(withhold.season_from_revenue ?? withhold.season_amount ?? 0);
    const dispatcherAmount = Number(withhold.dispatcher_amount_total || 0);
    return (
      Number(withhold.weekly_amount || 0) +
      seasonFromRevenue +
      dispatcherAmount
    );
  }, [shiftCloseTotals, normalizedSummary]);

  const fundsUi = useMemo(() => {
    const withhold = normalizedSummary?.motivation_withhold;
    if (!withhold && !shiftCloseTotals) return null;

    const seasonFromRevenue = Number(
      shiftCloseTotals?.season_from_revenue ??
      withhold?.season_from_revenue ??
      0
    );
    const seasonFromPrepaymentTransfer = Number(
      shiftCloseTotals?.season_prepay_transfer ??
      withhold?.season_from_prepayment_transfer ??
      0
    );
    const seasonFundTotalFromLedger =
      shiftCloseTotals?.season_fund_total ??
      withhold?.season_total ??
      withhold?.season_fund_total;
    const seasonFundTotal = Number(
      seasonFundTotalFromLedger ??
      (seasonFromRevenue + seasonFromPrepaymentTransfer)
    );
    const seasonTodayAmount = Number(
      shiftCloseTotals?.season_from_revenue ??
      withhold?.season_from_revenue ??
      withhold?.season_amount ??
      0
    );

    return {
      weeklyAmount: Number(shiftCloseTotals?.weekly_fund ?? withhold?.weekly_amount ?? 0),
      dispatcherAmount: Number(shiftCloseTotals?.dispatcher_bonus ?? withhold?.dispatcher_amount_total ?? 0),
      seasonTodayAmount,
      seasonFromRevenue,
      seasonFromPrepaymentTransfer,
      roundingToSeason: Number(
        shiftCloseTotals?.season_rounding ??
        withhold?.rounding_to_season_amount_total ??
        0
      ),
      seasonFundTotal,
      fundTotalOriginal: Number(
        shiftCloseTotals?.motivation_fund ??
        withhold?.fund_total_original ??
        0
      ),
      fundTotalAfterWithhold: Number(
        shiftCloseTotals?.salary_fund_total ??
        withhold?.fund_total_after_withhold ??
        0
      ),
    };
  }, [shiftCloseTotals, normalizedSummary]);

  const payrollRows = useMemo(() => {
    const sellersForRender =
      normalizedSummary?.sellers ??
      normalizedSummary?.participants_with_sales ??
      sellersData ??
      [];

    return sellersForRender.filter((seller) => {
      const sellerId = Number(seller?.seller_id ?? seller?.id ?? 0);
      const collectedTotal = Number(
        seller?.collected_total ??
        seller?.collectedTotal ??
        seller?.total_collected ??
        seller?.totalCollected ??
        seller?.accepted ??
        0
      );
      const salaryTotal = Number(
        seller?.salary_due_total ??
        seller?.salaryDueTotal ??
        seller?.salary_due ??
        seller?.salaryDue ??
        seller?.salary_accrued ??
        seller?.salaryAccrued ??
        0
      );
      return Number.isFinite(sellerId) && sellerId > 0 && (collectedTotal > 0 || salaryTotal > 0);
    });
  }, [normalizedSummary, sellersData]);

  const payrollMath = useMemo(() => {
    const withhold = normalizedSummary?.motivation_withhold;
    const salaryRawFromRows = roundMoney(payrollRows.reduce((sum, seller) => (
      sum + Number(seller?.total_raw ?? seller?.totalRaw ?? seller?.salary_due_total ?? seller?.salaryDueTotal ?? 0)
    ), 0));
    const salaryFinalFromRows = roundMoney(payrollRows.reduce((sum, seller) => (
      sum + Number(
        seller?.salary_due_total ??
        seller?.salaryDueTotal ??
        seller?.salary_due ??
        seller?.salaryDue ??
        seller?.salary_accrued ??
        seller?.salaryAccrued ??
        0
      )
    ), 0));
    const salaryRoundingFromRows = roundMoney(payrollRows.reduce((sum, seller) => (
      sum + Number(seller?.salary_rounding_to_season ?? seller?.salaryRoundingToSeason ?? 0)
    ), 0));

    const fundOriginal = roundMoney(
      shiftCloseTotals?.motivation_fund ??
      withhold?.fund_total_original ??
      0
    );
    const weeklyAmount = roundMoney(
      shiftCloseTotals?.weekly_fund ??
      withhold?.weekly_amount ??
      0
    );
    const dispatcherAmount = roundMoney(
      shiftCloseTotals?.dispatcher_bonus ??
      withhold?.dispatcher_amount_total ??
      0
    );
    const seasonBase = roundMoney(
      shiftCloseTotals?.season_base ??
      withhold?.season_amount_base ??
      0
    );
    const seasonFromRounding = roundMoney(
      shiftCloseTotals?.season_rounding ??
      withhold?.season_amount_from_rounding ??
      withhold?.rounding_to_season_amount_total ??
      0
    );
    const seasonTodayAmount = roundMoney(
      shiftCloseTotals?.season_from_revenue ??
      withhold?.season_from_revenue ??
      withhold?.season_amount ??
      (seasonBase + seasonFromRounding)
    );
    const seasonTransfer = roundMoney(
      shiftCloseTotals?.season_prepay_transfer ??
      withhold?.season_from_prepayment_transfer ??
      withhold?.season_amount_from_cancelled_prepayment ??
      0
    );
    const seasonFundTotal = roundMoney(
      shiftCloseTotals?.season_fund_total ??
      withhold?.season_total ??
      withhold?.season_fund_total ??
      (seasonTodayAmount + seasonTransfer)
    );

    const serverSalaryRaw = shiftCloseTotals?.salary_fund_total;
    const salaryRaw = serverSalaryRaw !== null && serverSalaryRaw !== undefined
      ? roundMoney(serverSalaryRaw)
      : salaryRawFromRows > 0
      ? salaryRawFromRows
      : roundMoney(withhold?.fund_total_after_withhold ?? 0);
    const serverSalaryFinal = shiftCloseTotals?.final_salary_total;
    const salaryFinal = serverSalaryFinal !== null && serverSalaryFinal !== undefined
      ? roundMoney(serverSalaryFinal)
      : salaryFinalFromRows > 0
      ? salaryFinalFromRows
      : roundMoney(normalizedSummary?.salary_due_total ?? 0);
    const serverSalaryRounding = shiftCloseTotals?.season_rounding;
    const salaryRoundingToSeason = serverSalaryRounding !== null && serverSalaryRounding !== undefined
      ? roundMoney(serverSalaryRounding)
      : salaryRoundingFromRows > 0
      ? salaryRoundingFromRows
      : roundMoney(Math.max(0, salaryRaw - salaryFinal));

    return {
      fundOriginal,
      weeklyAmount,
      dispatcherAmount,
      seasonBase,
      seasonFromRounding,
      seasonTodayAmount,
      seasonTransfer,
      seasonFundTotal,
      salaryRaw,
      salaryFinal,
      salaryRoundingToSeason,
      finalInvariantDiff: roundMoney(
        fundOriginal - weeklyAmount - seasonTodayAmount - dispatcherAmount - salaryFinal
      ),
    };
  }, [shiftCloseTotals, normalizedSummary, payrollRows]);

  const collectedLive = useMemo(() => {
    return {
      cash: Number(shiftCloseTotals?.cash_received ?? normalizedSummary?.collected_cash ?? dailySummary?.cashRevenue ?? 0),
      card: Number(shiftCloseTotals?.card_received ?? normalizedSummary?.collected_card ?? dailySummary?.cardRevenue ?? 0),
      total: Number(shiftCloseTotals?.total_received ?? normalizedSummary?.collected_total ?? dailySummary?.collectedTotal ?? 0),
    };
  }, [shiftCloseTotals, normalizedSummary, dailySummary]);

  const ownerCashHandoverFinal = useMemo(() => {
    if (shiftCloseTotals?.owner_cash_today !== null && shiftCloseTotals?.owner_cash_today !== undefined) {
      return Number(shiftCloseTotals.owner_cash_today);
    }
    if (normalizedSummary?.owner_handover_cash_final !== null && normalizedSummary?.owner_handover_cash_final !== undefined) {
      return Number(normalizedSummary.owner_handover_cash_final);
    }
    return 0;
  }, [shiftCloseTotals, normalizedSummary]);

  const shiftSourceLabel = useMemo(() => {
    if (shiftSource === 'snapshot') return 'снимок';
    if (shiftSource === 'live') return 'онлайн';
    return shiftSource || 'онлайн';
  }, [shiftSource]);

  const applySalaryPayoutForSeller = async (sellerId) => {
    const raw = salaryDraftBySellerId?.[sellerId];
    const amount = Math.max(0, Number(raw || 0));
    if (!amount) return;

    try {
      const business_day = normalizedSummary?.business_day ?? dailySummary?.businessDay ?? toLocalBusinessDay();
      await apiClient.request('/dispatcher/shift/deposit', {
        method: 'POST',
        body: {
          business_day,
          type: 'SALARY_PAYOUT_CASH',
          seller_id: sellerId,
          amount,
        },
      });
      await refreshSummary(business_day);
      setSalaryDraftBySellerId((prev) => ({ ...prev, [sellerId]: '' }));
    } catch (e) {
      const result = await handleApiError(e, 'SALARY_PAYOUT');
      if (result.handled) return;
      alert('Не удалось провести выплату зарплаты. Проверь соединение и попробуй снова.');
    }
  };

  const applyCashDeposit = async (sellerId) => {
    const s = (sellersData || []).find((x) => x.id === sellerId);
    if (!s) return;
    const raw = depositDrafts?.[sellerId]?.cash;
    const amount = Math.max(0, Number(raw || 0));
    if (!amount) return;

    try {
      const business_day = normalizedSummary?.business_day ?? dailySummary?.businessDay ?? toLocalBusinessDay();
      await apiClient.request('/dispatcher/shift/deposit', {
        method: 'POST',
        body: {
          business_day,
          type: 'DEPOSIT_TO_OWNER_CASH',
          seller_id: sellerId,
          amount,
        },
      });
      await refreshSummary(business_day);
      setDraftValue(sellerId, 'cash', '');
    } catch (e) {
      const result = await handleApiError(e, 'CASH_DEPOSIT');
      if (result.handled) return;
      alert('Не удалось провести сдачу наличных. Проверь соединение и попробуй снова.');
    }
  };

  const applyTerminalClose = async (sellerId) => {
    const s = (sellersData || []).find((x) => x.id === sellerId);
    if (!s) return;
    const raw = depositDrafts?.[sellerId]?.terminal;
    const amount = Math.max(0, Number(raw || 0));
    if (!amount) return;

    try {
      const business_day = normalizedSummary?.business_day ?? dailySummary?.businessDay ?? toLocalBusinessDay();
      await apiClient.request('/dispatcher/shift/deposit', {
        method: 'POST',
        body: {
          business_day,
          type: 'DEPOSIT_TO_OWNER_CARD',
          seller_id: sellerId,
          amount,
        },
      });
      await refreshSummary(business_day);
      setDraftValue(sellerId, 'terminal', '');
    } catch (e) {
      const result = await handleApiError(e, 'TERMINAL_CLOSE');
      if (result.handled) return;
      alert('Не удалось закрыть терминальный долг. Проверь соединение и попробуй снова.');
    }
  };

  const handleShiftClose = async () => {
    if (!allChecked) {
      alert('Отметь все пункты подтверждения перед закрытием смены.');
      return;
    }
    if (salarySummary.remaining > 0) {
      alert('Нельзя закрыть смену: есть невыплаченная зарплата.');
      return;
    }
    if (debtSummary.total > 0) {
      alert('Нельзя закрыть смену: есть несданные суммы у продавцов.');
      return;
    }
    if (!window.confirm('Вы уверены, что хотите закрыть смену?')) return;

    const business_day = normalizedSummary?.business_day ?? dailySummary?.businessDay ?? toLocalBusinessDay();

    try {
      await apiClient.request('/dispatcher/shift/close', {
        method: 'POST',
        body: { business_day },
      });

      // Success: ok:true
      setShiftClosed(true);
      if (setGlobalShiftClosed) setGlobalShiftClosed(true);
      try { localStorage.setItem('dispatcher_shiftClosed', 'true'); } catch {}
      alert('Смена закрыта');

      // Refetch summary to switch to snapshot source
      await refreshSummary(business_day);
    } catch (e) {
      const errData = e?.response || e?.body || e?.data || {};
      const status = e?.status;

      // 409: already closed (idempotent)
      if (status === 409 || errData?.code === 'SHIFT_CLOSED') {
        setShiftClosed(true);
        if (setGlobalShiftClosed) setGlobalShiftClosed(true);
        try { localStorage.setItem('dispatcher_shiftClosed', 'true'); } catch {}
        await refreshSummary(business_day);
        alert('Смена уже закрыта');
        return;
      }

      // 400: validation error (open trips, etc.)
      if (status === 400) {
        const msg = errData?.error || errData?.message || JSON.stringify(errData);
        alert(`Нельзя закрыть смену: ${msg}`);
        return;
      }

      // Other errors
      console.error('shift close failed', e);
      const msg = errData?.error || errData?.message || 'Проверь соединение и повтори.';
      alert(`Ошибка закрытия смены. ${msg}`);
    }
  };

  const handleCheckboxChange = (checkboxName) => {
    setConfirmationChecks(prev => ({
      ...prev,
      [checkboxName]: !prev[checkboxName]
    }));
  };

  const allChecked = Object.values(confirmationChecks).every(value => value);

  // Guard: shift cannot be closed while sellers still owe money, salary is unpaid, or trips are unfinished.
  const canCloseShift = allChecked && !shiftClosed && allTripsFinished && Number(salarySummary.remaining || 0) <= 0 && Number(debtSummary.total || 0) <= 0;
  const closeBlockReason = !allChecked
    ? 'Отметь все пункты подтверждения.'
    : !allTripsFinished
    ? `Есть незавершённые рейсы: ${openTripsCount}`
    : Number(salarySummary.remaining || 0) > 0
    ? 'Есть невыплаченная зарплата.'
    : Number(debtSummary.total || 0) > 0
    ? `Есть несданные суммы у продавцов: ${formatRUB(debtSummary.total)}`
    : '';
  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950">
        <div className="p-3">
          <div className="max-w-4xl mx-auto">
            <div className="text-center py-8">Загрузка...</div>
          </div>
        </div>
      </div>
    );
  }

  if (!dailySummary) {
    return (
      <div className="min-h-screen bg-neutral-950">
        <div className="p-3">
          <div className="max-w-4xl mx-auto">
            <div className="bg-neutral-900 rounded-2xl p-4 text-center">
              <div className="text-red-300 mb-3">Не удалось загрузить данные смены.</div>
              <button
                type="button"
                onClick={() => refreshSummary()}
                disabled={reloading}
                className="px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-700 text-neutral-200 hover:bg-neutral-900 disabled:opacity-60"
              >
                {reloading ? 'Обновление...' : 'Повторить'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="p-3">
        <div className="max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto space-y-6">
          {/* Daily Summary Card */}
          <div className="bg-neutral-900 rounded-2xl  p-3">
            {/* Shift status header */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-neutral-100">ИТОГО ЗА ДЕНЬ</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => refreshSummary()}
                  disabled={reloading}
                  className="px-2 py-1 rounded-lg border border-neutral-700 bg-neutral-950 text-neutral-300 text-sm hover:bg-neutral-900 disabled:opacity-60"
                >
                  {reloading ? 'Обновление...' : 'Обновить'}
                </button>
                {shiftClosed ? (
                  <span className="px-2 py-1 bg-green-900/50 text-green-300 rounded-lg text-sm">
                    ✓ Закрыта ({shiftSourceLabel})
                  </span>
                ) : (
                  <span className="px-2 py-1 bg-yellow-900/50 text-yellow-300 rounded-lg text-sm">
                    ○ Открыта ({shiftSourceLabel})
                  </span>
                )}
              </div>
            </div>
            
            {/* Closed shift message */}
            {shiftClosed && closedAt && (
              <div className="mb-3 p-2 bg-green-950/50 border border-green-900/50 rounded-lg text-sm text-green-300 text-center">
                Смена закрыта в {closedAt}{closedBy ? ` (id: ${closedBy})` : ''}. Операции запрещены.
              </div>
            )}
            {loadError ? (
              <div className="mb-3 p-2 bg-red-950/40 border border-red-900/50 rounded-lg text-sm text-red-300 text-center">
                Ошибка загрузки смены: {loadError}
              </div>
            ) : null}
            
            <div className="bg-neutral-950/50 border border-neutral-800 p-4 rounded-lg" data-testid="shiftclose-summary">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-neutral-900 px-3 py-3">
                  <div className="text-neutral-400 text-sm">Наличными получено</div>
                  <div data-testid="shiftclose-cash-received" className="text-2xl font-bold text-green-400">
                    {formatRUBExact(collectedLive.cash)}
                  </div>
                </div>
                <div className="rounded-lg bg-neutral-900 px-3 py-3">
                  <div className="text-neutral-400 text-sm">Терминал получено</div>
                  <div data-testid="shiftclose-card-received" className="text-2xl font-bold text-blue-400">
                    {formatRUBExact(collectedLive.card)}
                  </div>
                </div>
                <div className="rounded-lg bg-neutral-900 px-3 py-3">
                  <div className="text-neutral-400 text-sm">Итого получено</div>
                  <div data-testid="shiftclose-total-received" className="text-2xl font-bold text-emerald-400">
                    {formatRUBExact(collectedLive.total)}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                <div className="flex items-center justify-between py-2 px-3 bg-neutral-900 rounded-lg">
                  <span className="text-neutral-400">К выдаче зарплат</span>
                  <span data-testid="shiftclose-salary-due-remaining" className="text-lg font-bold text-blue-400">
                    {formatRUB(salarySummary.remaining)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 bg-neutral-900 rounded-lg">
                  <span className="text-neutral-400">Отложить в Weekly фонд</span>
                  <span data-testid="shiftclose-withhold-weekly" className="text-lg font-bold text-purple-300">
                    {formatRUB(fundsUi?.weeklyAmount ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 bg-neutral-900 rounded-lg">
                  <span className="text-neutral-400">Season фонд всего</span>
                  <span data-testid="shiftclose-withhold-season" className="text-lg font-bold text-purple-300">
                    {formatRUBExact(payrollMath?.seasonFundTotal ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 bg-neutral-900 rounded-lg">
                  <span className="text-neutral-400">Отложить в резерв будущих рейсов</span>
                  <span data-testid="shiftclose-future-reserve-total" className="text-lg font-bold text-amber-300">
                    {formatRUB(futureTripsReserveTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 bg-neutral-900 rounded-lg">
                  <span className="text-neutral-400">Сдать owner наличными сегодня</span>
                  <span data-testid="shiftclose-owner-final-kpi" className={`text-lg font-bold ${ownerCashHandoverFinal < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                    {formatRUB(ownerCashHandoverFinal)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 bg-neutral-900 rounded-lg">
                  <span className="text-neutral-400">Собрать с продавцов</span>
                  <span data-testid="shiftclose-sellers-debt-total" className={`text-lg font-bold ${sellersCollectTotal > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {formatRUB(sellersCollectTotal)}
                  </span>
                </div>
              </div>
            </div>

            {fundsUi && (
              <details className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                <summary className="cursor-pointer text-sm text-neutral-300">Внутренние расчёты смены</summary>
                <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs text-neutral-400">
                  <div className="space-y-2 rounded-xl border border-neutral-800 bg-neutral-950/60 p-3">
                    <div className="text-sm font-semibold text-neutral-200">Payroll</div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Общий фонд мотивации</span>
                      <span data-testid="shiftclose-fund-original" className="font-semibold text-fuchsia-300">
                        {formatRUBExact(payrollMath.fundOriginal)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>База для зарплаты</span>
                      <span className="font-semibold text-blue-300">{formatRUB(normalizedSummary?.salary_base ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>ЗП raw до округления</span>
                      <span data-testid="shiftclose-salary-raw" className="font-semibold text-orange-300">
                        {formatRUBExact(payrollMath.salaryRaw)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Итоговая ЗП к выплате</span>
                      <span className="font-semibold text-orange-300">{formatRUB(payrollMath.salaryFinal)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Округление в Season фонд</span>
                      <span data-testid="shiftclose-withhold-rounding-season" className="font-semibold text-amber-300">
                        {formatRUBExact(payrollMath.salaryRoundingToSeason)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Бонус диспетчерам</span>
                      <span data-testid="shiftclose-withhold-dispatcher" className="font-semibold text-sky-300">
                        {formatRUB(fundsUi?.dispatcherAmount ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Фонд = weekly + season today + dispatcher + salary final</span>
                      <span className={`font-semibold ${Math.abs(payrollMath.finalInvariantDiff) <= 0.01 ? 'text-emerald-300' : 'text-red-300'}`}>
                        {formatRUBExact(payrollMath.fundOriginal)} = {formatRUBExact(payrollMath.weeklyAmount)} + {formatRUBExact(payrollMath.seasonTodayAmount)} + {formatRUBExact(payrollMath.dispatcherAmount)} + {formatRUBExact(payrollMath.salaryFinal)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-xl border border-neutral-800 bg-neutral-950/60 p-3">
                    <div className="text-sm font-semibold text-neutral-200">Фонды и owner cash</div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Weekly фонд</span>
                      <span className="font-semibold text-purple-300">{formatRUBExact(payrollMath.weeklyAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Season сегодня из выручки</span>
                      <span data-testid="shiftclose-withhold-season-today" className="font-semibold text-violet-300">
                        {formatRUBExact(payrollMath.seasonTodayAmount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Season base</span>
                      <span className="font-semibold text-violet-300">{formatRUBExact(payrollMath.seasonBase)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Season из округлений</span>
                      <span className="font-semibold text-amber-300">{formatRUBExact(payrollMath.seasonFromRounding)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Добавлено переносом предоплат</span>
                      <span data-testid="shiftclose-withhold-season-transfer" className="font-semibold text-cyan-300">
                        {formatRUBExact(payrollMath.seasonTransfer)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Season фонд всего</span>
                      <span className="font-semibold text-purple-300">{formatRUBExact(payrollMath.seasonFundTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Наличные owner до резерва</span>
                      <span className={`font-semibold ${ownerCashAvailable < 0 ? 'text-red-300' : 'text-neutral-200'}`}>{formatRUB(ownerCashAvailable)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Резерв будущих рейсов (нал/терминал)</span>
                      <span className="font-semibold text-amber-300">{formatRUB(futureTripsReserveCash)} / {formatRUB(futureTripsReserveCard)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Наличные owner после резерва</span>
                      <span className={`font-semibold ${ownerCashAvailableAfterReserve < 0 ? 'text-red-300' : 'text-neutral-200'}`}>{formatRUB(ownerCashAvailableAfterReserve)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Удержания фондов сегодня (нал)</span>
                      <span className="font-semibold text-purple-300">{formatRUB(fundsWithholdCashToday)}</span>
                    </div>
                  </div>
                </div>
              </details>
            )}
          </div>
          
          {/* По продавцам - wider on desktop */}
          <div className="lg:-mx-4 xl:-mx-8" data-testid="shiftclose-sellers-section">
            <div className="lg:px-4 xl:px-8">
              <div className="bg-neutral-900 rounded-2xl p-3 lg:p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <h2 className="text-xl font-bold text-neutral-100">По продавцам</h2>
                {/* Trip completion warning */}
                {!allTripsFinished && !shiftClosed && (
                  <div className="mt-1 text-sm text-red-400">
                    Есть незавершённые рейсы: {openTripsCount}. Операции заблокированы.
                  </div>
                )}
                <div className="mt-1 text-sm">
                  {debtSummary.count > 0 ? (
                    <span className="text-red-400">● Должны деньги: {debtSummary.count} / {formatRUB(debtSummary.total)}</span>
                  ) : (
                    <span className="text-green-400">● Все продавцы закрыты</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fillAllDrafts}
                  className="px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-800 text-neutral-200 hover:bg-neutral-900"
                >
                  Заполнить всё
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-neutral-400 font-medium">Продавец</th>
                    <th className="text-left py-2 text-neutral-400 font-medium">Статус</th>
                    <th className="text-right py-2 text-neutral-400 font-medium">Долг наличными</th>
                    <th className="text-right py-2 text-neutral-400 font-medium">Долг терминал</th>
                    <th className="text-right py-2 text-neutral-400 font-medium">Итоговая ЗП</th>
                    <th className="text-right py-2 text-neutral-400 font-medium">Итого долг</th>
                    <th className="text-right py-2 text-neutral-400 font-medium">Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Seller source priority: normalized summary, fallback participants, then legacy state.
                    const sellersForRender =
                      normalizedSummary?.sellers ??
                      normalizedSummary?.participants_with_sales ??
                      sellersData ??
                      [];
                    const rowsForRender = payrollRows.length > 0
                      ? payrollRows
                      : sellersForRender.filter((seller) => {
                          const sellerId = Number(seller?.seller_id ?? seller?.id ?? 0);
                          const collectedTotal = Number(
                            seller?.collected_total ??
                            seller?.collectedTotal ??
                            seller?.total_collected ??
                            seller?.totalCollected ??
                            seller?.accepted ??
                            0
                          );
                          const salaryTotal = Number(
                            seller?.salary_due_total ??
                            seller?.salaryDueTotal ??
                            seller?.salary_due ??
                            seller?.salaryDue ??
                            seller?.salary_accrued ??
                            seller?.salaryAccrued ??
                            0
                          );
                          return Number.isFinite(sellerId) && sellerId > 0 && (collectedTotal > 0 || salaryTotal > 0);
                        });
                    if (rowsForRender.length === 0) {
                      return (
                        <tr>
                          <td colSpan={7} className="py-4 text-center text-neutral-500" data-testid="shiftclose-sellers-empty">
                            Нет данных по продавцам за этот день
                          </td>
                        </tr>
                      );
                    }
                    return rowsForRender.map((seller) => {
                      const role = String(seller.role || '').toLowerCase();
                      const accruedSalary = Number(
                        seller.salary_due_total ??
                        seller.salary_due ??
                        seller.salary_accrued ??
                        seller.salary_to_pay ??
                        0
                      );
                      const isDispatcherRow = role === 'dispatcher';

                      // Normalize field names for rendering
                      const s = {
                        id: seller.seller_id ?? seller.id,
                        name: seller.seller_name ?? seller.name,
                        role,
                        accruedSalary,
                        teamPart: Number(seller.team_part ?? seller.teamPart ?? 0),
                        individualPart: Number(seller.individual_part ?? seller.individualPart ?? 0),
                        dispatcherDailyBonus: Number(
                          seller.dispatcher_daily_bonus ??
                          seller.dispatcherDailyBonus ??
                          0
                        ),
                        totalRaw: Number(seller.total_raw ?? seller.totalRaw ?? accruedSalary),
                        salaryRoundingToSeason: Number(
                          seller.salary_rounding_to_season ??
                          seller.salaryRoundingToSeason ??
                          Math.max(0, Number(seller.total_raw ?? seller.totalRaw ?? accruedSalary) - accruedSalary)
                        ),
                        cashRemaining: seller.cash_due_to_owner ?? seller.cashRemaining ?? 0,
                        terminalDebt: seller.terminal_due_to_owner ?? seller.terminal_debt ?? seller.terminalDebt ?? 0,
                        totalDue: seller.net_total ?? seller.balance ?? seller.totalDue ?? 0,
                        cashHanded: seller.deposit_cash ?? seller.cashHanded ?? 0,
                        terminalHanded: seller.deposit_card ?? seller.terminalHanded ?? 0,
                        collectedCash: Number(seller.collected_cash ?? seller.collectedCash ?? 0),
                        collectedCard: Number(seller.collected_card ?? seller.collectedCard ?? 0),
                        collectedTotal: Number(
                          seller.collected_total ??
                          seller.collectedTotal ??
                          seller.total_collected ??
                          seller.totalCollected ??
                          0
                        ),
                        personalRevenueDay: Number(
                          seller.personal_revenue_day ??
                          seller.personalRevenueDay ??
                          seller.collected_total ??
                          seller.collectedTotal ??
                          0
                        ),
                      };
                      const dispatcherSalaryDisplay = Math.max(0, Number(s.accruedSalary || 0));
                      const st = isDispatcherRow ? 'DISPATCHER' : getSellerStatus(s);
                      const stLabel =
                        st === 'DISPATCHER'
                          ? 'Диспетчер'
                          : st === 'CLOSED'
                          ? 'Закрыт'
                          : st === 'PARTIAL'
                          ? 'Частично'
                          : 'Долг';
                      const stClass =
                        st === 'DISPATCHER'
                          ? 'bg-blue-900/40 text-blue-300 border-blue-800'
                          : st === 'CLOSED'
                          ? 'bg-green-900/40 text-green-300 border-green-800'
                          : st === 'PARTIAL'
                          ? 'bg-yellow-900/40 text-yellow-300 border-yellow-800'
                          : 'bg-red-900/40 text-red-300 border-red-800';

                      const cashRem = Number(s.cashRemaining || 0);
                      const termRem = Number(s.terminalDebt || 0);
                      const totalRem = Number(s.totalDue ?? (cashRem + termRem));
                      const canExpand = true;
                      const isOpen = expandedSellerId === s.id;

                      return (
                        <Fragment key={`${s.role || 'seller'}-${s.id}`}>
                          <tr className="border-b hover:bg-neutral-950" data-testid={`shiftclose-seller-row-${s.id}`}>
                            <td className="py-3">{s.name}</td>
                            <td className="py-3">
                              <span data-testid={`shiftclose-seller-status-${s.id}`} className={`inline-flex items-center px-2 py-1 rounded-md border text-xs ${stClass}`}>{stLabel}</span>
                            </td>
                            <td data-testid={`shiftclose-seller-cash-remaining-${s.id}`} className={`text-right py-3 ${isDispatcherRow ? 'text-neutral-500' : cashRem > 0 ? 'text-red-300 font-semibold' : 'text-neutral-200'}`}>
                              {isDispatcherRow ? '-' : formatRUB(cashRem)}
                            </td>
                            <td data-testid={`shiftclose-seller-terminal-debt-${s.id}`} className={`text-right py-3 ${isDispatcherRow ? 'text-neutral-500' : termRem > 0 ? 'text-red-300 font-semibold' : 'text-neutral-200'}`}>
                              {isDispatcherRow ? '-' : formatRUB(termRem)}
                            </td>
                            <td data-testid={`shiftclose-seller-salary-accrued-${s.id}`} className={`text-right py-3 ${
                              isDispatcherRow
                                ? dispatcherSalaryDisplay > 0
                                  ? 'text-orange-300 font-semibold'
                                  : 'text-neutral-200'
                                : s.accruedSalary > 0
                                ? 'text-orange-300 font-semibold'
                                : 'text-neutral-500'
                            }`}>
                              <div>
                                {isDispatcherRow
                                  ? formatRUB(dispatcherSalaryDisplay)
                                  : s.accruedSalary > 0
                                  ? formatRUB(s.accruedSalary)
                                  : '-'}
                              </div>
                            </td>
                            <td data-testid={`shiftclose-seller-total-due-${s.id}`} className={`text-right py-3 ${isDispatcherRow ? 'text-neutral-500' : totalRem > 0 ? 'text-red-300 font-semibold' : 'text-neutral-200'}`}>
                              {isDispatcherRow ? '-' : formatRUB(totalRem)}
                            </td>
                            <td className="py-3 text-right">
                              {canExpand ? (
                                <button
                                  type="button"
                                  onClick={() => setExpandedSellerId((prev) => (prev === s.id ? null : s.id))}
                                  className="inline-flex items-center justify-center w-10 h-9 rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900"
                                  aria-label="Показать детали"
                                  title="Показать детали"
                                >
                                  {isOpen ? '▴' : '▾'}
                                </button>
                              ) : (
                                <span className="text-neutral-500">-</span>
                              )}
                            </td>
                          </tr>

                          {isOpen && canExpand && (
                            <tr className="border-b">
                              <td colSpan={7} className="py-3">
                                <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-3">
                                  <div className="text-sm text-neutral-300 font-semibold mb-3">
                                    {isDispatcherRow ? `${s.name} - детали диспетчера` : `${s.name} - детали`}
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {isDispatcherRow ? (
                                      <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-3">
                                        <div className="text-sm text-neutral-200 font-semibold mb-2">Операционные показатели</div>

                                        <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl border border-neutral-800 bg-neutral-950/70 p-3 text-center">
                                          <div>
                                            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Наличные</div>
                                            <div className="mt-1 font-semibold text-green-300">{formatRUBExact(s.collectedCash)}</div>
                                          </div>
                                          <div>
                                            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Терминал</div>
                                            <div className="mt-1 font-semibold text-blue-300">{formatRUBExact(s.collectedCard)}</div>
                                          </div>
                                          <div>
                                            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Итого</div>
                                            <div className="mt-1 font-semibold text-emerald-300">{formatRUBExact(s.collectedTotal)}</div>
                                          </div>
                                        </div>

                                        <div className="flex items-center justify-between gap-3 py-2 border-b border-neutral-800">
                                          <span className="text-neutral-500">Seller debt</span>
                                          <span className="font-semibold text-neutral-200">Не применяется к диспетчеру</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-3 py-2">
                                          <span className="text-neutral-500">Личная выручка за день</span>
                                          <span className="font-semibold text-neutral-200">{formatRUBExact(s.personalRevenueDay)}</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-3">
                                        <div className="text-sm text-neutral-200 font-semibold mb-2">Движение денег</div>

                                        <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl border border-neutral-800 bg-neutral-950/70 p-3 text-center">
                                          <div>
                                            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Долг нал</div>
                                            <div className={`mt-1 font-semibold ${cashRem > 0 ? 'text-red-300' : 'text-neutral-200'}`}>{formatRUB(cashRem)}</div>
                                          </div>
                                          <div>
                                            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Долг терм</div>
                                            <div className={`mt-1 font-semibold ${termRem > 0 ? 'text-red-300' : 'text-neutral-200'}`}>{formatRUB(termRem)}</div>
                                          </div>
                                          <div>
                                            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Итого долг</div>
                                            <div className={`mt-1 font-semibold ${totalRem > 0 ? 'text-red-300' : 'text-neutral-200'}`}>{formatRUB(totalRem)}</div>
                                          </div>
                                        </div>

                                        <div className="flex items-center justify-between gap-3 py-2 border-b border-neutral-800">
                                          <div>
                                            <div className="text-neutral-400 text-xs">Остаток нал</div>
                                            <div className={`font-semibold ${cashRem > 0 ? 'text-red-300' : 'text-neutral-200'}`}>{formatRUB(cashRem)}</div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="number"
                                              min="0"
                                              step="1"
                                              inputMode="numeric"
                                              placeholder={cashRem > 0 ? String(cashRem) : ''}
                                              value={depositDrafts?.[s.id]?.cash ?? ''}
                                              onChange={(e) => {
                                                const raw = e.target.value;
                                                if (raw === '') {
                                                  setDraftValue(s.id, 'cash', '');
                                                } else {
                                                  const n = Math.max(0, Math.floor(Number(raw) || 0));
                                                  setDraftValue(s.id, 'cash', String(n));
                                                }
                                              }}
                                              className="w-28 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-2 text-neutral-100 no-spin"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => applyCashDeposit(s.id)}
                                              disabled={shiftClosed || !allTripsFinished || (cashRem <= 0 && Number(depositDrafts?.[s.id]?.cash || 0) <= 0)}
                                              className={`px-3 py-2 rounded-lg border ${
                                                !shiftClosed && allTripsFinished && (cashRem > 0 || Number(depositDrafts?.[s.id]?.cash || 0) > 0)
                                                  ? 'bg-neutral-900 border-neutral-700 text-neutral-100 hover:bg-neutral-800'
                                                  : 'bg-neutral-950 border-neutral-800 text-neutral-600 cursor-not-allowed'
                                              }`}
                                            >
                                              Сдать нал
                                            </button>
                                          </div>
                                        </div>

                                        <div className="flex items-center justify-between gap-3 py-2">
                                          <div>
                                            <div className="text-neutral-400 text-xs">Долг терминал</div>
                                            <div className={`font-semibold ${termRem > 0 ? 'text-red-300' : 'text-neutral-200'}`}>{formatRUB(termRem)}</div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="number"
                                              min="0"
                                              step="1"
                                              inputMode="numeric"
                                              placeholder={termRem > 0 ? String(termRem) : ''}
                                              value={depositDrafts?.[s.id]?.terminal ?? ''}
                                              onChange={(e) => {
                                                const raw = e.target.value;
                                                if (raw === '') {
                                                  setDraftValue(s.id, 'terminal', '');
                                                } else {
                                                  const n = Math.max(0, Math.floor(Number(raw) || 0));
                                                  setDraftValue(s.id, 'terminal', String(n));
                                                }
                                              }}
                                              className="w-28 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-2 text-neutral-100 no-spin"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => applyTerminalClose(s.id)}
                                              disabled={shiftClosed || !allTripsFinished || (termRem <= 0 && Number(depositDrafts?.[s.id]?.terminal || 0) <= 0)}
                                              className={`px-3 py-2 rounded-lg border ${
                                                !shiftClosed && allTripsFinished && (termRem > 0 || Number(depositDrafts?.[s.id]?.terminal || 0) > 0)
                                                  ? 'bg-neutral-900 border-neutral-700 text-neutral-100 hover:bg-neutral-800'
                                                  : 'bg-neutral-950 border-neutral-800 text-neutral-600 cursor-not-allowed'
                                              }`}
                                            >
                                              Закрыть терминал
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Salary payout */}
                                    <div className="bg-orange-950/20 border border-orange-900/30 rounded-xl p-3">
                                      <div className="text-sm text-neutral-200 font-semibold mb-1">
                                        {isDispatcherRow ? 'Начисление диспетчера' : 'Зарплата'}
                                      </div>
                                      <div className="text-xs text-neutral-500 mb-2">Выплата фиксируется в ledger</div>
                                      
                                      <div className="mb-2 pb-2 border-b border-neutral-800">
                                        <div className="text-xs text-neutral-400">Итоговая ЗП:</div>
                                        {dispatcherSalaryDisplay > 0 ? (
                                          <div className="text-sm font-semibold text-orange-300">{formatRUB(dispatcherSalaryDisplay)}</div>
                                        ) : (
                                          <div className="text-sm text-neutral-500">-</div>
                                        )}
                                      </div>
                                      
                                      <div className="mb-2 pb-2 border-b border-neutral-800">
                                        <div className="text-xs text-neutral-400">Структура начисления:</div>
                                        <div className="mt-2 space-y-1 text-sm">
                                          <div className="flex items-center justify-between gap-3">
                                            <span className="text-neutral-500">Командная часть</span>
                                            <span data-testid={`shiftclose-seller-team-part-${s.id}`} className={s.teamPart > 0 ? 'font-semibold text-sky-300' : 'text-neutral-500'}>
                                              {s.teamPart > 0 ? formatRUBExact(s.teamPart) : '-'}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between gap-3">
                                            <span className="text-neutral-500">Индивидуальная часть</span>
                                            <span data-testid={`shiftclose-seller-individual-part-${s.id}`} className={s.individualPart > 0 ? 'font-semibold text-violet-300' : 'text-neutral-500'}>
                                              {s.individualPart > 0 ? formatRUBExact(s.individualPart) : '-'}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between gap-3">
                                            <span className="text-neutral-500">Raw до округления</span>
                                            <span className={s.totalRaw > 0 ? 'font-semibold text-orange-200' : 'text-neutral-500'}>
                                              {s.totalRaw > 0 ? formatRUBExact(s.totalRaw) : '-'}
                                            </span>
                                          </div>
                                          {s.dispatcherDailyBonus > 0 ? (
                                            <div className="flex items-center justify-between gap-3">
                                              <span className="text-neutral-500">Бонус диспетчерам</span>
                                              <span
                                                data-testid={`shiftclose-seller-dispatcher-bonus-${s.id}`}
                                                className="font-semibold text-sky-300"
                                              >
                                                {formatRUBExact(s.dispatcherDailyBonus)}
                                              </span>
                                            </div>
                                          ) : null}
                                          {s.salaryRoundingToSeason > 0 ? (
                                            <div className="flex items-center justify-between gap-3">
                                              <span className="text-neutral-500">Сезонные удержания (округление)</span>
                                              <span className="font-semibold text-amber-300">{formatRUBExact(s.salaryRoundingToSeason)}</span>
                                            </div>
                                          ) : null}
                                          <div className="flex items-center justify-between gap-3">
                                            <span className="text-neutral-500">Итоговая ЗП</span>
                                            <span className={dispatcherSalaryDisplay > 0 ? 'font-semibold text-orange-300' : 'text-neutral-500'}>
                                              {dispatcherSalaryDisplay > 0 ? formatRUB(dispatcherSalaryDisplay) : '-'}
                                            </span>
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2">
                                        <input
                                          type="number"
                                          min="0"
                                          step="1"
                                          inputMode="numeric"
                                          placeholder={dispatcherSalaryDisplay > 0 ? String(Math.floor(dispatcherSalaryDisplay)) : 'Сумма'}
                                          value={salaryDraftBySellerId?.[s.id] ?? ''}
                                          onChange={(e) => {
                                            const raw = e.target.value;
                                            if (raw === '') {
                                              setSalaryDraftBySellerId((prev) => ({ ...prev, [s.id]: '' }));
                                            } else {
                                              const n = Math.max(0, Math.floor(Number(raw) || 0));
                                              setSalaryDraftBySellerId((prev) => ({ ...prev, [s.id]: String(n) }));
                                            }
                                          }}
                                          className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-2 text-neutral-100 no-spin"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => applySalaryPayoutForSeller(s.id)}
                                          disabled={shiftClosed || !allTripsFinished || Number(salaryDraftBySellerId?.[s.id] || 0) <= 0}
                                          className={`px-3 py-2 rounded-lg border whitespace-nowrap ${
                                            !shiftClosed && allTripsFinished && Number(salaryDraftBySellerId?.[s.id] || 0) > 0
                                              ? 'bg-orange-700 border-orange-600 text-white hover:bg-orange-600'
                                              : 'bg-neutral-950 border-neutral-800 text-neutral-600 cursor-not-allowed'
                                          }`}
                                        >
                                          Выдать ЗП
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
            
              </div>
            </div>
          </div>
          
          {shiftClosed ? (
            <div className="bg-green-950/30 border border-green-900/50 rounded-2xl p-3 mt-6">
              <h3 className="text-lg font-semibold text-green-300 mb-3">Статус смены</h3>
              <p className="text-green-400 font-medium">Смена закрыта</p>
            </div>
          ) : (
            <>
              {/* Confirmation Checks */}
              <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4 mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-neutral-200">Подтверждение закрытия смены</h3>
                  <span className="text-sm text-neutral-400">
                    Подтверждено: {[confirmationChecks.cashHandedOver, confirmationChecks.salaryCalculated, confirmationChecks.noComplaints].filter(Boolean).length}/3
                  </span>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={confirmationChecks.cashHandedOver}
                      onChange={() => handleCheckboxChange('cashHandedOver')}
                      disabled={shiftClosed}
                      className="h-5 w-5 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="text-neutral-300">Все продавцы сдали наличные</span>
                  </label>
                  <label className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={confirmationChecks.salaryCalculated}
                      onChange={() => handleCheckboxChange('salaryCalculated')}
                      disabled={shiftClosed}
                      className="h-5 w-5 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="text-neutral-300">ЗП продавцам рассчитана корректно</span>
                  </label>
                  <label className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={confirmationChecks.noComplaints}
                      onChange={() => handleCheckboxChange('noComplaints')}
                      disabled={shiftClosed}
                      className="h-5 w-5 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="text-neutral-300">Претензий по рейсам и билетам нет</span>
                  </label>
                </div>
              </div>
              
              {/* Action Buttons */}
              {closeBlockReason ? (
                <div className="text-sm text-red-400 text-center mt-3">Нельзя закрыть смену: {closeBlockReason}</div>
              ) : null}

              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <button
                  onClick={handleShiftClose}
                  disabled={!canCloseShift}
                  title={closeBlockReason || ''}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${canCloseShift ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
                >
                  Закрыть смену
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DispatcherShiftClose;


