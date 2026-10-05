import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";

import LockScreen from "./LockScreen";
import EnableBiometricPrompt from "./EnableBiometricPrompt";

import {
  isEnabled,
  unlock as unlockTrustedDevice,
} from "./deviceTrust";

/**
 * How long Umova may remain in the foreground/background
 * before requiring biometric authentication again.
 *
 * 60 seconds = 1 minute.
 */
const BACKGROUND_LOCK_DELAY = 60 * 1000;

/**
 * Default service.
 *
 * Finance is the main service currently being protected.
 */
const DEFAULT_SERVICE = "finance";

const LockContext = createContext(null);

/**
 * Access the current Umova application-lock state.
 */
export function useAppLock() {
  const context = useContext(LockContext);

  if (!context) {
    throw new Error(
      "useAppLock must be used inside <AppLock>."
    );
  }

  return context;
}

/**
 * AppLock protects the authenticated Umova interface.
 *
 * IMPORTANT:
 *
 * AppLock is NOT a replacement for:
 * - Supabase authentication
 * - AuthContext
 * - user roles
 * - Row Level Security
 * - server-side financial authorization
 *
 * It is simply an additional local biometric lock for
 * the already-authenticated mobile application.
 */
export default function AppLock({
  children,
  client,
  service = DEFAULT_SERVICE,
}) {
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState(null);

  const backgroundStartedAt = useRef(null);
  const mountedRef = useRef(true);

  /**
   * Only enable this lock on native mobile platforms.
   *
   * The web version should continue behaving normally.
   */
  const isNative = Capacitor.isNativePlatform();

  /**
   * Check whether biometric trusted-device access is enabled.
   */
  const refreshTrust = useCallback(async () => {
    if (!isNative || !client) {
      if (mountedRef.current) {
        setEnabled(false);
        setLocked(false);
        setLoading(false);
      }

      return false;
    }

    try {
      setLoading(true);
      setError(null);

      const trusted = await isEnabled(
        service,
        client
      );

      if (!mountedRef.current) {
        return trusted;
      }

      setEnabled(trusted);

      /**
       * If trusted-device authentication is enabled,
       * the app starts locked.
       *
       * This is particularly important after a cold start.
       */
      if (trusted) {
        setLocked(true);
      } else {
        setLocked(false);
      }

      return trusted;
    } catch (err) {
      console.error(
        "AppLock trust check failed:",
        err
      );

      if (mountedRef.current) {
        setEnabled(false);
        setLocked(false);
        setError(
          "Unable to check biometric security."
        );
      }

      return false;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [client, isNative, service]);

  /**
   * Lock the application immediately.
   */
  const lockNow = useCallback(() => {
    if (!isNative) {
      return;
    }

    if (!enabled) {
      return;
    }

    setError(null);
    setLocked(true);
  }, [enabled, isNative]);

  /**
   * Unlock the application using the trusted device.
   */
  const unlock = useCallback(async () => {
    if (!isNative) {
      return {
        ok: true,
        native: false,
      };
    }

    if (!client) {
      return {
        ok: false,
        reason: "supabase_client_missing",
      };
    }

    if (!enabled) {
      setLocked(false);

      return {
        ok: true,
        reason: "biometric_not_enabled",
      };
    }

    if (unlocking) {
      return {
        ok: false,
        reason: "unlock_in_progress",
      };
    }

    try {
      setUnlocking(true);
      setError(null);

      const result =
        await unlockTrustedDevice(
          service,
          client,
          {
            reason:
              "Use your fingerprint or device biometric to unlock Umova.",
          }
        );

      if (!mountedRef.current) {
        return result;
      }

      if (result?.ok) {
        /**
         * Both a server-verified unlock and an offline
         * local unlock may open the application UI.
         *
         * However, an offline/unverified result MUST NOT
         * be interpreted as authorization for financial
         * transactions.
         */
        setLocked(false);

        return result;
      }

      /**
       * Keep the application locked if authentication failed.
       */
      setLocked(true);

      const reason =
        result?.reason ||
        result?.error?.reason ||
        "biometric_failed";

      setError(reason);

      return result;
    } catch (err) {
      console.error(
        "AppLock unlock failed:",
        err
      );

      if (mountedRef.current) {
        setLocked(true);
        setError(
          err?.message ||
            "Biometric authentication failed."
        );
      }

      return {
        ok: false,
        reason: "unlock_error",
        error: err,
      };
    } finally {
      if (mountedRef.current) {
        setUnlocking(false);
      }
    }
  }, [
    client,
    enabled,
    isNative,
    service,
    unlocking,
  ]);

  /**
   * Initial trust check.
   */
  useEffect(() => {
    mountedRef.current = true;

    refreshTrust();

    return () => {
      mountedRef.current = false;
    };
  }, [refreshTrust]);

  /**
   * Listen for Android/iOS foreground/background changes.
   *
   * Capacitor's appStateChange event reports whether the
   * application/activity is active.
   */
  useEffect(() => {
    if (!isNative) {
      return undefined;
    }

    let listener;

    const setupListener = async () => {
      listener =
        await CapacitorApp.addListener(
          "appStateChange",
          ({ isActive }) => {
            if (!mountedRef.current) {
              return;
            }

            if (!isActive) {
              /**
               * Remember when the application went into
               * the background.
               */
              backgroundStartedAt.current =
                Date.now();

              return;
            }

            /**
             * Application returned to foreground.
             */
            const backgroundStarted =
              backgroundStartedAt.current;

            backgroundStartedAt.current = null;

            if (!enabled) {
              return;
            }

            /**
             * If there is no timestamp, we cannot determine
             * how long the application was away.
             */
            if (!backgroundStarted) {
              return;
            }

            const elapsed =
              Date.now() -
              backgroundStarted;

            /**
             * Lock after the configured delay.
             */
            if (
              elapsed >=
              BACKGROUND_LOCK_DELAY
            ) {
              setError(null);
              setLocked(true);
            }
          }
        );
    };

    setupListener();

    return () => {
      if (listener) {
        listener.remove();
      }
    };
  }, [enabled, isNative]);

  /**
   * Listen for changes to the trusted-device state.
   *
   * This allows the prompt/lock state to refresh after the
   * user enables or disables biometric authentication.
   */
  useEffect(() => {
    if (!isNative) {
      return undefined;
    }

    const interval = setInterval(() => {
      refreshTrust();
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [isNative, refreshTrust]);

  /**
   * Clear errors when the user starts another unlock attempt.
   */
  useEffect(() => {
    if (!locked) {
      setError(null);
    }
  }, [locked]);

  const contextValue = useMemo(
    () => ({
      locked,
      enabled,
      loading,
      unlocking,
      error,
      lockNow,
      unlock,
      refreshTrust,
    }),
    [
      locked,
      enabled,
      loading,
      unlocking,
      error,
      lockNow,
      unlock,
      refreshTrust,
    ]
  );

  /**
   * On web, AppLock is effectively transparent.
   */
  if (!isNative) {
    return (
      <LockContext.Provider
        value={contextValue}
      >
        {children}
      </LockContext.Provider>
    );
  }

  /**
   * Wait until the initial trusted-device state
   * has been determined.
   */
  if (loading) {
    return (
      <LockContext.Provider
        value={contextValue}
      >
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f7faf8",
            color: "#1f2937",
            fontFamily:
              "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          }}
        >
          <div
            style={{
              textAlign: "center",
              padding: 24,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                border:
                  "4px solid rgba(16, 185, 129, 0.2)",
                borderTopColor:
                  "#10b981",
                margin:
                  "0 auto 16px",
                animation:
                  "umova-spin 0.9s linear infinite",
              }}
            />

            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              Securing Umova...
            </div>

            <style>
              {`
                @keyframes umova-spin {
                  from {
                    transform: rotate(0deg);
                  }
                  to {
                    transform: rotate(360deg);
                  }
                }
              `}
            </style>
          </div>
        </div>
      </LockContext.Provider>
    );
  }

  /**
   * If biometric security is enabled and the application
   * is locked, do not render the protected application
   * underneath the lock screen.
   */
  if (enabled && locked) {
    return (
      <LockContext.Provider
        value={contextValue}
      >
        <LockScreen
          client={client}
          service={service}
          onUnlock={unlock}
          unlocking={unlocking}
          error={error}
        />
      </LockContext.Provider>
    );
  }

  /**
   * Normal authenticated application.
   *
   * The biometric enable prompt may be rendered by the
   * existing EnableBiometricPrompt component when appropriate.
   */
  return (
    <LockContext.Provider
      value={contextValue}
    >
      {children}

      <EnableBiometricPrompt
        client={client}
        service={service}
        onEnabled={refreshTrust}
      />
    </LockContext.Provider>
  );
}