// src/pos-erp/auth/POSLogin.jsx
//
// Rendered by POSAuthGate.jsx during the "logged_out" stage. Talks to
// the canonical POS auth system — context/POSAuthContext.js's RPC-based
// login(businessCode, username, password).
//
// REASON_MESSAGES covers resolve_pos_login's real reason strings
// (BUSINESS_NOT_FOUND, not the earlier guessed TENANT_NOT_FOUND — see
// the function definition pulled via pg_get_functiondef) plus
// INVALID_CREDENTIALS from POSAuthContext.js's login(). Anything else —
// AUTH_ERROR, UNKNOWN, or a reason we haven't seen — falls through to
// result.detail (the real server message) and only uses a generic line
// if there's truly nothing else to show. Same pattern as
// POSTenantSignup.jsx now, so neither screen can silently swallow a
// real server-side failure behind a canned message again.

import React, { useState } from "react";
import { Loader2, Store } from "lucide-react";
import { usePOSAuth } from "../context/POSAuthContext";

const REASON_MESSAGES = {
  BUSINESS_NOT_FOUND: "No business found with that code.",
  TENANT_NOT_APPROVED: "This business's registration is still pending approval.",
  TENANT_REJECTED: "This business's registration was rejected.",
  TENANT_SUSPENDED: "This business account is suspended.",
  STAFF_DISABLED: "This staff account has been disabled.",
  INVALID_CREDENTIALS: "Incorrect username or password.",
};

export default function POSLogin({ onGoToSignup, logoutNotice }) {
  const { login } = usePOSAuth();

  const [businessCode, setBusinessCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!businessCode.trim() || !username.trim() || !password) {
      setError("Enter your business code, username, and password.");
      return;
    }
    setSubmitting(true);
    setError("");

    const result = await login(businessCode.trim(), username.trim(), password);
    if (!result.ok) {
      // Known reasons get a friendly message. Anything else (AUTH_ERROR,
      // UNKNOWN, a reason we haven't mapped) shows the real detail from
      // the server instead of a generic line that would hide what
      // actually broke.
      setError(
        REASON_MESSAGES[result.reason] ||
        result.detail ||
        "Something went wrong signing in. Try again."
      );
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="bg-white rounded-3xl shadow-xl p-10 w-[380px] border border-slate-100"
      >
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-800 to-emerald-950 ring-2 ring-amber-400/50 flex items-center justify-center mb-5">
          <Store size={22} className="text-amber-400" />
        </div>
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">POS Sign In</h2>
        <p className="text-slate-500 text-sm mt-2 mb-6">
          Staff / till access. This is separate from the admin dashboard login.
        </p>

        {logoutNotice && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-3 text-amber-700 text-sm">
            {logoutNotice}
          </div>
        )}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        <label className="block text-xs font-bold text-slate-500 mb-1">Business code</label>
        <input
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm mb-4 outline-none focus:border-emerald-700 focus:ring-4 focus:ring-amber-100"
          value={businessCode}
          onChange={(e) => setBusinessCode(e.target.value)}
          placeholder="e.g. ACME01"
          autoComplete="organization"
          disabled={submitting}
        />

        <label className="block text-xs font-bold text-slate-500 mb-1">Username</label>
        <input
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm mb-4 outline-none focus:border-emerald-700 focus:ring-4 focus:ring-amber-100"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          disabled={submitting}
        />

        <label className="block text-xs font-bold text-slate-500 mb-1">Password</label>
        <input
          type="password"
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm mb-6 outline-none focus:border-emerald-700 focus:ring-4 focus:ring-amber-100"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={submitting}
        />

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-emerald-800 hover:bg-emerald-900 text-white font-bold py-3 px-6 rounded-2xl transition disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]"
        >
          {submitting && <Loader2 className="animate-spin" size={16} />}
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-center text-xs text-slate-400 mt-5">
          New business?{" "}
          <button
            type="button"
            onClick={onGoToSignup}
            className="font-semibold text-amber-600 hover:text-amber-700 hover:underline"
          >
            Register here
          </button>
        </p>
      </form>
    </div>
  );
}
