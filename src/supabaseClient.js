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
 * Web:
 * Uses browser sessionStorage.
 *
 * Native:
 * Uses secure native storage for the Supabase
 * authentication session.
 */
const authStorage = Capacitor.isNativePlatform()
  ? secureAuthStorage
  : window.sessionStorage;

/**
 * Supabase authentication storage key.
 */
const STORAGE_KEY = "umova-auth-session";

/**
 * Supabase client.
 *
 * Supabase remains the authoritative authentication
 * and authorization system.
 *
 * Biometric authentication is only an additional
 * trusted-device/app-unlock layer.
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