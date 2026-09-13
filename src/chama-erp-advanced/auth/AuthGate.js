import React, { useState } from "react";
import { useChama } from "../ChamaContext";
import LoginPhone from "./LoginPhone";
import RegisterAccount from "./RegisterAccount";
import RegisterChama from "./RegisterChama";
import ChamaSelector from "./ChamaSelector";
import LicenseBlocked from "./LicenseBlocked";
import { Loader2 } from "lucide-react";
import "./AuthGate.css";

// -----------------------------------------------------------------------------
// AuthGate
// Wrap your dashboard/router with this instead of rendering it directly:
//
//   <ChamaProvider>
//     <AuthGate>
//       <ChamaDashboardAdvanced />
//     </AuthGate>
//   </ChamaProvider>
//
// AuthGate renders the right screen for the current authStage and only
// ever renders `children` once authStage === "authenticated" — i.e. a
// real phone+password session exists, the chama has been resolved
// (auto-picked if there's only one, chosen from a list otherwise), and its
// license is valid.
//
// -----------------------------------------------------------------------------
// FIX (see AUDIT_REPORT.md, Finding P0-2): this file previously redirected
// authStage === "phone" to <Navigate to="/login" replace /> and relied on a
// "shared UnifiedLogin.js" screen that is not part of this package, is not
// referenced by App.js in the README's own wiring instructions, and does
// not exist anywhere in the delivered zip. Every fresh login attempt hit a
// route with nothing mounted on it. LoginPhone.js — fully built, styled,
// and wired to loginWithPhone()/registerUser() in ChamaContext — was
// present in the package but never actually rendered by anything.
// This restores AuthGate to render LoginPhone directly, exactly as the
// package's own README describes the flow ("AuthGate renders LoginPhone ->
// ChamaSelector if 2+ chamas -> LicenseBlocked -> otherwise your
// children"). If you have since built a real shared /login screen outside
// this package on purpose, swap the block below back to a <Navigate>, but
// make sure that route is actually mounted before you do.
// -----------------------------------------------------------------------------

export default function AuthGate({ children }) {
  const { authStage } = useChama();
  const [screen, setScreen] = useState("login"); // login | register_account | register_chama

  if (authStage === "checking") {
    return (
      <div className="ag-splash">
        <Loader2 size={26} className="spin" />
      </div>
    );
  }

  if (authStage === "phone") {
    if (screen === "register_account") return <RegisterAccount onBack={() => setScreen("login")} />;
    if (screen === "register_chama") return <RegisterChama onBack={() => setScreen("login")} />;
    return (
      <LoginPhone
        onRegisterClick={() => setScreen("register_account")}
        onNewChamaClick={() => setScreen("register_chama")}
      />
    );
  }

  if (authStage === "select_chama") {
    return <ChamaSelector />;
  }

  if (authStage === "blocked") {
    return <LicenseBlocked />;
  }

  // authStage === "authenticated"
  return children;
}
