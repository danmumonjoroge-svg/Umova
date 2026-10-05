import React, { useState } from "react";
import { Capacitor } from "@capacitor/core";

import {
  verifyPassword,
} from "./deviceTrust";

/**
 * LockScreen
 *
 * This screen appears when Umova has been locked by the
 * biometric AppLock.
 *
 * It provides:
 * 1. Fingerprint / biometric unlock
 * 2. Password fallback
 * 3. Logout
 *
 * IMPORTANT:
 * This screen does NOT decide the user's role or permissions.
 * AuthContext + Supabase remain authoritative.
 */
export default function LockScreen({
  client,
  service = "finance",
  onUnlock,
  unlocking = false,
  error = null,
}) {
  const [showPassword, setShowPassword] =
    useState(false);

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [passwordLoading, setPasswordLoading] =
    useState(false);

  const [passwordError, setPasswordError] =
    useState("");

  const [localMessage, setLocalMessage] =
    useState("");

  /**
   * Handle biometric unlock.
   *
   * AppLock/deviceTrust handles the actual biometric
   * authentication.
   */
  const handleBiometricUnlock =
    async () => {
      setLocalMessage("");
      setPasswordError("");

      if (!onUnlock) {
        setLocalMessage(
          "Biometric unlock is unavailable."
        );

        return;
      }

      const result = await onUnlock();

      if (!result?.ok) {
        /**
         * Some failures are normal user cancellations,
         * so we don't show a scary error for every case.
         */
        if (
          result?.reason ===
            "user_cancel" ||
          result?.reason ===
            "app_cancel" ||
          result?.reason ===
            "system_cancel" ||
          result?.reason ===
            "user_fallback"
        ) {
          setLocalMessage(
            "Biometric authentication was cancelled."
          );

          return;
        }

        if (
          result?.reason ===
            "not_enrolled"
        ) {
          setLocalMessage(
            "No fingerprint is enrolled on this device. Use your password or set up a fingerprint in Android settings."
          );

          return;
        }

        if (
          result?.reason ===
            "lockout" ||
          result?.reason ===
            "temporary_lockout"
        ) {
          setLocalMessage(
            "Biometric authentication is temporarily locked. Use your device PIN/password or try again later."
          );

          return;
        }

        setLocalMessage(
          "Biometric authentication failed. Please try again or use your password."
        );
      }
    };

  /**
   * Password fallback.
   */
  const handlePasswordUnlock =
    async (event) => {
      event.preventDefault();

      setPasswordError("");
      setLocalMessage("");

      if (!email.trim()) {
        setPasswordError(
          "Enter your email address."
        );

        return;
      }

      if (!password) {
        setPasswordError(
          "Enter your password."
        );

        return;
      }

      if (!client) {
        setPasswordError(
          "Authentication service is unavailable."
        );

        return;
      }

      try {
        setPasswordLoading(true);

        const result =
          await verifyPassword(
            client,
            email.trim(),
            password
          );

        if (!result?.ok) {
          setPasswordError(
            "Incorrect email or password."
          );

          return;
        }

        /**
         * Password authentication has successfully
         * refreshed the Supabase session.
         *
         * We can now unlock the local AppLock.
         */
        if (onUnlock) {
          /**
           * onUnlock normally expects trusted-device
           * authentication, so we do NOT call it here.
           *
           * Password authentication is already sufficient
           * to regain access to the authenticated application.
           *
           * The AppLock component receives this callback
           * through the local unlock handler below.
           */
        }

        /**
         * Tell AppLock to unlock through the custom event.
         *
         * This avoids treating password authentication as
         * biometric trusted-device verification.
         */
        window.dispatchEvent(
          new CustomEvent(
            "umova-password-unlocked",
            {
              detail: {
                service,
              },
            }
          )
        );
      } catch (error) {
        console.error(
          "Password unlock error:",
          error
        );

        setPasswordError(
          "Unable to authenticate. Please try again."
        );
      } finally {
        setPasswordLoading(false);
      }
    };

  /**
   * Logout from the current Supabase session.
   *
   * This deliberately uses Supabase's normal logout.
   */
  const handleLogout = async () => {
    try {
      if (client?.auth) {
        await client.auth.signOut({
          scope: "local",
        });
      }
    } catch (error) {
      console.error(
        "Logout error:",
        error
      );
    }
  };

  const native =
    Capacitor.isNativePlatform();

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 18px",
        background:
          "linear-gradient(160deg, #064e3b 0%, #047857 48%, #0f766e 100%)",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 430,
          boxSizing: "border-box",
          background: "#ffffff",
          borderRadius: 24,
          padding: "34px 24px 26px",
          boxShadow:
            "0 24px 70px rgba(0, 0, 0, 0.25)",
        }}
      >
        {/* Logo / security icon */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                "linear-gradient(135deg, #065f46, #10b981)",
              color: "#ffffff",
              fontSize: 34,
              boxShadow:
                "0 10px 30px rgba(6, 95, 70, 0.25)",
            }}
          >
            🔐
          </div>
        </div>

        <div
          style={{
            textAlign: "center",
          }}
        >
          <h1
            style={{
              margin: "0 0 8px",
              fontSize: 25,
              fontWeight: 800,
              color: "#12372a",
            }}
          >
            Umova is locked
          </h1>

          <p
            style={{
              margin: 0,
              color: "#64748b",
              fontSize: 14,
              lineHeight: 1.55,
            }}
          >
            Authenticate to continue using
            your Umova account.
          </p>
        </div>

        {/* Biometric section */}
        {native && (
          <div
            style={{
              marginTop: 28,
            }}
          >
            <button
              type="button"
              onClick={
                handleBiometricUnlock
              }
              disabled={unlocking}
              style={{
                width: "100%",
                border: "none",
                borderRadius: 15,
                padding: "15px 18px",
                background:
                  unlocking
                    ? "#94a3b8"
                    : "#047857",
                color: "#ffffff",
                fontSize: 16,
                fontWeight: 700,
                cursor: unlocking
                  ? "not-allowed"
                  : "pointer",
                boxShadow:
                  unlocking
                    ? "none"
                    : "0 8px 22px rgba(4, 120, 87, 0.25)",
              }}
            >
              {unlocking
                ? "Authenticating..."
                : "🔐  Unlock with fingerprint"}
            </button>
          </div>
        )}

        {(localMessage || error) && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 14px",
              borderRadius: 12,
              background: "#fff7ed",
              border:
                "1px solid #fed7aa",
              color: "#9a3412",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {localMessage ||
              error?.userMessage ||
              error?.message ||
              "Authentication failed."}
          </div>
        )}

        {/* Password fallback */}
        <div
          style={{
            marginTop: 22,
            borderTop:
              "1px solid #e2e8f0",
            paddingTop: 20,
          }}
        >
          <button
            type="button"
            onClick={() => {
              setShowPassword(
                (current) => !current
              );

              setPasswordError("");
              setLocalMessage("");
            }}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              color: "#065f46",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              padding: "8px 0",
            }}
          >
            {showPassword
              ? "Hide password login"
              : "Use password instead"}
          </button>

          {showPassword && (
            <form
              onSubmit={
                handlePasswordUnlock
              }
              style={{
                marginTop: 12,
              }}
            >
              <label
                style={{
                  display: "block",
                  marginBottom: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                Email
              </label>

              <input
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value
                  )
                }
                autoComplete="username"
                placeholder="Enter your email"
                disabled={
                  passwordLoading
                }
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding:
                    "13px 14px",
                  border:
                    "1px solid #cbd5e1",
                  borderRadius: 12,
                  fontSize: 15,
                  outline: "none",
                  marginBottom: 13,
                }}
              />

              <label
                style={{
                  display: "block",
                  marginBottom: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                Password
              </label>

              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value
                  )
                }
                autoComplete="current-password"
                placeholder="Enter your password"
                disabled={
                  passwordLoading
                }
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding:
                    "13px 14px",
                  border:
                    "1px solid #cbd5e1",
                  borderRadius: 12,
                  fontSize: 15,
                  outline: "none",
                  marginBottom: 13,
                }}
              />

              {passwordError && (
                <div
                  style={{
                    marginBottom: 12,
                    padding:
                      "10px 12px",
                    borderRadius: 10,
                    background:
                      "#fef2f2",
                    color: "#b91c1c",
                    fontSize: 13,
                  }}
                >
                  {passwordError}
                </div>
              )}

              <button
                type="submit"
                disabled={
                  passwordLoading
                }
                style={{
                  width: "100%",
                  border: "none",
                  borderRadius: 12,
                  padding:
                    "13px 16px",
                  background:
                    passwordLoading
                      ? "#94a3b8"
                      : "#0f766e",
                  color: "#ffffff",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor:
                    passwordLoading
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {passwordLoading
                  ? "Signing in..."
                  : "Unlock with password"}
              </button>
            </form>
          )}
        </div>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          style={{
            width: "100%",
            marginTop: 18,
            padding: "12px 16px",
            border:
              "1px solid #e2e8f0",
            borderRadius: 12,
            background: "#ffffff",
            color: "#475569",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>

        <p
          style={{
            margin:
              "18px 0 0",
            textAlign: "center",
            fontSize: 11,
            lineHeight: 1.5,
            color: "#94a3b8",
          }}
        >
          Your Umova account permissions
          remain controlled by your
          authenticated account and
          server-side security.
        </p>
      </div>
    </div>
  );
}