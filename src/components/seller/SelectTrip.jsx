import { useMemo } from 'react';
import { getSlotAvailable } from '../../utils/slotAvailability';

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
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
    return Date.now() < (start.getTime() - cutoffMs);
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
  const visibleTrips = useMemo(() => trips.filter(t => isSellableTrip(t, 10)), [trips]);

  return (
    <div className="flex flex-col" data-testid="seller-select-trip-screen">
      <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">Выберите рейс</h2>

      {/* Фильтр дат */}
      <div className="bg-white rounded-xl shadow-md p-4 mb-6">
        <div className="grid grid-cols-3 gap-2 mb-3">
          <button
            type="button"
            onClick={() => onDateChange && onDateChange(todayIso)}
            data-testid="seller-trip-date-today"
            className={`py-2 rounded-lg font-medium ${
              active === todayIso ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800'
            }`}
          >
            Сегодня
          </button>
          <button
            type="button"
            onClick={() => onDateChange && onDateChange(tomorrowIso)}
            data-testid="seller-trip-date-tomorrow"
            className={`py-2 rounded-lg font-medium ${
              active === tomorrowIso ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800'
            }`}
          >
            Завтра
          </button>
          <button
            type="button"
            onClick={() => onDateChange && onDateChange(afterTomorrowIso)}
            data-testid="seller-trip-date-day2"
            className={`py-2 rounded-lg font-medium ${
              active === afterTomorrowIso ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800'
            }`}
          >
            Послезавтра
          </button>
        </div>

        <input
          type="date"
          value={active}
          onChange={(e) => onDateChange && onDateChange(e.target.value)}
          data-testid="seller-trip-date-input"
          className="w-full px-3 py-2 border rounded-lg border-gray-300"
        />
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="space-y-4" data-testid="seller-trip-loading">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-xl shadow-md p-6 animate-pulse h-24" />
            ))}
          </div>
        ) : (
          <>
            {visibleTrips.map(trip => {
              const seatsLeft = getSlotAvailable(trip);

              const capacityRaw =
                typeof trip.capacity === 'number'
                  ? trip.capacity
                  : typeof trip.boat_capacity === 'number'
                  ? trip.boat_capacity
                  : null;

              const capacity = typeof capacityRaw === 'number' ? capacityRaw : 0;
              const sold = Math.max(0, capacity - seatsLeft);
              const percent =
                capacity > 0 ? Math.round((sold / capacity) * 100) : 0;

              const durationMinutes =
                typeof trip.duration_minutes === 'number'
                  ? trip.duration_minutes
                  : typeof trip.duration === 'number'
                  ? trip.duration
                  : null;

              return (
                <div
                  key={trip.slot_uid}
                  onClick={() => onSelect({ ...trip, seatsLeft })}
                  data-testid={`seller-trip-card-${trip.slot_uid}`}
                  data-trip-type={trip?.boat_type || ''}
                  data-trip-date={trip?.trip_date || ''}
                  className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 flex justify-between gap-4 cursor-pointer hover:shadow-md active:shadow-sm active:scale-[0.99] transition"
                >
                  {/* Левая часть */}
                  <div>
                    <div className="font-bold text-lg text-gray-900">{trip.boat_name}</div>

                    <div className="mt-1 flex items-center gap-2 text-base text-gray-800">
                      <span className="text-blue-600 text-lg">📅</span>
                      <span>{trip.trip_date} • {trip.time}</span>
                    </div>

                    <div className="mt-0.5 flex items-center gap-2 text-base text-gray-700">
                      <span className="text-blue-600 text-lg">⏱</span>
                      <span>Длительность: {formatDuration(durationMinutes)}</span>
                    </div>
                  </div>

                  {/* Правая мини-карточка */}
                  <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 min-w-[128px] text-gray-900">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="flex items-center gap-1 text-gray-700">
                        <span className="w-2 h-2 bg-green-500 rounded-full" />
                        Свободно
                      </span>
                      <span data-testid={`seller-trip-free-${trip.slot_uid}`} className="font-bold">{seatsLeft}</span>
                    </div>

                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700">Занято</span>
                      <span className="font-bold">
                        <span data-testid={`seller-trip-sold-${trip.slot_uid}`} className="text-red-600">{sold}</span> / <span data-testid={`seller-trip-capacity-${trip.slot_uid}`}>{capacity}</span>
                      </span>
                    </div>

                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <span>Заполнено</span>
                      <span data-testid={`seller-trip-load-${trip.slot_uid}`}>{percent}%</span>
                    </div>

                    <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-3 bg-green-500 rounded-full"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {visibleTrips.length === 0 && (
              <div data-testid="seller-trip-empty" className="text-center py-8 text-gray-500">
                Нет доступных рейсов
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-6">
        <button
          onClick={onBack}
          data-testid="seller-trip-back"
          className="w-full py-3 bg-gray-300 text-gray-800 rounded-lg font-medium"
        >
          Назад
        </button>
      </div>
    </div>
  );
};

export default SelectTrip;
