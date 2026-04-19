import { freezeTelegramHandoffValue } from './handoff-readiness.js';
import {
  deriveTelegramPresaleCustomerName,
  normalizeTelegramPresaleTicketMix,
} from './presale-handoff-adapter.js';
import { SELLER_SOURCE_FAMILIES } from './source-families.js';

export const TELEGRAM_BRIDGE_ADAPTER_DRY_RUN_CONTRACT_NAME =
  'telegram-bridge-adapter-dry-run-contract';
export const TELEGRAM_BRIDGE_ADAPTER_DRY_RUN_CONTRACT_VERSION =
  'telegram_bridge_adapter_dry_run_contract_v1';
export const TELEGRAM_BRIDGE_ADAPTER_DRY_RUN_STATUSES = Object.freeze([
  'dry_run_valid',
  'dry_run_blocked',
  'dry_run_manual_review',
]);

const ERROR_PREFIX = '[TELEGRAM_BRIDGE_ADAPTER_DRY_RUN_CONTRACT]';
const SLOT_UID_PATTERN = /^(manual|generated):\d+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function rejectDryRunContract(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveIntegerOrNull(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return null;
  }

  return normalized;
}

function buildIssue(code, message, details = {}) {
  return freezeTelegramHandoffValue({
    code,
    message,
    details,
  });
}

function normalizeSnapshotInput(input) {
  const handoffSnapshot =
    input?.handoff_snapshot && isPlainObject(input.handoff_snapshot)
      ? input.handoff_snapshot
      : input;

  if (!isPlainObject(handoffSnapshot)) {
    rejectDryRunContract('Frozen handoff snapshot is required');
  }
  if (
    handoffSnapshot.response_version &&
    handoffSnapshot.response_version !== 'telegram_handoff_snapshot.v1'
  ) {
    rejectDryRunContract(
      `Unsupported handoff snapshot version: ${handoffSnapshot.response_version}`
    );
  }
  if (
    handoffSnapshot.snapshot_type &&
    handoffSnapshot.snapshot_type !== 'telegram_presale_handoff_snapshot'
  ) {
    rejectDryRunContract(
      `Unsupported handoff snapshot type: ${handoffSnapshot.snapshot_type}`
    );
  }
  if (handoffSnapshot.booking_request_reference?.reference_type !== 'telegram_booking_request') {
    rejectDryRunContract('Frozen handoff snapshot must include a telegram booking request reference');
  }

  return freezeTelegramHandoffValue(handoffSnapshot);
}

function buildNormalizedBridgeInputSummary(handoffSnapshot) {
  const bookingRequestReference = handoffSnapshot.booking_request_reference;
  const guest = isPlainObject(handoffSnapshot.guest) ? handoffSnapshot.guest : {};
  const trip = isPlainObject(handoffSnapshot.trip) ? handoffSnapshot.trip : {};
  const payment = isPlainObject(handoffSnapshot.payment) ? handoffSnapshot.payment : {};
  const source = isPlainObject(handoffSnapshot.source) ? handoffSnapshot.source : {};
  const contactPhoneSummary = isPlainObject(handoffSnapshot.contact_phone_summary)
    ? handoffSnapshot.contact_phone_summary
    : {};
  const requestedTicketMix = normalizeTelegramPresaleTicketMix(
    trip.requested_ticket_mix || {}
  );
  const requestedPrepaymentAmount = Math.max(
    0,
    Number(payment.requested_prepayment_amount || 0)
  );
  const slotUid = normalizeString(trip.slot_uid);
  const sellerId = normalizePositiveIntegerOrNull(
    source.seller_id ?? handoffSnapshot.current_route_target?.seller_id ?? null
  );

  return freezeTelegramHandoffValue({
    bridge_contract_version: TELEGRAM_BRIDGE_ADAPTER_DRY_RUN_CONTRACT_VERSION,
    adapter_name: TELEGRAM_BRIDGE_ADAPTER_DRY_RUN_CONTRACT_NAME,
    dry_run_only: true,
    target_domain: 'existing_presale_domain',
    target_operation: 'create_presale',
    handoff_snapshot_version: handoffSnapshot.response_version || null,
    booking_request_reference: bookingRequestReference,
    resolution_summary: {
      slot_resolution_required:
        Boolean(trip.slot_resolution_required) || !slotUid,
      payment_method_selection_required: requestedPrepaymentAmount > 0,
      seller_resolution_required: sellerId === null,
      attribution_review_required:
        !SELLER_SOURCE_FAMILIES.includes(normalizeString(source.source_family)) ||
        normalizeString(source.source_ownership) !== 'seller' ||
        normalizeString(source.path_type) !== 'seller_attributed',
    },
    presale_create_request_summary: {
      slotUid,
      tripDate: normalizeString(trip.requested_trip_date),
      requestedTimeSlot: normalizeString(trip.requested_time_slot),
      customerName: deriveTelegramPresaleCustomerName({
        displayName: guest.display_name,
        username: guest.username,
        guestProfileId: bookingRequestReference.booking_request_id,
      }),
      customerPhone:
        normalizeString(guest.phone_e164) ||
        normalizeString(contactPhoneSummary.phone_e164),
      numberOfSeats: Number(trip.requested_seats || 0),
      tickets: requestedTicketMix.has_any_tickets ? requestedTicketMix.tickets : null,
      prepaymentAmount: requestedPrepaymentAmount,
      payment_method: null,
      cash_amount: 0,
      card_amount: 0,
      sellerId,
    },
    telegram_handoff_context: {
      booking_request_id: bookingRequestReference.booking_request_id,
      guest_profile_id: bookingRequestReference.guest_profile_id,
      seller_attribution_session_id:
        bookingRequestReference.seller_attribution_session_id,
      source_code: normalizeString(source.source_code),
      source_type: normalizeString(source.source_type),
      source_family: normalizeString(source.source_family),
      source_ownership: normalizeString(source.source_ownership),
      path_type: normalizeString(source.path_type),
      seller_id: sellerId,
    },
    no_op_guards: {
      production_presale_not_created: true,
      seat_reservation_not_applied: true,
      money_ledger_not_written: true,
      production_routes_not_invoked: true,
      production_bot_handlers_not_invoked: true,
    },
  });
}

