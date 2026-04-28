import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_MINI_APP_TRIPS_CATALOG_LIST_VERSION,
} from '../../server/telegram/index.js';
import {
  createMiniAppFoundationContext,
  MINI_APP_FUTURE_DATE,
} from './_mini-app-foundation-test-helpers.js';

describe('telegram mini app trips catalog query service', () => {
  let db;
  let context;
  let routingDecision;

  beforeEach(() => {
    const seeded = createMiniAppFoundationContext();
    db = seeded.db;
    context = seeded.context;
    routingDecision = seeded.routingDecision;
  });

  it('lists a frozen guest catalog with deterministic availability states', () => {
    const result = context.services.miniAppTripsCatalogQueryService.listMiniAppTripsForGuest(
      {
        telegram_guest: routingDecision.telegram_user_summary,
        date: MINI_APP_FUTURE_DATE,
        only_active_bookable: false,
      }
    );

    expect(result.response_version).toBe(TELEGRAM_MINI_APP_TRIPS_CATALOG_LIST_VERSION);
    expect(result.list_scope).toBe('mini_app_guest_trips_catalog');
    expect(result.item_count).toBe(5);
    expect(result.items.map((item) => item.booking_availability_state)).toEqual([
      'bookable',
      'low_availability',
      'unavailable',
      'bookable',
      'unavailable',
    ]);
    expect(result.items[0]).toMatchObject({
      projection_item_type: 'telegram_mini_app_trips_catalog_item',
      trip_slot_reference: {
        reference_type: 'telegram_requested_trip_slot_reference',
        requested_trip_date: MINI_APP_FUTURE_DATE,
      },
      trip_title_summary: {
        title: 'Sunrise sprint route',
      },
      trip_type_summary: {
        summary_type: 'available',
      },
      seats_availability_summary: {
        capacity_total: 12,
        availability_state: 'bookable',
      },
      price_summary: {
        summary_type: 'available',
        currency: 'RUB',
      },
      latest_timestamp_summary: {
        iso: expect.any(String),
        unix_seconds: expect.any(Number),
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items[0])).toBe(true);
    expect(Object.isFrozen(result.items[0].trip_slot_reference)).toBe(true);
  });

  it('lists catalog by date with deterministic filter behavior', () => {
    const result = context.services.miniAppTripsCatalogQueryService.listMiniAppTripsByDate({
      date: MINI_APP_FUTURE_DATE,
      trip_type: 'speed',
      only_active_bookable: true,
    });

    expect(result.list_scope).toBe('mini_app_trips_catalog_by_date');
    expect(result.item_count).toBe(3);
    expect(result.items.every((item) => item.booking_availability_state !== 'unavailable')).toBe(
      true
    );
    expect(result.items.every((item) => item.trip_type_summary.trip_type === 'speed')).toBe(true);
  });

  it('does not offer same-day trips that have already departed', () => {
    context.services.miniAppTripsCatalogQueryService.now = () =>
      new Date('2036-04-11T12:03:00.000Z');
    db.prepare(
      `
        INSERT INTO generated_slots (
          id, schedule_template_id, trip_date, boat_id, time, capacity, seats_left,
          duration_minutes, is_active, price_adult, price_child, price_teen
        )
        VALUES
          (45, 1, ?, 1, '15:00', 12, 12, 60, 1, 1500, 1000, 1200),
          (46, 1, ?, 1, '15:24', 12, 12, 60, 1, 1500, 1000, 1200)
      `
    ).run(MINI_APP_FUTURE_DATE, MINI_APP_FUTURE_DATE);

    const result = context.services.miniAppTripsCatalogQueryService.listMiniAppTripsForGuest(
      {
        telegram_guest: routingDecision.telegram_user_summary,
        date: MINI_APP_FUTURE_DATE,
        only_active_bookable: true,
      }
    );

    const slotUids = result.items.map((item) => item.trip_slot_reference.slot_uid);
    expect(slotUids).not.toContain('generated:45');
    expect(slotUids).toContain('generated:46');
  });

  it('rejects invalid filters and guest identity deterministically', () => {
    expect(() =>
      context.services.miniAppTripsCatalogQueryService.listMiniAppTripsForGuest({
        telegram_guest: null,
      })
    ).toThrow('telegram guest identity is required');

    expect(() =>
      context.services.miniAppTripsCatalogQueryService.listMiniAppTripsForGuest({
        telegram_guest: {
          telegram_user_id: 'missing-user',
        },
      })
    ).toThrow('No valid Telegram guest identity');

    expect(() =>
      context.services.miniAppTripsCatalogQueryService.listMiniAppTripsByDate({
        date: '2036-31-99',
      })
    ).toThrow('date must be a valid calendar date');

    expect(() =>
      context.services.miniAppTripsCatalogQueryService.listMiniAppTripsByDate({
        date: MINI_APP_FUTURE_DATE,
        trip_type: 'Speed Boat',
      })
    ).toThrow('trip_type filter must be a normalized identifier');

    expect(() =>
      context.services.miniAppTripsCatalogQueryService.listMiniAppTripsByDate({
        date: MINI_APP_FUTURE_DATE,
        only_active_bookable: 'y',
      })
    ).toThrow('only_active_bookable must be boolean');
  });
});
