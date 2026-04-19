import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';

function listRealOrchestrationEvents(context, bookingRequestId) {
  return context.repositories.bookingRequestEvents
    .listBy(
      { booking_request_id: bookingRequestId },
      { orderBy: 'booking_request_event_id ASC', limit: 100 }
    )
    .filter((event) => event.event_type.startsWith('REAL_PRESALE_HANDOFF_'));
}

function seedPreparedExecution(
  context,
  seedData,
  suffix,
  {
    requestedSeats = 2,
    requestedTicketMix = { adult: 1, child: 1 },
    requestedPrepaymentAmount = 1500,
  } = {}
) {
  const { repositories, services } = context;
  const sellerId = seedData.users.sellerA.id;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-prod-presale-${suffix}`,
    display_name: `Production Presale Guest ${suffix}`,
    username: `production_presale_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7997444${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-production-presale-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Production Presale ${suffix}`,
    default_seller_id: sellerId,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-production-presale-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: { zone: `production-presale-zone-${suffix}` },
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
    requested_trip_date: seedData.slots.generated.tomorrow,
    requested_time_slot: '12:00',
    requested_seats: requestedSeats,
    requested_ticket_mix: requestedTicketMix,
    requested_prepayment_amount: requestedPrepaymentAmount,
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

  return {
    bookingRequestId: confirmed.bookingRequest.booking_request_id,
    sellerId,
  };
}

describe('telegram production presale handoff adapter', () => {
  let db;
  let seedData;
  let createTelegramPersistenceContext;

  beforeEach(async () => {
    vi.resetModules();
    resetTestDb();

    const dbModule = await import('../../server/db.js');
    db = dbModule.default;
    seedData = await seedBasicData(db);

    ({ createTelegramPersistenceContext } = await import('../../server/telegram/index.js'));
  });

  function createContextWithProductionAdapter(adapterOptions = {}) {
    const context = createTelegramPersistenceContext(db);
    if (typeof adapterOptions.executePresaleCreateInDomain === 'function') {
      context.services.productionPresaleHandoffAdapterService.executePresaleCreateInDomain =
        adapterOptions.executePresaleCreateInDomain;
    }

    return {
      context,
      bridgeExecutor: vi.spyOn(
        context.services.realPresaleBridgeExecutionService,
        'execute'
      ),
      adapterExecutor: vi.spyOn(
        context.services.productionPresaleHandoffAdapterService,
        'execute'
      ),
    };
  }

  it('creates a canonical presale through the isolated Telegram bridge seam and replays idempotently', () => {
    const { context, bridgeExecutor, adapterExecutor } =
      createContextWithProductionAdapter();
    const seeded = seedPreparedExecution(context, seedData, '5001');
    const slotUid = `generated:${seedData.slots.generated.genSlot2}`;

    const first =
      context.services.realPresaleHandoffOrchestratorService.orchestrate(
        seeded.bookingRequestId,
        {
          actorType: 'system',
          actorId: 'production-presale-orchestrator',
          slotUid,
          paymentMethod: 'CARD',
        }
      );
    const second =
      context.services.realPresaleHandoffOrchestratorService.orchestrate(
        seeded.bookingRequestId,
        {
          actorType: 'system',
          actorId: 'production-presale-orchestrator',
          slotUid,
          paymentMethod: 'CARD',
        }
      );
    const presaleId = first.created_presale_reference.presale_id;
    const bookingRequest = context.repositories.bookingRequests.getById(
      seeded.bookingRequestId
    );

    expect(bridgeExecutor).toHaveBeenCalledTimes(1);
    expect(adapterExecutor).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first.orchestration_status).toBe('presale_created');
    expect(first.execution_state).toBe('handoff_consumed');
    expect(first.current_orchestration_outcome).toBe('success');
    expect(first.latest_run.outcome_code).toBe('PRESALE_CREATED');
    expect(first.latest_run.guard_decision.decision).toBe('eligible');
    expect(first.latest_run.adapter_invoked).toBe(true);
    expect(bookingRequest.request_status).toBe('CONFIRMED_TO_PRESALE');
    expect(bookingRequest.confirmed_presale_id).toBe(presaleId);
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales WHERE id = ?').get(presaleId).count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM tickets WHERE presale_id = ?').get(presaleId).count).toBe(2);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM money_ledger WHERE presale_id = ? AND type = 'SALE_PREPAYMENT_CARD'`
        )
        .get(presaleId).count
    ).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales WHERE slot_uid = ?').get(slotUid).count).toBe(1);
    expect(listRealOrchestrationEvents(context, seeded.bookingRequestId).map((event) => event.event_type)).toEqual([
      'REAL_PRESALE_HANDOFF_ATTEMPTED',
      'REAL_PRESALE_HANDOFF_SUCCEEDED',
    ]);
  });

  it('maps current presale-domain capacity rejection into a blocked orchestration result', () => {
    const { context, bridgeExecutor, adapterExecutor } =
      createContextWithProductionAdapter();
    const seeded = seedPreparedExecution(context, seedData, '5002', {
      requestedSeats: 3,
      requestedTicketMix: { adult: 3 },
      requestedPrepaymentAmount: 0,
    });
    const slotUid = `generated:${seedData.slots.generated.genSlot1}`;

    const result =
      context.services.realPresaleHandoffOrchestratorService.orchestrate(
        seeded.bookingRequestId,
        {
          actorType: 'system',
          actorId: 'production-presale-orchestrator',
          slotUid,
        }
      );

    expect(bridgeExecutor).toHaveBeenCalledTimes(1);
    expect(adapterExecutor).toHaveBeenCalledTimes(1);
    expect(result.orchestration_status).toBe('bridge_blocked');
    expect(result.execution_state).toBe('handoff_blocked');
    expect(result.current_orchestration_outcome).toBe('blocked');
    expect(result.latest_run.guard_decision.decision).toBe('eligible');
    expect(result.latest_run.adapter_invoked).toBe(true);
    expect(result.latest_run.adapter_result.outcome).toBe('blocked');
    expect(result.latest_run.outcome_code).toBe('INVALID_TICKET_BREAKDOWN');
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales WHERE slot_uid = ?').get(slotUid).count).toBe(0);
    expect(context.repositories.bookingRequests.getById(seeded.bookingRequestId).confirmed_presale_id).toBeNull();
    expect(listRealOrchestrationEvents(context, seeded.bookingRequestId).map((event) => event.event_type)).toEqual([
      'REAL_PRESALE_HANDOFF_ATTEMPTED',
      'REAL_PRESALE_HANDOFF_BLOCKED',
    ]);
  });

  it('maps unexpected presale-domain errors into a failure orchestration result', () => {
    const error = new Error('Injected presale-domain failure');
    error.code = 'PRESALE_DOMAIN_UNEXPECTED';
    const { context, bridgeExecutor, adapterExecutor } =
      createContextWithProductionAdapter({
        executePresaleCreateInDomain: () => {
          throw error;
        },
      });
    const seeded = seedPreparedExecution(context, seedData, '5003');

    const result =
      context.services.realPresaleHandoffOrchestratorService.orchestrate(
        seeded.bookingRequestId,
        {
          actorType: 'system',
          actorId: 'production-presale-orchestrator',
          slotUid: `generated:${seedData.slots.generated.genSlot2}`,
          paymentMethod: 'CARD',
        }
      );

    expect(bridgeExecutor).toHaveBeenCalledTimes(1);
    expect(adapterExecutor).toHaveBeenCalledTimes(1);
    expect(result.orchestration_status).toBe('bridge_failed');
    expect(result.execution_state).toBe('handoff_blocked');
    expect(result.current_orchestration_outcome).toBe('failure');
    expect(result.latest_run.guard_decision.decision).toBe('eligible');
    expect(result.latest_run.adapter_invoked).toBe(true);
    expect(result.latest_run.adapter_result.outcome).toBe('failure');
    expect(result.latest_run.outcome_code).toBe('PRESALE_DOMAIN_UNEXPECTED');
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
    expect(listRealOrchestrationEvents(context, seeded.bookingRequestId).map((event) => event.event_type)).toEqual([
      'REAL_PRESALE_HANDOFF_ATTEMPTED',
      'REAL_PRESALE_HANDOFF_FAILED',
    ]);
  });
});
