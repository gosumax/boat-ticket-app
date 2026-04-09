import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { getDay2Date, getTodayDate, getTomorrowDate } from '../../utils/dateUtils';

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const DAY_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
});

const COMPACT_DAY_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
});

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
});

const MONTH_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
});

function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isOutOfRange(value, min, max) {
  if (!value) return true;
  if (min && value < min) return true;
  if (max && value > max) return true;
  return false;
}

function getRelativeLabel(value) {
  if (!value) return null;
  if (value === getTodayDate()) return 'Сегодня';
  if (value === getTomorrowDate()) return 'Завтра';
  if (value === getDay2Date()) return 'Послезавтра';
  return null;
}

function buildDateDisplay(value, placeholder, options = {}) {
  const { showRelativeLabel = true, compactDisplay = false } = options;

  if (!value) {
    return {
      primary: placeholder,
      secondary: '',
    };
  }

  const parsed = parseIsoDate(value);
  if (!parsed) {
    return {
      primary: value,
      secondary: '',
    };
  }

  const relativeLabel = showRelativeLabel ? getRelativeLabel(value) : null;
  const absoluteLabel = compactDisplay ? COMPACT_DAY_FORMATTER.format(parsed) : DAY_FORMATTER.format(parsed);

  return {
    primary: relativeLabel || absoluteLabel,
    secondary: `${DAY_FORMATTER.format(parsed)} · ${WEEKDAY_FORMATTER.format(parsed)}`,
  };
}

function buildCalendarDays(monthDate) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startShift = (firstDay.getDay() + 6) % 7;

  return Array.from({ length: 42 }, (_, index) => {
    const cellDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), index - startShift + 1);
    return {
      value: toIsoDate(cellDate),
      label: cellDate.getDate(),
      inMonth: cellDate.getMonth() === monthDate.getMonth(),
    };
  });
}

export function buildStandardDatePresets() {
  return [
    { label: 'Сегодня', value: getTodayDate() },
    { label: 'Завтра', value: getTomorrowDate() },
    { label: 'Послезавтра', value: getDay2Date() },
  ];
}

