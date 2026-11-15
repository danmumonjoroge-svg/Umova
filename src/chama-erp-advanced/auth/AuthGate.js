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
// Plain Chama login lives on its own route, /chama/login (ChamaLoginScreen).
// Landing on /chama while logged out redirects there. It must NOT redirect
// to /login: that is the Finance (SACCO member) login and knows nothing
// about phone numbers. The registration screens (new account / new chama)
// still live here; links to them navigate to /chama with
// state={{screen: "register_account" | "register_chama"}}.
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
    // Plain login (screen === "login") goes to the Chama login route.
    return <Navigate to="/chama/login" replace />;
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
