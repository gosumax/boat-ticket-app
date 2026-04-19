import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramTemplateExecutionValue,
  TELEGRAM_POST_TRIP_MESSAGE_TYPES,
  TELEGRAM_PRE_TRIP_REMINDER_TYPES,
  TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS,
  TELEGRAM_SERVICE_MESSAGE_RESOLUTION_VERSION,
  TELEGRAM_SERVICE_MESSAGE_TEMPLATE_BASELINES,
  TELEGRAM_SERVICE_MESSAGE_TEMPLATE_TYPES,
  TELEGRAM_TEMPLATE_EXECUTION_BATCH_RESULT_VERSION,
  TELEGRAM_TEMPLATE_EXECUTION_RESULT_VERSION,
} from '../../../shared/telegram/index.js';

const SERVICE_NAME = 'telegram_template_execution_orchestration_service';
const ALLOWED_MESSAGE_TYPES = new Set(TELEGRAM_SERVICE_MESSAGE_TEMPLATE_TYPES);
const REMINDER_TYPES = new Set(TELEGRAM_PRE_TRIP_REMINDER_TYPES);
const POST_TRIP_TYPES = new Set(TELEGRAM_POST_TRIP_MESSAGE_TYPES);
const TEMPLATE_BASELINE_BY_TYPE = Object.freeze(
  Object.fromEntries(
    TELEGRAM_SERVICE_MESSAGE_TEMPLATE_BASELINES.map((item) => [item.template_type, item])
  )
);

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`[TELEGRAM_TEMPLATE_EXECUTION] ${label} must be a positive integer`);
  }

  return normalized;
}

function sortExecutionValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortExecutionValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortExecutionValue(value[key])])
  );
}

function freezeSortedExecutionValue(value) {
  return freezeTelegramTemplateExecutionValue(sortExecutionValue(value));
}

function pickBookingRequestReference(input = {}) {
  return (
    input.booking_request_reference ??
    input.bookingRequestReference ??
    input.booking_request ??
    input.bookingRequest ??
    input.reference ??
    null
  );
}

function normalizeBookingRequestReference(input = {}) {
  const rawReference = pickBookingRequestReference(input);
  if (!rawReference || typeof rawReference !== 'object' || Array.isArray(rawReference)) {
    throw new Error('[TELEGRAM_TEMPLATE_EXECUTION] booking_request_reference is required');
  }

  const referenceType = normalizeString(
    rawReference.reference_type || 'telegram_booking_request'
  );
  if (referenceType !== 'telegram_booking_request') {
    throw new Error(
      `[TELEGRAM_TEMPLATE_EXECUTION] Unsupported booking request reference type: ${
        referenceType || 'unknown'
      }`
    );
  }

  return freezeSortedExecutionValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: normalizePositiveInteger(
      rawReference.booking_request_id ?? rawReference.bookingRequestId,
      'booking_request_reference.booking_request_id'
    ),
  });
}

function normalizeMessageType(input = {}) {
  const messageType = normalizeString(
    input.message_type ?? input.messageType ?? input.type ?? null
  );
  if (!messageType || !ALLOWED_MESSAGE_TYPES.has(messageType)) {
    throw new Error(
      `[TELEGRAM_TEMPLATE_EXECUTION] Unsupported message type: ${messageType || 'unknown'}`
    );
  }

  return messageType;
}

function mapRunStatusToExecutionStatus(runResult, managedTemplateUsed) {
  const runStatus = normalizeString(runResult?.run_status);
  const skipReason = normalizeString(runResult?.skip_reason);
  if (runStatus === 'sent') {
    return managedTemplateUsed
      ? 'executed_with_managed_template'
      : 'executed_with_default_fallback';
  }

  if (runStatus === 'blocked' || skipReason === 'blocked' || skipReason === 'suppressed') {
    return 'execution_blocked';
  }

  return 'execution_not_possible';
}

function buildDeliveryResultSummary(runResult, planResult, intentResult) {
  return freezeSortedExecutionValue({
    run_status: runResult?.run_status || null,
    skip_reason: runResult?.skip_reason || null,
    blocked_reason: runResult?.blocked_reason || null,
    failed_reason: runResult?.failed_reason || null,
    execution_result_summary: runResult?.execution_result_summary || null,
    persisted_attempt_reference: runResult?.persisted_attempt_reference || null,
    persisted_intent_reference: intentResult?.persisted_intent_reference || null,
    plan_send_decision: planResult?.send_decision || null,
  });
}

