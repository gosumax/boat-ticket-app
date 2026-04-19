import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_FAQ_GROUPINGS,
  TELEGRAM_USEFUL_CONTENT_GROUPINGS,
  TELEGRAM_WEATHER_DATA_STATES,
  TELEGRAM_WEATHER_USEFUL_CONTENT_READ_MODEL_VERSION,
} from '../../shared/telegram/index.js';
import {
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram useful-content and faq projection service', () => {
  let clock;
  let context;
  let seeded;

  beforeEach(() => {
    clock = createClock('2026-04-14T07:30:00.000Z');
    ({ context } = createTestContext(clock));
    wireClock(context, clock);
    seeded = seedBookingRequest(context, clock, {
      suffix: '6101',
    });
  });

  it('reads useful content feed for a telegram guest', () => {
    const feed =
      context.services.usefulContentFaqProjectionService.readUsefulContentFeedForTelegramGuest(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: seeded.guest.telegram_user_id,
          },
        }
      );

    expect(feed.item_count).toBeGreaterThan(0);
    expect(feed.telegram_user_summary.telegram_user_id).toBe(seeded.guest.telegram_user_id);
    expect(feed.items.every((item) => item.content_reference)).toBe(true);
    expect(Object.isFrozen(feed)).toBe(true);
    expect(Object.isFrozen(feed.items[0])).toBe(true);
  });

  it('builds weather-aware useful-content model when weather resolver returns full data', () => {
    const custom = createTestContext(clock, {
      telegramWeatherSnapshotResolver: () => ({
        condition_code: 'rain',
        condition_label: 'Rain showers',
        temperature_c: 9,
        wind_speed_mps: 9,
        precipitation_probability: 70,
        observed_at: '2026-04-14T07:25:00.000Z',
      }),
    });
    wireClock(custom.context, clock);
    const seededCustom = seedBookingRequest(custom.context, clock, {
      suffix: '6111',
      requestedTripDate: '2026-04-15',
      requestedTimeSlot: '11:30',
    });

    const model =
      custom.context.services.usefulContentFaqProjectionService.readWeatherUsefulContentModelForTelegramGuest(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: seededCustom.guest.telegram_user_id,
          },
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seededCustom.bookingRequestId,
          },
          reminder_type: '1_hour_before_trip',
        }
      );

    expect(model.response_version).toBe(
      TELEGRAM_WEATHER_USEFUL_CONTENT_READ_MODEL_VERSION
    );
    expect(model.weather_summary.weather_data_state).toBe('available');
    expect(
      model.weather_caring_content_summary.recommendation_lines.some((line) =>
        line.includes('Rain is possible')
      )
    ).toBe(true);
    expect(model.weather_caring_content_summary.reminder_status_line).toContain(
      'Rain is possible'
    );
    custom.db.close();
  });

  it('reads faq list and one faq item by reference', () => {
    const faqList =
      context.services.usefulContentFaqProjectionService.readFaqListForTelegramGuest({
        telegram_user_reference: {
          reference_type: 'telegram_user',
          telegram_user_id: seeded.guest.telegram_user_id,
        },
      });
    expect(faqList.item_count).toBeGreaterThan(0);
    expect(faqList.items.every((item) => item.faq_reference)).toBe(true);

    const firstFaqReference = faqList.items[0].faq_reference;
    const faqItem =
      context.services.usefulContentFaqProjectionService.readFaqItemByReference({
        faq_reference: {
          reference_type: 'telegram_faq_item',
          faq_reference: firstFaqReference,
        },
        telegram_user_reference: {
          reference_type: 'telegram_user',
          telegram_user_id: seeded.guest.telegram_user_id,
        },
      });
    expect(faqItem.faq_item.faq_reference).toBe(firstFaqReference);
    expect(faqItem.telegram_user_summary.telegram_user_id).toBe(seeded.guest.telegram_user_id);
  });

  it('supports deterministic grouping filters', () => {
    const filteredFeed =
      context.services.usefulContentFaqProjectionService.readUsefulContentFeedForTelegramGuest(
        {
          content_grouping: 'what_to_take',
        }
      );
    expect(filteredFeed.item_count).toBeGreaterThan(0);
    expect(
      filteredFeed.items.every(
        (item) => item.content_type_summary.content_grouping === 'what_to_take'
      )
    ).toBe(true);

    const filteredFaq =
      context.services.usefulContentFaqProjectionService.readFaqListForTelegramGuest({
        content_grouping: 'faq_trip_rules',
      });
    expect(filteredFaq.item_count).toBeGreaterThan(0);
    expect(
      filteredFaq.items.every(
        (item) => item.content_type_summary.content_grouping === 'faq_trip_rules'
      )
    ).toBe(true);
  });

  it('uses stable unavailable-weather fallback and supports not-applicable useful context', () => {
    const weatherAware =
      context.services.usefulContentFaqProjectionService.readWeatherUsefulContentModelForTelegramGuest(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: seeded.guest.telegram_user_id,
          },
          reminder_type: '30_minutes_before_trip',
        }
      );
    expect(weatherAware.weather_summary.weather_data_state).toBe('unavailable');
    expect(weatherAware.weather_caring_content_summary.reminder_status_line).toContain(
      'Boarding is soon'
    );

    const notApplicable =
      context.services.usefulContentFaqProjectionService.readWeatherUsefulContentModelForTelegramGuest();
    expect(notApplicable.trip_context_summary.applicability_state).toBe('not_applicable');
    expect(notApplicable.weather_summary.weather_data_state).toBe('unavailable');
  });

  it('keeps deterministic partial-weather state when only part of snapshot is available', () => {
    const partial = createTestContext(clock, {
      telegramWeatherSnapshotResolver: () => ({
        temperature_c: 27,
      }),
    });
    wireClock(partial.context, clock);
    const seededPartial = seedBookingRequest(partial.context, clock, {
      suffix: '6112',
      requestedTripDate: '2026-04-15',
      requestedTimeSlot: '10:30',
    });

    const model =
      partial.context.services.usefulContentFaqProjectionService.readWeatherUsefulContentModelForTelegramGuest(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: seededPartial.guest.telegram_user_id,
          },
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seededPartial.bookingRequestId,
          },
        }
      );

    expect(model.weather_summary.weather_data_state).toBe('partial');
    expect(model.weather_caring_content_summary.recommendation_lines.length).toBeGreaterThan(0);
    partial.db.close();
  });

  it('rejects invalid or non-projectable inputs deterministically', () => {
    expect(() =>
      context.services.usefulContentFaqProjectionService.readUsefulContentFeedForTelegramGuest({
        content_grouping: 'trip_discounts',
      })
    ).toThrow('Unsupported useful content grouping');

    expect(() =>
      context.services.usefulContentFaqProjectionService.readUsefulContentFeedForTelegramGuest({
        telegram_user_reference: {
          reference_type: 'telegram_chat',
          telegram_user_id: seeded.guest.telegram_user_id,
        },
      })
    ).toThrow('Unsupported telegram-user reference type');

    expect(() =>
      context.services.usefulContentFaqProjectionService.readFaqListForTelegramGuest({
        telegram_user_reference: {
          reference_type: 'telegram_user',
          telegram_user_id: 'tg-unknown-6101',
        },
      })
    ).toThrow('Guest profile not found');

    expect(() =>
      context.services.usefulContentFaqProjectionService.readFaqItemByReference({
        faq_reference: 'tg_faq_unknown',
      })
    ).toThrow('Invalid faq reference');

    expect(() =>
      context.services.usefulContentFaqProjectionService.readWeatherUsefulContentModelForTelegramGuest(
        {
          telegram_user_reference: {
            reference_type: 'telegram_user',
            telegram_user_id: 'tg-unknown-weather',
          },
        }
      )
    ).toThrow('Guest profile not found');
  });

  it('keeps deterministic content grouping coverage', () => {
    expect(TELEGRAM_USEFUL_CONTENT_GROUPINGS).toEqual([
      'useful_places',
      'what_to_take',
      'trip_help',
    ]);
    expect(TELEGRAM_FAQ_GROUPINGS).toEqual(['faq_general', 'faq_trip_rules']);
    expect(TELEGRAM_WEATHER_DATA_STATES).toEqual([
      'available',
      'partial',
      'unavailable',
    ]);
  });
});
