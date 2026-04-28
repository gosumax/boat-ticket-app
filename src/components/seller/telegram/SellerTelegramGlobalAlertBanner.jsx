import React from 'react';
import { useMemo } from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { sellerContentClass } from '../sellerUi';
import { useSellerTelegramRequests } from './SellerTelegramRequestsContext';
import { formatSellerTelegramAmount } from './sellerTelegramQueueModel';

export const SELLER_TELEGRAM_REQUESTS_ROUTE = '/seller/telegram-requests';

function resolveUrgencyTone(urgency) {
  if (urgency === 'near_expiry') {
    return {
      shell: 'border-rose-300 bg-rose-50 text-rose-900',
      badge: 'bg-rose-600 text-white',
    };
  }
  if (urgency === 'urgent') {
    return {
      shell: 'border-amber-300 bg-amber-50 text-amber-900',
      badge: 'bg-amber-500 text-slate-950',
    };
  }
  return {
    shell: 'border-sky-300 bg-sky-50 text-sky-900',
    badge: 'bg-sky-600 text-white',
  };
}

function formatSingleBannerDetails(item) {
  if (!item) {
    return '';
  }
  const tripTime = item.requestedTimeSlot || 'время не указано';
  const seats = Number(item.requestedSeats || 0);
  return `Таймер ${item.timerLabel} • Рейс ${tripTime} • ${seats} мест • Предоплата ${formatSellerTelegramAmount(item.requestedPrepaymentAmount)}`;
}

function formatAggregatedBannerDetails(queueModel) {
  const primary = queueModel.bannerPrimaryItem;
  const nearestTimer = primary?.timerLabel || 'без таймера';
  return `Заявок: ${queueModel.unacknowledgedCount} • Ближайший таймер: ${nearestTimer}`;
}

export function openSellerTelegramRequests(navigate, { requestId = null } = {}) {
  const query = requestId ? `?requestId=${encodeURIComponent(String(requestId))}` : '';
  navigate(`${SELLER_TELEGRAM_REQUESTS_ROUTE}${query}`);
}

export default function SellerTelegramGlobalAlertBanner() {
  const navigate = useNavigate();
  const { queueModel, markRequestOpened, markRequestsOpened } = useSellerTelegramRequests();
  const isAggregated = queueModel.unacknowledgedCount > 1;
  const primaryItem = queueModel.bannerPrimaryItem;

  const tone = useMemo(
    () => resolveUrgencyTone(queueModel.bannerUrgency),
    [queueModel.bannerUrgency]
  );

  if (!queueModel.hasBanner) {
    return null;
  }

  const headline = isAggregated ? 'Новые Telegram заявки' : 'Новая Telegram заявка';
  const detailLine = isAggregated
    ? formatAggregatedBannerDetails(queueModel)
    : formatSingleBannerDetails(primaryItem);

  return (
    <div className={`${sellerContentClass} sticky top-[73px] z-10 pt-2 pb-0`}>
      <button
        type="button"
        data-testid="seller-telegram-global-alert"
        data-navigation-target={SELLER_TELEGRAM_REQUESTS_ROUTE}
        onClick={() => {
          if (isAggregated) {
            markRequestsOpened(queueModel.bannerItems.map((item) => item.bookingRequestId));
            openSellerTelegramRequests(navigate);
            return;
          }

          if (primaryItem?.bookingRequestId) {
            markRequestOpened(primaryItem.bookingRequestId);
          }
          openSellerTelegramRequests(navigate, {
            requestId: primaryItem?.bookingRequestId || null,
          });
        }}
        className={clsx(
          'w-full rounded-2xl border px-3 py-2 text-left shadow-sm transition-colors',
          'hover:brightness-[1.02]',
          tone.shell
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-sm font-semibold">{headline}</div>
          <span className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold', tone.badge)}>
            Открыть
          </span>
        </div>
        <div className="mt-1 truncate text-xs opacity-95" title={detailLine}>
          {detailLine}
        </div>
      </button>
    </div>
  );
}
