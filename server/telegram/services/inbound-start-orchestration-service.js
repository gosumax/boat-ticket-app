import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramInboundStartOrchestrationValue,
  TELEGRAM_INBOUND_START_ORCHESTRATION_RESULT_VERSION,
} from '../../../shared/telegram/index.js';

const SERVICE_NAME = 'telegram_inbound_start_orchestration_service';
const NORMALIZATION_ERROR_PREFIX = '[TELEGRAM_START_UPDATE_NORMALIZATION]';
const SELLER_ATTRIBUTION_ERROR_PREFIX = '[TELEGRAM_SELLER_ATTRIBUTION_SESSION_START]';
const SELLER_ATTRIBUTION_RESULT_VERSION =
  'telegram_seller_attribution_session_start_result.v1';
const SELLER_ATTRIBUTION_FALLBACK_REASON =
  'resolved_seller_source_missing_runtime_qr_linkage';
const SELLER_LINKAGE_ERROR_MARKERS = Object.freeze([
  'Source QR code not found for source token',
]);

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function sortResultValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortResultValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortResultValue(value[key])])
  );
}

function freezeSortedResultValue(value) {
  return freezeTelegramInboundStartOrchestrationValue(sortResultValue(value));
}

function buildSourceBindingSummary(sourceBindingResult) {
  if (!sourceBindingResult) {
    return null;
  }

  return freezeSortedResultValue({
    binding_status: sourceBindingResult.binding_status || null,
    source_binding_reference: sourceBindingResult.source_binding_reference || null,
    guest_entry_reference: sourceBindingResult.guest_entry_reference || null,
    raw_source_token: sourceBindingResult.raw_source_token || null,
    normalized_source_token: sourceBindingResult.normalized_source_token || null,
    resolved_source_family: sourceBindingResult.resolved_source_family || null,
    source_resolution_outcome: sourceBindingResult.source_resolution_outcome || null,
    source_resolution_summary: sourceBindingResult.source_resolution_summary || null,
    event_timestamp_summary: sourceBindingResult.event_timestamp_summary || null,
  });
}

function buildAttributionSummary(attributionResult) {
  if (!attributionResult) {
    return null;
  }

  return freezeSortedResultValue({
    attribution_status: attributionResult.attribution_status || null,
    no_attribution_reason: attributionResult.no_attribution_reason || null,
    seller_attribution_active: attributionResult.seller_attribution_active === true,
    attribution_session_reference:
      attributionResult.attribution_session_reference || null,
    source_binding_reference: attributionResult.source_binding_reference || null,
    attribution_started_at_summary:
      attributionResult.attribution_started_at_summary || null,
    attribution_expires_at_summary:
      attributionResult.attribution_expires_at_summary || null,
    dedupe_key: attributionResult.dedupe_key || null,
    idempotency_key: attributionResult.idempotency_key || null,
  });
}

function mapOrchestrationStatus({ sourceResolutionResult, sourceBindingResult, attributionResult }) {
  const resolutionStatus =
    sourceResolutionResult?.resolution_status ||
    sourceBindingResult?.source_resolution_outcome ||
    null;
  if (resolutionStatus === 'no_source_token') {
    return 'start_processed_without_source';
  }

  if (
    attributionResult?.attribution_status === 'ACTIVE' &&
    attributionResult?.seller_attribution_active === true
  ) {
    return 'start_processed_with_seller_attribution';
  }

  return 'start_processed';
}

function buildRejectedResult({ nowIso, rejectionReason }) {
  return freezeSortedResultValue({
    response_version: TELEGRAM_INBOUND_START_ORCHESTRATION_RESULT_VERSION,
    orchestrated_by: SERVICE_NAME,
    orchestration_status: 'start_rejected_invalid_update',
    rejection_reason: rejectionReason,
    telegram_user_summary: null,
    guest_entry_reference: null,
    source_binding_summary: null,
    attribution_summary: null,
    bot_start_state_summary: null,
    guest_action_state_summary: null,
    analytics_capture_summary: null,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(nowIso),
  });
}

function buildCaptureSummary({
  startCaptureSummary,
  sourceBindingCaptureSummary,
  attributionCaptureSummary,
}) {
  return freezeSortedResultValue({
    inbound_start_processed: startCaptureSummary || null,
    source_binding_persisted: sourceBindingCaptureSummary || null,
    attribution_started: attributionCaptureSummary || null,
  });
}

function shouldFallbackSellerAttributionError(sourceBindingResult, error) {
  if (sourceBindingResult?.source_resolution_outcome !== 'resolved_seller_source') {
    return false;
  }

  const errorMessage = normalizeString(error?.message);
  if (!errorMessage || !errorMessage.includes(SELLER_ATTRIBUTION_ERROR_PREFIX)) {
    return false;
  }

  return SELLER_LINKAGE_ERROR_MARKERS.some((marker) => errorMessage.includes(marker));
}

