import Database from 'better-sqlite3';
import path from 'path';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const e2eDbPath = path.resolve(__dirname, '..', '_testdata', 'e2e.sqlite');

function createTodayDateValue() {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatRussianDateTimeLabel(dateValue, timeValue) {
  const [year, month, day] = String(dateValue)
    .split('-')
    .map((segment) => Number(segment));
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dateLabel = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
  return `${dateLabel}, ${timeValue}`;
}

async function inspectCompactActionButton(locator) {
  await locator.click({ trial: true });
  return locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topNode = document.elementFromPoint(centerX, centerY);

    return {
      tagName: node.tagName,
      pointerEvents: getComputedStyle(node).pointerEvents,
      topTagName: topNode?.tagName || null,
      topIsSelfOrChild: topNode === node || node.contains(topNode),
      rect: {
        width: rect.width,
        height: rect.height,
      },
    };
  });
}

async function readMiniAppClipboardWrites(page) {
  return page.evaluate(() => window.__miniAppClipboardWrites || []);
}

async function expectMiniAppClipboardWrite(page, expectedCount, expectedValue) {
  await expect
    .poll(async () => (await readMiniAppClipboardWrites(page)).length)
    .toBe(expectedCount);

  const writes = await readMiniAppClipboardWrites(page);
  expect(writes.at(-1)).toBe(expectedValue);
}

