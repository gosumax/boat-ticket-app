import { describe, expect, it } from 'vitest';
import { TelegramWebhookOutboundResponseOrchestrationService } from '../../server/telegram/index.js';
import { TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES } from '../../shared/telegram/index.js';

function buildMessageUpdate({
  updateId = 1001,
  messageId = 101,
  telegramUserId = 900001,
  text = '/start',
} = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      text,
      from: {
        id: telegramUserId,
        first_name: 'Webhook',
        last_name: 'Guest',
        username: `webhook_guest_${telegramUserId}`,
        language_code: 'ru',
      },
      chat: {
        id: telegramUserId,
        type: 'private',
      },
    },
  };
}

function buildCallbackUpdate({
  updateId = 1002,
  callbackQueryId = 'cbq-1',
  messageId = 102,
  telegramUserId = 900001,
  data = 'open_trips',
} = {}) {
  return {
    update_id: updateId,
    callback_query: {
      id: callbackQueryId,
      data,
      from: {
        id: telegramUserId,
        first_name: 'Webhook',
        last_name: 'Guest',
        username: `webhook_guest_${telegramUserId}`,
        language_code: 'ru',
      },
      message: {
        message_id: messageId,
        chat: {
          id: telegramUserId,
          type: 'private',
        },
      },
    },
  };
}

describe('telegram webhook outbound response orchestration service', () => {
  it('maps /start runtime result into deterministic text, buttons, and sent handoff', () => {
    const adapterCalls = [];
    const service = new TelegramWebhookOutboundResponseOrchestrationService({
      executeTelegramNotificationDelivery: (adapterInput) => {
        adapterCalls.push(adapterInput);
        return {
          outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
          provider_result_reference: {
            adapter_name: 'webhook-outbound-test-adapter',
            adapter_outcome: 'sent',
          },
        };
      },
      now: () => new Date('2026-04-14T12:00:00.000Z'),
    });

    const result = service.orchestrateOutboundResponse({
      adapter_type: 'command',
      raw_update: buildMessageUpdate({ text: '/start' }),
      adapter_result_summary: {
        mapping_status: 'mapped_start_command',
        operation_type: 'inbound_start_update',
        operation_status: 'processed_with_fallback',
        operation_result_summary: {
          operation_result_summary: {
            bot_start_state_summary: {
              start_mode: 'new_guest',
              recommended_next_actions: [
                'view_trips',
                'create_booking_request',
                'contact',
                'faq',
                'useful_content',
              ],
            },
            guest_action_state_summary: {
              can_view_trips: true,
              can_open_useful_content: true,
              can_open_faq: true,
              can_contact: true,
            },
          },
        },
      },
    });

    expect(result).toMatchObject({
      outbound_mapping_status: 'mapped_start_response',
      mapped_operation_status: 'processed_with_fallback',
      response_text_fields: {
        headline: expect.any(String),
        content_source: 'start_mode_content',
      },
      delivery_handoff_summary: {
        handoff_status: 'sent',
        adapter_outcome: 'sent',
      },
    });
    expect(result.button_payloads).toEqual([
      expect.objectContaining({
        action_type: 'open_mini_app',
        callback_data: 'action:open_trips',
        web_app_url: null,
      }),
    ]);
    expect(adapterCalls).toHaveLength(1);
    expect(adapterCalls[0].telegram_reply_markup.inline_keyboard).toEqual([
      [
        { callback_data: 'action:open_trips', text: 'Открыть приложение' },
      ],
    ]);
  });

  it('keeps buyer navigation clean when mini app launch summary is ready', () => {
    const adapterCalls = [];
    const service = new TelegramWebhookOutboundResponseOrchestrationService({
      executeTelegramNotificationDelivery: (adapterInput) => {
        adapterCalls.push(adapterInput);
        return {
          outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
        };
      },
      now: () => new Date('2026-04-14T12:02:00.000Z'),
    });

    const result = service.orchestrateOutboundResponse({
      adapter_type: 'command',
      raw_update: buildMessageUpdate({ text: '/start', telegramUserId: 900123 }),
      adapter_result_summary: {
        mapping_status: 'mapped_start_command',
        operation_type: 'inbound_start_update',
        operation_status: 'processed',
        operation_result_summary: {
          operation_result_summary: {
            bot_start_state_summary: {
              start_mode: 'new_guest',
              recommended_next_actions: ['view_trips'],
            },
            guest_action_state_summary: {
              can_view_trips: true,
            },
          },
        },
      },
      mini_app_launch_summary: {
        launch_ready: true,
        launch_url: 'https://example.test/telegram/mini-app?mini_app_v=ios-cache-v3',
      },
    });

    expect(result.button_payloads.some((item) => item.action_type === 'open_mini_app')).toBe(
      true
    );
    expect(
      adapterCalls[0].telegram_reply_markup.inline_keyboard
        .flat()
        .some((button) => Boolean(button.web_app))
    ).toBe(true);
  });

  it('generates booking-bound callback payloads for guest action responses', () => {
    const service = new TelegramWebhookOutboundResponseOrchestrationService({
      executeTelegramNotificationDelivery: () => ({
        outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      }),
      now: () => new Date('2026-04-14T12:05:00.000Z'),
    });

    const result = service.orchestrateOutboundResponse({
      adapter_type: 'callback',
      raw_update: buildCallbackUpdate({ data: 'open_ticket:77' }),
      adapter_result_summary: {
        mapping_status: 'mapped_guest_action_callback',
        mapped_action_type: 'open_ticket',
        operation_type: 'guest_action_by_booking_request',
        operation_status: 'processed',
        related_booking_request_reference: {
          reference_type: 'telegram_booking_request',
          booking_request_id: 77,
        },
        operation_result_summary: {
          action_type: 'open_ticket',
          action_status: 'action_completed',
          resolved_data_summary: {
            ticket_status_summary: {
              deterministic_ticket_state: 'linked_ticket_ready',
            },
            date_time_summary: {
              requested_trip_date: '2026-04-20',
              requested_time_slot: '11:30',
            },
          },
          visibility_availability_summary: {
            can_view_trips: true,
            can_view_ticket: true,
            can_open_useful_content: true,
            can_open_faq: true,
            can_contact: true,
            can_cancel_before_prepayment: true,
          },
        },
      },
    });

    expect(result.outbound_mapping_status).toBe('mapped_guest_action_response');
    expect(
      result.button_payloads.every((item) =>
        item.callback_data.endsWith(':77')
      )
    ).toBe(true);
    expect(result.button_payloads[0]).toMatchObject({
      action_type: 'open_mini_app',
      callback_data: 'action:open_trips:77',
    });
  });

  it('renders buyer-facing ticket and active-request blocks for open_ticket action', () => {
    const service = new TelegramWebhookOutboundResponseOrchestrationService({
      executeTelegramNotificationDelivery: () => ({
        outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      }),
      now: () => new Date('2026-04-14T12:06:00.000Z'),
    });

    const result = service.orchestrateOutboundResponse({
      adapter_type: 'callback',
      raw_update: buildCallbackUpdate({ data: 'open_ticket:77' }),
      adapter_result_summary: {
        mapping_status: 'mapped_guest_action_callback',
        mapped_action_type: 'open_ticket',
        operation_type: 'guest_action_by_booking_request',
        operation_status: 'processed',
        related_booking_request_reference: {
          reference_type: 'telegram_booking_request',
          booking_request_id: 77,
        },
        operation_result_summary: {
          action_type: 'open_ticket',
          action_status: 'action_completed',
          resolved_data_summary: {
            booking_request_reference: {
              reference_type: 'telegram_booking_request',
              booking_request_id: 77,
            },
            ticket_status_summary: {
              deterministic_ticket_state: 'linked_ticket_ready',
            },
            ticket_availability_state: 'available',
            date_time_summary: {
              requested_trip_date: '2026-04-20',
              requested_time_slot: '11:30',
            },
            buyer_ticket_reference_summary: {
              buyer_ticket_code: 'M-12345',
            },
            booking_requests_summary: {
              item_count: 1,
              items: [
                {
                  booking_request_reference: {
                    reference_type: 'telegram_booking_request',
                    booking_request_id: 88,
                  },
                  requested_trip_slot_reference: {
                    requested_trip_date: '2026-04-21',
                    requested_time_slot: '13:45',
                  },
                  booking_request_status: 'WAITING_PREPAYMENT',
                  lifecycle_state: 'hold_active',
                  request_active: true,
                },
              ],
            },
          },
          visibility_availability_summary: {
            can_view_trips: true,
            can_view_ticket: true,
            can_open_useful_content: true,
            can_open_faq: true,
            can_contact: true,
            can_cancel_before_prepayment: true,
          },
        },
      },
    });

    expect(result.response_text_fields).toMatchObject({
      headline: 'Мой билет / заявки',
      status_line: 'Нажмите «Открыть приложение».',
      content_source: 'resolved_action_content',
    });
    expect(result.response_text_fields.body).toContain('Билет');
    expect(result.response_text_fields.body).toContain('Номер билета: № M-12345');
    expect(result.response_text_fields.body).toContain('Заявка');
    expect(result.response_text_fields.body).toContain('Статус: Ожидаем предоплату');
  });

  it('routes useful content action back to mini app entrypoint message', () => {
    const service = new TelegramWebhookOutboundResponseOrchestrationService({
      executeTelegramNotificationDelivery: () => ({
        outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      }),
      now: () => new Date('2026-04-14T12:07:00.000Z'),
    });

    const result = service.orchestrateOutboundResponse({
      adapter_type: 'callback',
      raw_update: buildCallbackUpdate({ data: 'open_useful_content' }),
      adapter_result_summary: {
        mapping_status: 'mapped_guest_action_callback',
        mapped_action_type: 'open_useful_content',
        operation_type: 'guest_action_by_telegram_user',
        operation_status: 'processed',
        operation_result_summary: {
          action_type: 'open_useful_content',
          action_status: 'action_completed',
          resolved_data_summary: {
            weather_summary: {
              condition_label: 'Ясно',
              temperature_c: 27,
              water_temperature_c: 22.4,
              sunset_time_local: '19:43',
            },
          },
          visibility_availability_summary: {
            can_view_trips: true,
            can_view_ticket: false,
            can_contact: true,
            can_open_useful_content: true,
            can_open_faq: true,
          },
        },
      },
    });

    expect(result.response_text_fields).toMatchObject({
      headline: 'Откройте приложение',
      body:
        'Полезные материалы, ответы на вопросы и контактная информация доступны в приложении.',
      status_line: 'Нажмите «Открыть приложение».',
      content_source: 'resolved_action_content',
    });
  });

  it('uses fallback content for invalid action payloads and keeps default action buttons', () => {
    const service = new TelegramWebhookOutboundResponseOrchestrationService({
      executeTelegramNotificationDelivery: () => ({
        outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      }),
      now: () => new Date('2026-04-14T12:10:00.000Z'),
    });

    const result = service.orchestrateOutboundResponse({
      adapter_type: 'command',
      raw_update: buildMessageUpdate({ text: '/open_my_tickets' }),
      adapter_result_summary: {
        mapping_status: 'mapped_guest_action_command',
        mapped_action_type: 'open_my_tickets',
        operation_type: 'guest_action_by_telegram_user',
        operation_status: 'rejected_invalid_input',
        operation_result_summary: {
          action_type: 'open_my_tickets',
          action_status: 'action_rejected_invalid_input',
          rejection_reason:
            '[TELEGRAM_BOOKING_REQUEST_LIFECYCLE_PROJECTION] Telegram guest identity is required',
        },
      },
    });

    expect(result).toMatchObject({
      outbound_mapping_status: 'mapped_guest_action_response_with_fallback',
      response_text_fields: {
        content_source: 'default_fallback_content',
        headline: 'Не удалось обработать запрос',
      },
      delivery_handoff_summary: {
        handoff_status: 'sent',
      },
    });
    expect(result.button_payloads.map((item) => item.action_type)).toEqual([
      'open_mini_app',
    ]);
    expect(result.button_payloads[0].callback_data).toBe('action:open_trips');
  });

  it('routes FAQ action back to mini app entrypoint message', () => {
    const service = new TelegramWebhookOutboundResponseOrchestrationService({
      executeTelegramNotificationDelivery: () => ({
        outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      }),
      now: () => new Date('2026-04-14T12:12:00.000Z'),
    });

    const result = service.orchestrateOutboundResponse({
      adapter_type: 'command',
      raw_update: buildMessageUpdate({ text: '/open_faq' }),
      adapter_result_summary: {
        mapping_status: 'mapped_guest_action_command',
        mapped_action_type: 'open_faq',
        operation_type: 'guest_action_by_telegram_user',
        operation_status: 'processed',
        operation_result_summary: {
          action_type: 'open_faq',
          action_status: 'action_completed',
          resolved_data_summary: {
            item_count: 2,
            items: [
              {
                faq_reference: 'tg_faq_general_001',
                title_short_text_summary: {
                  title: 'Когда приходить на посадку?',
                  short_text: 'Приходите за 15–20 минут до отправления.',
                },
              },
              {
                faq_reference: 'tg_faq_trip_rules_001',
                title_short_text_summary: {
                  title: 'Что делать, если опаздываю?',
                  short_text: 'Сразу позвоните диспетчеру и уточните маршрут.',
                },
              },
            ],
          },
          visibility_availability_summary: {
            can_view_trips: true,
            can_view_ticket: false,
            can_contact: true,
            can_open_useful_content: true,
            can_open_faq: true,
          },
        },
      },
    });

    expect(result.response_text_fields).toMatchObject({
      headline: 'Откройте приложение',
      body:
        'Полезные материалы, ответы на вопросы и контактная информация доступны в приложении.',
      status_line: 'Нажмите «Открыть приложение».',
      content_source: 'resolved_action_content',
    });
  });

  it('routes contact action back to mini app entrypoint message', () => {
    const service = new TelegramWebhookOutboundResponseOrchestrationService({
      executeTelegramNotificationDelivery: () => ({
        outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      }),
      now: () => new Date('2026-04-14T12:13:00.000Z'),
    });

    const result = service.orchestrateOutboundResponse({
      adapter_type: 'callback',
      raw_update: buildCallbackUpdate({ data: 'open_contact' }),
      adapter_result_summary: {
        mapping_status: 'mapped_guest_action_callback',
        mapped_action_type: 'open_contact',
        operation_type: 'guest_action_by_telegram_user',
        operation_status: 'processed',
        operation_result_summary: {
          action_type: 'open_contact',
          action_status: 'action_available',
          resolved_data_summary: {},
          visibility_availability_summary: {
            can_view_trips: true,
            can_view_ticket: false,
            can_contact: true,
            can_open_useful_content: true,
            can_open_faq: true,
          },
        },
      },
    });

    expect(result.response_text_fields).toMatchObject({
      headline: 'Откройте приложение',
      body:
        'Полезные материалы, ответы на вопросы и контактная информация доступны в приложении.',
      status_line: 'Нажмите «Открыть приложение».',
      content_source: 'resolved_action_content',
    });
  });

  it('handles blocked not-available actions with deterministic text and visibility-safe buttons', () => {
    const service = new TelegramWebhookOutboundResponseOrchestrationService({
      executeTelegramNotificationDelivery: () => ({
        outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      }),
      now: () => new Date('2026-04-14T12:15:00.000Z'),
    });

    const result = service.orchestrateOutboundResponse({
      adapter_type: 'callback',
      raw_update: buildCallbackUpdate({ data: 'cancel_before_prepayment' }),
      adapter_result_summary: {
        mapping_status: 'mapped_guest_action_callback',
        mapped_action_type: 'cancel_before_prepayment',
        operation_type: 'guest_action_by_telegram_user',
        operation_status: 'blocked_not_possible',
        operation_result_summary: {
          action_type: 'cancel_before_prepayment',
          action_status: 'action_not_available',
          visibility_availability_summary: {
            can_view_trips: true,
            can_view_ticket: false,
            can_contact: true,
            can_open_useful_content: true,
            can_open_faq: true,
            can_cancel_before_prepayment: false,
          },
        },
      },
    });

    expect(result.response_text_fields.headline).toBe('Действие временно недоступно');
    expect(result.button_payloads.some((item) => item.action_type === 'open_ticket')).toBe(false);
    expect(
      result.button_payloads.some(
        (item) => item.action_type === 'cancel_before_prepayment'
      )
    ).toBe(false);
    expect(result.button_payloads.some((item) => item.action_type === 'open_mini_app')).toBe(
      true
    );
  });

  it('surfaces blocked delivery handoff outcomes and preserves provider details', () => {
    const service = new TelegramWebhookOutboundResponseOrchestrationService({
      executeTelegramNotificationDelivery: () => ({
        outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
        blocked_reason: 'user_blocked_bot',
        provider_result_reference: {
          adapter_name: 'webhook-outbound-test-adapter',
          adapter_outcome: 'blocked',
          blocked_reason: 'user_blocked_bot',
        },
      }),
      now: () => new Date('2026-04-14T12:20:00.000Z'),
    });

    const result = service.orchestrateOutboundResponse({
      adapter_type: 'command',
      raw_update: buildMessageUpdate({ text: '/open_contact' }),
      adapter_result_summary: {
        mapping_status: 'mapped_guest_action_command',
        mapped_action_type: 'open_contact',
        operation_type: 'guest_action_by_telegram_user',
        operation_status: 'processed',
        operation_result_summary: {
          action_type: 'open_contact',
          action_status: 'action_available',
          resolved_data_summary: {
            preferred_contact_phone_e164: '+79990000000',
          },
          visibility_availability_summary: {
            can_view_trips: true,
            can_view_ticket: false,
            can_contact: true,
            can_open_useful_content: true,
            can_open_faq: true,
          },
        },
      },
    });

    expect(result.delivery_handoff_summary).toMatchObject({
      handoff_status: 'blocked',
      adapter_outcome: 'blocked',
      blocked_reason: 'user_blocked_bot',
      provider_result_reference: {
        adapter_name: 'webhook-outbound-test-adapter',
      },
    });
  });

  it('renders ticket-aware start response when handoff context is present', () => {
    const service = new TelegramWebhookOutboundResponseOrchestrationService({
      executeTelegramNotificationDelivery: () => ({
        outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      }),
      now: () => new Date('2026-04-14T12:21:00.000Z'),
    });

    const result = service.orchestrateOutboundResponse({
      adapter_type: 'command',
      raw_update: buildMessageUpdate({ text: '/start seller-direct-link-7__p145' }),
      adapter_result_summary: {
        mapping_status: 'mapped_start_command',
        operation_type: 'inbound_start_update',
        operation_status: 'processed',
        operation_result_summary: {
          start_handoff_summary: {
            lookup_status: 'ticket_found',
            canonical_presale_id: 145,
            buyer_ticket_code: 'Б46',
          },
          operation_result_summary: {
            bot_start_state_summary: {
              start_mode: 'new_guest',
            },
          },
        },
      },
      mini_app_launch_summary: {
        launch_ready: true,
        launch_url: 'https://example.test/telegram/mini-app',
      },
    });

    expect(result).toMatchObject({
      outbound_mapping_status: 'mapped_start_response',
      response_text_fields: {
        headline: 'Билет найден',
        content_source: 'start_handoff_ticket_content',
      },
    });
    expect(result.button_payloads[0]?.web_app_url || '').toContain(
      'https://example.test/telegram/mini-app'
    );
  });

  it('maps manual ticket-code message to open-app response', () => {
    const service = new TelegramWebhookOutboundResponseOrchestrationService({
      executeTelegramNotificationDelivery: () => ({
        outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      }),
      now: () => new Date('2026-04-14T12:22:00.000Z'),
    });

    const result = service.orchestrateOutboundResponse({
      adapter_type: 'command',
      raw_update: buildMessageUpdate({ text: 'Б46' }),
      adapter_result_summary: {
        mapping_status: 'mapped_ticket_code_message',
        operation_type: 'ticket_lookup_by_buyer_code',
        operation_status: 'processed',
        operation_result_summary: {
          lookup_status: 'ticket_found',
          buyer_ticket_code: 'Б46',
          canonical_presale_id: 145,
        },
      },
      mini_app_launch_summary: {
        launch_ready: true,
        launch_url: 'https://example.test/telegram/mini-app?canonical_presale_id=145',
      },
    });

    expect(result).toMatchObject({
      outbound_mapping_status: 'mapped_ticket_code_lookup_response',
      response_text_fields: {
        headline: 'Билет найден',
        content_source: 'ticket_lookup_content',
      },
      delivery_handoff_summary: {
        handoff_status: 'sent',
      },
    });
    expect(result.button_payloads[0]?.action_type).toBe('open_mini_app');
  });
});
