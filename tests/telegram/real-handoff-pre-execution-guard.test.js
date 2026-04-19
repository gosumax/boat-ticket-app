import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_REAL_HANDOFF_PRE_EXECUTION_GUARD_NAME,
  TELEGRAM_REAL_HANDOFF_PRE_EXECUTION_GUARD_VERSION,
} from '../../shared/telegram/index.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      role TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE presales (id INTEGER PRIMARY KEY AUTOINCREMENT);
  `);
  db.prepare(`INSERT INTO users (username, role, is_active) VALUES ('seller-a', 'seller', 1)`).run();
  return db;
}

function createClock(startIso) {
  let current = new Date(startIso);
  return {
    now: () => new Date(current),
  };
}

function wireClock(context, clock) {
  context.services.attributionService.now = clock.now;
  context.services.bookingRequestService.now = clock.now;
  context.services.presaleHandoffService.now = clock.now;
  context.services.handoffExecutionService.now = clock.now;
}

function seedPreparedExecution(context, clock, suffix, { start = true, consume = false } = {}) {
  wireClock(context, clock);

  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-guard-${suffix}`,
    display_name: `Guard Guest ${suffix}`,
    username: `guard_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7997444${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-guard-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Guard ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-guard-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: { zone: `guard-zone-${suffix}` },
    is_active: 1,
  });

  const attributionResult = services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    entry_channel: 'qr',
  });

  const lifecycleResult = services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id:
      attributionResult.sellerAttributionSession.seller_attribution_session_id,
    requested_trip_date: '2026-04-13',
    requested_time_slot: '13:30',
    requested_seats: 3,
    requested_ticket_mix: { adult: 2, child: 1 },
    requested_prepayment_amount: 4500,
    currency: 'RUB',
    contact_phone_e164: `+7997444${suffix}`,
  });

  const confirmed = services.bookingRequestService.confirmPrepayment(
    lifecycleResult.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: `payment-${suffix}`,
    }
  );

  services.presaleHandoffService.prepareHandoff(confirmed.bookingRequest.booking_request_id, {
    actorType: 'system',
    actorId: `prepared-${suffix}`,
  });

  services.handoffExecutionService.queueForHandoff(confirmed.bookingRequest.booking_request_id, {
    actorType: 'system',
    actorId: `queue-${suffix}`,
    queueReason: 'ready_for_guard',
  });

  if (start) {
    services.handoffExecutionService.startHandoff(confirmed.bookingRequest.booking_request_id, {
      actorType: 'system',
      actorId: `start-${suffix}`,
      startReason: 'guard_dry_run_window',
    });
  }

  if (consume) {
    services.handoffExecutionService.consumeHandoff(confirmed.bookingRequest.booking_request_id, {
      actorType: 'system',
      actorId: `consume-${suffix}`,
      consumeReason: 'already_consumed_snapshot',
      consumeMetadata: { external_handoff_ref: `guard-ref-${suffix}` },
    });
  }

  return {
    bookingRequestId: confirmed.bookingRequest.booking_request_id,
  };
}

describe('telegram real handoff pre-execution guard layer', () => {
  let db;
  let clock;
  let context;

  beforeEach(() => {
    db = createTestDb();
    clock = createClock('2026-04-10T11:00:00.000Z');
    context = createTelegramPersistenceContext(db);
    wireClock(context, clock);
  });

  it('returns an eligible future-bridge decision for a seller-attributed consumable snapshot', () => {
    const seeded = seedPreparedExecution(context, clock, '3001', { start: true });
    const before = context.services.handoffExecutionQueryService.readExecutionState(
      seeded.bookingRequestId
    );

    const result = context.services.realHandoffPreExecutionGuardService.evaluateExecutionDecision(
      seeded.bookingRequestId,
      {
        slotUid: 'generated:42',
        paymentMethod: 'CARD',
      }
    );

    expect(result.guard_name).toBe(TELEGRAM_REAL_HANDOFF_PRE_EXECUTION_GUARD_NAME);
    expect(result.guard_version).toBe(TELEGRAM_REAL_HANDOFF_PRE_EXECUTION_GUARD_VERSION);
    expect(result.decision).toBe('eligible');
    expect(result.decision_code).toBe('ELIGIBLE_FOR_FUTURE_REAL_BRIDGE');
    expect(result.future_real_bridge_eligible).toBe(true);
    expect(result.classification.hard_blockers).toEqual([]);
    expect(result.classification.manual_escalations).toEqual([]);
    expect(result.classification.soft_warnings).toEqual([]);
    expect(result.adapter_result.outcome).toBe('success');
    expect(result.bridge_input.presale_create_request.payment_method).toBe('CARD');
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);

    const after = context.services.handoffExecutionQueryService.readExecutionState(
      seeded.bookingRequestId
    );
    expect(after).toEqual(before);
  });

  it('keeps eligibility but records a soft warning for manually resolved slotUid input', () => {
    const seeded = seedPreparedExecution(context, clock, '3002', { start: true });

    const result = context.services.realHandoffPreExecutionGuardService.evaluateExecutionDecision(
      seeded.bookingRequestId,
      {
        slotUid: 'manual:77',
        paymentMethod: 'CARD',
      }
    );

    expect(result.decision).toBe('eligible');
    expect(result.decision_code).toBe('ELIGIBLE_WITH_WARNINGS');
    expect(result.classification.hard_blockers).toEqual([]);
    expect(result.classification.manual_escalations).toEqual([]);
    expect(result.classification.soft_warnings[0].code).toBe(
      'MANUAL_SLOT_UID_RECHECK_RECOMMENDED'
    );
  });

  it('blocks future real-bridge eligibility when the dry-run adapter still has hard blockers', () => {
    const seeded = seedPreparedExecution(context, clock, '3003', { start: true });

    const result = context.services.realHandoffPreExecutionGuardService.evaluateExecutionDecision(
      seeded.bookingRequestId,
      {
        paymentMethod: 'CARD',
      }
    );

    expect(result.decision).toBe('blocked');
    expect(result.decision_code).toBe('SLOT_UID_REQUIRED');
    expect(result.future_real_bridge_eligible).toBe(false);
    expect(result.classification.hard_blockers[0].code).toBe('SLOT_UID_REQUIRED');
  });

  it('requires manual escalation when payment method would otherwise be implicitly defaulted', () => {
    const seeded = seedPreparedExecution(context, clock, '3004', { start: true });

    const result = context.services.realHandoffPreExecutionGuardService.evaluateExecutionDecision(
      seeded.bookingRequestId,
      {
        slotUid: 'generated:90',
      }
    );

    expect(result.decision).toBe('manual_escalation_required');
    expect(result.decision_code).toBe('IMPLICIT_PAYMENT_METHOD_REQUIRES_REVIEW');
    expect(result.adapter_result.outcome).toBe('success');
    expect(result.classification.manual_escalations[0].code).toBe(
      'IMPLICIT_PAYMENT_METHOD_REQUIRES_REVIEW'
    );
  });

  it('requires manual escalation for already-consumed execution snapshots and stays deterministic', () => {
    const seeded = seedPreparedExecution(context, clock, '3005', {
      start: true,
      consume: true,
    });
    const before = context.services.handoffExecutionQueryService.readExecutionState(
      seeded.bookingRequestId
    );

    const first = context.services.realHandoffPreExecutionGuardService.evaluateExecutionDecision(
      seeded.bookingRequestId,
      {
        slotUid: 'generated:91',
        paymentMethod: 'CARD',
      }
    );
    const second = context.services.realHandoffPreExecutionGuardService.evaluateExecutionDecision(
      seeded.bookingRequestId,
      {
        slotUid: 'generated:91',
        paymentMethod: 'CARD',
      }
    );

    expect(first.decision).toBe('manual_escalation_required');
    expect(first.decision_code).toBe('EXECUTION_ALREADY_CONSUMED_REQUIRES_REVIEW');
    expect(first.classification.manual_escalations[0].code).toBe(
      'EXECUTION_ALREADY_CONSUMED_REQUIRES_REVIEW'
    );
    expect(second).toEqual(first);

    const after = context.services.handoffExecutionQueryService.readExecutionState(
      seeded.bookingRequestId
    );
    expect(after).toEqual(before);
  });

  it('requires manual escalation when the frozen snapshot reflects non-seller attribution', () => {
    const seeded = seedPreparedExecution(context, clock, '3006', { start: true });
    const preparedEvent = context.repositories.bookingRequestEvents.findOneBy(
      {
        booking_request_id: seeded.bookingRequestId,
        event_type: 'HANDOFF_PREPARED',
      },
      { orderBy: 'booking_request_event_id DESC' }
    );

    context.repositories.bookingRequestEvents.updateById(
      preparedEvent.booking_request_event_id,
      {
        event_payload: {
          ...preparedEvent.event_payload,
          payload: {
            ...preparedEvent.event_payload.payload,
            source: {
              ...preparedEvent.event_payload.payload.source,
              source_family: 'promo_qr',
              seller_id: null,
              source_ownership: 'owner_manual',
              path_type: 'owner_manual',
            },
          },
        },
      }
    );

    const result = context.services.realHandoffPreExecutionGuardService.evaluateExecutionDecision(
      seeded.bookingRequestId,
      {
        slotUid: 'generated:92',
        paymentMethod: 'CARD',
      }
    );

    expect(result.decision).toBe('manual_escalation_required');
    expect(result.decision_code).toBe('NON_SELLER_ATTRIBUTION_REQUIRES_REVIEW');
    expect(result.classification.manual_escalations[0].code).toBe(
      'NON_SELLER_ATTRIBUTION_REQUIRES_REVIEW'
    );
  });
});
