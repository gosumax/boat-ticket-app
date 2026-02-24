export const OWNER_MONEY_FUNDS_CASH_ONLY_HINT_TEXT =
  "Удержания фондов считаются как кассовое обязательство (наличные). Карта не уменьшается этой метрикой.";

export function shouldShowFundsCashOnlyHint({ fundsWithholdCardToday, fundsWithholdTotalToday }) {
  const card = Number(fundsWithholdCardToday || 0);
  const total = Number(fundsWithholdTotalToday || 0);
  return card === 0 && total > 0;
}
