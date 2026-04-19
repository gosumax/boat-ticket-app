import {
  buildTelegramHandoffExecutionHistoryRecord,
  buildTelegramHandoffExecutionReadback,
  TELEGRAM_HANDOFF_EXECUTION_EVENT_TYPES,
} from '../../../shared/telegram/index.js';

function normalizeLimit(limit, fallback = 200, max = 500) {
  const normalized = Number(limit);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

export class TelegramHandoffExecutionQueryService {
  constructor({
    bookingRequestEvents,
    handoffReadinessQueryService,
  }) {
    this.bookingRequestEvents = bookingRequestEvents;
    this.handoffReadinessQueryService = handoffReadinessQueryService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'handoff-execution-query-service',
      status: 'read_only_execution_projection_ready',
      dependencyKeys: ['bookingRequestEvents', 'handoffReadinessQueryService'],
    });
  }

  listExecutionEvents(bookingRequestId, { limit = 200 } = {}) {
    this.handoffReadinessQueryService.getBookingRequestOrThrow(bookingRequestId);
    this.bookingRequestEvents.assertReady();

    const normalizedLimit = normalizeLimit(limit);
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
      .all(bookingRequestId, ...executionEventTypes, normalizedLimit)
      .map((row) => this.bookingRequestEvents.deserializeRow(row));
  }

  listExecutionHistory(bookingRequestId, { limit = 200 } = {}) {
    return Object.freeze(
      this.listExecutionEvents(bookingRequestId, { limit }).map((event) =>
        buildTelegramHandoffExecutionHistoryRecord(event)
      )
    );
  }

  readCurrentExecutionStateByBookingRequestReference(input = {}, { limit = 200 } = {}) {
    const readinessRecord =
      this.handoffReadinessQueryService.readPreparedRequest(input);
    const executionHistory = this.listExecutionHistory(
      readinessRecord.booking_request_reference.booking_request_id,
      { limit }
    );

    return buildTelegramHandoffExecutionReadback({
      readinessRecord,
      executionHistory,
    });
  }

  readExecutionState(input = {}, options = {}) {
    return this.readCurrentExecutionStateByBookingRequestReference(input, options);
  }
}
