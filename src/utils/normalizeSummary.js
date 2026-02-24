/**
 * normalizeSummary.js
 * Normalizes dispatcher shift-ledger summary data from backend
 * Handles both snake_case and camelCase field names for robustness
 */

/**
 * Normalize a single seller object
 * @param {Object} s - Raw seller data from backend
 * @returns {Object} Normalized seller with consistent field names
 */
export function normalizeSeller(s) {
  if (!s) return null;
  
  const seller_id = s.seller_id ?? s.sellerId ?? s.id ?? 0;
  const seller_name = s.seller_name ?? s.sellerName ?? s.name ?? `Продавец #${seller_id}`;
  
  // Collected amounts
  const collected_total = s.collected_total ?? s.collectedTotal ?? s.accepted ?? 0;
  const collected_cash = s.collected_cash ?? s.collectedCash ?? s.accepted_cash ?? s.cashSales ?? 0;
  const collected_card = s.collected_card ?? s.collectedCard ?? s.accepted_card ?? s.cardSales ?? 0;
  
  // Deposits (handed to owner)
  const deposit_cash = s.deposit_cash ?? s.depositCash ?? s.deposited_cash ?? s.cashHanded ?? 0;
  const deposit_card = s.deposit_card ?? s.depositCard ?? s.deposited_card ?? s.terminalHanded ?? 0;
  
  // Balance / due
  const cash_due_to_owner = s.cash_due_to_owner ?? s.cashDueToOwner ?? s.cash_balance ?? s.cashBalance ?? s.cashRemaining ?? s.balance ?? 0;
  const terminal_due_to_owner = s.terminal_due_to_owner ?? s.terminalDueToOwner ?? s.terminal_debt ?? s.terminalDebt ?? 0;
  
  // Net
  const net_total = s.net_total ?? s.netTotal ?? cash_due_to_owner;
  
  // Status
  const status = s.status ?? (
    cash_due_to_owner === 0 ? 'CLOSED' : cash_due_to_owner > 0 ? 'DEBT' : 'OVERPAID'
  );
  
  // Salary fields
  const salary_due = s.salary_due ?? s.salaryDue ?? 0;
  const salary_due_total = s.salary_due_total ?? s.salaryDueTotal ?? salary_due;
  const salary_accrued = s.salary_accrued ?? s.salaryAccrued ?? salary_due_total;
  
  return {
    seller_id: Number(seller_id),
    seller_name,
    name: seller_name, // alias for compatibility
    collected_total: Number(collected_total),
    collected_cash: Number(collected_cash),
    collected_card: Number(collected_card),
    deposit_cash: Number(deposit_cash),
    deposit_card: Number(deposit_card),
    cash_due_to_owner: Number(cash_due_to_owner),
    terminal_due_to_owner: Number(terminal_due_to_owner),
    terminal_debt: Number(terminal_due_to_owner), // alias for backward compat
    net_total: Number(net_total),
    balance: Number(cash_due_to_owner),
    cash_balance: Number(cash_due_to_owner),
    status,
    // Salary fields
    salary_due: Number(salary_due),
    salary_due_total: Number(salary_due_total),
    salary_accrued: Number(salary_accrued),
    // Raw fallback values for debugging
    _raw: {
      accepted: s.accepted,
      deposited: s.deposited,
    },
  };
}

/**
 * Normalize dispatcher object
 * @param {Object} d - Raw dispatcher data from backend
 * @returns {Object} Normalized dispatcher with consistent field names
 */
export function normalizeDispatcher(d) {
  if (!d) return {
    collected_total: 0,
    collected_cash: 0,
    collected_card: 0,
    refund_total: 0,
    net_total: 0,
    deposit_cash: 0,
    deposit_card: 0,
    salary_paid_cash: 0,
    salary_paid_card: 0,
    salary_paid_total: 0,
  };
  
  return {
    collected_total: Number(d.collected_total ?? d.collectedTotal ?? 0),
    collected_cash: Number(d.collected_cash ?? d.collectedCash ?? 0),
    collected_card: Number(d.collected_card ?? d.collectedCard ?? 0),
    refund_total: Number(d.refund_total ?? d.refundTotal ?? 0),
    net_total: Number(d.net_total ?? d.netTotal ?? 0),
    deposit_cash: Number(d.deposit_cash ?? d.depositCash ?? 0),
    deposit_card: Number(d.deposit_card ?? d.depositCard ?? 0),
    salary_paid_cash: Number(d.salary_paid_cash ?? d.salaryPaidCash ?? 0),
    salary_paid_card: Number(d.salary_paid_card ?? d.salaryPaidCard ?? 0),
    salary_paid_total: Number(d.salary_paid_total ?? d.salaryPaidTotal ?? 0),
  };
}

