import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../utils/apiClient';
import Toast from '../Toast';

const ClearTripsButton = ({ onClearComplete }) => {
  const { currentUser } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: '' });

  const handleClearTrips = async () => {
    if (confirmationText !== 'DELETE ALL') {
      setToast({ show: true, message: 'Текст подтверждения введён неверно', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.clearAllTrips();

      
      if (response.ok) {
        setToast({ 
          show: true, 
          message: `Все рейсы удалены: ${response.deleted.generated_slots} сгенерированных, ${response.deleted.boat_slots} ручных`, 
          type: 'success' 
        });
        
        if (onClearComplete) {
          onClearComplete();
        }
      } else {
        setToast({ 
          show: true, 
          message: response.error || 'Ошибка при удалении рейсов', 
          type: 'error' 
        });
      }
    } catch (error) {
      setToast({ 
        show: true, 
        message: 'Ошибка при удалении рейсов: ' + error.message, 
        type: 'error' 
      });
    } finally {
      setLoading(false);
      setShowModal(false);
      setConfirmationText('');
    }
  };

  // Only show for admin/owner roles
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
    return null;
  }

  return (
    <>
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}

      <button
        onClick={() => setShowModal(true)}
        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md transition-colors duration-200 font-medium"
      >
        ❌ Очистить все рейсы
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Подтверждение действия</h3>
            <p className="text-gray-600 mb-4">
              Вы уверены? Будут удалены ВСЕ рейсы.
            </p>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Введите "DELETE ALL" для подтверждения:
              </label>
              <input
                type="text"
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Введите DELETE ALL"
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowModal(false);
                  setConfirmationText('');
                }}
                className="px-4 py-2 text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-md transition-colors duration-200"
                disabled={loading}
              >
                Отмена
              </button>
              <button
                onClick={handleClearTrips}
                disabled={loading || confirmationText !== 'DELETE ALL'}
                className={`px-4 py-2 text-white rounded-md transition-colors duration-200 ${
                  confirmationText === 'DELETE ALL' && !loading
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-red-400 cursor-not-allowed'
                }`}
              >
                {loading ? 'Удаление...' : 'Подтвердить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ClearTripsButton;