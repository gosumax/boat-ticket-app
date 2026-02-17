// e2e/helpers/dispatcher.js
import { expect } from '@playwright/test';

/**
 * Helpers for dispatcher UI interactions
 */

/**
 * Ensure we're on the "Продажа | Посадка" (Sales/Boarding) tab
 */
export async function ensureSalesTab(page) {
  await page.getByTestId('tab-selling').click();
}

/**
 * Navigate to dispatcher view and open first available trip
 */
export async function openFirstTrip(page) {
  await page.goto('/dispatcher');
  
  // Wait for trip cards to appear
  const tripCard = page.getByTestId(/trip-card-/).first();
  await expect(tripCard).toBeVisible({ timeout: 10000 });
  await expect(tripCard).toBeEnabled({ timeout: 5000 });
  
  // Click exactly once
  await tripCard.click({ clickCount: 1 });
  
  // Wait for sell button to appear (trip details loaded)
  await expect(
    page.getByTestId('trip-sell-btn').first()
  ).toBeVisible({ timeout: 5000 });
}

/**
 * Create presale via UI
 * @param {Page} page 
 * @param {Object} options 
 * @param {number} options.adult - Number of adult tickets
 * @param {number} options.teen - Number of teen tickets
 * @param {number} options.child - Number of child tickets
 * @param {string} options.namePreset - Quick name button to click (Latin: 'Maria', 'Alexey', 'Dmitry', 'Ivan', 'Anna', 'Elena')
 * @param {string} options.name - Customer name (if no preset)
 * @param {string} options.phone - Customer phone (required)
 * @param {number} options.prepayPreset - Prepayment preset button (500, 1000, 2000, or 'full')
 * @param {number} options.prepay - Prepayment amount (if no preset)
 * @param {string} options.paymentMethod - 'cash' | 'card' | 'mixed' (for prepayment > 0)
 * @param {string} options.sellerId - Optional seller ID for dispatcher
 */
export async function createPresaleUI(page, options) {
  const {
    adult = 1,
    teen = 0,
    child = 0,
    namePreset = 'Maria',
    name = '',
    phone = '+79785555555',
    prepayPreset = 0,
    prepay = 0,
    paymentMethod = '',
    sellerId = '',
  } = options;

  // Guard: wait for tab to be active and trips rendered
  await expect(
    page.getByRole('button', { name: 'Продажа | Посадка' })
  ).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByText(/Свободно:/)
  ).toBeVisible({ timeout: 10000 });

  // If form already open — close it first (idempotent)
  const openSubmit = page.getByTestId('presale-create-btn');
  if (await openSubmit.count() > 0) {
    const closeBtn = page.getByRole('button', { name: '✕' }).last();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await expect(openSubmit).toHaveCount(0);
    }
  }

  // Click "Продать билет" button
  const sellBtn = page.getByTestId('trip-sell-btn').first();
  await expect(sellBtn).toBeVisible({ timeout: 5000 });
  await expect(sellBtn).toBeEnabled({ timeout: 5000 });
  await sellBtn.click();

  // Wait for form to appear
  const submitBtn = page.getByTestId('presale-create-btn').last();
  await expect(submitBtn).toBeVisible({ timeout: 5000 });

  // Scope to the active form (last instance) to avoid strict mode violations
  const form = submitBtn.locator('xpath=ancestor::div[.//h3[contains(.,"Информация о клиенте")]]');

  // Select seller if provided (dispatcher only)
  if (sellerId) {
    const sellerSelect = form.getByTestId('seller-select');
    if (await sellerSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      await sellerSelect.selectOption(sellerId);
    }
  }

  // Set adult tickets (default is 1, so we may need to add more)
  const adultPlus = form.getByTestId('qty-adult-plus');
  const adultMinus = form.getByTestId('qty-adult-minus');
  
  // First reset to 0, then add desired count
  for (let i = 0; i < 10; i++) {
    await expect(adultMinus).toBeEnabled({ timeout: 2000 });
    await adultMinus.click();
  }
  for (let i = 0; i < adult; i++) {
    await expect(adultPlus).toBeEnabled({ timeout: 2000 });
    await adultPlus.click();
  }

  // Set teen tickets
  const teenPlus = form.getByTestId('qty-teen-plus');
  const teenMinus = form.getByTestId('qty-teen-minus');
  for (let i = 0; i < 10; i++) {
    await expect(teenMinus).toBeEnabled({ timeout: 2000 });
    await teenMinus.click();
  }
  for (let i = 0; i < teen; i++) {
    await expect(teenPlus).toBeEnabled({ timeout: 2000 });
    await teenPlus.click();
  }

  // Set child tickets
  const childPlus = form.getByTestId('qty-child-plus');
  const childMinus = form.getByTestId('qty-child-minus');
  for (let i = 0; i < 10; i++) {
    await expect(childMinus).toBeEnabled({ timeout: 2000 });
    await childMinus.click();
  }
  for (let i = 0; i < child; i++) {
    await expect(childPlus).toBeEnabled({ timeout: 2000 });
    await childPlus.click();
  }

  // Set customer name - use preset button (Latin testid)
  if (namePreset) {
    const nameBtn = form.getByTestId(`customer-name-preset-${namePreset}`);
    await expect(nameBtn).toBeVisible({ timeout: 2000 });
    await expect(nameBtn).toBeEnabled({ timeout: 2000 });
    await nameBtn.click();
  } else if (name) {
    const nameInput = form.getByTestId('customer-name-input');
    await expect(nameInput).toBeVisible({ timeout: 2000 });
    await nameInput.fill(name);
  }

  // Set phone (required for form to be valid)
  const phoneInput = form.getByTestId('customer-phone-input');
  await expect(phoneInput).toBeVisible({ timeout: 2000 });
  await phoneInput.fill(phone);

  // Set prepayment
  if (prepayPreset === 'full') {
    const prepayBtn = form.getByTestId('prepay-full');
    await expect(prepayBtn).toBeVisible({ timeout: 2000 });
    await prepayBtn.click();
  } else if (prepayPreset > 0) {
    const prepayBtn = form.getByTestId(`prepay-${prepayPreset}`);
    await expect(prepayBtn).toBeVisible({ timeout: 2000 });
    await prepayBtn.click();
  } else if (prepay > 0) {
    const prepayInput = form.getByTestId('prepay-input');
    await expect(prepayInput).toBeVisible({ timeout: 2000 });
    await prepayInput.fill(prepay.toString());
  }

  // Wait for submit button to be enabled and click
  await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  await submitBtn.click();
  
  // Wait for form to close
  await submitBtn.waitFor({ state: 'hidden', timeout: 5000 });
  
  // Guarantee: form fully closed
  await expect(
    page.getByTestId('presale-create-btn')
  ).toHaveCount(0, { timeout: 5000 });
  
  // Guarantee: at least one presale appeared
  await expect(
    page.getByTestId(/presale-(pay|delete|transfer)-btn-/).first()
  ).toBeVisible({ timeout: 5000 });
}

