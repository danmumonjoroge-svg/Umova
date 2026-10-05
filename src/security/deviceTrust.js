// src/security/deviceTrust.js
//
// Trusted-device logic, reusable by Finance, My Business (and Chama once its adapter exists).
// Each service passes in ITS OWN Supabase client (supabase / posSupabase), so we never merge the auth systems.
//
// Model:  account (already authenticated)  ->  trusted device  ->  biometric-protected device secret.
//   * The secret is 32 random bytes generated on the phone, kept in the OS secure store.
//   * The server stores only SHA-256(secret) in trusted_devices. No biometric data exists anywhere in Umova.
//   * Biometric success only RELEASES the secret locally; the server then confirms the device is still
//     trusted (not revoked, secret matches) and belongs to the signed-in account.
//   * Biometric proves "the phone's owner is here". It never grants roles/permissions: those still come from
//     AuthContext / POSAuthContext / RLS exactly as before.

import { Capacitor } from "@capacitor/core";
import { authenticate, checkBiometry, BioStatus } from "./nativeBiometric";
import { vaultSet, vaultGet, vaultDelete, prefGet, prefSet, prefRemove } from "./secureVault";

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
const isNetworkError = (e) => /network|failed to fetch|timeout|offline/i.test(String(e?.message || e));

const defaultLabel = () => {
  const p = Capacitor.getPlatform();
  return p === "ios" ? "iPhone" : p === "android" ? "Android phone" : "This device";
};

/** Random per-install id. NOT a hardware identifier (IMEI, serial, ANDROID_ID are never read). */
export async function getDeviceId() {
  let id = await prefGet(K_DEVICE);
  if (!id) { id = uuid(); await prefSet(K_DEVICE, id); }
  return id;
}

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

// ---- enable --------------------------------------------------------------
/** Call only while the account is signed in. Returns { ok } or { ok:false, status, detail? }. */
export async function enable({ service, client, label }) {
  const info = await checkBiometry();
  if (!info.biometric) return { ok: false, status: info.status === BioStatus.OK ? BioStatus.UNAVAILABLE : info.status };

  // User must prove presence at the OS level before we create the trust.
  const auth = await authenticate({ reason: "Confirm to turn on fingerprint sign-in" });
  if (!auth.ok) return { ok: false, status: auth.status };

  const deviceId = await getDeviceId();
  const secret = randomSecret();

  const { data, error } = await client.rpc("register_trusted_device", {
    p_device_id: deviceId,
    p_service: service,
    p_label: (label || defaultLabel()).slice(0, 60),
    p_platform: Capacitor.getPlatform(),
    p_secret: secret,
  });
  if (error || !data?.ok) return { ok: false, status: "server_error", detail: error?.message || data?.reason };

  try {
    await vaultDelete(service);                 // clear any stale entry (iOS keychain survives reinstall)
    await vaultSet(service, deviceId, secret);
  } catch (e) {
    await client.rpc("revoke_trusted_device", { p_device_id: deviceId, p_service: service, p_row_id: null });
    return { ok: false, status: "vault_error", detail: e?.message };
  }

  await prefSet(trustKey(service), JSON.stringify({ enabled: true, since: Date.now(), userId: await currentUserId(client) }));
  return { ok: true };
}

// ---- unlock --------------------------------------------------------------
/**
 * Biometric unlock of an EXISTING session (the lock screen). Never creates a session by itself:
 * after "Sign out" the user must do a full login again.
 *
 * -> { ok:true, unverified? }  or  { ok:false, status }
 *    status: a BioStatus value (retry/fallback), or
 *            "invalidated" | "revoked" -> local trust was wiped, user must use password then re-enable
 *            "no_session"              -> Supabase session is gone/expired, full login needed
 *            "server_error"            -> couldn't verify; fail closed, offer password
 */
export async function unlock({ service, client, reason = "Unlock Umova" }) {
  if (!(await isEnabled(service))) return { ok: false, status: "not_enabled" };

  const auth = await authenticate({ reason });
  if (!auth.ok) return { ok: false, status: auth.status };

  const stored = await vaultGet(service);
  if (!stored) {                                    // OS dropped the credential (e.g. biometrics changed)
    await clearLocal(service);
    return { ok: false, status: BioStatus.INVALIDATED };
  }

  const { data, error } = await client.rpc("verify_trusted_device", {
    p_device_id: stored.deviceId, p_service: service, p_secret: stored.secret,
  });

  if (error) {
    // Offline: the biometric check passed and the session is still local, so allow the UI to open;
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

// ---- disable / revoke ----------------------------------------------------
/** "Remove this device": biometric login stops working here until re-enabled after a normal login. */
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
