import { describe, expect, it, vi } from 'vitest';
import { TelegramBotApiNotificationDeliveryAdapter } from '../../server/telegram/index.js';
import { TelegramNotificationDeliveryExecutorService } from '../../server/telegram/services/notification-delivery-executor-service.js';
import {
  TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION,
  TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES,
  TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR_VERSION,
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
  TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION,
  TELEGRAM_NOTIFICATION_DISPATCH_STATUSES,
  TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS,
  TELEGRAM_SERVICE_MESSAGE_TYPES,
} from '../../shared/telegram/index.js';

function buildAdapterInput(overrides = {}) {
  const {
    delivery_target_summary: deliveryTargetSummaryOverrides,
    resolved_payload_summary_reference: payloadReferenceOverrides,
    ...topLevelOverrides
  } = overrides;
  const notificationType =
    overrides.notification_type || TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created;

  return {
    adapter_contract_version: TELEGRAM_NOTIFICATION_DELIVERY_ADAPTER_CONTRACT_VERSION,
    delivery_channel: 'telegram_bot',
    delivery_target_summary: {
      booking_request_id: 101,
      guest_profile_id: 202,
      language_code: 'ru',
      target_type: 'telegram_guest',
      telegram_user_id: '123456789',
      ...deliveryTargetSummaryOverrides,
    },
    dedupe_key: `test-dedupe-${notificationType}`,
    idempotency_key: `test-dedupe-${notificationType}`,
    no_op_guards: {
      bot_handlers_invoked: false,
      mini_app_ui_invoked: false,
      money_ledger_written: false,
      notification_log_row_created: false,
      production_routes_invoked: false,
      seller_owner_admin_ui_invoked: false,
      telegram_api_called_by_executor: false,
      telegram_message_sent_by_executor: false,
    },
    notification_type: notificationType,
    queue_item_reference: {
      notification_type: notificationType,
      reference_type: 'telegram_notification_dispatch_queue_item',
    },
    requested_by: 'telegram_notification_delivery_executor_service',
    resolved_payload_summary_reference: {
      booking_request_id: 101,
      content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS[notificationType],
      field_keys: ['body', 'headline', 'status_line'],
      locale: 'ru',
      message_mode: 'telegram_request_open',
      message_type: notificationType,
      reference_type: 'telegram_service_message_resolution',
      resolution_version: 'telegram_service_message_resolution_v1',
      ...payloadReferenceOverrides,
    },
    ...topLevelOverrides,
  };
}

function createAdapter({ transportResult } = {}) {
  const sendMessage = vi.fn(() =>
    transportResult || {
      body: {
        ok: true,
        result: {
          message_id: 987,
          chat: { id: 123456789 },
        },
      },
      http_status: 200,
      transport_ok: true,
    }
  );

  return {
    adapter: new TelegramBotApiNotificationDeliveryAdapter({
      botToken: '123456:ABC_DEF-test',
      transport: { sendMessage },
    }),
    sendMessage,
  };
}

function buildDispatchQueueItem(overrides = {}) {
  const adapterInput = buildAdapterInput(overrides);

  return {
    response_version: TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_PROJECTION_VERSION,
    queue_item_type: TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
    notification_type: adapterInput.notification_type,
    dispatch_status: {
      delivery_attempt_state: 'not_attempted',
      dispatchable: true,
      intent_status: 'intent_created',
      projected_from: 'persisted_notification_intent',
      reason: null,
      status: TELEGRAM_NOTIFICATION_DISPATCH_STATUSES.pending,
    },
    persisted_intent_reference: {
      booking_request_event_id: 303,
      booking_request_id: 101,
      event_type: 'NOTIFICATION_INTENT_CREATED',
      reference_type: 'telegram_booking_request_event',
    },
    delivery_target_summary: adapterInput.delivery_target_summary,
    dedupe_key: adapterInput.dedupe_key,
    idempotency_key: adapterInput.idempotency_key,
    resolved_payload_summary_reference: adapterInput.resolved_payload_summary_reference,
    read_only: true,
    projection_only: true,
  };
}

describe('telegram bot api notification delivery adapter', () => {
  it('sends a text service message to a valid Telegram user target', () => {
    const { adapter, sendMessage } = createAdapter();

    const result = adapter.executeTelegramNotificationDelivery(buildAdapterInput());

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      botToken: '123456:ABC_DEF-test',
      request: {
        chat_id: '123456789',
        text: [
          'Booking request received',
          'We received your request.',
          'Temporary hold is active.',
        ].join('\n'),
      },
    });
    expect(result).toMatchObject({
      adapter_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      blocked_reason: null,
      failed_reason: null,
      external_delivery_reference: {
        api_method: 'sendMessage',
        provider: 'telegram_bot_api',
        telegram_chat_id: '123456789',
        telegram_message_id: 987,
      },
      delivery_metadata_summary: {
        api_method: 'sendMessage',
        content_key: TELEGRAM_SERVICE_MESSAGE_CONTENT_KEYS.booking_created,
        notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
        target_summary: {
          chat_id_kind: 'private_user_id',
          chat_target_present: true,
          target_source: 'telegram_user_id',
        },
        text_payload_summary: {
          format: 'plain_text',
          message_kind: 'service_message',
        },
      },
      provider_result_reference: {
        adapter_outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
        external_delivery_reference: {
          telegram_message_id: 987,
        },
        telegram_api_summary: {
          ok: true,
          http_status: 200,
        },
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.delivery_metadata_summary)).toBe(true);
    expect(Object.isFrozen(result.provider_result_reference)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('123456:ABC_DEF-test');
    expect(JSON.stringify(result)).not.toContain('We received your request.');
  });

  it('blocks without calling Telegram when the existing target summary has no valid chat id', () => {
    const { adapter, sendMessage } = createAdapter();

    const result = adapter.executeTelegramNotificationDelivery(
      buildAdapterInput({
        delivery_target_summary: {
          telegram_user_id: 'tg-local-placeholder',
        },
      })
    );

    expect(sendMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      adapter_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
      outcome: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
      blocked_reason: 'no_valid_chat_target',
      failed_reason: null,
      external_delivery_reference: null,
      delivery_metadata_summary: {
        target_summary: {
          chat_target_present: false,
        },
      },
    });
  });

  it('maps Telegram blocked and chat-not-found API failures into blocked results', () => {
    const blocked = createAdapter({
      transportResult: {
        body: {
          ok: false,
          error_code: 403,
          description: 'Forbidden: bot was blocked by the user',
        },
        http_status: 403,
        transport_ok: true,
      },
    }).adapter.executeTelegramNotificationDelivery(buildAdapterInput());

    const chatNotFound = createAdapter({
      transportResult: {
        body: {
          ok: false,
          error_code: 400,
          description: 'Bad Request: chat not found',
        },
        http_status: 400,
        transport_ok: true,
      },
    }).adapter.executeTelegramNotificationDelivery(buildAdapterInput());

    expect(blocked).toMatchObject({
      adapter_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
      blocked_reason: 'user_blocked_bot',
      failed_reason: null,
      provider_result_reference: {
        telegram_api_summary: {
          error_code: 403,
          http_status: 403,
          ok: false,
        },
      },
    });
    expect(chatNotFound).toMatchObject({
      adapter_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.blocked,
      blocked_reason: 'chat_not_found',
      failed_reason: null,
      provider_result_reference: {
        telegram_api_summary: {
          error_code: 400,
          http_status: 400,
          ok: false,
        },
      },
    });
  });

  it('maps generic Telegram API and local configuration failures into failed results', () => {
    const genericFailure = createAdapter({
      transportResult: {
        body: {
          ok: false,
          error_code: 500,
          description: 'Internal Server Error',
        },
        http_status: 500,
        transport_ok: true,
      },
    }).adapter.executeTelegramNotificationDelivery(buildAdapterInput());

    const missingToken = new TelegramBotApiNotificationDeliveryAdapter({
      botToken: null,
      transport: { sendMessage: vi.fn() },
    }).executeTelegramNotificationDelivery(buildAdapterInput());

    expect(genericFailure).toMatchObject({
      adapter_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
      blocked_reason: null,
      failed_reason: 'telegram_api_failure',
    });
    expect(missingToken).toMatchObject({
      adapter_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.failed,
      blocked_reason: null,
      failed_reason: 'telegram_bot_token_missing_or_invalid',
    });
  });

  it('keeps richer future text fields behind the adapter boundary', () => {
    const { adapter, sendMessage } = createAdapter();

    const result = adapter.execute(
      buildAdapterInput({
        notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
        text_payload: {
          fields: {
            body: 'Confirmed body',
            headline: 'Confirmed headline',
            status_line: 'Confirmed status',
          },
        },
      })
    );

    expect(sendMessage).toHaveBeenCalledWith({
      botToken: '123456:ABC_DEF-test',
      request: {
        chat_id: '123456789',
        text: ['Confirmed headline', 'Confirmed body', 'Confirmed status'].join('\n'),
      },
    });
    expect(result).toMatchObject({
      adapter_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      delivery_metadata_summary: {
        notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_confirmed,
      },
    });
  });

  it('passes optional inline keyboard payload through sendMessage reply_markup', () => {
    const { adapter, sendMessage } = createAdapter();

    const result = adapter.executeTelegramNotificationDelivery(
      buildAdapterInput({
        text_payload: {
          fields: {
            headline: 'Menu',
            body: 'Pick one option below.',
            status_line: 'Callback actions are enabled.',
          },
        },
        telegram_reply_markup: {
          inline_keyboard: [
            [
              { text: 'Trips', callback_data: 'action:open_trips' },
              { text: 'FAQ', callback_data: 'action:open_faq' },
            ],
          ],
        },
      })
    );

    expect(sendMessage).toHaveBeenCalledWith({
      botToken: '123456:ABC_DEF-test',
      request: {
        chat_id: '123456789',
        text: ['Menu', 'Pick one option below.', 'Callback actions are enabled.'].join('\n'),
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Trips', callback_data: 'action:open_trips' },
              { text: 'FAQ', callback_data: 'action:open_faq' },
            ],
          ],
        },
      },
    });
    expect(result).toMatchObject({
      adapter_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      delivery_metadata_summary: {
        button_payload_summary: {
          row_count: 1,
          button_count: 2,
          inline_keyboard: true,
        },
      },
    });
  });

  it('passes web_app inline keyboard payload through sendMessage reply_markup', () => {
    const { adapter, sendMessage } = createAdapter();

    const result = adapter.executeTelegramNotificationDelivery(
      buildAdapterInput({
        text_payload: {
          fields: {
            headline: 'Launch',
            body: 'Open the Mini App.',
            status_line: 'Web App button is enabled.',
          },
        },
        telegram_reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Open Mini App',
                web_app: {
                  url: 'https://example.test/telegram/mini-app?telegram_user_id=123456789',
                },
              },
            ],
          ],
        },
      })
    );

    expect(sendMessage).toHaveBeenCalledWith({
      botToken: '123456:ABC_DEF-test',
      request: {
        chat_id: '123456789',
        text: ['Launch', 'Open the Mini App.', 'Web App button is enabled.'].join('\n'),
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Open Mini App',
                web_app: {
                  url: 'https://example.test/telegram/mini-app?telegram_user_id=123456789',
                },
              },
            ],
          ],
        },
      },
    });
    expect(result).toMatchObject({
      adapter_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      delivery_metadata_summary: {
        button_payload_summary: {
          row_count: 1,
          button_count: 1,
          inline_keyboard: true,
        },
      },
    });
  });

  it('plugs into the existing executor adapter contract without changing persistence', () => {
    const { adapter } = createAdapter();
    const persistenceCalls = [];
    const queueItem = buildDispatchQueueItem();
    const persistenceService = {
      listDeliveryAttemptEvents: vi.fn(() => []),
      persistNotificationDeliveryAttempt: vi.fn((input) => {
        persistenceCalls.push(input);

        return {
          notification_type: input.notification_dispatch_queue_item.notification_type,
          delivery_attempt_status: input.delivery_attempt_status,
          dispatch_queue_item_reference: {
            notification_type: input.notification_dispatch_queue_item.notification_type,
            persisted_intent_reference:
              input.notification_dispatch_queue_item.persisted_intent_reference,
            reference_type: TELEGRAM_NOTIFICATION_DISPATCH_QUEUE_ITEM_TYPE,
          },
          delivery_target_summary:
            input.notification_dispatch_queue_item.delivery_target_summary,
          dedupe_key: input.dedupeKey,
          idempotency_key: input.idempotencyKey,
          blocked_reason: input.blockedReason || null,
          failed_reason: input.failedReason || null,
          provider_result_reference: input.providerResultReference,
          persisted_delivery_attempt_reference: {
            booking_request_event_id: 404,
            booking_request_id: 101,
            delivery_attempt_status:
              TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent,
            event_type: 'NOTIFICATION_DELIVERY_SENT',
            reference_type: 'telegram_booking_request_event',
          },
        };
      }),
    };
    const executor = new TelegramNotificationDeliveryExecutorService({
      notificationDeliveryAttemptPersistenceService: persistenceService,
      deliveryAdapter: adapter,
    });

    const result = executor.executeNotificationDelivery({
      notification_dispatch_queue_item: queueItem,
      actorType: 'system',
      actorId: 'adapter-contract-test',
    });

    expect(result).toMatchObject({
      response_version: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTOR_VERSION,
      execution_status: TELEGRAM_NOTIFICATION_DELIVERY_EXECUTION_STATUSES.sent,
      notification_type: TELEGRAM_SERVICE_MESSAGE_TYPES.booking_created,
      persisted_attempt_reference: {
        delivery_attempt_status:
          TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent,
      },
    });
    expect(persistenceCalls[0]).toMatchObject({
      delivery_attempt_status:
        TELEGRAM_NOTIFICATION_DELIVERY_ATTEMPT_STATUSES.delivery_sent,
      providerResultReference: {
        adapter_name: 'telegram-bot-api-notification-delivery-adapter',
        external_delivery_reference: {
          telegram_message_id: 987,
        },
      },
    });
  });
});
