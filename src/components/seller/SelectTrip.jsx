import { useMemo } from 'react';
import { getSlotAvailable } from '../../utils/slotAvailability';
import {
  SellerInset,
  SellerSurface,
  sellerButtonClass,
  sellerChipClass,
  sellerHelperTextClass,
} from './sellerUi';
import DateFieldPicker from '../ui/DateFieldPicker';

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isSellableTrip(trip, cutoffMinutes = 10) {
  try {
    const dateStr = trip?.trip_date;
    const timeStr = trip?.time;
    if (!dateStr || !timeStr) return true;
    const start = new Date(`${dateStr}T${timeStr}:00`);
    if (Number.isNaN(start.getTime())) return true;
    const cutoffMs = cutoffMinutes * 60 * 1000;
    return Date.now() < start.getTime() - cutoffMs;
  } catch {
    return true;
  }
}

function formatDuration(durationMinutes) {
  if (typeof durationMinutes !== 'number' || durationMinutes <= 0) return '~1 час';
  const h = Math.floor(durationMinutes / 60);
  const m = durationMinutes % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  return `${m} мин`;
}

function getLoadAccent(percent, seatsLeft, sold, capacity) {
  if (seatsLeft <= 0 || (capacity > 0 && sold >= capacity)) {
    return {
      badge: 'bg-slate-950 text-white ring-1 ring-slate-950',
      bar: 'bg-slate-950',
      label: 'Мест нет',
    };
  }
  if (percent >= 90) {
    return {
      badge: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
      bar: 'bg-rose-500',
      label: 'Почти заполнено',
    };
  }
  if (percent >= 60) {
    return {
      badge: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
      bar: 'bg-amber-400',
      label: 'Ограниченно',
    };
  }
  return {
    badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    bar: 'bg-emerald-500',
    label: 'Много мест',
  };
}

function getActiveTelegramHoldSeats(trip) {
  const rawValue =
    trip?.telegram_active_hold_seats ??
    trip?.active_hold_seats ??
    trip?.hold_seats ??
    0;
  const normalized = Number(rawValue);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  const seats = Math.trunc(normalized);
  return seats > 0 ? seats : 0;
}

function formatHoldExpirySummary(holdExpiresAtIso, nowMs = Date.now()) {
  const parsedMs = Date.parse(String(holdExpiresAtIso || ''));
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  const remainingMs = Math.max(0, parsedMs - nowMs);
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const remainingLabel =
    totalMinutes <= 0
      ? 'expires now'
      : hours > 0
        ? `~${hours}h ${minutes}m`
        : `~${totalMinutes}m`;
  const clockLabel = new Date(parsedMs).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return { remainingLabel, clockLabel };
}

function getTripCategorySurfaceClass(trip) {
  const type = String(trip?.boat_type || trip?.type || '').toLowerCase();
  const name = String(trip?.boat_name || '').toLowerCase();

  if (type.includes('banana') || name.includes('банан')) {
    return 'border-yellow-200 bg-[linear-gradient(135deg,#ffffff_0%,#fefce8_52%,#fef3c7_100%)] shadow-[0_22px_40px_-28px_rgba(250,204,21,0.72)] ring-yellow-100/90';
  }
  if (type.includes('cruise') || type.includes('walk') || name.includes('прогул')) {
    return 'border-emerald-200 bg-[linear-gradient(135deg,#ffffff_0%,#ecfdf5_52%,#d1fae5_100%)] shadow-[0_22px_40px_-28px_rgba(16,185,129,0.64)] ring-emerald-100/90';
  }
  if (type.includes('speed') || name.includes('скорост')) {
    return 'border-sky-200 bg-[linear-gradient(135deg,#ffffff_0%,#eff6ff_52%,#dbeafe_100%)] shadow-[0_22px_40px_-28px_rgba(37,99,235,0.64)] ring-sky-100/90';
  }

  return '';
}

