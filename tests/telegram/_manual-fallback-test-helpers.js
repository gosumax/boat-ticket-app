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
      payment_method TEXT NULL,
      payment_cash_amount INTEGER DEFAULT 0,
      payment_card_amount INTEGER DEFAULT 0,
      seller_id INTEGER NULL,
      business_day TEXT NULL,
      tickets_json TEXT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(
    `INSERT INTO users (username, role, is_active) VALUES ('seller-a', 'seller', 1)`
  ).run();
  db.prepare(
    `INSERT INTO users (username, role, is_active) VALUES ('seller-b', 'seller', 1)`
  ).run();

  return db;
}

export function createClock(startIso) {
  let current = new Date(startIso);
  return {
    now: () => new Date(current),
    set(isoTimestamp) {
      current = new Date(isoTimestamp);
    },
    advanceMinutes(minutes) {
      current = new Date(current.getTime() + minutes * 60 * 1000);
    },
  };
}

export function createTestContext(clock) {
  const db = createTestDb();
  const context = createTelegramPersistenceContext(db);
  wireClock(context, clock);
  return { db, context };
}

export function wireClock(context, clock) {
  context.services.bookingRequestService.now = clock.now;
  context.services.presaleHandoffService.now = clock.now;
  context.services.handoffExecutionService.now = clock.now;
  context.services.manualFallbackQueueService.now = clock.now;
  if (context.services.manualFallbackQueueQueryService) {
    context.services.manualFallbackQueueQueryService.now = clock.now;
  }
  if (context.services.manualFallbackActionService) {
    context.services.manualFallbackActionService.now = clock.now;
  }
}

export function seedBookingRequest(
  context,
  clock,
  {
    suffix,
    sourceType = 'promo_qr',
    sourceName = `Manual Source ${suffix}`,
    sellerId = null,
    attributionStatus = 'ACTIVE',
    expiresAt = '2026-04-10T12:45:00.000Z',
    bindingReason = sourceType,
    requestedPrepaymentAmount = 3200,
  }
) {
  wireClock(context, clock);

  const { repositories, services } = context;
  const guest = repositories.guestProfiles.create({
    telegram_user_id: `tg-manual-new-${suffix}`,
    display_name: `Manual New Guest ${suffix}`,
    username: `manual_new_guest_${suffix}`,
    language_code: 'ru',
    phone_e164: `+7999888${suffix}`,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = repositories.trafficSources.create({
    source_code: `manual-new-source-${suffix}`,
    source_type: sourceType,
    source_name: sourceName,
    default_seller_id: sellerId,
    is_active: 1,
  });
  const qr = repositories.sourceQRCodes.create({
    qr_token: `manual-new-token-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: { zone: `manual-new-zone-${suffix}` },
    is_active: 1,
  });
  const attributionSession = repositories.sellerAttributionSessions.create({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    seller_id: sellerId,
    starts_at: clock.now().toISOString(),
    expires_at: expiresAt,
    attribution_status: attributionStatus,
    binding_reason: bindingReason,
  });

  const lifecycle = services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id: attributionSession.seller_attribution_session_id,
    requested_trip_date: '2026-04-12',
    requested_time_slot: '12:00',
    requested_seats: 2,
    requested_ticket_mix: { adult: 2 },
    requested_prepayment_amount: requestedPrepaymentAmount,
    currency: 'RUB',
    contact_phone_e164: `+7999888${suffix}`,
  });

  return {
    guest,
    source,
    qr,
    attributionSession,
    bookingRequest: lifecycle.bookingRequest,
    bookingHold: lifecycle.bookingHold,
    bookingRequestId: lifecycle.bookingRequest.booking_request_id,
  };
}

export function seedSourceBindingEvent(
  context,
  clock,
  {
    telegramUserId,
    bindingStatus,
    resolvedSourceFamily = null,
    rawSourceToken = null,
    normalizedSourceToken = null,
  }
) {
  const eventIso = clock.now().toISOString();
  const guestEntryEvent = context.repositories.guestEntryEvents.create({
    entry_status: 'RECORDED',
    telegram_update_id: Number(Date.now() % 1000000),
    telegram_message_id: Number((Date.now() + 1) % 1000000),
    telegram_user_summary: {
      telegram_user_id: telegramUserId,
      display_name: telegramUserId,
    },
    telegram_chat_summary: {},
    normalized_start_payload: {
      normalized_event_type: 'TELEGRAM_START_UPDATE_NORMALIZED',
      has_payload: Boolean(rawSourceToken),
      normalized_payload: rawSourceToken,
    },
    source_token: rawSourceToken,
    event_timestamp_summary: {
      iso: eventIso,
      unix_seconds: Math.floor(Date.parse(eventIso) / 1000),
    },
    entry_payload: {},
    idempotency_key: `guest-entry-${telegramUserId}-${bindingStatus}-${Date.now()}`,
    dedupe_key: `guest-entry-${telegramUserId}-${bindingStatus}-${Date.now()}`,
    entry_signature: {},
  });

  return context.repositories.guestEntrySourceBindingEvents.create({
    guest_entry_event_id: guestEntryEvent.guest_entry_event_id,
    event_type: 'SOURCE_BOUND',
    binding_status: bindingStatus,
    telegram_user_summary: {
      telegram_user_id: telegramUserId,
      display_name: telegramUserId,
    },
    guest_entry_reference: {
      reference_type: 'telegram_guest_entry_event',
      guest_entry_event_id: guestEntryEvent.guest_entry_event_id,
      idempotency_key: guestEntryEvent.idempotency_key,
    },
    raw_source_token: rawSourceToken,
    normalized_source_token: normalizedSourceToken,
    resolved_source_family: resolvedSourceFamily,
    source_resolution_outcome: bindingStatus,
    source_resolution_summary: {},
    event_at: eventIso,
    event_timestamp_summary: {
      iso: eventIso,
      unix_seconds: Math.floor(Date.parse(eventIso) / 1000),
    },
    binding_payload: {
      response_version: 'telegram_source_binding_persistence_result.v1',
    },
    idempotency_key: `source-binding-${telegramUserId}-${bindingStatus}-${Date.now()}`,
    dedupe_key: `source-binding-${telegramUserId}-${bindingStatus}-${Date.now()}`,
    binding_signature: {},
  });
}

export function listRequestEvents(context, bookingRequestId) {
  return context.repositories.bookingRequestEvents.listBy(
    { booking_request_id: bookingRequestId },
    { orderBy: 'booking_request_event_id ASC', limit: 500 }
  );
}
