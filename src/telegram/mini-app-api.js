import {
  normalizeString,
  readTelegramMiniAppInitDataRaw,
  readTelegramMiniAppUserId,
} from './mini-app-identity.js';

const MINI_APP_API_DIAGNOSTIC_KEYS = Object.freeze({
  catalog: 'catalog',
  myRequests: 'myRequests',
});
const MINI_APP_API_DEBUG_QUERY_KEYS = Object.freeze([
  'mini_app_debug',
  'miniAppDebug',
  'tg_mini_app_debug',
]);
const miniAppApiDiagnosticsState = {
  [MINI_APP_API_DIAGNOSTIC_KEYS.catalog]: null,
  [MINI_APP_API_DIAGNOSTIC_KEYS.myRequests]: null,
};
const miniAppApiDiagnosticsListeners = new Set();

function buildQueryString(query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    params.set(key, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

function resolveMiniAppRequestUrl(path) {
  const relativePath = `/api/telegram${path}`;
  if (typeof window === 'undefined') {
    return relativePath;
  }
  try {
    return new URL(relativePath, window.location.origin).toString();
  } catch {
    return relativePath;
  }
}

function isPublicNgrokMiniAppRequestUrl(requestUrl) {
  const normalizedUrl = normalizeString(requestUrl);
  if (!normalizedUrl) {
    return false;
  }

  try {
    const parsedUrl =
      typeof window === 'undefined'
        ? new URL(normalizedUrl, 'http://localhost')
        : new URL(normalizedUrl, window.location?.origin || undefined);
    const hostname = normalizeString(parsedUrl.hostname)?.toLowerCase();
    if (!hostname) {
      return false;
    }
    return (
      hostname.endsWith('.ngrok-free.app') ||
      hostname.endsWith('.ngrok.app') ||
      hostname.endsWith('.ngrok-free.dev') ||
      hostname.endsWith('.ngrok.dev')
    );
  } catch {
    return false;
  }
}

function cloneMiniAppApiDiagnostic(diagnostic) {
  return diagnostic && typeof diagnostic === 'object' ? { ...diagnostic } : null;
}

export function readMiniAppApiDiagnosticsSnapshot() {
  return {
    [MINI_APP_API_DIAGNOSTIC_KEYS.catalog]: cloneMiniAppApiDiagnostic(
      miniAppApiDiagnosticsState[MINI_APP_API_DIAGNOSTIC_KEYS.catalog]
    ),
    [MINI_APP_API_DIAGNOSTIC_KEYS.myRequests]: cloneMiniAppApiDiagnostic(
      miniAppApiDiagnosticsState[MINI_APP_API_DIAGNOSTIC_KEYS.myRequests]
    ),
  };
}

function emitMiniAppApiDiagnostics() {
  const snapshot = readMiniAppApiDiagnosticsSnapshot();
  miniAppApiDiagnosticsListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // Ignore diagnostics listener failures so buyer API reads stay resilient.
    }
  });
}

function updateMiniAppApiDiagnostic(diagnosticKey, diagnostic) {
  if (!diagnosticKey) {
    return;
  }
  miniAppApiDiagnosticsState[diagnosticKey] = cloneMiniAppApiDiagnostic(diagnostic);
  emitMiniAppApiDiagnostics();
}

export function subscribeMiniAppApiDiagnostics(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  miniAppApiDiagnosticsListeners.add(listener);
  listener(readMiniAppApiDiagnosticsSnapshot());
  return () => {
    miniAppApiDiagnosticsListeners.delete(listener);
  };
}

export function resetMiniAppApiDiagnostics() {
  Object.keys(miniAppApiDiagnosticsState).forEach((key) => {
    miniAppApiDiagnosticsState[key] = null;
  });
  emitMiniAppApiDiagnostics();
}

function readWindowQueryFlag(keys) {
  if (typeof window === 'undefined') {
    return false;
  }

  let searchParams = null;
  try {
    searchParams = new URLSearchParams(window.location?.search || '');
  } catch {
    return false;
  }

  return keys.some((key) => {
    const rawValue = normalizeString(searchParams.get(key));
    if (!rawValue) {
      return false;
    }
    return ['1', 'true', 'yes', 'on'].includes(rawValue.toLowerCase());
  });
}

export function isMiniAppApiDiagnosticsEnabled() {
  return readWindowQueryFlag(MINI_APP_API_DEBUG_QUERY_KEYS);
}

