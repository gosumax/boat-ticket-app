import React from 'react';

/**
 * ConfirmCancelTripModal
 *
 * Old usage (backward compatible):
 *   <ConfirmCancelTripModal open onConfirm onClose />
 *
 * New usage (prepay decision):
 *   <ConfirmCancelTripModal open mode="PREPAY_DECISION" prepayAmount onRefund onFund onClose loading error />
 */
const ConfirmCancelTripModal = (props) => {
  const open = !!props.open;
  const mode = props.mode || null;
  const onConfirm = props.onConfirm;
  const onClose = props.onClose;
  const prepayAmount = Number(props.prepayAmount || 0);
  const onRefund = props.onRefund;
  const onFund = props.onFund;
  const loading = !!props.loading;
  const error = props.error || null;

  if (!open) return null;

  const isPrepayDecision =
    mode === 'PREPAY_DECISION' &&
    (typeof onRefund === 'function' || typeof onFund === 'function');

  if (isPrepayDecision) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-lg max-w-sm w-full">
          <h3 className="font-semibold text-lg mb-2">Предоплата: что сделать?</h3>

          <p className="text-sm text-gray-700 mb-3">
            Предоплата: <span className="font-semibold">{prepayAmount.toLocaleString('ru-RU')} ₽</span>
          </p>

          <p className="text-sm text-gray-600 mb-4">
            Выбери действие: вернуть клиенту или отправить в сезонный фонд.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>
          )}

          <div className="flex flex-col gap-2">
            <button
              className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-70 disabled:cursor-not-allowed"
              onClick={onRefund}
              disabled={loading}
            >
              {loading ? 'Обработка…' : 'Вернуть предоплату'}
            </button>

            <button
              className="w-full px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-70 disabled:cursor-not-allowed"
              onClick={onFund}
              disabled={loading}
            >
              {loading ? 'Обработка…' : 'В сезонный фонд'}
            </button>

            <button
              className="w-full px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 disabled:opacity-70 disabled:cursor-not-allowed"
              onClick={onClose}
              disabled={loading}
            >
              Назад
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Back-compat: cancel whole trip
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-white p-4 rounded w-[320px]">
        <h3 className="font-semibold mb-2">Отменить рейс?</h3>

        <p className="text-sm mb-2">Рейс будет отменён и новые продажи станут недоступны.</p>

        <p className="text-sm mb-4">Все купленные билеты перейдут в список для обработки.</p>

        <div className="flex justify-end gap-2">
          <button className="px-3 py-1 bg-gray-200 rounded" onClick={onClose} disabled={loading}>
            Нет
          </button>

          <button
            className="px-3 py-1 bg-red-600 text-white rounded disabled:opacity-70 disabled:cursor-not-allowed"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? '...' : 'Да, отменить'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmCancelTripModal;
