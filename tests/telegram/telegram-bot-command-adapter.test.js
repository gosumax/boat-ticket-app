import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTelegramBotCommandAdapter } from '../../server/telegram/adapters/telegram-bot-command-adapter.mjs';
import {
  buildTelegramMessageUpdate,
  createClock,
  createTelegramWebhookTestContext,
  seedBookingRequest,
} from './_webhook-runtime-test-helpers.js';

describe('telegram bot command adapter', () => {
  let clock;
  let db;
  let telegramContext;
  let adapter;

  beforeEach(() => {
    clock = createClock('2026-04-14T14:00:00.000Z');
    ({ db, telegramContext } = createTelegramWebhookTestContext(clock));
    adapter = createTelegramBotCommandAdapter({
      runtimeEntrypointOrchestrationService:
        telegramContext.services.runtimeEntrypointOrchestrationService,
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

  it('maps /start command to runtime entrypoint orchestration with fallback status', () => {
    const result = adapter.handleCommandUpdate(
      buildTelegramMessageUpdate({
        updateId: 8401001,
        messageId: 101,
        telegramUserId: 840101,
        unixSeconds: 1767776400,
        text: '/start',
      })
    );

    expect(result).toMatchObject({
      mapping_status: 'mapped_start_command',
      operation_type: 'inbound_start_update',
      operation_status: 'processed_with_fallback',
      outbound_response_summary: {
        outbound_mapping_status: 'mapped_start_response',
        delivery_handoff_summary: {
          handoff_status: 'sent',
          adapter_outcome: 'sent',
        },
      },
      operation_result_summary: {
        operation_status: 'processed_with_fallback',
        related_message_action_summary: {
          start_orchestration_status: 'start_processed_without_source',
        },
      },
    });
  });

  it('maps approved guest commands by telegram user and booking reference', () => {
    const startUpdate = buildTelegramMessageUpdate({
      updateId: 8402001,
      messageId: 102,
      telegramUserId: 840202,
      unixSeconds: 1767776460,
      text: '/start',
    });
    adapter.handleCommandUpdate(startUpdate);

    const byUser = adapter.handleCommandUpdate(
      buildTelegramMessageUpdate({
        updateId: 8402002,
        messageId: 103,
        telegramUserId: 840202,
        unixSeconds: 1767776520,
        text: '/open_trips',
      })
    );
    expect(byUser).toMatchObject({
      mapping_status: 'mapped_guest_action_command',
      mapped_action_type: 'open_trips',
      operation_type: 'guest_action_by_telegram_user',
      operation_status: 'processed',
      outbound_response_summary: {
        outbound_mapping_status: 'mapped_guest_action_response',
        delivery_handoff_summary: {
          handoff_status: 'sent',
        },
      },
      operation_result_summary: {
        action_status: 'action_available',
      },
    });

    const seeded = seedBookingRequest(telegramContext, clock, {
      suffix: '8402',
    });
    const byBooking = adapter.handleCommandUpdate(
      buildTelegramMessageUpdate({
        updateId: 8402003,
        messageId: 104,
        telegramUserId: 840203,
        unixSeconds: 1767776580,
        text: `/open_trips ${seeded.bookingRequestId}`,
      })
    );
    expect(byBooking).toMatchObject({
      mapping_status: 'mapped_guest_action_command',
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

  it('maps template command through template execution and reports fallback status', () => {
    const seeded = seedBookingRequest(telegramContext, clock, {
      suffix: '8403',
    });
    telegramContext.services.serviceMessageTemplateManagementService.disableServiceMessageTemplate(
      {
        template_reference: 'tg_service_message_template_booking_created',
      }
    );

    const result = adapter.handleCommandUpdate(
      buildTelegramMessageUpdate({
        updateId: 8403001,
        messageId: 105,
        telegramUserId: 840301,
        unixSeconds: 1767776640,
        text: `/template_message booking_created ${seeded.bookingRequestId}`,
      })
    );

    expect(result).toMatchObject({
      mapping_status: 'mapped_template_command',
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

  it('returns deterministic blocked and invalid command outcomes', () => {
    adapter.handleCommandUpdate(
      buildTelegramMessageUpdate({
        updateId: 8404001,
        messageId: 106,
        telegramUserId: 840401,
        unixSeconds: 1767776700,
        text: '/start',
      })
    );

    const blocked = adapter.handleCommandUpdate(
      buildTelegramMessageUpdate({
        updateId: 8404002,
        messageId: 107,
        telegramUserId: 840401,
        unixSeconds: 1767776760,
        text: '/cancel_before_prepayment',
      })
    );
    expect(blocked).toMatchObject({
      mapping_status: 'mapped_guest_action_command',
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

    const unsupported = adapter.handleCommandUpdate(
      buildTelegramMessageUpdate({
        updateId: 8404003,
        messageId: 108,
        telegramUserId: 840401,
        unixSeconds: 1767776820,
        text: '/unknown_command',
      })
    );
    expect(unsupported).toMatchObject({
      mapping_status: 'unsupported_command',
      operation_status: 'rejected_invalid_input',
    });

    const invalidPayload = adapter.handleCommandUpdate(
      buildTelegramMessageUpdate({
        updateId: 8404004,
        messageId: 109,
        telegramUserId: 840401,
        unixSeconds: 1767776880,
        text: '/open_ticket bad-id',
      })
    );
    expect(invalidPayload).toMatchObject({
      mapping_status: 'rejected_invalid_input',
      operation_status: 'rejected_invalid_input',
      rejection_reason: expect.stringContaining('booking request id'),
    });
  });
});
