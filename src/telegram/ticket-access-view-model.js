function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeMoneyInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    return null;
  }
  return normalized;
}

function normalizeOptionalPositiveInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    return null;
  }
  return normalized;
}

export const MINI_APP_TICKET_RENDER_STATES = Object.freeze([
  'loading',
  'error',
  'ready_online',
  'ready_offline',
  'empty',
]);

export function resolveMiniAppTicketRenderState({
  loading = false,
  error = null,
  ticketView = null,
  offlineSnapshot = null,
} = {}) {
  if (loading) {
    return 'loading';
  }
  if (normalizeString(error)) {
    return 'error';
  }
  if (ticketView) {
    return 'ready_online';
  }
  if (offlineSnapshot) {
    return 'ready_offline';
  }
  return 'empty';
}

function resolveTicketStatusSummary({ ticketView = null, offlineSnapshot = null } = {}) {
  if (ticketView?.ticket_status_summary) {
    return ticketView.ticket_status_summary;
  }
  if (offlineSnapshot?.minimal_ticket_identity_summary) {
    return {
      deterministic_ticket_state:
        offlineSnapshot.minimal_ticket_identity_summary.deterministic_ticket_state || null,
      canonical_ticket_read_status:
        offlineSnapshot.minimal_ticket_identity_summary.canonical_ticket_read_status || null,
    };
  }
  return null;
}

function resolveDateTimeSummary({ ticketView = null, offlineSnapshot = null } = {}) {
  return (
    ticketView?.date_time_summary ??
    offlineSnapshot?.trip_date_time_summary ??
    null
  );
}

function resolveSeatsSummary({ ticketView = null, offlineSnapshot = null } = {}) {
  return (
    ticketView?.seats_count_summary ??
    offlineSnapshot?.seats_count_summary ??
    null
  );
}

function resolvePaymentSummary(ticketView = null) {
  const payment = ticketView?.payment_summary || null;
  if (!payment) {
    return null;
  }
  return {
    currency: normalizeString(payment.currency) || 'RUB',
    total_price: normalizeMoneyInteger(payment.total_price),
    prepayment_amount: normalizeMoneyInteger(payment.prepayment_amount),
    remaining_payment_amount: normalizeMoneyInteger(payment.remaining_payment_amount),
  };
}

function resolveContactSummary({ ticketView = null, offlineSnapshot = null } = {}) {
  return (
    ticketView?.contact_summary ??
    offlineSnapshot?.contact_summary ??
    null
  );
}

function resolveHoldStatusSummary({ ticketView = null, offlineSnapshot = null } = {}) {
  return (
    ticketView?.hold_status_summary ??
    offlineSnapshot?.hold_status_summary ??
    null
  );
}

function resolveSellerContactSummary({ ticketView = null, offlineSnapshot = null } = {}) {
  return (
    ticketView?.seller_contact_summary ??
    offlineSnapshot?.seller_contact_summary ??
    null
  );
}

function resolveBuyerTicketReferenceSummary({ ticketView = null, offlineSnapshot = null } = {}) {
  return (
    ticketView?.buyer_ticket_reference_summary ??
    offlineSnapshot?.buyer_ticket_reference_summary ??
    null
  );
}

function resolveBoardingQrPayloadSummary({ ticketView = null, offlineSnapshot = null } = {}) {
  return (
    ticketView?.boarding_qr_payload_summary ??
    offlineSnapshot?.boarding_qr_payload_summary ??
    null
  );
}

export function buildMiniAppTicketDetailViewModel({
  ticketView = null,
  offlineSnapshot = null,
  fallbackUsed = false,
  loading = false,
  error = null,
} = {}) {
  const renderState = resolveMiniAppTicketRenderState({
    loading,
    error,
    ticketView,
    offlineSnapshot,
  });

  const statusSummary = resolveTicketStatusSummary({ ticketView, offlineSnapshot });
  const dateTimeSummary = resolveDateTimeSummary({ ticketView, offlineSnapshot });
  const seatsSummary = resolveSeatsSummary({ ticketView, offlineSnapshot });
  const paymentSummary = resolvePaymentSummary(ticketView);
  const contactSummary = resolveContactSummary({ ticketView, offlineSnapshot });
  const holdStatusSummary = resolveHoldStatusSummary({ ticketView, offlineSnapshot });
  const sellerContactSummary = resolveSellerContactSummary({ ticketView, offlineSnapshot });
  const buyerTicketReferenceSummary = resolveBuyerTicketReferenceSummary({
    ticketView,
    offlineSnapshot,
  });
  const boardingQrPayloadSummary = resolveBoardingQrPayloadSummary({
    ticketView,
    offlineSnapshot,
  });

  const bookingRequestId =
    ticketView?.booking_request_reference?.booking_request_id ??
    offlineSnapshot?.booking_request_reference?.booking_request_id ??
    null;
  const status =
    statusSummary?.deterministic_ticket_state ||
    'no_ticket_yet';
  const availability =
    ticketView?.ticket_availability_state ??
    offlineSnapshot?.minimal_ticket_identity_summary?.ticket_availability_state ??
    null;
  const contactPhone = normalizeString(contactSummary?.preferred_contact_phone_e164);
  const sellerPhone = normalizeString(sellerContactSummary?.seller_phone_e164);
  const sellerName = normalizeString(sellerContactSummary?.seller_display_name);

  return Object.freeze({
    renderState,
    sourceMode: ticketView ? 'online_ticket' : offlineSnapshot ? 'offline_snapshot' : null,
    bookingRequestId,
    buyerTicketCode: normalizeString(buyerTicketReferenceSummary?.buyer_ticket_code),
    buyerTicketDisplayTitle: normalizeString(buyerTicketReferenceSummary?.display_title),
    status,
    availability,
    requestedTripDate: normalizeString(dateTimeSummary?.requested_trip_date),
    requestedTimeSlot: normalizeString(dateTimeSummary?.requested_time_slot),
    requestedSeats: normalizeOptionalPositiveInteger(seatsSummary?.requested_seats),
    linkedTicketCount: normalizeOptionalPositiveInteger(seatsSummary?.linked_ticket_count),
    paymentSummary,
    contactPhone,
    contactCallHref: contactPhone ? `tel:${contactPhone}` : null,
    sellerName,
    sellerPhone,
    sellerCallHref: sellerPhone ? `tel:${sellerPhone}` : null,
    holdStatus: normalizeString(holdStatusSummary?.hold_status),
    holdExpiresAtIso: normalizeString(holdStatusSummary?.hold_expires_at_summary?.iso),
    holdStartedAtIso: normalizeString(holdStatusSummary?.hold_started_at_summary?.iso),
    holdRequestedAmount: normalizeMoneyInteger(holdStatusSummary?.requested_amount),
    holdCurrency: normalizeString(holdStatusSummary?.currency) || null,
    boardingQrPayloadText: normalizeString(boardingQrPayloadSummary?.qr_payload_text),
    boardingQrPayloadFormat: normalizeString(boardingQrPayloadSummary?.payload_format),
    boardingQrCompatibilityTarget: normalizeString(
      boardingQrPayloadSummary?.compatibility_target
    ),
    offlineSnapshotStatus: normalizeString(offlineSnapshot?.offline_snapshot_status),
    offlineReferenceCode: normalizeString(
      offlineSnapshot?.offline_safe_code_reference_summary?.offline_reference_code
    ),
    hasBoardingQr: Boolean(normalizeString(boardingQrPayloadSummary?.qr_payload_text)),
    fallbackUsed: Boolean(fallbackUsed),
  });
}
