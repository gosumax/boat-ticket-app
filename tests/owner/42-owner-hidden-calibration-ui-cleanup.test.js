import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function importOwnerUiModules() {
  const previousReact = globalThis.React;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;

  globalThis.React = React;
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: 'visible',
  };

  const sellerModule = await import('../../src/views/OwnerSellersView.jsx');
  const motivationModule = await import('../../src/views/OwnerMotivationView.jsx');

  return {
    SellerCard: sellerModule.SellerCard,
    DayParticipantsTable: motivationModule.DayParticipantsTable,
    WeeklySellerTable: motivationModule.WeeklySellerTable,
    SeasonSellerTable: motivationModule.SeasonSellerTable,
    restore() {
      globalThis.React = previousReact;
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    },
  };
}

afterEach(() => {
  delete globalThis.React;
  delete globalThis.window;
  delete globalThis.document;
});

describe('OWNER hidden calibration UI cleanup', () => {
  it('keeps only calibration status and level on the owner seller card', async () => {
    const { SellerCard, restore } = await importOwnerUiModules();
    const html = renderToStaticMarkup(
      React.createElement(SellerCard, {
        rank: 1,
        isTop3: true,
        defaultExpanded: true,
        seller: {
          seller_id: 17,
          seller_name: 'Anna',
          revenue_forecast: 100000,
          revenue_paid: 80000,
          revenue_pending: 20000,
          revenue_per_shift: 50000,
          share_percent: 0.5,
          tickets_total: 20,
          tickets_paid: 15,
          tickets_pending: 5,
          shifts_count: 2,
          avg_check_paid: 4000,
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
      })
    );
    restore();

    expect(html).toContain('owner-seller-calibration-status-17');
    expect(html).toContain('owner-seller-calibration-level-17');
    expect(html).not.toContain('owner-seller-calibration-pending-17');
    expect(html).not.toContain('owner-seller-calibration-week-17');
    expect(html).not.toContain('owner-seller-calibration-next-week-17');
    expect(html).not.toContain('k:');
  });

  it('removes the calibration column from owner motivation day', async () => {
    const { DayParticipantsTable, restore } = await importOwnerUiModules();
    const html = renderToStaticMarkup(
      React.createElement(DayParticipantsTable, {
        rows: [
          {
            user_id: 10,
            name: 'Anna',
            zone: 'center',
            points_base: 12.4,
            k_streak: 1.1,
            points_total: 13.64,
            calibration_status: 'calibrated',
            effective_level: 'STRONG',
          },
        ],
      })
    );
    restore();

    expect(html).toContain('owner-motivation-day-participants-table');
    expect(html).toContain('Зона');
    expect(html).toContain('k(очков)');
    expect(html).not.toContain('Калибровка');
    expect(html).not.toContain('STRONG');
  });

  it('removes calibration and zone columns from owner motivation week', async () => {
    const { WeeklySellerTable, restore } = await importOwnerUiModules();
    const html = renderToStaticMarkup(
      React.createElement(WeeklySellerTable, {
        sellers: [
          {
            user_id: 11,
            name: 'Boris',
            zone: 'hedgehog',
            points_week_base: 20,
            k_streak: 1.2,
            points_week_total: 24,
            calibration_status: 'insufficient_data',
            effective_level: 'WEAK',
          },
        ],
      })
    );
    restore();

    expect(html).toContain('owner-motivation-week-table');
    expect(html).toContain('k(очков)');
    expect(html).not.toContain('Калибровка');
    expect(html).not.toContain('Зона');
    expect(html).not.toContain('insufficient_data');
    expect(html).not.toContain('WEAK');
  });

  it('removes the zone column from owner motivation season', async () => {
    const { SeasonSellerTable, restore } = await importOwnerUiModules();
    const html = renderToStaticMarkup(
      React.createElement(SeasonSellerTable, {
        sellers: [
          {
            user_id: 12,
            name: 'Clara',
            zone: 'sanatorium',
            points_total: 45,
            is_eligible: 1,
            worked_days_season: 80,
            worked_days_sep: 24,
            season_payout: 12345.67,
            season_payout_recipient: 1,
          },
        ],
        minWorkedDaysSeason: 75,
        minWorkedDaysSep: 20,
      })
    );
    restore();

    expect(html).toContain('owner-motivation-season-table');
    expect(html).toContain('Условие');
    expect(html).toContain('Выплата');
    expect(html).not.toContain('Зона');
    expect(html).not.toContain('sanatorium');
  });
});
