import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../utils/apiClient';
import { formatRUB } from '../utils/currency';

const COMMISSION_PERCENT = 13; // Temporary commission rate

const DispatcherShiftClose = ({ setShiftClosed: setGlobalShiftClosed }) => {
  const navigate = useNavigate();
  const { logout: authLogout } = useAuth();
  
  // Mock data for shift closing
  const [dailySummary, setDailySummary] = useState(null);
  const [sellersData, setSellersData] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // State for confirmation checkboxes
  const [confirmationChecks, setConfirmationChecks] = useState({
    cashHandedOver: false,
    salaryCalculated: false,
    noComplaints: false
  });
  
  // State to track if shift is closed
  const [shiftClosed, setShiftClosed] = useState(false);

  // Function to generate mock data
  const generateMockData = () => {
    // Mock daily summary
    const mockSummary = {
      totalRevenue: 125000,
      cashRevenue: 75000,
      cardRevenue: 50000,
      commissionPaid: 16250 // 13% of total revenue
    };
    
    // Mock sellers data
    const mockSellers = [
      { id: 1, name: 'Иванова А.', totalSales: 35000, cashSales: 20000, cardSales: 15000, cashToHandOver: 20000, salary: 4550 },
      { id: 2, name: 'Петров Б.', totalSales: 28000, cashSales: 18000, cardSales: 10000, cashToHandOver: 18000, salary: 3640 },
      { id: 3, name: 'Сидорова В.', totalSales: 42000, cashSales: 25000, cardSales: 17000, cashToHandOver: 25000, salary: 5460 },
      { id: 4, name: 'Козлов Г.', totalSales: 20000, cashSales: 12000, cardSales: 8000, cashToHandOver: 12000, salary: 2600 },
    ];
    
    setDailySummary(mockSummary);
    setSellersData(mockSellers);
    setLoading(false);
  };
  
  useEffect(() => {
    // In a real implementation, we would fetch actual data
    // For now, we'll use mock data
    generateMockData();
  }, []);

  const handleShiftClose = () => {
    if (window.confirm('Вы уверены, что хотите закрыть смену?')) {
      // Set shift as closed
      setShiftClosed(true);
      // Set global shift closed state
      localStorage.setItem('dispatcher_shiftClosed', 'true');
      if (setGlobalShiftClosed) {
        setGlobalShiftClosed(true);
      }
      // In a real implementation, this would call an API endpoint
      alert('Смена закрыта');
    }
  };

  const handleCheckboxChange = (checkboxName) => {
    setConfirmationChecks(prev => ({
      ...prev,
      [checkboxName]: !prev[checkboxName]
    }));
  };

  const allChecked = Object.values(confirmationChecks).every(value => value);

  const logout = () => {
    authLogout();
    navigate('/login', { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950">
        <div className="p-3">
          <div className="max-w-4xl mx-auto">
            <div className="text-center py-8">Загрузка...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="p-3">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Daily Summary Card */}
          <div className="bg-neutral-900 rounded-2xl  p-3">
            <h2 className="text-xl font-bold text-neutral-100 mb-4">ИТОГО ЗА ДЕНЬ</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-neutral-950 p-3 rounded-lg">
                <div className="text-neutral-400">Общая выручка</div>
                <div className="text-2xl font-bold text-purple-600">{formatRUB(dailySummary.totalRevenue)}</div>
              </div>
              <div className="bg-neutral-950 p-3 rounded-lg">
                <div className="text-neutral-400">Наличка/предоплата</div>
                <div className="text-2xl font-bold text-green-600">{formatRUB(dailySummary.cashRevenue)}</div>
              </div>
              <div className="bg-neutral-950 p-3 rounded-lg">
                <div className="text-neutral-400">Безнал/онлайн</div>
                <div className="text-2xl font-bold text-blue-600">{formatRUB(dailySummary.cardRevenue)}</div>
              </div>
              <div className="bg-neutral-950 p-3 rounded-lg">
                <div className="text-neutral-400">Начислено ЗП продавцам</div>
                <div className="text-2xl font-bold text-orange-600">{formatRUB(dailySummary.commissionPaid)}</div>
              </div>
            </div>
          </div>
          
          {/* Sellers Table */}
          <div className="bg-neutral-900 rounded-2xl  p-3">
            <h2 className="text-xl font-bold text-neutral-100 mb-4">По продавцам</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-neutral-400 font-medium">Продавец</th>
                    <th className="text-right py-2 text-neutral-400 font-medium">Продал на</th>
                    <th className="text-right py-2 text-neutral-400 font-medium">Нал/предоплата</th>
                    <th className="text-right py-2 text-neutral-400 font-medium">Безнал/онлайн</th>
                    <th className="text-right py-2 text-neutral-400 font-medium">Сдать диспетчеру</th>
                    <th className="text-right py-2 text-neutral-400 font-medium">ЗП выдать</th>
                  </tr>
                </thead>
                <tbody>
                  {sellersData.map(seller => (
                    <tr key={seller.id} className="border-b hover:bg-neutral-950">
                      <td className="py-3">{seller.name}</td>
                      <td className="text-right py-3 font-medium">{formatRUB(seller.totalSales)}</td>
                      <td className="text-right py-3">{formatRUB(seller.cashSales)}</td>
                      <td className="text-right py-3">{formatRUB(seller.cardSales)}</td>
                      <td className="text-right py-3 font-bold text-green-600">{formatRUB(seller.cashToHandOver)}</td>
                      <td className="text-right py-3 font-bold text-purple-600">{formatRUB(seller.salary)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="mt-4 text-sm text-gray-500 italic">
              Предварительный расчёт по {COMMISSION_PERCENT}% (позже заменим мотивацией)
            </div>
          </div>
          
          {shiftClosed ? (
            <div className="bg-green-100 border border-green-300 rounded-2xl p-3 mt-6">
              <h3 className="text-lg font-semibold text-green-800 mb-3">Статус смены</h3>
              <p className="text-green-700 font-medium">Смена закрыта</p>
            </div>
          ) : (
            <>
              {/* Confirmation Checks */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-3 mt-6">
                <h3 className="text-lg font-semibold text-neutral-100 mb-3">Подтверждение закрытия смены</h3>
                <div className="space-y-2">
                  <label className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={confirmationChecks.cashHandedOver}
                      onChange={() => handleCheckboxChange('cashHandedOver')}
                      disabled={shiftClosed}
                      className="h-5 w-5 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="text-neutral-300">Все продавцы сдали наличные/предоплаты</span>
                  </label>
                  <label className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={confirmationChecks.salaryCalculated}
                      onChange={() => handleCheckboxChange('salaryCalculated')}
                      disabled={shiftClosed}
                      className="h-5 w-5 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="text-neutral-300">ЗП продавцам рассчитана корректно</span>
                  </label>
                  <label className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={confirmationChecks.noComplaints}
                      onChange={() => handleCheckboxChange('noComplaints')}
                      disabled={shiftClosed}
                      className="h-5 w-5 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="text-neutral-300">Претензий по рейсам и билетам нет</span>
                  </label>
                </div>
              </div>
              
              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <button
                  onClick={handleShiftClose}
                  disabled={!allChecked || shiftClosed}
                  className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${allChecked && !shiftClosed ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
                >
                  Закрыть смену
                </button>
                <button
                  onClick={() => navigate('/dispatcher')}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-neutral-100 py-3 px-4 rounded-lg font-medium transition-colors"
                >
                  Вернуться к работе
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DispatcherShiftClose;