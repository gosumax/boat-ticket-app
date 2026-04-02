function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function safeNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function positive(value) {
  return Math.max(0, safeNumber(value));
}

function normalizeWithhold(withhold = {}) {
  const seasonFromRevenue = safeNumber(withhold.season_from_revenue ?? withhold.season_amount);
  const seasonPrepayTransfer = safeNumber(
    withhold.season_from_prepayment_transfer ??
    withhold.season_amount_from_cancelled_prepayment
  );
  const seasonRounding = safeNumber(
    withhold.rounding_to_season_amount_total ??
    withhold.season_amount_from_rounding
  );
  const seasonFundTotal = safeNumber(
    withhold.season_total ??
    withhold.season_fund_total ??
    (seasonFromRevenue + seasonPrepayTransfer)
  );

  return {
    viklif_percent: safeNumber(withhold.viklif_percent),
    viklif_amount: safeNumber(withhold.viklif_amount),
    weekly_percent: safeNumber(withhold.weekly_percent),
    weekly_percent_configured: safeNumber(withhold.weekly_percent_configured),
    season_percent: safeNumber(withhold.season_percent),
    dispatcher_percent_total: safeNumber(withhold.dispatcher_percent_total),
    dispatcher_percent_total_configured: safeNumber(withhold.dispatcher_percent_total_configured),
    dispatcher_percent_per_person: safeNumber(withhold.dispatcher_percent_per_person),
    weekly_amount: safeNumber(withhold.weekly_amount),
    season_amount: seasonFromRevenue,
    season_from_revenue: seasonFromRevenue,
    season_amount_base: safeNumber(withhold.season_amount_base),
    season_amount_from_rounding: seasonRounding,
    rounding_to_season_amount_total: seasonRounding,
    season_from_prepayment_transfer: seasonPrepayTransfer,
    season_amount_from_cancelled_prepayment: seasonPrepayTransfer,
    season_fund_total: seasonFundTotal,
    season_total: seasonFundTotal,
    dispatcher_amount_total: safeNumber(withhold.dispatcher_amount_total),
    fund_total_original: safeNumber(withhold.fund_total_original),
    fund_total_after_withhold: safeNumber(withhold.fund_total_after_withhold),
    salary_fund_total: safeNumber(withhold.salary_fund_total ?? withhold.fund_total_after_withhold),
    active_dispatchers_count: safeNumber(withhold.active_dispatchers_count),
  };
}

function mapSettingsSnapshot(settings = {}) {
  if (!settings || typeof settings !== 'object') return null;
  return {
    motivationType: String(settings.motivationType || 'team'),
    motivation_percent: safeNumber(settings.motivation_percent),
    weekly_percent_legacy: safeNumber(settings.weekly_percent),
    season_percent_legacy: safeNumber(settings.season_percent),
    individual_share: safeNumber(settings.individual_share),
    team_share: safeNumber(settings.team_share),
    teamIncludeSellers: settings.teamIncludeSellers !== false,
    teamIncludeDispatchers: settings.teamIncludeDispatchers !== false,
    viklif_withhold_percent_total: safeNumber(settings.viklif_withhold_percent_total),
    dispatcher_withhold_percent_total: safeNumber(settings.dispatcher_withhold_percent_total),
    weekly_withhold_percent_total: safeNumber(settings.weekly_withhold_percent_total),
    season_withhold_percent_total: safeNumber(settings.season_withhold_percent_total),
    k_dispatchers: safeNumber(settings.k_dispatchers),
    season_start_mmdd: settings.season_start_mmdd ?? null,
    season_end_mmdd: settings.season_end_mmdd ?? null,
  };
}

