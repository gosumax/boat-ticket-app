// e2e/helpers/auth.js
/**
 * Login helper for E2E tests
 */
export async function login(page, username, password) {
  await page.goto('/login');
  await page.fill('[data-testid="login-username"]', username);
  await page.fill('[data-testid="login-password"]', password);
  await page.click('[data-testid="login-submit"]');
  
  // Check if login error appeared
  const errorLocator = page.locator('text=/Неверное имя пользователя или пароль|Ошибка входа/i');
  const hasError = await errorLocator.isVisible({ timeout: 2000 }).catch(() => false);
  
  if (hasError) {
    const errorText = await errorLocator.textContent();
    throw new Error(`Login failed: ${errorText}. Check credentials: username="${username}", password="${password}"`);
  }
  
  // Wait for navigation to complete
  await page.waitForURL(/\/(seller|dispatcher|owner|admin)/, { timeout: 10000 });
  await page.waitForLoadState('networkidle');
}

/**
 * Logout helper
 */
export async function logout(page) {
  // Find and click logout button (adjust selector based on actual UI)
  const logoutBtn = page.locator('button:has-text("Выход"), button:has-text("Выйти")').first();
  if (await logoutBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await logoutBtn.click();
    await page.waitForURL('/login');
  }
}
