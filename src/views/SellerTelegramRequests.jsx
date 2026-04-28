import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  SellerScreen,
  SellerSurface,
  SellerTopbar,
  sellerButtonClass,
  sellerContentClass,
  sellerHelperTextClass,
  sellerInputClass,
} from '../components/seller/sellerUi';
import SellerTelegramGlobalAlertBanner from '../components/seller/telegram/SellerTelegramGlobalAlertBanner';
import { useSellerTelegramRequests } from '../components/seller/telegram/SellerTelegramRequestsContext';
import {
  buildSellerTelegramQueueModel,
  formatSellerTelegramAmount,
  formatSellerTelegramTimer,
} from '../components/seller/telegram/sellerTelegramQueueModel';

function hasAction(item, actionType) {
  return Array.isArray(item?.availableActions) && item.availableActions.includes(actionType);
}

function formatTripSummary(item) {
  const date = item?.requestedTripDate || '';
  const time = item?.requestedTimeSlot || 'Время не указано';
  return [date, time].filter(Boolean).join(' ');
}

function normalizeAcceptedPrepaymentAmount(rawValue) {
  const normalized = Number(String(rawValue ?? '').trim());
  if (!Number.isInteger(normalized) || normalized < 0) {
    return null;
  }
  return normalized;
}

function formatSellerHoldDeadlineLabel(holdExpiresAtIso) {
  const parsed = Date.parse(String(holdExpiresAtIso || '').trim());
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(parsed));
}

function mapSellerActionError(actionType, rawError) {
  const fallbackMessage =
    '\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e. \u041e\u0447\u0435\u0440\u0435\u0434\u044c \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0430.';
  const message = String(rawError || '').trim();
  const normalized = message.toLowerCase();

  if (actionType !== 'hold_extend') {
    return message || fallbackMessage;
  }

  if (
    normalized.includes('hold extension already used') ||
    normalized.includes('hold already extended') ||
    normalized.includes('already extended')
  ) {
    return '\u041f\u0440\u043e\u0434\u043b\u0435\u043d\u0438\u0435 \u0443\u0436\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u043e \u0434\u043b\u044f \u044d\u0442\u043e\u0439 \u0437\u0430\u044f\u0432\u043a\u0438.';
  }
  if (
    normalized.includes('cannot extend expired hold') ||
    normalized.includes('active hold is expired') ||
    normalized.includes('already expired')
  ) {
    return '\u041d\u0435\u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e \u043f\u0440\u043e\u0434\u043b\u0438\u0442\u044c: \u0441\u0440\u043e\u043a \u0431\u0440\u043e\u043d\u0438 \u0443\u0436\u0435 \u0438\u0441\u0442\u0435\u043a.';
  }
  if (
    normalized.includes('after prepayment is final') ||
    normalized.includes('prepayment is final') ||
    normalized.includes('prepayment confirmed')
  ) {
    return '\u041d\u0435\u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e \u043f\u0440\u043e\u0434\u043b\u0438\u0442\u044c: \u043f\u0440\u0435\u0434\u043e\u043f\u043b\u0430\u0442\u0430 \u0443\u0436\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430.';
  }
  if (
    normalized.includes('closed booking request') ||
    normalized.includes('guest_cancelled') ||
    normalized.includes('hold_expired')
  ) {
    return '\u041d\u0435\u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e \u043f\u0440\u043e\u0434\u043b\u0438\u0442\u044c: \u0437\u0430\u044f\u0432\u043a\u0430 \u043e\u0442\u043c\u0435\u043d\u0435\u043d\u0430 \u0438\u043b\u0438 \u0437\u0430\u043a\u0440\u044b\u0442\u0430.';
  }
  if (
    normalized.includes('no active seller path') ||
    normalized.includes('no longer actionable') ||
    normalized.includes('not assigned to seller')
  ) {
    return '\u041d\u0435\u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e \u043f\u0440\u043e\u0434\u043b\u0438\u0442\u044c: \u0437\u0430\u044f\u0432\u043a\u0430 \u0431\u043e\u043b\u044c\u0448\u0435 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u043f\u0440\u043e\u0434\u0430\u0432\u0446\u0443.';
  }

  return (
    message ||
    '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0434\u043b\u0438\u0442\u044c \u0431\u0440\u043e\u043d\u044c. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u043e\u0447\u0435\u0440\u0435\u0434\u044c \u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.'
  );
}
export async function copyTextToClipboard(value) {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }

  if (globalThis?.navigator?.clipboard?.writeText) {
    try {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback below
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return Boolean(copied);
  } catch {
    return false;
  }
}

