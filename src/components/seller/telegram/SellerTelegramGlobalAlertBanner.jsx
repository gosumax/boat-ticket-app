import React from 'react';
import { useMemo } from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { sellerContentClass } from '../sellerUi';
import { useSellerTelegramRequests } from './SellerTelegramRequestsContext';

export const SELLER_TELEGRAM_REQUESTS_ROUTE = '/seller/telegram-requests';

function resolveUrgencyTone(urgency) {
  if (urgency === 'near_expiry') {
    return {
      shell: 'border-rose-300 bg-rose-50 text-rose-900',
      pill: 'bg-rose-600 text-white',
      label: 'Near expiry',
    };
  }
  if (urgency === 'urgent') {
    return {
      shell: 'border-amber-300 bg-amber-50 text-amber-900',
      pill: 'bg-amber-500 text-slate-950',
      label: 'Urgent',
    };
  }
  return {
    shell: 'border-sky-300 bg-sky-50 text-sky-900',
    pill: 'bg-sky-600 text-white',
    label: 'Normal',
  };
}

export function openSellerTelegramRequests(navigate) {
  navigate(SELLER_TELEGRAM_REQUESTS_ROUTE);
}

export default function SellerTelegramGlobalAlertBanner() {
  const navigate = useNavigate();
  const { queueModel } = useSellerTelegramRequests();

  const tone = useMemo(
    () => resolveUrgencyTone(queueModel.bannerUrgency),
    [queueModel.bannerUrgency]
  );

  if (!queueModel.hasRequests) {
    return null;
  }

  const requestWord = queueModel.activeCount === 1 ? 'request' : 'requests';

  return (
    <div className={`${sellerContentClass} pt-2 pb-0`}>
      <button
        type="button"
        data-testid="seller-telegram-global-alert"
        data-navigation-target={SELLER_TELEGRAM_REQUESTS_ROUTE}
        onClick={() => openSellerTelegramRequests(navigate)}
        className={clsx(
          'w-full rounded-2xl border px-3 py-2.5 text-left shadow-sm transition-colors',
          'hover:brightness-[1.02]',
          tone.shell
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">
              Telegram queue: {queueModel.activeCount} active {requestWord}
            </div>
            <div className="mt-0.5 text-xs opacity-90">
              Tap to open seller Telegram requests
            </div>
          </div>
          <span className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold', tone.pill)}>
            {tone.label}
          </span>
        </div>
      </button>
    </div>
  );
}
