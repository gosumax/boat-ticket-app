import {
  buildTelegramRuntimeHealthSummary,
  buildTelegramRuntimeStartupValidation,
  resolveTelegramRuntimeConfig,
} from '../server/telegram/runtime-config.mjs';

const TELEGRAM_WEBHOOK_PATH = '/api/telegram/webhook';

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeCandidateBaseUrl(rawValue) {
  const value = normalizeString(rawValue);
  if (!value) {
    return null;
  }

  let parsed = null;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  const webhookPathSuffix = TELEGRAM_WEBHOOK_PATH.toLowerCase();
  let normalizedPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  const normalizedPathLower = normalizedPath.toLowerCase();
  if (normalizedPathLower.endsWith(webhookPathSuffix)) {
    normalizedPath = normalizedPath.slice(0, normalizedPath.length - webhookPathSuffix.length);
  }
  if (normalizedPath === '/') {
    normalizedPath = '';
  }
  return `${parsed.origin}${normalizedPath}`;
}

function toIsoOrNull(unixSeconds) {
  if (!Number.isInteger(unixSeconds) || unixSeconds <= 0) {
    return null;
  }
  return new Date(unixSeconds * 1000).toISOString();
}

function buildApiUrl(botToken, methodName) {
  return `https://api.telegram.org/bot${botToken}/${methodName}`;
}

function parseArgs(argv) {
  const flags = new Set();
  let inlineBaseUrl = null;
  for (const rawArg of argv) {
    const arg = String(rawArg || '').trim();
    if (!arg) {
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      inlineBaseUrl = arg.slice('--base-url='.length);
      continue;
    }
    if (arg.startsWith('--')) {
      flags.add(arg);
      continue;
    }
    if (!inlineBaseUrl) {
      inlineBaseUrl = arg;
    }
  }
  return {
    register: flags.has('--register'),
    check: flags.has('--check'),
    dropPendingUpdates: flags.has('--drop-pending-updates'),
    baseUrlArg: inlineBaseUrl,
  };
}

function printHeader() {
  console.log('Telegram webhook helper (local dev)');
  console.log('-----------------------------------');
}

function printInputs({
  envBaseUrl,
  normalizedArgBaseUrl,
  runtimeConfig,
  startupValidation,
  webhookUrl,
  botToken,
  webhookSecret,
}) {
  if (normalizedArgBaseUrl) {
    console.log(`Override TELEGRAM_PUBLIC_BASE_URL from CLI: ${normalizedArgBaseUrl}`);
  } else {
    console.log(`Current TELEGRAM_PUBLIC_BASE_URL: ${envBaseUrl || '(not set in environment)'}`);
  }
  console.log('');
  console.log('Webhook registration inputs:');
  console.log(`TELEGRAM_BOT_TOKEN=${botToken || '<missing>'}`);
  console.log(`TELEGRAM_WEBHOOK_SECRET_TOKEN=${webhookSecret || '<missing>'}`);
  console.log(
    `TELEGRAM_PUBLIC_BASE_URL=${runtimeConfig.telegram_public_base_url || '<missing_or_invalid>'}`
  );
  console.log(`Webhook URL=${webhookUrl || '<cannot_build_without_valid_base_url>'}`);
  if (botToken) {
    console.log(`Telegram setWebhook endpoint=${buildApiUrl(botToken, 'setWebhook')}`);
    console.log(`Telegram getWebhookInfo endpoint=${buildApiUrl(botToken, 'getWebhookInfo')}`);
  } else {
    console.log('Telegram API endpoints=<cannot_build_without_valid_bot_token>');
  }
  console.log('');
  console.log(`Startup validation state: ${startupValidation.validation_state}`);
  if (startupValidation.missing_required_settings.length > 0) {
    console.log(
      `Missing required settings: ${startupValidation.missing_required_settings.join(', ')}`
    );
  }
  if (startupValidation.invalid_reasons.length > 0) {
    console.log(`Invalid reasons: ${startupValidation.invalid_reasons.join(', ')}`);
  }
}

