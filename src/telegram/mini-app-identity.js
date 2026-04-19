const INIT_DATA_QUERY_KEYS = Object.freeze([
  'tgWebAppData',
  'tg_web_app_data',
  'tg_webapp_data',
  'telegram_init_data',
  'telegramInitData',
]);

const USER_ID_QUERY_KEYS = Object.freeze([
  'telegram_user_id',
  'tg_user_id',
  'tgWebAppUserId',
  'tg_web_app_user_id',
]);

const INIT_DATA_SESSION_STORAGE_KEY = 'telegram_mini_app_init_data';
const USER_ID_SESSION_STORAGE_KEY = 'telegram_mini_app_user_id';
const MINI_APP_BASE_PATH = '/telegram/mini-app';
const MINI_APP_LAUNCH_HINT_KEYS = Object.freeze([
  ...INIT_DATA_QUERY_KEYS,
  ...USER_ID_QUERY_KEYS,
  'tgWebAppVersion',
  'tgWebAppPlatform',
  'tgWebAppStartParam',
  'tgWebAppThemeParams',
  'startapp',
  'startApp',
]);

export function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function readWindowQueryParam(key) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const searchParams = new URLSearchParams(window.location?.search || '');
    return normalizeString(searchParams.get(key));
  } catch {
    return null;
  }
}

function parseHashParams() {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawHash = normalizeString(window.location?.hash || '');
  if (!rawHash) {
    return null;
  }

  let hashValue = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  if (!hashValue) {
    return null;
  }

  if (hashValue.startsWith('/')) {
    const queryIndex = hashValue.indexOf('?');
    hashValue = queryIndex >= 0 ? hashValue.slice(queryIndex + 1) : '';
  }
  if (!hashValue) {
    return null;
  }
  if (hashValue.startsWith('?')) {
    hashValue = hashValue.slice(1);
  }
  if (!hashValue) {
    return null;
  }

  try {
    return new URLSearchParams(hashValue);
  } catch {
    return null;
  }
}

function readWindowHashParam(key) {
  const hashParams = parseHashParams();
  if (!hashParams) {
    return null;
  }
  return normalizeString(hashParams.get(key));
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function readNestedInitDataFromQueryString(rawValue) {
  try {
    const searchParams = new URLSearchParams(rawValue);
    return normalizeString(
      searchParams.get('tgWebAppData') ||
        searchParams.get('tg_web_app_data') ||
        searchParams.get('tg_webapp_data') ||
        searchParams.get('telegram_init_data') ||
        searchParams.get('telegramInitData')
    );
  } catch {
    return null;
  }
}

function collectInitDataCandidates(rawInitData) {
  const queue = [normalizeString(rawInitData)];
  const seen = new Set();
  const candidates = [];

  while (queue.length > 0) {
    const current = normalizeString(queue.shift());
    if (!current || seen.has(current)) {
      continue;
    }

    seen.add(current);
    candidates.push(current);

    const nestedInitData = readNestedInitDataFromQueryString(current);
    if (nestedInitData && !seen.has(nestedInitData)) {
      queue.push(nestedInitData);
    }

    const decoded = decodeURIComponentSafe(current);
    if (decoded && !seen.has(decoded)) {
      queue.push(decoded);
    }
  }

  return candidates;
}

export function readTelegramUserIdFromInitDataRaw(rawInitData) {
  const candidates = collectInitDataCandidates(rawInitData);

  for (const candidate of candidates) {
    try {
      const searchParams = new URLSearchParams(candidate);
      const rawUser = normalizeString(searchParams.get('user'));
      if (!rawUser) {
        continue;
      }

      const parsedUser = JSON.parse(rawUser);
      const telegramUserId = normalizeString(parsedUser?.id);
      if (telegramUserId) {
        return telegramUserId;
      }
    } catch {
      // Ignore malformed init-data payloads and keep probing candidates.
    }
  }

  return null;
}

function resolveCanonicalInitData(rawInitData) {
  const candidates = collectInitDataCandidates(rawInitData);

  for (const candidate of candidates) {
    if (readTelegramUserIdFromInitDataRaw(candidate)) {
      return candidate;
    }
  }

  return candidates[0] || null;
}

function readSessionStorageValue(key) {
  if (typeof window === 'undefined') {
    return null;
  }
  let storage = null;
  try {
    storage = window.sessionStorage;
  } catch {
    return null;
  }
  if (!storage) {
    return null;
  }
  try {
    return normalizeString(storage.getItem(key));
  } catch {
    return null;
  }
}

function writeSessionStorageValue(key, value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }
  let storage = null;
  try {
    storage = window.sessionStorage;
  } catch {
    return;
  }
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, normalized);
  } catch {
    // Ignore storage failures in constrained environments.
  }
}

function readInitDataFromQuery() {
  for (const key of INIT_DATA_QUERY_KEYS) {
    const value = readWindowQueryParam(key) || readWindowHashParam(key);
    if (!value) {
      continue;
    }

    const canonical = resolveCanonicalInitData(value);
    if (canonical) {
      return canonical;
    }
  }
  return null;
}

