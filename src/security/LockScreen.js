// src/security/LockScreen.js
// Shown by AppLock while the app is locked. Biometric first, password always available.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, Lock, Loader2, LogOut } from "lucide-react";
import { unlock, verifyPassword } from "./deviceTrust";
import { BioStatus, bioMessage } from "./nativeBiometric";

export default function LockScreen({ service, client, onUnlocked, onSignOut }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [sessionGone, setSessionGone] = useState(false);
  const failures = useRef(0);
  const started = useRef(false);

  const attempt = useCallback(async () => {
    setBusy(true); setMessage("");
    const r = await unlock({ service, client });
    setBusy(false);

    if (r.ok) { onUnlocked(); return; }

    switch (r.status) {
      case BioStatus.CANCELLED:
        break;                                                  // user backed out: stay on the lock screen, no error
      case BioStatus.FALLBACK:
        setShowPassword(true); break;
      case BioStatus.FAILED:
        failures.current += 1;
        setMessage(bioMessage(r.status));
        if (failures.current >= 3) setShowPassword(true);
        break;
      case "no_session":
        setSessionGone(true);
        setMessage("Your session has expired. Please sign in again."); break;
      case "revoked": case BioStatus.INVALIDATED:
        setShowPassword(true);
        setMessage(bioMessage(BioStatus.INVALIDATED)); break;
      default:
        setShowPassword(true);
        setMessage(bioMessage(r.status));
    }
  }, [service, client, onUnlocked]);

  useEffect(() => {                                              // prompt immediately, once
    if (started.current) return;
    started.current = true;
    attempt();
  }, [attempt]);

  const submitPassword = async (e) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true); setMessage("");
    const r = await verifyPassword(client, password);
    setBusy(false);
    if (r.ok) { setPassword(""); onUnlocked(); return; }
    if (r.reason === "no_session") { setSessionGone(true); setMessage("Your session has expired. Please sign in again."); return; }
    setMessage("Incorrect password.");
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-gradient-to-br from-slate-900 via-green-950 to-black flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-green-800 text-white flex items-center justify-center mb-4">
          <Lock size={28} />
        </div>
        <h1 className="text-2xl font-black text-slate-800">Umova is locked</h1>
        <p className="text-slate-500 text-sm mt-1">Verify it's you to continue.</p>

        {message && <p className="mt-4 text-sm rounded-xl bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3">{message}</p>}

        {sessionGone ? (
          <button onClick={onSignOut} className="mt-6 w-full h-12 rounded-2xl bg-green-800 text-white font-bold">Sign in again</button>
        ) : (
          <>
            {!showPassword && (
              <button onClick={attempt} disabled={busy}
                className="mt-6 w-full h-14 rounded-2xl bg-green-800 hover:bg-green-700 disabled:opacity-60 text-white font-bold flex items-center justify-center gap-2">
                {busy ? <Loader2 size={20} className="animate-spin" /> : <Fingerprint size={22} />}
                Touch to unlock
              </button>
            )}

            {showPassword ? (
              <form onSubmit={submitPassword} className="mt-6 space-y-3 text-left">
                <input type="password" autoComplete="current-password" autoFocus value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="Account password"
                  className="w-full h-12 px-4 rounded-2xl border border-slate-300 focus:border-green-700 focus:ring-4 focus:ring-green-100 outline-none" />
                <button disabled={busy || !password}
                  className="w-full h-12 rounded-2xl bg-green-800 text-white font-bold disabled:opacity-60 flex items-center justify-center gap-2">
                  {busy && <Loader2 size={18} className="animate-spin" />} Unlock with password
                </button>
              </form>
            ) : (
              <button onClick={() => setShowPassword(true)} className="mt-4 text-sm font-semibold text-green-800 hover:underline">
                Use password instead
              </button>
            )}

            <button onClick={onSignOut} className="mt-6 inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600">
              <LogOut size={13} /> Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
