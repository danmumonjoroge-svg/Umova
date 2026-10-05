import { Capacitor } from "@capacitor/core";
import {
  SecureStorage,
} from "@aparajita/capacitor-secure-storage";

/**
 * Secure storage adapter for Supabase Auth.
 *
 * On Android/iOS:
 *   Uses @aparajita/capacitor-secure-storage.
 *
 * On web:
 *   Falls back to window.sessionStorage.
 *
 * Supabase expects a storage object with:
 *   getItem()
 *   setItem()
 *   removeItem()
 */
const isNativeApp = () => {
  return Capacitor.isNativePlatform();
};

/**
 * Web storage fallback.
 */
function getWebStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage;
}

/**
 * Get an item from secure storage.
 */
async function getItem(key) {
  try {
    /**
     * Browser:
     * Keep the existing sessionStorage behaviour.
     */
    if (!isNativeApp()) {
      return getWebStorage()?.getItem(key) ?? null;
    }

    /**
     * Native:
     * Read from Android/iOS secure storage.
     */
    const result = await SecureStorage.get({
      key,
    });

    if (
      result === null ||
      result === undefined
    ) {
      return null;
    }

    /**
     * The plugin returns the stored value.
     */
    if (
      typeof result === "object" &&
      "value" in result
    ) {
      return result.value ?? null;
    }

    return result;
  } catch (error) {
    /**
     * Supabase may request a key that does not exist.
     * Treat that as an empty value rather than crashing
     * the application.
     */
    console.warn(
      "Secure auth storage get warning:",
      error
    );

    return null;
  }
}

/**
 * Store an item.
 */
async function setItem(key, value) {
  /**
   * Browser:
   * Continue using sessionStorage.
   */
  if (!isNativeApp()) {
    const storage = getWebStorage();

    if (!storage) {
      throw new Error(
        "Browser sessionStorage is unavailable."
      );
    }

    storage.setItem(key, value);
    return;
  }

  /**
   * Native:
   * Store the Supabase session in encrypted native storage.
   *
   * The secure-storage plugin supports string, number,
   * boolean, arrays and objects, but Supabase gives us
   * a string, so we preserve it exactly.
   */
  await SecureStorage.set({
    key,
    value,
  });
}

/**
 * Remove an item.
 */
async function removeItem(key) {
  /**
   * Browser.
   */
  if (!isNativeApp()) {
    const storage = getWebStorage();

    if (storage) {
      storage.removeItem(key);
    }

    return;
  }

  /**
   * Native.
   */
  try {
    await SecureStorage.remove({
      key,
    });
  } catch (error) {
    /**
     * Removing a key that doesn't exist should not
     * prevent logout or application startup.
     */
    console.warn(
      "Secure auth storage remove warning:",
      error
    );
  }
}

/**
 * Supabase-compatible storage adapter.
 */
export const secureAuthStorage = {
  getItem,
  setItem,
  removeItem,
};

export default secureAuthStorage;