function createMiniAppApiDiagnostic({
  diagnosticKey = null,
  requestUrl,
  method,
  headers,
  cacheMode,
  credentialsMode,
}) {
  const startedAtIso = new Date().toISOString();
  return {
    diagnosticKey,
    requestUrl,
    method,
    fetchStarted: true,
    responseArrived: false,
    status: null,
    contentType: null,
    jsonParseSucceeded: null,
    jsonParseErrorMessage: null,
    fetchErrorName: null,
    fetchErrorMessage: null,
    routeStatus: null,
    rejectionReason: null,
    responsePreview: null,
    requestAcceptHeader: normalizeString(headers.accept),
    requestContentTypeHeader: normalizeString(headers['content-type']),
    requestDebugHeader: normalizeString(headers['x-telegram-mini-app-debug']),
    requestNgrokSkipBrowserWarningHeader: normalizeString(
      headers['ngrok-skip-browser-warning']
    ),
    initDataHeaderAttached: Boolean(headers['x-telegram-webapp-init-data']),
    cacheMode: normalizeString(cacheMode),
    credentialsMode: normalizeString(credentialsMode),
    startedAtIso,
    completedAtIso: null,
  };
}

function finalizeMiniAppApiDiagnostic(diagnostic, patch = {}) {
  return {
    ...diagnostic,
    ...patch,
    completedAtIso: patch.completedAtIso || new Date().toISOString(),
  };
}

async function requestTelegramMiniApp(
  path,
  { method = 'GET', body, diagnosticKey = null } = {}
) {
  const normalizedMethod = normalizeString(method)?.toUpperCase() || 'GET';
  const requestUrl = resolveMiniAppRequestUrl(path);
  const headers = {
    accept: 'application/json',
  };
  if (isPublicNgrokMiniAppRequestUrl(requestUrl)) {
    headers['ngrok-skip-browser-warning'] = '1';
  }
  const runtimeInitData = readTelegramMiniAppInitDataRaw();
  if (runtimeInitData) {
    headers['x-telegram-webapp-init-data'] = runtimeInitData;
  }
  if (isMiniAppApiDiagnosticsEnabled()) {
    headers['x-telegram-mini-app-debug'] = '1';
  }
  if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
    headers['content-type'] = 'application/json';
  }

  const fetchOptions = {
    method: normalizedMethod,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    credentials: 'same-origin',
  };
  let diagnostic = createMiniAppApiDiagnostic({
    diagnosticKey,
    requestUrl,
    method: normalizedMethod,
    headers,
    cacheMode: fetchOptions.cache,
    credentialsMode: fetchOptions.credentials,
  });
  updateMiniAppApiDiagnostic(diagnosticKey, diagnostic);

  let response = null;
  try {
    response = await fetch(requestUrl, fetchOptions);
  } catch (error) {
    diagnostic = finalizeMiniAppApiDiagnostic(diagnostic, {
      fetchErrorName: normalizeString(error?.name),
      fetchErrorMessage:
        normalizeString(error?.message) || normalizeString(String(error)),
      jsonParseSucceeded: false,
    });
    updateMiniAppApiDiagnostic(diagnosticKey, diagnostic);
    throw error;
  }

  let payload = null;
  let responseText = '';
  let jsonParseSucceeded = false;
  let jsonParseErrorMessage = null;
  const contentType = normalizeString(response.headers?.get('content-type'));
  try {
    responseText = await response.text();
    if (normalizeString(responseText)) {
      payload = JSON.parse(responseText);
      jsonParseSucceeded = true;
    }
  } catch (error) {
    payload = null;
    jsonParseSucceeded = false;
    jsonParseErrorMessage =
      normalizeString(error?.message) || normalizeString(String(error));
  }
  diagnostic = finalizeMiniAppApiDiagnostic(diagnostic, {
    responseArrived: true,
    status: response.status,
    contentType,
    jsonParseSucceeded,
    jsonParseErrorMessage,
    routeStatus: normalizeString(payload?.route_status),
    rejectionReason:
      normalizeString(payload?.rejection_reason) || normalizeString(payload?.message),
    responsePreview: normalizeString(String(responseText || '').slice(0, 280)),
  });
  updateMiniAppApiDiagnostic(diagnosticKey, diagnostic);

  return {
    response,
    payload,
    diagnostic,
  };
}

function resolveTelegramUserIdForRequest(telegramUserId) {
  return normalizeString(telegramUserId) || readTelegramMiniAppUserId();
}

