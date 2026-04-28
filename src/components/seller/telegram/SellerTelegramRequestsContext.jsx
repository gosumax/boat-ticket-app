import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import apiClient from '../../../utils/apiClient';
import { buildSellerTelegramQueueModel } from './sellerTelegramQueueModel';

const SellerTelegramRequestsContext = createContext(null);
const SELLER_TELEGRAM_QUEUE_POLL_MS = 15000;
const SELLER_TELEGRAM_ACK_STORAGE_KEY = 'seller_telegram_acknowledged_requests_v1';

function readPersistedAcknowledgedIds() {
  try {
    const storage = globalThis?.localStorage;
    if (!storage) {
      return {};
    }
    const rawValue = storage.getItem(SELLER_TELEGRAM_ACK_STORAGE_KEY);
    if (!rawValue) {
      return {};
    }
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function persistAcknowledgedIds(value) {
  try {
    const storage = globalThis?.localStorage;
    if (!storage) {
      return;
    }
    storage.setItem(SELLER_TELEGRAM_ACK_STORAGE_KEY, JSON.stringify(value || {}));
  } catch {
    // best-effort only
  }
}

function normalizeQueueSummary(response) {
  const summary = response?.operation_result_summary ?? response;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return { items: [] };
  }
  if (!Array.isArray(summary.items)) {
    return {
      ...summary,
      items: [],
    };
  }
  return summary;
}

function parseTimestampMs(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function shouldReplaceQueueSummary(currentSummary, nextSummary) {
  const currentGeneratedMs = parseTimestampMs(currentSummary?.generated_at);
  const nextGeneratedMs = parseTimestampMs(nextSummary?.generated_at);

  if (currentGeneratedMs === null || nextGeneratedMs === null) {
    return true;
  }
  return nextGeneratedMs >= currentGeneratedMs;
}

function resolveQueueItemBookingRequestId(queueItem) {
  const bookingRequestId = Number(queueItem?.booking_request?.booking_request_id);
  if (!Number.isInteger(bookingRequestId) || bookingRequestId <= 0) {
    return null;
  }
  return bookingRequestId;
}

function upsertQueueItemIntoSummary(summary, queueItem) {
  const bookingRequestId = resolveQueueItemBookingRequestId(queueItem);
  if (!bookingRequestId) {
    return summary;
  }

  const baseSummary =
    summary && typeof summary === 'object' && !Array.isArray(summary)
      ? summary
      : { items: [] };
  const currentItems = Array.isArray(baseSummary.items) ? baseSummary.items : [];
  const existingIndex = currentItems.findIndex(
    (item) =>
      Number(item?.booking_request?.booking_request_id || 0) === bookingRequestId
  );

  const nextItems = [...currentItems];
  if (existingIndex >= 0) {
    nextItems[existingIndex] = queueItem;
  } else {
    nextItems.unshift(queueItem);
  }

  return {
    ...baseSummary,
    generated_at: new Date().toISOString(),
    items: nextItems,
  };
}

function buildIdempotencyKey({ bookingRequestId, actionType }) {
  return [
    'seller-ui',
    bookingRequestId,
    actionType,
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 8),
  ].join(':');
}

export function SellerTelegramRequestsProvider({ children }) {
  const [queueSummary, setQueueSummary] = useState({ items: [] });
  const [acknowledgedRequestIds, setAcknowledgedRequestIds] = useState(() =>
    readPersistedAcknowledgedIds()
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyActions, setBusyActions] = useState({});

  const refreshQueue = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await apiClient.getSellerTelegramWorkQueue();
      const normalizedSummary = normalizeQueueSummary(response);
      setQueueSummary((currentSummary) =>
        shouldReplaceQueueSummary(currentSummary, normalizedSummary)
          ? normalizedSummary
          : currentSummary
      );
      setError('');
      return { ok: true };
    } catch (queueError) {
      const message = queueError?.message || 'Failed to load Telegram requests';
      setError(message);
      return { ok: false, error: message };
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refreshQueue();

    const intervalId = setInterval(() => {
      refreshQueue({ silent: true });
    }, SELLER_TELEGRAM_QUEUE_POLL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [refreshQueue]);

  const runAction = useCallback(
    async ({ bookingRequestId, actionType, actionPayload = {} }) => {
      const key = `${bookingRequestId}:${actionType}`;
      setBusyActions((prev) => ({ ...prev, [key]: true }));
      try {
        const response = await apiClient.recordSellerTelegramWorkQueueAction({
          bookingRequestId,
          actionType,
          idempotencyKey: buildIdempotencyKey({ bookingRequestId, actionType }),
          actionPayload,
        });
        const operationResult = response?.operation_result_summary ?? response;
        const resultQueueItem = operationResult?.queue_item || null;
        if (resultQueueItem) {
          setQueueSummary((currentSummary) =>
            upsertQueueItemIntoSummary(currentSummary, resultQueueItem)
          );
        }
        await refreshQueue({ silent: true });
        return {
          ok: true,
          result: operationResult,
        };
      } catch (actionError) {
        await refreshQueue({ silent: true });
        return {
          ok: false,
          error:
            actionError?.message ||
            'Telegram request action failed',
        };
      } finally {
        setBusyActions((prev) => ({ ...prev, [key]: false }));
      }
    },
    [refreshQueue]
  );

  const queueModel = useMemo(
    () =>
      buildSellerTelegramQueueModel(queueSummary, {
        acknowledgedRequestIds,
      }),
    [queueSummary, acknowledgedRequestIds]
  );

  useEffect(() => {
    const activeIds = new Set(
      queueModel.items.map((item) => Number(item.bookingRequestId)).filter((value) => value > 0)
    );
    setAcknowledgedRequestIds((prev) => {
      const next = {};
      for (const [key, value] of Object.entries(prev)) {
        const id = Number(key);
        if (activeIds.has(id) && value) {
          next[id] = true;
        }
      }
      if (Object.keys(next).length === Object.keys(prev).length) {
        return prev;
      }
      return next;
    });
  }, [queueModel.items]);

  useEffect(() => {
    persistAcknowledgedIds(acknowledgedRequestIds);
  }, [acknowledgedRequestIds]);

  const markRequestsOpened = useCallback((bookingRequestIds = []) => {
    const ids = Array.isArray(bookingRequestIds) ? bookingRequestIds : [bookingRequestIds];
    const normalized = ids
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (normalized.length === 0) {
      return;
    }
    setAcknowledgedRequestIds((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const bookingRequestId of normalized) {
        if (!next[bookingRequestId]) {
          next[bookingRequestId] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const markRequestOpened = useCallback((bookingRequestId) => {
    markRequestsOpened([bookingRequestId]);
  }, [markRequestsOpened]);

  const value = useMemo(
    () => ({
      queueSummary,
      queueModel,
      acknowledgedRequestIds,
      loading,
      refreshing,
      error,
      busyActions,
      refreshQueue,
      runAction,
      markRequestOpened,
      markRequestsOpened,
    }),
    [
      queueSummary,
      queueModel,
      acknowledgedRequestIds,
      loading,
      refreshing,
      error,
      busyActions,
      refreshQueue,
      runAction,
      markRequestOpened,
      markRequestsOpened,
    ]
  );

  return (
    <SellerTelegramRequestsContext.Provider value={value}>
      {children}
    </SellerTelegramRequestsContext.Provider>
  );
}

export function useSellerTelegramRequests() {
  const context = useContext(SellerTelegramRequestsContext);
  if (context) {
    return context;
  }

  return {
    queueSummary: { items: [] },
    queueModel: buildSellerTelegramQueueModel({ items: [] }),
    acknowledgedRequestIds: {},
    loading: false,
    refreshing: false,
    error: '',
    busyActions: {},
    refreshQueue: async () => ({ ok: true }),
    runAction: async () => ({ ok: false, error: 'Provider is not mounted' }),
    markRequestOpened: () => {},
    markRequestsOpened: () => {},
  };
}