test.describe('Telegram Mini App buyer booking flow', () => {
  test('keeps mobile navigation compact and shows clear post-booking request wording', async ({
    page,
  }) => {
    const telegramUserId = 777000111;
    const catalogDate = createTodayDateValue();
    const db = new Database(e2eDbPath);
    const sellerUser = db
      .prepare(
        `
          SELECT id
          FROM users
          WHERE username = ?
          ORDER BY id ASC
          LIMIT 1
        `
      )
      .get('seller');
    const sellerId = Number(sellerUser?.id || 1);
    const publicSellerName = 'Анна Соколова';
    const publicSellerPhone = '+79995554433';

    db.prepare(
      `
        UPDATE users
        SET public_display_name = ?, public_phone_e164 = ?
        WHERE id = ?
      `
    ).run(publicSellerName, publicSellerPhone, sellerId);

    await page.addInitScript(() => {
      const clipboardWrites = [];
      window.__miniAppClipboardWrites = clipboardWrites;
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value) => {
            clipboardWrites.push(String(value ?? ''));
          },
        },
      });
    });

    const trafficSource = db
      .prepare(
        `
          INSERT INTO telegram_traffic_sources (
            source_code,
            source_type,
            source_name,
            default_seller_id,
            is_active
          )
          VALUES (?, ?, ?, ?, 1)
          ON CONFLICT(source_code) DO UPDATE SET
            source_name = excluded.source_name,
            default_seller_id = excluded.default_seller_id,
            is_active = 1
          RETURNING traffic_source_id
        `
      )
      .get('seller-qr-a', 'seller_qr', 'seller-qr-a', sellerId);

    db.prepare(
      `
        INSERT INTO telegram_source_qr_codes (
          qr_token,
          traffic_source_id,
          seller_id,
          entry_context,
          is_active
        )
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(qr_token) DO UPDATE SET
          traffic_source_id = excluded.traffic_source_id,
          seller_id = excluded.seller_id,
          entry_context = excluded.entry_context,
          is_active = 1
      `
    ).run(
      'seller-qr-token-a',
      Number(trafficSource?.traffic_source_id || 1),
      sellerId,
      JSON.stringify({
        code: 'seller-qr-a',
        seller_contact: {
          name: 'Seller A',
          phone_e164: '+79991112233',
        },
      })
    );

    const speedBoat = db
      .prepare(
        `
          SELECT id
          FROM boats
          WHERE type = 'speed' AND is_active = 1
          ORDER BY id ASC
          LIMIT 1
        `
      )
      .get();

    expect(Number(speedBoat?.id || 0)).toBeGreaterThan(0);

    db.prepare(
      `
        INSERT INTO boat_slots (
          boat_id,
          time,
          price,
          capacity,
          seats_left,
          duration_minutes,
          trip_date,
          is_active,
          price_adult,
          price_child,
          price_teen
        )
        VALUES (?, '05:20', 2000, 4, 4, 60, ?, 1, 2000, 1000, 1500)
      `
    ).run(Number(speedBoat.id), catalogDate);
    db.close();

    await page.request.post('/api/telegram/webhook', {
      data: {
        update_id: 910001,
        message: {
          message_id: 401,
          date: 1767777600,
          text: '/start seller-qr-token-a',
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
      },
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(
      `/telegram/mini-app?telegram_user_id=${telegramUserId}&date=${catalogDate}`
    );

    await expect(page.locator('.tg-mini-app__nav')).toBeVisible();
    await expect(page.getByTestId('telegram-mini-app-type-selection')).toBeVisible();
    await expect(page.getByText('Active buyer runtime markers')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();

    const nav = page.locator('.tg-mini-app__nav');
    await expect(nav).toBeVisible();
    await expect(nav).toHaveCSS('position', 'static');

    const navButton = nav.getByRole('button', { name: 'Каталог', exact: true });
    await expect(navButton).toBeVisible();
    const navButtonBox = await navButton.boundingBox();
    expect(navButtonBox?.height ?? 0).toBeLessThanOrEqual(46);

    await nav.getByRole('button', { name: 'Каталог', exact: true }).click();
    await expect(page.getByTestId('telegram-mini-app-type-selection')).toBeVisible();
    await expect(page.getByTestId('telegram-mini-app-catalog-item')).toHaveCount(0);

    await page
      .getByTestId('telegram-mini-app-type-selection-card-speed')
      .getByRole('button', { name: 'Смотреть рейсы' })
      .click();
    const targetCatalogItem = page
      .getByTestId('telegram-mini-app-catalog-item')
      .filter({ hasText: 'Вместимость: 4 места' })
      .first();
    await expect(targetCatalogItem).toBeVisible();
    await expect(targetCatalogItem.locator('.tg-mini-app__list-card-price')).toHaveCount(0);
    await expect(targetCatalogItem).toContainText(
      formatRussianDateTimeLabel(catalogDate, '05:20')
    );

    await targetCatalogItem.getByRole('button').click();

    const tripCard = page.getByTestId('telegram-mini-app-trip-card');
    const tripPriceCard = page.getByTestId('telegram-mini-app-trip-price-card');
    await expect(tripCard).toBeVisible();
    const tripCardBox = await tripCard.boundingBox();
    const tripPriceCardBox = await tripPriceCard.boundingBox();
    expect(tripCardBox).not.toBeNull();
    expect(tripPriceCardBox).not.toBeNull();
    expect(tripPriceCardBox.width).toBeGreaterThan((tripCardBox.width ?? 0) - 50);
    await page.getByRole('button', { name: 'Забронировать рейс' }).click();

    await expect(page.getByTestId('telegram-mini-app-booking-form')).toBeVisible();
    await expect(page.getByText('Поведение формы не меняется', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Можно бронировать', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Цена за взрослого', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('telegram-mini-app-booking-counter-adult-value')).toHaveText(
      '1'
    );
    await expect(page.getByText('Свободно: 4 из 4', { exact: false })).toBeVisible();
    await expect(page.getByText(formatRussianDateTimeLabel(catalogDate, '05:20'))).toBeVisible();
    await expect(page.getByText(`${catalogDate} 05:20`, { exact: false })).toHaveCount(0);

    await page.getByTestId('telegram-mini-app-booking-counter-adult-plus').click();
    await page.getByTestId('telegram-mini-app-booking-counter-teen-plus').click();
    await page.getByTestId('telegram-mini-app-booking-counter-child-plus').click();

    await expect(page.getByTestId('telegram-mini-app-booking-selected-mix')).toHaveText(
      '2 взрослых, 1 подросток, 1 ребёнок'
    );
    await expect(page.getByTestId('telegram-mini-app-booking-total-seats')).toHaveText(
      '4 места'
    );
    await expect(page.getByTestId('telegram-mini-app-booking-total-price')).toHaveText(
      '6500 RUB'
    );
    await expect(page.getByTestId('telegram-mini-app-booking-counter-child-plus')).toBeDisabled();
    await expect(page.getByTestId('telegram-mini-app-booking-name-field')).toBeVisible();

    const nameField = page.getByTestId('telegram-mini-app-booking-name-field');
    const phoneField = page.getByTestId('telegram-mini-app-booking-phone-field');
    const totalCard = page.getByTestId('telegram-mini-app-booking-total-card');
    const counterGrid = page.locator('.tg-mini-app__ticket-counter-grid');
    const backButton = page.getByRole('button', { name: 'Назад', exact: true });
    const submitButton = page.getByTestId('telegram-mini-app-booking-submit-button');
    if (false) {

    await expect(submitButton).toHaveText('Заполните имя и телефон');
    await expect(submitButton).toBeDisabled();

    await phoneField.fill('+79990000000');
    await expect(submitButton).toHaveText('Заполните имя и телефон');
    await expect(submitButton).toBeDisabled();

    await nameField.fill('Мария');
    await expect(submitButton).toHaveText('Отправить заявку');
    await expect(submitButton).toBeEnabled();

    }

    const nameHelper = page.getByTestId('telegram-mini-app-booking-name-helper');
    const phoneHelper = page.getByTestId('telegram-mini-app-booking-phone-helper');
    const submitHelper = page.getByTestId('telegram-mini-app-booking-submit-helper');

    await expect(submitButton).toHaveText('Укажите имя и телефон');
    await expect(submitButton).toBeDisabled();
    await expect(nameHelper).toContainText('2');
    await expect(phoneHelper).toContainText('+7XXXXXXXXXX');
    await expect(submitHelper).toContainText('+7XXXXXXXXXX');

    await phoneField.fill('89990000000123');
    await expect(phoneField).toHaveValue('89990000000');
    await expect(submitButton).toHaveText('Укажите имя');
    await expect(submitButton).toBeDisabled();

    await nameField.fill('Я');
    await expect(submitButton).toHaveText('Укажите имя');
    await expect(submitButton).toBeDisabled();

    await nameField.fill('Ян');
    await expect(submitButton).toHaveText('Отправить заявку');
    await expect(submitButton).toBeEnabled();
    await expect(phoneHelper).toHaveCount(0);
    await expect(submitHelper).toHaveCount(0);

    await phoneField.fill('79990000000');
    await expect(submitButton).toHaveText('Проверьте телефон');
    await expect(submitButton).toBeDisabled();

    await phoneField.fill('+7999000000');
    await expect(submitButton).toHaveText('Проверьте телефон');
    await expect(submitButton).toBeDisabled();
    await expect(phoneHelper).toContainText('11');

    await phoneField.fill('+79990000000');
    await expect(submitButton).toHaveText('Отправить заявку');
    await expect(submitButton).toBeEnabled();

    const counterGridBox = await counterGrid.boundingBox();
    const phoneFieldBox = await phoneField.boundingBox();
    const totalCardBox = await totalCard.boundingBox();
    const backButtonBox = await backButton.boundingBox();
    expect(counterGridBox).not.toBeNull();
    expect(phoneFieldBox).not.toBeNull();
    expect(totalCardBox).not.toBeNull();
    expect(backButtonBox).not.toBeNull();
    expect(totalCardBox.y).toBeGreaterThan(counterGridBox.y + counterGridBox.height);
    expect(totalCardBox.y).toBeGreaterThan(phoneFieldBox.y + phoneFieldBox.height - 1);
    expect(backButtonBox.y).toBeGreaterThan(totalCardBox.y + totalCardBox.height - 1);

    await submitButton.click();

    await expect(page.getByTestId('telegram-mini-app-submit-result')).toBeVisible();
    await expect(page.getByText('Заявка создана', { exact: true })).toBeVisible();
    await expect(page.getByText('С вами свяжется продавец', { exact: false })).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Свяжитесь с продавцом и передайте предоплату' })
    ).toBeVisible();
    await expect(page.getByText(publicSellerName, { exact: true })).toBeVisible();
    await expect(page.getByText(publicSellerPhone, { exact: true })).toBeVisible();
    const postRequestSellerPhoneCard = page
      .locator('.tg-mini-app__meta-item')
      .filter({ hasText: publicSellerPhone })
      .first();
    const postRequestCopyAction = postRequestSellerPhoneCard.getByTestId(
      'telegram-mini-app-post-request-copy-seller'
    );
    await expect(postRequestCopyAction).toBeVisible();
    const postRequestCopyActionMechanism =
      await inspectCompactActionButton(postRequestCopyAction);
    expect(postRequestCopyActionMechanism.tagName).toBe('BUTTON');
    expect(postRequestCopyActionMechanism.topTagName).toBe('BUTTON');
    expect(postRequestCopyActionMechanism.topIsSelfOrChild).toBe(true);
    expect(postRequestCopyActionMechanism.pointerEvents).toBe('auto');
    expect(postRequestCopyActionMechanism.rect.height).toBeLessThan(44);
    await postRequestCopyAction.click();
    await expectMiniAppClipboardWrite(page, 1, publicSellerPhone);
    const postRequestCopyFeedback = postRequestSellerPhoneCard.getByTestId(
      'telegram-mini-app-post-request-copy-feedback'
    );
    await expect(postRequestCopyFeedback).toHaveText('Номер скопирован');
    await expect(page.getByRole('link', { name: 'Позвонить продавцу' })).toHaveCount(0);
    await expect(page.getByText('Срок брони', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Бронь действует до', { exact: false })).toHaveCount(0);
    const postRequestTimer = page.getByTestId('telegram-mini-app-post-request-timer');
    await expect(postRequestTimer).toHaveCount(1);
    await expect(postRequestTimer).toContainText(
      /\u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C \u0432\u0440\u0435\u043C\u0435\u043D\u0438/
    );
    await expect(postRequestTimer).toContainText(/\d{2}:\d{2}/);
    const postRequestLowerGrid = page.getByTestId('telegram-mini-app-post-request-lower-grid');
    const postRequestLowerGridBox = await postRequestLowerGrid.boundingBox();
    expect(postRequestLowerGridBox).not.toBeNull();
    await page.waitForTimeout(2200);
    await expect(postRequestCopyFeedback).toHaveCount(0);
    await expect(page.getByText('Бронь активна', { exact: true })).toHaveCount(0);
    await expect(
      page.getByText(formatRussianDateTimeLabel(catalogDate, '05:20'))
    ).toBeVisible();

    await page.getByRole('button', { name: 'Открыть мои заявки' }).click();

    const myTickets = page.getByTestId('telegram-mini-app-my-tickets');
    await expect(myTickets).toBeVisible();
    await expect(myTickets.getByText('Здесь видно, кто ведёт заявку', { exact: false })).toHaveCount(
      0
    );
    const pendingMyTicketCard = myTickets.getByTestId('telegram-mini-app-ticket-list-item').first();
    await expect(pendingMyTicketCard).toBeVisible();
    await expect(pendingMyTicketCard.locator('.tg-mini-app__list-card-topline')).toHaveCount(0);
    await expect(
      pendingMyTicketCard.locator('.tg-mini-app__meta-grid--buyer-flow-clean .tg-mini-app__meta-item')
    ).toHaveCount(3);
    await expect(myTickets.getByText('Ждём предоплату').first()).toBeVisible();
    await expect(myTickets.getByText('Осталось времени', { exact: true }).first()).toBeVisible();
    await expect(myTickets.getByText(formatRussianDateTimeLabel(catalogDate, '05:20'))).toBeVisible();
    await expect(myTickets.getByText('Пассажиры', { exact: true }).first()).toBeVisible();
    await expect(myTickets.getByText(publicSellerName, { exact: true })).toHaveCount(0);
    await expect(myTickets.getByText(publicSellerPhone, { exact: true })).toHaveCount(0);
    await expect(myTickets.getByText(/Осталось \d{2}:\d{2}/).first()).toHaveCount(0);
    await expect(myTickets.getByText('С вами свяжется продавец', { exact: false })).toHaveCount(0);
    await expect(myTickets.getByText('Ещё не оформлен', { exact: true })).toHaveCount(0);
    const openRequestButton = pendingMyTicketCard.getByRole('button', {
      name: 'Открыть заявку',
      exact: true,
    });
    await expect(openRequestButton).toBeVisible();
    const openRequestButtonBox = await openRequestButton.boundingBox();
    expect(openRequestButtonBox).not.toBeNull();
    const infoBlocks = pendingMyTicketCard.locator(
      '.tg-mini-app__meta-grid--buyer-flow-clean .tg-mini-app__meta-item'
    );
    const infoBlockCount = await infoBlocks.count();
    expect(infoBlockCount).toBe(3);
    for (let infoBlockIndex = 0; infoBlockIndex < infoBlockCount; infoBlockIndex += 1) {
      const infoBlockBox = await infoBlocks.nth(infoBlockIndex).boundingBox();
      expect(infoBlockBox).not.toBeNull();
      expect(infoBlockBox.width).toBeGreaterThan((openRequestButtonBox.width ?? 0) - 34);
    }
    const statusPill = pendingMyTicketCard
      .locator('.tg-mini-app__list-card-status .tg-mini-app__pill')
      .first();
    await expect(statusPill).toBeVisible();
    const statusPillBox = await statusPill.boundingBox();
    const pendingMyTicketCardBox = await pendingMyTicketCard.boundingBox();
    expect(statusPillBox).not.toBeNull();
    expect(pendingMyTicketCardBox).not.toBeNull();
    const statusPillCenterX = statusPillBox.x + statusPillBox.width / 2;
    const cardCenterX = pendingMyTicketCardBox.x + pendingMyTicketCardBox.width / 2;
    expect(Math.abs(statusPillCenterX - cardCenterX)).toBeLessThanOrEqual(12);

    await openRequestButton.click();
    await expect(page.getByTestId('telegram-mini-app-ticket-view')).toBeVisible();
    await expect(page.getByText('Заявка создана', { exact: true }).first()).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Ждём предоплату' })).toBeVisible();
    await expect(page.getByText('Что делать сейчас').first()).toBeVisible();
    const pendingDetailPanels = page.locator(
      '.tg-mini-app__ticket-view-stack--pending > .tg-mini-app__subpanel'
    );
    await expect(pendingDetailPanels).toHaveCount(2);
    const firstPendingPanelBox = await pendingDetailPanels.nth(0).boundingBox();
    const secondPendingPanelBox = await pendingDetailPanels.nth(1).boundingBox();
    expect(firstPendingPanelBox).not.toBeNull();
    expect(secondPendingPanelBox).not.toBeNull();
    expect(secondPendingPanelBox.y).toBeGreaterThan(
      firstPendingPanelBox.y + firstPendingPanelBox.height + 4
    );
    await expect(
      page.getByRole('heading', { name: 'Свяжитесь с продавцом и передайте предоплату' })
    ).toBeVisible();
    await expect(page.getByText(publicSellerName, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(publicSellerPhone, { exact: true }).first()).toBeVisible();
    const ticketViewSellerPhoneCard = page
      .locator('.tg-mini-app__meta-item')
      .filter({ hasText: publicSellerPhone })
      .first();
    const ticketViewCopyAction = ticketViewSellerPhoneCard.getByTestId(
      'telegram-mini-app-ticket-view-copy-seller'
    );
    await expect(ticketViewCopyAction).toBeVisible();
    const ticketViewCopyActionMechanism =
      await inspectCompactActionButton(ticketViewCopyAction);
    expect(ticketViewCopyActionMechanism.tagName).toBe('BUTTON');
    expect(ticketViewCopyActionMechanism.topTagName).toBe('BUTTON');
    expect(ticketViewCopyActionMechanism.topIsSelfOrChild).toBe(true);
    expect(ticketViewCopyActionMechanism.pointerEvents).toBe('auto');
    expect(ticketViewCopyActionMechanism.rect.height).toBeLessThan(44);
    await ticketViewCopyAction.click();
    await expectMiniAppClipboardWrite(page, 2, publicSellerPhone);
    await expect(
      ticketViewSellerPhoneCard.getByTestId('telegram-mini-app-ticket-view-copy-feedback')
    ).toHaveText('Номер скопирован');
    await expect(page.getByRole('link', { name: 'Позвонить продавцу' })).toHaveCount(0);
    const ticketViewTimer = page.getByTestId('telegram-mini-app-ticket-view-timer');
    await expect(ticketViewTimer).toHaveCount(1);
    await expect(ticketViewTimer).toContainText(/\d{2}:\d{2}/);
    await expect(page.getByText('Срок брони', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Бронь действует до', { exact: false })).toHaveCount(0);
    await expect(page.getByText(/Осталось \d{2}:\d{2}/)).toHaveCount(0);
    await expect(page.getByText('Код появится после оформления', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Открыть сохранённую копию' })).toHaveCount(0);
    await expect(page.getByText('4 места')).toBeVisible();
  });
});