function printWebhookInfoSummary(payload) {
  const result = payload?.result || {};
  const allowedUpdates = Array.isArray(result.allowed_updates) ? result.allowed_updates : [];
  const allowedUpdatesSorted = [...allowedUpdates].map(String).sort();

  console.log('Webhook status summary:');
  console.log(`ok=${Boolean(payload?.ok)}`);
  console.log(`url=${normalizeString(result.url) || '<none>'}`);
  console.log(`has_custom_certificate=${Boolean(result.has_custom_certificate)}`);
  console.log(`pending_update_count=${Number(result.pending_update_count || 0)}`);
  console.log(`ip_address=${normalizeString(result.ip_address) || '<none>'}`);
  console.log(`last_error_date_iso=${toIsoOrNull(result.last_error_date) || '<none>'}`);
  console.log(`last_error_message=${normalizeString(result.last_error_message) || '<none>'}`);
  console.log(
    `last_synchronization_error_date_iso=${
      toIsoOrNull(result.last_synchronization_error_date) || '<none>'
    }`
  );
  console.log(`max_connections=${Number(result.max_connections || 0)}`);
  console.log(
    `allowed_updates=${allowedUpdatesSorted.length > 0 ? allowedUpdatesSorted.join(',') : '<none>'}`
  );
}

async function callTelegramJson(botToken, methodName, { body = null } = {}) {
  const response = await fetch(buildApiUrl(botToken, methodName), {
    method: body ? 'POST' : 'GET',
    headers: body
      ? {
          'content-type': 'application/json',
        }
      : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsedBody = null;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    throw new Error(
      `[TELEGRAM_WEBHOOK_HELPER] Telegram API returned non-JSON for ${methodName}: HTTP ${response.status}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `[TELEGRAM_WEBHOOK_HELPER] Telegram API HTTP ${response.status} for ${methodName}: ${
        parsedBody?.description || 'unknown_error'
      }`
    );
  }

  return parsedBody;
}

async function main() {
  const parsedArgs = parseArgs(process.argv.slice(2));
  const normalizedArgBaseUrl = normalizeCandidateBaseUrl(parsedArgs.baseUrlArg);
  const envBaseUrl = normalizeString(process.env.TELEGRAM_PUBLIC_BASE_URL);
  const envForCheck =
    normalizedArgBaseUrl === null
      ? process.env
      : {
          ...process.env,
          TELEGRAM_PUBLIC_BASE_URL: normalizedArgBaseUrl,
        };

  const runtimeConfig = resolveTelegramRuntimeConfig({ env: envForCheck });
  const startupValidation = buildTelegramRuntimeStartupValidation(runtimeConfig);
  const healthSummary = buildTelegramRuntimeHealthSummary(runtimeConfig);

  const botToken = runtimeConfig.telegram_bot_token;
  const webhookSecret = runtimeConfig.telegram_webhook_secret_token;
  const webhookUrl = healthSummary.launch_urls.webhook_public_url;

  printHeader();
  if (parsedArgs.baseUrlArg && !normalizedArgBaseUrl) {
    console.log(`Input URL is invalid and was ignored: "${parsedArgs.baseUrlArg}"`);
    console.log('');
  }
  printInputs({
    envBaseUrl,
    normalizedArgBaseUrl,
    runtimeConfig,
    startupValidation,
    webhookUrl,
    botToken,
    webhookSecret,
  });

  if (!parsedArgs.register && !parsedArgs.check) {
    console.log('');
    console.log('No remote action requested. Use --register and/or --check.');
    return;
  }

  if (!botToken) {
    throw new Error(
      '[TELEGRAM_WEBHOOK_HELPER] Cannot call Telegram API because TELEGRAM_BOT_TOKEN is missing or invalid'
    );
  }

  if (parsedArgs.register) {
    if (!webhookUrl) {
      throw new Error(
        `[TELEGRAM_WEBHOOK_HELPER] Cannot register webhook because ${TELEGRAM_WEBHOOK_PATH} URL is not ready`
      );
    }
    if (!webhookSecret) {
      throw new Error(
        '[TELEGRAM_WEBHOOK_HELPER] Cannot register webhook because TELEGRAM_WEBHOOK_SECRET_TOKEN is missing or invalid'
      );
    }

    console.log('');
    console.log('Registering webhook via Telegram Bot API...');
    const registerResponse = await callTelegramJson(botToken, 'setWebhook', {
      body: {
        url: webhookUrl,
        secret_token: webhookSecret,
        drop_pending_updates: Boolean(parsedArgs.dropPendingUpdates),
      },
    });
    console.log(
      `setWebhook result: ok=${Boolean(registerResponse.ok)} description=${
        registerResponse.description || '<none>'
      }`
    );
  }

  if (parsedArgs.check) {
    console.log('');
    console.log('Checking webhook via Telegram Bot API...');
    const webhookInfo = await callTelegramJson(botToken, 'getWebhookInfo');
    printWebhookInfoSummary(webhookInfo);
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
