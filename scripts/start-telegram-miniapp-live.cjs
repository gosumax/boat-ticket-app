const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

function readEnv(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLogFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function normalizeCandidateBaseUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return null;
  }

  let parsed = null;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') {
    return null;
  }

  if (!/\.trycloudflare\.com$/i.test(parsed.hostname || '')) {
    return null;
  }

  return parsed.origin;
}

function extractQuickTunnelUrl(logText) {
  const quickTunnelUrlPattern =
    /https:\/\/[-a-z0-9]+\.trycloudflare\.com(?:\/[^\s"'<>]*)?/gi;
  const matches = Array.from(String(logText || '').matchAll(quickTunnelUrlPattern));
  if (matches.length === 0) {
    return null;
  }

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const normalized = normalizeCandidateBaseUrl(matches[index][0]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function detectQuickTunnelIssues(logText) {
  const lines = String(logText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const issuePatterns = [
    /failed to read quick-tunnel response/i,
    /context deadline exceeded/i,
    /failed to refresh dns local resolver/i,
    /\bi\/o timeout\b/i,
    /lookup .* timeout/i,
  ];

  return lines.filter((line) => issuePatterns.some((pattern) => pattern.test(line)));
}

function appendTunnelLogHeader(logPath, title) {
  fs.appendFileSync(logPath, `\r\n========== ${title} ==========\r\n`, 'utf8');
}

async function waitForCloudflareUrl(logPath, child, maxSeconds, attemptLabel) {
  let lastIssueLine = null;

  for (let attempt = 1; attempt <= maxSeconds; attempt += 1) {
    const logText = readLogFileSafe(logPath);
    const publicUrl = extractQuickTunnelUrl(logText);
    if (publicUrl) {
      return {
        publicUrl,
        failureReason: null,
        lastIssueLine,
      };
    }

    const issueLines = detectQuickTunnelIssues(logText);
    const nextIssueLine = issueLines.length > 0 ? issueLines[issueLines.length - 1] : null;
    if (nextIssueLine && nextIssueLine !== lastIssueLine) {
      lastIssueLine = nextIssueLine;
      console.log(`[LAUNCHER] ${attemptLabel}: detected tunnel startup issue: ${lastIssueLine}`);
    }

    if (child && child.exitCode !== null) {
      return {
        publicUrl: null,
        failureReason: `cloudflared exited with code ${child.exitCode}`,
        lastIssueLine,
      };
    }

    if (attempt === 1 || attempt % 5 === 0 || attempt === maxSeconds) {
      console.log(
        `[LAUNCHER] ${attemptLabel}: waiting for Cloudflare HTTPS URL (${attempt}/${maxSeconds})...`
      );
    }
    await sleep(1000);
  }

  return {
    publicUrl: null,
    failureReason: 'timed out while waiting for Cloudflare Quick Tunnel URL',
    lastIssueLine,
  };
}

function commandExists(commandOrPath) {
  if (!commandOrPath) {
    return false;
  }

  if (fs.existsSync(commandOrPath)) {
    return true;
  }

  const result = spawnSync('where.exe', [commandOrPath], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return result.status === 0;
}

function ensureTempDir() {
  const dirPath = path.join(os.tmpdir(), 'boat-ticket-app-live-launcher');
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function writeWorkerScript(filePath, lines) {
  fs.writeFileSync(filePath, `${lines.join('\r\n')}\r\n`, 'utf8');
}

function spawnWorker(workerPath, inlineMode, env) {
  const args = inlineMode ? ['/d', '/c', workerPath] : ['/d', '/k', workerPath];
  const child = spawn('cmd.exe', args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: Boolean(inlineMode),
    env,
  });
  child.unref();
}

function spawnDetachedLoggedProcess(command, args, env, logPath) {
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    env,
  });
  child.unref();
  fs.closeSync(logFd);
  return child;
}

function killDetachedProcess(child) {
  const pid = Number(child?.pid || 0);
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function promptForManualBaseUrl() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function ask(question) {
    return new Promise((resolve) => {
      rl.question(question, resolve);
    });
  }

  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const answer = await ask(
        attempt === 1
          ? '[FALLBACK] Paste the public HTTPS tunnel base URL to continue live testing now.\n[FALLBACK] Example: https://example.trycloudflare.com\n[FALLBACK] URL (leave blank to stop): '
          : '[FALLBACK] URL must be a full https://...trycloudflare.com base URL. Paste it now or press Enter to stop: '
      );
      const normalized = normalizeCandidateBaseUrl(answer);
      if (!String(answer || '').trim()) {
        return null;
      }
      if (normalized) {
        return normalized;
      }
    }
  } finally {
    rl.close();
  }

  return null;
}

async function discoverCloudflareBaseUrl({
  cloudflaredExe,
  projectDir,
  logPath,
  waitSeconds,
  maxAttempts,
  retryDelaySeconds,
}) {
  let activeChild = null;
  let lastFailure = 'Cloudflare Quick Tunnel did not produce a public URL';
  let lastIssueLine = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptLabel = `Cloudflare attempt ${attempt}/${maxAttempts}`;
    appendTunnelLogHeader(logPath, `${attemptLabel} started ${new Date().toISOString()}`);
    console.log(`[LAUNCHER] ${attemptLabel}: starting Cloudflare Quick Tunnel for port 3001...`);

    activeChild = spawnDetachedLoggedProcess(
      cloudflaredExe,
      [
        'tunnel',
        '--url',
        'http://127.0.0.1:3001',
        '--edge-ip-version',
        '4',
        '--no-autoupdate',
      ],
      {
        ...process.env,
        PROJECT_DIR: projectDir,
      },
      logPath
    );

    const waitResult = await waitForCloudflareUrl(
      logPath,
      activeChild,
      waitSeconds,
      attemptLabel
    );
    if (waitResult.publicUrl) {
      return {
        publicBaseUrl: waitResult.publicUrl,
        activeChild,
        discoveryMode: 'automatic',
        lastFailure: null,
        lastIssueLine: waitResult.lastIssueLine,
      };
    }

    lastFailure = waitResult.failureReason || lastFailure;
    lastIssueLine = waitResult.lastIssueLine || lastIssueLine;
    console.error(`[ERROR] ${attemptLabel} failed: ${lastFailure}`);
    if (lastIssueLine) {
      console.error(`[ERROR] ${attemptLabel} last tunnel issue: ${lastIssueLine}`);
    }
    killDetachedProcess(activeChild);
    activeChild = null;

    if (attempt < maxAttempts) {
      console.log(
        `[LAUNCHER] Waiting ${retryDelaySeconds} second(s) before retrying Cloudflare Quick Tunnel discovery...`
      );
      await sleep(retryDelaySeconds * 1000);
    }
  }

  return {
    publicBaseUrl: null,
    activeChild: null,
    discoveryMode: null,
    lastFailure,
    lastIssueLine,
  };
}

async function waitForJsonReady(url, maxAttempts, waitMs) {
  const timeoutMs = Math.max(waitMs - 250, 1000);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // Ignore transient startup errors while the build/server comes up.
    }

    console.log(
      `[LAUNCHER] Waiting for app health endpoint, attempt ${attempt} of ${maxAttempts}...`
    );
    await sleep(waitMs);
  }

  return false;
}

