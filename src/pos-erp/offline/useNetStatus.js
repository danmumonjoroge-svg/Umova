// src/pos-erp/offline/useNetStatus.js
//
// Brief §26 -- the connection-status indicator, in the owner's words
// (Online / Offline -- Everything is saved / Updating / Updated), plus
// the count of transactions waiting.
//
// navigator.onLine alone is not trustworthy (a device can report
// "online" while actually having no real route to Supabase -- captive
// portals, a router with no upstream), so this also does a light
// reachability check whenever the browser's own online/offline events
// fire, rather than taking navigator.onLine at face value.

import { useState, useEffect, useCallback } from 'react';
import { db } from './db';

// SUPABASE_URL is a public, non-secret value already used the same way
// in posSupabaseClient.js -- reading it directly here avoids depending
// on supabase-js's internal client shape (which isn't a stable public
// API) just to find a URL to ping.
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;

/**
 * Cheap reachability probe -- a HEAD request to Supabase's own REST
 * root. Deliberately not a real table query (no RLS evaluation, no
 * auth needed) -- this only needs to know "can a request reach the
 * server at all", not "is my session valid".
 */
async function probeReachable() {
  if (!SUPABASE_URL) return navigator.onLine; // no URL configured -- fall back rather than crash the hook
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    return res.ok || res.status === 404; // 404 on the bare REST root still proves reachability
  } catch {
    return false;
  }
}

export function useNetStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [checking, setChecking] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await db.outbox.where('status').anyOf('PENDING', 'FAILED').count();
      setPendingCount(count);
    } catch {
      // Dexie not ready yet (very first render) -- fine, next tick will catch it.
    }
  }, []);

  const recheck = useCallback(async () => {
    setChecking(true);
    const reachable = navigator.onLine && (await probeReachable());
    setIsOnline(reachable);
    setChecking(false);
    return reachable;
  }, []);

  useEffect(() => {
    recheck();
    refreshPendingCount();
    const onOnline = () => recheck();
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    // Also re-probe periodically -- catches the "wifi icon shows
    // connected but there's no real internet" case without waiting for
    // a browser event that may never fire.
    const interval = setInterval(recheck, 30000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(interval);
    };
  }, [recheck, refreshPendingCount]);

  return { isOnline, checking, pendingCount, lastSyncedAt, setLastSyncedAt, refreshPendingCount, recheck };
}
