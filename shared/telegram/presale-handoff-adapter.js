import { freezeTelegramHandoffValue } from './handoff-readiness.js';

export const TELEGRAM_PRESALE_HANDOFF_ADAPTER_NAME = 'telegram-presale-handoff-adapter';
export const TELEGRAM_PRESALE_HANDOFF_ADAPTER_VERSION =
  'telegram_presale_handoff_adapter_v1';
export const TELEGRAM_PRESALE_HANDOFF_ADAPTER_OUTCOMES = Object.freeze([
  'success',
  'blocked',
  'failure',
]);
export const TELEGRAM_PRESALE_HANDOFF_CONSUMABLE_EXECUTION_STATES = Object.freeze([
  'handoff_started',
  'handoff_consumed',
]);

const SUPPORTED_TICKET_KEYS = Object.freeze(['adult', 'teen', 'child']);

function normalizeNonNegativeInteger(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    return null;
  }

  return normalized;
}

export function isTelegramPresaleHandoffConsumableExecutionState(executionState) {
  return TELEGRAM_PRESALE_HANDOFF_CONSUMABLE_EXECUTION_STATES.includes(executionState);
}

export function deriveTelegramPresaleCustomerName({
  displayName,
  username,
  guestProfileId,
}) {
  const trimmedDisplayName = String(displayName || '').trim();
  if (trimmedDisplayName) {
    return trimmedDisplayName;
  }

  const trimmedUsername = String(username || '').trim();
  if (trimmedUsername) {
    return trimmedUsername.startsWith('@') ? trimmedUsername : `@${trimmedUsername}`;
  }

  return `Telegram Guest ${guestProfileId}`;
}

export function normalizeTelegramPresaleTicketMix(requestedTicketMix = {}) {
  const input = requestedTicketMix && typeof requestedTicketMix === 'object'
    ? requestedTicketMix
    : {};
  const invalidKeys = [];
  const unsupportedPositiveKeys = [];
  const tickets = {};

  for (const key of SUPPORTED_TICKET_KEYS) {
    const normalizedCount = normalizeNonNegativeInteger(input[key] ?? 0);
    if (normalizedCount === null) {
      invalidKeys.push(key);
      tickets[key] = 0;
    } else {
      tickets[key] = normalizedCount;
    }
  }

  for (const key of Object.keys(input)) {
    if (SUPPORTED_TICKET_KEYS.includes(key)) {
      continue;
    }

    const rawValue = Number(input[key] || 0);
    if (Number.isFinite(rawValue) && rawValue > 0) {
      unsupportedPositiveKeys.push(key);
    }
  }

  const totalSeatsFromTickets = tickets.adult + tickets.teen + tickets.child;

  return freezeTelegramHandoffValue({
    tickets,
    invalid_keys: invalidKeys,
    unsupported_positive_keys: unsupportedPositiveKeys,
    total_seats_from_tickets: totalSeatsFromTickets,
    has_any_tickets: totalSeatsFromTickets > 0,
  });
}

export function normalizeTelegramPresalePaymentSelection({
  prepaymentAmount = 0,
  paymentMethod = null,
  cashAmount = null,
  cardAmount = null,
} = {}) {
  const normalizedPrepaymentAmount = Math.max(0, Number(prepaymentAmount || 0));
  const rawMethod = paymentMethod ? String(paymentMethod).trim().toUpperCase() : null;
  const normalizedPaymentMethod = normalizedPrepaymentAmount > 0
    ? rawMethod === 'CASHLESS'
      ? 'CARD'
      : rawMethod || 'CASH'
    : null;

  const normalizedCashAmount =
    normalizedPaymentMethod === 'CASH'
      ? normalizedPrepaymentAmount
      : Number(cashAmount ?? 0);
  const normalizedCardAmount =
    normalizedPaymentMethod === 'CARD'
      ? normalizedPrepaymentAmount
      : Number(cardAmount ?? 0);

  return freezeTelegramHandoffValue({
    prepayment_amount: normalizedPrepaymentAmount,
    payment_method: normalizedPaymentMethod,
    cash_amount: Number.isFinite(normalizedCashAmount) ? normalizedCashAmount : null,
    card_amount: Number.isFinite(normalizedCardAmount) ? normalizedCardAmount : null,
  });
}

