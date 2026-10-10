// src/security/chamaDevice.js
//
// Fingerprint for Chama. Same idea as deviceTrust.js (Finance / My Business), adapted to the fact that Chama has NO
// Supabase session: its accounts are phone + password checked by authenticate_user().
//
//   * The phone's OS checks the fingerprint, which releases a random 32-byte device secret from the Android
//     Keystore (protected vault, BIOMETRY_CURRENT_SET). The fingerprint itself never reaches Umova.
//   * The server keeps only SHA-256(secret) in chama_trusted_devices.
//   * Turning it on needs the user's phone + password ONCE (checked by chama_device_register), because Chama has no
//     token that proves who is asking. After that, the fingerprint alone signs in, and the password always still works.
//
// Statuses returned (besides the BioStatus values from nativeBiometric):
//   "not_enabled"       fingerprint isn't turned on for Chama on this phone
//   "password_required" enable() was called without a password
//   "wrong_password"    the phone/password didn't match
//   "rate_limited"      too many wrong passwords, try again in a few minutes
//   "invalidated"       phone's fingerprints changed; local setup wiped, use password then turn it on again
//   "revoked"           the server no longer trusts this phone; local setup wiped
//   "account_inactive"  the Chama account is inactive
//   "offline"           couldn't reach the server
//   "server_error"      anything else
//
// Fingerprint here only proves WHO the user is (it returns the same { user_id, full_name, phone_number } that
// authenticate_user() returns). Memberships, roles and licence checks still run in ChamaContext afterwards.

import { Capacitor } from "@capacitor/core";
import { checkBiometry, BioStatus } from "./nativeBiometric";
import { vaultProtectedSet, vaultProtectedGet, vaultDelete, prefSet, prefRemove } from "./secureVault";
import { getDeviceId, isEnabled } from "./deviceTrust";

const SERVICE = "chama";
const TRUST_KEY = "umova.trust.chama";   // same key deviceTrust.isEnabled("chama") reads

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const randomSecret = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const isNetworkError = (e) => /network|failed to fetch|failed to send|timeout|offline/i.test(String(e?.message || e));
const keyIsGone = (s) => s === BioStatus.INVALIDATED || s === BioStatus.NOT_ENROLLED;

const defaultLabel = () => {
  const p = Capacitor.getPlatform();
  return p === "ios" ? "iPhone" : p === "android" ? "Android phone" : "This device";
};

export async function isChamaFingerprintOn() {
  return isEnabled(SERVICE);
}

async function clearLocal() {
  await vaultDelete(SERVICE);
  await prefRemove(TRUST_KEY);
}

// ---- turn on -------------------------------------------------------------
/**
 * Needs the Chama user's phone + password (asked once). Wrong password -> no fingerprint prompt is shown at all.
 * -> { ok:true } or { ok:false, status, detail? }
 */
export async function enableChamaFingerprint({ client, phone, password, label }) {
  const info = await checkBiometry();
  if (!info.biometric) return { ok: false, status: info.status === BioStatus.OK ? BioStatus.UNAVAILABLE : info.status };
  if (!String(phone || "").trim() || !password) return { ok: false, status: "password_required" };

  const deviceId = await getDeviceId();
  const secret = randomSecret();

  // 1. The server checks phone + password and stores only the hash of the secret.
  const { data, error } = await client.rpc("chama_device_register", {
    p_phone: String(phone).trim(),
    p_password: password,
    p_device_id: deviceId,
    p_label: (label || defaultLabel()).slice(0, 60),
    p_platform: Capacitor.getPlatform(),
    p_secret: secret,
  });
  if (error) return { ok: false, status: isNetworkError(error) ? "offline" : "server_error", detail: error.message };
  if (!data?.ok) {
    if (data?.reason === "INVALID_CREDENTIALS") return { ok: false, status: "wrong_password" };
    if (data?.reason === "RATE_LIMITED") return { ok: false, status: "rate_limited" };
    return { ok: false, status: "server_error", detail: data?.reason };
  }

  // 2. Keep the secret behind the fingerprint. On Android this shows the ONE fingerprint prompt.
  await vaultDelete(SERVICE);
  const stored = await vaultProtectedSet(SERVICE, deviceId, secret, { title: "Turn on fingerprint sign-in" });
  if (!stored.ok) {
    try { await client.rpc("chama_device_revoke", { p_device_id: deviceId, p_secret: secret }); } catch { /* best effort */ }
    return { ok: false, status: stored.status === BioStatus.UNKNOWN ? "vault_error" : stored.status, detail: stored.detail };
  }

  await prefSet(TRUST_KEY, JSON.stringify({ enabled: true, since: Date.now() }));
  return { ok: true };
}

