const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn, spawnSync } = require('child_process');
const BetterSqlite3 = require('better-sqlite3');

const launchedProcessPids = [];
let preserveLaunchedProcesses = false;

function readEnv(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDotEnv(projectDir) {
  const envPath = path.join(projectDir, '.env');
  const result = {};
  try {
    const text = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const equalsIndex = line.indexOf('=');
      if (equalsIndex <= 0) continue;
      const key = line.slice(0, equalsIndex).trim();
      const value = line.slice(equalsIndex + 1).trim();
      if (key) result[key] = value;
    }
  } catch {
    // Missing .env is handled by required-setting checks below.
  }
  return result;
}

function updateDotEnvPublicBaseUrl(projectDir, publicBaseUrl) {
  const envPath = path.join(projectDir, '.env');
  const normalizedBaseUrl = normalizeCandidateBaseUrl(publicBaseUrl);
  if (!normalizedBaseUrl) {
    return { updated: false, previousValue: null, nextValue: null };
  }

  let text = '';
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return { updated: false, previousValue: null, nextValue: null };
  }

  const previousMatch = text.match(/^TELEGRAM_PUBLIC_BASE_URL=(.*)$/m);
  const previousValue = previousMatch ? String(previousMatch[1] || '').trim() : null;

  let nextText = text;
  if (/^TELEGRAM_PUBLIC_BASE_URL=.*$/m.test(nextText)) {
    nextText = nextText.replace(
      /^TELEGRAM_PUBLIC_BASE_URL=.*$/m,
      `TELEGRAM_PUBLIC_BASE_URL=${normalizedBaseUrl}`
    );
  } else {
    const suffix = nextText.endsWith('\n') || nextText.length === 0 ? '' : '\n';
    nextText += `${suffix}TELEGRAM_PUBLIC_BASE_URL=${normalizedBaseUrl}\n`;
  }

  if (nextText !== text) {
    fs.writeFileSync(envPath, nextText, 'utf8');
    return { updated: true, previousValue, nextValue: normalizedBaseUrl };
  }

  return { updated: false, previousValue, nextValue: normalizedBaseUrl };
}

function extractHostFromUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || '').trim()).host || null;
  } catch {
    return null;
  }
}

