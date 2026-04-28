import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Filter,
  LogOut,
  MapPinned,
  Radar,
  Search,
  Settings2,
  Ticket,
  WalletCards,
} from 'lucide-react';
import SlotManagement from '../components/dispatcher/SlotManagement';
import TicketSellingView from '../components/dispatcher/TicketSellingView';
import {
  isScannerLikeCapture,
  resolveDispatcherLookupQuery,
} from '../components/dispatcher/dispatcherScannerUtils';
import { dpButton, dpIconWrap } from '../components/dispatcher/dispatcherTheme';
import DateFieldPicker from '../components/ui/DateFieldPicker';
import DispatcherShiftClose from './DispatcherShiftClose';
import { useAuth } from '../contexts/AuthContext';
import { getTodayDate, getTomorrowDate } from '../utils/dateUtils';
import '../styles/dispatcherPremium.css';

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

const TAB_ITEMS = [
  { key: 'selling', label: 'Продажа | Посадка', icon: Ticket },
  { key: 'slots', label: 'Управление рейсами', icon: Settings2 },
  { key: 'maps', label: 'Карты', icon: MapPinned },
  { key: 'shiftClose', label: 'Закрытие смены', icon: WalletCards },
];

function isEditableElement(target) {
  if (!target || typeof target !== 'object') return false;
  const maybeElement = /** @type {{ tagName?: string, isContentEditable?: boolean }} */ (target);
  const tag = String(maybeElement.tagName || '').toLowerCase();
  return (
    maybeElement.isContentEditable === true ||
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select'
  );
}

