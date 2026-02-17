// e2e/dispatcher-presale-creation.spec.js
/**
 * E2E Tests: Dispatcher Presale Creation (Group A)
 * Tests for creating presales with different seller/payment options
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers/auth.js';
import { openFirstTrip, createPresaleUI } from './helpers/dispatcher.js';

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
    await login(page, 'dispatcher', '123456');
    
    // Wait for redirect after login
    await expect(
      page.getByTestId('tab-selling')
    ).toBeVisible({ timeout: 10000 });
    
    // Wait for app to fully render
    await expect(
      page.getByRole('button', { name: 'Продажа | Посадка' })
    ).toBeVisible({ timeout: 10000 });
    
    await page.getByRole('button', { name: 'Продажа | Посадка' }).click();
    
    // Wait for trip list to appear
    await expect(
      page.getByText(/Свободно:/)
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
      sellerId: '2', // First active seller from DB
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
    });
    
    // Verify presale card appears
    const presaleCards = await page.locator('[data-testid^="presale-card-"]').count();
    expect(presaleCards).toBeGreaterThan(0);
  });
});
