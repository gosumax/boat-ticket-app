const REPAIRABLE_REQUEST_STATUS = 'PREPAYMENT_CONFIRMED';
const LINKED_REQUEST_STATUS = 'CONFIRMED_TO_PRESALE';
const FAILED_REQUEST_STATUS = 'CLOSED_UNCONVERTED';

const TERMINAL_BRIDGE_EVENT_TYPES = new Set([
  'HANDOFF_BLOCKED',
  'REAL_PRESALE_HANDOFF_BLOCKED',
  'REAL_PRESALE_HANDOFF_FAILED',
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeMoneyAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.round(numeric);
}

function normalizeNowIso(now) {
  const value = typeof now === 'function' ? now() : new Date();
  if (value instanceof Date) {
    return value.toISOString();
  }

  const normalized = normalizeString(value);
  if (normalized) {
    return normalized;
  }

  return new Date().toISOString();
}

function readPath(input, path) {
  return path.reduce((current, key) => {
    if (!current || typeof current !== 'object') {
      return null;
    }

    return current[key] ?? null;
  }, input);
}

function firstPresent(input, paths) {
  for (const path of paths) {
    const value = readPath(input, path);
    if (value !== null && value !== undefined && normalizeString(value) !== '') {
      return value;
    }
  }

  return null;
}

function extractPresaleIdFromPayload(payload = null) {
  return normalizePositiveInteger(
    firstPresent(payload, [
      ['created_presale_reference', 'presale_id'],
      ['bridge_execution_result', 'created_presale_reference', 'presale_id'],
      ['adapter_result', 'confirmed_presale_id'],
      ['adapter_result', 'confirmedPresaleId'],
      ['bridge_execution_result', 'adapter_result', 'confirmed_presale_id'],
      ['bridge_execution_result', 'adapter_result', 'confirmedPresaleId'],
      ['confirmed_presale_id'],
      ['confirmedPresaleId'],
    ])
  );
}

function extractExistingPresaleId(events = []) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const presaleId = extractPresaleIdFromPayload(events[index]?.event_payload);
    if (presaleId) {
      return presaleId;
    }
  }

  return null;
}

function extractSlotUidFromPayload(payload = null) {
  return normalizeString(
    firstPresent(payload, [
      ['requested_trip_slot_reference', 'slot_uid'],
      ['creation_result', 'requested_trip_slot_reference', 'slot_uid'],
      ['hold_activation_result', 'requested_trip_slot_reference', 'slot_uid'],
      ['live_seat_hold_summary', 'slot_uid'],
      ['active_hold_state', 'live_seat_hold_summary', 'slot_uid'],
    ])
  );
}

function resolveSlotUid({ handoffPrepared = null, events = [] } = {}) {
  const snapshotSlotUid = normalizeString(
    handoffPrepared?.handoff_snapshot?.trip?.slot_uid
  );
  if (snapshotSlotUid) {
    return snapshotSlotUid;
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const slotUid = extractSlotUidFromPayload(events[index]?.event_payload);
    if (slotUid) {
      return slotUid;
    }
  }

  return null;
}

function latestEventOfType(events = [], eventType) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.event_type === eventType) {
      return events[index];
    }
  }

  return null;
}

function hasTerminalBridgeEvent(events = []) {
  return events.some((event) => TERMINAL_BRIDGE_EVENT_TYPES.has(event?.event_type));
}

function resolvePaymentInput({ bookingHold = null, events = [] } = {}) {
  const prepaymentEvent = latestEventOfType(events, 'PREPAYMENT_CONFIRMED');
  const payload = prepaymentEvent?.event_payload || {};
  const actionPayload = payload?.action_signature?.action_payload || {};
  const acceptedPrepayment =
    normalizeMoneyAmount(payload.accepted_prepayment_amount) ||
    normalizeMoneyAmount(payload.acceptedPrepaymentAmount) ||
    normalizeMoneyAmount(actionPayload.accepted_prepayment_amount) ||
    normalizeMoneyAmount(actionPayload.acceptedPrepaymentAmount) ||
    normalizeMoneyAmount(bookingHold?.requested_amount);
  const paymentMethod = normalizeString(
    payload.payment_method ||
      payload.paymentMethod ||
      actionPayload.payment_method ||
      actionPayload.paymentMethod
  ).toUpperCase();
  const cashAmount =
    normalizeMoneyAmount(payload.cash_amount) ||
    normalizeMoneyAmount(payload.cashAmount) ||
    normalizeMoneyAmount(actionPayload.cash_amount) ||
    normalizeMoneyAmount(actionPayload.cashAmount);
  const cardAmount =
    normalizeMoneyAmount(payload.card_amount) ||
    normalizeMoneyAmount(payload.cardAmount) ||
    normalizeMoneyAmount(actionPayload.card_amount) ||
    normalizeMoneyAmount(actionPayload.cardAmount);
  const effectivePaymentMethod =
    paymentMethod || (acceptedPrepayment ? 'CASH' : null);

  return Object.freeze({
    paymentMethod: effectivePaymentMethod,
    cashAmount:
      cashAmount ||
      (effectivePaymentMethod === 'CASH' && !cardAmount ? acceptedPrepayment : null),
    cardAmount:
      cardAmount ||
      (effectivePaymentMethod === 'CARD' && !cashAmount ? acceptedPrepayment : null),
  });
}

