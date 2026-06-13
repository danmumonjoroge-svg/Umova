// ============================================================================
// FILE: src/Routes/ProtectedRoute.js
// ENTERPRISE ROLE-BASED ROUTE PROTECTION
// ============================================================================

import React from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../Context/AuthContext";

// ============================================================================
// LOADER
// ============================================================================

function Loader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white shadow-xl rounded-3xl p-10 w-[420px]">

        <div className="flex flex-col items-center">

          <div className="w-16 h-16 border-4 border-green-600 border-t-transparent rounded-full animate-spin mb-5" />

          <h2 className="text-2xl font-bold text-slate-800">
            SACCO ERP
          </h2>

          <p className="text-slate-500 text-sm mt-2">
            Verifying access...
          </p>

        </div>

      </div>
    </div>
  );
}

// ============================================================================
// PROTECTED ROUTE
// ============================================================================

export default function ProtectedRoute({
  children,
  allowedRoles = [],
}) {

  const {
    authReady,
    profileLoading,
    isAuthenticated,
    role,
  } = useAuth();

  // ==========================================================================
  // WAIT FOR AUTH
  // ==========================================================================

  if (!authReady || profileLoading) {
    return <Loader />;
  }

  // ==========================================================================
  // NOT LOGGED IN
  // ==========================================================================

  if (!isAuthenticated) {

    if (
      allowedRoles.includes("admin") ||
      allowedRoles.includes("staff")
    ) {

      return (
        <Navigate
          to="/admin-login"
          replace
        />
      );
    }

    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  // ==========================================================================
  // ROLE VALIDATION
  // ==========================================================================

  if (
    allowedRoles.length > 0 &&
    !allowedRoles.includes(role)
  ) {

    // MEMBER TRYING ADMIN PAGE

    if (role === "member") {

      return (
        <Navigate
          to="/member/dashboard"
          replace
        />
      );
    }

    // STAFF TRYING MEMBER PAGE

    return (
      <Navigate
        to="/admin/dashboard"
        replace
      />
    );
  }

  // ==========================================================================
  // ACCESS GRANTED
  // ==========================================================================

  return children;
}