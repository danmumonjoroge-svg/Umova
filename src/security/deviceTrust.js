// src/security/deviceTrust.js
//
// Trusted-device logic, reusable by Finance, My Business (and Chama through its own adapter).
// Each service passes in ITS OWN Supabase client (supabase / posSupabase), so we never merge the auth systems.
//
// Model:  account  ->  trusted device  ->  fingerprint-protected device secret.
//   * The secret is 32 random bytes generated on the phone and stored in the Android Keystore with
//     accessControl BIOMETRY_CURRENT_SET: it can only be released by a live fingerprint check, and it is
//     invalidated by the OS if the phone's fingerprints change. (The fingerprint prompt IS the read.)
//   * The server stores only SHA-256(secret) in trusted_devices. No biometric data exists anywhere in Umova.
//   * Fingerprint is an alternative to the password, never a replacement: the password always still works.
//
// Two ways the fingerprint is used:
//   unlock()           app is locked but a Supabase session exists  -> confirm the device is still trusted
//   signInWithDevice() NO session (fresh start / after logout)      -> the server checks the device secret and
//                      returns a one-time token; verifyOtp turns it into a REAL Supabase session
//                      (the same mechanism passkeys use on the web). No fake sessions, no stored passwords.
//
// Fingerprint never grants roles/permissions and never authorises money movement: roles still come from
// AuthContext / POSAuthContext / RLS, and withdrawals/transfers/approvals stay server-authorised.

import { Capacitor } from "@capacitor/core";
import { checkBiometry, BioStatus } from "./nativeBiometric";
import { vaultProtectedSet, vaultProtectedGet, vaultDelete, prefGet, prefSet, prefRemove } from "./secureVault";

export const SERVICES = Object.freeze({ FINANCE: "finance", BUSINESS: "business", CHAMA: "chama" });

const K_DEVICE = "umova.deviceId";
const trustKey = (s) => `umova.trust.${s}`;

// ---- helpers -------------------------------------------------------------
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const randomSecret = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
const isNetworkError = (e) =>
  e?.name === "FunctionsFetchError" || /network|failed to fetch|failed to send|timeout|offline/i.test(String(e?.message || e));

const defaultLabel = () => {
  const p = Capacitor.getPlatform();
  return p === "ios" ? "iPhone" : p === "android" ? "Android phone" : "This device";
};

/** Random per-install id. NOT a hardware identifier (IMEI, serial, ANDROID_ID are never read). Invisible to the user. */
export async function getDeviceId() {
  let id = await prefGet(K_DEVICE);
  if (!id) { id = uuid(); await prefSet(K_DEVICE, id); }
  return id;
}

/** Is fingerprint sign-in turned on for THIS phone and service? (local flag only; no prompt, no network) */
export async function isEnabled(service) {
  const raw = await prefGet(trustKey(service));
  if (!raw) return false;
  try { return !!JSON.parse(raw).enabled; } catch { return false; }
}

async function clearLocal(service) {
  await vaultDelete(service);
  await prefRemove(trustKey(service));
}

async function currentUserId(client) {
  const { data } = await client.auth.getSession();
  return data?.session?.user?.id ?? null;
}

// The Keystore key is gone for good (fingerprints changed / all removed / entry deleted): wipe local trust.
const keyIsGone = (status) => status === BioStatus.INVALIDATED || status === BioStatus.NOT_ENROLLED;

// ---- enable --------------------------------------------------------------
/**
 * Call only while the account is signed in. Returns { ok } or { ok:false, status, detail? }.
 * On Android the secret is stored behind the fingerprint, so storing it shows the ONE fingerprint prompt.
 * The server is told only after that succeeds, so cancelling leaves nothing behind.
 */
