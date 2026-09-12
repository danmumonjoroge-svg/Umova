// src/pos-erp/auth/POSLogin.jsx
//
// Dedicated login screen for POS, at /pos-login. Separate from /login
// (member/staff/chama unified login) on purpose — signing in here only
// ever touches posSupabase's session, never the main app's.
//
// FIXED: no longer navigates manually right after resolvePosLogin()
// resolves. That raced against POSAuthContext's onAuthStateChange
// listener — resolvePosLogin() only signs in; the listener is what
// actually updates `user`/`role`/`profile`, slightly *after* the sign-in
// call resolves. Navigating immediately meant POSStaffGuard sometimes
// saw a still-null `user` and bounced back to /pos-login, or the page
// was left waiting with no clear next step. Now a useEffect watches the
// context itself and navigates only once it's genuinely ready — and
// shows an error (instead of spinning) if the account turns out not to
// qualify for POS access after all.

import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { resolvePosLogin } from "./posLoginHelpers";
import { usePosAuth } from "./POSAuthContext";

export default function POSLogin() {
  const navigate = useNavigate();
  const { user, role, loading, isPosStaff } = usePosAuth();

  const [userNo, setUserNo] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // true once resolvePosLogin() has succeeded and we're waiting for
  // POSAuthContext to catch up via onAuthStateChange.
  const [awaitingSession, setAwaitingSession] = useState(false);

  // Navigate only once the context confirms a real, qualified session —
  // never right after the sign-in call itself.
  useEffect(() => {
    if (!awaitingSession || loading) return;

    if (user && isPosStaff) {
      navigate("/pos", { replace: true });
      return;
    }

    // Signed in, context settled, but this account isn't valid POS staff
    // (e.g. role isn't in STAFF_ROLES, or it got deactivated between the
    // pre-auth lookup and now). Surface that instead of spinning forever.
    if (user && !isPosStaff) {
      setError("This account doesn't have POS access. Contact an administrator.");
      setAwaitingSession(false);
      setSubmitting(false);
    }
  }, [awaitingSession, loading, user, role, isPosStaff, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    if (!userNo.trim() || !password) {
      setError("Enter your staff number and password.");
      return;
    }
    setSubmitting(true);
    setError("");

    const result = await resolvePosLogin(userNo, password);
    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      return;
    }

    // Sign-in succeeded. Don't navigate yet — wait for the effect above
    // to see POSAuthContext catch up (it will, via onAuthStateChange).
    setAwaitingSession(true);
  };

  const busy = submitting || awaitingSession;

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="bg-white rounded-3xl shadow-xl p-10 w-[380px] border border-slate-100"
      >
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">POS Sign In</h2>
        <p className="text-slate-500 text-sm mt-2 mb-6">
          Staff / till access. This is separate from the admin dashboard login.
        </p>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        <label className="block text-xs font-bold text-slate-500 mb-1">Staff number</label>
        <input
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm mb-4 outline-none focus:border-slate-400"
          value={userNo}
          onChange={(e) => setUserNo(e.target.value)}
          placeholder="UI-XXXX"
          autoComplete="username"
          disabled={busy}
        />

        <label className="block text-xs font-bold text-slate-500 mb-1">Password</label>
        <input
          type="password"
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm mb-6 outline-none focus:border-slate-400"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={busy}
        />

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-3 px-6 rounded-2xl transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="animate-spin" size={16} />}
          {awaitingSession ? "Finishing sign-in…" : submitting ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-center text-xs text-slate-400 mt-5">
          New here?{" "}
          <Link to="/pos-register" className="font-semibold text-emerald-700 hover:underline">
            Request POS access
          </Link>
        </p>
      </form>
    </div>
  );
}
