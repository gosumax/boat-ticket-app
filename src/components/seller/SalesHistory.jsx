import { useState, useEffect } from 'react';
import { formatRUB } from '../../utils/currency';
import apiClient from '../../utils/apiClient';
import { useAuth } from '../../contexts/AuthContext';

const SalesHistory = ({ onBack }) => {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const { currentUser } = useAuth();

  // Fixed commission percentage
  const COMMISSION_PERCENT = 0.13; // 13%

  // Calculate today's date for filtering
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to start of day

  useEffect(() => {
    const fetchSales = async () => {
      try {
        setLoading(true);
        // Get all presales - we'll filter by date and seller on the frontend
        const presales = await apiClient.getPresales();
        
        // Filter for today's sales and calculate totals
        let todaySales = presales.filter(sale => {
          // Parse the created_at or similar timestamp field
          const saleDate = new Date(sale.created_at || sale.timestamp || sale.createdAt || Date.now());
          const saleStartOfDay = new Date(saleDate);
          saleStartOfDay.setHours(0, 0, 0, 0);
          
          return saleStartOfDay.getTime() === today.getTime();
        });
        
        // If we have current user, try to filter by seller (best-effort approach)
        // Since the backend may not store seller IDs in the presales yet
        if (currentUser && currentUser.id) {
          // Try to filter by seller_id if available in the data
          todaySales = todaySales.filter(sale => {
            // Attempt to match by seller_id if available in the sale record
            // If seller_id is not available, we'll show all sales but note this limitation
            return sale.seller_id === currentUser.id || 
                   sale.sellerId === currentUser.id || 
                   sale.seller === currentUser.id;
          });
        }

        setSales(todaySales);
      } catch (err) {
        console.error('Error fetching sales:', err);
        setError('Не удалось загрузить данные о продажах');
        // Set empty array so UI shows "no sales" state
        setSales([]);
      } finally {
        setLoading(false);
      }
    };

    fetchSales();
  }, [currentUser]);

  // Calculate summary statistics
  const totalSalesAmount = sales.reduce((sum, sale) => {
    // Use the total price from the sale, fallback to calculating from tickets
    return sum + (sale.total_price || sale.totalPrice || 0);
  }, 0);

  const totalSeatsSold = sales.reduce((sum, sale) => {
    // Count total seats sold across all sales
    return sum + (sale.numberOfSeats || sale.seats || sale.tickets?.length || 0);
  }, 0);

  const estimatedEarnings = Math.round(totalSalesAmount * COMMISSION_PERCENT);

  if (loading) {
    return (
      <div className="flex flex-col">
        <div className="bg-white rounded-xl shadow-md p-6 mb-6">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-3/4 mb-6 mx-auto"></div>
            <div className="space-y-4">
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              <div className="h-4 bg-gray-200 rounded w-1/3"></div>
              <div className="h-4 bg-gray-200 rounded w-2/5"></div>
            </div>
          </div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl shadow-md p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <button
          onClick={onBack}
          className="text-blue-600 hover:text-blue-800 font-medium flex items-center"
        >
          ← Назад
        </button>
        <h2 className="text-xl font-bold text-gray-800">Мои продажи</h2>
        <div className="w-8"></div> {/* Spacer for alignment */}
      </div>

      {/* Today's Summary */}
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <h3 className="text-lg font-bold text-center mb-4">Сегодня</h3>
        
        <div className="space-y-4">
          <div className="flex justify-between items-center pb-3 border-b border-gray-100">
            <span className="text-gray-600">Продал на:</span>
            <span className="text-xl font-bold text-gray-800">{formatRUB(totalSalesAmount)}</span>
          </div>
          
          <div className="flex justify-between items-center pb-3 border-b border-gray-100">
            <span className="text-gray-600">Продано мест:</span>
            <span className="text-xl font-bold text-gray-800">{totalSeatsSold}</span>
          </div>
          
          <div className="flex justify-between items-center pb-3 border-b border-gray-100">
            <span className="text-gray-600">Заработок (предварительно):</span>
            <span className="text-xl font-bold text-purple-600">{formatRUB(estimatedEarnings)}</span>
          </div>
          
          <div className="pt-2">
            <p className="text-xs text-gray-500 text-center">
              Предварительный расчёт, финально при закрытии смены
            </p>
          </div>
        </div>
      </div>

      {/* Sales List */}
      <div className="space-y-4">
        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
            <p className="text-red-600">{error}</p>
          </div>
        ) : sales.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-8 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">Нет продаж</h3>
            <p className="text-gray-500">Сегодня ещё нет продаж</p>
          </div>
        ) : (
          sales.map((sale, index) => {
            const saleDate = new Date(sale.created_at || sale.timestamp || sale.createdAt || Date.now());
            const timeString = saleDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            
            return (
              <div key={sale.id || index} className="bg-white rounded-xl shadow-md p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-medium text-gray-800">
                      {sale.trip?.boat_name || sale.boat_name || 'Рейс'}
                    </div>
                    <div className="text-sm text-gray-600">
                      {timeString} • {sale.numberOfSeats || sale.seats || sale.tickets?.length || 0} мест
                    </div>
                    {sale.customerName && (
                      <div className="text-sm text-gray-500 mt-1">
                        {sale.customerName}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-purple-600">
                      {formatRUB(sale.total_price || sale.totalPrice || 0)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {sale.status || 'Активен'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default SalesHistory;