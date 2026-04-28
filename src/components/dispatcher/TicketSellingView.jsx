import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Anchor,
  BadgeCheck,
  CalendarDays,
  Clock3,
  Gauge,
  Hourglass,
  SearchX,
  Users,
} from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { getSlotAvailable, isSlotSoldOut } from '../../utils/slotAvailability';
import {
  dpBadge,
  dpIconWrap,
  dpMetric,
  dpPill,
  dpProgressTone,
  dpTypeTone,
} from './dispatcherTheme';
import PassengerList from './PassengerList.jsx';

function formatDurationMinutes(durationMinutes) {
  if (typeof durationMinutes !== 'number' || durationMinutes <= 0) return '~1 час';
  const h = Math.floor(durationMinutes / 60);
  const m = durationMinutes % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  return `${m} мин`;
}

function getCapacity(trip) {
  const cap =
    (typeof trip?.capacity === 'number' ? trip.capacity : undefined) ??
    (typeof trip?.boat_capacity === 'number' ? trip.boat_capacity : undefined);
  return typeof cap === 'number' && cap > 0 ? cap : null;
}

function getDurationMinutes(trip) {
  const v =
    (typeof trip?.duration_minutes === 'number' ? trip.duration_minutes : undefined) ??
    (typeof trip?.durationMinutes === 'number' ? trip.durationMinutes : undefined) ??
    (typeof trip?.duration === 'number' ? trip.duration : undefined);
  return typeof v === 'number' ? v : null;
}

function getSoldLevel(occupied, capacity) {
  if (typeof occupied !== 'number' || typeof capacity !== 'number' || capacity <= 0) return 'none';
  if (capacity === 12) {
    if (occupied < 4) return 'low';
    if (occupied < 8) return 'mid';
    return 'high';
  }
  const ratio = occupied / capacity;
  if (ratio < 0.34) return 'low';
  if (ratio < 0.67) return 'mid';
  return 'high';
}

function getSoldUi(level) {
  switch (level) {
    case 'low':
      return { tone: 'danger', label: 'Низкая загрузка' };
    case 'mid':
      return { tone: 'warning', label: 'Средняя загрузка' };
    case 'high':
      return { tone: 'success', label: 'Высокая загрузка' };
    default:
      return { tone: 'neutral', label: 'Без данных' };
  }
}

function normalizeType(t) {
  const value = String(t || '').toLowerCase();
  if (value.includes('banana')) return 'banana';
  if (value.includes('speed')) return 'speed';
  if (value.includes('cruise')) return 'cruise';
  return value || 'other';
}

function typeLabel(type) {
  const value = normalizeType(type);
  if (value === 'banana') return 'Банан';
  if (value === 'speed') return 'Скоростная';
  if (value === 'cruise') return 'Прогулочная';
  return 'Рейс';
}

function normalizeTripsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.slots)) return payload.slots;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function findTripForLookupMatch(trips, match) {
  if (!Array.isArray(trips) || trips.length === 0 || !match) return null;

  const slotUid = String(match?.slot_uid || '');
  if (slotUid) {
    const bySlotUid = trips.find((trip) => String(trip?.slot_uid || '') === slotUid);
    if (bySlotUid) return bySlotUid;
  }

  const boatSlotId = Number(match?.boat_slot_id);
  if (Number.isInteger(boatSlotId) && boatSlotId > 0) {
    const byBoatSlotId = trips.find((trip) => Number(trip?.id) === boatSlotId);
    if (byBoatSlotId) return byBoatSlotId;
  }

  return null;
}

