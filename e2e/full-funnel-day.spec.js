import { test, expect } from '@playwright/test';
import { login } from './helpers/auth.js';
import { openFirstTrip, createPresaleUI } from './helpers/dispatcher.js';

const E2E_DISPATCHER_USERNAME = process.env.E2E_DISPATCHER_USERNAME || 'dispatcher';
const E2E_DISPATCHER_PASSWORD = process.env.E2E_DISPATCHER_PASSWORD || '123456';
const E2E_SELLER_USERNAME = process.env.E2E_SELLER_USERNAME || 'seller';
const E2E_SELLER_PASSWORD = process.env.E2E_SELLER_PASSWORD || '123456';
const E2E_OWNER_USERNAME = process.env.E2E_OWNER_USERNAME || 'owner';
const E2E_OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'owner123';

const E2E_TARGET_DATE = process.env.E2E_TARGET_DATE || (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
})();

function toNum(v) {
  return Number(v || 0);
}

function ymdAdd(days = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getCurrentISOWeek() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const thursday = new Date(now);
  thursday.setDate(now.getDate() + (4 - dow));
  const isoYear = thursday.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const jan4Dow = jan4.getDay() === 0 ? 7 : jan4.getDay();
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - (jan4Dow - 1));
  week1Monday.setHours(0, 0, 0, 0);
  const weekNum = 1 + Math.floor((thursday.getTime() - week1Monday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

function parseMoneyUiPrecise(value) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/\u00A0/g, '')
    .replace(/[^\d,.-]/g, '')
    .replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function parseMoneyUi(value) {
  return Math.round(parseMoneyUiPrecise(value));
}

async function readMoneyByTestId(page, testId) {
  const text = await page.getByTestId(testId).textContent();
  return parseMoneyUi(text);
}

async function readMoneyByTestIdPrecise(page, testId) {
  const text = await page.getByTestId(testId).textContent();
  return parseMoneyUiPrecise(text);
}

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
  for (let i = 0; i < 15; i += 1) {
    const list = await fetchPresales(request, token);
    const found = list.find((p) => Number(p?.id || 0) > Number(previousMaxId || 0));
    if (found?.id) return found;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`New presale not found after id=${previousMaxId}`);
}

async function acceptPaymentViaApi(request, token, presaleId, payload) {
  const res = await request.patch(`/api/selling/presales/${presaleId}/accept-payment`, {
    headers: { Authorization: `Bearer ${token}` },
    data: payload,
  });
  expect(res.ok()).toBeTruthy();
}

