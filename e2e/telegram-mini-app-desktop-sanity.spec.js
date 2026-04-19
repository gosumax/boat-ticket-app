import { expect, test } from '@playwright/test';

test.describe('Telegram Mini App desktop sanity', () => {
  test('renders the buyer catalog shell cleanly on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/telegram/mini-app?telegram_user_id=777000111');

    await expect(page.locator('.tg-mini-app__nav')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Каталог', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Мои заявки', exact: true })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Выберите тип поездки' })).toBeVisible();
    await expect(page.getByText('Дата поездки')).toBeVisible();
    await expect(page.getByText('Каталог рейсов', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('telegram-mini-app-type-selection')).toBeVisible();
    await expect(page.getByTestId('telegram-mini-app-type-filter-speed')).toHaveCount(0);
    await expect(page.getByText('Debug only')).toHaveCount(0);
  });
});
