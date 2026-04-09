import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Anchor,
  CalendarDays,
  Clock3,
  Gauge,
  SearchX,
  Users,
} from 'lucide-react';
import apiClient from '../../utils/apiClient';
import {
  dpAlert,
  dpBadge,
  dpIconWrap,
  dpMetric,
  dpPill,
  dpProgressTone,
  dpTypeTone,
} from './dispatcherTheme';
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

function parseTripDateTime(trip) {
  const d = trip?.trip_date ? String(trip.trip_date) : '';
  const t = trip?.time ? String(trip.time) : '';
  if (!d || !t) return null;
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

function getLoadTone(left, pct) {
  if (left <= 1 || pct >= 90) return 'danger';
  if (left <= 3 || pct >= 70) return 'warning';
  if (pct >= 45) return 'info';
  return 'success';
}

const TripListView = ({
  dateFrom,
  dateTo,
  typeFilter = 'all',
  statusFilter = 'all',
  searchTerm = '',
  onTripCountsChange,
  shiftClosed,
  isActive = true,
}) => {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const inFlightRef = useRef(false);

  const loadSlots = useCallback(async (opts = {}) => {
    const silent = !!opts.silent;

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

  useEffect(() => {
    if (!isActive) return undefined;

    const intervalId = setInterval(() => {
      loadSlots({ silent: true });
    }, 5000);

    return () => clearInterval(intervalId);
  }, [loadSlots, isActive]);

  const filtered = useMemo(() => {
    const q = String(searchTerm || '').trim().toLowerCase();

    return (Array.isArray(slots) ? slots : [])
      .filter((s) => {
        if (!s || !s.trip_date) return false;

        if (dateFrom && dateTo) {
          const d = s.trip_date ? String(s.trip_date) : '';
          if (d && (d < String(dateFrom) || d > String(dateTo))) return false;
        }

        if (statusFilter && statusFilter !== 'all') {
          const st = String(s.status || s.slot_status || '').toLowerCase();
          const doneByStatus = st.includes('completed') || st.includes('done') || st.includes('finished');
          const doneByTime = isFinishedTrip(s);

          if (statusFilter === 'active') {
            if (doneByStatus || doneByTime) return false;
            if (!isActiveFlag(s)) return false;
          } else if (statusFilter === 'completed') {
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
      <div className="bg-transparent">
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
    <div className="bg-transparent">
      {err && (
        <div className={dpAlert('danger', 'mb-4')}>
          <AlertTriangle size={18} strokeWidth={2} className="mt-0.5 shrink-0" />
          <div>{err}</div>
        </div>
      )}

      {loading ? (
        <div className="dp-empty">Загрузка рейсов…</div>
      ) : filtered.length === 0 ? (
        <div className="dp-empty">
          <div className="dp-empty__icon">
            <SearchX size={22} strokeWidth={2} />
          </div>
          <div className="text-base font-semibold text-neutral-100">Рейсов не найдено</div>
          <div className="mt-2 text-sm text-neutral-500">
            Попробуйте изменить дату, тип рейса или строку поиска.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filtered.map((trip) => {
            const key = String(trip?.slot_uid ?? trip?.id ?? '');
            const left = seatLeft(trip);
            const cap = safeNum(trip?.capacity ?? trip?.boat_capacity ?? trip?.boatCapacity ?? 0, 0);
            const sold = cap > 0 ? Math.max(0, cap - left) : 0;
            const pct = cap > 0 ? Math.min(100, Math.round((sold / cap) * 100)) : 0;
            const tone = getLoadTone(left, pct);
            const toneAccent =
              tone === 'danger'
                ? 'shadow-[0_0_0_1px_rgba(244,114,182,0.12)]'
                : tone === 'warning'
                  ? 'shadow-[0_0_0_1px_rgba(251,191,36,0.12)]'
                  : tone === 'info'
                    ? 'shadow-[0_0_0_1px_rgba(96,165,250,0.12)]'
                    : 'shadow-[0_0_0_1px_rgba(74,222,128,0.12)]';

            return (
              <div
                key={key}
                data-testid={`trip-card-${trip.slot_uid || trip.slotUid || key}`}
                className={`dp-card dp-card--interactive ${toneAccent}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div className={dpIconWrap(dpTypeTone(trip.boat_type))}>
                        <Anchor size={18} strokeWidth={2} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-lg font-bold text-neutral-50">
                          {trip.boat_name || 'Рейс'}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-neutral-400">
                          <span className="inline-flex items-center gap-1.5">
                            <Clock3 size={14} strokeWidth={2} />
                            {trip.time || '—'}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarDays size={14} strokeWidth={2} />
                            {formatDateLabel(trip, dateFrom)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={dpPill(dpTypeTone(trip.boat_type))}>{typeLabel(trip.boat_type)}</div>
                </div>

                <div className="mt-4 dp-grid-meta">
                  <div className={dpMetric(tone)}>
                    <div className="dp-metric__label">Свободно</div>
                    <div className="dp-metric__value">{left}</div>
                  </div>
                  <div className={dpMetric('neutral')}>
                    <div className="dp-metric__label">Вместимость</div>
                    <div className="dp-metric__value text-neutral-100">{cap || '—'}</div>
                  </div>
                </div>

                <div className="mt-4 rounded-[20px] border border-white/5 bg-white/[0.03] p-3">
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm text-neutral-400">
                    <span className="inline-flex items-center gap-2">
                      <Gauge size={14} strokeWidth={2} />
                      Заполнение
                    </span>
                    <span className={dpBadge(tone)}>{pct}%</span>
                  </div>
                  <div className="dp-progress">
                    <div
                      className={dpProgressTone(tone)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-sm text-neutral-400">
                    <span className="inline-flex items-center gap-2">
                      <Users size={14} strokeWidth={2} />
                      Занято мест
                    </span>
                    <span className="font-semibold text-neutral-100">
                      {sold} / {cap || '—'}
                    </span>
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