function readUserIdFromQuery() {
  for (const key of USER_ID_QUERY_KEYS) {
    const value = readWindowQueryParam(key) || readWindowHashParam(key);
    if (value) {
      return value;
    }
  }
  return null;
}

function readUserIdFromRuntimeUnsafe() {
  if (typeof window === 'undefined') {
    return null;
  }
  return normalizeString(window?.Telegram?.WebApp?.initDataUnsafe?.user?.id);
}

function readWindowPathname() {
  if (typeof window === 'undefined') {
    return null;
  }
  return normalizeString(window.location?.pathname);
}

function readWindowSearchRaw() {
  if (typeof window === 'undefined') {
    return '';
  }
  const rawSearch = window.location?.search;
  return typeof rawSearch === 'string' ? rawSearch : '';
}

function readWindowHashRaw() {
  if (typeof window === 'undefined') {
    return '';
  }
  const rawHash = window.location?.hash;
  return typeof rawHash === 'string' ? rawHash : '';
}

function parseMiniAppHashPathCandidate(rawHash) {
  const normalizedHash = normalizeString(rawHash);
  if (!normalizedHash) {
    return null;
  }
  const hashWithoutPrefix = normalizedHash.startsWith('#')
    ? normalizedHash.slice(1)
    : normalizedHash;
  if (!hashWithoutPrefix.startsWith(`${MINI_APP_BASE_PATH}/`) &&
      hashWithoutPrefix !== MINI_APP_BASE_PATH) {
    return null;
  }

  const queryIndex = hashWithoutPrefix.indexOf('?');
  const hashPath = queryIndex >= 0
    ? hashWithoutPrefix.slice(0, queryIndex)
    : hashWithoutPrefix;
  const hashQuery = queryIndex >= 0
    ? hashWithoutPrefix.slice(queryIndex + 1)
    : '';

  return {
    path: normalizeString(hashPath) || MINI_APP_BASE_PATH,
    hashQuery: normalizeString(hashQuery),
  };
}

export function hasTelegramMiniAppLaunchHint() {
  if (typeof window === 'undefined') {
    return false;
  }

  const pathname = readWindowPathname();
  if (pathname?.startsWith(MINI_APP_BASE_PATH)) {
    return true;
  }

  const runtimeInitData = normalizeString(window?.Telegram?.WebApp?.initData);
  const runtimeUserId = readUserIdFromRuntimeUnsafe();
  if (runtimeInitData || runtimeUserId) {
    return true;
  }

  for (const key of MINI_APP_LAUNCH_HINT_KEYS) {
    if (readWindowQueryParam(key) || readWindowHashParam(key)) {
      return true;
    }
  }

  const hashPathCandidate = parseMiniAppHashPathCandidate(readWindowHashRaw());
  return Boolean(hashPathCandidate);
}

export function resolveTelegramMiniAppLaunchTarget() {
  const search = readWindowSearchRaw();
  const rawHash = readWindowHashRaw();
  const hashPathCandidate = parseMiniAppHashPathCandidate(rawHash);
  const targetPath = hashPathCandidate?.path || MINI_APP_BASE_PATH;

  if (!hashPathCandidate) {
    return `${targetPath}${search}${rawHash}`;
  }

  const hashSuffix = hashPathCandidate.hashQuery
    ? `#${hashPathCandidate.hashQuery}`
    : '';
  return `${targetPath}${search}${hashSuffix}`;
}

export function readTelegramMiniAppInitDataRaw() {
  if (typeof window === 'undefined') {
    return null;
  }

  const runtimeInitData = normalizeString(window?.Telegram?.WebApp?.initData);
  if (runtimeInitData) {
    writeSessionStorageValue(INIT_DATA_SESSION_STORAGE_KEY, runtimeInitData);
    return runtimeInitData;
  }

  const queryInitData = readInitDataFromQuery();
  if (queryInitData) {
    writeSessionStorageValue(INIT_DATA_SESSION_STORAGE_KEY, queryInitData);
    return queryInitData;
  }

  return readSessionStorageValue(INIT_DATA_SESSION_STORAGE_KEY);
}

export function readTelegramMiniAppUserId() {
  const runtimeUserId = readUserIdFromRuntimeUnsafe();
  if (runtimeUserId) {
    writeSessionStorageValue(USER_ID_SESSION_STORAGE_KEY, runtimeUserId);
    return runtimeUserId;
  }

  const initDataUserId = readTelegramUserIdFromInitDataRaw(readTelegramMiniAppInitDataRaw());
  if (initDataUserId) {
    writeSessionStorageValue(USER_ID_SESSION_STORAGE_KEY, initDataUserId);
    return initDataUserId;
  }

  const queryUserId = readUserIdFromQuery();
  if (queryUserId) {
    writeSessionStorageValue(USER_ID_SESSION_STORAGE_KEY, queryUserId);
    return queryUserId;
  }

  return readSessionStorageValue(USER_ID_SESSION_STORAGE_KEY);
}
