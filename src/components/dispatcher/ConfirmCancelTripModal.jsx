import { AlertTriangle, ArrowRightLeft, CircleX } from 'lucide-react';
import { dpAlert, dpButton, dpIconWrap } from './dispatcherTheme';

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
      <div className="dp-overlay z-50 flex items-center justify-center p-4">
        <div className="dp-modal-card">
          <div className="flex items-start gap-4">
            <div className={dpIconWrap('warning')}>
              <ArrowRightLeft size={18} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="dp-modal-title">Предоплата: что сделать?</h3>
              <p className="dp-modal-copy">
                Предоплата: <span className="font-semibold text-neutral-100">{prepayAmount.toLocaleString('ru-RU')} ₽</span>
              </p>
              <p className="dp-modal-copy">
                Выберите действие: вернуть клиенту или отправить в сезонный фонд.
              </p>
            </div>
          </div>

          {error && (
            <div className={dpAlert('danger', 'mt-4')}>
              <AlertTriangle size={18} strokeWidth={2} className="mt-0.5 shrink-0" />
              <div>{error}</div>
            </div>
          )}

          <div className="mt-5 grid gap-3">
            <button
              className={dpButton({ variant: 'success', block: true })}
              onClick={onRefund}
              disabled={loading}
            >
              {loading ? 'Обработка…' : 'Вернуть предоплату'}
            </button>

            <button
              className={dpButton({ variant: 'warning', block: true })}
              onClick={onFund}
              disabled={loading}
            >
              {loading ? 'Обработка…' : 'В сезонный фонд'}
            </button>

            <button
              className={dpButton({ variant: 'ghost', block: true })}
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

  return (
    <div className="dp-overlay z-50 flex items-center justify-center p-4">
      <div className="dp-modal-card">
        <div className="flex items-start gap-4">
          <div className={dpIconWrap('danger')}>
            <CircleX size={18} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="dp-modal-title">Отменить рейс?</h3>
            <p className="dp-modal-copy">
              Рейс будет отменён, а новые продажи станут недоступны.
            </p>
            <p className="dp-modal-copy">
              Все купленные билеты перейдут в список для обработки.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button className={dpButton({ variant: 'ghost' })} onClick={onClose} disabled={loading}>
            Нет
          </button>

          <button
            className={dpButton({ variant: 'danger' })}
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
