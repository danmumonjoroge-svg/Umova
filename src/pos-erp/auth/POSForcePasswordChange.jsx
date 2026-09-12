// src/pos-erp/auth/POSForcePasswordChange.jsx
//
// Rendered by POSAuthGate when authStage === "must_change_password" —
// i.e. get_pos_profile() came back with staff.must_change_password
// true, either because this is the staff member's very first login
// (temp password set at creation) or because an owner/manager just
// reset their password.
//
// The user already holds a real Supabase Auth session at this point
// (login already succeeded), so this is a plain client-side
// supabase.auth.updateUser() — no RPC, no password ever touches your
// own tables. After success, call a tiny RPC to flip
// must_change_password back to false server-side (below), then let
// the parent move to "authenticated".

import React, { useState } from "react";
import { Eye, EyeOff, Loader2, AlertCircle, ShieldCheck, Lock } from "lucide-react";
import { usePOSAuth } from "../context/POSAuthContext";

const getStrength = (pass) => {
  if (!pass) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pass.length >= 8) score++;
  if (/[A-Z]/.test(pass)) score++;
  if (/[a-z]/.test(pass)) score++;
  if (/[0-9]/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;
  const map = {
    0: { label: "", color: "" },
    1: { label: "Very Weak", color: "bg-red-500" },
    2: { label: "Weak", color: "bg-orange-500" },
    3: { label: "Fair", color: "bg-yellow-500" },
    4: { label: "Strong", color: "bg-lime-500" },
    5: { label: "Very Strong", color: "bg-green-600" },
  };
  return { score, ...map[score] };
};

const validate = (pass) => {
  if (pass.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(pass)) return "Password must contain an uppercase letter";
  if (!/[a-z]/.test(pass)) return "Password must contain a lowercase letter";
  if (!/[0-9]/.test(pass)) return "Password must contain a number";
  return null;
};

const Field = ({ value, onChange, placeholder, show, onToggle }) => (
  <div className="relative">
    <Lock size={18} className="absolute left-4 top-4 text-slate-400 pointer-events-none" />
    <input
      type={show ? "text" : "password"}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full h-14 pl-12 pr-14 rounded-2xl border border-slate-300 focus:border-emerald-700 focus:ring-4 focus:ring-amber-100 outline-none text-slate-800 placeholder-slate-400 transition"
    />
    <button type="button" onClick={onToggle} tabIndex={-1}
      className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition">
      {show ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  </div>
);

export default function POSForcePasswordChange({ staffName }) {
  const { completePasswordChange } = usePOSAuth();
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const strength = getStrength(pass);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const validationError = validate(pass);
    if (validationError) return setError(validationError);
    if (pass !== confirm) return setError("Passwords do not match.");

    setLoading(true);
    try {
      const result = await completePasswordChange(pass);
      if (!result.ok) {
        setError(result.reason || "Could not update password. Please try again.");
      }
      // On success, POSAuthContext re-validates and moves authStage to
      // "authenticated" — POSAuthGate handles the transition, nothing
      // else to do here.
    } catch (err) {
      console.error("[POS PASSWORD CHANGE]", err);
      setError(err.message || "Could not update password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-200 p-8">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-800 to-emerald-950 ring-2 ring-amber-400/50 flex items-center justify-center mb-4">
          <ShieldCheck size={22} className="text-white" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-1">Choose a new password</h1>
        <p className="text-sm text-slate-500 mb-6">
          {staffName ? `Welcome, ${staffName}. ` : ""}For security, you need to set your own password before continuing.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Field value={pass} onChange={(e) => setPass(e.target.value)} placeholder="New password"
            show={show} onToggle={() => setShow((s) => !s)} />

          {pass && (
            <div>
              <div className="flex gap-1 h-1.5 mb-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className={`flex-1 rounded-full ${i < strength.score ? strength.color : "bg-slate-200"}`} />
                ))}
              </div>
              <p className="text-xs text-slate-500">{strength.label}</p>
            </div>
          )}

          <Field value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password"
            show={show} onToggle={() => setShow((s) => !s)} />

          <button type="submit" disabled={loading}
            className="w-full h-14 rounded-2xl bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white font-medium flex items-center justify-center gap-2 transition shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
            {loading ? <Loader2 size={18} className="animate-spin" /> : null}
            {loading ? "Saving..." : "Set Password & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
