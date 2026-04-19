import {
  buildTelegramBookingRequestEventReference,
  getTelegramHandoffExecutionStateForEventType,
  isTelegramHandoffExecutionTerminalState,
  TELEGRAM_HANDOFF_EXECUTION_EVENT_TYPES,
  TELEGRAM_HANDOFF_EXECUTION_RESULT_VERSION,
} from '../../../shared/telegram/index.js';
import {
  compareStableLifecycleValues,
  freezeSortedLifecycleValue,
  normalizePositiveInteger,
  normalizeString,
  normalizeTimestampSummary,
} from './booking-request-lifecycle-shared.js';

const ERROR_PREFIX = '[TELEGRAM_HANDOFF_EXECUTION]';

const TRANSITION_DEFINITIONS = Object.freeze({
  queued_for_handoff: Object.freeze({
    eventType: TELEGRAM_HANDOFF_EXECUTION_EVENT_TYPES.queued_for_handoff,
    allowedFrom: Object.freeze(['handoff_prepared']),
  }),
  handoff_started: Object.freeze({
    eventType: TELEGRAM_HANDOFF_EXECUTION_EVENT_TYPES.handoff_started,
    allowedFrom: Object.freeze(['queued_for_handoff']),
  }),
  handoff_blocked: Object.freeze({
    eventType: TELEGRAM_HANDOFF_EXECUTION_EVENT_TYPES.handoff_blocked,
    allowedFrom: Object.freeze(['queued_for_handoff', 'handoff_started']),
  }),
  handoff_consumed: Object.freeze({
    eventType: TELEGRAM_HANDOFF_EXECUTION_EVENT_TYPES.handoff_consumed,
    allowedFrom: Object.freeze(['handoff_started']),
  }),
});

function rejectExecution(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  return normalizeString(value);
}

function normalizeOptionalPositiveInteger(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return normalizePositiveInteger(value, label, rejectExecution);
}

function normalizeBooleanFlag(value) {
  return value === true || value === 1;
}

function normalizeTransitionMetadata(value) {
  if (value === null || value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    rejectExecution('transition metadata must be an object');
  }

  return freezeSortedLifecycleValue(value);
}

function pickBookingRequestReference(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return {
      reference_type: 'telegram_booking_request',
      booking_request_id: Number(input),
      guest_profile_id: null,
      seller_attribution_session_id: null,
    };
  }

  return (
    input.booking_request_reference ??
    input.bookingRequestReference ??
    input.reference ??
    input.booking_request ??
    input.bookingRequest ??
    input ??
    null
  );
}

function normalizeBookingRequestReferenceInput(rawReference) {
  if (!rawReference) {
    rejectExecution('booking request reference is required');
  }

  if (
    rawReference.reference_type &&
    rawReference.reference_type !== 'telegram_booking_request'
  ) {
    rejectExecution(
      `Unsupported booking-request reference type: ${
        rawReference.reference_type || 'unknown'
      }`
    );
  }

  return freezeSortedLifecycleValue({
    reference_type: 'telegram_booking_request',
    booking_request_id: normalizePositiveInteger(
      rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
      'booking_request_reference.booking_request_id',
      rejectExecution
    ),
    guest_profile_id: normalizeOptionalPositiveInteger(
      rawReference.guest_profile_id,
      'booking_request_reference.guest_profile_id'
    ),
    seller_attribution_session_id: normalizeOptionalPositiveInteger(
      rawReference.seller_attribution_session_id,
      'booking_request_reference.seller_attribution_session_id'
    ),
  });
}

function normalizeQueueTransition(input = {}) {
  return freezeSortedLifecycleValue({
    queue_reason:
      normalizeOptionalString(input.queue_reason ?? input.queueReason) ||
      'handoff_execution_queued',
    queue_metadata: normalizeTransitionMetadata(
      input.queue_metadata ?? input.queueMetadata
    ),
  });
}

function normalizeStartTransition(input = {}) {
  return freezeSortedLifecycleValue({
    start_reason:
      normalizeOptionalString(input.start_reason ?? input.startReason) ||
      'handoff_execution_started',
    start_metadata: normalizeTransitionMetadata(
      input.start_metadata ?? input.startMetadata
    ),
  });
}

function normalizeBlockTransition(input = {}) {
  const blockedReason =
    normalizeOptionalString(
      input.blocked_reason ?? input.blockedReason ?? input.block_reason ?? input.blockReason
    ) || 'handoff_execution_blocked';

  return freezeSortedLifecycleValue({
    blocked_reason: blockedReason,
    block_reason: blockedReason,
    retryable: normalizeBooleanFlag(input.retryable),
    block_metadata: normalizeTransitionMetadata(
      input.block_metadata ?? input.blockMetadata
    ),
  });
}