function buildMiniAppResponseFailureMessage(
  response,
  payload,
  fallbackMessage,
  diagnostic = null
) {
  const backendMessage =
    normalizeString(payload?.rejection_reason) || normalizeString(payload?.message);
  if (backendMessage) {
    return backendMessage;
  }

  const status =
    Number.isInteger(Number(response?.status)) && Number(response?.status) > 0
      ? Number(response.status)
      : null;
  const contentType = normalizeString(diagnostic?.contentType);
  if (diagnostic?.responseArrived && diagnostic?.jsonParseSucceeded === false) {
    if (contentType && !contentType.toLowerCase().includes('application/json')) {
      return `${fallbackMessage} (received non-JSON response: ${contentType}${
        status ? `, status ${status}` : ''
      })`;
    }

    return `${fallbackMessage} (response parse failed${
      status ? `, status ${status}` : ''
    }${contentType ? `, content-type ${contentType}` : ''})`;
  }

  return fallbackMessage;
}

function readOperationResultOrThrow(response, payload, fallbackMessage, diagnostic = null) {
  const operationResult = payload?.operation_result_summary || null;
  if (operationResult) {
    return operationResult;
  }
  const message = buildMiniAppResponseFailureMessage(
    response,
    payload,
    fallbackMessage,
    diagnostic
  );
  if (!response.ok) {
    throw new Error(message || 'Запрос Telegram Mini App завершился ошибкой');
  }
  throw new Error(message || 'Ответ Telegram Mini App не содержит operation_result_summary');
}

export async function fetchMiniAppCatalog({
  telegramUserId,
  date = null,
  tripType = null,
  onlyActiveBookable = false,
}) {
  const query = buildQueryString({
    telegram_user_id: resolveTelegramUserIdForRequest(telegramUserId),
    date,
    trip_type: tripType,
    only_active_bookable: onlyActiveBookable ? 'true' : 'false',
  });
  const { response, payload, diagnostic } = await requestTelegramMiniApp(
    `/mini-app/catalog${query}`,
    {
      diagnosticKey: MINI_APP_API_DIAGNOSTIC_KEYS.catalog,
    }
  );
  return readOperationResultOrThrow(
    response,
    payload,
    'Не удалось загрузить каталог рейсов',
    diagnostic
  );
}

export async function fetchMiniAppTripCard({
  slotUid,
  requestedTripDate = null,
  requestedTimeSlot = null,
}) {
  const query = buildQueryString({
    slot_uid: slotUid,
    requested_trip_date: requestedTripDate,
    requested_time_slot: requestedTimeSlot,
  });
  const { response, payload, diagnostic } = await requestTelegramMiniApp(
    `/mini-app/trip-card${query}`
  );
  return readOperationResultOrThrow(
    response,
    payload,
    'Не удалось загрузить карточку рейса',
    diagnostic
  );
}

export async function submitMiniAppBookingRequest(payload) {
  const normalizedPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload }
      : payload;
  if (normalizedPayload && typeof normalizedPayload === 'object') {
    const explicitTelegramUserId =
      normalizedPayload.telegram_user_id ?? normalizedPayload.telegramUserId;
    const resolvedTelegramUserId = resolveTelegramUserIdForRequest(explicitTelegramUserId);
    if (resolvedTelegramUserId && !normalizeString(explicitTelegramUserId)) {
      normalizedPayload.telegram_user_id = resolvedTelegramUserId;
    }
  }

  const { response, payload: routePayload, diagnostic } = await requestTelegramMiniApp(
    '/mini-app/booking-submit',
    {
      method: 'POST',
      body: normalizedPayload,
    }
  );
  const submitResult = readOperationResultOrThrow(
    response,
    routePayload,
    'Не удалось отправить заявку',
    diagnostic
  );
  return {
    httpStatus: response.status,
    routeStatus: normalizeString(routePayload?.route_status) || null,
    submitResult,
  };
}

export async function fetchMiniAppEntrypointContent(
  entrypointKey,
  {
    telegramUserId = null,
    bookingRequestId = null,
  } = {}
) {
  const encodedKey = encodeURIComponent(entrypointKey || '');
  const query = buildQueryString({
    telegram_user_id: resolveTelegramUserIdForRequest(telegramUserId),
    booking_request_id: bookingRequestId,
  });
  const { response, payload, diagnostic } = await requestTelegramMiniApp(
    `/mini-app/entrypoint/${encodedKey}${query}`
  );
  return readOperationResultOrThrow(
    response,
    payload,
    'Не удалось загрузить содержимое раздела Mini App',
    diagnostic
  );
}

