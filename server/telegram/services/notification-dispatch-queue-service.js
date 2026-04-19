import {
  freezeTelegramHandoffValue,
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION,
  TELEGRAM_NOTIFICATION_DISPATCH_STATUS_NAMES,
  TELEGRAM_NOTIFICATION_DISPATCH_STATUSES,
  TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPE_NAMES,
  TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION,
  TELEGRAM_NOTIFICATION_INTENT_STATUSES,
  TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES,
} from '../../../shared/telegram/index.js';

const SERVICE_NAME = 'telegram_notification_dispatch_queue_projection_service';
const INTENT_SOURCE = 'telegram_notification_intent_persistence_service';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_SCAN_LIMIT = 1000;
const MAX_SCAN_LIMIT = 2000;
const SUPPORTED_NOTIFICATION_TYPES = new Set(TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES);

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeLimit(value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function normalizeDispatchStatuses(value) {
  const rawStatuses = value === undefined || value === null
    ? TELEGRAM_NOTIFICATION_DISPATCH_STATUS_NAMES
    : Array.isArray(value)
      ? value
      : [value];
  const normalizedStatuses = rawStatuses.map(normalizeString).filter(Boolean);
  const unsupportedStatuses = normalizedStatuses.filter(
    (status) => !TELEGRAM_NOTIFICATION_DISPATCH_STATUS_NAMES.includes(status)
  );

  if (unsupportedStatuses.length > 0) {
    throw new Error(
      `[TELEGRAM_NOTIFICATION_DISPATCH_QUEUE] Unsupported dispatch status: ${unsupportedStatuses[0]}`
    );
  }

  return new Set(
    normalizedStatuses.length > 0
      ? normalizedStatuses
      : TELEGRAM_NOTIFICATION_DISPATCH_STATUS_NAMES
  );
}

function pickDispatchStatuses(input = {}) {
  return (
    input.dispatch_statuses ??
    input.dispatchStatuses ??
    input.dispatch_status ??
    input.dispatchStatus ??
    input.statuses ??
    input.status
  );
}

function buildPersistedIntentReference(event) {
  return freezeTelegramHandoffValue({
    reference_type: 'telegram_booking_request_event',
    booking_request_event_id: event.booking_request_event_id,
    booking_request_id: event.booking_request_id,
    event_type: event.event_type,
  });
}

function buildNoOpGuards() {
  return freezeTelegramHandoffValue({
    telegram_message_sent: false,
    delivery_attempt_row_created: false,
    notification_log_row_created: false,
    bot_handlers_invoked: false,
    mini_app_ui_invoked: false,
    seller_owner_admin_ui_invoked: false,
    production_routes_invoked: false,
    money_ledger_written: false,
  });
}

function buildSuppressionBlockState(payload) {
  const sendDecision = payload.send_decision || {};
  const safeBlockReasons = Array.isArray(sendDecision.safe_block_reasons)
    ? sendDecision.safe_block_reasons
    : [];
  const suppressionReason = normalizeString(payload.suppression_reason);
  const blockReason = normalizeString(payload.block_reason);
  const hasSuppression = Boolean(suppressionReason);
  const hasBlock =
    Boolean(blockReason) ||
    safeBlockReasons.length > 0 ||
    sendDecision.send_allowed === false ||
    sendDecision.should_send === false;

  if (!hasSuppression && !hasBlock) {
    return null;
  }

  return freezeTelegramHandoffValue({
    state: hasBlock
      ? TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.blocked
      : TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.suppressed,
    suppression_reason: suppressionReason,
    block_reason: blockReason,
    safe_block_reasons: safeBlockReasons,
    send_allowed: sendDecision.send_allowed ?? null,
    should_send: sendDecision.should_send ?? null,
  });
}

function buildDispatchStatusProjection(payload, suppressionBlockState) {
  const intentStatus = normalizeString(payload.intent_status);
  const suppressionReason = normalizeString(payload.suppression_reason);
  const blockReason = normalizeString(payload.block_reason);
  const status = suppressionBlockState?.state ||
    (intentStatus === TELEGRAM_NOTIFICATION_INTENT_STATUSES.created
      ? TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.pending
      : TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.suppressed);

  return freezeTelegramHandoffValue({
    status,
    intent_status: intentStatus,
    dispatchable: status === TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.pending,
    delivery_attempt_state: 'not_attempted',
    projected_from: 'persisted_notification_intent',
    reason: blockReason || suppressionReason,
  });
}

function isSupportedPersistedIntentEvent(event) {
  const payload = event?.event_payload || {};

  return (
    TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPE_NAMES.includes(event?.event_type) &&
    payload.response_version === TELEGRAM_NOTIFICATION_INTENT_PERSISTENCE_VERSION &&
    payload.notification_intent_source === INTENT_SOURCE &&
    SUPPORTED_NOTIFICATION_TYPES.has(payload.notification_type)
  );
}

export class TelegramNotificationDispatchQueueProjectionService {
  constructor({ bookingRequestEvents }) {
    this.bookingRequestEvents = bookingRequestEvents;
  }

  describe() {
    return Object.freeze({
      serviceName: 'notification-dispatch-queue-projection-service',
      status: 'read_only_queue_projection_ready',
      dependencyKeys: ['bookingRequestEvents'],
    });
  }

  get db() {
    return this.bookingRequestEvents.db;
  }

  listPersistedIntentEvents({ scanLimit = DEFAULT_SCAN_LIMIT } = {}) {
    this.bookingRequestEvents.assertReady();
    const { tableName, idColumn } = this.bookingRequestEvents;
    const normalizedScanLimit = normalizeLimit(scanLimit, DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT);
    const placeholders = TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPE_NAMES
      .map(() => '?')
      .join(', ');

    return this.db
      .prepare(
        `
          SELECT *
          FROM ${tableName}
          WHERE event_type IN (${placeholders})
          ORDER BY ${idColumn} ASC
          LIMIT ?
        `
      )
      .all(...TELEGRAM_NOTIFICATION_INTENT_EVENT_TYPE_NAMES, normalizedScanLimit)
      .map((row) => this.bookingRequestEvents.deserializeRow(row));
  }

  buildQueueItem(event) {
    const payload = event.event_payload || {};
    const suppressionBlockState = buildSuppressionBlockState(payload);

    return freezeTelegramHandoffValue({
      response_version: TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION,
      queue_item_type: TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
      notification_type: payload.notification_type || null,
      dispatch_status: buildDispatchStatusProjection(payload, suppressionBlockState),
      persisted_intent_reference: buildPersistedIntentReference(event),
      delivery_target_summary: payload.delivery_target_summary || null,
      dedupe_key: payload.dedupe_key || payload.idempotency_key || null,
      idempotency_key: payload.idempotency_key || payload.dedupe_key || null,
      resolved_payload_summary_reference:
        payload.resolved_payload_summary_reference || null,
      suppression_block_state: suppressionBlockState,
      read_only: true,
      projection_only: true,
      projected_by: SERVICE_NAME,
      no_op_guards: buildNoOpGuards(),
    });
  }

  listNotificationDispatchQueue(input = {}) {
    const normalizedLimit = normalizeLimit(input.limit);
    const dispatchStatuses = normalizeDispatchStatuses(pickDispatchStatuses(input));
    const items = [];

    for (const event of this.listPersistedIntentEvents({
      scanLimit: input.scanLimit ?? input.scan_limit,
    })) {
      if (!isSupportedPersistedIntentEvent(event)) {
        continue;
      }

      const item = this.buildQueueItem(event);
      if (!dispatchStatuses.has(item.dispatch_status.status)) {
        continue;
      }

      items.push(item);
      if (items.length >= normalizedLimit) {
        break;
      }
    }

    return freezeTelegramHandoffValue({
      response_version: TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION,
      read_only: true,
      projection_only: true,
      source: 'persisted_notification_intents',
      filters: {
        dispatch_statuses: [...dispatchStatuses],
        notification_types: TELEGRAM_SERVICE_MESSAGE_TYPE_NAMES,
      },
      items,
      no_op_guards: buildNoOpGuards(),
    });
  }

  listDispatchQueue(input = {}) {
    return this.listNotificationDispatchQueue(input);
  }

  listPendingDispatchQueue(input = {}) {
    return this.listNotificationDispatchQueue({
      ...input,
      dispatch_statuses: [TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.pending],
    });
  }

  listBlockedDispatchQueue(input = {}) {
    return this.listNotificationDispatchQueue({
      ...input,
      dispatch_statuses: [TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.blocked],
    });
  }

  listSuppressedDispatchQueue(input = {}) {
    return this.listNotificationDispatchQueue({
      ...input,
      dispatch_statuses: [TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.suppressed],
    });
  }
}
