/**
 * motivation/engine.mjs
 * Core motivation calculation engine - reusable across endpoints.
 * Extracted from owner.mjs to avoid formula duplication.
 */

import { getStreakMultiplier, getSellerState } from '../seller-motivation-state.mjs';
import { roundDownTo50 } from '../utils/money-rounding.mjs';

// Default settings (synced with owner.mjs)
export const OWNER_SETTINGS_DEFAULTS = {
  // Business settings
  businessName: "Морские прогулки",
  timezone: "Europe/Moscow (UTC+3)",
  currency: "RUB",
  seasonStart: "2026-05-01",
  seasonEnd: "2026-10-01",
  
  // Analytics thresholds
  badDay: 350000,
  normalDay: 550000,
  goodDay: 800000,
  baseCompareDays: 7,
  
  // Motivation settings (final system) - stored as fractions
  motivationType: "team",
  motivation_percent: 0.15,
  individual_share: 0.60,
  team_share: 0.40,
  daily_activation_threshold: 200000,
  seller_series_threshold: 40000,
  dispatchers_series_threshold: 55000,
  season_min_days_N: 1,
  
  // Team participation
  teamIncludeSellers: true,
  teamIncludeDispatchers: true,
  
  // Product coefficients
  k_speed: 1.2,
  k_cruise: 3.0,
  k_fishing: 5.0,
  k_zone_hedgehog: 1.3,
  k_zone_center: 1.0,
  k_zone_sanatorium: 0.8,
  k_zone_stationary: 0.7,
  k_banana_hedgehog: 2.7,
  k_banana_center: 2.2,
  k_banana_sanatorium: 1.2,
  k_banana_stationary: 1.0,
  k_dispatchers: 1.0,
  
  // Triggers/notifications
  lowLoad: 45,
  highLoad: 85,
  minSellerRevenue: 30000,
  notifyBadRevenue: true,
  notifyLowLoad: true,
  notifyLowSeller: false,
  notifyChannel: "inapp",
  
  // Withhold settings (USED FOR LEDGER ENTRIES)
  dispatcher_withhold_percent_total: 0.002,   // 0.2% total cap for dispatcher withhold
  weekly_withhold_percent_total: 0.008,       // 0.8% withhold for weekly pool
  season_withhold_percent_total: 0.005        // 0.5% withhold for season pool
};

/**
 * Calculate motivation payouts for a specific business day.
 * This is the core calculation engine used by both owner and dispatcher endpoints.
 * 
 * @param {Object} db - better-sqlite3 database instance
 * @param {string} day - Business day in YYYY-MM-DD format
 * @returns {Object} Motivation data with payouts array
 */
