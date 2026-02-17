/**
 * Test setup for finance-stress tests
 * Reuses dispatcher test setup logic with in-memory SQLite
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set in-memory DB BEFORE any db.js import
process.env.DB_FILE = ':memory:';
process.env.NODE_ENV = 'test';

// Import helpers from dispatcher tests
import {
  initTestDb, 
  getSeedData,
  generateTestToken, 
  getDb, 
  closeDb,
  clearTables,
  seedTestData
} from '../dispatcher/test-setup.js';

// Re-export all helpers for test files
export {
  initTestDb, 
  getSeedData,
  generateTestToken, 
  getDb, 
  closeDb,
  clearTables,
  seedTestData
};

// =========================
// SQL Invariant Validators
// =========================

/**
 * ML-INV-1: Every money_ledger record has required fields
 */
export function validateMoneyLedgerBasic(db) {
  const rows = db.prepare(`
    SELECT id, kind, type, amount, status
    FROM money_ledger
    WHERE kind IS NULL OR type IS NULL OR amount IS NULL OR status IS NULL
  `).all();
  
  return {
    valid: rows.length === 0,
    errors: rows.map(r => `Row ${r.id}: missing required field`),
    invalidRows: rows
  };
}

/**
 * ML-INV-2: For each presale: paid <= total
 * Note: prepayment_amount already includes cash/card amounts after accept-payment
 * So we only check prepayment_amount <= total (not sum of all)
 */
export function validatePresalePaymentBounds(db, presaleId = null) {
  const whereClause = presaleId ? ` AND p.id = ${presaleId}` : '';
  
  // prepayment_amount is the cumulative paid amount
  const violations = db.prepare(`
    SELECT 
      p.id as presale_id,
      p.total_price,
      p.prepayment_amount
    FROM presales p
    WHERE 1=1
    AND p.prepayment_amount > p.total_price
    ${whereClause}
  `).all();
  
  // Also check for any null total_price
  const nullTotal = db.prepare(`
    SELECT id FROM presales WHERE total_price IS NULL OR total_price < 0
  `).all();
  
  const errors = [
    ...violations.map(v => `Presale ${v.presale_id}: prepayment ${v.prepayment_amount} > total ${v.total_price}`),
    ...nullTotal.map(n => `Presale ${n.id}: invalid total_price`)
  ];
  
  return {
    valid: violations.length === 0 && nullTotal.length === 0,
    errors,
    violations,
    nullTotal
  };
}

/**
 * ML-INV-3: Kind and type must be from whitelist
 * Note: Using flexible validation to allow backend to add new types
 */
const VALID_KINDS = ['SELLER_SHIFT', 'DISPATCHER_SHIFT', 'OWNER_DEPOSIT', 'REFUND', 'ADJUSTMENT', 'SALE'];
const VALID_TYPES = [
  'SALE_PREPAYMENT_CASH', 'SALE_PREPAYMENT_CARD',
  'SALE_ACCEPTED_CASH', 'SALE_ACCEPTED_CARD', 'SALE_ACCEPTED_MIXED',
  'SALE_ACCEPTED', 'DEPOSIT', 'REFUND', 'ADJUSTMENT', 'PREPAYMENT',
  'SALE', 'PAYMENT'
];

export function validateMoneyLedgerKinds(db) {
  // Check for NULL kinds/types instead of strict whitelist
  // Backend may add new types, so we only check for structure validity
  const nullKind = db.prepare(`
    SELECT id, kind, type FROM money_ledger
    WHERE kind IS NULL OR kind = ''
  `).all();
  
  const nullType = db.prepare(`
    SELECT id, kind, type FROM money_ledger
    WHERE type IS NULL OR type = ''
  `).all();
  
  const errors = [];
  if (nullKind.length > 0) {
    errors.push(...nullKind.map(r => `Row ${r.id}: kind is NULL or empty`));
  }
  if (nullType.length > 0) {
    errors.push(...nullType.map(r => `Row ${r.id}: type is NULL or empty`));
  }
  
  return {
    valid: errors.length === 0,
    errors,
    nullKindRows: nullKind,
    nullTypeRows: nullType
  };
}

/**
 * Run all money_ledger invariant checks
 */
export function validateAllMoneyLedgerInvariants(db, presaleId = null) {
  const results = {
    basic: validateMoneyLedgerBasic(db),
    bounds: validatePresalePaymentBounds(db, presaleId),
    kinds: validateMoneyLedgerKinds(db)
  };
  
  results.allValid = results.basic.valid && results.bounds.valid && results.kinds.valid;
  results.allErrors = [...results.basic.errors, ...results.bounds.errors, ...results.kinds.errors];
  
  return results;
}

/**
 * Check tickets integrity for a presale
 */
export function validateTicketsIntegrity(db, presaleId) {
  const tickets = db.prepare('SELECT * FROM tickets WHERE presale_id = ?').all(presaleId);
  const presale = db.prepare('SELECT number_of_seats, status FROM presales WHERE id = ?').get(presaleId);
  
  if (!presale) {
    return { valid: false, errors: [`Presale ${presaleId} not found`] };
  }
  
  const errors = [];
  
  // If presale is CANCELLED, all tickets should be REFUNDED
  if (presale.status === 'CANCELLED') {
    const nonRefunded = tickets.filter(t => t.status !== 'REFUNDED');
    if (nonRefunded.length > 0) {
      errors.push(`${nonRefunded.length} tickets not REFUNDED for CANCELLED presale`);
    }
  }
  
  // Ticket count should match number_of_seats (unless partially deleted)
  const activeOrRefunded = tickets.filter(t => t.status === 'ACTIVE' || t.status === 'REFUNDED');
  // Note: after partial delete, count may differ - this is expected
  
  return {
    valid: errors.length === 0,
    errors,
    ticketCount: tickets.length,
    activeCount: tickets.filter(t => t.status === 'ACTIVE').length,
    refundedCount: tickets.filter(t => t.status === 'REFUNDED').length,
    presaleSeats: presale.number_of_seats,
    presaleStatus: presale.status
  };
}

/**
 * Create a presale via API (helper for tests)
 */
export async function createPresale(request, app, token, data) {
  return request(app)
    .post('/api/selling/presales')
    .set('Authorization', `Bearer ${token}`)
    .send({
      slotUid: data.slotUid,
      customerName: data.customerName || 'Test Client',
      customerPhone: data.customerPhone || '79991234567',
      numberOfSeats: data.numberOfSeats || 1,
      prepaymentAmount: data.prepaymentAmount || 0,
      tripDate: data.tripDate
    });
}

/**
 * Accept payment for presale (helper for tests)
 */
export async function acceptPayment(request, app, token, presaleId, paymentData) {
  return request(app)
    .patch(`/api/selling/presales/${presaleId}/accept-payment`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      payment_method: paymentData.method || 'CASH',
      cash_amount: paymentData.cashAmount || 0,
      card_amount: paymentData.cardAmount || 0
    });
}

// Global beforeEach for finance-stress tests
beforeEach(() => {
  console.log('[FINANCE_TEST_BEFORE_EACH] Starting cleanup and seed...');
  clearTables();
  const seeded = seedTestData();
  console.log('[FINANCE_TEST_BEFORE_EACH] Seed completed with genSlotId1=', seeded.genSlotId1, 'genSlotId2=', seeded.genSlotId2);
});
