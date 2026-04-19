import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestDb } from '../_helpers/dbReset.js';
import { seedBasicData } from '../_helpers/seedBasic.js';

function seedBookingRequest(
  context,
  seedData,
  suffix,
  {
    prepareHandoff = true,
    queue = true,
    start = true,
    consume = false,
    requestedSeats = 2,
    requestedTicketMix = { adult: 1, child: 1 },
    requestedPrepaymentAmount = 1500,
  } = {}
) {
  const { repositories, services } = context;
  const sellerId = seedData.users.sellerA.id;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-real-bridge-${suffix}`,
    display_name: `Real Bridge Guest ${suffix}`,
    username: `real_bridge_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7997555${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `seller-real-bridge-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Seller Real Bridge ${suffix}`,
    default_seller_id: sellerId,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `seller-real-bridge-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: { zone: `real-bridge-zone-${suffix}` },
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
    contact_phone_e164: `+7997555${suffix}`,
  });

  const confirmed = services.bookingRequestService.confirmPrepayment(
    lifecycleResult.bookingRequest.booking_request_id,
    {
      actorType: 'system',
      actorId: `payment-${suffix}`,
    }
  );

  if (prepareHandoff) {
    services.presaleHandoffService.prepareHandoff(confirmed.bookingRequest.booking_request_id, {
      actorType: 'system',
      actorId: `prepared-${suffix}`,
    });
  }

  if (queue) {
    services.handoffExecutionService.queueForHandoff(
      confirmed.bookingRequest.booking_request_id,
      {
        actorType: 'system',
        actorId: `queue-${suffix}`,
        queueReason: 'real_bridge_ready',
      }
    );
  }

  if (start) {
    services.handoffExecutionService.startHandoff(
      confirmed.bookingRequest.booking_request_id,
      {
        actorType: 'system',
        actorId: `start-${suffix}`,
        startReason: 'real_bridge_execute',
      }
    );
  }

  if (consume) {
    services.handoffExecutionService.consumeHandoff(
      confirmed.bookingRequest.booking_request_id,
      {
        actorType: 'system',
        actorId: `consume-${suffix}`,
        consumeReason: 'already_consumed',
      }
    );
  }

  return {
    bookingRequestId: confirmed.bookingRequest.booking_request_id,
  };
}

describe('telegram real presale bridge execution service', () => {
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

  it('creates a canonical presale through the real Telegram bridge seam', () => {
    const context = createTelegramPersistenceContext(db);
    const seeded = seedBookingRequest(context, seedData, '6001');
    const slotUid = `generated:${seedData.slots.generated.genSlot2}`;

    const result = context.services.realPresaleBridgeExecutionService.execute(
      seeded.bookingRequestId,
      {
        slotUid,
        paymentMethod: 'CARD',
      }
    );

    expect(result.bridge_execution_status).toBe('presale_created');
    expect(result.created_presale_reference).toMatchObject({
      reference_type: 'canonical_presale',
      presale_id: expect.any(Number),
    });
    expect(result.blocked_reason).toBeNull();
    expect(result.failure_reason).toBeNull();
    expect(result.guard_decision.decision).toBe('eligible');
    expect(result.bridge_input.presale_create_request.slotUid).toBe(slotUid);
    expect(result.adapter_result.confirmed_presale_id).toBe(
      result.created_presale_reference.presale_id
    );
    expect(
      context.repositories.bookingRequests.getById(seeded.bookingRequestId).request_status
    ).toBe('CONFIRMED_TO_PRESALE');
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM presales WHERE id = ?')
        .get(result.created_presale_reference.presale_id).count
    ).toBe(1);
  });

  it('returns bridge_blocked when the request has not been handoff-prepared', () => {
    const context = createTelegramPersistenceContext(db);
    const seeded = seedBookingRequest(context, seedData, '6002', {
      prepareHandoff: false,
      queue: false,
      start: false,
    });

    const result = context.services.realPresaleBridgeExecutionService.execute(
      seeded.bookingRequestId,
      {
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        paymentMethod: 'CARD',
      }
    );

    expect(result.bridge_execution_status).toBe('bridge_blocked');
    expect(result.blocked_reason).toMatchObject({
      code: 'HANDOFF_NOT_PREPARED',
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });

  it('returns bridge_blocked when the snapshot has already been consumed without a presale link', () => {
    const context = createTelegramPersistenceContext(db);
    const seeded = seedBookingRequest(context, seedData, '6003', {
      consume: true,
    });

    const result = context.services.realPresaleBridgeExecutionService.execute(
      seeded.bookingRequestId,
      {
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        paymentMethod: 'CARD',
      }
    );

    expect(result.bridge_execution_status).toBe('bridge_blocked');
    expect(result.blocked_reason).toMatchObject({
      code: 'ALREADY_CONSUMED',
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });

  it('returns bridge_failed when the production bridge adapter throws unexpectedly', () => {
    const context = createTelegramPersistenceContext(db);
    const seeded = seedBookingRequest(context, seedData, '6004');
    const error = new Error('Injected bridge failure');
    error.code = 'BRIDGE_EXECUTION_THROWN_TEST';
    context.services.realPresaleBridgeExecutionService.productionPresaleHandoffAdapterService.execute =
      () => {
        throw error;
      };

    const result = context.services.realPresaleBridgeExecutionService.execute(
      seeded.bookingRequestId,
      {
        slotUid: `generated:${seedData.slots.generated.genSlot2}`,
        paymentMethod: 'CARD',
      }
    );

    expect(result.bridge_execution_status).toBe('bridge_failed');
    expect(result.failure_reason).toMatchObject({
      code: 'BRIDGE_EXECUTION_THROWN_TEST',
      message: 'Injected bridge failure',
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM presales').get().count).toBe(0);
  });
});