function RequestListCard({
  item,
  busyActions,
  copyFeedback,
  actionError,
  onOpen,
  onCopy,
  onExtend,
}) {
  const extendBusy = Boolean(busyActions[`${item.bookingRequestId}:hold_extend`]);
  const extendAllowed = hasAction(item, 'hold_extend');
  const feedbackText = copyFeedback || actionError || '';
  const feedbackTone = actionError ? 'text-rose-700' : 'text-emerald-700';

  return (
    <article
      className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
      data-testid={`seller-telegram-request-${item.bookingRequestId}`}
    >
      <div className="truncate text-sm font-semibold text-slate-900">
        {formatSellerTelegramTimer(item.remainingMs)} - {formatTripSummary(item)}
      </div>
      <div className="mt-0.5 truncate text-sm text-slate-700">
        {item.guestName || 'Гость'} - {item.phone || 'Телефон не указан'}
      </div>
      <div className="mt-0.5 truncate text-xs text-slate-600">
        {Number(item.requestedSeats || 0)} мест - предоплата {formatSellerTelegramAmount(item.requestedPrepaymentAmount)}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => onOpen(item.bookingRequestId)}
          className={sellerButtonClass({
            variant: 'secondary',
            size: 'sm',
            className: 'rounded-xl px-2 py-1.5 text-xs',
          })}
        >
          Открыть
        </button>
        <button
          type="button"
          onClick={() => onCopy(item)}
          className={sellerButtonClass({
            variant: 'secondary',
            size: 'sm',
            className: 'rounded-xl px-2 py-1.5 text-xs',
          })}
          data-testid={`seller-telegram-copy-phone-${item.bookingRequestId}`}
        >
          Скопировать номер
        </button>
        <button
          type="button"
          onClick={() => onExtend(item)}
          disabled={!extendAllowed || extendBusy}
          className={sellerButtonClass({
            variant: 'secondary',
            size: 'sm',
            disabled: !extendAllowed || extendBusy,
            className: 'rounded-xl px-2 py-1.5 text-xs',
          })}
          data-testid={`seller-telegram-request-extend-${item.bookingRequestId}`}
        >
          {extendBusy ? 'Продление...' : 'Продлить на 10 минут'}
        </button>
      </div>

      {feedbackText ? (
        <div className={`mt-1.5 text-xs ${feedbackTone}`}>{feedbackText}</div>
      ) : null}
    </article>
  );
}

