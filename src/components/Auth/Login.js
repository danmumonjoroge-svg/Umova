// ============================================================================
// FILE: src/components/Auth/Login.js
// FINAL CLEAN LOGIN SYSTEM
// MEMBER_NO + SUPABASE AUTH
// WORKS WITH:
// members.member_no
// members.email
// members.auth_user_id
// members.password_set
// members.status
// ============================================================================

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Eye,
  EyeOff,
  Shield,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Lock,
} from "lucide-react";
import { supabase } from "../../supabaseClient";

export default function Login() {
  const navigate = useNavigate();

  // ============================================================================
  // STATE
  // ============================================================================
  const [memberNo, setMemberNo] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ============================================================================
  // LOGIN LOGIC
  // ============================================================================
  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // 1. Client-Side Input Check
    if (!memberNo.trim() || !password) {
      setError("Enter member number and password");
      return;
    }

    setLoading(true);

    try {
      // 2. Fetch Member Record (.maybeSingle prevents unhandled crash spikes)
      const { data: member, error: memberError } = await supabase
        .from("members")
        .select(
          "id, member_no, name, email, auth_user_id, password_set, status"
        )
        .eq("member_no", memberNo.trim().toUpperCase())
        .maybeSingle();

      console.log("LOGIN MEMBER DATA:", member);

      if (memberError) {
        console.error("DB LOOKUP ERROR:", memberError);
      }

      if (memberError || !member) {
        setError("Member number not found. Check and try again.");
        return;
      }

      // 3. Status Flags Restrictions
      if (member.status === "inactive") {
        setError(
          "Account inactive. Please contact the SACCO administration office."
        );
        return;
      }

      if (member.status === "suspended") {
        setError(
          "Account suspended. Please contact the SACCO administration office."
        );
        return;
      }

      // 4. Verification Check
      if (!member.email) {
        setError(
          "No email address linked to this account. Contact support."
        );
        return;
      }

      // 5. Initial Lifecycle Validation Check
      if (!member.password_set) {
        navigate("/set-password", {
          state: {
            member_no: member.member_no,
          },
        });
        return;
      }

      // 6. Native Supabase Auth Call
      const { data: loginData, error: loginError } =
        await supabase.auth.signInWithPassword({
          email: member.email,
          password: password,
        });

      console.log("LOGIN RESPONSE:", loginData);

      if (loginError) {
        console.error("SUPABASE AUTH ERROR:", loginError);

        if (
          loginError.message
            .toLowerCase()
            .includes("invalid login credentials")
        ) {
          setError("Invalid password. Please try again.");
        } else if (
          loginError.message
            .toLowerCase()
            .includes("email not confirmed")
        ) {
          setError(
            "Your email is unverified. Check your inbox for confirmation."
          );
        } else {
          setError(loginError.message);
        }

        return;
      }

      // 7. Successful Session Match
      setSuccess(`Welcome back, ${member.name || "Member"}`);

      setTimeout(() => {
        navigate("/member", {
          replace: true,
        });
      }, 1000);

    } catch (err) {
      console.error("LOGIN SYSTEM CRASH:", err);
      setError(
        "An unexpected authentication error occurred."
      );
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // UI RENDER
  // ============================================================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-green-50 to-slate-200 flex items-center justify-center px-4">

      <div className="w-full max-w-md bg-white rounded-[30px] shadow-2xl border border-slate-200 overflow-hidden">

        {/* HEADER */}
        <div className="bg-gradient-to-r from-green-700 to-emerald-700 p-8 text-white">

          <div className="flex items-center gap-4">

            <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center">
              <Shield size={28} />
            </div>

            <div>
              <h1 className="text-3xl font-black tracking-tight">
                SACCO ERP
              </h1>

              <p className="text-green-100 text-sm">
                Member Authentication
              </p>
            </div>

          </div>

        </div>

        {/* BODY */}
        <div className="p-8">

          {/* ALERTS */}
          {error && (
            <div className="mb-5 bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">

              <AlertTriangle
                className="text-red-600 mt-0.5 shrink-0"
                size={20}
              />

              <div className="text-sm text-red-700 leading-relaxed">
                {error}
              </div>

            </div>
          )}

          {success && (
            <div className="mb-5 bg-green-50 border border-green-200 rounded-2xl p-4 flex items-start gap-3">

              <CheckCircle2
                className="text-green-600 mt-0.5 shrink-0"
                size={20}
              />

              <div className="text-sm text-green-700 leading-relaxed">
                {success}
              </div>

            </div>
          )}

          {/* FORM */}
          <form
            onSubmit={handleLogin}
            className="space-y-6"
            noValidate
          >

            {/* MEMBER NO INPUT */}
            <div>

              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Member Number
              </label>

              <div className="relative">

                <CreditCard
                  className="absolute left-4 top-4 text-slate-400 pointer-events-none"
                  size={20}
                />

                <input
                  type="text"
                  value={memberNo}
                  onChange={(e) =>
                    setMemberNo(
                      e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9-]/g, "")
                    )
                  }
                  placeholder="UI-0001"
                  maxLength={12}
                  autoComplete="username"
                  className="w-full h-14 pl-12 pr-4 rounded-2xl border border-slate-300 focus:border-green-600 focus:ring-4 focus:ring-green-100 font-mono tracking-wider text-slate-800 outline-none transition"
                />

              </div>

            </div>

            {/* PASSWORD INPUT */}
            <div>

              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Password
              </label>

              <div className="relative">

                <Lock
                  className="absolute left-4 top-4 text-slate-400 pointer-events-none"
                  size={20}
                />

                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full h-14 pl-12 pr-14 rounded-2xl border border-slate-300 focus:border-green-600 focus:ring-4 focus:ring-green-100 text-slate-800 outline-none transition"
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(!showPassword)
                  }
                  className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 transition"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff size={20} />
                  ) : (
                    <Eye size={20} />
                  )}
                </button>

              </div>

            </div>

            {/* ACTION ACCELERATOR BUTTON */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-green-700 to-emerald-700 text-white font-bold text-lg shadow-lg hover:shadow-xl active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100 disabled:active:scale-100 transition flex items-center justify-center gap-3"
            >
              {loading ? (
                <>
                  <Loader2
                    className="animate-spin"
                    size={20}
                  />
                  Authenticating...
                </>
              ) : (
                <>
                  <Shield size={20} />
                  Login
                </>
              )}
            </button>

          </form>

          {/* FOOTER */}
          <div className="mt-8 pt-6 border-t border-slate-200 text-center space-y-3">

            <div>
              <button
                onClick={() =>
                  navigate("/set-password")
                }
                className="text-green-700 text-sm font-semibold hover:text-green-900 hover:underline transition"
              >
                First time login? Set Password
              </button>
            </div>

            <div>
              <button
                onClick={() =>
                  navigate("/forgot-password")
                }
                className="text-slate-500 hover:text-green-700 text-sm font-medium transition"
              >
                Forgot Password?
              </button>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}