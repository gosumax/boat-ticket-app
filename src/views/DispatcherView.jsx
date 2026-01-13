import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TripListView from '../components/dispatcher/TripListView';
import SlotManagement from '../components/dispatcher/SlotManagement';
import TicketSellingView from '../components/dispatcher/TicketSellingView';
import DispatcherShiftClose from './DispatcherShiftClose';
import { useAuth } from '../contexts/AuthContext';
import { getTodayDate, getTomorrowDate } from '../utils/dateUtils';

const TYPE_OPTIONS = [
  { value: 'all', label: 'Все типы' },
  { value: 'speed', label: 'Скоростная' },
  { value: 'cruise', label: 'Прогулочная' },
  { value: 'banana', label: 'Банан' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'Все статусы' },
  { value: 'active', label: 'Активные' },
  { value: 'completed', label: 'Завершённые' },
];

const DispatcherView = () => {
  const navigate = useNavigate();
  const { logout: authLogout, currentUser, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !currentUser) {
      navigate('/login', { replace: true });
    }
  }, [currentUser, authLoading, navigate]);

  const [activeTab, setActiveTab] = useState('trips');

  const [dateRange, setDateRange] = useState(() => {
    const t = getTodayDate();
    return { from: t, to: t };
  });

  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [tripCounts, setTripCounts] = useState({ total: 0, shown: 0 });

  const [shiftClosed, setShiftClosed] = useState(() => {
    const saved = localStorage.getItem('dispatcher_shiftClosed');
    return saved === 'true';
  });

  const datePreset = useMemo(() => {
    const today = getTodayDate();
    const tomorrow = getTomorrowDate();
    if (dateRange.from === today && dateRange.to === today) return 'today';
    if (dateRange.from === tomorrow && dateRange.to === tomorrow) return 'tomorrow';
    return 'custom';
  }, [dateRange]);

  const dateFilter = useMemo(() => {
    if (datePreset === 'today') return 'today';
    if (datePreset === 'tomorrow') return 'tomorrow';
    return 'all';
  }, [datePreset]);

  const logout = () => {
    localStorage.removeItem('dispatcher_shiftClosed');
    setShiftClosed(false);
    authLogout();
    navigate('/login', { replace: true });
  };

  const resetFilters = () => {
    const t = getTodayDate();
    setDateRange({ from: t, to: t });
    setTypeFilter('all');
    setStatusFilter('active');
    setSearchTerm('');
  };

  // --- status dropdown menu ---
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusWrapRef = useRef(null);

  const statusLabel = useMemo(() => {
    return STATUS_OPTIONS.find(o => o.value === statusFilter)?.label ?? 'Активные';
  }, [statusFilter]);

  useEffect(() => {
    const onDown = (e) => {
      const sWrap = statusWrapRef.current;
      if (statusMenuOpen && sWrap && !sWrap.contains(e.target)) setStatusMenuOpen(false);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        setStatusMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [statusMenuOpen]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* HEADER */}
      <div className="border-b border-neutral-800 bg-neutral-950">
        <div className="h-14 px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
            >
              ← Назад
            </button>
            <div className="font-semibold">Диспетчер</div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('dispatcher:refresh'))}
              className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
              title="Обновить данные"
            >
              Обновить
            </button>

            <button
              onClick={logout}
              className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white"
            >
              Выйти
            </button>
          </div>
        </div>

        {/* TABS */}
        <div className="px-4 pb-2 flex gap-2 flex-wrap">
          {[
            ['trips', 'Активные рейсы'],
            ['selling', 'Продажа билетов'],
            ['slots', 'Управление рейсами'],
            ['shiftClose', 'Закрытие смены']
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border ${
                activeTab === key
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* FILTER BAR (ONE LINE) */}
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const t = getTodayDate();
                  setDateRange({ from: t, to: t });
                }}
                className={`px-3 py-2 rounded-xl text-sm font-semibold border ${
                  datePreset === 'today'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                Сегодня
              </button>
              <button
                onClick={() => {
                  const t = getTomorrowDate();
                  setDateRange({ from: t, to: t });
                }}
                className={`px-3 py-2 rounded-xl text-sm font-semibold border ${
                  datePreset === 'tomorrow'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                Завтра
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateRange.from}
                onChange={(e) => {
                  const v = e.target.value;
                  setDateRange((prev) => ({ from: v, to: prev.to >= v ? prev.to : v }));
                }}
                className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-200 text-sm"
              />
              <input
                type="date"
                value={dateRange.to}
                onChange={(e) => {
                  const v = e.target.value;
                  setDateRange((prev) => ({ from: prev.from <= v ? prev.from : v, to: v }));
                }}
                className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-200 text-sm"
              />
            </div>

            {/* TYPE BUTTONS */}
            <div className="flex items-center gap-2 flex-wrap">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTypeFilter(opt.value)}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold border ${
                    typeFilter === opt.value
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800'
                  }`}
                  title="Тип лодки"
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* STATUS MENU */}
            <div className="relative" ref={statusWrapRef}>
              <button
                onClick={() => {
                  setStatusMenuOpen(v => !v);
                                  }}
                className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-200 text-sm hover:bg-neutral-800 flex items-center gap-2"
                title="Статус рейса"
              >
                <span className="whitespace-nowrap">{statusLabel}</span>
                <span className="text-neutral-500">▾</span>
              </button>

              {statusMenuOpen && (
                <div className="absolute z-50 mt-2 w-56 rounded-xl border border-neutral-800 bg-neutral-950 shadow-xl overflow-hidden">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setStatusFilter(opt.value);
                        setStatusMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-900 ${
                        statusFilter === opt.value ? 'bg-blue-600/20 text-blue-100' : 'text-neutral-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Поиск..."
              className="min-w-[220px] flex-1 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-200 text-sm placeholder:text-neutral-500"
            />

            <button
              onClick={resetFilters}
              className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-200 hover:bg-neutral-800 text-sm font-semibold"
            >
              Сброс
            </button>

            <div className="ml-auto text-xs text-neutral-400">
              Показано <span className="text-neutral-100 font-semibold">{tripCounts.shown}</span> из{' '}
              <span className="text-neutral-100 font-semibold">{tripCounts.total}</span>
            </div>
          </div>
        </div>
      </div>

      {shiftClosed && (
        <div className="px-4 py-2 text-sm bg-red-950/40 border-b border-red-900 text-red-200">
          Смена закрыта. Все действия заблокированы.
        </div>
      )}

      {/* CONTENT */}
      <div className="p-4">
        {activeTab === 'trips' && (
          <TripListView
            dateFilter={dateFilter}
            dateFrom={dateRange.from}
            dateTo={dateRange.to}
            typeFilter={typeFilter}
            statusFilter={statusFilter}
            searchTerm={searchTerm}
            onTripCountsChange={setTripCounts}
            shiftClosed={shiftClosed}
          />
        )}

        {activeTab === 'selling' && (
          <TicketSellingView
            dateFilter={dateFilter}
            dateFrom={dateRange.from}
            dateTo={dateRange.to}
            typeFilter={typeFilter}
            statusFilter={statusFilter}
            searchTerm={searchTerm}
            onTripCountsChange={setTripCounts}
            shiftClosed={shiftClosed}
          />
        )}

        {activeTab === 'slots' && (
          <SlotManagement
            dateFilter={dateFilter}
            dateFrom={dateRange.from}
            dateTo={dateRange.to}
            typeFilter={typeFilter}
            statusFilter={statusFilter}
            searchTerm={searchTerm}
            onTripCountsChange={setTripCounts}
            shiftClosed={shiftClosed}
          />
        )}

        {activeTab === 'shiftClose' && (
          <DispatcherShiftClose setShiftClosed={setShiftClosed} />
        )}
      </div>
    </div>
  );
};

export default DispatcherView;
