import {
  buildTelegramLatestTimestampSummary,
  freezeTelegramHandoffValue,
  TELEGRAM_GUEST_COMMAND_ACTION_TYPES,
} from '../../shared/telegram/index.js';
import {
  TELEGRAM_MINI_APP_CACHE_BUSTER_QUERY_KEY,
  resolveTelegramMiniAppCacheBuster,
} from './mini-app-cache-buster.mjs';

export const TELEGRAM_RUNTIME_CONFIG_RESULT_VERSION = 'telegram_runtime_config_result.v1';
export const TELEGRAM_RUNTIME_HEALTH_SUMMARY_RESULT_VERSION =
  'telegram_runtime_health_summary_result.v1';
export const TELEGRAM_RUNTIME_STARTUP_VALIDATION_RESULT_VERSION =
  'telegram_runtime_startup_validation_result.v1';
export const TELEGRAM_RUNTIME_SMOKE_READINESS_RESULT_VERSION =
  'telegram_runtime_smoke_readiness_result.v1';

const TELEGRAM_WEBHOOK_PUBLIC_PATH = '/api/telegram/webhook';
const TELEGRAM_MINI_APP_PUBLIC_PATH = '/telegram/mini-app';

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function sortRuntimeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortRuntimeValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortRuntimeValue(value[key])])
  );
}

function freezeSortedRuntimeValue(value) {
  return freezeTelegramHandoffValue(sortRuntimeValue(value));
}

function resolveNowIso(now = () => new Date()) {
  const value = typeof now === 'function' ? now() : now;
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  if (Number.isNaN(Date.parse(iso))) {
    throw new Error('[TELEGRAM_RUNTIME_CONFIG] invalid clock timestamp');
  }
  return iso;
}

function normalizeTelegramBotToken(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return {
      configured: false,
      valid: false,
      token: null,
    };
  }

  const valid = /^[A-Za-z0-9:_-]+$/.test(normalized);
  return {
    configured: true,
    valid,
    token: valid ? normalized : null,
  };
}

function normalizeTelegramWebhookSecret(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return {
      configured: false,
      valid: false,
      secret: null,
      length: 0,
    };
  }

  const valid = normalized.length >= 8 && !/\s/.test(normalized);
  return {
    configured: true,
    valid,
    secret: valid ? normalized : null,
    length: normalized.length,
  };
}

function normalizeTelegramPublicBaseUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return {
      configured: false,
      valid: false,
      https: false,
      url: null,
    };
  }

  let parsed = null;
  try {
    parsed = new URL(normalized);
  } catch {
    return {
      configured: true,
      valid: false,
      https: false,
      url: null,
    };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return {
      configured: true,
      valid: false,
      https: false,
      url: null,
    };
  }

  const webhookPathSuffix = TELEGRAM_WEBHOOK_PUBLIC_PATH.toLowerCase();
  let normalizedPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  const normalizedPathLower = normalizedPath.toLowerCase();
  if (normalizedPathLower.endsWith(webhookPathSuffix)) {
    normalizedPath = normalizedPath.slice(0, normalizedPath.length - webhookPathSuffix.length);
  }
  if (normalizedPath === '/') {
    normalizedPath = '';
  }
  const normalizedUrl = `${parsed.origin}${normalizedPath}`;

  return {
    configured: true,
    valid: true,
    https: parsed.protocol === 'https:',
    url: normalizedUrl,
  };
}

function buildPublicUrl(baseUrl, path) {
  if (!baseUrl) {
    return null;
  }
  const normalizedPath = String(path || '')
    .trim()
    .replace(/^\/+/, '');
  if (!normalizedPath) {
    return baseUrl;
  }

  return `${baseUrl}/${normalizedPath}`;
}

function appendQueryParamToUrl(rawUrl, key, value) {
  const normalizedUrl = normalizeString(rawUrl);
  const normalizedKey = normalizeString(key);
  const normalizedValue = normalizeString(value);
  if (!normalizedUrl || !normalizedKey || !normalizedValue) {
    return normalizedUrl;
  }

  try {
    const parsed = new URL(normalizedUrl);
    parsed.searchParams.set(normalizedKey, normalizedValue);
    return parsed.toString();
  } catch {
    const separator = normalizedUrl.includes('?') ? '&' : '?';
    return `${normalizedUrl}${separator}${encodeURIComponent(
      normalizedKey
    )}=${encodeURIComponent(normalizedValue)}`;
  }
}

function normalizeRuntimeConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('[TELEGRAM_RUNTIME_CONFIG] runtime configuration object is required');
  }
  if (!input.summary || typeof input.summary !== 'object' || Array.isArray(input.summary)) {
    throw new Error('[TELEGRAM_RUNTIME_CONFIG] runtime configuration summary is required');
  }

  return input;
}

