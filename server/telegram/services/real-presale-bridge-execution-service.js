import {
  buildTelegramBridgeReason,
  buildTelegramCanonicalPresaleReference,
  buildTelegramRealPresaleBridgeExecutionResult,
} from '../../../shared/telegram/index.js';

const ERROR_PREFIX = '[TELEGRAM_REAL_PRESALE_BRIDGE_EXECUTION]';

function buildBlockedResult({
  bookingRequestReference,
  handoffSnapshotReference,
  code,
  message,
  executionTimestampIso,
  guardDecision = null,
  bridgeInput = null,
  adapterResult = null,
  details = null,
}) {
  return buildTelegramRealPresaleBridgeExecutionResult({
    bookingRequestReference,
    handoffSnapshotReference,
    bridgeExecutionStatus: 'bridge_blocked',
    bridgeExecutionCode: code,
    bridgeExecutionMessage: message,
    blockedReason: buildTelegramBridgeReason({
      code,
      message,
      details,
    }),
    executionTimestampIso,
    guardDecision,
    bridgeInput,
    adapterResult,
  });
}

function buildFailureResult({
  bookingRequestReference,
  handoffSnapshotReference,
  code,
  message,
  executionTimestampIso,
  guardDecision = null,
  bridgeInput = null,
  adapterResult = null,
  details = null,
}) {
  return buildTelegramRealPresaleBridgeExecutionResult({
    bookingRequestReference,
    handoffSnapshotReference,
    bridgeExecutionStatus: 'bridge_failed',
    bridgeExecutionCode: code,
    bridgeExecutionMessage: message,
    failureReason: buildTelegramBridgeReason({
      code,
      message,
      details,
    }),
    executionTimestampIso,
    guardDecision,
    bridgeInput,
    adapterResult,
  });
}

function buildSuccessResult({
  bookingRequestReference,
  handoffSnapshotReference,
  presaleId,
  code,
  message,
  executionTimestampIso,
  guardDecision = null,
  bridgeInput = null,
  adapterResult = null,
}) {
  return buildTelegramRealPresaleBridgeExecutionResult({
    bookingRequestReference,
    handoffSnapshotReference,
    bridgeExecutionStatus: 'presale_created',
    bridgeExecutionCode: code,
    bridgeExecutionMessage: message,
    createdPresaleReference: buildTelegramCanonicalPresaleReference(presaleId),
    executionTimestampIso,
    guardDecision,
    bridgeInput,
    adapterResult,
  });
}

function toRequestInput({
  slotUid = null,
  paymentMethod = null,
  cashAmount = null,
  cardAmount = null,
} = {}) {
  return {
    slotUid,
    paymentMethod,
    cashAmount,
    cardAmount,
  };
}