function buildSellerAttributionFallbackResult(sourceBindingResult) {
  const sourceBindingReference = sourceBindingResult?.source_binding_reference || null;
  const sourceBindingEventId = sourceBindingReference?.source_binding_event_id;
  const fallbackIdempotencyKey = Number.isInteger(sourceBindingEventId)
    ? `telegram_seller_attribution_session_start:source_binding_event=${sourceBindingEventId}`
    : `telegram_seller_attribution_session_start:fallback:${sourceBindingResult?.idempotency_key || 'unknown'}`;

  return freezeSortedResultValue({
    response_version: SELLER_ATTRIBUTION_RESULT_VERSION,
    attribution_status: 'NO_SELLER_ATTRIBUTION',
    no_attribution_reason: SELLER_ATTRIBUTION_FALLBACK_REASON,
    telegram_user_summary: sourceBindingResult?.telegram_user_summary || null,
    source_binding_reference: sourceBindingReference,
    attribution_session_reference: null,
    seller_attribution_active: false,
    attribution_started_at_summary: null,
    attribution_expires_at_summary: null,
    dedupe_key: fallbackIdempotencyKey,
    idempotency_key: fallbackIdempotencyKey,
  });
}

export class TelegramInboundStartOrchestrationService {
  constructor({
    guestProfiles = null,
    startUpdateNormalizationService,
    startSourceTokenResolutionService,
    guestEntryPersistenceService,
    sourceBindingPersistenceService,
    sellerAttributionSessionStartService,
    botStartStateService,
    guestActionStateProjectionService,
    runtimeAnalyticsAutoCaptureService = null,
    now = () => new Date(),
  }) {
    this.guestProfiles = guestProfiles;
    this.startUpdateNormalizationService = startUpdateNormalizationService;
    this.startSourceTokenResolutionService = startSourceTokenResolutionService;
    this.guestEntryPersistenceService = guestEntryPersistenceService;
    this.sourceBindingPersistenceService = sourceBindingPersistenceService;
    this.sellerAttributionSessionStartService = sellerAttributionSessionStartService;
    this.botStartStateService = botStartStateService;
    this.guestActionStateProjectionService = guestActionStateProjectionService;
    this.runtimeAnalyticsAutoCaptureService = runtimeAnalyticsAutoCaptureService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'telegram_inbound_start_orchestration_ready',
      dependencyKeys: [
        'guestProfiles',
        'startUpdateNormalizationService',
        'startSourceTokenResolutionService',
        'guestEntryPersistenceService',
        'sourceBindingPersistenceService',
        'sellerAttributionSessionStartService',
        'botStartStateService',
        'guestActionStateProjectionService',
        'runtimeAnalyticsAutoCaptureService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      throw new Error('[TELEGRAM_INBOUND_START_ORCHESTRATION] invalid clock timestamp');
    }
    return iso;
  }

  captureAnalytics(operationType, operationReference, operationResult, metadata = null) {
    if (!this.runtimeAnalyticsAutoCaptureService) {
      return null;
    }

    if (operationType === 'inbound_start_processed') {
      return this.runtimeAnalyticsAutoCaptureService.captureInboundStartProcessed({
        operation_reference: operationReference,
        operation_result: operationResult,
        operation_payload: metadata,
      });
    }
    if (operationType === 'source_binding_persisted') {
      return this.runtimeAnalyticsAutoCaptureService.captureSourceBindingPersisted({
        operation_reference: operationReference,
        operation_result: operationResult,
        operation_payload: metadata,
      });
    }
    if (operationType === 'attribution_started') {
      return this.runtimeAnalyticsAutoCaptureService.captureAttributionStarted({
        operation_reference: operationReference,
        operation_result: operationResult,
        operation_payload: metadata,
      });
    }

    return null;
  }

  ensureGuestProfileForStart(guestEntryResult, nowIso) {
    if (!this.guestProfiles || typeof this.guestProfiles.findOneBy !== 'function') {
      return;
    }

    const telegramUserSummary = guestEntryResult.telegram_user_summary || {};
    const telegramUserId = normalizeString(telegramUserSummary.telegram_user_id);
    if (!telegramUserId) {
      return;
    }

    const existing = this.guestProfiles.findOneBy(
      { telegram_user_id: telegramUserId },
      { orderBy: 'guest_profile_id ASC' }
    );
    if (existing) {
      return;
    }

    this.guestProfiles.create({
      telegram_user_id: telegramUserId,
      display_name: telegramUserSummary.display_name || telegramUserId,
      username: telegramUserSummary.username || null,
      language_code: telegramUserSummary.language_code || null,
      phone_e164: null,
      consent_status: 'unknown',
      first_seen_at: guestEntryResult.event_timestamp_summary?.iso || nowIso,
      last_seen_at: guestEntryResult.event_timestamp_summary?.iso || nowIso,
      profile_status: 'active',
    });
  }