function normalizeTelegramChatId(rawValue) {
  const normalized = String(rawValue || '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function resolveLaunchChatId(projectDir, preferredChatId = null) {
  const preferred = normalizeTelegramChatId(preferredChatId);
  if (preferred) {
    return {
      chatId: preferred,
      source: 'env',
    };
  }

  const dbPath = path.join(projectDir, 'database.sqlite');
  if (!fs.existsSync(dbPath)) {
    return {
      chatId: null,
      source: 'missing_db',
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
          LIMIT 100
        `
      )
      .all();
    for (const row of rows) {
      const candidate = normalizeTelegramChatId(row?.telegram_user_id);
      if (candidate) {
        return {
          chatId: candidate,
          source: 'database_latest_guest_profile',
        };
      }
    }
    return {
      chatId: null,
      source: 'database_no_numeric_chat_id',
    };
  } catch {
    return {
      chatId: null,
      source: 'database_query_failed',
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

function normalizeCandidateBaseUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;

  let parsed = null;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;

  let normalizedPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  const webhookPathSuffix = '/api/telegram/webhook';
  if (normalizedPath.toLowerCase().endsWith(webhookPathSuffix)) {
    normalizedPath = normalizedPath.slice(0, normalizedPath.length - webhookPathSuffix.length);
  }
  return `${parsed.origin}${normalizedPath === '/' ? '' : normalizedPath}`;
}

function readLogFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function extractQuickTunnelUrl(logText) {
  const matches = Array.from(
    String(logText || '').matchAll(/https:\/\/[-a-z0-9]+\.trycloudflare\.com\b/gi)
  );
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const normalized = normalizeCandidateBaseUrl(matches[index][0]);
    if (normalized) return normalized;
  }
  return null;
}

function commandExists(commandOrPath) {
  if (fs.existsSync(commandOrPath)) return true;
  const result = spawnSync('where.exe', [commandOrPath], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return result.status === 0;
}

function appendLogHeader(logPath, title) {
  fs.appendFileSync(logPath, `\r\n========== ${title} ${new Date().toISOString()} ==========\r\n`, 'utf8');
}

function spawnLoggedProcess(command, args, env, logPath) {
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    env,
  });
  launchedProcessPids.push(child.pid);
  child.unref();
  fs.closeSync(logFd);
  return child;
}

function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function listListeningPids(port) {
  const result = spawnSync('netstat.exe', ['-ano'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) return [];

  const pids = new Set();
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    if (!line.includes(`:${port}`) || !/\bLISTENING\b/i.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[parts.length - 1]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

function getProcessName(pid) {
  const result = spawnSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const firstLine = String(result.stdout || '').split(/\r?\n/).find(Boolean);
  const match = firstLine && firstLine.match(/^"([^"]+)"/);
  return match ? match[1] : '';
}

function releaseNodePort(port) {
  let blocked = false;
  for (const pid of listListeningPids(port)) {
    const name = getProcessName(pid);
    if (/^node\.exe$/i.test(name)) {
      console.log(`[PORT] Freeing stale node listener on ${port} (PID ${pid})...`);
      killProcessTree(pid);
    } else {
      blocked = true;
      console.warn(`[WARN] Port ${port} is busy by ${name || 'unknown process'} (PID ${pid}).`);
    }
  }
  return !blocked;
}

function stopOldQuickTunnels() {
  const command = [
    "$items = Get-CimInstance Win32_Process | Where-Object {",
    "$_.Name -eq 'cloudflared.exe' -and $_.CommandLine -like '*tunnel --url http://127.0.0.1:3001*'",
    '};',
    '$items | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };',
    '$items | ForEach-Object { Write-Output $_.ProcessId }',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const stopped = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (stopped.length > 0) {
    console.log(`[TUNNEL] Stopped old quick tunnel process(es): ${stopped.join(', ')}`);
  }
}

async function waitForJsonReady(url, label, maxAttempts, waitMs) {
  const timeoutMs = Math.max(waitMs - 250, 1000);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        console.log(`[READY] ${label}`);
        return true;
      }
    } catch {
      // Startup is intentionally polled.
    }

    if (attempt === 1 || attempt % 5 === 0 || attempt === maxAttempts) {
      console.log(`[WAIT] ${label} (${attempt}/${maxAttempts})...`);
    }
    await sleep(waitMs);
  }
  return false;
}

async function waitForHttpReady(url, label, maxAttempts, waitMs) {
  const timeoutMs = Math.max(waitMs - 250, 1000);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) {
        console.log(`[READY] ${label}`);
        return true;
      }
    } catch {
      // Startup is intentionally polled.
    }

    if (attempt === 1 || attempt % 5 === 0 || attempt === maxAttempts) {
      console.log(`[WAIT] ${label} (${attempt}/${maxAttempts})...`);
    }
    await sleep(waitMs);
  }
  return false;
}

async function discoverQuickTunnel({ cloudflaredExe, projectDir, logPath, waitSeconds, maxAttempts, retryDelaySeconds }) {
  let child = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    appendLogHeader(logPath, `Cloudflare quick tunnel attempt ${attempt}/${maxAttempts}`);
    console.log(`[TUNNEL] Starting Cloudflare quick tunnel (attempt ${attempt}/${maxAttempts})...`);
    child = spawnLoggedProcess(
      cloudflaredExe,
      ['tunnel', '--url', 'http://127.0.0.1:3001', '--edge-ip-version', '4', '--no-autoupdate'],
      { ...process.env, PROJECT_DIR: projectDir },
      logPath
    );

    for (let second = 1; second <= waitSeconds; second += 1) {
      const publicBaseUrl = extractQuickTunnelUrl(readLogFileSafe(logPath));
      if (publicBaseUrl) {
        console.log(`[TUNNEL] Fresh public URL: ${publicBaseUrl}`);
        return { publicBaseUrl, child };
      }
      if (child.exitCode !== null) break;
      if (second === 1 || second % 5 === 0 || second === waitSeconds) {
        console.log(`[WAIT] Cloudflare public URL (${second}/${waitSeconds})...`);
      }
      await sleep(1000);
    }

    killProcessTree(child.pid);
    child = null;
    if (attempt < maxAttempts) {
      await sleep(retryDelaySeconds * 1000);
    }
  }
  return { publicBaseUrl: null, child: null };
}

function runTelegramLaunchHelper({ projectDir, publicBaseUrl, env, launchChatId }) {
  const helperArgs = [
    'scripts/telegram-launch-helper.mjs',
    `--base-url=${publicBaseUrl}`,
    '--apply',
    '--check',
    '--sync-known-chat-menu-buttons',
    '--send-fresh-launch-message',
  ];
  if (launchChatId) {
    helperArgs.push(`--launch-chat-id=${launchChatId}`);
  }
  const result = spawnSync(
    process.execPath,
    helperArgs,
    {
      cwd: projectDir,
      stdio: 'inherit',
      env,
    }
  );
  return result.status === 0;
}

async function runTelegramLaunchHelperWithRetry({ projectDir, publicBaseUrl, env }) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[TELEGRAM] Refreshing webhook/menu (attempt ${attempt}/${maxAttempts})...`);
    if (runTelegramLaunchHelper({ projectDir, publicBaseUrl, env, launchChatId: env.MINI_APP_TEST_USER_ID })) {
      return true;
    }
    if (attempt < maxAttempts) {
      await sleep(4000);
    }
  }
  return false;
}

async function buildLaunchUrls(projectDir, env) {
  const runtimeConfigModuleUrl = pathToFileURL(
    path.join(projectDir, 'server', 'telegram', 'runtime-config.mjs')
  ).href;
  const {
    buildTelegramRuntimeHealthSummary,
    resolveTelegramRuntimeConfig,
  } = await import(runtimeConfigModuleUrl);
  const runtimeConfig = resolveTelegramRuntimeConfig({ env });
  const healthSummary = buildTelegramRuntimeHealthSummary(runtimeConfig);
  return healthSummary.launch_urls || {};
}

async function main() {
  const projectDir = readEnv('PROJECT_DIR') || path.resolve(__dirname, '..');
  const cloudflaredExe = readEnv('CLOUDFLARED_EXE', 'cloudflared');
  const waitSeconds = Number(readEnv('CLOUDFLARED_WAIT_SECONDS', '60')) || 60;
  const maxAttempts = Number(readEnv('CLOUDFLARED_MAX_DISCOVERY_ATTEMPTS', '3')) || 3;
  const retryDelaySeconds = Number(readEnv('CLOUDFLARED_RETRY_DELAY_SECONDS', '5')) || 5;
  const logsDir = path.join(projectDir, 'logs', 'unified-launcher');
  const tunnelLogPath = path.join(logsDir, 'cloudflared.log');
  const devLogPath = path.join(logsDir, 'dev-runtime.log');

  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(tunnelLogPath, '', 'utf8');
  fs.writeFileSync(devLogPath, '', 'utf8');

  console.log('[START] Boat Ticket App unified launcher');
  console.log(`[LOGS] ${logsDir}`);

  if (!fs.existsSync(path.join(projectDir, 'package.json'))) {
    throw new Error(`[ERROR] Project directory is invalid: ${projectDir}`);
  }
  if (!commandExists(cloudflaredExe)) {
    throw new Error('[ERROR] cloudflared was not found. Install it once: winget install --id Cloudflare.cloudflared');
  }

  const dotEnv = readDotEnv(projectDir);
  const telegramBotToken = readEnv('TELEGRAM_BOT_TOKEN', dotEnv.TELEGRAM_BOT_TOKEN || '');
  const telegramWebhookSecret = readEnv(
    'TELEGRAM_WEBHOOK_SECRET_TOKEN',
    dotEnv.TELEGRAM_WEBHOOK_SECRET_TOKEN || ''
  );
  if (!telegramBotToken || !telegramWebhookSecret) {
    throw new Error('[ERROR] TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET_TOKEN are required in .env or environment.');
  }

  console.log('[CHECK] Releasing old dev listeners and quick tunnels where possible...');
  const portsOk = [3001, 5173].map(releaseNodePort).every(Boolean);
  if (!portsOk) {
    throw new Error('[ERROR] Required port is busy by a non-node process. Stop it and run start-all.bat again.');
  }
  stopOldQuickTunnels();

  const tunnel = await discoverQuickTunnel({
    cloudflaredExe,
    projectDir,
    logPath: tunnelLogPath,
    waitSeconds,
    maxAttempts,
    retryDelaySeconds,
  });
  if (!tunnel.publicBaseUrl) {
    throw new Error(`[ERROR] Could not discover a fresh Cloudflare quick tunnel URL. Inspect ${tunnelLogPath}`);
  }

  const publicBaseUrl = tunnel.publicBaseUrl;
  const envSyncSummary = updateDotEnvPublicBaseUrl(projectDir, publicBaseUrl);
  if (envSyncSummary.updated) {
    console.log(`[CONFIG] Updated .env TELEGRAM_PUBLIC_BASE_URL to ${envSyncSummary.nextValue}`);
  }
  const previousHost = extractHostFromUrl(envSyncSummary.previousValue);
  const freshHost = extractHostFromUrl(publicBaseUrl);
  if (
    previousHost &&
    freshHost &&
    previousHost !== freshHost &&
    previousHost.endsWith('.trycloudflare.com')
  ) {
    console.warn(
      `[WARN] Previous .env trycloudflare host was stale: ${previousHost}. Replaced with fresh host: ${freshHost}`
    );
  }

  const runtimeEnv = {
    ...process.env,
    PROJECT_DIR: projectDir,
    TELEGRAM_BOT_TOKEN: telegramBotToken,
    TELEGRAM_WEBHOOK_SECRET_TOKEN: telegramWebhookSecret,
    TELEGRAM_PUBLIC_BASE_URL: publicBaseUrl,
  };
  const launchChatIdResolution = resolveLaunchChatId(
    projectDir,
    readEnv('MINI_APP_TEST_USER_ID')
  );
  if (launchChatIdResolution.chatId) {
    runtimeEnv.MINI_APP_TEST_USER_ID = launchChatIdResolution.chatId;
    console.log(
      `[TELEGRAM] Fresh launch message target chat id: ${launchChatIdResolution.chatId} (${launchChatIdResolution.source})`
    );
  } else {
    console.log(
      `[TELEGRAM] Fresh launch message chat id was not resolved (${launchChatIdResolution.source}).`
    );
  }

  const launchUrls = await buildLaunchUrls(projectDir, runtimeEnv);
  const miniAppUrl = launchUrls.mini_app_launch_url || `${publicBaseUrl}/telegram/mini-app`;
  const webhookUrl = launchUrls.webhook_public_url || `${publicBaseUrl}/api/telegram/webhook`;

  appendLogHeader(devLogPath, 'npm run dev');
  console.log('[DEV] Starting backend and frontend dev servers...');
  spawnLoggedProcess('cmd.exe', ['/d', '/c', 'npm.cmd', 'run', 'dev'], runtimeEnv, devLogPath);

  const backendReady = await waitForJsonReady(
    'http://127.0.0.1:3001/api/telegram/health',
    'backend /api/telegram/health',
    90,
    2000
  );
  if (!backendReady) {
    throw new Error(`[ERROR] Backend did not become ready. Inspect ${devLogPath}`);
  }

  const frontendReady = await waitForHttpReady(
    'http://localhost:5173/',
    'frontend dev server',
    60,
    2000
  );
  if (!frontendReady) {
    throw new Error(`[ERROR] Frontend did not become ready. Inspect ${devLogPath}`);
  }

  const publicReady = await waitForJsonReady(
    `${publicBaseUrl}/api/telegram/health`,
    'public tunnel backend health',
    90,
    2000
  );
  if (!publicReady) {
    throw new Error(`[ERROR] Public tunnel health check failed. Inspect ${tunnelLogPath}`);
  }

  console.log('[TELEGRAM] Registering webhook and menu button with the fresh Mini App URL...');
  if (!(await runTelegramLaunchHelperWithRetry({ projectDir, publicBaseUrl, env: runtimeEnv }))) {
    throw new Error('[ERROR] Telegram webhook/menu registration failed.');
  }

  console.log('');
  console.log('[READY] Unified startup complete.');
  console.log(`[READY] Public base URL: ${publicBaseUrl}`);
  console.log(`[READY] Mini App URL: ${miniAppUrl}`);
  console.log(`[READY] Webhook URL: ${webhookUrl}`);
  console.log('');
  console.log('[INFO] Backend, frontend, Cloudflare tunnel, webhook, and menu button now use the same fresh URL.');
  console.log(`[INFO] Logs: ${logsDir}`);
  preserveLaunchedProcesses = true;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  if (!preserveLaunchedProcesses) {
    for (const pid of launchedProcessPids.reverse()) {
      killProcessTree(pid);
    }
  }
  process.exitCode = 1;
});