export class TelegramRealPresaleBridgeExecutionService {
  constructor({
    bookingRequests,
    handoffReadinessQueryService,
    handoffExecutionQueryService,
    realHandoffPreExecutionGuardService,
    productionPresaleHandoffAdapterService,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.handoffReadinessQueryService = handoffReadinessQueryService;
    this.handoffExecutionQueryService = handoffExecutionQueryService;
    this.realHandoffPreExecutionGuardService = realHandoffPreExecutionGuardService;
    this.productionPresaleHandoffAdapterService =
      productionPresaleHandoffAdapterService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'real-presale-bridge-execution-service',
      status: 'bridge_execution_ready',
      dependencyKeys: [
        'bookingRequests',
        'handoffReadinessQueryService',
        'handoffExecutionQueryService',
        'realHandoffPreExecutionGuardService',
        'productionPresaleHandoffAdapterService',
      ],
    });
  }

  nowIso() {
    return this.now().toISOString();
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      throw new Error(
        `${ERROR_PREFIX} Booking request not found: ${bookingRequestId}`
      );
    }

    return bookingRequest;
  }

  readPreparedReadiness(bookingRequestId) {
    try {
      return this.handoffReadinessQueryService.readPreparedRequest({
        booking_request_reference: {
          reference_type: 'telegram_booking_request',
          booking_request_id: bookingRequestId,
        },
      });
    } catch (error) {
      const message = String(error?.message || '');
      if (
        message.includes('not handoff-prepared') ||
        message.includes('not prepayment') ||
        message.includes('Invalid booking request reference') ||
        message.includes('not projectable')
      ) {
        return null;
      }

      throw error;
    }
  }

  execute(
    bookingRequestId,
    {
      slotUid = null,
      paymentMethod = null,
      cashAmount = null,
      cardAmount = null,
    } = {}
  ) {
    const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
    const preparedReadiness = this.readPreparedReadiness(bookingRequestId);
    const executionSnapshot = preparedReadiness
      ? this.handoffExecutionQueryService.readExecutionState(bookingRequestId)
      : null;
    const bookingRequestReference =
      preparedReadiness?.booking_request_reference ||
      executionSnapshot?.booking_request_reference ||
      null;
    const handoffSnapshotReference =
      preparedReadiness?.handoff_snapshot_reference ||
      executionSnapshot?.handoff_snapshot_reference ||
      null;
    const executionTimestampIso = this.nowIso();

    if (bookingRequest.confirmed_presale_id && preparedReadiness) {
      return buildSuccessResult({
        bookingRequestReference,
        handoffSnapshotReference,
        presaleId: bookingRequest.confirmed_presale_id,
        code: 'PRESALE_ALREADY_LINKED',
        message: 'Booking request is already linked to a canonical presale',
        executionTimestampIso,
      });
    }

    if (!preparedReadiness) {
      return buildBlockedResult({
        bookingRequestReference,
        handoffSnapshotReference,
        code: 'HANDOFF_NOT_PREPARED',
        message:
          'Booking request must remain prepayment_confirmed and handoff_prepared before bridge execution',
        executionTimestampIso,
      });
    }

    if (preparedReadiness.lifecycle_state !== 'prepayment_confirmed') {
      return buildBlockedResult({
        bookingRequestReference,
        handoffSnapshotReference,
        code: 'BOOKING_REQUEST_NOT_PREPAYMENT_CONFIRMED',
        message:
          'Booking request must remain prepayment_confirmed before bridge execution',
        executionTimestampIso,
      });
    }

    if (executionSnapshot.current_execution_state === 'handoff_consumed') {
      return buildBlockedResult({
        bookingRequestReference,
        handoffSnapshotReference,
        code: 'ALREADY_CONSUMED',
        message:
          'Booking request handoff snapshot has already been consumed and cannot execute again',
        executionTimestampIso,
      });
    }

    const requestInput = toRequestInput({
      slotUid,
      paymentMethod,
      cashAmount,
      cardAmount,
    });
    const guardDecision =
      this.realHandoffPreExecutionGuardService.evaluateExecutionDecision(
        bookingRequestId,
        requestInput
      );
    const bridgeInput = guardDecision?.bridge_input || null;

    if (guardDecision?.decision !== 'eligible') {
      return buildBlockedResult({
        bookingRequestReference,
        handoffSnapshotReference,
        code: guardDecision?.decision_code || 'BRIDGE_NOT_ELIGIBLE',
        message:
          guardDecision?.message ||
          'Booking request is no longer eligible_for_bridge at execution time',
        executionTimestampIso,
        guardDecision,
        bridgeInput,
      });
    }

    try {
      const adapterResult = this.productionPresaleHandoffAdapterService.execute({
        bookingRequestId,
        executionSnapshot,
        guardDecision,
        bridgeInput,
      });

      if (adapterResult?.outcome === 'success') {
        const presaleId = adapterResult?.confirmed_presale_id || null;
        if (!presaleId) {
          return buildFailureResult({
            bookingRequestReference,
            handoffSnapshotReference,
            code: 'CREATED_PRESALE_REFERENCE_MISSING',
            message:
              'Real presale bridge completed without a canonical presale reference',
            executionTimestampIso,
            guardDecision,
            bridgeInput,
            adapterResult,
          });
        }

        return buildSuccessResult({
          bookingRequestReference,
          handoffSnapshotReference,
          presaleId,
          code: adapterResult?.outcome_code || 'PRESALE_CREATED',
          message:
            adapterResult?.message ||
            'Canonical presale created through the Telegram bridge seam',
          executionTimestampIso,
          guardDecision,
          bridgeInput,
          adapterResult,
        });
      }

      if (adapterResult?.outcome === 'blocked') {
        return buildBlockedResult({
          bookingRequestReference,
          handoffSnapshotReference,
          code: adapterResult?.outcome_code || 'BRIDGE_BLOCKED',
          message:
            adapterResult?.message ||
            'Real presale bridge is blocked by current domain constraints',
          executionTimestampIso,
          guardDecision,
          bridgeInput,
          adapterResult,
          details: adapterResult?.payload || null,
        });
      }

      return buildFailureResult({
        bookingRequestReference,
        handoffSnapshotReference,
        code: adapterResult?.outcome_code || 'BRIDGE_FAILED',
        message:
          adapterResult?.message ||
          'Real presale bridge failed unexpectedly while creating a presale',
        executionTimestampIso,
        guardDecision,
        bridgeInput,
        adapterResult,
        details: adapterResult?.payload || null,
      });
    } catch (error) {
      return buildFailureResult({
        bookingRequestReference,
        handoffSnapshotReference,
        code: error?.code || 'BRIDGE_EXECUTION_THROWN',
        message:
          error?.message ||
          'Real presale bridge execution threw unexpectedly',
        executionTimestampIso,
        guardDecision,
        bridgeInput,
        details: {
          error_name: error?.name || null,
        },
      });
    }
  }
}
