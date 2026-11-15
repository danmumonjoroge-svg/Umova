// src/chama-erp-advanced/auth/ChamaLoginScreen.js
//
// The Chama login route (/chama/login). Chama has its own accounts (phone + password checked by
// authenticate_user()), so this is deliberately separate from the Finance logins (/login, /admin-login).
//
// It only decides WHICH screen to show from ChamaContext's authStage:
//   phone                          -> the phone + password form (LoginPhone)
//   select_chama / blocked / authenticated -> hand over to /chama, where AuthGate renders the chama
//                                    picker, the licence-blocked screen, or the dashboard
// so there is exactly one place (AuthGate) that decides those later screens.

import React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useChama } from "../ChamaContext";
import LoginPhone from "./LoginPhone";
import "./AuthGate.css";

export default function ChamaLoginScreen() {
  const { authStage } = useChama();
  const navigate = useNavigate();

  if (authStage === "checking") {
    return (
      <div className="ag-splash">
        <Loader2 size={26} className="spin" />
      </div>
    );
  }

  if (authStage !== "phone") return <Navigate to="/chama" replace />;

  return (
    <LoginPhone
      onRegisterClick={() => navigate("/chama", { state: { screen: "register_account" } })}
      onNewChamaClick={() => navigate("/chama", { state: { screen: "register_chama" } })}
    />
  );
}
