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
    expect('collected_mixed' in result.sellers[0]).toBe(false);
    expect('collected_split_unallocated' in result.sellers[0]).toBe(false);
    expect('mixed_due_to_owner' in result.sellers[0]).toBe(false);
    expect(result.sellers[1].cash_due_to_owner).toBe(0);
    expect(result.sellers[1].status).toBe('CLOSED');
    expect('collected_split_unallocated' in result).toBe(false);
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

  it('normalizes future reserve and reserve-adjusted owner cash fields', () => {
    const input = {
      owner_cash_available: 5000,
      owner_cash_available_after_future_reserve_cash: 3800,
      owner_cash_available_after_reserve_and_funds_cash: 3400,
      owner_handover_cash_final: 3400,
      funds_withhold_cash_today: 400,
      future_trips_reserve_cash: 1200,
      future_trips_reserve_card: 800,
      future_trips_reserve_total: 2000,
      salary_base: 7500,
      explain: {
        liabilities: {
          future_trips_reserve_cash: 1200,
          future_trips_reserve_terminal: 800,
        },
      },
    };

    const result = normalizeSummary(input);

    expect(result.owner_cash_available).toBe(5000);
    expect(result.owner_cash_available_after_future_reserve_cash).toBe(3800);
    expect(result.owner_cash_available_after_reserve_and_funds_cash).toBe(3400);
    expect(result.owner_handover_cash_final).toBe(3400);
    expect(result.funds_withhold_cash_today).toBe(400);
    expect(result.future_trips_reserve_cash).toBe(1200);
    expect(result.future_trips_reserve_card).toBe(800);
    expect(result.future_trips_reserve_total).toBe(2000);
    expect(result.salary_base).toBe(7500);
  });

  it('uses shift_close_breakdown as canonical numeric fallback for top-level summary fields', () => {
    const input = {
      source: 'snapshot',
      is_closed: true,
      shift_close_breakdown: {
        version: 'shift_close_v2026_04_02',
        totals: {
          cash_received: 160900,
          card_received: 80700,
          total_received: 241600,
          reserve_cash: 900,
          reserve_card: 700,
          reserve_total: 1600,
          collect_from_sellers: 201600,
          salary_base: 240000,
          motivation_fund: 36000,
          weekly_fund: 288,
          season_from_revenue: 180,
          season_base: 180,
          season_rounding: 0,
          season_prepay_transfer: 0,
          season_fund_total: 180,
          dispatcher_bonus: 72,
          salary_fund_total: 35460,
          final_salary_total: 35460,
          owner_cash_before_reserve: 4540,
          owner_cash_after_reserve: 3640,
          owner_cash_today: 3100,
          funds_withhold_cash_today: 540,
        },
        participants: [
          {
            user_id: '1',
            collected_cash: '120900',
            collected_card: '80700',
            collect_to_owner_total: '201600',
            final_salary_total: '35460',
          },
        ],
      },
      sellers: [],
    };

    const result = normalizeSummary(input);

    expect(result.collected_cash).toBe(160900);
    expect(result.collected_card).toBe(80700);
    expect(result.collected_total).toBe(241600);
    expect(result.future_trips_reserve_cash).toBe(900);
    expect(result.future_trips_reserve_card).toBe(700);
    expect(result.future_trips_reserve_total).toBe(1600);
    expect(result.sellers_collect_total).toBe(201600);
    expect(result.salary_base).toBe(240000);
    expect(result.salary_due_total).toBe(35460);
    expect(result.salary_to_pay).toBe(35460);
    expect(result.final_salary_total).toBe(35460);
    expect(result.weekly_fund).toBe(288);
    expect(result.season_fund_total).toBe(180);
    expect(result.funds_withhold_cash_today).toBe(540);
    expect(result.owner_cash_available_without_future_reserve).toBe(4540);
    expect(result.owner_cash_available_after_future_reserve_cash).toBe(3640);
    expect(result.owner_handover_cash_final).toBe(3100);
    expect(result.shift_close_breakdown.totals.owner_cash_today).toBe(3100);
    expect(result.shift_close_breakdown.participants[0].user_id).toBe(1);
    expect(result.shift_close_breakdown.participants[0].final_salary_total).toBe(35460);
  });

  it('prefers top-level unified aliases when backend exposes ready-made server totals', () => {
    const input = {
      salary_to_pay: 16100,
      weekly_fund: 900,
      season_fund_total: 1760,
      owner_cash_today: 61140,
      sellers: [
        {
          seller_id: 11,
          seller_name: 'dispatcher',
          salary_due_total: 16100,
        },
      ],
    };

    const result = normalizeSummary(input);

    expect(result.salary_to_pay).toBe(16100);
    expect(result.final_salary_total).toBe(16100);
    expect(result.weekly_fund).toBe(900);
    expect(result.season_fund_total).toBe(1760);
    expect(result.owner_cash_today).toBe(61140);
    expect(result.sellers[0].salary_to_pay).toBe(16100);
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

  it('normalizes motivation_withhold extended rounding fields', () => {
    const input = {
      business_day: '2026-02-25',
      motivation_withhold: {
        weekly_amount_raw: 123.45,
        weekly_amount: 100,
        season_amount: 89.6,
        season_from_revenue: 89.6,
        season_fund_total: 1289.6,
        season_total: 1289.6,
        season_amount_base: 75,
        season_amount_from_rounding: 14.6,
        season_amount_from_cancelled_prepayment: 1200,
        season_from_prepayment_transfer: 1200,
        weekly_rounding_to_season_amount: 23.45,
        dispatcher_rounding_to_season_amount: 1.15,
        payouts_rounding_to_season_amount: 3.0,
        rounding_to_season_amount_total: 27.6,
        dispatcher_amount_total: 50,
        fund_total_original: 1000,
        fund_total_after_withhold: 760.4,
        salary_fund_total: 760.4,
      },
    };

    const result = normalizeSummary(input);

    expect(result.motivation_withhold).toBeDefined();
    expect(result.motivation_withhold.weekly_amount_raw).toBe(123.45);
    expect(result.motivation_withhold.weekly_amount).toBe(100);
    expect(result.motivation_withhold.season_amount).toBe(89.6);
    expect(result.motivation_withhold.season_from_revenue).toBe(89.6);
    expect(result.motivation_withhold.season_fund_total).toBe(1289.6);
    expect(result.motivation_withhold.season_total).toBe(1289.6);
    expect(result.motivation_withhold.season_amount_base).toBe(75);
    expect(result.motivation_withhold.season_amount_from_cancelled_prepayment).toBe(1200);
    expect(result.motivation_withhold.season_from_prepayment_transfer).toBe(1200);
    expect(result.motivation_withhold.rounding_to_season_amount_total).toBe(27.6);
    expect(result.motivation_withhold.fund_total_after_withhold).toBe(760.4);
    expect(result.motivation_withhold.salary_fund_total).toBe(760.4);
  });

  it('keeps dispatcher rows with sales and filters invalid seller ids', () => {
    const input = {
      sellers: [
        { seller_id: 7, seller_name: 'seller_a', role: 'seller', cash_due_to_owner: 100 },
        { seller_id: 3, seller_name: 'dispatcher_user', role: 'dispatcher', collected_total: 200, salary_due_total: 0 },
        { seller_id: 0, seller_name: '1', role: 'seller', cash_due_to_owner: 300 },
      ],
    };

    const result = normalizeSummary(input);
    expect(result.sellers).toHaveLength(2);
    expect(result.sellers.map((s) => s.seller_id).sort((a, b) => a - b)).toEqual([3, 7]);
    const dispatcherRow = result.sellers.find((s) => s.seller_id === 3);
    expect(dispatcherRow?.seller_name).toBe('dispatcher_user');
    expect(dispatcherRow?.role).toBe('dispatcher');
  });

  it('builds participants_with_sales by total_collected regardless of role', () => {
    const input = {
      sellers: [
        { seller_id: 7, seller_name: 'seller_a', role: 'seller', total_collected: 100 },
        { seller_id: 3, seller_name: 'dispatcher_user', role: 'dispatcher', total_collected: 200 },
        { seller_id: 9, seller_name: 'owner_user', role: 'owner', total_collected: 300 },
        { seller_id: 0, seller_name: 'invalid', role: 'seller', total_collected: 500 },
      ],
    };

    const result = normalizeSummary(input);
    expect(result.participants_with_sales.map((s) => s.seller_id).sort((a, b) => a - b)).toEqual([3, 7, 9]);
    expect(result.participants_with_sales.find((s) => s.seller_id === 3)?.collected_total).toBe(200);
  });

  it('filters dispatcher rows without sales, salary, and attribution', () => {
    const input = {
      sellers: [
        { seller_id: 7, seller_name: 'seller_a', role: 'seller', cash_due_to_owner: 100 },
        { seller_id: 3, seller_name: 'dispatcher_user', role: 'dispatcher', collected_total: 0, salary_due_total: 0 },
      ],
    };

    const result = normalizeSummary(input);
    expect(result.sellers).toHaveLength(1);
    expect(result.sellers[0].seller_id).toBe(7);
  });

  it('reconstructs the current dispatcher row when summary totals contain hidden dispatcher sales', () => {
    const input = {
      business_day: '2026-04-02',
      collected_total: 21000,
      collected_cash: 18000,
      collected_card: 3000,
      salary_due_total: 2800,
      sellers: [
        {
          seller_id: 4,
          seller_name: 'seller_a',
          role: 'seller',
          collected_total: 6000,
          collected_cash: 6000,
          collected_card: 0,
          salary_due_total: 1050,
        },
        {
          seller_id: 7,
          seller_name: 'seller_b',
          role: 'seller',
          collected_total: 6000,
          collected_cash: 6000,
          collected_card: 0,
          salary_due_total: 1400,
        },
      ],
    };

    const result = normalizeSummary(input, {
      currentUser: { id: 3, username: 'Maria', role: 'dispatcher' },
    });

    const dispatcherRow = result.sellers.find((s) => s.seller_id === 3);
    expect(dispatcherRow).toBeDefined();
    expect(dispatcherRow?.seller_name).toBe('Maria');
    expect(dispatcherRow?.role).toBe('dispatcher');
    expect(dispatcherRow?.salary_due_total).toBe(350);
    expect(dispatcherRow?.collected_total).toBeGreaterThan(0);
    expect(dispatcherRow?.cash_due_to_owner).toBe(0);
    expect(dispatcherRow?.terminal_due_to_owner).toBe(0);

    const dispatcherParticipant = result.participants_with_sales.find((s) => s.seller_id === 3);
    expect(dispatcherParticipant).toBeDefined();
    expect(dispatcherParticipant?.collected_total).toBeGreaterThan(0);
  });
});

