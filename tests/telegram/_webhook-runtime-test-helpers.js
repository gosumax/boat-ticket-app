import express from 'express';
import { createTelegramPersistenceContext } from '../../server/telegram/index.js';
import { createTelegramWebhookRouter } from '../../server/telegram/webhook-router.mjs';
import { resolveTelegramRuntimeConfig } from '../../server/telegram/runtime-config.mjs';
import {
  createClock,
  createTestDb,
  seedBookingRequest,
  wireClock,
} from './_guest-ticket-test-helpers.js';

export { createClock, seedBookingRequest };

export function buildTelegramMessageUpdate({
  updateId,
  messageId,
  telegramUserId,
  unixSeconds,
  text,
}) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: unixSeconds,
      text,
      from: {
        id: telegramUserId,
        is_bot: false,
        first_name: 'Webhook',
        last_name: 'Guest',
        username: `webhook_guest_${telegramUserId}`,
        language_code: 'ru',
      },
      chat: {
        id: telegramUserId,
        type: 'private',
        first_name: 'Webhook',
        last_name: 'Guest',
        username: `webhook_guest_${telegramUserId}`,
      },
    },
  };
}

export function buildTelegramCallbackUpdate({
  updateId,
  callbackQueryId,
  messageId,
  telegramUserId,
  unixSeconds,
  data,
}) {
  return {
    update_id: updateId,
    callback_query: {
      id: callbackQueryId,
      from: {
        id: telegramUserId,
        is_bot: false,
        first_name: 'Webhook',
        last_name: 'Guest',
        username: `webhook_guest_${telegramUserId}`,
        language_code: 'ru',
      },
      data,
      message: {
        message_id: messageId,
        date: unixSeconds,
        text: 'Callback source message',
        chat: {
          id: telegramUserId,
          type: 'private',
          first_name: 'Webhook',
          last_name: 'Guest',
          username: `webhook_guest_${telegramUserId}`,
        },
      },
    },
  };
}

function attachDeterministicDeliveryAdapter(context) {
  context.services.notificationDeliveryExecutorService.deliveryAdapter = () => ({
    outcome: 'sent',
    provider_result_reference: {
      adapter_name: 'telegram-webhook-test-adapter',
      adapter_outcome: 'sent',
    },
  });
}

export function createTelegramWebhookTestContext(clock) {
  const db = createTestDb();
  const telegramContext = createTelegramPersistenceContext(db);
  wireClock(telegramContext, clock);
  attachDeterministicDeliveryAdapter(telegramContext);
  return { db, telegramContext };
}

export function createTelegramWebhookTestApp(
  clock,
  {
    telegramWebhookSecretToken = null,
    runtimeEnvOverrides = {},
  } = {}
) {
  const { db, telegramContext } = createTelegramWebhookTestContext(clock);
  const telegramRuntimeConfig = resolveTelegramRuntimeConfig({
    env: {
      TELEGRAM_BOT_TOKEN: runtimeEnvOverrides.TELEGRAM_BOT_TOKEN,
      TELEGRAM_WEBHOOK_SECRET_TOKEN:
        telegramWebhookSecretToken === undefined
          ? runtimeEnvOverrides.TELEGRAM_WEBHOOK_SECRET_TOKEN
          : telegramWebhookSecretToken,
      TELEGRAM_PUBLIC_BASE_URL: runtimeEnvOverrides.TELEGRAM_PUBLIC_BASE_URL,
    },
  });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/telegram',
    createTelegramWebhookRouter({
      telegramContext,
      now: clock.now,
      telegramRuntimeConfig,
      telegramWebhookSecretToken,
    })
  );

  return { app, db, telegramContext, telegramRuntimeConfig };
}
