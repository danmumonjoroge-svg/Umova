import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";
import {
  authenticate,
  isBiometricAvailable,
} from "./nativeBiometric";

import {
  vaultSet,
  vaultGet,
  vaultDelete,
  vaultIsEnabled,
  vaultGetDeviceId,
} from "./secureVault";

const DEVICE_NAMESPACE = "umova-device-trust-v2";

const SERVICES = {
  finance: "finance",
  business: "business",
  chama: "chama",
};

/**
 * Trusted-device authentication is only intended for the native
 * mobile application.
 */
function isNativeApp() {
  return Capacitor.isNativePlatform();
}

/**
 * Generate a random installation/device identifier.
 */
function generateDeviceId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  const randomPart = Math.random()
    .toString(36)
    .substring(2, 12);

  return `umova-${Date.now()}-${randomPart}`;
}

/**
 * Generate a cryptographically strong secret.
 */
function generateSecret() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);

    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  throw new Error(
    "Secure random number generation is not available on this device."
  );
}

/**
 * Get the current Supabase session.
 */
async function getCurrentSession(client) {
  if (!client?.auth) {
    throw new Error("Supabase client is not available.");
  }

  const {
    data,
    error,
  } = await client.auth.getSession();

  if (error) {
    throw error;
  }

  return data?.session || null;
}

/**
 * Get the currently authenticated user's ID.
 */
async function getCurrentUserId(client) {
  const session = await getCurrentSession(client);

  return session?.user?.id || null;
}

/**
 * Local metadata key.
 *
 * This is NOT a secret.
 */
function metadataKey(service) {
  return `${DEVICE_NAMESPACE}:metadata:${service}`;
}

/**
 * Save non-secret local metadata.
 */
async function saveMetadata(service, metadata) {
  await Preferences.set({
    key: metadataKey(service),
    value: JSON.stringify(metadata),
  });
}

/**
 * Read non-secret local metadata.
 */
