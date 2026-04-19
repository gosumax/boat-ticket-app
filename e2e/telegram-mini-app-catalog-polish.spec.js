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

function formatRussianDateLabel(dateValue) {
  const [year, month, day] = String(dateValue)
    .split('-')
    .map((segment) => Number(segment));
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
}

async function expectCatalogItemsToMatchTripType(catalogItems, tripType) {
  const itemCount = await catalogItems.count();
  expect(itemCount).toBeGreaterThan(0);
  for (let index = 0; index < itemCount; index += 1) {
    await expect(catalogItems.nth(index)).toHaveAttribute('data-trip-type', tripType);
  }
}

test.describe('Telegram Mini App buyer catalog polish', () => {
  test('shows type selection first, scopes trips by chosen type, and shows age-based prices on mobile', async ({
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
      JSON.stringify({ code: 'seller-qr-a' })
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
        VALUES (?, '06:10', 2000, 10, 0, 60, ?, 1, 2000, 500, 1000)
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

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/telegram/mini-app?telegram_user_id=${telegramUserId}&date=${catalogDate}`
    );

    const catalog = page.getByTestId('telegram-mini-app-catalog');
    await expect(catalog).toBeVisible();
    await expect(page.getByText('06:10', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('telegram-mini-app-type-selection')).toBeVisible();
    await expect(page.getByTestId('telegram-mini-app-type-filter-speed')).toHaveCount(0);
    await expect(catalog.getByText('Каталог рейсов', { exact: true })).toHaveCount(0);
    await expect(catalog.getByText('Сначала выберите формат поездки', { exact: false })).toHaveCount(0);

    const catalogItems = page.getByTestId('telegram-mini-app-catalog-item');
    await expect(catalogItems).toHaveCount(0);

    await page
      .getByTestId('telegram-mini-app-type-selection-card-speed')
      .getByRole('button', { name: 'Смотреть рейсы' })
      .click();
    await expect(catalogItems.first()).toBeVisible();
    await expect(catalogItems.first().locator('.tg-mini-app__list-card-price')).toHaveCount(0);
    await expectCatalogItemsToMatchTripType(catalogItems, 'speed');

    await page.getByTestId('telegram-mini-app-change-type-button').click();
    await expect(page.getByTestId('telegram-mini-app-type-selection')).toBeVisible();
    await page
      .getByTestId('telegram-mini-app-type-selection-card-cruise')
      .getByRole('button', { name: 'Смотреть рейсы' })
      .click();
    await expect(catalogItems.first()).toBeVisible();
    await expectCatalogItemsToMatchTripType(catalogItems, 'cruise');

    await page.getByTestId('telegram-mini-app-change-type-button').click();
    await page
      .getByTestId('telegram-mini-app-type-selection-card-banana')
      .getByRole('button', { name: 'Смотреть рейсы' })
      .click();
    await expect(catalogItems.first()).toBeVisible();
    await expectCatalogItemsToMatchTripType(catalogItems, 'banana');
    await expect(
      page.locator('.tg-mini-app__panel--catalog .tg-mini-app__section-header')
    ).toHaveCSS('text-align', 'center');
    await expect(catalogItems.first().locator('.tg-mini-app__list-title')).toHaveCSS(
      'text-align',
      'center'
    );
    await expect(catalog.getByText('Цена за взрослого', { exact: true })).toHaveCount(0);
    await expect(catalog.getByText('Тип рейса', { exact: true })).toHaveCount(0);
    await expect(catalog.getByText('Показываем только рейсы формата', { exact: false })).toHaveCount(0);

    await catalogItems.first().getByRole('button', { name: 'Открыть рейс' }).click();

    const tripCard = page.getByTestId('telegram-mini-app-trip-card');
    await expect(tripCard).toBeVisible();
    await expect(tripCard.getByText('Карточка рейса', { exact: true })).toHaveCount(0);
    await expect(tripCard.getByRole('heading')).toHaveCount(1);
    await expect(
      tripCard.getByText('Видно сразу для всех возрастных категорий.', { exact: true })
    ).toHaveCount(0);
    await expect(tripCard).toContainText(formatRussianDateLabel(catalogDate));
    await expect(tripCard.getByText(/\d{4}-\d{2}-\d{2}/)).toHaveCount(0);
    await expect(page.getByTestId('telegram-mini-app-trip-price-adult')).toContainText(
      'Взрослый'
    );
    await expect(page.getByTestId('telegram-mini-app-trip-price-adult')).toContainText(
      '2200 RUB'
    );
    await expect(page.getByTestId('telegram-mini-app-trip-price-teen')).toContainText(
      'Подросток'
    );
    await expect(page.getByTestId('telegram-mini-app-trip-price-teen')).toContainText(
      '0 RUB'
    );
    await expect(page.getByTestId('telegram-mini-app-trip-price-child')).toContainText(
      'Ребёнок'
    );
    await expect(page.getByTestId('telegram-mini-app-trip-price-child')).toContainText(
      '700 RUB'
    );

    const priceCard = page.getByTestId('telegram-mini-app-trip-price-card');
    await expect(priceCard).toHaveCSS('padding-top', '18px');
    await expect(priceCard).toHaveCSS('padding-right', '58px');
    const priceCardBox = await priceCard.boundingBox();
    const hintTrigger = page.getByTestId('telegram-mini-app-age-hint-trigger');
    const hintTriggerBox = await hintTrigger.boundingBox();
    expect(priceCardBox).not.toBeNull();
    expect(hintTriggerBox).not.toBeNull();
    expect(hintTriggerBox.x).toBeGreaterThan(priceCardBox.x + priceCardBox.width - 56);
    expect(hintTriggerBox.y).toBeLessThan(priceCardBox.y + 24);
    expect(hintTriggerBox.x + hintTriggerBox.width).toBeLessThanOrEqual(
      priceCardBox.x + priceCardBox.width - 8
    );

    await hintTrigger.click();
    await expect(page.getByTestId('telegram-mini-app-age-hint-body')).toContainText(
      'Ребёнок: до 5 лет включительно. Подросток: старше 5 и до 14 лет. Взрослый: 14+.'
    );
  });
});