function mapParticipant(row = {}) {
  const userId = Number(row.seller_id ?? row.user_id ?? row.id ?? 0);
  if (!Number.isFinite(userId) || userId <= 0) return null;

  const role = String(row.role || '').toLowerCase() === 'dispatcher' ? 'dispatcher' : 'seller';
  const name = String(row.seller_name || row.name || `${role === 'dispatcher' ? 'Dispatcher' : 'Seller'} #${userId}`);
  const collectedCash = safeNumber(row.collected_cash);
  const collectedCard = safeNumber(row.collected_card);
  const depositCash = safeNumber(row.deposit_cash);
  const depositCard = safeNumber(row.deposit_card);
  const collectCash = positive(row.cash_due_to_owner ?? row.cash_balance);
  const collectCard = positive(row.terminal_due_to_owner ?? row.terminal_debt);
  const finalSalaryTotal = safeNumber(
    row.salary_due_total ??
    row.salary_due ??
    row.salary_accrued ??
    row.total
  );

  return {
    user_id: userId,
    role,
    name,
    collected_cash: collectedCash,
    collected_card: collectedCard,
    collected_total: safeNumber(row.collected_total ?? (collectedCash + collectedCard)),
    deposit_cash: depositCash,
    deposit_card: depositCard,
    deposit_total: roundMoney(depositCash + depositCard),
    collect_to_owner_cash: collectCash,
    collect_to_owner_card: collectCard,
    collect_to_owner_total: roundMoney(collectCash + collectCard),
    salary_team_part: safeNumber(row.team_part),
    salary_individual_part: safeNumber(row.individual_part),
    dispatcher_bonus: safeNumber(row.dispatcher_daily_bonus),
    salary_raw: safeNumber(row.total_raw ?? finalSalaryTotal),
    salary_rounding_to_season: safeNumber(row.salary_rounding_to_season),
    final_salary_total: finalSalaryTotal,
    personal_revenue_day: safeNumber(row.personal_revenue_day ?? row.collected_total),
  };
}

const SHIFT_CLOSE_FORMULAS = {
  cash_received: 'collected_cash',
  card_received: 'collected_card',
  total_received: 'collected_total',
  reserve_cash: 'future_trips_reserve_cash',
  reserve_card: 'future_trips_reserve_card',
  reserve_total: 'future_trips_reserve_cash + future_trips_reserve_card',
  collect_from_sellers: 'sum(participants.collect_to_owner_total)',
  salary_base: 'max(0, net_total - reserve_total)',
  motivation_fund: 'salary_base * motivation_percent',
  weekly_fund: 'withhold.weekly_amount',
  season_base: 'withhold.season_amount_base',
  season_rounding: 'withhold.rounding_to_season_amount_total',
  season_prepay_transfer: 'withhold.season_from_prepayment_transfer',
  season_fund_total: 'withhold.season_fund_total',
  dispatcher_bonus: 'withhold.dispatcher_amount_total',
  final_salary_total: 'sum(participants.final_salary_total)',
  owner_cash_before_reserve: 'net_cash - salary_paid_cash - seller_cash_debt_total - salary_remaining_total',
  owner_cash_after_reserve: 'owner_cash_before_reserve - reserve_cash',
  owner_cash_today: 'owner_cash_after_reserve - funds_withhold_cash_today',
};