export function analyzeTelegramBridgeAdapterDryRunContract(input) {
  const handoffSnapshot = normalizeSnapshotInput(input);
  const normalizedBridgeInputSummary =
    buildNormalizedBridgeInputSummary(handoffSnapshot);
  const request =
    normalizedBridgeInputSummary.presale_create_request_summary || {};
  const resolutionSummary = normalizedBridgeInputSummary.resolution_summary || {};
  const context = normalizedBridgeInputSummary.telegram_handoff_context || {};
  const requestedTicketMix = normalizeTelegramPresaleTicketMix(
    handoffSnapshot.trip?.requested_ticket_mix || {}
  );

  const blockingIssueList = [];
  const manualReviewIssueList = [];
  const warningIssueList = [];

  if (
    !request.tripDate ||
    !ISO_DATE_PATTERN.test(String(request.tripDate))
  ) {
    blockingIssueList.push(
      buildIssue(
        'INVALID_TRIP_DATE',
        'Frozen handoff snapshot must include a valid requested trip date',
        {
          trip_date: request.tripDate,
        }
      )
    );
  }

  if (request.slotUid && !SLOT_UID_PATTERN.test(String(request.slotUid))) {
    blockingIssueList.push(
      buildIssue(
        'INVALID_SLOT_UID',
        'Frozen handoff snapshot contains an invalid slotUid',
        {
          slotUid: request.slotUid,
        }
      )
    );
  }

  if (!request.customerPhone || String(request.customerPhone).length < 5) {
    blockingIssueList.push(
      buildIssue(
        'INVALID_CUSTOMER_PHONE',
        'Frozen handoff snapshot must include a usable customer phone',
        {
          customerPhone: request.customerPhone,
        }
      )
    );
  }

  if (!Number.isInteger(Number(request.numberOfSeats)) || Number(request.numberOfSeats) < 1) {
    blockingIssueList.push(
      buildIssue(
        'INVALID_SEAT_COUNT',
        'Frozen handoff snapshot must include a positive seat count',
        {
          numberOfSeats: request.numberOfSeats,
        }
      )
    );
  }

  if (requestedTicketMix.invalid_keys.length > 0) {
    blockingIssueList.push(
      buildIssue(
        'INVALID_TICKET_MIX',
        'Frozen handoff snapshot contains invalid ticket mix counts',
        {
          invalid_keys: requestedTicketMix.invalid_keys,
        }
      )
    );
  }

  if (requestedTicketMix.unsupported_positive_keys.length > 0) {
    blockingIssueList.push(
      buildIssue(
        'UNSUPPORTED_TICKET_MIX_KEYS',
        'Frozen handoff snapshot contains ticket types outside the current presale contract',
        {
          unsupported_positive_keys: requestedTicketMix.unsupported_positive_keys,
        }
      )
    );
  }

  if (
    requestedTicketMix.has_any_tickets &&
    requestedTicketMix.total_seats_from_tickets !== Number(request.numberOfSeats)
  ) {
    blockingIssueList.push(
      buildIssue(
        'TICKET_MIX_SEAT_MISMATCH',
        'Frozen handoff snapshot ticket mix seat total must match requested seats',
        {
          total_seats_from_tickets: requestedTicketMix.total_seats_from_tickets,
          numberOfSeats: request.numberOfSeats,
        }
      )
    );
  }

  if (resolutionSummary.slot_resolution_required) {
    manualReviewIssueList.push(
      buildIssue(
        'SLOT_RESOLUTION_REQUIRED',
        'Frozen handoff snapshot still requires slot resolution before a future bridge can consume it',
        {
          slotUid: request.slotUid,
        }
      )
    );
  }

  if (resolutionSummary.seller_resolution_required) {
    manualReviewIssueList.push(
      buildIssue(
        'SELLER_RESOLUTION_REQUIRED',
        'Frozen handoff snapshot still requires seller resolution before a future bridge can consume it',
        {
          seller_id: request.sellerId,
        }
      )
    );
  }

  if (resolutionSummary.attribution_review_required) {
    manualReviewIssueList.push(
      buildIssue(
        'NON_SELLER_ATTRIBUTION_REQUIRES_REVIEW',
        'Frozen handoff snapshot reflects non-seller attribution and requires manual review',
        {
          source_family: context.source_family,
          source_ownership: context.source_ownership,
          path_type: context.path_type,
        }
      )
    );
  }

  if (request.slotUid?.startsWith('manual:')) {
    warningIssueList.push(
      buildIssue(
        'MANUAL_SLOT_UID_RECHECK_RECOMMENDED',
        'Manual slotUid should be rechecked before any future real bridge execution',
        {
          slotUid: request.slotUid,
        }
      )
    );
  }

  if (request.prepaymentAmount > 0) {
    warningIssueList.push(
      buildIssue(
        'PAYMENT_METHOD_SELECTION_REQUIRED',
        'Future bridge execution will still require an explicit payment method selection',
        {
          prepayment_amount: request.prepaymentAmount,
        }
      )
    );
  }

  const adapterStatus =
    blockingIssueList.length > 0
      ? 'dry_run_blocked'
      : manualReviewIssueList.length > 0
        ? 'dry_run_manual_review'
        : 'dry_run_valid';
  const adapterValidationReason =
    blockingIssueList[0]?.message ||
    manualReviewIssueList[0]?.message ||
    (warningIssueList.length > 0
      ? 'Frozen handoff snapshot is valid for dry-run bridge normalization with warnings recorded'
      : 'Frozen handoff snapshot is valid for dry-run bridge normalization');
  const blockedReason = blockingIssueList[0]?.code || null;

  return freezeTelegramHandoffValue({
    adapter_status: adapterStatus,
    normalized_bridge_input_summary: normalizedBridgeInputSummary,
    adapter_validation_reason: adapterValidationReason,
    blocked_reason: blockedReason,
    warning_list: [...manualReviewIssueList, ...warningIssueList],
    blocking_issue_list: blockingIssueList,
    manual_review_issue_list: manualReviewIssueList,
    non_blocking_warning_list: warningIssueList,
  });
}

export function buildTelegramBridgeAdapterDryRunContractResult(input) {
  const handoffSnapshot = normalizeSnapshotInput(input);
  const analysis = analyzeTelegramBridgeAdapterDryRunContract(handoffSnapshot);

  return freezeTelegramHandoffValue({
    adapter_name: TELEGRAM_BRIDGE_ADAPTER_DRY_RUN_CONTRACT_NAME,
    adapter_version: TELEGRAM_BRIDGE_ADAPTER_DRY_RUN_CONTRACT_VERSION,
    dry_run: true,
    booking_request_reference: handoffSnapshot.booking_request_reference,
    adapter_status: analysis.adapter_status,
    normalized_bridge_input_summary: analysis.normalized_bridge_input_summary,
    adapter_validation_reason: analysis.adapter_validation_reason,
    blocked_reason: analysis.blocked_reason,
    warning_list: analysis.warning_list,
    no_op: {
      production_presale_created: false,
      production_seats_reserved: false,
      money_ledger_written: false,
      production_routes_invoked: false,
      production_bot_handlers_invoked: false,
    },
  });
}
