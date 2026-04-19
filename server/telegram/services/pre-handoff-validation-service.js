import {
  analyzeTelegramBridgeAdapterDryRunContract,
  buildTelegramPreHandoffValidationResult,
  freezeTelegramHandoffValue,
} from '../../../shared/telegram/index.js';

const ERROR_PREFIX = '[TELEGRAM_PRE_HANDOFF_VALIDATION]';

function rejectValidation(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function buildIssue(code, message, details = {}) {
  return freezeTelegramHandoffValue({
    code,
    message,
    details,
  });
}

function latestTimestampIso(...summaries) {
  const candidates = summaries
    .map((summary) => summary?.iso || null)
    .filter(Boolean)
    .map((iso) => ({ iso, parsed: Date.parse(iso) }))
    .filter((candidate) => !Number.isNaN(candidate.parsed))
    .sort((left, right) => right.parsed - left.parsed);

  return candidates[0]?.iso || null;
}

function mapValidationReadinessError(error) {
  const message = String(error?.message || '');
  if (
    message.includes('Invalid booking request reference') ||
    message.includes('booking request reference')
  ) {
    rejectValidation(
      message.replace(/^.*Invalid booking request reference/, 'Invalid booking request reference')
    );
  }
  if (message.includes('not projectable')) {
    rejectValidation(message);
  }

  throw error;
}

export class TelegramPreHandoffValidationService {
  constructor({
    handoffReadinessQueryService,
    handoffExecutionQueryService,
    bridgeAdapterDryRunContractService,
  }) {
    this.handoffReadinessQueryService = handoffReadinessQueryService;
    this.handoffExecutionQueryService = handoffExecutionQueryService;
    this.bridgeAdapterDryRunContractService = bridgeAdapterDryRunContractService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'pre-handoff-validation-service',
      status: 'validation_ready',
      dependencyKeys: [
        'handoffReadinessQueryService',
        'handoffExecutionQueryService',
        'bridgeAdapterDryRunContractService',
      ],
    });
  }

  readPreparedReadinessOrThrow(input = {}) {
    try {
      const readiness =
        this.handoffReadinessQueryService.readHandoffReadinessByBookingRequestReference(
          input
        );
      const bookingRequestId =
        readiness?.booking_request_reference?.booking_request_id || 'unknown';

      if (readiness.lifecycle_state !== 'prepayment_confirmed') {
        rejectValidation(
          `Booking request is not prepayment_confirmed for validation: ${bookingRequestId}`
        );
      }
      if (!readiness.handoff_prepared) {
        rejectValidation(
          `Booking request is not handoff_prepared for validation: ${bookingRequestId}`
        );
      }
      if (readiness.handoff_readiness_state !== 'ready_for_handoff') {
        rejectValidation(
          `Booking request is not ready_for_handoff for validation: ${bookingRequestId}`
        );
      }

      return readiness;
    } catch (error) {
      mapValidationReadinessError(error);
      return null;
    }
  }

  readValidationByBookingRequestReference(input = {}) {
    const readiness = this.readPreparedReadinessOrThrow(input);
    const execution =
      this.handoffExecutionQueryService.readCurrentExecutionStateByBookingRequestReference(
        {
          booking_request_reference: readiness.booking_request_reference,
        }
      );
    const contractAnalysis =
      this.bridgeAdapterDryRunContractService?.analyzeFrozenHandoffSnapshot
        ? this.bridgeAdapterDryRunContractService.analyzeFrozenHandoffSnapshot(
            readiness.handoff_snapshot
          )
        : analyzeTelegramBridgeAdapterDryRunContract(readiness.handoff_snapshot);

    const blockingIssues = [...(contractAnalysis.blocking_issue_list || [])];
    const manualReviewIssues = [...(contractAnalysis.manual_review_issue_list || [])];
    const warningIssues = [...(contractAnalysis.non_blocking_warning_list || [])];

    if (execution.current_execution_state === 'handoff_started') {
      manualReviewIssues.push(
        buildIssue(
          'EXECUTION_ALREADY_STARTED',
          'Current handoff execution has already started and requires manual review before any duplicate bridge handoff',
          {
            current_execution_state: execution.current_execution_state,
          }
        )
      );
    }

    if (execution.current_execution_state === 'handoff_blocked') {
      blockingIssues.push(
        buildIssue(
          'EXECUTION_ALREADY_BLOCKED',
          'Current handoff execution is already blocked',
          {
            current_execution_state: execution.current_execution_state,
            blocked_reason: execution.blocked_reason,
          }
        )
      );
    }

    if (execution.current_execution_state === 'handoff_consumed') {
      blockingIssues.push(
        buildIssue(
          'EXECUTION_ALREADY_CONSUMED',
          'Current handoff snapshot has already been consumed',
          {
            current_execution_state: execution.current_execution_state,
          }
        )
      );
    }

    const validationStatus =
      blockingIssues.length > 0
        ? 'blocked_for_handoff'
        : manualReviewIssues.length > 0
          ? 'manual_review_required'
          : 'valid_for_handoff';
    const validationReason =
      blockingIssues[0]?.message ||
      manualReviewIssues[0]?.message ||
      (warningIssues.length > 0
        ? 'Frozen handoff snapshot is valid_for_handoff with non-blocking warnings recorded'
        : 'Frozen handoff snapshot is valid_for_handoff');

    return buildTelegramPreHandoffValidationResult({
      bookingRequestReference: readiness.booking_request_reference,
      handoffSnapshotReference: readiness.handoff_snapshot_reference,
      validationStatus,
      validationReason,
      handoffAllowed: validationStatus === 'valid_for_handoff',
      blockingIssues,
      warningIssues: [...manualReviewIssues, ...warningIssues],
      validationTimestampIso: latestTimestampIso(
        readiness.latest_readiness_timestamp_summary,
        execution.latest_execution_timestamp_summary
      ),
    });
  }

  validateByBookingRequestReference(input = {}) {
    return this.readValidationByBookingRequestReference(input);
  }
}
