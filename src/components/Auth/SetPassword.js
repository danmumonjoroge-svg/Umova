// ============================================================================
// FILE: src/components/Auth/FirstTimeSetPassword.js
// FIRST-TIME MEMBER ACCOUNT ACTIVATION
// Flow:
//   1. Member enters Member No (UI-XXXX) + National ID  → verified against members table
//   2. If valid & first_time_login=true → show new password + confirm fields
//   3. On save → update Supabase Auth password + clear first_time_login flags
//   4. Redirect to /login
// ============================================================================

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  KeyRound, Eye, EyeOff, Loader2,
  AlertTriangle, CheckCircle2, ArrowLeft,
  ShieldCheck, User, CreditCard,
} from "lucide-react";
import { supabase } from "../../supabaseClient";

// ============================================================================
// PASSWORD STRENGTH
// ============================================================================
function getStrength(p) {
  if (!p) return { score: 0, label: "", color: "" };
  let s = 0;
  if (p.length >= 8)          s++;
  if (p.length >= 12)         s++;
  if (/[A-Z]/.test(p))        s++;
  if (/[0-9]/.test(p))        s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  const L = [
    { label: "",            color: "bg-slate-200"   },
    { label: "Weak",        color: "bg-red-500"     },
    { label: "Fair",        color: "bg-orange-400"  },
    { label: "Good",        color: "bg-yellow-400"  },
    { label: "Strong",      color: "bg-green-500"   },
    { label: "Very Strong", color: "bg-emerald-600" },
  ];
  return { score: s, ...L[s] };
}

const REQUIREMENTS = [
  { label: "At least 8 characters",  test: (p) => p.length >= 8 },
  { label: "One uppercase letter",   test: (p) => /[A-Z]/.test(p) },
  { label: "One number",             test: (p) => /[0-9]/.test(p) },
  { label: "One special character",  test: (p) => /[^A-Za-z0-9]/.test(p) },
];

