import { beforeEach, describe, expect, it } from 'vitest';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import {
  TELEGRAM_SERVICE_MESSAGE_TYPES,
} from '../../shared/telegram/index.js';
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
  const {
    telegramWeatherSnapshotResolver,
  } = options;
  const context = createTelegramPersistenceContext(db, {
    executeTelegramNotificationDelivery: (adapterInput) => {
      adapterCalls.push(adapterInput);
      return {
        outcome: 'sent',
        provider_result_reference: {
          adapter_name: 'telegram-template-execution-test-adapter',
          adapter_outcome: 'sent',
        },
      };
    },
    telegramWeatherSnapshotResolver,
  });
  wireClock(context, clock);
  return { db, context, adapterCalls };
}

describe('telegram template execution orchestration service', () => {
  let clock;
  let db;
  let context;
  let adapterCalls;

  beforeEach(() => {
    clock = createClock('2026-04-10T09:00:00.000Z');
    ({ db, context, adapterCalls } = createContextWithAdapter(clock));
  });

  it('executes one notification with managed template content through the existing run path', () => {
    const seeded = seedBookingRequest(context, clock, { suffix: '9301' });
    context.services.serviceMessageTemplateManagementService
      .updateServiceMessageTemplateVersionSafe({
        template_reference: 'tg_service_message_template_booking_created',
        title_name_summary: 'Managed Booking Created',
        text_body_summary: 'Managed body for booking created.',
      });

    const execution =
      context.services.templateExecutionOrchestrationService
        .executeTemplateBackedNotificationByBookingRequestReference({
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
          message_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        });

    expect(execution).toMatchObject({
      booking_request_reference: {
        booking_request_id: seeded.bookingRequestId,
      },
      message_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      execution_status: 'executed_with_managed_template',
      template_reference: 'tg_service_message_template_booking_created',
      delivery_result_summary: {
        run_status: 'sent',
      },
    });
    expect(execution.analytics_capture_summary?.related_operation_type).toBe(
      'notification_execution_outcome'
    );
    expect(adapterCalls[0].resolved_payload_summary_reference.resolved_text_fields).toMatchObject(
      {
        headline: 'Managed Booking Created',
        body: 'Managed body for booking created.',
      }
    );
  });

  it('falls back to default payload and returns deterministic blocked/not-possible outcomes', () => {
    const seeded = seedBookingRequest(context, clock, { suffix: '9302' });
    context.services.serviceMessageTemplateManagementService.disableServiceMessageTemplate({
      template_reference: 'tg_service_message_template_booking_created',
    });

    const fallbackExecution =
      context.services.templateExecutionOrchestrationService
        .executeTemplateBackedNotificationByBookingRequestReference({
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
          message_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        });
    expect(fallbackExecution).toMatchObject({
      execution_status: 'executed_with_default_fallback',
      template_reference: null,
      delivery_result_summary: {
        run_status: 'sent',
      },
    });

    const blockedSeed = seedBookingRequest(context, clock, { suffix: '9302b' });
    context.repositories.guestProfiles.updateById(blockedSeed.guest.guest_profile_id, {
      consent_status: 'revoked',
    });
    const blockedExecution =
      context.services.templateExecutionOrchestrationService
        .executeTemplateBackedNotificationByBookingRequestReference({
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: blockedSeed.bookingRequestId,
          },
          message_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        });
    expect(blockedExecution).toMatchObject({
      execution_status: 'execution_blocked',
      delivery_result_summary: {
        run_status: 'skipped',
        skip_reason: 'blocked',
      },
    });

    const notPossibleExecution =
      context.services.templateExecutionOrchestrationService
        .executeTemplateBackedNotificationByBookingRequestReference({
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
          message_type: 'unsupported_type',
        });
    expect(notPossibleExecution).toMatchObject({
      execution_status: 'execution_not_possible',
      message_type: null,
    });
  });

  it('executes planned reminder notifications for one booking request', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '9303',
      requestedTripDate: '2026-04-12',
      requestedTimeSlot: '12:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-12',
    });

    const batch =
      context.services.templateExecutionOrchestrationService
        .executePlannedRemindersByBookingRequestReference({
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
        });

    expect(batch).toMatchObject({
      execution_scope: 'planned_reminders',
      booking_request_reference: {
        booking_request_id: seeded.bookingRequestId,
      },
      item_count: 2,
      counters_summary: {
        total_count: 2,
      },
    });
    expect(batch.results.map((item) => item.message_type).sort()).toEqual([
      '1_hour_before_trip',
      '30_minutes_before_trip',
    ]);
  });

  it('enriches reminder payload with weather-aware status line and keeps deterministic fallback when weather is unavailable', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '9305',
      requestedTripDate: '2026-04-12',
      requestedTimeSlot: '13:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-12',
    });

    const fallbackExecution =
      context.services.templateExecutionOrchestrationService
        .executeTemplateBackedNotificationByBookingRequestReference({
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
          message_type: '30_minutes_before_trip',
        });
    expect(fallbackExecution.execution_status).toBe('executed_with_managed_template');
    expect(
      adapterCalls[0].resolved_payload_summary_reference.resolved_text_fields.status_line
    ).toContain('Boarding is soon');

    const weatherClock = createClock('2026-04-10T09:00:00.000Z');
    const weatherContextBundle = createContextWithAdapter(weatherClock, {
      telegramWeatherSnapshotResolver: () => ({
        condition_code: 'rain',
        condition_label: 'Rain showers',
        temperature_c: 8,
        wind_speed_mps: 9,
        precipitation_probability: 70,
      }),
    });
    const weatherContext = weatherContextBundle.context;
    const weatherDb = weatherContextBundle.db;
    const weatherAdapterCalls = weatherContextBundle.adapterCalls;

    const weatherSeeded = seedBookingRequest(weatherContext, weatherClock, {
      suffix: '9306',
      requestedTripDate: '2026-04-12',
      requestedTimeSlot: '12:00',
    });
    confirmAndLinkToPresale(weatherDb, weatherContext, weatherClock, {
      bookingRequestId: weatherSeeded.bookingRequestId,
      ticketStatuses: ['ACTIVE'],
      businessDay: '2026-04-12',
    });

    const weatherExecution =
      weatherContext.services.templateExecutionOrchestrationService
        .executeTemplateBackedNotificationByBookingRequestReference({
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: weatherSeeded.bookingRequestId,
          },
          message_type: '1_hour_before_trip',
        });
    expect(weatherExecution.execution_status).toBe('executed_with_managed_template');
    expect(
      weatherAdapterCalls[0].resolved_payload_summary_reference.resolved_text_fields.status_line
    ).toContain('Rain is possible');
    expect(
      weatherAdapterCalls[0].resolved_payload_summary_reference.resolved_text_fields
        .status_line
    ).toContain('waterproof layer');
    weatherDb.close();
  });

  it('executes planned post-trip notifications for one completed booking request', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '9304',
      requestedTripDate: '2026-04-09',
      requestedTimeSlot: '10:00',
    });
    confirmAndLinkToPresale(db, context, clock, {
      bookingRequestId: seeded.bookingRequestId,
      ticketStatuses: ['USED'],
      businessDay: '2026-04-09',
    });

    const batch =
      context.services.templateExecutionOrchestrationService
        .executePlannedPostTripMessagesByBookingRequestReference({
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
        });

    expect(batch).toMatchObject({
      execution_scope: 'planned_post_trip_messages',
      booking_request_reference: {
        booking_request_id: seeded.bookingRequestId,
      },
      item_count: 2,
      counters_summary: {
        total_count: 2,
      },
    });
    expect(batch.results.map((item) => item.message_type).sort()).toEqual([
      'post_trip_review_request',
      'post_trip_thank_you',
    ]);
  });
});
