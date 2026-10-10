// src/security/EnableBiometricPrompt.js
// "Would you like to use fingerprint for faster sign-in?" Shown once, right after a FRESH normal login.
import React, { useEffect, useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import { checkBiometry, bioMessage, BioStatus } from "./nativeBiometric";
import { enable, prefGet, prefSet } from "./deviceTrust";

const FRESH_LOGIN_MS = 5 * 60 * 1000;      // only offer right after a real sign-in, not on every session restore
const ASK_AGAIN_MS = 3 * 24 * 3600 * 1000; // "Not now" -> ask again in 3 days

/**
 * Plain-language text for a failed "turn on fingerprint". Shared with FingerprintToggle.
 * "wrong_password" / "rate_limited" / "offline" / "password_required" only come from Chama (its adapter asks for the password).
 */
export function enableErrorMessage(status) {
  switch (status) {
    case "server_error":
    case "vault_error":       return "Couldn't turn on fingerprint sign-in. You can try again from Settings.";
    case "wrong_password":    return "That password isn't right. Please try again.";
    case "rate_limited":      return "Too many wrong passwords. Please wait a few minutes and try again.";
    case "offline":           return "No connection. Check your internet and try again.";
    case "password_required": return "Enter your password to turn on fingerprint sign-in.";
    default:                  return bioMessage(status);
  }
}

export default function EnableBiometricPrompt({ service, client, adapter, onEnabled }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const needsPassword = !!adapter?.requiresPassword;   // Chama: no login token, so the password is asked once
  const dismissKey = `umova.trust.dismissed.${service}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      const info = await checkBiometry();
      if (!info.biometric) return;                               // no hardware / nothing enrolled: stay quiet (Settings explains)
      if (adapter?.signedInWithin) {
        if (!(await adapter.signedInWithin(FRESH_LOGIN_MS))) return;
      } else {
        const { data } = await client.auth.getSession();
        const last = data?.session?.user?.last_sign_in_at;
        if (!last || Date.now() - new Date(last).getTime() > FRESH_LOGIN_MS) return;
      }
      const dismissed = Number(await prefGet(dismissKey));
      if (dismissed && Date.now() - dismissed < ASK_AGAIN_MS) return;
      if (alive) setShow(true);
    })();
    return () => { alive = false; };
  }, [client, adapter, dismissKey]);

  if (!show) return null;

  const onEnable = async () => {
    if (needsPassword && !password) return;
    setBusy(true); setError("");
    const r = adapter?.enable
      ? await adapter.enable(needsPassword ? { password } : undefined)
      : await enable({ service, client });
    setBusy(false);
    setPassword("");                                   // never keep the password around after it was used
    if (r.ok) { setShow(false); onEnabled?.(); return; }
    if (r.status === BioStatus.CANCELLED || r.status === BioStatus.FALLBACK) return;   // changed their mind in the OS prompt
    setError(enableErrorMessage(r.status));
  };

  const notNow = async () => { await prefSet(dismissKey, Date.now()); setShow(false); };

  return (
    <div className="fixed inset-0 z-[9998] bg-black/60 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl p-7 text-center shadow-2xl">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-green-100 text-green-800 flex items-center justify-center mb-4"><Fingerprint size={28} /></div>
        <h2 className="text-xl font-black text-slate-800">Faster sign-in?</h2>
        <p className="text-sm text-slate-500 mt-2">Use your fingerprint or face to open Umova on this phone. Your fingerprint never leaves your phone, and your password still works.</p>
        {needsPassword && (
          <>
            <p className="text-xs text-slate-400 mt-3">Enter your password once to confirm. You won't need it for this again.</p>
            <input type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onEnable(); }}
              placeholder="Your password" disabled={busy}
              className="mt-3 w-full h-12 px-4 rounded-2xl border border-slate-300 focus:border-green-700 focus:ring-4 focus:ring-green-100 outline-none" />
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
        <button onClick={onEnable} disabled={busy || (needsPassword && !password)}
          className="mt-5 w-full h-12 rounded-2xl bg-green-800 text-white font-bold disabled:opacity-60 flex items-center justify-center gap-2">
          {busy && <Loader2 size={18} className="animate-spin" />} Enable biometric login
        </button>
        <button onClick={notNow} disabled={busy} className="mt-2 w-full h-11 text-sm font-semibold text-slate-500 hover:text-slate-700">Not now</button>
      </div>
    </div>
  );
}
