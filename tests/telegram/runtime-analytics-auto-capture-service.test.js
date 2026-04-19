import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  createClock,
  createTestDb,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

describe('telegram runtime analytics auto-capture service', () => {
  let clock;
  let context;
  let seeded;

  beforeEach(() => {
    clock = createClock('2026-04-14T12:30:00.000Z');
    ({ context } = createTestContext(clock));
    wireClock(context, clock);
    seeded = seedBookingRequest(context, clock, { suffix: '9101' });
  });

  it('captures and reads analytics summary for one processed operation reference', () => {
    const operationReference = 'runtime-op-9101-prepayment';
    const captured =
      context.services.runtimeAnalyticsAutoCaptureService
        .captureRuntimeAnalyticsForOperation({
          operation_type: 'prepayment_confirmed',
          operation_reference: operationReference,
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
          operation_payload: {
            from_test: true,
          },
        });

    expect(captured).toMatchObject({
      related_operation_type: 'prepayment_confirmed',
      operation_reference: operationReference,
      capture_status: 'success',
      captured_event_count_summary: {
        attempted_count: 1,
        captured_count: 1,
        failed_count: 0,
      },
    });
    expect(captured.captured_event_references[0]).toMatchObject({
      event_type: 'prepayment_confirmed',
      analytics_event_reference: {
        reference_type: 'telegram_analytics_capture_event',
      },
    });

    const readback =
      context.services.runtimeAnalyticsAutoCaptureService
        .readRuntimeAnalyticsCaptureResultForProcessedOperation({
          operation_type: 'prepayment_confirmed',
          operation_reference: operationReference,
        });
    expect(readback).toEqual(captured);
  });

  it('supports deterministic skipped mode when auto-capture is disabled through service options', () => {
    const db = createTestDb();
    const disabledContext = createTelegramPersistenceContext(db, {
      runtimeAnalyticsAutoCaptureEnabled: false,
    });
    wireClock(disabledContext, clock);
    const disabledSeed = seedBookingRequest(disabledContext, clock, { suffix: '9102' });

    const captured =
      disabledContext.services.runtimeAnalyticsAutoCaptureService
        .captureRuntimeAnalyticsForOperation({
          operation_type: 'hold_started',
          operation_reference: 'runtime-op-9102-hold-started',
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: disabledSeed.bookingRequestId,
          },
        });

    expect(captured).toMatchObject({
      related_operation_type: 'hold_started',
      capture_status: 'skipped',
      auto_capture_enabled: false,
      captured_event_count_summary: {
        attempted_count: 1,
        captured_count: 0,
        failed_count: 0,
      },
    });
  });

  it('keeps capture additive and non-blocking by returning partial when event capture fails', () => {
    const captured =
      context.services.runtimeAnalyticsAutoCaptureService
        .captureRuntimeAnalyticsForOperation({
          operation_type: 'source_binding_persisted',
          operation_reference: 'runtime-op-9103-source-binding',
          operation_payload: {
            intentionally_missing_guest_and_source: true,
          },
        });

    expect(captured).toMatchObject({
      related_operation_type: 'source_binding_persisted',
      capture_status: 'partial',
      captured_event_count_summary: {
        attempted_count: 1,
        captured_count: 0,
        failed_count: 1,
      },
    });
    expect(captured.capture_failure_summary[0]).toMatchObject({
      event_type: 'source_binding',
      reason: 'capture_failed',
    });
  });
});