export async function fetchMiniAppUsefulContentScreen({
  telegramUserId = null,
  bookingRequestId = null,
} = {}) {
  return fetchMiniAppEntrypointContent('useful_content', {
    telegramUserId,
    bookingRequestId,
  });
}

export async function fetchMiniAppFaqScreen({
  telegramUserId = null,
  bookingRequestId = null,
} = {}) {
  return fetchMiniAppEntrypointContent('faq', {
    telegramUserId,
    bookingRequestId,
  });
}

export async function fetchMiniAppContactScreen({
  telegramUserId = null,
  bookingRequestId = null,
} = {}) {
  return fetchMiniAppEntrypointContent('contact', {
    telegramUserId,
    bookingRequestId,
  });
}

export async function fetchMiniAppMyTickets({
  telegramUserId,
  limit = 20,
} = {}) {
  const query = buildQueryString({
    telegram_user_id: resolveTelegramUserIdForRequest(telegramUserId),
    limit,
  });
  const { response, payload, diagnostic } = await requestTelegramMiniApp(
    `/mini-app/my-tickets${query}`
  );
  return readOperationResultOrThrow(
    response,
    payload,
    'Не удалось загрузить список заявок и билетов',
    diagnostic
  );
}

export async function fetchMiniAppMyRequests({
  telegramUserId,
  limit = 50,
} = {}) {
  const query = buildQueryString({
    telegram_user_id: resolveTelegramUserIdForRequest(telegramUserId),
    limit,
  });
  const { response, payload, diagnostic } = await requestTelegramMiniApp(
    `/mini-app/my-requests${query}`,
    {
      diagnosticKey: MINI_APP_API_DIAGNOSTIC_KEYS.myRequests,
    }
  );
  return readOperationResultOrThrow(
    response,
    payload,
    'Не удалось загрузить список заявок',
    diagnostic
  );
}

export async function fetchMiniAppTicketView({
  telegramUserId,
  bookingRequestId,
} = {}) {
  const normalizedBookingRequestId = Number(bookingRequestId);
  if (!Number.isInteger(normalizedBookingRequestId) || normalizedBookingRequestId <= 0) {
    throw new Error('bookingRequestId должен быть положительным целым числом');
  }

  const query = buildQueryString({
    telegram_user_id: resolveTelegramUserIdForRequest(telegramUserId),
  });
  const { response, payload, diagnostic } = await requestTelegramMiniApp(
    `/mini-app/my-tickets/${normalizedBookingRequestId}${query}`
  );
  return readOperationResultOrThrow(
    response,
    payload,
    'Не удалось загрузить билет',
    diagnostic
  );
}

export async function fetchMiniAppOfflineTicketSnapshot({
  telegramUserId,
  bookingRequestId,
} = {}) {
  const normalizedBookingRequestId = Number(bookingRequestId);
  if (!Number.isInteger(normalizedBookingRequestId) || normalizedBookingRequestId <= 0) {
    throw new Error('bookingRequestId должен быть положительным целым числом');
  }

  const query = buildQueryString({
    telegram_user_id: resolveTelegramUserIdForRequest(telegramUserId),
  });
  const { response, payload, diagnostic } = await requestTelegramMiniApp(
    `/mini-app/my-tickets/${normalizedBookingRequestId}/offline-snapshot${query}`
  );
  return readOperationResultOrThrow(
    response,
    payload,
    'Не удалось загрузить офлайн-снимок билета',
    diagnostic
  );
}

export async function fetchMiniAppTicketViewWithOfflineFallback({
  telegramUserId,
  bookingRequestId,
} = {}) {
  try {
    const ticketView = await fetchMiniAppTicketView({
      telegramUserId,
      bookingRequestId,
    });
    return Object.freeze({
      ticketView,
      offlineSnapshot: null,
      fallbackUsed: false,
      ticketViewErrorMessage: null,
    });
  } catch (ticketError) {
    try {
      const offlineSnapshot = await fetchMiniAppOfflineTicketSnapshot({
        telegramUserId,
        bookingRequestId,
      });
      return Object.freeze({
        ticketView: null,
        offlineSnapshot,
        fallbackUsed: true,
        ticketViewErrorMessage: normalizeString(ticketError?.message),
      });
    } catch (offlineError) {
      const ticketErrorMessage = normalizeString(ticketError?.message);
      const offlineErrorMessage = normalizeString(offlineError?.message);
      throw new Error(
        ticketErrorMessage ||
          offlineErrorMessage ||
          'Не удалось загрузить билет и офлайн-снимок'
      );
    }
  }
}
