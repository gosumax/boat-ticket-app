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
  const sellerNameRaw = s.seller_name ?? s.sellerName ?? s.name ?? '';
  const seller_name = (() => {
    const text = String(sellerNameRaw || '').trim();
    if (!text || /^\d+$/.test(text)) return `Seller #${Number(seller_id) || 0}`;
    return text;
  })();
  const role = s.role ? String(s.role).toLowerCase() : null;

  // Collected amounts
  const collected_total =
    s.collected_total ??
    s.collectedTotal ??
    s.total_collected ??
    s.totalCollected ??
    s.accepted ??
    0;
  const collected_cash = s.collected_cash ?? s.collectedCash ?? s.accepted_cash ?? s.cashSales ?? 0;
  const collected_card = s.collected_card ?? s.collectedCard ?? s.accepted_card ?? s.cardSales ?? 0;

  // Deposits (handed to owner)
  const deposit_cash = s.deposit_cash ?? s.depositCash ?? s.deposited_cash ?? s.cashHanded ?? 0;
  const deposit_card = s.deposit_card ?? s.depositCard ?? s.deposited_card ?? s.terminalHanded ?? 0;

  // Balance / due
  const cash_due_to_owner = s.cash_due_to_owner ?? s.cashDueToOwner ?? s.cash_balance ?? s.cashBalance ?? s.cashRemaining ?? s.balance ?? 0;
  const terminal_due_to_owner = s.terminal_due_to_owner ?? s.terminalDueToOwner ?? s.terminal_debt ?? s.terminalDebt ?? 0;

  // Net
  const net_total = s.net_total ?? s.netTotal ?? (Number(cash_due_to_owner) + Number(terminal_due_to_owner));
  const is_attributed_seller = Boolean(s.is_attributed_seller ?? s.isAttributedSeller ?? false);

  // Status
  const status = s.status ?? (
    Number(net_total) === 0 ? 'CLOSED' : Number(net_total) > 0 ? 'DEBT' : 'OVERPAID'
  );

  // Salary fields
  const salary_due = s.salary_due ?? s.salaryDue ?? 0;
  const salary_due_total = s.salary_due_total ?? s.salaryDueTotal ?? salary_due;
  const salary_accrued = s.salary_accrued ?? s.salaryAccrued ?? salary_due_total;
  const team_part = s.team_part ?? s.teamPart ?? 0;
  const individual_part = s.individual_part ?? s.individualPart ?? 0;
  const dispatcher_daily_bonus = s.dispatcher_daily_bonus ?? s.dispatcherDailyBonus ?? 0;
  const total_raw = s.total_raw ?? s.totalRaw ?? salary_due_total;
  const salary_rounding_to_season =
    s.salary_rounding_to_season ??
    s.salaryRoundingToSeason ??
    Math.max(0, Number(total_raw) - Number(salary_due_total));
  const personal_revenue_day = s.personal_revenue_day ?? s.personalRevenueDay ?? collected_total;

  return {
    seller_id: Number(seller_id),
    seller_name,
    name: seller_name, // alias for compatibility
    role,
    collected_total: Number(collected_total),
    collected_cash: Number(collected_cash),
    collected_card: Number(collected_card),
    deposit_cash: Number(deposit_cash),
    deposit_card: Number(deposit_card),
    cash_due_to_owner: Number(cash_due_to_owner),
    terminal_due_to_owner: Number(terminal_due_to_owner),
    terminal_debt: Number(terminal_due_to_owner), // alias for backward compat
    net_total: Number(net_total),
    balance: Number(net_total),
    cash_balance: Number(cash_due_to_owner),
    status,
    // Salary fields
    salary_due: Number(salary_due),
    salary_due_total: Number(salary_due_total),
    salary_to_pay: Number(salary_due_total),
    final_salary_total: Number(salary_due_total),
    salary_accrued: Number(salary_accrued),
    team_part: Number(team_part),
    individual_part: Number(individual_part),
    dispatcher_daily_bonus: Number(dispatcher_daily_bonus),
    total_raw: Number(total_raw),
    salary_rounding_to_season: Number(salary_rounding_to_season),
    personal_revenue_day: Number(personal_revenue_day),
    is_attributed_seller,
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

function sumNumericField(rows, getter) {
  return (rows || []).reduce((sum, row) => {
    const value = Number(getter(row) ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function buildMissingDispatcherRow({
  currentUser,
  sellers = [],
  participants_with_sales = [],
  collected_total = 0,
  collected_cash = 0,
  collected_card = 0,
  salary_due_total = 0,
}) {
  const userId = Number(currentUser?.id ?? currentUser?.seller_id ?? currentUser?.sellerId ?? 0);
  const userRole = String(currentUser?.role || '').toLowerCase();
  if (userRole !== 'dispatcher' || !Number.isFinite(userId) || userId <= 0) return null;

  const rowExists = (rows) => (rows || []).some(
    (row) => Number(row?.seller_id ?? row?.sellerId ?? row?.id ?? 0) === userId
  );
  if (rowExists(sellers) || rowExists(participants_with_sales)) return null;

  const visibleSellerCollectedTotal = sumNumericField(
    sellers,
    (seller) => seller?.collected_total ?? seller?.collectedTotal ?? seller?.total_collected ?? seller?.accepted
  );
  const visibleSellerCollectedCash = sumNumericField(
    sellers,
    (seller) => seller?.collected_cash ?? seller?.collectedCash
  );
  const visibleSellerCollectedCard = sumNumericField(
    sellers,
    (seller) => seller?.collected_card ?? seller?.collectedCard
  );
  const visibleSellerSalaryDue = sumNumericField(
    sellers,
    (seller) => seller?.salary_due_total ?? seller?.salaryDueTotal ?? seller?.salary_due ?? seller?.salaryDue
  );

  const inferredCollectedCash = Math.max(0, Number(collected_cash || 0) - visibleSellerCollectedCash);
  const inferredCollectedCard = Math.max(0, Number(collected_card || 0) - visibleSellerCollectedCard);
  const inferredCollectedTotal = Math.max(
    0,
    Number(collected_total || 0) - visibleSellerCollectedTotal,
    inferredCollectedCash + inferredCollectedCard
  );
  const inferredSalaryDue = Math.max(0, Number(salary_due_total || 0) - visibleSellerSalaryDue);

  if (
    inferredCollectedTotal <= 0 &&
    inferredCollectedCash <= 0 &&
    inferredCollectedCard <= 0 &&
    inferredSalaryDue <= 0
  ) {
    return null;
  }

  const seller_name =
    currentUser?.username ??
    currentUser?.seller_name ??
    currentUser?.sellerName ??
    currentUser?.name ??
    `Dispatcher #${userId}`;

  return normalizeSeller({
    seller_id: userId,
    seller_name,
    role: 'dispatcher',
    collected_total: inferredCollectedTotal,
    collected_cash: inferredCollectedCash,
    collected_card: inferredCollectedCard,
    deposit_cash: 0,
    deposit_card: 0,
    cash_due_to_owner: 0,
    terminal_due_to_owner: 0,
    net_total: 0,
    status: 'CLOSED',
    salary_due: inferredSalaryDue,
    salary_due_total: inferredSalaryDue,
    salary_accrued: inferredSalaryDue,
    team_part: 0,
    individual_part: 0,
    total_raw: inferredSalaryDue,
    salary_rounding_to_season: 0,
    personal_revenue_day: inferredCollectedTotal,
    is_attributed_seller: false,
  });
}

/**
 * Normalize summary data from backend
 * Handles both snake_case and camelCase field names
 * @param {Object} data - Raw summary data from backend
 * @returns {Object} Normalized summary with consistent field names
 */
export function normalizeSummary(data, options = {}) {
  if (!data) return null;
  
  // Meta
  const business_day = data.business_day ?? data.businessDay ?? data.day ?? '';
  const source = data.source ?? data.shiftSource ?? 'ledger';
  const live_source = data.live_source ?? data.liveSource ?? source;
  const is_closed = Boolean(data.is_closed ?? data.closed ?? data.isClosed ?? false);
  const closed_at = data.closed_at ?? data.closedAt ?? null;
  const closed_by = data.closed_by ?? data.closedBy ?? null;
  const rawShiftCloseBreakdown = data.shift_close_breakdown ?? data.shiftCloseBreakdown ?? null;
  const rawShiftCloseTotals = rawShiftCloseBreakdown?.totals ?? null;
  
  // Collected money
  const collected_total = data.collected_total ?? data.collectedTotal ?? data.collected?.total ?? rawShiftCloseTotals?.total_received ?? 0;
  const collected_cash = data.collected_cash ?? data.collectedCash ?? data.collected?.cash ?? rawShiftCloseTotals?.cash_received ?? 0;
  const collected_card = data.collected_card ?? data.collectedCard ?? data.collected?.card ?? rawShiftCloseTotals?.card_received ?? 0;
  
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
  const salary_due_total = data.salary_due_total ?? data.salaryDueTotal ?? data.salary_due ?? data.salaryDue ?? rawShiftCloseTotals?.final_salary_total ?? 0;
  const salary_to_pay =
    data.salary_to_pay ??
    data.salaryToPay ??
    data.final_salary_total ??
    data.finalSalaryTotal ??
    rawShiftCloseTotals?.final_salary_total ??
    salary_due_total;
  const weekly_fund =
    data.weekly_fund ??
    data.weeklyFund ??
    rawShiftCloseTotals?.weekly_fund ??
    null;
  const season_fund_total =
    data.season_fund_total ??
    data.seasonFundTotal ??
    rawShiftCloseTotals?.season_fund_total ??
    null;
  const salary_paid_cash = data.salary_paid_cash ?? data.salaryPaidCash ?? 0;
  const salary_paid_card = data.salary_paid_card ?? data.salaryPaidCard ?? 0;
  const salary_paid_total = data.salary_paid_total ?? data.salaryPaidTotal ?? 0;
  const salary_base = data.salary_base ?? data.salaryBase ?? rawShiftCloseTotals?.salary_base ?? Math.max(0, Number(net_total) - Number(data.future_trips_reserve_total ?? data.futureTripsReserveTotal ?? 0));
  const salary_fund_total =
    data.salary_fund_total ??
    data.salaryFundTotal ??
    data.motivation_withhold?.salary_fund_total ??
    data.motivationWithhold?.salaryFundTotal ??
    rawShiftCloseBreakdown?.withhold?.salary_fund_total ??
    null;
  const owner_cash_today =
    data.owner_cash_today ??
    data.ownerCashToday ??
    data.owner_cash_live_today ??
    data.ownerCashLiveToday ??
    rawShiftCloseTotals?.owner_cash_today ??
    null;
  const sellers_collect_total =
    data.sellers_collect_total ??
    data.sellersCollectTotal ??
    data.sellers_total_collect ??
    data.sellersTotalCollect ??
    rawShiftCloseTotals?.collect_from_sellers ??
    null;
  const sellers_debt_total = data.sellers_debt_total ?? data.sellersDebtTotal ?? null;
  const owner_cash_available = data.owner_cash_available ?? data.ownerCashAvailable ?? null;
  const owner_cash_available_after_future_reserve_cash =
    data.owner_cash_available_after_future_reserve_cash ??
    data.ownerCashAvailableAfterFutureReserveCash ??
    rawShiftCloseTotals?.owner_cash_after_reserve ??
    null;
  const owner_cash_available_after_reserve_and_funds =
    data.owner_cash_available_after_reserve_and_funds ??
    data.ownerCashAvailableAfterReserveAndFunds ??
    null;
  const owner_cash_available_after_reserve_and_funds_cash =
    data.owner_cash_available_after_reserve_and_funds_cash ??
    data.ownerCashAvailableAfterReserveAndFundsCash ??
    owner_cash_available_after_reserve_and_funds;
  const owner_handover_cash_final =
    data.owner_handover_cash_final ??
    data.ownerHandoverCashFinal ??
    owner_cash_available_after_reserve_and_funds_cash ??
    owner_cash_today;
  const funds_withhold_cash_today =
    data.funds_withhold_cash_today ??
    data.fundsWithholdCashToday ??
    rawShiftCloseTotals?.funds_withhold_cash_today ??
    null;
  const owner_cash_available_without_future_reserve =
    data.owner_cash_available_without_future_reserve ??
    data.ownerCashAvailableWithoutFutureReserve ??
    rawShiftCloseTotals?.owner_cash_before_reserve ??
    owner_cash_available;
  const reserveFromExplainCash = data.explain?.liabilities?.future_trips_reserve_cash ?? data.explain?.liabilities?.prepayment_future_cash;
  const reserveFromExplainCard = data.explain?.liabilities?.future_trips_reserve_terminal ?? data.explain?.liabilities?.prepayment_future_terminal;
  const future_trips_reserve_cash =
    data.future_trips_reserve_cash ??
    data.futureTripsReserveCash ??
    data.reserve_future_trips?.cash ??
    reserveFromExplainCash ??
    rawShiftCloseTotals?.reserve_cash ??
    0;
  const future_trips_reserve_card =
    data.future_trips_reserve_card ??
    data.futureTripsReserveCard ??
    data.reserve_future_trips?.card ??
    reserveFromExplainCard ??
    rawShiftCloseTotals?.reserve_card ??
    0;
  const future_trips_reserve_total =
    data.future_trips_reserve_total ??
    data.futureTripsReserveTotal ??
    data.reserve_future_trips?.total ??
    rawShiftCloseTotals?.reserve_total ??
    (Number(future_trips_reserve_cash || 0) + Number(future_trips_reserve_card || 0));
  
  // Trip status
  const all_trips_finished = Boolean(data.all_trips_finished ?? data.allTripsFinished ?? true);
  const open_trips_count = Number(data.open_trips_count ?? data.openTripsCount ?? 0);
  
  // Sellers
  const rawSellers = Array.isArray(data.sellers_live)
    ? data.sellers_live
    : Array.isArray(data.sellers)
    ? data.sellers
    : [];
  const baseParticipantsWithSales = rawSellers
    .filter((s) => {
      const collectedTotal = Number(
        s?.collected_total ??
        s?.collectedTotal ??
        s?.total_collected ??
        s?.totalCollected ??
        s?.accepted ??
        0
      );
      const sellerId = Number(s?.seller_id ?? s?.sellerId ?? s?.id ?? 0);
      return Number.isFinite(sellerId) && sellerId > 0 && collectedTotal > 0;
    })
    .map(normalizeSeller)
    .filter((s) => Boolean(s) && Number.isFinite(Number(s.seller_id)) && Number(s.seller_id) > 0);
  const baseSellers = rawSellers
    .filter((s) => {
      const role = String(s?.role || '').toLowerCase();
      const isAttributedSeller = Boolean(s?.is_attributed_seller ?? s?.isAttributedSeller ?? false);
      if (role === 'dispatcher') {
        const dispatcherSalaryDue = Number(
          s?.salary_due_total ??
          s?.salaryDueTotal ??
          s?.salary_due ??
          s?.salaryDue ??
          s?.salary_accrued ??
          s?.salaryAccrued ??
          0
        );
        const dispatcherCollectedTotal = Number(
          s?.collected_total ??
          s?.collectedTotal ??
          s?.total_collected ??
          s?.totalCollected ??
          s?.accepted ??
          0
        );
        const dispatcherCollectedCash = Number(s?.collected_cash ?? s?.collectedCash ?? 0);
        const dispatcherCollectedCard = Number(s?.collected_card ?? s?.collectedCard ?? 0);
        const hasDispatcherSales =
          dispatcherCollectedTotal > 0 ||
          dispatcherCollectedCash > 0 ||
          dispatcherCollectedCard > 0;
        return hasDispatcherSales || dispatcherSalaryDue > 0 || isAttributedSeller;
      }
      if ((role === 'owner' || role === 'admin') && !isAttributedSeller) return false;
      return true;
    })
    .map(normalizeSeller)
    .filter((s) => Boolean(s) && Number.isFinite(Number(s.seller_id)) && Number(s.seller_id) > 0);
  const inferredDispatcherRow = buildMissingDispatcherRow({
    currentUser: options?.currentUser,
    sellers: baseSellers,
    participants_with_sales: baseParticipantsWithSales,
    collected_total,
    collected_cash,
    collected_card,
    salary_due_total,
  });
  const sellers = inferredDispatcherRow
    ? [...baseSellers, inferredDispatcherRow]
    : baseSellers;
  const participants_with_sales = inferredDispatcherRow && Number(inferredDispatcherRow.collected_total || 0) > 0
    ? [...baseParticipantsWithSales, inferredDispatcherRow]
    : baseParticipantsWithSales;
  
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
        viklif_amount_raw: Number(rawWithhold.viklif_amount_raw ?? rawWithhold.viklifAmountRaw ?? 0),
        viklif_amount: Number(rawWithhold.viklif_amount ?? rawWithhold.viklifAmount ?? 0),
        weekly_amount: Number(rawWithhold.weekly_amount ?? rawWithhold.weeklyAmount ?? 0),
        season_amount: Number(rawWithhold.season_amount ?? rawWithhold.seasonAmount ?? rawWithhold.season_from_revenue ?? rawWithhold.seasonFromRevenue ?? 0),
        season_from_revenue: Number(rawWithhold.season_from_revenue ?? rawWithhold.seasonFromRevenue ?? rawWithhold.season_amount ?? rawWithhold.seasonAmount ?? 0),
        season_amount_base: Number(rawWithhold.season_amount_base ?? rawWithhold.seasonAmountBase ?? 0),
        season_amount_from_rounding: Number(rawWithhold.season_amount_from_rounding ?? rawWithhold.seasonAmountFromRounding ?? 0),
        season_fund_total: Number(rawWithhold.season_fund_total ?? rawWithhold.seasonFundTotal ?? rawWithhold.season_total ?? rawWithhold.seasonTotal ?? rawWithhold.season_amount ?? rawWithhold.seasonAmount ?? rawWithhold.season_from_revenue ?? rawWithhold.seasonFromRevenue ?? 0),
        season_total: Number(rawWithhold.season_total ?? rawWithhold.seasonTotal ?? rawWithhold.season_fund_total ?? rawWithhold.seasonFundTotal ?? rawWithhold.season_amount ?? rawWithhold.seasonAmount ?? rawWithhold.season_from_revenue ?? rawWithhold.seasonFromRevenue ?? 0),
        season_amount_from_cancelled_prepayment: Number(rawWithhold.season_amount_from_cancelled_prepayment ?? rawWithhold.seasonAmountFromCancelledPrepayment ?? rawWithhold.season_from_prepayment_transfer ?? rawWithhold.seasonFromPrepaymentTransfer ?? 0),
        season_from_prepayment_transfer: Number(rawWithhold.season_from_prepayment_transfer ?? rawWithhold.seasonFromPrepaymentTransfer ?? rawWithhold.season_amount_from_cancelled_prepayment ?? rawWithhold.seasonAmountFromCancelledPrepayment ?? 0),
        viklif_rounding_to_season_amount: Number(rawWithhold.viklif_rounding_to_season_amount ?? rawWithhold.viklifRoundingToSeasonAmount ?? 0),
        weekly_rounding_to_season_amount: Number(rawWithhold.weekly_rounding_to_season_amount ?? rawWithhold.weeklyRoundingToSeasonAmount ?? 0),
        dispatcher_rounding_to_season_amount: Number(rawWithhold.dispatcher_rounding_to_season_amount ?? rawWithhold.dispatcherRoundingToSeasonAmount ?? 0),
        payouts_rounding_to_season_amount: Number(rawWithhold.payouts_rounding_to_season_amount ?? rawWithhold.payoutsRoundingToSeasonAmount ?? 0),
        rounding_to_season_amount_total: Number(rawWithhold.rounding_to_season_amount_total ?? rawWithhold.roundingToSeasonAmountTotal ?? 0),
        dispatcher_amount_total: Number(rawWithhold.dispatcher_amount_total ?? rawWithhold.dispatcherAmountTotal ?? 0),
        fund_total_original: Number(rawWithhold.fund_total_original ?? rawWithhold.fundTotalOriginal ?? 0),
        fund_total_after_withhold: Number(rawWithhold.fund_total_after_withhold ?? rawWithhold.fundTotalAfterWithhold ?? 0),
        salary_fund_total: Number(rawWithhold.salary_fund_total ?? rawWithhold.salaryFundTotal ?? rawWithhold.fund_total_after_withhold ?? rawWithhold.fundTotalAfterWithhold ?? 0),
        viklif_percent: Number(rawWithhold.viklif_percent ?? rawWithhold.viklifPercent ?? 0),
        weekly_percent: Number(rawWithhold.weekly_percent ?? rawWithhold.weeklyPercent ?? 0),
        weekly_percent_configured: Number(rawWithhold.weekly_percent_configured ?? rawWithhold.weeklyPercentConfigured ?? 0),
        season_percent: Number(rawWithhold.season_percent ?? rawWithhold.seasonPercent ?? 0),
        dispatcher_percent_total: Number(rawWithhold.dispatcher_percent_total ?? rawWithhold.dispatcherPercentTotal ?? 0),
        dispatcher_percent_total_configured: Number(rawWithhold.dispatcher_percent_total_configured ?? rawWithhold.dispatcherPercentTotalConfigured ?? 0),
        dispatcher_percent_per_person: Number(rawWithhold.dispatcher_percent_per_person ?? rawWithhold.dispatcherPercentPerPerson ?? 0),
        active_dispatchers_count: Number(rawWithhold.active_dispatchers_count ?? rawWithhold.activeDispatchersCount ?? 0),
      }
    : null;
  const shift_close_breakdown = rawShiftCloseBreakdown
    ? {
        ...rawShiftCloseBreakdown,
        totals: rawShiftCloseTotals
          ? Object.fromEntries(
              Object.entries(rawShiftCloseTotals).map(([key, value]) => [key, Number(value ?? 0)])
            )
          : {},
        participants: Array.isArray(rawShiftCloseBreakdown.participants)
          ? rawShiftCloseBreakdown.participants.map((participant) => ({
              ...participant,
              user_id: Number(participant.user_id ?? participant.seller_id ?? 0),
              collected_cash: Number(participant.collected_cash ?? 0),
              collected_card: Number(participant.collected_card ?? 0),
              collected_total: Number(participant.collected_total ?? 0),
              deposit_cash: Number(participant.deposit_cash ?? 0),
              deposit_card: Number(participant.deposit_card ?? 0),
              deposit_total: Number(participant.deposit_total ?? 0),
              collect_to_owner_cash: Number(participant.collect_to_owner_cash ?? 0),
              collect_to_owner_card: Number(participant.collect_to_owner_card ?? 0),
              collect_to_owner_total: Number(participant.collect_to_owner_total ?? 0),
              salary_team_part: Number(participant.salary_team_part ?? 0),
              salary_individual_part: Number(participant.salary_individual_part ?? 0),
              dispatcher_bonus: Number(participant.dispatcher_bonus ?? 0),
              salary_raw: Number(participant.salary_raw ?? 0),
              salary_rounding_to_season: Number(participant.salary_rounding_to_season ?? 0),
              final_salary_total: Number(participant.final_salary_total ?? 0),
              personal_revenue_day: Number(participant.personal_revenue_day ?? 0),
            }))
          : [],
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
    live_source,
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
    salary_to_pay: Number(salary_to_pay),
    final_salary_total: Number(salary_to_pay),
    weekly_fund: weekly_fund !== null ? Number(weekly_fund) : null,
    season_fund_total: season_fund_total !== null ? Number(season_fund_total) : null,
    salary_base: Number(salary_base),
    salary_fund_total: salary_fund_total !== null ? Number(salary_fund_total) : null,
    salary_paid_cash: Number(salary_paid_cash),
    salary_paid_card: Number(salary_paid_card),
    salary_paid_total: Number(salary_paid_total),
    owner_cash_today: owner_cash_today !== null ? Number(owner_cash_today) : null,
    sellers_collect_total: sellers_collect_total !== null ? Number(sellers_collect_total) : null,
    sellers_debt_total: sellers_debt_total !== null ? Number(sellers_debt_total) : null,
    owner_cash_available: owner_cash_available !== null ? Number(owner_cash_available) : null,
    owner_cash_available_without_future_reserve: owner_cash_available_without_future_reserve !== null ? Number(owner_cash_available_without_future_reserve) : null,
    owner_cash_available_after_future_reserve_cash: owner_cash_available_after_future_reserve_cash !== null ? Number(owner_cash_available_after_future_reserve_cash) : null,
    owner_cash_available_after_reserve_and_funds_cash: owner_cash_available_after_reserve_and_funds_cash !== null ? Number(owner_cash_available_after_reserve_and_funds_cash) : null,
    owner_handover_cash_final: owner_handover_cash_final !== null ? Number(owner_handover_cash_final) : null,
    funds_withhold_cash_today: funds_withhold_cash_today !== null ? Number(funds_withhold_cash_today) : null,
    future_trips_reserve_cash: Number(future_trips_reserve_cash),
    future_trips_reserve_card: Number(future_trips_reserve_card),
    future_trips_reserve_total: Number(future_trips_reserve_total),
    
    // Trip status
    all_trips_finished,
    open_trips_count,
    
    // Role breakdown
    sellers,
    participants_with_sales,
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
    shift_close_breakdown,
  };
}

export default normalizeSummary;