export function resolveTelegramRuntimeConfig({ env = process.env } = {}) {
  const botToken = normalizeTelegramBotToken(env?.TELEGRAM_BOT_TOKEN);
  const webhookSecret = normalizeTelegramWebhookSecret(env?.TELEGRAM_WEBHOOK_SECRET_TOKEN);
  const publicBaseUrl = normalizeTelegramPublicBaseUrl(env?.TELEGRAM_PUBLIC_BASE_URL);
  const miniAppCacheBuster = resolveTelegramMiniAppCacheBuster({ env });

  const invalidReasons = [];
  if (botToken.configured && !botToken.valid) {
    invalidReasons.push('invalid_telegram_bot_token_format');
  }
  if (webhookSecret.configured && !webhookSecret.valid) {
    invalidReasons.push('invalid_telegram_webhook_secret_format');
  }
  if (publicBaseUrl.configured && !publicBaseUrl.valid) {
    invalidReasons.push('invalid_telegram_public_base_url');
  }

  return freezeSortedRuntimeValue({
    response_version: TELEGRAM_RUNTIME_CONFIG_RESULT_VERSION,
    config_source: 'environment',
    telegram_bot_token: botToken.token,
    telegram_webhook_secret_token: webhookSecret.secret,
    telegram_public_base_url: publicBaseUrl.url,
    telegram_mini_app_cache_buster: miniAppCacheBuster,
    summary: {
      bot_token_configured: botToken.configured,
      bot_token_valid: botToken.valid,
      webhook_secret_configured: webhookSecret.configured,
      webhook_secret_valid: webhookSecret.valid,
      webhook_secret_length: webhookSecret.length,
      public_base_url_configured: publicBaseUrl.configured,
      public_base_url_valid: publicBaseUrl.valid,
      public_base_url_https: publicBaseUrl.https,
      mini_app_cache_buster_configured: Boolean(miniAppCacheBuster),
      has_invalid_values: invalidReasons.length > 0,
      invalid_reasons: invalidReasons,
    },
  });
}

export function buildTelegramMiniAppLaunchReadinessSummary(runtimeConfig = null) {
  const resolvedRuntimeConfig = normalizeRuntimeConfig(runtimeConfig || resolveTelegramRuntimeConfig());
  const launchUrlBase = buildPublicUrl(
    resolvedRuntimeConfig.telegram_public_base_url,
    TELEGRAM_MINI_APP_PUBLIC_PATH
  );
  const launchUrl = appendQueryParamToUrl(
    launchUrlBase,
    TELEGRAM_MINI_APP_CACHE_BUSTER_QUERY_KEY,
    resolvedRuntimeConfig.telegram_mini_app_cache_buster
  );
  const launchReady =
    Boolean(launchUrl) &&
    resolvedRuntimeConfig.summary.public_base_url_valid &&
    resolvedRuntimeConfig.summary.public_base_url_https;

  return freezeSortedRuntimeValue({
    launch_path: TELEGRAM_MINI_APP_PUBLIC_PATH,
    launch_ready: launchReady,
    launch_url_base: launchUrlBase,
    launch_url: launchUrl,
    launch_cache_buster: normalizeString(
      resolvedRuntimeConfig.telegram_mini_app_cache_buster
    ),
    rejection_reason: launchReady ? null : 'telegram_public_base_url_https_required',
  });
}

export function buildTelegramRuntimeHealthSummary(
  runtimeConfig = null,
  { now = () => new Date(), webhookSecretRequired = null } = {}
) {
  const resolvedRuntimeConfig = normalizeRuntimeConfig(runtimeConfig || resolveTelegramRuntimeConfig());
  const nowIso = resolveNowIso(now);
  const launchSummary = buildTelegramMiniAppLaunchReadinessSummary(resolvedRuntimeConfig);
  const secretRequired =
    webhookSecretRequired === null
      ? resolvedRuntimeConfig.summary.webhook_secret_valid
      : Boolean(webhookSecretRequired);

  return freezeSortedRuntimeValue({
    response_version: TELEGRAM_RUNTIME_HEALTH_SUMMARY_RESULT_VERSION,
    runtime_config_summary: {
      has_invalid_values: resolvedRuntimeConfig.summary.has_invalid_values,
      invalid_reasons: resolvedRuntimeConfig.summary.invalid_reasons,
    },
    bot_token_summary: {
      configured: resolvedRuntimeConfig.summary.bot_token_configured,
      usable: resolvedRuntimeConfig.summary.bot_token_valid,
    },
    webhook_secret_summary: {
      configured: resolvedRuntimeConfig.summary.webhook_secret_configured,
      length: resolvedRuntimeConfig.summary.webhook_secret_length,
      required: secretRequired,
      usable: resolvedRuntimeConfig.summary.webhook_secret_valid,
    },
    public_base_url_summary: {
      configured: resolvedRuntimeConfig.summary.public_base_url_configured,
      https_ready: resolvedRuntimeConfig.summary.public_base_url_https,
      valid: resolvedRuntimeConfig.summary.public_base_url_valid,
    },
    launch_urls: {
      mini_app_launch_url: launchSummary.launch_url,
      webhook_public_url: buildPublicUrl(
        resolvedRuntimeConfig.telegram_public_base_url,
        TELEGRAM_WEBHOOK_PUBLIC_PATH
      ),
    },
    mini_app_launch_summary: launchSummary,
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(nowIso),
  });
}

