import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TELEGRAM_MINI_APP_CACHE_BUSTER_ENV_KEY =
  'TELEGRAM_MINI_APP_CACHE_BUSTER';
export const TELEGRAM_MINI_APP_CACHE_BUSTER_QUERY_KEY = 'mini_app_v';

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function resolveTelegramMiniAppDistDirectory(distDirectory = null) {
  const explicitPath = normalizeString(distDirectory);
  if (explicitPath) {
    return resolve(explicitPath);
  }
  return resolve(__dirname, '..', '..', 'dist');
}

function resolveMiniAppCacheBusterFromDist(distDirectory) {
  const dedicatedMiniAppIndexFilePath = join(distDirectory, 'telegram-mini-app.html');
  const fallbackIndexFilePath = join(distDirectory, 'index.html');
  const indexFilePath = existsSync(dedicatedMiniAppIndexFilePath)
    ? dedicatedMiniAppIndexFilePath
    : fallbackIndexFilePath;
  if (!existsSync(indexFilePath)) {
    return null;
  }

  try {
    const indexHtml = readFileSync(indexFilePath, 'utf8');
    return createHash('sha1').update(indexHtml).digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}

export function resolveTelegramMiniAppCacheBuster({
  env = process.env,
  distDirectory = null,
} = {}) {
  const cacheBusterFromEnv = normalizeString(
    env?.[TELEGRAM_MINI_APP_CACHE_BUSTER_ENV_KEY]
  );
  if (cacheBusterFromEnv) {
    return cacheBusterFromEnv;
  }

  const resolvedDistDirectory = resolveTelegramMiniAppDistDirectory(distDirectory);
  return resolveMiniAppCacheBusterFromDist(resolvedDistDirectory);
}