export class TelegramConfirmedPrepaymentTicketRepairService {
  constructor({
    bookingRequests,
    bookingHolds,
    bookingRequestEvents,
    presaleHandoffService,
    realPresaleHandoffOrchestratorService,
    now = () => new Date(),
  }) {
    this.bookingRequests = bookingRequests;
    this.bookingHolds = bookingHolds;
    this.bookingRequestEvents = bookingRequestEvents;
    this.presaleHandoffService = presaleHandoffService;
    this.realPresaleHandoffOrchestratorService =
      realPresaleHandoffOrchestratorService;
    this.now = now;
  }

  describe() {
    return Object.freeze({
      serviceName: 'confirmed-prepayment-ticket-repair-service',
      status: 'repair_ready',
      dependencyKeys: [
        'bookingRequests',
        'bookingHolds',
        'bookingRequestEvents',
        'presaleHandoffService',
        'realPresaleHandoffOrchestratorService',
      ],
    });
  }

  get db() {
    return this.bookingRequests?.db || null;
  }

  nowIso() {
    return normalizeNowIso(this.now);
  }

  assertReady() {
    const missing = [];
    if (!this.bookingRequests?.getById || !this.bookingRequests?.updateById) {
      missing.push('bookingRequests');
    }
    if (!this.bookingHolds?.findOneBy) {
      missing.push('bookingHolds');
    }
    if (!this.bookingRequestEvents?.listBy) {
      missing.push('bookingRequestEvents');
    }
    if (!this.presaleHandoffService?.prepareHandoff) {
      missing.push('presaleHandoffService');
    }
    if (!this.realPresaleHandoffOrchestratorService?.orchestrate) {
      missing.push('realPresaleHandoffOrchestratorService');
    }
    if (missing.length > 0) {
      throw new Error(
        `[TELEGRAM_CONFIRMED_PREPAYMENT_REPAIR] Missing dependencies: ${missing.join(
          ', '
        )}`
      );
    }
  }

