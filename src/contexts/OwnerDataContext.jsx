import { createContext, useContext, useState, useCallback, useRef } from 'react';
import apiClient from '../utils/apiClient.js';

const API_BASE = '/api';

async function ownerGet(url) {
  const res = await apiClient.request(url, { method: 'GET' });
  const one = res?.data && (res.data.data || res.data.meta) ? res.data : res;
  const two = one?.data && (one.data.data || one.data.meta) ? one.data : one;
  return two || { data: {}, meta: {} };
}

const OwnerDataContext = createContext({
  pendingByDay: { today: null, tomorrow: null, day2: null },
  pendingLoading: false,
  refreshPendingByDays: () => Promise.resolve(),
  refreshOwnerData: () => {},
  refreshAllMoneyData: () => Promise.resolve(),
});

export function OwnerDataProvider({ children }) {
  // Pending data keyed by day: { today: {...}, tomorrow: {...}, day2: {...} }
  const [pendingByDay, setPendingByDay] = useState({
    today: null,
    tomorrow: null,
    day2: null,
  });
  const [pendingLoading, setPendingLoading] = useState(false);
  
  // Per-day request ID for stale check
  const reqIdRef = useRef({ today: 0, tomorrow: 0, day2: 0 });
  
  // Ref for optional refresh callback (e.g., from OwnerMoneyView for summary/compare)
  const refreshCallbackRef = useRef(null);

  // Fetch single day
  const fetchPendingForDay = useCallback(async (day) => {
    const rid = (reqIdRef.current[day] || 0) + 1;
    reqIdRef.current[day] = rid;
    
    try {
      const res = await ownerGet(`/owner/money/pending-by-day?day=${encodeURIComponent(day)}`);
      // Stale check
      if (reqIdRef.current[day] !== rid) return null;
      return res?.data ?? null;
    } catch (e) {
      return { _error: e?.message, _timestamp: Date.now() };
    }
  }, []);

  // Main function: refresh multiple days (TanStack Query invalidateQueries pattern)
  const refreshPendingByDays = useCallback(async (input, reason = 'unknown') => {
    // Normalize input: accept array, single string, or object with days/affectedDays/day
    let raw = input;
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      raw = input.days ?? input.affectedDays ?? input.day;
    }
    const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const allowedDays = ['today', 'tomorrow', 'day2'];
    const valid = [...new Set(arr)].filter(d => allowedDays.includes(d));
    
    // Fallback: if no valid days, refresh today+tomorrow
    const daysToLoad = valid.length > 0 ? valid : ['today', 'tomorrow'];
    
    console.log('[pending invalidate/refetch] days=', daysToLoad, 'reason=', reason);
    
    setPendingLoading(true);
    try {
      // Fetch all days in parallel
      const results = await Promise.all(
        daysToLoad.map(async (day) => {
          const data = await fetchPendingForDay(day);
          return { day, data };
        })
      );
      
      // Update state per-day (don't overwrite other days)
      setPendingByDay(prev => {
        const next = { ...prev };
        for (const { day, data } of results) {
          if (data !== null) {
            next[day] = data;
          }
        }
        return next;
      });
    } finally {
      setPendingLoading(false);
    }
  }, [fetchPendingForDay]);

  // Register optional callback for broader refresh (summary/compare)
  const registerRefreshCallback = useCallback((fn) => {
    refreshCallbackRef.current = fn;
  }, []);

  // Refresh owner data (summary, boats, compare)
  const refreshOwnerData = useCallback(({ silent = false, reason = 'unknown' } = {}) => {
    if (refreshCallbackRef.current && typeof refreshCallbackRef.current === 'function') {
      return refreshCallbackRef.current({ silent });
    }
    return Promise.resolve();
  }, []);

  // Refresh ALL money data: summary + boats + compare + pending (all days)
  const refreshAllMoneyData = useCallback(async ({ silent = false, reason = 'manual' } = {}) => {
    console.log('[refreshAllMoneyData] reason=', reason, 'silent=', silent);
    await Promise.all([
      refreshOwnerData({ silent: true, reason }),
      refreshPendingByDays(['today', 'tomorrow', 'day2'], reason),
    ]);
  }, [refreshOwnerData, refreshPendingByDays]);

  const value = {
    pendingByDay,
    pendingLoading,
    refreshPendingByDays,
    refreshOwnerData,
    refreshAllMoneyData,
    registerRefreshCallback,
  };

  return (
    <OwnerDataContext.Provider value={value}>
      {children}
    </OwnerDataContext.Provider>
  );
}

export const useOwnerData = () => useContext(OwnerDataContext);
export { OwnerDataContext };
