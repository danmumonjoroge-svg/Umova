// src/security/secureVault.js
//
// Two kinds of storage, deliberately separate:
//   vault*  -> the per-service "device secret" in the OS Keystore/Keychain (via the biometric plugin's credential store).
//              Never localStorage. Never the database in raw form (the server keeps only a SHA-256 hash).
//   pref*   -> NON-secret flags only (random device id, "biometric enabled", "asked recently").
//              @capacitor/preferences. Safe to lose; losing it just means "ask the user to set up again".
//
// iOS NOTE: Keychain items survive app uninstall. On reinstall the Preferences flags are gone, so a leftover
// vault entry is never trusted (enable() deletes any stale entry before writing a new one).

import { isNativeApp } from "./nativeBiometric";

const NS = "app.umova.trust.";
let _bio, _prefs;
const bio = async () => (_bio ||= (await import("capacitor-native-biometric")).NativeBiometric);
const prefs = async () => (_prefs ||= (await import("@capacitor/preferences")).Preferences);

// ---- secrets -------------------------------------------------------------
export async function vaultSet(service, deviceId, secret) {
  if (!isNativeApp()) throw new Error("Secure vault is only available in the mobile app.");
  const p = await bio();
  await p.setCredentials({ username: deviceId, password: secret, server: NS + service });
}

export async function vaultGet(service) {
  if (!isNativeApp()) return null;
  try {
    const p = await bio();
    const c = await p.getCredentials({ server: NS + service });
    return c?.password ? { deviceId: c.username, secret: c.password } : null;
  } catch {
    return null; // missing, or the OS invalidated the key
  }
}

export async function vaultDelete(service) {
  if (!isNativeApp()) return;
  try { const p = await bio(); await p.deleteCredentials({ server: NS + service }); } catch { /* already gone */ }
}

// ---- non-secret flags ----------------------------------------------------
export async function prefGet(key) {
  if (!isNativeApp()) return null;
  const { value } = await (await prefs()).get({ key });
  return value ?? null;
}
export async function prefSet(key, value) {
  if (!isNativeApp()) return;
  await (await prefs()).set({ key, value: String(value) });
}
export async function prefRemove(key) {
  if (!isNativeApp()) return;
  await (await prefs()).remove({ key });
}
