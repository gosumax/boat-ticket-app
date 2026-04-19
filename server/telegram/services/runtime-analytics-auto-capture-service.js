import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramRuntimeAnalyticsCaptureValue,
  TELEGRAM_RUNTIME_ANALYTICS_CAPTURE_STATUSES,
  TELEGRAM_RUNTIME_ANALYTICS_CAPTURE_SUMMARY_VERSION,
  TELEGRAM_RUNTIME_ANALYTICS_OPERATION_RESULT_VERSION,
} from '../../../shared/telegram/index.js';

const SERVICE_NAME = 'telegram_runtime_analytics_auto_capture_service';

const OPERATION_TO_EVENT_TYPES = Object.freeze({
  inbound_start_processed: Object.freeze(['guest_entry']),
  source_binding_persisted: Object.freeze(['source_binding']),
  attribution_started: Object.freeze(['attribution_start']),
  booking_request_created: Object.freeze(['booking_request_created']),
  hold_started: Object.freeze(['hold_started']),
  hold_extended: Object.freeze(['hold_extended']),
  hold_expired: Object.freeze(['hold_expired']),
  guest_cancelled_before_prepayment: Object.freeze([
    'guest_cancelled_before_prepayment',
  ]),
  prepayment_confirmed: Object.freeze(['prepayment_confirmed']),
  bridge_outcome: Object.freeze(['bridge_outcome']),
  notification_execution_outcome: Object.freeze(['notification_execution_outcome']),
  review_submitted: Object.freeze(['review_submitted']),
});

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return Boolean(fallback);
  }
  if (value === true || value === false) {
    return value;
  }
  if (value === 1 || value === 0) {
    return value === 1;
  }

  return Boolean(fallback);
}

function sortCaptureValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortCaptureValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortCaptureValue(value[key])])
  );
}

function freezeSortedCaptureValue(value) {
  return freezeTelegramRuntimeAnalyticsCaptureValue(sortCaptureValue(value));
}

function pickOperationResult(input = {}) {
  return (
    input.operation_result ??
    input.operationResult ??
    input.result ??
    input ??
    null
  );
}

function pickOperationType(input = {}) {
  return normalizeString(
    input.operation_type ?? input.operationType ?? input.type ?? null
  );
}

function pickOperationReference(input = {}, operationType, fallbackIso) {
  const explicit = normalizeString(
    input.operation_reference ??
      input.operationReference ??
      input.reference ??
      null
  );
  if (explicit) {
    return explicit;
  }

  const operationResult = pickOperationResult(input);
  const derivedKey = normalizeString(
    operationResult?.idempotency_key ??
      operationResult?.dedupe_key ??
      operationResult?.booking_request_reference?.booking_request_id ??
      operationResult?.telegram_user_summary?.telegram_user_id ??
      null
  );
  if (derivedKey) {
    return `${operationType}:${derivedKey}`;
  }

  return `${operationType}:${fallbackIso}`;
}

