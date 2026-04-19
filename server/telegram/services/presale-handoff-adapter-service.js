import {
  buildTelegramPresaleHandoffAdapterResult,
  buildTelegramPresaleHandoffBridgeInput,
  freezeTelegramHandoffValue,
  isTelegramPresaleHandoffConsumableExecutionState,
  normalizeTelegramPresalePaymentSelection,
  normalizeTelegramPresaleTicketMix,
} from '../../../shared/telegram/index.js';

const SLOT_UID_PATTERN = /^(manual|generated):\d+$/;
const SUPPORTED_PAYMENT_METHODS = new Set(['CASH', 'CARD', 'MIXED']);

function asIssue(code, message, details = {}) {
  return freezeTelegramHandoffValue({
    code,
    message,
    details,
  });
}

export class TelegramPresaleHandoffAdapterService {
  constructor({
    handoffExecutionQueryService,
  }) {
    this.handoffExecutionQueryService = handoffExecutionQueryService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'presale-handoff-adapter-service',
      status: 'dry_run_ready',
      dependencyKeys: ['handoffExecutionQueryService'],
    });
  }

  readExecutionSnapshot(bookingRequestId) {
    return this.handoffExecutionQueryService.readExecutionState(bookingRequestId);
  }

  buildBridgeInput(
    bookingRequestId,
    {
      slotUid = null,
      paymentMethod = null,
      cashAmount = null,
      cardAmount = null,
    } = {}
  ) {
    const executionSnapshot = this.readExecutionSnapshot(bookingRequestId);

    return buildTelegramPresaleHandoffBridgeInput({
      executionSnapshot,
      resolvedSlotUid: slotUid,
      paymentMethod,
      cashAmount,
      cardAmount,
    });
  }

  validateDryRun(
    bookingRequestId,
    {
      slotUid = null,
      paymentMethod = null,
      cashAmount = null,
      cardAmount = null,
    } = {}
  ) {
    let executionSnapshot;
    let bridgeInput;

    try {
      executionSnapshot = this.readExecutionSnapshot(bookingRequestId);
      bridgeInput = buildTelegramPresaleHandoffBridgeInput({
        executionSnapshot,
        resolvedSlotUid: slotUid,
        paymentMethod,
        cashAmount,
        cardAmount,
      });
    } catch (error) {
      return buildTelegramPresaleHandoffAdapterResult({
        outcome: 'failure',
        outcomeCode: 'ADAPTER_BUILD_FAILED',
        message: error?.message || 'Telegram handoff adapter build failed',
        executionSnapshot: executionSnapshot || null,
        bridgeInput: bridgeInput || null,
        failures: [
          asIssue(
            'ADAPTER_BUILD_FAILED',
            error?.message || 'Telegram handoff adapter build failed'
          ),
        ],
      });
    }

    const blockers = [];
    const failures = [];
    const warnings = [];
    const request = bridgeInput.presale_create_request;
    const ticketMix = normalizeTelegramPresaleTicketMix(
      executionSnapshot.snapshot_payload?.trip?.requested_ticket_mix || {}
    );
    const paymentSelection = normalizeTelegramPresalePaymentSelection({
      prepaymentAmount: executionSnapshot.snapshot_payload?.payment?.requested_prepayment_amount || 0,
      paymentMethod,
      cashAmount,
      cardAmount,
    });

    if (!isTelegramPresaleHandoffConsumableExecutionState(executionSnapshot.current_execution_state)) {
      blockers.push(
        asIssue(
          'EXECUTION_STATE_NOT_CONSUMABLE',
          'Execution snapshot is not yet consumable by the presale handoff adapter',
          {
            current_execution_state: executionSnapshot.current_execution_state,
          }
        )
      );
    }

    if (!request.slotUid) {
      blockers.push(
        asIssue(
          'SLOT_UID_REQUIRED',
          'slotUid resolution is required before the future presale domain can consume this bridge input'
        )
      );
    } else if (!SLOT_UID_PATTERN.test(String(request.slotUid))) {
      failures.push(
        asIssue(
          'INVALID_SLOT_UID',
          'slotUid must match manual:<id> or generated:<id>',
          {
            slotUid: request.slotUid,
          }
        )
      );
    }

    if (!request.customerName || String(request.customerName).trim().length < 2) {
      failures.push(
        asIssue(
          'INVALID_CUSTOMER_NAME',
          'Derived customerName must contain at least 2 characters',
          {
            customerName: request.customerName,
          }
        )
      );
    }

    if (!request.customerPhone || String(request.customerPhone).trim().length < 5) {
      failures.push(
        asIssue(
          'INVALID_CUSTOMER_PHONE',
          'Derived customerPhone must contain at least 5 characters',
          {
            customerPhone: request.customerPhone,
          }
        )
      );
    }

    if (!Number.isInteger(Number(request.numberOfSeats)) || Number(request.numberOfSeats) < 1) {
      failures.push(
        asIssue(
          'INVALID_SEAT_COUNT',
          'numberOfSeats must be an integer greater than zero',
          {
            numberOfSeats: request.numberOfSeats,
          }
        )
      );
    }

    if (ticketMix.invalid_keys.length > 0) {
      failures.push(
        asIssue(
          'INVALID_TICKET_MIX',
          'Requested ticket mix contains invalid counts',
          {
            invalid_keys: ticketMix.invalid_keys,
          }
        )
      );
    }

    if (ticketMix.unsupported_positive_keys.length > 0) {
      failures.push(
        asIssue(
          'UNSUPPORTED_TICKET_MIX_KEYS',
          'Requested ticket mix contains ticket types that the current presale contract cannot accept',
          {
            unsupported_positive_keys: ticketMix.unsupported_positive_keys,
          }
        )
      );
    }

    if (
      ticketMix.has_any_tickets &&
      ticketMix.total_seats_from_tickets !== Number(request.numberOfSeats)
    ) {
      failures.push(
        asIssue(
          'TICKET_MIX_SEAT_MISMATCH',
          'Ticket mix seat total must match numberOfSeats',
          {
            total_seats_from_tickets: ticketMix.total_seats_from_tickets,
            numberOfSeats: request.numberOfSeats,
          }
        )
      );
    }

    if (
      paymentSelection.payment_method &&
      !SUPPORTED_PAYMENT_METHODS.has(paymentSelection.payment_method)
    ) {
      failures.push(
        asIssue(
          'INVALID_PAYMENT_METHOD',
          'payment_method must be CASH, CARD, or MIXED',
          {
            payment_method: paymentSelection.payment_method,
          }
        )
      );
    }

    if (paymentSelection.prepayment_amount === 0 && request.payment_method) {
      warnings.push(
        asIssue(
          'PAYMENT_METHOD_IGNORED_WITH_ZERO_PREPAYMENT',
          'payment_method is ignored when prepaymentAmount is zero'
        )
      );
    }

    if (paymentSelection.payment_method === 'MIXED') {
      const cash = Number(paymentSelection.cash_amount);
      const card = Number(paymentSelection.card_amount);
      if (!Number.isFinite(cash) || !Number.isFinite(card) || cash < 0 || card < 0) {
        failures.push(
          asIssue(
            'INVALID_PAYMENT_SPLIT',
            'cash_amount and card_amount must be non-negative numbers for MIXED payment',
            {
              cash_amount: paymentSelection.cash_amount,
              card_amount: paymentSelection.card_amount,
            }
          )
        );
      } else if (Math.round(cash + card) !== Math.round(paymentSelection.prepayment_amount)) {
        failures.push(
          asIssue(
            'INVALID_PAYMENT_SPLIT',
            'cash_amount and card_amount must sum to prepaymentAmount for MIXED payment',
            {
              cash_amount: cash,
              card_amount: card,
              prepayment_amount: paymentSelection.prepayment_amount,
            }
          )
        );
      } else if (cash === 0 || card === 0) {
        failures.push(
          asIssue(
            'INVALID_PAYMENT_SPLIT',
            'MIXED payment requires positive amounts for both cash and card',
            {
              cash_amount: cash,
              card_amount: card,
            }
          )
        );
      }
    }

    const outcome =
      failures.length > 0 ? 'failure' : blockers.length > 0 ? 'blocked' : 'success';
    const outcomeCode =
      failures.length > 0
        ? failures[0].code
        : blockers.length > 0
          ? blockers[0].code
          : 'DRY_RUN_READY';
    const message =
      outcome === 'success'
        ? 'Dry-run adapter validation succeeded without invoking production presale flows'
        : outcome === 'blocked'
          ? blockers[0].message
          : failures[0].message;

    return buildTelegramPresaleHandoffAdapterResult({
      outcome,
      outcomeCode,
      message,
      executionSnapshot,
      bridgeInput,
      blockers,
      failures,
      warnings,
    });
  }
}
