import {
  freezeTelegramHandoffValue,
  TELEGRAM_SELLER_WORK_QUEUE_ACTION_NAMES,
  TELEGRAM_SELLER_WORK_QUEUE_ACTIONS,
  TELEGRAM_SELLER_WORK_QUEUE_ACTIVE_REQUEST_STATUSES,
  TELEGRAM_SELLER_WORK_QUEUE_EVENT_TYPES,
} from '../../../shared/telegram/index.js';

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

const EXTENDABLE_HOLD_STATUSES = new Set([
  'ACTIVE',
  'EXTENDED',
]);

const PRESALE_QUEUE_COLUMNS = Object.freeze([
  'id',
  'boat_slot_id',
  'customer_name',
  'customer_phone',
  'number_of_seats',
  'total_price',
  'prepayment_amount',
  'status',
  'slot_uid',
  'payment_method',
  'payment_cash_amount',
  'payment_card_amount',
  'seller_id',
  'business_day',
  'created_at',
  'updated_at',
  'tickets_json',
]);

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`[TELEGRAM_SELLER_WORK_QUEUE] ${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeLimit(value, fallback = 50, max = 200) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function normalizeAction(action) {
  const normalized = String(action || '').trim();
  if (!TELEGRAM_SELLER_WORK_QUEUE_ACTION_NAMES.includes(normalized)) {
    throw new Error(`[TELEGRAM_SELLER_WORK_QUEUE] Unsupported seller action: ${normalized || 'unknown'}`);
  }

  return normalized;
}

function normalizeIdempotencyKey(idempotencyKey) {
  const normalized = String(idempotencyKey || '').trim();
  if (!normalized) {
    throw new Error('[TELEGRAM_SELLER_WORK_QUEUE] idempotencyKey is required');
  }

  return normalized;
}

function compareFrozenValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

export class TelegramSellerWorkQueueService {
  constructor({
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    sellerAttributionSessions,
    guestProfiles,
    bookingRequestService,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.sellerAttributionSessions = sellerAttributionSessions;
    this.guestProfiles = guestProfiles;
    this.bookingRequestService = bookingRequestService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'seller-work-queue-service',
      status: 'seller_queue_ready',
      dependencyKeys: [
        'bookingRequests',
        'bookingHolds',
        'bookingRequestEvents',
        'sellerAttributionSessions',
        'guestProfiles',
        'bookingRequestService',
      ],
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
        `[TELEGRAM_SELLER_WORK_QUEUE] Booking request not found: ${bookingRequestId}`
      );
    }

    return bookingRequest;
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  getSellerAttributionOrThrow(bookingRequest) {
    const attribution = this.sellerAttributionSessions.getById(
      bookingRequest.seller_attribution_session_id
    );
    if (!attribution) {
      throw new Error(
        `[TELEGRAM_SELLER_WORK_QUEUE] Seller attribution is missing for booking request: ${bookingRequest.booking_request_id}`
      );
    }

    return attribution;
  }

  assertSellerOwnsRequest(bookingRequest, sellerId) {
    const attribution = this.getSellerAttributionOrThrow(bookingRequest);
    if (Number(attribution.seller_id || 0) !== sellerId) {
      throw new Error(
        `[TELEGRAM_SELLER_WORK_QUEUE] Booking request is not assigned to seller: ${sellerId}`
      );
    }

    return attribution;
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

  hasHoldExtensionEvent(bookingRequestId) {
    return this.listRequestEvents(bookingRequestId).some(
      (event) => event.event_type === 'HOLD_EXTENDED'
    );
  }

  isHoldExtendable(bookingRequest, bookingHold) {
    if (!bookingHold || !EXTENDABLE_HOLD_STATUSES.has(bookingHold.hold_status)) {
      return false;
    }
    if (PREPAYMENT_FINAL_REQUEST_STATUSES.has(bookingRequest.request_status)) {
      return false;
    }
    if (this.hasHoldExtensionEvent(bookingRequest.booking_request_id)) {
      return false;
    }

    return new Date(bookingHold.hold_expires_at).getTime() > new Date(this.nowIso()).getTime();
  }

  listApplicableActions(bookingRequest, bookingHold = this.getHoldForRequest(bookingRequest.booking_request_id)) {
    const actions = [];
    const isClosed = CLOSED_REQUEST_STATUSES.has(bookingRequest.request_status);
    const isPrepaymentFinal = PREPAYMENT_FINAL_REQUEST_STATUSES.has(
      bookingRequest.request_status
    );

    if (!isClosed && !isPrepaymentFinal) {
      actions.push(TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.call_started);
      actions.push(TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.not_reached);
      actions.push(TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.prepayment_confirmed);
    }

    if (this.isHoldExtendable(bookingRequest, bookingHold)) {
      actions.push(TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.hold_extend);
    }

    return Object.freeze(actions);
  }

  listSellerOwnedBookingRequestIds(sellerId, { limit = 50 } = {}) {
    this.bookingRequests.assertReady();
    const normalizedLimit = normalizeLimit(limit);
    const placeholders = TELEGRAM_SELLER_WORK_QUEUE_ACTIVE_REQUEST_STATUSES
      .map(() => '?')
      .join(', ');

    return this.db
      .prepare(
        `
          SELECT br.booking_request_id
          FROM telegram_booking_requests br
          JOIN telegram_seller_attribution_sessions sas
            ON sas.seller_attribution_session_id = br.seller_attribution_session_id
          WHERE sas.seller_id = ?
            AND br.request_status IN (${placeholders})
          ORDER BY
            CASE br.request_status
              WHEN 'HOLD_ACTIVE' THEN 0
              WHEN 'WAITING_PREPAYMENT' THEN 1
              WHEN 'CONTACT_IN_PROGRESS' THEN 2
              WHEN 'NEW' THEN 3
              WHEN 'ATTRIBUTED' THEN 4
              WHEN 'PREPAYMENT_CONFIRMED' THEN 5
              WHEN 'CONFIRMED_TO_PRESALE' THEN 6
              ELSE 7
            END,
            br.last_status_at ASC,
            br.booking_request_id ASC
          LIMIT ?
        `
      )
      .all(
        sellerId,
        ...TELEGRAM_SELLER_WORK_QUEUE_ACTIVE_REQUEST_STATUSES,
        normalizedLimit
      )
      .map((row) => row.booking_request_id);
  }

  getPresaleColumns() {
    if (!this.db) {
      return [];
    }

    const table = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'presales'")
      .get();
    if (!table) {
      return [];
    }

    return this.db.prepare('PRAGMA table_info(presales)').all().map((column) => column.name);
  }

  readPresalesByIds(presaleIds) {
    const uniqueIds = [...new Set(presaleIds.filter(Boolean).map(Number))];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const availableColumns = new Set(this.getPresaleColumns());
    const selectedColumns = PRESALE_QUEUE_COLUMNS.filter((column) => availableColumns.has(column));
    if (!selectedColumns.includes('id')) {
      return new Map();
    }

    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `
          SELECT ${selectedColumns.map(quoteIdentifier).join(', ')}
          FROM presales
          WHERE id IN (${placeholders})
        `
      )
      .all(...uniqueIds)
      .map((row) => ({
        ...row,
        tickets_json: parseMaybeJson(row.tickets_json),
      }));

    return new Map(rows.map((row) => [Number(row.id), row]));
  }

  buildAttributionView(attribution) {
    return freezeTelegramHandoffValue({
      seller_attribution_session_id: attribution.seller_attribution_session_id,
      guest_profile_id: attribution.guest_profile_id,
      traffic_source_id: attribution.traffic_source_id,
      source_qr_code_id: attribution.source_qr_code_id,
      seller_id: attribution.seller_id,
      starts_at: attribution.starts_at,
      expires_at: attribution.expires_at,
      attribution_status: attribution.attribution_status,
      binding_reason: attribution.binding_reason,
    });
  }

  buildGuestView(guestProfile) {
    if (!guestProfile) {
      return null;
    }

    return freezeTelegramHandoffValue({
      guest_profile_id: guestProfile.guest_profile_id,
      telegram_user_id: guestProfile.telegram_user_id,
      display_name: guestProfile.display_name,
      username: guestProfile.username,
      language_code: guestProfile.language_code,
      phone_e164: guestProfile.phone_e164,
      profile_status: guestProfile.profile_status,
    });
  }

  buildQueueItem(bookingRequest, confirmedPresale = null) {
    const bookingHold = this.getHoldForRequest(bookingRequest.booking_request_id);
    const attribution = this.getSellerAttributionOrThrow(bookingRequest);
    const guestProfile = this.guestProfiles.getById(bookingRequest.guest_profile_id);
    const linkedPresale =
      confirmedPresale ||
      this.readPresalesByIds([bookingRequest.confirmed_presale_id]).get(
        Number(bookingRequest.confirmed_presale_id)
      ) ||
      null;

    return freezeTelegramHandoffValue({
      queue_item_type: bookingRequest.confirmed_presale_id
        ? 'linked_confirmed_presale'
        : 'active_booking_request',
      booking_request: bookingRequest,
      booking_hold: bookingHold,
      guest_profile: this.buildGuestView(guestProfile),
      seller_attribution: this.buildAttributionView(attribution),
      confirmed_presale: linkedPresale,
      available_actions: this.listApplicableActions(bookingRequest, bookingHold),
    });
  }

  listSellerWorkQueue(sellerId, { limit = 50 } = {}) {
    const normalizedSellerId = normalizePositiveInteger(sellerId, 'sellerId');
    const requestIds = this.listSellerOwnedBookingRequestIds(normalizedSellerId, { limit });
    const bookingRequests = requestIds.map((bookingRequestId) =>
      this.bookingRequests.getById(bookingRequestId)
    );
    const presalesById = this.readPresalesByIds(
      bookingRequests.map((bookingRequest) => bookingRequest.confirmed_presale_id)
    );

    return freezeTelegramHandoffValue({
      seller_id: normalizedSellerId,
      generated_at: this.nowIso(),
      items: bookingRequests.map((bookingRequest) =>
        this.buildQueueItem(
          bookingRequest,
          presalesById.get(Number(bookingRequest.confirmed_presale_id)) || null
        )
      ),
    });
  }

  buildActionSignature({ action, sellerId, bookingRequestId, actionPayload }) {
    return freezeTelegramHandoffValue({
      action,
      seller_id: sellerId,
      booking_request_id: bookingRequestId,
      action_payload: freezeTelegramHandoffValue(actionPayload || {}),
    });
  }

  buildActionMetadata({ action, sellerId, idempotencyKey, actionSignature }) {
    return freezeTelegramHandoffValue({
      idempotency_key: idempotencyKey,
      seller_work_queue_action: action,
      action_source: 'telegram_seller_work_queue',
      seller_id: sellerId,
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
      (event) => event.event_payload?.seller_work_queue_action
    );
    if (
      matchingActionEvent &&
      compareFrozenValues(matchingActionEvent.event_payload?.action_signature, actionSignature)
    ) {
      return matchingActionEvent;
    }

    throw new Error(
      `[TELEGRAM_SELLER_WORK_QUEUE] Idempotency conflict for booking request: ${bookingRequestId}`
    );
  }

  assertActionBeforePrepaymentFinal(bookingRequest, action) {
    if (CLOSED_REQUEST_STATUSES.has(bookingRequest.request_status)) {
      throw new Error(
        `[TELEGRAM_SELLER_WORK_QUEUE] Cannot apply ${action} to a closed booking request`
      );
    }

    if (PREPAYMENT_FINAL_REQUEST_STATUSES.has(bookingRequest.request_status)) {
      throw new Error(
        `[TELEGRAM_SELLER_WORK_QUEUE] Cannot apply ${action} after prepayment is final`
      );
    }
  }

  recordCallStarted({ bookingRequest, attribution, actorType, actorId, eventMetadata }) {
    this.assertActionBeforePrepaymentFinal(
      bookingRequest,
      TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.call_started
    );

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
      seller_attribution_session_id: attribution.seller_attribution_session_id,
      event_type: TELEGRAM_SELLER_WORK_QUEUE_EVENT_TYPES.call_started,
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

  applyAction({ bookingRequest, action, actorType, actorId, eventMetadata }) {
    if (action === TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.call_started) {
      return this.recordCallStarted({
        bookingRequest,
        attribution: this.getSellerAttributionOrThrow(bookingRequest),
        actorType,
        actorId,
        eventMetadata,
      });
    }

    if (action === TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.hold_extend) {
      this.assertActionBeforePrepaymentFinal(bookingRequest, action);
      const bookingHold = this.bookingRequestService.extendHoldOnce(
        bookingRequest.booking_request_id,
        {
          actorType,
          actorId,
          eventMetadata,
        }
      );
      const event = this.resolveIdempotentActionEvent({
        bookingRequestId: bookingRequest.booking_request_id,
        idempotencyKey: eventMetadata.idempotency_key,
        actionSignature: eventMetadata.action_signature,
      });

      return Object.freeze({
        bookingRequest: this.bookingRequests.getById(bookingRequest.booking_request_id),
        bookingHold,
        event,
      });
    }

    if (action === TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.not_reached) {
      this.assertActionBeforePrepaymentFinal(bookingRequest, action);
      const result = this.bookingRequestService.markSellerNotReached(
        bookingRequest.booking_request_id,
        {
          actorType,
          actorId,
          eventMetadata,
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

    if (action === TELEGRAM_SELLER_WORK_QUEUE_ACTIONS.prepayment_confirmed) {
      this.assertActionBeforePrepaymentFinal(bookingRequest, action);
      const result = this.bookingRequestService.confirmPrepayment(
        bookingRequest.booking_request_id,
        {
          actorType,
          actorId,
          eventMetadata,
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

    throw new Error(`[TELEGRAM_SELLER_WORK_QUEUE] Unsupported seller action: ${action}`);
  }

  buildActionResult({ outcome, action, sellerId, bookingRequestId, event }) {
    const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
    return freezeTelegramHandoffValue({
      outcome,
      action,
      seller_id: sellerId,
      booking_request_id: bookingRequestId,
      event,
      queue_item: this.buildQueueItem(bookingRequest),
    });
  }

  recordSellerAction({
    sellerId,
    bookingRequestId,
    action,
    idempotencyKey,
    actorType = 'seller',
    actorId = null,
    actionPayload = {},
  } = {}) {
    const runAction = () => {
      const normalizedSellerId = normalizePositiveInteger(sellerId, 'sellerId');
      const normalizedBookingRequestId = normalizePositiveInteger(
        bookingRequestId,
        'bookingRequestId'
      );
      const normalizedAction = normalizeAction(action);
      const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
      const normalizedActorId = actorId ?? String(normalizedSellerId);
      const bookingRequest = this.getBookingRequestOrThrow(normalizedBookingRequestId);
      this.assertSellerOwnsRequest(bookingRequest, normalizedSellerId);

      const actionSignature = this.buildActionSignature({
        action: normalizedAction,
        sellerId: normalizedSellerId,
        bookingRequestId: normalizedBookingRequestId,
        actionPayload,
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
          sellerId: normalizedSellerId,
          bookingRequestId: normalizedBookingRequestId,
          event: idempotentEvent,
        });
      }

      const eventMetadata = this.buildActionMetadata({
        action: normalizedAction,
        sellerId: normalizedSellerId,
        idempotencyKey: normalizedIdempotencyKey,
        actionSignature,
      });
      const applied = this.applyAction({
        bookingRequest,
        action: normalizedAction,
        actorType,
        actorId: String(normalizedActorId),
        eventMetadata,
      });

      return this.buildActionResult({
        outcome: 'applied',
        action: normalizedAction,
        sellerId: normalizedSellerId,
        bookingRequestId: applied.bookingRequest.booking_request_id,
        event: applied.event,
      });
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runAction)();
    }

    return runAction();
  }
}
