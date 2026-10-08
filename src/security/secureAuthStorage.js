// src/security/secureAuthStorage.js
//
// Supabase session storage for the NATIVE app only: tokens live in Android Keystore-backed / iOS Keychain
// storage instead of plain localStorage. On the web, createAuthStorage() returns undefined and
// supabaseClient.js keeps using window.sessionStorage, so browser login is unchanged.
//
// FIX 1 (earlier): src/supabaseClient.js does `import { secureAuthStorage } from "./security/secureAuthStorage"`,
// so `secureAuthStorage` is exported here and supabaseClient.js works as written with NO change.
//
// FIX 2 (this version): a Capacitor plugin object is a Proxy that answers EVERY property, including `then`.
// Returning it from an `async` function (or awaiting it) makes JavaScript call plugin.then(), which Capacitor
// rejects with `"SecureStorage.then()" is not implemented on android`. That rejected the session read, so the
// app sat on a spinner forever. The plugin is now always handed around INSIDE a plain object ({ plugin }),
// and getItem() fails safe: if secure storage can't be read, it reports "no session" (the login screen shows)
// instead of hanging.
//
// Plugin: @aparajita/capacitor-secure-storage
// A session left in localStorage by an older build is moved into secure storage once, then deleted.

import { Capacitor } from "@capacitor/core";

export function createAuthStorage() {
  let native = false;
  try { native = Capacitor.isNativePlatform(); } catch { /* not running inside Capacitor */ }
  if (!native) return undefined;

  let _holder;
  // Resolves to { plugin } -- NEVER to the plugin itself (see FIX 2).
  const load = async () => {
    if (!_holder) _holder = { plugin: (await import("@aparajita/capacitor-secure-storage")).SecureStorage };
    return _holder;
  };

  return {
    async getItem(key) {
      try {
        const { plugin: s } = await load();
        const v = await s.get(key).catch(() => null);
        // The plugin JSON-parses what it stored; supabase-js needs the original string back.
        if (v != null) return typeof v === "string" ? v : JSON.stringify(v);

        const legacy = window.localStorage.getItem(key);   // one-time migration from older builds
        if (legacy != null) {
          await s.set(key, legacy);
          window.localStorage.removeItem(key);
          return legacy;
        }
        return null;
      } catch (e) {
        console.error("[secureAuthStorage] getItem failed:", e);
        return null;                                        // fail safe: no session -> login screen, never a hang
      }
    },
    async setItem(key, value) {
      const { plugin: s } = await load();
      await s.set(key, value);
    },
    async removeItem(key) {
      try {
        const { plugin: s } = await load();
        await s.remove(key).catch(() => {});
      } catch { /* nothing to remove */ }
      window.localStorage.removeItem(key);
    },
  };
}

// Ready-made instance for supabaseClient.js (undefined on web; supabaseClient only uses it when native).
export const secureAuthStorage = createAuthStorage();

export default secureAuthStorage;
