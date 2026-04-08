const WORKED_DAY_MIN_SEATS = 5;

function safeTableExists(db, tableName) {
  try {
    return !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1")
      .get(tableName);
  } catch {
    return false;
  }
}

function safeGetColumns(db, tableName) {
  try {
    if (!safeTableExists(db, tableName)) return new Set();
    const rows = db.prepare(`PRAGMA table_info('${tableName}')`).all();
    return new Set((rows || []).map((row) => row.name));
  } catch {
    return new Set();
  }
}

function hasCol(cols, columnName) {
  return cols && cols.has(columnName);
}

function normalizeBusinessDay(value) {
  const day = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function normalizeSellerId(value) {
  const sellerId = Number(value);
  return Number.isInteger(sellerId) && sellerId > 0 ? sellerId : null;
}

function buildSlotCompletedPredicate(alias, cols) {
  const checks = [];
  if (hasCol(cols, 'is_completed')) {
    checks.push(`COALESCE(${alias}.is_completed, 0) = 1`);
  }
  if (hasCol(cols, 'status')) {
    checks.push(`COALESCE(${alias}.status, '') = 'COMPLETED'`);
  }
  if (checks.length === 0) return '0 = 1';
  return `(${checks.join(' OR ')})`;
}

function buildSeatCountExpr(stcCols, presaleCols) {
  if (hasCol(stcCols, 'qty')) {
    return 'CAST(COALESCE(stc.qty, 0) AS INTEGER)';
  }

  if (hasCol(stcCols, 'ticket_id')) {
    if (hasCol(presaleCols, 'number_of_seats')) {
      return `
        CASE
          WHEN stc.ticket_id IS NOT NULL THEN 1
          ELSE CAST(COALESCE(p.number_of_seats, 1) AS INTEGER)
        END
      `;
    }
    return 'CASE WHEN stc.ticket_id IS NOT NULL THEN 1 ELSE 1 END';
  }

  if (hasCol(presaleCols, 'number_of_seats')) {
    return 'CAST(COALESCE(p.number_of_seats, 1) AS INTEGER)';
  }

  return '1';
}

function buildCompletedBaseSource(db) {
  const stcCols = safeGetColumns(db, 'sales_transactions_canonical');
  const presaleCols = safeGetColumns(db, 'presales');
  const generatedSlotCols = safeGetColumns(db, 'generated_slots');
  const boatSlotCols = safeGetColumns(db, 'boat_slots');

  const hasCanonicalSource =
    safeTableExists(db, 'sales_transactions_canonical') &&
    safeTableExists(db, 'presales') &&
    hasCol(stcCols, 'presale_id') &&
    hasCol(stcCols, 'business_day') &&
    hasCol(stcCols, 'amount') &&
    hasCol(stcCols, 'cash_amount') &&
    hasCol(stcCols, 'card_amount') &&
    hasCol(presaleCols, 'seller_id');

  if (!hasCanonicalSource) {
    return null;
  }

  const hasSlotUid = hasCol(presaleCols, 'slot_uid');
  const hasBoatSlotId = hasCol(presaleCols, 'boat_slot_id');
  const generatedJoinSql = hasSlotUid && safeTableExists(db, 'generated_slots')
    ? `
      LEFT JOIN generated_slots gs
        ON p.slot_uid LIKE 'generated:%'
       AND gs.id = CAST(substr(p.slot_uid, 11) AS INTEGER)
    `
    : '';
  const boatJoinSql = hasBoatSlotId && safeTableExists(db, 'boat_slots')
    ? 'LEFT JOIN boat_slots bs ON bs.id = p.boat_slot_id'
    : '';

  const generatedCompletedPredicate = generatedJoinSql
    ? buildSlotCompletedPredicate('gs', generatedSlotCols)
    : '0 = 1';
  const boatCompletedPredicate = boatJoinSql
    ? buildSlotCompletedPredicate('bs', boatSlotCols)
    : '0 = 1';

  const completedTripPredicate = hasSlotUid
    ? `(
        (p.slot_uid LIKE 'generated:%' AND ${generatedCompletedPredicate})
        OR
        ((p.slot_uid IS NULL OR p.slot_uid NOT LIKE 'generated:%') AND ${boatCompletedPredicate})
      )`
    : boatCompletedPredicate;

  const canonicalStatusPredicate = hasCol(stcCols, 'status')
    ? "AND stc.status = 'VALID'"
    : '';
  const presaleStatusPredicate = hasCol(presaleCols, 'status')
    ? "AND COALESCE(p.status, 'ACTIVE') NOT IN ('CANCELLED', 'CANCELLED_TRIP_PENDING', 'REFUNDED')"
    : '';

  return {
    boatJoinSql,
    canonicalStatusPredicate,
    completedTripPredicate,
    generatedJoinSql,
    presaleStatusPredicate,
    seatCountExpr: buildSeatCountExpr(stcCols, presaleCols),
  };
}

function toMetricRow(row, fallback = {}) {
  const sellerId = normalizeSellerId(row?.seller_id ?? fallback.seller_id);
  const businessDay = normalizeBusinessDay(row?.business_day ?? fallback.business_day);
  const completedFullyPaidSeats = Math.max(0, Number(row?.completed_fully_paid_seats || 0));
  const completedFinishedRevenue = Math.max(0, Number(row?.completed_finished_revenue || 0));

  return {
    seller_id: sellerId,
    business_day: businessDay,
    completed_finished_revenue: completedFinishedRevenue,
    completed_fully_paid_seats: completedFullyPaidSeats,
    worked_day: completedFullyPaidSeats >= WORKED_DAY_MIN_SEATS,
  };
}

function zeroMetricRow({ sellerId = null, businessDay = null } = {}) {
  return {
    seller_id: normalizeSellerId(sellerId),
    business_day: normalizeBusinessDay(businessDay),
    completed_finished_revenue: 0,
    completed_fully_paid_seats: 0,
    worked_day: false,
  };
}

export function listSellerCompletedDailyMetrics(db, { sellerId = null, dateFrom, dateTo } = {}) {
  const normalizedDateFrom = normalizeBusinessDay(dateFrom);
  const normalizedDateTo = normalizeBusinessDay(dateTo);
  const normalizedSellerId = sellerId == null ? null : normalizeSellerId(sellerId);

  if (!normalizedDateFrom || !normalizedDateTo || (sellerId != null && normalizedSellerId == null)) {
    return [];
  }

  const source = buildCompletedBaseSource(db);
  if (!source) {
    return [];
  }

  const where = [
    'DATE(stc.business_day) BETWEEN ? AND ?',
    '(COALESCE(stc.amount, 0) > 0)',
    '(COALESCE(stc.cash_amount, 0) + COALESCE(stc.card_amount, 0) >= COALESCE(stc.amount, 0))',
    source.completedTripPredicate,
  ];
  const params = [normalizedDateFrom, normalizedDateTo];

  if (normalizedSellerId != null) {
    where.push('p.seller_id = ?');
    params.push(normalizedSellerId);
  }

  const rows = db.prepare(`
    SELECT
      p.seller_id AS seller_id,
      DATE(stc.business_day) AS business_day,
      COALESCE(SUM(stc.amount), 0) AS completed_finished_revenue,
      COALESCE(SUM(${source.seatCountExpr}), 0) AS completed_fully_paid_seats
    FROM sales_transactions_canonical stc
    JOIN presales p ON p.id = stc.presale_id
    ${source.generatedJoinSql}
    ${source.boatJoinSql}
    WHERE ${where.join('\n      AND ')}
      ${source.canonicalStatusPredicate}
      ${source.presaleStatusPredicate}
    GROUP BY p.seller_id, DATE(stc.business_day)
    ORDER BY DATE(stc.business_day) ASC, p.seller_id ASC
  `).all(...params);

  return (rows || []).map((row) => toMetricRow(row));
}

export function getSellerCompletedDailyMetrics(db, { sellerId, businessDay } = {}) {
  const normalizedSellerId = normalizeSellerId(sellerId);
  const normalizedBusinessDay = normalizeBusinessDay(businessDay);

  if (!normalizedSellerId || !normalizedBusinessDay) {
    return zeroMetricRow({ sellerId, businessDay });
  }

  const rows = listSellerCompletedDailyMetrics(db, {
    sellerId: normalizedSellerId,
    dateFrom: normalizedBusinessDay,
    dateTo: normalizedBusinessDay,
  });

  return rows[0] || zeroMetricRow({
    sellerId: normalizedSellerId,
    businessDay: normalizedBusinessDay,
  });
}

export const SELLER_COMPLETED_WORKED_DAY_MIN_SEATS = WORKED_DAY_MIN_SEATS;

export default {
  getSellerCompletedDailyMetrics,
  listSellerCompletedDailyMetrics,
  SELLER_COMPLETED_WORKED_DAY_MIN_SEATS,
};