function buildTemplateReferenceByType(messageType) {
  const baseline = TEMPLATE_BASELINE_BY_TYPE[messageType] || null;
  return baseline?.template_reference || `tg_service_message_template_${messageType}`;
}

function buildFallbackFields(messageType, fallbackResolution = null) {
  const fallbackFields = fallbackResolution?.text_payload?.fields || null;
  if (fallbackFields) {
    return freezeSortedExecutionValue({
      headline: normalizeString(fallbackFields.headline),
      body: normalizeString(fallbackFields.body),
      status_line: normalizeString(fallbackFields.status_line),
    });
  }

  const baseline = TEMPLATE_BASELINE_BY_TYPE[messageType] || null;
  return freezeSortedExecutionValue({
    headline: normalizeString(baseline?.title_name_summary),
    body: normalizeString(baseline?.text_body_summary),
    status_line: null,
  });
}

function buildReminderWeatherVariables(weatherUsefulContentSummary = null) {
  const weatherSummary = weatherUsefulContentSummary?.weather_summary || {};
  const caringSummary = weatherUsefulContentSummary?.weather_caring_content_summary || {};

  return freezeSortedExecutionValue({
    weather_data_state: normalizeString(weatherSummary.weather_data_state) || 'unavailable',
    weather_source_type: normalizeString(weatherSummary.source_type) || 'unavailable',
    weather_condition_code: normalizeString(weatherSummary.condition_code),
    weather_condition_label: normalizeString(weatherSummary.condition_label),
    weather_temperature_c:
      weatherSummary.temperature_c === undefined ? null : weatherSummary.temperature_c,
    weather_wind_speed_mps:
      weatherSummary.wind_speed_mps === undefined ? null : weatherSummary.wind_speed_mps,
    weather_precipitation_probability:
      weatherSummary.precipitation_probability === undefined
        ? null
        : weatherSummary.precipitation_probability,
    weather_reminder_status_line: normalizeString(caringSummary.reminder_status_line),
    weather_recommendation_lines: Array.isArray(caringSummary.recommendation_lines)
      ? caringSummary.recommendation_lines
      : [],
  });
}

function resolveReminderStatusLine(weatherUsefulContentSummary = null, fallbackFields = null) {
  const statusLine = normalizeString(
    weatherUsefulContentSummary?.weather_caring_content_summary?.reminder_status_line
  );
  if (statusLine) {
    return statusLine;
  }
  return normalizeString(fallbackFields?.status_line);
}

function buildContextVariables(
  context,
  messageType,
  fallbackResolution = null,
  extraVariables = null
) {
  const fallbackVariables = fallbackResolution?.text_payload?.variables || {};
  const bookingRequest = context.historyItem.booking_request || {};
  const bookingHold = context.historyItem.booking_hold || {};
  const guestIdentity = context.profileView.guest_identity || {};

  return freezeSortedExecutionValue({
    message_type: messageType,
    guest_profile_id: guestIdentity.guest_profile_id || null,
    telegram_user_id: guestIdentity.telegram_user_id || null,
    guest_display_name: guestIdentity.display_name || null,
    guest_username: guestIdentity.username || null,
    guest_language_code: guestIdentity.language_code || null,
    guest_consent_status: guestIdentity.consent_status || null,
    guest_profile_status: guestIdentity.profile_status || null,
    booking_request_id: bookingRequest.booking_request_id || null,
    requested_trip_date: bookingRequest.requested_trip_date || null,
    requested_time_slot: bookingRequest.requested_time_slot || null,
    requested_seats: Number(bookingRequest.requested_seats || 0),
    requested_ticket_mix: bookingRequest.requested_ticket_mix || {},
    contact_phone_e164: bookingRequest.contact_phone_e164 || null,
    request_status: bookingRequest.request_status || null,
    hold_status: bookingHold.hold_status || null,
    hold_expires_at: bookingHold.hold_expires_at || null,
    confirmed_presale_id: bookingRequest.confirmed_presale_id || null,
    linked_to_presale: Boolean(bookingRequest.confirmed_presale_id),
    ...fallbackVariables,
    ...(extraVariables || {}),
  });
}

