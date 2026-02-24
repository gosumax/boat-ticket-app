export const OWNER_MONEY_MAIN_KPI_TITLE = "Можно вынуть из кассы сегодня";
export const OWNER_MONEY_MAIN_KPI_FORMULA =
  "Нал получено − резерв (нал) − фонды (нал) = можно вынуть";

export function isMainKpiReducedByFunds({
  ownerAvailableCashAfterReserve,
  fundsWithholdCashToday,
  cashTakeawayAfterReserveAndFunds,
}) {
  const afterReserve = Number(ownerAvailableCashAfterReserve || 0);
  const fundsCash = Number(fundsWithholdCashToday || 0);
  const finalKpi = Number(cashTakeawayAfterReserveAndFunds || 0);
  if (fundsCash <= 0) return true;
  return finalKpi !== afterReserve && finalKpi < afterReserve;
}