async function runLaunchHelperWithRetry({
  launchHelperPath,
  projectDir,
  publicBaseUrl,
  serverEnv,
  telegramBotToken,
  telegramWebhookSecret,
}) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(
      `[LAUNCHER] Refreshing live Telegram webhook and menu button (attempt ${attempt}/${maxAttempts})...`
    );
    const helperResult = spawnSync(
      process.execPath,
      [
        launchHelperPath,
        `--base-url=${publicBaseUrl}`,
        '--apply',
        '--check',
      ],
      {
        cwd: projectDir,
        stdio: 'inherit',
        env: {
          ...serverEnv,
          TELEGRAM_BOT_TOKEN: telegramBotToken,
          TELEGRAM_WEBHOOK_SECRET_TOKEN: telegramWebhookSecret,
        },
      }
    );

    if (helperResult.status === 0) {
      return true;
    }

    if (attempt < maxAttempts) {
      console.error(
        `[ERROR] Telegram launch helper attempt ${attempt}/${maxAttempts} failed. Waiting 4 seconds before retry...`
      );
      await sleep(4000);
    }
  }

  return false;
}

async function main() {
  const projectDir = readEnv('PROJECT_DIR') || path.resolve(__dirname, '..');
  const launcherPath = path.join(projectDir, 'start-telegram-miniapp-live.bat');
  const cloudflaredExe = readEnv('CLOUDFLARED_EXE', 'cloudflared');
  const cloudflaredWaitSeconds =
    Number(readEnv('CLOUDFLARED_WAIT_SECONDS', '60')) || 60;
  const cloudflaredMaxDiscoveryAttempts =
    Number(readEnv('CLOUDFLARED_MAX_DISCOVERY_ATTEMPTS', '3')) || 3;
  const cloudflaredRetryDelaySeconds =
    Number(readEnv('CLOUDFLARED_RETRY_DELAY_SECONDS', '5')) || 5;
  const inlineMode = readEnv('LAUNCHER_INLINE_MODE') === '1';
  const launchHelperPath = path.join(projectDir, 'scripts', 'telegram-launch-helper.mjs');

  const telegramBotToken = readEnv('TELEGRAM_BOT_TOKEN_VALUE');
  const telegramWebhookSecret = readEnv('TELEGRAM_WEBHOOK_SECRET_TOKEN_VALUE');
  const miniAppUserId = readEnv('MINI_APP_TEST_USER_ID', '777123456');
  const miniAppVersion = readEnv('MINI_APP_VERSION', 'live1');

  if (!projectDir || !fs.existsSync(path.join(projectDir, 'package.json'))) {
    console.error(`[ERROR] Project directory not found: ${projectDir || '(empty)'}`);
    process.exit(1);
    return;
  }

  if (!fs.existsSync(launchHelperPath)) {
    console.error(`[ERROR] Launch helper not found: ${launchHelperPath}`);
    process.exit(1);
    return;
  }

  if (!commandExists(cloudflaredExe)) {
    console.error('[ERROR] cloudflared was not found.');
    console.error('[ERROR] Update CLOUDFLARED_EXE in this file or install Cloudflare Tunnel once:');
    console.error(`[ERROR] ${launcherPath}`);
    console.error('[ERROR] Example install: winget install --id Cloudflare.cloudflared');
    console.error(
      '[ERROR] Example path override: set "CLOUDFLARED_EXE=%LOCALAPPDATA%\\cloudflared\\cloudflared.exe"'
    );
    process.exit(1);
    return;
  }

  const tempDir = ensureTempDir();
  const serverWorkerPath = path.join(tempDir, 'start-telegram-miniapp-live-server.cmd');
  const tunnelLogPath = path.join(tempDir, 'start-telegram-miniapp-live-cloudflared.log');

  fs.writeFileSync(tunnelLogPath, '', 'utf8');

  console.log('[LAUNCHER] Checking cloudflared path...');
  console.log(`[LAUNCHER] Tunnel log: ${tunnelLogPath}`);
  console.log(
    `[LAUNCHER] Waiting for the Cloudflare HTTPS URL with up to ${cloudflaredMaxDiscoveryAttempts} attempt(s) and ${cloudflaredWaitSeconds} second(s) per attempt...`
  );

  const discoveryResult = await discoverCloudflareBaseUrl({
    cloudflaredExe,
    projectDir,
    logPath: tunnelLogPath,
    waitSeconds: cloudflaredWaitSeconds,
    maxAttempts: cloudflaredMaxDiscoveryAttempts,
    retryDelaySeconds: cloudflaredRetryDelaySeconds,
  });

  let publicBaseUrl = discoveryResult.publicBaseUrl;
  let discoveryMode = discoveryResult.discoveryMode;
  if (!publicBaseUrl) {
    console.error('[ERROR] Failed to discover a public HTTPS URL from Cloudflare Tunnel automatically.');
    console.error(`[ERROR] Inspect the log file: ${tunnelLogPath}`);
    const logTail = readLogFileSafe(tunnelLogPath)
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-20)
      .join('\n');
    if (logTail) {
      console.error('[ERROR] Last tunnel log lines:');
      console.error(logTail);
    }
    if (discoveryResult.lastFailure) {
      console.error(`[ERROR] Last automatic discovery failure: ${discoveryResult.lastFailure}`);
    }
    if (discoveryResult.lastIssueLine) {
      console.error(`[ERROR] Last Cloudflare issue line: ${discoveryResult.lastIssueLine}`);
    }
    console.error('[FALLBACK] Automatic discovery did not finish in time.');
    console.error('[FALLBACK] If needed, start or restart Cloudflare manually in another terminal:');
    console.error(
      `[FALLBACK] ${cloudflaredExe} tunnel --url http://127.0.0.1:3001 --edge-ip-version 4 --no-autoupdate`
    );
    console.error(
      '[FALLBACK] When Cloudflare shows an https://...trycloudflare.com URL, paste that base URL below to continue live testing.'
    );

    publicBaseUrl = await promptForManualBaseUrl();
    if (!publicBaseUrl) {
      console.error(
        '[ERROR] The server was not started because TELEGRAM_PUBLIC_BASE_URL could not be discovered automatically and no manual fallback URL was provided.'
      );
      process.exit(1);
      return;
    }

    discoveryMode = 'manual_fallback';
  }

  if (!discoveryResult.activeChild && discoveryMode === 'manual_fallback') {
    console.log('[LAUNCHER] Continuing with manually provided TELEGRAM_PUBLIC_BASE_URL.');
  }

  writeWorkerScript(serverWorkerPath, [
    '@echo off',
    'chcp 65001 >nul',
    'title boat-ticket-app server',
    'cd /d "%PROJECT_DIR%"',
    'echo [SERVER] Building project...',
    'call npm.cmd run build',
    'if errorlevel 1 (',
    '  echo [SERVER] ERROR: npm run build failed.',
    '  exit /b 1',
    ')',
    'set "TELEGRAM_BOT_TOKEN=%TELEGRAM_BOT_TOKEN_VALUE%"',
    'set "TELEGRAM_WEBHOOK_SECRET_TOKEN=%TELEGRAM_WEBHOOK_SECRET_TOKEN_VALUE%"',
    'set "TELEGRAM_PUBLIC_BASE_URL=%TELEGRAM_PUBLIC_BASE_URL%"',
    'echo [SERVER] TELEGRAM_PUBLIC_BASE_URL=%TELEGRAM_PUBLIC_BASE_URL%',
    'echo [SERVER] Starting node server/index.js...',
    'node.exe server/index.js',
  ]);

  const finalMiniAppUrl =
    `${publicBaseUrl}/telegram/mini-app` +
    `?telegram_user_id=${encodeURIComponent(miniAppUserId)}` +
    `&mini_app_v=${encodeURIComponent(miniAppVersion)}`;

  console.log(
    `[LAUNCHER] Public Cloudflare base URL ${discoveryMode === 'manual_fallback' ? 'accepted via fallback' : 'discovered'}:`
  );
  console.log(`[LAUNCHER] ${publicBaseUrl}`);
  console.log('[LAUNCHER] Starting the app server window with TELEGRAM_PUBLIC_BASE_URL...');

  const serverEnv = {
    ...process.env,
    PROJECT_DIR: projectDir,
    TELEGRAM_BOT_TOKEN_VALUE: telegramBotToken,
    TELEGRAM_WEBHOOK_SECRET_TOKEN_VALUE: telegramWebhookSecret,
    TELEGRAM_PUBLIC_BASE_URL: publicBaseUrl,
  };
  spawnWorker(serverWorkerPath, inlineMode, serverEnv);

  console.log('[LAUNCHER] Server window started.');
  const healthReady = await waitForJsonReady(
    `${publicBaseUrl}/api/telegram/health`,
    90,
    2000
  );
  if (!healthReady) {
    console.error(
      '[ERROR] Timed out waiting for the public Telegram health endpoint before refreshing Telegram launch settings.'
    );
    process.exit(1);
    return;
  }

  console.log('[LAUNCHER] Public Telegram health endpoint is ready.');
  const helperReady = await runLaunchHelperWithRetry({
    launchHelperPath,
    projectDir,
    publicBaseUrl,
    serverEnv,
    telegramBotToken,
    telegramWebhookSecret,
  });
  if (!helperReady) {
    console.error('[ERROR] Telegram launch helper failed.');
    process.exit(1);
    return;
  }

  console.log('');
  console.log('[LAUNCHER] Buyer Mini App URL for live checks:');
  console.log(`[LAUNCHER] ${finalMiniAppUrl}`);
  console.log('');
  console.log(
    '[LAUNCHER] Cloudflare Tunnel is running in the background log, and the server is running in its own window.'
  );
}

main().catch((error) => {
  console.error(`[ERROR] Launcher failed: ${error?.message || String(error)}`);
  process.exit(1);
});
