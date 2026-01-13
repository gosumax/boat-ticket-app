import React, { useMemo, useState } from 'react';
import { formatRUB } from '../../utils/currency';
import apiClient from '../../utils/apiClient';

function pickFirst(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function toRuDateTime(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return String(value);
  }
}

const ConfirmationScreen = ({
  ticketInfo,
  trip,
  numberOfSeats,
  customerName,
  customerPhone,
  prepaymentAmount,
  onBack,
  onConfirm,
  onPresaleCancel
}) => {
  const [isCancelled, setIsCancelled] = useState(false);
  const presaleObj = ticketInfo?.presale || ticketInfo;
  const slotObj = ticketInfo?.slot || ticketInfo?.trip || trip;

  const [cancelError, setCancelError] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);

    const presaleId = pickFirst(presaleObj?.id, presaleObj?.presale_id, presaleObj?.presaleId, ticketInfo?.id, ticketInfo?.presale_id, ticketInfo?.presaleId);
    const boatName = pickFirst(slotObj?.boat_name, slotObj?.boatName, trip?.boat_name, presaleObj?.boat_name, ticketInfo?.boat_name);
    const time = pickFirst(slotObj?.time, trip?.time, presaleObj?.time, ticketInfo?.time);
    const seats = pickFirst(numberOfSeats, presaleObj?.number_of_seats, presaleObj?.numberOfSeats, ticketInfo?.number_of_seats, ticketInfo?.numberOfSeats, ticketInfo?.seats);

  const totalPrice = useMemo(() => {
    const fromApi = pickFirst(presaleObj?.total_price, presaleObj?.totalPrice, ticketInfo?.total_price, ticketInfo?.totalPrice, ticketInfo?.total, ticketInfo?.amount);
    if (typeof fromApi === 'number') return fromApi;

    const priceAdult = pickFirst(slotObj?.price_adult, slotObj?.price, trip?.price_adult, trip?.price);
    if (typeof priceAdult === 'number' && typeof seats === 'number') {
      return priceAdult * seats;
    }
    return 0;
  }, [ticketInfo, trip, seats]);

  const paid = useMemo(() => {
    const fromApi = pickFirst(presaleObj?.prepayment_amount, presaleObj?.prepaymentAmount, ticketInfo?.prepayment_amount, ticketInfo?.prepaymentAmount, ticketInfo?.prepayment);
    if (typeof fromApi === 'number') return fromApi;
    if (typeof prepaymentAmount === 'number') return prepaymentAmount;
    return 0;
  }, [ticketInfo, prepaymentAmount]);

  const remaining = Math.max(0, (totalPrice || 0) - (paid || 0));

  const createdAt = pickFirst(presaleObj?.created_at, presaleObj?.createdAt, ticketInfo?.created_at, ticketInfo?.createdAt, ticketInfo?.timestamp);

  const handleCancelPresale = async () => {
    setCancelError(null);

    if (!presaleId) {
      setCancelError('Ошибка: ID предзаказа отсутствует');
      return;
    }

    try {
      setIsCancelling(true);

      // Prefer apiClient method if it exists, BUT call it as a method (keep correct `this`).
      // Some apiClient implementations rely on `this.request(...)`.
      if (typeof apiClient?.cancelPresale === 'function') {
        await apiClient.cancelPresale(presaleId);
      } else if (typeof apiClient?.cancelPresaleById === 'function') {
        await apiClient.cancelPresaleById(presaleId);
      } else if (typeof apiClient?.cancelPreorder === 'function') {
        await apiClient.cancelPreorder(presaleId);
      } else {
        const token = localStorage.getItem('token');
        const resp = await fetch(`/api/selling/presales/${presaleId}/cancel`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          }
        });

        if (!resp.ok) {
          let msg = 'Не удалось отменить предзаказ';
          try {
            const data = await resp.json();
            if (data?.error) msg = String(data.error);
          } catch {
            // ignore
          }
          throw new Error(msg);
        }
      }

      setIsCancelled(true);
      if (typeof onPresaleCancel === 'function') onPresaleCancel();
    } catch (e) {
      console.error('Cancel presale error:', e);
      setCancelError(e?.message ? String(e.message) : 'Не удалось отменить предзаказ');
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">{isCancelled ? 'Отменено' : 'Успешно!'}</h2>
          <p className="text-gray-600">{isCancelled ? 'Предзаказ отменён' : 'Предзаказ создан'}</p>
        </div>

        <div className="bg-gray-50 rounded-lg p-6 mb-6">
          <div className="text-center text-sm text-gray-500 mb-4">Номер предзаказа</div>
          <div className="text-center text-2xl font-bold text-gray-800 mb-4">{presaleId ?? '—'}</div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Лодка:</span>
              <span className="font-medium text-gray-800">{boatName ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Время:</span>
              <span className="font-medium text-gray-800">{time ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Мест:</span>
              <span className="font-medium text-gray-800">{seats ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Клиент:</span>
              <span className="font-medium text-gray-800">{customerName || presaleObj?.customer_name || presaleObj?.customerName || ticketInfo?.customer_name || ticketInfo?.customerName || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Телефон:</span>
              <span className="font-medium text-gray-800">{customerPhone || presaleObj?.customer_phone || presaleObj?.customerPhone || ticketInfo?.customer_phone || ticketInfo?.customerPhone || '—'}</span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Общая стоимость:</span>
              <span className="font-bold text-gray-800">{formatRUB(totalPrice || 0)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Предоплата:</span>
              <span className="font-bold text-green-600">-{formatRUB(paid || 0)}</span>
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-gray-200">
              <span className="text-gray-800 font-bold">Остаток к оплате:</span>
              <span className="text-xl font-bold text-blue-600">{formatRUB(remaining || 0)}</span>
            </div>
          </div>
        </div>

        {createdAt && (
          <div className="text-xs text-gray-500 text-center mb-6">
            Дата создания: {toRuDateTime(createdAt)}
          </div>
        )}

        {cancelError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm mb-4">
            {cancelError}
          </div>
        )}

        <div className="flex space-x-3">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 py-3 bg-gray-300 text-gray-800 rounded-lg font-medium hover:bg-gray-400 transition-colors"
          >
            Назад
          </button>

          <button
            type="button"
            onClick={handleCancelPresale}
            disabled={isCancelled || isCancelling}
            className="flex-1 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Отменить
          </button>

          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationScreen;
