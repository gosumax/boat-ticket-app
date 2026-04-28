import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTelegramMiniAppRouter } from '../../server/telegram/mini-app-router.mjs';
import { resolveTelegramRuntimeConfig } from '../../server/telegram/runtime-config.mjs';
import {
  createMiniAppFoundationContext,
  MINI_APP_FUTURE_DATE,
} from './_mini-app-foundation-test-helpers.js';
import { countRows } from './_booking-request-lifecycle-helpers.js';
import {
  confirmAndLinkToPresale,
  createClock,
  wireClock,
} from './_guest-ticket-test-helpers.js';

function buildStartUpdate({
  updateId,
  messageId,
  telegramUserId,
  unixSeconds,
  text,
}) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: unixSeconds,
      text,
      from: {
        id: telegramUserId,
        is_bot: false,
        first_name: 'Mini',
        last_name: 'Guest',
        username: `mini_guest_${telegramUserId}`,
        language_code: 'ru',
      },
      chat: {
        id: telegramUserId,
        type: 'private',
        first_name: 'Mini',
        last_name: 'Guest',
        username: `mini_guest_${telegramUserId}`,
      },
    },
  };
}

function buildTelegramWebAppInitData({
  telegramUserId,
  username = null,
  firstName = 'Mini',
  languageCode = 'ru',
}) {
  const params = new URLSearchParams();
  params.set('query_id', `qa_${telegramUserId}`);
  params.set(
    'user',
    JSON.stringify({
      id: Number(telegramUserId),
      is_bot: false,
      first_name: firstName,
      username,
      language_code: languageCode,
    })
  );
  params.set('auth_date', '1775815200');
  params.set('hash', `hash_${telegramUserId}`);
  return params.toString();
}

