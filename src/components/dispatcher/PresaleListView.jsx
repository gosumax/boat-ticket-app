import { useState, useEffect, useMemo } from 'react';
import apiClient from '../../utils/apiClient';
import { formatRUB } from '../../utils/currency';

const PresaleListView = ({ dateFilter, typeFilter, statusFilter, searchTerm }) => {
  const [presales, setPresales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedPresale, setSelectedPresale] = useState(null);
  const [additionalPayment, setAdditionalPayment] = useState('');
  const [paymentError, setPaymentError] = useState('');
  
  // Filter presales based on props from parent
  const filteredPresales = useMemo(() => {
    let result = presales;
    
    // Date filter - no date fields in presale data, so ignore for now
    // Type filter - check if boat_name or other fields match type
    if (typeFilter !== 'all') {
      result = result.filter(presale => {
        const boatName = presale.boat_name || '';
        if (typeFilter === 'speed') {
          return boatName.toLowerCase().includes('скоростн') || boatName.toLowerCase().includes('speed');
        } else if (typeFilter === 'cruise') {
          return boatName.toLowerCase().includes('прогулочн') || boatName.toLowerCase().includes('cruise');
        } else if (typeFilter === 'banana') {
          return boatName.toLowerCase().includes('банан') || boatName.toLowerCase().includes('banana');
        }
        return false;
      });
    }
    
    // Status filter - map based on remaining amount or other status
    if (statusFilter !== 'all') {
      result = result.filter(presale => {
        const isPaid = presale.remaining_amount === 0;
        
        if (statusFilter === 'active') {
          return !isPaid;
        } else if (statusFilter === 'completed') {
          return isPaid;
        } else if (statusFilter === 'cancelled') {
          // Assuming there's no cancelled status for presales
          return false;
        }
        return true;
      });
    }
    
    // Search filter - search across relevant fields
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(presale => {
        const boatName = presale.boat_name || '';
        const customerName = presale.customer_name || '';
        const customerPhone = presale.customer_phone || '';
        const idStr = presale.id.toString();
        
        return (
          boatName.toLowerCase().includes(term) ||
          customerName.toLowerCase().includes(term) ||
          customerPhone.includes(term) ||
          idStr.includes(term)
        );
      });
    }
    
    return result;
  }, [presales, dateFilter, typeFilter, statusFilter, searchTerm]);

  useEffect(() => {
    loadPresales();
  }, []);

  const loadPresales = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getPresales();
      setPresales(data);
    } catch (error) {
      console.error('Error loading presales:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePayRemaining = async () => {
    if (!selectedPresale) return;

    const payment = parseInt(additionalPayment) || 0;
    if (payment <= 0) {
      setPaymentError('Сумма оплаты должна быть больше 0');
      return;
    }

    if (payment > selectedPresale.remaining_amount) {
      setPaymentError('Сумма оплаты не может превышать остаток');
      return;
    }

    try {
      setLoading(true);
      const updatedPresale = await apiClient.updatePresalePayment(selectedPresale.id, {
        additionalPayment: payment
      });

      // Update the presale in the list
      setPresales(prev => prev.map(p => 
        p.id === selectedPresale.id ? updatedPresale : p
      ));

      // Update selected presale
      setSelectedPresale(updatedPresale);
      setAdditionalPayment('');
      setPaymentError('');
    } catch (error) {
      console.error('Error updating payment:', error);
      setPaymentError('Ошибка при обновлении платежа: ' + (error.message || 'Неизвестная ошибка'));
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-neutral-100">Предзаказы</h2>
      
      {loading && (
        <div className="text-center py-4 text-neutral-400">Загрузка...</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
        {filteredPresales.map(presale => (
          <div 
            key={presale.id} 
            className={`rounded-2xl border bg-neutral-900 p-3 cursor-pointer transition-all ${
              selectedPresale?.id === presale.id
                ? "border-sky-500/80 bg-sky-950/30"
                : "border-neutral-800 hover:border-neutral-700"
            }`}
            onClick={() => setSelectedPresale(presale)}
          >
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-bold text-lg">#{presale.id}</h3>
              <span className="text-sm text-neutral-400">{formatDate(presale.created_at)}</span>
            </div>
            
            <p className="text-neutral-300 mb-1">{presale.boat_name}</p>
            <p className="text-neutral-300 mb-2">{presale.slot_time}</p>
            
            <div className="flex justify-between items-center mb-2">
              <span className="text-neutral-300">Клиент:</span>
              <span className="font-medium">{presale.customer_name}</span>
            </div>
            
            <div className="flex justify-between items-center mb-2">
              <span className="text-neutral-300">Телефон:</span>
              <a href={`tel:${presale.customer_phone}`} className="font-medium text-sky-400 hover:underline">
                {presale.customer_phone}
              </a>
            </div>
            
            <div className="flex justify-between items-center mb-2">
              <span className="text-neutral-300">Мест:</span>
              <span className="font-medium">{presale.number_of_seats}</span>
            </div>
            
            <div className="flex justify-between items-center mb-1">
              <span className="text-neutral-300">Общая стоимость:</span>
              <span className="font-bold">{formatRUB(presale.total_price)}</span>
            </div>
            
            <div className="flex justify-between items-center mb-1">
              <span className="text-neutral-300">Предоплата:</span>
              <span className="font-bold text-emerald-300">-{formatRUB(presale.prepayment_amount)}</span>
            </div>
            
            <div className="flex justify-between items-center pt-2 border-t border-neutral-800">
              <span className="text-neutral-100 font-bold">Остаток:</span>
              <span className={`text-lg font-bold ${
                presale.remaining_amount > 0 ? 'text-sky-400' : 'text-emerald-300'
              }`}>
                {formatRUB(presale.remaining_amount)}
              </span>
            </div>
            
            {presale.remaining_amount === 0 && (
              <div className="mt-2 text-center text-emerald-300 font-medium text-sm">
                Полностью оплачен
              </div>
            )}
          </div>
        ))}
        
        {filteredPresales.length === 0 && !loading && (
          <div className="col-span-full text-center py-8 text-neutral-500">
            Нет предзаказов
          </div>
        )}
      </div>

      {selectedPresale && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 mt-4">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-lg font-semibold text-neutral-100">Детали заказа #{selectedPresale.id}</h3>
            <button 
              onClick={() => setSelectedPresale(null)}
              className="text-neutral-400 hover:text-neutral-200"
            >
              ✕
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-bold text-lg mb-3 text-neutral-100">Информация о клиенте</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-neutral-300">Имя:</span>
                  <span className="font-medium">{selectedPresale.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-300">Телефон:</span>
                  <a href={`tel:${selectedPresale.customer_phone}`} className="font-medium text-sky-400 hover:underline">
                    {selectedPresale.customer_phone}
                  </a>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-300">Дата создания:</span>
                  <span className="font-medium">{formatDate(selectedPresale.created_at)}</span>
                </div>
              </div>
            </div>
            
            <div>
              <h4 className="font-bold text-lg mb-3 text-neutral-100">Детали рейса</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-neutral-300">Лодка:</span>
                  <span className="font-medium">{selectedPresale.boat_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-300">Время:</span>
                  <span className="font-medium">{selectedPresale.slot_time}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-300">Мест:</span>
                  <span className="font-medium">{selectedPresale.number_of_seats}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-6 pt-6 border-t border-neutral-800">
            <h4 className="font-bold text-lg mb-3 text-neutral-100">Платежная информация</h4>
            <div className="bg-neutral-950/40 p-3 rounded-xl border border-neutral-800">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-neutral-300">Общая стоимость:</span>
                  <span className="font-bold">{formatRUB(selectedPresale.total_price)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-300">Предоплата:</span>
                  <span className="font-bold text-emerald-300">-{formatRUB(selectedPresale.prepayment_amount)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-neutral-800">
                  <span className="text-neutral-100 font-bold">Остаток к оплате:</span>
                  <span className={`text-xl font-bold ${
                    selectedPresale.remaining_amount > 0 ? 'text-sky-400' : 'text-emerald-300'
                  }`}>
                    {formatRUB(selectedPresale.remaining_amount)}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          {selectedPresale.remaining_amount > 0 && (
            <div className="mt-6 pt-6 border-t border-neutral-800">
              <h4 className="font-bold text-lg mb-3 text-neutral-100">Завершить оплату</h4>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Сумма доплаты, ₽
                  </label>
                  <input
                    type="number"
                    value={additionalPayment}
                    onChange={(e) => setAdditionalPayment(e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg ${
                      paymentError ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="Введите сумму"
                  />
                  {paymentError && <p className="text-red-500 text-xs mt-1">{paymentError}</p>}
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handlePayRemaining}
                    disabled={loading}
                    className={`px-5 py-2 rounded-xl font-semibold text-white bg-sky-600 ${
                      loading ? "opacity-50 cursor-not-allowed" : "hover:bg-sky-500"
                    }`}
                  >
                    Оплатить
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {selectedPresale.remaining_amount === 0 && (
            <div className="border-t border-neutral-800 pt-6">
              <div className="text-center text-emerald-300 font-bold text-lg">
                Заказ полностью оплачен!
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PresaleListView;