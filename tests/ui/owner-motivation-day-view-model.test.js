import { describe, expect, it } from 'vitest';

import { buildOwnerMotivationDayViewModel } from '../../src/utils/ownerMotivationDayViewModel.js';

describe('buildOwnerMotivationDayViewModel', () => {
  it('keeps seller-only rows and computes daily funds from withhold amounts', () => {
    const viewModel = buildOwnerMotivationDayViewModel({
      business_day: '2026-04-03',
      payouts: [
        { user_id: 10, name: 'Anna', role: 'seller', zone: 'center' },
        { user_id: 11, name: 'Maria', role: 'dispatcher', dispatcher_daily_bonus: 50 },
      ],
      points_by_user: [
        { user_id: 10, zone: 'center', points_base: 12.4, k_streak: 1.1, points_total: 13.64 },
        { user_id: 11, points_base: 0, k_streak: 1, points_total: 0 },
      ],
      withhold: {
        weekly_amount: 200,
        season_amount: 350,
      },
    });

    expect(viewModel.business_day).toBe('2026-04-03');
    expect(viewModel.participants).toBe(1);
    expect(viewModel.weekly_amount_day).toBe(200);
    expect(viewModel.season_amount_day).toBe(350);
    expect(viewModel.total_funds_day).toBe(550);
    expect(viewModel.seller_rows).toEqual([
      expect.objectContaining({
        user_id: 10,
        name: 'Anna',
        role: 'seller',
        zone: 'center',
        points_base: 12.4,
        k_streak: 1.1,
        points_total: 13.64,
      }),
    ]);
    expect(viewModel.seller_rows.find((row) => row.name === 'Maria')).toBeUndefined();
  });

  it('prefers daily fund totals over shift-close decision metrics', () => {
    const viewModel = buildOwnerMotivationDayViewModel(
      {
        business_day: '2026-04-03',
        payouts: [
          { user_id: 10, name: 'Anna', role: 'seller', zone: 'center' },
          { user_id: 11, name: 'Maria', role: 'dispatcher' },
        ],
        points_by_user: [
          { user_id: 10, zone: 'center', points_base: 12.4, k_streak: 1.1, points_total: 13.64 },
        ],
        withhold: {
          weekly_amount: 250,
          season_amount: 200,
        },
      },
      '2026-04-03',
      {
        owner_decision_metrics: {
          withhold_weekly_today: 300,
          withhold_season_today: 330,
        },
        totals: {
          funds_withhold_weekly_today: 250,
          funds_withhold_season_today: 200,
          weekly_fund: 300,
          season_fund_total: 330,
        },
      }
    );

    expect(viewModel.participants).toBe(1);
    expect(viewModel.weekly_amount_day).toBe(250);
    expect(viewModel.season_amount_day).toBe(200);
    expect(viewModel.total_funds_day).toBe(450);
    expect(viewModel.seller_rows.find((row) => row.name === 'Maria')).toBeUndefined();
  });

  it('prefers explicit day aliases when they are present', () => {
    const viewModel = buildOwnerMotivationDayViewModel({
      business_day: '2026-04-03',
      weekly_amount_day: 500,
      season_amount_day: 700,
      total_funds_day: 1200,
      payouts: [],
      points_by_user: [],
      withhold: {
        weekly_amount: 200,
        season_amount: 350,
      },
    });

    expect(viewModel.weekly_amount_day).toBe(500);
    expect(viewModel.season_amount_day).toBe(700);
    expect(viewModel.total_funds_day).toBe(1200);
  });

  it('carries additive owner calibration visibility from the hidden sidecar state', () => {
    const viewModel = buildOwnerMotivationDayViewModel({
      business_day: '2026-04-15',
      payouts: [
        {
          user_id: 10,
          name: 'Anna',
          role: 'seller',
          zone: 'center',
          seller_calibration_state: {
            calibration_status: 'calibrated',
            effective_level: 'STRONG',
            pending_next_week_level: 'TOP',
            streak_days: 4,
            streak_multiplier: 1.4,
            effective_week_id: '2026-W16',
            pending_week_id: '2026-W17',
          },
        },
      ],
      points_by_user: [
        {
          user_id: 10,
          zone: 'center',
          points_base: 12.4,
          k_streak: 1.1,
          points_total: 13.64,
        },
      ],
    });

    expect(viewModel.seller_rows).toEqual([
      expect.objectContaining({
        user_id: 10,
        calibration_status: 'calibrated',
        effective_level: 'STRONG',
        pending_next_week_level: 'TOP',
        streak_multiplier: 1.4,
        effective_week_id: '2026-W16',
        pending_week_id: '2026-W17',
        seller_calibration_state: expect.objectContaining({
          streak_days: 4,
          streak_multiplier: 1.4,
        }),
      }),
    ]);
  });
});