const TicketSellingView = ({
  dateFrom,
  dateTo,
  typeFilter = 'all',
  statusFilter = 'all',
  searchTerm = '',
  onTripCountsChange,
  refreshAllSlots,
  shiftClosed,
  isActive = true,
  ticketLookupRequest = null,
  onTicketLookupResult,
  onLookupActionComplete,
}) => {
  const [trips, setTrips] = useState(() => {
    try {
      const raw = sessionStorage.getItem('dispatcher_trips_cache');
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [ticketLookupContext, setTicketLookupContext] = useState(null);
  const didInitRef = useRef(false);
  const inFlightRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const sigRef = useRef('');
  const lastHandledLookupIdRef = useRef(null);

  const loadTrips = useCallback(async (opts = {}) => {
    const silent = !!opts.silent;
    const force = !!opts.force;
    if (inFlightRef.current) {
      pendingReloadRef.current = true;
      return null;
    }
    inFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const data = await apiClient.getTrips();
      const next = normalizeTripsPayload(data);

      const sig = JSON.stringify(next.map((t) => ({
        id: t?.id,
        slot_uid: t?.slot_uid,
        trip_date: t?.trip_date,
        time: t?.time,
        status: t?.status,
        is_active: t?.is_active,
        capacity: t?.capacity,
        seats_left: t?.seats_left ?? t?.seatsLeft ?? t?.free_seats ?? t?.freeSeats,
        occupied: t?.occupied ?? t?.sold ?? t?.taken_seats ?? t?.takenSeats,
        paid_total: t?.paid_total ?? t?.paidTotal,
        has_debt: t?.has_debt ?? t?.hasDebt,
        debt_amount: t?.debt_amount ?? t?.debtAmount,
        updated_at: t?.updated_at ?? t?.updatedAt,
      })));
      if (force || sig !== sigRef.current) {
        sigRef.current = sig;
        setTrips(next);
        try {
          sessionStorage.setItem('dispatcher_trips_cache', JSON.stringify(next));
        } catch {}
      }
      return next;
    } catch (e) {
      console.error(e);
      return null;
    } finally {
      if (!silent) setLoading(false);
      inFlightRef.current = false;
      if (pendingReloadRef.current) {
        pendingReloadRef.current = false;
        loadTrips({ silent: true, force: true });
      }
    }
  }, []);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    loadTrips();
  }, [loadTrips]);

  useEffect(() => {
    const h = () => loadTrips({ silent: true, force: true });
    try {
      window.addEventListener('dispatcher:slots-changed', h);
    } catch {}
    return () => {
      try {
        window.removeEventListener('dispatcher:slots-changed', h);
      } catch {}
    };
  }, [loadTrips]);

  useEffect(() => {
    if (!isActive) return undefined;

    const intervalId = setInterval(() => {
      loadTrips({ silent: true });
    }, 5000);

    return () => clearInterval(intervalId);
  }, [loadTrips, isActive]);

  const isInDateRange = (trip) => {
    if (!trip.trip_date || !dateFrom || !dateTo) return true;
    return trip.trip_date >= dateFrom && trip.trip_date <= dateTo;
  };

  const isFinished = (trip) => {
    if (!trip.trip_date || !trip.time) return false;
    return new Date(`${trip.trip_date}T${trip.time}:00`) < new Date();
  };

  const filteredTrips = useMemo(() => {
    let result = [...trips];

    result = result.filter(isInDateRange);

    if (typeFilter !== 'all') {
      result = result.filter((t) => t.boat_type === typeFilter);
    }

    if (statusFilter !== 'all') {
      result = result.filter((t) => {
        if (statusFilter === 'active') return t.is_active === 1 && !isFinished(t);
        if (statusFilter === 'completed') return isFinished(t);
        return true;
      });
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((t) =>
        (t.boat_name || '').toLowerCase().includes(term) ||
        String(t.id).includes(term),
      );
    }

    return result;
  }, [trips, dateFrom, dateTo, typeFilter, statusFilter, searchTerm]);

  useEffect(() => {
    onTripCountsChange?.({
      total: trips.length,
      shown: filteredTrips.length,
    });
  }, [trips.length, filteredTrips.length, onTripCountsChange]);

  useEffect(() => {
    const requestId = ticketLookupRequest?.id;
    const lookupQuery = String(ticketLookupRequest?.query || '').trim();
    if (!requestId || !lookupQuery) return;
    if (lastHandledLookupIdRef.current === requestId) return;
    lastHandledLookupIdRef.current = requestId;

    let cancelled = false;
    const reportResult = (payload) => {
      if (!cancelled) {
        onTicketLookupResult?.({
          id: requestId,
          query: lookupQuery,
          ...payload,
        });
      }
    };

    const run = async () => {
      try {
        const response = await apiClient.lookupDispatcherTicket(lookupQuery);
        const match = response?.match || null;
        if (!match) {
          throw new Error('\u0411\u0438\u043b\u0435\u0442 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d');
        }

        let matchedTrip = findTripForLookupMatch(trips, match);
        if (!matchedTrip) {
          const freshPayload = await apiClient.getTrips();
          const freshTrips = normalizeTripsPayload(freshPayload);
          if (Array.isArray(freshTrips) && freshTrips.length > 0) {
            const sig = JSON.stringify(freshTrips.map((t) => ({
              id: t?.id,
              slot_uid: t?.slot_uid,
              trip_date: t?.trip_date,
              time: t?.time,
              status: t?.status,
              is_active: t?.is_active,
              capacity: t?.capacity,
              seats_left: t?.seats_left ?? t?.seatsLeft ?? t?.free_seats ?? t?.freeSeats,
              occupied: t?.occupied ?? t?.sold ?? t?.taken_seats ?? t?.takenSeats,
              paid_total: t?.paid_total ?? t?.paidTotal,
              has_debt: t?.has_debt ?? t?.hasDebt,
              debt_amount: t?.debt_amount ?? t?.debtAmount,
              updated_at: t?.updated_at ?? t?.updatedAt,
            })));
            sigRef.current = sig;
            setTrips(freshTrips);
            try {
              sessionStorage.setItem('dispatcher_trips_cache', JSON.stringify(freshTrips));
            } catch {}
            matchedTrip = findTripForLookupMatch(freshTrips, match);
          }
        }

        if (!matchedTrip) {
          throw new Error('\u0420\u0435\u0439\u0441 \u0434\u043b\u044f \u0431\u0438\u043b\u0435\u0442\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d');
        }

        if (!cancelled) {
          const presaleId = Number(match?.presale_id);
          const ticketId = Number(match?.ticket_id);
          setSelectedTrip(matchedTrip);
          setTicketLookupContext({
            presaleId: Number.isInteger(presaleId) && presaleId > 0 ? presaleId : null,
            ticketId: Number.isInteger(ticketId) && ticketId > 0 ? ticketId : null,
            ticketCode: String(match?.public_ticket_code || match?.buyer_ticket_code || match?.ticket_code || '').trim() || null,
            lookupQuery,
            key: `${requestId}:${presaleId || ''}:${ticketId || ''}`,
          });
        }

        reportResult({ ok: true, match });
      } catch (error) {
        reportResult({
          ok: false,
          error: error?.message || '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0431\u0438\u043b\u0435\u0442',
        });
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [ticketLookupRequest, trips, onTicketLookupResult]);

  if (selectedTrip) {
    return (
      <div className="dp-overlay z-50 overflow-y-auto">
        <div className="flex min-h-screen items-start justify-center p-3">
          <div className="dp-sheet">
            <PassengerList
              trip={selectedTrip}
              onBack={() => {
                setSelectedTrip(null);
                setTicketLookupContext(null);
              }}
              onLookupActionComplete={(payload) => {
                setSelectedTrip(null);
                setTicketLookupContext(null);
                onLookupActionComplete?.(payload);
              }}
              refreshTrips={loadTrips}
              refreshAllSlots={refreshAllSlots}
              shiftClosed={shiftClosed}
              focusedPresaleId={ticketLookupContext?.presaleId}
              focusedTicketId={ticketLookupContext?.ticketId}
              focusedTicketCode={ticketLookupContext?.ticketCode}
              focusedLookupQuery={ticketLookupContext?.lookupQuery}
              focusLookupKey={ticketLookupContext?.key}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="text-neutral-100">
      {loading && <div className="dp-empty mb-3">Обновление рейсов…</div>}

      {!loading && filteredTrips.length === 0 && (
        <div className="dp-empty">
          <div className="dp-empty__icon">
            <SearchX size={22} strokeWidth={2} />
          </div>
          <div className="text-base font-semibold text-neutral-100">Нет рейсов для продажи</div>
          <div className="mt-2 text-sm text-neutral-500">
            Измените фильтры или дождитесь появления новых активных слотов.
          </div>
        </div>
      )}

      <div className="dp-trip-grid grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {filteredTrips.map((trip) => {
          const available = getSlotAvailable(trip);
          const capacity = getCapacity(trip);
          const occupied = (typeof capacity === 'number') ? Math.max(0, capacity - available) : null;
          const soldOut = (typeof available === 'number') ? available <= 0 : isSlotSoldOut(trip);
          const hasDebt =
            Number(trip?.has_debt ?? trip?.hasDebt ?? 0) === 1 ||
            Number(trip?.debt_amount ?? trip?.debtAmount ?? 0) > 0;
          const showPaidFullBadge = soldOut && !hasDebt;
          const soldLevel = getSoldLevel(occupied, capacity);
          const soldUi = getSoldUi(soldLevel);
          const durationText = formatDurationMinutes(getDurationMinutes(trip));
          const fillPercent =
            (typeof occupied === 'number' && typeof capacity === 'number' && capacity > 0)
              ? Math.max(0, Math.min(100, Math.round((occupied / capacity) * 100)))
              : 0;
          const almostFull =
            (typeof available === 'number' && typeof capacity === 'number')
              ? available <= Math.max(1, Math.floor(capacity * 0.1))
              : false;
          const cardGlow =
            soldUi.tone === 'danger'
              ? 'shadow-[0_0_0_1px_rgba(248,113,113,0.12)]'
              : soldUi.tone === 'warning'
                ? 'shadow-[0_0_0_1px_rgba(251,191,36,0.12)]'
                : 'shadow-[0_0_0_1px_rgba(96,165,250,0.12)]';

          return (
            <div
              key={trip.slot_uid || trip.id}
              data-testid={`trip-card-${trip.slot_uid || trip.id}`}
              className={`dp-card dp-card--interactive dp-trip-card ${cardGlow} ${soldOut ? 'opacity-70' : ''} ${shiftClosed ? 'cursor-default' : 'cursor-pointer'} ${almostFull ? 'border-amber-300/20' : ''}`}
              onClick={shiftClosed ? undefined : () => {
                setSelectedTrip(trip);
                setTicketLookupContext(null);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <div className={dpIconWrap(dpTypeTone(trip.boat_type))}>
                      <Anchor size={18} strokeWidth={2} />
                    </div>
                    <div className="min-w-0">
                      <div className="dp-trip-card__title truncate text-lg font-bold leading-tight text-neutral-50">
                        {trip.boat_name}
                      </div>
                      <div className="dp-trip-card__meta mt-1 flex flex-wrap items-center gap-3 text-sm text-neutral-400">
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarDays size={14} strokeWidth={2} />
                          {trip.trip_date}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 size={14} strokeWidth={2} />
                          {trip.time}
                        </span>
                        <span className="dp-trip-duration-chip hidden items-center gap-1.5 sm:inline-flex">
                          <Hourglass size={14} strokeWidth={2} />
                          {durationText}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="dp-trip-card__badges mt-3 flex flex-wrap items-center gap-2">
                    <div className={dpPill(dpTypeTone(trip.boat_type))}>{typeLabel(trip.boat_type)}</div>
                    <div className={dpPill(soldUi.tone)}>{soldUi.label}</div>
                  </div>
                </div>

                {showPaidFullBadge && (
                  <div className={dpIconWrap('success')}>
                    <BadgeCheck size={20} strokeWidth={2} />
                  </div>
                )}
              </div>

              <div className="dp-trip-card__metrics mt-4 dp-grid-meta">
                <div className={dpMetric(available <= 2 ? 'warning' : 'success')}>
                  <div className="dp-metric__label">Свободно</div>
                  <div className="dp-metric__value">{available}</div>
                </div>
                <div className={dpMetric('neutral')}>
                  <div className="dp-metric__label">Вместимость</div>
                  <div className="dp-metric__value text-neutral-100">{capacity ?? '—'}</div>
                </div>
              </div>

              <div className="dp-trip-card__load mt-4 rounded-[20px] border border-white/5 bg-white/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between gap-3 text-sm text-neutral-400">
                  <span className="inline-flex items-center gap-2">
                    <Gauge size={14} strokeWidth={2} />
                    Заполнение
                  </span>
                  <span className={dpBadge(soldUi.tone)}>{fillPercent}%</span>
                </div>
                <div className="dp-progress">
                  <div
                    className={dpProgressTone(soldUi.tone)}
                    style={{ width: `${fillPercent}%` }}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm text-neutral-400">
                  <span className="inline-flex items-center gap-2">
                    <Users size={14} strokeWidth={2} />
                    Занято мест
                  </span>
                  <span className="font-semibold text-neutral-100">
                    {occupied ?? '—'} / {capacity ?? '—'}
                  </span>
                </div>
              </div>

              <div className="dp-trip-duration-mobile mt-4 flex items-center justify-between gap-3 rounded-[18px] border border-white/5 bg-white/[0.02] px-4 py-3 text-sm text-neutral-400 sm:hidden">
                <span className="inline-flex items-center gap-2">
                  <Hourglass size={14} strokeWidth={2} />
                  Длительность
                </span>
                <span className="font-semibold text-neutral-100">{durationText}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TicketSellingView;
