// sales-transactions.mjs
// Canonical money layer for Owner analytics.
// Owner money appears ONLY after trip is auto-completed.
// Safe-by-default: if required tables/columns are missing, it does nothing.

const VALID_PRESALE_STATUSES = new Set(['ACTIVE', 'PAID', 'PARTIALLY_PAID', 'CONFIRMED']);
const EXCLUDED_PRESALE_STATUSES = new Set(['CANCELLED', 'CANCELLED_TRIP_PENDING', 'REFUNDED']);

function safe(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}

function tableExists(db, name) {
  return !!safe(() => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name), null);
}

function columnExists(db, table, column) {
  return !!safe(() => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column), false);
}

function normalizeMethod(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'cash' || s === 'нал' || s === 'наличные') return 'CASH';
  if (s === 'card' || s === 'карта' || s === 'card_payment') return 'CARD';
  if (s === 'mixed' || s === 'mix' || s === 'смешанная' || s === 'смеш') return 'MIXED';
  return '';
}

function safeInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function ensureSalesTransactionsSchema(db) {
  if (!db) return;

  safe(() => db.exec(`
    CREATE TABLE IF NOT EXISTS sales_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_day TEXT NOT NULL,
      slot_uid TEXT NOT NULL,
      slot_source TEXT NOT NULL,
      slot_id INTEGER NOT NULL,
      presale_id INTEGER,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'VALID',
      method TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'online',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `));

  // Idempotency guard (avoid duplicates if ticker runs again)
  safe(() => db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_tx_unique
    ON sales_transactions(slot_uid, presale_id, method, source, status);
  `));

  safe(() => db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_tx_business_day
    ON sales_transactions(business_day);
  `));
}

function hasAnyTxForSlot(db, slotUid) {
  if (!tableExists(db, 'sales_transactions')) return false;
  const row = safe(() => db.prepare(
    `SELECT 1 AS one FROM sales_transactions WHERE slot_uid = ? LIMIT 1`
  ).get(slotUid), null);
  return !!row;
}

function getGeneratedSlot(db, slotId) {
  if (!tableExists(db, 'generated_slots')) return null;
  if (!columnExists(db, 'generated_slots', 'trip_date')) return null;
  if (!columnExists(db, 'generated_slots', 'time')) return null;
  return safe(() => db.prepare(
    `SELECT id, trip_date, time, boat_id FROM generated_slots WHERE id = ?`
  ).get(slotId), null);
}

function listPresalesForGeneratedSlot(db, slotId) {
  if (!tableExists(db, 'presales')) return [];
  const hasSlotUid = columnExists(db, 'presales', 'slot_uid');
  const slotUid = `generated:${slotId}`;

  // Minimal safe fields set (some DBs may not have payment columns yet)
  const cols = safe(() => db.prepare('PRAGMA table_info(presales)').all().map(r => r.name), []);
  const hasPaymentMethod = cols.includes('payment_method');
  const hasCash = cols.includes('payment_cash_amount');
  const hasCard = cols.includes('payment_card_amount');
  const hasPrepay = cols.includes('prepayment_amount');

  const selectParts = [
    'p.id',
    'p.total_price',
    'p.status'
  ];
  if (hasPaymentMethod) selectParts.push('p.payment_method');
  if (hasCash) selectParts.push('p.payment_cash_amount');
  if (hasCard) selectParts.push('p.payment_card_amount');
  if (hasPrepay) selectParts.push('p.prepayment_amount');

  const where = hasSlotUid
    ? `p.slot_uid = ?`
    : `0=1`;

  return safe(() => db.prepare(`
    SELECT ${selectParts.join(', ')}
    FROM presales p
    WHERE ${where}
  `).all(slotUid), []);
}

function deriveAmounts(p) {
  const status = String(p.status || '').trim().toUpperCase();
  if (EXCLUDED_PRESALE_STATUSES.has(status)) return { cash: 0, card: 0, reason: 'excluded_status' };
  if (!VALID_PRESALE_STATUSES.has(status)) {
    // Unknown status: be conservative.
    return { cash: 0, card: 0, reason: 'unknown_status' };
  }

  const method = normalizeMethod(p.payment_method);
  const cash = safeInt(p.payment_cash_amount);
  const card = safeInt(p.payment_card_amount);
  const total = safeInt(p.total_price);

  // Preferred: use explicit cash/card amounts
  if (cash > 0 || card > 0) {
    return { cash, card, reason: 'explicit_split' };
  }

  // Fallback: if payment method is known and total_price exists
  if (total > 0) {
    if (method === 'CASH') return { cash: total, card: 0, reason: 'fallback_total_cash' };
    if (method === 'CARD') return { cash: 0, card: total, reason: 'fallback_total_card' };
    if (method === 'MIXED') {
      // No split provided -> do nothing (avoid wrong money)
      return { cash: 0, card: 0, reason: 'mixed_without_split' };
    }
  }

  return { cash: 0, card: 0, reason: 'no_payment' };
}

function insertTx(db, row) {
  if (!tableExists(db, 'sales_transactions')) return;

  safe(() => db.prepare(`
    INSERT OR IGNORE INTO sales_transactions (
      business_day, slot_uid, slot_source, slot_id, presale_id,
      amount, status, method, source
    ) VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    row.business_day,
    row.slot_uid,
    row.slot_source,
    row.slot_id,
    row.presale_id,
    row.amount,
    row.status,
    row.method,
    row.source
  ));
}

export function createSalesTransactionsForCompletedSlot(db, { slot_source, slot_id }) {
  // This function is called ONLY after trip was marked completed + locked.
  if (!db) return { ok: false, reason: 'no_db' };
  ensureSalesTransactionsSchema(db);

  if (slot_source !== 'generated_slots') {
    // For now, canonical money is generated for generated slots only (seller flow uses them).
    return { ok: true, skipped: true, reason: 'unsupported_slot_source' };
  }

  const slot = getGeneratedSlot(db, slot_id);
  if (!slot) return { ok: false, reason: 'slot_not_found_or_missing_columns' };

  const slotUid = `generated:${slot.id}`;
  if (hasAnyTxForSlot(db, slotUid)) {
    return { ok: true, skipped: true, reason: 'already_exists' };
  }

  const businessDay = String(slot.trip_date || '').trim();
  if (!businessDay) return { ok: false, reason: 'missing_trip_date' };

  const presales = listPresalesForGeneratedSlot(db, slot.id);
  if (!presales.length) {
    // No sales -> still ok.
    return { ok: true, created: 0, reason: 'no_presales' };
  }

  let created = 0;

  const tx = db.transaction(() => {
    for (const p of presales) {
      const amounts = deriveAmounts(p);
      const presaleId = safeInt(p.id) || null;

      if (amounts.cash > 0) {
        insertTx(db, {
          business_day: businessDay,
          slot_uid: slotUid,
          slot_source: 'generated_slots',
          slot_id: slot.id,
          presale_id: presaleId,
          amount: amounts.cash,
          status: 'VALID',
          method: 'CASH',
          source: 'online',
        });
        created++;
      }

      if (amounts.card > 0) {
        insertTx(db, {
          business_day: businessDay,
          slot_uid: slotUid,
          slot_source: 'generated_slots',
          slot_id: slot.id,
          presale_id: presaleId,
          amount: amounts.card,
          status: 'VALID',
          method: 'CARD',
          source: 'online',
        });
        created++;
      }
    }
  });

  safe(() => tx());

  return { ok: true, created };
}
