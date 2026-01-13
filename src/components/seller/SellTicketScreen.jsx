const SellTicketScreen = ({ onSellTicket, onBack, onShowSalesHistory }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-gray-800 mb-4">Продать билет</h2>
        <p className="text-gray-600">Начать продажу нового билета</p>
      </div>
      
      <div className="flex flex-col space-y-3 w-full max-w-md">
        <div className="flex space-x-3">
          <button
            onClick={onBack}
            className="flex-1 py-5 px-6 text-xl font-medium rounded-xl bg-gray-300 text-gray-800 hover:bg-gray-400 active:bg-gray-500 transition-all shadow-lg"
          >
            Назад
          </button>
          <button 
            onClick={onSellTicket}
            className="flex-1 py-5 px-6 text-xl font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 transition-all shadow-lg transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Продать билет
          </button>
        </div>
      </div>
    </div>
  );
};

export default SellTicketScreen;