import React from 'react';

const ConfirmCancelTripModal = ({ open, onConfirm, onClose }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-white p-4 rounded w-[320px]">
        <h3 className="font-semibold mb-2">Отменить рейс?</h3>

        <p className="text-sm mb-2">
          Рейс будет отменён и новые продажи станут недоступны.
        </p>

        <p className="text-sm mb-4">
          Все купленные билеты перейдут в список для обработки.
        </p>

        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1 bg-gray-200 rounded"
            onClick={onClose}
          >
            Нет
          </button>

          <button
            className="px-3 py-1 bg-red-600 text-white rounded"
            onClick={onConfirm}
          >
            Да, отменить
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmCancelTripModal;