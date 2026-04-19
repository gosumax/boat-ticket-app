import Database from 'better-sqlite3';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';

export function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      public_display_name TEXT,
      public_phone_e164 TEXT,
      role TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE presales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      boat_slot_id INTEGER NULL,
      customer_name TEXT,
      customer_phone TEXT,
      number_of_seats INTEGER,
      total_price INTEGER,
      prepayment_amount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      slot_uid TEXT NULL,
      business_day TEXT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      presale_id INTEGER NOT NULL REFERENCES presales(id),
      boat_slot_id INTEGER NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );
  `);
  db.prepare(
    `INSERT INTO users (id, username, role, is_active) VALUES (1, 'seller-a', 'seller', 1)`
  ).run();

  return db;
}

export function createClock(startIso) {
  let current = new Date(startIso);
  return {
    now: () => new Date(current),
    set(iso) {
      current = new Date(iso);
    },
    advanceMinutes(minutes) {
      current = new Date(current.getTime() + minutes * 60 * 1000);
    },
  };
}

export function wireClock(context, clock) {
  context.services.attributionService.now = clock.now;
  context.services.bookingRequestService.now = clock.now;
  context.services.presaleHandoffService.now = clock.now;
  context.services.handoffExecutionService.now = clock.now;
  if (context.services.offlineTicketSnapshotService) {
    context.services.offlineTicketSnapshotService.now = clock.now;
  }
  if (context.services.preTripReminderPlanningService) {
    context.services.preTripReminderPlanningService.now = clock.now;
  }
  if (context.services.postTripMessagePlanningService) {
    context.services.postTripMessagePlanningService.now = clock.now;
  }
  if (context.services.reviewFlowService) {
    context.services.reviewFlowService.now = clock.now;
  }
  if (context.services.usefulContentFaqProjectionService) {
    context.services.usefulContentFaqProjectionService.now = clock.now;
  }
  if (context.services.serviceMessageTemplateManagementService) {
    context.services.serviceMessageTemplateManagementService.now = clock.now;
  }
  if (context.services.sourceRegistryService) {
    context.services.sourceRegistryService.now = clock.now;
  }
  if (context.services.sourceAnalyticsReportingService) {
    context.services.sourceAnalyticsReportingService.now = clock.now;
  }
  if (context.services.qrExportPayloadService) {
    context.services.qrExportPayloadService.now = clock.now;
  }
  if (context.services.analyticsFoundationService) {
    context.services.analyticsFoundationService.now = clock.now;
  }
  if (context.services.runtimeAnalyticsAutoCaptureService) {
    context.services.runtimeAnalyticsAutoCaptureService.now = clock.now;
  }
  if (context.services.inboundStartOrchestrationService) {
    context.services.inboundStartOrchestrationService.now = clock.now;
  }
  if (context.services.templateExecutionOrchestrationService) {
    context.services.templateExecutionOrchestrationService.now = clock.now;
  }
  if (context.services.guestCommandActionOrchestrationService) {
    context.services.guestCommandActionOrchestrationService.now = clock.now;
  }
  if (context.services.runtimeEntrypointOrchestrationService) {
    context.services.runtimeEntrypointOrchestrationService.now = clock.now;
  }
  if (context.services.scheduledMessageRunnerService) {
    context.services.scheduledMessageRunnerService.now = clock.now;
  }
}

export function createTestContext(clock, contextOptions = {}) {
  const db = createTestDb();
  const context = createTelegramPersistenceContext(db, contextOptions);
  wireClock(context, clock);

  return {
    db,
    context,
  };
}

export function seedBookingRequest(
  context,
  clock,
  {
    suffix,
    requestedTripDate = '2026-04-12',
    requestedTimeSlot = '12:00',
    requestedSeats = 2,
    requestedTicketMix = { adult: 2 },
    requestedPrepaymentAmount = 2000,
    sellerName = `Seller ${suffix}`,
    sellerPhoneE164 = `+7999000${suffix}`,
  } = {}
) {
  wireClock(context, clock);

  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-ticket-${suffix}`,
    display_name: `Ticket Guest ${suffix}`,
    username: `ticket_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999555${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `ticket-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `Ticket Source ${suffix}`,
    default_seller_id: 1,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `ticket-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: 1,
    entry_context: {
      zone: `ticket-zone-${suffix}`,
      seller_contact: {
        name: sellerName,
        phone_e164: sellerPhoneE164,
      },
    },
    is_active: 1,
  });
  const attribution = services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    entry_channel: 'qr',
  });
  const lifecycle = services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id:
      attribution.sellerAttributionSession.seller_attribution_session_id,
    requested_trip_date: requestedTripDate,
    requested_time_slot: requestedTimeSlot,
    requested_seats: requestedSeats,
    requested_ticket_mix: requestedTicketMix,
    requested_prepayment_amount: requestedPrepaymentAmount,
    currency: 'RUB',
    contact_phone_e164: guest.phone_e164,
  });

  return {
    guest,
    source,
    qr,
    attribution: attribution.sellerAttributionSession,
    bookingRequest: lifecycle.bookingRequest,
    bookingHold: lifecycle.bookingHold,
    bookingRequestId: lifecycle.bookingRequest.booking_request_id,
  };
}

export function confirmAndLinkToPresale(
  db,
  context,
  clock,
  {
    bookingRequestId,
    presaleStatus = 'ACTIVE',
    ticketStatuses = ['ACTIVE'],
    presaleId = null,
    numberOfSeats = 2,
    totalPrice = 5000,
    prepaymentAmount = 2000,
    slotUid = 'generated:42',
    boatSlotId = 42,
    businessDay = '2026-04-12',
    customerPhone = '+79990000000',
  }
) {
  wireClock(context, clock);
  const nowIso = clock.now().toISOString();

  context.services.bookingRequestService.confirmPrepayment(bookingRequestId, {
    actorType: 'system',
    actorId: `confirm-${bookingRequestId}`,
  });

  const insertResult = presaleId
    ? db
        .prepare(
          `
            INSERT INTO presales (
              id,
              boat_slot_id,
              customer_name,
              customer_phone,
              number_of_seats,
              total_price,
              prepayment_amount,
              status,
              slot_uid,
              business_day,
              created_at,
              updated_at
            )
            VALUES (?, ?, 'Ticket Guest', ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          presaleId,
          boatSlotId,
          customerPhone,
          numberOfSeats,
          totalPrice,
          prepaymentAmount,
          presaleStatus,
          slotUid,
          businessDay,
          nowIso,
          nowIso
        )
    : db
        .prepare(
          `
            INSERT INTO presales (
              boat_slot_id,
              customer_name,
              customer_phone,
              number_of_seats,
              total_price,
              prepayment_amount,
              status,
              slot_uid,
              business_day,
              created_at,
              updated_at
            )
            VALUES (?, 'Ticket Guest', ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          boatSlotId,
          customerPhone,
          numberOfSeats,
          totalPrice,
          prepaymentAmount,
          presaleStatus,
          slotUid,
          businessDay,
          nowIso,
          nowIso
        );
  const linkedPresaleId = Number(presaleId || insertResult.lastInsertRowid);

  for (const status of ticketStatuses) {
    db.prepare(
      `
        INSERT INTO tickets (presale_id, boat_slot_id, status)
        VALUES (?, ?, ?)
      `
    ).run(linkedPresaleId, boatSlotId, status);
  }

  context.repositories.bookingRequests.updateById(bookingRequestId, {
    request_status: 'CONFIRMED_TO_PRESALE',
    confirmed_presale_id: linkedPresaleId,
    last_status_at: clock.now().toISOString(),
  });

  return linkedPresaleId;
}
