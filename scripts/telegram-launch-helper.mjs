import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTelegramRuntimeHealthSummary,
  buildTelegramRuntimeStartupValidation,
  resolveTelegramRuntimeConfig,
} from '../server/telegram/runtime-config.mjs';

const MENU_BUTTON_TEXT = 'Open Mini App';

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

  let normalizedPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  const webhookPathSuffix = '/api/telegram/webhook';
  if (normalizedPath.toLowerCase().endsWith(webhookPathSuffix)) {
    normalizedPath = normalizedPath.slice(0, normalizedPath.length - webhookPathSuffix.length);
  }
  if (normalizedPath === '/') {
    normalizedPath = '';
  }

  return `${parsed.origin}${normalizedPath}`;
}

function readLocalDotEnv() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(scriptDir, '..', '.env');
  let text = '';
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    return {};
  }

  const pairs = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }
    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    if (!key) {
      continue;
    }
    pairs[key] = value;
  }

  return pairs;
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
    if (arg.startsWith('--menu-text=')) {
      flags.add(arg);
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

  const menuTextFlag = [...flags].find((flag) => flag.startsWith('--menu-text='));
  return {
    apply: flags.has('--apply'),
    check: flags.has('--check'),
    registerWebhook: flags.has('--register-webhook'),
    setMenuButton: flags.has('--set-menu-button'),
    clearMenuButton: flags.has('--clear-menu-button'),
    dropPendingUpdates: flags.has('--drop-pending-updates'),
    baseUrlArg: inlineBaseUrl,
    menuText: normalizeString(
      menuTextFlag ? menuTextFlag.slice('--menu-text='.length) : MENU_BUTTON_TEXT
    ),
  };
}

function buildApiUrl(botToken, methodName) {
  return `https://api.telegram.org/bot${botToken}/${methodName}`;
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
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `[TELEGRAM_LAUNCH_HELPER] Telegram API returned non-JSON for ${methodName}: HTTP ${response.status}`
    );
  }

  if (!response.ok || payload?.ok !== true) {
    throw new Error(
      `[TELEGRAM_LAUNCH_HELPER] Telegram API ${methodName} failed: ${
        payload?.description || `HTTP ${response.status}`
      }`
    );
  }

  return payload;
}

function printHeader() {
  console.log('Telegram launch helper (local dev)');
  console.log('----------------------------------');
}

