import { formatRUB } from '../../utils/currency';

const EarningsScreen = ({ tickets, onNewSale, onBack }) => {
  // Calculate earnings
  const totalEarnings = tickets.reduce((sum, ticket) => sum + (ticket.prepaymentAmount || ticket.totalPrice || 0), 0);
  const totalTickets = tickets.length;

  return (
    <div className="flex flex-col items-center">
      <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Заработок</h2>
          <p className="text-gray-600">Сегодняшние продажи</p>
        </div>
        
        <div className="bg-gray-50 rounded-lg p-6 mb-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Продано предзаказов:</span>
              <span className="text-2xl font-bold text-gray-800">{totalTickets}</span>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-gray-200">
              <span className="text-gray-600">Общий заработок:</span>
              <span className="text-2xl font-bold text-purple-600">{formatRUB(totalEarnings)}</span>
            </div>
          </div>
        </div>
        
        <div className="mb-6">
          <h3 className="font-bold text-lg mb-3">Последние продажи</h3>
          <div className="max-h-60 overflow-y-auto">
            {tickets.slice(-5).reverse().map((ticket, index) => (
              <div key={ticket.id} className="flex justify-between items-center py-2 border-b border-gray-100">
                <div>
                  <p className="font-medium text-sm">{ticket.trip?.boat_name}</p>
                  <p className="text-xs text-gray-500">{ticket.timestamp}</p>
                </div>
                <span className="font-bold text-purple-600">{formatRUB(ticket.prepaymentAmount || ticket.totalPrice)}</span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="flex space-x-3">
          <button
            onClick={onBack}
            className="flex-1 py-3 bg-gray-300 text-gray-800 rounded-lg font-medium hover:bg-gray-400 transition-colors"
          >
            Назад
          </button>
          <button
            onClick={onNewSale}
            className="flex-1 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors"
          >
            Новая продажа
          </button>
        </div>
      </div>
    </div>
  );
};

export default EarningsScreen;