async function createPresaleViaApi(request, token, payload) {
  const res = await request.post('/api/selling/presales', {
    headers: { Authorization: `Bearer ${token}` },
    data: payload,
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(Number(body?.presale?.id || 0)).toBeGreaterThan(0);
  return body.presale;
}

async function logoutToLogin(page) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
  await expect(page.getByTestId('login-submit')).toBeVisible({ timeout: 10000 });
}

test.describe('E2E Full Funnel Day', () => {
  test('seller / dispatcher / owner pages stay consistent through full sales funnel', async ({ page, request }) => {
    test.setTimeout(180000);

    const phoneDispatcherSelf = '+79991110001';
    const phoneDispatcherSeller = '+79991110002';
    const phoneSellerUi = '+79991110003';

    await page.context().clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/');
    await login(page, E2E_DISPATCHER_USERNAME, E2E_DISPATCHER_PASSWORD);

    await expect(page.getByTestId('tab-selling')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('tab-selling').click();
    const dispatcherToken = await getTokenFromStorage(page);
    expect(dispatcherToken).toBeTruthy();

    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill(E2E_TARGET_DATE);
    await dateInputs.nth(1).fill(E2E_TARGET_DATE);

    await openFirstTrip(page);
    const presalesBefore = await fetchPresales(request, dispatcherToken);
    const maxBefore = getMaxPresaleId(presalesBefore);

    // Dispatcher creates presale without seller (with prepay CASH).
    await createPresaleUI(page, {
      adult: 1,
      teen: 0,
      child: 0,
      namePreset: 'Maria',
      phone: phoneDispatcherSelf,
      prepayPreset: 1000,
      paymentMethod: 'cash',
    });
    const dispatcherSelfPresale = await waitNewPresaleAfterId(request, dispatcherToken, maxBefore);

    // Dispatcher creates presale on behalf of seller (with prepay CARD).
    const maxAfterSelf = getMaxPresaleId(await fetchPresales(request, dispatcherToken));
    await createPresaleUI(page, {
      adult: 1,
      teen: 0,
      child: 0,
      namePreset: 'Alexey',
      phone: phoneDispatcherSeller,
      sellerId: 'first',
      prepayPreset: 1000,
      paymentMethod: 'card',
    });
    const dispatcherSellerPresale = await waitNewPresaleAfterId(request, dispatcherToken, maxAfterSelf);

    // Seller login and create presale (seller token context).
    await logoutToLogin(page);
    await login(page, E2E_SELLER_USERNAME, E2E_SELLER_PASSWORD);
    const sellerToken = await getTokenFromStorage(page);
    expect(sellerToken).toBeTruthy();

    // Seller UI: type/date matrix (speed/cruise/banana x today/tomorrow/day+2).
    await page.goto('/seller');
    await expect(page.getByTestId('seller-select-type-screen')).toBeVisible({ timeout: 10000 });

    const dateMatrix = [
      { btn: 'seller-trip-date-today', expectedDate: ymdAdd(0), requireTrips: false },
      { btn: 'seller-trip-date-tomorrow', expectedDate: ymdAdd(1), requireTrips: true },
      { btn: 'seller-trip-date-day2', expectedDate: ymdAdd(2), requireTrips: true },
    ];
    const typeMatrix = ['speed', 'cruise', 'banana'];

    for (const type of typeMatrix) {
      await page.getByTestId(`seller-type-${type}`).click();
      await expect(page.getByTestId('seller-select-trip-screen')).toBeVisible({ timeout: 10000 });
      for (const dateItem of dateMatrix) {
        await page.getByTestId(dateItem.btn).click();
        await page.waitForFunction(() => !document.querySelector('[data-testid="seller-trip-loading"]'), null, { timeout: 10000 });
        let cards = page.locator('[data-testid^="seller-trip-card-"]');
        let count = await cards.count();
        if (count === 0) {
          const fallbackCards = page.locator('[data-testid="seller-select-trip-screen"] .space-y-4 > div.cursor-pointer');
          const fallbackCount = await fallbackCards.count();
          if (fallbackCount > 0) {
            cards = fallbackCards;
            count = fallbackCount;
          }
        }
        if (count === 0) {
          await expect(page.getByTestId('seller-trip-empty')).toBeVisible({ timeout: 5000 });
          if (dateItem.requireTrips) {
            throw new Error(`Expected seller trips for type=${type} date=${dateItem.expectedDate}, got empty list`);
          }
          continue;
        }
        const firstCard = cards.first();
        const cardType = await firstCard.getAttribute('data-trip-type');
        const cardDate = await firstCard.getAttribute('data-trip-date');
        if (cardType) {
          expect(cardType).toBe(type);
        }
        if (cardDate) {
          expect(cardDate).toBe(dateItem.expectedDate);
        } else {
          await expect(firstCard).toContainText(dateItem.expectedDate);
        }
        if (await firstCard.locator('[data-testid^="seller-trip-free-"]').count()) {
          await expect(firstCard.locator('[data-testid^="seller-trip-free-"]')).toBeVisible();
          await expect(firstCard.locator('[data-testid^="seller-trip-sold-"]')).toBeVisible();
          await expect(firstCard.locator('[data-testid^="seller-trip-capacity-"]')).toBeVisible();
        } else {
          await expect(firstCard).toContainText('Свободно');
          await expect(firstCard).toContainText('Занято');
        }
      }
      await page.getByTestId('seller-trip-back').click();
      await expect(page.getByTestId('seller-select-type-screen')).toBeVisible({ timeout: 5000 });
    }

    const sellerUiPresale = await createPresaleViaApi(request, sellerToken, {
      slotUid: dispatcherSelfPresale.slot_uid,
      tripDate: E2E_TARGET_DATE,
      customerName: 'Seller Funnel',
      customerPhone: phoneSellerUi,
      numberOfSeats: 1,
      prepaymentAmount: 500,
      payment_method: 'CASH',
    });

    // Dispatcher accepts payments: CASH / CARD / MIXED.
    await logoutToLogin(page);
    await login(page, E2E_DISPATCHER_USERNAME, E2E_DISPATCHER_PASSWORD);

    await acceptPaymentViaApi(request, dispatcherToken, dispatcherSelfPresale.id, {
      payment_method: 'CASH',
    });

    await acceptPaymentViaApi(request, dispatcherToken, dispatcherSellerPresale.id, {
      payment_method: 'CARD',
    });

    const sellerListAfter = await fetchPresales(request, dispatcherToken);
    const sellerPresaleFresh = sellerListAfter.find((p) => Number(p.id) === Number(sellerUiPresale.id));
    expect(sellerPresaleFresh).toBeDefined();
    const remaining = Math.max(0, toNum(sellerPresaleFresh.total_price) - toNum(sellerPresaleFresh.prepayment_amount));
    const mixedCash = Math.max(1, Math.floor(remaining / 2));
    const mixedCard = Math.max(1, remaining - mixedCash);

    await acceptPaymentViaApi(request, dispatcherToken, sellerUiPresale.id, {
      payment_method: 'MIXED',
      cash_amount: mixedCash,
      card_amount: mixedCard,
    });

    // Dispatcher shift-close page: sellers section and owner amount are visible and not empty.
    await page.getByTestId('tab-shiftClose').click();
    await expect(page.getByTestId('shiftclose-summary')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('shiftclose-sellers-section')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('shiftclose-sellers-empty')).toHaveCount(0);

    const shiftSummaryRes = await request.get('/api/dispatcher/shift-ledger/summary', {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    expect(shiftSummaryRes.ok()).toBeTruthy();
    const shiftSummary = await shiftSummaryRes.json();
    expect(Array.isArray(shiftSummary.sellers)).toBe(true);
    expect(shiftSummary.sellers.length).toBeGreaterThan(0);
    expect(toNum(shiftSummary.collected_total)).toBe(
      toNum(shiftSummary.collected_cash) + toNum(shiftSummary.collected_card)
    );

    const shiftCashUi = await readMoneyByTestId(page, 'shiftclose-cash-received');
    const shiftCardUi = await readMoneyByTestId(page, 'shiftclose-card-received');
    const shiftTotalUi = await readMoneyByTestId(page, 'shiftclose-total-received');
    const shiftOwnerUi = await readMoneyByTestId(page, 'shiftclose-owner-final-kpi');
    const shiftWithholdWeeklyUi = await readMoneyByTestIdPrecise(page, 'shiftclose-withhold-weekly');
    const shiftWithholdSeasonUi = await readMoneyByTestIdPrecise(page, 'shiftclose-withhold-season');
    const shiftWithholdRoundingSeasonUi = await readMoneyByTestIdPrecise(page, 'shiftclose-withhold-rounding-season');
    const shiftFundsCash = toNum(
      shiftSummary?.funds_withhold_cash_today ??
      (
        toNum(shiftSummary?.motivation_withhold?.weekly_amount) +
        toNum(shiftSummary?.motivation_withhold?.season_amount) +
        toNum(shiftSummary?.motivation_withhold?.dispatcher_amount_total)
      )
    );
    const shiftOwnerExpected = Math.round(
      toNum(shiftSummary?.net_cash) -
      toNum(shiftSummary?.future_trips_reserve_cash) -
      shiftFundsCash
    );
    expect(shiftCashUi).toBe(Math.round(toNum(shiftSummary.collected_cash)));
    expect(shiftCardUi).toBe(Math.round(toNum(shiftSummary.collected_card)));
    expect(shiftTotalUi).toBe(Math.round(toNum(shiftSummary.collected_total)));
    expect(shiftOwnerUi).toBe(shiftOwnerExpected);
    if (shiftSummary?.motivation_withhold) {
      expect(shiftWithholdWeeklyUi).toBeCloseTo(toNum(shiftSummary.motivation_withhold.weekly_amount), 2);
      expect(shiftWithholdSeasonUi).toBeCloseTo(toNum(shiftSummary.motivation_withhold.season_amount), 2);
      expect(shiftWithholdRoundingSeasonUi).toBeCloseTo(toNum(shiftSummary.motivation_withhold.rounding_to_season_amount_total), 2);
    }

    // Owner dashboard view.
    await logoutToLogin(page);
    await login(page, E2E_OWNER_USERNAME, E2E_OWNER_PASSWORD);
    await expect(page).toHaveURL(/\/owner/, { timeout: 10000 });
    await expect(page.getByTestId('owner-screen-money')).toBeVisible({ timeout: 15000 });

    const ownerToken = await getTokenFromStorage(page);
    expect(ownerToken).toBeTruthy();
    const ownerSummaryRes = await request.get('/api/owner/money/summary?preset=today', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerSummaryRes.ok()).toBeTruthy();
    const ownerSummary = await ownerSummaryRes.json();
    const totals = ownerSummary?.data?.totals || {};
    expect(toNum(totals.collected_total)).toBe(
      toNum(totals.collected_cash) + toNum(totals.collected_card)
    );

    const ownerCollectedTotalUi = await readMoneyByTestId(page, 'owner-money-collected-total');
    const ownerCollectedCashUi = await readMoneyByTestId(page, 'owner-money-collected-cash');
    const ownerCollectedCardUi = await readMoneyByTestId(page, 'owner-money-collected-card');
    const ownerPendingUi = await readMoneyByTestId(page, 'owner-money-pending-total');
    const ownerTicketsUi = await readMoneyByTestId(page, 'owner-money-tickets-total');
    const ownerTripsUi = await readMoneyByTestId(page, 'owner-money-trips-total');
    const ownerMainKpiUi = await readMoneyByTestId(page, 'owner-money-main-kpi');
    const ownerFillUiText = await page.getByTestId('owner-money-fill-percent').textContent();
    const ownerFillUi = Number(String(ownerFillUiText || '').replace(/[^\d.-]/g, '') || 0);
    expect(ownerCollectedTotalUi).toBe(Math.round(toNum(totals.collected_total)));
    expect(ownerCollectedCashUi).toBe(Math.round(toNum(totals.collected_cash)));
    expect(ownerCollectedCardUi).toBe(Math.round(toNum(totals.collected_card)));
    expect(ownerPendingUi).toBe(Math.round(toNum(totals.pending_amount)));
    expect(ownerTicketsUi).toBe(Math.round(toNum(totals.tickets)));
    expect(ownerTripsUi).toBe(Math.round(toNum(totals.trips)));
    expect(ownerMainKpiUi).toBe(Math.round(toNum(totals.cash_takeaway_after_reserve_and_funds)));
    expect(shiftOwnerUi).toBe(ownerMainKpiUi);
    expect(ownerFillUi).toBe(Math.round(toNum(totals.fillPercent || 0)));

    await page.locator('[data-testid="owner-tab-boats"]:visible').first().click();
    await expect(page.getByTestId('owner-screen-boats')).toBeVisible({ timeout: 10000 });
    const ownerBoatsRes = await request.get('/api/owner/boats?preset=today', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerBoatsRes.ok()).toBeTruthy();
    const ownerBoatsData = (await ownerBoatsRes.json())?.data || {};
    expect(await readMoneyByTestId(page, 'owner-boats-total-revenue')).toBe(Math.round(toNum(ownerBoatsData?.totals?.revenue)));
    expect(await readMoneyByTestId(page, 'owner-boats-total-tickets')).toBe(Math.round(toNum(ownerBoatsData?.totals?.tickets)));
    expect(await readMoneyByTestId(page, 'owner-boats-total-trips')).toBe(Math.round(toNum(ownerBoatsData?.totals?.trips)));
    const boatsFillUiText = await page.getByTestId('owner-boats-total-fill').textContent();
    const boatsFillUi = Number(String(boatsFillUiText || '').replace(/[^\d.-]/g, '') || 0);
    expect(boatsFillUi).toBe(Math.round(toNum(ownerBoatsData?.totals?.fillPercent || 0)));

    await page.locator('[data-testid="owner-tab-sellers"]:visible').first().click();
    await expect(page.getByTestId('owner-screen-sellers')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('owner-sellers-total-forecast')).toBeVisible({ timeout: 10000 });
    const ownerSellersRes = await request.get('/api/owner/sellers?preset=today', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerSellersRes.ok()).toBeTruthy();
    const ownerSellersData = (await ownerSellersRes.json())?.data || {};
    const topSeller = Array.isArray(ownerSellersData.items) ? ownerSellersData.items[0] : null;
    if (topSeller?.seller_id) {
      const topSellerId = Number(topSeller.seller_id);
      const topCard = page.getByTestId(`owner-seller-card-${topSellerId}`);
      await expect(topCard).toBeVisible({ timeout: 10000 });
      expect(await readMoneyByTestId(page, `owner-seller-paid-${topSellerId}`)).toBe(Math.round(toNum(topSeller.revenue_paid)));
      expect(await readMoneyByTestId(page, `owner-seller-pending-${topSellerId}`)).toBe(Math.round(toNum(topSeller.revenue_pending)));
      await topCard.click();
      await expect(page.getByTestId(`owner-seller-details-${topSellerId}`)).toBeVisible({ timeout: 5000 });
    }

    await page.locator('[data-testid="owner-tab-motivation"]:visible').first().click();
    await expect(page.getByTestId('owner-screen-motivation')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('owner-motivation-tab-week').click();
    const weekKey = getCurrentISOWeek();
    const ownerWeeklyRes = await request.get(`/api/owner/motivation/weekly?week=${encodeURIComponent(weekKey)}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerWeeklyRes.ok()).toBeTruthy();
    const ownerWeeklyData = (await ownerWeeklyRes.json())?.data || {};
    expect(await readMoneyByTestId(page, 'owner-weekly-current-fund')).toBe(Math.round(toNum(ownerWeeklyData.weekly_pool_total_current)));
    expect(await readMoneyByTestId(page, 'owner-weekly-top3-split-first')).toBe(Math.round(toNum(ownerWeeklyData.weekly_pool_total_current) * 0.5));
    expect(await readMoneyByTestId(page, 'owner-weekly-top3-split-second')).toBe(Math.round(toNum(ownerWeeklyData.weekly_pool_total_current) * 0.3));
    expect(await readMoneyByTestId(page, 'owner-weekly-top3-split-third')).toBe(Math.round(toNum(ownerWeeklyData.weekly_pool_total_current) * 0.2));

    await page.getByTestId('owner-motivation-tab-season').click();
    const seasonId = String(new Date().getFullYear());
    const ownerSeasonRes = await request.get(`/api/owner/motivation/season?season_id=${seasonId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerSeasonRes.ok()).toBeTruthy();
    const ownerSeasonData = (await ownerSeasonRes.json())?.data || {};
    const expectedSeasonCurrent = toNum(ownerSeasonData.season_pool_total_current || ownerSeasonData.season_pool_total_ledger);
    expect(await readMoneyByTestIdPrecise(page, 'owner-season-current-fund')).toBeCloseTo(expectedSeasonCurrent, 2);
    expect(await readMoneyByTestIdPrecise(page, 'owner-season-rounding-total')).toBeCloseTo(toNum(ownerSeasonData.season_pool_rounding_total), 2);

    // Seller personal sales view is accessible after funnel operations.
    await logoutToLogin(page);
    await login(page, E2E_SELLER_USERNAME, E2E_SELLER_PASSWORD);
    const sellerHome = page.getByTestId('seller-home-screen');
    if (await sellerHome.isVisible().catch(() => false)) {
      await page.getByTestId('seller-home-earnings-btn').click();
    } else {
      await page.goto('/seller/earnings');
    }
    await expect(page).toHaveURL(/\/seller\/earnings/, { timeout: 10000 });
    await expect(page.getByTestId('seller-earnings-screen')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('seller-earnings-title')).toBeVisible({ timeout: 10000 });
  });
});
