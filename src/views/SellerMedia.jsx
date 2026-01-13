import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const SellerMedia = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 flex justify-between items-center shadow-md">
        <button 
          onClick={() => navigate(-1)}
          className="text-white hover:text-blue-200 transition-colors"
        >
          ← Назад
        </button>
        <h1 className="text-xl font-bold">Фото|видео</h1>
        <button 
          onClick={handleLogout}
          className="bg-blue-700 hover:bg-blue-800 text-white px-3 py-1 rounded font-medium transition-colors"
        >
          Выйти
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Фото|видео</h2>
          <p className="text-gray-600">Страница в разработке</p>
        </div>
      </div>
    </div>
  );
};

export default SellerMedia;