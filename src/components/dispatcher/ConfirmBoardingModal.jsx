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
  titleOverride = null,
  descriptionOverride = null,
  confirmLabelOverride = null,
}) => {
  if (!open) return null;

  const isPrepayDecision = mode === 'prepay_decision';
  const baseTitle = isPrepayDecision
    ? '\u041f\u0440\u0435\u0434\u043e\u043f\u043b\u0430\u0442\u0430: \u0447\u0442\u043e \u0441\u0434\u0435\u043b\u0430\u0442\u044c?'
    : '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u043f\u043e\u0441\u0430\u0434\u043a\u0443?';
  const baseDescription = isPrepayDecision
    ? `\u0412 \u0437\u0430\u043a\u0430\u0437\u0435 \u0435\u0441\u0442\u044c \u043f\u0440\u0435\u0434\u043e\u043f\u043b\u0430\u0442\u0430 ${Number(prepayAmount || 0).toLocaleString('ru-RU')} \u20bd. \u041a\u0443\u0434\u0430 \u0435\u0451 \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c?`
    : '\u041f\u043e\u0441\u043b\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u043f\u043e\u0441\u0430\u0434\u043a\u0438 \u0432\u043e\u0437\u0432\u0440\u0430\u0442 \u043f\u043e \u044d\u0442\u043e\u043c\u0443 \u0431\u0438\u043b\u0435\u0442\u0443 \u0431\u0443\u0434\u0435\u0442 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d.';
  const title = titleOverride || baseTitle;
  const description = descriptionOverride || baseDescription;
  const confirmLabel =
    confirmLabelOverride || '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c';

  return (
    <div
      className="dp-overlay z-50 flex items-center justify-center p-4"
      data-testid={
        isPrepayDecision ? 'dispatcher-prepay-decision-modal' : 'dispatcher-confirm-modal'
      }
    >
      <div className="dp-modal-card">
        <div className="flex items-start gap-4">
          <div className={dpIconWrap(isPrepayDecision ? 'warning' : 'success')}>
            {isPrepayDecision ? (
              <ArrowRightLeft size={18} strokeWidth={2} />
            ) : (
              <ShieldCheck size={18} strokeWidth={2} />
            )}
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
            {'\u041e\u0442\u043c\u0435\u043d\u0430'}
          </button>

          {isPrepayDecision ? (
            <>
              <button
                className={dpButton({ variant: 'primary' })}
                onClick={() => onConfirm?.('REFUND')}
                disabled={loading}
                data-testid="dispatcher-prepay-decision-refund"
              >
                {loading ? '...' : '\u0412\u0435\u0440\u043d\u0443\u0442\u044c \u043a\u043b\u0438\u0435\u043d\u0442\u0443'}
              </button>

              <button
                className={dpButton({ variant: 'warning' })}
                onClick={() => onConfirm?.('FUND')}
                disabled={loading}
                data-testid="dispatcher-prepay-decision-fund"
              >
                {loading ? '...' : '\u0412 \u0441\u0435\u0437\u043e\u043d\u043d\u044b\u0439 \u0444\u043e\u043d\u0434'}
              </button>
            </>
          ) : (
            <button
              className={dpButton({ variant: 'success' })}
              onClick={() => onConfirm?.()}
              disabled={loading}
              data-testid="dispatcher-confirm-submit"
            >
              {loading ? '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435...' : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConfirmBoardingModal;
