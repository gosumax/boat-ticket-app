import { formatMiniAppBusinessHoldDeadlineLabel } from './hold-deadline-format.js';

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function formatFallbackLabel(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return 'Неизвестно';
  }
  return normalized
    .split('_')
    .filter(Boolean)
    .join(' ');
}

function formatRussianSeatWord(count) {
  const normalizedCount = Number(count);
  if (!Number.isInteger(normalizedCount) || normalizedCount <= 0) {
    return 'мест';
  }

  const lastTwoDigits = normalizedCount % 100;
  const lastDigit = normalizedCount % 10;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return 'мест';
  }
  if (lastDigit === 1) {
    return 'место';
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return 'места';
  }
  return 'мест';
}

function createPresentation(values) {
  return Object.freeze(values);
}

function createPendingRequestPresentation({
  requestReferenceLabel,
  holdActive,
  holdExpiresAtIso,
}) {
  const holdDeadlineLabel = formatMiniAppBusinessHoldDeadlineLabel(holdExpiresAtIso);
  const holdStatusLabel = holdActive
    ? holdDeadlineLabel
      ? `До ${holdDeadlineLabel}`
      : 'Идёт таймер'
    : 'Статус обновляется';

  return createPresentation({
    entityLabel: 'Заявка',
    cardTitle: 'Заявка создана',
    statusLabel: 'Ждём предоплату',
    statusTone: 'warning',
    availabilityLabel: 'Билет появится после подтверждения',
    availabilityTone: 'accent',
    description:
      'С вами свяжется продавец. Если удобнее, позвоните сами и передайте предоплату.',
    detailTitle: requestReferenceLabel || 'Заявка',
    detailDescription:
      'Дождитесь звонка продавца или свяжитесь с ним сами. Билет появится здесь после подтверждения предоплаты.',
    actionLabel: 'Открыть заявку',
    holdStatusLabel,
    holdTone: 'warning',
    prepaymentStatusLabel: 'Нужно передать предоплату',
    prepaymentTone: 'warning',
    ticketStatusLabel: 'Появится после подтверждения',
    ticketTone: 'accent',
    nextActionLabel: 'Дождитесь звонка продавца или свяжитесь с ним сами.',
    nextActionTone: 'accent',
  });
}

function createPrepaymentConfirmedPresentation({ requestReferenceLabel }) {
  return createPresentation({
    entityLabel: 'Заявка',
    cardTitle: requestReferenceLabel,
    statusLabel: 'Предоплата подтверждена',
    statusTone: 'success',
    availabilityLabel: 'Билет появится позже',
    availabilityTone: 'warning',
    description: 'Предоплата подтверждена. Билет уже оформляется и скоро появится в этом разделе.',
    detailTitle: requestReferenceLabel,
    detailDescription:
      'Предоплата подтверждена. Билет ещё не выдан и появится здесь, как только будет готов.',
    actionLabel: 'Открыть заявку',
    holdStatusLabel: 'Завершена',
    holdTone: 'neutral',
    prepaymentStatusLabel: 'Подтверждена',
    prepaymentTone: 'success',
    ticketStatusLabel: 'Оформляется',
    ticketTone: 'warning',
    nextActionLabel: 'Дождитесь появления билета.',
    nextActionTone: 'accent',
  });
}

function createReadyTicketPresentation({ ticketReferenceLabel }) {
  return createPresentation({
    entityLabel: 'Билет',
    cardTitle: ticketReferenceLabel,
    statusLabel: 'Билет готов',
    statusTone: 'success',
    availabilityLabel: 'Можно открыть',
    availabilityTone: 'success',
    description: 'Билет готов и уже доступен в этом разделе.',
    detailTitle: ticketReferenceLabel,
    detailDescription: 'Билет готов. Откройте его, чтобы посмотреть детали поездки.',
    actionLabel: 'Открыть билет',
    holdStatusLabel: 'Завершена',
    holdTone: 'neutral',
    prepaymentStatusLabel: 'Подтверждена',
    prepaymentTone: 'success',
    ticketStatusLabel: 'Готов',
    ticketTone: 'success',
    nextActionLabel: 'Откройте билет.',
    nextActionTone: 'accent',
  });
}

function createCompletedTicketPresentation({ ticketReferenceLabel }) {
  return createPresentation({
    entityLabel: 'Билет',
    cardTitle: ticketReferenceLabel,
    statusLabel: 'Поездка завершена',
    statusTone: 'neutral',
    availabilityLabel: 'Архив',
    availabilityTone: 'neutral',
    description: 'Поездка завершена. Карточка билета сохранена для просмотра.',
    detailTitle: ticketReferenceLabel,
    detailDescription: 'Поездка завершена. Здесь сохранены детали выданного билета.',
    actionLabel: 'Посмотреть билет',
    holdStatusLabel: 'Завершена',
    holdTone: 'neutral',
    prepaymentStatusLabel: 'Подтверждена',
    prepaymentTone: 'success',
    ticketStatusLabel: 'Использован',
    ticketTone: 'neutral',
    nextActionLabel: 'Можно посмотреть детали поездки.',
    nextActionTone: 'accent',
  });
}

function createExpiredRequestPresentation({ requestReferenceLabel }) {
  return createPresentation({
    entityLabel: 'Заявка',
    cardTitle: requestReferenceLabel,
    statusLabel: 'Бронь истекла',
    statusTone: 'danger',
    availabilityLabel: 'Билет не оформлен',
    availabilityTone: 'danger',
    description: 'Время брони закончилось, поэтому билет по этой заявке не был оформлен.',
    detailTitle: requestReferenceLabel,
    detailDescription: 'Срок брони истёк. По этой заявке билет не был оформлен.',
    actionLabel: 'Открыть заявку',
    holdStatusLabel: 'Истекла',
    holdTone: 'danger',
    prepaymentStatusLabel: 'Не подтверждена',
    prepaymentTone: 'danger',
    ticketStatusLabel: 'Не выдан',
    ticketTone: 'danger',
    nextActionLabel: 'Можно выбрать новый рейс в каталоге.',
    nextActionTone: 'accent',
  });
}

function createCancelledRequestPresentation({ requestReferenceLabel }) {
  return createPresentation({
    entityLabel: 'Заявка',
    cardTitle: requestReferenceLabel,
    statusLabel: 'Заявка закрыта',
    statusTone: 'danger',
    availabilityLabel: 'Билет не оформлен',
    availabilityTone: 'danger',
    description: 'Эта заявка закрыта до оформления билета.',
    detailTitle: requestReferenceLabel,
    detailDescription: 'Заявка закрыта. Билет по ней не оформлялся.',
    actionLabel: 'Открыть заявку',
    holdStatusLabel: 'Не активна',
    holdTone: 'danger',
    prepaymentStatusLabel: 'Не подтверждена',
    prepaymentTone: 'danger',
    ticketStatusLabel: 'Не выдан',
    ticketTone: 'danger',
    nextActionLabel: 'Если поездка ещё нужна, выберите новый рейс.',
    nextActionTone: 'accent',
  });
}

function createUnavailableTicketPresentation({ requestReferenceLabel }) {
  return createPresentation({
    entityLabel: 'Заявка',
    cardTitle: requestReferenceLabel,
    statusLabel: 'Билет недоступен',
    statusTone: 'danger',
    availabilityLabel: 'Недоступен',
    availabilityTone: 'danger',
    description: 'Сейчас по этой заявке нельзя открыть билет.',
    detailTitle: requestReferenceLabel,
    detailDescription:
      'Сейчас по этой заявке нет доступного билета. Если нужна помощь, откройте раздел «Связь».',
    actionLabel: 'Открыть заявку',
    holdStatusLabel: 'Не активна',
    holdTone: 'danger',
    prepaymentStatusLabel: 'Проверьте статус',
    prepaymentTone: 'warning',
    ticketStatusLabel: 'Недоступен',
    ticketTone: 'danger',
    nextActionLabel: 'Откройте заявку и проверьте детали.',
    nextActionTone: 'accent',
  });
}

export function formatMiniAppSeatCountLabel(value) {
  const normalizedCount = Number(value);
  if (!Number.isInteger(normalizedCount) || normalizedCount <= 0) {
    return 'н/д';
  }
  return `${normalizedCount} ${formatRussianSeatWord(normalizedCount)}`;
}

export function resolveMiniAppBuyerTicketPresentation({
  status = null,
  availability = null,
  buyerTicketCode = null,
  lifecycleState = null,
  holdActive = false,
  requestConfirmed = false,
  holdExpiresAtIso = null,
} = {}) {
  const normalizedStatus = normalizeString(status) || 'unknown';
  const normalizedAvailability = normalizeString(availability) || 'unknown';
  const normalizedLifecycleState = normalizeString(lifecycleState) || null;
  const normalizedBuyerTicketCode = normalizeString(buyerTicketCode);
  const resolvedRequestReferenceLabel = normalizedBuyerTicketCode
    ? `Билет ${normalizedBuyerTicketCode}`
    : 'Заявка';
  const resolvedTicketReferenceLabel = normalizedBuyerTicketCode
    ? `Билет ${normalizedBuyerTicketCode}`
    : 'Билет';

  if (
    normalizedStatus === 'linked_ticket_ready' ||
    normalizedAvailability === 'available'
  ) {
    return createReadyTicketPresentation({ ticketReferenceLabel: resolvedTicketReferenceLabel });
  }

  if (
    normalizedStatus === 'linked_ticket_completed' ||
    normalizedAvailability === 'completed'
  ) {
    return createCompletedTicketPresentation({
      ticketReferenceLabel: resolvedTicketReferenceLabel,
    });
  }

  if (normalizedLifecycleState === 'hold_expired') {
    return createExpiredRequestPresentation({
      requestReferenceLabel: resolvedRequestReferenceLabel,
    });
  }

  if (normalizedLifecycleState === 'cancelled_before_prepayment') {
    return createCancelledRequestPresentation({
      requestReferenceLabel: resolvedRequestReferenceLabel,
    });
  }

  if (
    normalizedLifecycleState === 'prepayment_confirmed' ||
    requestConfirmed === true
  ) {
    return createPrepaymentConfirmedPresentation({
      requestReferenceLabel: resolvedRequestReferenceLabel,
    });
  }

  if (
    normalizedStatus === 'no_ticket_yet' ||
    normalizedStatus === 'request_created' ||
    normalizedStatus === 'request_received' ||
    normalizedAvailability === 'not_available_yet'
  ) {
    return createPendingRequestPresentation({
      requestReferenceLabel: resolvedRequestReferenceLabel,
      holdActive: Boolean(holdActive),
      holdExpiresAtIso,
    });
  }

  if (
    normalizedStatus === 'linked_ticket_cancelled_or_unavailable' ||
    normalizedAvailability === 'unavailable'
  ) {
    return createUnavailableTicketPresentation({
      requestReferenceLabel: resolvedRequestReferenceLabel,
    });
  }

  return createPresentation({
    entityLabel: 'Заявка',
    cardTitle: resolvedRequestReferenceLabel,
    statusLabel: formatFallbackLabel(normalizedStatus),
    statusTone: 'neutral',
    availabilityLabel: formatFallbackLabel(normalizedAvailability),
    availabilityTone: 'neutral',
    description: 'Статус обновляется. Откройте заявку, чтобы посмотреть подробности.',
    detailTitle: resolvedRequestReferenceLabel,
    detailDescription: 'Откройте заявку, чтобы посмотреть подробности текущего статуса.',
    actionLabel: 'Открыть заявку',
    holdStatusLabel: 'Обновляется',
    holdTone: 'neutral',
    prepaymentStatusLabel: 'Обновляется',
    prepaymentTone: 'neutral',
    ticketStatusLabel: 'Обновляется',
    ticketTone: 'neutral',
    nextActionLabel: 'Откройте заявку и проверьте детали.',
    nextActionTone: 'accent',
  });
}
