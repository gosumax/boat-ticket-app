import Database from 'better-sqlite3';
import path from 'path';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'url';
import { login } from './helpers/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const e2eDbPath = path.resolve(__dirname, '..', '_testdata', 'e2e.sqlite');

const ADMIN_USERNAME = 'admin_ui_polish';
const ADMIN_PASSWORD = '123456';

function ensureAdminUsersSanityFixtures() {
  const db = new Database(e2eDbPath);
  try {
    db.prepare(
      `
        INSERT INTO users (username, password_hash, role, is_active)
        VALUES (?, ?, 'admin', 1)
        ON CONFLICT(username) DO UPDATE SET
          password_hash = excluded.password_hash,
          role = 'admin',
          is_active = 1
      `
    ).run(ADMIN_USERNAME, ADMIN_PASSWORD);

    const seller = db
      .prepare(
        `
          SELECT id
          FROM users
          WHERE role = 'seller'
          ORDER BY id ASC
          LIMIT 1
        `
      )
      .get();

    const sellerId = Number(seller?.id || 0);
    if (sellerId > 0) {
      db.prepare(
        `
          UPDATE users
          SET
            public_display_name = COALESCE(NULLIF(public_display_name, ''), ?),
            public_phone_e164 = COALESCE(NULLIF(public_phone_e164, ''), ?)
          WHERE id = ?
        `
      ).run('Анна Соколова', '+79995554433', sellerId);
    }
  } finally {
    db.close();
  }
}

test.describe('Admin users desktop polish', () => {
  test('stretches users layout on desktop and shows save-profile success feedback for 3s', async ({
    page,
  }) => {
    ensureAdminUsersSanityFixtures();

    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    await page.goto('/admin');
    await page.getByTestId('admin-tab-users').click();

    const layout = page.getByTestId('admin-users-layout');
    await expect(layout).toBeVisible();

    const createBlock = page.getByTestId('admin-users-create-block');
    const listBlock = page.getByTestId('admin-users-list-block');
    await expect(createBlock).toBeVisible();
    await expect(listBlock).toBeVisible();

    const layoutBox = await layout.boundingBox();
    const createBox = await createBlock.boundingBox();
    const listBox = await listBlock.boundingBox();
    expect(layoutBox).not.toBeNull();
    expect(createBox).not.toBeNull();
    expect(listBox).not.toBeNull();
    expect(layoutBox.width).toBeGreaterThan(1200);
    expect(listBox.x).toBeGreaterThan(createBox.x + createBox.width - 48);
    expect(listBox.width).toBeGreaterThan(createBox.width * 1.8);

    const usersTableScrollArea = page.getByTestId('admin-users-table-scroll-area');
    await expect(usersTableScrollArea).toBeVisible();
    const usersTableOverflowMetrics = await usersTableScrollArea.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(usersTableOverflowMetrics.scrollWidth).toBeLessThanOrEqual(
      usersTableOverflowMetrics.clientWidth + 1
    );

    const saveProfileButton = page
      .locator('[data-testid^="admin-save-profile-button-"]')
      .first();
    await expect(saveProfileButton).toBeVisible();
    await saveProfileButton.click();

    const saveSuccess = page.getByTestId('admin-save-profile-success');
    await expect(saveSuccess).toBeVisible();
    await expect(saveSuccess).toContainText(
      '\u041F\u0440\u043E\u0444\u0438\u043B\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D'
    );
    await expect(saveSuccess).toHaveCount(0, { timeout: 5000 });
  });
});