  listEvents(bookingRequestId) {
    return this.bookingRequestEvents.listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 500 }
    );
  }

  getHoldForRequest(bookingRequestId) {
    return this.bookingHolds.findOneBy({ booking_request_id: bookingRequestId });
  }

  presaleExists(presaleId) {
    const normalizedPresaleId = normalizePositiveInteger(presaleId);
    if (!normalizedPresaleId || !this.db?.prepare) {
      return false;
    }

    try {
      return Boolean(
        this.db
          .prepare('SELECT id FROM presales WHERE id = ?')
          .get(normalizedPresaleId)
      );
    } catch {
      return false;
    }
  }

  linkExistingPresale({ bookingRequest, presaleId, nowIso }) {
    return this.bookingRequests.updateById(bookingRequest.booking_request_id, {
      confirmed_presale_id: presaleId,
      request_status: LINKED_REQUEST_STATUS,
      last_status_at: nowIso,
    });
  }

  closeUnconverted({ bookingRequest, nowIso, reason }) {
    const updatedRequest = this.bookingRequests.updateById(
      bookingRequest.booking_request_id,
      {
        request_status: FAILED_REQUEST_STATUS,
        last_status_at: nowIso,
      }
    );

    return Object.freeze({
      repair_status: 'failed_closed_unconverted',
      booking_request_id: bookingRequest.booking_request_id,
      request_status: updatedRequest.request_status,
      reason,
    });
  }

  repairBookingRequest(
    bookingRequestId,
    {
      actorType = 'system',
      actorId = 'confirmed-prepayment-ticket-repair',
      nowIso = this.nowIso(),
    } = {}
  ) {
    this.assertReady();
    const bookingRequest = this.bookingRequests.getById(bookingRequestId);
    if (!bookingRequest) {
      return Object.freeze({
        repair_status: 'skipped',
        booking_request_id: bookingRequestId,
        reason: 'booking_request_not_found',
      });
    }

    if (bookingRequest.request_status !== REPAIRABLE_REQUEST_STATUS) {
      return Object.freeze({
        repair_status: 'skipped',
        booking_request_id: bookingRequest.booking_request_id,
        request_status: bookingRequest.request_status,
        reason: 'request_status_not_repairable',
      });
    }

    const alreadyLinkedPresaleId = normalizePositiveInteger(
      bookingRequest.confirmed_presale_id
    );
    if (alreadyLinkedPresaleId && this.presaleExists(alreadyLinkedPresaleId)) {
      this.linkExistingPresale({
        bookingRequest,
        presaleId: alreadyLinkedPresaleId,
        nowIso,
      });
      return Object.freeze({
        repair_status: 'linked_existing_presale',
        booking_request_id: bookingRequest.booking_request_id,
        confirmed_presale_id: alreadyLinkedPresaleId,
      });
    }

    let events = this.listEvents(bookingRequest.booking_request_id);
    const existingPresaleId = extractExistingPresaleId(events);
    if (existingPresaleId && this.presaleExists(existingPresaleId)) {
      this.linkExistingPresale({
        bookingRequest,
        presaleId: existingPresaleId,
        nowIso,
      });
      return Object.freeze({
        repair_status: 'linked_existing_presale',
        booking_request_id: bookingRequest.booking_request_id,
        confirmed_presale_id: existingPresaleId,
      });
    }

    if (hasTerminalBridgeEvent(events)) {
      return this.closeUnconverted({
        bookingRequest,
        nowIso,
        reason: 'terminal_bridge_event_without_presale',
      });
    }

    const bookingHold = this.getHoldForRequest(bookingRequest.booking_request_id);

    try {
      const handoffPrepared = this.presaleHandoffService.prepareHandoff({
        booking_request_reference: {
          reference_type: 'telegram_booking_request',
          booking_request_id: bookingRequest.booking_request_id,
        },
        actor_type: actorType,
        actor_id: actorId,
      });
      events = this.listEvents(bookingRequest.booking_request_id);
      const slotUid = resolveSlotUid({ handoffPrepared, events });
      const paymentInput = resolvePaymentInput({ bookingHold, events });
      const orchestration =
        this.realPresaleHandoffOrchestratorService.orchestrate(
          bookingRequest.booking_request_id,
          {
            actorType,
            actorId,
            slotUid,
            paymentMethod: paymentInput.paymentMethod,
            cashAmount: paymentInput.cashAmount,
            cardAmount: paymentInput.cardAmount,
          }
        );

      const linkedRequest = this.bookingRequests.getById(
        bookingRequest.booking_request_id
      );
      const linkedPresaleId = normalizePositiveInteger(
        linkedRequest?.confirmed_presale_id
      );
      if (linkedPresaleId && this.presaleExists(linkedPresaleId)) {
        return Object.freeze({
          repair_status: 'created_presale',
          booking_request_id: bookingRequest.booking_request_id,
          confirmed_presale_id: linkedPresaleId,
        });
      }

      const orchestrationPresaleId = normalizePositiveInteger(
        orchestration?.created_presale_reference?.presale_id
      );
      if (orchestrationPresaleId && this.presaleExists(orchestrationPresaleId)) {
        this.linkExistingPresale({
          bookingRequest,
          presaleId: orchestrationPresaleId,
          nowIso,
        });
        return Object.freeze({
          repair_status: 'linked_existing_presale',
          booking_request_id: bookingRequest.booking_request_id,
          confirmed_presale_id: orchestrationPresaleId,
        });
      }

      events = this.listEvents(bookingRequest.booking_request_id);
      const createdPresaleId = extractExistingPresaleId(events);
      if (createdPresaleId && this.presaleExists(createdPresaleId)) {
        this.linkExistingPresale({
          bookingRequest,
          presaleId: createdPresaleId,
          nowIso,
        });
        return Object.freeze({
          repair_status: 'linked_existing_presale',
          booking_request_id: bookingRequest.booking_request_id,
          confirmed_presale_id: createdPresaleId,
        });
      }

      return this.closeUnconverted({
        bookingRequest,
        nowIso,
        reason:
          orchestration?.orchestration_status ||
          'bridge_completed_without_presale',
      });
    } catch (error) {
      return this.closeUnconverted({
        bookingRequest,
        nowIso,
        reason:
          normalizeString(error?.message) ||
          'repair_failed_before_presale_creation',
      });
    }
  }

  repairConfirmedPrepaymentRequestsForGuestProfile(
    guestProfileId,
    {
      actorType = 'system',
      actorId = 'confirmed-prepayment-ticket-repair',
      nowIso = this.nowIso(),
      limit = 100,
    } = {}
  ) {
    this.assertReady();
    const normalizedGuestProfileId = normalizePositiveInteger(guestProfileId);
    if (!normalizedGuestProfileId) {
      throw new Error(
        '[TELEGRAM_CONFIRMED_PREPAYMENT_REPAIR] guestProfileId is required'
      );
    }

    const rows = this.bookingRequests
      .listBy(
        { guest_profile_id: normalizedGuestProfileId },
        { orderBy: 'booking_request_id DESC', limit }
      )
      .filter(
        (row) =>
          row?.request_status === REPAIRABLE_REQUEST_STATUS &&
          !normalizePositiveInteger(row.confirmed_presale_id)
      );
    const items = rows.map((row) =>
      this.repairBookingRequest(row.booking_request_id, {
        actorType,
        actorId,
        nowIso,
      })
    );

    return Object.freeze({
      repair_status: 'completed',
      guest_profile_id: normalizedGuestProfileId,
      scanned_request_count: rows.length,
      repaired_count: items.filter((item) =>
        ['created_presale', 'linked_existing_presale'].includes(
          item.repair_status
        )
      ).length,
      failed_count: items.filter(
        (item) => item.repair_status === 'failed_closed_unconverted'
      ).length,
      skipped_count: items.filter((item) => item.repair_status === 'skipped')
        .length,
      items,
    });
  }
}
