import { beforeEach, describe, expect, it } from 'vitest';
import {
  createClock,
  createTestContext,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

function buildStartUpdate({ updateId, messageId, telegramUserId, unixSeconds, text }) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: unixSeconds,
      text,
      from: {
        id: telegramUserId,
        is_bot: false,
        first_name: 'Runtime',
        last_name: 'Guest',
        username: `runtime_user_${telegramUserId}`,
        language_code: 'ru',
      },
      chat: {
        id: telegramUserId,
        type: 'private',
        first_name: 'Runtime',
        last_name: 'Guest',
        username: `runtime_user_${telegramUserId}`,
      },
    },
  };
}

describe('telegram runtime entrypoint orchestration service', () => {
  let clock;
  let context;

  beforeEach(() => {
    clock = createClock('2026-04-14T12:00:00.000Z');
    ({ context } = createTestContext(clock));
    wireClock(context, clock);
    context.services.notificationDeliveryExecutorService.deliveryAdapter = () => ({
      outcome: 'sent',
      provider_result_reference: {
        adapter_name: 'telegram-runtime-entrypoint-test-adapter',
        adapter_outcome: 'sent',
      },
    });
  });

  it('maps inbound start without source token to processed_with_fallback', () => {
    const result =
      context.services.runtimeEntrypointOrchestrationService.processInboundStartUpdate(
        buildStartUpdate({
          updateId: 8001001,
          messageId: 101,
          telegramUserId: 800101,
          unixSeconds: 1767776400,
          text: '/start',
        })
      );

    expect(result).toMatchObject({
      operation_type: 'inbound_start_update',
      operation_status: 'processed_with_fallback',
      related_message_action_summary: {
        start_orchestration_status: 'start_processed_without_source',
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('processes guest action requests through Telegram boundary action orchestration', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '8002',
    });

    const result =
      context.services.runtimeEntrypointOrchestrationService.processGuestActionRequest({
        action_type: 'open_trips',
        telegram_user_reference: {
          reference_type: 'telegram_user',
          telegram_user_id: seeded.guest.telegram_user_id,
        },
      });

    expect(result).toMatchObject({
      operation_type: 'guest_action_by_telegram_user',
      operation_status: 'processed',
      telegram_user_summary: {
        telegram_user_id: seeded.guest.telegram_user_id,
      },
      related_message_action_summary: {
        action_type: 'open_trips',
        action_status: 'action_available',
      },
    });
  });

  it('executes one template-backed message and reports fallback execution status', () => {
    const seeded = seedBookingRequest(context, clock, {
      suffix: '8003',
    });
    context.services.serviceMessageTemplateManagementService.disableServiceMessageTemplate({
      template_reference: 'tg_service_message_template_booking_created',
    });

    const result =
      context.services.runtimeEntrypointOrchestrationService
        .executeTemplateMessageByBookingRequestReference({
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: seeded.bookingRequestId,
          },
          message_type: 'booking_created',
        });

    expect(result).toMatchObject({
      operation_type: 'template_message_by_booking_request',
      operation_status: 'processed_with_fallback',
      related_booking_request_reference: {
        booking_request_id: seeded.bookingRequestId,
      },
      related_message_action_summary: {
        message_type: 'booking_created',
        execution_status: 'executed_with_default_fallback',
      },
    });
  });

  it('rejects invalid guest/template payloads deterministically', () => {
    const guestAction =
      context.services.runtimeEntrypointOrchestrationService.processGuestActionRequest({
        action_type: 'open_unknown_action',
        telegram_user_reference: {
          reference_type: 'telegram_user',
          telegram_user_id: 'tg-invalid-8004',
        },
      });
    const template =
      context.services.runtimeEntrypointOrchestrationService
        .executeTemplateMessageByBookingRequestReference({
          booking_request_reference: {
            reference_type: 'telegram_booking_request',
            booking_request_id: 1,
          },
          message_type: 'unsupported_template_message',
        });

    expect(guestAction).toMatchObject({
      operation_status: 'rejected_invalid_input',
      rejection_reason: expect.stringContaining('Unsupported action type'),
    });
    expect(template).toMatchObject({
      operation_status: 'rejected_invalid_input',
      rejection_reason: expect.stringContaining('Unsupported message type'),
    });
  });
});
