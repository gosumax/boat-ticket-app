import clsx from 'clsx';

export const sellerPageClass =
  'min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#edf4ff_42%,#f8fbff_100%)] text-slate-950';

export const sellerContentClass = 'mx-auto max-w-2xl px-3 py-3';

export const sellerSurfaceClass =
  'rounded-[28px] bg-white p-4 shadow-[0_22px_48px_-30px_rgba(15,23,42,0.38)] ring-1 ring-slate-200/90';

export const sellerInsetClass =
  'rounded-[22px] border border-slate-200 bg-slate-50/85 px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]';

export const sellerFieldLabelClass =
  'mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500';

export const sellerHelperTextClass = 'text-sm leading-5 text-slate-500';

export function sellerButtonClass({
  variant = 'primary',
  size = 'md',
  block = true,
  disabled = false,
  className = '',
} = {}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-sky-100';
  const sizeMap = {
    sm: 'px-3 py-2 text-sm',
    md: 'px-4 py-3 text-sm',
    lg: 'px-5 py-4 text-base',
  };
  const variantMap = {
    primary:
      'bg-[linear-gradient(135deg,#0f172a_0%,#17325d_48%,#2563eb_100%)] text-white shadow-[0_20px_34px_-20px_rgba(37,99,235,0.75)] hover:brightness-[1.04] active:translate-y-[1px]',
    secondary:
      'border border-slate-200 bg-white text-slate-700 shadow-[0_18px_30px_-24px_rgba(15,23,42,0.4)] hover:bg-slate-50 active:translate-y-[1px]',
    ghost:
      'bg-white/60 text-slate-600 ring-1 ring-slate-200/80 shadow-[0_16px_28px_-24px_rgba(15,23,42,0.35)] hover:bg-white active:translate-y-[1px]',
    destructive:
      'bg-[linear-gradient(135deg,#7f1d1d_0%,#dc2626_100%)] text-white shadow-[0_18px_32px_-20px_rgba(220,38,38,0.72)] hover:brightness-[1.03] active:translate-y-[1px]',
  };

  return clsx(
    base,
    sizeMap[size] || sizeMap.md,
    variantMap[variant] || variantMap.primary,
    block && 'w-full',
    disabled && 'pointer-events-none opacity-50 saturate-75 shadow-none',
    className,
  );
}

export function sellerChipClass({
  active = false,
  tone = 'default',
  className = '',
} = {}) {
  const toneMap = {
    default: active
      ? 'bg-slate-950 text-white shadow-[0_14px_26px_-18px_rgba(15,23,42,0.7)]'
      : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
    accent: active
      ? 'bg-sky-950 text-white shadow-[0_14px_26px_-18px_rgba(14,116,144,0.7)]'
      : 'bg-sky-50 text-sky-900 ring-1 ring-sky-200 hover:bg-sky-100',
    success: active
      ? 'bg-emerald-700 text-white shadow-[0_14px_26px_-18px_rgba(4,120,87,0.7)]'
      : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100',
    warning: active
      ? 'bg-amber-500 text-slate-950 shadow-[0_14px_26px_-18px_rgba(245,158,11,0.75)]'
      : 'bg-amber-50 text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100',
  };

  return clsx(
    'inline-flex items-center justify-center rounded-full px-3 py-2 text-sm font-medium transition-colors',
    toneMap[tone] || toneMap.default,
    className,
  );
}

export function sellerChoiceCardClass({
  selected = false,
  disabled = false,
  className = '',
} = {}) {
  return clsx(
    'w-full rounded-[26px] border p-4 text-left transition-all duration-200',
    selected
      ? 'border-slate-950 bg-slate-950 text-white shadow-[0_24px_38px_-24px_rgba(15,23,42,0.85)]'
      : 'border-slate-200 bg-white text-slate-900 shadow-[0_18px_30px_-24px_rgba(15,23,42,0.38)] hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_22px_36px_-24px_rgba(15,23,42,0.42)]',
    disabled && 'cursor-not-allowed opacity-55 saturate-75 hover:translate-y-0',
    className,
  );
}

export function sellerInputClass(className = '') {
  return clsx(
    'w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[15px] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] outline-none transition-all placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:ring-4 focus:ring-sky-100',
    className,
  );
}

export function sellerSegmentClass(active) {
  return clsx(
    'inline-flex items-center justify-center rounded-2xl px-3 py-2.5 text-sm font-semibold transition-all',
    active
      ? 'bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_100%)] text-white shadow-[0_18px_28px_-20px_rgba(37,99,235,0.72)]'
      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
  );
}

export function SellerScreen({ children, className = '', ...props }) {
  return (
    <div className={clsx(sellerPageClass, className)} {...props}>
      {children}
    </div>
  );
}