function buildNotificationResolution({
  messageType,
  context,
  fallbackResolution = null,
  selectedFields,
  extraVariables = null,
}) {
  const bookingRequestId = context.bookingRequestReference.booking_request_id;
  const variables = buildContextVariables(
    context,
    messageType,
    fallbackResolution,
    extraVariables
  );
  const locale = variables.guest_language_code || 'und';
  const actionButtons = Array.isArray(fallbackResolution?.action_buttons)
    ? fallbackResolution.action_buttons
    : [];
  const messageMode = fallbackResolution?.message_mode
    ? fallbackResolution.message_mode
    : REMINDER_TYPES.has(messageType)
      ? 'telegram_pre_trip_reminder'
      : POST_TRIP_TYPES.has(messageType)
        ? 'telegram_post_trip_message'
        : 'telegram_service_message';

  return freezeSortedExecutionValue({
    response_version: TELEGRAM_SERVICE_MESSAGE_RESOLUTION_VERSION,
    read_only: true,
    message_type: messageType,
    message_mode: messageMode,
    related_booking_request_reference: context.bookingRequestReference,
    telegram_user_summary:
      fallbackResolution?.telegram_user_summary || context.telegramUserSummary,
    text_payload: {
      content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS[messageType],
      locale,
      fields: selectedFields,
      variables,
    },
    action_buttons: actionButtons,
    requested_booking_request_id: bookingRequestId,
  });
}

function buildExecutionResult({
  bookingRequestReference,
  messageType,
  executionStatus,
  templateReference,
  deliveryResultSummary,
  analyticsCaptureSummary,
  nowIso,
  planResult,
  intentResult,
}) {
  return freezeSortedExecutionValue({
    response_version: TELEGRAM_TEMPLATE_EXECUTION_RESULT_VERSION,
    executed_by: SERVICE_NAME,
    booking_request_reference: bookingRequestReference,
    message_type: messageType,
    execution_status: executionStatus,
    template_reference: templateReference || null,
    delivery_result_summary: deliveryResultSummary,
    analytics_capture_summary: analyticsCaptureSummary || null,
    dedupe_key:
      intentResult?.dedupe_key || planResult?.dedupe_key || deliveryResultSummary?.dedupe_key,
    idempotency_key:
      intentResult?.idempotency_key ||
      planResult?.idempotency_key ||
      deliveryResultSummary?.idempotency_key,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      deliveryResultSummary?.execution_result_summary?.persisted_attempt_reference?.event_at,
      planResult?.resolved_payload_summary_reference?.latest_timestamp_summary?.iso,
      intentResult?.latest_timestamp_summary?.iso
    ),
  });
}

function buildNotPossibleResult({
  bookingRequestReference,
  messageType,
  nowIso,
  reason,
}) {
  return freezeSortedExecutionValue({
    response_version: TELEGRAM_TEMPLATE_EXECUTION_RESULT_VERSION,
    executed_by: SERVICE_NAME,
    booking_request_reference: bookingRequestReference || null,
    message_type: messageType || null,
    execution_status: 'execution_not_possible',
    template_reference: null,
    delivery_result_summary: {
      run_status: null,
      skip_reason: null,
      blocked_reason: null,
      failed_reason: reason || 'execution_not_possible',
      execution_result_summary: null,
      persisted_attempt_reference: null,
      persisted_intent_reference: null,
      plan_send_decision: null,
    },
    analytics_capture_summary: null,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(nowIso),
  });
}

function buildBatchResult({ bookingRequestReference, scope, results, nowIso }) {
  const counters = {
    total_count: results.length,
    executed_with_managed_template: 0,
    executed_with_default_fallback: 0,
    execution_blocked: 0,
    execution_not_possible: 0,
  };
  for (const result of results) {
    if (Object.prototype.hasOwnProperty.call(counters, result.execution_status)) {
      counters[result.execution_status] += 1;
    }
  }

  return freezeSortedExecutionValue({
    response_version: TELEGRAM_TEMPLATE_EXECUTION_BATCH_RESULT_VERSION,
    executed_by: SERVICE_NAME,
    booking_request_reference: bookingRequestReference,
    execution_scope: scope,
    item_count: results.length,
    counters_summary: counters,
    results,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(
      nowIso,
      ...results.map((item) => item.latest_timestamp_summary?.iso)
    ),
  });
}

