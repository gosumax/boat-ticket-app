import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_MINI_APP_TRIP_CARD_RESULT_VERSION,
} from '../../server/telegram/index.js';
import {
  createMiniAppFoundationContext,
  MINI_APP_FUTURE_DATE,
} from './_mini-app-foundation-test-helpers.js';

describe('telegram mini app trip-card query service', () => {
  let context;

  beforeEach(() => {
    context = createMiniAppFoundationContext().context;
  });

  it('reads one frozen detailed trip card by trip/slot reference', () => {
    const result =
      context.services.miniAppTripCardQueryService.readMiniAppTripCardByTripSlotReference(
        {
          requested_trip_slot_reference: {
            reference_type: 'telegram_requested_trip_slot_reference',
            requested_trip_date: MINI_APP_FUTURE_DATE,
            requested_time_slot: '12:00',
            slot_uid: 'generated:42',
          },
        }
      );

    expect(result).toMatchObject({
      response_version: TELEGRAM_MINI_APP_TRIP_CARD_RESULT_VERSION,
      trip_slot_reference: {
        reference_type: 'telegram_requested_trip_slot_reference',
        slot_uid: 'generated:42',
        requested_trip_date: MINI_APP_FUTURE_DATE,
        requested_time_slot: '12:00',
      },
      trip_title_summary: {
        title: 'Sunrise sprint route',
      },
      trip_type_summary: {
        summary_type: 'available',
        trip_type: 'speed',
      },
      trip_description_summary: {
        summary_type: 'available',
        short_description: 'Sunrise sprint route',
      },
      route_meeting_point_summary: {
        summary_type: 'unavailable',
      },
      booking_availability_state: 'low_availability',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.trip_slot_reference)).toBe(true);
  });

  it('returns manual slot card details with deterministic summaries', () => {
    const result =
      context.services.miniAppTripCardQueryService.readMiniAppTripCardByTripSlotReference(
        {
          requested_trip_slot_reference: {
            reference_type: 'telegram_requested_trip_slot_reference',
            requested_trip_date: MINI_APP_FUTURE_DATE,
            requested_time_slot: '16:00',
            slot_uid: 'manual:51',
            boat_slot_id: 51,
          },
        }
      );

    expect(result.trip_slot_reference.slot_uid).toBe('manual:51');
    expect(result.trip_description_summary).toMatchObject({
      summary_type: 'available',
      short_description: 'Duration 75 minutes',
      source: 'slot.duration_minutes',
    });
    expect(result.price_summary.summary_type).toBe('available');
    expect(result.booking_availability_state).toBe('bookable');
  });

  it('rejects invalid or non-projectable references deterministically', () => {
    expect(() =>
      context.services.miniAppTripCardQueryService.readMiniAppTripCardByTripSlotReference({
        requested_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          slot_uid: 'speed-42',
        },
      })
    ).toThrow('slot_uid must match manual:<id> or generated:<id>');

    expect(() =>
      context.services.miniAppTripCardQueryService.readMiniAppTripCardByTripSlotReference({
        requested_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          slot_uid: 'generated:999',
        },
      })
    ).toThrow('Invalid trip/slot reference');

    expect(() =>
      context.services.miniAppTripCardQueryService.readMiniAppTripCardByTripSlotReference({
        requested_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          requested_trip_date: '2036-04-19',
          requested_time_slot: '12:00',
          slot_uid: 'generated:42',
        },
      })
    ).toThrow('Trip/slot date mismatch');

    expect(() =>
      context.services.miniAppTripCardQueryService.readMiniAppTripCardByTripSlotReference({
        requested_trip_slot_reference: {
          reference_type: 'telegram_requested_trip_slot_reference',
          slot_uid: 'manual:60',
        },
      })
    ).toThrow('non-projectable');
  });
});

