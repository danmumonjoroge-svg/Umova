import React, { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

import {
  canUseBiometric,
  enable,
} from "./deviceTrust";

/**
 * EnableBiometricPrompt
 *
 * Appears after a successful normal login when biometric
 * trusted-device access has not yet been enabled.
 *
 * It does NOT replace normal authentication.
 * It simply gives the user the option to protect future
 * app openings with the device biometric.
 */
export default function EnableBiometricPrompt({
  client,
  service = "finance",
  onEnabled,
}) {
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState("");

  /**
   * Check whether this is a native app and whether biometric
   * authentication is available.
   */
  useEffect(() => {
    let cancelled = false;

    const checkBiometric = async () => {
      /**
       * Never show this prompt in the browser.
       */
      if (!Capacitor.isNativePlatform()) {
        if (!cancelled) {
          setChecking(false);
          setVisible(false);
        }

        return;
      }

      if (!client) {
        if (!cancelled) {
          setChecking(false);
          setVisible(false);
        }

        return;
      }

      try {
        const result =
          await canUseBiometric();

        if (cancelled) {
          return;
        }

        /**
         * Only show the prompt when the phone actually
         * supports biometric authentication.
         */
        if (result?.available) {
          setVisible(true);
        } else {
          setVisible(false);
        }
      } catch (err) {
        console.error(
          "Biometric availability check failed:",
          err
        );

        if (!cancelled) {
          setVisible(false);
        }
      } finally {
        if (!cancelled) {
          setChecking(false);
        }
      }
    };

    checkBiometric();

    return () => {
      cancelled = true;
    };
  }, [client]);

  /**
   * Enable trusted-device biometric access.
   */
  const handleEnable = async () => {
    if (enabling) {
      return;
    }

    setError("");
    setEnabling(true);

    try {
      const result = await enable(
        service,
        client
      );

      if (!result?.ok) {
        let message =
          "Biometric authentication could not be enabled.";

        switch (result?.reason) {
          case "not_enrolled":
            message =
              "No fingerprint is enrolled on this device. Add a fingerprint in Android Settings, then try again.";
            break;

          case "passcode_not_set":
            message =
              "Please set a screen lock PIN, password, or pattern on your device first.";
            break;

          case "unavailable":
          case "biometric_unavailable":
            message =
              "Biometric authentication is not available on this device.";
            break;

          case "user_cancel":
          case "app_cancel":
          case "system_cancel":
          case "user_fallback":
            message =
              "Biometric setup was cancelled.";
            break;

          case "lockout":
          case "temporary_lockout":
            message =
              "Biometric authentication is temporarily locked. Try again later.";
            break;

          default:
            if (
              result?.error?.userMessage
            ) {
              message =
                result.error.userMessage;
            }
        }

        setError(message);
        return;
      }

      /**
       * Trusted-device registration succeeded.
       */
      setVisible(false);
      setError("");

      if (typeof onEnabled === "function") {
        await onEnabled();
      }
    } catch (err) {
      console.error(
        "Enable biometric error:",
        err
      );

      setError(
        err?.message ||
          "Unable to enable biometric authentication."
      );
    } finally {
      setEnabling(false);
    }
  };

  /**
   * User can choose not to enable biometric now.
   *
   * We simply hide the prompt. Normal login continues
   * to work.
   */
  const handleNotNow = () => {
    setVisible(false);
    setError("");
  };

  if (checking || !visible) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 16,
        background:
          "rgba(2, 44, 34, 0.42)",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#ffffff",
          borderRadius:
            "24px 24px 18px 18px",
          padding: "28px 22px 22px",
          boxSizing: "border-box",
          boxShadow:
            "0 -12px 50px rgba(0,0,0,0.18)",
        }}
      >
        {/* Biometric icon */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 18,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                "linear-gradient(135deg, #065f46, #10b981)",
              color: "#ffffff",
              fontSize: 32,
            }}
          >
            👆
          </div>
        </div>

        <h2
          style={{
            margin: 0,
            textAlign: "center",
            color: "#12372a",
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          Protect Umova with fingerprint
        </h2>

        <p
          style={{
            margin:
              "10px auto 0",
            maxWidth: 380,
            textAlign: "center",
            color: "#64748b",
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          Use your fingerprint or device
          biometric to unlock Umova faster
          the next time you open the app.
        </p>

        <div
          style={{
            marginTop: 18,
            padding: "12px 14px",
            borderRadius: 12,
            background: "#ecfdf5",
            border:
              "1px solid #a7f3d0",
            color: "#065f46",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          Your biometric is handled by your
          phone. Umova does not receive or
          store your fingerprint.
        </div>

        {error && (
          <div
            style={{
              marginTop: 14,
              padding: "11px 13px",
              borderRadius: 10,
              background: "#fef2f2",
              border:
                "1px solid #fecaca",
              color: "#b91c1c",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleEnable}
          disabled={enabling}
          style={{
            width: "100%",
            marginTop: 20,
            padding: "15px 18px",
            border: "none",
            borderRadius: 14,
            background: enabling
              ? "#94a3b8"
              : "#047857",
            color: "#ffffff",
            fontSize: 16,
            fontWeight: 700,
            cursor: enabling
              ? "not-allowed"
              : "pointer",
          }}
        >
          {enabling
            ? "Setting up fingerprint..."
            : "Enable fingerprint"}
        </button>

        <button
          type="button"
          onClick={handleNotNow}
          disabled={enabling}
          style={{
            width: "100%",
            marginTop: 10,
            padding: "13px 18px",
            border: "none",
            background: "transparent",
            color: "#64748b",
            fontSize: 14,
            fontWeight: 600,
            cursor: enabling
              ? "not-allowed"
              : "pointer",
          }}
        >
          Not now
        </button>

        <p
          style={{
            margin:
              "14px 0 0",
            textAlign: "center",
            fontSize: 11,
            lineHeight: 1.5,
            color: "#94a3b8",
          }}
        >
          You can continue using Umova
          normally without enabling
          biometric unlock.
        </p>
      </div>
    </div>
  );
}