async function getMetadata(service) {
  const { value } = await Preferences.get({
    key: metadataKey(service),
  });

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Remove local metadata.
 */
async function clearMetadata(service) {
  await Preferences.remove({
    key: metadataKey(service),
  });
}

/**
 * Validate service name.
 */
function normalizeService(service) {
  if (!Object.values(SERVICES).includes(service)) {
    throw new Error(`Unsupported trusted-device service: ${service}`);
  }

  return service;
}

/**
 * Check whether trusted-device biometric authentication is
 * available on this device.
 */
export async function canUseBiometric() {
  if (!isNativeApp()) {
    return {
      available: false,
      reason: "not_native",
    };
  }

  return await isBiometricAvailable();
}

/**
 * Check whether biometric trusted-device access is enabled
 * for the currently logged-in user.
 *
 * IMPORTANT:
 * This only checks local metadata.
 * It does not authenticate the user.
 */
export async function isEnabled(service, client) {
  service = normalizeService(service);

  if (!isNativeApp()) {
    return false;
  }

  const userId = await getCurrentUserId(client);

  if (!userId) {
    return false;
  }

  const metadata = await getMetadata(service);

  if (!metadata) {
    return false;
  }

  /**
   * Protect against another user using the same physical phone.
   *
   * If the locally trusted device belongs to another Supabase
   * user, clear the local trust information.
   */
  if (metadata.userId !== userId) {
    await clearTrustedDevice(service);
    return false;
  }

  const vaultEnabled = await vaultIsEnabled(service);

  if (!vaultEnabled) {
    await clearMetadata(service);
    return false;
  }

  return true;
}

/**
 * Enable biometric trusted-device access.
 *
 * Flow:
 *
 * 1. Confirm native device.
 * 2. Confirm biometric is available.
 * 3. Confirm the current Supabase user.
 * 4. Ask for biometric authentication.
 * 5. Generate a random trusted-device secret.
 * 6. Store the secret inside the native biometric-protected vault.
 * 7. Register the trusted device with the Supabase server.
 * 8. Store only non-secret metadata locally.
 */
export async function enable(service, client) {
  service = normalizeService(service);

  if (!isNativeApp()) {
    return {
      ok: false,
      reason: "not_native",
    };
  }

  if (!client) {
    throw new Error("Supabase client is required.");
  }

  const userId = await getCurrentUserId(client);

  if (!userId) {
    throw new Error(
      "You must be logged in before enabling biometric authentication."
    );
  }

  const availability = await canUseBiometric();

  if (!availability?.available) {
    return {
      ok: false,
      reason:
        availability?.reason ||
        "biometric_unavailable",
      error: availability?.error || null,
    };
  }

  /**
   * First biometric verification.
   *
   * This proves that the person enabling trusted-device access
   * is physically present.
   */
  const authentication = await authenticate(
    "Confirm your identity to enable biometric login."
  );

  if (!authentication?.ok) {
    return {
      ok: false,
      reason:
        authentication?.reason ||
        "authentication_failed",
      error: authentication?.error || null,
    };
  }

  const deviceId = generateDeviceId();
  const secret = generateSecret();

  /**
   * Register the trusted device with the server first.
   *
   * The secret is sent only through the authenticated Supabase
   * session. The server should hash/store it securely and should
   * never return the secret later.
   */
  const { data, error } = await client.rpc(
    "register_trusted_device",
    {
      p_user_id: userId,
      p_service: service,
      p_device_id: deviceId,
      p_secret: secret,
    }
  );

  if (error) {
    throw error;
  }

  if (data === false) {
    throw new Error(
      "The server rejected trusted-device registration."
    );
  }

  /**
   * Store the secret ONLY after the server has accepted it.
   *
   * vaultSet protects it with the device's biometric system.
   */
  try {
    await vaultSet(
      service,
      deviceId,
      secret
    );
  } catch (vaultError) {
    /**
     * If secure storage fails, immediately attempt to remove
     * the server-side trusted-device registration so we don't
     * leave a trusted device that the phone cannot use.
     */
    try {
      await client.rpc(
        "revoke_trusted_device",
        {
          p_user_id: userId,
          p_service: service,
          p_device_id: deviceId,
        }
      );
    } catch (cleanupError) {
      console.warn(
        "Trusted-device cleanup warning:",
        cleanupError
      );
    }

    throw vaultError;
  }

  await saveMetadata(service, {
    version: 2,
    userId,
    deviceId,
    enabledAt: new Date().toISOString(),
  });

  return {
    ok: true,
    service,
    deviceId,
  };
}

/**
 * Unlock a trusted device.
 *
 * IMPORTANT:
 *
 * vaultGet() itself invokes the biometric-protected native
 * credential retrieval. Therefore we DO NOT call authenticate()
 * immediately before vaultGet().
 *
 * Otherwise the user could receive two biometric prompts.
 */
export async function unlock(
  service,
  client,
  options = {}
) {
  service = normalizeService(service);

  if (!isNativeApp()) {
    return {
      ok: false,
      reason: "not_native",
    };
  }

  if (!client) {
    throw new Error("Supabase client is required.");
  }

  const userId = await getCurrentUserId(client);

  if (!userId) {
    return {
      ok: false,
      reason: "not_authenticated",
    };
  }

  const enabled = await isEnabled(
    service,
    client
  );

  if (!enabled) {
    return {
      ok: false,
      reason: "not_enabled",
    };
  }

  let protectedCredentials;

  /**
   * This is where the Android biometric prompt happens.
   *
   * The secret is released only after successful biometric
   * authentication.
   */
  try {
    protectedCredentials = await vaultGet(
      service,
      options.reason ||
        "Authenticate to unlock Umova."
    );
  } catch (error) {
    return {
      ok: false,
      reason:
        error?.reason ||
        "biometric_failed",
      error,
    };
  }

  if (
    !protectedCredentials?.deviceId ||
    !protectedCredentials?.secret
  ) {
    return {
      ok: false,
      reason: "protected_credentials_missing",
    };
  }

  const metadata = await getMetadata(service);

  /**
   * Verify that the protected device identity belongs to
   * the currently authenticated user.
   */
  if (
    !metadata ||
    metadata.userId !== userId ||
    metadata.deviceId !==
      protectedCredentials.deviceId
  ) {
    await clearTrustedDevice(service);

    return {
      ok: false,
      reason: "device_user_mismatch",
    };
  }

  /**
   * Server-side trusted-device verification.
   *
   * The biometric itself never grants permissions.
   * The server still decides whether this trusted device
   * is valid.
   */
  try {
    const { data, error } =
      await client.rpc(
        "verify_trusted_device",
        {
          p_user_id: userId,
          p_service: service,
          p_device_id:
            protectedCredentials.deviceId,
          p_secret:
            protectedCredentials.secret,
        }
      );

    if (error) {
      throw error;
    }

    if (!data) {
      return {
        ok: false,
        reason: "trusted_device_rejected",
      };
    }

    return {
      ok: true,
      verified: true,
      service,
      userId,
      deviceId:
        protectedCredentials.deviceId,
    };
  } catch (error) {
    /**
     * Network failure is different from authentication failure.
     *
     * We allow the application to report that local biometric
     * authentication succeeded, but callers MUST NOT treat
     * this as server authorization for financial transactions.
     *
     * This is useful for opening cached/view-only screens when
     * temporarily offline.
     */
    if (isNetworkError(error)) {
      return {
        ok: true,
        verified: false,
        unverified: true,
        offline: true,
        service,
        userId,
        deviceId:
          protectedCredentials.deviceId,
        warning:
          "Biometric authentication succeeded, but the trusted device could not be verified with the server because the network is unavailable.",
      };
    }

    return {
      ok: false,
      reason: "server_verification_failed",
      error,
    };
  }
}

/**
 * Password fallback.
 *
 * This is intentionally separate from biometric trusted-device
 * authentication.
 */
export async function verifyPassword(
  client,
  email,
  password
) {
  if (!client?.auth) {
    throw new Error("Supabase client is not available.");
  }

  if (!email || !password) {
    return {
      ok: false,
      reason: "missing_credentials",
    };
  }

  const {
    data,
    error,
  } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return {
      ok: false,
      reason: "invalid_credentials",
      error,
    };
  }

  return {
    ok: true,
    session: data?.session || null,
    user: data?.user || null,
  };
}

