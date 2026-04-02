import { roundDownTo50 } from '../utils/money-rounding.mjs';

const SALES_TYPES = new Set([
  'SALE_PREPAYMENT_CASH',
  'SALE_PREPAYMENT_CARD',
  'SALE_PREPAYMENT_MIXED',
  'SALE_ACCEPTED_CASH',
  'SALE_ACCEPTED_CARD',
  'SALE_ACCEPTED_MIXED',
]);
const REFUND_TYPES = new Set(['SALE_CANCEL_REVERSE']);
const DEFAULT_SETTINGS = {
  motivationType: 'team',
  motivation_percent: 0.15,
  individual_share: 0.6,
  team_share: 0.4,
  teamIncludeSellers: true,
  teamIncludeDispatchers: true,
  k_speed: 1.2,
  k_cruise: 3.0,
  k_zone_hedgehog: 1.3,
  k_zone_center: 1.0,
  k_zone_sanatorium: 0.8,
  k_zone_stationary: 0.7,
  k_banana_hedgehog: 2.7,
  k_banana_center: 2.2,
  k_banana_sanatorium: 1.2,
  k_banana_stationary: 1.0,
  k_dispatchers: 1.0,
  dispatcher_withhold_percent_total: 0.002,
  weekly_withhold_percent_total: 0.008,
  season_withhold_percent_total: 0.005,
};
const STREAK_MULTIPLIERS = { 0: 1, 1: 1, 2: 1.05, 3: 1.1, 4: 1.15, 5: 1.2, 6: 1.25, 7: 1.3, 8: 1.3 };

const roundToKopecks = (value) => Math.round(Number(value || 0) * 100) / 100;
const isRevenueType = (type) => SALES_TYPES.has(String(type || '').toUpperCase());
const isRefundType = (type) => REFUND_TYPES.has(String(type || '').toUpperCase());
const getStreakMultiplier = (days) => (days >= 8 ? 1.3 : (STREAK_MULTIPLIERS[Math.max(0, Math.floor(Number(days) || 0))] || 1));

function safeTableExists(db, tableName) {
  try {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ? AND type IN ('table','view') LIMIT 1").get(tableName);
  } catch {
    return false;
  }
}

function safeGetColumns(db, tableName) {
  try {
    if (!safeTableExists(db, tableName)) return new Set();
    return new Set(db.prepare(`PRAGMA table_info('${tableName}')`).all().map((row) => row.name));
  } catch {
    return new Set();
  }
}

function hasCol(cols, name) {
  return cols && cols.has(name);
}

function getReserveTripDayExpr(db) {
  const presaleCols = safeGetColumns(db, 'presales');
  const ledgerCols = safeGetColumns(db, 'money_ledger');
  const presaleTripDayExpr = hasCol(presaleCols, 'business_day')
    ? "COALESCE(p.business_day, DATE(p.created_at))"
    : 'DATE(p.created_at)';
  return hasCol(ledgerCols, 'trip_day')
    ? `COALESCE(NULLIF(ml.trip_day, ''), ${presaleTripDayExpr})`
    : presaleTripDayExpr;
}

function calcFutureTripsReserveTotal(db, businessDay) {
  try {
    if (!safeTableExists(db, 'money_ledger') || !safeTableExists(db, 'presales')) return 0;
    const ledgerCols = safeGetColumns(db, 'money_ledger');
    if (!hasCol(ledgerCols, 'business_day')) return 0;
    const tripDayExpr = getReserveTripDayExpr(db);
    const row = db.prepare(`
      SELECT COALESCE(SUM(CASE
        WHEN ${tripDayExpr} > ? AND ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
        ) THEN ABS(ml.amount)
        WHEN ${tripDayExpr} > ? AND ml.type = 'SALE_CANCEL_REVERSE' THEN -ABS(ml.amount)
        ELSE 0 END), 0) AS reserve_total
      FROM money_ledger ml
      LEFT JOIN presales p ON p.id = ml.presale_id
      WHERE ml.business_day = ?
        AND ml.status = 'POSTED'
        AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
        AND ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE'
        )
    `).get(businessDay, businessDay, businessDay);
    return Math.max(0, Number(row?.reserve_total || 0));
  } catch {
    return 0;
  }
}

