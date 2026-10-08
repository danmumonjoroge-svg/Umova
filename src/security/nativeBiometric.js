// src/security/nativeBiometric.js
//
// The ONLY file that talks to the OS biometric prompt. The OS verifies the fingerprint/face;
// we only ever receive success/failure. No biometric data is read, stored or transmitted.
//
// Plugin: @capgo/capacitor-native-biometric (Capacitor 8). Loaded lazily so the plain web build
// never runs it. secureVault.js gets the SAME plugin instance from loadBiometric() below, so
// there is exactly one place in the app that names the package.

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

// Verified against @capgo/capacitor-native-biometric 8.6.11 (BiometricAuthError in definitions.d.ts).
// 11-13 are iOS-only; 21 = no biometric-protected credential found (never saved, deleted, or the
// Keystore key was invalidated because the phone's fingerprints changed).
const CODE_MAP = {
  1: BioStatus.UNAVAILABLE,   // BIOMETRICS_UNAVAILABLE
  2: BioStatus.LOCKED_OUT,    // USER_LOCKOUT
  3: BioStatus.NOT_ENROLLED,  // BIOMETRICS_NOT_ENROLLED
  4: BioStatus.LOCKED_OUT,    // USER_TEMPORARY_LOCKOUT
  10: BioStatus.FAILED,       // AUTHENTICATION_FAILED
  11: BioStatus.CANCELLED,    // APP_CANCEL (iOS)
  14: BioStatus.UNAVAILABLE,  // PASSCODE_NOT_SET (no device screen lock)
  15: BioStatus.CANCELLED,    // SYSTEM_CANCEL
  16: BioStatus.CANCELLED,    // USER_CANCEL (also the Android negative button)
  17: BioStatus.FALLBACK,     // USER_FALLBACK
  21: BioStatus.INVALIDATED,  // NO_PROTECTED_CREDENTIALS_FOUND
};

export function mapBioError(e) {
  const code = Number(e?.code ?? e?.errorCode);
  if (CODE_MAP[code]) return CODE_MAP[code];
  const msg = String(e?.message || e || "");
  if (/invalidat|permanently|no protected credentials/i.test(msg)) return BioStatus.INVALIDATED;
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
    case BioStatus.LOCKED_OUT:   return "Fingerprint temporarily unavailable. Use your password instead.";
    case BioStatus.FAILED:       return "Not recognised. Try again or use your password.";
    case BioStatus.INVALIDATED:  return "Your phone's fingerprints or face data changed. For your safety, sign in with your password and turn fingerprint sign-in on again.";
    case BioStatus.CANCELLED:
    case BioStatus.FALLBACK:     return "";
    default:                     return "Fingerprint sign-in isn't working right now. Use your password.";
  }
}

let _holder;
/**
 * The one and only loader for the biometric plugin. secureVault.js uses this too.
 * Resolves to { plugin } -- NEVER to the plugin itself. A Capacitor plugin is a Proxy that answers every
 * property (including `then`), so returning it from an async function throws
 * `"NativeBiometric.then()" is not implemented on android`. Always destructure: const { plugin } = await loadBiometric();
 */
export async function loadBiometric() {
  if (!_holder) _holder = { plugin: (await import("@capgo/capacitor-native-biometric")).NativeBiometric };
  return _holder;
}

/**
 * What can this device do right now?
 * -> { native, available, biometric, deviceCredentialOnly, type, status }
 *   biometric            : a STRONG fingerprint/face is enrolled and usable. Strong is required because the
 *                          Keystore-protected vault (secureVault.js) needs a biometric the OS rates as strong.
 *   deviceCredentialOnly : no biometric, but the phone has a PIN/pattern (we do NOT treat this as biometric login)
 */
export async function checkBiometry() {
  if (!isNativeApp()) return { native: false, available: false, biometric: false, deviceCredentialOnly: false, status: BioStatus.UNAVAILABLE };
  try {
    const { plugin: p } = await loadBiometric();
    const bio = await p.isAvailable({ useFallback: false });
    if (bio?.isAvailable && bio.strongBiometryIsAvailable !== false) {
      return { native: true, available: true, biometric: true, deviceCredentialOnly: false, type: bio.biometryType, status: BioStatus.OK };
    }
    if (bio?.isAvailable) {
      // Only a weak biometric (e.g. basic face unlock): fine for nothing here, so treat as unavailable.
      return { native: true, available: false, biometric: false, deviceCredentialOnly: false, status: BioStatus.UNAVAILABLE };
    }
    const any = await p.isAvailable({ useFallback: true });
    const mapped = mapBioError({ code: bio?.errorCode });
    return {
      native: true, available: false, biometric: false,
      deviceCredentialOnly: !!any?.isAvailable,
      status: mapped === BioStatus.UNKNOWN ? BioStatus.UNAVAILABLE : mapped,
    };
  } catch (e) {
    return { native: true, available: false, biometric: false, deviceCredentialOnly: false, status: mapBioError(e) };
  }
}

/** Simple yes/no: can this phone do fingerprint sign-in right now? */
export async function isBiometricAvailable() {
  return !!(await checkBiometry()).biometric;
}

/**
 * Show the OS prompt.
 * On Android the prompt is biometric-only; the plugin ignores `useFallback` there, so the negative button is
 * labelled "Use password" and tapping it comes back as CANCELLED (the screens then show the password option).
 * allowDeviceCredential only has an effect on iOS.
 * -> { ok:true } | { ok:false, status: BioStatus.* }
 */
export async function authenticate({ reason = "Unlock Umova", title = "Umova", allowDeviceCredential = true } = {}) {
  if (!isNativeApp()) return { ok: false, status: BioStatus.UNAVAILABLE };
  try {
    const { plugin: p } = await loadBiometric();
    await p.verifyIdentity({
      reason, title,
      negativeButtonText: "Use password",
      useFallback: allowDeviceCredential,
      maxAttempts: 3,
    });
    return { ok: true, status: BioStatus.OK };
  } catch (e) {
    return { ok: false, status: mapBioError(e) };
  }
}
