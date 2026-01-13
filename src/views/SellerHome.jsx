import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const SellerHome = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-gradient-to-b from-blue-50 to-blue-100 p-4">
      {/* Header with logout */}
      <div className="w-full max-w-md flex justify-end mb-8">
        <button 
          onClick={handleLogout}
          className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded-lg font-medium transition-colors"
        >
          Выйти
        </button>
      </div>
      
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-blue-800 mb-2">⛵ Морские билеты</h1>
        <p className="text-lg text-blue-600">Продавец</p>
      </div>
      
      <div className="w-full max-w-sm space-y-4">
        <button 
          onClick={() => navigate('/seller')}
          className="w-full text-center py-5 text-xl font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 transition-all shadow-lg transform hover:scale-[1.02] active:scale-[0.98]"
        >
          Продать билет
        </button>
        
        <button 
          onClick={() => navigate('/dispatcher')}
          className="w-full text-center py-5 text-xl font-medium rounded-xl bg-green-600 text-white hover:bg-green-700 active:bg-green-800 transition-all shadow-lg transform hover:scale-[1.02] active:scale-[0.98]"
        >
          Расписание
        </button>
        
        <button 
          onClick={() => navigate('/seller/earnings')}
          className="w-full text-center py-5 text-xl font-medium rounded-xl bg-yellow-600 text-white hover:bg-yellow-700 active:bg-yellow-800 transition-all shadow-lg transform hover:scale-[1.02] active:scale-[0.98]"
        >
          Мои продажи
        </button>
        
        <button 
          onClick={() => navigate('/seller/media')}
          className="w-full text-center py-5 text-xl font-medium rounded-xl bg-purple-600 text-white hover:bg-purple-700 active:bg-purple-800 transition-all shadow-lg transform hover:scale-[1.02] active:scale-[0.98]"
        >
          Фото|видео
        </button>
      </div>
      
      <div className="mt-16 text-center">
        <p className="text-blue-700 text-sm">Система продаж билетов v1.0</p>
      </div>
    </div>
  );
};

export default SellerHome;