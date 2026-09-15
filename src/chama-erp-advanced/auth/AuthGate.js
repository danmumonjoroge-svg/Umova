import React, { useState } from "react";
import { useLocation, Navigate } from "react-router-dom";
import { useChama } from "../ChamaContext";
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
// Plain login now happens on the shared /login screen (UnifiedLogin.js),
// not here — landing on /chama while logged out redirects there. The
// registration screens (new account / new chama) still live here, since
// they're chama-specific; UnifiedLogin's "register" links navigate to
// /chama with state={{screen: "register_account" | "register_chama"}} to
// reach them directly instead of via a plain login form.
// -----------------------------------------------------------------------------

export default function AuthGate({ children }) {
  const { authStage } = useChama();
  const location = useLocation();
  const [screen, setScreen] = useState(location.state?.screen || "login");

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
    // Plain login (screen === "login") funnels through the shared entry
    // point instead of rendering LoginPhone inline here.
    return <Navigate to="/login" replace />;
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
