import { useState, useEffect } from 'react';
import { formatRUB } from '../../utils/currency';
import { getSlotAvailable } from '../../utils/slotAvailability';

const SelectSeats = ({ 
  trip, 
  onConfirm, 
  onBack, 
  numberOfSeats, 
  setNumberOfSeats,
  customerName,
  setCustomerName,
  customerPhone,
  setCustomerPhone,
  prepaymentStr,
  setPrepaymentStr,
  validateCustomerInputs,
  apiUrl,
  lastError,
  isSubmitting // Add isSubmitting prop
}) => {
  // Initialize local state with prop values
  const [seats, setSeats] = useState(numberOfSeats || 1);
  const [ticketBreakdown, setTicketBreakdown] = useState({ adult: 0, teen: 0, child: 0 });
  const [localCustomerName, setLocalCustomerName] = useState(customerName || '');
  const [localCustomerPhone, setLocalCustomerPhone] = useState(customerPhone || '');
  const [localPrepaymentStr, setLocalPrepaymentStr] = useState(prepaymentStr || "");
  const [errors, setErrors] = useState({});
  const [prepaymentError, setPrepaymentError] = useState('');
  const [touched, setTouched] = useState({
    customerName: false,
    customerPhone: false
  });
  const isBananaTrip = trip?.boat_type === 'banana';


  // Update local state when props change
  useEffect(() => {
    setSeats(numberOfSeats || 1);
  }, [numberOfSeats]);
  
  // Calculate total seats from breakdown when breakdown changes and sync to parent
  useEffect(() => {
    const total = (ticketBreakdown.adult ?? 0) + (ticketBreakdown.teen ?? 0) + (ticketBreakdown.child ?? 0);
    setSeats(total);
    // Update parent state if callback is provided
    if (setNumberOfSeats) {
      setNumberOfSeats(total);
    }
  }, [ticketBreakdown, setNumberOfSeats]);

  // Для банана: подросток не используется — гарантируем teen = 0 (защита от скрытых мест и багов)
  useEffect(() => {
    if (!isBananaTrip) return;
    if ((ticketBreakdown?.teen ?? 0) === 0) return;
    setTicketBreakdown(prev => ({ ...prev, teen: 0 }));
  }, [isBananaTrip, ticketBreakdown?.teen]);

  useEffect(() => {
    setLocalCustomerName(customerName || '');
  }, [customerName]);

  useEffect(() => {
    setLocalCustomerPhone(customerPhone || '');
  }, [customerPhone]);

  useEffect(() => {
    setLocalPrepaymentStr(prepaymentStr || "");
  }, [prepaymentStr]);

  const incrementTicket = (type) => {
    if (!type) return;
    const maxSeats = getSlotAvailable(trip);
    const total =
      (ticketBreakdown.adult ?? 0) +
      (ticketBreakdown.teen ?? 0) +
      (ticketBreakdown.child ?? 0);
    if (trip?.boat_type === 'banana' && type === 'teen') return;
    if (total < maxSeats) {
      setTicketBreakdown(prev => ({
        ...prev,
        [type]: (prev[type] ?? 0) + 1
      }));
    }
  };
  
  const decrementTicket = (type) => {
    if (!type) return;
    setTicketBreakdown(prev => {
      const cur = prev[type] ?? 0;
      if (cur > 0) return { ...prev, [type]: cur - 1 };
      return prev;
    });
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setLocalCustomerName(value);
    // Update parent state immediately
    if (setCustomerName) {
      setCustomerName(value);
    }
    // Clear error when user starts typing
    if (touched.customerName && errors.customerName) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors['customerName'];
        return newErrors;
      });
    }
  };

  const handlePhoneChange = (e) => {
    const value = e.target.value;
    setLocalCustomerPhone(value);
    // Update parent state immediately
    if (setCustomerPhone) {
      setCustomerPhone(value);
    }
    // Clear error when user starts typing
    if (touched.customerPhone && errors.customerPhone) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors['customerPhone'];
        return newErrors;
      });
    }
  };

  const handlePrepaymentChange = (e) => {
    const value = e.target.value;
    setLocalPrepaymentStr(value);
    // Update parent state immediately
    if (setPrepaymentStr) {
      setPrepaymentStr(value);
    }
    
    // Clear prepayment error when user types
    setPrepaymentError('');
  };

  const handleConfirm = () => {
    // Push action to debug store
    if (window.__debugPushAction) {
      window.__debugPushAction({
        type: 'PRESALE_CLICK',
        payload: {
          slotUid: trip?.slot_uid,
          numberOfSeats: seats,
          customerName: localCustomerName,
          customerPhone: localCustomerPhone
        },
        ts: Date.now()
      });
    }

    try {
      // Mark all fields as touched to show validation errors
      setTouched({
        customerName: true,
        customerPhone: true
      });

      // Validate inputs
      const validationErrors = validateCustomerInputs ? validateCustomerInputs() : {};
      setErrors(validationErrors);

      // If validation errors exist, log them as API errors
      if (Object.keys(validationErrors).length > 0) {
        if (window.__debugPushAction) {
          window.__debugPushAction({
            type: 'API_ERROR',
            payload: {
              status: 0,
              code: 'VALIDATION_BLOCKED',
              message: 'Form validation failed',
              debug: validationErrors
            },
            ts: Date.now()
          });
        }
        return;
      }

      // If no errors, proceed to confirmation
      onConfirm(seats, ticketBreakdown, totalPrice);
    } catch (error) {
      // If exception occurs before request, log it
      if (window.__debugPushAction) {
        window.__debugPushAction({
          type: 'API_ERROR',
          payload: {
            status: 0,
            code: 'FRONTEND_PRE_REQUEST',
            message: error.message,
            stack: error.stack
          },
          ts: Date.now()
        });
      }
      console.error('Error in handleConfirm:', error);
    }
  };

  const totalPrice = trip ? 
    (ticketBreakdown.adult * (trip.price_adult || trip.price)) +
    (ticketBreakdown.teen * (trip.price_teen || trip.price)) +
    (ticketBreakdown.child * (trip.price_child || trip.price))
    : 0;
  
  // Calculate prepayment amount from string value
  const prepaymentAmount = parseFloat(localPrepaymentStr) || 0;
  
  // Check if prepayment is valid (not greater than total price)
  const isPrepaymentValid = prepaymentAmount <= totalPrice && prepaymentAmount >= 0;
  
  // Check if form is valid
  const isFormValid = (() => {
    // Check if all required fields are valid
    const hasName = localCustomerName && localCustomerName.trim().length >= 2;
    const phoneDigits = localCustomerPhone.replace(/\D/g, "");
    const hasValidPhone = phoneDigits.length === 11;
    const hasValidSeats = seats >= 1;
    
    // For banana trips, check that teen tickets are not used
    const isBananaTrip = trip?.boat_type === 'banana';
    const hasValidTicketBreakdown = !isBananaTrip || ticketBreakdown.teen === 0;
    
    // Also check prepayment validity
    return hasName && hasValidPhone && hasValidSeats && isPrepaymentValid && hasValidTicketBreakdown;
  sValidTicketBreakdown;
  })();
  
  // Update prepayment error message
  useEffect(() => {
    if (prepaymentAmount > totalPrice && totalPrice > 0) {
      setPrepaymentError('Предоплата не может быть больше суммы заказа');
    } else if (prepaymentAmount < 0) {
      setPrepaymentError('Предоплата не может быть отрицательной');
    } else {
      setPrepaymentError('');
    }
  }, [prepaymentAmount, totalPrice]);

  return (
    <div className="flex flex-col">
      <h2 className="text-2xl font-extrabold text-gray-900 mb-5 text-center">Количество мест</h2>

      {/* Trip Details */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4">
        <h3 className="font-bold text-lg mb-1 text-gray-900">Детали рейса</h3>
        <p className="text-gray-700 text-sm">
          <span className="font-semibold">{trip?.boat_name || '—'}</span>
          <span className="mx-2 text-gray-400">•</span>
          <span className="font-semibold">{trip?.time || '—'}</span>
          {trip?.duration ? (
            <>
              <span className="mx-2 text-gray-400">•</span>
              <span className="text-gray-700">Длительность: <span className="font-semibold">{trip?.duration}</span></span>
            </>
          ) : null}
        </p>

        {/* Banana warning */}
        {trip?.boat_type === 'banana' && (
          <div className="mt-3 rounded-xl bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-900">
            Банан: только взрослый/детский билет, вместимость 12 мест
          </div>
        )}
      </div>

      {/* Seats / Breakdown */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4">
        <h3 className="font-bold text-lg mb-4 text-gray-900">Количество мест</h3>

        <div className={`grid ${isBananaTrip ? "grid-cols-2" : "grid-cols-3"} gap-x-8 gap-y-6 justify-items-center max-w-[520px] mx-auto`}>
          {/* Adult */}
          <div className="text-center">
            <p className="text-xs font-extrabold text-gray-800 uppercase tracking-wider">Взрослый</p>
            <div className="mt-3 inline-flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => decrementTicket('adult')}
                disabled={ticketBreakdown.adult <= 0}
                className="w-11 h-11 rounded-2xl bg-white border border-gray-300 shadow-sm flex items-center justify-center text-2xl font-extrabold text-gray-900 disabled:opacity-40"
              >
                −
              </button>

              <span className="w-8 text-center text-2xl font-extrabold text-gray-900 tabular-nums">
                {ticketBreakdown.adult}
              </span>

              <button
                type="button"
                onClick={() => incrementTicket('adult')}
                disabled={(ticketBreakdown.adult + ticketBreakdown.teen + ticketBreakdown.child) >= getSlotAvailable(trip)}
                className="w-11 h-11 rounded-2xl bg-white border border-gray-300 shadow-sm flex items-center justify-center text-2xl font-extrabold text-gray-900 disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>

          {/* Teen */}
          {!isBananaTrip && (
            <div className="text-center">
              <p className="text-xs font-extrabold text-gray-800 uppercase tracking-wider">Подросток</p>
              <div className="mt-3 inline-flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => decrementTicket('teen')}
                  disabled={ticketBreakdown.teen <= 0}
                  className="w-11 h-11 rounded-2xl bg-white border border-gray-300 shadow-sm flex items-center justify-center text-2xl font-extrabold text-gray-900 disabled:opacity-40"
                >
                  −
                </button>

                <span className="w-8 text-center text-2xl font-extrabold text-gray-900 tabular-nums">
                  {ticketBreakdown.teen}
                </span>

                <button
                  type="button"
                  onClick={() => incrementTicket('teen')}
                  disabled={(ticketBreakdown.adult + ticketBreakdown.teen + ticketBreakdown.child) >= getSlotAvailable(trip)}
                  className="w-11 h-11 rounded-2xl bg-white border border-gray-300 shadow-sm flex items-center justify-center text-2xl font-extrabold text-gray-900 disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* Child */}
          <div className="text-center">
            <p className="text-xs font-extrabold text-gray-800 uppercase tracking-wider">Детский</p>
            <div className="mt-3 inline-flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => decrementTicket('child')}
                disabled={ticketBreakdown.child <= 0}
                className="w-11 h-11 rounded-2xl bg-white border border-gray-300 shadow-sm flex items-center justify-center text-2xl font-extrabold text-gray-900 disabled:opacity-40"
              >
                −
              </button>

              <span className="w-8 text-center text-2xl font-extrabold text-gray-900 tabular-nums">
                {ticketBreakdown.child}
              </span>

              <button
                type="button"
                onClick={() => incrementTicket('child')}
                disabled={(ticketBreakdown.adult + ticketBreakdown.teen + ticketBreakdown.child) >= getSlotAvailable(trip)}
                className="w-11 h-11 rounded-2xl bg-white border border-gray-300 shadow-sm flex items-center justify-center text-2xl font-extrabold text-gray-900 disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 text-center">
          <p className="font-bold text-gray-900">
            Итого: <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-gray-300 bg-white text-gray-900 tabular-nums">{seats}</span> мест
          </p>
          <p className="text-sm text-gray-600 mt-1">Максимум {getSlotAvailable(trip)} мест доступно</p>
        </div>

        {/* Ticket prices (visible) */}
        <div className="mt-4 rounded-2xl border border-gray-300 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-extrabold text-gray-900 tracking-wide">Стоимость билетов</p>
            <span className="text-xs font-semibold text-gray-600">за 1 место</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 border border-gray-200">
              <span className="text-sm font-semibold text-gray-800">Взрослый</span>
              <span className="text-sm font-extrabold text-gray-900 tabular-nums">
                {formatRUB(trip?.price_adult || trip?.price)}
              </span>
            </div>

            {!isBananaTrip && (
              <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 border border-gray-200">
                <span className="text-sm font-semibold text-gray-800">Подросток</span>
                <span className="text-sm font-extrabold text-gray-900 tabular-nums">
                  {formatRUB(trip?.price_teen || trip?.price)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 border border-gray-200">
              <span className="text-sm font-semibold text-gray-800">Детский</span>
              <span className="text-sm font-extrabold text-gray-900 tabular-nums">
                {formatRUB(trip?.price_child || trip?.price)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Customer Information Section */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4">
        <h3 className="font-bold text-lg mb-4 text-gray-900">Информация о клиенте</h3>

        <div className="mb-4">
          <label className="block text-gray-800 text-sm font-bold mb-2" htmlFor="customerName">Имя клиента</label>

          <div className="grid grid-cols-3 gap-2 mb-2">
            {['Алексей','Дмитрий','Иван','Анна','Мария','Елена'].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setLocalCustomerName(n);
                  if (setCustomerName) setCustomerName(n);
                }}
                className={`py-2 rounded-lg font-semibold transition ${
                  localCustomerName === n ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-900 hover:bg-blue-200 active:bg-blue-300'
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <input
            id="customerName"
            type="text"
            value={localCustomerName}
            onChange={handleNameChange}
            onBlur={() => setTouched(prev => ({ ...prev, customerName: true }))}
            className="shadow-sm border border-gray-300 rounded-xl w-full py-3 px-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="Введите имя"
          />
          {touched.customerName && errors.customerName && (
            <p className="text-red-600 text-xs mt-1">{errors.customerName}</p>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-gray-800 text-sm font-bold mb-2" htmlFor="customerPhone">Телефон клиента</label>
          <input
            id="customerPhone"
            type="tel"
            value={localCustomerPhone}
            onChange={handlePhoneChange}
            onBlur={() => setTouched(prev => ({ ...prev, customerPhone: true }))}
            className="shadow-sm border border-gray-300 rounded-xl w-full py-3 px-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="+7 9xx xxx-xx-xx"
          />
          {touched.customerPhone && errors.customerPhone && (
            <p className="text-red-600 text-xs mt-1">{errors.customerPhone}</p>
          )}
        </div>

        <div className="mb-1">
          <label className="block text-gray-800 text-sm font-bold mb-2" htmlFor="prepayment">Предоплата (₽)</label>

          <div className="grid grid-cols-3 gap-2 mb-2">
            {[500, 1000, 2000].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setLocalPrepaymentStr(String(v));
                  if (setPrepaymentStr) setPrepaymentStr(String(v));
                }}
                className="py-2 rounded-lg font-semibold bg-blue-100 text-blue-900 hover:bg-blue-200 active:bg-blue-300 transition"
              >
                {v} ₽
              </button>
            ))}
          </div>

          <input
            id="prepayment"
            type="number"
            value={localPrepaymentStr}
            onChange={handlePrepaymentChange}
            className="shadow-sm border border-gray-300 rounded-xl w-full py-3 px-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="0"
            min="0"
          />

          {prepaymentError && (
            <p className="text-red-600 text-xs mt-1">{prepaymentError}</p>
          )}
        </div>
      </div>

      {/* Total */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-900 font-bold">Итого:</span>
          <span className="text-blue-700 font-extrabold text-xl tabular-nums">{formatRUB(totalPrice)}</span>
        </div>
        {lastError && (
          <div className="mt-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
            {lastError}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          type="button"
          className="flex-1 py-4 text-lg font-bold rounded-xl bg-gray-200 text-gray-900 hover:bg-gray-300 active:bg-gray-400 shadow"
        >
          Назад
        </button>

        <button
          onClick={handleConfirm}
          type="button"
          disabled={!isFormValid || isSubmitting}
          className={`flex-1 py-4 text-lg font-bold rounded-xl shadow transform transition ${
            isFormValid && !isSubmitting
              ? 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
              : 'bg-gray-400 text-gray-200 cursor-not-allowed'
          }`}
        >
          Создать предзаказ
        </button>
      </div>
    </div>
  );
};

export default SelectSeats;
