import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';

const DEFAULT_HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const DEFAULT_MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
export const DISPATCHER_TIME_OPTIONS = Array.from({ length: 27 }, (_, index) => {
  const totalMinutes = 8 * 60 + index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
});

function normalizeTime(value) {
  if (typeof value !== 'string') return '';
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '';
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function buildOptionMap(options, currentValue) {
  if (!Array.isArray(options) || options.length === 0) return null;

  const normalizedOptions = options
    .map(normalizeTime)
    .filter(Boolean);
  const normalizedCurrent = normalizeTime(currentValue);

  if (normalizedCurrent && !normalizedOptions.includes(normalizedCurrent)) {
    normalizedOptions.push(normalizedCurrent);
  }

  const map = new Map();
  [...new Set(normalizedOptions)].sort().forEach((time) => {
    const [hour, minute] = time.split(':');
    const minutes = map.get(hour) || [];
    minutes.push(minute);
    map.set(hour, minutes);
  });

  return map;
}

function getInitialDraft(value, optionMap) {
  const normalizedValue = normalizeTime(value);
  if (normalizedValue) return normalizedValue;

  if (optionMap?.size) {
    const hour = Array.from(optionMap.keys())[0];
    return `${hour}:${optionMap.get(hour)[0]}`;
  }

  return '12:00';
}

export default function TimeFieldPicker({
  value,
  onChange,
  name,
  label = '',
  placeholder = 'Выберите время',
  options = null,
  className = '',
  labelClassName = '',
  triggerClassName = '',
  disabled = false,
  required = false,
  sheetTitle = 'Выберите время',
  sheetDescription = 'Настройте часы и минуты, затем подтвердите выбор.',
  cancelLabel = 'Отмена',
  confirmLabel = 'Применить',
}) {
  const optionMap = useMemo(() => buildOptionMap(options, value), [options, value]);
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(() => getInitialDraft(value, optionMap));

  useEffect(() => {
    if (!open) return undefined;

    setDraftValue(getInitialDraft(value, optionMap));

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, optionMap, value]);

  const [draftHour, draftMinute] = draftValue.split(':');
  const hours = useMemo(() => (optionMap ? Array.from(optionMap.keys()) : DEFAULT_HOURS), [optionMap]);
  const minutes = optionMap ? optionMap.get(draftHour) || [] : DEFAULT_MINUTES;
  const displayValue = normalizeTime(value) || value || placeholder;

  const selectHour = (hour) => {
    const allowedMinutes = optionMap ? optionMap.get(hour) || [] : DEFAULT_MINUTES;
    const nextMinute = allowedMinutes.includes(draftMinute) ? draftMinute : allowedMinutes[0];
    setDraftValue(`${hour}:${nextMinute}`);
  };

  const selectMinute = (minute) => {
    setDraftValue(`${draftHour}:${minute}`);
  };

  const applyDraftValue = () => {
    onChange?.(draftValue);
    setOpen(false);
  };

  return (
    <>
      <div className={className}>
        {name ? <input type="hidden" name={name} value={normalizeTime(value) || value || ''} /> : null}

        {label ? (
          <label className={clsx('mb-1 block text-sm font-medium text-neutral-200', labelClassName)}>
            {label}
          </label>
        ) : null}

        <button
          type="button"
          onClick={() => !disabled && setOpen(true)}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-required={required || undefined}
          className={clsx(
            'flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[18px] border border-white/10 bg-[#07101d]/80 px-4 py-3 text-left text-sm text-neutral-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:bg-white/[0.06] focus:outline-none focus:ring-4 focus:ring-blue-500/15 disabled:cursor-not-allowed disabled:opacity-50',
            triggerClassName,
          )}
        >
          <span className={clsx('font-semibold', value ? 'text-neutral-100' : 'text-neutral-500')}>
            {displayValue}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-neutral-300">
            ЧЧ:ММ
          </span>
        </button>
      </div>

      {open ? (
        <div className="dp-overlay z-[80] flex items-center justify-center p-3" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Закрыть выбор времени"
            onClick={() => setOpen(false)}
            className="absolute inset-0"
          />

          <div className="dp-modal-card relative w-full max-w-[560px] overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                  Время
                </div>
                <div className="mt-1 text-lg font-semibold text-neutral-100">
                  {sheetTitle}
                </div>
                {sheetDescription ? (
                  <div className="mt-1 text-sm leading-5 text-neutral-400">
                    {sheetDescription}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="dp-button dp-button--ghost dp-button--sm"
              >
                {cancelLabel}
              </button>
            </div>

            <div className="mt-4 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                Выбрано
              </div>
              <div className="mt-2 text-[36px] font-bold leading-none text-neutral-50">
                {draftValue}
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                  Часы
                </div>
                <div className="grid max-h-[236px] grid-cols-4 gap-2 overflow-y-auto pr-1">
                  {hours.map((hour) => (
                    <button
                      key={hour}
                      type="button"
                      onClick={() => selectHour(hour)}
                      className={clsx(
                        'min-h-[44px] rounded-[14px] border px-3 text-sm font-bold transition-colors',
                        hour === draftHour
                          ? 'border-blue-300/60 bg-blue-600 text-white shadow-[0_18px_34px_-26px_rgba(59,130,246,0.9)]'
                          : 'border-white/10 bg-white/[0.04] text-neutral-200 hover:bg-white/[0.08]',
                      )}
                    >
                      {hour}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                  Минуты
                </div>
                <div className="grid max-h-[236px] grid-cols-5 gap-2 overflow-y-auto pr-1">
                  {minutes.map((minute) => (
                    <button
                      key={`${draftHour}:${minute}`}
                      type="button"
                      onClick={() => selectMinute(minute)}
                      className={clsx(
                        'min-h-[44px] rounded-[14px] border px-3 text-sm font-bold transition-colors',
                        minute === draftMinute
                          ? 'border-blue-300/60 bg-blue-600 text-white shadow-[0_18px_34px_-26px_rgba(59,130,246,0.9)]'
                          : 'border-white/10 bg-white/[0.04] text-neutral-200 hover:bg-white/[0.08]',
                      )}
                    >
                      {minute}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2 border-t border-white/10 pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="dp-button dp-button--ghost w-full sm:w-auto"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={applyDraftValue}
                className="dp-button dp-button--primary w-full sm:w-auto"
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