export class TelegramTemplateExecutionOrchestrationService {
  constructor({
    guestProfileService,
    serviceMessageResolutionService,
    serviceMessageTemplateManagementService,
    usefulContentFaqProjectionService = null,
    preTripReminderPlanningService,
    postTripMessagePlanningService,
    notificationDeliveryPlanningService,
    notificationIntentPersistenceService,
    notificationDeliveryRunService,
    runtimeAnalyticsAutoCaptureService = null,
    now = () => new Date(),
  }) {
    this.guestProfileService = guestProfileService;
    this.serviceMessageResolutionService = serviceMessageResolutionService;
    this.serviceMessageTemplateManagementService = serviceMessageTemplateManagementService;
    this.usefulContentFaqProjectionService = usefulContentFaqProjectionService;
    this.preTripReminderPlanningService = preTripReminderPlanningService;
    this.postTripMessagePlanningService = postTripMessagePlanningService;
    this.notificationDeliveryPlanningService = notificationDeliveryPlanningService;
    this.notificationIntentPersistenceService = notificationIntentPersistenceService;
    this.notificationDeliveryRunService = notificationDeliveryRunService;
    this.runtimeAnalyticsAutoCaptureService = runtimeAnalyticsAutoCaptureService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: SERVICE_NAME,
      status: 'telegram_template_execution_orchestration_ready',
      dependencyKeys: [
        'guestProfileService',
        'serviceMessageResolutionService',
        'serviceMessageTemplateManagementService',
        'usefulContentFaqProjectionService',
        'preTripReminderPlanningService',
        'postTripMessagePlanningService',
        'notificationDeliveryPlanningService',
        'notificationIntentPersistenceService',
        'notificationDeliveryRunService',
        'runtimeAnalyticsAutoCaptureService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      throw new Error('[TELEGRAM_TEMPLATE_EXECUTION] invalid clock timestamp');
    }
    return iso;
  }

  resolveBookingContext(bookingRequestReference) {
    const bookingRequestId = bookingRequestReference.booking_request_id;
    const profileView = this.guestProfileService.readGuestProfileView({
      booking_request_id: bookingRequestId,
    });
    const historyItem =
      profileView.booking_request_history.find(
        (item) => item.booking_request.booking_request_id === bookingRequestId
      ) || null;
    if (!historyItem) {
      throw new Error(
        `[TELEGRAM_TEMPLATE_EXECUTION] Booking request is not projectable: ${bookingRequestId}`
      );
    }

    return freezeSortedExecutionValue({
      bookingRequestReference,
      profileView,
      historyItem,
      telegramUserSummary: freezeSortedExecutionValue({
        guest_profile_id: profileView.guest_identity?.guest_profile_id || null,
        telegram_user_id: profileView.guest_identity?.telegram_user_id || null,
        display_name: profileView.guest_identity?.display_name || null,
        username: profileView.guest_identity?.username || null,
        language_code: profileView.guest_identity?.language_code || null,
        consent_status: profileView.guest_identity?.consent_status || null,
        profile_status: profileView.guest_identity?.profile_status || null,
      }),
    });
  }

  resolvePlanningGate(messageType, bookingRequestReference, input = {}) {
    if (REMINDER_TYPES.has(messageType)) {
      const planned =
        this.preTripReminderPlanningService.planRemindersByBookingRequestReference({
          booking_request_reference: bookingRequestReference,
          reminder_type: messageType,
        });
      const item = planned.items?.[0] || null;
      if (!item || item.reminder_planning_status !== 'reminder_planned') {
        throw new Error(
          `[TELEGRAM_TEMPLATE_EXECUTION] Reminder execution is not possible: ${
            item?.reminder_planning_status || 'reminder_not_projectable'
          }`
        );
      }
      return freezeSortedExecutionValue({
        planning_type: 'pre_trip_reminder',
        planning_item: item,
      });
    }

    if (POST_TRIP_TYPES.has(messageType)) {
      const planned =
        this.postTripMessagePlanningService.planPostTripMessagesByBookingRequestReference({
          booking_request_reference: bookingRequestReference,
          post_trip_message_type: messageType,
        });
      const item = planned.items?.[0] || null;
      if (!item || item.planning_status !== 'post_trip_planned') {
        throw new Error(
          `[TELEGRAM_TEMPLATE_EXECUTION] Post-trip execution is not possible: ${
            item?.planning_status || 'post_trip_not_projectable'
          }`
        );
      }
      return freezeSortedExecutionValue({
        planning_type: 'post_trip_message',
        planning_item: item,
      });
    }

    if (input.planning_gate) {
      return input.planning_gate;
    }

    return freezeSortedExecutionValue({
      planning_type: 'service_message',
      planning_item: null,
    });
  }

