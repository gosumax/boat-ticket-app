import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  confirmAndLinkToPresale,
  createClock,
  createTestDb,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

function createContextWithAdapter(clock, options = {}) {
  const db = createTestDb();
  const adapterCalls = [];
  const context = createTelegramPersistenceContext(db, {
    executeTelegramNotificationDelivery: (adapterInput) => {
      adapterCalls.push(adapterInput);
      return {
        outcome: 'sent',
        provider_result_reference: {
          adapter_name: 'telegram-scheduled-message-runner-test-adapter',
          adapter_outcome: 'sent',
        },
      };
    },
    telegramWeatherSnapshotResolver: options.telegramWeatherSnapshotResolver,
  });
  wireClock(context, clock);

  return {
    db,
    context,
    adapterCalls,
  };
}

describe('telegram scheduled message runner service', () => {
  let clock;
  let db;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-14T11:45:00.000Z');
    ({ db, context } = createContextWithAdapter(clock));
  });

  it('runs one booking reminder scope with deterministic not-due and already-resolved skips', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '7201',
      requestedTripDate: '2026-04-14',
      requestedTimeSlot: '12:30',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-14',
    });

    const result =
      context.services.scheduledMessageRunnerService
        .runPlannedRemindersForBookingRequest({
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
        });

    expect(result).toMatchObject({
      run_scope: 'planned_reminders_by_booking_request',
      run_status: 'run_nothing_due',
      related_booking_request_reference: {
        booking_request_id: seeded.bookingRequestId,
      },
      counters_summary: {
        planned_total: 2,
        due_total: 0,
        processed_total: 0,
        skipped_total: 2,
        skipped_not_due: 1,
        skipped_already_resolved: 1,
      },
    });
    expect(
      result.skipped_item_summaries.map((item) => item.skip_reason).sort()
    ).toEqual(['already_resolved', 'not_due']);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('keeps scheduled reminder handoff safe when a due reminder is no longer executable by planning gate', () => {
    const weatherClock = createClock('2026-04-14T11:31:00.000Z');
    const weatherBundle = createContextWithAdapter(weatherClock, {
      telegramWeatherSnapshotResolver: () => ({
        condition_code: 'rain',
        condition_label: 'Rain showers',
        temperature_c: 10,
        wind_speed_mps: 8,
        precipitation_probability: 65,
      }),
    });
    const weatherDb = weatherBundle.db;
    const weatherContext = weatherBundle.context;
    const weatherAdapterCalls = weatherBundle.adapterCalls;

    const seeded = seedBookingRequest(weatherContext, weatherClock, {
      suffix: '7204',
      requestedTripDate: '2026-04-14',
      requestedTimeSlot: '12:00',
    });
    confirmAndLinkToPresale(weatherDb, weatherContext, weatherClock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-14',
    });

    const bookingRequestReference = {
      reference_type: 'telegram_booking_request',
      booking_request_id: seeded.bookingRequestId,
    };
    const result =
      weatherContext.services.scheduledMessageRunnerService
        .runPlannedItems(
          'planned_reminders_by_booking_request',
          bookingRequestReference,
          [
            {
              planned_item_scope: 'pre_trip_reminder',
              booking_request_reference: bookingRequestReference,
              message_type: '30_minutes_before_trip',
              planning_status: 'reminder_planned',
              planned_trigger_time_summary: {
                iso: '2026-04-14T10:30:00.000Z',
              },
              latest_timestamp_summary: {
                iso: '2026-04-14T10:30:00.000Z',
              },
            },
          ]
        );

    expect(result).toMatchObject({
      run_scope: 'planned_reminders_by_booking_request',
      run_status: 'run_blocked',
      counters_summary: {
        planned_total: 1,
        due_total: 1,
        processed_total: 0,
        skipped_total: 1,
        skipped_blocked: 1,
      },
    });
    expect(weatherAdapterCalls.length).toBe(0);
    expect(result.skipped_item_summaries[0].skip_reason).toBe('blocked');
    weatherDb.close();
  });

  it('keeps live reminder handoff weather-aware and deterministic when weather is available or unavailable', () => {
    const weatherClock = createClock('2026-04-14T11:45:00.000Z');
    const rainyBundle = createContextWithAdapter(weatherClock, {
      telegramWeatherSnapshotResolver: () => ({
        condition_code: 'rain',
        condition_label: 'Rain showers',
        temperature_c: 8,
        wind_speed_mps: 9,
        precipitation_probability: 70,
      }),
    });
    const rainyDb = rainyBundle.db;
    const rainyContext = rainyBundle.context;
    const rainyAdapterCalls = rainyBundle.adapterCalls;

    const rainySeed = seedBookingRequest(rainyContext, weatherClock, {
      suffix: '7210',
      requestedTripDate: '2026-04-15',
      requestedTimeSlot: '12:30',
    });
    confirmAndLinkToPresale(rainyDb, rainyContext, weatherClock, {
      bookingRequestId: rainySeed.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-15',
    });

    const rainyBookingRequestReference = {
      reference_type: 'telegram_booking_request',
      booking_request_id: rainySeed.bookingRequestId,
    };
    const rainyResult =
      rainyContext.services.scheduledMessageRunnerService
        .runPlannedItems(
          'planned_reminders_by_booking_request',
          rainyBookingRequestReference,
          [
            {
              planned_item_scope: 'pre_trip_reminder',
              booking_request_reference: rainyBookingRequestReference,
              message_type: '1_hour_before_trip',
              planning_status: 'reminder_planned',
              planned_trigger_time_summary: {
                iso: '2026-04-14T10:00:00.000Z',
              },
              latest_timestamp_summary: {
                iso: '2026-04-14T10:00:00.000Z',
              },
            },
          ]
        );

    expect(rainyResult).toMatchObject({
      run_scope: 'planned_reminders_by_booking_request',
      run_status: 'run_executed',
      counters_summary: {
        due_total: 1,
        processed_total: 1,
        skipped_total: 0,
      },
    });
    expect(
      rainyAdapterCalls[0].resolved_payload_summary_reference.resolved_text_fields.status_line
    ).toContain('Rain is possible');
    expect(
      rainyAdapterCalls[0].resolved_payload_summary_reference.resolved_text_fields.status_line
    ).toContain('waterproof layer');
    rainyDb.close();

    const dryClock = createClock('2026-04-14T11:45:00.000Z');
    const dryBundle = createContextWithAdapter(dryClock);
    const dryDb = dryBundle.db;
    const dryContext = dryBundle.context;
    const dryAdapterCalls = dryBundle.adapterCalls;

    const drySeed = seedBookingRequest(dryContext, dryClock, {
      suffix: '7211',
      requestedTripDate: '2026-04-15',
      requestedTimeSlot: '12:30',
    });
    confirmAndLinkToPresale(dryDb, dryContext, dryClock, {
      bookingRequestId: drySeed.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-15',
    });

    const dryBookingRequestReference = {
      reference_type: 'telegram_booking_request',
      booking_request_id: drySeed.bookingRequestId,
    };
    const dryResult =
      dryContext.services.scheduledMessageRunnerService
        .runPlannedItems(
          'planned_reminders_by_booking_request',
          dryBookingRequestReference,
          [
            {
              planned_item_scope: 'pre_trip_reminder',
              booking_request_reference: dryBookingRequestReference,
              message_type: '30_minutes_before_trip',
              planning_status: 'reminder_planned',
              planned_trigger_time_summary: {
                iso: '2026-04-14T10:00:00.000Z',
              },
              latest_timestamp_summary: {
                iso: '2026-04-14T10:00:00.000Z',
              },
            },
          ]
        );

    expect(dryResult).toMatchObject({
      run_scope: 'planned_reminders_by_booking_request',
      run_status: 'run_executed',
      counters_summary: {
        due_total: 1,
        processed_total: 1,
        skipped_total: 0,
      },
    });
    expect(
      dryAdapterCalls[0].resolved_payload_summary_reference.resolved_text_fields.status_line
    ).toContain('Boarding is soon');
    dryDb.close();
  });

  it('runs one booking post-trip scope for both supported post-trip message types', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '7202',
      requestedTripDate: '2026-04-13',
      requestedTimeSlot: '10:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['USED'],
      businessDay: '2026-04-13',
    });
    clock.advanceMinutes(200);
    wireClock(context, clock);

    const result =
      context.services.scheduledMessageRunnerService
        .runPlannedPostTripMessagesForBookingRequest({
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
        });

    expect(result).toMatchObject({
      run_scope: 'planned_post_trip_messages_by_booking_request',
      run_status: 'run_executed',
      counters_summary: {
        planned_total: 2,
        due_total: 2,
        processed_total: 2,
        skipped_total: 0,
      },
    });
    expect(
      result.processed_item_summaries.map((item) => item.message_type).sort()
    ).toEqual(['post_trip_review_request', 'post_trip_thank_you']);
  });

  it('keeps batch replay safe and idempotent with already_resolved skip classification', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '7203',
      requestedTripDate: '2026-04-13',
      requestedTimeSlot: '10:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['USED'],
      businessDay: '2026-04-13',
    });
    clock.advanceMinutes(200);
    wireClock(context, clock);

    const first =
      context.services.scheduledMessageRunnerService.runAllDuePlannedMessagesBatch({
        scan_limit: 100,
      });
    const second =
      context.services.scheduledMessageRunnerService.runAllDuePlannedMessagesBatch({
        scan_limit: 100,
      });

    expect(first.counters_summary.processed_total).toBeGreaterThanOrEqual(2);
    expect(second).toMatchObject({
      run_scope: 'all_due_planned_messages',
      run_status: 'run_blocked',
      counters_summary: {
        due_total: 2,
        processed_total: 0,
      },
    });
    expect(second.counters_summary.skipped_already_resolved).toBeGreaterThanOrEqual(1);
    expect(
      second.skipped_item_summaries.some((item) => item.skip_reason === 'already_resolved')
    ).toBe(true);
  });
});
