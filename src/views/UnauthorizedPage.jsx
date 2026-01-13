import { Link } from 'react-router-dom';

const UnauthorizedPage = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-blue-50 to-blue-100 p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-8 text-center">
        <div className="text-5xl mb-6">🚫</div>
        <h1 className="text-2xl font-bold text-red-600 mb-4">Доступ запрещён</h1>
        <p className="text-gray-600 mb-8">
          У вас нет прав для доступа к этой странице.
        </p>
        <Link 
          to="/" 
          className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Вернуться на главную
        </Link>
      </div>
    </div>
  );
};

export default UnauthorizedPage;