// ============================================================================
// STEP INDICATOR
// ============================================================================
function Steps({ current }) {
  const steps = ["Verify Identity", "Set Password", "Done"];
  return (
    <div className="flex items-center justify-center gap-2 mt-4 mb-1">
      {steps.map((label, i) => {
        const idx = i + 1;
        const active  = idx === current;
        const done    = idx < current;
        return (
          <React.Fragment key={label}>
            <div className="flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all
                ${done   ? "bg-white text-green-700" :
                  active ? "bg-white/30 text-white ring-2 ring-white" :
                           "bg-white/10 text-white/40"}`}>
                {done ? "✓" : idx}
              </div>
              <span className={`text-[10px] font-medium hidden sm:block transition-colors
                ${active ? "text-white" : done ? "text-green-200" : "text-white/40"}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px max-w-[40px] mb-4 transition-colors
                ${done ? "bg-white/60" : "bg-white/20"}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function FirstTimeSetPassword() {
  const navigate = useNavigate();

  // Step 1 fields
  const [memberNo,    setMemberNo]    = useState("");
  const [nationalId,  setNationalId]  = useState("");

  // Step 2 fields
  const [password,    setPassword]    = useState("");
  const [confirm,     setConfirm]     = useState("");
  const [showPass,    setShowPass]    = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Flow state
  const [step,        setStep]        = useState(1);  // 1 = verify, 2 = set password, 3 = success
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [memberData,  setMemberData]  = useState(null); // verified member row

  const strength         = getStrength(password);
  const passwordsMatch   = password && confirm && password === confirm;
  const allReqsMet       = REQUIREMENTS.every((r) => r.test(password));

  // ============================================================================
  // STEP 1 — Verify Member No + National ID
  // ============================================================================
  const handleVerify = async (e) => {
    e.preventDefault();
    setError("");

    const rawNo = memberNo.trim().toUpperCase();
    const rawId = nationalId.trim();

    if (!rawNo || !rawId) {
      setError("Please enter both your Member Number and National ID.");
      return;
    }

    // Accept with or without UI- prefix
    const formattedNo = rawNo.startsWith("UI-") ? rawNo : `UI-${rawNo}`;

    setLoading(true);
    try {
      const { data: member, error: dbErr } = await supabase
        .from("members")
        .select("id, auth_id, member_no, name, email, national_id, status, first_time_login, first_login, password_set")
        .eq("member_no", formattedNo)
        .maybeSingle();

      if (dbErr) throw dbErr;

      if (!member) {
        setError("Member number not found. Please check and try again.");
        return;
      }

      // National ID check (case-insensitive trim)
      if (!member.national_id || member.national_id.trim() !== rawId) {
        setError("National ID does not match our records.");
        return;
      }

      if (member.status === "inactive" || member.status === "suspended") {
        setError("This account is inactive or suspended. Please contact the SACCO.");
        return;
      }

      // Already activated?
      if (member.password_set === "true" || member.first_time_login === false) {
        setError("This account has already been activated. Please use the login page.");
        return;
      }

      setMemberData(member);
      setStep(2);

    } catch (err) {
      console.error("VERIFY ERROR:", err);
      setError(err.message || "Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // STEP 2 — Set New Password
  // ============================================================================
  const handleSetPassword = async (e) => {
    e.preventDefault();
    setError("");

    if (!allReqsMet) {
      setError("Password does not meet all requirements.");
      return;
    }
    if (!passwordsMatch) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      // The member must have a Supabase Auth account already created by admin.
      // We sign them in with a magic OTP (passwordless) so we can call updateUser.
      // Strategy: use admin-created account — auth_id is already in members row.
      // We update their password via the auth.admin API through an Edge Function,
      // OR we sign them in via OTP if email exists.

      if (!memberData.email) {
        setError("No email address linked to this account. Please contact the SACCO admin.");
        return;
      }

      // Sign in with OTP to get a session, then immediately update password
      // This works for first-time activation where no password is set yet.
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email: memberData.email,
        options: { shouldCreateUser: false },
      });

      if (otpErr) throw otpErr;

      // Since OTP requires email confirmation, use the alternative:
      // Call a Supabase Edge Function that updates password by auth_id
      // If no edge function, fall back to the admin REST approach below.

      // ---- ALTERNATIVE: if your backend can update directly ----
      // Use RPC function handle_first_time_password(p_auth_id, p_password)
      const { error: rpcErr } = await supabase.rpc("set_member_password", {
        p_auth_id:  memberData.auth_id,
        p_password: password,
        p_member_no: memberData.member_no,
      });

      if (rpcErr) throw rpcErr;

      // Mark account as activated in members table
      await supabase
        .from("members")
        .update({
          first_time_login: false,
          first_login:      false,
          password_set:     "true",
        })
        .eq("id", memberData.id);

      setStep(3);

    } catch (err) {
      console.error("SET PASSWORD ERROR:", err);
      setError(err.message || "Failed to set password. Please contact the SACCO.");
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================
  const headerColor =
    step === 3 ? "from-emerald-700 to-teal-700" : "from-green-700 to-emerald-700";

  const headerIcon =
    step === 1 ? <User size={28} /> :
    step === 2 ? <KeyRound size={28} /> :
                 <ShieldCheck size={32} />;

  const headerTitle =
    step === 1 ? "Account Activation" :
    step === 2 ? "Set Your Password" :
                 "Account Activated!";

  const headerSub =
    step === 1 ? "Verify your identity to activate your SACCO account." :
    step === 2 ? `Welcome, ${memberData?.name?.split(" ")[0] || "Member"}. Create your secure password.` :
                 "Your SACCO account is ready to use.";

  // ============================================================================
  // SUCCESS SCREEN
  // ============================================================================
  if (step === 3) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-green-50 to-slate-200 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-white rounded-[30px] shadow-2xl border border-slate-200 overflow-hidden">
          <div className={`bg-gradient-to-r ${headerColor} p-8 text-white text-center`}>
            <div className="mx-auto w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center mb-3">
              {headerIcon}
            </div>
            <h1 className="text-2xl font-black tracking-tight">{headerTitle}</h1>
            <p className="text-green-100 text-xs mt-1">{headerSub}</p>
          </div>
          <div className="p-8 text-center">
            <CheckCircle2 className="mx-auto text-green-600 mb-4" size={52} />
            <h2 className="text-xl font-bold text-slate-800 mb-2">You're all set!</h2>
            <p className="text-slate-500 text-sm mb-2">
              Your password has been created for member account
            </p>
            <p className="text-green-700 font-bold text-lg mb-6">{memberData?.member_no}</p>
            <p className="text-slate-400 text-xs mb-6">
              You can now log in using your Member Number and the password you just set.
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
  // MAIN CARD (Step 1 & 2)
  // ============================================================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-green-50 to-slate-200 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-[30px] shadow-2xl border border-slate-200 overflow-hidden">

        {/* HEADER */}
        <div className={`bg-gradient-to-r ${headerColor} p-8 text-white text-center`}>
          <div className="mx-auto w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mb-3">
            {headerIcon}
          </div>
          <h1 className="text-2xl font-black tracking-tight">{headerTitle}</h1>
          <p className="text-green-100 text-xs mt-1">{headerSub}</p>
          <Steps current={step} />
        </div>

        <div className="p-8">

          {/* ERROR */}
          {error && (
            <div className="mb-5 bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
              <AlertTriangle className="text-red-600 mt-0.5 shrink-0" size={20} />
              <div className="text-sm text-red-700 leading-relaxed">{error}</div>
            </div>
          )}

          {/* ── STEP 1: VERIFY IDENTITY ── */}
          {step === 1 && (
            <form onSubmit={handleVerify} className="space-y-5" noValidate>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Member Number
                </label>
                <div className="relative">
                  <User className="absolute left-4 top-4 text-slate-400 pointer-events-none" size={20} />
                  <input
                    type="text"
                    value={memberNo}
                    onChange={(e) => setMemberNo(e.target.value)}
                    placeholder="UI-0001 or 0001"
                    autoComplete="off"
                    disabled={loading}
                    className="w-full h-14 pl-12 pr-4 rounded-2xl border border-slate-300 focus:border-green-600 focus:ring-4 focus:ring-green-100 text-slate-800 outline-none transition disabled:bg-slate-50 uppercase tracking-widest font-mono"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1.5 ml-1">
                  Found on your SACCO membership card or welcome letter.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  National ID Number
                </label>
                <div className="relative">
                  <CreditCard className="absolute left-4 top-4 text-slate-400 pointer-events-none" size={20} />
                  <input
                    type="text"
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    placeholder="Enter your national ID"
                    autoComplete="off"
                    disabled={loading}
                    className="w-full h-14 pl-12 pr-4 rounded-2xl border border-slate-300 focus:border-green-600 focus:ring-4 focus:ring-green-100 text-slate-800 outline-none transition disabled:bg-slate-50"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-14 rounded-2xl bg-gradient-to-r from-green-700 to-emerald-700 text-white font-bold text-lg shadow-lg hover:shadow-xl active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition flex items-center justify-center gap-3"
              >
                {loading ? (
                  <><Loader2 className="animate-spin" size={20} /> Verifying...</>
                ) : (
                  <><ShieldCheck size={20} /> Verify Identity</>
                )}
              </button>
            </form>
          )}

          {/* ── STEP 2: SET PASSWORD ── */}
          {step === 2 && (
            <form onSubmit={handleSetPassword} className="space-y-5" noValidate>

              {/* Verified member badge */}
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl p-3">
                <CheckCircle2 className="text-green-600 shrink-0" size={20} />
                <div>
                  <p className="text-xs text-green-600 font-semibold">Identity Verified</p>
                  <p className="text-sm text-green-800 font-bold">
                    {memberData?.name} &nbsp;·&nbsp; {memberData?.member_no}
                  </p>
                </div>
              </div>

              {/* New password */}
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
                    placeholder="Create a strong password"
                    autoComplete="new-password"
                    disabled={loading}
                    className="w-full h-14 pl-12 pr-12 rounded-2xl border border-slate-300 focus:border-green-600 focus:ring-4 focus:ring-green-100 text-slate-800 outline-none transition disabled:bg-slate-50"
                  />
                  <button type="button" tabIndex={-1}
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition">
                    {showPass ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                {password && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1,2,3,4,5].map((i) => (
                        <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i <= strength.score ? strength.color : "bg-slate-200"}`} />
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 text-right">{strength.label}</p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
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
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    disabled={loading}
                    className={`w-full h-14 pl-12 pr-12 rounded-2xl border focus:ring-4 focus:ring-green-100 text-slate-800 outline-none transition disabled:bg-slate-50
                      ${confirm ? passwordsMatch ? "border-green-500 focus:border-green-600" : "border-red-400 focus:border-red-500" : "border-slate-300 focus:border-green-600"}`}
                  />
                  <button type="button" tabIndex={-1}
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition">
                    {showConfirm ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                {confirm && (
                  <p className={`text-xs mt-1.5 ${passwordsMatch ? "text-green-600" : "text-red-500"}`}>
                    {passwordsMatch ? "✓ Passwords match" : "✗ Passwords do not match"}
                  </p>
                )}
              </div>

              {/* Requirements */}
              {password && (
                <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Requirements</p>
                  {REQUIREMENTS.map((req) => (
                    <div key={req.label} className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${req.test(password) ? "bg-green-500" : "bg-slate-300"}`}>
                        {req.test(password) && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10">
                            <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <span className={`text-xs transition-colors ${req.test(password) ? "text-green-700" : "text-slate-500"}`}>
                        {req.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !allReqsMet || !passwordsMatch}
                className="w-full h-14 rounded-2xl bg-gradient-to-r from-green-700 to-emerald-700 text-white font-bold text-lg shadow-lg hover:shadow-xl active:scale-[0.98] disabled:from-slate-400 disabled:to-slate-500 disabled:opacity-60 disabled:cursor-not-allowed transition flex items-center justify-center gap-3"
              >
                {loading ? (
                  <><Loader2 className="animate-spin" size={20} /> Activating Account...</>
                ) : (
                  <><ShieldCheck size={20} /> Activate Account</>
                )}
              </button>

              <button type="button" onClick={() => { setStep(1); setError(""); setPassword(""); setConfirm(""); }}
                className="w-full flex items-center justify-center gap-2 text-slate-500 hover:text-green-700 text-sm font-semibold transition">
                <ArrowLeft size={15} /> Change Identity
              </button>
            </form>
          )}

          {/* FOOTER */}
          <div className="mt-6 pt-5 border-t border-slate-200 flex items-center justify-center">
            <button type="button" onClick={() => navigate("/login")}
              className="flex items-center gap-2 text-slate-500 hover:text-green-700 text-sm font-semibold transition group">
              <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
              Back to Login
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}