import { useCallback, useEffect, useRef, useState } from "react";
import useOnlineStatus from "./useOnlineStatus";

// -----------------------------------------------------------------------------
// useCachedQuery — READ-ONLY cache for information that is safe to show stale
// (balances, statements, updates). It is deliberately NOT a write queue:
// nothing that moves money is ever stored here or replayed from here.
//
// Last good result is kept in localStorage under CACHE_PREFIX and shown
// immediately (flagged `fromCache`) while a fresh copy loads, or when the
// device is offline. `clearChamaCache()` is called on logout so a shared
// phone doesn't keep the previous person's balances.
// -----------------------------------------------------------------------------
export const CACHE_PREFIX = "chama_cache_v1:";

export function clearChamaCache() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable — nothing to clear */ }
}

function readCache(key) {
  try { const raw = localStorage.getItem(CACHE_PREFIX + key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeCache(key, data) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data })); } catch { /* quota — skip */ }
}

// fetcher must THROW on failure (not return partial data) so a failed refresh
// never overwrites a good cached copy.
export default function useCachedQuery(key, fetcher, enabled = true) {
  const online = useOnlineStatus();
  const cached = useRef(enabled && key ? readCache(key) : null);
  const [data, setData] = useState(cached.current?.data ?? null);
  const [cachedAt, setCachedAt] = useState(cached.current?.ts ?? null);
  const [fromCache, setFromCache] = useState(!!cached.current);
  const [loading, setLoading] = useState(!cached.current);
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    if (!enabled || !key) return;
    setError(null);
    try {
      const fresh = await fetcherRef.current();
      setData(fresh); setFromCache(false); setCachedAt(Date.now());
      writeCache(key, fresh);
    } catch (e) {
      setError(e?.message || "Could not refresh");
    } finally {
      setLoading(false);
    }
  }, [key, enabled]);

  useEffect(() => {
    const c = enabled && key ? readCache(key) : null;
    setData(c?.data ?? null); setCachedAt(c?.ts ?? null); setFromCache(!!c); setLoading(!c);
    if (online) reload(); else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  // Coming back online → refresh whatever is showing.
  useEffect(() => { if (online) reload(); /* eslint-disable-next-line */ }, [online]);

  return { data, loading, error, fromCache, cachedAt, reload, online };
}
