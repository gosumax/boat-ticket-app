import { useEffect, useMemo, useState } from 'react';
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
  { value: 'active', label: 'Активные' },
  { value: 'completed', label: 'Завершённые' },
  { value: 'all', label: 'Все рейсы' },
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

  // statusFilter is controlled by segmented buttons in the UI (Active / Completed / All).

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="border-b border-neutral-800 bg-neutral-950">
        <div className="h-14 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-2xl font-bold">🧭 Диспетчер</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('dispatcher:refresh'))}
              className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
            >
              Обновить
            </button>
            <button
              type="button"
              onClick={logout}
              className="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white"
            >
              Выйти
            </button>
          </div>
        </div>

        <div className="px-4 pb-2 flex gap-2 flex-wrap">
          {[
            ['trips', 'Активные рейсы'],
            ['selling', 'Продажа | Посадка'],
            ['slots', 'Управление рейсами'],
            ['maps', 'Карты'],
            ['shiftClose', 'Закрытие смены'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              data-testid={`tab-${key}`}
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

        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
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
              type="button"
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

            {/* Status filter: Active / Completed / All */}
            <div className="flex items-center rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatusFilter(opt.value)}
                  className={`px-3 py-2 text-sm font-semibold border-r border-neutral-800 last:border-r-0 ${
                    statusFilter === opt.value
                      ? 'bg-blue-600 text-white'
                      : 'text-neutral-300 hover:bg-neutral-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Boat type filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-200 text-sm"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

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

            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Поиск..."
              className="min-w-[220px] flex-1 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-200 text-sm placeholder:text-neutral-500"
            />

            <button
              type="button"
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

        {activeTab === 'maps' && (
          <div className="h-[60vh] flex items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900">
            <div className="text-center text-neutral-400">
              <div className="text-4xl mb-2">🗺️</div>
              <div className="text-lg font-semibold text-neutral-200">Карты</div>
              <div className="text-sm mt-1">Скоро здесь появится карта с локациями и маршрутами</div>
            </div>
          </div>
        )}

        {activeTab === 'shiftClose' && (
          <DispatcherShiftClose setShiftClosed={setShiftClosed} />
        )}
      </div>
    </div>
  );
};

export default DispatcherView;