export function buildShiftCloseBreakdown({
  businessDay,
  source = 'live',
  sellers = [],
  collectedCash = 0,
  collectedCard = 0,
  collectedTotal = 0,
  reserveCash = 0,
  reserveCard = 0,
  reserveTotal = null,
  salaryBase = 0,
  salaryDueTotal = 0,
  salaryPaidCash = 0,
  salaryPaidCard = 0,
  salaryPaidTotal = 0,
  ownerCashMetrics = {},
  fundsWithholdCashToday = 0,
  motivationData = null,
  motivationWithhold = null,
} = {}) {
  const normalizedWithhold = normalizeWithhold(motivationWithhold || motivationData?.withhold || {});
  const participants = (Array.isArray(sellers) ? sellers : [])
    .map(mapParticipant)
    .filter(Boolean);

  const collectFromSellersCash = roundMoney(
    participants.reduce((sum, participant) => sum + positive(participant.collect_to_owner_cash), 0)
  );
  const collectFromSellersCard = roundMoney(
    participants.reduce((sum, participant) => sum + positive(participant.collect_to_owner_card), 0)
  );
  const collectFromSellersTotal = roundMoney(collectFromSellersCash + collectFromSellersCard);
  const finalSalaryFromParticipants = roundMoney(
    participants.reduce((sum, participant) => sum + safeNumber(participant.final_salary_total), 0)
  );
  const salaryRemainingTotal = roundMoney(
    Math.max(0, safeNumber(ownerCashMetrics.salary_remaining_total ?? (salaryDueTotal - salaryPaidTotal)))
  );
  const totalReserve = roundMoney(
    reserveTotal == null ? (safeNumber(reserveCash) + safeNumber(reserveCard)) : safeNumber(reserveTotal)
  );
  const ownerCashBeforeReserve = roundMoney(
    ownerCashMetrics.owner_cash_available_without_future_reserve
  );
  const ownerCashAfterReserve = roundMoney(
    ownerCashMetrics.owner_cash_available_after_future_reserve_cash
  );
  const ownerCashToday = roundMoney(ownerCashMetrics.owner_handover_cash_final);
  const normalizedFundsWithholdCashToday = roundMoney(
    fundsWithholdCashToday || (
      normalizedWithhold.weekly_amount +
      normalizedWithhold.season_from_revenue +
      normalizedWithhold.dispatcher_amount_total
    )
  );

  const totals = {
    cash_received: roundMoney(collectedCash),
    card_received: roundMoney(collectedCard),
    total_received: roundMoney(collectedTotal),
    reserve_cash: roundMoney(reserveCash),
    reserve_card: roundMoney(reserveCard),
    reserve_total: totalReserve,
    collect_from_sellers_cash: collectFromSellersCash,
    collect_from_sellers_card: collectFromSellersCard,
    collect_from_sellers: collectFromSellersTotal,
    salary_base: roundMoney(salaryBase),
    motivation_fund: roundMoney(
      motivationData?.fundTotal ??
      normalizedWithhold.fund_total_original
    ),
    weekly_fund: roundMoney(normalizedWithhold.weekly_amount),
    season_from_revenue: roundMoney(normalizedWithhold.season_from_revenue),
    season_base: roundMoney(normalizedWithhold.season_amount_base),
    season_rounding: roundMoney(normalizedWithhold.rounding_to_season_amount_total),
    season_prepay_transfer: roundMoney(normalizedWithhold.season_from_prepayment_transfer),
    season_fund_total: roundMoney(normalizedWithhold.season_fund_total),
    salary_fund_total: roundMoney(normalizedWithhold.salary_fund_total),
    dispatcher_bonus: roundMoney(normalizedWithhold.dispatcher_amount_total),
    final_salary_total: roundMoney(salaryDueTotal || finalSalaryFromParticipants),
    salary_paid_cash: roundMoney(salaryPaidCash),
    salary_paid_card: roundMoney(salaryPaidCard),
    salary_paid_total: roundMoney(salaryPaidTotal),
    salary_remaining_total: salaryRemainingTotal,
    owner_cash_before_reserve: ownerCashBeforeReserve,
    owner_cash_after_reserve: ownerCashAfterReserve,
    owner_cash_today: ownerCashToday,
    funds_withhold_cash_today: normalizedFundsWithholdCashToday,
    seller_cash_debt_total: roundMoney(ownerCashMetrics.seller_cash_debt_total),
    seller_card_debt_total: roundMoney(ownerCashMetrics.seller_card_debt_total),
  };

  const checks = {
    total_received_diff: roundMoney(totals.total_received - (totals.cash_received + totals.card_received)),
    reserve_total_diff: roundMoney(totals.reserve_total - (totals.reserve_cash + totals.reserve_card)),
    collect_from_sellers_diff: roundMoney(totals.collect_from_sellers - collectFromSellersTotal),
    final_salary_total_diff: roundMoney(totals.final_salary_total - finalSalaryFromParticipants),
    owner_cash_today_diff: roundMoney(
      totals.owner_cash_today - (totals.owner_cash_after_reserve - totals.funds_withhold_cash_today)
    ),
  };

  return {
    version: 'shift_close_v2026_04_02',
    business_day: businessDay,
    source,
    settings: mapSettingsSnapshot(motivationData?.settings_snapshot),
    settings_trace: {
      is_locked: Boolean(motivationData?.lock?.is_locked),
      snapshot_found: Boolean(motivationData?.lock?.snapshot_found),
      settings_source: motivationData?.lock?.settings_source ?? null,
    },
    formulas: SHIFT_CLOSE_FORMULAS,
    withhold: normalizedWithhold,
    totals,
    participants,
    checks,
  };
}

export function parseShiftCloseBreakdown(rawValue) {
  if (!rawValue) return null;

  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.totals || typeof parsed.totals !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}
