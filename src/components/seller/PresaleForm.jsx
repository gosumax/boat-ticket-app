import { useState, useEffect } from 'react';
import { formatRUB } from '../../utils/currency';
import { getSlotAvailable } from '../../utils/slotAvailability';

const PresaleForm = ({ trip, onConfirm, onCancel, onBack }) => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [numberOfSeats, setNumberOfSeats] = useState(1);
  const [prepaymentAmount, setPrepaymentAmount] = useState(0);
  const [errors, setErrors] = useState({});

  const totalPrice = trip ? (trip.price_adult || trip.price) * numberOfSeats : 0;
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
      onConfirm({
        slotUid: trip.slot_uid,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        numberOfSeats,
        prepaymentAmount
      });
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
              }}
              min="0"
              max={totalPrice}
              className={`w-full px-3 py-2 border rounded-lg ${errors.prepaymentAmount ? 'border-red-500' : 'border-gray-300'}`}
            />
            {errors.prepaymentAmount && <p className="text-red-500 text-xs mt-1">{errors.prepaymentAmount}</p>}
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