// ---- check this phone's device with the server ----------------------------
// Shared by signInWithChamaFingerprint (no session) and unlockChamaFingerprint (app lock).
async function verifyDevice({ client, reason }) {
  if (!(await isEnabled(SERVICE))) return { ok: false, status: "not_enabled" };

  const got = await vaultProtectedGet(SERVICE, { reason });
  if (!got.ok) {
    if (keyIsGone(got.status)) {
      await clearLocal();
      return { ok: false, status: BioStatus.INVALIDATED };
    }
    return { ok: false, status: got.status };            // cancelled / failed / locked out: nothing is wiped
  }

  const { data, error } = await client.rpc("chama_device_login", { p_device_id: got.deviceId, p_secret: got.secret });
  if (error) return { ok: false, status: isNetworkError(error) ? "offline" : "server_error" };
  if (data?.ok && data.user?.user_id) return { ok: true, user: data.user };

  switch (data?.reason) {
    case "REVOKED":
    case "INVALID":
      await clearLocal();
      return { ok: false, status: "revoked" };
    case "RATE_LIMITED":
      return { ok: false, status: BioStatus.LOCKED_OUT };
    case "ACCOUNT_INACTIVE":
      return { ok: false, status: "account_inactive" };
    default:
      return { ok: false, status: "server_error" };
  }
}

// ---- sign in (no session yet) ------------------------------------------
/** -> { ok:true, user:{ user_id, full_name, phone_number } } or { ok:false, status }. The caller continues the Chama login with `user`. */
export async function signInWithChamaFingerprint({ client, reason = "Sign in to Umova Chama" }) {
  return verifyDevice({ client, reason });
}

// ---- unlock (app lock; a Chama session already exists) -----------------------
/**
 * Fingerprint unlock. `expectedUserId` is the signed-in Chama user; if this phone's fingerprint was turned on by a
 * different Chama user, it is not honoured and the local setup is wiped.
 * Offline: the fingerprint check passed and the session is local, so the UI may open (re-checked next time online).
 */
export async function unlockChamaFingerprint({ client, expectedUserId, reason = "Unlock Umova Chama" }) {
  const r = await verifyDevice({ client, reason });
  if (r.ok) {
    if (expectedUserId && String(r.user.user_id) !== String(expectedUserId)) {
      await clearLocal();
      return { ok: false, status: "revoked" };
    }
    return { ok: true };
  }
  if (r.status === "offline") return { ok: true, unverified: true };
  return r;
}

// ---- turn off ----------------------------------------------------------
/**
 * Turns fingerprint off on this phone. It tries to tell the server too, which needs the device secret and so one
 * fingerprint prompt; if that is cancelled or fails, it still turns off locally. That is safe: the secret lives only in
 * the vault entry deleted here, so a leftover server row can never be used again.
 */
export async function disableChamaFingerprint({ client }) {
  try {
    const got = await vaultProtectedGet(SERVICE, { reason: "Turn off fingerprint sign-in" });
    if (got.ok) await client.rpc("chama_device_revoke", { p_device_id: got.deviceId, p_secret: got.secret });
  } catch { /* best effort */ }
  await clearLocal();
  return { ok: true };
}
