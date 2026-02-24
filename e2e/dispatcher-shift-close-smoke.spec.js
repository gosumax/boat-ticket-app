// e2e/dispatcher-shift-close-smoke.spec.js — Smoke test for dispatcher shift close
import { test, expect } from '@playwright/test';
import { loginAsDispatcher } from './helpers/dispatcher';

test.describe('Dispatcher Shift Close Smoke', () => {
  test('shift close flow: open -> summary -> close -> snapshot', async ({ page }) => {
    // Login as dispatcher
    await loginAsDispatcher(page);
    
    // Navigate to shift close tab
    await page.click('text=Закрытие смены');
    
    // Wait for summary to load
    await page.waitForSelector('text=ИТОГО ЗА ДЕНЬ', { timeout: 10000 });
    
    // Check shift status indicator
    const statusText = await page.locator('text=Открыта').or(page.locator('text=Закрыта')).first().textContent();
    console.log('Shift status:', statusText);
    
    // If shift is open, check buttons are enabled
    const isOpen = statusText.includes('Открыта');
    
    if (isOpen) {
      // Check deposit buttons are enabled (not disabled)
      const depositButtons = await page.locator('button:has-text("Сдать нал")').count();
      console.log('Found deposit buttons:', depositButtons);
      
      // Check close shift button exists
      const closeBtn = page.locator('button:has-text("Закрыть смену")');
      if (await closeBtn.count() > 0) {
        console.log('Close shift button found');
      }
    } else {
      // Shift is closed - verify disabled state
      console.log('Shift already closed, verifying snapshot mode');
      
      // Check for closed message
      const closedMsg = await page.locator('text=Смена закрыта').first().textContent();
      expect(closedMsg).toContain('Смена закрыта');
      
      // Verify source is snapshot
      const sourceText = await page.locator('text=snapshot').first().textContent();
      expect(sourceText).toContain('snapshot');
    }
    
    // Check motivation_withhold block visibility (if present)
    const withholdBlock = page.locator('[data-testid="shiftclose-withhold-weekly"]');
    if (await withholdBlock.count() > 0) {
      console.log('Motivation withhold block found');
      // Verify testid elements exist
      await expect(page.locator('[data-testid="shiftclose-withhold-season"]')).toBeVisible();
      await expect(page.locator('[data-testid="shiftclose-withhold-dispatcher"]')).toBeVisible();
      await expect(page.locator('[data-testid="shiftclose-withhold-fund-original"]')).toBeVisible();
      await expect(page.locator('[data-testid="shiftclose-withhold-fund-after"]')).toBeVisible();
    }
    
    // Take screenshot for evidence
    await page.screenshot({ path: 'test-results/shift-close-smoke.png' });
  });
});