  resolveDefaultResolution(messageType, bookingRequestReference) {
    if (REMINDER_TYPES.has(messageType) || POST_TRIP_TYPES.has(messageType)) {
      return null;
    }

    return this.serviceMessageResolutionService.resolveServiceMessage({
      message_type: messageType,
      booking_request_reference: bookingRequestReference,
    });
  }

  resolveManagedTemplate(messageType) {
    const templateReference = buildTemplateReferenceByType(messageType);
    let templateItem = null;
    try {
      templateItem =
        this.serviceMessageTemplateManagementService
          .readServiceMessageTemplateByReference({
            template_reference: templateReference,
          })
          .service_message_template || null;
    } catch {
      templateItem = null;
    }

    if (!templateItem || templateItem.enabled_state_summary?.enabled !== true) {
      return freezeSortedExecutionValue({
        template_reference: null,
        managed_template_enabled: false,
        template_fields: null,
      });
    }

    return freezeSortedExecutionValue({
      template_reference: templateItem.template_reference || templateReference,
      managed_template_enabled: true,
      template_fields: {
        headline: normalizeString(templateItem.title_name_summary?.title_name),
        body: normalizeString(templateItem.text_body_summary?.text_body),
        status_line: null,
      },
    });
  }

  resolveReminderWeatherUsefulContentModel({
    messageType,
    bookingRequestReference,
    context,
    input,
  }) {
    if (!REMINDER_TYPES.has(messageType)) {
      return null;
    }
    if (
      !this.usefulContentFaqProjectionService ||
      typeof this.usefulContentFaqProjectionService.readWeatherUsefulContentModelForTelegramGuest !==
        'function'
    ) {
      return null;
    }

    const telegramUserId = normalizeString(context?.telegramUserSummary?.telegram_user_id);
    const telegramUserReference = telegramUserId
      ? {
          reference_type: 'telegram_user',
          telegram_user_id: telegramUserId,
        }
      : null;

    try {
      return this.usefulContentFaqProjectionService.readWeatherUsefulContentModelForTelegramGuest({
        booking_request_reference: bookingRequestReference,
        telegram_user_reference: telegramUserReference,
        reminder_type: messageType,
        weather_snapshot: input.weather_snapshot ?? input.weatherSnapshot ?? null,
      });
    } catch {
      return null;
    }
  }

  captureNotificationExecution(operationReference, operationResult, metadata = null) {
    if (!this.runtimeAnalyticsAutoCaptureService) {
      return null;
    }

    return this.runtimeAnalyticsAutoCaptureService.captureNotificationExecutionOutcome({
      operation_reference: operationReference,
      operation_result: operationResult,
      operation_payload: metadata,
    });
  }