const DispatcherView = () => {
  const navigate = useNavigate();
  const { logout: authLogout, currentUser, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !currentUser) {
      navigate('/login', { replace: true });
    }
  }, [currentUser, authLoading, navigate]);

  const [activeTab, setActiveTab] = useState('selling');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateRange, setDateRange] = useState(() => {
    const t = getTodayDate();
    return { from: t, to: t };
  });
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [tripCounts, setTripCounts] = useState({ total: 0, shown: 0 });
  const [quickTicketLookup, setQuickTicketLookup] = useState('');
  const [ticketLookupRequest, setTicketLookupRequest] = useState(null);
  const [ticketLookupError, setTicketLookupError] = useState('');
  const [ticketLookupBusy, setTicketLookupBusy] = useState(false);
  const quickLookupInputRef = useRef(null);
  const pendingLookupRequestIdRef = useRef(null);
  const scannerStateRef = useRef({
    buffer: '',
    startedAt: 0,
    lastAt: 0,
    intervals: [],
    source: 'keyboard',
  });

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

  const filtersDirty = useMemo(
    () =>
      datePreset !== 'today' ||
      typeFilter !== 'all' ||
      statusFilter !== 'active' ||
      searchTerm.trim().length > 0,
    [datePreset, typeFilter, statusFilter, searchTerm],
  );

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

  const resetScannerBuffer = useCallback(() => {
    scannerStateRef.current = {
      buffer: '',
      startedAt: 0,
      lastAt: 0,
      intervals: [],
      source: 'keyboard',
    };
  }, []);

  const submitTicketLookup = useCallback((rawValue, source = 'manual') => {
    const normalizedQuery = String(rawValue || '').trim();
    if (!normalizedQuery) {
      setTicketLookupError('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u043e\u0434 \u0431\u0438\u043b\u0435\u0442\u0430');
      return false;
    }

    const requestId = Date.now() + Math.floor(Math.random() * 1000);
    pendingLookupRequestIdRef.current = requestId;
    setTicketLookupBusy(true);
    setTicketLookupError('');
    setActiveTab('selling');
    setTicketLookupRequest({
      id: requestId,
      query: normalizedQuery,
      source,
    });
    return true;
  }, []);

  const handleTicketLookupResult = useCallback((result) => {
    const resultId = Number(result?.id);
    if (!Number.isInteger(resultId) || pendingLookupRequestIdRef.current !== resultId) {
      return;
    }
    pendingLookupRequestIdRef.current = null;
    setTicketLookupBusy(false);
    if (!result?.ok) {
      setTicketLookupError(result?.error || '\u0411\u0438\u043b\u0435\u0442 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d');
      return;
    }
    setTicketLookupError('');
  }, []);

  const handleLookupActionComplete = useCallback(() => {
    pendingLookupRequestIdRef.current = null;
    setActiveTab('selling');
    setTicketLookupBusy(false);
    setTicketLookupError('');
    setQuickTicketLookup('');
    setTimeout(() => {
      quickLookupInputRef.current?.focus();
      quickLookupInputRef.current?.select();
    }, 0);
  }, []);

  useEffect(() => {
    const handleGlobalKeydown = (event) => {
      const state = scannerStateRef.current;
      const now = Date.now();
      const key = event.key;
      const editable = isEditableElement(event.target);
      const quickInputFocused =
        quickLookupInputRef.current != null &&
        event.target === quickLookupInputRef.current;

      if (quickInputFocused) {
        resetScannerBuffer();
        return;
      }

      if (editable) {
        resetScannerBuffer();
        return;
      }

      if (key === 'Enter') {
        const cleanedBuffer = String(state.buffer || '').trim();
        const scannerLike = isScannerLikeCapture({
          buffer: cleanedBuffer,
          startedAt: state.startedAt,
          now,
          intervals: state.intervals,
          source: state.source,
        });

        if (scannerLike) {
          const resolvedLookup = resolveDispatcherLookupQuery(cleanedBuffer) || cleanedBuffer;
          setQuickTicketLookup(resolvedLookup);
          const started = submitTicketLookup(resolvedLookup, 'scanner');
          if (started) {
            event.preventDefault();
          }
        }

        resetScannerBuffer();
        return;
      }

      if (key === 'Escape') {
        resetScannerBuffer();
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (key.length !== 1) {
        if (!editable) {
          resetScannerBuffer();
        }
        return;
      }

      if (!state.startedAt || now - state.lastAt > 280) {
        state.buffer = '';
        state.startedAt = now;
        state.intervals = [];
        state.source = 'keyboard';
      }

      if (state.lastAt > 0) {
        state.intervals.push(now - state.lastAt);
      }

      state.lastAt = now;
      state.buffer += key;
    };

    const handleGlobalPaste = (event) => {
      const quickInputFocused =
        quickLookupInputRef.current != null &&
        event.target === quickLookupInputRef.current;
      if (quickInputFocused || isEditableElement(event.target)) {
        return;
      }

      const pastedText = String(event.clipboardData?.getData('text') || '').trim();
      if (!pastedText) {
        return;
      }

      const now = Date.now();
      scannerStateRef.current = {
        buffer: pastedText,
        startedAt: now,
        lastAt: now,
        intervals: [],
        source: 'paste',
      };
    };

    window.addEventListener('keydown', handleGlobalKeydown, true);
    window.addEventListener('paste', handleGlobalPaste, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeydown, true);
      window.removeEventListener('paste', handleGlobalPaste, true);
    };
  }, [resetScannerBuffer, submitTicketLookup]);

  return (
    <div className="dispatcher-premium min-h-screen text-neutral-100">
      <div className="dp-shell">
        <div className="dp-topbar dp-topbar--compact">
          <div className="dp-toolbar dp-toolbar--compact">
            <div className="dp-brand dp-brand--compact">
              <div className={dpIconWrap('info')}>
                <Radar size={20} strokeWidth={2} />
              </div>
              <div className="dp-brand__title dp-brand__title--compact">Диспетчер</div>
            </div>

            <form
              className="relative min-w-[220px] flex-1 max-w-[560px]"
              onSubmit={(event) => {
                event.preventDefault();
                const resolvedLookup = resolveDispatcherLookupQuery(quickTicketLookup) || quickTicketLookup;
                submitTicketLookup(resolvedLookup, 'topbar');
              }}
            >
              <Search
                size={16}
                strokeWidth={2}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500"
              />
              <input
                ref={quickLookupInputRef}
                type="text"
                value={quickTicketLookup}
                onChange={(event) => {
                  setQuickTicketLookup(event.target.value);
                  if (ticketLookupError) setTicketLookupError('');
                }}
                placeholder={'\u041d\u0430\u0439\u0442\u0438 \u0431\u0438\u043b\u0435\u0442'}
                className={ticketLookupBusy ? 'w-full py-2 pl-11 pr-4 text-sm border-sky-300/50' : 'w-full py-2 pl-11 pr-4 text-sm'}
                data-testid="dispatcher-ticket-quick-lookup"
              />
            </form>
            <div className="dp-toolbar__actions dp-toolbar__actions--compact">
              <button
                type="button"
                onClick={logout}
                className={dpButton({ variant: 'danger' })}
              >
                <LogOut size={16} strokeWidth={2} />
                <span>Выйти</span>
              </button>
            </div>
          </div>

          {ticketLookupError && (
            <div className="px-1 text-xs text-rose-300" data-testid="dispatcher-ticket-lookup-error">
              {ticketLookupError}
            </div>
          )}

          <div className="dp-topbar__nav">
            <div className="dp-tabbar dp-tabbar--compact">
              {TAB_ITEMS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  data-testid={`tab-${key}`}
                  className={dpButton({
                    variant: activeTab === key ? 'primary' : 'ghost',
                    active: activeTab === key,
                    className: 'dp-button--tab',
                  })}
                >
                  <Icon size={16} strokeWidth={2} />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setFiltersOpen((prev) => !prev)}
              data-testid="dispatcher-filter-toggle"
              className={dpButton({
                variant: filtersOpen || filtersDirty ? 'secondary' : 'ghost',
                className: 'dp-filter-toggle',
              })}
            >
              <Filter size={16} strokeWidth={2} />
              <span>{filtersOpen ? 'Скрыть фильтры' : 'Фильтры'}</span>
              {filtersOpen ? <ChevronUp size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
            </button>
          </div>

          {filtersOpen && (
            <div className="dp-filterbar dp-filterbar--expanded">
              <div className={dpIconWrap('neutral')}>
                <Filter size={18} strokeWidth={2} />
              </div>

              <button
                type="button"
                onClick={() => {
                  const t = getTodayDate();
                  setDateRange({ from: t, to: t });
                }}
                className={dpButton({
                  variant: datePreset === 'today' ? 'primary' : 'ghost',
                  active: datePreset === 'today',
                  size: 'sm',
                })}
              >
                <CalendarDays size={15} strokeWidth={2} />
                <span>Сегодня</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const t = getTomorrowDate();
                  setDateRange({ from: t, to: t });
                }}
                className={dpButton({
                  variant: datePreset === 'tomorrow' ? 'primary' : 'ghost',
                  active: datePreset === 'tomorrow',
                  size: 'sm',
                })}
              >
                <CalendarDays size={15} strokeWidth={2} />
                <span>Завтра</span>
              </button>

              <div className="dp-segmented">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatusFilter(opt.value)}
                    className={dpButton({
                      variant: statusFilter === opt.value ? 'primary' : 'ghost',
                      active: statusFilter === opt.value,
                      size: 'sm',
                    })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="min-w-[190px] px-4 py-2 text-sm"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <DateFieldPicker
                value={dateRange.from}
                onChange={(nextValue) => {
                  setDateRange((prev) => ({
                    from: nextValue,
                    to: prev.to >= nextValue ? prev.to : nextValue,
                  }));
                }}
                caption=""
                sheetTitle="Начало периода"
                sheetDescription="Выберите дату начала фильтра."
                tone="dark"
                className="min-w-[96px] sm:w-[108px]"
                triggerClassName="min-h-[44px] rounded-[18px] px-4 py-2"
                primaryClassName="!mt-0 text-sm font-semibold leading-5"
                secondaryClassName="hidden"
                showRelativeLabel={false}
                compactDisplay
              />

              <DateFieldPicker
                value={dateRange.to}
                onChange={(nextValue) => {
                  setDateRange((prev) => ({
                    from: prev.from <= nextValue ? prev.from : nextValue,
                    to: nextValue,
                  }));
                }}
                caption=""
                sheetTitle="Конец периода"
                sheetDescription="Выберите дату окончания фильтра."
                tone="dark"
                min={dateRange.from}
                className="min-w-[96px] sm:w-[108px]"
                triggerClassName="min-h-[44px] rounded-[18px] px-4 py-2"
                primaryClassName="!mt-0 text-sm font-semibold leading-5"
                secondaryClassName="hidden"
                showRelativeLabel={false}
                compactDisplay
              />

              <div className="relative min-w-[220px] flex-1">
                <Search
                  size={16}
                  strokeWidth={2}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Поиск по рейсам, времени и дате"
                  className="w-full py-2 pl-11 pr-4 text-sm"
                />
              </div>

              <button
                type="button"
                onClick={resetFilters}
                className={dpButton({ variant: 'secondary', size: 'sm' })}
              >
                Сброс
              </button>

              <div className="dp-counter">
                <span>Показано</span>
                <strong>{tripCounts.shown}</strong>
                <span>из</span>
                <strong>{tripCounts.total}</strong>
              </div>
            </div>
          )}
        </div>

        <div className="pt-4">
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
              isActive={activeTab === 'selling'}
              ticketLookupRequest={ticketLookupRequest}
              onTicketLookupResult={handleTicketLookupResult}
              onLookupActionComplete={handleLookupActionComplete}
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
              onDateRangeChange={setDateRange}
            />
          )}

          {activeTab === 'maps' && (
            <div className="dp-empty flex h-[60vh] items-center justify-center">
              <div>
                <div className="dp-empty__icon">
                  <MapPinned size={24} strokeWidth={2} />
                </div>
                <div className="text-lg font-semibold text-neutral-100">Карты</div>
                <div className="mt-2 text-sm text-neutral-400">
                  Скоро здесь появится карта с локациями и маршрутами.
                </div>
              </div>
            </div>
          )}

          {activeTab === 'shiftClose' && <DispatcherShiftClose setShiftClosed={setShiftClosed} />}
        </div>
      </div>
    </div>
  );
};

export default DispatcherView;
