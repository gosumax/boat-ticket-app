const ensuredDatabases = new WeakSet();

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

export function getShiftClosureColumns(db) {
  try {
    if (!safeTableExists(db, 'shift_closures')) return new Set();
    const rows = db.prepare("PRAGMA table_info('shift_closures')").all();
    return new Set((rows || []).map((row) => row.name));
  } catch {
    return new Set();
  }
}

export function ensureCanonicalShiftClosureColumns(db) {
  if (!db || ensuredDatabases.has(db)) return;
  if (!safeTableExists(db, 'shift_closures')) {
    ensuredDatabases.add(db);
    return;
  }

  const addColumnIfMissing = (cols, columnName, sqlType) => {
    if (cols.has(columnName)) return;
    db.exec(`ALTER TABLE shift_closures ADD COLUMN ${columnName} ${sqlType}`);
    cols.add(columnName);
  };

  try {
    const cols = getShiftClosureColumns(db);

    addColumnIfMissing(cols, 'closed_by', 'INTEGER NULL');
    addColumnIfMissing(cols, 'total_revenue', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(cols, 'collected_total', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(cols, 'collected_cash', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(cols, 'collected_card', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(cols, 'refund_total', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(cols, 'refund_cash', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(cols, 'refund_card', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(cols, 'net_total', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(cols, 'net_cash', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(cols, 'net_card', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(cols, 'deposit_cash', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(cols, 'deposit_card', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(cols, 'sellers_json', 'TEXT NULL');
    addColumnIfMissing(cols, 'cashbox_json', 'TEXT NULL');
    addColumnIfMissing(cols, 'calculation_json', 'TEXT NULL');

    try {
      db.exec('CREATE INDEX IF NOT EXISTS idx_shift_closures_business_day ON shift_closures(business_day)');
    } catch {}
    try {
      if (cols.has('closed_by')) {
        db.exec('CREATE INDEX IF NOT EXISTS idx_shift_closures_closed_by ON shift_closures(closed_by)');
      }
    } catch {}
    try {
      if (cols.has('calculation_json')) {
        db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_closures_business_day_canonical
          ON shift_closures(business_day)
          WHERE calculation_json IS NOT NULL AND calculation_json != ''
        `);
      }
    } catch {}
  } catch (error) {
    console.error('[SHIFT_CLOSURES] ensureCanonicalShiftClosureColumns error:', error?.message || error);
  }

  ensuredDatabases.add(db);
}

export function getCanonicalShiftClosurePredicate(dbOrCols, options = {}) {
  const cols = dbOrCols instanceof Set ? dbOrCols : getShiftClosureColumns(dbOrCols);
  const requireCalculationJson = options.requireCalculationJson === true;
  const parts = [];

  if (cols.has('calculation_json')) {
    parts.push("COALESCE(calculation_json, '') != ''");
  }

  if (!requireCalculationJson) {
    if (cols.has('sellers_json')) {
      parts.push("COALESCE(sellers_json, '') != ''");
    }
    if (cols.has('closed_by')) {
      parts.push('closed_by IS NOT NULL');
    }
  }

  if (parts.length === 0) return '0';
  return `(${parts.join(' OR ')})`;
}

export function findCanonicalShiftClosureRow(db, businessDay, options = {}) {
  const day = String(businessDay || '').trim();
  if (!day) return null;

  ensureCanonicalShiftClosureColumns(db);

  const cols = getShiftClosureColumns(db);
  if (cols.size === 0) return null;

  const selectColumns = Array.isArray(options.columns) && options.columns.length > 0
    ? options.columns.filter((column) => cols.has(column))
    : Array.from(cols);

  if (cols.has('id') && !selectColumns.includes('id')) {
    selectColumns.unshift('id');
  }

  if (selectColumns.length === 0) return null;

  const predicate = getCanonicalShiftClosurePredicate(cols, {
    requireCalculationJson: options.requireCalculationJson === true,
  });

  try {
    return db.prepare(`
      SELECT ${selectColumns.join(', ')}
      FROM shift_closures
      WHERE business_day = ?
        AND ${predicate}
      ORDER BY id DESC
      LIMIT 1
    `).get(day) || null;
  } catch {
    return null;
  }
}

export function hasCanonicalShiftClosureRow(db, businessDay, options = {}) {
  return !!findCanonicalShiftClosureRow(db, businessDay, {
    columns: ['id'],
    requireCalculationJson: options.requireCalculationJson === true,
  });
}

export function listLegacyShiftClosureBusinessDays(db) {
  ensureCanonicalShiftClosureColumns(db);

  const days = new Set();

  try {
    if (safeTableExists(db, 'shift_closures')) {
      const rows = db.prepare(`
        SELECT DISTINCT business_day
        FROM shift_closures
        WHERE business_day IS NOT NULL AND business_day != ''
      `).all();
      for (const row of rows || []) {
        days.add(String(row.business_day));
      }
    }
  } catch {}

  try {
    if (safeTableExists(db, 'money_ledger')) {
      const rows = db.prepare(`
        SELECT DISTINCT business_day
        FROM money_ledger
        WHERE business_day IS NOT NULL
          AND business_day != ''
          AND status = 'POSTED'
          AND kind = 'FUND'
          AND type IN ('WITHHOLD_VIKLIF', 'WITHHOLD_WEEKLY', 'WITHHOLD_SEASON')
      `).all();
      for (const row of rows || []) {
        days.add(String(row.business_day));
      }
    }
  } catch {}

  return Array.from(days).sort();
}

export function getShiftClosureLegacyMeta(db, businessDay) {
  const day = String(businessDay || '').trim();
  const meta = {
    closed_at: null,
    closed_by: 0,
  };
  if (!day) return meta;

  ensureCanonicalShiftClosureColumns(db);
  const cols = getShiftClosureColumns(db);

  try {
    if (cols.has('closed_at')) {
      const row = db.prepare(`
        SELECT MAX(closed_at) AS closed_at
        FROM shift_closures
        WHERE business_day = ?
      `).get(day);
      if (row?.closed_at) meta.closed_at = row.closed_at;
    }
  } catch {}

  try {
    if (cols.has('closed_by')) {
      const row = db.prepare(`
        SELECT closed_by
        FROM shift_closures
        WHERE business_day = ?
          AND closed_by IS NOT NULL
        ORDER BY id DESC
        LIMIT 1
      `).get(day);
      if (Number(row?.closed_by || 0) > 0) {
        meta.closed_by = Number(row.closed_by);
      }
    }
  } catch {}

  try {
    if (safeTableExists(db, 'manual_days')) {
      const row = db.prepare(`
        SELECT locked_at, locked_by_user_id
        FROM manual_days
        WHERE business_day = ?
          AND (locked = 1 OR is_locked = 1)
        LIMIT 1
      `).get(day);
      if (!meta.closed_at && row?.locked_at) meta.closed_at = row.locked_at;
      if (meta.closed_by <= 0 && Number(row?.locked_by_user_id || 0) > 0) {
        meta.closed_by = Number(row.locked_by_user_id);
      }
    }
  } catch {}

  try {
    if (safeTableExists(db, 'money_ledger')) {
      const row = db.prepare(`
        SELECT
          MAX(event_time) AS closed_at,
          MAX(COALESCE(decided_by_user_id, 0)) AS closed_by
        FROM money_ledger
        WHERE business_day = ?
          AND status = 'POSTED'
          AND kind = 'FUND'
          AND type IN ('WITHHOLD_VIKLIF', 'WITHHOLD_WEEKLY', 'WITHHOLD_SEASON')
      `).get(day);
      if (!meta.closed_at && row?.closed_at) meta.closed_at = row.closed_at;
      if (meta.closed_by <= 0 && Number(row?.closed_by || 0) > 0) {
        meta.closed_by = Number(row.closed_by);
      }
    }
  } catch {}

  return meta;
}
