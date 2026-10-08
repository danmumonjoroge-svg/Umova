// src/security/secureVault.js
//
// Two kinds of storage, deliberately separate:
//   vault*  -> the per-service "device secret" in the OS Keystore/Keychain (via the biometric plugin's credential store).
//              Never localStorage. Never the database in raw form (the server keeps only a SHA-256 hash).
//   pref*   -> NON-secret flags only (random device id, "biometric enabled", "asked recently").
//              @capacitor/preferences. Safe to lose; losing it just means "ask the user to set up again".
//
// Two flavours of vault:
//   vaultProtectedSet / vaultProtectedGet  -> the secret is stored with accessControl BIOMETRY_CURRENT_SET:
//        an Android Keystore key that can only be used after a live fingerprint check. The fingerprint prompt
//        IS the read, so there is one prompt and the secret can't be released without it. If the phone's
//        fingerprints change, the key is invalidated and the read fails with BioStatus.INVALIDATED.
//   vaultSet / vaultGet                    -> LEGACY, NOT biometric-protected (accessControl defaults to NONE
//        in the Capgo plugin). Kept only until deviceTrust.js is migrated to the protected pair; then removed.
//
// iOS NOTE: Keychain items survive app uninstall. On reinstall the Preferences flags are gone, so a leftover
// vault entry is never trusted (enable() deletes any stale entry before writing a new one).

import { isNativeApp, loadBiometric, mapBioError, BioStatus } from "./nativeBiometric";

const NS = "app.umova.trust.";
// NEVER return a Capacitor plugin from an async function: it is a Proxy that answers `.then`, so the promise
// machinery calls it and Capacitor throws `"Preferences.then()" is not implemented on android`.
// The plugin is always handed around inside a plain object: const { plugin } = await prefs();
let _prefsHolder;
const prefs = async () => (_prefsHolder ||= { plugin: (await import("@capacitor/preferences")).Preferences });

// ---- protected secrets (use these) ---------------------------------------
/**
 * Store the device secret behind the fingerprint. On Android this itself shows the OS fingerprint prompt
 * (the Keystore key is created biometric-bound). -> { ok:true } | { ok:false, status }
 */
export async function vaultProtectedSet(service, deviceId, secret, { title = "Turn on fingerprint sign-in" } = {}) {
  if (!isNativeApp()) return { ok: false, status: BioStatus.UNAVAILABLE };
  try {
    const { plugin: p } = await loadBiometric();
    const { AccessControl } = await import("@capgo/capacitor-native-biometric");
    await p.setCredentials({
      username: deviceId,
      password: secret,
      server: NS + service,
      accessControl: AccessControl.BIOMETRY_CURRENT_SET,
      title,
      negativeButtonText: "Cancel",
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, status: mapBioError(e), detail: e?.message };
  }
}

/**
 * Release the device secret. Shows the OS fingerprint prompt and only returns the secret if it passes.
 * -> { ok:true, deviceId, secret } | { ok:false, status }
 *    status CANCELLED / FAILED / LOCKED_OUT : trust is still intact, let the user retry or use the password
 *    status INVALIDATED                     : key gone (fingerprints changed / never saved) -> caller wipes trust
 */
export async function vaultProtectedGet(service, { reason = "Unlock Umova", title = "Umova" } = {}) {
  if (!isNativeApp()) return { ok: false, status: BioStatus.UNAVAILABLE };
  try {
    const { plugin: p } = await loadBiometric();
    const c = await p.getSecureCredentials({
      server: NS + service,
      reason,
      title,
      negativeButtonText: "Use password",
    });
    return c?.password
      ? { ok: true, deviceId: c.username, secret: c.password }
      : { ok: false, status: BioStatus.INVALIDATED };
  } catch (e) {
    return { ok: false, status: mapBioError(e), detail: e?.message };
  }
}

// ---- legacy, unprotected (to be removed once deviceTrust.js is migrated) --
export async function vaultSet(service, deviceId, secret) {
  if (!isNativeApp()) throw new Error("Secure vault is only available in the mobile app.");
  const { plugin: p } = await loadBiometric();
  await p.setCredentials({ username: deviceId, password: secret, server: NS + service });
}

export async function vaultGet(service) {
  if (!isNativeApp()) return null;
  try {
    const { plugin: p } = await loadBiometric();
    const c = await p.getCredentials({ server: NS + service });
    return c?.password ? { deviceId: c.username, secret: c.password } : null;
  } catch {
    return null; // missing, or the OS invalidated the key
  }
}

// ---- shared ---------------------------------------------------------------
export async function vaultDelete(service) {
  if (!isNativeApp()) return;
  try { const { plugin: p } = await loadBiometric(); await p.deleteCredentials({ server: NS + service }); } catch { /* already gone */ }
}

// ---- non-secret flags ----------------------------------------------------
export async function prefGet(key) {
  if (!isNativeApp()) return null;
  try {
    const { plugin } = await prefs();
    const { value } = await plugin.get({ key });
    return value ?? null;
  } catch (e) {
    console.error("[secureVault] prefGet failed:", e);
    return null;                       // unreadable flag = "not enabled": the app opens, never hangs
  }
}
export async function prefSet(key, value) {
  if (!isNativeApp()) return;
  const { plugin } = await prefs();
  await plugin.set({ key, value: String(value) });
}
export async function prefRemove(key) {
  if (!isNativeApp()) return;
  try {
    const { plugin } = await prefs();
    await plugin.remove({ key });
  } catch (e) {
    console.error("[secureVault] prefRemove failed:", e);
  }
}
