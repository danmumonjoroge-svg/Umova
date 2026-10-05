// src/security/secureAuthStorage.js
//
// Supabase session storage for the MOBILE app only: tokens go into Android EncryptedSharedPreferences /
// iOS Keychain instead of plain localStorage. On the web this returns undefined, so supabase-js keeps
// using localStorage exactly as today (browser/desktop login is unchanged).
//
// Use it where each Supabase client is created (src/supabaseClient.js and pos-erp/services/posSupabaseClient.js):
//
//   import { createAuthStorage } from "./security/secureAuthStorage";
//   export const supabase = createClient(URL, KEY, {
//     auth: { storage: createAuthStorage(), persistSession: true, autoRefreshToken: true },
//   });
//
// (keep each client's existing storageKey option; the POS client must keep its separate key.)
//
// Plugin: @aparajita/capacitor-secure-storage. One-time migration: an existing session found in localStorage
// is moved into secure storage and the plaintext copy removed.

import { Capacitor } from "@capacitor/core";

export function createAuthStorage() {
  let native = false;
  try { native = Capacitor.isNativePlatform(); } catch { /* not in Capacitor */ }
  if (!native) return undefined;

  let _ss;
  const ss = async () => (_ss ||= (await import("@aparajita/capacitor-secure-storage")).SecureStorage);

  return {
    async getItem(key) {
      const s = await ss();
      const v = await s.get(key).catch(() => null);
      if (v != null) return typeof v === "string" ? v : JSON.stringify(v);
      const legacy = window.localStorage.getItem(key); // migrate once
      if (legacy != null) {
        await s.set(key, legacy);
        window.localStorage.removeItem(key);
        return legacy;
      }
      return null;
    },
    async setItem(key, value) { await (await ss()).set(key, value); },
    async removeItem(key) {
      await (await ss()).remove(key).catch(() => {});
      window.localStorage.removeItem(key);
    },
  };
}
