// src/security/AppLock.js
//
// Wrap an authenticated area with this. It does NOT replace any auth context or route guard: it sits INSIDE
// them, so the user must already be authenticated (and have their role resolved) for it to render at all.
//
//   Lock          = session stays on the device; biometric (or password) needed to reopen. (cold start, background > 60s, "Lock now")
//   Sign out      = the context's own logout(); full account authentication required again.
//   Remove device = disable() in deviceTrust; biometric stops working here until re-enabled after a normal login.
//
// On web (not native) it renders children untouched.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { isNativeApp } from "./nativeBiometric";
import { isEnabled } from "./deviceTrust";
import LockScreen from "./LockScreen";
import EnableBiometricPrompt from "./EnableBiometricPrompt";

const LockCtx = createContext({ locked: false, lockNow: () => {}, refreshTrust: async () => {} });
export const useAppLock = () => useContext(LockCtx);

const LOCK_AFTER_MS = 60 * 1000;

export default function AppLock({ service, client, onSignOut, children }) {
  const native = isNativeApp();
  const [ready, setReady] = useState(!native);
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const enabledRef = useRef(false);
  const hiddenAt = useRef(null);

  // Cold start: if biometric is on for this service, start LOCKED before any content renders.
  useEffect(() => {
    if (!native) return;
    let alive = true;
    isEnabled(service).then((e) => {
      if (!alive) return;
      enabledRef.current = e; setEnabled(e); setLocked(e); setReady(true);
    });
    return () => { alive = false; };
  }, [native, service]);

  const refreshTrust = useCallback(async () => {
    const e = await isEnabled(service);
    enabledRef.current = e; setEnabled(e);
  }, [service]);

  // Re-lock after the app has been in the background for a while.
  useEffect(() => {
    if (!native) return;
    let handle;
    import("@capacitor/app").then(({ App }) => {
      App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) { hiddenAt.current = Date.now(); return; }
        if (enabledRef.current && hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS) setLocked(true);
        hiddenAt.current = null;
      }).then((h) => { handle = h; });
    });
    return () => { handle?.remove?.(); };
  }, [native]);

  const lockNow = useCallback(() => { if (enabledRef.current) setLocked(true); }, []);
  const handleUnlocked = useCallback(async () => { await refreshTrust(); setLocked(false); }, [refreshTrust]);

  if (!native) return children;
  if (!ready) {
    return <div className="min-h-screen bg-slate-100 flex items-center justify-center"><Loader2 size={28} className="animate-spin text-emerald-800" /></div>;
  }

  return (
    <LockCtx.Provider value={{ locked, lockNow, refreshTrust }}>
      <div style={{ display: locked ? "none" : "contents" }} aria-hidden={locked}>{children}</div>
      {locked && <LockScreen service={service} client={client} onUnlocked={handleUnlocked} onSignOut={onSignOut} />}
      {!locked && !enabled && <EnableBiometricPrompt service={service} client={client} onEnabled={refreshTrust} />}
    </LockCtx.Provider>
  );
}