function normalizeConsumeTransition(input = {}) {
  return freezeSortedLifecycleValue({
    consume_reason:
      normalizeOptionalString(input.consume_reason ?? input.consumeReason) ||
      'handoff_execution_consumed',
    consume_metadata: normalizeTransitionMetadata(
      input.consume_metadata ?? input.consumeMetadata
    ),
  });
}

function normalizeTransitionForState(targetState, input = {}) {
  if (targetState === 'queued_for_handoff') {
    return normalizeQueueTransition(input);
  }
  if (targetState === 'handoff_started') {
    return normalizeStartTransition(input);
  }
  if (targetState === 'handoff_blocked') {
    return normalizeBlockTransition(input);
  }
  if (targetState === 'handoff_consumed') {
    return normalizeConsumeTransition(input);
  }

  rejectExecution(`Unknown execution state transition: ${targetState}`);
}

function normalizeExecutionInput(targetState, input = {}) {
  const bookingRequestReference = normalizeBookingRequestReferenceInput(
    pickBookingRequestReference(input)
  );
  const idempotencyKey =
    normalizeOptionalString(input.idempotency_key ?? input.idempotencyKey) ||
    `telegram_handoff_execution:${bookingRequestReference.booking_request_id}:${targetState}`;
  const transition = normalizeTransitionForState(targetState, input);

  return freezeSortedLifecycleValue({
    booking_request_reference: bookingRequestReference,
    actor_type: normalizeOptionalString(input.actor_type ?? input.actorType) || 'system',
    actor_id: normalizeOptionalString(input.actor_id ?? input.actorId) || null,
    target_state: targetState,
    blocked_reason:
      targetState === 'handoff_blocked' ? transition.blocked_reason : null,
    transition,
    dedupe_key: idempotencyKey,
    idempotency_key: idempotencyKey,
    transition_signature: {
      response_version: TELEGRAM_HANDOFF_EXECUTION_RESULT_VERSION,
      booking_request_reference: bookingRequestReference,
      target_state: targetState,
      transition,
      dedupe_key: idempotencyKey,
      idempotency_key: idempotencyKey,
    },
  });
}

function buildExecutionNoOpGuards() {
  return {
    handoff_snapshot_created: false,
    handoff_prepared: false,
    queued_for_handoff: false,
    handoff_started: false,
    handoff_blocked: false,
    handoff_consumed: false,
    production_presale_created: false,
    production_route_invoked: false,
    bot_command_handler_invoked: false,
    mini_app_ui_invoked: false,
    admin_ui_invoked: false,
    money_ledger_written: false,
  };
}

function formatStateLabel(executionState) {
  return executionState || 'handoff_prepared';
}

