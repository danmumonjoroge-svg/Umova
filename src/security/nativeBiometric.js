import { Capacitor } from "@capacitor/core";

const PLUGIN_NAME = "@capgo/capacitor-native-biometric";

/**
 * Load the biometric plugin only on native platforms.
 *
 * This prevents the web version of Umova from trying to load
 * native Android/iOS biometric functionality.
 */
async function getBiometricPlugin() {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  return await import(PLUGIN_NAME);
}

/**
 * Convert native biometric errors into something the rest
 * of the application can understand consistently.
 */
function normalizeBiometricError(error) {
  const code =
    Number(
      error?.code ??
        error?.errorCode ??
        error?.details?.code ??
        error?.details?.errorCode
    ) || 0;

  const message =
    error?.message ||
    error?.error ||
    error?.details?.message ||
    "Biometric authentication failed.";

  const errorInfo = {
    code,
    message,
    raw: error,
  };

  switch (code) {
    case 1:
      errorInfo.reason = "unavailable";
      errorInfo.userMessage =
        "Biometric authentication is not available on this device.";
      break;

    case 2:
      errorInfo.reason = "lockout";
      errorInfo.userMessage =
        "Biometric authentication is temporarily locked. Use your device PIN or password, then try again.";
      break;

    case 3:
      errorInfo.reason = "not_enrolled";
      errorInfo.userMessage =
        "No fingerprint or other biometric is enrolled on this device.";
      break;

    case 4:
      errorInfo.reason = "temporary_lockout";
      errorInfo.userMessage =
        "Biometric authentication is temporarily unavailable. Please try again later.";
      break;

    case 10:
      errorInfo.reason = "failed";
      errorInfo.userMessage =
        "The biometric was not recognized. Please try again.";
      break;

    case 11:
      errorInfo.reason = "app_cancel";
      errorInfo.userMessage = "Biometric authentication was cancelled.";
      break;

    case 12:
      errorInfo.reason = "invalid_context";
      errorInfo.userMessage =
        "Biometric authentication could not be started.";
      break;

    case 13:
      errorInfo.reason = "not_interactive";
      errorInfo.userMessage =
        "Biometric authentication cannot be used right now.";
      break;

    case 14:
      errorInfo.reason = "passcode_not_set";
      errorInfo.userMessage =
        "Please set a screen lock PIN, password, or pattern on your device first.";
      break;

    case 15:
      errorInfo.reason = "system_cancel";
      errorInfo.userMessage =
        "The system cancelled biometric authentication.";
      break;

    case 16:
      errorInfo.reason = "user_cancel";
      errorInfo.userMessage =
        "Biometric authentication was cancelled.";
      break;

    case 17:
      errorInfo.reason = "user_fallback";
      errorInfo.userMessage =
        "Biometric authentication was cancelled.";
      break;

    case 21:
      errorInfo.reason = "no_protected_credentials";
      errorInfo.userMessage =
        "No protected biometric credentials were found on this device.";
      break;

    default:
      errorInfo.reason = "unknown";
      errorInfo.userMessage =
        message || "Biometric authentication failed.";
      break;
  }

  return errorInfo;
}

/**
 * Check whether biometric authentication is available.
 */
export async function isBiometricAvailable() {
  if (!Capacitor.isNativePlatform()) {
    return {
      available: false,
      native: false,
      reason: "not_native",
    };
  }

  try {
    const plugin = await getBiometricPlugin();

    if (!plugin?.NativeBiometric) {
      return {
        available: false,
        native: true,
        reason: "plugin_unavailable",
      };
    }

    const result = await plugin.NativeBiometric.isAvailable();

    return {
      available: Boolean(result?.isAvailable),
      native: true,
      biometryType: result?.biometryType ?? null,
      deviceIsSecure: Boolean(result?.deviceIsSecure),
      strongBiometryIsAvailable: Boolean(
        result?.strongBiometryIsAvailable
      ),
      errorCode: result?.errorCode ?? null,
      raw: result,
    };
  } catch (error) {
    const normalized = normalizeBiometricError(error);

    return {
      available: false,
      native: true,
      reason: normalized.reason,
      error: normalized,
    };
  }
}

/**
 * Perform a standalone biometric authentication.
 *
 * This is useful for operations that need an explicit biometric check.
 *
 * IMPORTANT:
 * This function does NOT grant permissions or user roles.
 * Supabase authentication and server-side authorization remain
 * authoritative.
 */
export async function authenticate(
  reason = "Authenticate to continue"
) {
  if (!Capacitor.isNativePlatform()) {
    return {
      ok: false,
      native: false,
      reason: "not_native",
    };
  }

  try {
    const plugin = await getBiometricPlugin();

    if (!plugin?.NativeBiometric) {
      return {
        ok: false,
        native: true,
        reason: "plugin_unavailable",
      };
    }

    const availability =
      await plugin.NativeBiometric.isAvailable();

    if (!availability?.isAvailable) {
      const normalized = normalizeBiometricError({
        code: availability?.errorCode,
        message:
          "Biometric authentication is not available.",
      });

      return {
        ok: false,
        native: true,
        reason: normalized.reason,
        error: normalized,
      };
    }

    await plugin.NativeBiometric.verifyIdentity({
      reason,
      title: "Unlock Umova",
      subtitle: "Confirm your identity",
      description: reason,
      negativeButtonText: "Cancel",
      maxAttempts: 3,
    });

    return {
      ok: true,
      native: true,
    };
  } catch (error) {
    const normalized = normalizeBiometricError(error);

    return {
      ok: false,
      native: true,
      reason: normalized.reason,
      error: normalized,
    };
  }
}

/**
 * Determine whether a biometric error represents a normal
 * cancellation by the user.
 */
export function isBiometricCancellation(error) {
  const normalized =
    error?.reason
      ? error
      : normalizeBiometricError(error);

  return [
    "user_cancel",
    "app_cancel",
    "system_cancel",
    "user_fallback",
  ].includes(normalized.reason);
}

/**
 * Determine whether the device is temporarily locked out
 * from biometric authentication.
 */
export function isBiometricLockout(error) {
  const normalized =
    error?.reason
      ? error
      : normalizeBiometricError(error);

  return [
    "lockout",
    "temporary_lockout",
  ].includes(normalized.reason);
}

/**
 * Determine whether biometric authentication is unavailable
 * because the device has no enrolled biometric or secure
 * screen lock.
 */
export function isBiometricUnavailable(error) {
  const normalized =
    error?.reason
      ? error
      : normalizeBiometricError(error);

  return [
    "unavailable",
    "not_enrolled",
    "passcode_not_set",
    "plugin_unavailable",
    "not_native",
  ].includes(normalized.reason);
}

/**
 * Expose the normalized error converter for the security layer.
 */
export { normalizeBiometricError };