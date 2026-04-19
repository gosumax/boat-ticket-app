import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEGRAM_ANALYTICS_SAFE_EVENT_TYPES,
} from '../../shared/telegram/index.js';
import {
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram analytics foundation service', () => {
  let clock;
  let context;
  let seeded;
  let sourceRegistryItemReference;

  beforeEach(() => {
    clock = createClock('2026-04-14T11:20:00.000Z');
    ({ context } = createTestContext(clock));
    wireClock(context, clock);
    seeded = seedBookingRequest(context, clock, { suffix: '6301' });
    if (context.services.analyticsFoundationService) {
      context.services.analyticsFoundationService.now = clock.now;
    }
    if (context.services.sourceRegistryService) {
      context.services.sourceRegistryService.now = clock.now;
    }

    const sourceRegistryCreate =
      context.services.sourceRegistryService.createSourceRegistryItem({
        source_reference: 'tg_src_analytics_6301',
        source_family: 'seller_source',
        source_type: 'seller_qr',
        source_token: 'seller-qr-analytics-6301',
        seller_id: 1,
      });
    sourceRegistryItemReference =
      sourceRegistryCreate.source_registry_item.source_reference;
  });

  it('captures safe analytics events and projects lists by guest/source', () => {
    for (const eventType of TELEGRAM_ANALYTICS_SAFE_EVENT_TYPES) {
      const captured =
        context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState(
          {
            event_type: eventType,
            booking_request_reference: {
              reference_type: 'telegram_booking_request',
              booking_request_id: seeded.bookingRequestId,
            },
            guest_profile_id: seeded.guest.guest_profile_id,
            source_reference: sourceRegistryItemReference,
            event_payload: {
              event_type: eventType,
              seed: '6301',
            },
            idempotency_key: `tg_analytics_${eventType}_6301`,
          }
        );

      expect(captured.analytics_event.event_type).toBe(eventType);
      expect(captured.analytics_event.analytics_event_reference.reference_type).toBe(
        'telegram_analytics_capture_event'
      );
    }

    const byGuest =
      context.services.analyticsFoundationService.listAnalyticsEventsByGuestReference(
        {
          guest_reference: {
            reference_type: 'telegram_guest_profile',
            guest_profile_id: seeded.guest.guest_profile_id,
          },
        }
      );
    expect(byGuest.item_count).toBe(TELEGRAM_ANALYTICS_SAFE_EVENT_TYPES.length);
    expect(byGuest.items.every((item) => item.guest_reference)).toBe(true);

    const bySource =
      context.services.analyticsFoundationService.listAnalyticsEventsBySourceReference(
        {
          source_reference: sourceRegistryItemReference,
        }
      );
    expect(bySource.item_count).toBe(TELEGRAM_ANALYTICS_SAFE_EVENT_TYPES.length);
    expect(bySource.items.every((item) => item.source_reference)).toBe(true);
  });

  it('returns simple counters summary', () => {
    context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
      event_type: 'booking_request_created',
      booking_request_id: seeded.bookingRequestId,
      guest_profile_id: seeded.guest.guest_profile_id,
      source_reference: sourceRegistryItemReference,
      idempotency_key: 'tg_analytics_counter_6301_a',
    });
    context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
      event_type: 'hold_started',
      booking_request_id: seeded.bookingRequestId,
      guest_profile_id: seeded.guest.guest_profile_id,
      source_reference: sourceRegistryItemReference,
      idempotency_key: 'tg_analytics_counter_6301_b',
    });
    context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
      event_type: 'hold_started',
      booking_request_id: seeded.bookingRequestId,
      guest_profile_id: seeded.guest.guest_profile_id,
      source_reference: sourceRegistryItemReference,
      idempotency_key: 'tg_analytics_counter_6301_c',
    });

    const summary = context.services.analyticsFoundationService.readAnalyticsCountersSummary({
      guest_profile_id: seeded.guest.guest_profile_id,
    });
    expect(summary.response_version).toBe('telegram_analytics_counters_summary.v1');
    expect(summary.counters_summary.total_events).toBe(3);
    expect(summary.counters_summary.by_event_type.booking_request_created).toBe(1);
    expect(summary.counters_summary.by_event_type.hold_started).toBe(2);
    expect(Object.isFrozen(summary)).toBe(true);
  });

  it('supports idempotent capture replay and rejects invalid/non-projectable analytics input', () => {
    const first =
      context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
        event_type: 'source_binding',
        guest_profile_id: seeded.guest.guest_profile_id,
        source_reference: sourceRegistryItemReference,
        idempotency_key: 'tg_analytics_idem_6301',
      });
    const replay =
      context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
        event_type: 'source_binding',
        guest_profile_id: seeded.guest.guest_profile_id,
        source_reference: sourceRegistryItemReference,
        idempotency_key: 'tg_analytics_idem_6301',
      });
    expect(replay.analytics_event.analytics_event_reference.analytics_capture_event_id).toBe(
      first.analytics_event.analytics_event_reference.analytics_capture_event_id
    );

    expect(() =>
      context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
        event_type: 'unknown_event',
      })
    ).toThrow('invalid or non-projectable analytics event type');

    expect(() =>
      context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
        event_type: 'hold_started',
        guest_profile_id: seeded.guest.guest_profile_id,
      })
    ).toThrow('requires booking request reference');
  });
});
