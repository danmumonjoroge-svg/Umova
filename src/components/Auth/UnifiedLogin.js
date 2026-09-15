// ============================================================================
// FILE: src/components/Auth/UnifiedLogin.js
// ONE LOGIN SCREEN FOR ALL THREE SYSTEMS: Umova members, Umova staff/POS,
// and Chama.
//
// How identity is detected: member codes and staff codes share the exact
// same "UI-XXXX" shape (both are the `member_no` column, just on
// different tables — see loginHelpers.js), so a dash in the input means
// "try it as a code." No dash + mostly digits means "try it as a phone
// number" (Chama's identity, checked via authenticate_user() RPC, not
// Supabase Auth — see ChamaContext.js).
//
// Precedence when the input is a code: staff table is checked first, then
// member table — same precedence AuthContext.js already uses when
// resolving a signed-in Supabase user's role.
//
// Chama login doesn't go through Supabase Auth at all, so once
// loginWithPhone() succeeds (or needs a chama picked, or is blocked by an
// expired license), we hand off to /chama and let AuthGate render the
// right sub-view — this file never renders ChamaSelector/LicenseBlocked
// itself, to avoid having two places that decide which of those to show.
//
// Face ID / Fingerprint: webauthnHelpers.loginWithPasskey() signs in with
// nothing typed at all — no member number, no password. Passkeys are
// registered as discoverable credentials, so the authenticator itself
// holds the user handle and the biometric check identifies the account.
// If the identifier field happens to be filled in it's passed along as a
// hint, which keeps older non-discoverable passkeys working; otherwise it
// falls back silently to the password field.
// ============================================================================

import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  UserCircle2,
  Lock,
  Fingerprint,
} from "lucide-react";

import { useChama } from "../../chama-erp-advanced/ChamaContext";
import { resolveStaffLogin, resolveMemberLogin, looksLikePhoneNumber } from "./loginHelpers";
import { loginWithPasskey, passkeysSupported } from "./webauthnHelpers";

