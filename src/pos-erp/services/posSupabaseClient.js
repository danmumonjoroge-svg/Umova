// src/pos-erp/services/posSupabaseClient.js
//
// A second Supabase client, same project, different auth storage key.
// This is the fix for the session-collision problem: the main app's
// AuthContext and Chama's ChamaProvider both eventually call into
// Supabase's client-side session store, and a single client instance
// only ever holds one session at a time. If POS used the same client
// (../../supabaseClient), signing in as a POS cashier would silently
// sign out whoever's logged into /admin in that same browser tab set —
// violating "POS logout must not affect Umova staff logout, and vice
// versa."
//
// Using a distinct storageKey gives POS its own independent session in
// localStorage, coexisting with the main app's session under a different
// key. Same Supabase project, same anon key — just two client instances.
//
// Credentials come from env vars (same names already used in this
// project's .env — REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_KEY)
// rather than being hardcoded, so this file is safe to commit and works
// across dev/staging/prod without edits.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fail loudly at import time rather than letting createClient() throw a
  // cryptic error deep inside a POS auth call later.
  throw new Error(
    "[posSupabaseClient] Missing REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_KEY. " +
    "Check your .env file — see comment at top of this file."
  );
}

export const posSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: "sb-pos-auth-token", // distinct from the main client's default key
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // POS never handles email-link redirects
  },
});