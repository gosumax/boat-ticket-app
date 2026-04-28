import BetterSqlite3 from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTelegramRuntimeHealthSummary,
  buildTelegramRuntimeStartupValidation,
  resolveTelegramRuntimeConfig,
} from '../server/telegram/runtime-config.mjs';

const MENU_BUTTON_TEXT = 'Открыть приложение';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(SCRIPT_DIR, '..');
const TRY_CLOUDFLARE_HOST_SUFFIX = '.trycloudflare.com';
const KNOWN_CHAT_ID_SCAN_LIMIT = 200;
const PRESERVED_LAUNCH_QUERY_PARAMS = new Set([
  'canonical_presale_id',
  'buyer_ticket_code',
  'telegram_user_id',
  'startapp',
]);

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

function extractHostFromUrl(rawUrl) {
  const normalized = normalizeString(rawUrl);
  if (!normalized) {
    return null;
  }
  try {
    return new URL(normalized).host || null;
  } catch {
    return null;
  }
}

function isTryCloudflareHost(rawHost) {
  const host = normalizeString(rawHost);
  return Boolean(host && host.endsWith(TRY_CLOUDFLARE_HOST_SUFFIX));
}

function normalizePrivateChatId(rawValue) {
  const normalized = normalizeString(rawValue);
  if (!normalized) {
    return null;
  }
  if (!/^[1-9]\d*$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function loadKnownChatIdsFromDatabase() {
  const dbPath = resolve(PROJECT_DIR, 'database.sqlite');
  if (!existsSync(dbPath)) {
    return {
      source: 'missing_database_file',
      chatIds: [],
    };
  }

  let db = null;
  try {
    db = new BetterSqlite3(dbPath, { readonly: true });
    const rows = db
      .prepare(
        `
          SELECT telegram_user_id
          FROM telegram_guest_profiles
          ORDER BY COALESCE(last_seen_at, first_seen_at) DESC
          LIMIT ?
        `
      )
      .all(KNOWN_CHAT_ID_SCAN_LIMIT);
    const chatIds = [...new Set(rows.map((row) => normalizePrivateChatId(row?.telegram_user_id)).filter(Boolean))];
    return {
      source: 'database_guest_profiles',
      chatIds,
    };
  } catch {
    return {
      source: 'database_read_failed',
      chatIds: [],
    };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // no-op
      }
    }
  }
}

function buildRefreshedChatSpecificMiniAppUrl({ currentUrl, targetMiniAppUrl }) {
  const current = normalizeString(currentUrl);
  const target = normalizeString(targetMiniAppUrl);
  if (!target) {
    return null;
  }
  if (!current) {
    return target;
  }

  try {
    const currentParsed = new URL(current);
    const targetParsed = new URL(target);
    for (const [key, value] of currentParsed.searchParams.entries()) {
      if (PRESERVED_LAUNCH_QUERY_PARAMS.has(key) && !targetParsed.searchParams.has(key)) {
        targetParsed.searchParams.set(key, value);
      }
    }
    return targetParsed.toString();
  } catch {
    return target;
  }
}

function readLocalDotEnv() {
  const envPath = resolve(PROJECT_DIR, '.env');
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
  let launchChatId = null;

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
    if (arg.startsWith('--launch-chat-id=')) {
      launchChatId = normalizeString(arg.slice('--launch-chat-id='.length));
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
    sendFreshLaunchMessage: flags.has('--send-fresh-launch-message'),
    syncKnownChatMenuButtons: flags.has('--sync-known-chat-menu-buttons'),
    dropPendingUpdates: flags.has('--drop-pending-updates'),
    baseUrlArg: inlineBaseUrl,
    launchChatId,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildFreshLaunchMessagePayload({ chatId, miniAppUrl, menuText }) {
  return {
    chat_id: chatId,
    text: 'Кнопка обновлена. Откройте Mini App по кнопке ниже.',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: menuText || MENU_BUTTON_TEXT,
            web_app: {
              url: miniAppUrl,
            },
          },
        ],
      ],
    },
  };
}

async function inspectKnownChatMenuButtons({
  botToken,
  knownChatIds = [],
  expectedMiniAppUrl,
}) {
  const expectedHost = extractHostFromUrl(expectedMiniAppUrl);
  const staleChatButtons = [];
  let resolvedChats = 0;
  let skippedUnavailableChats = 0;

  for (const chatId of knownChatIds) {
    try {
      const menuButton = await callTelegramJson(botToken, 'getChatMenuButton', {
        body: {
          chat_id: chatId,
        },
      });
      resolvedChats += 1;

      const menuType = normalizeString(menuButton?.result?.type);
      const menuUrl = normalizeString(menuButton?.result?.web_app?.url);
      const menuHost = extractHostFromUrl(menuUrl);
      if (
        menuType === 'web_app' &&
        menuHost &&
        expectedHost &&
        menuHost !== expectedHost &&
        isTryCloudflareHost(menuHost)
      ) {
        staleChatButtons.push({
          chatId,
          currentUrl: menuUrl,
          currentHost: menuHost,
        });
      }
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('chat not found') || message.includes('user not found')) {
        skippedUnavailableChats += 1;
        continue;
      }
      skippedUnavailableChats += 1;
    }
  }

  return {
    checkedCount: knownChatIds.length,
    resolvedChats,
    skippedUnavailableChats,
    staleChatButtons,
  };
}

