import {
  freezeTelegramHandoffValue,
  isTelegramPresaleHandoffConsumableExecutionState,
} from '../../../shared/telegram/index.js';
import { createPresaleFromPreparedInput } from '../adapters/production-presale-create-bridge.mjs';

const TELEGRAM_PRODUCTION_PRESALE_ADAPTER_NAME =
  'telegram-production-presale-handoff-adapter';
const TELEGRAM_PRODUCTION_PRESALE_ADAPTER_VERSION =
  'telegram_production_presale_handoff_adapter_v1';

const BLOCKED_ERROR_CODES = new Set([
  'SLOT_UID_REQUIRED',
  'SLOT_UID_INVALID',
  'SLOT_RESOLUTION_ERROR',
  'SLOT_DATE_MISMATCH',
  'SLOT_NOT_FOUND',
  'TRIP_CLOSED_BY_TIME',
  'SALES_CLOSED',
  'INVALID_TICKET_BREAKDOWN',
  'SEAT_CAPACITY_EXCEEDED',
  'NO_SEATS',
  'CAPACITY_EXCEEDED',
  'PREPAYMENT_EXCEEDS_TOTAL',
  'INVALID_SELLER_ID',
  'SELLER_NOT_FOUND',
  'SHIFT_CLOSED',
]);

function buildAdapterResult({
  outcome,
  outcomeCode,
  message,
  confirmedPresaleId = null,
  payload = null,
} = {}) {
  return freezeTelegramHandoffValue({
    adapter_name: TELEGRAM_PRODUCTION_PRESALE_ADAPTER_NAME,
    adapter_version: TELEGRAM_PRODUCTION_PRESALE_ADAPTER_VERSION,
    outcome,
    outcome_code: outcomeCode,
    message,
    confirmed_presale_id: confirmedPresaleId,
    payload,
  });
}

function getBlockedOutcomeCode(error) {
  if (error?.code === 'SHIFT_CLOSED') {
    return error?.code;
  }

  if (BLOCKED_ERROR_CODES.has(error?.code)) {
    return error.code;
  }

  if (error?.message === 'CAPACITY_EXCEEDED') {
    return 'CAPACITY_EXCEEDED';
  }

  return null;
}

export class TelegramProductionPresaleHandoffAdapterService {
  constructor({
    bookingRequests,
    executePresaleCreateInDomain = createPresaleFromPreparedInput,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.executePresaleCreateInDomain = executePresaleCreateInDomain;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'production-presale-handoff-adapter-service',
      status: 'bridge_ready',
      dependencyKeys: ['bookingRequests'],
    });
  }

  nowIso() {
    return this.now().toISOString();
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      throw new Error(
        `[TELEGRAM_PRODUCTION_PRESALE_ADAPTER] Booking request not found: ${bookingRequestId}`
      );
    }

    return bookingRequest;
  }

  execute({
    bookingRequestId,
    executionSnapshot,
    guardDecision,
    bridgeInput,
  } = {}) {
    const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);

    if (guardDecision?.decision !== 'eligible') {
      return buildAdapterResult({
        outcome: 'blocked',
        outcomeCode: guardDecision?.decision_code || 'GUARD_NOT_ELIGIBLE',
        message:
          guardDecision?.message ||
          'Pre-execution guard did not approve production presale bridge execution',
        payload: {
          guard_decision: guardDecision,
        },
      });
    }

    if (
      !isTelegramPresaleHandoffConsumableExecutionState(
        executionSnapshot?.current_execution_state || null
      )
    ) {
      return buildAdapterResult({
        outcome: 'blocked',
        outcomeCode: 'EXECUTION_STATE_NOT_CONSUMABLE',
        message:
          'Execution snapshot is not consumable for production presale bridge execution',
        payload: {
          current_execution_state: executionSnapshot?.current_execution_state || null,
        },
      });
    }

    if (bookingRequest.confirmed_presale_id) {
      return buildAdapterResult({
        outcome: 'success',
        outcomeCode: 'PRESALE_ALREADY_LINKED',
        message: 'Booking request is already linked to a canonical presale',
        confirmedPresaleId: bookingRequest.confirmed_presale_id,
        payload: {
          booking_request_id: bookingRequestId,
          linked_reuse: true,
        },
      });
    }

    const presaleRequest = bridgeInput?.presale_create_request || {};
    const telegramContext = bridgeInput?.telegram_handoff_context || {};
    const sellerId =
      Number(telegramContext.seller_id ?? presaleRequest.sellerId ?? 0) || null;

    try {
      const createResult = this.executePresaleCreateInDomain({
        slotUid: presaleRequest.slotUid || null,
        tripDate: presaleRequest.tripDate || null,
        customerName: presaleRequest.customerName || '',
        customerPhone: presaleRequest.customerPhone || '',
        seats: Number(presaleRequest.numberOfSeats || 0),
        ticketsJson: presaleRequest.tickets ? JSON.stringify(presaleRequest.tickets) : null,
        prepayment: Number(presaleRequest.prepaymentAmount || 0),
        prepaymentComment: null,
        sellerId,
        actorRole: 'seller',
        actorUserId: sellerId,
        paymentMethodUpper: presaleRequest.payment_method || null,
        paymentCashAmount: Number(presaleRequest.cash_amount || 0),
        paymentCardAmount: Number(presaleRequest.card_amount || 0),
        latAtSale: null,
        lngAtSale: null,
        zoneAtSale: null,
      });

      this.bookingRequests.updateById(bookingRequestId, {
        confirmed_presale_id: createResult.presaleId,
        request_status: 'CONFIRMED_TO_PRESALE',
        last_status_at: this.nowIso(),
      });

      return buildAdapterResult({
        outcome: 'success',
        outcomeCode: 'PRESALE_CREATED',
        message: 'Canonical presale created through the existing presale domain bridge',
        confirmedPresaleId: createResult.presaleId,
        payload: {
          booking_request_id: bookingRequestId,
          effective_seller_id: createResult.effectiveSellerId || null,
          presale: createResult.presale,
          slot: createResult.slot,
        },
      });
    } catch (error) {
      const blockedOutcomeCode = getBlockedOutcomeCode(error);
      if (blockedOutcomeCode) {
        return buildAdapterResult({
          outcome: 'blocked',
          outcomeCode: blockedOutcomeCode,
          message:
            error?.message ||
            'Production presale bridge was blocked by current domain constraints',
          payload: {
            details: error?.details || null,
            payload: error?.payload || null,
          },
        });
      }

      return buildAdapterResult({
        outcome: 'failure',
        outcomeCode: error?.code || 'PRESALE_CREATE_FAILED',
        message:
          error?.message ||
          'Production presale bridge failed unexpectedly while creating a presale',
        payload: {
          error_name: error?.name || null,
          details: error?.details || null,
        },
      });
    }
  }
}

export {
  TELEGRAM_PRODUCTION_PRESALE_ADAPTER_NAME,
  TELEGRAM_PRODUCTION_PRESALE_ADAPTER_VERSION,
};