export default function DateFieldPicker({
  value,
  onChange,
  label = '',
  caption = '',
  sheetTitle = 'Выберите дату',
  sheetDescription = 'Календарь открывается снизу и подходит для работы с телефона.',
  placeholder = 'Выберите дату',
  presets = null,
  min = '',
  max = '',
  tone = 'light',
  size = 'md',
  align = 'left',
  helper = '',
  className = '',
  triggerClassName = '',
  labelClassName = '',
  helperClassName = '',
  primaryClassName = '',
  secondaryClassName = '',
  showRelativeLabel = true,
  compactDisplay = false,
  testId,
  inputTestId,
  inputName,
  disabled = false,
  confirmLabel = 'Применить',
  closeLabel = 'Закрыть',
}) {
  const fallbackValue = value || getTodayDate();
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(fallbackValue);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(parseIsoDate(fallbackValue) || new Date()));

  useEffect(() => {
    if (!open) return undefined;

    const nextValue = value || getTodayDate();
    setDraftValue(nextValue);
    setViewMonth(startOfMonth(parseIsoDate(nextValue) || new Date()));

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
  }, [open, value]);

  const resolvedPresets = useMemo(() => {
    const items = Array.isArray(presets) ? presets : buildStandardDatePresets();
    return items.filter((item) => item?.value && !isOutOfRange(item.value, min, max));
  }, [max, min, presets]);

  const triggerDisplay = useMemo(
    () => buildDateDisplay(value, placeholder, { showRelativeLabel, compactDisplay }),
    [compactDisplay, placeholder, showRelativeLabel, value],
  );
  const draftDisplay = useMemo(
    () => buildDateDisplay(draftValue, placeholder, { showRelativeLabel, compactDisplay }),
    [compactDisplay, draftValue, placeholder, showRelativeLabel],
  );
  const calendarDays = useMemo(() => buildCalendarDays(viewMonth), [viewMonth]);
  const isDark = tone === 'dark';

  const toneStyles = isDark
    ? {
        label: 'text-neutral-500',
        helper: 'text-neutral-500',
        trigger:
          'border border-white/10 bg-white/[0.04] text-neutral-50 shadow-[0_18px_40px_-30px_rgba(0,0,0,0.78)] backdrop-blur-xl',
        caption: 'text-neutral-500',
        primary: 'text-neutral-50',
        secondary: 'text-neutral-400',
        focusRing: 'focus:ring-blue-500/25',
      }
    : {
        label: 'text-slate-500',
        helper: 'text-slate-500',
        trigger:
          'border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] text-slate-950 shadow-[0_24px_48px_-34px_rgba(15,23,42,0.45)]',
        caption: 'text-slate-400',
        primary: 'text-slate-950',
        secondary: 'text-slate-500',
        focusRing: 'focus:ring-sky-100/70',
      };

  const sizeStyles = size === 'lg'
    ? {
        trigger: 'min-h-[106px] rounded-[30px] px-5 py-5',
        primary: 'text-[30px] font-semibold leading-[1.05] tracking-[-0.05em]',
        secondary: 'text-sm leading-5',
      }
    : isDark
      ? {
          trigger: 'min-h-[64px] rounded-[20px] px-3.5 py-3',
          primary: 'text-base font-semibold leading-5',
          secondary: 'text-[13px] leading-4',
        }
    : {
        trigger: 'min-h-[76px] rounded-[24px] px-4 py-4',
        primary: 'text-lg font-semibold leading-6',
        secondary: 'text-sm leading-5',
      };

  const sheetStyles = isDark
    ? {
        width: 'max-w-xl',
        shell:
          'overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,32,0.98)_0%,rgba(2,6,23,0.97)_100%)] shadow-[0_32px_90px_-44px_rgba(0,0,0,0.92)] backdrop-blur-xl',
        header: 'border-b border-white/10 px-4 pb-3 pt-3',
        eyebrow: 'text-neutral-500',
        title: 'mt-1 text-lg font-semibold text-neutral-100',
        description: 'mt-1 text-sm leading-5 text-neutral-400',
        topClose:
          'rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-neutral-300 transition-colors hover:bg-white/[0.08]',
        summary:
          'mt-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
        summaryPrimary: 'mt-2 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-neutral-50',
        summarySecondary: 'mt-2 text-sm leading-5 text-neutral-400',
        presetWrap: 'mt-3 flex flex-wrap gap-2',
        presetButton: 'rounded-full px-3.5 py-2 text-xs font-semibold transition-colors',
        presetActive:
          'border border-blue-400/60 bg-[linear-gradient(145deg,#1d4ed8_0%,#2563eb_100%)] text-white shadow-[0_16px_26px_-20px_rgba(59,130,246,0.72)]',
        presetIdle: 'bg-neutral-900/90 text-neutral-200 ring-1 ring-white/10 hover:bg-neutral-800',
        body: 'px-4 py-3',
        navButton:
          'rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-neutral-200 transition-colors hover:bg-white/[0.08]',
        monthTitle: 'text-center text-base font-semibold capitalize text-neutral-100',
        weekday: 'pb-1 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500',
        dayBase: 'min-h-[42px] rounded-xl text-sm font-semibold transition-all',
        daySelected:
          'bg-[linear-gradient(145deg,#1d4ed8_0%,#2563eb_100%)] text-white shadow-[0_16px_28px_-22px_rgba(59,130,246,0.8)]',
        dayCurrent: 'bg-neutral-900/90 text-neutral-100 ring-1 ring-white/10 hover:bg-neutral-800',
        dayAdjacent: 'bg-neutral-950/70 text-neutral-500 ring-1 ring-white/[0.06] hover:bg-neutral-900',
        footer: 'border-t border-white/10 bg-black/10 px-4 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-3',
        footerLayout: 'flex flex-col gap-2 sm:flex-row sm:justify-end',
        closeAction:
          'w-full rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-neutral-200 transition-colors hover:bg-white/[0.08] sm:w-auto sm:min-w-[120px]',
        confirmAction:
          'w-full rounded-[18px] bg-[linear-gradient(145deg,#1d4ed8_0%,#2563eb_100%)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_20px_36px_-24px_rgba(37,99,235,0.82)] transition hover:brightness-[1.04] sm:w-auto sm:min-w-[140px]',
      }
    : {
        width: 'max-w-2xl',
        shell:
          'overflow-hidden rounded-[32px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(247,250,255,0.96)_100%)] shadow-[0_32px_90px_-44px_rgba(15,23,42,0.72)] backdrop-blur-xl',
        header: 'border-b border-slate-200/80 px-4 pb-4 pt-4',
        eyebrow: 'text-slate-400',
        title: 'mt-1 text-xl font-semibold text-slate-950',
        description: 'mt-1 text-sm leading-5 text-slate-500',
        topClose: 'rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200',
        summary: 'mt-4 rounded-[26px] border border-slate-200 bg-white/90 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]',
        summaryPrimary: 'mt-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.05em] text-slate-950',
        summarySecondary: 'mt-2 text-sm leading-5 text-slate-500',
        presetWrap: 'mt-4 flex flex-wrap gap-2',
        presetButton: 'rounded-full px-4 py-3 text-sm font-semibold transition-colors',
        presetActive: 'bg-slate-950 text-white shadow-[0_18px_30px_-24px_rgba(15,23,42,0.72)]',
        presetIdle: 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
        body: 'px-4 py-4',
        navButton: 'rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200',
        monthTitle: 'text-center text-lg font-semibold capitalize text-slate-950',
        weekday: 'pb-1 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400',
        dayBase: 'min-h-[54px] rounded-2xl text-base font-semibold transition-all',
        daySelected:
          'bg-[linear-gradient(145deg,#0f172a_0%,#2563eb_100%)] text-white shadow-[0_22px_34px_-24px_rgba(37,99,235,0.78)]',
        dayCurrent: 'bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50',
        dayAdjacent: 'bg-slate-100/70 text-slate-400 ring-1 ring-slate-200/70 hover:bg-slate-100',
        footer: 'border-t border-slate-200/80 bg-white/80 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4',
        footerLayout: 'flex flex-col gap-2 sm:flex-row',
        closeAction:
          'w-full rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50',
        confirmAction:
          'w-full rounded-[22px] bg-[linear-gradient(145deg,#0f172a_0%,#2563eb_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_36px_-24px_rgba(37,99,235,0.82)] transition hover:brightness-[1.04]',
      };

  const handleInputChange = (event) => {
    const nextValue = event.target.value;
    if (!nextValue || isOutOfRange(nextValue, min, max)) return;
    onChange(nextValue);
  };

  const applyDraftValue = () => {
    if (draftValue && !isOutOfRange(draftValue, min, max)) {
      onChange(draftValue);
    }
    setOpen(false);
  };

  const alignmentClass = align === 'center' ? 'items-center text-center' : 'items-start text-left';

  return (
    <>
      <div className={clsx('space-y-2', className)}>
        {label ? (
          <div className={clsx('text-[11px] font-semibold uppercase tracking-[0.16em]', toneStyles.label, labelClassName)}>
            {label}
          </div>
        ) : null}

        <div className="relative">
          <input
            type="date"
            name={inputName}
            value={value || ''}
            onChange={handleInputChange}
            data-testid={inputTestId}
            disabled={disabled}
            className="absolute inset-0 z-0 h-full w-full opacity-0"
          />

          <button
            type="button"
            onClick={() => !disabled && setOpen(true)}
            data-testid={testId}
            disabled={disabled}
            className={clsx(
              'relative z-10 w-full overflow-hidden transition-transform duration-200 focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60',
              toneStyles.focusRing,
              toneStyles.trigger,
              sizeStyles.trigger,
              triggerClassName,
            )}
          >
            <div className={clsx('flex min-h-full justify-center', alignmentClass)}>
              <div className="min-w-0">
                {caption ? (
                  <div className={clsx('text-[11px] font-semibold uppercase tracking-[0.18em]', toneStyles.caption)}>
                    {caption}
                  </div>
                ) : null}
                <div className={clsx('mt-1', toneStyles.primary, sizeStyles.primary, primaryClassName)}>
                  {triggerDisplay.primary}
                </div>
                {triggerDisplay.secondary ? (
                  <div className={clsx('mt-2', toneStyles.secondary, sizeStyles.secondary, secondaryClassName)}>
                    {triggerDisplay.secondary}
                  </div>
                ) : null}
              </div>
            </div>
          </button>
        </div>

        {helper ? (
          <div className={clsx('text-sm leading-5', toneStyles.helper, helperClassName)}>
            {helper}
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Закрыть календарь"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
          />

          <div className={clsx('absolute inset-x-0 bottom-0 mx-auto w-full px-3 pb-3 md:bottom-4', sheetStyles.width)}>
            <div className={sheetStyles.shell}>
              <div className={sheetStyles.header}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className={clsx('text-[11px] font-semibold uppercase tracking-[0.18em]', sheetStyles.eyebrow)}>
                      Календарь
                    </div>
                    <div className={sheetStyles.title}>{sheetTitle}</div>
                    {sheetDescription ? (
                      <div className={sheetStyles.description}>{sheetDescription}</div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className={sheetStyles.topClose}
                  >
                    {closeLabel}
                  </button>
                </div>

                <div className={sheetStyles.summary}>
                  <div className={clsx('text-[11px] font-semibold uppercase tracking-[0.18em]', sheetStyles.eyebrow)}>
                    Выбрано
                  </div>
                  <div className={sheetStyles.summaryPrimary}>
                    {draftDisplay.primary}
                  </div>
                  {draftDisplay.secondary ? (
                    <div className={sheetStyles.summarySecondary}>{draftDisplay.secondary}</div>
                  ) : null}
                </div>

                {resolvedPresets.length > 0 ? (
                  <div className={sheetStyles.presetWrap}>
                    {resolvedPresets.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => {
                          setDraftValue(preset.value);
                          const parsed = parseIsoDate(preset.value);
                          if (parsed) {
                            setViewMonth(startOfMonth(parsed));
                          }
                        }}
                        className={clsx(
                          sheetStyles.presetButton,
                          draftValue === preset.value
                            ? sheetStyles.presetActive
                            : sheetStyles.presetIdle,
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className={sheetStyles.body}>
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                    className={sheetStyles.navButton}
                  >
                    Назад
                  </button>

                  <div className={sheetStyles.monthTitle}>
                    {MONTH_FORMATTER.format(viewMonth)}
                  </div>

                  <button
                    type="button"
                    onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                    className={sheetStyles.navButton}
                  >
                    Вперёд
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-7 gap-2">
                  {WEEKDAY_LABELS.map((weekday) => (
                    <div
                      key={weekday}
                      className={sheetStyles.weekday}
                    >
                      {weekday}
                    </div>
                  ))}

                  {calendarDays.map((day) => {
                    const selected = draftValue === day.value;
                    const disabledDay = isOutOfRange(day.value, min, max);

                    return (
                      <button
                        key={day.value}
                        type="button"
                        disabled={disabledDay}
                        onClick={() => setDraftValue(day.value)}
                        className={clsx(
                          sheetStyles.dayBase,
                          selected
                            ? sheetStyles.daySelected
                            : day.inMonth
                              ? sheetStyles.dayCurrent
                              : sheetStyles.dayAdjacent,
                          disabledDay && 'cursor-not-allowed opacity-35',
                        )}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={sheetStyles.footer}>
                <div className={sheetStyles.footerLayout}>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className={sheetStyles.closeAction}
                  >
                    {closeLabel}
                  </button>
                  <button
                    type="button"
                    onClick={applyDraftValue}
                    className={sheetStyles.confirmAction}
                  >
                    {confirmLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
