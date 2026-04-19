import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient.js';
import {
  buildOwnerTelegramManualQueueModel,
  formatOwnerTelegramTimer,
} from './owner-manual-fallback-model.js';

const QUEUE_POLL_INTERVAL_MS = 15000;

const ACTION_BUTTONS = Object.freeze([
  { actionType: 'call_started', label: 'Call started', tone: 'secondary' },
  { actionType: 'not_reached', label: 'Not reached', tone: 'danger' },
  {
    actionType: 'manual_prepayment_confirmed',
    label: 'Prepayment confirmed',
    tone: 'success',
  },
]);

function normalizeSellersList(response) {
  const items = response?.data?.items;
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      id: Number(item?.id || 0),
      username: String(item?.username || '').trim(),
      isActive: Boolean(item?.is_active),
    }))
    .filter((item) => Number.isInteger(item.id) && item.id > 0 && item.username);
}

function formatAmount(value) {
  return `${Number(value || 0).toLocaleString('ru-RU')} RUB`;
}

function formatTrip(date, time) {
  if (date && time) {
    return `${date} ${time}`;
  }
  return date || time || 'Trip not selected';
}

function buildIdempotencyKey({ bookingRequestId, actionType }) {
  return [
    'owner-ui',
    bookingRequestId,
    actionType,
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 8),
  ].join(':');
}

function resolveErrorMessage(error, fallbackMessage) {
  const response = error?.response;
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    if (response.rejection_reason) {
      return String(response.rejection_reason);
    }
    if (response.error) {
      return String(response.error);
    }
    if (response.message) {
      return String(response.message);
    }
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    try {
      const parsed = JSON.parse(error.message);
      if (parsed?.rejection_reason) {
        return String(parsed.rejection_reason);
      }
    } catch {
      // no-op
    }
    return error.message;
  }

  return fallbackMessage;
}

function badgeClass(tone = 'neutral') {
  if (tone === 'danger') {
    return 'rounded-full border border-rose-500/40 bg-rose-900/20 px-2.5 py-1 text-[11px] font-medium text-rose-200';
  }
  if (tone === 'warning') {
    return 'rounded-full border border-amber-500/40 bg-amber-900/20 px-2.5 py-1 text-[11px] font-medium text-amber-200';
  }
  if (tone === 'success') {
    return 'rounded-full border border-emerald-500/40 bg-emerald-900/20 px-2.5 py-1 text-[11px] font-medium text-emerald-200';
  }
  return 'rounded-full border border-slate-500/40 bg-slate-900/30 px-2.5 py-1 text-[11px] font-medium text-slate-200';
}

function actionButtonClass(tone = 'secondary') {
  if (tone === 'danger') {
    return 'rounded-xl border border-rose-500/50 bg-rose-900/30 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-900/45 disabled:cursor-not-allowed disabled:opacity-50';
  }
  if (tone === 'success') {
    return 'rounded-xl border border-emerald-500/50 bg-emerald-900/30 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-900/45 disabled:cursor-not-allowed disabled:opacity-50';
  }
  return 'rounded-xl border border-slate-500/50 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-slate-900/60 disabled:cursor-not-allowed disabled:opacity-50';
}

function queueStateTone(queueState) {
  if (queueState === 'no_longer_actionable' || queueState === 'manual_not_reached') {
    return 'danger';
  }
  if (queueState === 'prepayment_confirmed_waiting_handoff') {
    return 'success';
  }
  if (queueState === 'hold_extended_waiting_manual') {
    return 'warning';
  }
  return 'neutral';
}

function handlingStateTone(handlingState) {
  if (handlingState === 'no_longer_actionable' || handlingState === 'manual_not_reached') {
    return 'danger';
  }
  if (handlingState === 'prepayment_confirmed' || handlingState === 'handed_off') {
    return 'success';
  }
  if (handlingState === 'manual_contact_in_progress') {
    return 'warning';
  }
  return 'neutral';
}

function timerTone(item) {
  if (item.isExpired) {
    return 'text-rose-300';
  }
  if (item.remainingMs !== null && item.remainingMs <= 5 * 60 * 1000) {
    return 'text-amber-300';
  }
  return 'text-emerald-300';
}