export async function enable({ service, client, label }) {
  const info = await checkBiometry();
  if (!info.biometric) return { ok: false, status: info.status === BioStatus.OK ? BioStatus.UNAVAILABLE : info.status };

  const deviceId = await getDeviceId();
  const secret = randomSecret();

  await vaultDelete(service);                       // clear any stale entry (iOS keychain survives reinstall)
  const stored = await vaultProtectedSet(service, deviceId, secret);
  if (!stored.ok) {
    return { ok: false, status: stored.status === BioStatus.UNKNOWN ? "vault_error" : stored.status, detail: stored.detail };
  }

  const { data, error } = await client.rpc("register_trusted_device", {
    p_device_id: deviceId,
    p_service: service,
    p_label: (label || defaultLabel()).slice(0, 60),
    p_platform: Capacitor.getPlatform(),
    p_secret: secret,
  });
  if (error || !data?.ok) {
    await vaultDelete(service);                     // server didn't accept it: don't leave a useless secret
    return { ok: false, status: "server_error", detail: error?.message || data?.reason };
  }

  await prefSet(trustKey(service), JSON.stringify({ enabled: true, since: Date.now(), userId: await currentUserId(client) }));
  return { ok: true };
}

// ---- unlock (a session already exists) -------------------------------------
/**
 * Fingerprint unlock of an EXISTING session (the lock screen). One OS prompt: it releases the secret.
 *
 * -> { ok:true, unverified? }  or  { ok:false, status }
 *    status: a BioStatus value (cancelled / failed / locked_out ...) -> trust is untouched, retry or use password
 *            "invalidated" | "revoked" -> local trust was wiped, user must use password then re-enable
 *            "no_session"              -> Supabase session is gone/expired, full login needed
 *            "server_error"            -> couldn't verify; fail closed, offer password
 */
export async function unlock({ service, client, reason = "Unlock Umova" }) {
  if (!(await isEnabled(service))) return { ok: false, status: "not_enabled" };

  const got = await vaultProtectedGet(service, { reason });
  if (!got.ok) {
    if (keyIsGone(got.status)) {
      await clearLocal(service);
      try {                                          // we are signed in here, so tell the server too (best effort)
        await client.rpc("revoke_trusted_device", { p_device_id: await getDeviceId(), p_service: service, p_row_id: null });
      } catch { /* best effort */ }
      return { ok: false, status: BioStatus.INVALIDATED };
    }
    return { ok: false, status: got.status };        // cancelled / failed / locked out: nothing is wiped
  }

  const { data, error } = await client.rpc("verify_trusted_device", {
    p_device_id: got.deviceId, p_service: service, p_secret: got.secret,
  });

  if (error) {
    // Offline: the fingerprint check passed and the session is still local, so allow the UI to open;
    // revocation is re-checked on the next online unlock. Any other server error fails closed.
    return isNetworkError(error) ? { ok: true, unverified: true } : { ok: false, status: "server_error" };
  }
  if (data?.ok) return { ok: true };

  switch (data?.reason) {
    case "NO_SESSION":
      return { ok: false, status: "no_session" };
    case "REVOKED": case "NOT_FOUND": case "SECRET_MISMATCH":
      await clearLocal(service);
      return { ok: false, status: "revoked" };
    default:
      return { ok: false, status: "server_error" };
  }
}

// ---- sign in with fingerprint (NO session yet) -----------------------------
/** Read the JSON body the edge function sent with an error status (supabase-js hides it in error.context). */
async function readFunctionBody(error) {
  try {
    const body = await error?.context?.json?.();
    return body && typeof body === "object" ? body : null;
  } catch { return null; }
}

/**
 * Sign in WITHOUT a password, using this phone's fingerprint-protected device secret.
 * Works for Finance and My Business (client = supabase / posSupabase). Not for Chama (own adapter).
 *
 * -> { ok:true }  or  { ok:false, status }
 *    status: BioStatus value (cancelled / failed / locked_out ...) -> stay on the screen, offer "Use password instead"
 *            "not_enabled"      -> fingerprint isn't set up on this phone
 *            "invalidated"      -> fingerprints changed on the phone; local trust wiped, use password then re-enable
 *            "revoked"          -> the server no longer trusts this device; local trust wiped
 *            "account_inactive" -> the account is suspended/inactive
 *            "offline"          -> couldn't reach the server
 *            "server_error"     -> anything else; offer the password
 */
