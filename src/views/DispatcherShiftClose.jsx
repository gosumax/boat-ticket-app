import { useState, useEffect, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../utils/apiClient';
import { formatRUB } from '../utils/currency';
import normalizeSummary from '../utils/normalizeSummary';

const COMMISSION_PERCENT = 13; // Temporary commission rate

// Backend сдачи денег: пытаемся использовать реальный endpoint.
// Если endpoint недоступен — UI продолжит работать в локальном (мок) режиме.
const BACKEND_DEPOSIT_ENABLED_DEFAULT = true;

function toLocalBusinessDay(d = new Date()) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DispatcherShiftClose = ({ setShiftClosed: setGlobalShiftClosed }) => {
  const navigate = useNavigate();
  const { logout: authLogout } = useAuth();
  
  // Mock data for shift closing
  const [dailySummary, setDailySummary] = useState(null);
  const [sellersData, setSellersData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Флаг доступности backend-эндпоинтов сдачи.
  const [backendDepositEnabled, setBackendDepositEnabled] = useState(BACKEND_DEPOSIT_ENABLED_DEFAULT);

  // Черновики сумм сдачи (локально, пока backend не подключён)
  // drafts[sellerId] = { cash: string|number, terminal: string|number }
  const [depositDrafts, setDepositDrafts] = useState({});

  // Раскрытие продавца (accordion)
  const [expandedSellerId, setExpandedSellerId] = useState(null);

  // Salary values from backend
  const [salaryDue, setSalaryDue] = useState(0);
  const [salaryPaidCash, setSalaryPaidCash] = useState(0);
  const [salaryPaidCard, setSalaryPaidCard] = useState(0);
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
  const [dispatcherData, setDispatcherData] = useState(null);

  // State for trip completion status (gate for operations)
  const [allTripsFinished, setAllTripsFinished] = useState(true);
  const [openTripsCount, setOpenTripsCount] = useState(0);

  // Explain section (human-readable breakdown)
  const [explainData, setExplainData] = useState(null);

  // Function to generate mock data
  const generateMockData = () => {
    // Mock daily summary
    const mockSummary = {
      totalRevenue: 125000,
      cashRevenue: 75000,
      cardRevenue: 50000,
      unassigned: 0,
      commissionPaid: 16250 // 13% of total revenue
    };
    
    // Mock sellers data
    // Поля под закрытие смены:
    //  - cashRemaining: сколько налички/предоплат осталось у продавца (надо сдать)
    //  - terminalDebt: сколько "долг по терминалу" осталось у продавца (надо закрыть)
    const mockSellers = [
      { id: 1, name: 'Иванова А.', totalSales: 35000, cashSales: 20000, cardSales: 15000, cashHanded: 15000, terminalHanded: 0, cashRemaining: 5000, terminalDebt: 15000 },
      { id: 2, name: 'Петров Б.', totalSales: 28000, cashSales: 18000, cardSales: 10000, cashHanded: 12000, terminalHanded: 0, cashRemaining: 6000, terminalDebt: 10000 },
      { id: 3, name: 'Сидорова В.', totalSales: 42000, cashSales: 25000, cardSales: 17000, cashHanded: 15000, terminalHanded: 0, cashRemaining: 10000, terminalDebt: 17000 },
      { id: 4, name: 'Козлов Г.', totalSales: 20000, cashSales: 12000, cardSales: 8000, cashHanded: 0, terminalHanded: 0, cashRemaining: 12000, terminalDebt: 8000 },
    ];
    
    setDailySummary(mockSummary);
    setSellersData(mockSellers);
    // Инициализация черновиков (по умолчанию пусто)
    const draftsInit = {};
    const salaryDueInit = {};
    const salaryPaidInit = {};
    for (const s of mockSellers) {
      draftsInit[s.id] = { cash: '', terminal: '' };
      salaryDueInit[s.id] = '';
      salaryPaidInit[s.id] = 0;
    }
    setDepositDrafts(draftsInit);
    setSalaryDueDrafts(salaryDueInit);
    setSalaryPaid(salaryPaidInit);
    setLoading(false);
  };

  const loadSummaryFromBackend = async (businessDay) => {
    const day = businessDay || toLocalBusinessDay();
    const data = await apiClient.request(`/dispatcher/shift-ledger/summary?business_day=${encodeURIComponent(day)}`);

    // Normalize the response (handles both snake_case and camelCase)
    const normalized = normalizeSummary(data);
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
    setDispatcherData(normalized.dispatcher);

    // Trip status
    setAllTripsFinished(closed ? true : normalized.all_trips_finished);
    setOpenTripsCount(closed ? 0 : normalized.open_trips_count);

    // Explain section (human-readable breakdown)
    setExplainData(normalized.explain || null);

    // Salary values
    setSalaryDue(normalized.salary_due_total);
    setSalaryPaidCash(normalized.salary_paid_cash);
    setSalaryPaidCard(normalized.salary_paid_card);
    setSalaryPaidTotal(normalized.salary_paid_total);

    // Init drafts
    const draftsInit = {};
    for (const s of sellers) {
      draftsInit[s.id] = { cash: '', terminal: '' };
    }

    setDailySummary(summary);
    setSellersData(sellers);
    setDepositDrafts(draftsInit);
    setLoading(false);
  };
  
  // Helper: handle API error, check for SHIFT_CLOSED, reload summary
  const handleApiError = async (error, operation) => {
    const errData = error?.body || error?.data || {};
    if (errData?.code === 'SHIFT_CLOSED' || error?.status === 409) {
      // Shift was closed - reload summary to update UI
      const businessDay = normalizedSummary?.business_day || dailySummary?.businessDay || toLocalBusinessDay();
      await loadSummaryFromBackend(businessDay);
      return { handled: true, shiftClosed: true };
    }
    console.error(`[${operation}] Error:`, error);
    return { handled: false };
  };

  useEffect(() => {
    (async () => {
      try {
        await loadSummaryFromBackend(toLocalBusinessDay());
        setBackendDepositEnabled(true);
      } catch (e) {
        // backend not ready yet — keep UI usable
        setBackendDepositEnabled(false);
        generateMockData();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debtSummary = useMemo(() => {
    const sellers = normalizedSummary?.sellers ?? sellersData ?? [];
    const debtSellers = sellers.filter(
      (s) => Number(s.cash_due_to_owner ?? (s.cashRemaining || 0)) > 0 || Number(s.terminal_due_to_owner ?? s.terminal_debt ?? (s.terminalDebt || 0)) > 0
    );
    const totalDebt = debtSellers.reduce(
      (acc, s) => acc + Number(s.cash_due_to_owner ?? (s.cashRemaining || 0)) + Number(s.terminal_due_to_owner ?? s.terminal_debt ?? (s.terminalDebt || 0)),
      0
    );
    return { count: debtSellers.length, total: totalDebt };
  }, [normalizedSummary, sellersData]);

  const getSellerStatus = (s) => {
    const cashRem = Number(s.cashRemaining || 0);
    const termRem = Number(s.terminalDebt || 0);
    if (cashRem <= 0 && termRem <= 0) return 'CLOSED';
    // Частично: если уже что-то сдавал (cashHanded/terminalHanded) или один из остатков = 0
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
      const cashDue = Math.max(0, Math.floor(Number(s.cash_due_to_owner ?? (s.cashRemaining || 0))));
      const termDue = Math.max(0, Math.floor(Number(s.terminal_due_to_owner ?? s.terminal_debt ?? (s.terminalDebt || 0))));
      const sellerId = s.seller_id ?? s.id;
      const prev = next[sellerId] || { cash: '', terminal: '' };
      next[sellerId] = {
        // Заполнять только если: due > 0 И поле пустое
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
  
  // Cash in cashbox calculation - use server truth if available, else fallback to local calculation
  const cashInCashbox = useMemo(() => {
    // Server truth (from cashbox_json in snapshot or close response)
    if (normalizedSummary?.cashbox?.cash_in_cashbox !== null && normalizedSummary?.cashbox?.cash_in_cashbox !== undefined) {
      return normalizedSummary.cashbox.cash_in_cashbox;
    }
    // Fallback: local calculation
    const netCash = normalizedSummary?.net_cash ?? dailySummary?.netCash ?? 0;
    const depositCash = normalizedSummary?.deposit_cash ?? dailySummary?.depositCash ?? 0;
    const salaryPaidCashValue = normalizedSummary?.dispatcher?.salary_paid_cash ?? dispatcherData?.salary_paid_cash ?? salaryPaidCash ?? 0;
    return netCash - depositCash - salaryPaidCashValue;
  }, [normalizedSummary, dailySummary, salaryPaidCash, dispatcherData]);
  
  // Expected sellers cash due - use server truth if available
  const expectedSellersCashDue = useMemo(() => {
    // Server truth
    if (normalizedSummary?.cashbox?.expected_sellers_cash_due !== null && normalizedSummary?.cashbox?.expected_sellers_cash_due !== undefined) {
      return normalizedSummary.cashbox.expected_sellers_cash_due;
    }
    // Fallback: sum of positive cash_due_to_owner
    const sellers = normalizedSummary?.sellers ?? sellersData ?? [];
    return sellers.reduce((sum, s) => {
      const due = s.cash_due_to_owner ?? s.cashRemaining ?? 0;
      return sum + Math.max(0, Number(due));
    }, 0);
  }, [normalizedSummary, sellersData]);

  // Cash discrepancy - use server truth if available
  const cashDiscrepancy = useMemo(() => {
    // Server truth
    if (normalizedSummary?.cashbox?.cash_discrepancy !== null && normalizedSummary?.cashbox?.cash_discrepancy !== undefined) {
      return normalizedSummary.cashbox.cash_discrepancy;
    }
    // Fallback: calculate locally
    return cashInCashbox - expectedSellersCashDue;
  }, [normalizedSummary, cashInCashbox, expectedSellersCashDue]);

  // Warnings from server (CASH_DISCREPANCY)
  const cashboxWarnings = useMemo(() => {
    return normalizedSummary?.cashbox?.warnings ?? normalizedSummary?.warnings ?? [];
  }, [normalizedSummary]);

  const applySalaryPayoutForSeller = async (sellerId) => {
    const raw = salaryDraftBySellerId?.[sellerId];
    const amount = Math.max(0, Number(raw || 0));
    if (!amount) return;

    if (!backendDepositEnabled) {
      // Fallback: local update only
      setSalaryPaidTotal((prev) => prev + amount);
      setSalaryDraftBySellerId((prev) => ({ ...prev, [sellerId]: '' }));
      return;
    }

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
      await loadSummaryFromBackend(business_day);
      setSalaryDraftBySellerId((prev) => ({ ...prev, [sellerId]: '' }));
    } catch (e) {
      const result = await handleApiError(e, 'SALARY_PAYOUT');
      if (result.handled) return;
      // Fallback: backend not available
      setBackendDepositEnabled(false);
      setSalaryPaidTotal((prev) => prev + amount);
      setSalaryDraftBySellerId((prev) => ({ ...prev, [sellerId]: '' }));
    }
  };

  const applyCashDeposit = async (sellerId) => {
    const s = (sellersData || []).find((x) => x.id === sellerId);
    if (!s) return;
    const raw = depositDrafts?.[sellerId]?.cash;
    const amount = Math.max(0, Number(raw || 0));
    if (!amount) return;

    if (!backendDepositEnabled) {
      // Пока backend не подключён — имитируем проведение локально, чтобы диспетчер понимал итог.
      setSellersData((prev) =>
        prev.map((x) => {
          if (x.id !== sellerId) return x;
          const newRem = Math.max(0, Number(x.cashRemaining || 0) - amount);
          return {
            ...x,
            cashHanded: Number(x.cashHanded || 0) + amount,
            cashRemaining: newRem,
          };
        })
      );
      setDraftValue(sellerId, 'cash', '');
      return;
    }

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
      await loadSummaryFromBackend(business_day);
      setDraftValue(sellerId, 'cash', '');
    } catch (e) {
      const result = await handleApiError(e, 'CASH_DEPOSIT');
      if (result.handled) return;
      // Фоллбек: backend не готов/недоступен
      setBackendDepositEnabled(false);
      setSellersData((prev) =>
        prev.map((x) => {
          if (x.id !== sellerId) return x;
          const newRem = Math.max(0, Number(x.cashRemaining || 0) - amount);
          return {
            ...x,
            cashHanded: Number(x.cashHanded || 0) + amount,
            cashRemaining: newRem,
          };
        })
      );
      setDraftValue(sellerId, 'cash', '');
    }
  };

  const applyTerminalClose = async (sellerId) => {
    const s = (sellersData || []).find((x) => x.id === sellerId);
    if (!s) return;
    const raw = depositDrafts?.[sellerId]?.terminal;
    const amount = Math.max(0, Number(raw || 0));
    if (!amount) return;

    if (!backendDepositEnabled) {
      setSellersData((prev) =>
        prev.map((x) => {
          if (x.id !== sellerId) return x;
          const newRem = Math.max(0, Number(x.terminalDebt || 0) - amount);
          return {
            ...x,
            terminalHanded: Number(x.terminalHanded || 0) + amount,
            terminalDebt: newRem,
          };
        })
      );
      setDraftValue(sellerId, 'terminal', '');
      return;
    }

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
      await loadSummaryFromBackend(business_day);
      setDraftValue(sellerId, 'terminal', '');
    } catch (e) {
      const result = await handleApiError(e, 'TERMINAL_CLOSE');
      if (result.handled) return;
      setBackendDepositEnabled(false);
      setSellersData((prev) =>
        prev.map((x) => {
          if (x.id !== sellerId) return x;
          const newRem = Math.max(0, Number(x.terminalDebt || 0) - amount);
          return {
            ...x,
            terminalHanded: Number(x.terminalHanded || 0) + amount,
            terminalDebt: newRem,
          };
        })
      );
      setDraftValue(sellerId, 'terminal', '');
    }
  };

  const handleShiftClose = () => {
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
    if (window.confirm('Вы уверены, что хотите закрыть смену?')) {
      setShiftClosed(true);
      localStorage.setItem('dispatcher_shiftClosed', 'true');
      if (setGlobalShiftClosed) setGlobalShiftClosed(true);
      alert('Смена закрыта');
    }
  };

  const handleCheckboxChange = (checkboxName) => {
    setConfirmationChecks(prev => ({
      ...prev,
      [checkboxName]: !prev[checkboxName]
    }));
  };

  const allChecked = Object.values(confirmationChecks).every(value => value);

  // Guard: нельзя закрыть смену, если есть несданная наличка/долги или невыплаченная ЗП или незавершённые рейсы
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


  const logout = () => {
    authLogout();
    navigate('/login', { replace: true });
  };

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
                {shiftClosed ? (
                  <span className="px-2 py-1 bg-green-900/50 text-green-300 rounded-lg text-sm">
                    ✓ Закрыта ({shiftSource === 'snapshot' ? 'snapshot' : 'live'})
                  </span>
                ) : (
                  <span className="px-2 py-1 bg-yellow-900/50 text-yellow-300 rounded-lg text-sm">
                    ○ Открыта ({shiftSource})
                  </span>
                )}
              </div>
            </div>
            
            {/* Closed shift message */}
            {shiftClosed && closedAt && (
              <div className="mb-3 p-2 bg-green-950/50 border border-green-900/50 rounded-lg text-sm text-green-300 text-center">
                Смена закрыта в {closedAt}. Операции запрещены.
              </div>
            )}
            
            {/* КАССА ЗА СМЕНУ - компактный блок */}
            <div className="bg-neutral-950/50 border border-neutral-800 p-4 rounded-lg">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-neutral-400 text-sm">Наличные получено</div>
                  <div className="text-2xl font-bold text-green-400">{formatRUB(dailySummary.cashRevenue)}</div>
                </div>
                <div>
                  <div className="text-neutral-400 text-sm">Терминал получено</div>
                  <div className="text-2xl font-bold text-blue-400">{formatRUB(dailySummary.cardRevenue)}</div>
                </div>
                <div>
                  <div className="text-neutral-400 text-sm">Итого получено</div>
                  <div className="text-2xl font-bold text-emerald-400">{formatRUB(dailySummary.cashRevenue + dailySummary.cardRevenue)}</div>
                </div>
              </div>
              
              {/* Предоплаты будущих рейсов */}
              {explainData && (explainData.liabilities?.prepayment_future_cash > 0 || explainData.liabilities?.prepayment_future_terminal > 0) && (
                <div className="mt-3 pt-3 border-t border-neutral-800 text-xs text-neutral-500 text-center">
                  <span 
                    className="cursor-help text-neutral-500 hover:text-neutral-300" 
                    title="Это деньги, полученные сегодня за рейсы в будущие дни. Это не 'заработано', это обязательство: при отмене делается возврат предоплаты."
                  >?</span>
                  {' '}Предоплаты будущих рейсов: {formatRUB((explainData.liabilities?.prepayment_future_cash || 0) + (explainData.liabilities?.prepayment_future_terminal || 0))}
                </div>
              )}
            </div>

            {/* ОПЕРАЦИИ НА ЗАКРЫТИЕ */}
            <div className="mt-3 bg-neutral-950/30 border border-neutral-800 p-3 rounded-lg">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                {/* Собрать с продавцов */}
                <div className="flex items-center justify-between py-2 px-3 bg-neutral-900 rounded-lg">
                  <span className="text-neutral-400">Собрать с продавцов:</span>
                  <span className={`text-lg font-bold ${debtSummary.total > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {formatRUB(debtSummary.total)}
                  </span>
                </div>
                
                {/* К выдаче зарплат */}
                <div className="flex items-center justify-between py-2 px-3 bg-neutral-900 rounded-lg">
                  <span className="text-neutral-400">К выдаче зарплат:</span>
                  <span className="text-lg font-bold text-blue-400">
                    {formatRUB(salaryPaidTotal > 0 ? salaryPaidTotal : dailySummary.commissionPaid || 0)}
                  </span>
                </div>
                
                {/* К сдаче owner'у */}
                <div className="flex items-center justify-between py-2 px-3 bg-neutral-900 rounded-lg">
                  <span className="text-neutral-400">К сдаче owner'у:</span>
                  <span className="text-lg font-bold text-purple-400">
                    {formatRUB(dailySummary.netTotal)}
                  </span>
                </div>
              </div>
            </div>

            {/* Refunds if any */}
            {dailySummary.refundTotal > 0 && (
              <div className="mt-3 bg-red-950/30 border border-red-900/50 p-3 rounded-lg text-center">
                <div className="text-neutral-400 text-sm">Возвраты</div>
                <div className="text-xl font-bold text-red-400">{formatRUB(dailySummary.refundTotal)}</div>
                <div className="mt-1 text-xs text-neutral-500">Нал: {formatRUB(dailySummary.refundCash)} | Терминал: {formatRUB(dailySummary.refundCard)}</div>
              </div>
            )}
          
          {/* Cash discrepancy warning (from server) - KEEP */}
          {(cashDiscrepancy !== 0 || cashboxWarnings.length > 0) && (
            <div className={`mt-3 p-3 rounded-lg border text-center ${
              cashDiscrepancy > 0 
                ? 'bg-yellow-950/30 border-yellow-900/50' 
                : 'bg-red-950/30 border-red-900/50'
            }`}>
              <div className={`text-lg font-bold mb-1 ${cashDiscrepancy > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                ⚠ ВНИМАНИЕ: Расхождение кассы
              </div>
              <div className="text-sm text-neutral-300">
                {cashDiscrepancy > 0 
                  ? `В кассе больше наличных на ${formatRUB(Math.abs(cashDiscrepancy))}, чем ожидалось от продавцов`
                  : `В кассе меньше наличных на ${formatRUB(Math.abs(cashDiscrepancy))}, чем ожидалось от продавцов`
                }
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                Закрытие смены разрешено, но проверь кассу перед закрытием.
              </div>
            </div>
          )}
          </div>
          
          {/* По продавцам - wider on desktop */}
          <div className="lg:-mx-4 xl:-mx-8">
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
                    <th className="text-right py-2 text-neutral-400 font-medium">Остаток нал</th>
                    <th className="text-right py-2 text-neutral-400 font-medium">Долг терминал</th>
                    <th className="text-right py-2 text-neutral-400 font-medium">Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Источник продавцов: normalizedSummary.sellers (нормализованные) -> sellersData (legacy state) -> пусто
                    const sellersForRender = normalizedSummary?.sellers ?? sellersData ?? [];
                    if (sellersForRender.length === 0) {
                      return (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-neutral-500">
                            Нет данных по продавцам за этот день
                          </td>
                        </tr>
                      );
                    }
                    return sellersForRender.map((seller) => {
                      // Normalize field names for rendering
                      const s = {
                        id: seller.seller_id ?? seller.id,
                        name: seller.seller_name ?? seller.name,
                        cashRemaining: seller.cash_due_to_owner ?? seller.cashRemaining ?? 0,
                        terminalDebt: seller.terminal_due_to_owner ?? seller.terminal_debt ?? seller.terminalDebt ?? 0,
                        cashHanded: seller.deposit_cash ?? seller.cashHanded ?? 0,
                        terminalHanded: seller.deposit_card ?? seller.terminalHanded ?? 0,
                      };
                      const st = getSellerStatus(s);
                      const stLabel = st === 'CLOSED' ? 'Закрыт' : st === 'PARTIAL' ? 'Частично' : 'Долг';
                      const stClass =
                        st === 'CLOSED'
                          ? 'bg-green-900/40 text-green-300 border-green-800'
                          : st === 'PARTIAL'
                          ? 'bg-yellow-900/40 text-yellow-300 border-yellow-800'
                          : 'bg-red-900/40 text-red-300 border-red-800';

                      const cashRem = Number(s.cashRemaining || 0);
                      const termRem = Number(s.terminalDebt || 0);

                      const isOpen = expandedSellerId === s.id;

                      return (
                        <Fragment key={s.id}>
                          <tr className="border-b hover:bg-neutral-950">
                            <td className="py-3">{s.name}</td>
                            <td className="py-3">
                              <span className={`inline-flex items-center px-2 py-1 rounded-md border text-xs ${stClass}`}>{stLabel}</span>
                            </td>
                            <td className={`text-right py-3 ${cashRem > 0 ? 'text-red-300 font-semibold' : 'text-neutral-200'}`}>{formatRUB(cashRem)}</td>
                            <td className={`text-right py-3 ${termRem > 0 ? 'text-red-300 font-semibold' : 'text-neutral-200'}`}>{formatRUB(termRem)}</td>
                            <td className="py-3 text-right">
                              <button
                                type="button"
                                onClick={() => setExpandedSellerId((prev) => (prev === s.id ? null : s.id))}
                                className="inline-flex items-center justify-center w-10 h-9 rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-200 hover:bg-neutral-900"
                                aria-label="Показать детали"
                                title="Показать детали"
                              >
                                {isOpen ? '▴' : '▾'}
                              </button>
                            </td>
                          </tr>

                          {isOpen && (
                            <tr className="border-b">
                              <td colSpan={5} className="py-3">
                                <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-3">
                                  <div className="text-sm text-neutral-300 font-semibold mb-3">{s.name} — детали</div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {/* Money movement */}
                                    <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-3">
                                      <div className="text-sm text-neutral-200 font-semibold mb-2">Движение денег</div>

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
                                    
                                    {/* Salary payout */}
                                    <div className="bg-orange-950/20 border border-orange-900/30 rounded-xl p-3">
                                      <div className="text-sm text-neutral-200 font-semibold mb-1">Зарплата</div>
                                      <div className="text-xs text-neutral-500 mb-2">Выплата фиксируется в ledger</div>
                                      
                                      {/* Начислено - only show real per-seller data, no fake calculations */}
                                      <div className="mb-2 pb-2 border-b border-neutral-800">
                                        <div className="text-xs text-neutral-400">Начислено сегодня:</div>
                                        {(() => {
                                          const sellerNorm = normalizedSummary?.sellers?.find(x => (x.seller_id ?? x.id) === s.id);
                                          const accrued = sellerNorm?.salary_due_total ?? sellerNorm?.salary_due ?? sellerNorm?.salary_accrued ?? sellerNorm?.salary_to_pay ?? null;
                                          return accrued != null ? (
                                            <div className="text-sm font-semibold text-orange-300">{formatRUB(accrued)}</div>
                                          ) : (
                                            <div className="text-sm text-neutral-500">—</div>
                                          );
                                        })()}
                                      </div>
                                      
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="number"
                                          min="0"
                                          step="1"
                                          inputMode="numeric"
                                          placeholder="Сумма"
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
            
            <div className="mt-4 text-sm text-gray-500 italic">
              Предварительный расчёт по {COMMISSION_PERCENT}% (позже заменим мотивацией)
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