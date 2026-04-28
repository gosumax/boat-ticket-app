import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_FAQ_GROUPINGS,
  TELEGRAM_USEFUL_CONTENT_GROUPINGS,
  TELEGRAM_USEFUL_RESORT_CARD_REFERENCES,
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

  it('upgrades legacy v1 FAQ baseline rows to the current russian buyer-facing copy', () => {
    const nowIso = clock.now().toISOString();
    const managedContentItems = context.repositories.managedContentItems;
    const legacyRows = [
      {
        content_reference: 'tg_faq_general_001',
        content_group: 'faq_general',
        title_summary: 'When should I arrive before departure?',
        short_text_summary: 'Arrive at least 15 minutes before your selected time slot.',
      },
      {
        content_reference: 'tg_faq_general_002',
        content_group: 'faq_general',
        title_summary: 'Can I change my contact phone?',
        short_text_summary:
          'Yes, contact support and include your booking request reference.',
      },
      {
        content_reference: 'tg_faq_trip_rules_001',
        content_group: 'faq_trip_rules',
        title_summary: 'Are life jackets provided?',
        short_text_summary: 'Yes, safety equipment is provided before boarding.',
      },
      {
        content_reference: 'tg_faq_trip_rules_002',
        content_group: 'faq_trip_rules',
        title_summary: 'Is smoking allowed during the trip?',
        short_text_summary: 'No, smoking is not allowed during passenger trips.',
      },
    ];

    for (const row of legacyRows) {
      managedContentItems.create({
        content_reference: row.content_reference,
        content_group: row.content_group,
        content_type: 'faq_item',
        title_summary: row.title_summary,
        short_text_summary: row.short_text_summary,
        visibility_action_summary: {
          visibility_state: 'visible',
          action_type: 'none',
          action_reference: null,
        },
        is_enabled: 1,
        content_version: 1,
        is_latest_version: 1,
        versioned_from_item_id: null,
        created_at: nowIso,
        updated_at: nowIso,
      });
    }

    const faqList =
      context.services.usefulContentFaqProjectionService.readFaqListForTelegramGuest();
    const faqByReference = new Map(
      faqList.items.map((item) => [item.faq_reference, item])
    );

    expect(faqByReference.get('tg_faq_general_001')?.title_short_text_summary?.title).toBe(
      'Можно ли с детьми'
    );
    expect(faqByReference.get('tg_faq_general_002')?.title_short_text_summary?.title).toBe(
      'Можно ли беременным'
    );
    expect(
      faqByReference.get('tg_faq_trip_rules_001')?.title_short_text_summary?.title
    ).toBe('Когда приходить');
    expect(
      faqByReference.get('tg_faq_trip_rules_002')?.title_short_text_summary?.title
    ).toBe('Как пройти');

    const upgraded = managedContentItems.findOneBy(
      { content_reference: 'tg_faq_general_001', is_latest_version: 1 },
      { orderBy: 'content_version DESC' }
    );
    expect(Number(upgraded?.content_version)).toBe(2);
  });

  it('builds weather-aware useful-content model when weather resolver returns full data', () => {
    const custom = createTestContext(clock, {
      telegramWeatherSnapshotResolver: () => ({
        condition_code: 'rain',
        condition_label: 'Ливневый дождь',
        temperature_c: 9,
        water_temperature_c: 14,
        sunset_time_iso: '2026-04-14T16:41:00.000Z',
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
    expect(model.useful_content_feed_summary.item_count).toBeGreaterThan(0);
    expect(
      model.useful_content_feed_summary.items.map((item) => item.content_reference)
    ).toEqual(TELEGRAM_USEFUL_RESORT_CARD_REFERENCES);
    expect(
      model.weather_caring_content_summary.recommendation_lines.length
    ).toBeGreaterThan(0);
    expect(model.weather_caring_content_summary.reminder_status_line).toBeTruthy();
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
          content_grouping: 'useful_places',
        }
      );
    expect(filteredFeed.item_count).toBeGreaterThan(0);
    expect(
      filteredFeed.items.every(
        (item) => item.content_type_summary.content_grouping === 'useful_places'
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
      'До посадки осталось'
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
