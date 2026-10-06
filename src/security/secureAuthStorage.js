// src/security/secureAuthStorage.js
//
// Supabase session storage for the NATIVE app only: tokens live in Android Keystore-backed / iOS Keychain
// storage instead of plain localStorage. On the web, createAuthStorage() returns undefined and
// supabaseClient.js keeps using window.sessionStorage, so browser login is unchanged.
//
// FIX: src/supabaseClient.js does `import { secureAuthStorage } from "./security/secureAuthStorage"`,
// but this file only exported createAuthStorage(). The named import resolved to undefined, so on the phone
// Supabase silently fell back to its default plain storage (and CI=true builds fail on the missing export).
// `secureAuthStorage` is now exported, so supabaseClient.js works as written with NO change.
//
// Plugin: @aparajita/capacitor-secure-storage  (npm i @aparajita/capacitor-secure-storage && npx cap sync android)
// A session left in localStorage by an older build is moved into secure storage once, then deleted.

import { Capacitor } from "@capacitor/core";

export function createAuthStorage() {
  let native = false;
  try { native = Capacitor.isNativePlatform(); } catch { /* not running inside Capacitor */ }
  if (!native) return undefined;

  let _ss;
  const ss = async () => (_ss ||= (await import("@aparajita/capacitor-secure-storage")).SecureStorage);

  return {
    async getItem(key) {
      const s = await ss();
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
    },
    async setItem(key, value) {
      await (await ss()).set(key, value);
    },
    async removeItem(key) {
      await (await ss()).remove(key).catch(() => {});
      window.localStorage.removeItem(key);
    },
  };
}

// Ready-made instance for supabaseClient.js (undefined on web; supabaseClient only uses it when native).
export const secureAuthStorage = createAuthStorage();

export default secureAuthStorage;
