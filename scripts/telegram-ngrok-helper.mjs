import {
  buildTelegramRuntimeHealthSummary,
  buildTelegramRuntimeStartupValidation,
  resolveTelegramRuntimeConfig,
} from '../server/telegram/runtime-config.mjs';

const TELEGRAM_WEBHOOK_PATH = '/api/telegram/webhook';
const TELEGRAM_MINI_APP_PATH = '/telegram/mini-app';

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

function readBaseUrlArg(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const baseArg = args.find((arg) => arg.startsWith('--base-url='));
  if (baseArg) {
    return baseArg.slice('--base-url='.length);
  }

  return args[0] || null;
}

function buildUrl(baseUrl, path) {
  if (!baseUrl) {
    return null;
  }
  const normalizedPath = String(path || '')
    .trim()
    .replace(/^\/+/, '');
  return normalizedPath ? `${baseUrl}/${normalizedPath}` : baseUrl;
}

const rawBaseUrlArg = readBaseUrlArg(process.argv.slice(2));
const normalizedArgBaseUrl = normalizeCandidateBaseUrl(rawBaseUrlArg);
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

const configuredBaseUrl = runtimeConfig.telegram_public_base_url;
const webhookUrl = buildUrl(configuredBaseUrl, TELEGRAM_WEBHOOK_PATH);
const miniAppUrl = buildUrl(configuredBaseUrl, TELEGRAM_MINI_APP_PATH);

console.log('Telegram public URL helper (local dev)');
console.log('--------------------------------');
if (rawBaseUrlArg && !normalizedArgBaseUrl) {
  console.log(`Input URL is invalid and was ignored: "${rawBaseUrlArg}"`);
}
console.log(
  `Current TELEGRAM_PUBLIC_BASE_URL: ${envBaseUrl || '(not set in environment)'}`
);
if (normalizedArgBaseUrl) {
  console.log(`Override from CLI: ${normalizedArgBaseUrl}`);
}
console.log('');
console.log('Set TELEGRAM_PUBLIC_BASE_URL to this base URL value (no /api/... suffix):');
console.log(
  `TELEGRAM_PUBLIC_BASE_URL=${configuredBaseUrl || '<paste_https_tunnel_base_url_here>'}`
);
console.log('');
console.log(`Expected webhook URL: ${webhookUrl || '(not available until base URL is valid)'}`);
console.log(`Expected Mini App URL: ${miniAppUrl || '(not available until base URL is valid)'}`);
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
console.log(
  `Webhook public URL from runtime health: ${healthSummary.launch_urls.webhook_public_url || '(not ready)'}`
);
