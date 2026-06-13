// ============================================================================
// FILE: src/components/Auth/AdminLogin.js
// USERS TABLE LOGIN
// USER_NO + PASSWORD
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
  UserCog,
} from "lucide-react";

import { supabase } from "../../supabaseClient";

export default function AdminLogin() {

  const navigate = useNavigate();

  const [userNo, setUserNo] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);

  const [showPassword, setShowPassword] =
    useState(false);

  const [error, setError] = useState("");

  const [success, setSuccess] = useState("");

  // ==========================================================================
  // LOGIN
  // ==========================================================================

  const handleLogin = async (e) => {

    e.preventDefault();

    setError("");
    setSuccess("");

    if (!userNo.trim() || !password) {

      setError("Enter Member Number and Password");

      return;
    }

    setLoading(true);

    try {

      // ==========================================================
      // LOOKUP USER
      // ==========================================================

      const {
        data: userRecord,
        error: userError,
      } = await supabase
        .from("users")
        .select(`
          id,
          member_no,
          name,
          email,
          role,
          status,
          auth_user_id
        `)
        .eq(
          "member_no",
          userNo.trim().toUpperCase()
        )
        .maybeSingle();

      if (userError || !userRecord) {

        setError(
          "Member Number not found."
        );

        return;
      }

      // ==========================================================
      // STATUS CHECK
      // ==========================================================

      if (
        userRecord.status === "inactive"
      ) {

        setError(
          "Account is inactive."
        );

        return;
      }

      if (
        userRecord.status === "suspended"
      ) {

        setError(
          "Account is suspended."
        );

        return;
      }

      // ==========================================================
      // EMAIL CHECK
      // ==========================================================

      if (!userRecord.email) {

        setError(
          "No email linked to this user."
        );

        return;
      }

      // ==========================================================
      // AUTH LOGIN
      // ==========================================================

      const {
        data,
        error: loginError,
      } =
        await supabase.auth.signInWithPassword({

          email: userRecord.email,
          password,
        });

      if (loginError) {

        if (
          loginError.message
            .toLowerCase()
            .includes(
              "invalid login credentials"
            )
        ) {

          setError(
            "Invalid password."
          );

        } else {

          setError(
            loginError.message
          );
        }

        return;
      }

      // ==========================================================
      // ROLE CHECK
      // ==========================================================

      const allowedRoles = [

        "admin",
        "staff",
        "manager",
        "supervisor",
        "credit",
        "finance",
        "ceo",
      ];

      if (
        !allowedRoles.includes(
          (userRecord.role || "")
            .toLowerCase()
        )
      ) {

        await supabase.auth.signOut();

        setError(
          "You do not have dashboard access."
        );

        return;
      }

      // ==========================================================
      // AUDIT LOG
      // ==========================================================

      try {

        await supabase
          .from("audit_logs")
          .insert([
            {
              user_id: data.user.id,
              action: "ADMIN_LOGIN",
              role: userRecord.role,
              email: userRecord.email,
            },
          ]);

      } catch {}

      // ==========================================================
      // SUCCESS
      // ==========================================================

      setSuccess(
        `Welcome ${userRecord.name}`
      );

      setTimeout(() => {

        navigate(
          "/admin",
          {
            replace: true,
          }
        );

      }, 1000);

    } catch (err) {

      console.error(err);

      setError(
        "Unexpected authentication error."
      );

    } finally {

      setLoading(false);
    }
  };

  return (

    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-green-950 to-black flex items-center justify-center px-4">

      <div className="w-full max-w-md bg-white rounded-[35px] overflow-hidden shadow-2xl">

        {/* HEADER */}

        <div className="bg-gradient-to-r from-green-800 to-emerald-700 p-8 text-white">

          <div className="flex items-center gap-4">

            <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center">

              <UserCog size={30} />

            </div>

            <div>

              <h1 className="text-3xl font-black">
                ADMIN ERP
              </h1>

              <p className="text-green-100">
                Staff Authentication
              </p>

            </div>

          </div>

        </div>

        {/* BODY */}

        <div className="p-8">

          {error && (
            <div className="mb-5 bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">

              <AlertTriangle
                size={20}
                className="text-red-600 shrink-0"
              />

              <div className="text-red-700 text-sm">
                {error}
              </div>

            </div>
          )}

          {success && (
            <div className="mb-5 bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-3">

              <CheckCircle2
                size={20}
                className="text-green-600 shrink-0"
              />

              <div className="text-green-700 text-sm">
                {success}
              </div>

            </div>
          )}

          <form
            onSubmit={handleLogin}
            className="space-y-6"
          >

            {/* USER NUMBER */}

            <div>

              <label className="font-semibold text-sm block mb-2">
                User Number
              </label>

              <div className="relative">

                <CreditCard
                  className="absolute left-4 top-4 text-slate-400"
                  size={20}
                />

                <input
                  type="text"
                  value={userNo}
                  onChange={(e) =>
                    setUserNo(
                      e.target.value
                        .toUpperCase()
                    )
                  }
                  placeholder="UI-0004"
                  className="w-full h-14 pl-12 rounded-2xl border"
                />

              </div>

            </div>

            {/* PASSWORD */}

            <div>

              <label className="font-semibold text-sm block mb-2">
                Password
              </label>

              <div className="relative">

                <Lock
                  className="absolute left-4 top-4 text-slate-400"
                  size={20}
                />

                <input
                  type={
                    showPassword
                      ? "text"
                      : "password"
                  }
                  value={password}
                  onChange={(e) =>
                    setPassword(
                      e.target.value
                    )
                  }
                  placeholder="Enter Password"
                  className="w-full h-14 pl-12 pr-14 rounded-2xl border"
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(
                      !showPassword
                    )
                  }
                  className="absolute right-4 top-4"
                >

                  {showPassword
                    ? <EyeOff size={20}/>
                    : <Eye size={20}/>
                  }

                </button>

              </div>

            </div>

            {/* LOGIN */}

            <button
              disabled={loading}
              className="w-full h-14 bg-green-800 hover:bg-green-700 text-white rounded-2xl font-bold flex items-center justify-center gap-3"
            >

              {loading ? (
                <>
                  <Loader2
                    size={20}
                    className="animate-spin"
                  />
                  Authenticating...
                </>
              ) : (
                <>
                  <Shield size={20}/>
                  Login
                </>
              )}

            </button>

          </form>

        </div>

      </div>

    </div>
  );
}