import { createClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { secureAuthStorage } from "./security/secureAuthStorage";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_KEY."
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

/**
 * Chama client.
 *
 * Chama users sign in with phone + password, then the chama-session edge
 * function turns that into a real Supabase session that carries chama_id /
 * member_id / chama_role. It uses its OWN storage key so it never overwrites
 * (or is overwritten by) the SACCO / My Business session in this browser.
 */
export const chamaSupabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      storage: window.localStorage,
      storageKey: "umova-chama-auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
);

export default supabase;