const SelectTrip = ({ trips, onSelect, onBack, loading, selectedDate, onDateChange }) => {
  const todayIso = useMemo(() => toISODate(new Date()), []);
  const tomorrowIso = useMemo(() => {
    const d = new Date(`${todayIso}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return toISODate(d);
  }, [todayIso]);
  const afterTomorrowIso = useMemo(() => {
    const d = new Date(`${todayIso}T00:00:00`);
    d.setDate(d.getDate() + 2);
    return toISODate(d);
  }, [todayIso]);

  const active = selectedDate || todayIso;
  const visibleTrips = useMemo(() => trips.filter((trip) => isSellableTrip(trip, 10)), [trips]);

  return (
    <div className="space-y-3" data-testid="seller-select-trip-screen">
      <SellerSurface>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Выберите рейс</h2>
        </div>

        <div className="mt-4">
          <DateFieldPicker
            value={active}
            onChange={(nextValue) => onDateChange && onDateChange(nextValue)}
            caption="Дата рейса"
            sheetTitle="Дата рейса"
            sheetDescription="Выберите удобную дату и сразу увидите доступные рейсы."
            align="center"
            size="lg"
            testId="seller-trip-date-trigger"
            inputTestId="seller-trip-date-input"
            helper="Календарь открывается снизу, а быстрые даты остаются под рукой."
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onDateChange && onDateChange(todayIso)}
            data-testid="seller-trip-date-today"
            className={sellerChipClass({ active: active === todayIso })}
          >
            Сегодня
          </button>
          <button
            type="button"
            onClick={() => onDateChange && onDateChange(tomorrowIso)}
            data-testid="seller-trip-date-tomorrow"
            className={sellerChipClass({ active: active === tomorrowIso, tone: 'accent' })}
          >
            Завтра
          </button>
          <button
            type="button"
            onClick={() => onDateChange && onDateChange(afterTomorrowIso)}
            data-testid="seller-trip-date-day2"
            className={sellerChipClass({ active: active === afterTomorrowIso, tone: 'success' })}
          >
            Послезавтра
          </button>
        </div>
      </SellerSurface>

      <div className="space-y-3">
        {loading ? (
          <div className="space-y-3" data-testid="seller-trip-loading">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-32 animate-pulse rounded-[28px] bg-white/75 shadow-[0_18px_36px_-28px_rgba(15,23,42,0.4)] ring-1 ring-slate-200"
              />
            ))}
          </div>
        ) : visibleTrips.length > 0 ? (
          visibleTrips.map((trip) => {
            const seatsLeft = getSlotAvailable(trip);
            const capacityRaw =
              typeof trip.capacity === 'number'
                ? trip.capacity
                : typeof trip.boat_capacity === 'number'
                  ? trip.boat_capacity
                  : null;
            const capacity = typeof capacityRaw === 'number' ? capacityRaw : 0;
            const sold = capacity > 0 ? Math.min(capacity, Math.max(0, capacity - seatsLeft)) : 0;
            const percent =
              capacity > 0 ? (sold >= capacity ? 100 : Math.min(99, Math.round((sold / capacity) * 100))) : 0;
            const durationMinutes =
              typeof trip.duration_minutes === 'number'
                ? trip.duration_minutes
                : typeof trip.duration === 'number'
                  ? trip.duration
                  : null;
            const holdSeats = getActiveTelegramHoldSeats(trip);
            const holdExpirySummary = formatHoldExpirySummary(
              trip?.telegram_hold_expires_at
            );
            const accent = getLoadAccent(percent, seatsLeft, sold, capacity);

            return (
              <button
                key={trip.slot_uid}
                type="button"
                onClick={() => onSelect({ ...trip, seatsLeft })}
                data-testid={`seller-trip-card-${trip.slot_uid}`}
                data-trip-type={trip?.boat_type || ''}
                data-trip-date={trip?.trip_date || ''}
                className="w-full text-left"
              >
                <SellerSurface className={`transition-transform duration-200 hover:-translate-y-0.5 ${getTripCategorySurfaceClass(trip)}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-semibold text-slate-950">{trip.boat_name || 'Рейс'}</div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-2xl bg-slate-950 px-3 py-1.5 text-xl font-semibold leading-none text-white shadow-[0_16px_28px_-20px_rgba(15,23,42,0.85)]">
                          {trip.time || '—'}
                        </span>
                        <span className="text-sm text-slate-500">{trip.trip_date || active}</span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600">
                        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium">
                          Длительность: {formatDuration(durationMinutes)}
                        </span>
                        <span className={`rounded-full px-3 py-1 font-medium ${accent.badge}`}>{accent.label}</span>
                      </div>
                    </div>

                    <div className="shrink-0 min-w-[132px]">
                      <SellerInset className="px-3 py-3">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-slate-500">Свободно</span>
                          <span data-testid={`seller-trip-free-${trip.slot_uid}`} className="text-lg font-semibold text-slate-950">
                            {seatsLeft}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                          <span className="text-slate-500">Занято</span>
                          <span className="font-semibold text-slate-900">
                            <span data-testid={`seller-trip-sold-${trip.slot_uid}`}>{sold}</span>
                            <span className="mx-1 text-slate-400">/</span>
                            <span data-testid={`seller-trip-capacity-${trip.slot_uid}`}>{capacity}</span>
                          </span>
                        </div>
                        {holdSeats > 0 && (
                          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/80 px-2.5 py-2 text-xs text-amber-900">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">Temporary hold</span>
                              <span
                                data-testid={`seller-trip-hold-seats-${trip.slot_uid}`}
                                className="font-semibold"
                              >
                                {holdSeats}
                              </span>
                            </div>
                            {holdExpirySummary && (
                              <div
                                data-testid={`seller-trip-hold-expiry-${trip.slot_uid}`}
                                className="mt-1 text-[11px] text-amber-800"
                              >
                                Until {holdExpirySummary.clockLabel} ({holdExpirySummary.remainingLabel})
                              </div>
                            )}
                          </div>
                        )}
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs font-medium text-slate-500">
                          <span>Заполнено</span>
                          <span data-testid={`seller-trip-load-${trip.slot_uid}`}>{percent}%</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className={`h-full rounded-full ${accent.bar}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </SellerInset>
                    </div>
                  </div>
                </SellerSurface>
              </button>
            );
          })
        ) : (
          <SellerSurface data-testid="seller-trip-empty">
            <div className="text-center">
              <div className="text-base font-semibold text-slate-900">Нет доступных рейсов</div>
              <p className={`mt-2 ${sellerHelperTextClass}`}>
                Попробуйте другую дату или вернитесь к выбору типа лодки.
              </p>
            </div>
          </SellerSurface>
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        data-testid="seller-trip-back"
        className={sellerButtonClass({ variant: 'secondary', size: 'lg' })}
      >
        Назад
      </button>
    </div>
  );
};

export default SelectTrip;