export default function UnifiedLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  // Set by AdminLoginRoute-equivalent guards, or by a login button that
  // wants staff to land somewhere specific (e.g. POS Login -> /admin/pos).
  const from = location.state?.from || "/admin/dashboard";

  const { loginWithPhone, authStage, authError, authBusy } = useChama();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Only react to ChamaContext's authStage changes when WE just triggered
  // a phone-login attempt — otherwise a leftover/restored chama session
  // from a previous visit would silently redirect someone away from a
  // member/staff login attempt they never asked to make.
  const attemptedChama = useRef(false);

  useEffect(() => {
    if (!attemptedChama.current) return;

    if (authStage === "select_chama" || authStage === "authenticated" || authStage === "blocked") {
      attemptedChama.current = false;
      navigate("/chama", { replace: true });
      return;
    }

    if (authStage === "phone" && authError) {
      attemptedChama.current = false;
      setError(authError);
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStage, authError]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const trimmed = identifier.trim();
    if (!trimmed || !password) {
      setError("Enter your member number, user number, or phone number, and your password.");
      return;
    }

    setBusy(true);

    // ---- Path 1: phone number -> Chama (custom RPC auth) ----
    if (looksLikePhoneNumber(trimmed)) {
      attemptedChama.current = true;
      await loginWithPhone(trimmed, password);
      // Resolution happens in the effect above once authStage/authError update.
      return;
    }

    // ---- Path 2: "UI-XXXX" code -> staff first, then member ----
    try {
      const staffResult = await resolveStaffLogin(trimmed, password);

      if (staffResult.ok) {
        setSuccess(`Welcome ${staffResult.userRecord.name}`);
        setTimeout(() => navigate(from, { replace: true }), 800);
        return;
      }

      // Only fall through to the member table if this code simply isn't a
      // staff number at all — a wrong password or blocked staff account
      // should surface as a staff error, not silently retry as a member.
      if (staffResult.reason !== "NOT_FOUND") {
        setError(staffResult.message);
        setBusy(false);
        return;
      }

      const memberResult = await resolveMemberLogin(trimmed, password);

      if (memberResult.ok) {
        setSuccess(`Welcome back, ${memberResult.member.name || "Member"}!`);
        setTimeout(() => navigate("/redirect", { replace: true }), 800);
        return;
      }

      if (memberResult.reason === "NEEDS_SETUP") {
        // Hand off to the full member-setup flow (National ID verification,
        // password creation) rather than reimplementing it here.
        navigate("/member-login", { state: { mode: "setup", memberNo: trimmed } });
        return;
      }

      setError(memberResult.message);
      setBusy(false);
    } catch (err) {
      console.error(err);
      setError("Unexpected authentication error.");
      setBusy(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError("");
    setSuccess("");

    const trimmed = identifier.trim();

    // Nothing needs to be typed. If the field happens to be filled in
    // with a member/user code we pass it along, which keeps passkeys
    // registered before discoverable credentials were required working —
    // those can't be found without an explicit credential list. A phone
    // number is a Chama account, which has its own separate login, so
    // it's never a useful hint here.
    const hint = trimmed && !looksLikePhoneNumber(trimmed) ? trimmed : undefined;

    setPasskeyBusy(true);
    try {
      const result = await loginWithPasskey(hint);

      if (result.cancelled) {
        // User dismissed the OS prompt — not an error, say nothing.
        return;
      }

      if (!result.usedPasskey) {
        setError(
          hint
            ? "No Face ID / Fingerprint is set up for this account yet. Enter your password to sign in, then add it in Settings."
            : "No Face ID / Fingerprint is set up on this device yet. Sign in with your password once, then add it in Settings."
        );
        return;
      }

      setSuccess("Signed in with Face ID / Fingerprint.");
      setTimeout(() => navigate(from, { replace: true }), 500);
    } catch (err) {
      console.error(err);
      setError(err.message || "Face ID / Fingerprint sign-in failed. Try your password instead.");
    } finally {
      setPasskeyBusy(false);
    }
  };

  const isBusy = busy || authBusy;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-green-950 to-black flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-[35px] overflow-hidden shadow-2xl">
        {/* HEADER */}
        <div className="bg-gradient-to-r from-green-800 to-emerald-700 p-8 text-white">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center">
              <UserCircle2 size={30} />
            </div>
            <div>
              <h1 className="text-3xl font-black">UMOVA</h1>
              <p className="text-green-100">Sign in to continue</p>
            </div>
          </div>
        </div>

        {/* BODY */}
        <div className="p-8">
          {error && (
            <div className="mb-5 bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
              <AlertTriangle size={20} className="text-red-600 shrink-0" />
              <div className="text-red-700 text-sm">{error}</div>
            </div>
          )}

          {success && (
            <div className="mb-5 bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-3">
              <CheckCircle2 size={20} className="text-green-600 shrink-0" />
              <div className="text-green-700 text-sm">{success}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="font-semibold text-sm block mb-2">
                Member No, User No, or Phone Number
              </label>
              <div className="relative">
                <UserCircle2 className="absolute left-4 top-4 text-slate-400" size={20} />
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="UI-0001, UI-0004, or 07XXXXXXXX"
                  autoComplete="username"
                  className="w-full h-14 pl-12 rounded-2xl border border-slate-300 focus:border-green-700 focus:ring-4 focus:ring-green-100 outline-none text-slate-800 placeholder-slate-400 transition"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold text-sm block mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-4 text-slate-400" size={20} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter Password"
                  autoComplete="current-password"
                  className="w-full h-14 pl-12 pr-14 rounded-2xl border border-slate-300 focus:border-green-700 focus:ring-4 focus:ring-green-100 outline-none text-slate-800 placeholder-slate-400 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-4 text-slate-400"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button
              disabled={isBusy}
              className="w-full h-14 bg-green-800 hover:bg-green-700 disabled:opacity-60 text-white rounded-2xl font-bold flex items-center justify-center gap-3"
            >
              {isBusy ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <Lock size={20} />
                  Login
                </>
              )}
            </button>

            {passkeysSupported() && (
              <button
                type="button"
                disabled={passkeyBusy}
                onClick={handlePasskeyLogin}
                className="w-full h-12 border-2 border-green-700 text-green-800 hover:bg-green-50 disabled:opacity-60 rounded-2xl font-semibold flex items-center justify-center gap-2"
              >
                {passkeyBusy ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Fingerprint size={18} />
                )}
                {passkeyBusy ? "Verifying..." : "Use Face ID / Fingerprint"}
              </button>
            )}
          </form>

          <div className="mt-6 text-center text-sm text-slate-500">
            First time logging in, or forgot your password?{" "}
            <button
              type="button"
              onClick={() => navigate("/member-login")}
              className="text-green-700 font-semibold hover:underline"
            >
              Set up / reset here
            </button>
          </div>

          <div className="mt-3 text-center text-xs text-slate-400">
            New to Chama?{" "}
            <button
              type="button"
              onClick={() => navigate("/chama", { state: { screen: "register_account" } })}
              className="text-green-700 font-semibold hover:underline"
            >
              Create an account
            </button>{" "}
            or{" "}
            <button
              type="button"
              onClick={() => navigate("/chama", { state: { screen: "register_chama" } })}
              className="text-green-700 font-semibold hover:underline"
            >
              register a new chama
            </button>
          </div>

          <div className="mt-3 text-center text-xs text-slate-400">
            New staff member?{" "}
            <button
              type="button"
              onClick={() => navigate("/register-pos")}
              className="text-green-700 font-semibold hover:underline"
            >
              Register for POS access
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}