export async function signInWithDevice({ service, client, reason = "Sign in to Umova" }) {
  if (service === SERVICES.CHAMA) return { ok: false, status: "server_error" };
  if (!(await isEnabled(service))) return { ok: false, status: "not_enabled" };

  const got = await vaultProtectedGet(service, { reason });
  if (!got.ok) {
    if (keyIsGone(got.status)) {
      await clearLocal(service);                     // no session, so the server row stays; it's reset on re-enable
      return { ok: false, status: BioStatus.INVALIDATED };
    }
    return { ok: false, status: got.status };
  }

  let res;
  try {
    const { data, error } = await client.functions.invoke("device-auth-verify", {
      body: { deviceId: got.deviceId, service, secret: got.secret },
    });
    if (error) {
      res = await readFunctionBody(error);
      if (!res) return { ok: false, status: isNetworkError(error) ? "offline" : "server_error" };
    } else {
      res = data;
    }
  } catch (e) {
    return { ok: false, status: isNetworkError(e) ? "offline" : "server_error" };
  }

  if (!res?.ok) {
    switch (res?.reason) {
      case "REVOKED": case "INVALID":
        await clearLocal(service);
        return { ok: false, status: "revoked" };
      case "RATE_LIMITED":
        return { ok: false, status: BioStatus.LOCKED_OUT };
      case "ACCOUNT_INACTIVE":
        return { ok: false, status: "account_inactive" };
      default:
        return { ok: false, status: "server_error" };
    }
  }
  if (res.kind !== "supabase" || !res.token_hash) return { ok: false, status: "server_error" };

  // Exchange the single-use token for a real Supabase session (same call the passkey flow makes).
  const { error: otpErr } = await client.auth.verifyOtp({ token_hash: res.token_hash, type: "magiclink" });
  if (otpErr) return { ok: false, status: isNetworkError(otpErr) ? "offline" : "server_error" };
  return { ok: true };
}

// ---- disable / revoke ----------------------------------------------------
/** "Remove this device": fingerprint login stops working here until re-enabled after a normal login. */
export async function disable({ service, client }) {
  const deviceId = await getDeviceId();
  try { await client.rpc("revoke_trusted_device", { p_device_id: deviceId, p_service: service, p_row_id: null }); } catch { /* best effort */ }
  await clearLocal(service);
  return { ok: true };
}

export async function listDevices({ service, client }) {
  const { data, error } = await client.rpc("list_trusted_devices", { p_service: service, p_current_device: await getDeviceId() });
  if (error) throw error;
  return data || [];
}

export async function revokeDevice({ client, rowId }) {
  const { data, error } = await client.rpc("revoke_trusted_device", { p_device_id: null, p_service: null, p_row_id: rowId });
  if (error) throw error;
  return data;
}

/** "Log out all devices": revoke every trusted device, then invalidate every refresh token for the account. */
export async function signOutEverywhere({ service, client }) {
  await client.rpc("revoke_all_trusted_devices", { p_service: service });
  await clearLocal(service);
  await client.auth.signOut({ scope: "global" });
}

// ---- password fallback / re-auth -----------------------------------------
/** Confirms the signed-in account's password. Works for member, staff and POS accounts (POS uses its synthetic email). */
export async function verifyPassword(client, password) {
  const { data } = await client.auth.getSession();
  const email = data?.session?.user?.email;
  if (!email) return { ok: false, reason: "no_session" };
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error ? { ok: false, reason: "wrong_password" } : { ok: true };
}

export async function shouldOfferEnable(service) {
  return !(await isEnabled(service));
}
export { prefGet, prefSet };