describe('telegram mini app router', () => {
  let app;
  let context;
  let db;
  let clocks;
  let telegramRuntimeConfig;

  function mountMiniAppRouter(nowIso = '2036-04-10T10:31:00.000Z') {
    app = express();
    app.use(express.json());
    app.use(
      '/api/telegram',
      createTelegramMiniAppRouter({
        telegramContext: context,
        telegramRuntimeConfig,
        now: () => new Date(nowIso),
      })
    );
  }

  beforeEach(() => {
    const seeded = createMiniAppFoundationContext();
    context = seeded.context;
    db = seeded.db;
    clocks = seeded.clocks;
    telegramRuntimeConfig = resolveTelegramRuntimeConfig({
      env: {
        TELEGRAM_BOT_TOKEN: '123456:ABC_DEF-runtime',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'telegram-secret-123',
        TELEGRAM_PUBLIC_BASE_URL: 'https://example.test',
      },
    });
    mountMiniAppRouter();
  });

  afterEach(() => {
    db.close();
  });

  async function submitGuestBookingRequest({
    telegramUserId = '777000111',
    requestedTimeSlot = '12:00',
    idempotencyKey = 'mini-app-http-ticket-seed',
  } = {}) {
    const response = await request(app)
      .post('/api/telegram/mini-app/booking-submit')
      .send({
        telegram_user_id: telegramUserId,
        selected_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: MINI_APP_FUTURE_DATE,
          requested_time_slot: requestedTimeSlot,
          slot_uid: requestedTimeSlot === '10:00' ? 'generated:41' : 'generated:42',
        },
        requested_seats: 2,
        requested_prepayment_amount: 1000,
        customer_name: 'Mini Guest',
        contact_phone: '+79990000000',
        idempotency_key: idempotencyKey,
      });

    expect(response.status).toBe(201);
    return Number(
      response.body?.operation_result_summary?.booking_request_reference?.booking_request_id
    );
  }

  function ensureMiniAppPresaleTicketColumns() {
    const presaleColumns = [
      'boat_slot_id INTEGER NULL',
      'customer_name TEXT',
      'customer_phone TEXT',
      'number_of_seats INTEGER',
      'total_price INTEGER',
      'prepayment_amount INTEGER DEFAULT 0',
      "status TEXT DEFAULT 'ACTIVE'",
      'slot_uid TEXT NULL',
      'business_day TEXT NULL',
      'created_at TEXT DEFAULT CURRENT_TIMESTAMP',
      'updated_at TEXT DEFAULT CURRENT_TIMESTAMP',
    ];

    for (const columnDefinition of presaleColumns) {
      const columnName = columnDefinition.split(' ')[0];
      try {
        db.exec(`ALTER TABLE presales ADD COLUMN ${columnDefinition}`);
      } catch (error) {
        if (!String(error?.message || '').includes(`duplicate column name: ${columnName}`)) {
          throw error;
        }
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presale_id INTEGER NOT NULL REFERENCES presales(id),
        boat_slot_id INTEGER NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
    `);
  }

  function seedReadyCanonicalPresale({
    slotUid = 'generated:42',
    boatSlotId = 42,
    businessDay = MINI_APP_FUTURE_DATE,
    customerPhone = '+79990000000',
    numberOfSeats = 2,
    totalPrice = 6000,
    prepaymentAmount = 1000,
    createdAt = '2036-04-10T10:42:00.000Z',
  } = {}) {
    ensureMiniAppPresaleTicketColumns();
    const insertResult = db
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
          VALUES (?, 'Mini Guest', ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
        `
      )
      .run(
        boatSlotId,
        customerPhone,
        numberOfSeats,
        totalPrice,
        prepaymentAmount,
        slotUid,
        businessDay,
        createdAt,
        createdAt
      );
    const canonicalPresaleId = Number(insertResult.lastInsertRowid);
    db.prepare(
      `
        INSERT INTO tickets (presale_id, boat_slot_id, status)
        VALUES (?, ?, 'ACTIVE')
      `
    ).run(canonicalPresaleId, boatSlotId);
    return canonicalPresaleId;
  }

  async function bindCanonicalTicketToMiniAppGuest({
    canonicalPresaleId,
    telegramUserId = '777000111',
    sourceToken,
  }) {
    const trustedSourceToken =
      sourceToken || seedTrustedTicketSourceToken(`seller-direct-link-${canonicalPresaleId}`);
    const response = await request(app)
      .get('/api/telegram/mini-app/ticket-view')
      .query({
        telegram_user_id: telegramUserId,
        canonical_presale_id: canonicalPresaleId,
        source_token: trustedSourceToken,
      });

    expect(response.status).toBe(200);
    return response;
  }

  function seedTrustedTicketSourceToken(sourceToken = 'seller-direct-link-42') {
    const nowIso = '2036-04-10T10:30:00.000Z';
    db.prepare(
      `
        INSERT INTO telegram_source_registry_items (
          source_reference,
          source_family,
          source_type,
          source_token,
          seller_id,
          is_enabled,
          is_exportable,
          source_payload,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      `source-ref-${sourceToken}`,
      'seller',
      'seller_deep_link',
      sourceToken,
      1,
      1,
      1,
      '{}',
      nowIso,
      nowIso
    );
    return sourceToken;
  }

  function ensureCanonicalTicketTablesForRepair() {
    const presaleColumns = [
      "status TEXT DEFAULT 'ACTIVE'",
      'slot_uid TEXT NULL',
      'boat_slot_id INTEGER NULL',
      'business_day TEXT NULL',
      'number_of_seats INTEGER NULL',
      'total_price INTEGER NULL',
      'prepayment_amount INTEGER NULL',
      'customer_phone TEXT NULL',
      'created_at TEXT DEFAULT CURRENT_TIMESTAMP',
      'updated_at TEXT DEFAULT CURRENT_TIMESTAMP',
    ];

    for (const columnDefinition of presaleColumns) {
      const columnName = columnDefinition.split(' ')[0];
      try {
        db.exec(`ALTER TABLE presales ADD COLUMN ${columnDefinition}`);
      } catch (error) {
        if (!String(error?.message || '').includes(`duplicate column name: ${columnName}`)) {
          throw error;
        }
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presale_id INTEGER NOT NULL REFERENCES presales(id),
        boat_slot_id INTEGER NULL,
        ticket_code TEXT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        price INTEGER NULL
      );
    `);
  }

  function confirmPrepaymentWithoutHandoff(bookingRequestId) {
    return context.services.bookingRequestService.confirmPrepayment(bookingRequestId, {
      actorType: 'seller',
      actorId: '1',
      eventMetadata: {
        accepted_prepayment_amount: 1000,
        payment_method: 'CASH',
      },
    });
  }

  function stubSuccessfulRepairBridge() {
    ensureCanonicalTicketTablesForRepair();
    context.services.realPresaleHandoffOrchestratorService.orchestrate = (
      bookingRequestId
    ) => {
      const insertResult = db.prepare(
        `
          INSERT INTO presales (
            status, slot_uid, boat_slot_id, business_day, number_of_seats,
            total_price, prepayment_amount, customer_phone
          )
          VALUES ('ACTIVE', 'generated:41', 41, ?, 2, 3000, 1000, '+79990000000')
        `
      ).run(MINI_APP_FUTURE_DATE);
      const presaleId = Number(insertResult.lastInsertRowid);
      db.prepare(
        `
          INSERT INTO tickets (presale_id, boat_slot_id, ticket_code, status, price)
          VALUES (?, 41, 'TKT-REPAIR-1', 'ACTIVE', 1500)
        `
      ).run(presaleId);
      context.repositories.bookingRequests.updateById(bookingRequestId, {
        confirmed_presale_id: presaleId,
        request_status: 'CONFIRMED_TO_PRESALE',
        last_status_at: '2036-04-10T10:41:30.000Z',
      });

      return {
        orchestration_status: 'presale_created',
        created_presale_reference: {
          reference_type: 'canonical_presale',
          presale_id: presaleId,
        },
      };
    };
  }

  function stubFailedRepairBridge() {
    context.services.realPresaleHandoffOrchestratorService.orchestrate = () => ({
      orchestration_status: 'bridge_failed',
      failure_reason: {
        code: 'PRESALE_CREATE_FAILED',
        message: 'test bridge failure',
      },
    });
  }

  it('repairs a confirmed prepayment request with no handoff into a linked ticket on next load', async () => {
    const bookingRequestId = await submitGuestBookingRequest({
      requestedTimeSlot: '10:00',
      idempotencyKey: 'mini-app-http-stuck-prepayment-repair',
    });
    confirmPrepaymentWithoutHandoff(bookingRequestId);
    stubSuccessfulRepairBridge();

    expect(
      context.repositories.bookingRequests.getById(bookingRequestId)
    ).toMatchObject({
      request_status: 'PREPAYMENT_CONFIRMED',
      confirmed_presale_id: null,
    });

    const ticketList = await request(app)
      .get('/api/telegram/mini-app/my-tickets')
      .query({
        telegram_user_id: '777000111',
      });

    expect(ticketList.status).toBe(200);
    const repairedRequest =
      context.repositories.bookingRequests.getById(bookingRequestId);
    expect(repairedRequest.request_status).toBe('CONFIRMED_TO_PRESALE');
    expect(Number(repairedRequest.confirmed_presale_id)).toBeGreaterThan(0);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM tickets WHERE presale_id = ?')
        .get(repairedRequest.confirmed_presale_id).count
    ).toBe(1);
    const repairedItem = ticketList.body.operation_result_summary.items.find(
      (item) =>
        item.booking_request_reference?.booking_request_id === bookingRequestId
    );
    expect(repairedItem).toMatchObject({
      ticket_status_summary: {
        deterministic_ticket_state: 'linked_ticket_ready',
      },
      ticket_availability_state: 'available',
    });
  });

  it('closes an unrecoverable confirmed prepayment repair and stops blocking new bookings', async () => {
    const bookingRequestId = await submitGuestBookingRequest({
      requestedTimeSlot: '10:00',
      idempotencyKey: 'mini-app-http-stuck-prepayment-failed-repair',
    });
    confirmPrepaymentWithoutHandoff(bookingRequestId);
    stubFailedRepairBridge();

    const ticketList = await request(app)
      .get('/api/telegram/mini-app/my-tickets')
      .query({
        telegram_user_id: '777000111',
      });

    expect(ticketList.status).toBe(200);
    const closedRequest =
      context.repositories.bookingRequests.getById(bookingRequestId);
    expect(closedRequest.request_status).toBe('CLOSED_UNCONVERTED');
    expect(closedRequest.confirmed_presale_id).toBeNull();
    const closedItem = ticketList.body.operation_result_summary.items.find(
      (item) =>
        item.booking_request_reference?.booking_request_id === bookingRequestId
    );
    expect(closedItem).toMatchObject({
      ticket_status_summary: {
        deterministic_ticket_state: 'linked_ticket_cancelled_or_unavailable',
      },
      ticket_availability_state: 'unavailable',
    });

    const newBooking = await request(app)
      .post('/api/telegram/mini-app/booking-submit')
      .send({
        telegram_user_id: '777000111',
        selected_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: MINI_APP_FUTURE_DATE,
          requested_time_slot: '12:00',
          slot_uid: 'generated:42',
        },
        requested_seats: 2,
        requested_prepayment_amount: 1000,
        customer_name: 'Mini Guest',
        contact_phone: '+79990000000',
        idempotency_key: 'mini-app-http-after-failed-repair',
      });

    expect(newBooking.status).toBe(201);
  });

  it('binds Mini App runtime init-data to the same guest created by QR /start', async () => {
    const telegramUserId = '777004444';
    const startUpdate = buildStartUpdate({
      updateId: 9301001,
      messageId: 701,
      telegramUserId: Number(telegramUserId),
      unixSeconds: 1767777000,
      text: '/start seller-qr-token-a',
    });
    const startResult =
      context.services.inboundStartOrchestrationService.orchestrateInboundStartUpdate(
        startUpdate
      );
    const startReplay =
      context.services.inboundStartOrchestrationService.orchestrateInboundStartUpdate(
        startUpdate
      );
    const initData = buildTelegramWebAppInitData({
      telegramUserId,
      username: `mini_guest_${telegramUserId}`,
    });

    expect(startResult.orchestration_status).toBe(
      'start_processed_with_seller_attribution'
    );
    expect(startReplay.guest_entry_reference.guest_entry_event_id).toBe(
      startResult.guest_entry_reference.guest_entry_event_id
    );
    expect(
      startReplay.source_binding_summary.source_binding_reference.source_binding_event_id
    ).toBe(
      startResult.source_binding_summary.source_binding_reference.source_binding_event_id
    );
    const rowCountsBeforeMiniAppOpen = {
      guestProfiles: countRows(db, 'telegram_guest_profiles'),
      guestEntryEvents: countRows(db, 'telegram_guest_entry_events'),
      sourceBindingEvents: countRows(db, 'telegram_guest_entry_source_binding_events'),
      sellerAttributionSessions: countRows(db, 'telegram_seller_attribution_sessions'),
      sellerAttributionSessionStartEvents: countRows(
        db,
        'telegram_seller_attribution_session_start_events'
      ),
    };

    const catalog = await request(app)
      .get('/api/telegram/mini-app/catalog')
      .set('x-telegram-webapp-init-data', initData)
      .query({
        date: MINI_APP_FUTURE_DATE,
      });

    expect(catalog.status).toBe(200);
    expect(catalog.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_catalog',
      operation_result_summary: {
        list_scope: 'mini_app_guest_trips_catalog',
        item_count: 3,
        telegram_user_summary: {
          telegram_user_id: telegramUserId,
        },
      },
    });

    const submit = await request(app)
      .post('/api/telegram/mini-app/booking-submit')
      .set('x-telegram-webapp-init-data', initData)
      .send({
        selected_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: MINI_APP_FUTURE_DATE,
          requested_time_slot: '12:00',
          slot_uid: 'generated:42',
        },
        requested_seats: 2,
        requested_prepayment_amount: 1000,
        customer_name: 'Mini Guest',
        contact_phone: '+79994440000',
        idempotency_key: 'mini-app-http-init-data-submit',
      });

    expect(submit.status).toBe(201);
    expect(submit.body).toMatchObject({
      route_status: 'processed_created',
      route_operation_type: 'mini_app_booking_submit',
      operation_result_summary: {
        submit_status: 'submitted_with_hold',
        seller_contact_summary: {
          seller_display_name: 'Seller A',
          seller_phone_e164: '+79991112233',
        },
      },
    });
    const bookingRequestId = Number(
      submit.body?.operation_result_summary?.booking_request_reference?.booking_request_id
    );
    expect(Number.isInteger(bookingRequestId) && bookingRequestId > 0).toBe(true);

    const myRequests = await request(app)
      .get('/api/telegram/mini-app/my-requests')
      .set('x-telegram-webapp-init-data', initData);

    expect(myRequests.status).toBe(200);
    expect(myRequests.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_my_requests_list',
      operation_result_summary: {
        response_version: 'telegram_mini_app_guest_my_requests.v1',
        list_scope: 'mini_app_guest_my_requests',
        telegram_user_summary: {
          telegram_user_id: telegramUserId,
        },
      },
    });
    expect(myRequests.body.operation_result_summary.active_reservation_count).toBeGreaterThan(
      0
    );
    expect(myRequests.body.operation_result_summary.lifecycle_item_count).toBeGreaterThan(0);
    expect(myRequests.body.operation_result_summary.trip_timeline_item_count).toBeGreaterThan(
      0
    );
    expect(
      myRequests.body.operation_result_summary.state_buckets
        .completed_cancelled_expired.length
    ).toBeGreaterThanOrEqual(0);

    const myTickets = await request(app)
      .get('/api/telegram/mini-app/my-tickets')
      .set('x-telegram-webapp-init-data', initData);

    expect(myTickets.status).toBe(200);
    expect(myTickets.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_my_tickets_list',
      operation_result_summary: {
        list_scope: 'mini_app_guest_my_tickets',
        telegram_user_summary: {
          telegram_user_id: telegramUserId,
        },
        my_requests_read_model: {
          list_scope: 'mini_app_guest_my_requests',
          trip_timeline_item_count: expect.any(Number),
          state_buckets: {
            completed_cancelled_expired: expect.any(Array),
            linked_to_presale: expect.any(Array),
            telegram_confirmed_not_yet_ticketed: expect.any(Array),
          },
        },
      },
    });
    expect(
      myTickets.body.operation_result_summary.items.some(
        (item) => item.booking_request_reference?.booking_request_id === bookingRequestId
      )
    ).toBe(true);
    expect(
      myTickets.body.operation_result_summary.items.find(
        (item) => item.booking_request_reference?.booking_request_id === bookingRequestId
      )
    ).toMatchObject({
      seller_contact_summary: {
        seller_display_name: 'Seller A',
        seller_phone_e164: '+79991112233',
      },
      hold_status_summary: {
        hold_status: 'ACTIVE',
      },
    });

    const ticketView = await request(app)
      .get(`/api/telegram/mini-app/my-tickets/${bookingRequestId}`)
      .set('x-telegram-webapp-init-data', initData);
    expect(ticketView.status).toBe(200);
    expect(ticketView.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_ticket_view',
      operation_result_summary: {
        booking_request_reference: {
          booking_request_id: bookingRequestId,
        },
        seller_contact_summary: {
          seller_display_name: 'Seller A',
          seller_phone_e164: '+79991112233',
        },
        hold_status_summary: {
          hold_status: 'ACTIVE',
        },
      },
    });

    const offlineSnapshot = await request(app)
      .get(`/api/telegram/mini-app/my-tickets/${bookingRequestId}/offline-snapshot`)
      .set('x-telegram-webapp-init-data', initData);
    expect(offlineSnapshot.status).toBe(200);
    expect(offlineSnapshot.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_ticket_offline_snapshot',
      operation_result_summary: {
        booking_request_reference: {
          booking_request_id: bookingRequestId,
        },
      },
    });

    const myRequestsReplay = await request(app)
      .get('/api/telegram/mini-app/my-requests')
      .set('x-telegram-webapp-init-data', initData);

    expect(myRequestsReplay.status).toBe(200);
    expect(myRequestsReplay.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_my_requests_list',
      operation_result_summary: {
        telegram_user_summary: {
          telegram_user_id: telegramUserId,
        },
      },
    });
    expect(countRows(db, 'telegram_guest_profiles')).toBe(
      rowCountsBeforeMiniAppOpen.guestProfiles
    );
    expect(countRows(db, 'telegram_guest_entry_events')).toBe(
      rowCountsBeforeMiniAppOpen.guestEntryEvents
    );
    expect(countRows(db, 'telegram_guest_entry_source_binding_events')).toBe(
      rowCountsBeforeMiniAppOpen.sourceBindingEvents
    );
    expect(countRows(db, 'telegram_seller_attribution_sessions')).toBe(
      rowCountsBeforeMiniAppOpen.sellerAttributionSessions
    );
    expect(countRows(db, 'telegram_seller_attribution_session_start_events')).toBe(
      rowCountsBeforeMiniAppOpen.sellerAttributionSessionStartEvents
    );
  });

  it('resolves guest identity from encoded tgWebAppData query fallback', async () => {
    const telegramUserId = '777006666';
    const startUpdate = buildStartUpdate({
      updateId: 9302001,
      messageId: 801,
      telegramUserId: Number(telegramUserId),
      unixSeconds: 1767777700,
      text: '/start seller-qr-token-a',
    });
    context.services.inboundStartOrchestrationService.orchestrateInboundStartUpdate(
      startUpdate
    );

    const initData = buildTelegramWebAppInitData({
      telegramUserId,
      username: `mini_guest_${telegramUserId}`,
    });
    const encodedInitData = encodeURIComponent(encodeURIComponent(initData));

    const catalog = await request(app)
      .get('/api/telegram/mini-app/catalog')
      .query({
        tgWebAppData: encodedInitData,
        date: MINI_APP_FUTURE_DATE,
      });

    expect(catalog.status).toBe(200);
    expect(catalog.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_catalog',
      operation_result_summary: {
        telegram_user_summary: {
          telegram_user_id: telegramUserId,
        },
      },
    });

    const myRequests = await request(app)
      .get('/api/telegram/mini-app/my-requests')
      .query({
        tgWebAppData: encodedInitData,
      });

    expect(myRequests.status).toBe(200);
    expect(myRequests.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_my_requests_list',
      operation_result_summary: {
        telegram_user_summary: {
          telegram_user_id: telegramUserId,
        },
      },
    });
  });

  it('builds ticket-view projection from canonical presale when booking request linkage is absent', async () => {
    const sourceToken = seedTrustedTicketSourceToken('seller-direct-link-canonical-1');
    const insertResult = db.prepare('INSERT INTO presales DEFAULT VALUES').run();
    const canonicalPresaleId = Number(insertResult.lastInsertRowid);
    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presale_id INTEGER NOT NULL,
        status TEXT NOT NULL
      )
    `);
    db.prepare(
      `
        INSERT INTO tickets (presale_id, status)
        VALUES (?, ?)
      `
    ).run(canonicalPresaleId, 'ACTIVE');

    const response = await request(app)
      .get('/api/telegram/mini-app/ticket-view')
      .query({
        telegram_user_id: '777000111',
        canonical_presale_id: canonicalPresaleId,
        source_token: sourceToken,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_ticket_view',
      operation_result_summary: {
        booking_request_reference: null,
        linked_canonical_presale_reference: {
          presale_id: canonicalPresaleId,
        },
        ticket_status_summary: {
          deterministic_ticket_state: 'linked_ticket_ready',
          canonical_linkage_status: 'canonical_presale_only',
        },
        ticket_availability_state: 'available',
      },
    });
    expect(
      response.body?.operation_result_summary?.buyer_ticket_reference_summary?.buyer_ticket_code
    ).toBeTruthy();
  });

  it('keeps canonical seller-ticket visible in my-tickets after FAQ navigation and repeated re-entry', async () => {
    const sourceToken = seedTrustedTicketSourceToken('seller-direct-link-canonical-2');
    await submitGuestBookingRequest({
      idempotencyKey: 'mini-app-http-my-tickets-old-seed',
    });

    const insertResult = db.prepare('INSERT INTO presales DEFAULT VALUES').run();
    const canonicalPresaleId = Number(insertResult.lastInsertRowid);
    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presale_id INTEGER NOT NULL,
        status TEXT NOT NULL
      )
    `);
    db.prepare(
      `
        INSERT INTO tickets (presale_id, status)
        VALUES (?, ?)
      `
    ).run(canonicalPresaleId, 'ACTIVE');

    const ticketView = await request(app)
      .get('/api/telegram/mini-app/ticket-view')
      .query({
        telegram_user_id: '777000111',
        canonical_presale_id: canonicalPresaleId,
        source_token: sourceToken,
      });

    expect(ticketView.status).toBe(200);
    expect(ticketView.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_ticket_view',
      operation_result_summary: {
        booking_request_reference: null,
        linked_canonical_presale_reference: {
          presale_id: canonicalPresaleId,
        },
        ticket_status_summary: {
          canonical_linkage_status: 'canonical_presale_only',
        },
      },
    });
    expect(countRows(db, 'telegram_guest_canonical_ticket_links')).toBe(1);

    const faq = await request(app)
      .get('/api/telegram/mini-app/entrypoint/faq')
      .query({
        telegram_user_id: '777000111',
      });
    expect(faq.status).toBe(200);

    const myTicketsAfterNavigation = await request(app)
      .get('/api/telegram/mini-app/my-tickets')
      .query({
        telegram_user_id: '777000111',
        limit: 20,
      });

    expect(myTicketsAfterNavigation.status).toBe(200);
    expect(
      myTicketsAfterNavigation.body.operation_result_summary.items.some(
        (item) =>
          Number(item?.linked_canonical_presale_reference?.presale_id) ===
          canonicalPresaleId
      )
    ).toBe(true);

    const myTicketsAfterReopen = await request(app)
      .get('/api/telegram/mini-app/my-tickets')
      .query({
        telegram_user_id: '777000111',
        limit: 20,
      });

    expect(myTicketsAfterReopen.status).toBe(200);
    expect(
      myTicketsAfterReopen.body.operation_result_summary.items.some(
        (item) =>
          Number(item?.linked_canonical_presale_reference?.presale_id) ===
          canonicalPresaleId
      )
    ).toBe(true);
  });

  it('binds canonical ticket to first trusted guest and rejects other guests with neutral not-found message', async () => {
    const sourceToken = seedTrustedTicketSourceToken('seller-direct-link-canonical-3');
    const insertResult = db.prepare('INSERT INTO presales DEFAULT VALUES').run();
    const canonicalPresaleId = Number(insertResult.lastInsertRowid);
    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presale_id INTEGER NOT NULL,
        status TEXT NOT NULL
      )
    `);
    db.prepare(
      `
        INSERT INTO tickets (presale_id, status)
        VALUES (?, ?)
      `
    ).run(canonicalPresaleId, 'ACTIVE');

    const firstGuestView = await request(app)
      .get('/api/telegram/mini-app/ticket-view')
      .query({
        telegram_user_id: '777000111',
        canonical_presale_id: canonicalPresaleId,
        source_token: sourceToken,
      });
    expect(firstGuestView.status).toBe(200);
    expect(countRows(db, 'telegram_guest_canonical_ticket_links')).toBe(1);

    const secondGuestView = await request(app)
      .get('/api/telegram/mini-app/ticket-view')
      .query({
        telegram_user_id: '777000222',
        canonical_presale_id: canonicalPresaleId,
      });
    expect(secondGuestView.status).toBe(404);
    expect(secondGuestView.body).toMatchObject({
      route_status: 'rejected_not_found',
      route_operation_type: 'mini_app_ticket_view',
      operation_result_summary: null,
      rejection_reason:
        'Билет не найден. Проверьте номер или откройте билет по ссылке из Telegram.',
    });
  });

  it('rejects first canonical ticket open without trusted source token', async () => {
    const insertResult = db.prepare('INSERT INTO presales DEFAULT VALUES').run();
    const canonicalPresaleId = Number(insertResult.lastInsertRowid);
    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presale_id INTEGER NOT NULL,
        status TEXT NOT NULL
      )
    `);
    db.prepare(
      `
        INSERT INTO tickets (presale_id, status)
        VALUES (?, ?)
      `
    ).run(canonicalPresaleId, 'ACTIVE');

    const response = await request(app)
      .get('/api/telegram/mini-app/ticket-view')
      .query({
        telegram_user_id: '777000333',
        canonical_presale_id: canonicalPresaleId,
      });
    expect(response.status).toBe(404);
    expect(response.body?.operation_result_summary).toBe(null);
    expect(response.body?.rejection_reason).toBe(
      'Билет не найден. Проверьте номер или откройте билет по ссылке из Telegram.'
    );
    expect(countRows(db, 'telegram_guest_canonical_ticket_links')).toBe(0);
  });

  it('supports health route and loads catalog/trip-card through the HTTP seam', async () => {
    const health = await request(app).get('/api/telegram/mini-app/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      response_version: 'telegram_mini_app_http_route_result.v1',
      route_status: 'processed',
      route_operation_type: 'mini_app_health_check',
      operation_result_summary: {
        mini_app_launch_summary: {
          launch_ready: true,
          launch_url: expect.stringContaining('https://example.test/telegram/mini-app'),
        },
      },
    });

    const catalog = await request(app)
      .get('/api/telegram/mini-app/catalog')
      .query({
        telegram_user_id: '777000111',
        date: MINI_APP_FUTURE_DATE,
      });
    expect(catalog.status).toBe(200);
    expect(catalog.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_catalog',
      operation_result_summary: {
        list_scope: 'mini_app_guest_trips_catalog',
        item_count: 3,
      },
    });

    const tripCard = await request(app)
      .get('/api/telegram/mini-app/trip-card')
      .query({
        slot_uid: 'generated:42',
        requested_trip_date: MINI_APP_FUTURE_DATE,
        requested_time_slot: '12:00',
      });
    expect(tripCard.status).toBe(200);
    expect(tripCard.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_trip_card',
      operation_result_summary: {
        trip_slot_reference: {
          slot_uid: 'generated:42',
        },
        booking_availability_state: 'low_availability',
      },
    });
  });

  it('expires stale active holds before my-requests and allows a new buyer submit', async () => {
    const firstBookingRequestId = await submitGuestBookingRequest({
      idempotencyKey: 'mini-app-http-stale-hold-first',
    });

    const firstRequestBeforeExpiry = db
      .prepare(
        `
          SELECT
            r.request_status AS request_status,
            h.hold_status AS hold_status,
            h.hold_expires_at AS hold_expires_at
          FROM telegram_booking_requests r
          LEFT JOIN telegram_booking_holds h
            ON h.booking_request_id = r.booking_request_id
          WHERE r.booking_request_id = ?
        `
      )
      .get(firstBookingRequestId);

    expect(firstRequestBeforeExpiry).toMatchObject({
      request_status: 'HOLD_ACTIVE',
      hold_status: 'ACTIVE',
    });
    expect(
      Date.parse(firstRequestBeforeExpiry.hold_expires_at) <=
        Date.parse('2036-04-10T10:47:00.000Z')
    ).toBe(true);

    clocks.creation.set('2036-04-10T10:47:00.000Z');
    clocks.activation.set('2036-04-10T10:47:00.000Z');
    mountMiniAppRouter('2036-04-10T10:47:00.000Z');

    const myRequestsAfterExpiry = await request(app)
      .get('/api/telegram/mini-app/my-requests')
      .query({
        telegram_user_id: '777000111',
      });

    expect(myRequestsAfterExpiry.status).toBe(200);
    expect(myRequestsAfterExpiry.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_my_requests_list',
      operation_result_summary: {
        active_reservation_count: 0,
        completed_cancelled_expired_count: 1,
      },
    });

    const firstRequestAfterExpiry = db
      .prepare(
        `
          SELECT
            r.request_status AS request_status,
            h.hold_status AS hold_status
          FROM telegram_booking_requests r
          LEFT JOIN telegram_booking_holds h
            ON h.booking_request_id = r.booking_request_id
          WHERE r.booking_request_id = ?
        `
      )
      .get(firstBookingRequestId);

    expect(firstRequestAfterExpiry).toMatchObject({
      request_status: 'HOLD_EXPIRED',
      hold_status: 'EXPIRED',
    });

    const secondSubmit = await request(app)
      .post('/api/telegram/mini-app/booking-submit')
      .send({
        telegram_user_id: '777000111',
        selected_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: MINI_APP_FUTURE_DATE,
          requested_time_slot: '10:00',
          slot_uid: 'generated:41',
        },
        requested_seats: 2,
        requested_prepayment_amount: 1000,
        customer_name: 'Mini Guest',
        contact_phone: '+79990000000',
        idempotency_key: 'mini-app-http-stale-hold-second',
      });

    expect(secondSubmit.status).toBe(201);
    expect(secondSubmit.body).toMatchObject({
      route_status: 'processed_created',
      route_operation_type: 'mini_app_booking_submit',
      operation_result_summary: {
        submit_status: 'submitted_with_hold',
      },
    });

    const myRequestsAfterResubmit = await request(app)
      .get('/api/telegram/mini-app/my-requests')
      .query({
        telegram_user_id: '777000111',
      });

    expect(myRequestsAfterResubmit.status).toBe(200);
    expect(myRequestsAfterResubmit.body).toMatchObject({
      operation_result_summary: {
        active_reservation_count: 1,
        completed_cancelled_expired_count: 1,
      },
    });
  });

  it('normalizes stale hold expiry drift and keeps submit/my-requests operational', async () => {
    const firstBookingRequestId = await submitGuestBookingRequest({
      idempotencyKey: 'mini-app-http-stale-hold-expiry-drift-first',
    });

    db.prepare(
      `
        UPDATE telegram_booking_holds
        SET hold_expires_at = '2036-04-10 10:40:30'
        WHERE booking_request_id = ?
      `
    ).run(firstBookingRequestId);

    clocks.creation.set('2036-04-10T10:47:00.000Z');
    clocks.activation.set('2036-04-10T10:47:00.000Z');
    mountMiniAppRouter('2036-04-10T10:47:00.000Z');

    const myRequestsAfterExpiry = await request(app)
      .get('/api/telegram/mini-app/my-requests')
      .query({
        telegram_user_id: '777000111',
      });

    expect(myRequestsAfterExpiry.status).toBe(200);
    expect(myRequestsAfterExpiry.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_my_requests_list',
      operation_result_summary: {
        active_reservation_count: 0,
        completed_cancelled_expired_count: 1,
      },
      rejection_reason: null,
    });

    const firstRequestAfterExpiry = db
      .prepare(
        `
          SELECT
            r.request_status AS request_status,
            h.hold_status AS hold_status
          FROM telegram_booking_requests r
          LEFT JOIN telegram_booking_holds h
            ON h.booking_request_id = r.booking_request_id
          WHERE r.booking_request_id = ?
        `
      )
      .get(firstBookingRequestId);

    expect(firstRequestAfterExpiry).toMatchObject({
      request_status: 'HOLD_EXPIRED',
      hold_status: 'EXPIRED',
    });

    const secondSubmit = await request(app)
      .post('/api/telegram/mini-app/booking-submit')
      .send({
        telegram_user_id: '777000111',
        selected_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: MINI_APP_FUTURE_DATE,
          requested_time_slot: '10:00',
          slot_uid: 'generated:41',
        },
        requested_seats: 2,
        requested_prepayment_amount: 1000,
        customer_name: 'Mini Guest',
        contact_phone: '+79990000000',
        idempotency_key: 'mini-app-http-stale-hold-expiry-drift-second',
      });

    expect(secondSubmit.status).toBe(201);
    expect(secondSubmit.body).toMatchObject({
      route_status: 'processed_created',
      route_operation_type: 'mini_app_booking_submit',
      operation_result_summary: {
        submit_status: 'submitted_with_hold',
      },
      rejection_reason: null,
    });
  });

  it('submits booking request successfully and returns hold-active result payload', async () => {
    const response = await request(app)
      .post('/api/telegram/mini-app/booking-submit')
      .send({
        telegram_user_id: '777000111',
        selected_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: MINI_APP_FUTURE_DATE,
          requested_time_slot: '12:00',
          slot_uid: 'generated:42',
        },
        requested_seats: 2,
        requested_prepayment_amount: 1000,
        customer_name: 'Mini Guest',
        contact_phone: '+79990000000',
        idempotency_key: 'mini-app-http-submit-success',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      route_status: 'processed_created',
      route_operation_type: 'mini_app_booking_submit',
      operation_result_summary: {
        submit_status: 'submitted_with_hold',
        booking_request_reference: {
          booking_request_id: 1,
        },
        hold_reference: {
          booking_hold_id: 1,
        },
      },
    });
  });

  it('returns invalid-input and blocked states deterministically', async () => {
    const missingCustomerName = await request(app)
      .post('/api/telegram/mini-app/booking-submit')
      .send({
        telegram_user_id: '777000111',
        selected_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: MINI_APP_FUTURE_DATE,
          requested_time_slot: '12:00',
          slot_uid: 'generated:42',
        },
        customer_name: '',
        requested_seats: 1,
        requested_prepayment_amount: 1000,
        contact_phone: '+79990000000',
        idempotency_key: 'mini-app-http-missing-customer-name',
      });
    expect(missingCustomerName.status).toBe(422);
    expect(missingCustomerName.body).toMatchObject({
      route_status: 'rejected_invalid_input',
      operation_result_summary: {
        submit_status: 'submit_failed_validation',
        submit_reason_code: 'invalid_customer_name',
      },
    });

    const invalidInput = await request(app)
      .post('/api/telegram/mini-app/booking-submit')
      .send({
        telegram_user_id: '777000111',
        selected_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: MINI_APP_FUTURE_DATE,
          requested_time_slot: '12:00',
          slot_uid: 'generated:42',
        },
        requested_seats: 0,
        requested_prepayment_amount: 1000,
        customer_name: 'Mini Guest',
        contact_phone: '+79990000000',
        idempotency_key: 'mini-app-http-invalid-input',
      });
    expect(invalidInput.status).toBe(422);
    expect(invalidInput.body).toMatchObject({
      route_status: 'rejected_invalid_input',
      operation_result_summary: {
        submit_status: 'submit_failed_validation',
        submit_reason_code: 'invalid_seats_count',
      },
    });

    const unavailableBlocked = await request(app)
      .post('/api/telegram/mini-app/booking-submit')
      .send({
        telegram_user_id: '777000111',
        selected_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: MINI_APP_FUTURE_DATE,
          requested_time_slot: '14:00',
          slot_uid: 'generated:43',
        },
        requested_seats: 1,
        requested_prepayment_amount: 500,
        customer_name: 'Mini Guest',
        contact_phone: '+79990000000',
        idempotency_key: 'mini-app-http-unavailable-blocked',
      });
    expect(unavailableBlocked.status).toBe(409);
    expect(unavailableBlocked.body).toMatchObject({
      route_status: 'blocked_not_possible',
      operation_result_summary: {
        submit_status: 'submit_blocked',
        submit_reason_code: 'invalid_trip_slot_reference',
      },
    });

    const capacityBlocked = await request(app)
      .post('/api/telegram/mini-app/booking-submit')
      .send({
        telegram_user_id: '777000111',
        selected_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: MINI_APP_FUTURE_DATE,
          requested_time_slot: '12:00',
          slot_uid: 'generated:42',
        },
        requested_seats: 3,
        requested_ticket_mix: {
          adult: 2,
          child: 1,
        },
        requested_prepayment_amount: 500,
        customer_name: 'Mini Guest',
        contact_phone: '+79990000000',
        idempotency_key: 'mini-app-http-capacity-blocked',
      });
    expect(capacityBlocked.status).toBe(409);
    expect(capacityBlocked.body).toMatchObject({
      route_status: 'blocked_not_possible',
      operation_result_summary: {
        submit_status: 'submit_blocked',
        submit_reason_code: 'not_enough_seats',
      },
    });

    context.repositories.guestProfiles.create({
      telegram_user_id: '888000999',
      display_name: 'No Route Guest',
      username: 'no_route_guest',
      language_code: 'ru',
      phone_e164: '+79998887766',
      consent_status: 'granted',
      profile_status: 'active',
    });

    const noRouteBlocked = await request(app)
      .post('/api/telegram/mini-app/booking-submit')
      .send({
        telegram_user_id: '888000999',
        selected_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: MINI_APP_FUTURE_DATE,
          requested_time_slot: '10:00',
          slot_uid: 'generated:41',
        },
        requested_seats: 1,
        requested_prepayment_amount: 500,
        customer_name: 'No Route Guest',
        contact_phone: '+79998887766',
        idempotency_key: 'mini-app-http-no-route-blocked',
      });
    expect(noRouteBlocked.status).toBe(409);
    expect(noRouteBlocked.body).toMatchObject({
      route_status: 'blocked_not_possible',
      operation_result_summary: {
        submit_status: 'submit_blocked',
        submit_reason_code: 'no_valid_routing_state',
      },
    });
  });

  it('returns useful/faq/contact read models and keeps deterministic fallback+blocked entrypoint behavior', async () => {
    const useful = await request(app)
      .get('/api/telegram/mini-app/entrypoint/useful_content')
      .query({
        telegram_user_id: '777000111',
      });
    expect(useful.status).toBe(200);
    expect(useful.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_entrypoint_useful_content',
      operation_result_summary: {
        entrypoint_key: 'useful_content',
        placeholder: false,
        title: 'Полезное в Архипо-Осиповке',
        body: expect.any(String),
        useful_content_read_model: {
          response_version: 'telegram_weather_useful_content_read_model.v1',
          weather_summary: {
            weather_data_state: 'unavailable',
          },
          weather_caring_content_summary: {
            useful_headline: 'Полезное в Архипо-Осиповке',
            useful_body: expect.any(String),
          },
          useful_content_feed_summary: {
            item_count: expect.any(Number),
          },
        },
      },
    });
    const usefulNoGuest = await request(app).get(
      '/api/telegram/mini-app/entrypoint/useful_content'
    );
    expect(usefulNoGuest.status).toBe(200);
    expect(usefulNoGuest.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_entrypoint_useful_content',
      operation_result_summary: {
        useful_content_read_model: {
          trip_context_summary: {
            applicability_state: 'not_applicable',
          },
        },
      },
    });

    const ownedBookingRequestId = await submitGuestBookingRequest({
      telegramUserId: '777000111',
      idempotencyKey: 'mini-app-http-useful-owned-booking',
    });
    const ownershipMismatch = await request(app)
      .get('/api/telegram/mini-app/entrypoint/useful_content')
      .query({
        telegram_user_id: 'tg-not-found',
        booking_request_id: ownedBookingRequestId,
      });
    expect(ownershipMismatch.status).toBe(404);
    expect(ownershipMismatch.body).toMatchObject({
      route_status: 'rejected_not_found',
      route_operation_type: 'mini_app_entrypoint_useful_content',
      operation_result_summary: null,
    });

    const faq = await request(app)
      .get('/api/telegram/mini-app/entrypoint/faq')
      .query({
        telegram_user_id: '777000111',
      });
    expect(faq.status).toBe(200);
    expect(faq.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_entrypoint_faq',
      operation_result_summary: {
        entrypoint_key: 'faq',
        placeholder: false,
        faq_read_model: {
          list_scope: 'telegram_guest_faq_list',
          item_count: expect.any(Number),
        },
      },
    });

    const contact = await request(app)
      .get('/api/telegram/mini-app/entrypoint/contact')
      .query({
        telegram_user_id: '777000111',
      });
    expect(contact.status).toBe(200);
    expect(contact.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_entrypoint_contact',
      operation_result_summary: {
        entrypoint_key: 'contact',
        placeholder: false,
        contact_read_model: {
          response_version: 'telegram_contact_support_read_model.v1',
          applicability_state: 'guest_profile_context',
          preferred_contact_phone_e164: '+79990000000',
          trip_help_feed_summary: {
            item_count: expect.any(Number),
          },
        },
      },
    });

    const contactNoGuest = await request(app).get('/api/telegram/mini-app/entrypoint/contact');
    expect(contactNoGuest.status).toBe(200);
    expect(contactNoGuest.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_entrypoint_contact',
      operation_result_summary: {
        contact_read_model: {
          applicability_state: 'not_applicable',
        },
      },
    });

    const fallback = await request(app).get('/api/telegram/mini-app/entrypoint/not-real');
    expect(fallback.status).toBe(200);
    expect(fallback.body).toMatchObject({
      route_status: 'processed',
      operation_result_summary: {
        entrypoint_key: 'catalog',
        fallback_used: true,
      },
    });

    const missingGuest = await request(app)
      .get('/api/telegram/mini-app/entrypoint/useful_content')
      .query({
        telegram_user_id: 'tg-not-found',
      });
    expect(missingGuest.status).toBe(404);
    expect(missingGuest.body).toMatchObject({
      route_status: 'rejected_not_found',
      route_operation_type: 'mini_app_entrypoint_useful_content',
    });

    const faqMissingGuest = await request(app)
      .get('/api/telegram/mini-app/entrypoint/faq')
      .query({
        telegram_user_id: 'tg-not-found',
      });
    expect(faqMissingGuest.status).toBe(404);
    expect(faqMissingGuest.body).toMatchObject({
      route_status: 'rejected_not_found',
      route_operation_type: 'mini_app_entrypoint_faq',
    });

    const contactMissingGuest = await request(app)
      .get('/api/telegram/mini-app/entrypoint/contact')
      .query({
        telegram_user_id: 'tg-not-found',
      });
    expect(contactMissingGuest.status).toBe(404);
    expect(contactMissingGuest.body).toMatchObject({
      route_status: 'rejected_not_found',
      route_operation_type: 'mini_app_entrypoint_contact',
    });

    const faqListBeforeDisable =
      context.services.usefulContentFaqProjectionService.readFaqListForTelegramGuest();
    for (const item of faqListBeforeDisable.items) {
      context.services.usefulContentFaqProjectionService.disableContentItem({
        content_reference: item.faq_reference,
      });
    }
    const tripHelpBeforeDisable =
      context.services.usefulContentFaqProjectionService.readUsefulContentFeedForTelegramGuest({
        content_grouping: 'trip_help',
      });
    for (const item of tripHelpBeforeDisable.items) {
      context.services.usefulContentFaqProjectionService.disableContentItem({
        content_reference: item.content_reference,
      });
    }

    const faqFallback = await request(app).get('/api/telegram/mini-app/entrypoint/faq');
    expect(faqFallback.status).toBe(200);
    expect(faqFallback.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_entrypoint_faq',
      operation_result_summary: {
        fallback_content_used: true,
        faq_read_model: {
          item_count: 0,
        },
      },
    });

    const contactFallback = await request(app).get('/api/telegram/mini-app/entrypoint/contact');
    expect(contactFallback.status).toBe(200);
    expect(contactFallback.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_entrypoint_contact',
      operation_result_summary: {
        fallback_content_used: true,
        contact_read_model: {
          applicability_state: 'not_applicable',
          preferred_contact_phone_e164: null,
          trip_help_feed_summary: {
            item_count: 0,
          },
        },
      },
    });
  });

  it('loads my-tickets list and single ticket view via HTTP seam', async () => {
    const bookingRequestId = await submitGuestBookingRequest({
      idempotencyKey: 'mini-app-http-my-tickets-list',
    });

    const ticketList = await request(app)
      .get('/api/telegram/mini-app/my-tickets')
      .query({
        telegram_user_id: '777000111',
      });

    expect(ticketList.status).toBe(200);
    expect(ticketList.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_my_tickets_list',
      operation_result_summary: {
        list_scope: 'mini_app_guest_my_tickets',
      },
    });
    expect(ticketList.body.operation_result_summary.item_count).toBeGreaterThanOrEqual(1);
    expect(
      ticketList.body.operation_result_summary.items.some(
        (item) => item.booking_request_reference?.booking_request_id === bookingRequestId
      )
    ).toBe(true);

    const ticketView = await request(app)
      .get(`/api/telegram/mini-app/my-tickets/${bookingRequestId}`)
      .query({
        telegram_user_id: '777000111',
      });

    expect(ticketView.status).toBe(200);
    expect(ticketView.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_ticket_view',
      operation_result_summary: {
        booking_request_reference: {
          booking_request_id: bookingRequestId,
        },
        ticket_status_summary: {
          deterministic_ticket_state: 'no_ticket_yet',
        },
      },
    });
  });

  it('reflects seller hold extension in buyer my-tickets and detail projections on refresh', async () => {
    const bookingRequestId = await submitGuestBookingRequest({
      idempotencyKey: 'mini-app-http-hold-extension-refresh',
    });
    const beforeExtension = await request(app)
      .get('/api/telegram/mini-app/my-tickets')
      .query({
        telegram_user_id: '777000111',
      });
    const beforeItem = beforeExtension.body?.operation_result_summary?.items?.find(
      (item) =>
        Number(item?.booking_request_reference?.booking_request_id) === bookingRequestId
    );
    expect(beforeItem?.hold_status_summary?.hold_expires_at_summary?.iso).toBe(
      '2036-04-10T10:46:00.000Z'
    );

    const holdStartedEvent = context.repositories.bookingRequestEvents.findOneBy(
      {
        booking_request_id: bookingRequestId,
        event_type: 'HOLD_STARTED',
      },
      { orderBy: 'booking_request_event_id DESC' }
    );
    context.services.bookingRequestHoldExtensionService.extendHold({
      active_hold_state: holdStartedEvent?.event_payload?.hold_activation_result,
      idempotency_key: 'seller-extended-hold-refresh',
    });

    const afterExtension = await request(app)
      .get('/api/telegram/mini-app/my-tickets')
      .query({
        telegram_user_id: '777000111',
      });
    const afterItem = afterExtension.body?.operation_result_summary?.items?.find(
      (item) =>
        Number(item?.booking_request_reference?.booking_request_id) === bookingRequestId
    );
    expect(afterItem?.hold_status_summary?.hold_expires_at_summary?.iso).toBe(
      '2036-04-10T10:56:00.000Z'
    );

    const detailAfterExtension = await request(app)
      .get(`/api/telegram/mini-app/my-tickets/${bookingRequestId}`)
      .query({
        telegram_user_id: '777000111',
      });
    expect(
      detailAfterExtension.body?.operation_result_summary?.hold_status_summary
        ?.hold_expires_at_summary?.iso
    ).toBe('2036-04-10T10:56:00.000Z');
  });

  it('merges a stale request row with the matching ready canonical ticket in my-tickets', async () => {
    const bookingRequestId = await submitGuestBookingRequest({
      requestedTimeSlot: '12:00',
      idempotencyKey: 'mini-app-http-dedupe-stale-request',
    });
    const canonicalPresaleId = seedReadyCanonicalPresale({
      slotUid: 'generated:42',
      boatSlotId: 42,
      businessDay: MINI_APP_FUTURE_DATE,
      customerPhone: '+79990000000',
      numberOfSeats: 2,
    });
    await bindCanonicalTicketToMiniAppGuest({ canonicalPresaleId });

    const ticketList = await request(app)
      .get('/api/telegram/mini-app/my-tickets')
      .query({
        telegram_user_id: '777000111',
        limit: 20,
      });

    expect(ticketList.status).toBe(200);
    const items = ticketList.body.operation_result_summary.items;
    const sameTripItems = items.filter(
      (item) =>
        item?.date_time_summary?.requested_trip_date === MINI_APP_FUTURE_DATE &&
        item?.date_time_summary?.requested_time_slot === '12:00'
    );
    expect(sameTripItems).toHaveLength(1);
    expect(sameTripItems[0]).toMatchObject({
      linked_canonical_presale_reference: {
        presale_id: canonicalPresaleId,
      },
      ticket_status_summary: {
        deterministic_ticket_state: 'linked_ticket_ready',
      },
      ticket_availability_state: 'available',
    });
    expect(
      items.some(
        (item) =>
          item?.booking_request_reference?.booking_request_id === bookingRequestId &&
          item?.ticket_status_summary?.deterministic_ticket_state === 'no_ticket_yet'
      )
    ).toBe(false);
  });

  it('keeps two separate same-day ready canonical purchases visible', async () => {
    const firstPresaleId = seedReadyCanonicalPresale({
      slotUid: 'generated:41',
      boatSlotId: 41,
      businessDay: MINI_APP_FUTURE_DATE,
      customerPhone: '+79990000000',
      numberOfSeats: 1,
      createdAt: '2036-04-10T10:42:00.000Z',
    });
    const secondPresaleId = seedReadyCanonicalPresale({
      slotUid: 'generated:42',
      boatSlotId: 42,
      businessDay: MINI_APP_FUTURE_DATE,
      customerPhone: '+79990000000',
      numberOfSeats: 2,
      createdAt: '2036-04-10T10:43:00.000Z',
    });
    await bindCanonicalTicketToMiniAppGuest({
      canonicalPresaleId: firstPresaleId,
      sourceToken: seedTrustedTicketSourceToken('seller-direct-link-same-day-1'),
    });
    await bindCanonicalTicketToMiniAppGuest({
      canonicalPresaleId: secondPresaleId,
      sourceToken: seedTrustedTicketSourceToken('seller-direct-link-same-day-2'),
    });

    const ticketList = await request(app)
      .get('/api/telegram/mini-app/my-tickets')
      .query({
        telegram_user_id: '777000111',
        limit: 20,
      });

    expect(ticketList.status).toBe(200);
    const visiblePresaleIds = ticketList.body.operation_result_summary.items
      .map((item) => Number(item?.linked_canonical_presale_reference?.presale_id))
      .filter((presaleId) => Number.isInteger(presaleId) && presaleId > 0);

    expect(visiblePresaleIds).toEqual(
      expect.arrayContaining([firstPresaleId, secondPresaleId])
    );
  });

  it('loads my-requests buckets and embeds request read model into my-tickets list', async () => {
    const cancelledBookingRequestId = await submitGuestBookingRequest({
      requestedTimeSlot: '12:00',
      idempotencyKey: 'mini-app-http-my-requests-cancelled',
    });
    const cancelledLifecycleState =
      context.services.bookingRequestLifecycleProjectionService.readCurrentLifecycleStateByBookingRequestReference(
        cancelledBookingRequestId
      );
    const cancelResult =
      context.services.bookingRequestGuestCancelBeforePrepaymentService.cancelBeforePrepayment(
        {
          booking_request_reference: cancelledLifecycleState.booking_request_reference,
          telegram_user_summary: cancelledLifecycleState.telegram_user_summary,
          idempotency_key: 'mini-app-http-my-requests-cancel-op',
        }
      );
    expect(cancelResult.cancel_status).toBe('cancelled_before_prepayment');

    const activeBookingRequestId = await submitGuestBookingRequest({
      requestedTimeSlot: '10:00',
      idempotencyKey: 'mini-app-http-my-requests-active',
    });

    const myRequests = await request(app)
      .get('/api/telegram/mini-app/my-requests')
      .query({
        telegram_user_id: '777000111',
        limit: 50,
      });

    expect(myRequests.status).toBe(200);
    expect(myRequests.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_my_requests_list',
      operation_result_summary: {
        response_version: 'telegram_mini_app_guest_my_requests.v1',
        list_scope: 'mini_app_guest_my_requests',
        active_reservation_count: expect.any(Number),
        completed_cancelled_expired_count: expect.any(Number),
      },
    });
    expect(myRequests.body.operation_result_summary.active_reservation_count).toBeGreaterThan(0);
    expect(
      myRequests.body.operation_result_summary.completed_cancelled_expired_count
    ).toBeGreaterThan(0);
    expect(
      myRequests.body.operation_result_summary.active_reservations.some(
        (item) =>
          item.booking_request_reference?.booking_request_id === activeBookingRequestId
      )
    ).toBe(true);
    expect(
      myRequests.body.operation_result_summary.completed_cancelled_expired_reservations.some(
        (item) =>
          item.booking_request_reference?.booking_request_id === cancelledBookingRequestId
      )
    ).toBe(true);
    expect(
      myRequests.body.operation_result_summary.state_buckets
        .completed_cancelled_expired.some(
          (item) => Number(item.booking_request_id) === cancelledBookingRequestId
        )
    ).toBe(true);

    const ticketList = await request(app)
      .get('/api/telegram/mini-app/my-tickets')
      .query({
        telegram_user_id: '777000111',
      });

    expect(ticketList.status).toBe(200);
    expect(ticketList.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_my_tickets_list',
      operation_result_summary: {
        list_scope: 'mini_app_guest_my_tickets',
        my_requests_read_model: {
          response_version: 'telegram_mini_app_guest_my_requests.v1',
          list_scope: 'mini_app_guest_my_requests',
        },
      },
    });
    expect(
      ticketList.body.operation_result_summary.my_requests_read_model
        .active_reservation_count
    ).toBeGreaterThan(0);
    expect(
      ticketList.body.operation_result_summary.my_requests_read_model
        .completed_cancelled_expired_count
    ).toBeGreaterThan(0);
  });

  it('returns rejected_not_found for my-requests when Telegram guest is unknown', async () => {
    const myRequestsMissingGuest = await request(app)
      .get('/api/telegram/mini-app/my-requests')
      .query({
        telegram_user_id: 'tg-not-found',
      });

    expect(myRequestsMissingGuest.status).toBe(404);
    expect(myRequestsMissingGuest.body).toMatchObject({
      route_status: 'rejected_not_found',
      route_operation_type: 'mini_app_my_requests_list',
      operation_result_summary: null,
    });
  });

  it('returns missing ticket references deterministically', async () => {
    const seededBookingRequestId = await submitGuestBookingRequest({
      idempotencyKey: 'mini-app-http-my-tickets-unavailable',
    });

    const presentTicketView = await request(app)
      .get(`/api/telegram/mini-app/my-tickets/${seededBookingRequestId}`)
      .query({
        telegram_user_id: '777000111',
      });

    expect(presentTicketView.status).toBe(200);
    expect(presentTicketView.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_ticket_view',
      operation_result_summary: {
        booking_request_reference: {
          booking_request_id: seededBookingRequestId,
        },
        ticket_status_summary: {
          deterministic_ticket_state: 'no_ticket_yet',
        },
        ticket_availability_state: 'not_available_yet',
      },
    });

    const missingTicketView = await request(app)
      .get('/api/telegram/mini-app/my-tickets/999999')
      .query({
        telegram_user_id: '777000111',
      });

    expect(missingTicketView.status).toBe(404);
    expect(missingTicketView.body).toMatchObject({
      route_status: 'rejected_not_found',
      route_operation_type: 'mini_app_ticket_view',
      operation_result_summary: null,
    });
  });

  it('loads offline snapshot for a selected ticket via HTTP seam', async () => {
    const bookingRequestId = await submitGuestBookingRequest({
      idempotencyKey: 'mini-app-http-offline-snapshot',
    });

    const offlineSnapshot = await request(app)
      .get(`/api/telegram/mini-app/my-tickets/${bookingRequestId}/offline-snapshot`)
      .query({
        telegram_user_id: '777000111',
      });

    expect(offlineSnapshot.status).toBe(200);
    expect(offlineSnapshot.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_ticket_offline_snapshot',
      operation_result_summary: {
        booking_request_reference: {
          booking_request_id: bookingRequestId,
        },
        offline_snapshot_status: 'offline_unavailable',
      },
    });
  });

  it('returns compact buyer code and boarding qr for a confirmed ticket', async () => {
    const bookingRequestId = await submitGuestBookingRequest({
      idempotencyKey: 'mini-app-http-confirmed-ticket-qr',
    });
    const confirmationClock = createClock('2036-04-10T10:41:00.000Z');
    const presaleColumns = [
      'boat_slot_id INTEGER NULL',
      'customer_name TEXT',
      'customer_phone TEXT',
      'number_of_seats INTEGER',
      'total_price INTEGER',
      'prepayment_amount INTEGER DEFAULT 0',
      "status TEXT DEFAULT 'ACTIVE'",
      'slot_uid TEXT NULL',
      'business_day TEXT NULL',
      'created_at TEXT DEFAULT CURRENT_TIMESTAMP',
      'updated_at TEXT DEFAULT CURRENT_TIMESTAMP',
    ];

    for (const columnDefinition of presaleColumns) {
      const columnName = columnDefinition.split(' ')[0];
      try {
        db.exec(`ALTER TABLE presales ADD COLUMN ${columnDefinition}`);
      } catch (error) {
        if (!String(error?.message || '').includes(`duplicate column name: ${columnName}`)) {
          throw error;
        }
      }
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presale_id INTEGER NOT NULL REFERENCES presales(id),
        boat_slot_id INTEGER NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
    `);

    wireClock(context, confirmationClock);
    const presaleId = confirmAndLinkToPresale(db, context, confirmationClock, {
      bookingRequestId,
      ticketStatuses: ['ACTIVE', 'ACTIVE'],
      numberOfSeats: 2,
      totalPrice: 6000,
      prepaymentAmount: 1000,
      businessDay: MINI_APP_FUTURE_DATE,
      customerPhone: '+79990000000',
    });

    const ticketView = await request(app)
      .get(`/api/telegram/mini-app/my-tickets/${bookingRequestId}`)
      .query({
        telegram_user_id: '777000111',
      });

    expect(ticketView.status).toBe(200);
    expect(ticketView.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_ticket_view',
      operation_result_summary: {
        booking_request_reference: {
          booking_request_id: bookingRequestId,
        },
        linked_canonical_presale_reference: {
          presale_id: presaleId,
        },
        ticket_status_summary: {
          deterministic_ticket_state: 'linked_ticket_ready',
        },
        buyer_ticket_reference_summary: {
          buyer_ticket_code: 'А1',
          canonical_presale_id: presaleId,
          canonical_ticket_count: 2,
          canonical_ticket_ids: [1, 2],
        },
        boarding_qr_payload_summary: {
          payload_source: 'canonical_presale_id_and_ticket_ids',
          compatibility_target: 'dispatcher_boarding_existing_ids',
          qr_payload_text: 'boat-ticket:v1|presale=1|tickets=1,2',
        },
      },
    });

    const offlineSnapshot = await request(app)
      .get(`/api/telegram/mini-app/my-tickets/${bookingRequestId}/offline-snapshot`)
      .query({
        telegram_user_id: '777000111',
      });

    expect(offlineSnapshot.status).toBe(200);
    expect(offlineSnapshot.body).toMatchObject({
      route_status: 'processed',
      route_operation_type: 'mini_app_ticket_offline_snapshot',
      operation_result_summary: {
        booking_request_reference: {
          booking_request_id: bookingRequestId,
        },
        offline_snapshot_status: 'offline_snapshot_ready',
        buyer_ticket_reference_summary: {
          buyer_ticket_code: 'А1',
        },
        boarding_qr_payload_summary: {
          qr_payload_text: 'boat-ticket:v1|presale=1|tickets=1,2',
        },
      },
    });
  });
});
