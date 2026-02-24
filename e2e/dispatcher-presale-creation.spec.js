// e2e/dispatcher-presale-creation.spec.js
/**
 * E2E Tests: Dispatcher Presale Creation (Group A)
 * Tests for creating presales with different seller/payment options
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers/auth.js';
import { openFirstTrip, createPresaleUI } from './helpers/dispatcher.js';

const E2E_DISPATCHER_USERNAME = process.env.E2E_DISPATCHER_USERNAME || 'dispatcher';
const E2E_DISPATCHER_PASSWORD = process.env.E2E_DISPATCHER_PASSWORD || '123456';
const E2E_TARGET_DATE = process.env.E2E_TARGET_DATE || (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
})();

async function getTokenFromStorage(page) {
  return page.evaluate(() => localStorage.getItem('token'));
}

async function fetchPresales(request, token) {
  const res = await request.get('/api/selling/presales', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

function getMaxPresaleId(list) {
  return (list || []).reduce((maxId, p) => {
    const id = Number(p?.id || 0);
    return id > maxId ? id : maxId;
  }, 0);
}

async function waitNewPresaleAfterId(request, token, previousMaxId) {
  for (let i = 0; i < 20; i += 1) {
    const list = await fetchPresales(request, token);
    const found = list.find((p) => Number(p?.id || 0) > Number(previousMaxId || 0));
    if (found?.id) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`New presale not found after id=${previousMaxId}`);
}

async function loginApi(request, username, password) {
  const res = await request.post('/api/auth/login', {
    data: { username, password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body?.token).toBeTruthy();
  return body.token;
}

async function getSeasonFundCurrent(request, ownerToken, seasonId) {
  const res = await request.get(`/api/owner/motivation/season?season_id=${seasonId}`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const data = body?.data || {};
  return Number(data.season_pool_total_current ?? data.season_pool_total_ledger ?? 0);
}

async function waitSeasonFundAtLeast(request, ownerToken, seasonId, minValue) {
  for (let i = 0; i < 20; i += 1) {
    const current = await getSeasonFundCurrent(request, ownerToken, seasonId);
    if (current >= minValue) return current;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`season_pool_total_current did not reach ${minValue}`);
}

test.describe('A. Dispatcher Presale Creation', () => {
  test.beforeEach(async ({ page }) => {
    // Clean state for each test
    await page.context().clearCookies();

    // Clear storage BEFORE React initializes
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.goto('http://localhost:5173/');

    // Login using helper
    await login(page, E2E_DISPATCHER_USERNAME, E2E_DISPATCHER_PASSWORD);

    // Wait for redirect after login and open selling tab
    await expect(
      page.getByTestId('tab-selling')
    ).toBeVisible({ timeout: 10000 });

    await page.getByTestId('tab-selling').click();

    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill(E2E_TARGET_DATE);
    await dateInputs.nth(1).fill(E2E_TARGET_DATE);

    await expect(
      page.getByTestId(/trip-card-/).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('A1. Create presale without seller selection (defaults to dispatcher)', async ({ page }) => {
    // Open first available trip
    await openFirstTrip(page);

    // Create presale with dispatcher as seller (no seller selected)
    await createPresaleUI(page, {
      adult: 1,
      teen: 0,
      child: 0,
      namePreset: 'Maria',
      phone: '+79781110001',
    });

    // Wait for presale card to appear
    await page.waitForSelector('[data-testid^="presale-card-"]', { timeout: 5000 });

    // Verify presale card exists
    const presaleCards = await page.locator('[data-testid^="presale-card-"]').count();
    expect(presaleCards).toBeGreaterThan(0);
  });

  test('A2. Create presale on behalf of seller', async ({ page }) => {
    await openFirstTrip(page);

    // Create presale selecting a specific seller
    await createPresaleUI(page, {
      adult: 1,
      teen: 0,
      child: 0,
      namePreset: 'Alexey',
      phone: '+79781110002',
      sellerId: 'first',
    });

    // Verify presale created
    const presaleCards = await page.locator('[data-testid^="presale-card-"]').count();
    expect(presaleCards).toBeGreaterThan(0);
  });

  test('A3. Create presale with prepayment CASH', async ({ page }) => {
    await openFirstTrip(page);

    await createPresaleUI(page, {
      adult: 1,
      teen: 0,
      child: 0,
      namePreset: 'Dmitry',
      phone: '+79781110003',
      prepayPreset: 1000,
      paymentMethod: 'cash',
    });

    // Verify presale card appears
    const presaleCards = await page.locator('[data-testid^="presale-card-"]').count();
    expect(presaleCards).toBeGreaterThan(0);
  });

  test('A4. Create presale with prepayment CARD', async ({ page }) => {
    await openFirstTrip(page);

    await createPresaleUI(page, {
      adult: 1,
      teen: 0,
      child: 0,
      namePreset: 'Ivan',
      phone: '+79781110004',
      prepayPreset: 500,
      paymentMethod: 'card',
    });

    // Verify presale card appears
    const presaleCards = await page.locator('[data-testid^="presale-card-"]').count();
    expect(presaleCards).toBeGreaterThan(0);
  });

  test('A5. Create presale with prepayment MIXED', async ({ page }) => {
    await openFirstTrip(page);

    await createPresaleUI(page, {
      adult: 1,
      teen: 0,
      child: 0,
      namePreset: 'Anna',
      phone: '+79781110005',
      prepayPreset: 2000,
      paymentMethod: 'mixed',
    });

    // Verify presale card appears
    const presaleCards = await page.locator('[data-testid^="presale-card-"]').count();
    expect(presaleCards).toBeGreaterThan(0);
  });

  test('A6. Delete prepayment order to season fund via modal', async ({ page, request }) => {
    await openFirstTrip(page);

    const dispatcherToken = await getTokenFromStorage(page);
    expect(dispatcherToken).toBeTruthy();

    const ownerUsername = process.env.E2E_OWNER_USERNAME || 'owner';
    const ownerPassword = process.env.E2E_OWNER_PASSWORD || 'owner123';
    const ownerToken = await loginApi(request, ownerUsername, ownerPassword);

    const seasonId = String(new Date().getFullYear());
    const seasonBefore = await getSeasonFundCurrent(request, ownerToken, seasonId);

    const presalesBefore = await fetchPresales(request, dispatcherToken);
    const maxBefore = getMaxPresaleId(presalesBefore);

    await createPresaleUI(page, {
      adult: 1,
      teen: 0,
      child: 0,
      namePreset: 'Maria',
      phone: '+79781110006',
      prepayPreset: 1000,
      paymentMethod: 'cash',
    });

    const createdPresale = await waitNewPresaleAfterId(request, dispatcherToken, maxBefore);
    const presaleId = Number(createdPresale.id);
    expect(presaleId).toBeGreaterThan(0);

    await page.getByTestId(`presale-delete-btn-${presaleId}`).click();
    await expect(page.getByTestId('dispatcher-prepay-decision-modal')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('dispatcher-prepay-decision-fund').click();

    await expect(page.getByTestId(`presale-card-${presaleId}`)).toHaveCount(0, { timeout: 10000 });

    const seasonAfter = await waitSeasonFundAtLeast(request, ownerToken, seasonId, seasonBefore + 1000);
    expect(seasonAfter).toBeGreaterThanOrEqual(seasonBefore + 1000);
  });
});
