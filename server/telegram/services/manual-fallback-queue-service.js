import {
  freezeTelegramHandoffValue,
  TELEGRAM_MANUAL_FALLBACK_ACTION_NAMES,
  TELEGRAM_MANUAL_FALLBACK_ACTIONS,
  TELEGRAM_MANUAL_FALLBACK_EVENT_TYPES,
  SELLER_SOURCE_FAMILIES,
} from '../../../shared/telegram/index.js';

const MANUAL_FALLBACK_QUEUE_ITEM_TYPE = 'manual_fallback_request';
const MANUAL_FALLBACK_QUEUE_DEFAULT_LIMIT = 50;
const MANUAL_FALLBACK_QUEUE_MAX_LIMIT = 200;
const MANUAL_FALLBACK_QUEUE_SCAN_LIMIT = 500;
const MANUAL_ASSIGNMENT_SOURCE_FAMILY = 'seller_direct_link';
const CLOSED_REQUEST_STATUSES = new Set([
  'GUEST_CANCELLED',
  'HOLD_EXPIRED',
  'SELLER_NOT_REACHED',
  'CLOSED_UNCONVERTED',
]);
const PREPAYMENT_FINAL_REQUEST_STATUSES = new Set([
  'PREPAYMENT_CONFIRMED',
  'CONFIRMED_TO_PRESALE',
]);
const CALL_STARTED_MUTABLE_REQUEST_STATUSES = new Set([
  'NEW',
  'ATTRIBUTED',
]);

