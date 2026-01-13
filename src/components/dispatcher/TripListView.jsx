import { useState, useEffect, useMemo } from 'react';
import apiClient from '../../utils/apiClient';

function formatDurationMinutes(durationMinutes) {
  if (typeof durationMinutes !== 'number' || durationMinutes <= 0) return '';
  const h = Math.floor(durationMinutes / 60);
  const m = durationMinutes % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  return `${m} мин`;
}

function getCapacity(trip) {
  const cap =
    Number(trip?.capacity ?? trip?.boat_capacity ?? trip?.boatCapacity ?? trip?.max_capacity ?? trip?.maxCapacity);
  return Number.isFinite(cap) ? cap : 0;
}

function getSeatsLeft(trip) {
  const v = Number(trip?.seats_left ?? trip?.seatsLeft ?? trip?.free_seats ?? trip?.freeSeats);
  return Number.isFinite(v) ? v : 0;
}

const TripListView = ({
  dateFrom,
  dateTo,
  typeFilter = 'all',
  statusFilter = 'all',
  searchTerm = '',
  onTripCountsChange,
  shiftClosed
}) => {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadTrips = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getTrips();
      setTrips(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setTrips([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If shift is closed, we still show the trips list (visual only), no behavior changes needed here.
  const filteredTrips = useMemo(() => {
    let result = Array.isArray(trips) ? [...trips] : [];

    if (dateFrom) {
      result = result.filter(t => (t.trip_date || '') >= dateFrom);
    }
    if (dateTo) {
      result = result.filter(t => (t.trip_date || '') <= dateTo);
    }

    if (typeFilter && typeFilter !== 'all') {
      // project types are usually: speed / cruise / banana / etc.
      result = result.filter(t => (t.boat_type || t.type || '').toLowerCase() === String(typeFilter).toLowerCase());
    }

    if (statusFilter && statusFilter !== 'all') {
      // status might be on trip.is_active or status field
      const sf = String(statusFilter).toLowerCase();
      result = result.filter(t => {
        const st = String(t.status ?? (t.is_active ? 'active' : 'inactive')).toLowerCase();
        return st === sf;
      });
    }

    if (searchTerm && searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(t =>
        (t.boat_name || '').toLowerCase().includes(term) ||
        String(t.trip_date || '').includes(term) ||
        String(t.time || '').includes(term) ||
        String(t.id || '').includes(term)
      );
    }

    return result;
  }, [trips, dateFrom, dateTo, typeFilter, statusFilter, searchTerm]);

  useEffect(() => {
    onTripCountsChange?.({
      total: trips.length,
      shown: filteredTrips.length
    });
  }, [trips.length, filteredTrips.length, onTripCountsChange]);

  return (
    <div className="p-3">
      {loading && (
        <div className="text-sm text-gray-600 mb-3">
          Загрузка...
        </div>
      )}

      {!loading && filteredTrips.length === 0 && (
        <div className="text-sm text-gray-600">
          Рейсы не найдены
        </div>
      )}

      <div className="space-y-3">
        {filteredTrips.map((trip) => {
          const capacity = getCapacity(trip);
          const seatsLeft = getSeatsLeft(trip);
          const sold = Math.max(0, capacity - seatsLeft);
          const fillPercent = capacity > 0 ? Math.min(100, Math.max(0, Math.round((sold / capacity) * 100))) : 0;
          const durationLabel = formatDurationMinutes(Number(trip?.duration_minutes ?? trip?.durationMinutes));

          return (
            <div
              key={trip.slot_uid ?? trip.id}
              className="bg-white rounded-2xl shadow p-4 flex flex-col gap-3"
            >
              {/* LEFT INFO */}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true">⛵</span>
                  <div className="font-bold text-lg truncate">{trip.boat_name || 'Рейс'}</div>
                </div>

                <div className="mt-2 space-y-1 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true">📅</span>
                    <span>{trip.trip_date || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true">🕒</span>
                    <span>{trip.time || '-'}</span>
                  </div>
                  {durationLabel ? (
                    <div className="flex items-center gap-2">
                      <span aria-hidden="true">⏱️</span>
                      <span>Длительность: {durationLabel}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* RIGHT STATS */}
              <div className="w-full">
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-3">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
                      <span className="text-gray-700">Свободно</span>
                    </div>
                    <div className="font-bold text-gray-900">{seatsLeft}</div>
                  </div>

                  <div className="flex items-center justify-between text-sm mt-1">
                    <div className="text-gray-700">Занято</div>
                    <div className="font-semibold">
                      <span className="text-red-600">{sold}</span>
                      <span className="text-gray-800"> / {capacity}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-600 mt-2">
                    <div className="flex items-center gap-2">
                      <span aria-hidden="true">📊</span>
                      <span>Заполнено</span>
                    </div>
                    <div className="font-semibold text-gray-800">{fillPercent}%</div>
                  </div>

                  <div className="mt-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full"
                      style={{ width: `${fillPercent}%` }}
                    />
                  </div>
                </div>

                {/* Optional: subtle note when shiftClosed - visual only */}
                {shiftClosed ? (
                  <div className="mt-2 text-[11px] text-gray-500 text-right">
                    Смена закрыта
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TripListView;
