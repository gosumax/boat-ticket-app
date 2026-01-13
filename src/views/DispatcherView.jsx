import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import TripListView from '../components/dispatcher/TripListView';
import SlotManagement from '../components/dispatcher/SlotManagement';
import TicketSellingView from '../components/dispatcher/TicketSellingView';
import DispatcherShiftClose from './DispatcherShiftClose';
import { useAuth } from '../contexts/AuthContext';
import { getTodayDate, getTomorrowDate } from '../utils/dateUtils';

const DispatcherView = () => {
  const navigate = useNavigate();
  const { logout: authLogout, currentUser, loading: authLoading } = useAuth();

  const logout = () => {
    localStorage.removeItem('dispatcher_shiftClosed');
    setShiftClosed(false);
    authLogout();
    navigate('/login', { replace: true });
  };

  useEffect(() => {
    if (!authLoading && !currentUser) {
      navigate('/login', { replace: true });
    }
  }, [currentUser, authLoading, navigate]);

  const [activeTab, setActiveTab] = useState('trips');

  // filters
  const [showFilters, setShowFilters] = useState(false);

  const [dateRange, setDateRange] = useState(() => {
    const t = getTodayDate();
    return { from: t, to: t };
  });

  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [searchTerm, setSearchTerm] = useState('');

  const dateFilter = useMemo(() => {
    const today = getTodayDate();
    const tomorrow = getTomorrowDate();

    if (dateRange.from === today && dateRange.to === today) return 'today';
    if (dateRange.from === tomorrow && dateRange.to === tomorrow) return 'tomorrow';
    return 'all';
  }, [dateRange]);

  const [tripCounts, setTripCounts] = useState({ total: 0, shown: 0 });

  const [shiftClosed, setShiftClosed] = useState(() => {
    const saved = localStorage.getItem('dispatcher_shiftClosed');
    return saved === 'true';
  });

  const refreshAllSlots = async () => {};

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-purple-600 text-white p-3 flex justify-between items-center shadow-md">
        <button onClick={() => navigate('/')} className="hover:text-purple-200">
          ← Назад
        </button>
        <h1 className="text-lg font-bold">Диспетчер</h1>
        <button
          onClick={logout}
          className="bg-purple-700 hover:bg-purple-800 px-3 py-1 rounded"
        >
          Выйти
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 flex overflow-x-auto">
        {[
          ['trips', 'Активные рейсы'],
          ['selling', 'Продажа билетов'],
          ['slots', 'Управление рейсами'],
          ['shiftClose', 'Закрытие смены']
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-none whitespace-nowrap px-4 py-3 text-sm font-medium ${
              activeTab === key
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {shiftClosed && (
        <div className="bg-red-100 border border-red-300 text-red-700 p-3 text-center">
          Смена закрыта. Все действия заблокированы.
        </div>
      )}

      {/* Filters */}
      {activeTab !== 'shiftClose' && (
        <div className="p-4 bg-white border-b border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="text-blue-600 font-medium"
            >
              {showFilters ? 'Скрыть фильтры' : 'Показать фильтры'}
            </button>
            <div className="text-sm text-gray-600">
              Показано: {tripCounts.shown} из {tripCounts.total}
            </div>
          </div>

          {showFilters && (
            <div className="p-4 bg-white rounded-lg shadow">
              <div className="grid grid-cols-1 gap-4">
                {/* DATE */}
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-2">Дата</div>

                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => {
                        const t = getTodayDate();
                        setDateRange({ from: t, to: t });
                      }}
                      className={`px-4 py-2 rounded-lg text-sm ${
                        dateFilter === 'today'
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-100 hover:bg-gray-200'
                      }`}
                    >
                      Сегодня
                    </button>

                    <button
                      onClick={() => {
                        const t = getTomorrowDate();
                        setDateRange({ from: t, to: t });
                      }}
                      className={`px-4 py-2 rounded-lg text-sm ${
                        dateFilter === 'tomorrow'
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-100 hover:bg-gray-200'
                      }`}
                    >
                      Завтра
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={dateRange.from}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDateRange((prev) => ({
                          from: v,
                          to: prev.to >= v ? prev.to : v
                        }));
                      }}
                      className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-purple-500"
                    />

                    <input
                      type="date"
                      value={dateRange.to}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDateRange((prev) => ({
                          from: prev.from <= v ? prev.from : v,
                          to: v
                        }));
                      }}
                      className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>

                {/* TYPE */}
                <div>
                  <div className="text-sm font-medium mb-2">Тип</div>
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="all">Все</option>
                    <option value="speed">Скоростная</option>
                    <option value="cruise">Прогулочная</option>
                    <option value="banana">Банан</option>
                  </select>
                </div>

                {/* STATUS */}
                <div>
                  <div className="text-sm font-medium mb-2">Статус</div>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="all">Все</option>
                    <option value="active">Активные</option>
                    <option value="completed">Завершённые</option>
                  </select>
                </div>

                {/* SEARCH */}
                <div>
                  <div className="text-sm font-medium mb-2">Поиск</div>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Поиск по названию..."
                    className="w-full px-3 py-2 border rounded-md"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => {
                    const t = getTodayDate();
                    setDateRange({ from: t, to: t });
                    setTypeFilter('all');
                    setStatusFilter('all');
                    setSearchTerm('');
                  }}
                  className="px-4 py-2 bg-gray-500 text-white rounded"
                >
                  Сброс
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CONTENT */}
      <div className="p-3 ">
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
