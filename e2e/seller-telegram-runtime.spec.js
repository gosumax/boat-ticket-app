import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'url';
import { login } from './helpers/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const e2eDbPath = path.resolve(__dirname, '..', '_testdata', 'e2e.sqlite');
const runtimeArtifactsDir = path.resolve(__dirname, '..', 'test-results', 'seller-telegram-runtime');
const E2E_SELLER_USERNAME = process.env.E2E_SELLER_USERNAME || 'seller';
const E2E_SELLER_PASSWORD = process.env.E2E_SELLER_PASSWORD || '123456';

function formatDateOffset(daysFromToday = 1) {
  const value = new Date();
  value.setDate(value.getDate() + daysFromToday);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readSlot(db, tripDate, timeValue) {
  return db.prepare(
    `
      SELECT id, seats_left, capacity
      FROM generated_slots
      WHERE trip_date = ? AND time = ?
      ORDER BY id ASC
      LIMIT 1
    `
  ).get(tripDate, timeValue);
}

function listRequestEvents(context, bookingRequestId) {
  return context.repositories.bookingRequestEvents.listBy(
    { booking_request_id: bookingRequestId },
    { orderBy: 'booking_request_event_id ASC', limit: 200 }
  );
}

function findLatestEventByType(context, bookingRequestId, eventType) {
  return listRequestEvents(context, bookingRequestId)
    .filter((event) => event.event_type === eventType)
    .at(-1);
}

function listSellerQueueRequestIds(context, sellerId) {
  const queue = context.services.sellerWorkQueueService.listSellerWorkQueue(sellerId, {
    limit: 200,
  });
  return (Array.isArray(queue?.items) ? queue.items : [])
    .map((item) => Number(item?.booking_request?.booking_request_id || 0))
    .filter((bookingRequestId) => Number.isInteger(bookingRequestId) && bookingRequestId > 0);
}

function normalizeEventPayload(rawPayload) {
  if (!rawPayload) {
    return {};
  }
  if (typeof rawPayload === 'string') {
    try {
      const parsed = JSON.parse(rawPayload);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof rawPayload === 'object') {
    return rawPayload;
  }
  return {};
}

let requestSequence = 0;

function seedSellerRequest(
  context,
  {
    sellerId,
    requestedTripDate,
    requestedTimeSlot,
    requestedSeats,
    requestedPrepaymentAmount,
    guestLabel,
  }
) {
  requestSequence += 1;
  const sequence = requestSequence;
  const normalizedPhoneDigits = String(700000000 + sequence).padStart(9, '0').slice(-9);
  const phone = `+79${normalizedPhoneDigits}`;
  const suffix = `${Date.now()}-${sequence}`;
  const guest = context.repositories.guestProfiles.create({
    telegram_user_id: `tg-e2e-seller-${suffix}`,
    display_name: guestLabel,
    username: `e2e_seller_${sequence}`,
    language_code: 'ru',
    phone_e164: phone,
    consent_status: 'granted',
    profile_status: 'active',
  });
  const source = context.repositories.trafficSources.create({
    source_code: `e2e-seller-source-${suffix}`,
    source_type: 'seller_qr',
    source_name: `e2e-seller-source-${suffix}`,
    default_seller_id: sellerId,
    is_active: 1,
  });
  const qr = context.repositories.sourceQRCodes.create({
    qr_token: `e2e-seller-qr-${suffix}`,
    traffic_source_id: source.traffic_source_id,
    seller_id: sellerId,
    entry_context: {
      code: `e2e-seller-source-${suffix}`,
    },
    is_active: 1,
  });
  const attribution = context.services.attributionService.registerGuestEntryFromSource({
    guest_profile_id: guest.guest_profile_id,
    traffic_source_id: source.traffic_source_id,
    source_qr_code_id: qr.source_qr_code_id,
    entry_channel: 'qr',
  });
  const lifecycle = context.services.bookingRequestService.createBookingRequest({
    guest_profile_id: guest.guest_profile_id,
    seller_attribution_session_id:
      attribution.sellerAttributionSession.seller_attribution_session_id,
    requested_trip_date: requestedTripDate,
    requested_time_slot: requestedTimeSlot,
    requested_seats: requestedSeats,
    requested_ticket_mix: { adult: requestedSeats },
    requested_prepayment_amount: requestedPrepaymentAmount,
    currency: 'RUB',
    contact_phone_e164: phone,
  });

  return {
    bookingRequestId: lifecycle.bookingRequest.booking_request_id,
    requestedSeats,
    requestedPrepaymentAmount,
    phone,
  };
}

async function saveRuntimeScreenshot(page, filename) {
  fs.mkdirSync(runtimeArtifactsDir, { recursive: true });
  const screenshotPath = path.join(runtimeArtifactsDir, filename);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

test.describe('Seller Telegram runtime flow', () => {
  test('shows compact banner/list/detail and processes seller actions in live runtime', async ({
    page,
  }) => {
    test.setTimeout(180000);

    process.env.NODE_ENV = 'test';
    process.env.DB_FILE = e2eDbPath;
    const { createTelegramPersistenceContext } = await import('../server/telegram/index.js');

    const db = new Database(e2eDbPath);
    const context = createTelegramPersistenceContext(db);
    const sellerRow = db
      .prepare(
        `
          SELECT id
          FROM users
          WHERE username = ?
          ORDER BY id ASC
          LIMIT 1
        `
      )
      .get(E2E_SELLER_USERNAME);
    const sellerId = Number(sellerRow?.id || 0);
    expect(sellerId).toBeGreaterThan(0);

    const requestedTripDate = formatDateOffset(1);
    const requestedTimeSlot = String(
      db
        .prepare(
          `
            SELECT time
            FROM generated_slots
            WHERE trip_date = ?
            ORDER BY time ASC
            LIMIT 1
          `
        )
        .get(requestedTripDate)?.time || '23:20'
    );
    const slotBeforeCreate = readSlot(db, requestedTripDate, requestedTimeSlot);

    await page.addInitScript(() => {
      const writes = [];
      window.__sellerClipboardWrites = writes;
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value) => {
            writes.push(String(value ?? ''));
          },
        },
      });
    });

    await login(page, E2E_SELLER_USERNAME, E2E_SELLER_PASSWORD);
    await page.goto('/seller/media');
    await expect(page.getByTestId('seller-telegram-global-alert')).toHaveCount(0);

    const extendAndPrepayRequest = seedSellerRequest(context, {
      sellerId,
      requestedTripDate,
      requestedTimeSlot,
      requestedSeats: 2,
      requestedPrepaymentAmount: 1000,
      guestLabel: 'E2E Extend Prepay Guest',
    });
    const cancelRequest = seedSellerRequest(context, {
      sellerId,
      requestedTripDate,
      requestedTimeSlot,
      requestedSeats: 1,
      requestedPrepaymentAmount: 800,
      guestLabel: 'E2E Cancel Guest',
    });
    const seededRequestIds = [
      extendAndPrepayRequest.bookingRequestId,
      cancelRequest.bookingRequestId,
    ];
    await expect
      .poll(() => {
        const queueIds = listSellerQueueRequestIds(context, sellerId);
        return seededRequestIds.every((bookingRequestId) => queueIds.includes(bookingRequestId));
      }, { timeout: 30000 })
      .toBe(true);
    const slotAfterCreate = readSlot(db, requestedTripDate, requestedTimeSlot);
    const holdAffectsSeats =
      Number.isInteger(Number(slotBeforeCreate?.seats_left))
      && Number.isInteger(Number(slotAfterCreate?.seats_left))
      && Number(slotAfterCreate?.seats_left) < Number(slotBeforeCreate?.seats_left);

    const globalBanner = page.getByTestId('seller-telegram-global-alert');
    await expect(globalBanner).toBeVisible({ timeout: 30000 });
    await saveRuntimeScreenshot(page, '01-banner-on-seller-media.png');

    await globalBanner.click();
    await expect(page).toHaveURL(/\/seller\/telegram-requests/);
    await page.reload();
    await expect
      .poll(async () => {
        const counts = await Promise.all(
          seededRequestIds.map((bookingRequestId) =>
            page.getByTestId(`seller-telegram-request-${bookingRequestId}`).count()
          )
        );
        return counts.every((count) => count > 0);
      }, { timeout: 30000 })
      .toBe(true);
    await saveRuntimeScreenshot(page, '02-active-requests-list.png');

    await page
      .getByTestId(`seller-telegram-copy-phone-${extendAndPrepayRequest.bookingRequestId}`)
      .click();
    await expect
      .poll(async () => page.evaluate(() => window.__sellerClipboardWrites?.length || 0))
      .toBe(1);
    await expect
      .poll(async () => page.evaluate(() => window.__sellerClipboardWrites?.[0] || null))
      .toBe(extendAndPrepayRequest.phone);

    const extendRequestCard = page.getByTestId(
      `seller-telegram-request-${extendAndPrepayRequest.bookingRequestId}`
    );
    await extendRequestCard.locator('button').first().click();
    await expect(page).toHaveURL(
      new RegExp(`/seller/telegram-requests\\?requestId=${extendAndPrepayRequest.bookingRequestId}`)
    );
    await expect(page.getByTestId('seller-telegram-request-detail')).toBeVisible();
    await expect(page.getByTestId('seller-telegram-accepted-prepayment-input')).toHaveValue(
      String(extendAndPrepayRequest.requestedPrepaymentAmount)
    );
    await saveRuntimeScreenshot(page, '03-request-detail.png');

    const holdBeforeExtend = context.services.bookingRequestService.getHoldForRequest(
      extendAndPrepayRequest.bookingRequestId
    );
    await page.getByTestId('seller-telegram-detail-extend').click();
    await expect
      .poll(() =>
        Boolean(
          findLatestEventByType(
            context,
            extendAndPrepayRequest.bookingRequestId,
            'HOLD_EXTENDED'
          )
        )
      )
      .toBe(true);
    const holdAfterExtend = context.services.bookingRequestService.getHoldForRequest(
      extendAndPrepayRequest.bookingRequestId
    );
    expect(new Date(holdAfterExtend.hold_expires_at).getTime()).toBeGreaterThan(
      new Date(holdBeforeExtend.hold_expires_at).getTime()
    );

    await page.getByTestId('seller-telegram-detail-not-reached').click();
    await expect
      .poll(() =>
        Boolean(
          findLatestEventByType(
            context,
            extendAndPrepayRequest.bookingRequestId,
            'SELLER_NOT_REACHED_NOTE'
          )
        )
      )
      .toBe(true);
    const statusAfterNotReached = context.repositories.bookingRequests.getById(
      extendAndPrepayRequest.bookingRequestId
    )?.request_status;
    expect(statusAfterNotReached).not.toBe('GUEST_CANCELLED');
    expect(statusAfterNotReached).not.toBe('HOLD_EXPIRED');
    await expect(
      page.getByTestId(`seller-telegram-request-${extendAndPrepayRequest.bookingRequestId}`)
    ).toBeVisible();

    const cancelRequestCard = page.getByTestId(
      `seller-telegram-request-${cancelRequest.bookingRequestId}`
    );
    await cancelRequestCard.locator('button').first().click();
    await page.getByTestId('seller-telegram-detail-cancel-request').click();
    await expect(page.getByTestId('seller-telegram-cancel-confirm-back')).toBeVisible();
    await saveRuntimeScreenshot(page, '04-cancel-confirm-modal.png');

    await page.getByTestId('seller-telegram-cancel-confirm-back').click();
    await expect(page.getByTestId('seller-telegram-cancel-confirm-back')).toHaveCount(0);
    await page.getByTestId('seller-telegram-detail-cancel-request').click();
    await page.getByTestId('seller-telegram-cancel-confirm-submit').click();

    await expect
      .poll(
        () =>
          context.repositories.bookingRequests.getById(cancelRequest.bookingRequestId)?.request_status
      )
      .toBe('GUEST_CANCELLED');
    await expect
      .poll(
        () =>
          context.services.bookingRequestService.getHoldForRequest(cancelRequest.bookingRequestId)
            ?.hold_status
      )
      .toBe('CANCELLED');
    await expect(
      page.getByTestId(`seller-telegram-request-${cancelRequest.bookingRequestId}`)
    ).toHaveCount(0);

    if (holdAffectsSeats) {
      const seatsAfterCancel = Number(readSlot(db, requestedTripDate, requestedTimeSlot)?.seats_left || 0);
      expect(seatsAfterCancel).toBeGreaterThanOrEqual(Number(slotAfterCreate?.seats_left || 0));
    }

    await page.goto(`/seller/telegram-requests?requestId=${extendAndPrepayRequest.bookingRequestId}`);
    await expect(page.getByTestId('seller-telegram-request-detail')).toBeVisible();
    await page.getByTestId('seller-telegram-accepted-prepayment-input').fill('1666');
    await page.getByTestId('seller-telegram-detail-accept-prepayment').click();

    await expect
      .poll(
        () =>
          context.repositories.bookingRequests.getById(extendAndPrepayRequest.bookingRequestId)
            ?.request_status
      )
      .toBe('PREPAYMENT_CONFIRMED');
    await expect(
      page.getByTestId(`seller-telegram-request-${extendAndPrepayRequest.bookingRequestId}`)
    ).toHaveCount(0);

    const prepaymentEvent = findLatestEventByType(
      context,
      extendAndPrepayRequest.bookingRequestId,
      'PREPAYMENT_CONFIRMED'
    );
    const prepaymentPayload = normalizeEventPayload(prepaymentEvent?.event_payload);
    expect(prepaymentPayload.accepted_prepayment_amount).toBe(1666);

    await saveRuntimeScreenshot(page, '05-after-processing.png');
    db.close();
  });
});
