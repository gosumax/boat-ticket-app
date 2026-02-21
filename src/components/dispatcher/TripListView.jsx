import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import apiClient from '../../utils/apiClient';
import PassengerList from './PassengerList';

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function seatLeft(trip) {
  const left = safeNum(trip?.seats_left ?? trip?.seatsLeft ?? trip?.free_seats ?? trip?.freeSeats, NaN);
  if (Number.isFinite(left)) return Math.max(0, left);
  const cap = safeNum(trip?.capacity ?? trip?.boat_capacity ?? trip?.boatCapacity ?? 0, 0);
  return cap;
}

function formatDateLabel(trip, fallbackDate) {
  const raw = trip?.trip_date ? String(trip.trip_date) : (fallbackDate ? String(fallbackDate) : '');
  if (!raw) return '—';
  const parts = raw.split('-');
  if (parts.length === 3) return `${parts[2]}.${parts[1]}`;
  return raw;
}

function normalizeType(t) {
  const v = String(t || '').toLowerCase();
  if (v.includes('banana') || v === 'banana') return 'banana';
  if (v.includes('speed') || v.includes('fast') || v.includes('скор')) return 'speed';
  if (v.includes('cruise') || v.includes('walk') || v.includes('прог')) return 'cruise';
  return v || 'other';
}

function typeLabel(type) {
  const t = normalizeType(type);
  if (t === 'banana') return 'Банан';
  if (t === 'speed') return 'Скоростная';
  if (t === 'cruise') return 'Прогулочная';
  return 'Рейс';
}

function typePill(type) {
  const t = normalizeType(type);
  if (t === 'banana') return 'bg-fuchsia-600/15 border-fuchsia-700/40 text-fuchsia-200';
  if (t === 'speed') return 'bg-sky-600/15 border-sky-700/40 text-sky-200';
  if (t === 'cruise') return 'bg-emerald-600/15 border-emerald-700/40 text-emerald-200';
  return 'bg-neutral-700/20 border-neutral-700/40 text-neutral-200';
}

function parseTripDateTime(trip) {
  const d = trip?.trip_date ? String(trip.trip_date) : '';
  const t = trip?.time ? String(trip.time) : '';
  if (!d || !t) return null;
  // local time (no timezone suffix)
  const dt = new Date(`${d}T${t}:00`);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt;
}

function isFinishedTrip(trip) {
  const dt = parseTripDateTime(trip);
  if (!dt) return false;
  return dt.getTime() < Date.now();
}

function isActiveFlag(trip) {
  const v = trip?.is_active ?? trip?.active ?? trip?.isActive;
  if (v == null) return true;
  return Boolean(Number(v));
}

