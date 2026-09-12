// src/pos-erp/auth/POSAuthGate.jsx
//
// Controls the entire POS application per §14. The dashboard
// (`children`) only ever renders in the "authenticated" case.
//
// "signup" isn't a stage POSAuthContext tracks server-side (there's
// no session yet to derive it from) — it's local navigation between
// the login and registration forms, held here.

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { usePOSAuth } from "../context/POSAuthContext";
import POSLogin from "./POSLogin";
import POSTenantSignup from "./POSTenantSignup";
import POSForcePasswordChange from "./POSForcePasswordChange";
import POSAccountStatus from "./POSAccountStatus";

export default function POSAuthGate({ children }) {
  const { authStage, staff, logoutNotice } = usePOSAuth();
  const [preAuthScreen, setPreAuthScreen] = useState("login"); // "login" | "signup"

  switch (authStage) {
    case "checking":
      return <FullScreenLoader />;

    case "logged_out":
      return preAuthScreen === "signup" ? (
        <POSTenantSignup onBackToLogin={() => setPreAuthScreen("login")} />
      ) : (
        <POSLogin onGoToSignup={() => setPreAuthScreen("signup")} logoutNotice={logoutNotice} />
      );

    case "pending":
    case "rejected":
    case "suspended":
      return <POSAccountStatus stage={authStage} />;

    case "must_change_password":
      return <POSForcePasswordChange staffName={staff?.name} />;

    case "authenticated":
      return children;

    default:
      return <FullScreenLoader />;
  }
}

function FullScreenLoader() {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center">
      <Loader2 size={28} className="animate-spin text-emerald-800" />
    </div>
  );
}
