// ============================================================================
// FILE: src/components/Auth/AdminLogin.js
// USERS TABLE LOGIN
// USER_NO + PASSWORD
//
// Phone app only: if fingerprint was turned on for this phone, <FingerprintLogin> shows
// a "Use fingerprint" button under the Login button. The fingerprint releases a device secret from the Android
// Keystore, the server verifies it and returns a one-time token, and verifyOtp() makes a normal Supabase
// session (src/security/deviceTrust.js). Roles, StaffGuard and RLS apply exactly as for a password login.
// On the web nothing changes. The password form below is always the fallback.
// ============================================================================

import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
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

import { resolveStaffLogin } from "./loginHelpers";
import FingerprintLogin from "../../security/FingerprintLogin";
import { supabase } from "../../supabaseClient";
import umovaEmblem from "../../assets/brand/umova-emblem-small.png";

export default function AdminLogin() {

  const navigate = useNavigate();
  const location = useLocation();
  // Set by AdminLoginRoute's <Navigate state={{from: ...}}/> when a staff-
  // only page (e.g. /admin/pos) redirected here, or by a login button that
  // wants to land somewhere other than the default dashboard.
  const from = location.state?.from || "/admin/dashboard";

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

      const result = await resolveStaffLogin(userNo, password);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const { userRecord } = result;

      // ==========================================================
      // SUCCESS
      // ==========================================================

      setSuccess(
        `Welcome ${userRecord.name}`
      );

      setTimeout(() => {

        navigate(
          from,
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

            <div className="w-16 h-16 rounded-2xl bg-white shadow-md flex items-center justify-center p-1.5">

              <img src={umovaEmblem} alt="Umova" className="w-full h-full object-contain" />

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

          {/* Phone app only, and only after fingerprint was turned on for this phone; renders nothing otherwise. */}
          <FingerprintLogin
            service="finance"
            client={supabase}
            onSignedIn={() => {
              setError("");
              setSuccess("Signed in with fingerprint.");
              setTimeout(() => navigate(from, { replace: true }), 600);
            }}
          />

        </div>

      </div>

    </div>
  );
}