function printResolvedInputs({
  envBaseUrl,
  normalizedArgBaseUrl,
  runtimeConfig,
  startupValidation,
  healthSummary,
  menuText,
}) {
  if (normalizedArgBaseUrl) {
    console.log(`Override TELEGRAM_PUBLIC_BASE_URL from CLI: ${normalizedArgBaseUrl}`);
  } else {
    console.log(`Current TELEGRAM_PUBLIC_BASE_URL: ${envBaseUrl || '(not set in environment)'}`);
  }
  console.log(`Menu button text: ${menuText || MENU_BUTTON_TEXT}`);
  console.log('');
  console.log('Resolved launch targets:');
  console.log(
    `TELEGRAM_PUBLIC_BASE_URL=${runtimeConfig.telegram_public_base_url || '<missing_or_invalid>'}`
  );
  console.log(
    `Webhook URL=${healthSummary.launch_urls.webhook_public_url || '<cannot_build_without_valid_base_url>'}`
  );
  console.log(
    `Mini App URL=${healthSummary.launch_urls.mini_app_launch_url || '<cannot_build_without_valid_base_url>'}`
  );
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

function summarizeMenuButton(menuButtonResult = null) {
  const button = menuButtonResult?.result || {};
  return {
    type: normalizeString(button.type) || '<none>',
    text: normalizeString(button.text) || '<none>',
    url: normalizeString(button?.web_app?.url) || '<none>',
  };
}

function printRemoteState({ botProfile, webhookInfo, menuButton, commands }) {
  console.log('');
  console.log('Telegram remote state:');
  console.log(`Bot username=@${normalizeString(botProfile?.result?.username) || '<unknown>'}`);
  console.log(`Bot has_main_web_app=${Boolean(botProfile?.result?.has_main_web_app)}`);
  console.log(
    `Webhook URL=${normalizeString(webhookInfo?.result?.url) || '<none>'}`
  );
  console.log(
    `Webhook pending_update_count=${Number(webhookInfo?.result?.pending_update_count || 0)}`
  );
  console.log(
    `Webhook last_error_message=${normalizeString(webhookInfo?.result?.last_error_message) || '<none>'}`
  );
  const menuSummary = summarizeMenuButton(menuButton);
  console.log(`Menu button type=${menuSummary.type}`);
  console.log(`Menu button text=${menuSummary.text}`);
  console.log(`Menu button url=${menuSummary.url}`);
  const commandCount = Array.isArray(commands?.result) ? commands.result.length : 0;
  console.log(`Bot commands count=${commandCount}`);
}

function buildMenuButtonPayload({ menuText, miniAppUrl }) {
  return {
    menu_button: {
      type: 'web_app',
      text: menuText || MENU_BUTTON_TEXT,
      web_app: {
        url: miniAppUrl,
      },
    },
  };
}

function validateFinalState({
  intendedWebhookUrl,
  intendedMiniAppUrl,
  webhookInfo,
  menuButton,
}) {
  const actualWebhookUrl = normalizeString(webhookInfo?.result?.url);
  const actualMenuButtonType = normalizeString(menuButton?.result?.type);
  const actualMenuButtonUrl = normalizeString(menuButton?.result?.web_app?.url);

  const mismatches = [];
  if (actualWebhookUrl !== intendedWebhookUrl) {
    mismatches.push(
      `Webhook URL mismatch: expected ${intendedWebhookUrl}, received ${actualWebhookUrl || '<none>'}`
    );
  }
  if (actualMenuButtonType !== 'web_app') {
    mismatches.push(
      `Menu button type mismatch: expected web_app, received ${actualMenuButtonType || '<none>'}`
    );
  }
  if (actualMenuButtonUrl !== intendedMiniAppUrl) {
    mismatches.push(
      `Menu button URL mismatch: expected ${intendedMiniAppUrl}, received ${
        actualMenuButtonUrl || '<none>'
      }`
    );
  }

  return mismatches;
}

async function main() {
  const parsedArgs = parseArgs(process.argv.slice(2));
  const localDotEnv = readLocalDotEnv();
  const baseEnv = {
    ...localDotEnv,
    ...process.env,
  };
  const normalizedArgBaseUrl = normalizeCandidateBaseUrl(parsedArgs.baseUrlArg);
  const envBaseUrl = normalizeString(baseEnv.TELEGRAM_PUBLIC_BASE_URL);
  const envForCheck =
    normalizedArgBaseUrl === null
      ? baseEnv
      : {
          ...baseEnv,
          TELEGRAM_PUBLIC_BASE_URL: normalizedArgBaseUrl,
        };

  const runtimeConfig = resolveTelegramRuntimeConfig({ env: envForCheck });
  const startupValidation = buildTelegramRuntimeStartupValidation(runtimeConfig);
  const healthSummary = buildTelegramRuntimeHealthSummary(runtimeConfig);
  const botToken = runtimeConfig.telegram_bot_token;
  const webhookSecret = runtimeConfig.telegram_webhook_secret_token;
  const webhookUrl = healthSummary.launch_urls.webhook_public_url;
  const miniAppUrl = healthSummary.launch_urls.mini_app_launch_url;

  printHeader();
  if (parsedArgs.baseUrlArg && !normalizedArgBaseUrl) {
    console.log(`Input URL is invalid and was ignored: "${parsedArgs.baseUrlArg}"`);
    console.log('');
  }
  printResolvedInputs({
    envBaseUrl,
    normalizedArgBaseUrl,
    runtimeConfig,
    startupValidation,
    healthSummary,
    menuText: parsedArgs.menuText,
  });

  if (!botToken) {
    throw new Error(
      '[TELEGRAM_LAUNCH_HELPER] Cannot call Telegram API because TELEGRAM_BOT_TOKEN is missing or invalid'
    );
  }

  const shouldRegisterWebhook = parsedArgs.apply || parsedArgs.registerWebhook;
  const shouldSetMenuButton = parsedArgs.apply || parsedArgs.setMenuButton;
  const shouldCheck = parsedArgs.apply || parsedArgs.check;

  if (shouldRegisterWebhook) {
    if (!webhookUrl) {
      throw new Error(
        '[TELEGRAM_LAUNCH_HELPER] Cannot register webhook because TELEGRAM_PUBLIC_BASE_URL is not ready'
      );
    }
    if (!webhookSecret) {
      throw new Error(
        '[TELEGRAM_LAUNCH_HELPER] Cannot register webhook because TELEGRAM_WEBHOOK_SECRET_TOKEN is missing or invalid'
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

  if (shouldSetMenuButton) {
    if (!miniAppUrl) {
      throw new Error(
        '[TELEGRAM_LAUNCH_HELPER] Cannot set menu button because TELEGRAM_PUBLIC_BASE_URL is not ready'
      );
    }
    console.log('');
    console.log('Setting chat menu button via Telegram Bot API...');
    const menuResponse = await callTelegramJson(botToken, 'setChatMenuButton', {
      body: buildMenuButtonPayload({
        menuText: parsedArgs.menuText,
        miniAppUrl,
      }),
    });
    console.log(
      `setChatMenuButton result: ok=${Boolean(menuResponse.ok)} description=${
        menuResponse.description || '<none>'
      }`
    );
  }

  if (parsedArgs.clearMenuButton) {
    console.log('');
    console.log('Clearing chat menu button back to default commands...');
    const clearResponse = await callTelegramJson(botToken, 'setChatMenuButton', {
      body: {
        menu_button: {
          type: 'commands',
        },
      },
    });
    console.log(
      `clear menu button result: ok=${Boolean(clearResponse.ok)} description=${
        clearResponse.description || '<none>'
      }`
    );
  }

  if (!shouldCheck && !shouldRegisterWebhook && !shouldSetMenuButton && !parsedArgs.clearMenuButton) {
    console.log('');
    console.log('No remote action requested. Use --apply, --check, --register-webhook, or --set-menu-button.');
    return;
  }

  if (shouldCheck || parsedArgs.clearMenuButton) {
    console.log('');
    console.log('Checking live Telegram configuration...');
    const [botProfile, webhookInfo, menuButton, commands] = await Promise.all([
      callTelegramJson(botToken, 'getMe'),
      callTelegramJson(botToken, 'getWebhookInfo'),
      callTelegramJson(botToken, 'getChatMenuButton', { body: {} }),
      callTelegramJson(botToken, 'getMyCommands'),
    ]);

    printRemoteState({
      botProfile,
      webhookInfo,
      menuButton,
      commands,
    });

    if (!parsedArgs.clearMenuButton) {
      const mismatches = validateFinalState({
        intendedWebhookUrl: webhookUrl,
        intendedMiniAppUrl: miniAppUrl,
        webhookInfo,
        menuButton,
      });
      if (mismatches.length > 0) {
        throw new Error(
          `[TELEGRAM_LAUNCH_HELPER] Final Telegram launch state is not aligned:\n- ${mismatches.join('\n- ')}`
        );
      }
      console.log('');
      console.log('Telegram launch state is aligned with the current Mini App URL.');
    }
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