function pickBookingRequestId(value = {}) {
  const raw =
    value?.booking_request_id ??
    value?.bookingRequestId ??
    value?.booking_request_reference?.booking_request_id ??
    value?.bookingRequestReference?.booking_request_id ??
    value?.bookingRequestReference?.bookingRequestId ??
    value?.booking_request_reference?.bookingRequestId ??
    value?.operation_result?.booking_request_reference?.booking_request_id ??
    value?.operationResult?.booking_request_reference?.booking_request_id ??
    null;
  const normalized = Number(raw);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function pickTelegramUserId(value = {}) {
  return normalizeString(
    value?.telegram_user_summary?.telegram_user_id ??
      value?.telegramUserSummary?.telegram_user_id ??
      value?.telegram_user_reference?.telegram_user_id ??
      value?.telegramUserReference?.telegram_user_id ??
      value?.operation_result?.telegram_user_summary?.telegram_user_id ??
      value?.operationResult?.telegram_user_summary?.telegram_user_id ??
      null
  );
}

function pickGuestProfileId(value = {}) {
  const raw =
    value?.guest_profile_id ??
    value?.guestProfileId ??
    value?.telegram_user_summary?.guest_profile_id ??
    value?.telegramUserSummary?.guest_profile_id ??
    value?.guest_reference?.guest_profile_id ??
    value?.guestReference?.guest_profile_id ??
    value?.operation_result?.telegram_user_summary?.guest_profile_id ??
    value?.operationResult?.telegram_user_summary?.guest_profile_id ??
    null;
  const normalized = Number(raw);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
}

function pickSourceReference(value = {}) {
  const explicit =
    value?.source_reference ??
    value?.sourceReference ??
    value?.operation_result?.source_reference ??
    value?.operationResult?.source_reference ??
    null;
  if (explicit) {
    return explicit;
  }

  return normalizeString(
    value?.normalized_source_token ??
      value?.source_token ??
      value?.sourceBindingSummary?.normalized_source_token ??
      value?.source_binding_summary?.normalized_source_token ??
      value?.operation_result?.source_binding_summary?.normalized_source_token ??
      value?.operationResult?.source_binding_summary?.normalized_source_token ??
      null
  );
}

function pickEventTypes(input = {}, operationType) {
  const rawEventTypes =
    input.analytics_event_types ??
    input.analyticsEventTypes ??
    input.event_types ??
    input.eventTypes ??
    null;
  if (rawEventTypes !== null && rawEventTypes !== undefined) {
    const values = Array.isArray(rawEventTypes) ? rawEventTypes : [rawEventTypes];
    return Object.freeze(
      values.map((value) => normalizeString(value)).filter(Boolean)
    );
  }

  return OPERATION_TO_EVENT_TYPES[operationType] || Object.freeze([]);
}

function buildCaptureStatus({ attemptedCount, capturedCount, failedCount }) {
  if (attemptedCount <= 0) {
    return 'skipped';
  }
  if (capturedCount > 0 && failedCount === 0) {
    return 'success';
  }
  if (capturedCount > 0 || failedCount > 0) {
    return 'partial';
  }

  return 'skipped';
}

function buildCaptureSummary({
  operationType,
  operationReference,
  autoCaptureEnabled,
  attemptedCount,
  capturedEvents,
  failures,
  nowIso,
  preservedLatestIso = null,
}) {
  const capturedCount = capturedEvents.length;
  const failedCount = failures.length;
  const skippedCount = Math.max(attemptedCount - capturedCount - failedCount, 0);
  const captureStatus = autoCaptureEnabled
    ? buildCaptureStatus({ attemptedCount, capturedCount, failedCount })
    : TELEGRAM_RUNTIME_ANALYTICS_CAPTURE_STATUSES[2];

  return freezeSortedCaptureValue({
    response_version: TELEGRAM_RUNTIME_ANALYTICS_CAPTURE_SUMMARY_VERSION,
    capture_source: SERVICE_NAME,
    related_operation_type: operationType,
    operation_reference: operationReference,
    auto_capture_enabled: autoCaptureEnabled,
    capture_status: captureStatus,
    captured_event_count_summary: {
      attempted_count: attemptedCount,
      captured_count: capturedCount,
      failed_count: failedCount,
      skipped_count: skippedCount,
    },
    captured_event_references: capturedEvents,
    capture_failure_summary: failures,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      preservedLatestIso,
      ...capturedEvents.map((item) => item.event_timestamp_summary?.iso)
    ),
  });
}

function buildOperationEnvelope({
  operationType,
  operationReference,
  operationResult,
  captureSummary,
  nowIso,
}) {
  return freezeSortedCaptureValue({
    response_version: TELEGRAM_RUNTIME_ANALYTICS_OPERATION_RESULT_VERSION,
    operation_type: operationType,
    operation_reference: operationReference,
    operation_result: operationResult,
    analytics_capture_summary: captureSummary,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      operationResult?.latest_timestamp_summary?.iso,
      operationResult?.event_timestamp_summary?.iso,
      captureSummary?.latest_timestamp_summary?.iso
    ),
  });
}

