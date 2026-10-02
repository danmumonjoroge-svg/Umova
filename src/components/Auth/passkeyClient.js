// passkeyClient.js — ONE client for fingerprint / passkey sign-in, copied unchanged into each app
// (src/components/Auth/, pos-erp/auth/, chama-erp-advanced/auth/). Each app passes in its own Supabase wiring.
//
// Requires:  npm install @simplewebauthn/browser
// Env (CRA): REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_KEY (anon)
//
// Two kinds of account, one API:
//   "supabase" (SACCO app, My Business/POS) -> verify returns a one-time token; we exchange it for a real Supabase session.
//   "chama" (own phone+password accounts, no Supabase session) -> verify returns the verified user; the app continues
//            exactly as it does after authenticate_user().

import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";

const dismissed = (err) => err?.name === "NotAllowedError" || err?.name === "AbortError";

export function createPasskeyClient({ getAccessToken, verifyOtp }) {
  const base = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1`;
  const anon = process.env.REACT_APP_SUPABASE_KEY;

  async function call(name, body, token) {
    const res = await fetch(`${base}/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${token || anon}` },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error((await res.text()) || "Request failed");
    return res.json();
  }

  /** Enrol this device for the account that is signed in right now (Supabase accounts). `label` = friendly name shown by the phone. */
  async function registerPasskey({ nickname, label } = {}) {
    const token = await getAccessToken?.();
    if (!token) throw new Error("You must be signed in to set up fingerprint sign-in.");
    const options = await call("webauthn-register-options", { kind: "supabase", label }, token);
    const attestationResponse = await startRegistration({ optionsJSON: options });
    return call("webauthn-register-verify", { attestationResponse, nickname }, token);
  }

  /** Chama: no session exists, so the person confirms phone + password to enrol. */
  async function registerChamaPasskey({ phone, password, nickname }) {
    const options = await call("webauthn-register-options", { kind: "chama", phone, password });
    const attestationResponse = await startRegistration({ optionsJSON: options });
    return call("webauthn-register-verify", { attestationResponse, nickname });
  }

  /**
   * Sign in with a fingerprint. Nothing typed.
   * Resolves { usedPasskey:false, cancelled? } when there is nothing to use / the person dismissed the prompt,
   * so the caller can fall back to the password form without showing an error.
   * Resolves { usedPasskey:true, kind:"supabase" } after a real session exists, or
   *          { usedPasskey:true, kind:"chama", user } for Chama accounts.
   */
  async function loginWithPasskey({ identifier } = {}) {
    const { available, options } = await call("webauthn-auth-options", identifier ? { identifier } : {});
    if (!available) return { usedPasskey: false };

    let assertionResponse;
    try {
      assertionResponse = await startAuthentication({ optionsJSON: options });
    } catch (err) {
      if (dismissed(err)) return { usedPasskey: false, cancelled: true };
      throw err;
    }

    const result = await call("webauthn-auth-verify", { ...(identifier ? { identifier } : {}), assertionResponse });
    if (result.kind === "chama") return { usedPasskey: true, kind: "chama", user: result.user };

    const { error } = await verifyOtp({ token_hash: result.token_hash, type: "magiclink" });
    if (error) throw error;
    return { usedPasskey: true, kind: "supabase" };
  }

  const listChamaPasskeys = ({ phone, password }) => call("webauthn-manage", { action: "list", phone, password }).then((r) => r.credentials);
  const removeChamaPasskey = ({ phone, password, credentialId }) => call("webauthn-manage", { action: "remove", phone, password, credentialId });

  return {
    supported: () => browserSupportsWebAuthn(),
    dismissed,
    registerPasskey, registerChamaPasskey, loginWithPasskey, listChamaPasskeys, removeChamaPasskey,
  };
}