function calcSeasonPrepayRoutedAmount(db, businessDay) {
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM money_ledger
      WHERE kind = 'FUND'
        AND type = 'SEASON_PREPAY_DELETE'
        AND status = 'POSTED'
        AND DATE(business_day) = ?
    `).get(businessDay);
    return Math.max(0, Number(row?.total || 0));
  } catch {
    return 0;
  }
}

function clampPercent(rawValue, fallback) {
  let value = Number(rawValue);
  if (!Number.isFinite(value)) value = Number(fallback);
  if (!Number.isFinite(value)) value = 0;
  if (value < 0) value = 0;
  if (value > 0.05) value = 0.05;
  return value;
}

function parseSettings(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function loadDaySettings(db, day) {
  const locked = !!db.prepare(`
    SELECT 1
    FROM money_ledger
    WHERE business_day = ?
      AND kind = 'FUND'
      AND type IN ('WITHHOLD_WEEKLY', 'WITHHOLD_SEASON')
      AND status = 'POSTED'
    LIMIT 1
  `).get(day);
  const daySnapshot = safeTableExists(db, 'motivation_day_settings')
    ? db.prepare('SELECT settings_json FROM motivation_day_settings WHERE business_day = ?').get(day)
    : null;
  const ownerSettings = safeTableExists(db, 'owner_settings')
    ? db.prepare('SELECT settings_json FROM owner_settings WHERE id = 1').get()
    : null;
  const source = daySnapshot?.settings_json ? 'snapshot' : (locked ? 'fallback' : (ownerSettings?.settings_json ? 'owner_settings' : 'fallback'));
  const settings = { ...DEFAULT_SETTINGS, ...parseSettings(source === 'snapshot' ? daySnapshot?.settings_json : ownerSettings?.settings_json) };
  return { settings, lock: { is_locked: locked, snapshot_found: !!daySnapshot?.settings_json, settings_source: source } };
}

function getZoneK(settings, zone) {
  if (zone === 'hedgehog') return Number(settings.k_zone_hedgehog ?? 1.3);
  if (zone === 'center') return Number(settings.k_zone_center ?? 1);
  if (zone === 'sanatorium') return Number(settings.k_zone_sanatorium ?? 0.8);
  if (zone === 'stationary') return Number(settings.k_zone_stationary ?? 0.7);
  return 1;
}

function getBananaK(settings, zone) {
  if (zone === 'hedgehog') return Number(settings.k_banana_hedgehog ?? 2.7);
  if (zone === 'center') return Number(settings.k_banana_center ?? 2.2);
  if (zone === 'sanatorium') return Number(settings.k_banana_sanatorium ?? 1.2);
  if (zone === 'stationary') return Number(settings.k_banana_stationary ?? 1);
  return 1;
}

function calcPointsDelta(settings, boatType, zone, amount) {
  const revenueInK = Number(amount || 0) / 1000;
  if (!Number.isFinite(revenueInK) || revenueInK <= 0) return 0;
  if (boatType === 'speed') return roundToKopecks(revenueInK * Number(settings.k_speed ?? 1.2) * getZoneK(settings, zone));
  if (boatType === 'cruise') return roundToKopecks(revenueInK * Number(settings.k_cruise ?? 3) * getZoneK(settings, zone));
  if (boatType === 'banana') return roundToKopecks(revenueInK * getBananaK(settings, zone));
  return 0;
}

function allocateAcrossOperations(total, operations, getBasis) {
  const allocations = new Map();
  const normalizedTotal = roundToKopecks(total);
  if (!normalizedTotal || !operations.length) return allocations;
  const weighted = operations.map((op) => ({ id: op.id, basis: Math.max(0, Number(getBasis(op) || 0)) })).filter((op) => op.basis > 0);
  if (!weighted.length) {
    allocations.set(operations[0].id, normalizedTotal);
    return allocations;
  }
  const basisTotal = weighted.reduce((sum, op) => sum + op.basis, 0);
  let allocated = 0;
  weighted.forEach((op, index) => {
    const share = index === weighted.length - 1 ? roundToKopecks(normalizedTotal - allocated) : roundToKopecks((op.basis / basisTotal) * normalizedTotal);
    allocated = roundToKopecks(allocated + share);
    allocations.set(op.id, share);
  });
  return allocations;
}

function getOperationRows(db, day) {
  return db.prepare(`
    SELECT
      ml.id, ml.event_time, ml.business_day, ml.type, ml.kind, ml.method, ml.amount, ml.seller_id, ml.presale_id,
      u.username AS seller_name, u.role AS seller_role, u.zone AS seller_zone,
      p.zone_at_sale, p.total_price, p.prepayment_amount,
      COALESCE(b.type, gb.type) AS boat_type
    FROM money_ledger ml
    LEFT JOIN users u ON u.id = ml.seller_id
    LEFT JOIN presales p ON p.id = ml.presale_id
    LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
    LEFT JOIN generated_slots gs ON (p.slot_uid LIKE 'generated:%' AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER))
    LEFT JOIN boats b ON b.id = bs.boat_id
    LEFT JOIN boats gb ON gb.id = gs.boat_id
    WHERE ml.status = 'POSTED'
      AND DATE(ml.business_day) = ?
    ORDER BY ml.event_time, ml.id
  `).all(day);
}

export function buildMotivationDayBreakdown(db, day) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: 'Invalid day format (use YYYY-MM-DD)', data: null };

  const { settings, lock } = loadDaySettings(db, day);
  const mode = String(settings.motivationType || 'team');
  const operations = getOperationRows(db, day);
  const salesGross = roundToKopecks(operations.reduce((sum, row) => sum + (isRevenueType(row.type) ? Number(row.amount || 0) : 0), 0));
  const refundsTotal = roundToKopecks(operations.reduce((sum, row) => sum + (isRefundType(row.type) ? Math.abs(Number(row.amount || 0)) : 0), 0));
  const revenueTotal = Math.max(0, roundToKopecks(salesGross - refundsTotal));
  const futureTripsReserveTotal = calcFutureTripsReserveTotal(db, day);
  const salaryBase = Math.max(0, roundToKopecks(revenueTotal - futureTripsReserveTotal));
  const motivationPercent = Number(settings.motivation_percent ?? 0.15);
  const fundTotal = roundToKopecks(salaryBase * motivationPercent);

  const usersWithRevenue = db.prepare(`
    SELECT ml.seller_id, u.username, u.role, COALESCE(SUM(ml.amount), 0) AS revenue
    FROM money_ledger ml
    JOIN users u ON u.id = ml.seller_id
    WHERE ml.status = 'POSTED'
      AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
      AND DATE(ml.business_day) = ?
      AND ml.seller_id IS NOT NULL
      AND ml.seller_id > 0
      AND ml.type IN (
        'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
        'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
      )
    GROUP BY ml.seller_id, u.username, u.role
  `).all(day);
  const activeSellers = usersWithRevenue.filter((row) => String(row.role || '').toLowerCase() === 'seller').map((row) => ({ user_id: Number(row.seller_id), role: 'seller', name: row.username, revenue: Math.max(0, Number(row.revenue || 0)) }));
  const activeDispatchersRevenue = usersWithRevenue.filter((row) => String(row.role || '').toLowerCase() === 'dispatcher').map((row) => ({ user_id: Number(row.seller_id), role: 'dispatcher', name: row.username, revenue: Math.max(0, Number(row.revenue || 0)) }));
  const dispatchers = db.prepare(`SELECT id, username FROM users WHERE role = 'dispatcher' AND is_active = 1`).all();
  const personalRevenueMap = new Map([...activeSellers, ...activeDispatchersRevenue].map((row) => [row.user_id, Number(row.revenue || 0)]));
  const dispatchersById = new Map((dispatchers || []).map((row) => [Number(row.id), row]));
  const activeDispatcherIdsRaw = operations.filter((row) => isRevenueType(row.type) && String(row.seller_role || '').toLowerCase() === 'dispatcher').map((row) => Number(row.seller_id)).filter((value, index, array) => Number.isFinite(value) && value > 0 && array.indexOf(value) === index);
  const activeDispatcherIds = activeDispatcherIdsRaw.slice(0, 2);
  const activeDispatchers = activeDispatcherIds.map((id) => dispatchersById.get(id)).filter(Boolean).map((row) => ({ user_id: Number(row.id), role: 'dispatcher', name: row.username, revenue: Math.max(0, Number(personalRevenueMap.get(Number(row.id)) || 0)) }));

  const weeklyPercentConfigured = clampPercent(settings.weekly_withhold_percent_total ?? settings.weekly_percent, 0.008);
  const seasonPercent = clampPercent(settings.season_withhold_percent_total ?? settings.season_percent, 0.005);
  const dispatcherPercentConfigured = clampPercent(settings.dispatcher_withhold_percent_total, 0.002);
  const dispatcherPercentPerPerson = dispatcherPercentConfigured / 2;
  const weeklyPercentEffective = Number((weeklyPercentConfigured + (activeDispatcherIds.length === 1 ? dispatcherPercentPerPerson : 0)).toFixed(6));
  const dispatcherPercentApplied = Number((dispatcherPercentPerPerson * activeDispatcherIds.length).toFixed(6));
  const weeklyAmountRaw = roundToKopecks(revenueTotal * weeklyPercentEffective);
  const weeklyAmount = roundDownTo50(weeklyAmountRaw);
  const weeklyRoundingToSeason = roundToKopecks(Math.max(0, weeklyAmountRaw - weeklyAmount));
  const seasonAmountBase = roundToKopecks(revenueTotal * seasonPercent);
  const seasonPrepayTransfer = roundToKopecks(calcSeasonPrepayRoutedAmount(db, day));
  const dispatcherAmountPerPersonRaw = activeDispatcherIds.length > 0 ? roundToKopecks(revenueTotal * dispatcherPercentPerPerson) : 0;
  const dispatcherAmountPerPerson = activeDispatcherIds.length > 0 ? roundDownTo50(dispatcherAmountPerPersonRaw) : 0;
  const dispatcherAmountTotal = dispatcherAmountPerPerson * activeDispatcherIds.length;
  const dispatcherRoundingToSeason = roundToKopecks(Math.max(0, dispatcherAmountPerPersonRaw - dispatcherAmountPerPerson) * activeDispatcherIds.length);
  const fundAfterWithholdInitial = roundToKopecks(fundTotal - weeklyAmount - seasonAmountBase - dispatcherAmountTotal);
  const salaryFundPool = Math.max(0, roundToKopecks(fundAfterWithholdInitial));

  const sellerStates = safeTableExists(db, 'seller_motivation_state') ? new Map(db.prepare('SELECT * FROM seller_motivation_state').all().map((row) => [Number(row.seller_id), row])) : new Map();
  const sellerZones = new Map(db.prepare(`SELECT id, zone FROM users WHERE role = 'seller'`).all().map((row) => [Number(row.id), row.zone]));
  const pointsByUserMap = new Map(activeSellers.map((seller) => {
    const state = sellerStates.get(seller.user_id);
    const streakDays = state?.calibrated ? Number(state.streak_days || 0) : 0;
    return [seller.user_id, { user_id: seller.user_id, role: 'seller', name: seller.name, zone: sellerZones.get(seller.user_id) || null, points_total: 0, k_streak: getStreakMultiplier(streakDays), streak_days: streakDays }];
  }));
  if (mode === 'adaptive') {
    const pointRows = db.prepare(`
      SELECT
        ml.seller_id,
        COALESCE(b.type, gb.type) AS boat_type,
        p.zone_at_sale,
        COALESCE(SUM(CASE WHEN ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
        ) THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
        COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refunds
      FROM money_ledger ml
      LEFT JOIN presales p ON p.id = ml.presale_id
      LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id
      LEFT JOIN generated_slots gs ON (p.slot_uid LIKE 'generated:%' AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER))
      LEFT JOIN boats b ON b.id = bs.boat_id
      LEFT JOIN boats gb ON gb.id = gs.boat_id
      WHERE ml.status = 'POSTED'
        AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
        AND DATE(ml.business_day) = ?
        AND ml.seller_id IS NOT NULL
        AND ml.seller_id > 0
        AND ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE'
        )
      GROUP BY ml.seller_id, COALESCE(b.type, gb.type), p.zone_at_sale
    `).all(day);
    for (const row of pointRows || []) {
      const entry = pointsByUserMap.get(Number(row.seller_id));
      const boatType = String(row.boat_type || '').toLowerCase();
      if (!entry || !['speed', 'cruise', 'banana'].includes(boatType)) continue;
      const revenueNet = Math.max(0, Number(row.revenue_gross || 0) - Number(row.refunds || 0));
      entry.points_total = roundToKopecks(entry.points_total + calcPointsDelta(settings, boatType, row.zone_at_sale || entry.zone, revenueNet));
    }
    activeDispatchers.forEach((dispatcher) => {
      if (!pointsByUserMap.has(dispatcher.user_id)) pointsByUserMap.set(dispatcher.user_id, { user_id: dispatcher.user_id, role: 'dispatcher', name: dispatcher.name, zone: null, points_total: 0 });
    });
  }

  const rawByUserId = new Map();
  const metricByUserId = new Map();
  const ensureRaw = (member) => {
    const userId = Number(member.user_id);
    if (!rawByUserId.has(userId)) rawByUserId.set(userId, { user_id: userId, role: member.role, name: member.name, revenue: Math.max(0, Number(member.revenue || personalRevenueMap.get(userId) || 0)), team_part_raw: 0, individual_part_raw: 0, dispatcher_daily_bonus_raw: 0, total_raw: 0 });
    return rawByUserId.get(userId);
  };

  let teamShare = 0;
  let individualShare = 0;
  let teamFund = 0;
  let individualFund = 0;
  if (mode === 'personal') {
    individualShare = 1;
    individualFund = salaryFundPool;
    const totalSellerRevenue = activeSellers.reduce((sum, seller) => sum + Number(seller.revenue || 0), 0);
    activeSellers.forEach((seller) => {
      const row = ensureRaw(seller);
      metricByUserId.set(seller.user_id, Number(seller.revenue || 0));
      row.individual_part_raw = totalSellerRevenue > 0 ? roundToKopecks((Number(seller.revenue || 0) / totalSellerRevenue) * individualFund) : 0;
      row.total_raw = roundToKopecks(row.team_part_raw + row.individual_part_raw);
    });
  } else {
    if (mode === 'team') {
      teamShare = 1;
      teamFund = salaryFundPool;
    } else {
      teamShare = Number(settings.team_share ?? 0.4);
      individualShare = Number(settings.individual_share ?? 0.6);
      const shareSum = teamShare + individualShare;
      if (Math.abs(shareSum - 1) > 0.0001) {
        if (shareSum > 0) {
          teamShare /= shareSum;
          individualShare /= shareSum;
        } else {
          teamShare = 1;
          individualShare = 0;
        }
      }
      teamFund = roundToKopecks(salaryFundPool * teamShare);
      individualFund = roundToKopecks(salaryFundPool - teamFund);
    }
    const teamMembers = [
      ...(settings.teamIncludeSellers !== false ? activeSellers : []),
      ...(settings.teamIncludeDispatchers !== false ? activeDispatchers : []),
    ];
    const dispatcherWeight = Math.max(0, Number(settings.k_dispatchers ?? 1));
    const weightTotal = teamMembers.reduce((sum, member) => sum + (member.role === 'dispatcher' ? dispatcherWeight : 1), 0);
    if (weightTotal > 0 && teamFund > 0) {
      teamMembers.forEach((member) => {
        const row = ensureRaw(member);
        const weight = member.role === 'dispatcher' ? dispatcherWeight : 1;
        row.team_part_raw = roundToKopecks((weight / weightTotal) * teamFund);
        row.total_raw = roundToKopecks(row.team_part_raw + row.individual_part_raw);
      });
    }
    if (individualFund > 0) {
      const sellerMetrics = activeSellers.map((seller) => {
        const pointsTotal = Number(pointsByUserMap.get(seller.user_id)?.points_total || 0);
        const metric = mode === 'adaptive' ? Math.max(0, pointsTotal || Number(seller.revenue || 0)) : Math.max(0, Number(seller.revenue || 0));
        metricByUserId.set(seller.user_id, metric);
        return { ...seller, metric };
      });
      const metricTotal = sellerMetrics.reduce((sum, seller) => sum + Number(seller.metric || 0), 0);
      if (metricTotal > 0) {
        sellerMetrics.forEach((seller) => {
          const row = ensureRaw(seller);
          row.individual_part_raw = roundToKopecks((Number(seller.metric || 0) / metricTotal) * individualFund);
          row.total_raw = roundToKopecks(row.team_part_raw + row.individual_part_raw);
        });
      }
    }
  }