/**
 * Normalize summary data from backend
 * Handles both snake_case and camelCase field names
 * @param {Object} data - Raw summary data from backend
 * @returns {Object} Normalized summary with consistent field names
 */
export function normalizeSummary(data) {
  if (!data) return null;
  
  // Meta
  const business_day = data.business_day ?? data.businessDay ?? data.day ?? '';
  const source = data.source ?? data.shiftSource ?? 'ledger';
  const is_closed = Boolean(data.is_closed ?? data.closed ?? data.isClosed ?? false);
  const closed_at = data.closed_at ?? data.closedAt ?? null;
  const closed_by = data.closed_by ?? data.closedBy ?? null;
  
  // Collected money
  const collected_total = data.collected_total ?? data.collectedTotal ?? data.collected?.total ?? 0;
  const collected_cash = data.collected_cash ?? data.collectedCash ?? data.collected?.cash ?? 0;
  const collected_card = data.collected_card ?? data.collectedCard ?? data.collected?.card ?? 0;
  
  // Revenue (alias)
  const total_revenue = data.total_revenue ?? data.totalRevenue ?? data.revenue ?? 0;
  
  // Refunds
  const refund_total = data.refund_total ?? data.refundTotal ?? data.refunds?.total ?? 0;
  const refund_cash = data.refund_cash ?? data.refundCash ?? data.refunds?.cash ?? 0;
  const refund_card = data.refund_card ?? data.refundCard ?? data.refunds?.card ?? 0;
  
  // Net (collected - refunds)
  const net_total = data.net_total ?? data.netTotal ?? data.net?.total ?? 0;
  const net_cash = data.net_cash ?? data.netCash ?? data.net?.cash ?? 0;
  const net_card = data.net_card ?? data.netCard ?? data.net?.card ?? 0;
  
  // Deposits
  const deposit_cash = data.deposit_cash ?? data.depositCash ?? data.ledger?.deposit_to_owner?.cash ?? 0;
  const deposit_card = data.deposit_card ?? data.depositCard ?? data.ledger?.deposit_to_owner?.card ?? 0;
  const deposit_total = data.deposit_total ?? data.depositTotal ?? (Number(deposit_cash) + Number(deposit_card));
  
  // Salary
  const salary_due_total = data.salary_due_total ?? data.salaryDueTotal ?? data.salary_due ?? data.salaryDue ?? 0;
  const salary_paid_cash = data.salary_paid_cash ?? data.salaryPaidCash ?? 0;
  const salary_paid_card = data.salary_paid_card ?? data.salaryPaidCard ?? 0;
  const salary_paid_total = data.salary_paid_total ?? data.salaryPaidTotal ?? 0;
  const sellers_debt_total = data.sellers_debt_total ?? data.sellersDebtTotal ?? null;
  const owner_cash_available = data.owner_cash_available ?? data.ownerCashAvailable ?? null;
  const owner_cash_available_after_future_reserve_cash =
    data.owner_cash_available_after_future_reserve_cash ??
    data.ownerCashAvailableAfterFutureReserveCash ??
    null;
  const owner_cash_available_after_reserve_and_funds =
    data.owner_cash_available_after_reserve_and_funds ??
    data.ownerCashAvailableAfterReserveAndFunds ??
    null;
  const owner_cash_available_after_reserve_and_funds_cash =
    data.owner_cash_available_after_reserve_and_funds_cash ??
    data.ownerCashAvailableAfterReserveAndFundsCash ??
    owner_cash_available_after_reserve_and_funds;
  const funds_withhold_cash_today =
    data.funds_withhold_cash_today ??
    data.fundsWithholdCashToday ??
    null;
  const owner_cash_available_without_future_reserve =
    data.owner_cash_available_without_future_reserve ??
    data.ownerCashAvailableWithoutFutureReserve ??
    owner_cash_available;
  const reserveFromExplainCash = data.explain?.liabilities?.future_trips_reserve_cash ?? data.explain?.liabilities?.prepayment_future_cash;
  const reserveFromExplainCard = data.explain?.liabilities?.future_trips_reserve_terminal ?? data.explain?.liabilities?.prepayment_future_terminal;
  const future_trips_reserve_cash =
    data.future_trips_reserve_cash ??
    data.futureTripsReserveCash ??
    data.reserve_future_trips?.cash ??
    reserveFromExplainCash ??
    0;
  const future_trips_reserve_card =
    data.future_trips_reserve_card ??
    data.futureTripsReserveCard ??
    data.reserve_future_trips?.card ??
    reserveFromExplainCard ??
    0;
  const future_trips_reserve_total =
    data.future_trips_reserve_total ??
    data.futureTripsReserveTotal ??
    data.reserve_future_trips?.total ??
    (Number(future_trips_reserve_cash || 0) + Number(future_trips_reserve_card || 0));
  
  // Trip status
  const all_trips_finished = Boolean(data.all_trips_finished ?? data.allTripsFinished ?? true);
  const open_trips_count = Number(data.open_trips_count ?? data.openTripsCount ?? 0);
  
  // Sellers
  const rawSellers = Array.isArray(data.sellers) ? data.sellers : [];
  const sellers = rawSellers.map(normalizeSeller).filter(Boolean);
  
  // Dispatcher
  const dispatcher = normalizeDispatcher(data.dispatcher);
  
  // Cashbox (server-computed sanity check - source of truth)
  // Can come from: data.cashbox (nested) or top-level fields
  const rawCashbox = data.cashbox ?? {};
  const cash_in_cashbox = data.cash_in_cashbox ?? data.cashInCashbox ?? rawCashbox.cash_in_cashbox ?? null;
  const expected_sellers_cash_due = data.expected_sellers_cash_due ?? data.expectedSellersCashDue ?? rawCashbox.expected_sellers_cash_due ?? null;
  const deposits_cash_total = data.deposits_cash_total ?? data.depositsCashTotal ?? rawCashbox.deposits_cash_total ?? data.deposit_cash ?? 0;
  const salary_paid_cash_cashbox = rawCashbox.salary_paid_cash ?? data.salary_paid_cash ?? 0;
  const cash_discrepancy = data.cash_discrepancy ?? data.cashDiscrepancy ?? rawCashbox.cash_discrepancy ?? null;
  const rawWarnings = data.warnings ?? rawCashbox.warnings ?? [];
  const warnings = Array.isArray(rawWarnings) ? rawWarnings : [];

  // Explain section (human-readable breakdown)
  const explain = data.explain ?? null;

  // Motivation withhold (daily shift-close preview)
  const rawWithhold = data.motivation_withhold ?? data.motivationWithhold ?? null;
  const motivation_withhold = rawWithhold
    ? {
        weekly_amount_raw: Number(rawWithhold.weekly_amount_raw ?? rawWithhold.weeklyAmountRaw ?? 0),
        weekly_amount: Number(rawWithhold.weekly_amount ?? rawWithhold.weeklyAmount ?? 0),
        season_amount: Number(rawWithhold.season_amount ?? rawWithhold.seasonAmount ?? 0),
        season_amount_base: Number(rawWithhold.season_amount_base ?? rawWithhold.seasonAmountBase ?? 0),
        season_amount_from_rounding: Number(rawWithhold.season_amount_from_rounding ?? rawWithhold.seasonAmountFromRounding ?? 0),
        weekly_rounding_to_season_amount: Number(rawWithhold.weekly_rounding_to_season_amount ?? rawWithhold.weeklyRoundingToSeasonAmount ?? 0),
        dispatcher_rounding_to_season_amount: Number(rawWithhold.dispatcher_rounding_to_season_amount ?? rawWithhold.dispatcherRoundingToSeasonAmount ?? 0),
        payouts_rounding_to_season_amount: Number(rawWithhold.payouts_rounding_to_season_amount ?? rawWithhold.payoutsRoundingToSeasonAmount ?? 0),
        rounding_to_season_amount_total: Number(rawWithhold.rounding_to_season_amount_total ?? rawWithhold.roundingToSeasonAmountTotal ?? 0),
        dispatcher_amount_total: Number(rawWithhold.dispatcher_amount_total ?? rawWithhold.dispatcherAmountTotal ?? 0),
        fund_total_original: Number(rawWithhold.fund_total_original ?? rawWithhold.fundTotalOriginal ?? 0),
        fund_total_after_withhold: Number(rawWithhold.fund_total_after_withhold ?? rawWithhold.fundTotalAfterWithhold ?? 0),
        dispatcher_percent_total: Number(rawWithhold.dispatcher_percent_total ?? rawWithhold.dispatcherPercentTotal ?? 0),
        dispatcher_percent_per_person: Number(rawWithhold.dispatcher_percent_per_person ?? rawWithhold.dispatcherPercentPerPerson ?? 0),
        active_dispatchers_count: Number(rawWithhold.active_dispatchers_count ?? rawWithhold.activeDispatchersCount ?? 0),
      }
    : null;

  const cashbox = {
    cash_in_cashbox: cash_in_cashbox !== null ? Number(cash_in_cashbox) : null,
    expected_sellers_cash_due: expected_sellers_cash_due !== null ? Number(expected_sellers_cash_due) : null,
    deposits_cash_total: Number(deposits_cash_total),
    salary_paid_cash: Number(salary_paid_cash_cashbox),
    cash_discrepancy: cash_discrepancy !== null ? Number(cash_discrepancy) : null,
    warnings,
  };

  return {
    // Meta
    business_day,
    source,
    is_closed,
    closed_at,
    closed_by,
    
    // Revenue
    total_revenue: Number(total_revenue),
    
    // Collected
    collected_total: Number(collected_total),
    collected_cash: Number(collected_cash),
    collected_card: Number(collected_card),
    
    // Refunds
    refund_total: Number(refund_total),
    refund_cash: Number(refund_cash),
    refund_card: Number(refund_card),
    
    // Net
    net_total: Number(net_total),
    net_cash: Number(net_cash),
    net_card: Number(net_card),
    
    // Deposits
    deposit_cash: Number(deposit_cash),
    deposit_card: Number(deposit_card),
    deposit_total: Number(deposit_total),
    
    // Salary
    salary_due_total: Number(salary_due_total),
    salary_paid_cash: Number(salary_paid_cash),
    salary_paid_card: Number(salary_paid_card),
    salary_paid_total: Number(salary_paid_total),
    sellers_debt_total: sellers_debt_total !== null ? Number(sellers_debt_total) : null,
    owner_cash_available: owner_cash_available !== null ? Number(owner_cash_available) : null,
    owner_cash_available_without_future_reserve: owner_cash_available_without_future_reserve !== null ? Number(owner_cash_available_without_future_reserve) : null,
    owner_cash_available_after_future_reserve_cash: owner_cash_available_after_future_reserve_cash !== null ? Number(owner_cash_available_after_future_reserve_cash) : null,
    owner_cash_available_after_reserve_and_funds_cash: owner_cash_available_after_reserve_and_funds_cash !== null ? Number(owner_cash_available_after_reserve_and_funds_cash) : null,
    funds_withhold_cash_today: funds_withhold_cash_today !== null ? Number(funds_withhold_cash_today) : null,
    future_trips_reserve_cash: Number(future_trips_reserve_cash),
    future_trips_reserve_card: Number(future_trips_reserve_card),
    future_trips_reserve_total: Number(future_trips_reserve_total),
    
    // Trip status
    all_trips_finished,
    open_trips_count,
    
    // Role breakdown
    sellers,
    dispatcher,
    
    // Cashbox (server truth)
    cashbox,
    // Top-level convenience
    cash_in_cashbox: cashbox.cash_in_cashbox,
    expected_sellers_cash_due: cashbox.expected_sellers_cash_due,
    cash_discrepancy: cashbox.cash_discrepancy,
    warnings: cashbox.warnings,

    // Explain section (human-readable breakdown)
    explain,

    // Motivation withhold details
    motivation_withhold,
  };
}

export default normalizeSummary;
