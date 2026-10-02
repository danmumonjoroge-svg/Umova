// chama-erp-advanced/auth/chamaPasskeys.js — Chama wiring for the shared passkey client.
// Chama has no Supabase session (its own phone + password accounts), so there is no access token and no verifyOtp:
// enrolment re-confirms phone + password on the server, and sign-in returns the verified Chama user directly.
import { createPasskeyClient } from "./passkeyClient";

export const chamaPasskeys = createPasskeyClient({
  getAccessToken: async () => null,
  verifyOtp: async () => ({ error: new Error("Not used by Chama") }),
});
