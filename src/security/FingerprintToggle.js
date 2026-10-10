// src/security/FingerprintToggle.js
//
// "Fingerprint login  ON / OFF" for THIS phone only. The device is detected automatically (random per-install
// id kept internally); the user never sees or picks a device. Turning it OFF here does not affect any other
// phone signed in to the same account.
//
// Renders nothing on the web, so it is safe to place anywhere (Settings -> Security).
//
// Props:  service  "finance" | "business" | "chama"
//         client   the Supabase client that service uses (supabase / posSupabase)
//         adapter  optional (Chama): { enable(), disable() } used instead of the Supabase-backed versions.
//                  If adapter.requiresPassword is set, turning ON first asks for the password (once) and calls
//                  adapter.enable({ password }). Finance / My Business are unaffected.

import React, { useCallback, useEffect, useState } from "react";
import { checkBiometry, isNativeApp, bioMessage, BioStatus } from "./nativeBiometric";
import { enable, disable, isEnabled } from "./deviceTrust";
import { useAppLock } from "./AppLock";
import { enableErrorMessage } from "./EnableBiometricPrompt";

const FRIENDLY_SERVER = "Couldn't turn on fingerprint login right now. Please try again.";

export default function FingerprintToggle({ service, client, adapter }) {
  const native = isNativeApp();
  const { refreshTrust } = useAppLock();
  const [loading, setLoading] = useState(native);
  const [on, setOn] = useState(false);
  const [canUse, setCanUse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [askPw, setAskPw] = useState(false);   // Chama: show the one-time password box
  const [pw, setPw] = useState("");

  const load = useCallback(async () => {
    const [info, enabled] = await Promise.all([checkBiometry(), isEnabled(service)]);
    setCanUse(!!info.biometric);
    setOn(enabled);
    if (!info.biometric && !enabled) {
      setNote(info.status === BioStatus.NOT_ENROLLED
        ? bioMessage(BioStatus.NOT_ENROLLED)
        : "Fingerprint login isn't available on this device. Please use your password.");
    } else {
      setNote("");
    }
    setLoading(false);
  }, [service]);

  useEffect(() => { if (native) load(); }, [native, load]);

  if (!native) return null;

  const runEnable = async (args) => {
    setBusy(true); setNote("");
    const r = adapter?.enable ? await adapter.enable(args) : await enable({ service, client });
    setBusy(false);
    if (r.ok) { setOn(true); setAskPw(false); await refreshTrust(); return; }
    if (r.status === BioStatus.CANCELLED || r.status === BioStatus.FALLBACK) {
      setNote("Fingerprint login cancelled. You can use your password instead.");
    } else if (r.status === "server_error" || r.status === "vault_error") {
      setNote(FRIENDLY_SERVER);
    } else if (r.status === BioStatus.LOCKED_OUT) {
      setNote("Fingerprint temporarily unavailable. Please use your password.");
    } else {
      setNote(enableErrorMessage(r.status) || "Fingerprint login isn't available on this device. Please use your password.");
    }
  };

  // Chama asks for the password first; everyone else turns on straight away, exactly as before.
  const turnOn = async () => {
    if (adapter?.requiresPassword) { setNote(""); setAskPw(true); return; }
    await runEnable(undefined);
  };

  const confirmEnable = async (e) => {
    e.preventDefault();
    if (!pw) return;
    const password = pw;
    setPw("");                                   // never keep the password around after it was used
    await runEnable({ password });
  };

  const turnOff = async () => {
    setBusy(true); setNote("");
    if (adapter?.disable) await adapter.disable();
    else await disable({ service, client });   // best-effort server revoke + wipes the local credential
    setBusy(false);
    setOn(false);
    await refreshTrust();
  };

  const onClick = () => (on ? turnOff() : turnOn());
  const disabled = loading || busy || (!on && !canUse);

  return (
    <div>
      <div className="uma-row" style={{ minHeight: 52, alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Fingerprint login</div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>
            {on ? "On for this phone" : "Use your fingerprint to open Umova on this phone"}
          </div>
        </div>
        <button
          type="button" role="switch" aria-checked={on} aria-label="Fingerprint login"
          onClick={onClick} disabled={disabled}
          style={{
            width: 52, height: 30, borderRadius: 15, border: 0, padding: 3, flexShrink: 0,
            background: on ? "#237A52" : "#B8C1BB", opacity: disabled && !on ? 0.5 : 1,
            cursor: disabled ? "default" : "pointer", transition: "background .15s",
            display: "flex", justifyContent: on ? "flex-end" : "flex-start",
          }}
        >
          <span style={{ width: 24, height: 24, borderRadius: 12, background: "#fff", display: "block" }} />
        </button>
      </div>
      {askPw && !on && (
        <form onSubmit={confirmEnable} style={{ marginTop: 10 }}>
          <input
            type="password" autoComplete="current-password" autoFocus value={pw}
            onChange={(e) => setPw(e.target.value)} placeholder="Enter your password to confirm" disabled={busy}
            style={{ width: "100%", height: 44, padding: "0 12px", borderRadius: 12, border: "1px solid #B8C1BB", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="submit" disabled={busy || !pw}
              style={{ flex: 1, height: 40, borderRadius: 12, border: 0, background: "#237A52", color: "#fff", fontWeight: 700, opacity: busy || !pw ? 0.6 : 1 }}
            >
              Turn on
            </button>
            <button
              type="button" disabled={busy}
              onClick={() => { setAskPw(false); setPw(""); setNote(""); }}
              style={{ height: 40, padding: "0 16px", borderRadius: 12, border: "1px solid #B8C1BB", background: "#fff", fontWeight: 600 }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {note && <p style={{ fontSize: 13, margin: "8px 0 0", color: "#8A5A00" }}>{note}</p>}
    </div>
  );
}