/**
 * Accept payment on presale card
 */
export async function acceptPayment(page, presaleId, method = 'CASH') {
  const payBtn = page.getByTestId(`presale-pay-btn-${presaleId}`);
  await expect(payBtn).toBeVisible({ timeout: 5000 });
  await expect(payBtn).toBeEnabled({ timeout: 5000 });
  await payBtn.click();

  // Select payment method in modal
  const methodBtn = page.locator(`button:has-text("${method}")`).first();
  await expect(methodBtn).toBeVisible({ timeout: 5000 });
  await methodBtn.click();
  
  // Confirm
  const confirmBtn = page.locator('button:has-text("Подтвердить"), button:has-text("Принять")').first();
  await expect(confirmBtn).toBeVisible({ timeout: 5000 });
  await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
  await confirmBtn.click();
}

/**
 * Delete presale
 */
export async function deletePresale(page, presaleId) {
  const deleteBtn = page.getByTestId(`presale-delete-btn-${presaleId}`);
  await expect(deleteBtn).toBeVisible({ timeout: 5000 });
  await expect(deleteBtn).toBeEnabled({ timeout: 5000 });
  await deleteBtn.click();

  // Confirm deletion
  const confirmBtn = page.locator('button:has-text("Удалить"), button:has-text("Да")').first();
  await expect(confirmBtn).toBeVisible({ timeout: 5000 });
  await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
  await confirmBtn.click();
}

/**
 * Transfer presale to another slot
 */
export async function transferPresale(page, presaleId, targetDate, targetSlotUid) {
  const transferBtn = page.getByTestId(`presale-transfer-btn-${presaleId}`);
  await expect(transferBtn).toBeVisible({ timeout: 5000 });
  await expect(transferBtn).toBeEnabled({ timeout: 5000 });
  await transferBtn.click();

  // Select date (adjust based on actual UI)
  const dateBtn = page.locator(`button:has-text("${targetDate}")`).first();
  await expect(dateBtn).toBeVisible({ timeout: 5000 });
  await dateBtn.click();

  // Select target slot
  const targetCard = page.locator(`[data-testid="trip-card-${targetSlotUid}"]`).first();
  await expect(targetCard).toBeVisible({ timeout: 5000 });
  await targetCard.click();
  
  // Confirm transfer
  const confirmBtn = page.locator('button:has-text("Перенести"), button:has-text("Подтвердить")').first();
  await expect(confirmBtn).toBeVisible({ timeout: 5000 });
  await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
  await confirmBtn.click();
}

/**
 * Get seats left count from trip card
 */
export async function getSeatsLeft(page, slotUid) {
  const tripCard = page.getByTestId(`trip-card-${slotUid}`);
  const seatsText = await tripCard.locator('text=/Свободно: \\d+/').first().textContent();
  const match = seatsText.match(/Свободно: (\d+)/);
  return match ? parseInt(match[1]) : 0;
}
