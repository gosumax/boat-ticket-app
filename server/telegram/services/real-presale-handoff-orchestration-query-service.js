import {
  buildTelegramRealPresaleHandoffAttemptRecord,
  buildTelegramRealPresaleHandoffReadback,
  buildTelegramRealPresaleHandoffResultRecord,
  buildTelegramRealPresaleHandoffRunRecord,
  TELEGRAM_REAL_PRESALE_HANDOFF_ATTEMPT_EVENT_TYPE,
  TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATION_EVENT_TYPES,
} from '../../../shared/telegram/index.js';

function normalizeLimit(limit, fallback = 200, max = 500) {
  const normalized = Number(limit);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

export class TelegramRealPresaleHandoffOrchestrationQueryService {
  constructor({
    bookingRequestEvents,
    handoffExecutionQueryService,
  }) {
    this.bookingRequestEvents = bookingRequestEvents;
    this.handoffExecutionQueryService = handoffExecutionQueryService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'real-presale-handoff-orchestration-query-service',
      status: 'query_ready',
      dependencyKeys: ['bookingRequestEvents', 'handoffExecutionQueryService'],
    });
  }

  listOrchestrationEvents(bookingRequestId, { limit = 200 } = {}) {
    this.handoffExecutionQueryService.readExecutionState(bookingRequestId);
    this.bookingRequestEvents.assertReady();

    const normalizedLimit = normalizeLimit(limit);
    const placeholders = TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATION_EVENT_TYPES.map(() => '?').join(
      ', '
    );
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
      .all(
        bookingRequestId,
        ...TELEGRAM_REAL_PRESALE_HANDOFF_ORCHESTRATION_EVENT_TYPES,
        normalizedLimit
      )
      .map((row) => this.bookingRequestEvents.deserializeRow(row));
  }

  listRunHistory(bookingRequestId, { limit = 200 } = {}) {
    const events = this.listOrchestrationEvents(bookingRequestId, { limit });
    const attempts = [];
    const resultsByAttemptEventId = new Map();

    for (const event of events) {
      if (event.event_type === TELEGRAM_REAL_PRESALE_HANDOFF_ATTEMPT_EVENT_TYPE) {
        attempts.push(buildTelegramRealPresaleHandoffAttemptRecord(event));
        continue;
      }

      const resultRecord = buildTelegramRealPresaleHandoffResultRecord(event);
      if (!resultsByAttemptEventId.has(resultRecord.attempt_event_id)) {
        resultsByAttemptEventId.set(resultRecord.attempt_event_id, resultRecord);
      }
    }

    return Object.freeze(
      attempts.map((attemptRecord) =>
        buildTelegramRealPresaleHandoffRunRecord({
          attemptRecord,
          resultRecord:
            resultsByAttemptEventId.get(attemptRecord.booking_request_event_id) || null,
        })
      )
    );
  }

  readOrchestrationState(bookingRequestId, { limit = 200 } = {}) {
    const executionSnapshot = this.handoffExecutionQueryService.readExecutionState(
      bookingRequestId
    );
    const orchestrationHistory = this.listRunHistory(bookingRequestId, { limit });

    return buildTelegramRealPresaleHandoffReadback({
      executionSnapshot,
      orchestrationHistory,
    });
  }
}
