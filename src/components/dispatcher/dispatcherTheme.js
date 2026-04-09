import clsx from 'clsx';

export function dpButton({
  variant = 'secondary',
  active = false,
  disabled = false,
  block = false,
  size = 'md',
  className = '',
} = {}) {
  return clsx(
    'dp-button',
    `dp-button--${variant}`,
    size !== 'md' && `dp-button--${size}`,
    active && 'is-active',
    disabled && 'is-disabled',
    block && 'dp-button--block',
    className,
  );
}

export function dpPill(tone = 'neutral', className = '') {
  return clsx('dp-pill', `dp-pill--${tone}`, className);
}

export function dpBadge(tone = 'neutral', className = '') {
  return clsx('dp-badge', `dp-badge--${tone}`, className);
}

export function dpIconWrap(tone = 'info', className = '') {
  return clsx('dp-icon-wrap', `dp-icon-wrap--${tone}`, className);
}

export function dpAlert(tone = 'info', className = '') {
  return clsx('dp-alert', `dp-alert--${tone}`, className);
}

export function dpMetric(tone = 'neutral', className = '') {
  return clsx('dp-metric', `dp-metric--${tone}`, className);
}

export function dpProgressTone(tone = 'info', className = '') {
  return clsx('dp-progress__bar', `dp-progress__bar--${tone}`, className);
}

export function dpTypeTone(type = '') {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('banana')) return 'warning';
  if (normalized.includes('speed') || normalized.includes('fast')) return 'info';
  if (normalized.includes('cruise') || normalized.includes('walk')) return 'success';
  return 'neutral';
}

export function dpStatusTone(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (
    normalized.includes('active') ||
    normalized.includes('open') ||
    normalized.includes('paid') ||
    normalized.includes('ready')
  ) {
    return 'success';
  }
  if (
    normalized.includes('partial') ||
    normalized.includes('pending') ||
    normalized.includes('hold') ||
    normalized.includes('warning')
  ) {
    return 'warning';
  }
  if (
    normalized.includes('debt') ||
    normalized.includes('closed') ||
    normalized.includes('cancel') ||
    normalized.includes('error')
  ) {
    return 'danger';
  }
  if (normalized.includes('complete') || normalized.includes('finish')) {
    return 'info';
  }
  return 'neutral';
}
