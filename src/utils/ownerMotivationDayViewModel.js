import { extractSellerCalibrationState } from './ownerSellerCalibration.js';

function safeNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

export function extractOwnerMoneyDayFunds(moneySummary) {
  const summary = moneySummary && typeof moneySummary === 'object' ? moneySummary : {};
  const ownerDecisionMetrics = summary.ownerDecisionMetrics ?? summary.owner_decision_metrics ?? null;
  const totals = summary.totals && typeof summary.totals === 'object' ? summary.totals : {};

  const hasCanonicalFunds =
    hasOwn(ownerDecisionMetrics, 'withhold_weekly_today') ||
    hasOwn(ownerDecisionMetrics, 'withhold_season_today') ||
    hasOwn(totals, 'weekly_fund') ||
    hasOwn(totals, 'season_fund_total') ||
    hasOwn(totals, 'funds_withhold_weekly_today') ||
    hasOwn(totals, 'funds_withhold_season_today');

  const weeklyAmountDay = safeNum(
    totals.funds_withhold_weekly_today ??
      ownerDecisionMetrics?.withhold_weekly_today ??
      totals.weekly_fund ??
      0
  );
  const seasonAmountDay = safeNum(
    totals.funds_withhold_season_today ??
      ownerDecisionMetrics?.withhold_season_today ??
      totals.season_fund_total
  );

  return {
    has_canonical_funds: hasCanonicalFunds,
    weekly_amount_day: weeklyAmountDay,
    season_amount_day: seasonAmountDay,
    total_funds_day: safeNum(weeklyAmountDay + seasonAmountDay),
  };
}

export function buildOwnerMotivationDayViewModel(data, fallbackDay, moneySummary) {
  const payload = data && typeof data === 'object' ? data : {};
  const pointsByUser = new Map(
    (Array.isArray(payload.points_by_user) ? payload.points_by_user : [])
      .map((entry) => [safeNum(entry?.user_id), entry])
  );

  const fallbackWeeklyAmountDay = safeNum(payload.weekly_amount_day ?? payload.withhold?.weekly_amount);
  const fallbackSeasonAmountDay = safeNum(
    payload.season_amount_day ??
      payload.withhold?.season_amount ??
      payload.withhold?.season_from_revenue
  );
  const fallbackTotalFundsDay = safeNum(
    payload.total_funds_day ?? (fallbackWeeklyAmountDay + fallbackSeasonAmountDay)
  );
  const canonicalFunds = extractOwnerMoneyDayFunds(moneySummary);
  const weeklyAmountDay = canonicalFunds.has_canonical_funds
    ? canonicalFunds.weekly_amount_day
    : fallbackWeeklyAmountDay;
  const seasonAmountDay = canonicalFunds.has_canonical_funds
    ? canonicalFunds.season_amount_day
    : fallbackSeasonAmountDay;
  const totalFundsDay = canonicalFunds.has_canonical_funds
    ? canonicalFunds.total_funds_day
    : fallbackTotalFundsDay;

  const sellerRows = (Array.isArray(payload.payouts) ? payload.payouts : [])
    .filter((row) => row?.role === 'seller')
    .map((row) => {
      const pointsEntry = pointsByUser.get(safeNum(row?.user_id));
      const calibrationState = extractSellerCalibrationState({
        ...(row || {}),
        ...(pointsEntry || {}),
      });
      const kStreak = safeNum(
        pointsEntry?.k_streak ??
          pointsEntry?.streak_multiplier ??
          row?.k_streak ??
          row?.streak_multiplier
      );

      return {
        user_id: safeNum(row?.user_id),
        name: row?.name || `User ${row?.user_id}`,
        role: 'seller',
        zone: row?.zone ?? pointsEntry?.zone ?? null,
        points_base: safeNum(pointsEntry?.points_base ?? row?.points_base),
        k_streak: kStreak > 0 ? kStreak : 1,
        points_total: safeNum(pointsEntry?.points_total ?? row?.points_total),
        seller_calibration_state: calibrationState,
        calibration_status: calibrationState.calibration_status,
        effective_level: calibrationState.effective_level,
        pending_next_week_level: calibrationState.pending_next_week_level,
        streak_multiplier: calibrationState.streak_multiplier,
        effective_week_id: calibrationState.effective_week_id,
        pending_week_id: calibrationState.pending_week_id,
      };
    });

  return {
    business_day: payload.business_day || fallbackDay,
    mode: payload.mode || 'unknown',
    participants: sellerRows.length,
    weekly_amount_day: weeklyAmountDay,
    season_amount_day: seasonAmountDay,
    total_funds_day: totalFundsDay,
    seller_rows: sellerRows,
  };
}

export default {
  extractOwnerMoneyDayFunds,
  buildOwnerMotivationDayViewModel,
};
