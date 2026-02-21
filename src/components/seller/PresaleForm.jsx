import { useState, useEffect } from 'react';
import { formatRUB } from '../../utils/currency';
import { getSlotAvailable } from '../../utils/slotAvailability';

const PresaleForm = ({ trip, onConfirm, onCancel, onBack, ticketBreakdown }) => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [numberOfSeats, setNumberOfSeats] = useState(1);
  const [prepaymentAmount, setPrepaymentAmount] = useState(0);
  const [errors, setErrors] = useState({});
  
  // Prepayment payment method (same logic as dispatcher)
  const [prepaymentMethod, setPrepaymentMethod] = useState(null); // 'cash' | 'card' | 'mixed'
  const [prepaymentCashStr, setPrepaymentCashStr] = useState('');
  const [prepaymentCardStr, setPrepaymentCardStr] = useState('');
  const [prepaymentMethodError, setPrepaymentMethodError] = useState('');

  const totalPrice = trip ? (
    ticketBreakdown && typeof ticketBreakdown === 'object' ?
      (Number(ticketBreakdown.adult || 0) * (trip.price_adult || trip.price)) +
      (Number(ticketBreakdown.teen || 0)  * (trip.price_teen  || trip.price)) +
      (Number(ticketBreakdown.child || 0) * (trip.price_child || trip.price))
    : (trip.price_adult || trip.price) * numberOfSeats
  ) : 0;
  const remainingAmount = totalPrice - prepaymentAmount;

  // Update remaining amount when prepayment or total price changes
  useEffect(() => {
    // This will automatically recalculate due to reactive variables
  }, [prepaymentAmount, totalPrice]);

  const handleIncrement = () => {
    const maxSeats = getSlotAvailable(trip);
    if (numberOfSeats < maxSeats) {
      setNumberOfSeats(numberOfSeats + 1);
    }
  };

  const handleDecrement = () => {
    if (numberOfSeats > 1) {
      setNumberOfSeats(numberOfSeats - 1);
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!customerName.trim() || customerName.trim().length < 2) {
      newErrors.customerName = 'Имя клиента должно содержать минимум 2 символа';
    }

    if (!customerPhone.trim()) {
      newErrors.customerPhone = 'Телефон клиента обязателен';
    }

    if (prepaymentAmount < 0) {
      newErrors.prepaymentAmount = 'Предоплата не может быть отрицательной';
    }

    if (prepaymentAmount > totalPrice) {
      newErrors.prepaymentAmount = 'Предоплата не может превышать общую стоимость';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleConfirm = () => {
    if (validateForm()) {
      // Validate prepayment payment method
      if (prepaymentAmount > 0) {
        if (!prepaymentMethod) {
          setPrepaymentMethodError('Выберите способ оплаты предоплаты');
          return;
        }
        if (prepaymentMethod === 'mixed') {
          const cash = Math.round(Number(prepaymentCashStr || 0));
          const card = Math.round(Number(prepaymentCardStr || 0));
          if (cash + card !== prepaymentAmount) {
            setPrepaymentMethodError('Сумма Нал + Карта должна быть равна предоплате');
            return;
          }
          if (cash === 0 || card === 0) {
            setPrepaymentMethodError('Для комбо укажите суммы и для налички, и для карты');
            return;
          }
        }
      }
      
      const payload = {
        slotUid: trip.slot_uid,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        numberOfSeats,
        prepaymentAmount
      };

      if (ticketBreakdown && typeof ticketBreakdown === 'object') {
        payload.tickets = {
          adult: Number(ticketBreakdown.adult || 0),
          teen: Number(ticketBreakdown.teen || 0),
          child: Number(ticketBreakdown.child || 0)
        };
      }

      // Add payment method for prepayment (same logic as dispatcher)
      if (prepaymentAmount > 0) {
        if (prepaymentMethod === 'cash') {
          payload.payment_method = 'CASH';
        } else if (prepaymentMethod === 'card') {
          payload.payment_method = 'CARD';
        } else if (prepaymentMethod === 'mixed') {
          payload.payment_method = 'MIXED';
          payload.cash_amount = Math.round(Number(prepaymentCashStr || 0));
          payload.card_amount = Math.round(Number(prepaymentCardStr || 0));
        }
      }

      onConfirm(payload);
    }
  };

  return (
    <div className="flex flex-col">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Предзаказ</h2>
      
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h3 className="font-bold text-lg mb-2">Детали рейса</h3>
        <p className="text-gray-600">{trip?.boat_name} • {trip?.time}</p>
        <div className="text-sm text-gray-600">
          <p>Взрослый: {formatRUB(trip?.price_adult || trip?.price)}</p>
          <p>Подросток: {formatRUB(trip?.price_teen || trip?.price)}</p>
          <p>Детский: {formatRUB(trip?.price_child || trip?.price)}</p>
        </div>
      </div>
      
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h3 className="font-bold text-lg mb-4">Количество мест</h3>
        <div className="flex items-center justify-between">
          <button 
            onClick={handleDecrement}
            className="bg-gray-200 text-gray-800 w-12 h-12 rounded-full flex items-center justify-center text-2xl font-bold hover:bg-gray-300 active:bg-gray-400"
            disabled={numberOfSeats <= 1}
          >
            -
          </button>
          
          <span className="text-3xl font-bold">{numberOfSeats}</span>
          
          <button 
            onClick={handleIncrement}
            className="bg-gray-200 text-gray-800 w-12 h-12 rounded-full flex items-center justify-center text-2xl font-bold hover:bg-gray-300 active:bg-gray-400"
            disabled={numberOfSeats >= getSlotAvailable(trip)}
          >
            +
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-2 text-center">
          Максимум {getSlotAvailable(trip)} мест доступно
        </p>
      </div>
      
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h3 className="font-bold text-lg mb-4">Данные клиента</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2">
              Имя клиента *
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg ${errors.customerName ? 'border-red-500' : 'border-gray-300'}`}
              placeholder="Введите имя клиента"
            />
            {errors.customerName && <p className="text-red-500 text-xs mt-1">{errors.customerName}</p>}
          </div>
          
          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2">
              Телефон клиента *
            </label>
            <input
              type="text"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg ${errors.customerPhone ? 'border-red-500' : 'border-gray-300'}`}
              placeholder="+7 ___ ___-__-__"
            />
            {errors.customerPhone && <p className="text-red-500 text-xs mt-1">{errors.customerPhone}</p>}
          </div>
        </div>
      </div>
      
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h3 className="font-bold text-lg mb-4">Предоплата</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2">
              Предоплата, ₽
            </label>
            <input
              type="number"
              value={prepaymentAmount}
              onChange={(e) => {
                const value = parseInt(e.target.value) || 0;
                setPrepaymentAmount(Math.max(0, value));
                setPrepaymentMethod(null);
                setPrepaymentCashStr('');
                setPrepaymentCardStr('');
                setPrepaymentMethodError('');
              }}
              min="0"
              max={totalPrice}
              className={`w-full px-3 py-2 border rounded-lg ${errors.prepaymentAmount ? 'border-red-500' : 'border-gray-300'}`}
            />
            {errors.prepaymentAmount && <p className="text-red-500 text-xs mt-1">{errors.prepaymentAmount}</p>}
            
            {/* Payment method picker for prepayment (Нал/Карта/Комбо) - same as dispatcher */}
            {prepaymentAmount > 0 && (
              <div className="mt-3 p-3 rounded-lg border border-gray-300 bg-gray-50">
                <div className="text-gray-700 text-sm font-bold mb-2">Оплата предоплаты</div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => { setPrepaymentMethod('cash'); setPrepaymentCashStr(''); setPrepaymentCardStr(''); setPrepaymentMethodError(''); }}
                    className={`py-2 rounded-lg font-medium transition-colors ${prepaymentMethod === 'cash' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                  >
                    Нал
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPrepaymentMethod('card'); setPrepaymentCashStr(''); setPrepaymentCardStr(''); setPrepaymentMethodError(''); }}
                    className={`py-2 rounded-lg font-medium transition-colors ${prepaymentMethod === 'card' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                  >
                    Карта
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPrepaymentMethod('mixed');
                      const p = Math.round(Number(prepaymentAmount || 0));
                      const cash = Math.max(1, Math.floor(p / 2));
                      const card = Math.max(1, p - cash);
                      setPrepaymentCashStr(String(cash));
                      setPrepaymentCardStr(String(card));
                      setPrepaymentMethodError('');
                    }}
                    className={`py-2 rounded-lg font-medium transition-colors ${prepaymentMethod === 'mixed' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                  >
                    Комбо
                  </button>
                </div>
                
                {prepaymentMethod === 'mixed' && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-gray-600 text-xs font-bold mb-1">Нал (₽)</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={prepaymentCashStr}
                        onChange={(e) => { setPrepaymentCashStr(e.target.value); setPrepaymentMethodError(''); }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 text-xs font-bold mb-1">Карта (₽)</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={prepaymentCardStr}
                        onChange={(e) => { setPrepaymentCardStr(e.target.value); setPrepaymentMethodError(''); }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>
                )}
                
                {prepaymentMethodError && (
                  <div className="text-red-500 text-xs mt-2">{prepaymentMethodError}</div>
                )}
              </div>
            )}
          </div>
          
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex justify-between items-center mb-2">
              <span className="text-gray-600">Общая стоимость:</span>
              <span className="font-bold">{formatRUB(totalPrice)}</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-gray-600">Предоплата:</span>
              <span className="font-bold text-green-600">-{formatRUB(prepaymentAmount)}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-gray-200">
              <span className="text-gray-800 font-bold">Остаток к оплате:</span>
              <span className="text-xl font-bold text-blue-600">{formatRUB(remainingAmount)}</span>
            </div>
          </div>
        </div>
      </div>
      
      <div className="flex space-x-3">
        <button 
          onClick={onBack}
          className="flex-1 py-3 text-lg font-medium rounded-xl bg-gray-300 text-gray-800 hover:bg-gray-400 active:bg-gray-500 transition-all shadow-lg"
        >
          Назад
        </button>
        <button 
          onClick={onCancel}
          className="flex-1 py-3 text-lg font-medium rounded-xl bg-gray-300 text-gray-800 hover:bg-gray-400 active:bg-gray-500 transition-all shadow-lg"
        >
          Отмена
        </button>
        <button 
          onClick={handleConfirm}
          className="flex-1 py-3 text-lg font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 transition-all shadow-lg transform hover:scale-[1.02] active:scale-[0.98]"
        >
          Создать предзаказ
        </button>
      </div>
    </div>
  );
};

export default PresaleForm;