// src/components/Auth/webauthnHelpers.js
//
// Kept as the SAME public API UnifiedLogin.js and PasskeySettings.js already import
// (passkeysSupported, registerPasskey(nickname), loginWithPasskey(identifier)) — only the engine underneath changed:
// it is now the shared passkeyClient used by all three Umova apps.

import { supabase } from "../../supabaseClient";
import { createPasskeyClient } from "./passkeyClient";

const client = createPasskeyClient({
  getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
  verifyOtp: (params) => supabase.auth.verifyOtp(params),
});

export const passkeysSupported = () => client.supported();

export async function registerPasskey(nickname) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("You must be signed in to add a passkey.");
  const label = session.user.user_metadata?.name || session.user.email;
  return client.registerPasskey({ nickname, label });
}

export async function loginWithPasskey(identifier) {
  return client.loginWithPasskey({ identifier });
}
