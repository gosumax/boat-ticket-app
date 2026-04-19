import {
  buildTelegramBridgeLinkageList,
  buildTelegramBridgeLinkageProjection,
  buildTelegramCanonicalPresaleReference,
} from '../../../shared/telegram/index.js';

const ERROR_PREFIX = '[TELEGRAM_BRIDGE_LINKAGE]';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function rejectBridgeLinkage(message) {
  throw new Error(`${ERROR_PREFIX} ${message}`);
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    rejectBridgeLinkage(`${label} must be a positive integer`);
  }

  return normalized;
}

function normalizeLimit(limit, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) {
  const normalized = Number(limit);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(normalized), max);
}

function latestTimestampIso(...values) {
  const timestamps = values
    .map((value) => value?.iso ?? value ?? null)
    .filter(Boolean)
    .map((iso) => ({ iso, parsed: Date.parse(iso) }))
    .filter((candidate) => !Number.isNaN(candidate.parsed))
    .sort((left, right) => right.parsed - left.parsed);

  return timestamps[0]?.iso || null;
}

function compareProjectionItems(left, right) {
  const leftTime = Date.parse(left.latest_bridge_timestamp_summary?.iso || 0);
  const rightTime = Date.parse(right.latest_bridge_timestamp_summary?.iso || 0);
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return (
    right.booking_request_reference.booking_request_id -
    left.booking_request_reference.booking_request_id
  );
}

function pickBookingRequestReference(input = {}) {
  if (Number.isInteger(Number(input)) && Number(input) > 0) {
    return {
      reference_type: 'telegram_booking_request',
      booking_request_id: Number(input),
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

export class TelegramBridgeLinkageProjectionService {
  constructor({
    bookingRequests,
    handoffReadinessQueryService,
    handoffExecutionQueryService,
    realPresaleHandoffOrchestrationQueryService,
  }) {
    this.bookingRequests = bookingRequests;
    this.handoffReadinessQueryService = handoffReadinessQueryService;
    this.handoffExecutionQueryService = handoffExecutionQueryService;
    this.realPresaleHandoffOrchestrationQueryService =
      realPresaleHandoffOrchestrationQueryService;
  }

  describe() {
    return Object.freeze({
      serviceName: 'bridge-linkage-projection-service',
      status: 'projection_ready',
      dependencyKeys: [
        'bookingRequests',
        'handoffReadinessQueryService',
        'handoffExecutionQueryService',
        'realPresaleHandoffOrchestrationQueryService',
      ],
    });
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  getBookingRequestOrThrow(bookingRequestId) {
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      rejectBridgeLinkage(`Invalid booking request reference: ${bookingRequestId}`);
    }

    return bookingRequest;
  }

  normalizeBookingRequestId(input = {}) {
    const rawReference = pickBookingRequestReference(input);
    if (!rawReference) {
      rejectBridgeLinkage('booking request reference is required');
    }

    return normalizePositiveInteger(
      rawReference.booking_request_id ?? rawReference.bookingRequestId ?? rawReference,
      'booking_request_reference.booking_request_id'
    );
  }

  readPreparedReadinessOrThrow(bookingRequestId) {
    try {
      return this.handoffReadinessQueryService.readPreparedRequest({
        booking_request_reference: {
          reference_type: 'telegram_booking_request',
          booking_request_id: bookingRequestId,
        },
      });
    } catch (error) {
      const message = String(error?.message || '');
      if (
        message.includes('not handoff-prepared') ||
        message.includes('Invalid booking request reference') ||
        message.includes('not projectable')
      ) {
        rejectBridgeLinkage(
          `Booking request is not handoff-prepared for bridge linkage: ${bookingRequestId}`
        );
      }

      throw error;
    }
  }

  resolveBridgeLinkageState({
    bookingRequest,
    executionState,
    orchestrationState,
  }) {
    if (bookingRequest.confirmed_presale_id) {
      return 'bridged_to_presale';
    }

    if (orchestrationState?.orchestration_status === 'bridge_failed') {
      return 'bridge_failed';
    }

    if (orchestrationState?.orchestration_status === 'bridge_blocked') {
      return 'bridge_blocked';
    }

    if (executionState?.current_execution_state === 'handoff_consumed') {
      return 'already_consumed';
    }

    if (executionState?.current_execution_state === 'handoff_blocked') {
      return 'bridge_blocked';
    }

    return 'not_bridged';
  }

  buildProjection(bookingRequestId) {
    const bookingRequest = this.getBookingRequestOrThrow(bookingRequestId);
    const readiness = this.readPreparedReadinessOrThrow(bookingRequestId);
    const executionState = this.handoffExecutionQueryService.readExecutionState({
      booking_request_reference: readiness.booking_request_reference,
    });
    const orchestrationState =
      this.realPresaleHandoffOrchestrationQueryService.readOrchestrationState(
        bookingRequestId
      );
    const bridgeLinkageState = this.resolveBridgeLinkageState({
      bookingRequest,
      executionState,
      orchestrationState,
    });

    return buildTelegramBridgeLinkageProjection({
      bookingRequestReference: readiness.booking_request_reference,
      lifecycleState: readiness.lifecycle_state,
      handoffReadinessState: readiness.handoff_readiness_state,
      executionState: executionState.current_execution_state,
      bridgeLinkageState,
      createdPresaleReference: buildTelegramCanonicalPresaleReference(
        bookingRequest.confirmed_presale_id
      ),
      latestBridgeTimestampIso: latestTimestampIso(
        orchestrationState?.latest_timestamp_summary,
        executionState?.latest_execution_timestamp_summary,
        readiness?.latest_readiness_timestamp_summary,
        bookingRequest?.last_status_at
      ),
    });
  }

  readCurrentBridgeLinkageByBookingRequestReference(input = {}) {
    const bookingRequestId = this.normalizeBookingRequestId(input);
    return this.buildProjection(bookingRequestId);
  }

  listBridgedTelegramRequests({ limit = DEFAULT_LIMIT } = {}) {
    this.bookingRequests.assertReady();

    const rows = this.db
      .prepare(
        `
          SELECT booking_request_id
          FROM telegram_booking_requests
          WHERE confirmed_presale_id IS NOT NULL
          ORDER BY COALESCE(last_status_at, created_at) DESC, booking_request_id DESC
          LIMIT ?
        `
      )
      .all(normalizeLimit(limit))
      .map((row) => this.buildProjection(row.booking_request_id))
      .sort(compareProjectionItems);

    return buildTelegramBridgeLinkageList({
      listScope: 'bridged_telegram_requests',
      items: rows,
    });
  }

  readLatestBridgeOutcomeForTelegramGuest(input = {}) {
    const guestProfile = this.handoffReadinessQueryService.resolveGuestProfile(input);
    const bookingRequests = this.bookingRequests.listBy(
      { guest_profile_id: guestProfile.guest_profile_id },
      {
        orderBy: 'created_at DESC, booking_request_id DESC',
        limit: 200,
      }
    );
    const items = bookingRequests
      .map((bookingRequest) => {
        try {
          return this.buildProjection(bookingRequest.booking_request_id);
        } catch (error) {
          const message = String(error?.message || '');
          if (message.includes('not handoff-prepared for bridge linkage')) {
            return null;
          }

          throw error;
        }
      })
      .filter(Boolean)
      .sort(compareProjectionItems);

    return items[0] || null;
  }
}