export function calcMotivationDay(db, day) {
  const warnings = [];
  
  // Validate date format
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { error: 'Invalid day format (use YYYY-MM-DD)', data: null };
  }
  
  // ====================
  // STEP 0: Check if day is LOCKED (has WITHHOLD entries)
  // ====================
  const lockedDayRow = db.prepare(`
    SELECT 1 FROM money_ledger
    WHERE business_day = ? AND kind = 'FUND' AND type IN ('WITHHOLD_WEEKLY', 'WITHHOLD_SEASON') AND status = 'POSTED'
    LIMIT 1
  `).get(day);
  
  const isLocked = !!lockedDayRow;
  
  // ====================
  // STEP 1: Get or create day settings snapshot
  // ====================
  let daySettingsRow = db.prepare('SELECT settings_json FROM motivation_day_settings WHERE business_day = ?').get(day);
  let settings;
  let snapshotFound = false;
  let settingsSource = 'fallback';
  
  if (daySettingsRow?.settings_json) {
    settings = JSON.parse(daySettingsRow.settings_json);
    snapshotFound = true;
    settingsSource = 'snapshot';
  } else if (isLocked) {
    // Locked day without snapshot - use defaults (will be flagged in invariants)
    settings = { ...OWNER_SETTINGS_DEFAULTS };
    settingsSource = 'fallback';
    warnings.push('Locked day has no settings snapshot');
  } else {
    const ownerRow = db.prepare("SELECT settings_json FROM owner_settings WHERE id = 1").get();
    const savedSettings = ownerRow?.settings_json ? JSON.parse(ownerRow.settings_json) : {};
    settings = { ...OWNER_SETTINGS_DEFAULTS, ...savedSettings };
    settingsSource = 'owner_settings';
    
    const now = new Date().toISOString();
    try {
      db.prepare('INSERT INTO motivation_day_settings (business_day, settings_json, created_at) VALUES (?, ?, ?)').run(day, JSON.stringify(settings), now);
    } catch (e) {
      // Snapshot may exist from concurrent call - ignore
    }
  }
  
  // Guard: ensure settings is always a valid object (defensive, no mutation of defaults)
  settings = { ...OWNER_SETTINGS_DEFAULTS, ...(settings || {}) };
  
  const mode = settings.motivationType || 'team';
  const p = Number(settings.motivation_percent ?? 0.15);
  const fundPercent = Math.round(p * 100);
  
  // ====================
  // STEP 2: Calculate revenue for the day
  // ====================
  const revenueRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
      COALESCE(SUM(CASE WHEN ml.type = 'SALE_CANCEL_REVERSE' THEN ABS(ml.amount) ELSE 0 END), 0) AS refunds
    FROM money_ledger ml
    WHERE ml.status = 'POSTED'
      AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
      AND DATE(ml.business_day) = ?
  `).get(day);
  
  const revenue_total = Math.max(0, Number(revenueRow?.revenue_gross || 0) - Number(revenueRow?.refunds || 0));
  const fundTotal = Math.round(revenue_total * p);
  
  // ====================
  // STEP 2.5: Calculate WITHHOLDS from fundTotal
  // ====================
  const MAX_ACTIVE_DISPATCHERS = 2;
  
  // Read weekly withhold percent from settings (with validation)
  let weeklyPercentTotal = Number(settings.weekly_withhold_percent_total);
  if (isNaN(weeklyPercentTotal) || weeklyPercentTotal === null) weeklyPercentTotal = 0.008;
  if (weeklyPercentTotal < 0) weeklyPercentTotal = 0;
  if (weeklyPercentTotal > 0.05) weeklyPercentTotal = 0.05; // max 5%
  
  // Read season withhold percent from settings (with validation)
  let seasonPercentTotal = Number(settings.season_withhold_percent_total);
  if (isNaN(seasonPercentTotal) || seasonPercentTotal === null) seasonPercentTotal = 0.005;
  if (seasonPercentTotal < 0) seasonPercentTotal = 0;
  if (seasonPercentTotal > 0.05) seasonPercentTotal = 0.05; // max 5%
  
  // Read dispatcher withhold percent from settings (with validation)
  let dispatcherPercentTotal = Number(settings.dispatcher_withhold_percent_total);
  if (isNaN(dispatcherPercentTotal) || dispatcherPercentTotal === null) dispatcherPercentTotal = 0.002;
  if (dispatcherPercentTotal < 0) dispatcherPercentTotal = 0;
  if (dispatcherPercentTotal > 0.05) dispatcherPercentTotal = 0.05; // max 5%
  const dispatcherPercentPerPerson = dispatcherPercentTotal / 2;
  
  // Find dispatchers with sales TODAY (active_dispatchers_today)
  // A dispatcher is "active today" if they have sales in money_ledger with seller_id = dispatcher.id
  const dispatchersWithSalesTodayRaw = db.prepare(`
    SELECT DISTINCT ml.seller_id
    FROM money_ledger ml
    JOIN users u ON u.id = ml.seller_id
    WHERE ml.status = 'POSTED'
      AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
      AND DATE(ml.business_day) = ?
      AND ml.seller_id IS NOT NULL
      AND ml.seller_id > 0
      AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED')
      AND u.role = 'dispatcher'
  `).all(day);
  
  const activeDispatchersTodayIdsRaw = (dispatchersWithSalesTodayRaw || []).map(r => Number(r.seller_id));
  // Cap to max 2 active dispatchers
  const activeDispatchersTodayIds = activeDispatchersTodayIdsRaw.slice(0, MAX_ACTIVE_DISPATCHERS);
  const activeDispatchersTodayCount = activeDispatchersTodayIds.length;
  
  // Calculate withhold amounts (all rounded down to 50)
  const weekly_withhold_amount = roundDownTo50(fundTotal * weeklyPercentTotal);
  const season_withhold_amount = roundDownTo50(fundTotal * seasonPercentTotal);
  
  // Dispatcher withhold: per-person percent (capped to max 2)
  const dispatcher_withhold_per_person = activeDispatchersTodayCount > 0 ? roundDownTo50(fundTotal * dispatcherPercentPerPerson) : 0;
  const dispatcher_withhold_amounts = activeDispatchersTodayIds.map(dispatcherId => ({
    dispatcher_id: dispatcherId,
    amount: dispatcher_withhold_per_person
  }));
  const dispatcher_withhold_total = dispatcher_withhold_amounts.reduce((sum, d) => sum + d.amount, 0);
  
  // Fund after withhold
  const fundTotal_after_withhold = fundTotal - weekly_withhold_amount - season_withhold_amount - dispatcher_withhold_total;
  
  // ====================
  // STEP 3: Get sellers with revenue for the day
  // ====================
  const sellersWithRevenue = db.prepare(`
    SELECT
      ml.seller_id,
      u.username,
      COALESCE(SUM(ml.amount), 0) AS revenue
    FROM money_ledger ml
    JOIN users u ON u.id = ml.seller_id
    WHERE ml.status = 'POSTED'
      AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
      AND DATE(ml.business_day) = ?
      AND ml.seller_id IS NOT NULL
      AND ml.seller_id > 0
      AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED')
    GROUP BY ml.seller_id
  `).all(day);
  
  const activeSellersList = (sellersWithRevenue || []).map(r => ({
    user_id: Number(r.seller_id),
    name: r.username,
    revenue: Math.max(0, Number(r.revenue || 0))
  }));
  
  // ====================
  // STEP 4: Get active dispatchers
  // ====================
  const dispatchersList = db.prepare(`
    SELECT id, username
    FROM users
    WHERE role = 'dispatcher' AND is_active = 1
  `).all();
  
  const sellerUserIds = new Set(activeSellersList.map(s => s.user_id));
  const pureDispatchersList = (dispatchersList || []).filter(d => !sellerUserIds.has(Number(d.id)));
  
  let active_dispatchers = pureDispatchersList.length;
  let active_sellers = activeSellersList.length;
  
  // ====================
  // STEP 4.5: Build revenue map
  // ====================
  const personalRevenueMap = new Map();
  for (const seller of activeSellersList) {
    personalRevenueMap.set(seller.user_id, seller.revenue);
  }
  
  // ====================
  // STEP 5: Build payouts based on mode
  // ====================
  let payouts = [];
  let participants = 0;
  let team_share = 0;
  let individual_share = 0;
  let teamFund = 0;
  let individualFund = 0;
  let teamPerPerson = 0;
  
  if (mode === 'personal') {
    participants = active_sellers;
    active_dispatchers = 0;
    
    payouts = activeSellersList.map(seller => {
      const pay = Math.round(seller.revenue * p);
      return {
        user_id: seller.user_id,
        role: 'seller',
        name: seller.name,
        revenue: seller.revenue,
        team_part: 0,
        individual_part: pay,
        total: pay
      };
    });
    
  } else if (mode === 'team') {
    const teamIncludeSellers = settings.teamIncludeSellers !== false;
    const teamIncludeDispatchers = settings.teamIncludeDispatchers !== false;
    
    const teamMembersMap = new Map();
    
    if (teamIncludeSellers) {
      activeSellersList.forEach(s => {
        teamMembersMap.set(s.user_id, {
          user_id: s.user_id,
          role: 'seller',
          name: s.name,
          revenue: s.revenue
        });
      });
    }
    
    if (teamIncludeDispatchers) {
      (dispatchersList || []).forEach(d => {
        const uid = Number(d.id);
        if (!teamMembersMap.has(uid)) {
          teamMembersMap.set(uid, {
            user_id: uid,
            role: 'dispatcher',
            name: d.username,
            revenue: 0
          });
        }
      });
    }
    
    const teamMembers = Array.from(teamMembersMap.values());
    participants = teamMembers.length;
    
    if (participants > 0) {
      teamPerPerson = Math.round(fundTotal / participants);
      
      payouts = teamMembers.map(m => ({
        user_id: m.user_id,
        role: m.role,
        name: m.name,
        revenue: m.revenue,
        team_part: teamPerPerson,
        individual_part: 0,
        total: teamPerPerson
      }));
    } else {
      warnings.push('Нет участников для распределения фонда');
    }
    
  } else if (mode === 'adaptive') {
    team_share = Number(settings.team_share ?? 0.4);
    individual_share = Number(settings.individual_share ?? 0.6);
    
    const shareSum = team_share + individual_share;
    if (Math.abs(shareSum - 1) > 0.0001) {
      if (shareSum > 0) {
        team_share = team_share / shareSum;
        individual_share = individual_share / shareSum;
      } else {
        team_share = 1;
        individual_share = 0;
      }
    }
    
    teamFund = Math.round(fundTotal * team_share);
    individualFund = Math.round(fundTotal * individual_share);
    
    const teamIncludeSellers = settings.teamIncludeSellers !== false;
    const teamIncludeDispatchers = settings.teamIncludeDispatchers !== false;
    
    const teamMembersMap = new Map();
    
    if (teamIncludeSellers) {
      activeSellersList.forEach(s => {
        teamMembersMap.set(s.user_id, {
          user_id: s.user_id,
          role: 'seller',
          name: s.name,
          revenue: s.revenue
        });
      });
    }
    
    if (teamIncludeDispatchers) {
      (dispatchersList || []).forEach(d => {
        const uid = Number(d.id);
        if (!teamMembersMap.has(uid)) {
          teamMembersMap.set(uid, {
            user_id: uid,
            role: 'dispatcher',
            name: d.username,
            revenue: 0
          });
        }
      });
    }
    
    const teamMembers = Array.from(teamMembersMap.values());
    participants = teamMembers.length;
    
    if (participants > 0) {
      teamPerPerson = Math.round(teamFund / participants);
    }
    
    const k_dispatchers = Number(settings.k_dispatchers ?? 1.0);
    
    const sellersWithWeight = activeSellersList.map(s => {
      const weighted_revenue = Math.round(s.revenue * k_dispatchers);
      return { ...s, weighted_revenue };
    });
    
    const W_total = sellersWithWeight.reduce((sum, s) => sum + s.weighted_revenue, 0);
    
    payouts = teamMembers.map(m => {
      const team_part = teamPerPerson;
      let individual_part = 0;
      let weighted_revenue = null;
      
      if (m.role === 'seller') {
        const sellerData = sellersWithWeight.find(s => s.user_id === m.user_id);
        if (sellerData) {
          weighted_revenue = sellerData.weighted_revenue;
          if (W_total > 0) {
            individual_part = Math.round((weighted_revenue / W_total) * individualFund);
          }
        }
      }
      
      return {
        user_id: m.user_id,
        role: m.role,
        name: m.name,
        revenue: m.revenue,
        ...(weighted_revenue !== null ? { weighted_revenue } : {}),
        team_part,
        individual_part,
        total: team_part + individual_part
      };
    });
  }
  
  // ====================
  // STEP 5.5: Calculate POINTS (adaptive mode only)
  // ====================
  let pointsByUserMap = new Map();
  let points_by_user = [];
  
  if (mode === 'adaptive') {
    const revenueBySellerAndType = db.prepare(`
      SELECT
        ml.seller_id,
        COALESCE(b.type, gb.type) AS boat_type,
        p.zone_at_sale,
        COALESCE(SUM(CASE WHEN ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED') THEN ml.amount ELSE 0 END), 0) AS revenue_gross,
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
        AND ml.type IN ('SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED','SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED','SALE_CANCEL_REVERSE')
      GROUP BY ml.seller_id, COALESCE(b.type, gb.type), p.zone_at_sale
    `).all(day);
    
    const sellerZones = db.prepare(`SELECT id, zone FROM users WHERE role = 'seller'`).all();
    const sellerZoneMap = new Map((sellerZones || []).map(r => [Number(r.id), r.zone]));
    
    const k_speed = Number(settings.k_speed ?? 1.2);
    const k_cruise = Number(settings.k_cruise ?? 3.0);
    const k_zone_hedgehog = Number(settings.k_zone_hedgehog ?? 1.3);
    const k_zone_center = Number(settings.k_zone_center ?? 1.0);
    const k_zone_sanatorium = Number(settings.k_zone_sanatorium ?? 0.8);
    const k_zone_stationary = Number(settings.k_zone_stationary ?? 0.7);
    const k_banana_hedgehog = Number(settings.k_banana_hedgehog ?? 2.7);
    const k_banana_center = Number(settings.k_banana_center ?? 2.2);
    const k_banana_sanatorium = Number(settings.k_banana_sanatorium ?? 1.2);
    const k_banana_stationary = Number(settings.k_banana_stationary ?? 1.0);
    
    const getZoneK = (zone) => {
      if (zone === 'hedgehog') return k_zone_hedgehog;
      if (zone === 'center') return k_zone_center;
      if (zone === 'sanatorium') return k_zone_sanatorium;
      if (zone === 'stationary') return k_zone_stationary;
      return 1.0;
    };
    
    const getBananaK = (zone) => {
      if (zone === 'hedgehog') return k_banana_hedgehog;
      if (zone === 'center') return k_banana_center;
      if (zone === 'sanatorium') return k_banana_sanatorium;
      if (zone === 'stationary') return k_banana_stationary;
      return 1.0;
    };
    
    pointsByUserMap = new Map();
    
    activeSellersList.forEach(s => {
      const zone = sellerZoneMap.get(s.user_id) || null;
      const state = getSellerState(s.user_id);
      const streakDays = state?.calibrated ? (state.streak_days || 0) : 0;
      const kStreak = getStreakMultiplier(streakDays);
      pointsByUserMap.set(s.user_id, {
        user_id: s.user_id,
        role: 'seller',
        name: s.name,
        zone,
        revenue_total: s.revenue,
        revenue_by_type: { speed: 0, cruise: 0, banana: 0 },
        points_by_type: { speed: 0, cruise: 0, banana: 0 },
        points_base: 0,
        points_total: 0,
        calibrated: state?.calibrated || 0,
        current_level: state?.current_level || 'NONE',
        streak_days: streakDays,
        k_streak: kStreak
      });
    });
    
    for (const row of (revenueBySellerAndType || [])) {
      const sellerId = Number(row.seller_id);
      const boatType = row.boat_type || null;
      const zoneAtSale = row.zone_at_sale || null;
      const revenueGross = Number(row.revenue_gross || 0);
      const refunds = Number(row.refunds || 0);
      const revenueNet = Math.max(0, revenueGross - refunds);
      
      if (!boatType || !['speed', 'cruise', 'banana'].includes(boatType)) continue;
      
      let entry = pointsByUserMap.get(sellerId);
      if (!entry) {
        const zone = sellerZoneMap.get(sellerId) || null;
        const state = getSellerState(sellerId);
        const streakDays = state?.calibrated ? (state.streak_days || 0) : 0;
        const kStreak = getStreakMultiplier(streakDays);
        entry = {
          user_id: sellerId,
          role: 'seller',
          name: `Seller #${sellerId}`,
          zone,
          revenue_total: 0,
          revenue_by_type: { speed: 0, cruise: 0, banana: 0 },
          points_by_type: { speed: 0, cruise: 0, banana: 0 },
          points_base: 0,
          points_total: 0,
          calibrated: state?.calibrated || 0,
          current_level: state?.current_level || 'NONE',
          streak_days: streakDays,
          k_streak: kStreak
        };
        pointsByUserMap.set(sellerId, entry);
      }
      
      entry.revenue_by_type[boatType] += revenueNet;
      entry.revenue_total += revenueNet;
      
      const effectiveZone = zoneAtSale || entry.zone;
      const revenueInK = revenueNet / 1000;
      let pointsBase = 0;
      
      if (boatType === 'speed') {
        pointsBase = revenueInK * k_speed * getZoneK(effectiveZone);
      } else if (boatType === 'cruise') {
        pointsBase = revenueInK * k_cruise * getZoneK(effectiveZone);
      } else if (boatType === 'banana') {
        pointsBase = revenueInK * getBananaK(effectiveZone);
      }
      
      entry.points_by_type[boatType] += pointsBase;
      entry.points_base += pointsBase;
    }
    
    for (const [sellerId, entry] of pointsByUserMap) {
      if (entry.role === 'seller') {
        entry.points_total = Math.round(entry.points_base * entry.k_streak * 100) / 100;
      }
    }
    
    for (const d of (dispatchersList || [])) {
      const uid = Number(d.id);
      if (!pointsByUserMap.has(uid)) {
        pointsByUserMap.set(uid, {
          user_id: uid,
          role: 'dispatcher',
          name: d.username,
          zone: null,
          revenue_total: 0,
          revenue_by_type: { speed: 0, cruise: 0, banana: 0 },
          points_by_type: { speed: 0, cruise: 0, banana: 0 },
          points_base: 0,
          points_total: 0,
          calibrated: 0,
          current_level: 'NONE',
          streak_days: 0,
          k_streak: 1.0
        });
      }
    }
    
    points_by_user = Array.from(pointsByUserMap.values());
  }
  
  // ====================
  // STEP 5.6: Dispatcher Daily Bonus
  // ====================
  const DISPATCHER_DAILY_PERCENT = 0.001;
  
  const activeDispatchersWithRevenue = (dispatchersList || []).filter(d => {
    const dispatcherId = Number(d.id);
    const personalRevenue = personalRevenueMap.get(dispatcherId) || 0;
    return personalRevenue > 0;
  });
  
  const activeDispatchersCount = activeDispatchersWithRevenue.length;
  const dispatcherDailyBonus = activeDispatchersCount > 0 ? roundDownTo50(revenue_total * DISPATCHER_DAILY_PERCENT) : 0;
  const dispatcherDailyBonusTotal = activeDispatchersCount * dispatcherDailyBonus;
  
  const activeDispatcherUserIds = new Set(activeDispatchersWithRevenue.map(d => Number(d.id)));
  
  const payoutsWithDispatcherBonus = (Array.isArray(payouts) ? payouts : []).map(payout => {
    const personalRevenue = personalRevenueMap.get(payout.user_id) || 0;
    const isActiveDispatcher = activeDispatcherUserIds.has(payout.user_id);
    return {
      ...payout,
      dispatcher_daily_bonus: isActiveDispatcher ? dispatcherDailyBonus : 0,
      personal_revenue_day: personalRevenue
    };
  });
  
  payouts = payoutsWithDispatcherBonus;
  
  // ====================
  // STEP 5.7: Apply rounding to payouts
  // ====================
  payouts = payouts.map(p => ({
    ...p,
    total: roundDownTo50(p.total),
    individual_part: roundDownTo50(p.individual_part),
    team_part: roundDownTo50(p.team_part),
    dispatcher_daily_bonus: roundDownTo50(p.dispatcher_daily_bonus)
  }));
  
  // ====================
  // STEP 6: Build response
  // ====================
  const safeNum = (val) => Number.isFinite(Number(val)) ? Number(val) : 0;
  const safeWarnings = Array.isArray(warnings) ? warnings : [];
  
  const meaningfulPayouts = (Array.isArray(payouts) ? payouts : [])
    .filter(p => safeNum(p?.total) > 0);
  
  const payoutsWithPoints = meaningfulPayouts.map(payout => {
    const pointsEntry = pointsByUserMap.get(payout.user_id);
    return {
      ...payout,
      points_total: mode === 'adaptive' ? (pointsEntry?.points_total ?? 0) : 0,
      zone: mode === 'adaptive' ? (pointsEntry?.zone ?? null) : null
    };
  });
  
  const safeRevenueTotal = safeNum(revenue_total);
  const safeFundTotal = safeNum(fundTotal);
  const safeFundPercent = safeNum(fundPercent);
  const safeMotivationPercent = safeNum(p);
  const safeTeamPerPerson = safeNum(teamPerPerson);
  
  const finalParticipants = meaningfulPayouts.length;
  const finalActiveSellers = meaningfulPayouts.filter(p => p?.role === 'seller').length;
  const finalActiveDispatchers = meaningfulPayouts.filter(p => p?.role === 'dispatcher').length;
  
  const data = {
    business_day: day,
    mode,
    revenue_total: safeRevenueTotal,
    motivation_percent: safeMotivationPercent,
    fundPercent: safeFundPercent,
    fundTotal: safeFundTotal,
    participants: finalParticipants,
    active_sellers: finalActiveSellers,
    active_dispatchers: finalActiveDispatchers,
    dispatcher_daily_percent: DISPATCHER_DAILY_PERCENT,
    active_dispatchers_count: activeDispatchersCount,
    dispatcher_daily_bonus_total: dispatcherDailyBonusTotal,
    payouts: payoutsWithPoints,
    points_enabled: mode === 'adaptive',
    points_rule: mode === 'adaptive' ? 'v3_zone_at_sale_fallback_user_zone_streak_multiplier' : null,
    points_by_user: mode === 'adaptive' ? points_by_user : [],
    // Additional mode-specific fields
    team_share,
    individual_share,
    teamFund,
    individualFund,
    teamPerPerson: safeTeamPerPerson,
    // NEW: Withhold breakdown
    withhold: {
      weekly_percent: weeklyPercentTotal,
      season_percent: seasonPercentTotal,
      dispatcher_percent_total: dispatcherPercentTotal,
      dispatcher_percent_per_person: dispatcherPercentPerPerson,
      weekly_amount: weekly_withhold_amount,
      season_amount: season_withhold_amount,
      dispatcher_amount_total: dispatcher_withhold_total,
      fund_total_original: safeFundTotal,
      fund_total_after_withhold: fundTotal_after_withhold
    },
    // NEW: Dispatchers with sales today
    dispatchers_today: {
      active_ids: activeDispatchersTodayIds,
      active_count: activeDispatchersTodayCount,
      active_ids_raw_count: activeDispatchersTodayIdsRaw.length,
      per_dispatcher_percent: dispatcherPercentPerPerson,
      per_dispatcher_amounts: dispatcher_withhold_amounts
    },
    // NEW: Effective settings used for withhold calculation
    settings_effective: {
      weekly_withhold_percent_total: weeklyPercentTotal,
      season_withhold_percent_total: seasonPercentTotal,
      dispatcher_withhold_percent_total: dispatcherPercentTotal,
      dispatcher_withhold_percent_per_person: dispatcherPercentPerPerson
    },
    // NEW: Lock status for immutability
    lock: {
      is_locked: isLocked,
      snapshot_found: snapshotFound,
      settings_source: settingsSource
    }
  };
  
  // Clean up mode-inappropriate fields
  if (mode === 'personal') {
    delete data.teamPerPerson;
    delete data.team_share;
    delete data.individual_share;
    delete data.teamFund;
    delete data.individualFund;
  } else if (mode === 'team') {
    delete data.team_share;
    delete data.individual_share;
    delete data.teamFund;
    delete data.individualFund;
  }
  
  return { data, warnings: safeWarnings, error: null };
}

export default { calcMotivationDay, OWNER_SETTINGS_DEFAULTS };
