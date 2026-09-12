// src/pos-erp/auth/POSTenantSignup.jsx
//
// Registration MUST NOT auto-authenticate or auto-approve (spec §8) —
// so on success this shows a confirmation and a way back to the login
// screen, it never transitions authStage itself. When the owner does
// log in later, get_pos_profile() naturally routes them to the
// "pending" screen (POSAccountStatus) until Umova approves them.
//
// FIXED: error handling used to show REASON_MESSAGES.UNKNOWN ("Something
// went wrong. Please try again.") for ANY reason not in the map — which
// silently discarded result.detail, the actual Postgres error message
// (e.g. a pgcrypto/search_path failure inside register_pos_tenant).
// Same class of bug already fixed in POSLogin.jsx. Now falls back to
// showing the real detail when it's present, so a genuine server-side
// bug is visible instead of indistinguishable from a normal validation
// failure.

import React, { useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, Store, ArrowLeft } from "lucide-react";
import { usePOSAuth } from "../context/POSAuthContext";

const FIELD_CLASS =
  "w-full h-13 px-4 rounded-2xl border border-slate-300 focus:border-emerald-700 focus:ring-4 focus:ring-amber-100 outline-none text-slate-800 placeholder-slate-400 transition";

const REASON_MESSAGES = {
  WEAK_PASSWORD: "Password must be at least 8 characters.",
  BUSINESS_CODE_TAKEN: "That business code is already registered — pick another.",
  DUPLICATE: "That business code or username is already taken.",
};

const EMPTY_FORM = {
  business_name: "", owner_name: "", phone: "", email: "",
  business_code: "", username: "", password: "", confirm: "",
  business_type: "", address: "",
};

export default function POSTenantSignup({ onBackToLogin }) {
  const { signup } = usePOSAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [submittedCode, setSubmittedCode] = useState(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const required = ["business_name", "owner_name", "phone", "business_code", "username", "password"];
    if (required.some((k) => !form[k].trim())) return setError("Please fill in all required fields.");
    if (form.password.length < 8) return setError(REASON_MESSAGES.WEAK_PASSWORD);
    if (form.password !== form.confirm) return setError("Passwords do not match.");

    setLoading(true);
    try {
      const result = await signup({
        p_business_name: form.business_name.trim(),
        p_owner_name: form.owner_name.trim(),
        p_phone: form.phone.trim(),
        p_email: form.email.trim() || null,
        p_business_code: form.business_code.trim(),
        p_username: form.username.trim(),
        p_password: form.password,
        p_business_type: form.business_type.trim() || null,
        p_address: form.address.trim() || null,
      });

      if (!result.ok) {
        // Known validation reasons get a friendly message. Anything else
        // (a real server-side failure) shows the actual detail instead
        // of a generic "something went wrong" that hides what broke.
        setError(
          REASON_MESSAGES[result.reason] ||
          result.detail ||
          "Something went wrong. Please try again."
        );
        return;
      }
      setSubmittedCode(result.businessCode);
    } catch (err) {
      console.error("[POS SIGNUP]", err);
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (submittedCode) {
    return (
      <Shell>
        <div className="text-center py-4">
          <CheckCircle2 size={40} className="text-emerald-700 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-800 mb-2">Registration submitted</h2>
          <p className="text-sm text-slate-600 mb-1">
            Your business code is <span className="font-mono font-semibold">{submittedCode}</span>.
          </p>
          <p className="text-sm text-slate-600 mb-6">
            Umova will review your application. Once approved, sign in with your business code, username, and password to get started.
          </p>
          <button onClick={onBackToLogin}
            className="w-full h-13 rounded-2xl bg-emerald-800 hover:bg-emerald-900 text-white font-medium shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
            Back to Sign In
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <button onClick={onBackToLogin} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft size={16} /> Back to sign in
      </button>
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Register Your Business</h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /><span>{error}</span>
          </div>
        )}

        <input className={FIELD_CLASS} placeholder="Business name *" value={form.business_name} onChange={set("business_name")} />
        <input className={FIELD_CLASS} placeholder="Owner name *" value={form.owner_name} onChange={set("owner_name")} />
        <div className="grid grid-cols-2 gap-3">
          <input className={FIELD_CLASS} placeholder="Phone *" value={form.phone} onChange={set("phone")} />
          <input className={FIELD_CLASS} placeholder="Email" value={form.email} onChange={set("email")} />
        </div>
        <input className={FIELD_CLASS} placeholder="Business code (e.g. UM-2201) *" value={form.business_code}
          onChange={set("business_code")} style={{ textTransform: "uppercase" }} />
        <input className={FIELD_CLASS} placeholder="Username *" value={form.username} onChange={set("username")} />
        <div className="grid grid-cols-2 gap-3">
          <input type="password" className={FIELD_CLASS} placeholder="Password *" value={form.password} onChange={set("password")} />
          <input type="password" className={FIELD_CLASS} placeholder="Confirm password *" value={form.confirm} onChange={set("confirm")} />
        </div>
        <input className={FIELD_CLASS} placeholder="Business type (optional)" value={form.business_type} onChange={set("business_type")} />
        <input className={FIELD_CLASS} placeholder="Address (optional)" value={form.address} onChange={set("address")} />

        <button type="submit" disabled={loading}
          className="w-full h-13 rounded-2xl bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white font-medium flex items-center justify-center gap-2 mt-2 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
          {loading ? <Loader2 size={18} className="animate-spin" /> : null}
          {loading ? "Submitting..." : "Submit for Approval"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-200 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-800 to-emerald-950 ring-2 ring-amber-400/50 flex items-center justify-center flex-shrink-0">
            <Store size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">Umova POS</h1>
            <p className="text-xs text-slate-500">Business registration</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
