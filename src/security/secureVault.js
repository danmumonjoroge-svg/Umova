import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";
import {
  setCredentials,
  getSecureCredentials,
  deleteCredentials,
} from "@capgo/capacitor-native-biometric";

const NAMESPACE = "umova-secure-vault-v1";

const isNativeApp = () => Capacitor.isNativePlatform();

const getServerKey = (service) => {
  return `${NAMESPACE}:${service}`;
};

/**
 * Store a secret for a trusted device.
 *
 * On native Android/iOS:
 * - The secret is stored using the native biometric-protected credential store.
 * - BIOMETRY_CURRENT_SET means the credential becomes invalid if the
 *   enrolled biometric set changes.
 *
 * On web:
 * - We do NOT pretend browser storage is equivalent to native secure storage.
 * - This vault is intended primarily for the native mobile app.
 */
export async function vaultSet(service, deviceId, secret) {
  if (!service || !deviceId || !secret) {
    throw new Error("Missing secure vault information.");
  }

  if (!isNativeApp()) {
    throw new Error("Secure vault is only available on the native app.");
  }

  const server = getServerKey(service);

  await setCredentials({
    username: deviceId,
    password: secret,
    server,
    accessControl: "BIOMETRY_CURRENT_SET",
    authValidityDuration: 0,
    title: "Protect Umova",
    description: "Biometric authentication is required to access your trusted device.",
    negativeButtonText: "Cancel",
  });

  // Non-secret metadata only.
  await Preferences.set({
    key: `${NAMESPACE}:enabled:${service}`,
    value: "true",
  });

  await Preferences.set({
    key: `${NAMESPACE}:device:${service}`,
    value: deviceId,
  });
}

/**
 * Retrieve the protected trusted-device secret.
 *
 * This call itself triggers the phone's biometric authentication.
 * We intentionally use getSecureCredentials() rather than first calling
 * verifyIdentity() and then reading an unprotected credential.
 */
export async function vaultGet(service, reason = "Authenticate to continue") {
  if (!service) {
    throw new Error("Missing secure vault service.");
  }

  if (!isNativeApp()) {
    throw new Error("Secure vault is only available on the native app.");
  }

  const server = getServerKey(service);

  const result = await getSecureCredentials({
    server,
    reason,
    title: "Unlock Umova",
    description: reason,
    negativeButtonText: "Cancel",
  });

  if (!result || !result.username || !result.password) {
    throw new Error("No protected credentials were found.");
  }

  return {
    deviceId: result.username,
    secret: result.password,
  };
}

/**
 * Delete the biometric-protected trusted-device secret.
 */
export async function vaultDelete(service) {
  if (!service) return;

  if (isNativeApp()) {
    const server = getServerKey(service);

    try {
      await deleteCredentials({
        server,
      });
    } catch (error) {
      // It is safe to continue if the credential does not already exist.
      console.warn("Secure vault delete warning:", error);
    }
  }

  await Preferences.remove({
    key: `${NAMESPACE}:enabled:${service}`,
  });

  await Preferences.remove({
    key: `${NAMESPACE}:device:${service}`,
  });
}

/**
 * Check whether this service has a locally enabled trusted device.
 *
 * This does NOT authenticate the user.
 * It only checks non-secret local metadata.
 */
export async function vaultIsEnabled(service) {
  if (!service) return false;

  if (!isNativeApp()) {
    return false;
  }

  const { value } = await Preferences.get({
    key: `${NAMESPACE}:enabled:${service}`,
  });

  return value === "true";
}

/**
 * Get the locally stored device ID.
 *
 * Device ID is not the secret, so it may safely live in Preferences.
 */
export async function vaultGetDeviceId(service) {
  if (!service) return null;

  if (!isNativeApp()) {
    return null;
  }

  const { value } = await Preferences.get({
    key: `${NAMESPACE}:device:${service}`,
  });

  return value || null;
}

/**
 * Clear all vault information for a service.
 */
export async function vaultClear(service) {
  await vaultDelete(service);
}