function CancelConfirmModal({ open, onBack, onConfirm, busy }) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">Отменить заявку?</h3>
        <p className="mt-1 text-sm text-slate-600">Это действие нельзя автоматически откатить.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onBack}
            data-testid="seller-telegram-cancel-confirm-back"
            className={sellerButtonClass({ variant: 'secondary', size: 'sm' })}
          >
            Вернуться
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="seller-telegram-cancel-confirm-submit"
            disabled={busy}
            className={sellerButtonClass({
              variant: 'destructive',
              size: 'sm',
              disabled: busy,
            })}
          >
            {busy ? 'Отмена...' : 'Да, отменить'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SellerTelegramRequests() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { logout } = useAuth();
  const {
    queueSummary,
    acknowledgedRequestIds,
    loading,
    refreshing,
    error,
    busyActions,
    refreshQueue,
    runAction,
    markRequestOpened,
  } = useSellerTelegramRequests();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [acceptedAmounts, setAcceptedAmounts] = useState({});
  const [copyFeedbackById, setCopyFeedbackById] = useState({});
  const [actionErrors, setActionErrors] = useState({});
  const [globalFeedback, setGlobalFeedback] = useState('');
  const [cancelTargetId, setCancelTargetId] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(intervalId);
  }, []);

  const queueModel = useMemo(
    () =>
      buildSellerTelegramQueueModel(queueSummary, {
        nowMs,
        acknowledgedRequestIds,
      }),
    [queueSummary, nowMs, acknowledgedRequestIds]
  );

  useEffect(() => {
    setAcceptedAmounts((prev) => {
      const next = { ...prev };
      let changed = false;
      const activeIds = new Set();
      for (const item of queueModel.items) {
        activeIds.add(item.bookingRequestId);
        if (next[item.bookingRequestId] === undefined) {
          next[item.bookingRequestId] = String(Number(item.requestedPrepaymentAmount || 0));
          changed = true;
        }
      }
      for (const key of Object.keys(next)) {
        const requestId = Number(key);
        if (!activeIds.has(requestId)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [queueModel.items]);

  const requestIdParam = searchParams.get('requestId');
  useEffect(() => {
    const fromQuery = Number(requestIdParam);
    const queryMatches = Number.isInteger(fromQuery)
      && fromQuery > 0
      && queueModel.items.some((item) => item.bookingRequestId === fromQuery);

    if (queryMatches) {
      if (selectedRequestId !== fromQuery) {
        setSelectedRequestId(fromQuery);
      }
      markRequestOpened(fromQuery);
      return;
    }

    if (
      selectedRequestId
      && queueModel.items.some((item) => item.bookingRequestId === selectedRequestId)
    ) {
      return;
    }

    const fallbackId = queueModel.items[0]?.bookingRequestId || null;
    setSelectedRequestId(fallbackId);
    if (fallbackId) {
      markRequestOpened(fallbackId);
      setSearchParams({ requestId: String(fallbackId) }, { replace: true });
    }
  }, [
    markRequestOpened,
    queueModel.items,
    requestIdParam,
    selectedRequestId,
    setSearchParams,
  ]);

  const selectedItem = useMemo(
    () =>
      queueModel.items.find(
        (item) => Number(item.bookingRequestId) === Number(selectedRequestId || 0)
      ) || null,
    [queueModel.items, selectedRequestId]
  );

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const handleOpen = useCallback(
    (bookingRequestId) => {
      const normalizedId = Number(bookingRequestId);
      if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
        return;
      }
      setSelectedRequestId(normalizedId);
      markRequestOpened(normalizedId);
      setSearchParams({ requestId: String(normalizedId) }, { replace: true });
    },
    [markRequestOpened, setSearchParams]
  );

  const handleAction = useCallback(
    async ({ bookingRequestId, actionType, actionPayload = {} }) => {
      setActionErrors((prev) => ({ ...prev, [bookingRequestId]: '' }));
      const result = await runAction({ bookingRequestId, actionType, actionPayload });
      if (!result.ok) {
        const mappedError = mapSellerActionError(actionType, result.error);
        setActionErrors((prev) => ({
          ...prev,
          [bookingRequestId]: mappedError,
        }));
        return { ok: false, error: mappedError };
      }
      setActionErrors((prev) => ({ ...prev, [bookingRequestId]: '' }));
      return { ok: true, result: result.result || null };
    },
    [runAction]
  );

  const handleCopyPhone = useCallback(async (item) => {
    const requestId = Number(item?.bookingRequestId || 0);
    const copied = await copyTextToClipboard(item?.phone || '');
    setCopyFeedbackById((prev) => ({
      ...prev,
      [requestId]: copied ? 'Номер скопирован' : 'Не удалось скопировать номер',
    }));
    globalThis.setTimeout(() => {
      setCopyFeedbackById((prev) => {
        if (!prev[requestId]) {
          return prev;
        }
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    }, 1800);
  }, []);

  const handleExtend = useCallback(
    async (item) => {
      if (!hasAction(item, 'hold_extend')) {
        return;
      }
      const result = await handleAction({
        bookingRequestId: item.bookingRequestId,
        actionType: 'hold_extend',
      });
      if (result.ok) {
        const holdExpiresAtIso = result?.result?.queue_item?.booking_hold?.hold_expires_at;
        const deadlineLabel = formatSellerHoldDeadlineLabel(holdExpiresAtIso);
        if (deadlineLabel) {
          setGlobalFeedback(`Бронь продлена до ${deadlineLabel}.`);
        } else {
          setGlobalFeedback('Бронь продлена на 10 минут.');
        }
      }
    },
    [handleAction]
  );

  const handleAcceptPrepayment = useCallback(async () => {
    if (!selectedItem) {
      return;
    }
    if (!hasAction(selectedItem, 'prepayment_confirmed')) {
      setActionErrors((prev) => ({
        ...prev,
        [selectedItem.bookingRequestId]: 'Подтверждение предоплаты сейчас недоступно.',
      }));
      return;
    }

    const inputValue =
      acceptedAmounts[selectedItem.bookingRequestId] ??
      String(Number(selectedItem.requestedPrepaymentAmount || 0));
    const acceptedAmount = normalizeAcceptedPrepaymentAmount(inputValue);
    if (acceptedAmount === null) {
      setActionErrors((prev) => ({
        ...prev,
        [selectedItem.bookingRequestId]: 'Принятая предоплата должна быть целым числом от 0.',
      }));
      return;
    }

    const result = await handleAction({
      bookingRequestId: selectedItem.bookingRequestId,
      actionType: 'prepayment_confirmed',
      actionPayload: {
        accepted_prepayment_amount: acceptedAmount,
      },
    });
    if (result.ok) {
      setGlobalFeedback('Предоплата подтверждена.');
    }
  }, [acceptedAmounts, handleAction, selectedItem]);

  const handleNotReached = useCallback(async () => {
    if (!selectedItem) {
      return;
    }
    if (!hasAction(selectedItem, 'not_reached')) {
      return;
    }
    const result = await handleAction({
      bookingRequestId: selectedItem.bookingRequestId,
      actionType: 'not_reached',
    });
    if (result.ok) {
      setGlobalFeedback('Отметка "Не дозвонился" сохранена.');
    }
  }, [handleAction, selectedItem]);

  const handleConfirmCancel = useCallback(async () => {
    if (!cancelTargetId) {
      return;
    }
    setCancelBusy(true);
    try {
      const result = await handleAction({
        bookingRequestId: cancelTargetId,
        actionType: 'cancel_request',
      });
      if (result.ok) {
        setCancelTargetId(null);
        setGlobalFeedback('Заявка отменена.');
      }
    } finally {
      setCancelBusy(false);
    }
  }, [cancelTargetId, handleAction]);

  return (
    <SellerScreen data-testid="seller-telegram-requests-screen">
      <SellerTopbar
        title="Активные заявки"
        subtitle="Telegram buyer flow"
        onBack={() => navigate('/seller/home')}
        onLogout={handleLogout}
      />

      <SellerTelegramGlobalAlertBanner />

      <div className={`${sellerContentClass} space-y-3`}>
        <SellerSurface>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Активные заявки</h2>
              <p className={`mt-1 ${sellerHelperTextClass}`}>
                Компактный список для быстрого открытия рабочей карточки.
              </p>
            </div>
            <button
              type="button"
              onClick={() => refreshQueue({ silent: false })}
              className={sellerButtonClass({ variant: 'ghost', size: 'sm', block: false })}
            >
              {refreshing ? 'Обновление...' : 'Обновить'}
            </button>
          </div>
        </SellerSurface>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {globalFeedback ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {globalFeedback}
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
              <RequestListCard
                key={item.bookingRequestId}
                item={{
                  ...item,
                  timerLabel: formatSellerTelegramTimer(item.remainingMs),
                }}
                busyActions={busyActions}
                copyFeedback={copyFeedbackById[item.bookingRequestId] || ''}
                actionError={actionErrors[item.bookingRequestId] || ''}
                onOpen={handleOpen}
                onCopy={handleCopyPhone}
                onExtend={handleExtend}
              />
            ))}
          </div>
        ) : (
          <SellerSurface>
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
              Активных Telegram заявок сейчас нет.
            </div>
          </SellerSurface>
        )}

        {selectedItem ? (
          <SellerSurface data-testid="seller-telegram-request-detail">
            <h3 className="text-base font-semibold text-slate-900">Рабочая карточка заявки</h3>

            <div className="mt-3 grid gap-2 text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-slate-500">Имя</span>
                <span className="font-medium text-slate-900">{selectedItem.guestName || 'Гость'}</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-slate-500">Телефон</span>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-slate-900">
                    {selectedItem.phone || 'Не указан'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyPhone(selectedItem)}
                    className={sellerButtonClass({
                      variant: 'secondary',
                      size: 'sm',
                      block: false,
                      className: 'rounded-xl px-2 py-1 text-xs',
                    })}
                  >
                    Скопировать номер
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-slate-500">Рейс</span>
                <span className="font-medium text-slate-900">{formatTripSummary(selectedItem)}</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-slate-500">Дата</span>
                <span className="font-medium text-slate-900">{selectedItem.requestedTripDate || 'Не указана'}</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-slate-500">Время</span>
                <span className="font-medium text-slate-900">{selectedItem.requestedTimeSlot || 'Не указано'}</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-slate-500">Места</span>
                <span className="font-medium text-slate-900">{Number(selectedItem.requestedSeats || 0)}</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-slate-500">Таймер hold</span>
                <span className="font-medium text-slate-900">
                  {formatSellerTelegramTimer(selectedItem.remainingMs)}
                </span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-slate-500">Запрошено</span>
                <span className="font-medium text-slate-900">
                  {formatSellerTelegramAmount(selectedItem.requestedPrepaymentAmount)}
                </span>
              </div>
            </div>

            <div className="mt-3">
              <label
                className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"
                htmlFor="seller-accepted-prepayment-input"
              >
                Принятая предоплата
              </label>
              <input
                id="seller-accepted-prepayment-input"
                data-testid="seller-telegram-accepted-prepayment-input"
                type="number"
                min="0"
                step="1"
                value={
                  acceptedAmounts[selectedItem.bookingRequestId]
                  ?? String(Number(selectedItem.requestedPrepaymentAmount || 0))
                }
                onChange={(event) =>
                  setAcceptedAmounts((prev) => ({
                    ...prev,
                    [selectedItem.bookingRequestId]: event.target.value,
                  }))
                }
                className={sellerInputClass('py-2.5')}
                placeholder="Сумма в ₽"
              />
            </div>

            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={handleAcceptPrepayment}
                data-testid="seller-telegram-detail-accept-prepayment"
                disabled={
                  !hasAction(selectedItem, 'prepayment_confirmed')
                  || Boolean(busyActions[`${selectedItem.bookingRequestId}:prepayment_confirmed`])
                }
                className={sellerButtonClass({
                  variant: 'primary',
                  size: 'sm',
                  disabled:
                    !hasAction(selectedItem, 'prepayment_confirmed')
                    || Boolean(busyActions[`${selectedItem.bookingRequestId}:prepayment_confirmed`]),
                })}
              >
                {busyActions[`${selectedItem.bookingRequestId}:prepayment_confirmed`]
                  ? 'Подтверждение...'
                  : 'Принять предоплату'}
              </button>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => handleExtend(selectedItem)}
                  data-testid="seller-telegram-detail-extend"
                  disabled={
                    !hasAction(selectedItem, 'hold_extend')
                    || Boolean(busyActions[`${selectedItem.bookingRequestId}:hold_extend`])
                  }
                  className={sellerButtonClass({
                    variant: 'secondary',
                    size: 'sm',
                    disabled:
                      !hasAction(selectedItem, 'hold_extend')
                      || Boolean(busyActions[`${selectedItem.bookingRequestId}:hold_extend`]),
                  })}
                >
                  {busyActions[`${selectedItem.bookingRequestId}:hold_extend`]
                    ? 'Продление...'
                    : 'Продлить на 10 минут'}
                </button>
                <button
                  type="button"
                  onClick={handleNotReached}
                  data-testid="seller-telegram-detail-not-reached"
                  disabled={
                    !hasAction(selectedItem, 'not_reached')
                    || Boolean(busyActions[`${selectedItem.bookingRequestId}:not_reached`])
                  }
                  className={sellerButtonClass({
                    variant: 'secondary',
                    size: 'sm',
                    disabled:
                      !hasAction(selectedItem, 'not_reached')
                      || Boolean(busyActions[`${selectedItem.bookingRequestId}:not_reached`]),
                  })}
                >
                  {busyActions[`${selectedItem.bookingRequestId}:not_reached`]
                    ? 'Сохранение...'
                    : 'Не дозвонился'}
                </button>
                <button
                  type="button"
                  onClick={() => setCancelTargetId(selectedItem.bookingRequestId)}
                  data-testid="seller-telegram-detail-cancel-request"
                  disabled={!hasAction(selectedItem, 'cancel_request')}
                  className={sellerButtonClass({
                    variant: 'destructive',
                    size: 'sm',
                    disabled: !hasAction(selectedItem, 'cancel_request'),
                  })}
                >
                  Отменить заявку
                </button>
              </div>
            </div>

            {actionErrors[selectedItem.bookingRequestId] ? (
              <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {actionErrors[selectedItem.bookingRequestId]}
              </div>
            ) : null}
          </SellerSurface>
        ) : null}
      </div>

      <CancelConfirmModal
        open={Boolean(cancelTargetId)}
        busy={cancelBusy}
        onBack={() => setCancelTargetId(null)}
        onConfirm={handleConfirmCancel}
      />
    </SellerScreen>
  );
}

