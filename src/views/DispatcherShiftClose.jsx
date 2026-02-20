import { useState, useEffect, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../utils/apiClient';
import { formatRUB } from '../utils/currency';

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
  // Input for salary payout amount
  const [salaryPayoutDraft, setSalaryPayoutDraft] = useState('');
  
  // State for confirmation checkboxes
  const [confirmationChecks, setConfirmationChecks] = useState({
    cashHandedOver: false,
    salaryCalculated: false,
    noComplaints: false
  });
  
  // State to track if shift is closed
  const [shiftClosed, setShiftClosed] = useState(false);

  // State for trip completion status (gate for operations)
  const [allTripsFinished, setAllTripsFinished] = useState(true);
  const [openTripsCount, setOpenTripsCount] = useState(0);

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

    // Backend contract (aligned with Owner → Money):
    //  total_revenue: revenue from canonical (trip_date semantics)
    //  collected_cash/card: from money_ledger (payment date semantics) - SAME AS OWNER
    //  net_cash/card: collected - refunds
    //  sellers[]: per-seller balances
    //
    // IMPORTANT: No local recalculation. All values come directly from backend.
    const totalRevenue = Number(data?.total_revenue ?? data?.revenue ?? data?.sales?.revenue ?? 0);

    // Collected money (from money_ledger - authoritative source, same as Owner)
    const collectedCash = Number(data?.collected_cash ?? data?.collected?.cash ?? 0);
    const collectedCard = Number(data?.collected_card ?? data?.collected?.card ?? 0);
    const collectedTotal = Number(data?.collected_total ?? data?.collected?.total ?? 0);

    // Refunds
    const refundTotal = Number(data?.refund_total ?? data?.refunds?.total ?? 0);
    const refundCash = Number(data?.refund_cash ?? data?.refunds?.cash ?? 0);
    const refundCard = Number(data?.refund_card ?? data?.refunds?.card ?? 0);

    // Net metrics (collected - refunds)
    const netTotal = Number(data?.net_total ?? data?.net?.total ?? 0);
    const netCash = Number(data?.net_cash ?? data?.net?.cash ?? 0);
    const netCard = Number(data?.net_card ?? data?.net?.card ?? 0);

    // Deposits (for backward compat / seller details)
    const depositTotal = Number(data?.deposit_total ?? data?.ledger?.deposit_to_owner?.total ?? 0);
    const depositCash = Number(data?.deposit_cash ?? data?.ledger?.deposit_to_owner?.cash ?? 0);
    const depositCard = Number(data?.deposit_card ?? data?.ledger?.deposit_to_owner?.card ?? 0);

    const commissionPaid = Number(
      data?.salary_total ?? Math.round((totalRevenue * COMMISSION_PERCENT) / 100)
    );

    const summary = {
      totalRevenue,
      // Collected money (authoritative, same as Owner)
      cashRevenue: collectedCash,
      cardRevenue: collectedCard,
      collectedTotal,
      commissionPaid,
      businessDay: data?.business_day || day,
      // Refund and net metrics
      refundTotal,
      refundCash,
      refundCard,
      netTotal,
      netCash,
      netCard,
    };

    const rawSellers = Array.isArray(data?.sellers) ? data.sellers : [];
    const sellers = rawSellers.map((r) => {
      const sid = Number(r.seller_id);
      const cashRemaining = Number(r.cash_balance ?? r.balance ?? 0);
      const terminalDebt = Number(r.terminal_debt ?? 0);
      const accepted = Number(r.accepted ?? 0);
      const deposited = Number(r.deposited ?? 0);

      return {
        id: sid,
        name: `Продавец #${sid}`,
        // informational fields (used in details, optional)
        totalSales: accepted,
        cashSales: Number(r.accepted_cash || 0),
        cardSales: Number(r.accepted_card || 0),

        // already handed to owner/dispatcher (optional)
        cashHanded: Number(r.deposited_cash || 0),
        terminalHanded: Number(r.deposited_card || 0),

        // critical fields for the main table
        cashRemaining,
        terminalDebt,

        // debug (optional)
        depositedTotal: deposited,
      };
    });

    // If backend says the shift is already closed — reflect it in UI
    const closed = Boolean(data?.is_closed);
    setShiftClosed(closed);
    if (typeof setGlobalShiftClosed === 'function') setGlobalShiftClosed(closed);
    try {
      if (closed) localStorage.setItem('dispatcher_shiftClosed', 'true');
      else localStorage.removeItem('dispatcher_shiftClosed');
    } catch {}

    // Extract trip completion status (gate for operations)
    // If shift is closed, always consider all trips finished
    const tripsFinished = closed ? true : Boolean(data?.all_trips_finished ?? true);
    const tripsCount = closed ? 0 : Number(data?.open_trips_count ?? 0);
    setAllTripsFinished(tripsFinished);
    setOpenTripsCount(tripsCount);

    // Extract salary values from backend
    setSalaryDue(Number(data?.salary_due ?? 0));
    setSalaryPaidCash(Number(data?.salary_paid_cash ?? 0));
    setSalaryPaidCard(Number(data?.salary_paid_card ?? 0));
    setSalaryPaidTotal(Number(data?.salary_paid_total ?? 0));

    const draftsInit = {};
    for (const s of sellers) {
      draftsInit[s.id] = { cash: '', terminal: '' };
    }

    setDailySummary(summary);
    setSellersData(sellers);
    setDepositDrafts(draftsInit);
    setLoading(false);
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
    const debtSellers = (sellersData || []).filter(
      (s) => Number(s.cashRemaining || 0) > 0 || Number(s.terminalDebt || 0) > 0
    );
    const totalDebt = debtSellers.reduce(
      (acc, s) => acc + Number(s.cashRemaining || 0) + Number(s.terminalDebt || 0),
      0
    );
    return { count: debtSellers.length, total: totalDebt };
  }, [sellersData]);

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
    const next = {};
    for (const s of sellersData || []) {
      next[s.id] = {
        cash: Number(s.cashRemaining || 0) > 0 ? String(s.cashRemaining) : '',
        terminal: Number(s.terminalDebt || 0) > 0 ? String(s.terminalDebt) : '',
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

  const applySalaryPayout = async () => {
    const amount = Math.max(0, Number(salaryPayoutDraft || 0));
    if (!amount) return;

    if (!backendDepositEnabled) {
      // Fallback: local update only
      setSalaryPaidTotal((prev) => prev + amount);
      setSalaryPayoutDraft('');
      return;
    }

    try {
      const business_day = dailySummary?.businessDay || toLocalBusinessDay();
      await apiClient.request('/dispatcher/shift/deposit', {
        method: 'POST',
        body: {
          business_day,
          type: 'SALARY_PAYOUT_CASH',
          amount,
        },
      });
      await loadSummaryFromBackend(business_day);
      setSalaryPayoutDraft('');
    } catch (e) {
      // Fallback: backend not available
      setBackendDepositEnabled(false);
      setSalaryPaidTotal((prev) => prev + amount);
      setSalaryPayoutDraft('');
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
      const business_day = dailySummary?.businessDay || toLocalBusinessDay();
      await apiClient.request('/dispatcher/shift-ledger', {
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
      const business_day = dailySummary?.businessDay || toLocalBusinessDay();
      await apiClient.request('/dispatcher/shift-ledger', {
        method: 'POST',
        body: {
          business_day,
          type: 'DEPOSIT_TO_OWNER_TERMINAL',
          seller_id: sellerId,
          amount,
        },
      });
      await loadSummaryFromBackend(business_day);
      setDraftValue(sellerId, 'terminal', '');
    } catch (e) {
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

  const applyAllDeposits = async () => {
    // 1) Наличка
    for (const s of sellersData || []) {
      const a = Math.max(0, Number(depositDrafts?.[s.id]?.cash || 0));
      if (a > 0) {
        // eslint-disable-next-line no-await-in-loop
        await applyCashDeposit(s.id);
      }
    }
    // 2) Терминал
    for (const s of sellersData || []) {
      const a = Math.max(0, Number(depositDrafts?.[s.id]?.terminal || 0));
      if (a > 0) {
        // eslint-disable-next-line no-await-in-loop
        await applyTerminalClose(s.id);
      }
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
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Daily Summary Card */}
          <div className="bg-neutral-900 rounded-2xl  p-3">
            <h2 className="text-xl font-bold text-neutral-100 mb-4">ИТОГО ЗА ДЕНЬ</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-neutral-950 p-3 rounded-lg">
                <div className="text-neutral-400">Общая выручка</div>
                <div className="text-2xl font-bold text-purple-600">{formatRUB(dailySummary.totalRevenue)}</div>
              </div>
              <div className="bg-neutral-950 p-3 rounded-lg">
                <div className="text-neutral-400">Наличка/предоплата</div>
                <div className="text-2xl font-bold text-green-600">{formatRUB(dailySummary.cashRevenue)}</div>
              </div>
              <div className="bg-neutral-950 p-3 rounded-lg">
                <div className="text-neutral-400">Безнал/онлайн</div>
                <div className="text-2xl font-bold text-blue-600">{formatRUB(dailySummary.cardRevenue)}</div>
              </div>
          </div>
          
          {/* Refunds and Net */}
          {dailySummary.refundTotal > 0 && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-red-950/30 border border-red-900/50 p-3 rounded-lg">
                <div className="text-neutral-400">Возвраты</div>
                <div className="text-2xl font-bold text-red-400">{formatRUB(dailySummary.refundTotal)}</div>
                <div className="mt-1 text-xs text-neutral-500">Нал: {formatRUB(dailySummary.refundCash)} | Карта: {formatRUB(dailySummary.refundCard)}</div>
              </div>
              <div className="bg-emerald-950/30 border border-emerald-900/50 p-3 rounded-lg">
                <div className="text-neutral-400">Чистая касса</div>
                <div className="text-2xl font-bold text-emerald-400">{formatRUB(dailySummary.netTotal)}</div>
                <div className="mt-1 text-xs text-neutral-500">Нал: {formatRUB(dailySummary.netCash)} | Карта: {formatRUB(dailySummary.netCard)}</div>
              </div>
            </div>
          )}
          </div>
          
          {/* Salary (cash) */}
          <div className="bg-neutral-900 rounded-2xl  p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-neutral-100">Зарплата (нал)</h2>
                <div className="mt-1 text-sm text-neutral-400">К выплате временно 0, позже придёт из мотивации.</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
              <div className="bg-neutral-950 p-3 rounded-lg">
                <div className="text-neutral-400">К выплате</div>
                <div className="text-2xl font-bold text-orange-600">{formatRUB(salaryDue)}</div>
              </div>
              <div className="bg-neutral-950 p-3 rounded-lg">
                <div className="text-neutral-400">Выдано нал</div>
                <div className="text-2xl font-bold text-green-600">{formatRUB(salaryPaidCash)}</div>
              </div>
              <div className="bg-neutral-950 p-3 rounded-lg">
                <div className="text-neutral-400">Выдано карта</div>
                <div className="text-2xl font-bold text-blue-600">{formatRUB(salaryPaidCard)}</div>
              </div>
              <div className="bg-neutral-950 p-3 rounded-lg">
                <div className="text-neutral-400">Осталось выдать</div>
                <div className={`text-2xl font-bold ${salarySummary.remaining > 0 ? 'text-yellow-400' : 'text-neutral-200'}`}>{formatRUB(salarySummary.remaining)}</div>
              </div>
            </div>
            {/* Salary payout action */}
            {!shiftClosed && (
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="Сумма выдачи"
                  value={salaryPayoutDraft}
                  onChange={(e) => setSalaryPayoutDraft(e.target.value)}
                  className="w-32 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-2 text-neutral-100"
                />
                <button
                  type="button"
                  onClick={applySalaryPayout}
                  disabled={!allTripsFinished || Number(salaryPayoutDraft || 0) <= 0}
                  className={`px-3 py-2 rounded-lg border ${
                    allTripsFinished && Number(salaryPayoutDraft || 0) > 0
                      ? 'bg-orange-700 border-orange-600 text-white hover:bg-orange-600'
                      : 'bg-neutral-950 border-neutral-800 text-neutral-600 cursor-not-allowed'
                  }`}
                >
                  Выдать ЗП (нал)
                </button>
                {!allTripsFinished && (
                  <span className="text-xs text-red-400">Есть незавершённые рейсы</span>
                )}
              </div>
            )}
          </div>

          <div className="bg-neutral-900 rounded-2xl  p-3">
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

                <button
                  type="button"
                  onClick={applyAllDeposits}
                  disabled={!backendDepositEnabled}
                  title={!backendDepositEnabled ? 'Backend сдачи денег ещё не подключён' : ''}
                  className={`px-3 py-2 rounded-lg border ${
                    backendDepositEnabled
                      ? 'bg-purple-700 border-purple-600 text-white hover:bg-purple-600'
                      : 'bg-neutral-950 border-neutral-800 text-neutral-500 cursor-not-allowed'
                  }`}
                >
                  Провести всё
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
                  {sellersData.map((seller) => {
                    const st = getSellerStatus(seller);
                    const stLabel = st === 'CLOSED' ? 'Закрыт' : st === 'PARTIAL' ? 'Частично' : 'Долг';
                    const stClass =
                      st === 'CLOSED'
                        ? 'bg-green-900/40 text-green-300 border-green-800'
                        : st === 'PARTIAL'
                        ? 'bg-yellow-900/40 text-yellow-300 border-yellow-800'
                        : 'bg-red-900/40 text-red-300 border-red-800';

                    const cashRem = Number(seller.cashRemaining || 0);
                    const termRem = Number(seller.terminalDebt || 0);

                    const isOpen = expandedSellerId === seller.id;

                    return (
                      <Fragment key={seller.id}>
                        <tr className="border-b hover:bg-neutral-950">
                          <td className="py-3">{seller.name}</td>
                          <td className="py-3">
                            <span className={`inline-flex items-center px-2 py-1 rounded-md border text-xs ${stClass}`}>{stLabel}</span>
                          </td>
                          <td className={`text-right py-3 ${cashRem > 0 ? 'text-red-300 font-semibold' : 'text-neutral-200'}`}>{formatRUB(cashRem)}</td>
                          <td className={`text-right py-3 ${termRem > 0 ? 'text-red-300 font-semibold' : 'text-neutral-200'}`}>{formatRUB(termRem)}</td>
                          <td className="py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setExpandedSellerId((prev) => (prev === seller.id ? null : seller.id))}
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
                                <div className="text-sm text-neutral-300 font-semibold mb-3">{seller.name} — детали</div>

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
                                          inputMode="numeric"
                                          placeholder={cashRem > 0 ? String(cashRem) : ''}
                                          value={depositDrafts?.[seller.id]?.cash ?? ''}
                                          onChange={(e) => setDraftValue(seller.id, 'cash', e.target.value)}
                                          className="w-28 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-2 text-neutral-100"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => applyCashDeposit(seller.id)}
                                          disabled={shiftClosed || !allTripsFinished || (cashRem <= 0 && Number(depositDrafts?.[seller.id]?.cash || 0) <= 0)}
                                          className={`px-3 py-2 rounded-lg border ${
                                            !shiftClosed && allTripsFinished && (cashRem > 0 || Number(depositDrafts?.[seller.id]?.cash || 0) > 0)
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
                                          inputMode="numeric"
                                          placeholder={termRem > 0 ? String(termRem) : ''}
                                          value={depositDrafts?.[seller.id]?.terminal ?? ''}
                                          onChange={(e) => setDraftValue(seller.id, 'terminal', e.target.value)}
                                          className="w-28 bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-2 text-neutral-100"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => applyTerminalClose(seller.id)}
                                          disabled={termRem <= 0 && Number(depositDrafts?.[seller.id]?.terminal || 0) <= 0}
                                          className={`px-3 py-2 rounded-lg border ${
                                            termRem > 0 || Number(depositDrafts?.[seller.id]?.terminal || 0) > 0
                                              ? 'bg-neutral-900 border-neutral-700 text-neutral-100 hover:bg-neutral-800'
                                              : 'bg-neutral-950 border-neutral-800 text-neutral-600 cursor-not-allowed'
                                          }`}
                                        >
                                          Закрыть терминал
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            <div className="mt-4 text-sm text-gray-500 italic">
              Предварительный расчёт по {COMMISSION_PERCENT}% (позже заменим мотивацией)
            </div>
          </div>
          
          {shiftClosed ? (
            <div className="bg-green-100 border border-green-300 rounded-2xl p-3 mt-6">
              <h3 className="text-lg font-semibold text-green-800 mb-3">Статус смены</h3>
              <p className="text-green-700 font-medium">Смена закрыта</p>
            </div>
          ) : (
            <>
              {/* Confirmation Checks */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-3 mt-6">
                <h3 className="text-lg font-semibold text-neutral-100 mb-3">Подтверждение закрытия смены</h3>
                <div className="space-y-2">
                  <label className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={confirmationChecks.cashHandedOver}
                      onChange={() => handleCheckboxChange('cashHandedOver')}
                      disabled={shiftClosed}
                      className="h-5 w-5 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="text-neutral-300">Все продавцы сдали наличные/предоплаты</span>
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
                <div className="text-sm text-red-300 mb-2">Нельзя закрыть смену: {closeBlockReason}</div>
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
                <button
                  onClick={() => navigate('/dispatcher')}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-neutral-100 py-3 px-4 rounded-lg font-medium transition-colors"
                >
                  Вернуться к работе
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