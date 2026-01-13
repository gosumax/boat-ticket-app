import { useState, useEffect } from 'react';
import { formatRUB } from '../../utils/currency';
import { getSlotAvailable } from '../../utils/slotAvailability';
import apiClient from '../../utils/apiClient';

const QuickSaleForm = ({ trip, onBack, onSaleSuccess, seatsLeft, refreshAllSlots }) => {
  // Initialize ticket categories with default values
  const [ticketCategories, setTicketCategories] = useState({ adult: 1, teen: 0, child: 0 });
  
  // Check if boat type is banana (no teen tickets allowed)
  const isBanana = trip?.boat_type === 'banana';
  
  // Update ticket categories based on boat type after component mounts
  useEffect(() => {
    if (isBanana) {
      setTicketCategories({ adult: 1, child: 0 });
    } else {
      setTicketCategories({ adult: 1, teen: 0, child: 0 });
    }
  }, [isBanana]);
  
  // Filter categories based on boat type
  const allowedCategories = isBanana 
    ? Object.keys(ticketCategories).filter(cat => cat !== 'teen')
    : Object.keys(ticketCategories);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [prepaymentStr, setPrepaymentStr] = useState('');
  const [errors, setErrors] = useState({});
  const [prepaymentError, setPrepaymentError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // The slotId variable is kept for backward compatibility but we now use slot_uid from the trip object
  const slotId = trip?.slot_id ?? trip?.id ?? trip?.boatSlotId ?? trip?.boat_slot_id;
  
  // Calculate category totals and total price based on category-specific prices
  const categoryTotalSeats = allowedCategories.reduce((total, category) => total + ticketCategories[category], 0);
  const totalPrice = trip ? 
    allowedCategories.reduce((total, category) => {
      const price = category === 'adult' ? (trip.price_adult || trip.price || 0) :
                category === 'teen' ? (trip.price_teen || trip.price || 0) :
                category === 'child' ? (trip.price_child || trip.price || 0) : 0;
      return total + (ticketCategories[category] * price);
    }, 0)
    : 0;

  // Phone validation (RU mobile)
  const validatePhone = (raw) => {
    const value = String(raw ?? "").trim();
    if (!value) return { valid: false, error: "Введите номер телефона", normalized: "" };

    const digits = value.replace(/\D/g, "");
    if (digits.length !== 11) {
      return { valid: false, error: "Номер должен содержать ровно 11 цифр", normalized: digits };
    }

    // Accept: 8XXXXXXXXXX, +7XXXXXXXXXX, 7XXXXXXXXXX
    if (value.startsWith("+")) {
      if (digits[0] !== "7") return { valid: false, error: "Номер с + должен начинаться с +7", normalized: digits };
      return { valid: true, error: "", normalized: digits };
    }

    if (digits[0] === "8" || digits[0] === "7") return { valid: true, error: "", normalized: digits };
    return { valid: false, error: "Номер должен начинаться с 8 или +7", normalized: digits };
  };

  const phoneCheck = validatePhone(customerPhone);
  const isPhoneValid = phoneCheck.valid;
  const phoneError = phoneCheck.error;

  const prepaymentAmount = parseFloat(prepaymentStr) || 0;
  const isPrepaymentValid = prepaymentAmount <= totalPrice && prepaymentAmount >= 0;

  const isFormValid = !!slotId &&
                      Number.isFinite(categoryTotalSeats) && categoryTotalSeats >= 1 &&
                      customerName.trim().length > 0 &&
                      isPhoneValid &&
                      categoryTotalSeats > 0 && // Allow API call even if trip is closed, let backend decide
                      isPrepaymentValid;

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
  


  // Remove the separate seats state and related handlers since we're using category totals as source of truth
  
  const updateCategoryCount = (category, change) => {
    setTicketCategories(prev => {
      const newCount = Math.max(0, prev[category] + change);
      
      return {
        ...prev,
        [category]: newCount
      };
    });
  };

  const handlePrepaymentChange = (e) => {
    const value = e.target.value;
    setPrepaymentStr(value);
    setPrepaymentError('');
  };

  const handleNameChange = (e) => {
    setCustomerName(e.target.value);
  };

  const handlePhoneChange = (e) => {
    setCustomerPhone(e.target.value);
  };

  const handleQuickName = (name) => {
    setCustomerName(name);
  };

  const handleQuickPrepayment = (amount) => {
    setPrepaymentStr(Math.max(0, amount).toString());
    setPrepaymentError('');
  };

  const handleSubmit = async () => {
    
    if (!isFormValid) {
      // Show appropriate error instead of "Рейс закрыт" for local blocks
      setErrors({ submit: phoneError || prepaymentError || "Форма не заполнена" });
      return;
    }

    setIsSubmitting(true);
    setSuccessMessage('');
    // Clear any previous errors before making API call
    setErrors({});
        
    // Normalize phone by stripping all non-digits
    const normalizedPhone = customerPhone.replace(/\D/g, "");
        
    // Create presale data
    // Filter out teen category for banana boats
    const filteredTicketCategories = isBanana 
      ? Object.fromEntries(
          Object.entries(ticketCategories).filter(([key]) => key !== 'teen')
        )
      : ticketCategories;
        
    const presaleData = {
      slotUid: trip.slot_uid, // Use slotUid for deterministic slot identification
      numberOfSeats: categoryTotalSeats,
      tickets: filteredTicketCategories,  // Include ticket breakdown
      customerName: customerName.trim(),
      customerPhone: normalizedPhone,
      prepaymentAmount: Math.max(0, Number(prepaymentStr || 0))
    };
        
    try {
      
      const presale = await apiClient.createPresale(presaleData);
      
      // Success message
      setSuccessMessage('Заказ оформлен');
      
      // Reset form state
      setCustomerName('');
      setCustomerPhone('');
      setPrepaymentStr('');
      // Reset ticket categories based on boat type
      setTicketCategories(isBanana ? { adult: 1, child: 0 } : { adult: 1, teen: 0, child: 0 });
      
      // Call the success callback immediately to update parent state
      // The parent component should refresh the trip data to get updated availability from backend
      if (onSaleSuccess) {
        onSaleSuccess(presale);
      }
      
      // Refresh all slot data since this action affects availability
      if (refreshAllSlots) {
        refreshAllSlots();
      }
    } catch (error) {
      console.error('Error creating presale:', error);
      
      let errorMessage = error.message || 'Неизвестная ошибка';
      
      // Check if response has structured error codes
      if (error.response && error.response.data) {
        const errorData = error.response.data;
        if (errorData.code && errorData.message) {
          errorMessage = `${errorData.code}: ${errorData.message}`;
          
          // Add details if present (for TRIP_CLOSED_BY_TIME)
          if (errorData.details) {
            console.log('Trip closure details:', errorData.details);
          }
        }
      } else {
        // Legacy error handling
        if (error.status === 409) {
          errorMessage = 'Недостаточно мест';
        } else if (error.status === 404) {
          errorMessage = 'Рейс закрыт'; // This comes from backend
        } else if (error.message && error.message.includes('Недостаточно мест')) {
          errorMessage = 'Недостаточно мест';
        } else if (error.message && error.message.includes('Boat or slot is not active')) {
          errorMessage = 'Рейс закрыт'; // This comes from backend
        } else if (error.message && error.message.includes('Prepayment amount cannot exceed total price')) {
          errorMessage = 'Предоплата не может быть больше суммы заказа';
        }
      }
      
      setErrors({ submit: errorMessage });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Быстрая продажа</h2>
        <button 
          onClick={onBack}
          className="text-gray-500 hover:text-gray-700"
        >
          ✕
        </button>
      </div>
      
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h3 className="font-bold text-lg mb-2">Детали рейса</h3>
        <p className="text-gray-600">{trip.boat_name} • {trip.time}</p>
        <p className="font-bold text-blue-600">
          {allowedCategories.map((category, index) => {
            const label = category === 'adult' ? 'Взрослый' : 
                     category === 'teen' ? 'Подросток' : 'Ребёнок';
            const price = category === 'adult' ? (trip?.price_adult || trip?.price || 0) :
                       category === 'teen' ? (trip?.price_teen || trip?.price || 0) :
                       category === 'child' ? (trip?.price_child || trip?.price || 0) : 0;
                        
            return ticketCategories[category] > 0 ? (
              <span key={category}>
                {index > 0 && ' | '}
                {label}: {formatRUB(price)} × {ticketCategories[category]}
              </span>
            ) : null;
          })}
        </p>
      </div>
      

      
      {/* Ticket Categories Section */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h3 className="font-bold text-lg mb-4">Категории билетов</h3>
        <p className="text-sm text-gray-500 mb-4 text-center">
          Максимум {getSlotAvailable(trip)} мест доступно
        </p>
        <div className="space-y-4">
          {allowedCategories.map((category) => {
            const label = category === 'adult' ? 'Взрослый' : 
                     category === 'teen' ? 'Подросток' : 'Ребёнок';
            const price = category === 'adult' ? (trip?.price_adult || trip?.price || 0) :
                       category === 'teen' ? (trip?.price_teen || trip?.price || 0) :
                       category === 'child' ? (trip?.price_child || trip?.price || 0) : 0;
            
            return (
              <div key={category} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="font-medium">{label}</span>
                <div className="flex items-center space-x-3">
                  <button 
                    onClick={() => updateCategoryCount(category, -1)}
                    className="bg-gray-200 text-gray-800 w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold hover:bg-gray-300 active:bg-gray-400"
                    disabled={ticketCategories[category] <= 0}
                  >
                    -
                  </button>
                  <span className="text-lg font-bold w-6 text-center">{ticketCategories[category]}</span>
                  <button 
                    onClick={() => updateCategoryCount(category, 1)}
                    className="bg-gray-200 text-gray-800 w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold hover:bg-gray-300 active:bg-gray-400"
                    disabled={false} // Allow adding more than available, let backend handle validation
                  >
                    +
                  </button>
                </div>
                <span className="text-gray-600">{formatRUB(price)} за билет</span>
              </div>
            );
          })}
        </div>
      </div>
      
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h3 className="font-bold text-lg mb-2">Информация о клиенте</h3>
        
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="customerName">
            Имя клиента
          </label>
          
          {/* Quick name buttons */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <button
              type="button"
              onClick={() => handleQuickName('Алексей')}
              className={`py-2 rounded-lg font-medium transition-colors ${customerName === 'Алексей' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              Алексей
            </button>
            <button
              type="button"
              onClick={() => handleQuickName('Дмитрий')}
              className={`py-2 rounded-lg font-medium transition-colors ${customerName === 'Дмитрий' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              Дмитрий
            </button>
            <button
              type="button"
              onClick={() => handleQuickName('Иван')}
              className={`py-2 rounded-lg font-medium transition-colors ${customerName === 'Иван' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              Иван
            </button>
            <button
              type="button"
              onClick={() => handleQuickName('Анна')}
              className={`py-2 rounded-lg font-medium transition-colors ${customerName === 'Анна' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              Анна
            </button>
            <button
              type="button"
              onClick={() => handleQuickName('Мария')}
              className={`py-2 rounded-lg font-medium transition-colors ${customerName === 'Мария' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              Мария
            </button>
            <button
              type="button"
              onClick={() => handleQuickName('Елена')}
              className={`py-2 rounded-lg font-medium transition-colors ${customerName === 'Елена' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              Елена
            </button>
          </div>
          
          <input
            id="customerName"
            type="text"
            value={customerName}
            onChange={handleNameChange}
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
          />
        </div>
        
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="customerPhone">
            Телефон клиента
          </label>
          <input
            id="customerPhone"
            type="tel"
            value={customerPhone}
            onChange={handlePhoneChange}
            className={`shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline ${!isPhoneValid ? 'border-red-500' : ''}`}
            placeholder="+7 (XXX) XXX-XXXX"
          />
          {!isPhoneValid && (
            <p className="text-red-500 text-xs italic mt-2">{phoneError}</p>
          )}
        </div>
        
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="prepayment">
            Предоплата (₽)
          </label>
          
          {/* Quick prepayment buttons */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <button
              type="button"
              onClick={() => handleQuickPrepayment(500)}
              className={`py-2 rounded-lg font-medium transition-colors ${prepaymentAmount === 500 ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              500 ₽
            </button>
            <button
              type="button"
              onClick={() => handleQuickPrepayment(1000)}
              className={`py-2 rounded-lg font-medium transition-colors ${prepaymentAmount === 1000 ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              1000 ₽
            </button>
            <button
              type="button"
              onClick={() => handleQuickPrepayment(2000)}
              className={`py-2 rounded-lg font-medium transition-colors ${prepaymentAmount === 2000 ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
            >
              2000 ₽
            </button>
          </div>
          <button
            type="button"
            onClick={() => handleQuickPrepayment(totalPrice)}
            disabled={totalPrice <= 0}
            className={`w-full py-2 rounded-lg font-medium transition-colors mb-2 ${prepaymentAmount === totalPrice && totalPrice > 0 ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 hover:bg-blue-200 active:bg-blue-300'}`}
          >
            Полная предоплата
          </button>
          
          <input
            id="prepayment"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={prepaymentStr}
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
      
      {errors.submit && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 text-center">
          {errors.submit}
        </div>
      )}
      
      {successMessage && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4 text-center">
          {successMessage}
        </div>
      )}
      
      <div className="flex space-x-3">
        <button
          onClick={onBack}
          className="flex-1 py-3 bg-gray-300 text-gray-800 rounded-lg font-medium hover:bg-gray-400 active:bg-gray-500 transition-colors"
        >
          Назад
        </button>
        <div className="flex-1">
          <button 
            onClick={handleSubmit}
            disabled={!isFormValid || isSubmitting}
            className={`w-full py-3 font-medium rounded-lg transition-colors ${
              isFormValid 
                ? (categoryTotalSeats <= getSlotAvailable(trip) 
                   ? 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800' 
                   : 'bg-yellow-500 text-white hover:bg-yellow-600 active:bg-yellow-700')
                : 'bg-gray-400 text-gray-200 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? 'Создание...' : `Создать предзаказ${categoryTotalSeats > getSlotAvailable(trip) ? ' (проверка мест)' : ''}`}
          </button>
          {!isFormValid && (
            <div className="text-xs text-gray-500 mt-1 text-center">
              {!slotId ? 'Не выбран рейс' :
               customerName.trim().length === 0 ? 'Введите имя' :
               customerPhone.trim().length === 0 ? 'Введите номер телефона' :
               categoryTotalSeats <= 0 ? 'Выберите хотя бы один билет' : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickSaleForm;