import { formatMiniAppBusinessHoldDeadlineLabel } from './hold-deadline-format.js';

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function readIso(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }
  return normalizeString(summary.iso);
}

function readReferenceId(reference, key) {
  if (!reference || typeof reference !== 'object') {
    return null;
  }
  const value = reference[key];
  return Number.isInteger(value) ? value : null;
}

function mapSubmitReasonCode(reasonCode) {
  if (reasonCode === 'invalid_contact_phone') {
    return 'Проверьте телефон: нужен корректный номер в международном формате.';
  }
  if (reasonCode === 'invalid_seats_count') {
    return 'Проверьте количество мест в заявке.';
  }
  if (reasonCode === 'invalid_ticket_mix') {
    return 'Проверьте выбранные билеты и попробуйте ещё раз.';
  }
  if (reasonCode === 'invalid_trip_slot_reference') {
    return 'Этот рейс сейчас нельзя забронировать.';
  }
  if (reasonCode === 'not_enough_seats') {
    return 'На этот рейс осталось меньше мест. Выберите меньше билетов.';
  }
  if (reasonCode === 'no_valid_routing_state') {
    return 'Сейчас оформить заявку не получилось. Попробуйте открыть рейс заново.';
  }
  if (reasonCode === 'duplicate_active_request') {
    return 'У вас уже есть активная заявка. Откройте её в разделе «Мои заявки».';
  }
  if (reasonCode === 'idempotency_conflict') {
    return 'Похоже, эта заявка уже была отправлена. Проверьте раздел «Мои заявки».';
  }
  if (reasonCode === 'network_error') {
    return 'Не удалось отправить заявку из-за ошибки сети.';
  }
  return null;
}

function readSellerContactSummary(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  const sellerName = normalizeString(
    summary.seller_display_name ?? summary.sellerDisplayName
  );
  const sellerPhone = normalizeString(
    summary.seller_phone_e164 ?? summary.sellerPhoneE164
  );

  if (!sellerName && !sellerPhone) {
    return null;
  }

  return Object.freeze({
    sellerName,
    sellerPhone,
    sellerCallHref: sellerPhone ? `tel:${sellerPhone}` : null,
  });
}

function buildReferenceText({ bookingRequestId, holdId }) {
  const parts = [
    bookingRequestId ? `ID заявки: ${bookingRequestId}` : null,
    holdId ? `ID брони: ${holdId}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' • ') : null;
}

export function buildMiniAppHoldResultViewModel(submitResult) {
  const submitStatus = normalizeString(submitResult?.submit_status) || 'unknown';
  const submitReasonCode = normalizeString(submitResult?.submit_reason_code);
  const submitMessage = normalizeString(submitResult?.submit_message);
  const bookingRequestId = readReferenceId(
    submitResult?.booking_request_reference,
    'booking_request_id'
  );
  const holdId = readReferenceId(submitResult?.hold_reference, 'booking_hold_id');
  const holdExpiresAtIso = readIso(submitResult?.hold_expires_at_summary);
  const holdDeadlineLabel = formatMiniAppBusinessHoldDeadlineLabel(holdExpiresAtIso);
  const sellerContact = readSellerContactSummary(submitResult?.seller_contact_summary);

  if (submitStatus === 'submitted_with_hold') {
    return {
      tone: 'success',
      headline: 'Заявка создана',
      statusLabel: 'Ждём предоплату',
      primaryText: null,
      secondaryText: null,
      summaryItems: [],
      referenceText: buildReferenceText({ bookingRequestId, holdId }),
      holdExpiresAtIso,
      holdDeadlineLabel,
      sellerContact,
      instructionSteps: Object.freeze([
        'Свяжитесь с продавцом или дождитесь его звонка.',
        'Передайте предоплату, чтобы подтвердить бронь.',
        'После подтверждения предоплаты билет появится здесь.',
      ]),
      isSuccess: true,
    };
  }

  if (submitStatus === 'submit_failed_validation') {
    return {
      tone: 'warning',
      headline: 'Проверьте данные заявки',
      statusLabel: 'Нужно исправить',
      primaryText:
        mapSubmitReasonCode(submitReasonCode) ||
        submitMessage ||
        'Данные заявки заполнены некорректно.',
      secondaryText: null,
      summaryItems: [],
      referenceText: null,
      holdExpiresAtIso: null,
      holdDeadlineLabel: null,
      sellerContact: null,
      instructionSteps: Object.freeze([]),
      isSuccess: false,
    };
  }

  if (submitStatus === 'submit_blocked') {
    if (submitReasonCode === 'duplicate_active_request') {
      return {
        tone: 'success',
        headline: 'Заявка уже создана',
        statusLabel: 'Откройте «Мои заявки»',
        primaryText:
          mapSubmitReasonCode(submitReasonCode) ||
          submitMessage ||
          'У вас уже есть активная заявка. Откройте её в разделе «Мои заявки».',
        secondaryText: null,
        summaryItems: [],
        referenceText: null,
        holdExpiresAtIso: null,
        holdDeadlineLabel: null,
        sellerContact: null,
        instructionSteps: Object.freeze([]),
        isSuccess: true,
      };
    }

    return {
      tone: 'warning',
      headline: 'Заявка не создана',
      statusLabel: 'Отправка недоступна',
      primaryText:
        mapSubmitReasonCode(submitReasonCode) ||
        submitMessage ||
        'Сейчас создать заявку нельзя.',
      secondaryText: null,
      summaryItems: [],
      referenceText: null,
      holdExpiresAtIso: null,
      holdDeadlineLabel: null,
      sellerContact: null,
      instructionSteps: Object.freeze([]),
      isSuccess: false,
    };
  }

  return {
    tone: 'neutral',
    headline: 'Статус заявки не определён',
    statusLabel: 'Нужна проверка',
    primaryText:
      submitMessage || 'Ответ сервера не совпал с известными статусами отправки.',
    secondaryText: null,
    summaryItems: [],
    referenceText: null,
    holdExpiresAtIso: null,
    holdDeadlineLabel: null,
    sellerContact: null,
    instructionSteps: Object.freeze([]),
    isSuccess: false,
  };
}
