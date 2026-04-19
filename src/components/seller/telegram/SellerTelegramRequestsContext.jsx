import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import apiClient from '../../../utils/apiClient';
import { buildSellerTelegramQueueModel } from './sellerTelegramQueueModel';

const SellerTelegramRequestsContext = createContext(null);
const SELLER_TELEGRAM_QUEUE_POLL_MS = 15000;

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
      setQueueSummary(normalizeQueueSummary(response));
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
        await refreshQueue({ silent: true });
        return {
          ok: true,
          result: response?.operation_result_summary ?? response,
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
    () => buildSellerTelegramQueueModel(queueSummary),
    [queueSummary]
  );

  const value = useMemo(
    () => ({
      queueSummary,
      queueModel,
      loading,
      refreshing,
      error,
      busyActions,
      refreshQueue,
      runAction,
    }),
    [queueSummary, queueModel, loading, refreshing, error, busyActions, refreshQueue, runAction]
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
    loading: false,
    refreshing: false,
    error: '',
    busyActions: {},
    refreshQueue: async () => ({ ok: true }),
    runAction: async () => ({ ok: false, error: 'Provider is not mounted' }),
  };
}
