// src/security/AppLock.js
//
// Mount INSIDE an already-guarded, authenticated area (e.g. MemberAppShell). It does not replace any auth
// context or route guard, so roles/permissions are resolved before it ever renders.
//
//   Lock          = session stays on the device; fingerprint (or password) needed to reopen.
//   Sign out      = the context's own logout(); full account authentication required again.
//   Remove device = turning "Fingerprint login" OFF; fingerprint stops working here until turned on again.
//
// On web (not native) it renders children untouched.
//
// Two modes:
//   * Supabase mode (Finance, My Business): pass `client`. Unlock is confirmed against the trusted_devices RPCs.
//   * Adapter mode (Chama has no Supabase session): pass `adapter` = {
//       unlock(), verifyPassword(pw), enable(), disable(), signedInWithin(ms)
//     } and AppLock/LockScreen/EnableBiometricPrompt/FingerprintToggle call those instead.
//
// Locking rules at mount time, when fingerprint login is ON for this service:
//   * signed in less than 60s ago                -> do not lock (they just proved who they are)
//   * already unlocked earlier in this app run   -> do not lock (e.g. navigating away and back)
//   * otherwise (reopened app, older session)    -> start locked

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { isNativeApp } from "./nativeBiometric";
import { isEnabled } from "./deviceTrust";
import LockScreen from "./LockScreen";
import EnableBiometricPrompt from "./EnableBiometricPrompt";

const LockCtx = createContext({ locked: false, lockNow: () => {}, refreshTrust: async () => {} });
export const useAppLock = () => useContext(LockCtx);

const LOCK_AFTER_MS = 60 * 1000;      // background time before the app locks again
const FRESH_SIGN_IN_MS = 60 * 1000;   // "just signed in with a password"

// Lives as long as the app process does; resets when Android kills the app = a true cold start.
const unlockedThisRun = new Set();

async function signedInWithin(client, adapter, ms) {
  try {
    if (adapter?.signedInWithin) return !!(await adapter.signedInWithin(ms));
    const { data } = await client.auth.getSession();
    const last = data?.session?.user?.last_sign_in_at;
    return !!last && Date.now() - new Date(last).getTime() < ms;
  } catch {
    return false;                      // can't tell -> fail closed (lock)
  }
}

export default function AppLock({ service, client, adapter, onSignOut, children }) {
  const native = isNativeApp();
  const [ready, setReady] = useState(!native);
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const enabledRef = useRef(false);
  const hiddenAt = useRef(null);
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  // Mount: decide once whether to start locked.
  useEffect(() => {
    if (!native) return;
    let alive = true;
    (async () => {
      const e = await isEnabled(service);
      let startLocked = false;
      if (e && !unlockedThisRun.has(service)) {
        startLocked = !(await signedInWithin(client, adapterRef.current, FRESH_SIGN_IN_MS));
      }
      if (!startLocked) unlockedThisRun.add(service);
      if (!alive) return;
      enabledRef.current = e;
      setEnabled(e);
      setLocked(startLocked);
      setReady(true);
    })();
    return () => { alive = false; };
  }, [native, service, client]);

  const refreshTrust = useCallback(async () => {
    const e = await isEnabled(service);
    enabledRef.current = e;
    setEnabled(e);
  }, [service]);

  // Re-lock after the app has been in the background for a while.
  useEffect(() => {
    if (!native) return;
    let handle;
    let cancelled = false;
    import("@capacitor/app").then(({ App }) => {
      App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) { hiddenAt.current = Date.now(); return; }
        if (enabledRef.current && hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS) {
          unlockedThisRun.delete(service);
          setLocked(true);
        }
        hiddenAt.current = null;
      }).then((h) => { if (cancelled) h.remove(); else handle = h; });
    });
    return () => { cancelled = true; handle?.remove?.(); };
  }, [native, service]);

  const lockNow = useCallback(() => {
    if (enabledRef.current) { unlockedThisRun.delete(service); setLocked(true); }
  }, [service]);

  // Called by LockScreen after fingerprint OR password succeeds.
  const handleUnlocked = useCallback(async () => {
    unlockedThisRun.add(service);
    await refreshTrust();
    setLocked(false);
  }, [service, refreshTrust]);

  if (!native) return children;
  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-emerald-800" />
      </div>
    );
  }

  return (
    <LockCtx.Provider value={{ locked, lockNow, refreshTrust }}>
      <div style={{ display: locked ? "none" : "contents" }} aria-hidden={locked}>{children}</div>
      {locked && <LockScreen service={service} client={client} adapter={adapter} onUnlocked={handleUnlocked} onSignOut={onSignOut} />}
      {!locked && !enabled && <EnableBiometricPrompt service={service} client={client} adapter={adapter} onEnabled={refreshTrust} />}
    </LockCtx.Provider>
  );
}
