// src/security/EnableBiometricPrompt.js
// "Would you like to use fingerprint for faster sign-in?" Shown once, right after a FRESH normal login.
import React, { useEffect, useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import { checkBiometry, bioMessage, BioStatus } from "./nativeBiometric";
import { enable, prefGet, prefSet } from "./deviceTrust";

const FRESH_LOGIN_MS = 5 * 60 * 1000;      // only offer right after a real sign-in, not on every session restore
const ASK_AGAIN_MS = 3 * 24 * 3600 * 1000; // "Not now" -> ask again in 3 days

export default function EnableBiometricPrompt({ service, client, onEnabled }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dismissKey = `umova.trust.dismissed.${service}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      const info = await checkBiometry();
      if (!info.biometric) return;                               // no hardware / nothing enrolled: stay quiet (Settings explains)
      const { data } = await client.auth.getSession();
      const last = data?.session?.user?.last_sign_in_at;
      if (!last || Date.now() - new Date(last).getTime() > FRESH_LOGIN_MS) return;
      const dismissed = Number(await prefGet(dismissKey));
      if (dismissed && Date.now() - dismissed < ASK_AGAIN_MS) return;
      if (alive) setShow(true);
    })();
    return () => { alive = false; };
  }, [client, dismissKey]);

  if (!show) return null;

  const onEnable = async () => {
    setBusy(true); setError("");
    const r = await enable({ service, client });
    setBusy(false);
    if (r.ok) { setShow(false); onEnabled?.(); return; }
    if (r.status === BioStatus.CANCELLED || r.status === BioStatus.FALLBACK) return;   // changed their mind in the OS prompt
    setError(r.status === "server_error" || r.status === "vault_error"
      ? "Couldn't turn on fingerprint sign-in. You can try again from Settings."
      : bioMessage(r.status));
  };

  const notNow = async () => { await prefSet(dismissKey, Date.now()); setShow(false); };

  return (
    <div className="fixed inset-0 z-[9998] bg-black/60 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl p-7 text-center shadow-2xl">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-green-100 text-green-800 flex items-center justify-center mb-4"><Fingerprint size={28} /></div>
        <h2 className="text-xl font-black text-slate-800">Faster sign-in?</h2>
        <p className="text-sm text-slate-500 mt-2">Use your fingerprint or face to open Umova on this phone. Your fingerprint never leaves your phone, and your password still works.</p>
        {error && <p className="mt-3 text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
        <button onClick={onEnable} disabled={busy}
          className="mt-5 w-full h-12 rounded-2xl bg-green-800 text-white font-bold disabled:opacity-60 flex items-center justify-center gap-2">
          {busy && <Loader2 size={18} className="animate-spin" />} Enable biometric login
        </button>
        <button onClick={notNow} disabled={busy} className="mt-2 w-full h-11 text-sm font-semibold text-slate-500 hover:text-slate-700">Not now</button>
      </div>
    </div>
  );
}
