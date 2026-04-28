import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { formatRUB } from '../../utils/currency';
import apiClient from '../../utils/apiClient';
import { formatSaleCreatedAt } from '../../utils/sellerDashboard';

const HANDOFF_CHANNEL_OPTIONS = Object.freeze([
  { key: 'telegram', label: 'Telegram' },
  { key: 'max', label: 'Max' },
  { key: 'website', label: 'Сайт' },
]);

function pickFirst(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function toRuDateTime(value) {
  if (!value) return '';
  return formatSaleCreatedAt(value);
}

function buildFallbackChannelPayload(channelKey) {
  if (channelKey === 'telegram') {
    return {
      channel_key: 'telegram',
      channel_label: 'Telegram',
      handoff_status: 'blocked',
      message: 'Telegram handoff пока не готов для этого предзаказа.',
      deeplink_url: null,
      qr_payload_text: null,
    };
  }
  if (channelKey === 'max') {
    return {
      channel_key: 'max',
      channel_label: 'Max',
      handoff_status: 'planned',
      message: 'Канал Max скоро будет доступен.',
      deeplink_url: null,
      qr_payload_text: null,
    };
  }
  return {
    channel_key: 'website',
    channel_label: 'Сайт',
    handoff_status: 'planned',
    message: 'Веб-канал скоро будет доступен.',
    deeplink_url: null,
    qr_payload_text: null,
  };
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
  const [cancelError, setCancelError] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrError, setQrError] = useState('');

  const presaleObj = ticketInfo?.presale || ticketInfo;
  const slotObj = ticketInfo?.slot || ticketInfo?.trip || trip;
  const buyerHandoff = ticketInfo?.buyer_handoff || ticketInfo?.buyerHandoff || null;
  const handoffChannels =
    buyerHandoff && typeof buyerHandoff === 'object' ? buyerHandoff.channels || null : null;

  const presaleId = pickFirst(
    presaleObj?.id,
    presaleObj?.presale_id,
    presaleObj?.presaleId,
    ticketInfo?.id,
    ticketInfo?.presale_id,
    ticketInfo?.presaleId
  );
  const buyerTicketCode = pickFirst(
    buyerHandoff?.buyer_ticket_code,
    buyerHandoff?.buyerTicketCode,
    ticketInfo?.buyer_ticket_code,
    ticketInfo?.buyerTicketCode,
    presaleObj?.buyer_ticket_code,
    presaleObj?.buyerTicketCode
  );
  const boatName = pickFirst(
    slotObj?.boat_name,
    slotObj?.boatName,
    trip?.boat_name,
    presaleObj?.boat_name,
    ticketInfo?.boat_name
  );
  const time = pickFirst(slotObj?.time, trip?.time, presaleObj?.time, ticketInfo?.time);
  const seats = pickFirst(
    numberOfSeats,
    presaleObj?.number_of_seats,
    presaleObj?.numberOfSeats,
    ticketInfo?.number_of_seats,
    ticketInfo?.numberOfSeats,
    ticketInfo?.seats
  );

  const totalPrice = useMemo(() => {
    const fromApi = pickFirst(
      presaleObj?.total_price,
      presaleObj?.totalPrice,
      ticketInfo?.total_price,
      ticketInfo?.totalPrice,
      ticketInfo?.total,
      ticketInfo?.amount
    );
    if (typeof fromApi === 'number') return fromApi;

    const priceAdult = pickFirst(slotObj?.price_adult, slotObj?.price, trip?.price_adult, trip?.price);
    if (typeof priceAdult === 'number' && typeof seats === 'number') {
      return priceAdult * seats;
    }
    return 0;
  }, [ticketInfo, trip, seats, presaleObj, slotObj]);

  const paid = useMemo(() => {
    const fromApi = pickFirst(
      presaleObj?.prepayment_amount,
      presaleObj?.prepaymentAmount,
      ticketInfo?.prepayment_amount,
      ticketInfo?.prepaymentAmount,
      ticketInfo?.prepayment
    );
    if (typeof fromApi === 'number') return fromApi;
    if (typeof prepaymentAmount === 'number') return prepaymentAmount;
    return 0;
  }, [ticketInfo, prepaymentAmount, presaleObj]);

  const remaining = Math.max(0, (totalPrice || 0) - (paid || 0));
  const createdAt = pickFirst(
    presaleObj?.created_at,
    presaleObj?.createdAt,
    ticketInfo?.created_at,
    ticketInfo?.createdAt,
    ticketInfo?.timestamp
  );

  const selectedChannelPayload = useMemo(() => {
    if (!selectedChannel) {
      return null;
    }

    const channels = handoffChannels && typeof handoffChannels === 'object' ? handoffChannels : {};
    if (selectedChannel === 'website') {
      return channels.website || channels.site || buildFallbackChannelPayload(selectedChannel);
    }
    return channels[selectedChannel] || buildFallbackChannelPayload(selectedChannel);
  }, [selectedChannel, handoffChannels]);

  const selectedChannelQrPayload = useMemo(
    () =>
      pickFirst(
        selectedChannelPayload?.qr_payload_text,
        selectedChannelPayload?.qrPayloadText,
        selectedChannelPayload?.deeplink_url,
        selectedChannelPayload?.deepLinkUrl
      ),
    [selectedChannelPayload]
  );

  const selectedChannelIsReady = useMemo(
    () =>
      selectedChannelPayload?.handoff_status === 'ready' &&
      Boolean(selectedChannelQrPayload),
    [selectedChannelPayload, selectedChannelQrPayload]
  );

  useEffect(() => {
    setQrDataUrl('');
    setQrError('');

    if (!selectedChannel || !selectedChannelIsReady || !selectedChannelQrPayload) {
      return undefined;
    }

    let disposed = false;
    QRCode.toDataURL(selectedChannelQrPayload, {
      width: 340,
      margin: 2,
      errorCorrectionLevel: 'M',
    })
      .then((dataUrl) => {
        if (disposed) return;
        setQrDataUrl(dataUrl);
      })
      .catch((error) => {
        if (disposed) return;
        setQrError(error?.message || 'Не удалось построить QR для выбранного канала.');
      });

    return () => {
      disposed = true;
    };
  }, [selectedChannel, selectedChannelIsReady, selectedChannelQrPayload]);

  const handleCancelPresale = async () => {
    setCancelError(null);

    if (!presaleId) {
      setCancelError('Ошибка: ID предзаказа отсутствует');
      return;
    }

    try {
      setIsCancelling(true);

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
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!resp.ok) {
          let message = 'Не удалось отменить предзаказ';
          try {
            const data = await resp.json();
            if (data?.error) message = String(data.error);
          } catch {
            // ignore json parse errors
          }
          throw new Error(message);
        }
      }

      setIsCancelled(true);
      if (typeof onPresaleCancel === 'function') onPresaleCancel();
    } catch (error) {
      console.error('Cancel presale error:', error);
      setCancelError(error?.message ? String(error.message) : 'Не удалось отменить предзаказ');
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="bg-white rounded-xl shadow-md p-6 max-w-md w-full">
        <div className="text-center mb-5">
          <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg
              className="w-7 h-7 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12h6m-6 4h6m2 4H7a2 2 0 01-2-2V6a2 2 0 012-2h3.5a1.5 1.5 0 003 0H17a2 2 0 012 2v12a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900">
            {isCancelled ? 'Предзаказ отменён' : 'Передайте билет клиенту'}
          </h2>
          <p className="text-sm text-gray-600 mt-2">
            {isCancelled
              ? 'Предзаказ отменён и больше не активен.'
              : 'Покажите QR клиенту или назовите номер билета вручную.'}
          </p>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 text-center">
            Номер билета
          </div>
          <div className="text-center text-2xl font-bold text-gray-900 mt-1">
            {buyerTicketCode || '—'}
          </div>
          <div className="text-center text-xs text-gray-500 mt-1">
            Предзаказ № {presaleId ?? '—'}
          </div>
        </div>

        <div className="space-y-2 mb-4">
          <div className="text-sm font-medium text-gray-800">Канал передачи</div>
          <div className="grid grid-cols-3 gap-2">
            {HANDOFF_CHANNEL_OPTIONS.map((channel) => {
              const selected = selectedChannel === channel.key;
              return (
                <button
                  key={channel.key}
                  type="button"
                  onClick={() => setSelectedChannel(channel.key)}
                  className={`py-2 rounded-lg border text-sm font-medium transition-colors ${
                    selected
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-gray-300 text-gray-700 hover:border-blue-400'
                  }`}
                >
                  {channel.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 min-h-[180px]">
          {!selectedChannel && (
            <p className="text-sm text-gray-600 text-center">
              Выберите канал, после этого появится QR и ссылка передачи.
            </p>
          )}

          {selectedChannel && selectedChannelIsReady && qrDataUrl && (
            <div className="flex flex-col items-center gap-3">
              <div className="text-sm font-medium text-gray-800">
                {selectedChannelPayload?.channel_label || 'Telegram'} QR
              </div>
              <img
                src={qrDataUrl}
                alt="QR для передачи билета клиенту"
                className="w-52 h-52 rounded-lg border border-gray-200"
              />
              <div className="text-xs text-gray-500 text-center break-all">
                {selectedChannelPayload?.deeplink_url || selectedChannelQrPayload}
              </div>
            </div>
          )}

          {selectedChannel && selectedChannelIsReady && !qrDataUrl && !qrError && (
            <p className="text-sm text-gray-600 text-center">Готовим QR…</p>
          )}

          {selectedChannel && qrError && (
            <p className="text-sm text-red-600 text-center">{qrError}</p>
          )}

          {selectedChannel && !selectedChannelIsReady && (
            <p className="text-sm text-gray-600 text-center">
              {selectedChannelPayload?.message || 'Канал ещё не готов. Используйте номер билета вручную.'}
            </p>
          )}
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4">
          <p className="text-sm text-blue-800">
            Если клиент не сканирует QR, попросите открыть Telegram-бота и ввести номер билета{' '}
            <span className="font-semibold">{buyerTicketCode || '—'}</span>.
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
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
              <span className="font-medium text-gray-800">
                {customerName ||
                  presaleObj?.customer_name ||
                  presaleObj?.customerName ||
                  ticketInfo?.customer_name ||
                  ticketInfo?.customerName ||
                  '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Телефон:</span>
              <span className="font-medium text-gray-800">
                {customerPhone ||
                  presaleObj?.customer_phone ||
                  presaleObj?.customerPhone ||
                  ticketInfo?.customer_phone ||
                  ticketInfo?.customerPhone ||
                  '—'}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-gray-200">
              <span className="text-gray-600">Итого / Остаток:</span>
              <span className="font-semibold text-gray-800">
                {formatRUB(totalPrice || 0)} / {formatRUB(remaining || 0)}
              </span>
            </div>
          </div>
        </div>

        {createdAt && (
          <div className="text-xs text-gray-500 text-center mb-4">
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
            Завершить
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationScreen;
