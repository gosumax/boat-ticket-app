import { AlertTriangle, ArrowRightLeft, ShieldCheck } from 'lucide-react';
import { dpAlert, dpButton, dpIconWrap } from './dispatcherTheme';

const ConfirmBoardingModal = ({
  open,
  onConfirm,
  onClose,
  loading = false,
  error = null,
  mode = 'boarding',
  prepayAmount = 0,
}) => {
  if (!open) return null;

  const isPrepayDecision = mode === 'prepay_decision';
  const title = isPrepayDecision ? 'Предоплата: что сделать?' : 'Подтвердить посадку?';
  const description = isPrepayDecision
    ? `В заказе есть предоплата ${Number(prepayAmount || 0).toLocaleString('ru-RU')} ₽. Куда её отправить?`
    : 'После подтверждения посадки возврат по этому билету будет недоступен.';

  return (
    <div
      className="dp-overlay z-50 flex items-center justify-center p-4"
      data-testid={isPrepayDecision ? 'dispatcher-prepay-decision-modal' : 'dispatcher-confirm-modal'}
    >
      <div className="dp-modal-card">
        <div className="flex items-start gap-4">
          <div className={dpIconWrap(isPrepayDecision ? 'warning' : 'success')}>
            {isPrepayDecision ? <ArrowRightLeft size={18} strokeWidth={2} /> : <ShieldCheck size={18} strokeWidth={2} />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="dp-modal-title">{title}</h3>
            <p className="dp-modal-copy">{description}</p>
          </div>
        </div>

        {error && (
          <div className={dpAlert('danger', 'mt-4')}>
            <AlertTriangle size={18} strokeWidth={2} className="mt-0.5 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            className={dpButton({ variant: 'ghost' })}
            onClick={onClose}
            disabled={loading}
            data-testid="dispatcher-confirm-cancel"
          >
            Отмена
          </button>

          {isPrepayDecision ? (
            <>
              <button
                className={dpButton({ variant: 'primary' })}
                onClick={() => onConfirm?.('REFUND')}
                disabled={loading}
                data-testid="dispatcher-prepay-decision-refund"
              >
                {loading ? '...' : 'Вернуть клиенту'}
              </button>

              <button
                className={dpButton({ variant: 'warning' })}
                onClick={() => onConfirm?.('FUND')}
                disabled={loading}
                data-testid="dispatcher-prepay-decision-fund"
              >
                {loading ? '...' : 'В сезонный фонд'}
              </button>
            </>
          ) : (
            <button
              className={dpButton({ variant: 'success' })}
              onClick={() => onConfirm?.()}
              disabled={loading}
              data-testid="dispatcher-confirm-submit"
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
