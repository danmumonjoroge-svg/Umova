// src/security/nativeBiometric.js
//
// The ONLY file that talks to the OS biometric prompt. The OS verifies the fingerprint/face;
// we only ever receive success/failure. No biometric data is read, stored or transmitted.
//
// Plugin: capacitor-native-biometric (loaded lazily so the plain web build never touches it).
// If you swap plugins later, this file and secureVault.js are the only two that change.

import { Capacitor } from "@capacitor/core";

export const isNativeApp = () => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

export const BioStatus = Object.freeze({
  OK: "ok",
  UNAVAILABLE: "unavailable",     // no hardware / no screen lock
  NOT_ENROLLED: "not_enrolled",   // hardware present, nothing enrolled
  CANCELLED: "cancelled",         // user dismissed the prompt
  FALLBACK: "fallback",           // user tapped "use password/PIN" in the prompt
  LOCKED_OUT: "locked_out",       // too many failed attempts (temporary or permanent)
  FAILED: "failed",               // not recognised
  INVALIDATED: "invalidated",     // biometric set changed / key gone -> must re-enrol
  UNKNOWN: "unknown",
});

// capacitor-native-biometric's numeric errorCode values. VERIFY against the README of the
// version you install; anything not listed safely falls through to the message heuristics below.
const CODE_MAP = {
  1: BioStatus.UNAVAILABLE,   // BIOMETRICS_UNAVAILABLE
  2: BioStatus.LOCKED_OUT,    // USER_LOCKOUT
  3: BioStatus.NOT_ENROLLED,  // BIOMETRICS_NOT_ENROLLED
  4: BioStatus.LOCKED_OUT,    // USER_TEMPORARY_LOCKOUT
  10: BioStatus.FAILED,       // AUTHENTICATION_FAILED
  11: BioStatus.CANCELLED,    // APP_CANCEL
  14: BioStatus.UNAVAILABLE,  // PASSCODE_NOT_SET (no device screen lock)
  15: BioStatus.CANCELLED,    // SYSTEM_CANCEL
  16: BioStatus.CANCELLED,    // USER_CANCEL
  17: BioStatus.FALLBACK,     // USER_FALLBACK
};

export function mapBioError(e) {
  const code = Number(e?.code ?? e?.errorCode);
  if (CODE_MAP[code]) return CODE_MAP[code];
  const msg = String(e?.message || e || "");
  if (/invalidat|permanently/i.test(msg)) return BioStatus.INVALIDATED;
  if (/cancel/i.test(msg)) return BioStatus.CANCELLED;
  if (/lock/i.test(msg)) return BioStatus.LOCKED_OUT;
  if (/not.?enrolled|no biometric|none enrolled/i.test(msg)) return BioStatus.NOT_ENROLLED;
  if (/unavailable|not available|no hardware/i.test(msg)) return BioStatus.UNAVAILABLE;
  return BioStatus.UNKNOWN;
}

/** Plain-language text for each status, shared by every screen so wording stays consistent. */
export function bioMessage(status) {
  switch (status) {
    case BioStatus.UNAVAILABLE:  return "This phone doesn't support fingerprint or face unlock, or has no screen lock set.";
    case BioStatus.NOT_ENROLLED: return "No fingerprint or face is set up on this phone yet. Add one in your phone's Settings, then try again.";
    case BioStatus.LOCKED_OUT:   return "Too many attempts. Use your password, or try again shortly.";
    case BioStatus.FAILED:       return "Not recognised. Try again or use your password.";
    case BioStatus.INVALIDATED:  return "Your phone's fingerprints or face data changed. For your safety, sign in with your password and turn fingerprint sign-in on again.";
    case BioStatus.CANCELLED:
    case BioStatus.FALLBACK:     return "";
    default:                     return "Fingerprint sign-in isn't working right now. Use your password.";
  }
}

let _plugin;
async function plugin() {
  if (!_plugin) _plugin = (await import("capacitor-native-biometric")).NativeBiometric;
  return _plugin;
}

/**
 * What can this device do right now?
 * -> { native, available, biometric, deviceCredentialOnly, type, status }
 *   biometric            : fingerprint/face is enrolled and usable
 *   deviceCredentialOnly : no biometric, but the phone has a PIN/pattern (we do NOT treat this as biometric login)
 */
export async function checkBiometry() {
  if (!isNativeApp()) return { native: false, available: false, biometric: false, deviceCredentialOnly: false, status: BioStatus.UNAVAILABLE };
  try {
    const p = await plugin();
    const bio = await p.isAvailable({ useFallback: false });
    if (bio?.isAvailable) {
      return { native: true, available: true, biometric: true, deviceCredentialOnly: false, type: bio.biometryType, status: BioStatus.OK };
    }
    const any = await p.isAvailable({ useFallback: true });
    return {
      native: true, available: false, biometric: false,
      deviceCredentialOnly: !!any?.isAvailable,
      status: mapBioError({ code: bio?.errorCode }) === BioStatus.UNKNOWN ? BioStatus.UNAVAILABLE : mapBioError({ code: bio?.errorCode }),
    };
  } catch (e) {
    return { native: true, available: false, biometric: false, deviceCredentialOnly: false, status: mapBioError(e) };
  }
}

/**
 * Show the OS prompt.
 * allowDeviceCredential=true  -> phone PIN/pattern is accepted as an alternative (fine for app unlock)
 * allowDeviceCredential=false -> biometric only (use for sensitive actions: a phone PIN is easy to shoulder-surf)
 * -> { ok:true } | { ok:false, status: BioStatus.* }
 */
export async function authenticate({ reason = "Unlock Umova", title = "Umova", allowDeviceCredential = true } = {}) {
  if (!isNativeApp()) return { ok: false, status: BioStatus.UNAVAILABLE };
  try {
    const p = await plugin();
    await p.verifyIdentity({ reason, title, useFallback: allowDeviceCredential, maxAttempts: 3 });
    return { ok: true, status: BioStatus.OK };
  } catch (e) {
    return { ok: false, status: mapBioError(e) };
  }
}