describe('normalizeSeller', () => {
  it('normalizes seller with all fallback fields', () => {
    const result = normalizeSeller({
      id: 5,
      name: 'Test Seller',
      cashRemaining: 1000,
      terminalDebt: 200,
      collected_mixed: 300,
      mixed_due_to_owner: 100,
    });

    expect(result.seller_id).toBe(5);
    expect(result.seller_name).toBe('Test Seller');
    expect(result.cash_due_to_owner).toBe(1000);
    expect(result.terminal_debt).toBe(200);
    expect(result.status).toBe('DEBT');
    expect('collected_mixed' in result).toBe(false);
    expect('mixed_due_to_owner' in result).toBe(false);
  });

  it('preserves salary breakdown fields for shift close rendering', () => {
    const result = normalizeSeller({
      seller_id: 11,
      seller_name: 'Salary Breakdown',
      role: 'dispatcher',
      salary_due_total: 1550,
      team_part: 1200,
      individual_part: 350,
      dispatcher_daily_bonus: 200,
      total_raw: 1575,
      salary_rounding_to_season: 25,
      personal_revenue_day: 5000,
    });

    expect(result.seller_id).toBe(11);
    expect(result.role).toBe('dispatcher');
    expect(result.salary_due_total).toBe(1550);
    expect(result.team_part).toBe(1200);
    expect(result.individual_part).toBe(350);
    expect(result.dispatcher_daily_bonus).toBe(200);
    expect(result.total_raw).toBe(1575);
    expect(result.salary_rounding_to_season).toBe(25);
    expect(result.personal_revenue_day).toBe(5000);
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
