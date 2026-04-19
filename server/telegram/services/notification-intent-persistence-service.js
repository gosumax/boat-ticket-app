import {
  freezeTelegramHandoffValue,
  TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES,
  TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPE_NAMES,
  TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
  TELEGRAM_NOTIFICATION_INTENT_STATUSES,
  TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES,
} from '../../../shared/telegram/index.js';
import {
  TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
  TELEGRAM_NOTIFICATION_DELIVERY_PLAN_VERSION,
  TELEGRAM_NOTIFICATION_SEND_TIMING_MODE,
} from './notification-delivery-planning-service.js';

const SERVICE_NAME = 'telegram_notification_intent_persistence_service';
const SUPPORTED_NOTIFICATION_TYPES = new Set(TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES);

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeActorType(value) {
  const normalized = normalizeString(value || 'system');
  if (!normalized) {
    throw new Error('[TELEGRAM_NOTIFICATION_INTENT] actorType is required');
  }

  return normalized;
}

function normalizeActorId(value) {
  return value === null || value === undefined ? null : normalizeString(value);
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`[TELEGRAM_NOTIFICATION_INTENT] ${label} must be a positive integer`);
  }

  return normalized;
}

function sortIntentValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortIntentValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortIntentValue(value[key])])
  );
}

function compareFrozenValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pickDeliveryPlan(input = {}) {
  if (input?.notification_delivery_plan) return input.notification_delivery_plan;
  if (input?.notificationDeliveryPlan) return input.notificationDeliveryPlan;
  if (input?.delivery_plan) return input.delivery_plan;
  if (input?.deliveryPlan) return input.deliveryPlan;
  if (input?.plan) return input.plan;
  if (input?.response_version) return input;

  return null;
}

function buildDeliveryTargetSummary(plan) {
  const target = plan.delivery_target || {};
  const payloadReference = plan.resolved_payload_summary_reference || {};

  return freezeTelegramHandoffValue(
    sortIntentValue({
      target_type: normalizeString(target.target_type),
      guest_profile_id: target.guest_profile_id ?? null,
      telegram_user_id: normalizeString(target.telegram_user_id),
      display_name: normalizeString(target.display_name),
      username: normalizeString(target.username),
      language_code: normalizeString(target.language_code),
      booking_request_id:
        target.booking_request_id ?? payloadReference.booking_request_id ?? null,
    })
  );
}

function getPrimaryBlockReason(sendDecision) {
  return normalizeString(
    sendDecision?.suppression_reason ||
      sendDecision?.block_reason ||
      sendDecision?.safe_block_reasons?.[0]?.reason
  );
}

function buildNoOpGuards(plan) {
  return freezeTelegramHandoffValue({
    ...(plan.no_op_guards || {}),
    telegram_message_sent: false,
    notification_log_row_created: false,
    bot_handlers_invoked: false,
    mini_app_ui_invoked: false,
    seller_owner_admin_ui_invoked: false,
    production_routes_invoked: false,
    money_ledger_written: false,
  });
}

function assertPlanningResult(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('[TELEGRAM_NOTIFICATION_INTENT] notification delivery plan is required');
  }
  if (plan.response_version !== TELEGRAM_NOTIFICATION_DELIVERY_PLAN_VERSION) {
    throw new Error('[TELEGRAM_NOTIFICATION_INTENT] Unsupported notification delivery plan version');
  }
  if (plan.read_only !== true || plan.planning_only !== true) {
    throw new Error('[TELEGRAM_NOTIFICATION_INTENT] Delivery plan must be read-only and planning-only');
  }
}