export function buildTelegramPresaleHandoffBridgeInput({
  executionSnapshot,
  resolvedSlotUid = null,
  paymentMethod = null,
  cashAmount = null,
  cardAmount = null,
} = {}) {
  const snapshotPayload = executionSnapshot?.snapshot_payload || {};
  const guest = snapshotPayload.guest || {};
  const trip = snapshotPayload.trip || {};
  const payment = snapshotPayload.payment || {};
  const source = snapshotPayload.source || {};
  const ticketMix = normalizeTelegramPresaleTicketMix(trip.requested_ticket_mix || {});
  const paymentSelection = normalizeTelegramPresalePaymentSelection({
    prepaymentAmount: payment.requested_prepayment_amount || 0,
    paymentMethod,
    cashAmount,
    cardAmount,
  });

  return freezeTelegramHandoffValue({
    bridge_contract_version: TELEGRAM_PRESALE_HANDOFF_ADAPTER_VERSION,
    adapter_name: TELEGRAM_PRESALE_HANDOFF_ADAPTER_NAME,
    dry_run_only: true,
    target_domain: 'existing_presale_domain',
    target_operation: 'create_presale',
    target_route_hint: 'POST /api/selling/presales',
    presale_create_request: {
      slotUid: resolvedSlotUid ?? trip.slot_uid ?? null,
      tripDate: trip.requested_trip_date || null,
      customerName: deriveTelegramPresaleCustomerName({
        displayName: guest.display_name,
        username: guest.username,
        guestProfileId: executionSnapshot?.guest_profile_id,
      }),
      customerPhone: guest.phone_e164 || null,
      numberOfSeats: Number(trip.requested_seats || 0),
      tickets: ticketMix.has_any_tickets ? ticketMix.tickets : null,
      prepaymentAmount: paymentSelection.prepayment_amount,
      payment_method: paymentSelection.payment_method,
      cash_amount: paymentSelection.cash_amount,
      card_amount: paymentSelection.card_amount,
      sellerId: source.seller_id ?? null,
    },
    telegram_handoff_context: {
      booking_request_id: executionSnapshot?.booking_request_id ?? null,
      guest_profile_id: executionSnapshot?.guest_profile_id ?? null,
      seller_attribution_session_id: executionSnapshot?.seller_attribution_session_id ?? null,
      handoff_prepared_event_id: executionSnapshot?.handoff_prepared_event_id ?? null,
      current_execution_state: executionSnapshot?.current_execution_state ?? null,
      source_code: executionSnapshot?.attribution_context?.source_code ?? null,
      source_type: executionSnapshot?.attribution_context?.source_type ?? null,
      source_family: executionSnapshot?.attribution_context?.source_family ?? null,
      seller_id: executionSnapshot?.attribution_context?.seller_id ?? null,
    },
    no_op_guards: {
      production_presale_not_created: true,
      seat_reservation_not_applied: true,
      money_ledger_not_written: true,
    },
  });
}

export function buildTelegramPresaleHandoffAdapterResult({
  outcome,
  outcomeCode,
  message,
  executionSnapshot,
  bridgeInput = null,
  blockers = [],
  failures = [],
  warnings = [],
} = {}) {
  return freezeTelegramHandoffValue({
    adapter_name: TELEGRAM_PRESALE_HANDOFF_ADAPTER_NAME,
    adapter_version: TELEGRAM_PRESALE_HANDOFF_ADAPTER_VERSION,
    dry_run: true,
    outcome,
    outcome_code: outcomeCode,
    message,
    booking_request_id: executionSnapshot?.booking_request_id ?? null,
    current_execution_state: executionSnapshot?.current_execution_state ?? null,
    handoff_consumable: isTelegramPresaleHandoffConsumableExecutionState(
      executionSnapshot?.current_execution_state || null
    ),
    bridge_input: bridgeInput,
    validation: {
      ready: outcome === 'success',
      blockers,
      failures,
      warnings,
    },
    no_op: {
      production_presale_created: false,
      production_seats_reserved: false,
      money_ledger_written: false,
      production_routes_invoked: false,
      production_bot_handlers_invoked: false,
    },
  });
}