function RequestCard({
  item,
  sellers,
  selectedSellerId,
  onChangeSeller,
  onAction,
  busyActions,
  actionError,
}) {
  const hasAssignAction = item.availableActions.includes('assign_to_seller');

  return (
    <article
      className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
      data-testid={`owner-telegram-request-${item.bookingRequestId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-neutral-100">{item.guestName}</h3>
          <div className="text-xs text-neutral-400">{item.phone || 'Phone not provided'}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={badgeClass(queueStateTone(item.queueState))}>{item.queueStateLabel}</span>
          <span className={badgeClass(handlingStateTone(item.handlingState))}>
            {item.handlingStateLabel}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">Timer</div>
          <div className={`mt-1 font-semibold ${timerTone(item)}`}>
            {formatOwnerTelegramTimer(item.remainingMs)}
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">Prepayment</div>
          <div className="mt-1 font-semibold text-neutral-100">
            {formatAmount(item.requestedPrepaymentAmount)}
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">Seats</div>
          <div className="mt-1 font-semibold text-neutral-100">{item.requestedSeats}</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">Trip/date/time</div>
          <div className="mt-1 font-semibold text-neutral-100">
            {formatTrip(item.requestedTripDate, item.requestedTimeSlot)}
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">Source</div>
          <div className="mt-1 text-sm text-neutral-200">{item.sourceLabel}</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.1em] text-neutral-500">Fallback reason</div>
          <div className="mt-1 text-sm text-neutral-200">{item.fallbackReason}</div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-xs text-neutral-300">
        Route target: <span className="font-medium text-neutral-100">{item.routeTargetLabel}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {ACTION_BUTTONS.map((actionButton) => {
          const actionKey = `${item.bookingRequestId}:${actionButton.actionType}`;
          const isBusy = Boolean(busyActions[actionKey]);
          const isAllowed = item.availableActions.includes(actionButton.actionType);

          return (
            <button
              key={actionButton.actionType}
              type="button"
              className={actionButtonClass(actionButton.tone)}
              disabled={!isAllowed || isBusy}
              onClick={() => onAction(item.bookingRequestId, actionButton.actionType)}
            >
              {isBusy ? 'Processing...' : actionButton.label}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={selectedSellerId || ''}
          onChange={(event) => onChangeSeller(item.bookingRequestId, event.target.value)}
          disabled={!hasAssignAction || sellers.length === 0}
          className="min-w-[180px] rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`owner-telegram-assign-seller-${item.bookingRequestId}`}
        >
          <option value="">Select seller</option>
          {sellers.map((seller) => (
            <option key={seller.id} value={seller.id}>
              {seller.username} {seller.isActive ? '' : '(inactive)'}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={actionButtonClass('secondary')}
          disabled={!hasAssignAction || !selectedSellerId || sellers.length === 0}
          onClick={() =>
            onAction(item.bookingRequestId, 'assign_to_seller', {
              seller_id: Number(selectedSellerId),
            })
          }
          data-testid={`owner-telegram-assign-action-${item.bookingRequestId}`}
        >
          Assign to seller
        </button>
      </div>

      {actionError ? (
        <div className="mt-2 rounded-xl border border-rose-600/40 bg-rose-900/20 px-3 py-2 text-xs text-rose-200">
          {actionError}
        </div>
      ) : null}
    </article>
  );
}

export default function OwnerTelegramManualFallbackView() {
  const navigate = useNavigate();
  const [queueResponse, setQueueResponse] = useState({ items: [] });
  const [requestStatesResponse, setRequestStatesResponse] = useState({ items: [] });
  const [sellers, setSellers] = useState([]);
  const [assignSellerByRequest, setAssignSellerByRequest] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyActions, setBusyActions] = useState({});
  const [actionErrors, setActionErrors] = useState({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  const model = useMemo(
    () =>
      buildOwnerTelegramManualQueueModel(queueResponse, requestStatesResponse, {
        nowMs,
      }),
    [queueResponse, requestStatesResponse, nowMs]
  );

  const refreshData = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [queueResult, stateResult, sellersResult] = await Promise.all([
        apiClient.getOwnerTelegramManualFallbackQueue({ limit: 150 }),
        apiClient.getOwnerTelegramManualFallbackRequestStatesActive({ limit: 150 }),
        apiClient.getOwnerSellersList(),
      ]);
      setQueueResponse(queueResult);
      setRequestStatesResponse(stateResult);
      setSellers(normalizeSellersList(sellersResult));
      setError('');
      return { ok: true };
    } catch (requestError) {
      const message = resolveErrorMessage(
        requestError,
        'Failed to load Telegram manual fallback queue'
      );
      setError(message);
      return { ok: false, error: message };
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refreshData();

    const intervalId = setInterval(() => {
      refreshData({ silent: true });
    }, QUEUE_POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [refreshData]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!sellers.length || !model.items.length) {
      return;
    }

    setAssignSellerByRequest((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const item of model.items) {
        if (!item.availableActions.includes('assign_to_seller')) {
          continue;
        }
        if (!next[item.bookingRequestId]) {
          next[item.bookingRequestId] = String(sellers[0].id);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [sellers, model.items]);

  const handleChangeSeller = useCallback((bookingRequestId, sellerId) => {
    setAssignSellerByRequest((previous) => ({
      ...previous,
      [bookingRequestId]: sellerId,
    }));
  }, []);

  const runAction = useCallback(
    async (bookingRequestId, actionType, actionPayload = {}) => {
      const actionKey = `${bookingRequestId}:${actionType}`;
      setActionErrors((previous) => ({ ...previous, [bookingRequestId]: '' }));
      setBusyActions((previous) => ({ ...previous, [actionKey]: true }));

      try {
        await apiClient.recordOwnerTelegramManualFallbackAction({
          bookingRequestId,
          actionType,
          idempotencyKey: buildIdempotencyKey({ bookingRequestId, actionType }),
          actionPayload,
        });
        await refreshData({ silent: true });
      } catch (actionError) {
        await refreshData({ silent: true });
        setActionErrors((previous) => ({
          ...previous,
          [bookingRequestId]: resolveErrorMessage(
            actionError,
            'Action failed. Request may already be unavailable or expired.'
          ),
        }));
      } finally {
        setBusyActions((previous) => ({ ...previous, [actionKey]: false }));
      }
    },
    [refreshData]
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100" data-testid="owner-telegram-manual-fallback-screen">
      <header className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-neutral-100">Telegram manual fallback queue</h1>
            <p className="mt-1 text-xs text-neutral-400">
              Owner/operator screen for manual Telegram fallback requests.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/owner-ui')}
              className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100 hover:bg-neutral-800"
            >
              Back to owner
            </button>
            <button
              type="button"
              onClick={() => refreshData({ silent: false })}
              className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-100 hover:bg-neutral-800"
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-3 px-4 py-4 pb-24">
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-200">
          <div className="flex flex-wrap items-center gap-3">
            <span>Total: {model.itemCount}</span>
            <span>Actionable: {model.actionableCount}</span>
            <span>Expired timer: {model.expiredCount}</span>
          </div>
        </section>

        {error ? (
          <section className="rounded-2xl border border-rose-600/40 bg-rose-900/20 px-4 py-3 text-sm text-rose-200">
            {error}
          </section>
        ) : null}

        {loading ? (
          <section className="space-y-2">
            <div className="h-24 animate-pulse rounded-2xl bg-neutral-900" />
            <div className="h-24 animate-pulse rounded-2xl bg-neutral-900" />
            <div className="h-24 animate-pulse rounded-2xl bg-neutral-900" />
          </section>
        ) : model.items.length > 0 ? (
          <section className="space-y-3" data-testid="owner-telegram-manual-fallback-list">
            {model.items.map((item) => (
              <RequestCard
                key={item.bookingRequestId}
                item={item}
                sellers={sellers}
                selectedSellerId={assignSellerByRequest[item.bookingRequestId] || ''}
                onChangeSeller={handleChangeSeller}
                onAction={runAction}
                busyActions={busyActions}
                actionError={actionErrors[item.bookingRequestId] || ''}
              />
            ))}
          </section>
        ) : (
          <section className="rounded-2xl border border-dashed border-neutral-700 bg-neutral-900/30 px-4 py-4 text-sm text-neutral-400">
            No Telegram manual fallback requests right now.
          </section>
        )}
      </main>
    </div>
  );
}