function normalizePlanningResult(plan) {
  assertPlanningResult(plan);

  const notificationType = normalizeString(plan.notification_type) || 'unknown';
  const dedupeKey = normalizeString(plan.dedupe_key ?? plan.idempotency_key);
  const idempotencyKey = normalizeString(plan.idempotency_key ?? plan.dedupe_key);

  if (!dedupeKey || !idempotencyKey) {
    throw new Error('[TELEGRAM_NOTIFICATION_INTENT] dedupe/idempotency key is required');
  }
  if (dedupeKey !== idempotencyKey) {
    throw new Error('[TELEGRAM_NOTIFICATION_INTENT] dedupe and idempotency keys must match');
  }

  const deliveryTargetSummary = buildDeliveryTargetSummary(plan);
  const bookingRequestId = normalizePositiveInteger(
    deliveryTargetSummary.booking_request_id,
    'delivery_target.booking_request_id'
  );
  const sendDecision = freezeTelegramHandoffValue(sortIntentValue(plan.send_decision || {}));
  const supportedType = SUPPORTED_NOTIFICATION_TYPES.has(notificationType);
  const planningAllowed =
    plan.send_decision?.should_send === true && plan.send_decision?.send_allowed !== false;
  const intentStatus =
    supportedType && planningAllowed
      ? TELEGRAM_NOTIFICATION_INTENT_STATUSES.created
      : TELEGRAM_NOTIFICATION_INTENT_STATUSES.suppressed;
  const eventType =
    intentStatus === TELEGRAM_NOTIFICATION_INTENT_STATUSES.created
      ? TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES.created
      : TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPES.suppressed;
  const planBlockReason = getPrimaryBlockReason(sendDecision);
  const suppressionReason = supportedType ? planBlockReason : 'unsupported_notification_type';
  const blockReason = supportedType ? planBlockReason : 'unsupported_notification_type';
  const resolvedPayloadSummaryReference = freezeTelegramHandoffValue(
    sortIntentValue(plan.resolved_payload_summary_reference || {})
  );
  const intentSignature = freezeTelegramHandoffValue(
    sortIntentValue({
      response_version: TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
      notification_type: notificationType,
      intent_status: intentStatus,
      delivery_channel:
        normalizeString(plan.delivery_channel) || TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
      send_timing_mode:
        normalizeString(plan.send_timing_mode) || TELEGRAM_NOTIFICATION_SEND_TIMING_MODE,
      delivery_target_summary: deliveryTargetSummary,
      resolved_payload_summary_reference: resolvedPayloadSummaryReference,
      send_decision: sendDecision,
      dedupe_key: dedupeKey,
      idempotency_key: idempotencyKey,
      suppression_reason: suppressionReason,
      block_reason: blockReason,
    })
  );

  return freezeTelegramHandoffValue({
    booking_request_id: bookingRequestId,
    notification_type: notificationType,
    intent_status: intentStatus,
    event_type: eventType,
    delivery_channel:
      normalizeString(plan.delivery_channel) || TELEGRAM_NOTIFICATION_DELIVERY_CHANNEL,
    send_timing_mode:
      normalizeString(plan.send_timing_mode) || TELEGRAM_NOTIFICATION_SEND_TIMING_MODE,
    delivery_target_summary: deliveryTargetSummary,
    resolved_payload_summary_reference: resolvedPayloadSummaryReference,
    send_decision: sendDecision,
    dedupe_key: dedupeKey,
    idempotency_key: idempotencyKey,
    suppression_reason: suppressionReason,
    block_reason: blockReason,
    no_op_guards: buildNoOpGuards(plan),
    intent_signature: intentSignature,
  });
}

function buildPersistedIntentReference(event) {
  return freezeTelegramHandoffValue({
    reference_type: 'telegram_booking_request_event',
    booking_request_event_id: event.booking_request_event_id,
    booking_request_id: event.booking_request_id,
    event_type: event.event_type,
  });
}

function buildResultFromEvent(event) {
  const eventPayload = event.event_payload || {};

  return freezeTelegramHandoffValue({
    response_version:
      eventPayload.response_version || TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
    notification_type: eventPayload.notification_type || null,
    intent_status: eventPayload.intent_status || null,
    persisted_intent_reference: buildPersistedIntentReference(event),
    delivery_target_summary: eventPayload.delivery_target_summary || null,
    dedupe_key: eventPayload.dedupe_key || eventPayload.idempotency_key || null,
    idempotency_key: eventPayload.idempotency_key || eventPayload.dedupe_key || null,
    suppression_reason: eventPayload.suppression_reason || null,
    block_reason: eventPayload.block_reason || null,
  });
}

