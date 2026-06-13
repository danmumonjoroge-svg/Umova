// src/components/Auth/AuthPage.js
// FIRST-TIME SETUP FLOW (FIXED):
//   1. Verify member_no + national_id in members table
//   2. Check if an auth user record is already provisioned via database trigger (auth_id check)
//      - If YES → Run resetPasswordForEmail directly to bypass Supabase 422 errors
//      - If NO  → Attempt clean signUp with their email + chosen password
//   3. Mark password_set = "true", update profiles, and guide to link verification

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Eye, EyeOff, Shield, Loader2, AlertCircle, CheckCircle,
  Lock, User, ArrowLeft, RefreshCcw, CreditCard,
} from "lucide-react";
import { supabase } from "../../supabaseClient";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const getPasswordStrength = (pass) => {
  if (!pass) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pass.length >= 8)           score++;
  if (/[A-Z]/.test(pass))         score++;
  if (/[a-z]/.test(pass))         score++;
  if (/[0-9]/.test(pass))         score++;
  if (/[^A-Za-z0-9]/.test(pass))  score++;
  const map = {
    0: { label: "",            color: "" },
    1: { label: "Very Weak",   color: "bg-red-500" },
    2: { label: "Weak",        color: "bg-orange-500" },
    3: { label: "Fair",        color: "bg-yellow-500" },
    4: { label: "Strong",      color: "bg-lime-500" },
    5: { label: "Very Strong", color: "bg-green-600" },
  };
  return { score, ...map[score] };
};

const validatePassword = (pass) => {
  if (pass.length < 8)      return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(pass))  return "Password must contain an uppercase letter";
  if (!/[a-z]/.test(pass))  return "Password must contain a lowercase letter";
  if (!/[0-9]/.test(pass))  return "Password must contain a number";
  return null;
};

const formatMemberNo = (val) => val.toUpperCase().replace(/[^A-Z0-9-]/g, "");

const isPasswordSet = (val) => val === true || val === "true";

