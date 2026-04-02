import { calcMotivationDay } from './motivation/engine.mjs';
import {
  calcFutureTripsReserveByPaymentDay,
  calcLiveUiLedgerTotals,
  calcShiftOwnerCashMetrics,
} from './dispatcher-shift-ledger.mjs';
import { buildShiftCloseBreakdown } from './shift-close-breakdown.mjs';
import {
  ensureCanonicalShiftClosureColumns,
  findCanonicalShiftClosureRow,
  getShiftClosureColumns,
  getShiftClosureLegacyMeta,
  listLegacyShiftClosureBusinessDays,
} from './shift-closure-schema.mjs';

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function safeTableExists(db, tableName) {
  try {
    const row = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE name = ? AND type IN ('table','view') LIMIT 1")
      .get(tableName);
    return !!row;
  } catch {
    return false;
  }
}

function getLocalNowSql(db) {
  try {
    return db.prepare("SELECT datetime('now','localtime') AS d").get()?.d || new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function getShiftCloseMotivationOptions(dispatcherUserId = null) {
  const normalized = Number(dispatcherUserId || 0);
  return {
    profile: 'dispatcher_shift_close',
    dispatcherUserId: Number.isFinite(normalized) && normalized > 0 ? normalized : null,
  };
}

function isActiveDispatcher(db, userId) {
  const normalizedUserId = Number(userId || 0);
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return false;
  try {
    const row = db.prepare(`
      SELECT 1
      FROM users
      WHERE id = ? AND role = 'dispatcher' AND is_active = 1
      LIMIT 1
    `).get(normalizedUserId);
    return !!row;
  } catch {
    return false;
  }
}

function resolveSnapshotDispatcherUserId(db, businessDay, preferredUserId = null, liveUiTotals = null) {
  if (isActiveDispatcher(db, preferredUserId)) {
    return Number(preferredUserId);
  }

  const sellers = Array.isArray(liveUiTotals?.sellers) ? liveUiTotals.sellers : [];
  const dispatcherCandidates = sellers
    .filter((seller) => String(seller?.role || '').toLowerCase() === 'dispatcher')
    .map((seller) => Number(seller?.seller_id || 0))
    .filter((userId) => isActiveDispatcher(db, userId));

  if (dispatcherCandidates.length === 1) {
    return dispatcherCandidates[0];
  }

  try {
    const row = db.prepare(`
      SELECT ml.seller_id
      FROM money_ledger ml
      JOIN users u ON u.id = ml.seller_id
      WHERE ml.business_day = ?
        AND ml.status = 'POSTED'
        AND ml.kind IN ('SELLER_SHIFT','DISPATCHER_SHIFT')
        AND ml.type IN (
          'SALE_PREPAYMENT_CASH','SALE_PREPAYMENT_CARD','SALE_PREPAYMENT_MIXED',
          'SALE_ACCEPTED_CASH','SALE_ACCEPTED_CARD','SALE_ACCEPTED_MIXED'
        )
        AND u.role = 'dispatcher'
        AND u.is_active = 1
      GROUP BY ml.seller_id
      ORDER BY SUM(ABS(ml.amount)) DESC, ml.seller_id ASC
      LIMIT 1
    `).get(businessDay);
    if (Number(row?.seller_id || 0) > 0) {
      return Number(row.seller_id);
    }
  } catch {}

  return null;
}

function applySnapshotPayoutFields(row, payout) {
  const base = { ...row };
  if (!payout) {
    return {
      ...base,
      salary_due: Number(base.salary_due || 0),
      salary_due_total: Number(base.salary_due_total || base.salary_due || 0),
      salary_accrued: Number(base.salary_accrued || base.salary_due_total || base.salary_due || 0),
      team_part: Number(base.team_part || 0),
      individual_part: Number(base.individual_part || 0),
      dispatcher_daily_bonus: Number(base.dispatcher_daily_bonus || 0),
      total_raw: Number(base.total_raw || 0),
      salary_rounding_to_season: Number(base.salary_rounding_to_season || 0),
      personal_revenue_day: Number(base.personal_revenue_day || base.collected_total || 0),
    };
  }

  return {
    ...base,
    salary_due: Number(payout.total || 0),
    salary_due_total: Number(payout.total || 0),
    salary_accrued: Number(payout.total || 0),
    team_part: Number(payout.team_part || 0),
    individual_part: Number(payout.individual_part || 0),
    dispatcher_daily_bonus: Number(payout.dispatcher_daily_bonus || 0),
    total_raw: Number(payout.total_raw || payout.total || 0),
    salary_rounding_to_season: Number(payout.salary_rounding_to_season || 0),
    personal_revenue_day: Number(
      payout.personal_revenue_day ||
      payout.revenue ||
      base.personal_revenue_day ||
      base.collected_total ||
      0
    ),
  };
}

function createSnapshotParticipantRowFromPayout(db, payout) {
  const userId = Number(payout?.user_id || 0);
  let participantName = payout?.name || null;
  let participantRole = String(payout?.role || '').toLowerCase() === 'dispatcher' ? 'dispatcher' : 'seller';

  try {
    const row = db.prepare('SELECT username, role FROM users WHERE id = ?').get(userId);
    if (row?.username) participantName = row.username;
    if (row?.role) participantRole = String(row.role).toLowerCase() === 'dispatcher' ? 'dispatcher' : 'seller';
  } catch {}

  return applySnapshotPayoutFields({
    seller_id: userId,
    seller_name: participantName || `${participantRole === 'dispatcher' ? 'Dispatcher' : 'Seller'} #${userId}`,
    name: participantName || `${participantRole === 'dispatcher' ? 'Dispatcher' : 'Seller'} #${userId}`,
    role: participantRole,
    accepted: Number(payout?.personal_revenue_day || payout?.revenue || 0),
    deposited: 0,
    balance: 0,
    cash_balance: 0,
    terminal_debt: 0,
    terminal_due_to_owner: 0,
    status: 'CLOSED',
    collected_total: Number(payout?.personal_revenue_day || payout?.revenue || 0),
    collected_cash: 0,
    collected_card: 0,
    deposit_cash: 0,
    deposit_card: 0,
    cash_due_to_owner: 0,
    personal_revenue_day: Number(payout?.personal_revenue_day || payout?.revenue || 0),
  }, payout);
}

function getTotalRevenueForBusinessDay(db, businessDay) {
  try {
    if (!safeTableExists(db, 'sales_transactions_canonical')) return 0;
    const cols = new Set(db.prepare("PRAGMA table_info('sales_transactions_canonical')").all().map((row) => row.name));
    if (!cols.has('business_day')) return 0;
    const hasStatus = cols.has('status');
    const where = hasStatus ? 'business_day = ? AND status = \'VALID\'' : 'business_day = ?';
    const row = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total_revenue
      FROM sales_transactions_canonical
      WHERE ${where}
    `).get(businessDay);
    return Number(row?.total_revenue || 0);
  } catch {
    return 0;
  }
}

function getSalaryPaidForBusinessDay(db, businessDay) {
  try {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'SALARY_PAYOUT_CASH' THEN amount ELSE 0 END), 0) AS salary_paid_cash,
        COALESCE(SUM(CASE WHEN type = 'SALARY_PAYOUT_CARD' THEN amount ELSE 0 END), 0) AS salary_paid_card
      FROM money_ledger
      WHERE status = 'POSTED'
        AND kind = 'DISPATCHER_SHIFT'
        AND type IN ('SALARY_PAYOUT_CASH', 'SALARY_PAYOUT_CARD')
        AND business_day = ?
    `).get(businessDay);
    const salaryPaidCash = Number(row?.salary_paid_cash || 0);
    const salaryPaidCard = Number(row?.salary_paid_card || 0);
    return {
      salary_paid_cash: salaryPaidCash,
      salary_paid_card: salaryPaidCard,
      salary_paid_total: salaryPaidCash + salaryPaidCard,
    };
  } catch {
    return {
      salary_paid_cash: 0,
      salary_paid_card: 0,
      salary_paid_total: 0,
    };
  }
}

function getDispatcherDepositsForBusinessDay(db, businessDay) {
  try {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'DEPOSIT_TO_OWNER_CASH' THEN amount ELSE 0 END), 0) AS deposit_cash,
        COALESCE(SUM(CASE WHEN type = 'DEPOSIT_TO_OWNER_CARD' THEN amount ELSE 0 END), 0) AS deposit_card
      FROM money_ledger
      WHERE status = 'POSTED'
        AND kind = 'DISPATCHER_SHIFT'
        AND type LIKE 'DEPOSIT_TO_OWNER%'
        AND business_day = ?
    `).get(businessDay);
    return {
      deposit_cash: Number(row?.deposit_cash || 0),
      deposit_card: Number(row?.deposit_card || 0),
    };
  } catch {
    return {
      deposit_cash: 0,
      deposit_card: 0,
    };
  }
}

function getFundsWithholdCashToday(withhold) {
  if (!withhold) return 0;
  const seasonFromRevenue = Number(withhold.season_from_revenue ?? withhold.season_amount ?? 0);
  const dispatcherAmount = Number(withhold.dispatcher_amount_total || 0);
  return roundMoney(Number(withhold.weekly_amount || 0) + seasonFromRevenue + dispatcherAmount);
}

function getFutureTripsReserveForBusinessDay(db, businessDay) {
  try {
    if (!safeTableExists(db, 'money_ledger')) {
      return { cash: 0, card: 0, total: 0, unresolvedTripDayCount: 0 };
    }
    const ledgerCols = new Set(db.prepare("PRAGMA table_info('money_ledger')").all().map((row) => row.name));
    return calcFutureTripsReserveByPaymentDay({
      businessDay,
      ledgerCols,
      hasLedger: ledgerCols.size > 0,
      ledgerHasBDay: ledgerCols.has('business_day'),
    });
  } catch {
    return { cash: 0, card: 0, total: 0, unresolvedTripDayCount: 0 };
  }
}

function buildCashboxWarnings(cashDiscrepancy) {
  if (!cashDiscrepancy) return [];
  return [
    {
      code: 'CASH_DISCREPANCY',
      amount: cashDiscrepancy,
      message: cashDiscrepancy > 0
        ? `В кассе больше наличных на ${Math.abs(cashDiscrepancy)} ₽, чем ожидалось от продавцов`
        : `В кассе меньше наличных на ${Math.abs(cashDiscrepancy)} ₽, чем ожидалось от продавцов`,
    },
  ];
}

export function buildUnifiedShiftClosureSnapshot(db, {
  businessDay,
  closedBy = null,
  closedAt = null,
  dispatcherUserId = null,
  snapshotSource = 'snapshot',
} = {}) {
  const day = String(businessDay || '').trim();
  if (!day) {
    throw new Error('business_day is required for shift closure snapshot');
  }

  ensureCanonicalShiftClosureColumns(db);

  const totalRevenue = getTotalRevenueForBusinessDay(db, day);
  const liveUiTotals = calcLiveUiLedgerTotals(day);
  const collectedTotal = Number(liveUiTotals?.collected_total || 0);
  const collectedCash = Number(liveUiTotals?.collected_cash || 0);
  const collectedCard = Number(liveUiTotals?.collected_card || 0);
  const refundTotal = Number(liveUiTotals?.refund_total || 0);
  const refundCash = Number(liveUiTotals?.refund_cash || 0);
  const refundCard = Number(liveUiTotals?.refund_card || 0);
  const netCash = collectedCash - refundCash;
  const netCard = collectedCard - refundCard;
  const netTotal = netCash + netCard;

  const dispatcherDeposits = getDispatcherDepositsForBusinessDay(db, day);
  const depositCash = Number(dispatcherDeposits.deposit_cash || 0);
  const depositCard = Number(dispatcherDeposits.deposit_card || 0);
  const salaryPaid = getSalaryPaidForBusinessDay(db, day);

  const resolvedDispatcherUserId = resolveSnapshotDispatcherUserId(
    db,
    day,
    dispatcherUserId ?? closedBy,
    liveUiTotals
  );

  let salaryDue = 0;
  let salaryBase = Math.max(0, netTotal);
  let fundsWithholdCashToday = 0;
  let motivationData = null;
  let motivationWithhold = null;
  const payoutsByUserId = new Map();

  try {
    const motivationResult = calcMotivationDay(
      db,
      day,
      getShiftCloseMotivationOptions(resolvedDispatcherUserId)
    );
    if (motivationResult?.data?.payouts) {
      for (const payout of motivationResult.data.payouts) {
        payoutsByUserId.set(Number(payout.user_id), payout);
      }
      salaryDue = motivationResult.data.payouts.reduce((sum, payout) => sum + Number(payout.total || 0), 0);
    }
    if (motivationResult?.data) {
      motivationData = motivationResult.data;
      motivationWithhold = motivationResult.data.withhold || null;
      salaryBase = Number(motivationResult.data.salary_base ?? salaryBase);
      fundsWithholdCashToday = getFundsWithholdCashToday(motivationResult.data.withhold);
    }
  } catch {
    salaryDue = 0;
  }

  const sellers = (Array.isArray(liveUiTotals?.sellers) ? liveUiTotals.sellers : []).map((seller) => {
    const sellerId = Number(seller?.seller_id || 0);
    return applySnapshotPayoutFields({ ...seller }, payoutsByUserId.get(sellerId));
  });

  for (const [userId, payout] of payoutsByUserId.entries()) {
    const exists = sellers.some((seller) => Number(seller?.seller_id || 0) === Number(userId));
    if (!exists) {
      sellers.push(createSnapshotParticipantRowFromPayout(db, payout));
    }
  }

  const cashInCashbox = netCash - depositCash - Number(salaryPaid.salary_paid_cash || 0);
  const expectedSellersCashDue = sellers.reduce((sum, seller) => {
    const due = Math.max(0, Number(seller.cash_due_to_owner ?? seller.cash_balance ?? seller.balance ?? 0));
    return sum + due;
  }, 0);
  const sellersDebtTotal = sellers.reduce((sum, seller) => {
    const cashDue = Math.max(0, Number(seller.cash_due_to_owner ?? seller.cash_balance ?? seller.balance ?? 0));
    const cardDue = Math.max(0, Number(seller.terminal_due_to_owner ?? seller.terminal_debt ?? 0));
    return sum + cashDue + cardDue;
  }, 0);

  const futureTripsReserve = getFutureTripsReserveForBusinessDay(db, day);
  const ownerCashAvailable = netTotal - salaryDue - sellersDebtTotal;
  const ownerCashMetrics = calcShiftOwnerCashMetrics({
    netCash,
    salaryDueTotal: salaryDue,
    salaryPaidCash: Number(salaryPaid.salary_paid_cash || 0),
    salaryPaidTotal: Number(salaryPaid.salary_paid_total || 0),
    sellers,
    futureTripsReserveCash: Number(futureTripsReserve.cash || 0),
    fundsWithholdCashToday,
  });
  const cashDiscrepancy = cashInCashbox - expectedSellersCashDue;
  const warnings = buildCashboxWarnings(cashDiscrepancy);

  const cashbox = {
    cash_in_cashbox: cashInCashbox,
    expected_sellers_cash_due: expectedSellersCashDue,
    deposits_cash_total: depositCash,
    salary_paid_cash: Number(salaryPaid.salary_paid_cash || 0),
    cash_discrepancy: cashDiscrepancy,
    warnings,
    future_trips_reserve_cash: Number(futureTripsReserve.cash || 0),
    future_trips_reserve_card: Number(futureTripsReserve.card || 0),
    future_trips_reserve_total: Number(futureTripsReserve.total || 0),
    future_trips_reserve_unresolved_trip_day_count: Number(futureTripsReserve.unresolvedTripDayCount || 0),
    salary_base: salaryBase,
    funds_withhold_cash_today: fundsWithholdCashToday,
    owner_cash_available: ownerCashAvailable,
    owner_cash_available_after_future_reserve_cash: ownerCashMetrics.owner_cash_available_after_future_reserve_cash,
    owner_cash_available_after_reserve_and_funds_cash: ownerCashMetrics.owner_cash_available_after_reserve_and_funds_cash,
    owner_handover_cash_final: ownerCashMetrics.owner_handover_cash_final,
  };

  const shiftCloseBreakdown = buildShiftCloseBreakdown({
    businessDay: day,
    source: snapshotSource,
    sellers,
    collectedCash,
    collectedCard,
    collectedTotal,
    reserveCash: Number(futureTripsReserve.cash || 0),
    reserveCard: Number(futureTripsReserve.card || 0),
    reserveTotal: Number(futureTripsReserve.total || 0),
    salaryBase,
    salaryDueTotal: salaryDue,
    salaryPaidCash: Number(salaryPaid.salary_paid_cash || 0),
    salaryPaidCard: Number(salaryPaid.salary_paid_card || 0),
    salaryPaidTotal: Number(salaryPaid.salary_paid_total || 0),
    ownerCashMetrics,
    fundsWithholdCashToday,
    motivationData,
    motivationWithhold,
  });

  const legacyMeta = getShiftClosureLegacyMeta(db, day);
  const resolvedClosedAt = closedAt || legacyMeta.closed_at || getLocalNowSql(db);
  const resolvedClosedBy = Number(closedBy || legacyMeta.closed_by || 0);

  return {
    business_day: day,
    closed_at: resolvedClosedAt,
    closed_by: resolvedClosedBy,
    total_revenue: totalRevenue,
    collected_total: collectedTotal,
    collected_cash: collectedCash,
    collected_card: collectedCard,
    refund_total: refundTotal,
    refund_cash: refundCash,
    refund_card: refundCard,
    net_total: netTotal,
    net_cash: netCash,
    net_card: netCard,
    deposit_cash: depositCash,
    deposit_card: depositCard,
    salary_due: salaryDue,
    salary_paid_cash: Number(salaryPaid.salary_paid_cash || 0),
    salary_paid_card: Number(salaryPaid.salary_paid_card || 0),
    salary_paid_total: Number(salaryPaid.salary_paid_total || 0),
    sellers,
    sellers_json: JSON.stringify(sellers),
    cashbox,
    cashbox_json: JSON.stringify(cashbox),
    calculation_json: JSON.stringify(shiftCloseBreakdown),
    motivation_withhold: shiftCloseBreakdown.withhold,
    shift_close_breakdown: shiftCloseBreakdown,
    owner_cash_available: ownerCashAvailable,
    owner_cash_today: Number(shiftCloseBreakdown?.totals?.owner_cash_today ?? ownerCashMetrics.owner_handover_cash_final),
    weekly_fund: Number(shiftCloseBreakdown?.totals?.weekly_fund ?? 0),
    season_fund_total: Number(shiftCloseBreakdown?.totals?.season_fund_total ?? 0),
    final_salary_total: Number(shiftCloseBreakdown?.totals?.final_salary_total ?? salaryDue),
    salary_to_pay: Number(shiftCloseBreakdown?.totals?.final_salary_total ?? salaryDue),
  };
}

export function persistUnifiedShiftClosureSnapshot(db, snapshot) {
  ensureCanonicalShiftClosureColumns(db);

  const cols = getShiftClosureColumns(db);
  const valuesByColumn = {
    business_day: snapshot.business_day,
    closed_at: snapshot.closed_at,
    closed_by: snapshot.closed_by,
    total_revenue: snapshot.total_revenue,
    collected_total: snapshot.collected_total,
    collected_cash: snapshot.collected_cash,
    collected_card: snapshot.collected_card,
    refund_total: snapshot.refund_total,
    refund_cash: snapshot.refund_cash,
    refund_card: snapshot.refund_card,
    net_total: snapshot.net_total,
    net_cash: snapshot.net_cash,
    net_card: snapshot.net_card,
    deposit_cash: snapshot.deposit_cash,
    deposit_card: snapshot.deposit_card,
    salary_due: snapshot.salary_due,
    salary_paid_cash: snapshot.salary_paid_cash,
    salary_paid_card: snapshot.salary_paid_card,
    salary_paid_total: snapshot.salary_paid_total,
    sellers_json: snapshot.sellers_json,
    cashbox_json: snapshot.cashbox_json,
    calculation_json: snapshot.calculation_json,
    seller_id: 0,
    accepted: 0,
    deposited: 0,
    balance: 0,
    accepted_cash: 0,
    accepted_card: 0,
    deposited_cash: 0,
    deposited_card: 0,
  };

  const existingCanonicalRow = findCanonicalShiftClosureRow(db, snapshot.business_day, {
    columns: ['id', 'business_day', 'calculation_json'],
  });

  if (existingCanonicalRow?.id) {
    const updateColumns = Object.keys(valuesByColumn).filter((column) => cols.has(column) && column !== 'business_day');
    db.prepare(`
      UPDATE shift_closures
      SET ${updateColumns.map((column) => `${column} = ?`).join(', ')}
      WHERE id = ?
    `).run(...updateColumns.map((column) => valuesByColumn[column]), existingCanonicalRow.id);
    return { action: 'updated', id: existingCanonicalRow.id };
  }

  const insertColumns = Object.keys(valuesByColumn).filter((column) => cols.has(column));
  const result = db.prepare(`
    INSERT INTO shift_closures (${insertColumns.join(', ')})
    VALUES (${insertColumns.map(() => '?').join(', ')})
  `).run(...insertColumns.map((column) => valuesByColumn[column]));

  return { action: 'inserted', id: result.lastInsertRowid };
}

export function backfillShiftClosureSnapshotForDay(db, businessDay, options = {}) {
  const day = String(businessDay || '').trim();
  if (!day) return { ok: false, skipped: true, reason: 'missing_business_day' };

  ensureCanonicalShiftClosureColumns(db);

  const existingWithCalculation = findCanonicalShiftClosureRow(db, day, {
    columns: ['id'],
    requireCalculationJson: true,
  });
  if (existingWithCalculation?.id) {
    return { ok: true, skipped: true, reason: 'already_has_calculation_json', business_day: day };
  }

  const legacyDays = new Set(listLegacyShiftClosureBusinessDays(db));
  const existingCanonicalLike = findCanonicalShiftClosureRow(db, day, {
    columns: ['id', 'business_day', 'calculation_json'],
  });

  if (!legacyDays.has(day) && !existingCanonicalLike?.id) {
    return { ok: true, skipped: true, reason: 'not_a_legacy_closed_day', business_day: day };
  }

  const snapshot = buildUnifiedShiftClosureSnapshot(db, {
    businessDay: day,
    closedBy: options.closedBy,
    closedAt: options.closedAt,
    dispatcherUserId: options.dispatcherUserId,
    snapshotSource: options.snapshotSource || 'snapshot_backfill',
  });
  const persistResult = persistUnifiedShiftClosureSnapshot(db, snapshot);

  return {
    ok: true,
    backfilled: true,
    business_day: day,
    action: persistResult.action,
    id: persistResult.id,
    snapshot,
  };
}

export function backfillAllLegacyShiftClosures(db, options = {}) {
  const days = listLegacyShiftClosureBusinessDays(db);
  const results = [];

  for (const businessDay of days) {
    const result = backfillShiftClosureSnapshotForDay(db, businessDay, options);
    if (result?.backfilled) {
      results.push({
        business_day: businessDay,
        action: result.action,
        id: result.id,
      });
    }
  }

  return {
    ok: true,
    scanned_days: days.length,
    backfilled_days: results.length,
    results,
  };
}