export class TelegramNotificationIntentPersistenceService {
  constructor({
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'notification-intent-persistence-service',
      status: 'persistence_only_ready',
      dependencyKeys: ['bookingRequests', 'bookingHolds', 'bookingRequestEvents'],
    });
  }

  nowIso() {
    return this.now().toISOString();
  }

  get db() {
    return this.bookingRequests.db;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      throw new Error(
        `[TELEGRAM_NOTIFICATION_INTENT] Booking request not found: ${bookingRequestId}`
      );
    }

    return bookingRequest;
  }

  assertPlanMatchesBookingRequest(bookingRequest, normalizedPlan) {
    const targetGuestProfileId = normalizedPlan.delivery_target_summary.guest_profile_id;
    if (
      targetGuestProfileId !== null &&
      targetGuestProfileId !== undefined &&
      Number(targetGuestProfileId) !== Number(bookingRequest.guest_profile_id)
    ) {
      throw new Error(
        `[TELEGRAM_NOTIFICATION_INTENT] Delivery target does not match booking request: ${bookingRequest.booking_request_id}`
      );
    }
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  listIntentEvents(bookingRequestId) {
    return this.bookingRequestEvents
      .listBy(
        { booking_request_id: bookingRequestId },
        { orderBy: 'booking_request_event_id ASC', limit: 500 }
      )
      .filter((event) => TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPE_NAMES.includes(event.event_type));
  }

  resolveIdempotentIntentEvent({ bookingRequestId, idempotencyKey, intentSignature }) {
    const matchingEvents = this.listIntentEvents(bookingRequestId).filter(
      (event) => event.event_payload?.idempotency_key === idempotencyKey
    );
    if (matchingEvents.length === 0) {
      return null;
    }

    const matchingIntentEvent = matchingEvents.find((event) =>
      compareFrozenValues(event.event_payload?.intent_signature, intentSignature)
    );
    if (matchingIntentEvent) {
      return matchingIntentEvent;
    }

    throw new Error(
      `[TELEGRAM_NOTIFICATION_INTENT] Idempotency conflict for booking request: ${bookingRequestId}`
    );
  }

  buildEventPayload(normalizedPlan) {
    return freezeTelegramHandoffValue({
      response_version: TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
      notification_intent_source: SERVICE_NAME,
      notification_type: normalizedPlan.notification_type,
      intent_status: normalizedPlan.intent_status,
      delivery_channel: normalizedPlan.delivery_channel,
      send_timing_mode: normalizedPlan.send_timing_mode,
      delivery_target_summary: normalizedPlan.delivery_target_summary,
      resolved_payload_summary_reference:
        normalizedPlan.resolved_payload_summary_reference,
      send_decision: normalizedPlan.send_decision,
      dedupe_key: normalizedPlan.dedupe_key,
      idempotency_key: normalizedPlan.idempotency_key,
      suppression_reason: normalizedPlan.suppression_reason,
      block_reason: normalizedPlan.block_reason,
      persistence_only: true,
      no_op_guards: normalizedPlan.no_op_guards,
      intent_signature: normalizedPlan.intent_signature,
    });
  }

  appendIntentEvent({ bookingRequest, normalizedPlan, actorType, actorId }) {
    const bookingHold = this.getHoldForRequest(bookingRequest.booking_request_id);

    return this.bookingRequestEvents.create({
      booking_request_id: bookingRequest.booking_request_id,
      booking_hold_id: bookingHold?.booking_hold_id || null,
      seller_attribution_session_id: bookingRequest.seller_attribution_session_id,
      event_type: normalizedPlan.event_type,
      event_at: this.nowIso(),
      actor_type: actorType,
      actor_id: actorId,
      event_payload: this.buildEventPayload(normalizedPlan),
    });
  }

  persistNotificationIntent(input = {}) {
    const runPersistence = () => {
      const deliveryPlan = pickDeliveryPlan(input);
      const normalizedPlan = normalizePlanningResult(deliveryPlan);
      const actorType = normalizeActorType(input.actorType || input.actor_type || 'system');
      const actorId = normalizeActorId(input.actorId ?? input.actor_id ?? null);
      const bookingRequest = this.getBookingRequestOrThrow(
        normalizedPlan.booking_request_id
      );

      this.assertPlanMatchesBookingRequest(bookingRequest, normalizedPlan);

      const idempotentEvent = this.resolveIdempotentIntentEvent({
        bookingRequestId: normalizedPlan.booking_request_id,
        idempotencyKey: normalizedPlan.idempotency_key,
        intentSignature: normalizedPlan.intent_signature,
      });
      if (idempotentEvent) {
        return buildResultFromEvent(idempotentEvent);
      }

      const event = this.appendIntentEvent({
        bookingRequest,
        normalizedPlan,
        actorType,
        actorId,
      });

      return buildResultFromEvent(event);
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runPersistence)();
    }

    return runPersistence();
  }
}
