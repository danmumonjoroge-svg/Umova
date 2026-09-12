// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

// FIXED: was checking process.env.REACT_APP_SUPABASE_ANON_KEY, but the
// actual .env file uses REACT_APP_SUPABASE_KEY (same mismatch already
// found and fixed once in posSupabaseClient.js — see that file's
// history). That meant this check ALWAYS silently failed and fell
// through to the hardcoded fallback below, in every environment, with
// no visible sign anything was wrong. Now reads the correct var name,
// and warns loudly (instead of silently) if it ever has to fall back —
// so a future key rotation that only touches .env doesn't quietly do
// nothing.
const SUPABASE_URL      = process.env.REACT_APP_SUPABASE_URL || "https://tejzcwftbvcojvpczxbm.supabase.co";
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlanpjd2Z0YnZjb2p2cGN6eGJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDMyNzgsImV4cCI6MjA4ODYxOTI3OH0.1EnpfkK8q81Tc4pludB5qH22pIF8GvJos_E05yTH_S8";

if (!process.env.REACT_APP_SUPABASE_URL || !process.env.REACT_APP_SUPABASE_KEY) {
  console.warn(
    "[supabaseClient] REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_KEY not found in " +
    "process.env — falling back to the hardcoded value in source. Check your .env file."
  );
}

// Give each browser tab its own unique Supabase client "instance ID".
// This, combined with sessionStorage, ensures that multiple tabs (each
// potentially logged in as a different user) never share or overwrite
// each other's auth tokens, even if Supabase internally tries to
// broadcast auth state across the same browser context.
const TAB_INSTANCE_KEY = "umova_tab_instance_id";
let tabInstanceId = sessionStorage.getItem(TAB_INSTANCE_KEY);
if (!tabInstanceId) {
  tabInstanceId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(TAB_INSTANCE_KEY, tabInstanceId);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Per-tab session storage: each tab can hold a different logged-in
    // user without clobbering other tabs' sessions. NOTE: this also
    // means a login does not survive closing the tab/browser — see the
    // question about this in the file's conversation notes if you want
    // localStorage-backed persistence instead.
    storage: window.sessionStorage,

    // Unique storage key per tab so multiple tabs never read/write the
    // same sessionStorage entry for the auth token.
    storageKey: `sb-${tabInstanceId}-auth-token`,

    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,

    // Avoid GoTrue's cross-tab "lock" mechanism interfering between
    // independent per-tab sessions.
    multiTab: false,
  },
  global: {
    headers: {
      "x-client-info": `umova-erp/${tabInstanceId}`,
    },
  },
});

// Convenience helper if you ever need to identify this tab's session
// (e.g. for debugging multi-user/multi-tab issues).
export const getTabInstanceId = () => tabInstanceId;
