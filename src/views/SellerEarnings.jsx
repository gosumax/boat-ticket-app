import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import EarningsScreen from '../components/seller/EarningsScreen';
import apiClient from '../utils/apiClient';

const SellerEarnings = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [soldTickets, setSoldTickets] = useState([]);

  useEffect(() => {
    // Load sold tickets for the current seller
    // For now, we'll simulate this with sample data
    // In a real app, this would fetch from the backend
    const loadEarningsData = async () => {
      try {
        // This would be an actual API call to get the seller's sales
        // const tickets = await apiClient.getSellerSales();
        // For now, using sample data
        const sampleTickets = [
          {
            id: 1,
            trip: { boat_name: "Скоростной катер" },
            prepaymentAmount: 2500,
            totalPrice: 2500,
            timestamp: "10.01.2026 14:30"
          },
          {
            id: 2,
            trip: { boat_name: "Прогулочный катер" },
            prepaymentAmount: 4200,
            totalPrice: 4200,
            timestamp: "10.01.2026 15:45"
          },
          {
            id: 3,
            trip: { boat_name: "Банан" },
            prepaymentAmount: 1800,
            totalPrice: 1800,
            timestamp: "10.01.2026 16:20"
          }
        ];
        setSoldTickets(sampleTickets);
      } catch (error) {
        console.error('Error loading earnings:', error);
        // Still set an empty array so the UI works
        setSoldTickets([]);
      }
    };

    loadEarningsData();
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50" data-testid="seller-earnings-screen">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 flex justify-between items-center shadow-md">
        <button 
          onClick={() => navigate(-1)}
          data-testid="seller-earnings-back"
          className="text-white hover:text-blue-200 transition-colors"
        >
          ← Назад
        </button>
        <h1 className="text-xl font-bold" data-testid="seller-earnings-title">Мои продажи</h1>
        <button 
          onClick={handleLogout}
          data-testid="seller-earnings-logout"
          className="bg-blue-700 hover:bg-blue-800 text-white px-3 py-1 rounded font-medium transition-colors"
        >
          Выйти
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4">
        <EarningsScreen 
          tickets={soldTickets} 
          onBack={() => navigate('/seller/home')} 
          onNewSale={() => navigate('/seller')} 
        />
      </div>
    </div>
  );
};

export default SellerEarnings;

