/**
 * Test: normalizeSummary utility
 * Verifies that both snake_case and camelCase input are normalized correctly
 */
import { describe, it, expect } from 'vitest';
import normalizeSummary, { normalizeSeller, normalizeDispatcher } from '../../src/utils/normalizeSummary.js';

describe('normalizeSummary', () => {
  it('snake_case input -> normalized fields correct', () => {
    const input = {
      business_day: '2026-02-20',
      source: 'snapshot',
      is_closed: true,
      closed_at: '2026-02-20 18:00:00',
      closed_by: 5,
      collected_total: 10000,
      collected_cash: 7000,
      collected_card: 3000,
      refund_total: 500,
      refund_cash: 300,
      refund_card: 200,
      net_total: 9500,
      net_cash: 6700,
      net_card: 2800,
      deposit_cash: 2000,
      deposit_card: 1000,
      salary_due_total: 1235,
      salary_paid_cash: 500,
      salary_paid_card: 0,
      salary_paid_total: 500,
      all_trips_finished: true,
      open_trips_count: 0,
      dispatcher: {
        collected_total: 0,
        deposit_cash: 2000,
        deposit_card: 1000,
        salary_paid_cash: 500,
        salary_paid_card: 0,
        salary_paid_total: 500,
      },
      sellers: [
        {
          seller_id: 1,
          seller_name: 'Иванова',
          collected_total: 5000,
          collected_cash: 3500,
          collected_card: 1500,
          deposit_cash: 1000,
          deposit_card: 500,
          cash_due_to_owner: 2500,
          terminal_debt: 0,
          net_total: 2500,
          status: 'DEBT',
        },
        {
          seller_id: 2,
          seller_name: 'Петров',
          collected_total: 5000,
          collected_cash: 3500,
          collected_card: 1500,
          deposit_cash: 1000,
          deposit_card: 500,
          cash_due_to_owner: 0,
          terminal_debt: 0,
          net_total: 0,
          status: 'CLOSED',
        },
      ],
    };

    const result = normalizeSummary(input);

    // Meta
    expect(result.business_day).toBe('2026-02-20');
    expect(result.source).toBe('snapshot');
    expect(result.is_closed).toBe(true);
    expect(result.closed_at).toBe('2026-02-20 18:00:00');
    expect(result.closed_by).toBe(5);

    // Totals
    expect(result.collected_total).toBe(10000);
    expect(result.collected_cash).toBe(7000);
    expect(result.collected_card).toBe(3000);
    expect(result.net_total).toBe(9500);
    expect(result.net_cash).toBe(6700);
    expect(result.net_card).toBe(2800);
    expect(result.deposit_cash).toBe(2000);
    expect(result.deposit_card).toBe(1000);

    // Salary
    expect(result.salary_due_total).toBe(1235);
    expect(result.salary_paid_cash).toBe(500);
    expect(result.salary_paid_total).toBe(500);

    // Dispatcher
    expect(result.dispatcher.deposit_cash).toBe(2000);
    expect(result.dispatcher.salary_paid_cash).toBe(500);

    // Sellers
    expect(result.sellers).toHaveLength(2);
    expect(result.sellers[0].seller_id).toBe(1);
    expect(result.sellers[0].seller_name).toBe('Иванова');
    expect(result.sellers[0].cash_due_to_owner).toBe(2500);
    expect(result.sellers[0].status).toBe('DEBT');
    expect(result.sellers[1].cash_due_to_owner).toBe(0);
    expect(result.sellers[1].status).toBe('CLOSED');
  });

  it('camelCase/old fields (closed, netCash, depositCash, cashRemaining) -> normalized correctly', () => {
    const input = {
      businessDay: '2026-02-21',  // camelCase
      closed: true,               // old field
      closedAt: '2026-02-21 19:00:00',
      netCash: 5000,              // camelCase
      netCard: 2000,
      depositCash: 1500,          // camelCase
      depositCard: 500,
      salaryDue: 850,             // old field
      salaryPaidCash: 300,
      allTripsFinished: true,
      openTripsCount: 0,
      dispatcher: {
        depositCash: 1500,
        salaryPaidCash: 300,
      },
      sellers: [
        {
          id: 3,
          name: 'Сидорова',         // old field
          cashRemaining: 3000,      // old field
          terminalDebt: 500,
          cashHanded: 1000,
          terminalHanded: 0,
        },
      ],
    };

    const result = normalizeSummary(input);

    // Meta
    expect(result.business_day).toBe('2026-02-21');
    expect(result.is_closed).toBe(true);
    expect(result.closed_at).toBe('2026-02-21 19:00:00');

    // Totals
    expect(result.net_cash).toBe(5000);
    expect(result.net_card).toBe(2000);
    expect(result.deposit_cash).toBe(1500);
    expect(result.deposit_card).toBe(500);

    // Salary
    expect(result.salary_due_total).toBe(850);
    expect(result.salary_paid_cash).toBe(300);

    // Dispatcher
    expect(result.dispatcher.deposit_cash).toBe(1500);
    expect(result.dispatcher.salary_paid_cash).toBe(300);

    // Sellers
    expect(result.sellers).toHaveLength(1);
    expect(result.sellers[0].seller_id).toBe(3);
    expect(result.sellers[0].seller_name).toBe('Сидорова');
    expect(result.sellers[0].cash_due_to_owner).toBe(3000);
    expect(result.sellers[0].terminal_debt).toBe(500);
  });

  it('handles null/undefined input gracefully', () => {
    expect(normalizeSummary(null)).toBeNull();
    expect(normalizeSummary(undefined)).toBeNull();
  });

  it('handles missing optional fields with defaults', () => {
    const input = {
      business_day: '2026-02-22',
    };

    const result = normalizeSummary(input);

    expect(result.business_day).toBe('2026-02-22');
    expect(result.source).toBe('ledger');
    expect(result.is_closed).toBe(false);
    expect(result.collected_total).toBe(0);
    expect(result.net_cash).toBe(0);
    expect(result.deposit_cash).toBe(0);
    expect(result.sellers).toEqual([]);
    expect(result.dispatcher).toBeDefined();
  });

  it('normalizes cashbox fields with warnings from server response', () => {
    const input = {
      business_day: '2026-02-23',
      source: 'snapshot',
      is_closed: true,
      cashbox: {
        cash_in_cashbox: 800,
        expected_sellers_cash_due: 1000,
        deposits_cash_total: 0,
        salary_paid_cash: 200,
        cash_discrepancy: -200,
        warnings: [
          {
            code: 'CASH_DISCREPANCY',
            amount: -200,
            message: 'В кассе меньше наличных на 200 ₽, чем ожидалось от продавцов'
          }
        ]
      },
      sellers: [],
    };

    const result = normalizeSummary(input);

    // Cashbox normalized
    expect(result.cashbox).toBeDefined();
    expect(result.cashbox.cash_in_cashbox).toBe(800);
    expect(result.cashbox.expected_sellers_cash_due).toBe(1000);
    expect(result.cashbox.cash_discrepancy).toBe(-200);
    expect(result.cashbox.warnings).toHaveLength(1);
    expect(result.cashbox.warnings[0].code).toBe('CASH_DISCREPANCY');
    expect(result.cashbox.warnings[0].amount).toBe(-200);

    // Top-level convenience fields
    expect(result.cash_in_cashbox).toBe(800);
    expect(result.expected_sellers_cash_due).toBe(1000);
    expect(result.cash_discrepancy).toBe(-200);
    expect(result.warnings).toHaveLength(1);
  });

  it('normalizes top-level cashbox fields as fallback', () => {
    const input = {
      business_day: '2026-02-24',
      cash_in_cashbox: 1500,
      expected_sellers_cash_due: 1500,
      cash_discrepancy: 0,
      warnings: [],
      sellers: [],
    };

    const result = normalizeSummary(input);

    expect(result.cashbox.cash_in_cashbox).toBe(1500);
    expect(result.cashbox.expected_sellers_cash_due).toBe(1500);
    expect(result.cashbox.cash_discrepancy).toBe(0);
    expect(result.cashbox.warnings).toEqual([]);
    
    // Top-level convenience
    expect(result.cash_in_cashbox).toBe(1500);
    expect(result.expected_sellers_cash_due).toBe(1500);
  });
});

describe('normalizeSeller', () => {
  it('normalizes seller with all fallback fields', () => {
    const result = normalizeSeller({
      id: 5,
      name: 'Test Seller',
      cashRemaining: 1000,
      terminalDebt: 200,
    });

    expect(result.seller_id).toBe(5);
    expect(result.seller_name).toBe('Test Seller');
    expect(result.cash_due_to_owner).toBe(1000);
    expect(result.terminal_debt).toBe(200);
    expect(result.status).toBe('DEBT');
  });
});

describe('normalizeDispatcher', () => {
  it('returns defaults for null input', () => {
    const result = normalizeDispatcher(null);

    expect(result.deposit_cash).toBe(0);
    expect(result.salary_paid_cash).toBe(0);
    expect(result.salary_paid_total).toBe(0);
  });
});
