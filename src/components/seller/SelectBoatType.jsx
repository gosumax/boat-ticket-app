import React from 'react';

const SelectBoatType = ({ onSelect, onBack }) => {
  return (
    <div className="flex flex-col gap-4" data-testid="seller-select-type-screen">
      <h2 className="text-2xl font-bold text-center">Выберите тип лодки</h2>

      <button
        className="w-full py-4 rounded-xl bg-blue-600 text-white text-lg font-semibold"
        data-testid="seller-type-speed"
        onClick={() => onSelect('speed')}
      >
        Скоростная
      </button>

      <button
        className="w-full py-4 rounded-xl bg-green-600 text-white text-lg font-semibold"
        data-testid="seller-type-cruise"
        onClick={() => onSelect('cruise')}
      >
        Прогулочная
      </button>

      <button
        className="w-full py-4 rounded-xl bg-yellow-500 text-white text-lg font-semibold"
        data-testid="seller-type-banana"
        onClick={() => onSelect('banana')}
      >
        Банан
      </button>

      {/* Заглушка: Рыбалка (пока не активна) */}
      <button
        className="w-full py-4 rounded-xl bg-gray-200 text-gray-500 text-lg font-semibold cursor-not-allowed"
        disabled
      >
        🎣 Рыбалка (скоро)
      </button>

      <button
        className="w-full py-3 rounded-xl bg-gray-300 text-gray-800 font-medium"
        data-testid="seller-type-back"
        onClick={onBack}
      >
        Назад
      </button>
    </div>
  );
};

export default SelectBoatType;