/**
 * Disable trusted-device access.
 *
 * Revokes the device on the server and removes the local
 * biometric-protected secret.
 */
export async function disable(
  service,
  client
) {
  service = normalizeService(service);

  if (!isNativeApp()) {
    return {
      ok: true,
    };
  }

  const userId = await getCurrentUserId(client);
  const deviceId =
    await vaultGetDeviceId(service);

  /**
   * Revoke on server when possible.
   */
  if (userId && deviceId && client?.rpc) {
    try {
      await client.rpc(
        "revoke_trusted_device",
        {
          p_user_id: userId,
          p_service: service,
          p_device_id: deviceId,
        }
      );
    } catch (error) {
      console.warn(
        "Trusted-device server revoke warning:",
        error
      );
    }
  }

  await clearTrustedDevice(service);

  return {
    ok: true,
  };
}

/**
 * Clear local trusted-device information.
 */
export async function clearTrustedDevice(
  service
) {
  service = normalizeService(service);

  await vaultDelete(service);
  await clearMetadata(service);
}

/**
 * Revoke every trusted device for the current user/service.
 */
export async function revokeAll(
  service,
  client
) {
  service = normalizeService(service);

  const userId = await getCurrentUserId(client);

  if (!userId) {
    return {
      ok: false,
      reason: "not_authenticated",
    };
  }

  if (client?.rpc) {
    try {
      const { error } = await client.rpc(
        "revoke_all_trusted_devices",
        {
          p_user_id: userId,
          p_service: service,
        }
      );

      if (error) {
        throw error;
      }
    } catch (error) {
      return {
        ok: false,
        reason: "server_revoke_failed",
        error,
      };
    }
  }

  await clearTrustedDevice(service);

  return {
    ok: true,
  };
}

/**
 * List trusted devices from the server.
 */
export async function listTrustedDevices(
  service,
  client
) {
  service = normalizeService(service);

  const userId = await getCurrentUserId(client);

  if (!userId) {
    return {
      ok: false,
      reason: "not_authenticated",
      devices: [],
    };
  }

  const {
    data,
    error,
  } = await client.rpc(
    "list_trusted_devices",
    {
      p_user_id: userId,
      p_service: service,
    }
  );

  if (error) {
    return {
      ok: false,
      reason: "server_error",
      error,
      devices: [],
    };
  }

  return {
    ok: true,
    devices: data || [],
  };
}

/**
 * Determine whether an error looks like a network problem.
 */
function isNetworkError(error) {
  const message =
    String(
      error?.message ||
        error?.error ||
        ""
    ).toLowerCase();

  const code = String(
    error?.code || ""
  ).toLowerCase();

  return (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("failed to fetch") ||
    message.includes("offline") ||
    message.includes("connection") ||
    code === "network_error" ||
    code === "fetch_error"
  );
}

export default {
  canUseBiometric,
  isEnabled,
  enable,
  unlock,
  verifyPassword,
  disable,
  clearTrustedDevice,
  revokeAll,
  listTrustedDevices,
};