const TripListView = ({
  dateFrom,
  dateTo,
  typeFilter = 'all',
  statusFilter = 'all',
  searchTerm = '',
  onTripCountsChange,
  shiftClosed,
  isActive = true
}) => {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null); // drilldown disabled
  const inFlightRef = useRef(false);

  const loadSlots = useCallback(async (opts = {}) => {
    const silent = !!opts.silent;
    
    // Prevent overlapping requests
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const resp = await apiClient.getAllDispatcherSlots();
      const arr = resp?.data || resp?.slots || resp || [];
      setSlots(Array.isArray(arr) ? arr : []);
    } catch (e) {
      setErr(e?.message || 'Ошибка загрузки рейсов');
      // Keep previous slots on error to avoid flicker
    } finally {
      if (!silent) setLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadSlots();
    const handler = () => loadSlots({ silent: true });
    window.addEventListener('dispatcher:refresh', handler);
    return () => window.removeEventListener('dispatcher:refresh', handler);
  }, [loadSlots]);

  // Polling: auto-refresh every 5s when component is active (trips tab visible)
  useEffect(() => {
    if (!isActive) return;
    
    const intervalId = setInterval(() => {
      loadSlots({ silent: true });
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [loadSlots, isActive]);

  const filtered = useMemo(() => {
    const q = String(searchTerm || '').trim().toLowerCase();

    return (Array.isArray(slots) ? slots : [])
      .filter((s) => {
        if (!s) return false;

        
        // hide any slots without a concrete trip_date (templates/invalid rows)
        if (!s.trip_date) return false;
if (dateFrom && dateTo) {
          const d = s.trip_date ? String(s.trip_date) : '';
          if (d && (d < String(dateFrom) || d > String(dateTo))) return false;
        }

        if (statusFilter && statusFilter !== 'all') {
          const st = String(s.status || s.slot_status || '').toLowerCase();
          const doneByStatus = st.includes('completed') || st.includes('done') || st.includes('finished');
          const doneByTime = isFinishedTrip(s);

          if (statusFilter === 'active') {
            // "Активные" = продаются сейчас: не ушёл по времени + активен (не отменён)
            if (doneByStatus || doneByTime) return false;
            if (!isActiveFlag(s)) return false;
          } else if (statusFilter === 'completed') {
            // "Завершённые" = уже ушёл (по времени) или явно помечен как completed
            if (!(doneByStatus || doneByTime)) return false;
          }
        }

        if (typeFilter && typeFilter !== 'all') {
          const t = normalizeType(s.boat_type || s.type);
          if (t !== typeFilter) return false;
        }

        if (q) {
          const name = String(s.boat_name || s.name || '').toLowerCase();
          const time = String(s.time || '').toLowerCase();
          const d = String(s.trip_date || '').toLowerCase();
          if (!name.includes(q) && !time.includes(q) && !d.includes(q)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const ad = a.trip_date ? String(a.trip_date) : '';
        const bd = b.trip_date ? String(b.trip_date) : '';
        if (ad !== bd) return ad.localeCompare(bd);
        return String(a.time || '').localeCompare(String(b.time || ''));
      });
  }, [slots, dateFrom, dateTo, typeFilter, statusFilter, searchTerm]);

  useEffect(() => {
    onTripCountsChange?.({ total: slots.length, shown: filtered.length });
  }, [slots.length, filtered.length, onTripCountsChange]);

  const refreshAllSlots = useCallback(() => loadSlots(), [loadSlots]);

  if (selectedTrip) {
    return (
      <div className="bg-neutral-950">
        <PassengerList
          trip={selectedTrip}
          onBack={() => setSelectedTrip(null)}
          onClose={() => setSelectedTrip(null)}
          refreshAllSlots={refreshAllSlots}
          shiftClosed={shiftClosed}
        />
      </div>
    );
  }

  return (
    <div className="bg-neutral-950">
      {err && (
        <div className="mb-4 rounded-xl border border-red-900 bg-red-950/40 px-4 py-3 text-red-200">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-neutral-400">Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center text-neutral-400">
          Рейсов нет
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
          {filtered.map((trip) => {
            const key = String(trip?.slot_uid ?? trip?.id ?? '');
            const left = seatLeft(trip);
            const cap = safeNum(trip?.capacity ?? trip?.boat_capacity ?? trip?.boatCapacity ?? 0, 0);
            const sold = cap > 0 ? Math.max(0, cap - left) : 0;
            const pct = cap > 0 ? Math.min(100, Math.round((sold / cap) * 100)) : 0;
            const filled = Math.max(0, Math.min(cap, sold));
            const warn = Number.isFinite(left) && left <= 2 ? 'text-amber-200' : 'text-emerald-200';

            return (
              <div
                key={key}
                data-testid={`trip-card-${trip.slot_uid || trip.slotUid || key}`}
                className={`relative text-left rounded-2xl border border-neutral-800 bg-neutral-900 p-3 pointer-events-none ${filled <= 4 ? "ring-2 ring-red-500/40 shadow-[0_0_18px_rgba(239,68,68,0.25)]" : filled <= 9 ? "ring-2 ring-amber-400/40 shadow-[0_0_18px_rgba(251,191,36,0.25)]" : "ring-2 ring-emerald-500/40 shadow-[0_0_18px_rgba(16,185,129,0.28)]"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="text-base font-bold truncate text-neutral-100" style={{ fontSize: "130%" }}>
                        {trip.boat_name || 'Рейс'}
                      </div>
</div>
                    <div className="mt-1 text-sm text-neutral-400 flex flex-wrap gap-x-2 gap-y-1" style={{ fontSize: "130%" }}>
                      <span>🕒 {trip.time || '—'}</span>
                      <span className="text-neutral-700">•</span>
                      <span>📅 {formatDateLabel(trip, dateFrom)}</span>
                    </div>
                  </div>

                  <div className={`shrink-0 px-2.5 py-1 rounded-xl border text-xs font-bold ${typePill(trip.boat_type)}`}>
                    {typeLabel(trip.boat_type)}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                    <div className="text-xs text-neutral-500">Свободно</div>
                    <div className={`text-2xl font-black ${warn}`}>{left}</div>
                  </div>
                  <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                    <div className="text-xs text-neutral-500">Вместимость</div>
                    <div className="text-2xl font-black text-neutral-100">{cap || '—'}</div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
                    <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                    <span>Заполнено</span>
                    <span className="text-neutral-200 font-semibold">{pct}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TripListView;
