// src/pos-erp/auth/posPasskeys.js — My Business/POS wiring for the shared passkey client.
// POS uses its OWN Supabase client (separate storage key), so the session token and the final
// verifyOtp() must go through posSupabase, not the main app's client.
import { posSupabase } from "../services/posSupabaseClient";
import { createPasskeyClient } from "./passkeyClient";

export const posPasskeys = createPasskeyClient({
  getAccessToken: async () => (await posSupabase.auth.getSession()).data.session?.access_token,
  verifyOtp: (params) => posSupabase.auth.verifyOtp(params),
});
