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
      <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Количество мест</h2>
      
      {/* Debug information - only shown in development */}
      {process.env.NODE_ENV === 'development' && (
        <div className="space-y-2 mb-4">
          {lastError && lastError.resolvedUrl && lastError.status !== 400 && (
            <div className="bg-red-100 border-l-4 border-red-500 p-2">
              <p className="text-sm text-red-700">
                <strong>Presale create failed:</strong> {lastError.status} - {lastError.message}
              </p>
              <p className="text-sm text-red-700">
                Request: {lastError.method} {lastError.resolvedUrl}
              </p>
            </div>
          )}
          {lastError && !lastError.resolvedUrl && lastError.status !== 400 && (
            <div className="bg-red-100 border-l-4 border-red-500 p-2">
              <p className="text-sm text-red-700">
                <strong>Presale create failed:</strong> {lastError.status} - {lastError.message}
              </p>
            </div>
          )}
        </div>
      )}
      
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h3 className="font-bold text-lg mb-2">Детали рейса</h3>
        <p className="text-gray-600">{trip?.boat_name} • {trip?.time} • Длительность: {trip?.duration}</p>
        {trip?.boat_type === 'banana' ? (
          <div className="text-sm text-gray-600">
            <p>Взрослый: {formatRUB(trip?.price_adult || trip?.price)}</p>
            <p>Детский: {formatRUB(trip?.price_child || trip?.price)}</p>
          </div>
        ) : (
          <div className="text-sm text-gray-600">
            <p>Взрослый: {formatRUB(trip?.price_adult || trip?.price)}</p>
            <p>Подросток: {formatRUB(trip?.price_teen || trip?.price)}</p>
            <p>Детский: {formatRUB(trip?.price_child || trip?.price)}</p>
          </div>
        )}
        
        {/* Show warning for banana trips */}
        {trip?.boat_type === 'banana' && (
          <div className="mt-2 p-2 bg-yellow-100 text-yellow-800 rounded-lg text-sm">
            Банан: только взрослый/детский билеты, вместимость 12 мест
          </div>
        )}
      </div>
      
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h3 className="font-bold text-lg mb-4">Количество мест</h3>
        
        <div className="space-y-4">
          <div className={`grid ${isBananaTrip ? "grid-cols-2" : "grid-cols-3"} gap-6 justify-items-center`}>
            <div className="text-center">
              <p className="font-medium text-gray-700">Взрослый</p>
              <div className="flex items-center justify-between mt-3 w-[140px]">
                <button 
                  type="button"
                  onClick={() => decrementTicket('adult')}
                  className="bg-gray-200 text-gray-800 w-8 h-8 rounded-full flex items-center justify-center text-xl font-bold hover:bg-gray-300 active:bg-gray-400"
                  disabled={ticketBreakdown.adult <= 0}
                >
                  -
                </button>
                <span className="mx-3 text-xl font-bold">{ticketBreakdown.adult}</span>
                <button 
                  type="button"
                  onClick={() => incrementTicket('adult')}
                  className="bg-gray-200 text-gray-800 w-8 h-8 rounded-full flex items-center justify-center text-xl font-bold hover:bg-gray-300 active:bg-gray-400"
                  disabled={ticketBreakdown.adult + ticketBreakdown.teen + ticketBreakdown.child >= getSlotAvailable(trip)}
                >
                  +
                </button>
              </div>
            </div>
            {!isBananaTrip && (

            
            <div className="text-center">
              <p className="font-medium text-gray-700">Подросток</p>
              <div className="flex items-center justify-between mt-3 w-[140px]">
                <button 
                  type="button"
                  onClick={() => decrementTicket('teen')}
                  className={`bg-gray-200 text-gray-800 w-8 h-8 rounded-full flex items-center justify-center text-xl font-bold hover:bg-gray-300 active:bg-gray-400 ${trip?.boat_type === 'banana' ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={ticketBreakdown.teen <= 0 || trip?.boat_type === 'banana'}
                >
                  -
                </button>
                <span className="mx-3 text-xl font-bold">{ticketBreakdown.teen}</span>
                <button 
                  type="button"
                  onClick={() => incrementTicket('teen')}
                  className={`bg-gray-200 text-gray-800 w-8 h-8 rounded-full flex items-center justify-center text-xl font-bold hover:bg-gray-300 active:bg-gray-400 ${trip?.boat_type === 'banana' ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={ticketBreakdown.teen + ticketBreakdown.adult + ticketBreakdown.child >= getSlotAvailable(trip) || trip?.boat_type === 'banana'}
                >
                  +
                </button>
              </div>
              {trip?.boat_type === 'banana' && (
                <p className="text-xs text-red-600 mt-1">Недоступно для банана</p>
              )}
            </div>
                        )}

                        <div className="text-center">
              <p className="font-medium text-gray-700">Детский</p>
              <div className="flex items-center justify-between mt-3 w-[140px]">
                <button 
                  type="button"
                  onClick={() => decrementTicket('child')}
                  className="bg-gray-200 text-gray-800 w-8 h-8 rounded-full flex items-center justify-center text-xl font-bold hover:bg-gray-300 active:bg-gray-400"
                  disabled={ticketBreakdown.child <= 0}
                >
                  -
                </button>
                <span className="mx-3 text-xl font-bold">{ticketBreakdown.child}</span>
                <button 
                  type="button"
                  onClick={() => incrementTicket('child')}
                  className="bg-gray-200 text-gray-800 w-8 h-8 rounded-full flex items-center justify-center text-xl font-bold hover:bg-gray-300 active:bg-gray-400"
                  disabled={ticketBreakdown.child + ticketBreakdown.adult + ticketBreakdown.teen >= getSlotAvailable(trip)}
                >
                  +
                </button>
              </div>
            </div>
          </div>
          
          <div className="text-center font-bold text-lg">
            Итого: {ticketBreakdown.adult + ticketBreakdown.teen + ticketBreakdown.child} мест
          </div>
        </div>
        
        <p className="text-sm text-gray-500 mt-2 text-center">
          Максимум {getSlotAvailable(trip)} мест доступно
        </p>
        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">Стоимость билетов:</p>
          <div className="flex justify-between mt-1">
            <span>Взрослый:</span>
            <span className="font-medium">{formatRUB(trip?.price_adult || trip?.price)}</span>
          </div>
          {!isBananaTrip && (
            <div className="flex justify-between mt-1">
              <span>Подросток:</span>
              <span className="font-medium">{formatRUB(trip?.price_teen || trip?.price)}</span>
            </div>
          )}
          <div className="flex justify-between mt-1">
            <span>Детский:</span>
            <span className="font-medium">{formatRUB(trip?.price_child || trip?.price)}</span>
          </div>
        </div>
      </div>
      
      {/* Customer Information Section */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h3 className="font-bold text-lg mb-4">Информация о клиенте</h3>
        
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="customerName">
            Имя клиента
          </label>
          
          {/* Quick name buttons */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <button
              type="button"
              onClick={() => {
                setLocalCustomerName('Алексей');
                if (setCustomerName) setCustomerName('Алексей');
              }}
              className={`py-2 rounded-lg font-medium transition-colors ${localCustomerName === 'Алексей' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              Алексей
            </button>
            <button
              type="button"
              onClick={() => {
                setLocalCustomerName('Дмитрий');
                if (setCustomerName) setCustomerName('Дмитрий');
              }}
              className={`py-2 rounded-lg font-medium transition-colors ${localCustomerName === 'Дмитрий' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              Дмитрий
            </button>
            <button
              type="button"
              onClick={() => {
                setLocalCustomerName('Иван');
                if (setCustomerName) setCustomerName('Иван');
              }}
              className={`py-2 rounded-lg font-medium transition-colors ${localCustomerName === 'Иван' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              Иван
            </button>
            <button
              type="button"
              onClick={() => {
                setLocalCustomerName('Анна');
                if (setCustomerName) setCustomerName('Анна');
              }}
              className={`py-2 rounded-lg font-medium transition-colors ${localCustomerName === 'Анна' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              Анна
            </button>
            <button
              type="button"
              onClick={() => {
                setLocalCustomerName('Мария');
                if (setCustomerName) setCustomerName('Мария');
              }}
              className={`py-2 rounded-lg font-medium transition-colors ${localCustomerName === 'Мария' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              Мария
            </button>
            <button
              type="button"
              onClick={() => {
                setLocalCustomerName('Елена');
                if (setCustomerName) setCustomerName('Елена');
              }}
              className={`py-2 rounded-lg font-medium transition-colors ${localCustomerName === 'Елена' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              Елена
            </button>
          </div>
          
          <input
            id="customerName"
            type="text"
            value={localCustomerName}
            onChange={handleNameChange}
            onBlur={() => setTouched(prev => ({ ...prev, customerName: true }))}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
          />
          {touched.customerName && errors.customerName && (
            <p className="text-red-500 text-xs italic mt-2">{errors.customerName}</p>
          )}
        </div>
        
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="customerPhone">
            Телефон клиента
          </label>
          <input
            id="customerPhone"
            type="text"
            value={localCustomerPhone}
            onChange={handlePhoneChange}
            onBlur={() => setTouched(prev => ({ ...prev, customerPhone: true }))}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
          />
          {touched.customerPhone && errors.customerPhone && (
            <p className="text-red-500 text-xs italic mt-2">{errors.customerPhone}</p>
          )}
        </div>
        
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="prepayment">
            Предоплата (₽)
          </label>
          
          {/* Quick prepayment buttons */}
          <div className="flex space-x-2 mb-2">
            <button
              type="button"
              onClick={() => {
                setLocalPrepaymentStr('500');
                if (setPrepaymentStr) setPrepaymentStr('500');
                setPrepaymentError('');
              }}
              className="flex-1 py-2 bg-blue-100 text-blue-800 rounded-lg font-medium hover:bg-blue-200 active:bg-blue-300 transition-colors"
            >
              500 ₽
            </button>
            <button
              type="button"
              onClick={() => {
                setLocalPrepaymentStr('1000');
                if (setPrepaymentStr) setPrepaymentStr('1000');
                setPrepaymentError('');
              }}
              className="flex-1 py-2 bg-blue-100 text-blue-800 rounded-lg font-medium hover:bg-blue-200 active:bg-blue-300 transition-colors"
            >
              1000 ₽
            </button>
            <button
              type="button"
              onClick={() => {
                setLocalPrepaymentStr('2000');
                if (setPrepaymentStr) setPrepaymentStr('2000');
                setPrepaymentError('');
              }}
              className="flex-1 py-2 bg-blue-100 text-blue-800 rounded-lg font-medium hover:bg-blue-200 active:bg-blue-300 transition-colors"
            >
              2000 ₽
            </button>
          </div>
          
          <input
            id="prepayment"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={localPrepaymentStr}
            onChange={handlePrepaymentChange}
            className={`shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline ${prepaymentError ? 'border-red-500' : ''}`}
          />
          {prepaymentError && (
            <p className="text-red-500 text-xs italic mt-2">{prepaymentError}</p>
          )}
        </div>
      </div>
      
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <div className="flex justify-between items-center">
          <span className="font-bold text-lg">Итого:</span>
          <span className="font-bold text-2xl text-blue-600">{formatRUB(totalPrice)}</span>
        </div>
      </div>
      
      <div className="flex space-x-3">
        <button
          onClick={onBack}
          className="flex-1 py-5 text-xl font-medium rounded-xl bg-gray-300 text-gray-800 hover:bg-gray-400 active:bg-gray-500 transition-all shadow-lg"
        >
          Назад
        </button>
        <button 
          onClick={handleConfirm}
          disabled={!isFormValid || isSubmitting}
          className={`flex-1 py-5 text-xl font-medium rounded-xl transition-all shadow-lg transform hover:scale-[1.02] active:scale-[0.98] ${
            isFormValid 
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