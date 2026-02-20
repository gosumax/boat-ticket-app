/**
 * Season Stats Management
 * 
 * Pure storage/upsert module for seasonal point accumulation.
 * NO dependencies on seller-motivation-state.
 * IDEMPOTENT: uses seller_season_applied_days to prevent double-counting.
 */

/**
 * Save daily stats snapshot (idempotent - replaces if exists)
 * @param {object} db - Database instance
 * @param {string} businessDay - YYYY-MM-DD
 * @param {Array} rows - Array of { seller_id, revenue_day, points_day_total }
 */
export function saveDayStats(db, businessDay, rows) {
  if (!rows || rows.length === 0) return;
  
  for (const row of rows) {
    const sellerId = Number(row.seller_id);
    const revenueDay = Number(row.revenue_day || 0);
    const pointsDayTotal = Number(row.points_day_total || 0);
    
    // UPSERT: replace if exists (idempotent daily snapshot)
    db.prepare(`
      INSERT INTO seller_day_stats (business_day, seller_id, revenue_day, points_day_total)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(business_day, seller_id) DO UPDATE SET
        revenue_day = excluded.revenue_day,
        points_day_total = excluded.points_day_total
    `).run(businessDay, sellerId, revenueDay, pointsDayTotal);
  }
}

/**
 * Update seller season stats from daily snapshot (idempotent)
 * Uses seller_season_applied_days to prevent double-counting.
 * @param {object} db - Database instance
 * @param {string} businessDay - YYYY-MM-DD
 */
export function updateSeasonStatsFromDay(db, businessDay) {
  const seasonId = businessDay.substring(0, 4); // YYYY
  
  console.log(`[SEASON_STATS] Applying day ${businessDay} to season ${seasonId}`);
  
  // Get all day stats for this business_day
  const dayStats = db.prepare(`
    SELECT seller_id, revenue_day, points_day_total
    FROM seller_day_stats
    WHERE business_day = ?
  `).all(businessDay);
  
  if (!dayStats || dayStats.length === 0) {
    console.log(`[SEASON_STATS] No day stats found for ${businessDay}`);
    return;
  }
  
  let appliedCount = 0;
  
  for (const row of dayStats) {
    const sellerId = Number(row.seller_id);
    const revenueDay = Number(row.revenue_day || 0);
    const pointsDayTotal = Number(row.points_day_total || 0);
    
    // Check if already applied (idempotency)
    const alreadyApplied = db.prepare(`
      SELECT 1 FROM seller_season_applied_days
      WHERE season_id = ? AND business_day = ? AND seller_id = ?
    `).get(seasonId, businessDay, sellerId);
    
    if (alreadyApplied) {
      // Already counted - skip
      continue;
    }
    
    // Mark as applied FIRST (primary key ensures atomicity)
    try {
      db.prepare(`
        INSERT INTO seller_season_applied_days (season_id, business_day, seller_id)
        VALUES (?, ?, ?)
      `).run(seasonId, businessDay, sellerId);
    } catch (e) {
      // Race condition or duplicate - skip increment
      continue;
    }
    
    // NOW increment season stats
    const existing = db.prepare(`
      SELECT * FROM seller_season_stats WHERE seller_id = ? AND season_id = ?
    `).get(sellerId, seasonId);
    
    if (existing) {
      db.prepare(`
        UPDATE seller_season_stats 
        SET revenue_total = revenue_total + ?,
            points_total = points_total + ?
        WHERE seller_id = ? AND season_id = ?
      `).run(revenueDay, pointsDayTotal, sellerId, seasonId);
    } else {
      db.prepare(`
        INSERT INTO seller_season_stats (seller_id, season_id, revenue_total, points_total)
        VALUES (?, ?, ?, ?)
      `).run(sellerId, seasonId, revenueDay, pointsDayTotal);
    }
    
    appliedCount++;
  }
  
  console.log(`[SEASON_STATS] Applied ${appliedCount} sellers from day ${businessDay} to season ${seasonId}`);
}

export default {
  saveDayStats,
  updateSeasonStatsFromDay
};