  orchestrateInboundStartUpdate(rawUpdate) {
    const nowIso = this.nowIso();

    let normalizedStartUpdate = null;
    try {
      normalizedStartUpdate =
        this.startUpdateNormalizationService.normalizeStartUpdate(rawUpdate);
    } catch (error) {
      const message = normalizeString(error?.message) || 'invalid_start_update';
      if (message.includes(NORMALIZATION_ERROR_PREFIX)) {
        return buildRejectedResult({
          nowIso,
          rejectionReason: message,
        });
      }
      throw error;
    }

    const guestEntryResult =
      this.guestEntryPersistenceService.persistGuestEntry(normalizedStartUpdate);
    const sourceResolutionResult =
      this.startSourceTokenResolutionService.resolveStartSourceToken({
        normalized_start_event: normalizedStartUpdate,
      });
    const sourceBindingResult =
      this.sourceBindingPersistenceService.persistSourceBinding({
        guest_entry_result: guestEntryResult,
        source_resolution_result: sourceResolutionResult,
      });
    let attributionResult = null;
    try {
      attributionResult =
        this.sellerAttributionSessionStartService.startSellerAttributionFromSourceBinding({
          source_binding_result: sourceBindingResult,
        });
    } catch (error) {
      if (shouldFallbackSellerAttributionError(sourceBindingResult, error)) {
        attributionResult =
          buildSellerAttributionFallbackResult(sourceBindingResult);
      } else {
        throw error;
      }
    }
    this.ensureGuestProfileForStart(guestEntryResult, nowIso);
    const telegramUserId = guestEntryResult.telegram_user_summary?.telegram_user_id;
    const botStartStateSummary =
      this.botStartStateService.readBotStartStateByTelegramUserReference({
        telegram_user_id: telegramUserId,
      });
    const guestActionStateSummary =
      this.guestActionStateProjectionService.readGuestActionStateByTelegramUserReference({
        telegram_user_id: telegramUserId,
      });

    const orchestrationReference =
      normalizeString(guestEntryResult.idempotency_key) ||
      `start_orchestration:${telegramUserId || 'unknown'}:${nowIso}`;
    const startCaptureSummary = this.captureAnalytics(
      'inbound_start_processed',
      `${orchestrationReference}:guest_entry`,
      guestEntryResult,
      {
        source_resolution_status: sourceResolutionResult.resolution_status,
      }
    );
    const sourceBindingCaptureSummary = this.captureAnalytics(
      'source_binding_persisted',
      `${orchestrationReference}:source_binding`,
      sourceBindingResult,
      {
        source_resolution_outcome: sourceBindingResult.source_resolution_outcome,
      }
    );
    const attributionCaptureSummary =
      attributionResult?.attribution_status === 'ACTIVE'
        ? this.captureAnalytics(
            'attribution_started',
            `${orchestrationReference}:attribution_started`,
            attributionResult,
            {
              attribution_status: attributionResult.attribution_status,
            }
          )
        : null;

    return freezeSortedResultValue({
      response_version: TELEGRAM_INBOUND_START_ORCHESTRATION_RESULT_VERSION,
      orchestrated_by: SERVICE_NAME,
      orchestration_status: mapOrchestrationStatus({
        sourceResolutionResult,
        sourceBindingResult,
        attributionResult,
      }),
      telegram_user_summary: guestEntryResult.telegram_user_summary || null,
      guest_entry_reference: guestEntryResult.persisted_entry_reference || null,
      source_binding_summary: buildSourceBindingSummary(sourceBindingResult),
      attribution_summary: buildAttributionSummary(attributionResult),
      bot_start_state_summary: botStartStateSummary,
      guest_action_state_summary: guestActionStateSummary,
      analytics_capture_summary: buildCaptureSummary({
        startCaptureSummary,
        sourceBindingCaptureSummary,
        attributionCaptureSummary,
      }),
      latest_timestamp_summary: buildTelegramLatestTimestampSummary(
        nowIso,
        guestEntryResult.event_timestamp_summary?.iso,
        sourceBindingResult.event_timestamp_summary?.source_binding_event_timestamp?.iso,
        sourceBindingResult.event_timestamp_summary?.guest_entry_event_timestamp?.iso,
        attributionResult.attribution_started_at_summary?.iso,
        botStartStateSummary.latest_timestamp_summary?.iso,
        guestActionStateSummary.latest_timestamp_summary?.iso
      ),
    });
  }

  processInboundStartUpdate(rawUpdate) {
    return this.orchestrateInboundStartUpdate(rawUpdate);
  }
}
