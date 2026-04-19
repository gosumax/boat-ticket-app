import { beforeEach, describe, expect, it } from 'vitest';
import {
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram source analytics reporting service', () => {
  let clock;
  let context;
  let seeded;
  let sellerSourceReference;
  let genericSourceReference;

  beforeEach(() => {
    clock = createClock('2026-04-14T13:30:00.000Z');
    ({ context } = createTestContext(clock));
    wireClock(context, clock);
    seeded = seedBookingRequest(context, clock, { suffix: '6401' });

    sellerSourceReference =
      context.services.sourceRegistryService.createSourceRegistryItem({
        source_reference: 'tg_src_report_seller_6401',
        source_family: 'seller_source',
        source_type: 'seller_qr',
        source_token: 'seller-qr-report-6401',
        seller_id: 1,
      }).source_registry_item.source_reference;
    genericSourceReference =
      context.services.sourceRegistryService.createSourceRegistryItem({
        source_reference: 'tg_src_report_generic_6401',
        source_family: 'generic_source',
        source_type: 'generic_qr',
        source_token: 'generic-report-6401',
      }).source_registry_item.source_reference;
  });

  function capture(eventType, idempotencyKey, sourceReference, payload = {}) {
    return context.services.analyticsFoundationService.captureAnalyticsEventFromTelegramState({
      event_type: eventType,
      booking_request_id: seeded.bookingRequestId,
      guest_profile_id: seeded.guest.guest_profile_id,
      source_reference: sourceReference,
      event_payload: payload,
      idempotency_key: idempotencyKey,
    });
  }

  it('lists source performance summaries with counters and conversion summaries', () => {
    capture('guest_entry', 'tg_report_entry_6401', sellerSourceReference);
    capture('source_binding', 'tg_report_binding_6401', sellerSourceReference);
    capture('attribution_start', 'tg_report_attr_6401', sellerSourceReference);
    capture(
      'booking_request_created',
      'tg_report_request_6401',
      sellerSourceReference
    );
    capture(
      'prepayment_confirmed',
      'tg_report_prepay_6401',
      sellerSourceReference
    );
    capture('bridge_outcome', 'tg_report_bridge_6401', sellerSourceReference, {
      bridge_outcome: 'success',
      linked_to_presale: true,
      completed_trip: true,
    });
    capture(
      'review_submitted',
      'tg_report_review_6401',
      sellerSourceReference,
      {
        rating_value: 5,
      }
    );
    capture('guest_entry', 'tg_report_entry_generic_6401', genericSourceReference);

    const list =
      context.services.sourceAnalyticsReportingService.listSourcePerformanceSummaries();

    expect(list.response_version).toBe('telegram_source_analytics_report_list.v1');
    expect(list.item_count).toBe(2);
    const sellerItem = list.items.find(
      (item) =>
        item.source_reference.source_reference === 'tg_src_report_seller_6401'
    );
    expect(sellerItem.counters_summary).toMatchObject({
      entries: 1,
      source_bindings: 1,
      attribution_starts: 1,
      booking_requests: 1,
      prepayment_confirmations: 1,
      bridged_presales: 1,
      completed_trips: 1,
      review_submissions: 1,
    });
    expect(
      sellerItem.conversion_summary.booking_requests_from_entries.ratio
    ).toBe(1);
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(sellerItem)).toBe(true);
  });

  it('reads one source report and overall funnel summary', () => {
    capture('guest_entry', 'tg_report_entry_6401_b', sellerSourceReference);
    capture(
      'booking_request_created',
      'tg_report_request_6401_b',
      sellerSourceReference
    );
    capture(
      'prepayment_confirmed',
      'tg_report_prepay_6401_b',
      sellerSourceReference
    );

    const sourceReport =
      context.services.sourceAnalyticsReportingService
        .readSourcePerformanceReportBySourceReference({
          source_reference: 'tg_src_report_seller_6401',
        });
    expect(sourceReport.response_version).toBe(
      'telegram_source_analytics_report_item.v1'
    );
    expect(
      sourceReport.source_performance_report.source_reference.source_reference
    ).toBe('tg_src_report_seller_6401');
    expect(
      sourceReport.source_performance_report.counters_summary.prepayment_confirmations
    ).toBe(1);

    const overall =
      context.services.sourceAnalyticsReportingService
        .readOverallTelegramFunnelCountersSummary();
    expect(overall.response_version).toBe(
      'telegram_source_analytics_funnel_summary.v1'
    );
    expect(overall.counters_summary.entries).toBe(1);
    expect(overall.counters_summary.booking_requests).toBe(1);
    expect(overall.source_coverage_summary.registered_sources).toBe(2);
  });

  it('rejects invalid or non-projectable source inputs deterministically', () => {
    expect(() =>
      context.services.sourceAnalyticsReportingService
        .readSourcePerformanceReportBySourceReference({
          source_reference: 'tg_src_missing_6401',
        })
    ).toThrow('invalid or non-projectable source input');

    expect(() =>
      context.services.sourceAnalyticsReportingService
        .listSourcePerformanceSummaries('bad-input')
    ).toThrow('source analytics list input must be an object');
  });
});
