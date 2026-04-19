import { expect, test } from '@playwright/test';

test.describe('Telegram Mini App buyer shell', () => {
  test('renders the buyer catalog shell on desktop without showing debug panels by default', async ({ page }) => {
    await page.goto('/telegram/mini-app?telegram_user_id=777123456');

    await expect(page.locator('.tg-mini-app__nav')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Каталог', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Мои заявки', exact: true })).toBeVisible();
    await expect(page.getByText('Дата поездки')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Выберите тип поездки' })).toBeVisible();
    await expect(page.getByTestId('telegram-mini-app-type-selection')).toBeVisible();
    await expect(page.getByText('Active buyer runtime markers')).toHaveCount(0);
    await expect(page.getByTestId('login-submit')).toHaveCount(0);
    await expect(page.getByTestId('telegram-mini-app-emergency-shell')).toHaveCount(0);
  });

  test('keeps the first visible catalog screen polished on an iPhone-like viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/telegram/mini-app?telegram_user_id=777123456');

    await expect(page.getByRole('heading', { name: 'Выберите тип поездки' })).toBeVisible();
    await expect(page.getByText('Дата поездки')).toBeVisible();
    await expect(page.getByTestId('telegram-mini-app-type-selection')).toBeVisible();
    await expect(page.locator('.tg-mini-app__nav')).toBeVisible();
    await expect(page.getByText('Active buyer runtime markers')).toHaveCount(0);
    await expect(page.getByText('Debug only')).toHaveCount(0);
  });

  test('keeps diagnostics available when debug mode is explicitly enabled', async ({ page }) => {
    await page.goto('/telegram/mini-app?telegram_user_id=777123456&mini_app_debug=1');

    await expect(page.getByText('Active buyer runtime markers')).toBeVisible();
    await expect(page.getByText('Buyer API diagnostics')).toBeVisible();
    await expect(page.getByText('Current URL:')).toBeVisible();
  });
});
