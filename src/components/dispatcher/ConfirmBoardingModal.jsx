import React from 'react';

/**
 * ConfirmBoardingModal
 *
 * Backward compatible:
 *  - default mode "boarding" (old UI)
 *  - mode "prepay_decision" for cancelling a presale that has prepayment
 */
const ConfirmBoardingModal = ({
  open,
  onConfirm,
  onClose,
  loading = false,
  error = null,
  mode = 'boarding', // 'boarding' | 'prepay_decision'
  prepayAmount = 0,
}) => {
  if (!open) return null;

  const isPrepayDecision = mode === 'prepay_decision';
  const title = isPrepayDecision ? 'Предоплата: что сделать?' : 'Подтвердить посадку?';
  const description = isPrepayDecision
    ? `В заказе есть предоплата ${Number(prepayAmount || 0).toLocaleString('ru-RU')} ₽. Куда её отправить?`
    : 'После подтверждения посадки возврат по этому билету будет недоступен.';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white p-6 rounded-lg max-w-sm w-full">
        <h3 className="font-semibold text-lg mb-2">{title}</h3>

        <p className="text-sm text-gray-600 mb-4">{description}</p>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
            onClick={onClose}
            disabled={loading}
          >
            Отмена
          </button>

          {isPrepayDecision ? (
            <>
              <button
                className={`px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors ${
                  loading ? 'opacity-75 cursor-not-allowed' : ''
                }`}
                onClick={() => onConfirm?.('REFUND')}
                disabled={loading}
              >
                {loading ? '...' : 'Вернуть клиенту'}
              </button>

              <button
                className={`px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors ${
                  loading ? 'opacity-75 cursor-not-allowed' : ''
                }`}
                onClick={() => onConfirm?.('FUND')}
                disabled={loading}
              >
                {loading ? '...' : 'В сезонный фонд'}
              </button>
            </>
          ) : (
            <button
              className={`px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors ${
                loading ? 'opacity-75 cursor-not-allowed' : ''
              }`}
              onClick={() => onConfirm?.()}
              disabled={loading}
            >
              {loading ? 'Подтверждение...' : 'Подтвердить'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConfirmBoardingModal;
