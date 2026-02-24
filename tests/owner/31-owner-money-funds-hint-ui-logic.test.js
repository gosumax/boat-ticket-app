import { describe, it, expect } from 'vitest';
import {
  OWNER_MONEY_FUNDS_CASH_ONLY_HINT_TEXT,
  shouldShowFundsCashOnlyHint,
} from '../../src/utils/ownerMoneyFundsHint.js';

describe('Owner Money: funds hint visibility logic', () => {
  it('shows hint when funds_withhold_card_today = 0 and funds_withhold_total_today > 0', () => {
    expect(
      shouldShowFundsCashOnlyHint({
        fundsWithholdCardToday: 0,
        fundsWithholdTotalToday: 1500,
      }),
    ).toBe(true);
    expect(OWNER_MONEY_FUNDS_CASH_ONLY_HINT_TEXT).toBe(
      'Удержания фондов считаются как кассовое обязательство (наличные). Карта не уменьшается этой метрикой.',
    );
  });

  it('hides hint when card split appears (funds_withhold_card_today > 0)', () => {
    expect(
      shouldShowFundsCashOnlyHint({
        fundsWithholdCardToday: 200,
        fundsWithholdTotalToday: 1500,
      }),
    ).toBe(false);
  });

  it('hides hint when total funds obligations are zero', () => {
    expect(
      shouldShowFundsCashOnlyHint({
        fundsWithholdCardToday: 0,
        fundsWithholdTotalToday: 0,
      }),
    ).toBe(false);
  });
});
