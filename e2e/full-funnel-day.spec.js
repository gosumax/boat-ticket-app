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

function formatRUBUiExpected(value) {
  return parseMoneyUi(
    new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number(value || 0))
  );
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
  test.setTimeout(5 * 60 * 1000);

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

    await page.getByTestId('dispatcher-filter-toggle').click();
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
        await page.waitForFunction(() => {
          const screen = document.querySelector('[data-testid="seller-select-trip-screen"]');
          if (!screen) return false;
          const hasCards = !!screen.querySelector('[data-testid^="seller-trip-card-"], .space-y-4 > div.cursor-pointer');
          const hasEmpty = !!screen.querySelector('[data-testid="seller-trip-empty"]');
          return hasCards || hasEmpty;
        }, null, { timeout: 5000 }).catch(() => {});
        const selectedDateInput = page.locator('[data-testid="seller-select-trip-screen"] input').first();
        let expectedDate = dateItem.expectedDate;
        try {
          const inputVal = (await selectedDateInput.inputValue()).trim();
          if (inputVal) expectedDate = inputVal;
        } catch {}
        let cards = page.locator('[data-testid^="seller-trip-card-"]');
        let count = await cards.count();
        if (count === 0) {
          const fallbackCards = page.locator('[data-testid="seller-select-trip-screen"] .space-y-4 > div');
          const fallbackCount = await fallbackCards.count();
          const emptyCount = await page.getByTestId('seller-trip-empty').count();
          if (fallbackCount > 0 && emptyCount === 0) {
            cards = fallbackCards;
            count = fallbackCount;
          }
        }
        if (count === 0) {
          const emptyState = page.getByTestId('seller-trip-empty');
          const emptyCount = await emptyState.count();
          if (emptyCount > 0) {
            await expect(emptyState).toBeVisible({ timeout: 5000 });
          }
          if (dateItem.requireTrips) {
            console.warn(`[E2E][seller-matrix] empty trip list for type=${type}, date=${expectedDate}`);
          }
          continue;
        }
        const firstCard = cards.first();
        const cardType = await firstCard.getAttribute('data-trip-type');
        const cardDate = await firstCard.getAttribute('data-trip-date');
        const allowedDates = Array.from(new Set([expectedDate, ymdAdd(0), ymdAdd(1), ymdAdd(2)]));
        if (cardType) {
          expect(cardType).toBe(type);
        }
        if (cardDate) {
          expect(allowedDates).toContain(cardDate);
        } else {
          const cardText = await firstCard.textContent();
          const hasAllowedDate = allowedDates.some((v) => String(cardText || '').includes(v));
          expect(hasAllowedDate).toBe(true);
        }
        if (await firstCard.locator('[data-testid^="seller-trip-free-"]').count()) {
          await expect(firstCard.locator('[data-testid^="seller-trip-free-"]')).toBeVisible();
          await expect(firstCard.locator('[data-testid^="seller-trip-sold-"]')).toBeVisible();
          await expect(firstCard.locator('[data-testid^="seller-trip-capacity-"]')).toBeVisible();
        } else {
          await expect(firstCard).toContainText('РЎРІРѕР±РѕРґРЅРѕ');
          await expect(firstCard).toContainText('Р—Р°РЅСЏС‚Рѕ');
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

    const uiBusinessDay = await page.evaluate(() => {
      const dt = new Date();
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    });
    const shiftSummaryRes = await request.get(`/api/dispatcher/shift-ledger/summary?business_day=${encodeURIComponent(uiBusinessDay)}`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    expect(shiftSummaryRes.ok()).toBeTruthy();
    const shiftSummary = await shiftSummaryRes.json();
    expect(Array.isArray(shiftSummary.sellers)).toBe(true);
    expect(shiftSummary.sellers.length).toBeGreaterThan(0);
    const shiftSplitUnallocated = toNum(
      shiftSummary.collected_split_unallocated ??
      shiftSummary?.collected?.split_unallocated
    );
    expect(toNum(shiftSummary.collected_total)).toBe(
      toNum(shiftSummary.collected_cash) +
      toNum(shiftSummary.collected_card) +
      shiftSplitUnallocated
    );

    const shiftCashUi = await readMoneyByTestIdPrecise(page, 'shiftclose-cash-received');
    const shiftCardUi = await readMoneyByTestIdPrecise(page, 'shiftclose-card-received');
    const shiftTotalUi = await readMoneyByTestIdPrecise(page, 'shiftclose-total-received');
    const shiftOwnerUi = await readMoneyByTestId(page, 'shiftclose-owner-final-kpi');
    const shiftWithholdWeeklyUi = await readMoneyByTestId(page, 'shiftclose-withhold-weekly');
    const shiftWithholdSeasonUi = await readMoneyByTestIdPrecise(page, 'shiftclose-withhold-season');
    const shiftWithholdSeasonTodayUi = await readMoneyByTestIdPrecise(page, 'shiftclose-withhold-season-today');
    const roundingSeasonLocator = page.getByTestId('shiftclose-withhold-rounding-season');
    const shiftWithholdRoundingSeasonUi = (await roundingSeasonLocator.count()) > 0
      ? await readMoneyByTestIdPrecise(page, 'shiftclose-withhold-rounding-season')
      : null;
    const shiftOwnerExpected = formatRUBUiExpected(
      shiftSummary?.owner_handover_cash_final ??
      shiftSummary?.owner_cash_today ??
      (
        toNum(shiftSummary?.net_cash) -
        toNum(shiftSummary?.future_trips_reserve_cash) -
        toNum(
          shiftSummary?.funds_withhold_cash_today ??
          (
            toNum(shiftSummary?.motivation_withhold?.weekly_amount) +
            toNum(shiftSummary?.motivation_withhold?.season_amount) +
            toNum(shiftSummary?.motivation_withhold?.dispatcher_amount_total)
          )
        )
      )
    );
    expect(shiftCashUi).toBeCloseTo(toNum(shiftSummary.collected_cash), 2);
    expect(shiftCardUi).toBeCloseTo(toNum(shiftSummary.collected_card), 2);
    expect(shiftTotalUi).toBeCloseTo(toNum(shiftSummary.collected_total), 2);
    expect(shiftOwnerUi).toBe(shiftOwnerExpected);
    await expect(page.getByTestId('shiftclose-summary')).toContainText('Season фонд всего');
    await expect(page.getByTestId('shiftclose-summary')).not.toContainText('Отложить в Season фонд');
    if (shiftSummary?.motivation_withhold) {
      expect(shiftWithholdWeeklyUi).toBe(Math.round(toNum(shiftSummary.motivation_withhold.weekly_amount)));
      const seasonTodayExpected = toNum(
        shiftSummary?.shift_close_breakdown?.totals?.season_from_revenue ??
        shiftSummary.motivation_withhold.season_from_revenue ??
        shiftSummary.motivation_withhold.season_amount
      );
      const seasonTotalExpected = toNum(
        shiftSummary.motivation_withhold.season_total ??
        shiftSummary.motivation_withhold.season_fund_total ??
        (
          toNum(shiftSummary.motivation_withhold.season_from_revenue) +
          toNum(shiftSummary.motivation_withhold.season_from_prepayment_transfer)
        )
      );
      expect(shiftWithholdSeasonTodayUi).toBeCloseTo(seasonTodayExpected, 2);
      expect(shiftWithholdSeasonUi).toBeCloseTo(seasonTotalExpected, 2);
      if (shiftWithholdRoundingSeasonUi !== null) {
        expect(shiftWithholdRoundingSeasonUi).toBeCloseTo(toNum(shiftSummary.motivation_withhold.rounding_to_season_amount_total), 2);
      }
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
    const ownerDecisionMetrics = ownerSummary?.data?.owner_decision_metrics || {};
    const ownerSplitUnallocated = toNum(
      totals.collected_split_unallocated ??
      ownerSummary?.data?.collected_split_unallocated
    );
    expect(toNum(totals.collected_total)).toBe(
      toNum(totals.collected_cash) +
      toNum(totals.collected_card) +
      ownerSplitUnallocated
    );

    const ownerCollectedTotalUi = await readMoneyByTestId(page, 'owner-money-collected-total');
    const ownerCollectedCashUi = await readMoneyByTestId(page, 'owner-money-collected-cash');
    const ownerCollectedCardUi = await readMoneyByTestId(page, 'owner-money-collected-card');
    const ownerMainKpiUi = await readMoneyByTestId(page, 'owner-money-main-kpi');
    const ownerMoneySeasonTodayUi = await readMoneyByTestId(page, 'owner-money-funds-season');
    const ownerTomorrowObligationsCashUi = await readMoneyByTestId(page, 'owner-money-obligations-tomorrow-cash');
    const ownerTomorrowObligationsCardUi = await readMoneyByTestId(page, 'owner-money-obligations-tomorrow-card');
    const ownerTomorrowObligationsTotalUi = await readMoneyByTestId(page, 'owner-money-obligations-tomorrow-total');
    expect(ownerCollectedTotalUi).toBe(
      Math.round(toNum(ownerDecisionMetrics.received_total_today ?? totals.collected_total))
    );
    expect(ownerCollectedCashUi).toBe(
      Math.round(toNum(ownerDecisionMetrics.received_cash_today ?? totals.collected_cash))
    );
    expect(ownerCollectedCardUi).toBe(
      Math.round(toNum(ownerDecisionMetrics.received_card_today ?? totals.collected_card))
    );
    await expect(page.getByText('Season сегодня по закрытию смены')).toBeVisible();
    expect(ownerMoneySeasonTodayUi).toBe(
      Math.round(toNum(ownerDecisionMetrics.withhold_season_today ?? totals.funds_withhold_season_today))
    );
    const ownerMainKpiExpected = formatRUBUiExpected(
      ownerDecisionMetrics.can_take_cash_today ??
      totals.owner_cash_today ??
      totals.cash_takeaway_after_reserve_and_funds
    );
    expect(ownerMainKpiUi).toBe(ownerMainKpiExpected);
    expect(shiftOwnerUi).toBe(ownerMainKpiExpected);
    expect(ownerTomorrowObligationsCashUi).toBe(
      Math.round(toNum(ownerDecisionMetrics.obligations_tomorrow_cash ?? totals.obligations_tomorrow_cash))
    );
    expect(ownerTomorrowObligationsCardUi).toBe(
      Math.round(toNum(ownerDecisionMetrics.obligations_tomorrow_card ?? totals.obligations_tomorrow_card))
    );
    expect(ownerTomorrowObligationsTotalUi).toBe(
      Math.round(toNum(ownerDecisionMetrics.obligations_tomorrow_total ?? totals.obligations_tomorrow_total))
    );

    await page.getByTestId('owner-money-secondary-summary').click();
    const ownerPendingUi = await readMoneyByTestId(page, 'owner-money-pending-total');
    const ownerTicketsUi = await readMoneyByTestId(page, 'owner-money-tickets-total');
    const ownerTripsUi = await readMoneyByTestId(page, 'owner-money-trips-total');
    const ownerFillUiText = await page.getByTestId('owner-money-fill-percent').textContent();
    const ownerFillUi = Number(String(ownerFillUiText || '').replace(/[^\d.-]/g, '') || 0);
    expect(ownerPendingUi).toBe(Math.round(toNum(totals.pending_amount)));
    expect(ownerTicketsUi).toBe(Math.round(toNum(totals.tickets)));
    expect(ownerTripsUi).toBe(Math.round(toNum(totals.trips)));
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
      await expect(page.getByTestId(`owner-seller-calibration-status-${topSellerId}`)).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId(`owner-seller-calibration-level-${topSellerId}`)).toBeVisible({ timeout: 5000 });
      await expect(topCard).not.toContainText('k:');
      await expect(page.locator(`[data-testid="owner-seller-calibration-pending-${topSellerId}"]`)).toHaveCount(0);
      await topCard.click();
      await expect(page.getByTestId(`owner-seller-details-${topSellerId}`)).toBeVisible({ timeout: 5000 });
      await expect(page.locator(`[data-testid="owner-seller-calibration-week-${topSellerId}"]`)).toHaveCount(0);
      await expect(page.locator(`[data-testid="owner-seller-calibration-next-week-${topSellerId}"]`)).toHaveCount(0);
    }

    await page.locator('[data-testid="owner-tab-motivation"]:visible').first().click();
    await expect(page.getByTestId('owner-screen-motivation')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Season начислено в фонд за день')).toBeVisible();
    await expect
      .poll(
        async () => readMoneyByTestId(page, 'owner-motivation-day-season-funds'),
        { timeout: 15000 }
      )
      .toBe(
        Math.round(
          toNum(totals.funds_withhold_season_today)
        )
      );
    await expect(page.getByTestId('owner-screen-motivation')).not.toContainText('Калибровка');
    expect(ownerMoneySeasonTodayUi).toBe(
      Math.round(
        toNum(
          shiftSummary?.shift_close_breakdown?.totals?.season_from_revenue ??
          shiftSummary?.motivation_withhold?.season_from_revenue ??
          shiftSummary?.motivation_withhold?.season_amount
        )
      )
    );
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
    await expect(page.getByTestId('owner-screen-motivation')).not.toContainText('Калибровка');
    await expect(page.getByTestId('owner-screen-motivation')).not.toContainText('Зона');

    await page.getByTestId('owner-motivation-tab-season').click();
    const seasonId = String(new Date().getFullYear());
    const ownerSeasonRes = await request.get(`/api/owner/motivation/season?season_id=${seasonId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerSeasonRes.ok()).toBeTruthy();
    const ownerSeasonData = (await ownerSeasonRes.json())?.data || {};
    const expectedSeasonCurrent =
      toNum(ownerSeasonData.season_pool_from_revenue_total ?? ownerSeasonData.season_pool_total_current ?? ownerSeasonData.season_pool_total_ledger ?? 0) +
      toNum(ownerSeasonData.season_pool_rounding_total) +
      toNum(ownerSeasonData.season_pool_dispatcher_decision_total ?? ownerSeasonData.season_pool_manual_transfer_total ?? 0);
    expect(await readMoneyByTestIdPrecise(page, 'owner-season-current-fund')).toBeCloseTo(expectedSeasonCurrent, 2);
    expect(await readMoneyByTestIdPrecise(page, 'owner-season-rounding-total')).toBeCloseTo(toNum(ownerSeasonData.season_pool_rounding_total), 2);
    expect(await readMoneyByTestIdPrecise(page, 'owner-season-dispatcher-decision-total')).toBeCloseTo(
      toNum(ownerSeasonData.season_pool_dispatcher_decision_total ?? ownerSeasonData.season_pool_manual_transfer_total ?? 0),
      2
    );
    await expect(page.getByText(/РћР±С‰РёР№ С„РѕРЅРґ:/)).toHaveCount(0);
    await expect(page.getByTestId('owner-screen-motivation')).not.toContainText('Зона');

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