  executeTemplateBackedNotificationByBookingRequestReference(input = {}) {
    const nowIso = this.nowIso();
    let bookingRequestReference = null;
    let messageType = null;

    try {
      bookingRequestReference = normalizeBookingRequestReference(input);
      messageType = normalizeMessageType(input);
      const context = this.resolveBookingContext(bookingRequestReference);
      this.resolvePlanningGate(messageType, bookingRequestReference, input);
      const defaultResolution = this.resolveDefaultResolution(
        messageType,
        bookingRequestReference
      );
      const fallbackFields = buildFallbackFields(messageType, defaultResolution);
      const reminderWeatherUsefulContentModel =
        this.resolveReminderWeatherUsefulContentModel({
          messageType,
          bookingRequestReference,
          context,
          input,
        });
      const reminderStatusLine = resolveReminderStatusLine(
        reminderWeatherUsefulContentModel,
        fallbackFields
      );
      const managedTemplate = this.resolveManagedTemplate(messageType);
      const selectedFields = managedTemplate.managed_template_enabled
        ? freezeSortedExecutionValue({
            headline:
              managedTemplate.template_fields?.headline || fallbackFields.headline || null,
            body: managedTemplate.template_fields?.body || fallbackFields.body || null,
            status_line: reminderStatusLine,
          })
        : freezeSortedExecutionValue({
            ...fallbackFields,
            status_line: reminderStatusLine,
          });
      const reminderWeatherVariables = REMINDER_TYPES.has(messageType)
        ? buildReminderWeatherVariables(reminderWeatherUsefulContentModel)
        : null;
      const deliveryResolution = buildNotificationResolution({
        messageType,
        context,
        fallbackResolution: defaultResolution,
        selectedFields,
        extraVariables: reminderWeatherVariables,
      });
      const planResult =
        this.notificationDeliveryPlanningService.planNotificationDelivery({
          service_message_resolution: deliveryResolution,
        });
      const intentResult =
        this.notificationIntentPersistenceService.persistNotificationIntent({
          notification_delivery_plan: planResult,
          actorType: 'system',
          actorId: SERVICE_NAME,
        });
      const runResult =
        this.notificationDeliveryRunService.runDeliveryForReadyNotificationItem({
          persisted_intent_reference: intentResult.persisted_intent_reference,
          actorType: 'system',
          actorId: SERVICE_NAME,
        });
      const executionStatus = mapRunStatusToExecutionStatus(
        runResult,
        managedTemplate.managed_template_enabled
      );
      const deliveryResultSummary = buildDeliveryResultSummary(
        runResult,
        planResult,
        intentResult
      );
      const operationReference =
        intentResult.idempotency_key ||
        planResult.idempotency_key ||
        `${messageType}:${bookingRequestReference.booking_request_id}:${nowIso}`;
      const operationResult = freezeSortedExecutionValue({
        booking_request_reference: bookingRequestReference,
        message_type: messageType,
        execution_status: executionStatus,
        template_reference: managedTemplate.template_reference,
        delivery_result_summary: deliveryResultSummary,
      });
      const analyticsCaptureSummary = this.captureNotificationExecution(
        operationReference,
        operationResult,
        {
          managed_template_enabled: managedTemplate.managed_template_enabled,
          run_status: runResult.run_status,
          weather_data_state: reminderWeatherVariables?.weather_data_state || null,
        }
      );

      return buildExecutionResult({
        bookingRequestReference,
        messageType,
        executionStatus,
        templateReference: managedTemplate.template_reference,
        deliveryResultSummary,
        analyticsCaptureSummary,
        nowIso,
        planResult,
        intentResult,
      });
    } catch (error) {
      return buildNotPossibleResult({
        bookingRequestReference,
        messageType,
        nowIso,
        reason: normalizeString(error?.message) || 'execution_not_possible',
      });
    }
  }

  executePlannedRemindersByBookingRequestReference(input = {}) {
    const nowIso = this.nowIso();
    const bookingRequestReference = normalizeBookingRequestReference(input);
    const planned = this.preTripReminderPlanningService.planRemindersByBookingRequestReference({
      booking_request_reference: bookingRequestReference,
    });
    const plannedItems = (planned.items || []).filter(
      (item) => item.reminder_planning_status === 'reminder_planned'
    );
    const results = plannedItems.map((item) =>
      this.executeTemplateBackedNotificationByBookingRequestReference({
        booking_request_reference: bookingRequestReference,
        message_type: item.reminder_type,
        planning_gate: {
          planning_type: 'pre_trip_reminder',
          planning_item: item,
        },
      })
    );

    return buildBatchResult({
      bookingRequestReference,
      scope: 'planned_reminders',
      results,
      nowIso,
    });
  }

  executePlannedPostTripMessagesByBookingRequestReference(input = {}) {
    const nowIso = this.nowIso();
    const bookingRequestReference = normalizeBookingRequestReference(input);
    const planned =
      this.postTripMessagePlanningService.planPostTripMessagesByBookingRequestReference({
        booking_request_reference: bookingRequestReference,
      });
    const plannedItems = (planned.items || []).filter(
      (item) => item.planning_status === 'post_trip_planned'
    );
    const results = plannedItems.map((item) =>
      this.executeTemplateBackedNotificationByBookingRequestReference({
        booking_request_reference: bookingRequestReference,
        message_type: item.post_trip_message_type,
        planning_gate: {
          planning_type: 'post_trip_message',
          planning_item: item,
        },
      })
    );

    return buildBatchResult({
      bookingRequestReference,
      scope: 'planned_post_trip_messages',
      results,
      nowIso,
    });
  }

  executeOne(input = {}) {
    return this.executeTemplateBackedNotificationByBookingRequestReference(input);
  }

  executePlannedRemindersForBookingRequest(input = {}) {
    return this.executePlannedRemindersByBookingRequestReference(input);
  }

  executePlannedPostTripMessagesForBookingRequest(input = {}) {
    return this.executePlannedPostTripMessagesByBookingRequestReference(input);
  }
}
