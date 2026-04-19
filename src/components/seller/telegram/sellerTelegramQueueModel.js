const URGENCY_RANK = Object.freeze({
  normal: 0,
  urgent: 1,
  near_expiry: 2,
});

const REQUEST_STATUS_LABELS = Object.freeze({
  NEW: 'New',
  ATTRIBUTED: 'Attributed',
  CONTACT_IN_PROGRESS: 'Contact in progress',
  HOLD_ACTIVE: 'Hold active',
  WAITING_PREPAYMENT: 'Waiting prepayment',
  PREPAYMENT_CONFIRMED: 'Prepayment confirmed',
  CONFIRMED_TO_PRESALE: 'Confirmed to presale',
  SELLER_NOT_REACHED: 'Not reached',
  HOLD_EXPIRED: 'Hold expired',
  GUEST_CANCELLED: 'Cancelled by guest',
  CLOSED_UNCONVERTED: 'Closed',
});

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
    return 'No timer';
  }
  if (remainingMs <= 0) {
    return 'Expired';
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
      REQUEST_STATUS_LABELS[String(bookingRequest.request_status || '').trim()] || 'Unknown',
    requestedTripDate: bookingRequest.requested_trip_date || null,
    requestedTimeSlot: bookingRequest.requested_time_slot || null,
    requestedSeats: Number(bookingRequest.requested_seats || 0),
    requestedPrepaymentAmount: Number(
      bookingHold.requested_amount ?? bookingRequest.requested_prepayment_amount ?? 0
    ),
    phone:
      bookingRequest.contact_phone_e164 || guestProfile.phone_e164 || null,
    guestName: guestProfile.display_name || guestProfile.username || 'Telegram guest',
    holdStatus: bookingHold.hold_status || null,
    holdExpiresAtIso,
    remainingMs,
    timerLabel: formatSellerTelegramTimer(remainingMs),
    urgency,
    availableActions: Array.isArray(rawItem?.available_actions)
      ? rawItem.available_actions
      : [],
    raw: rawItem,
  });
}

export function buildSellerTelegramQueueModel(summary, { nowMs = Date.now() } = {}) {
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

  const bannerUrgency = items.reduce((current, item) => {
    return URGENCY_RANK[item.urgency] > URGENCY_RANK[current] ? item.urgency : current;
  }, 'normal');

  return Object.freeze({
    activeCount: items.length,
    bannerUrgency,
    hasRequests: items.length > 0,
    nearExpiryCount: items.filter((item) => item.urgency === 'near_expiry').length,
    urgentCount: items.filter((item) => item.urgency === 'urgent').length,
    items,
  });
}
