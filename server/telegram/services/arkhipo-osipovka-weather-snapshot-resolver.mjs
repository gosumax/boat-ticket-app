const ARKHIPO_OSIPOVKA_LOCATION = Object.freeze({
  country: 'Российская Федерация',
  region: 'Краснодарский край',
  locality: 'Архипо-Осиповка',
  waterBody: 'Чёрное море',
  timezone: 'Europe/Moscow',
  utcOffset: '+03:00',
  latitude: 44.3717,
  longitude: 38.5318,
});

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 4500;

const WMO_WEATHER_CODE_LABELS = Object.freeze({
  0: 'Ясно',
  1: 'Преимущественно ясно',
  2: 'Переменная облачность',
  3: 'Пасмурно',
  45: 'Туман',
  48: 'Туман с изморозью',
  51: 'Лёгкая морось',
  53: 'Морось',
  55: 'Сильная морось',
  56: 'Лёгкая ледяная морось',
  57: 'Сильная ледяная морось',
  61: 'Небольшой дождь',
  63: 'Дождь',
  65: 'Сильный дождь',
  66: 'Лёгкий ледяной дождь',
  67: 'Сильный ледяной дождь',
  71: 'Небольшой снег',
  73: 'Снег',
  75: 'Сильный снег',
  77: 'Снежная крупа',
  80: 'Ливневый дождь',
  81: 'Ливень',
  82: 'Сильный ливень',
  85: 'Небольшой снегопад',
  86: 'Сильный снегопад',
  95: 'Гроза',
  96: 'Гроза с градом',
  99: 'Сильная гроза с градом',
});

function normalizeNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeInteger(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) ? normalized : null;
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function resolveIsoWithOffset(rawTimestamp, utcOffset) {
  const timestamp = normalizeString(rawTimestamp);
  if (!timestamp) {
    return null;
  }

  const hasOffset = /([zZ]|[+\-]\d{2}:\d{2})$/.test(timestamp);
  const resolved = hasOffset ? timestamp : `${timestamp}${utcOffset}`;
  const parsed = Date.parse(resolved);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function buildForecastUrl(location) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    timezone: location.timezone,
    current: 'temperature_2m,weather_code,wind_speed_10m,precipitation_probability',
    daily: 'sunset',
    wind_speed_unit: 'ms',
  });
  return `${OPEN_METEO_FORECAST_URL}?${params.toString()}`;
}

function buildMarineUrl(location) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    timezone: location.timezone,
    current: 'sea_surface_temperature',
  });
  return `${OPEN_METEO_MARINE_URL}?${params.toString()}`;
}

async function fetchJsonWithTimeout(fetchImpl, url, timeoutMs) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveConditionLabel(weatherCode, fallbackLabel = null) {
  if (Number.isInteger(weatherCode) && WMO_WEATHER_CODE_LABELS[weatherCode]) {
    return WMO_WEATHER_CODE_LABELS[weatherCode];
  }
  return normalizeString(fallbackLabel);
}

function buildSnapshotFromOpenMeteoPayload({
  location,
  forecastPayload,
  marinePayload,
}) {
  const forecastCurrent = forecastPayload?.current || {};
  const marineCurrent = marinePayload?.current || {};
  const dailySunset = Array.isArray(forecastPayload?.daily?.sunset)
    ? forecastPayload.daily.sunset[0]
    : null;

  const weatherCode = normalizeInteger(forecastCurrent.weather_code);
  const conditionLabel = resolveConditionLabel(weatherCode, forecastCurrent.weather_description);
  const observedAt =
    resolveIsoWithOffset(forecastCurrent.time, location.utcOffset) ||
    resolveIsoWithOffset(marineCurrent.time, location.utcOffset);
  const sunsetIso = resolveIsoWithOffset(dailySunset, location.utcOffset);

  return Object.freeze({
    observed_at: observedAt,
    condition_code: weatherCode === null ? null : String(weatherCode),
    condition_label: conditionLabel,
    temperature_c: normalizeNumber(forecastCurrent.temperature_2m),
    wind_speed_mps: normalizeNumber(forecastCurrent.wind_speed_10m),
    precipitation_probability: normalizeNumber(
      forecastCurrent.precipitation_probability
    ),
    water_temperature_c: normalizeNumber(marineCurrent.sea_surface_temperature),
    sunset_time_iso: sunsetIso,
    sunset_time_local: normalizeString(dailySunset),
    location_country: location.country,
    location_region: location.region,
    location_locality: location.locality,
    location_water_body: location.waterBody,
    data_provider: 'open-meteo',
  });
}

export function createArkhipoOsipovkaWeatherSnapshotResolver(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const logger = options.logger || console;
  const cacheTtlMs = Number(options.cacheTtlMs) || DEFAULT_CACHE_TTL_MS;
  const timeoutMs = Number(options.requestTimeoutMs) || DEFAULT_TIMEOUT_MS;
  const location = Object.freeze({
    ...ARKHIPO_OSIPOVKA_LOCATION,
    ...(options.location || {}),
  });

  if (typeof fetchImpl !== 'function') {
    return () => null;
  }

  const cacheState = {
    snapshot: null,
    refreshedAtMs: 0,
    refreshPromise: null,
  };

  async function refreshSnapshot() {
    const [forecastPayload, marinePayload] = await Promise.all([
      fetchJsonWithTimeout(fetchImpl, buildForecastUrl(location), timeoutMs),
      fetchJsonWithTimeout(fetchImpl, buildMarineUrl(location), timeoutMs),
    ]);
    cacheState.snapshot = buildSnapshotFromOpenMeteoPayload({
      location,
      forecastPayload,
      marinePayload,
    });
    cacheState.refreshedAtMs = Number(now());
  }

  function isCacheStale() {
    if (!cacheState.snapshot || !cacheState.refreshedAtMs) {
      return true;
    }
    return Number(now()) - cacheState.refreshedAtMs >= cacheTtlMs;
  }

  function triggerRefreshIfNeeded() {
    if (!isCacheStale() || cacheState.refreshPromise) {
      return;
    }
    cacheState.refreshPromise = refreshSnapshot()
      .catch((error) => {
        if (logger && typeof logger.warn === 'function') {
          logger.warn(
            '[TELEGRAM_WEATHER_RESOLVER] failed to refresh Arkhipo-Osipovka snapshot:',
            error?.message || error
          );
        }
      })
      .finally(() => {
        cacheState.refreshPromise = null;
      });
  }

  triggerRefreshIfNeeded();

  return function resolveWeatherSnapshot() {
    triggerRefreshIfNeeded();
    return cacheState.snapshot;
  };
}

