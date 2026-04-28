const URGENCY_RANK = Object.freeze({
  normal: 0,
  urgent: 1,
  near_expiry: 2,
});

const REQUEST_STATUS_LABELS = Object.freeze({
  NEW: 'Новая',
  ATTRIBUTED: 'Назначена',
  CONTACT_IN_PROGRESS: 'В работе',
  HOLD_ACTIVE: 'Hold активен',
  WAITING_PREPAYMENT: 'Ожидает предоплату',
  PREPAYMENT_CONFIRMED: 'Предоплата принята',
  CONFIRMED_TO_PRESALE: 'Передана в бронь',
  SELLER_NOT_REACHED: 'Не дозвонились',
  HOLD_EXPIRED: 'Hold истек',
  GUEST_CANCELLED: 'Отменена',
  CLOSED_UNCONVERTED: 'Закрыта',
});

function normalizeAcknowledgedIds(input) {
  if (input instanceof Set) {
    return input;
  }
  if (Array.isArray(input)) {
    return new Set(input.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0));
  }
  if (input && typeof input === 'object') {
    return new Set(
      Object.entries(input)
        .filter(([, value]) => Boolean(value))
        .map(([key]) => Number(key))
        .filter((value) => Number.isInteger(value) && value > 0)
    );
  }
  return new Set();
}

export function resolveSellerTelegramUrgency(holdExpiresAtIso, nowMs = Date.now()) {
  const parsed = Date.parse(holdExpiresAtIso || '');
  if (Number.isNaN(parsed)) {
    return 'normal';
  }

  const remainingMs = parsed - nowMs;
  if (remainingMs <= 5 * 60 * 1000) {
    return 'near_expiry';
  }
  if (remainingMs <= 20 * 60 * 1000) {
    return 'urgent';
  }
  return 'normal';
}

export function resolveSellerTelegramRemainingMs(holdExpiresAtIso, nowMs = Date.now()) {
  const parsed = Date.parse(holdExpiresAtIso || '');
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed - nowMs;
}

export function formatSellerTelegramTimer(remainingMs) {
  if (remainingMs === null || remainingMs === undefined) {
    return 'Без таймера';
  }
  if (remainingMs <= 0) {
    return 'Истек';
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const minutesInHour = minutes % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutesInHour).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatSellerTelegramAmount(value) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
}

function normalizeItem(rawItem, nowMs) {
  const bookingRequest = rawItem?.booking_request || {};
  const bookingHold = rawItem?.booking_hold || {};
  const guestProfile = rawItem?.guest_profile || {};
  const holdExpiresAtIso = bookingHold?.hold_expires_at || null;
  const remainingMs = resolveSellerTelegramRemainingMs(holdExpiresAtIso, nowMs);
  const urgency = resolveSellerTelegramUrgency(holdExpiresAtIso, nowMs);

  return Object.freeze({
    bookingRequestId: Number(bookingRequest.booking_request_id || 0),
    requestStatus: String(bookingRequest.request_status || '').trim() || 'UNKNOWN',
    requestStatusLabel:
      REQUEST_STATUS_LABELS[String(bookingRequest.request_status || '').trim()] || 'Неизвестно',
    requestedTripDate: bookingRequest.requested_trip_date || null,
    requestedTimeSlot: bookingRequest.requested_time_slot || null,
    requestedSeats: Number(bookingRequest.requested_seats || 0),
    requestedPrepaymentAmount: Number(
      bookingHold.requested_amount ?? bookingRequest.requested_prepayment_amount ?? 0
    ),
    phone: bookingRequest.contact_phone_e164 || guestProfile.phone_e164 || null,
    guestName: guestProfile.display_name || guestProfile.username || 'Telegram гость',
    holdStatus: bookingHold.hold_status || null,
    holdExpiresAtIso,
    remainingMs,
    timerLabel: formatSellerTelegramTimer(remainingMs),
    urgency,
    availableActions: Array.isArray(rawItem?.available_actions) ? rawItem.available_actions : [],
    raw: rawItem,
  });
}

function selectNearestByTimer(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  return items
    .slice()
    .sort((left, right) => {
      const leftRemaining = left.remainingMs ?? Number.POSITIVE_INFINITY;
      const rightRemaining = right.remainingMs ?? Number.POSITIVE_INFINITY;
      if (leftRemaining !== rightRemaining) {
        return leftRemaining - rightRemaining;
      }
      return left.bookingRequestId - right.bookingRequestId;
    })[0];
}

export function buildSellerTelegramQueueModel(
  summary,
  { nowMs = Date.now(), acknowledgedRequestIds = new Set() } = {}
) {
  const acknowledgedIds = normalizeAcknowledgedIds(acknowledgedRequestIds);
  const sourceItems = Array.isArray(summary?.items) ? summary.items : [];
  const items = sourceItems
    .map((rawItem) => normalizeItem(rawItem, nowMs))
    .filter((item) => item.bookingRequestId > 0)
    .sort((left, right) => {
      const urgencyDiff = URGENCY_RANK[right.urgency] - URGENCY_RANK[left.urgency];
      if (urgencyDiff !== 0) {
        return urgencyDiff;
      }
      const leftRemaining = left.remainingMs ?? Number.POSITIVE_INFINITY;
      const rightRemaining = right.remainingMs ?? Number.POSITIVE_INFINITY;
      if (leftRemaining !== rightRemaining) {
        return leftRemaining - rightRemaining;
      }
      return left.bookingRequestId - right.bookingRequestId;
    });

  const unacknowledgedItems = items.filter(
    (item) => !acknowledgedIds.has(item.bookingRequestId)
  );
  const bannerItems = unacknowledgedItems;
  const bannerPrimaryItem = selectNearestByTimer(bannerItems);

  const bannerUrgency = bannerItems.reduce((current, item) => {
    return URGENCY_RANK[item.urgency] > URGENCY_RANK[current] ? item.urgency : current;
  }, 'normal');

  return Object.freeze({
    activeCount: items.length,
    hasRequests: items.length > 0,
    items,
    unacknowledgedItems,
    unacknowledgedCount: unacknowledgedItems.length,
    hasBanner: bannerItems.length > 0,
    bannerItems,
    bannerPrimaryItem,
    bannerUrgency,
    nearExpiryCount: items.filter((item) => item.urgency === 'near_expiry').length,
    urgentCount: items.filter((item) => item.urgency === 'urgent').length,
  });
}