export function buildTelegramRuntimeStartupValidation(runtimeConfig = null) {
  const resolvedRuntimeConfig = normalizeRuntimeConfig(runtimeConfig || resolveTelegramRuntimeConfig());
  const missingRequired = [];
  if (!resolvedRuntimeConfig.summary.bot_token_valid) {
    missingRequired.push('TELEGRAM_BOT_TOKEN');
  }
  if (!resolvedRuntimeConfig.summary.webhook_secret_valid) {
    missingRequired.push('TELEGRAM_WEBHOOK_SECRET_TOKEN');
  }
  if (!resolvedRuntimeConfig.summary.public_base_url_https) {
    missingRequired.push('TELEGRAM_PUBLIC_BASE_URL');
  }

  const validationState = resolvedRuntimeConfig.summary.has_invalid_values
    ? 'invalid_runtime_config'
    : missingRequired.length > 0
      ? 'not_ready_missing_required_config'
      : 'ready_for_live_test_bot';

  return freezeSortedRuntimeValue({
    response_version: TELEGRAM_RUNTIME_STARTUP_VALIDATION_RESULT_VERSION,
    validation_state: validationState,
    ready_for_live_test_bot: validationState === 'ready_for_live_test_bot',
    missing_required_settings: missingRequired,
    invalid_reasons: resolvedRuntimeConfig.summary.invalid_reasons,
  });
}

export function buildTelegramRuntimeSmokeReadinessResult({
  runtimeConfig = null,
  startupValidation = null,
  commandAdapter = null,
  callbackAdapter = null,
  services = null,
  webhookSecretRequired = null,
  now = () => new Date(),
} = {}) {
  const resolvedRuntimeConfig = normalizeRuntimeConfig(runtimeConfig || resolveTelegramRuntimeConfig());
  const resolvedStartupValidation =
    startupValidation || buildTelegramRuntimeStartupValidation(resolvedRuntimeConfig);
  const healthSummary = buildTelegramRuntimeHealthSummary(resolvedRuntimeConfig, {
    now,
    webhookSecretRequired,
  });

  const startPathReady =
    Boolean(services?.runtimeEntrypointOrchestrationService) &&
    typeof commandAdapter?.handleCommandUpdate === 'function';
  const callbackPathReady =
    Boolean(services?.guestCommandActionOrchestrationService) &&
    typeof callbackAdapter?.handleCallbackUpdate === 'function';
  const deliveryAdapter = services?.notificationDeliveryExecutorService?.deliveryAdapter;
  const outboundDeliveryReady =
    Boolean(deliveryAdapter) && resolvedRuntimeConfig.summary.bot_token_valid;
  const webhookSecretReady = healthSummary.webhook_secret_summary.required
    ? resolvedRuntimeConfig.summary.webhook_secret_valid
    : true;
  const miniAppServicesReady =
    Boolean(services?.miniAppTripsCatalogQueryService) &&
    Boolean(services?.miniAppTripCardQueryService) &&
    Boolean(services?.miniAppBookingSubmitOrchestrationService);
  const miniAppLaunchReady =
    Boolean(healthSummary.mini_app_launch_summary.launch_ready) && miniAppServicesReady;

  const readyForLiveSmoke =
    resolvedStartupValidation.ready_for_live_test_bot &&
    startPathReady &&
    callbackPathReady &&
    outboundDeliveryReady &&
    webhookSecretReady &&
    miniAppLaunchReady;

  const smokeStatus =
    resolvedStartupValidation.validation_state === 'invalid_runtime_config'
      ? 'invalid_configuration'
      : readyForLiveSmoke
        ? 'ready_for_live_smoke'
        : 'not_ready';

  return freezeSortedRuntimeValue({
    response_version: TELEGRAM_RUNTIME_SMOKE_READINESS_RESULT_VERSION,
    smoke_status: smokeStatus,
    ready_for_live_smoke: readyForLiveSmoke,
    startup_validation: resolvedStartupValidation,
    checks: {
      approved_callback_actions: {
        approved_action_types: TELEGRAM_GUEST_COMMAND_ACTION_TYPES,
        check_status: callbackPathReady ? 'ready' : 'not_ready',
      },
      mini_app_launch_readiness: {
        check_status: miniAppLaunchReady ? 'ready' : 'not_ready',
        launch_url: healthSummary.mini_app_launch_summary.launch_url,
        mini_app_services_ready: miniAppServicesReady,
      },
      outbound_delivery_readiness: {
        bot_token_usable: resolvedRuntimeConfig.summary.bot_token_valid,
        check_status: outboundDeliveryReady ? 'ready' : 'not_ready',
        delivery_adapter_configured: Boolean(deliveryAdapter),
      },
      start_command_route: {
        check_status: startPathReady ? 'ready' : 'not_ready',
        method: 'POST',
        path: TELEGRAM_WEBHOOK_PUBLIC_PATH,
        trigger: '/start',
      },
      webhook_secret_handling: {
        check_status: webhookSecretReady ? 'ready' : 'not_ready',
        secret_required: Boolean(healthSummary.webhook_secret_summary.required),
      },
    },
    latest_timestamp_summary: buildTelegramLatestTimestampSummary(resolveNowIso(now)),
  });
}
