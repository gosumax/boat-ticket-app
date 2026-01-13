const SelectBoatType = ({ selectedType, onSelect, onBack }) => {
  return (
    <div className="flex flex-col items-center">
      <h2 className="text-2xl font-bold text-gray-800 mb-8 text-center">Тип лодки</h2>

      <div className="w-full max-w-sm space-y-4">
        <button
          type="button"
          onClick={() => onSelect('speed')}
          className={`w-full py-6 text-xl font-medium rounded-xl transition-all shadow-lg flex items-center justify-center transform hover:scale-[1.02] active:scale-[0.98] ${
            selectedType === 'speed'
              ? 'bg-blue-700 text-white'
              : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
          }`}
        >
          <span className="mr-2 text-2xl">⚡</span> Скоростная
        </button>

        <button
          type="button"
          onClick={() => onSelect('cruise')}
          className={`w-full py-6 text-xl font-medium rounded-xl transition-all shadow-lg flex items-center justify-center transform hover:scale-[1.02] active:scale-[0.98] ${
            selectedType === 'cruise'
              ? 'bg-green-700 text-white'
              : 'bg-green-600 text-white hover:bg-green-700 active:bg-green-800'
          }`}
        >
          <span className="mr-2 text-2xl">🚢</span> Прогулочная
        </button>

        <button
          type="button"
          onClick={() => onSelect('banana')}
          className={`w-full py-6 text-xl font-medium rounded-xl transition-all shadow-lg flex items-center justify-center transform hover:scale-[1.02] active:scale-[0.98] ${
            selectedType === 'banana'
              ? 'bg-yellow-600 text-white'
              : 'bg-yellow-500 text-white hover:bg-yellow-600 active:bg-yellow-700'
          }`}
        >
          <span className="mr-2 text-2xl">🍌</span> Банан
        </button>
      </div>

      <div className="mt-6 w-full max-w-sm">
        <button
          type="button"
          onClick={onBack}
          className="w-full py-4 text-lg font-medium rounded-xl bg-gray-300 text-gray-800 hover:bg-gray-400 active:bg-gray-500 transition-all shadow-lg"
        >
          Назад
        </button>
      </div>
    </div>
  );
};

export default SelectBoatType;
