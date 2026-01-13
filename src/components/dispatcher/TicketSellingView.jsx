import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import apiClient from '../../utils/apiClient';
import PassengerList from './PassengerList';
import { getSlotAvailable, isSlotSoldOut } from '../../utils/slotAvailability';

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
  // If capacity is the standard 12 seats, apply the requested absolute thresholds.
  if (capacity === 12) {
    if (occupied < 4) return 'low';
    if (occupied < 8) return 'mid';
    return 'high';
  }
  // Otherwise use percent thresholds.
  const ratio = occupied / capacity;
  if (ratio < 0.34) return 'low';
  if (ratio < 0.67) return 'mid';
  return 'high';
}

function getSoldUi(level) {
  switch (level) {
    case 'low':
      return { text: 'text-red-600', bar: 'bg-red-500', ring: 'ring-red-200' };
    case 'mid':
      return { text: 'text-yellow-600', bar: 'bg-yellow-500', ring: 'ring-yellow-200' };
    case 'high':
      return { text: 'text-green-600', bar: 'bg-green-500', ring: 'ring-green-200' };
    default:
      return { text: 'text-neutral-200', bar: 'bg-gray-400', ring: 'ring-gray-200' };
  }
}

const TicketSellingView = ({
  dateFrom,
  dateTo,
  typeFilter = 'all',
  statusFilter = 'all',
  searchTerm = '',
  onTripCountsChange,
  refreshAllSlots,
  shiftClosed
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
  const didInitRef = useRef(false);
  const inFlightRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const sigRef = useRef('');

  const loadTrips = useCallback(async (opts = {}) => {
    const silent = !!opts.silent;
    const force = !!opts.force;
    if (inFlightRef.current) {
      pendingReloadRef.current = true;
      return;
    }
    inFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const data = await apiClient.getTrips();
      let next = [];
      if (Array.isArray(data)) next = data;
      else if (data?.slots && Array.isArray(data.slots)) next = data.slots;
      else if (data?.data && Array.isArray(data.data)) next = data.data;

      // Avoid useless state updates (prevents blinking), but include dynamic fields
      const sig = JSON.stringify(next.map(t => ({
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
        try { sessionStorage.setItem('dispatcher_trips_cache', JSON.stringify(next)); } catch {}
      }
} catch (e) {
      console.error(e);
      // keep previous trips to avoid flicker
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
    try { window.addEventListener('dispatcher:slots-changed', h); } catch {}
    return () => {
      try { window.removeEventListener('dispatcher:slots-changed', h); } catch {}
    };
  }, [loadTrips]);



  const isInDateRange = (trip) => {
    if (!trip.trip_date) return true;
    if (!dateFrom || !dateTo) return true;
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
      result = result.filter(t => t.boat_type === typeFilter);
    }

    if (statusFilter !== 'all') {
      result = result.filter(t => {
        if (statusFilter === 'active') return t.is_active === 1 && !isFinished(t);
        if (statusFilter === 'completed') return isFinished(t);
        return true;
      });
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(t =>
        (t.boat_name || '').toLowerCase().includes(term) ||
        String(t.id).includes(term)
      );
    }

    return result;
  }, [trips, dateFrom, dateTo, typeFilter, statusFilter, searchTerm]);

  useEffect(() => {
    onTripCountsChange?.({
      total: trips.length,
      shown: filteredTrips.length
    });
  }, [trips.length, filteredTrips.length]);

  if (selectedTrip) {
    return (
      <PassengerList
        trip={selectedTrip}
        onBack={() => setSelectedTrip(null)}
        refreshTrips={loadTrips}
        refreshAllSlots={refreshAllSlots}
        shiftClosed={shiftClosed}
      />
    );
  }

  return (
    <div className="text-neutral-100">
      {loading && <div className="text-center py-2 text-neutral-400 text-sm">Обновление…</div>}

      {!loading && filteredTrips.length === 0 && (
        <div className="text-center py-6 text-neutral-500">
          Нет рейсов
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        {filteredTrips.map(trip => {
          const available = getSlotAvailable(trip);
          const capacity = getCapacity(trip);
          const occupied = (typeof capacity === 'number') ? Math.max(0, capacity - available) : null;

          const soldLevel = getSoldLevel(occupied, capacity);
          const soldUi = getSoldUi(soldLevel);

          const durationText = formatDurationMinutes(getDurationMinutes(trip));

          const fillPercent =
            (typeof occupied === 'number' && typeof capacity === 'number' && capacity > 0)
              ? Math.max(0, Math.min(100, Math.round((occupied / capacity) * 100)))
              : 0;

          // подсветка карточки если почти полный (<= 10% мест или <= 1 место)
          const almostFull =
            (typeof available === 'number' && typeof capacity === 'number')
              ? available <= Math.max(1, Math.floor(capacity * 0.1))
              : false;

          return (
            <div
              key={trip.slot_uid || trip.id}
              className={`rounded-2xl border border-neutral-800 bg-neutral-900 p-3 cursor-pointer transition-all ${almostFull ? `ring-2 ${soldUi.ring}` : ''} ${isSlotSoldOut(trip) ? 'opacity-60' : ''}`}
              onClick={shiftClosed ? undefined : () => setSelectedTrip(trip)}
            >
              <div className="flex flex-col">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg leading-none">🚤</span>
                    <div className="font-semibold text-lg leading-tight truncate text-neutral-100">{trip.boat_name}</div>
                  </div>

                  <div className="mt-1 flex items-center gap-2 text-sm text-neutral-300">
                    <span className="leading-none">📅</span>
                    <span>{trip.trip_date}</span>
                    <span className="text-gray-300">•</span>
                    <span className="leading-none">🕒</span>
                    <span>{trip.time}</span>
                  </div>

                  <div className="mt-1 flex items-center gap-2 text-sm text-neutral-400">
                    <span className="leading-none">⏱️</span>
                    <span>Длительность: {durationText}</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-col gap-2">
                  <div className="bg-neutral-950/40 border border-neutral-800 rounded-xl px-3 py-2 text-sm w-full">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-neutral-400 flex items-center gap-1">
                        <span className="leading-none">🟢</span>
                        Свободно
                      </span>
                      <span className="font-bold text-neutral-100">{available}</span>
                    </div>

                    {(typeof occupied === 'number' && typeof capacity === 'number') && (
                      <div className="mt-1 flex items-center justify-between gap-3">
                        <span className="text-neutral-400 flex items-center gap-1">
                          <span className="leading-none">👥</span>
                          Занято
                        </span>
                        <span className={`font-bold ${soldUi.text}`}>
                          {occupied} / {capacity}
                        </span>
                      </div>
                    )}
                  </div>

                  {(typeof occupied === 'number' && typeof capacity === 'number') && (
                    <div className="w-full">
                      <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
                        <span className="flex items-center gap-1"><span>📊</span>Заполнено</span>
                        <span className="font-semibold text-neutral-200">{fillPercent}%</span>
                      </div>
                      <div className="h-2 w-full bg-neutral-800 rounded-full overflow-hidden">
                        <div
                          className={`h-2 ${soldUi.bar} rounded-full`}
                          style={{ width: `${fillPercent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TicketSellingView;
