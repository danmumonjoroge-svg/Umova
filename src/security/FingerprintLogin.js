// src/security/FingerprintLogin.js
//
// The "Use fingerprint" option at the point of login. Drop it UNDER the password form's main button
// (thumb-friendly, and the password Login stays the primary action):
//
//   <FingerprintLogin service="finance" client={supabase} onSignedIn={() => navigate(...)} />
//
// position="bottom" (default): an "or" divider, then an outlined "Use fingerprint" button.
// position="top": the older layout, a "Welcome back" heading above the form.
//
// It shows only when ALL of these are true, otherwise it renders nothing and the screen is exactly as before:
//   * running inside the Android/iOS app (never on the web)
//   * fingerprint has been turned on for THIS phone and THIS service
// The user never sees device ids, device lists or "trusted devices": the phone knows which device it is.
//
// Tapping the button: fingerprint -> device secret released from the Keystore -> server verifies it ->
// one-time token -> a REAL Supabase session (deviceTrust.signInWithDevice). The password form below stays
// fully usable the whole time, and is always the fallback.
//
// When the phone CAN do fingerprint but it hasn't been turned on for this service yet, it shows one quiet line saying
// so (instead of nothing), so it's always clear whether the screen is working. Phones without fingerprint, and the
// web, see nothing at all.
//
// It deliberately does NOT prompt automatically on screen load: after a deliberate "Sign out", the phone must not
// instantly sign itself back in. One tap, then the fingerprint.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import { isNativeApp, bioMessage, BioStatus, checkBiometry } from "./nativeBiometric";
import { isEnabled, signInWithDevice } from "./deviceTrust";

// Text for each outcome. Cancelling is not an error: we just point at the password below.
function messageFor(status) {
  switch (status) {
    case BioStatus.CANCELLED:
    case BioStatus.FALLBACK:
      return "Fingerprint cancelled. Try again, or sign in with your password below.";
    case BioStatus.FAILED:
    case BioStatus.LOCKED_OUT:
    case BioStatus.INVALIDATED:
    case BioStatus.NOT_ENROLLED:
    case BioStatus.UNAVAILABLE:
      return bioMessage(status);
    case "revoked":
      return "This phone is no longer set up for fingerprint sign-in. Sign in with your password, then turn it on again.";
    case "account_inactive":
      return "This account isn't active. Please contact your administrator.";
    case "offline":
      return "No connection. Check your internet and try again, or use your password.";
    default:
      return "Fingerprint sign-in isn't working right now. Use your password below.";
  }
}

const SERVICE_NAME = { finance: "Umova", business: "My Business", chama: "Chama" };

export default function FingerprintLogin({ service, client, onSignedIn, position = "bottom" }) {
  const native = isNativeApp();
  const [show, setShow] = useState(false);
  const [offerHint, setOfferHint] = useState(false);   // can do fingerprint, but not turned on for this service yet
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Is fingerprint turned on for this phone? (local flag only: no prompt, no network)
  useEffect(() => {
    if (!native) return undefined;
    let alive = true;
    (async () => {
      const enabled = await isEnabled(service).catch(() => false);
      const bio = enabled ? null : await checkBiometry().catch(() => null);
      if (!alive) return;
      console.info("[FingerprintLogin]", service, enabled ? "turned on" : (bio?.biometric ? "available, not turned on" : "not available"));
      setShow(!!enabled);
      setOfferHint(!enabled && !!bio?.biometric);
    })();
    return () => { alive = false; };
  }, [native, service]);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    let r;
    try {
      r = await signInWithDevice({ service, client });
    } catch (e) {
      console.error("[FingerprintLogin]", e);
      r = { ok: false, status: "server_error" };
    }
    if (!mounted.current) return;           // the new session already moved the user to the dashboard
    setBusy(false);
    if (r.ok) { onSignedIn?.(); return; }
    setMessage(messageFor(r.status));
    // revoked / invalidated wipe the local setup: hide the button, the password form takes over
    setShow(await isEnabled(service).catch(() => false));
  }, [busy, service, client, onSignedIn]);

  if (!native) return null;

  if (!show) {
    if (!offerHint) return null;
    return (
      <p className={`${position === "top" ? "mb-5" : "mt-5"} flex items-center justify-center gap-2 text-center text-xs text-slate-400`}>
        <Fingerprint size={14} className="shrink-0" />
        Fingerprint sign-in isn't turned on for {SERVICE_NAME[service] || "this app"} on this phone yet.
        Sign in with your password, then choose "Enable fingerprint".
      </p>
    );
  }

  const messageEl = message && (
    <p role="status" className="mt-3 text-center text-xs text-amber-700">{message}</p>
  );

  if (position === "top") {
    return (
      <div className="mb-6">
        <p className="text-center text-sm font-semibold text-slate-700 mb-3">Welcome back</p>

        <button
          type="button"                         // never submits the password form
          onClick={start}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white font-semibold py-3.5 transition"
        >
          {busy ? <Loader2 size={20} className="animate-spin" /> : <Fingerprint size={22} />}
          {busy ? "Checking…" : "Use fingerprint"}
        </button>

        {messageEl}

        <div className="flex items-center gap-3 mt-5 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          or sign in with your password
          <span className="h-px flex-1 bg-slate-200" />
        </div>
      </div>
    );
  }

  // position === "bottom": sits under the password form's main button.
  return (
    <div className="mt-6">
      <div className="flex items-center gap-3 mb-4 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        or
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <button
        type="button"                           // never submits the password form
        onClick={start}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-emerald-800 text-emerald-800 hover:bg-emerald-50 disabled:opacity-60 font-semibold py-3.5 transition"
      >
        {busy ? <Loader2 size={22} className="animate-spin" /> : <Fingerprint size={24} />}
        {busy ? "Checking…" : "Use fingerprint"}
      </button>

      {messageEl}
    </div>
  );
}