function normalizeLimit(value, fallback = MANUAL_FALLBACK_QUEUE_DEFAULT_LIMIT, max = MANUAL_FALLBACK_QUEUE_MAX_LIMIT) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`[TELEGRAM_MANUAL_FALLBACK_QUEUE] ${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeAction(action) {
  const normalized = String(action || '').trim();
  if (!TELEGRAM_MANUAL_FALLBACK_ACTION_NAMES.includes(normalized)) {
    throw new Error(
      `[TELEGRAM_MANUAL_FALLBACK_QUEUE] Unsupported manual fallback action: ${normalized || 'unknown'}`
    );
  }

  return normalized;
}

function normalizeIdempotencyKey(idempotencyKey) {
  const normalized = String(idempotencyKey || '').trim();
  if (!normalized) {
    throw new Error('[TELEGRAM_MANUAL_FALLBACK_QUEUE] idempotencyKey is required');
  }

  return normalized;
}

function normalizeActorType(actorType) {
  const normalized = String(actorType || 'owner').trim();
  if (!normalized) {
    throw new Error('[TELEGRAM_MANUAL_FALLBACK_QUEUE] actorType is required');
  }

  return normalized;
}

function normalizeActorId(actorId) {
  if (actorId === null || actorId === undefined) {
    return null;
  }

  const normalized = String(actorId).trim();
  return normalized || null;
}

function normalizeActionPayload(actionPayload) {
  if (actionPayload === null || actionPayload === undefined) {
    return {};
  }
  if (typeof actionPayload !== 'object' || Array.isArray(actionPayload)) {
    throw new Error('[TELEGRAM_MANUAL_FALLBACK_QUEUE] actionPayload must be an object');
  }

  return freezeTelegramHandoffValue(sortActionPayloadValue(actionPayload));
}

function sortActionPayloadValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortActionPayloadValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortActionPayloadValue(value[key])])
  );
}

function normalizeAssignSellerId(actionPayload) {
  const snakeCaseSellerId = actionPayload.seller_id;
  const camelCaseSellerId = actionPayload.sellerId;

  if (
    snakeCaseSellerId !== undefined &&
    camelCaseSellerId !== undefined &&
    Number(snakeCaseSellerId) !== Number(camelCaseSellerId)
  ) {
    throw new Error('[TELEGRAM_MANUAL_FALLBACK_QUEUE] seller_id payload fields conflict');
  }

  return normalizePositiveInteger(
    snakeCaseSellerId ?? camelCaseSellerId,
    'actionPayload.seller_id'
  );
}

function compareFrozenValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toIsoTimestamp(input) {
  const date = input instanceof Date ? input : new Date(input);
  return date.toISOString();
}

export class TelegramManualFallbackQueueService {
  constructor({
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    sellerAttributionSessions,
    trafficSources,
    sourceQRCodes,
    attributionService,
    bookingRequestService,
    presaleHandoffService,
    handoffReadinessQueryService,
    handoffExecutionQueryService,
    handoffExecutionService,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.trafficSources = trafficSources;
    this.sourceQRCodes = sourceQRCodes;
    this.attributionService = attributionService;
    this.bookingRequestService = bookingRequestService;
    this.presaleHandoffService = presaleHandoffService;
    this.handoffReadinessQueryService = handoffReadinessQueryService;
    this.handoffExecutionQueryService = handoffExecutionQueryService;
    this.handoffExecutionService = handoffExecutionService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'manual-fallback-queue-service',
      status: 'queue_ready',
      dependencyKeys: [
        'bookingRequests',
        'bookingHolds',
        'bookingRequestEvents',
        'sellerAttributionSessions',
        'trafficSources',
        'sourceQRCodes',
        'attributionService',
        'bookingRequestService',
        'presaleHandoffService',
        'handoffReadinessQueryService',
        'handoffExecutionQueryService',
        'handoffExecutionService',
      ],
    });
  }

  nowIso() {
    return toIsoTimestamp(this.now());
  }

  get db() {
    return this.bookingRequests.db;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      throw new Error(
        `[TELEGRAM_MANUAL_FALLBACK_QUEUE] Booking request not found: ${bookingRequestId}`
      );
    }

    return bookingRequest;
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  listRequestEvents(bookingRequestId) {
    this.bookingRequestEvents.assertReady();
    const { tableName, idColumn } = this.bookingRequestEvents;
    return this.bookingRequestEvents.db
      .prepare(
        `
          SELECT *
          FROM ${tableName}
          WHERE booking_request_id = ?
          ORDER BY ${idColumn} ASC
        `
      )
      .all(bookingRequestId)
      .map((row) => this.bookingRequestEvents.deserializeRow(row));
  }

  getAttributionBundle(bookingRequest) {
    const attributionSession = this.sellerAttributionSessions.getById(
      bookingRequest.seller_attribution_session_id
    );
    if (!attributionSession) {
      return {
        attributionSession: null,
        trafficSource: null,
        sourceQRCode: null,
        sourceFamily: null,
      };
    }

    const trafficSource = this.trafficSources.getById(attributionSession.traffic_source_id);
    const sourceQRCode = this.sourceQRCodes.getById(attributionSession.source_qr_code_id);
    const sourceFamily =
      attributionSession.binding_reason ||
      (trafficSource
        ? this.attributionService.classifySourceFamily({
            sourceType: trafficSource.source_type,
            entryChannel: sourceQRCode?.entry_context?.entry_channel || 'manual_fallback_queue',
          })
        : null);

    return {
      attributionSession,
      trafficSource,
      sourceQRCode,
      sourceFamily,
    };
  }

  buildManualFallbackClassification({
    attributionSession,
    sourceFamily,
    nowIso,
  }) {
    const nowMs = new Date(nowIso).getTime();
    const expiresAtMs = attributionSession?.expires_at
      ? new Date(attributionSession.expires_at).getTime()
      : null;
    const expiredAttribution = Boolean(attributionSession) && (
      attributionSession.attribution_status === 'EXPIRED' ||
      (expiresAtMs !== null && expiresAtMs <= nowMs)
    );
    const missingSeller = Boolean(attributionSession) && !attributionSession.seller_id;
    const nonSellerRouting =
      Boolean(sourceFamily) && !SELLER_SOURCE_FAMILIES.includes(sourceFamily);
    const hasActiveSellerAttribution = Boolean(
      attributionSession &&
        attributionSession.attribution_status === 'ACTIVE' &&
        !expiredAttribution &&
        !missingSeller &&
        !nonSellerRouting
    );
    const noActiveSellerAttribution = !hasActiveSellerAttribution;
    const manualFallbackReason = nonSellerRouting
      ? 'non_seller_routing'
      : missingSeller
        ? 'missing_seller'
        : expiredAttribution
          ? 'expired_attribution'
          : noActiveSellerAttribution
            ? 'no_active_seller_attribution'
            : null;

    return freezeTelegramHandoffValue({
      manual_fallback_reason: manualFallbackReason,
      no_active_seller_attribution: noActiveSellerAttribution,
      expired_attribution: expiredAttribution,
      missing_seller: missingSeller,
      non_seller_routing: nonSellerRouting,
    });
  }

  buildAttributionContext({
    bookingRequest,
    attributionSession,
    trafficSource,
    sourceQRCode,
    sourceFamily,
  }) {
    return freezeTelegramHandoffValue({
      seller_attribution_session_id:
        attributionSession?.seller_attribution_session_id ??
        bookingRequest?.seller_attribution_session_id ??
        null,
      traffic_source_id: trafficSource?.traffic_source_id ?? null,
      source_qr_code_id: sourceQRCode?.source_qr_code_id ?? null,
      seller_id: attributionSession?.seller_id ?? null,
      source_code: trafficSource?.source_code ?? null,
      source_type: trafficSource?.source_type ?? null,
      source_name: trafficSource?.source_name ?? null,
      source_family: sourceFamily ?? null,
      source_ownership: 'owner_manual',
      path_type: 'owner_manual',
      attribution_status: attributionSession?.attribution_status ?? null,
      attribution_expires_at: attributionSession?.expires_at ?? null,
      binding_reason: attributionSession?.binding_reason ?? null,
    });
  }

  getHandoffSnapshot(bookingRequest) {
    const preparedEvent = this.handoffReadinessQueryService.getPreparedEvent(
      bookingRequest.booking_request_id
    );

    if (!preparedEvent) {
      return null;
    }

    return this.handoffReadinessQueryService.buildPreparedRecord(bookingRequest, preparedEvent);
  }

  getCurrentExecutionState(bookingRequestId, handoffSnapshot) {
    if (!handoffSnapshot) {
      return null;
    }

    return this.handoffExecutionQueryService
      .readExecutionState(bookingRequestId)
      .current_execution_state;
  }

  listApplicableActions(bookingRequest) {
    if (
      CLOSED_REQUEST_STATUSES.has(bookingRequest.request_status) ||
      PREPAYMENT_FINAL_REQUEST_STATUSES.has(bookingRequest.request_status)
    ) {
      return Object.freeze([]);
    }

    return Object.freeze([
      TELEGRAM_MANUAL_FALLBACK_ACTIONS.call_started,
      TELEGRAM_MANUAL_FALLBACK_ACTIONS.not_reached,
      TELEGRAM_MANUAL_FALLBACK_ACTIONS.assign_to_seller,
      TELEGRAM_MANUAL_FALLBACK_ACTIONS.manual_prepayment_confirmed,
    ]);
  }

  buildQueueItem(bookingRequest) {
    const bundle = this.getAttributionBundle(bookingRequest);
    const classification = this.buildManualFallbackClassification({
      attributionSession: bundle.attributionSession,
      sourceFamily: bundle.sourceFamily,
      nowIso: this.nowIso(),
    });

    if (!classification.manual_fallback_reason) {
      return null;
    }

    const handoffSnapshot = this.getHandoffSnapshot(bookingRequest);
    const currentTelegramExecutionState = this.getCurrentExecutionState(
      bookingRequest.booking_request_id,
      handoffSnapshot
    );
    const bookingHold = this.getHoldForRequest(bookingRequest.booking_request_id);

    return freezeTelegramHandoffValue({
      queue_item_type: MANUAL_FALLBACK_QUEUE_ITEM_TYPE,
      booking_request: bookingRequest,
      booking_hold: bookingHold,
      manual_fallback_classification: classification,
      attribution_context: this.buildAttributionContext({
        bookingRequest,
        attributionSession: bundle.attributionSession,
        trafficSource: bundle.trafficSource,
        sourceQRCode: bundle.sourceQRCode,
        sourceFamily: bundle.sourceFamily,
      }),
      handoff_snapshot: handoffSnapshot,
      current_telegram_execution_state: currentTelegramExecutionState,
      available_actions: this.listApplicableActions(bookingRequest),
    });
  }

  listManualFallbackQueue({ limit = MANUAL_FALLBACK_QUEUE_DEFAULT_LIMIT } = {}) {
    const normalizedLimit = normalizeLimit(limit);
    const candidates = this.bookingRequests.listBy(
      {},
      {
        orderBy: 'last_status_at DESC, booking_request_id DESC',
        limit: MANUAL_FALLBACK_QUEUE_SCAN_LIMIT,
      }
    );
    const items = [];

    for (const bookingRequest of candidates) {
      const queueItem = this.buildQueueItem(bookingRequest);
      if (!queueItem) {
        continue;
      }

      items.push(queueItem);
      if (items.length >= normalizedLimit) {
        break;
      }
    }

    return freezeTelegramHandoffValue({
      generated_at: this.nowIso(),
      items,
    });
  }

  readManualFallbackRequest(bookingRequestId) {
    const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
    const queueItem = this.buildQueueItem(bookingRequest);

    if (!queueItem) {
      throw new Error(
        `[TELEGRAM_MANUAL_FALLBACK_QUEUE] Booking request is not a manual fallback request: ${bookingRequestId}`
      );
    }

    return queueItem;
  }

  buildActionSignature({
    action,
    bookingRequestId,
    actorType,
    actorId,
    actionPayload,
  }) {
    return freezeTelegramHandoffValue({
      action,
      booking_request_id: bookingRequestId,
      actor_type: actorType,
      actor_id: actorId,
      action_payload: freezeTelegramHandoffValue(actionPayload || {}),
    });
  }

  buildActionMetadata({
    action,
    idempotencyKey,
    actionSignature,
    manualFallbackClassification,
  }) {
    return freezeTelegramHandoffValue({
      idempotency_key: idempotencyKey,
      manual_fallback_action: action,
      action_source: 'telegram_manual_fallback_queue',
      manual_fallback_classification: manualFallbackClassification,
      action_signature: actionSignature,
    });
  }

  resolveIdempotentActionEvent({ bookingRequestId, idempotencyKey, actionSignature }) {
    const matchingEvents = this.listRequestEvents(bookingRequestId).filter(
      (event) => event.event_payload?.idempotency_key === idempotencyKey
    );
    if (matchingEvents.length === 0) {
      return null;
    }

    const matchingActionEvent = matchingEvents.find(
      (event) => event.event_payload?.manual_fallback_action
    );
    if (
      matchingActionEvent &&
      compareFrozenValues(matchingActionEvent.event_payload?.action_signature, actionSignature)
    ) {
      return matchingActionEvent;
    }

    throw new Error(
      `[TELEGRAM_MANUAL_FALLBACK_QUEUE] Idempotency conflict for booking request: ${bookingRequestId}`
    );
  }

  assertActionableRequest(bookingRequest, action) {
    if (CLOSED_REQUEST_STATUSES.has(bookingRequest.request_status)) {
      throw new Error(
        `[TELEGRAM_MANUAL_FALLBACK_QUEUE] Cannot apply ${action} to a closed booking request`
      );
    }

    if (PREPAYMENT_FINAL_REQUEST_STATUSES.has(bookingRequest.request_status)) {
      throw new Error(
        `[TELEGRAM_MANUAL_FALLBACK_QUEUE] Cannot apply ${action} after prepayment is final`
      );
    }
  }

  assertActiveSellerExists(sellerId) {
    const seller = this.db
      .prepare(
        `
          SELECT id
          FROM users
          WHERE id = ? AND role = 'seller' AND is_active = 1
        `
      )
      .get(sellerId);

    if (!seller) {
      throw new Error(
        `[TELEGRAM_MANUAL_FALLBACK_QUEUE] Seller not found or inactive: ${sellerId}`
      );
    }
  }

  readActionQueueItem(bookingRequestId) {
    try {
      return this.readManualFallbackRequest(bookingRequestId);
    } catch (error) {
      if (String(error?.message || '').includes('not a manual fallback request')) {
        return null;
      }

      throw error;
    }
  }

  recordManualFallbackAssignToSeller({
    bookingRequest,
    actorType,
    actorId,
    eventMetadata,
    actionPayload,
  }) {
    const action = TELEGRAM_MANUAL_FALLBACK_ACTIONS.assign_to_seller;
    this.assertActionableRequest(bookingRequest, action);

    const sellerId = normalizeAssignSellerId(actionPayload);
    this.assertActiveSellerExists(sellerId);

    const priorAttributionSession = this.sellerAttributionSessions.getById(
      bookingRequest.seller_attribution_session_id
    );
    if (!priorAttributionSession) {
      throw new Error(
        `[TELEGRAM_MANUAL_FALLBACK_QUEUE] Seller attribution is missing for booking request: ${bookingRequest.booking_request_id}`
      );
    }

    const eventAt = this.nowIso();
    const nextAttributionSession = this.attributionService.createSellerAttributionSession({
      guestProfileId: bookingRequest.guest_profile_id,
      trafficSourceId: priorAttributionSession.traffic_source_id,
      sourceQRCodeId: priorAttributionSession.source_qr_code_id,
      sellerId,
      sourceFamily: MANUAL_ASSIGNMENT_SOURCE_FAMILY,
      startsAt: eventAt,
    });
    const requestPatch = {
      seller_attribution_session_id:
        nextAttributionSession.seller_attribution_session_id,
    };

    if (bookingRequest.request_status === 'NEW') {
      requestPatch.request_status = 'ATTRIBUTED';
      requestPatch.last_status_at = eventAt;
    }

    const updatedRequest = this.bookingRequests.updateById(
      bookingRequest.booking_request_id,
      requestPatch
    );
    const bookingHold = this.getHoldForRequest(bookingRequest.booking_request_id);
    const event = this.bookingRequestEvents.create({
      booking_request_id: bookingRequest.booking_request_id,
      booking_hold_id: bookingHold?.booking_hold_id || null,
      seller_attribution_session_id:
        nextAttributionSession.seller_attribution_session_id,
      event_type: TELEGRAM_MANUAL_FALLBACK_EVENT_TYPES.assigned_to_seller,
      event_at: eventAt,
      actor_type: actorType,
      actor_id: actorId,
      event_payload: {
        ...eventMetadata,
        prior_request_status: bookingRequest.request_status,
        request_status: updatedRequest.request_status,
        prior_seller_attribution_session_id:
          priorAttributionSession.seller_attribution_session_id,
        seller_attribution_session_id:
          nextAttributionSession.seller_attribution_session_id,
        seller_id: sellerId,
        source_family: MANUAL_ASSIGNMENT_SOURCE_FAMILY,
        source_ownership: 'seller',
        path_type: 'seller_attributed',
      },
    });

    return Object.freeze({
      bookingRequest: updatedRequest,
      bookingHold,
      event,
    });
  }

  recordManualFallbackPrepaymentConfirmed({
    bookingRequest,
    actorType,
    actorId,
    eventMetadata,
  }) {
    const action = TELEGRAM_MANUAL_FALLBACK_ACTIONS.manual_prepayment_confirmed;
    this.assertActionableRequest(bookingRequest, action);

    const result = this.bookingRequestService.confirmPrepayment(
      bookingRequest.booking_request_id,
      {
        actorType,
        actorId,
        eventMetadata: {
          ...eventMetadata,
          prior_request_status: bookingRequest.request_status,
        },
      }
    );
    const event = this.resolveIdempotentActionEvent({
      bookingRequestId: bookingRequest.booking_request_id,
      idempotencyKey: eventMetadata.idempotency_key,
      actionSignature: eventMetadata.action_signature,
    });
    const handoffPrepared = this.presaleHandoffService.prepareHandoff(
      result.bookingRequest.booking_request_id,
      {
        actorType,
        actorId,
      }
    );
    const handoffExecution = this.handoffExecutionService.queueForHandoff(
      result.bookingRequest.booking_request_id,
      {
        actorType,
        actorId,
        queueReason: 'manual_fallback_prepayment_confirmed',
        queueMetadata: {
          idempotency_key: eventMetadata.idempotency_key,
          manual_fallback_action: action,
          confirmation_event_id: event.booking_request_event_id,
        },
      }
    );

    return Object.freeze({
      bookingRequest: result.bookingRequest,
      bookingHold: result.bookingHold,
      event,
      handoffPrepared,
      handoffExecution,
    });
  }

  recordManualFallbackCallStarted({ bookingRequest, actorType, actorId, eventMetadata }) {
    const action = TELEGRAM_MANUAL_FALLBACK_ACTIONS.call_started;
    this.assertActionableRequest(bookingRequest, action);

    const eventAt = this.nowIso();
    const updatedRequest = CALL_STARTED_MUTABLE_REQUEST_STATUSES.has(
      bookingRequest.request_status
    )
      ? this.bookingRequests.updateById(bookingRequest.booking_request_id, {
          request_status: 'CONTACT_IN_PROGRESS',
          last_status_at: eventAt,
        })
      : bookingRequest;
    const bookingHold = this.getHoldForRequest(bookingRequest.booking_request_id);
    const event = this.bookingRequestEvents.create({
      booking_request_id: bookingRequest.booking_request_id,
      booking_hold_id: bookingHold?.booking_hold_id || null,
      seller_attribution_session_id: bookingRequest.seller_attribution_session_id,
      event_type: TELEGRAM_MANUAL_FALLBACK_EVENT_TYPES.call_started,
      event_at: eventAt,
      actor_type: actorType,
      actor_id: actorId,
      event_payload: {
        ...eventMetadata,
        prior_request_status: bookingRequest.request_status,
        request_status: updatedRequest.request_status,
      },
    });

    return Object.freeze({
      bookingRequest: updatedRequest,
      bookingHold,
      event,
    });
  }

  recordManualFallbackNotReached({ bookingRequest, actorType, actorId, eventMetadata }) {
    const action = TELEGRAM_MANUAL_FALLBACK_ACTIONS.not_reached;
    this.assertActionableRequest(bookingRequest, action);

    const result = this.bookingRequestService.markSellerNotReached(
      bookingRequest.booking_request_id,
      {
        actorType,
        actorId,
        eventMetadata: {
          ...eventMetadata,
          prior_request_status: bookingRequest.request_status,
        },
      }
    );
    const event = this.resolveIdempotentActionEvent({
      bookingRequestId: bookingRequest.booking_request_id,
      idempotencyKey: eventMetadata.idempotency_key,
      actionSignature: eventMetadata.action_signature,
    });

    return Object.freeze({
      bookingRequest: result.bookingRequest,
      bookingHold: result.bookingHold,
      event,
    });
  }

  applyManualFallbackAction({
    bookingRequest,
    action,
    actorType,
    actorId,
    eventMetadata,
    actionPayload,
  }) {
    if (action === TELEGRAM_MANUAL_FALLBACK_ACTIONS.call_started) {
      return this.recordManualFallbackCallStarted({
        bookingRequest,
        actorType,
        actorId,
        eventMetadata,
      });
    }

    if (action === TELEGRAM_MANUAL_FALLBACK_ACTIONS.not_reached) {
      return this.recordManualFallbackNotReached({
        bookingRequest,
        actorType,
        actorId,
        eventMetadata,
      });
    }

    if (action === TELEGRAM_MANUAL_FALLBACK_ACTIONS.assign_to_seller) {
      return this.recordManualFallbackAssignToSeller({
        bookingRequest,
        actorType,
        actorId,
        eventMetadata,
        actionPayload,
      });
    }

    if (action === TELEGRAM_MANUAL_FALLBACK_ACTIONS.manual_prepayment_confirmed) {
      return this.recordManualFallbackPrepaymentConfirmed({
        bookingRequest,
        actorType,
        actorId,
        eventMetadata,
      });
    }

    throw new Error(`[TELEGRAM_MANUAL_FALLBACK_QUEUE] Unsupported manual fallback action: ${action}`);
  }

  buildActionResult({
    outcome,
    action,
    bookingRequestId,
    event,
    handoffPrepared = null,
    handoffExecution = null,
  }) {
    return freezeTelegramHandoffValue({
      outcome,
      action,
      booking_request_id: bookingRequestId,
      event,
      queue_item: this.readActionQueueItem(bookingRequestId),
      handoff_prepared: handoffPrepared,
      handoff_execution: handoffExecution,
    });
  }

  recordManualFallbackAction({
    bookingRequestId,
    action,
    idempotencyKey,
    actorType = 'owner',
    actorId = null,
    actionPayload = {},
  } = {}) {
    const runAction = () => {
      const normalizedBookingRequestId = normalizePositiveInteger(
        bookingRequestId,
        'bookingRequestId'
      );
      const normalizedAction = normalizeAction(action);
      const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
      const normalizedActorType = normalizeActorType(actorType);
      const normalizedActorId = normalizeActorId(actorId);
      const normalizedActionPayload = normalizeActionPayload(actionPayload);
      const actionSignature = this.buildActionSignature({
        action: normalizedAction,
        bookingRequestId: normalizedBookingRequestId,
        actorType: normalizedActorType,
        actorId: normalizedActorId,
        actionPayload: normalizedActionPayload,
      });
      const idempotentEvent = this.resolveIdempotentActionEvent({
        bookingRequestId: normalizedBookingRequestId,
        idempotencyKey: normalizedIdempotencyKey,
        actionSignature,
      });

      if (idempotentEvent) {
        return this.buildActionResult({
          outcome: 'idempotent_replay',
          action: normalizedAction,
          bookingRequestId: normalizedBookingRequestId,
          event: idempotentEvent,
        });
      }

      const manualFallbackRequest = this.readManualFallbackRequest(normalizedBookingRequestId);
      const eventMetadata = this.buildActionMetadata({
        action: normalizedAction,
        idempotencyKey: normalizedIdempotencyKey,
        actionSignature,
        manualFallbackClassification:
          manualFallbackRequest.manual_fallback_classification,
      });
      const applied = this.applyManualFallbackAction({
        bookingRequest: manualFallbackRequest.booking_request,
        action: normalizedAction,
        actorType: normalizedActorType,
        actorId: normalizedActorId,
        eventMetadata,
        actionPayload: normalizedActionPayload,
      });

      return this.buildActionResult({
        outcome: 'applied',
        action: normalizedAction,
        bookingRequestId: applied.bookingRequest.booking_request_id,
        event: applied.event,
        handoffPrepared: applied.handoffPrepared || null,
        handoffExecution: applied.handoffExecution || null,
      });
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runAction)();
    }

    return runAction();
  }
}
