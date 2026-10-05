import { createClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { secureAuthStorage } from "./security/secureAuthStorage";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY."
  );
}

/**
 * Umova uses different session storage depending on platform.
 *
 * WEB:
 * Keep the existing browser sessionStorage behaviour.
 *
 * NATIVE:
 * Use the secure native storage adapter so the Supabase
 * authentication session is protected by the mobile app's
 * secure storage mechanism.
 */
const authStorage = Capacitor.isNativePlatform()
  ? secureAuthStorage
  : window.sessionStorage;

/**
 * Keep the existing per-tab/per-app storage key.
 *
 * Do not change this unless your existing application already
 * uses a different key elsewhere.
 */
const STORAGE_KEY =
  "umova-auth-session";

/**
 * Supabase client.
 *
 * Authentication remains controlled by Supabase.
 * Biometric authentication is only an additional local
 * authentication layer for the trusted device.
 */
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      storage: authStorage,
      storageKey: STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: !Capacitor.isNativePlatform(),
    },
  }
);

export default supabase;