export function SellerTopbar({
  title,
  subtitle = null,
  onBack,
  backLabel = 'Назад',
  onLogout,
  logoutLabel = 'Выйти',
  rightSlot = null,
  sticky = true,
  backProps = {},
  titleProps = {},
  logoutProps = {},
}) {
  return (
    <div
      className={clsx(
        sticky && 'sticky top-0 z-20',
        'border-b border-slate-200/80 bg-white/92 backdrop-blur-xl',
      )}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-3 py-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className={sellerButtonClass({ variant: 'ghost', size: 'sm', block: false })}
            {...backProps}
          >
            {backLabel}
          </button>
        ) : (
          <div className="w-[84px] shrink-0" />
        )}

        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-base font-semibold text-slate-900" {...titleProps}>
            {title}
          </div>
          {subtitle ? <div className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</div> : null}
        </div>

        {rightSlot ? (
          <div className="shrink-0">{rightSlot}</div>
        ) : onLogout ? (
          <button
            type="button"
            onClick={onLogout}
            className={sellerButtonClass({ variant: 'secondary', size: 'sm', block: false })}
            {...logoutProps}
          >
            {logoutLabel}
          </button>
        ) : (
          <div className="w-[84px] shrink-0" />
        )}
      </div>
    </div>
  );
}

export function SellerHeroPanel({ children, className = '' }) {
  return (
    <section
      className={clsx(
        'rounded-[30px] bg-[linear-gradient(145deg,#0f172a_0%,#10294d_45%,#2563eb_100%)] px-4 py-5 text-white shadow-[0_28px_52px_-24px_rgba(37,99,235,0.62)]',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SellerSurface({ children, className = '', ...props }) {
  return (
    <section className={clsx(sellerSurfaceClass, className)} {...props}>
      {children}
    </section>
  );
}

export function SellerInset({ children, className = '', ...props }) {
  return (
    <div className={clsx(sellerInsetClass, className)} {...props}>
      {children}
    </div>
  );
}

const sellerStepperTones = [
  {
    active: 'bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_100%)] text-white ring-blue-700/50 shadow-[0_18px_34px_-22px_rgba(29,78,216,0.86)]',
    passed: 'bg-[linear-gradient(135deg,#eff6ff_0%,#dbeafe_100%)] text-blue-950 ring-blue-200',
  },
  {
    active: 'bg-[linear-gradient(135deg,#1e3a8a_0%,#0284c7_100%)] text-white ring-sky-500/50 shadow-[0_18px_34px_-22px_rgba(2,132,199,0.82)]',
    passed: 'bg-[linear-gradient(135deg,#eff6ff_0%,#e0f2fe_100%)] text-sky-950 ring-sky-200',
  },
  {
    active: 'bg-[linear-gradient(135deg,#075985_0%,#14b8a6_100%)] text-white ring-teal-500/50 shadow-[0_18px_34px_-22px_rgba(20,184,166,0.78)]',
    passed: 'bg-[linear-gradient(135deg,#f0fdfa_0%,#ccfbf1_100%)] text-teal-950 ring-teal-200',
  },
  {
    active: 'bg-[linear-gradient(135deg,#047857_0%,#22c55e_100%)] text-white ring-emerald-500/50 shadow-[0_18px_34px_-22px_rgba(34,197,94,0.78)]',
    passed: 'bg-[linear-gradient(135deg,#ecfdf5_0%,#d1fae5_100%)] text-emerald-950 ring-emerald-200',
  },
];

export function SellerStepper({ steps, currentStep, onStepClick }) {
  const visibleSteps = Array.isArray(steps) ? steps : [];
  const activeIndex = Math.max(
    0,
    visibleSteps.findIndex((step) => step.id === currentStep),
  );
  const progress = visibleSteps.length > 1 ? ((activeIndex + 1) / visibleSteps.length) * 100 : 0;

  return (
    <SellerSurface className="overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)]">
      <div>
        <div className="text-lg font-semibold text-slate-900">
          {visibleSteps[activeIndex]?.title || visibleSteps[activeIndex]?.label || 'Оформление'}
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#0f172a_0%,#1d4ed8_34%,#0ea5e9_64%,#22c55e_100%)] shadow-[0_0_18px_rgba(14,165,233,0.34)] transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {visibleSteps.map((step, index) => {
          const isActive = step.id === currentStep;
          const isPassed = index < activeIndex;
          const isNavigable = index <= activeIndex && typeof onStepClick === 'function';
          const tone = sellerStepperTones[index] || sellerStepperTones[sellerStepperTones.length - 1];

          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onStepClick?.(step.id)}
              disabled={!isNavigable}
              aria-current={isActive ? 'step' : undefined}
              className={clsx(
                'flex min-h-[64px] items-center justify-center rounded-[22px] px-3 py-3 text-center ring-1 transition-all duration-200',
                isNavigable && 'hover:-translate-y-0.5',
                isActive
                  ? tone.active
                  : isPassed
                    ? tone.passed
                    : 'bg-slate-50 text-slate-500 ring-slate-200',
                !isNavigable && 'cursor-not-allowed',
              )}
            >
              <div className="text-sm font-semibold leading-5">{step.label}</div>
            </button>
          );
        })}
      </div>
    </SellerSurface>
  );
}
