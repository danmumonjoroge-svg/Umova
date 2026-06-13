// ============================================================================
// FILE: src/components/Auth/SetPassword.js
// PASSWORD RESET / SET NEW PASSWORD PAGE
// Handles Supabase recovery links: /set-password?type=recovery
// Also handles first-time login password setup
// ============================================================================

import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  KeyRound,
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "../../supabaseClient";

// ============================================================================
// PASSWORD STRENGTH EVALUATOR
// ============================================================================
function getStrength(password) {
  if (!password) return { score: 0, label: "", color: "" };
  let score = 0;
  if (password.length >= 8)  score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const levels = [
    { label: "",          color: "bg-slate-200" },
    { label: "Weak",      color: "bg-red-500"   },
    { label: "Fair",      color: "bg-orange-400" },
    { label: "Good",      color: "bg-yellow-400" },
    { label: "Strong",    color: "bg-green-500"  },
    { label: "Very Strong", color: "bg-emerald-600" },
  ];
  return { score, ...levels[score] };
}

// ============================================================================
// REQUIREMENTS CHECKLIST
// ============================================================================
const REQUIREMENTS = [
  { label: "At least 8 characters",       test: (p) => p.length >= 8 },
  { label: "One uppercase letter",         test: (p) => /[A-Z]/.test(p) },
  { label: "One number",                   test: (p) => /[0-9]/.test(p) },
  { label: "One special character",        test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export default function SetPassword() {
  const navigate = useNavigate();
  const location = useLocation();

  // ============================================================================
  // STATE
  // ============================================================================
  const [password, setPassword]         = useState("");
  const [confirm, setConfirm]           = useState("");
  const [showPass, setShowPass]         = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [loading, setLoading]           = useState(false);
  const [verifying, setVerifying]       = useState(true);
  const [error, setError]               = useState("");
  const [success, setSuccess]           = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  const strength = getStrength(password);
  const passwordsMatch = password && confirm && password === confirm;
  const allRequirementsMet = REQUIREMENTS.every((r) => r.test(password));

  // ============================================================================
  // SESSION VERIFICATION
  // Supabase embeds the recovery token in the URL hash (#access_token=...)
  // We wait for onAuthStateChange to confirm the session is live
  // ============================================================================
  useEffect(() => {
    // Check URL params — if type=recovery, wait for Supabase to process the hash
    const params = new URLSearchParams(location.search);
    const type = params.get("type");

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "PASSWORD_RECOVERY" || (session && type === "recovery")) {
          setSessionReady(true);
          setVerifying(false);
        } else if (event === "SIGNED_IN" && session) {
          // First-time login flow (must_change_password)
          setSessionReady(true);
          setVerifying(false);
        } else if (!session && !verifying) {
          setError("This recovery link has expired or is invalid. Please request a new one.");
          setVerifying(false);
        }
      }
    );

    // Fallback: if already has a session (e.g. first-time login redirect)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
        setVerifying(false);
      } else {
        // Give Supabase 2s to process the URL hash token
        setTimeout(() => {
          setVerifying(false);
        }, 2000);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ============================================================================
  // SUBMIT HANDLER
  // ============================================================================
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!allRequirementsMet) {
      setError("Password does not meet all requirements.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      // Update the password via Supabase Auth
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) throw updateError;

      // If this was a first-time login, clear the must_change_password flag
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("members")
          .update({
            must_change_password: false,
            first_login: false,
            first_time_login: false,
            password_set: "true",
          })
          .eq("auth_id", user.id);
      }

      setSuccess(true);

      // Redirect to login after 3 seconds
      setTimeout(() => navigate("/login"), 3000);

    } catch (err) {
      console.error("SET PASSWORD ERROR:", err);
      if (err.message?.includes("expired")) {
        setError("This recovery session has expired. Please request a new reset link.");
      } else {
        setError(err.message || "Failed to update password. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // LOADING STATE — verifying session
  // ============================================================================
  if (verifying) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-green-50 to-slate-200 flex items-center justify-center px-4">
        <div className="text-center">
          <Loader2 className="animate-spin mx-auto text-green-700 mb-4" size={40} />
          <p className="text-slate-600 font-medium">Verifying your recovery link...</p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // SUCCESS STATE
  // ============================================================================
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-green-50 to-slate-200 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white rounded-[30px] shadow-2xl border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-green-700 to-emerald-700 p-8 text-white text-center">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center mb-3">
              <ShieldCheck size={32} />
            </div>
            <h1 className="text-2xl font-black tracking-tight">Password Updated</h1>
            <p className="text-green-100 text-xs mt-1">Your credentials have been secured.</p>
          </div>
          <div className="p-8 text-center">
            <CheckCircle2 className="mx-auto text-green-600 mb-4" size={48} />
            <h2 className="text-xl font-bold text-slate-800 mb-2">All Done!</h2>
            <p className="text-slate-500 text-sm mb-6">
              Your password has been successfully updated. You will be redirected to the login page in a moment.
            </p>
            <button
              onClick={() => navigate("/login")}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-green-700 to-emerald-700 text-white font-bold text-base shadow hover:shadow-lg transition"
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // INVALID / EXPIRED LINK STATE
  // ============================================================================
  if (!sessionReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-green-50 to-slate-200 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white rounded-[30px] shadow-2xl border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-red-600 to-rose-600 p-8 text-white text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mb-3">
              <AlertTriangle size={28} />
            </div>
            <h1 className="text-2xl font-black tracking-tight">Link Invalid</h1>
            <p className="text-red-100 text-xs mt-1">This recovery link could not be verified.</p>
          </div>
          <div className="p-8 text-center">
            <p className="text-slate-500 text-sm mb-6">
              This password reset link has expired or has already been used. Recovery links are valid for 1 hour.
            </p>
            <button
              onClick={() => navigate("/forgot-password")}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-green-700 to-emerald-700 text-white font-bold text-base shadow hover:shadow-lg transition mb-3"
            >
              Request New Link
            </button>
            <button
              onClick={() => navigate("/login")}
              className="flex items-center gap-2 text-slate-500 hover:text-green-700 text-sm font-semibold transition mx-auto"
            >
              <ArrowLeft size={16} />
              Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // MAIN FORM
  // ============================================================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-green-50 to-slate-200 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-[30px] shadow-2xl border border-slate-200 overflow-hidden">

        {/* HEADER */}
        <div className="bg-gradient-to-r from-green-700 to-emerald-700 p-8 text-white text-center relative">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mb-3">
            <KeyRound size={28} />
          </div>
          <h1 className="text-2xl font-black tracking-tight">Set New Password</h1>
          <p className="text-green-100 text-xs mt-1">
            Create a strong, secure password for your SACCO account.
          </p>
        </div>

        {/* FORM BODY */}
        <div className="p-8">

          {/* ERROR MESSAGE */}
          {error && (
            <div className="mb-5 bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
              <AlertTriangle className="text-red-600 mt-0.5 shrink-0" size={20} />
              <div className="text-sm text-red-700 leading-relaxed">{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>

            {/* NEW PASSWORD */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                New Password
              </label>
              <div className="relative">
                <KeyRound className="absolute left-4 top-4 text-slate-400 pointer-events-none" size={20} />
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter new password"
                  autoComplete="new-password"
                  disabled={loading}
                  className="w-full h-14 pl-12 pr-12 rounded-2xl border border-slate-300 focus:border-green-600 focus:ring-4 focus:ring-green-100 text-slate-800 outline-none transition disabled:bg-slate-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>

              {/* STRENGTH BAR */}
              {password && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                          i <= strength.score ? strength.color : "bg-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 text-right">{strength.label}</p>
                </div>
              )}
            </div>

            {/* CONFIRM PASSWORD */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <ShieldCheck className="absolute left-4 top-4 text-slate-400 pointer-events-none" size={20} />
                <input
                  type={showConfirm ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                  disabled={loading}
                  className={`w-full h-14 pl-12 pr-12 rounded-2xl border focus:ring-4 focus:ring-green-100 text-slate-800 outline-none transition disabled:bg-slate-50 ${
                    confirm
                      ? passwordsMatch
                        ? "border-green-500 focus:border-green-600"
                        : "border-red-400 focus:border-red-500"
                      : "border-slate-300 focus:border-green-600"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {confirm && (
                <p className={`text-xs mt-1.5 ${passwordsMatch ? "text-green-600" : "text-red-500"}`}>
                  {passwordsMatch ? "✓ Passwords match" : "✗ Passwords do not match"}
                </p>
              )}
            </div>

            {/* REQUIREMENTS CHECKLIST */}
            {password && (
              <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
                  Password Requirements
                </p>
                {REQUIREMENTS.map((req) => (
                  <div key={req.label} className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                      req.test(password) ? "bg-green-500" : "bg-slate-300"
                    }`}>
                      {req.test(password) && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10">
                          <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <span className={`text-xs transition-colors ${
                      req.test(password) ? "text-green-700" : "text-slate-500"
                    }`}>
                      {req.label}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* SUBMIT BUTTON */}
            <button
              type="submit"
              disabled={loading || !allRequirementsMet || !passwordsMatch}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-green-700 to-emerald-700 text-white font-bold text-lg shadow-lg hover:shadow-xl active:scale-[0.98] disabled:from-slate-400 disabled:to-slate-500 disabled:opacity-60 disabled:cursor-not-allowed transition flex items-center justify-center gap-3"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Saving Password...
                </>
              ) : (
                <>
                  <ShieldCheck size={20} />
                  Save New Password
                </>
              )}
            </button>
          </form>

          {/* FOOTER NAV */}
          <div className="mt-6 pt-5 border-t border-slate-200 flex items-center justify-center">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="flex items-center gap-2 text-slate-500 hover:text-green-700 text-sm font-semibold transition group"
            >
              <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
              Back to Login
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}