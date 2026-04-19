import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTelegramBotCallbackAdapter } from '../../server/telegram/adapters/telegram-bot-callback-adapter.mjs';
import {
  buildTelegramCallbackUpdate,
  buildTelegramMessageUpdate,
  createClock,
  createTelegramWebhookTestContext,
  seedBookingRequest,
} from './_webhook-runtime-test-helpers.js';

describe('telegram bot callback adapter', () => {
  let clock;
  let db;
  let telegramContext;
  let adapter;

  beforeEach(() => {
    clock = createClock('2026-04-14T15:00:00.000Z');
    ({ db, telegramContext } = createTelegramWebhookTestContext(clock));
    adapter = createTelegramBotCallbackAdapter({
      guestCommandActionOrchestrationService:
        telegramContext.services.guestCommandActionOrchestrationService,
      templateExecutionOrchestrationService:
        telegramContext.services.templateExecutionOrchestrationService,
      webhookOutboundResponseOrchestrationService:
        telegramContext.services.webhookOutboundResponseOrchestrationService,
      now: clock.now,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('maps approved guest action callbacks by telegram user and by booking reference', () => {
    telegramContext.services.runtimeEntrypointOrchestrationService.processInboundStartUpdate(
      buildTelegramMessageUpdate({
        updateId: 8501001,
        messageId: 201,
        telegramUserId: 850101,
        unixSeconds: 1767777000,
        text: '/start',
      })
    );

    const byUser = adapter.handleCallbackUpdate(
      buildTelegramCallbackUpdate({
        updateId: 8501002,
        callbackQueryId: 'cbq-8501-a',
        messageId: 202,
        telegramUserId: 850101,
        unixSeconds: 1767777060,
        data: 'open_faq',
      })
    );
    expect(byUser).toMatchObject({
      mapping_status: 'mapped_guest_action_callback',
      mapped_action_type: 'open_faq',
      operation_type: 'guest_action_by_telegram_user',
      operation_status: 'processed',
      outbound_response_summary: {
        outbound_mapping_status: 'mapped_guest_action_response',
        delivery_handoff_summary: {
          handoff_status: 'sent',
        },
      },
      operation_result_summary: {
        action_status: 'action_completed',
      },
    });

    const seeded = seedBookingRequest(telegramContext, clock, {
      suffix: '8501',
    });
    const byBooking = adapter.handleCallbackUpdate(
      buildTelegramCallbackUpdate({
        updateId: 8501003,
        callbackQueryId: 'cbq-8501-b',
        messageId: 203,
        telegramUserId: 850101,
        unixSeconds: 1767777120,
        data: `open_trips:${seeded.bookingRequestId}`,
      })
    );
    expect(byBooking).toMatchObject({
      mapping_status: 'mapped_guest_action_callback',
      mapped_action_type: 'open_trips',
      operation_type: 'guest_action_by_booking_request',
      operation_status: 'processed',
      outbound_response_summary: {
        outbound_mapping_status: 'mapped_guest_action_response',
        button_payloads: expect.arrayContaining([
          expect.objectContaining({
            callback_data: `action:open_trips:${seeded.bookingRequestId}`,
          }),
        ]),
      },
      related_booking_request_reference: {
        booking_request_id: seeded.bookingRequestId,
      },
      operation_result_summary: {
        action_status: 'action_available',
      },
    });
  });

  it('maps template callback execution and returns fallback status when managed template is disabled', () => {
    const seeded = seedBookingRequest(telegramContext, clock, {
      suffix: '8502',
    });
    telegramContext.services.serviceMessageTemplateManagementService.disableServiceMessageTemplate(
      {
        template_reference: 'tg_service_message_template_booking_created',
      }
    );

    const result = adapter.handleCallbackUpdate(
      buildTelegramCallbackUpdate({
        updateId: 8502001,
        callbackQueryId: 'cbq-8502-a',
        messageId: 204,
        telegramUserId: 850201,
        unixSeconds: 1767777180,
        data: `template:booking_created:${seeded.bookingRequestId}`,
      })
    );

    expect(result).toMatchObject({
      mapping_status: 'mapped_template_callback',
      mapped_message_type: 'booking_created',
      operation_type: 'template_message_by_booking_request',
      operation_status: 'processed_with_fallback',
      related_booking_request_reference: {
        booking_request_id: seeded.bookingRequestId,
      },
      operation_result_summary: {
        execution_status: 'executed_with_default_fallback',
      },
    });
  });

  it('returns deterministic blocked and invalid callback outcomes', () => {
    telegramContext.services.runtimeEntrypointOrchestrationService.processInboundStartUpdate(
      buildTelegramMessageUpdate({
        updateId: 8503001,
        messageId: 205,
        telegramUserId: 850301,
        unixSeconds: 1767777240,
        text: '/start',
      })
    );

    const blocked = adapter.handleCallbackUpdate(
      buildTelegramCallbackUpdate({
        updateId: 8503002,
        callbackQueryId: 'cbq-8503-a',
        messageId: 206,
        telegramUserId: 850301,
        unixSeconds: 1767777300,
        data: 'cancel_before_prepayment',
      })
    );
    expect(blocked).toMatchObject({
      mapping_status: 'mapped_guest_action_callback',
      operation_status: 'blocked_not_possible',
      outbound_response_summary: {
        outbound_mapping_status: 'mapped_guest_action_response_with_fallback',
        response_text_fields: {
          headline: 'Action is not available',
        },
      },
      operation_result_summary: {
        action_status: 'action_not_available',
      },
    });

    const unsupported = adapter.handleCallbackUpdate(
      buildTelegramCallbackUpdate({
        updateId: 8503003,
        callbackQueryId: 'cbq-8503-b',
        messageId: 207,
        telegramUserId: 850301,
        unixSeconds: 1767777360,
        data: 'unsupported_callback_data',
      })
    );
    expect(unsupported).toMatchObject({
      mapping_status: 'unsupported_callback_data',
      operation_status: 'rejected_invalid_input',
    });
  });
});
