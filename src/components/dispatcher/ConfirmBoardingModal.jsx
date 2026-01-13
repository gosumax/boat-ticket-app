import React from 'react';

const ConfirmBoardingModal = ({ 
  open, 
  onConfirm, 
  onClose, 
  loading = false,
  error = null 
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white p-6 rounded-lg max-w-sm w-full">
        <h3 className="font-semibold text-lg mb-2">Подтвердить посадку?</h3>

        <p className="text-sm text-gray-600 mb-4">
          После подтверждения посадки возврат по этому билету будет недоступен.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
            onClick={onClose}
            disabled={loading}
          >
            Отмена
          </button>

          <button
            className={`px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors ${
              loading ? 'opacity-75 cursor-not-allowed' : ''
            }`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Подтверждение...' : 'Подтвердить'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmBoardingModal;