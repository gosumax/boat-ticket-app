import { describe, expect, it } from 'vitest';
import {
  buildTelegramRuntimeHealthSummary,
  buildTelegramRuntimeSmokeReadinessResult,
  buildTelegramRuntimeStartupValidation,
  resolveTelegramRuntimeConfig,
} from '../../server/telegram/runtime-config.mjs';

function createReadyServices() {
  return {
    runtimeEntrypointOrchestrationService: {},
    guestCommandActionOrchestrationService: {},
    notificationDeliveryExecutorService: {
      deliveryAdapter: () => ({
        outcome: 'sent',
      }),
    },
    miniAppTripsCatalogQueryService: {},
    miniAppTripCardQueryService: {},
    miniAppBookingSubmitOrchestrationService: {},
  };
}

describe('telegram runtime config and smoke readiness', () => {
  it('parses valid env config and marks startup as ready for live test bot', () => {
    const config = resolveTelegramRuntimeConfig({
      env: {
        TELEGRAM_BOT_TOKEN: '123456:ABC_DEF-valid',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'telegram-secret-123',
        TELEGRAM_PUBLIC_BASE_URL: 'https://example.test',
      },
    });
    const startupValidation = buildTelegramRuntimeStartupValidation(config);

    expect(config).toMatchObject({
      summary: {
        bot_token_configured: true,
        bot_token_valid: true,
        webhook_secret_configured: true,
        webhook_secret_valid: true,
        public_base_url_configured: true,
        public_base_url_valid: true,
        public_base_url_https: true,
        has_invalid_values: false,
      },
    });
    expect(startupValidation).toMatchObject({
      validation_state: 'ready_for_live_test_bot',
      ready_for_live_test_bot: true,
      missing_required_settings: [],
      invalid_reasons: [],
    });
  });

  it('maps invalid and missing config states deterministically', () => {
    const invalidConfig = resolveTelegramRuntimeConfig({
      env: {
        TELEGRAM_BOT_TOKEN: 'invalid token with spaces',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'short',
        TELEGRAM_PUBLIC_BASE_URL: 'ftp://invalid-host',
      },
    });
    const invalidStartupValidation =
      buildTelegramRuntimeStartupValidation(invalidConfig);
    const missingConfig = resolveTelegramRuntimeConfig({
      env: {},
    });
    const missingStartupValidation =
      buildTelegramRuntimeStartupValidation(missingConfig);

    expect(invalidConfig.summary).toMatchObject({
      has_invalid_values: true,
      invalid_reasons: expect.arrayContaining([
        'invalid_telegram_bot_token_format',
        'invalid_telegram_webhook_secret_format',
        'invalid_telegram_public_base_url',
      ]),
    });
    expect(invalidStartupValidation).toMatchObject({
      validation_state: 'invalid_runtime_config',
      ready_for_live_test_bot: false,
    });
    expect(missingStartupValidation).toMatchObject({
      validation_state: 'not_ready_missing_required_config',
      ready_for_live_test_bot: false,
      missing_required_settings: [
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_WEBHOOK_SECRET_TOKEN',
        'TELEGRAM_PUBLIC_BASE_URL',
      ],
    });
  });

  it('builds runtime health envelope with launch URLs and secret requirement state', () => {
    const config = resolveTelegramRuntimeConfig({
      env: {
        TELEGRAM_BOT_TOKEN: '123456:ABC_DEF-valid',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'telegram-secret-123',
        TELEGRAM_PUBLIC_BASE_URL: 'https://example.test/root/',
        TELEGRAM_MINI_APP_CACHE_BUSTER: 'ios-cache-v1',
      },
    });
    const health = buildTelegramRuntimeHealthSummary(config, {
      now: () => new Date('2026-04-15T10:00:00.000Z'),
      webhookSecretRequired: true,
    });

    expect(health).toMatchObject({
      response_version: 'telegram_runtime_health_summary_result.v1',
      bot_token_summary: {
        configured: true,
        usable: true,
      },
      webhook_secret_summary: {
        configured: true,
        required: true,
        usable: true,
      },
      public_base_url_summary: {
        configured: true,
        valid: true,
        https_ready: true,
      },
      launch_urls: {
        webhook_public_url: 'https://example.test/root/api/telegram/webhook',
        mini_app_launch_url:
          'https://example.test/root/telegram/mini-app?mini_app_v=ios-cache-v1',
      },
      mini_app_launch_summary: {
        launch_ready: true,
        launch_cache_buster: 'ios-cache-v1',
      },
    });
  });

  it('normalizes TELEGRAM_PUBLIC_BASE_URL when a webhook URL is pasted by mistake', () => {
    const config = resolveTelegramRuntimeConfig({
      env: {
        TELEGRAM_BOT_TOKEN: '123456:ABC_DEF-valid',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'telegram-secret-123',
        TELEGRAM_PUBLIC_BASE_URL: 'https://example.test/api/telegram/webhook',
        TELEGRAM_MINI_APP_CACHE_BUSTER: 'ios-cache-v2',
      },
    });
    const health = buildTelegramRuntimeHealthSummary(config, {
      now: () => new Date('2026-04-15T10:00:00.000Z'),
      webhookSecretRequired: true,
    });

    expect(config.telegram_public_base_url).toBe('https://example.test');
    expect(health.launch_urls).toMatchObject({
      webhook_public_url: 'https://example.test/api/telegram/webhook',
      mini_app_launch_url:
        'https://example.test/telegram/mini-app?mini_app_v=ios-cache-v2',
    });
    expect(health.mini_app_launch_summary).toMatchObject({
      launch_ready: true,
      launch_url: 'https://example.test/telegram/mini-app?mini_app_v=ios-cache-v2',
      launch_url_base: 'https://example.test/telegram/mini-app',
      launch_cache_buster: 'ios-cache-v2',
    });
  });

  it('adds deterministic mini-app cache-buster query to launch URL', () => {
    const config = resolveTelegramRuntimeConfig({
      env: {
        TELEGRAM_BOT_TOKEN: '123456:ABC_DEF-valid',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'telegram-secret-123',
        TELEGRAM_PUBLIC_BASE_URL: 'https://example.test',
        TELEGRAM_MINI_APP_CACHE_BUSTER: 'frontend-build-2026-04-15',
      },
    });
    const health = buildTelegramRuntimeHealthSummary(config, {
      now: () => new Date('2026-04-15T10:00:00.000Z'),
      webhookSecretRequired: true,
    });

    expect(health.mini_app_launch_summary).toMatchObject({
      launch_ready: true,
      launch_url_base: 'https://example.test/telegram/mini-app',
      launch_url:
        'https://example.test/telegram/mini-app?mini_app_v=frontend-build-2026-04-15',
      launch_cache_buster: 'frontend-build-2026-04-15',
    });
  });

  it('maps smoke readiness result for ready and not-ready routing states', () => {
    const readyConfig = resolveTelegramRuntimeConfig({
      env: {
        TELEGRAM_BOT_TOKEN: '123456:ABC_DEF-valid',
        TELEGRAM_WEBHOOK_SECRET_TOKEN: 'telegram-secret-123',
        TELEGRAM_PUBLIC_BASE_URL: 'https://example.test',
      },
    });
    const readySmoke = buildTelegramRuntimeSmokeReadinessResult({
      runtimeConfig: readyConfig,
      commandAdapter: {
        handleCommandUpdate() {},
      },
      callbackAdapter: {
        handleCallbackUpdate() {},
      },
      services: createReadyServices(),
      webhookSecretRequired: true,
      now: () => new Date('2026-04-15T10:00:00.000Z'),
    });
    const notReadySmoke = buildTelegramRuntimeSmokeReadinessResult({
      runtimeConfig: resolveTelegramRuntimeConfig({ env: {} }),
      commandAdapter: null,
      callbackAdapter: null,
      services: {},
      webhookSecretRequired: true,
      now: () => new Date('2026-04-15T10:00:00.000Z'),
    });

    expect(readySmoke).toMatchObject({
      response_version: 'telegram_runtime_smoke_readiness_result.v1',
      smoke_status: 'ready_for_live_smoke',
      ready_for_live_smoke: true,
      checks: {
        start_command_route: {
          check_status: 'ready',
          path: '/api/telegram/webhook',
          trigger: '/start',
        },
        approved_callback_actions: {
          check_status: 'ready',
          approved_action_types: expect.arrayContaining(['open_trips', 'open_faq']),
        },
        outbound_delivery_readiness: {
          check_status: 'ready',
          delivery_adapter_configured: true,
        },
        webhook_secret_handling: {
          check_status: 'ready',
          secret_required: true,
        },
        mini_app_launch_readiness: {
          check_status: 'ready',
        },
      },
    });
    expect(notReadySmoke).toMatchObject({
      smoke_status: 'not_ready',
      ready_for_live_smoke: false,
      checks: {
        start_command_route: {
          check_status: 'not_ready',
        },
        approved_callback_actions: {
          check_status: 'not_ready',
        },
        outbound_delivery_readiness: {
          check_status: 'not_ready',
          delivery_adapter_configured: false,
        },
        webhook_secret_handling: {
          check_status: 'not_ready',
        },
        mini_app_launch_readiness: {
          check_status: 'not_ready',
        },
      },
    });
  });
});