// ─────────────────────────────────────────────
// PASSWORD INPUT
// ─────────────────────────────────────────────
const PasswordInput = ({ value, onChange, placeholder, show, onToggle, icon: Icon }) => (
  <div className="relative">
    {Icon && <Icon size={18} className="absolute left-4 top-4 text-slate-400 pointer-events-none" />}
    <input
      type={show ? "text" : "password"}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`w-full h-14 ${Icon ? "pl-12" : "pl-4"} pr-14 rounded-2xl border border-slate-300 focus:border-green-700 focus:ring-4 focus:ring-green-100 outline-none text-slate-800 placeholder-slate-400 transition`}
    />
    <button type="button" onClick={onToggle}
      className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition" tabIndex={-1}>
      {show ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  </div>
);

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");

  // Login States
  const [memberNo, setMemberNo] = useState("");
  const [password, setPassword] = useState("");

  // Setup States
  const [setupMemberNo, setSetupMemberNo] = useState("");
  const [setupIdNumber, setSetupIdNumber] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Forgot States
  const [resetMemberNo, setResetMemberNo] = useState("");
  const [resetIdNumber, setResetIdNumber] = useState("");

  // UI Engine States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const passwordStrength = getPasswordStrength(setupPassword);
  const clearMessages = () => { setError(""); setSuccess(""); };
  const switchMode = (m) => { clearMessages(); setMode(m); };

  // ─────────────────────────────────────────────
  // LOGIN FLOW
  // ─────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!memberNo.trim() || !password) {
      setError("Enter your member number and password");
      return;
    }

    setLoading(true);
    try {
      const { data: member, error: memberError } = await supabase
        .from("members")
        .select("id, member_no, name, email, auth_id, auth_user_id, password_set, status")
        .eq("member_no", memberNo.trim())
        .maybeSingle();

      if (memberError) { setError("Failed to look up member. Please try again."); return; }
      if (!member)     { setError("Member number not found."); return; }

      if (member.status === "inactive")  { setError("Your account is inactive. Contact the SACCO office."); return; }
      if (member.status === "suspended") { setError("Your account is suspended. Contact the SACCO office."); return; }

      if (!isPasswordSet(member.password_set)) {
        setSetupMemberNo(member.member_no);
        setError("You haven't activated your account yet. Complete setup below.");
        setMode("setup");
        return;
      }

      if (!member.email) { setError("No email on file. Contact the SACCO office."); return; }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: member.email,
        password,
      });

      if (authError) {
        if (authError.message.toLowerCase().includes("invalid login credentials")) {
          setError("Incorrect password. Please try again.");
        } else if (authError.message.toLowerCase().includes("email not confirmed")) {
          setError("Please confirm your email address first — check your inbox.");
        } else {
          setError(authError.message);
        }
        return;
      }

      setSuccess(`Welcome back, ${member.name || "Member"}!`);
      setTimeout(() => navigate("/redirect", { replace: true }), 800);

    } catch (err) {
      console.error("Login error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────
  // FIRST TIME SETUP FLOW (FIXED 422 WORKFLOW)
  // ─────────────────────────────────────────────
  const handleSetup = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!setupMemberNo.trim() || !setupIdNumber.trim() || !setupPassword || !confirmPassword) {
      setError("All fields are required"); return;
    }
    const pwErr = validatePassword(setupPassword);
    if (pwErr) { setError(pwErr); return; }
    if (setupPassword !== confirmPassword) { setError("Passwords do not match"); return; }

    setLoading(true);
    try {
      // ── Step 1: Identity verification ──────────────────
      const { data: member, error: memberError } = await supabase
        .from("members")
        .select("id, member_no, name, email, national_id, password_set, auth_id, auth_user_id, status")
        .eq("member_no", setupMemberNo.trim())
        .maybeSingle();

      if (memberError) { setError("Lookup failed. Please try again."); return; }
      if (!member)     { setError("Member number not found. Check your card and try again."); return; }

      if (!member.national_id || member.national_id.trim() !== setupIdNumber.trim()) {
        setError("Member number and National ID do not match our records."); return;
      }

      if (member.status === "inactive" || member.status === "suspended") {
        setError("This account is not active. Contact the SACCO office."); return;
      }

      if (isPasswordSet(member.password_set)) {
        setError("This account is already activated. Use Forgot Password if you need to reset it.");
        return;
      }

      if (!member.email) {
        setError("No email address linked to your account. Contact the SACCO office to add one.");
        return;
      }

      // ── Step 2: Deterministic Flow Divergence ──────────
      // Check database to see if a row sync trigger has pre-built the account record
      const hasAuthAccount = !!(member.auth_id || member.auth_user_id);

      if (hasAuthAccount) {
        // Direct Path: Account exists but needs recovery parameters set up
        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(member.email, {
          redirectTo: `${window.location.origin}/set-password`,
        });

        if (resetErr) { setError("Failed to send setup email: " + resetErr.message); return; }

        await supabase
          .from("members")
          .update({ password_set: "true", first_time_login: false })
          .eq("id", member.id);

        setSuccess(
          `A password setup link has been sent to your email (${member.email.replace(/(.{2}).*@/, "$1***@")}). ` +
          `Open the link to finish setting your password, then log in here.`
        );
        setSetupPassword(""); setConfirmPassword(""); setSetupIdNumber("");
        return;
      }

      // ── Step 3: Pure Signup Fallback (No Auth Entity Found) ──
      const { data: signupData, error: signupError } = await supabase.auth.signUp({
        email:    member.email,
        password: setupPassword,
        options: {
          data: {
            member_id:  member.id,
            member_no:  member.member_no,
            full_name:  member.name || "",
          },
        },
      });

      if (signupError) {
        // Catch-all safety verification fallback for race conditions (422 recovery handle)
        if (signupError.status === 422 || signupError.message.toLowerCase().includes("registered")) {
          const { error: resetErr } = await supabase.auth.resetPasswordForEmail(member.email, {
            redirectTo: `${window.location.origin}/set-password`,
          });
          if (resetErr) { setError("Failed to send setup email: " + resetErr.message); return; }

          await supabase
            .from("members")
            .update({ password_set: "true", first_time_login: false })
            .eq("id", member.id);

          setSuccess(
            `A password setup link has been sent to your email (${member.email.replace(/(.{2}).*@/, "$1***@")}). ` +
            `Open the link to finish setting your password, then log in here.`
          );
          return;
        }
        setError("Account creation failed: " + signupError.message);
        return;
      }

      const authUserId = signupData?.user?.id;
      if (!authUserId) {
        setError("Account creation incomplete. Please contact SACCO support.");
        return;
      }

      // Bind newly populated auth id references back to database row
      await supabase
        .from("members")
        .update({
          auth_id:          authUserId,
          auth_user_id:     authUserId,
          password_set:     "true",
          first_time_login: false,
          first_login:      false,
        })
        .eq("id", member.id);

      const needsConfirmation = !signupData?.session;

      if (needsConfirmation) {
        setSuccess(
          `Account activated! A confirmation email has been sent to ` +
          `${member.email.replace(/(.{2}).*@/, "$1***@")}. ` +
          `Please verify your email before logging in.`
        );
      } else {
        setSuccess("Account activated! You can now log in with your member number and password.");
        setTimeout(() => switchMode("login"), 2000);
      }

      setSetupPassword(""); setConfirmPassword(""); setSetupIdNumber("");

    } catch (err) {
      console.error("Setup error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────
  // FORGOT PASSWORD FLOW
  // ─────────────────────────────────────────────
  const handleForgotPassword = async (e) => {
    e.preventDefault();
    clearMessages();

    if (!resetMemberNo.trim() || !resetIdNumber.trim()) {
      setError("Enter your member number and ID number"); return;
    }

    setLoading(true);
    try {
      const { data: member, error: memberError } = await supabase
        .from("members")
        .select("email, member_no, national_id, password_set, status")
        .eq("member_no", resetMemberNo.trim())
        .maybeSingle();

      if (memberError) { setError("Verification failed. Please try again."); return; }
      if (!member)     { setError("Member number not found."); return; }

      if (!member.national_id || member.national_id.trim() !== resetIdNumber.trim()) {
        setError("Member number and ID number do not match our records."); return;
      }

      if (member.status === "inactive" || member.status === "suspended") {
        setError("This account is not active. Contact the SACCO office."); return;
      }

      if (!isPasswordSet(member.password_set)) {
        setError("No password set yet. Use First Time Setup instead."); return;
      }

      if (!member.email) { setError("No email on file. Contact the SACCO office."); return; }

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(member.email, {
        redirectTo: `${window.location.origin}/set-password`,
      });

      if (resetError) { setError(resetError.message); return; }

      const masked = member.email.replace(/(.{2}).*@/, "$1***@");
      setSuccess(`Reset link sent to ${masked}. Check your inbox and follow the link.`);
      setResetMemberNo(""); setResetIdNumber("");

    } catch (err) {
      console.error("Reset error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────
  // JSX LAYOUT
  // ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 p-8">

        {/* HEADER */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-green-700 flex items-center justify-center text-white mb-4 shadow-lg">
            <Shield size={36} />
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">SACCO ERP</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {mode === "login"  && "Secure Member Authentication"}
            {mode === "setup"  && "First Time Account Setup"}
            {mode === "forgot" && "Reset Your Password"}
          </p>
        </div>

        {/* ALERTS DISPLAY */}
        {error && (
          <div className="mb-5 bg-red-50 border border-red-200 p-4 rounded-2xl flex gap-3 items-start">
            <AlertCircle className="text-red-500 mt-0.5 shrink-0" size={18} />
            <p className="text-red-700 text-sm leading-relaxed">{error}</p>
          </div>
        )}
        {success && (
          <div className="mb-5 bg-green-50 border border-green-200 p-4 rounded-2xl flex gap-3 items-start">
            <CheckCircle className="text-green-600 mt-0.5 shrink-0" size={18} />
            <p className="text-green-700 text-sm leading-relaxed">{success}</p>
          </div>
        )}

        {/* ── LOGIN FORM ── */}
        {mode === "login" && (
          <form onSubmit={handleLogin} className="space-y-5" noValidate>
            <div>
              <label className="block mb-2 font-semibold text-sm text-slate-700">Member Number</label>
              <div className="relative">
                <User size={18} className="absolute left-4 top-4 text-slate-400 pointer-events-none" />
                <input type="text" value={memberNo}
                  onChange={(e) => setMemberNo(formatMemberNo(e.target.value))}
                  placeholder="UI-0001" maxLength={12} autoComplete="username"
                  className="w-full h-14 pl-12 rounded-2xl border border-slate-300 focus:border-green-700 focus:ring-4 focus:ring-green-100 outline-none text-slate-800 placeholder-slate-400 transition font-mono tracking-wider" />
              </div>
            </div>
            <div>
              <label className="block mb-2 font-semibold text-sm text-slate-700">Password</label>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password" show={showPassword}
                onToggle={() => setShowPassword(v => !v)} icon={Lock} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full h-14 rounded-2xl bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold flex items-center justify-center gap-3 transition shadow-md">
              {loading ? <><Loader2 className="animate-spin" size={20} />Authenticating...</> : <><Shield size={20} />Login</>}
            </button>
            <div className="flex items-center justify-between pt-2">
              <button type="button" onClick={() => switchMode("setup")}
                className="text-green-700 hover:text-green-900 font-semibold text-sm transition">
                First Time Setup
              </button>
              <button type="button" onClick={() => switchMode("forgot")}
                className="text-green-700 hover:text-green-900 font-semibold text-sm transition">
                Forgot Password?
              </button>
            </div>
          </form>
        )}

        {/* ── FIRST TIME SETUP FORM ── */}
        {mode === "setup" && (
          <form onSubmit={handleSetup} className="space-y-4" noValidate>
            <button type="button" onClick={() => switchMode("login")}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-2 transition">
              <ArrowLeft size={16} />Back to Login
            </button>

            <div>
              <label className="block mb-1.5 font-semibold text-sm text-slate-700">Member Number</label>
              <div className="relative">
                <CreditCard size={18} className="absolute left-4 top-4 text-slate-400 pointer-events-none" />
                <input type="text" value={setupMemberNo}
                  onChange={(e) => setSetupMemberNo(formatMemberNo(e.target.value))}
                  placeholder="UI-0001" maxLength={12} autoComplete="off"
                  className="w-full h-14 pl-12 rounded-2xl border border-slate-300 focus:border-green-700 focus:ring-4 focus:ring-green-100 outline-none text-slate-800 placeholder-slate-400 transition font-mono tracking-wider" />
              </div>
            </div>

            <div>
              <label className="block mb-1.5 font-semibold text-sm text-slate-700">National ID Number</label>
              <div className="relative">
                <User size={18} className="absolute left-4 top-4 text-slate-400 pointer-events-none" />
                <input type="text" value={setupIdNumber}
                  onChange={(e) => setSetupIdNumber(e.target.value.replace(/\D/g, ""))}
                  placeholder="12345678" maxLength={8} autoComplete="off"
                  className="w-full h-14 pl-12 rounded-2xl border border-slate-300 focus:border-green-700 focus:ring-4 focus:ring-green-100 outline-none text-slate-800 placeholder-slate-400 transition" />
              </div>
            </div>

            <div>
              <label className="block mb-1.5 font-semibold text-sm text-slate-700">New Password</label>
              <PasswordInput value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)}
                placeholder="Min 8 chars, upper, lower, number"
                show={showSetupPassword} onToggle={() => setShowSetupPassword(v => !v)} icon={Lock} />
                            {setupPassword.length > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1,2,3,4,5].map(i => (
                      <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= passwordStrength.score ? passwordStrength.color : "bg-slate-200"}`} />
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">{passwordStrength.label}</p>
                </div>
              )}
            </div>

            <div>
              <label className="block mb-1.5 font-semibold text-sm text-slate-700">Confirm Password</label>
              <PasswordInput value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                show={showConfirmPassword} onToggle={() => setShowConfirmPassword(v => !v)} icon={Lock} />
              {confirmPassword.length > 0 && (
                <p className={`text-xs mt-1.5 ${setupPassword === confirmPassword ? "text-green-600" : "text-red-500"}`}>
                  {setupPassword === confirmPassword ? "✓ Passwords match" : "✗ Passwords do not match"}
                </p>
              )}
            </div>

            <button type="submit" disabled={loading}
              className="w-full h-14 rounded-2xl bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold flex items-center justify-center gap-3 transition shadow-md">
              {loading ? <><Loader2 className="animate-spin" size={20} />Activating...</> : <><Shield size={20} />Activate Account</>}
            </button>
          </form>
        )}

        {/* ── FORGOT PASSWORD FORM ── */}
        {mode === "forgot" && (
          <form onSubmit={handleForgotPassword} className="space-y-4" noValidate>
            <button type="button" onClick={() => switchMode("login")}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-2 transition">
              <ArrowLeft size={16} />Back to Login
            </button>

            <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 rounded-2xl p-4 border border-slate-200">
              Enter your member number and national ID. We'll send a password reset link to your registered email.
            </p>

            <div>
              <label className="block mb-1.5 font-semibold text-sm text-slate-700">Member Number</label>
              <div className="relative">
                <CreditCard size={18} className="absolute left-4 top-4 text-slate-400 pointer-events-none" />
                <input type="text" value={resetMemberNo}
                  onChange={(e) => setResetMemberNo(formatMemberNo(e.target.value))}
                  placeholder="UI-0001" maxLength={12} autoComplete="off"
                  className="w-full h-14 pl-12 rounded-2xl border border-slate-300 focus:border-green-700 focus:ring-4 focus:ring-green-100 outline-none text-slate-800 placeholder-slate-400 transition font-mono tracking-wider" />
              </div>
            </div>

            <div>
              <label className="block mb-1.5 font-semibold text-sm text-slate-700">National ID Number</label>
              <div className="relative">
                <User size={18} className="absolute left-4 top-4 text-slate-400 pointer-events-none" />
                <input type="text" value={resetIdNumber}
                  onChange={(e) => setResetIdNumber(e.target.value.replace(/\D/g, ""))}
                  placeholder="12345678" maxLength={8} autoComplete="off"
                  className="w-full h-14 pl-12 rounded-2xl border border-slate-300 focus:border-green-700 focus:ring-4 focus:ring-green-100 outline-none text-slate-800 placeholder-slate-400 transition" />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full h-14 rounded-2xl bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold flex items-center justify-center gap-3 transition shadow-md">
              {loading ? <><Loader2 className="animate-spin" size={18} />Sending...</> : <><RefreshCcw size={18} />Send Reset Email</>}
            </button>
          </form>
        )}

      </div>
    </div>
  );
}