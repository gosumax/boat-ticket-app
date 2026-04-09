import { describe, expect, it } from 'vitest';
import {
  buildSellerDashboardModel,
  filterSellerSalesByPreset,
  getPaymentStatusViewModel,
  getSeatCountFromSale,
} from '../../src/utils/sellerDashboard.js';

const MOSCOW_TZ = 'Europe/Moscow';

describe('sellerDashboard helpers', () => {
  it('counts seats from direct field and tickets_json fallback', () => {
    expect(getSeatCountFromSale({ number_of_seats: 3 })).toBe(3);
    expect(
      getSeatCountFromSale({
        tickets_json: JSON.stringify({ adult: 2, teen: 1, child: 1 }),
      })
    ).toBe(4);
  });

  it('derives payment status from existing sale fields without inventing new logic', () => {
    expect(
      getPaymentStatusViewModel({ total_price: 5000, prepayment_amount: 5000 }).kind
    ).toBe('fully_paid');
    expect(
      getPaymentStatusViewModel({ total_price: 5000, prepayment_amount: 1500 }).kind
    ).toBe('prepayment');
    expect(
      getPaymentStatusViewModel({ total_price: 5000, prepayment_amount: 0 }).kind
    ).toBe('unpaid');
  });

  it('builds today and future-trip buckets from existing presale data', () => {
    const model = buildSellerDashboardModel(
      [
        {
          id: 1,
          total_price: 5000,
          prepayment_amount: 5000,
          number_of_seats: 2,
          created_at: '2026-04-08 09:00:00',
          slot_trip_date: '2026-04-08',
          slot_time: '12:00',
          boat_type: 'speed',
          boat_name: 'Комета',
        },
        {
          id: 2,
          total_price: 3000,
          prepayment_amount: 1000,
          number_of_seats: 1,
          created_at: '2026-04-08 11:30:00',
          slot_trip_date: '2026-04-09',
          slot_time: '15:30',
          boat_type: 'banana',
          boat_name: 'Жёлтый',
        },
        {
          id: 3,
          total_price: 2000,
          prepayment_amount: 0,
          number_of_seats: 1,
          created_at: '2026-04-07 18:00:00',
          slot_trip_date: '2026-04-10',
          slot_time: '10:00',
          boat_type: 'cruise',
          boat_name: 'Волна',
        },
      ],
      '2026-04-08'
    );

    expect(model.summary.amountToday).toBe(8000);
    expect(model.summary.salesCountToday).toBe(2);
    expect(model.summary.seatsCountToday).toBe(3);
    expect(model.summary.fullyPaidCountToday).toBe(1);
    expect(model.summary.prepaymentCountToday).toBe(1);
    expect(model.summary.todayTripSalesCountToday).toBe(1);
    expect(model.summary.futureTripSalesCountToday).toBe(1);
    expect(model.tabs.today).toHaveLength(2);
    expect(model.tabs.futureTrips).toHaveLength(2);
  });

  it('filters sales by seller presets using trip day rather than button visuals only', () => {
    const model = buildSellerDashboardModel(
      [
        {
          id: 1,
          total_price: 5000,
          prepayment_amount: 5000,
          number_of_seats: 2,
          created_at: '2026-04-08 09:00:00',
          slot_trip_date: '2026-04-08',
          slot_time: '12:00',
          boat_type: 'speed',
          boat_name: 'Комета',
        },
        {
          id: 2,
          total_price: 3000,
          prepayment_amount: 1000,
          number_of_seats: 1,
          created_at: '2026-04-08 11:30:00',
          slot_trip_date: '2026-04-09',
          slot_time: '15:30',
          boat_type: 'banana',
          boat_name: 'Жёлтый',
        },
        {
          id: 3,
          total_price: 2000,
          prepayment_amount: 0,
          number_of_seats: 1,
          created_at: '2026-04-07 18:00:00',
          slot_trip_date: '2026-04-10',
          slot_time: '10:00',
          boat_type: 'cruise',
          boat_name: 'Волна',
        },
      ],
      '2026-04-08',
    );

    expect(
      filterSellerSalesByPreset(model.sales, {
        preset: 'today',
        today: '2026-04-08',
        tomorrow: '2026-04-09',
      }).map((row) => row.id)
    ).toEqual([1]);

    expect(
      filterSellerSalesByPreset(model.sales, {
        preset: 'tomorrow',
        today: '2026-04-08',
        tomorrow: '2026-04-09',
      }).map((row) => row.id)
    ).toEqual([2]);

    expect(
      filterSellerSalesByPreset(model.sales, {
        preset: 'date',
        selectedDate: '2026-04-10',
        today: '2026-04-08',
        tomorrow: '2026-04-09',
      }).map((row) => row.id)
    ).toEqual([3]);

    expect(
      filterSellerSalesByPreset(model.sales, {
        preset: 'all',
        today: '2026-04-08',
        tomorrow: '2026-04-09',
      }).map((row) => row.id)
    ).toEqual([2, 1, 3]);
  });

  it('merges backend seller metrics into the dashboard model without inventing frontend values', () => {
    const model = buildSellerDashboardModel(
      [
        {
          id: 1,
          total_price: 5000,
          prepayment_amount: 5000,
          number_of_seats: 2,
          created_at: '2026-04-08 09:00:00',
          slot_trip_date: '2026-04-08',
          slot_time: '12:00',
          boat_type: 'speed',
          boat_name: 'Комета',
        },
      ],
      '2026-04-08',
      {
        dates: {
          today: '2026-04-08',
          tomorrow: '2026-04-09',
        },
        earnings: {
          available: true,
          value: 1350,
        },
        points: {
          today: 7.2,
        },
        prepayments_today: {
          available: true,
          cash: 1200,
          card: 800,
          total: 2000,
        },
        streak: {
          available: true,
          calibrated: true,
          calibration_worked_days: 3,
          current_level: 'MID',
          current_series: 2,
          multiplier: 1.05,
          threshold: 60000,
          today_revenue: 42000,
          today_completed: false,
        },
        week: {
          available: true,
          week_id: '2026-W15',
          date_from: '2026-04-06',
          date_to: '2026-04-12',
          place: 2,
          points: 16.4,
          revenue: 24000,
          total_sellers: 4,
          current_payout: 481,
          prize_place: 2,
          participating: true,
          prizes: [
            { place: 1, amount: 802 },
            { place: 2, amount: 481 },
            { place: 3, amount: 321 },
          ],
        },
        season: {
          available: true,
          season_id: '2026',
          season_from: '2026-05-01',
          season_to: '2026-10-01',
          place: 3,
          points: 42.9,
          revenue: 64000,
          total_sellers: 8,
          current_payout: 7500,
          season_share: 0.2,
          season_payout_recipient: 1,
          payout_scheme: 'top3',
          payout_mode: 'eligible_top3_weighted_by_rank',
          fund_total: 37500,
          eligible_count: 5,
          recipient_count: 3,
          participating: true,
          is_eligible: false,
          worked_days_season: 32,
          worked_days_required: 75,
          remaining_days_season: 43,
          worked_days_sep: 5,
          worked_days_sep_required: 20,
          remaining_days_sep: 15,
          worked_days_end_sep: 0,
          worked_days_end_sep_required: 1,
          remaining_days_end_sep: 1,
        },
      },
    );

    expect(model.earnings.available).toBe(true);
    expect(model.earnings.value).toBe(1350);
    expect(model.summary.pointsToday).toBe(7.2);
    expect(model.summary.prepaymentsToday).toMatchObject({
      available: true,
      cash: 1200,
      card: 800,
      total: 2000,
    });
    expect(model.summary.todayTripAmount).toBe(5000);
    expect(model.streak.available).toBe(true);
    expect(model.streak.currentSeries).toBe(2);
    expect(model.rating.currentSellerWeek).toMatchObject({
      place: 2,
      points: 16.4,
      totalSellers: 4,
      currentPayout: 481,
      prizePlace: 2,
      participating: true,
    });
    expect(model.rating.currentSellerWeek.prizes).toEqual([
      { place: 1, amount: 802 },
      { place: 2, amount: 481 },
      { place: 3, amount: 321 },
    ]);
    expect(model.rating.currentSellerSeason).toMatchObject({
      place: 3,
      points: 42.9,
      totalSellers: 8,
      currentPayout: 7500,
      payoutRecipient: true,
      isEligible: false,
      workedDaysSeason: 32,
      remainingDaysSeason: 43,
      workedDaysSep: 5,
      remainingDaysSep: 15,
      workedDaysEndSep: 0,
      remainingDaysEndSep: 1,
    });
  });

  it('keeps the real issue-day seller metrics intact in the dashboard model', () => {
    const model = buildSellerDashboardModel(
      [
        {
          id: 1,
          total_price: 3000,
          prepayment_amount: 1000,
          number_of_seats: 3,
          created_at: '2026-04-09 09:00:00',
          slot_trip_date: '2026-04-09',
          slot_time: '10:00',
          boat_type: 'speed',
          boat_name: 'РЎРєРѕСЂРѕСЃС‚РЅРѕР№ 1',
        },
        {
          id: 2,
          total_price: 3000,
          prepayment_amount: 3000,
          number_of_seats: 3,
          created_at: '2026-04-09 11:00:00',
          slot_trip_date: '2026-04-09',
          slot_time: '12:00',
          boat_type: 'speed',
          boat_name: 'РЎРєРѕСЂРѕСЃС‚РЅРѕР№ 2',
        },
        {
          id: 3,
          total_price: 21000,
          prepayment_amount: 1000,
          number_of_seats: 21,
          created_at: '2026-04-09 13:00:00',
          slot_trip_date: '2026-04-09',
          slot_time: '14:00',
          boat_type: 'speed',
          boat_name: 'РЎРєРѕСЂРѕСЃС‚РЅРѕР№ 3',
        },
      ],
      '2026-04-09',
      {
        dates: {
          today: '2026-04-09',
          tomorrow: '2026-04-10',
        },
        earnings: {
          available: true,
          value: 1900,
        },
        points: {
          today: 12,
        },
        prepayments_today: {
          available: true,
          cash: 4000,
          card: 0,
          total: 4000,
        },
      },
    );

    expect(model.summary.todayTripAmount).toBe(27000);
    expect(model.earnings.value).toBe(1900);
    expect(model.summary.pointsToday).toBe(12);
    expect(model.summary.prepaymentsToday).toMatchObject({
      available: true,
      cash: 4000,
      card: 0,
      total: 4000,
    });
  });

  it('keeps sale creation time separate from trip time for seller cards and details', () => {
    const model = buildSellerDashboardModel(
      [
        {
          id: 11,
          total_price: 5000,
          prepayment_amount: 1500,
          number_of_seats: 2,
          created_at: '2026-04-08 14:22:00',
          slot_trip_date: '2026-04-09',
          slot_time: '12:00',
          boat_type: 'speed',
          boat_name: 'Комета',
        },
      ],
      '2026-04-08',
      null,
      { timeZone: MOSCOW_TZ },
    );

    expect(model.sales).toHaveLength(1);
    expect(model.sales[0].createdDay).toBe('2026-04-08');
    expect(model.sales[0].createdTimeLabel).toBe('17:22');
    expect(model.sales[0].createdAtLabel).toContain('17:22');
    expect(model.sales[0].tripTimeLabel).toBe('12:00');
  });

  it('keeps created-day grouping in the same local timezone normalization as the visible time label', () => {
    const model = buildSellerDashboardModel(
      [
        {
          id: 12,
          total_price: 3200,
          prepayment_amount: 0,
          number_of_seats: 1,
          created_at: '2026-04-08 21:30:00',
          slot_trip_date: '2026-04-10',
          slot_time: '09:00',
          boat_type: 'banana',
          boat_name: 'Boat',
        },
      ],
      '2026-04-09',
      null,
      { timeZone: MOSCOW_TZ },
    );

    expect(model.sales[0].createdDay).toBe('2026-04-09');
    expect(model.sales[0].createdTimeLabel).toBe('00:30');
    expect(model.summary.salesCountToday).toBe(1);
  });
});
