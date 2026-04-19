import {
  buildTelegramHandoffEligibilityList,
  buildTelegramHandoffEligibilityRecord,
} from '../../../shared/telegram/index.js';

const ERROR_PREFIX = '[TELEGRAM_HANDOFF_ELIGIBILITY]';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_SCAN_LIMIT = 500;

function rejectEligibility(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizeLimit(limit, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const normalized = Number(limit);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
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

function compareEligibilityItems(left, right) {
  const leftTime = Date.parse(left.latest_timestamp_summary?.iso || 0);
  const rightTime = Date.parse(right.latest_timestamp_summary?.iso || 0);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return (
    right.booking_request_reference.booking_request_id -
    left.booking_request_reference.booking_request_id
  );
}

function isNonProjectableEligibilityError(error) {
  const message = String(error?.message || '');
  return (
    message.includes('Invalid booking request reference') ||
    message.includes('not projectable')
  );
}

export class TelegramHandoffEligibilityProjectionService {
  constructor({
    handoffReadinessQueryService,
    handoffExecutionQueryService,
    preHandoffValidationService,
  }) {
    this.handoffReadinessQueryService = handoffReadinessQueryService;
    this.handoffExecutionQueryService = handoffExecutionQueryService;
    this.preHandoffValidationService = preHandoffValidationService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'handoff-eligibility-projection-service',
      status: 'projection_ready',
      dependencyKeys: [
        'handoffReadinessQueryService',
        'handoffExecutionQueryService',
        'preHandoffValidationService',
      ],
    });
  }

  readHandoffEligibilityByBookingRequestReference(input = {}) {
    let readiness = null;

    try {
      readiness =
        this.handoffReadinessQueryService.readHandoffReadinessByBookingRequestReference(
          input
        );
    } catch (error) {
      const message = String(error?.message || '');
      if (
        message.includes('Invalid booking request reference') ||
        message.includes('not projectable')
      ) {
        rejectEligibility(message);
      }

      throw error;
    }

    let executionState = null;
    let validationStatus = null;
    let latestTimestamp = readiness.latest_readiness_timestamp_summary?.iso || null;

    if (!readiness.handoff_prepared || readiness.lifecycle_state !== 'prepayment_confirmed') {
      return buildTelegramHandoffEligibilityRecord({
        bookingRequestReference: readiness.booking_request_reference,
        lifecycleState: readiness.lifecycle_state,
        handoffReadinessState: readiness.handoff_readiness_state,
        executionState,
        validationStatus,
        eligibilityState:
          readiness.handoff_readiness_state === 'invalid_for_handoff'
            ? 'blocked_for_bridge'
            : 'not_ready',
        eligibilityReason:
          readiness.handoff_readiness_state === 'invalid_for_handoff'
            ? 'Booking request is blocked_for_bridge because current handoff readiness is invalid'
            : 'Booking request is not_ready because prepayment confirmation and handoff preparation are not both complete',
        latestTimestampIso: latestTimestamp,
      });
    }

    const validation =
      this.preHandoffValidationService.readValidationByBookingRequestReference({
        booking_request_reference: readiness.booking_request_reference,
      });
    const execution =
      this.handoffExecutionQueryService.readCurrentExecutionStateByBookingRequestReference(
        {
          booking_request_reference: readiness.booking_request_reference,
        }
      );

    executionState = execution.current_execution_state;
    validationStatus = validation.validation_status;
    latestTimestamp = latestTimestampIso(
      readiness.latest_readiness_timestamp_summary,
      execution.latest_execution_timestamp_summary,
      validation.validation_timestamp_summary
    );

    let eligibilityState = 'eligible_for_bridge';
    let eligibilityReason =
      'Booking request is eligible_for_bridge based on lifecycle, readiness, execution, and validation state';

    if (executionState === 'handoff_consumed') {
      eligibilityState = 'already_consumed';
      eligibilityReason =
        'Booking request is already_consumed because the frozen handoff snapshot has already been consumed';
    } else if (executionState === 'handoff_blocked' || validationStatus === 'blocked_for_handoff') {
      eligibilityState = 'blocked_for_bridge';
      eligibilityReason =
        validation.validation_reason ||
        'Booking request is blocked_for_bridge by pre-handoff validation or execution state';
    } else if (validationStatus === 'manual_review_required') {
      eligibilityState = 'manual_review_required';
      eligibilityReason =
        validation.validation_reason ||
        'Booking request requires manual review before a future bridge can consume it';
    }

    return buildTelegramHandoffEligibilityRecord({
      bookingRequestReference: readiness.booking_request_reference,
      lifecycleState: readiness.lifecycle_state,
      handoffReadinessState: readiness.handoff_readiness_state,
      executionState,
      validationStatus,
      eligibilityState,
      eligibilityReason,
      latestTimestampIso: latestTimestamp,
    });
  }

  listPreparedEligibilityItems({ limit = DEFAULT_LIMIT, scanLimit = DEFAULT_SCAN_LIMIT } = {}) {
    const preparedItems = this.handoffReadinessQueryService.listPreparedRequests({
      limit: normalizeLimit(scanLimit, DEFAULT_SCAN_LIMIT, DEFAULT_SCAN_LIMIT),
    });

    return preparedItems
      .map((preparedItem) => {
        try {
          return this.readHandoffEligibilityByBookingRequestReference({
            booking_request_reference: preparedItem.booking_request_reference,
          });
        } catch (error) {
          if (isNonProjectableEligibilityError(error)) {
            return null;
          }

          throw error;
        }
      })
      .filter(Boolean)
      .sort(compareEligibilityItems)
      .slice(0, normalizeLimit(limit));
  }

  listHandoffEligibleRequests(input = {}) {
    const items = this.listPreparedEligibilityItems({
      limit: input.limit,
      scanLimit: input.scanLimit ?? input.scan_limit,
    }).filter((item) => item.eligibility_state === 'eligible_for_bridge');

    return buildTelegramHandoffEligibilityList({
      listScope: 'handoff_eligible_requests',
      items,
    });
  }

  listRequestsNeedingManualReview(input = {}) {
    const items = this.listPreparedEligibilityItems({
      limit: input.limit,
      scanLimit: input.scanLimit ?? input.scan_limit,
    }).filter((item) => item.eligibility_state === 'manual_review_required');

    return buildTelegramHandoffEligibilityList({
      listScope: 'handoff_manual_review_requests',
      items,
    });
  }

  readHandoffEligibility(input = {}) {
    return this.readHandoffEligibilityByBookingRequestReference(input);
  }
}