export class TelegramHandoffExecutionService {
  constructor({
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    handoffReadinessQueryService,
    handoffExecutionQueryService,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.handoffReadinessQueryService = handoffReadinessQueryService;
    this.handoffExecutionQueryService = handoffExecutionQueryService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'handoff-execution-service',
      status: 'execution_event_persistence_ready',
      dependencyKeys: [
        'bookingRequests',
        'bookingHolds',
        'bookingRequestEvents',
        'handoffReadinessQueryService',
        'handoffExecutionQueryService',
      ],
    });
  }

  nowIso() {
    const date = this.now();
    const iso = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    if (Number.isNaN(Date.parse(iso))) {
      rejectExecution('handoff execution clock returned an unusable timestamp');
    }

    return iso;
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  getTransitionDefinition(targetState) {
    const definition = TRANSITION_DEFINITIONS[targetState];
    if (!definition) {
      rejectExecution(`Unknown execution state transition: ${targetState}`);
    }

    return definition;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectExecution(`Invalid booking request reference: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  listPersistedExecutionEvents(bookingRequestId, { limit = 500 } = {}) {
    this.bookingRequestEvents.assertReady();
    const executionEventTypes = Object.values(TELEGRAM_HANDOFF_EXECUTION_EVENT_TYPES);
    const placeholders = executionEventTypes.map(() => '?').join(', ');
    const { db, tableName, idColumn } = this.bookingRequestEvents;
    const statement = db.prepare(`
      SELECT *
      FROM ${tableName}
      WHERE booking_request_id = ?
        AND event_type IN (${placeholders})
      ORDER BY ${idColumn} ASC
      LIMIT ?
    `);

    return statement
      .all(bookingRequestId, ...executionEventTypes, limit)
      .map((row) => this.bookingRequestEvents.deserializeRow(row));
  }

  listPersistedExecutionEventsByIdempotencyKey(idempotencyKey, { limit = 500 } = {}) {
    this.bookingRequestEvents.assertReady();
    const executionEventTypes = Object.values(TELEGRAM_HANDOFF_EXECUTION_EVENT_TYPES);
    const placeholders = executionEventTypes.map(() => '?').join(', ');
    const { db, tableName, idColumn } = this.bookingRequestEvents;
    const statement = db.prepare(`
      SELECT *
      FROM ${tableName}
      WHERE event_type IN (${placeholders})
      ORDER BY ${idColumn} ASC
      LIMIT ?
    `);

    return statement
      .all(...executionEventTypes, limit)
      .map((row) => this.bookingRequestEvents.deserializeRow(row))
      .filter((event) => event.event_payload?.idempotency_key === idempotencyKey);
  }

  getLatestPersistedExecutionEvent(bookingRequestId) {
    const events = this.listPersistedExecutionEvents(bookingRequestId, { limit: 500 });
    return events.length > 0 ? events[events.length - 1] : null;
  }

  resolveIdempotentExecutionEvent(normalizedInput) {
    const matchingEvents = this.listPersistedExecutionEventsByIdempotencyKey(
      normalizedInput.idempotency_key,
      { limit: 5000 }
    );
    if (matchingEvents.length === 0) {
      return null;
    }

    const matchingEvent = matchingEvents.find((event) =>
      compareStableLifecycleValues(
        event.event_payload?.transition_signature,
        normalizedInput.transition_signature
      )
    );
    if (matchingEvent) {
      return matchingEvent;
    }

    rejectExecution(
      `Idempotency conflict for ${normalizedInput.target_state}: ${normalizedInput.booking_request_reference.booking_request_id}`
    );
  }

  assertBookingRequestReferenceMatches(bookingRequest, bookingRequestReference) {
    if (
      bookingRequestReference.guest_profile_id !== null &&
      bookingRequestReference.guest_profile_id !== bookingRequest.guest_profile_id
    ) {
      rejectExecution(
        `Invalid booking request reference: ${bookingRequest.booking_request_id}`
      );
    }
    if (
      bookingRequestReference.seller_attribution_session_id !== null &&
      bookingRequestReference.seller_attribution_session_id !==
        bookingRequest.seller_attribution_session_id
    ) {
      rejectExecution(
        `Invalid booking request reference: ${bookingRequest.booking_request_id}`
      );
    }
  }

  assertAllowedTransition({ bookingRequestId, currentState, targetState }) {
    const definition = this.getTransitionDefinition(targetState);
    if (definition.allowedFrom.includes(currentState)) {
      return;
    }

    rejectExecution(
      `Invalid transition from ${formatStateLabel(currentState)} to ${targetState}: ${bookingRequestId}`
    );
  }

  buildExecutionEventPayload({
    normalizedInput,
    readinessRecord,
    currentState,
  }) {
    const noOpGuards = buildExecutionNoOpGuards();
    noOpGuards[normalizedInput.target_state] = true;

    return freezeSortedLifecycleValue({
      response_version: TELEGRAM_HANDOFF_EXECUTION_RESULT_VERSION,
      handoff_execution_source: 'telegram_handoff_execution_service',
      booking_request_reference: readinessRecord.booking_request_reference,
      handoff_snapshot_reference: readinessRecord.handoff_snapshot_reference,
      execution_state: normalizedInput.target_state,
      prior_execution_state: currentState,
      blocked_reason: normalizedInput.blocked_reason,
      transition: normalizedInput.transition,
      dedupe_key: normalizedInput.dedupe_key,
      idempotency_key: normalizedInput.idempotency_key,
      transition_signature: normalizedInput.transition_signature,
      no_op_guards: noOpGuards,
      prepared_event_id:
        readinessRecord.handoff_snapshot_reference?.handoff_prepared_event_id ??
        null,
    });
  }

  buildExecutionResultFromEvent(event, readinessRecord) {
    const executionState =
      event?.event_payload?.execution_state ||
      getTelegramHandoffExecutionStateForEventType(event?.event_type);
    const executionEventReference = buildTelegramBookingRequestEventReference(event);
    const blockedReason =
      event?.event_payload?.blocked_reason ??
      event?.event_payload?.transition?.blocked_reason ??
      event?.event_payload?.transition?.block_reason ??
      null;

    return freezeSortedLifecycleValue({
      response_version: TELEGRAM_HANDOFF_EXECUTION_RESULT_VERSION,
      booking_request_reference: readinessRecord.booking_request_reference,
      handoff_snapshot_reference: readinessRecord.handoff_snapshot_reference,
      execution_state: executionState,
      execution_event_reference: executionEventReference,
      blocked_reason: blockedReason,
      latest_execution_timestamp_summary: normalizeTimestampSummary(event.event_at),
      dedupe_key: event?.event_payload?.dedupe_key ?? null,
      idempotency_key: event?.event_payload?.idempotency_key ?? null,
      handoff_snapshot: readinessRecord.handoff_snapshot,
      booking_request_id: readinessRecord.booking_request_reference.booking_request_id,
      guest_profile_id: readinessRecord.booking_request_reference.guest_profile_id,
      seller_attribution_session_id:
        readinessRecord.booking_request_reference.seller_attribution_session_id,
      request_status: readinessRecord.request_status,
      handoff_ready_state: readinessRecord.handoff_state,
      prepared_at: readinessRecord.prepared_at,
      handoff_prepared_event_id:
        readinessRecord.handoff_snapshot_reference?.handoff_prepared_event_id ?? null,
      current_execution_state: executionState,
      last_transition_at: event.event_at,
      last_transition_event_id: event.booking_request_event_id,
      handoff_blocked: executionState === 'handoff_blocked',
      handoff_consumed: executionState === 'handoff_consumed',
      handoff_terminal: isTelegramHandoffExecutionTerminalState(executionState),
      snapshot_payload: readinessRecord.handoff_snapshot,
      attribution_context: readinessRecord.attribution_context,
      transition: event?.event_payload?.transition || null,
    });
  }

  transition(targetState, input = {}, options = {}) {
    const runTransition = () => {
      const mergedInput =
        typeof input === 'object' && input !== null && !Array.isArray(input)
          ? { ...input, ...options }
          : { ...options, booking_request_reference: input };
      const normalizedInput = normalizeExecutionInput(targetState, mergedInput);
      const bookingRequest = this.getBookingRequestOrThrow(
        normalizedInput.booking_request_reference.booking_request_id
      );
      this.assertBookingRequestReferenceMatches(
        bookingRequest,
        normalizedInput.booking_request_reference
      );

      const readinessRecord =
        this.handoffReadinessQueryService.readPreparedRequest({
          booking_request_reference: normalizedInput.booking_request_reference,
        });
      const idempotentEvent =
        this.resolveIdempotentExecutionEvent(normalizedInput);
      if (idempotentEvent) {
        return this.buildExecutionResultFromEvent(idempotentEvent, readinessRecord);
      }

      const currentReadback =
        this.handoffExecutionQueryService.readCurrentExecutionStateByBookingRequestReference(
          {
            booking_request_reference: normalizedInput.booking_request_reference,
          }
        );
      this.assertAllowedTransition({
        bookingRequestId: bookingRequest.booking_request_id,
        currentState: currentReadback.execution_state,
        targetState,
      });

      const event = this.bookingRequestEvents.create({
        booking_request_id: bookingRequest.booking_request_id,
        booking_hold_id: this.getHoldForRequest(bookingRequest.booking_request_id)?.booking_hold_id || null,
        seller_attribution_session_id:
          bookingRequest.seller_attribution_session_id,
        event_type: this.getTransitionDefinition(targetState).eventType,
        event_at: this.nowIso(),
        actor_type: normalizedInput.actor_type,
        actor_id: normalizedInput.actor_id,
        event_payload: this.buildExecutionEventPayload({
          normalizedInput,
          readinessRecord,
          currentState: currentReadback.execution_state,
        }),
      });

      return this.buildExecutionResultFromEvent(event, readinessRecord);
    };

    if (typeof this.db?.transaction === 'function') {
      return this.db.transaction(runTransition)();
    }

    return runTransition();
  }

  markQueued(input = {}, options = {}) {
    return this.transition('queued_for_handoff', input, options);
  }

  markStarted(input = {}, options = {}) {
    return this.transition('handoff_started', input, options);
  }

  markBlocked(input = {}, options = {}) {
    return this.transition('handoff_blocked', input, options);
  }

  markConsumed(input = {}, options = {}) {
    return this.transition('handoff_consumed', input, options);
  }

  queueForHandoff(input = {}, options = {}) {
    return this.markQueued(input, options);
  }

  startHandoff(input = {}, options = {}) {
    return this.markStarted(input, options);
  }

  blockHandoff(input = {}, options = {}) {
    return this.markBlocked(input, options);
  }

  consumeHandoff(input = {}, options = {}) {
    return this.markConsumed(input, options);
  }
}
