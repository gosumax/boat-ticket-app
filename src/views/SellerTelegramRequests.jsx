import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  SellerScreen,
  SellerSurface,
  SellerTopbar,
  sellerButtonClass,
  sellerChipClass,
  sellerContentClass,
  sellerHelperTextClass,
} from '../components/seller/sellerUi';
import SellerTelegramGlobalAlertBanner from '../components/seller/telegram/SellerTelegramGlobalAlertBanner';
import { useSellerTelegramRequests } from '../components/seller/telegram/SellerTelegramRequestsContext';
import {
  buildSellerTelegramQueueModel,
  formatSellerTelegramTimer,
} from '../components/seller/telegram/sellerTelegramQueueModel';

const ACTION_LABELS = Object.freeze({
  call_started: 'Call started',
  not_reached: 'Not reached',
  prepayment_confirmed: 'Prepayment confirmed',
  hold_extend: 'Extend hold',
});

function formatAmount(value) {
  return `${Number(value || 0).toLocaleString('ru-RU')} RUB`;
}

function formatTrip(date, time) {
  if (!date && !time) return 'Trip not selected';
  if (date && time) return `${date} ${time}`;
  return date || time;
}

function resolveUrgencyChip(urgency) {
  if (urgency === 'near_expiry') {
    return sellerChipClass({ tone: 'warning', className: 'text-xs px-2.5 py-1' });
  }
  if (urgency === 'urgent') {
    return sellerChipClass({ tone: 'accent', className: 'text-xs px-2.5 py-1' });
  }
  return sellerChipClass({ tone: 'success', className: 'text-xs px-2.5 py-1' });
}

function RequestCard({
  item,
  busyActions,
  onAction,
  actionError,
}) {
  return (
    <article
      className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm"
      data-testid={`seller-telegram-request-${item.bookingRequestId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">{item.guestName}</div>
          <div className="mt-0.5 text-xs text-slate-500">{item.phone || 'Phone not provided'}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={resolveUrgencyChip(item.urgency)}>{item.urgency.replace('_', ' ')}</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {item.requestStatusLabel}
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Timer</div>
          <div className="mt-1 font-semibold text-slate-900">{item.timerLabel}</div>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Prepayment</div>
          <div className="mt-1 font-semibold text-slate-900">{formatAmount(item.requestedPrepaymentAmount)}</div>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Seats</div>
          <div className="mt-1 font-semibold text-slate-900">{item.requestedSeats || 0}</div>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Trip</div>
          <div className="mt-1 font-semibold text-slate-900">{formatTrip(item.requestedTripDate, item.requestedTimeSlot)}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {Object.entries(ACTION_LABELS).map(([actionType, label]) => {
          const actionKey = `${item.bookingRequestId}:${actionType}`;
          const allowed = item.availableActions.includes(actionType);
          const busy = Boolean(busyActions[actionKey]);

          return (
            <button
              key={actionType}
              type="button"
              disabled={!allowed || busy}
              onClick={() => onAction(item.bookingRequestId, actionType)}
              className={sellerButtonClass({
                variant: actionType === 'not_reached' ? 'destructive' : 'secondary',
                size: 'sm',
                className: 'rounded-xl px-2 py-2 text-xs',
              })}
            >
              {busy ? 'Processing...' : label}
            </button>
          );
        })}
      </div>

      {actionError ? (
        <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {actionError}
        </div>
      ) : null}
    </article>
  );
}

export default function SellerTelegramRequests() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { queueSummary, loading, refreshing, error, busyActions, refreshQueue, runAction } =
    useSellerTelegramRequests();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [actionErrors, setActionErrors] = useState({});

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(intervalId);
  }, []);

  const queueModel = useMemo(
    () => buildSellerTelegramQueueModel(queueSummary, { nowMs }),
    [queueSummary, nowMs]
  );

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const handleAction = async (bookingRequestId, actionType) => {
    setActionErrors((prev) => ({ ...prev, [bookingRequestId]: '' }));
    const result = await runAction({ bookingRequestId, actionType });
    if (!result.ok) {
      setActionErrors((prev) => ({
        ...prev,
        [bookingRequestId]:
          result.error || 'Request is unavailable. Queue has been refreshed.',
      }));
      return;
    }
    setActionErrors((prev) => ({ ...prev, [bookingRequestId]: '' }));
  };

  return (
    <SellerScreen data-testid="seller-telegram-requests-screen">
      <SellerTopbar
        title="Telegram requests"
        subtitle="Seller queue"
        onBack={() => navigate('/seller/home')}
        onLogout={handleLogout}
      />

      <SellerTelegramGlobalAlertBanner />

      <div className={`${sellerContentClass} space-y-3`}>
        <SellerSurface>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Active requests</h2>
              <p className={`mt-1 ${sellerHelperTextClass}`}>
                Manage Telegram requests without leaving seller flow.
              </p>
            </div>
            <button
              type="button"
              onClick={() => refreshQueue({ silent: false })}
              className={sellerButtonClass({ variant: 'ghost', size: 'sm', block: false })}
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </SellerSurface>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <SellerSurface>
            <div className="space-y-2">
              <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
            </div>
          </SellerSurface>
        ) : queueModel.items.length > 0 ? (
          <div className="space-y-2.5" data-testid="seller-telegram-requests-list">
            {queueModel.items.map((item) => (
              <RequestCard
                key={item.bookingRequestId}
                item={{
                  ...item,
                  timerLabel: formatSellerTelegramTimer(item.remainingMs),
                }}
                busyActions={busyActions}
                onAction={handleAction}
                actionError={actionErrors[item.bookingRequestId] || ''}
              />
            ))}
          </div>
        ) : (
          <SellerSurface>
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              No active Telegram requests right now.
            </div>
          </SellerSurface>
        )}
      </div>
    </SellerScreen>
  );
}