async function syncKnownChatMenuButtons({
  botToken,
  menuText,
  miniAppUrl,
  knownChatIds = [],
}) {
  const inspection = await inspectKnownChatMenuButtons({
    botToken,
    knownChatIds,
    expectedMiniAppUrl: miniAppUrl,
  });
  const updatedChatButtons = [];
  let refreshMessagesSent = 0;
  let refreshMessagesFailed = 0;

  for (const staleChat of inspection.staleChatButtons) {
    const refreshedUrl = buildRefreshedChatSpecificMiniAppUrl({
      currentUrl: staleChat.currentUrl,
      targetMiniAppUrl: miniAppUrl,
    });
    if (!refreshedUrl) {
      continue;
    }
    await callTelegramJson(botToken, 'setChatMenuButton', {
      body: {
        chat_id: staleChat.chatId,
        menu_button: {
          type: 'web_app',
          text: menuText || MENU_BUTTON_TEXT,
          web_app: {
            url: refreshedUrl,
          },
        },
      },
    });
    try {
      await callTelegramJson(botToken, 'sendMessage', {
        body: buildFreshLaunchMessagePayload({
          chatId: staleChat.chatId,
          miniAppUrl: refreshedUrl,
          menuText,
        }),
      });
      refreshMessagesSent += 1;
    } catch {
      refreshMessagesFailed += 1;
    }
    updatedChatButtons.push({
      chatId: staleChat.chatId,
      previousUrl: staleChat.currentUrl,
      nextUrl: refreshedUrl,
    });
  }

  return {
    inspected: inspection,
    updatedChatButtons,
    refreshMessagesSent,
    refreshMessagesFailed,
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
  const shouldSyncKnownChatMenuButtons =
    parsedArgs.apply || parsedArgs.syncKnownChatMenuButtons;
  const shouldSendFreshLaunchMessage =
    parsedArgs.apply || parsedArgs.sendFreshLaunchMessage;
  const launchChatId =
    parsedArgs.launchChatId ||
    normalizeString(baseEnv.MINI_APP_TEST_USER_ID) ||
    normalizeString(baseEnv.TELEGRAM_TEST_CHAT_ID);
  const knownChatIdsLookup =
    shouldSyncKnownChatMenuButtons || shouldCheck
      ? loadKnownChatIdsFromDatabase()
      : {
          source: 'not_requested',
          chatIds: [],
        };

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

  if (shouldSyncKnownChatMenuButtons) {
    if (!miniAppUrl) {
      throw new Error(
        '[TELEGRAM_LAUNCH_HELPER] Cannot sync chat-specific menu buttons because TELEGRAM_PUBLIC_BASE_URL is not ready'
      );
    }
    console.log('');
    console.log(
      `Syncing known chat-specific menu buttons from ${knownChatIdsLookup.source} (candidate chats: ${knownChatIdsLookup.chatIds.length})...`
    );
    const syncSummary = await syncKnownChatMenuButtons({
      botToken,
      menuText: parsedArgs.menuText,
      miniAppUrl,
      knownChatIds: knownChatIdsLookup.chatIds,
    });
    console.log(
      `Known chat menu sync: stale_found=${syncSummary.inspected.staleChatButtons.length}, updated=${syncSummary.updatedChatButtons.length}, refreshed_messages_sent=${syncSummary.refreshMessagesSent}, refreshed_messages_failed=${syncSummary.refreshMessagesFailed}, resolved=${syncSummary.inspected.resolvedChats}, unavailable=${syncSummary.inspected.skippedUnavailableChats}`
    );
    if (syncSummary.updatedChatButtons.length > 0) {
      for (const updatedChatButton of syncSummary.updatedChatButtons.slice(0, 20)) {
        console.log(
          `Updated chat_id=${updatedChatButton.chatId} menu URL: ${updatedChatButton.previousUrl} -> ${updatedChatButton.nextUrl}`
        );
      }
    }
  }

  if (shouldSendFreshLaunchMessage) {
    if (!miniAppUrl) {
      throw new Error(
        '[TELEGRAM_LAUNCH_HELPER] Cannot send fresh launch message because TELEGRAM_PUBLIC_BASE_URL is not ready'
      );
    }
    if (!launchChatId) {
      console.log('');
      console.log(
        '[TELEGRAM_LAUNCH_HELPER] Skipped fresh launch message: launch chat id is not configured (--launch-chat-id or MINI_APP_TEST_USER_ID).'
      );
    } else {
      console.log('');
      console.log(`Sending fresh launch message to chat ${launchChatId}...`);
      try {
        const sendMessageResult = await callTelegramJson(botToken, 'sendMessage', {
          body: buildFreshLaunchMessagePayload({
            chatId: launchChatId,
            miniAppUrl,
            menuText: parsedArgs.menuText,
          }),
        });
        console.log(
          `sendMessage result: ok=${Boolean(sendMessageResult.ok)} message_id=${
            sendMessageResult?.result?.message_id ?? '<none>'
          }`
        );
        console.log(
          '[TELEGRAM_LAUNCH_HELPER] Fresh inline launch button was sent. Old buttons in chat history may still point to old URLs.'
        );
      } catch (error) {
        console.log(
          `[TELEGRAM_LAUNCH_HELPER] Fresh launch message was not sent: ${error?.message || String(error)}`
        );
        console.log(
          '[TELEGRAM_LAUNCH_HELPER] Continuing because webhook and chat menu button were updated successfully.'
        );
      }
    }
  }

  if (
    !shouldCheck &&
    !shouldRegisterWebhook &&
    !shouldSetMenuButton &&
    !parsedArgs.clearMenuButton &&
    !shouldSyncKnownChatMenuButtons &&
    !shouldSendFreshLaunchMessage
  ) {
    console.log('');
    console.log(
      'No remote action requested. Use --apply, --check, --register-webhook, --set-menu-button, --sync-known-chat-menu-buttons, or --send-fresh-launch-message.'
    );
    return;
  }

  if (shouldCheck || parsedArgs.clearMenuButton) {
    console.log('');
    console.log('Checking live Telegram configuration...');
    const maxAlignmentAttempts = parsedArgs.apply ? 10 : 1;
    const alignmentWaitMs = 2000;
    let lastMismatches = [];

    for (let attempt = 1; attempt <= maxAlignmentAttempts; attempt += 1) {
      const [botProfile, webhookInfo, menuButton, commands] = await Promise.all([
        callTelegramJson(botToken, 'getMe'),
        callTelegramJson(botToken, 'getWebhookInfo'),
        callTelegramJson(botToken, 'getChatMenuButton', { body: {} }),
        callTelegramJson(botToken, 'getMyCommands'),
      ]);

      if (attempt === 1 || attempt === maxAlignmentAttempts) {
        printRemoteState({
          botProfile,
          webhookInfo,
          menuButton,
          commands,
        });
      }

      if (parsedArgs.clearMenuButton) {
        lastMismatches = [];
        break;
      }

      const mismatches = validateFinalState({
        intendedWebhookUrl: webhookUrl,
        intendedMiniAppUrl: miniAppUrl,
        webhookInfo,
        menuButton,
      });
      if (knownChatIdsLookup.chatIds.length > 0 && miniAppUrl) {
        const knownChatInspection = await inspectKnownChatMenuButtons({
          botToken,
          knownChatIds: knownChatIdsLookup.chatIds,
          expectedMiniAppUrl: miniAppUrl,
        });
        console.log(
          `Known chat menu check: stale=${knownChatInspection.staleChatButtons.length}, resolved=${knownChatInspection.resolvedChats}, unavailable=${knownChatInspection.skippedUnavailableChats}`
        );
        if (knownChatInspection.staleChatButtons.length > 0) {
          const stalePreview = knownChatInspection.staleChatButtons
            .slice(0, 5)
            .map((item) => `${item.chatId} (${item.currentHost})`)
            .join(', ');
          mismatches.push(
            `Known chat-specific stale menu buttons detected: ${stalePreview}`
          );
        }
      }

      if (mismatches.length === 0) {
        lastMismatches = [];
        if (attempt > 1) {
          console.log(
            `[TELEGRAM_LAUNCH_HELPER] Launch state aligned after retry ${attempt}/${maxAlignmentAttempts}.`
          );
        }
        break;
      }

      lastMismatches = mismatches;
      if (attempt < maxAlignmentAttempts) {
        await sleep(alignmentWaitMs);
      }
    }

    if (!parsedArgs.clearMenuButton) {
      if (lastMismatches.length > 0) {
        throw new Error(
          `[TELEGRAM_LAUNCH_HELPER] Final Telegram launch state is not aligned:\n- ${lastMismatches.join('\n- ')}`
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