export class TelegramRuntimeAnalyticsAutoCaptureService {
  constructor({
    analyticsFoundationService,
    bookingRequestCreationService = null,
    bookingRequestHoldActivationService = null,
    bookingRequestHoldExtensionService = null,
    bookingRequestHoldExpiryService = null,
    bookingRequestGuestCancelBeforePrepaymentService = null,
    bookingRequestPrepaymentConfirmationService = null,
    realPresaleHandoffOrchestratorService = null,
    reviewFlowService = null,
    autoCaptureEnabled = true,
    now = () => new Date(),
  }) {
    this.analyticsFoundationService = analyticsFoundationService;
    this.bookingRequestCreationService = bookingRequestCreationService;
    this.bookingRequestHoldActivationService = bookingRequestHoldActivationService;
    this.bookingRequestHoldExtensionService = bookingRequestHoldExtensionService;
    this.bookingRequestHoldExpiryService = bookingRequestHoldExpiryService;
    this.bookingRequestGuestCancelBeforePrepaymentService =
      bookingRequestGuestCancelBeforePrepaymentService;
    this.bookingRequestPrepaymentConfirmationService =
      bookingRequestPrepaymentConfirmationService;
    this.realPresaleHandoffOrchestratorService = realPresaleHandoffOrchestratorService;
    this.reviewFlowService = reviewFlowService;
    this.autoCaptureEnabled = normalizeBoolean(autoCaptureEnabled, true);
    this.now = now;
    this.captureSummariesByReference = new Map();
  }

  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'telegram_runtime_auto_capture_ready',
      dependencyKeys: [
        'analyticsFoundationService',
        'bookingRequestCreationService',
        'bookingRequestHoldActivationService',
        'bookingRequestHoldExtensionService',
        'bookingRequestHoldExpiryService',
        'bookingRequestGuestCancelBeforePrepaymentService',
        'bookingRequestPrepaymentConfirmationService',
        'realPresaleHandoffOrchestratorService',
        'reviewFlowService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      throw new Error('[TELEGRAM_RUNTIME_ANALYTICS_AUTO_CAPTURE] invalid clock timestamp');
    }
    return iso;
  }

  setAutoCaptureEnabled(enabled) {
    this.autoCaptureEnabled = normalizeBoolean(enabled, true);
  }

  isAutoCaptureEnabled() {
    return this.autoCaptureEnabled === true;
  }

  captureRuntimeAnalyticsForOperation(input = {}) {
    const nowIso = this.nowIso();
    const operationType = pickOperationType(input);
    if (!operationType || !OPERATION_TO_EVENT_TYPES[operationType]) {
      return buildCaptureSummary({
        operationType: operationType || 'unknown_operation',
        operationReference: `unknown_operation:${nowIso}`,
        autoCaptureEnabled: this.isAutoCaptureEnabled(),
        attemptedCount: 0,
        capturedEvents: [],
        failures: [
          freezeSortedCaptureValue({
            reason: 'unsupported_operation_type',
            message: `Unsupported operation type: ${operationType || 'unknown'}`,
          }),
        ],
        nowIso,
      });
    }

    const operationReference = pickOperationReference(input, operationType, nowIso);
    const eventTypes = pickEventTypes(input, operationType);
    const operationResult = pickOperationResult(input);
    const bookingRequestId = pickBookingRequestId(input) || pickBookingRequestId(operationResult);
    const guestProfileId = pickGuestProfileId(input) || pickGuestProfileId(operationResult);
    const telegramUserId = pickTelegramUserId(input) || pickTelegramUserId(operationResult);
    const sourceReference = pickSourceReference(input) || pickSourceReference(operationResult);
    const eventPayload = freezeSortedCaptureValue({
      operation_type: operationType,
      operation_reference: operationReference,
      operation_status:
        normalizeString(operationResult?.orchestration_status) ||
        normalizeString(operationResult?.execution_status) ||
        normalizeString(operationResult?.submit_status) ||
        normalizeString(operationResult?.review_status) ||
        normalizeString(operationResult?.hold_status) ||
        normalizeString(operationResult?.confirmation_status) ||
        normalizeString(operationResult?.cancel_status) ||
        null,
      metadata: input.operation_payload ?? input.operationPayload ?? null,
    });

    if (!this.isAutoCaptureEnabled()) {
      const skippedSummary = buildCaptureSummary({
        operationType,
        operationReference,
        autoCaptureEnabled: false,
        attemptedCount: eventTypes.length,
        capturedEvents: [],
        failures: [],
        nowIso,
      });
      this.captureSummariesByReference.set(operationReference, skippedSummary);
      return skippedSummary;
    }

    const capturedEvents = [];
    const failures = [];
    for (const [index, eventType] of eventTypes.entries()) {
      try {
        const captured = this.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
          event_type: eventType,
          booking_request_reference: bookingRequestId
            ? {
                reference_type: 'telegram_booking_request',
                booking_request_id: bookingRequestId,
              }
            : null,
          guest_profile_id: guestProfileId,
          telegram_user_reference: telegramUserId
            ? {
                reference_type: 'telegram_user',
                telegram_user_id: telegramUserId,
              }
            : null,
          source_reference: sourceReference,
          event_payload: eventPayload,
          idempotency_key: `${operationReference}:${eventType}:${index}`,
          dedupe_key: `${operationReference}:${eventType}:${index}`,
        });
        capturedEvents.push(
          freezeSortedCaptureValue({
            event_type: eventType,
            analytics_event_reference: captured.analytics_event?.analytics_event_reference || null,
            event_timestamp_summary: captured.analytics_event?.event_timestamp_summary || null,
          })
        );
      } catch (error) {
        failures.push(
          freezeSortedCaptureValue({
            event_type: eventType,
            reason: 'capture_failed',
            message: normalizeString(error?.message) || 'analytics capture failed',
          })
        );
      }
    }

    const summary = buildCaptureSummary({
      operationType,
      operationReference,
      autoCaptureEnabled: true,
      attemptedCount: eventTypes.length,
      capturedEvents,
      failures,
      nowIso,
      preservedLatestIso: operationResult?.latest_timestamp_summary?.iso || null,
    });
    this.captureSummariesByReference.set(operationReference, summary);
    return summary;
  }

  readRuntimeAnalyticsCaptureResultForProcessedOperation(input = {}) {
    const operationType = pickOperationType(input) || 'unknown_operation';
    const operationReference = normalizeString(
      input.operation_reference ?? input.operationReference ?? input.reference ?? null
    );
    const nowIso = this.nowIso();
    if (!operationReference) {
      return buildCaptureSummary({
        operationType,
        operationReference: `missing_operation_reference:${nowIso}`,
        autoCaptureEnabled: this.isAutoCaptureEnabled(),
        attemptedCount: 0,
        capturedEvents: [],
        failures: [
          freezeSortedCaptureValue({
            reason: 'operation_reference_required',
            message: 'operation_reference is required',
          }),
        ],
        nowIso,
      });
    }

    const existing = this.captureSummariesByReference.get(operationReference);
    if (existing) {
      return existing;
    }

    return buildCaptureSummary({
      operationType,
      operationReference,
      autoCaptureEnabled: this.isAutoCaptureEnabled(),
      attemptedCount: 0,
      capturedEvents: [],
      failures: [],
      nowIso,
    });
  }

  readRuntimeAnalyticsCaptureResult(input = {}) {
    return this.readRuntimeAnalyticsCaptureResultForProcessedOperation(input);
  }

  buildAndCaptureOperationEnvelope(operationType, operationResult, metadata = null) {
    const nowIso = this.nowIso();
    const operationReference = pickOperationReference(
      { operation_type: operationType, operation_result: operationResult },
      operationType,
      nowIso
    );
    const captureSummary = this.captureRuntimeAnalyticsForOperation({
      operation_type: operationType,
      operation_reference: operationReference,
      operation_result: operationResult,
      operation_payload: metadata,
    });

    return buildOperationEnvelope({
      operationType,
      operationReference,
      operationResult,
      captureSummary,
      nowIso,
    });
  }

  captureInboundStartProcessed(input = {}) {
    return this.captureRuntimeAnalyticsForOperation({
      ...input,
      operation_type: 'inbound_start_processed',
    });
  }

  captureSourceBindingPersisted(input = {}) {
    return this.captureRuntimeAnalyticsForOperation({
      ...input,
      operation_type: 'source_binding_persisted',
    });
  }

  captureAttributionStarted(input = {}) {
    return this.captureRuntimeAnalyticsForOperation({
      ...input,
      operation_type: 'attribution_started',
    });
  }

  captureNotificationExecutionOutcome(input = {}) {
    return this.captureRuntimeAnalyticsForOperation({
      ...input,
      operation_type: 'notification_execution_outcome',
    });
  }

  createBookingRequestWithAutoCapture(input = {}) {
    const result = this.bookingRequestCreationService.createBookingRequest(input);
    return this.buildAndCaptureOperationEnvelope('booking_request_created', result);
  }

  activateHoldWithAutoCapture(input = {}) {
    const result = this.bookingRequestHoldActivationService.activateHold(input);
    return this.buildAndCaptureOperationEnvelope('hold_started', result);
  }

  extendHoldWithAutoCapture(input = {}) {
    const result = this.bookingRequestHoldExtensionService.extendHold(input);
    return this.buildAndCaptureOperationEnvelope('hold_extended', result);
  }

  expireHoldWithAutoCapture(input = {}) {
    const result = this.bookingRequestHoldExpiryService.expireHold(input);
    return this.buildAndCaptureOperationEnvelope('hold_expired', result);
  }

  cancelBeforePrepaymentWithAutoCapture(input = {}) {
    const result =
      this.bookingRequestGuestCancelBeforePrepaymentService.cancel(input);
    return this.buildAndCaptureOperationEnvelope(
      'guest_cancelled_before_prepayment',
      result
    );
  }

  confirmPrepaymentWithAutoCapture(input = {}) {
    const result =
      this.bookingRequestPrepaymentConfirmationService.confirmPrepayment(input);
    return this.buildAndCaptureOperationEnvelope('prepayment_confirmed', result);
  }

  orchestrateBridgeOutcomeWithAutoCapture(bookingRequestId, input = {}) {
    const result = this.realPresaleHandoffOrchestratorService.orchestrate(
      bookingRequestId,
      input
    );
    return this.buildAndCaptureOperationEnvelope('bridge_outcome', result);
  }

  submitReviewWithAutoCapture(input = {}) {
    const result = this.reviewFlowService.submitGuestReviewForCompletedTrip(input);
    return this.buildAndCaptureOperationEnvelope('review_submitted', result);
  }
}
